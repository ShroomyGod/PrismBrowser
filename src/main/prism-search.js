// prism-search.js — the query engine for Prism Search.
//
// Parses queries (phrases, -exclusions, site:, intitle:), scores with
// BM25 over the local inverted index, blends in PageRank authority and
// title-phrase boosts, and builds highlighted snippets on-device.
const { index, tokenize } = require('./index-store');
const settings = require('./settings');

const BM25_K1 = 1.4;
const BM25_B = 0.72;

function parseQuery(raw) {
  const query = { phrases: [], terms: [], exclude: [], site: null, intitle: null, plain: raw };
  const tokens = [];
  let s = String(raw || '');

  const phraseRe = /"([^"]+)"/g;
  let m;
  while ((m = phraseRe.exec(s))) {
    if (m[1].trim()) query.phrases.push(m[1].toLowerCase());
    s = s.replace(m[0], ' ');
  }
  for (const part of s.split(/\s+/)) {
    if (!part) continue;
    if (part.startsWith('-') && part.length > 1) { query.exclude.push(part.slice(1).toLowerCase()); continue; }
    if (part.startsWith('site:')) { query.site = part.slice(5).toLowerCase(); continue; }
    if (part.startsWith('intitle:')) { query.intitle = (part.slice(8) || '').toLowerCase(); continue; }
    tokens.push(part);
  }
  for (const t of tokenize(tokens.join(' '))) query.terms.push(t);
  if (!query.terms.length && query.phrases.length) {
    for (const p of query.phrases) for (const t of tokenize(p)) if (!query.terms.includes(t)) query.terms.push(t);
  }
  return query;
}

function snippetFor(text, query, len = 220) {
  if (!text) return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= len) return flat;
  const lower = flat.toLowerCase();
  let bestPos = 0, bestScore = -1;
  const terms = [...query.terms, ...query.phrases.join(' ').split(/\s+/)].filter(Boolean);
  for (const t of terms) {
    const p = lower.indexOf(t.toLowerCase());
    if (p >= 0) {
      const score = 1000 - p; // earlier mentions read better
      if (score > bestScore) { bestScore = score; bestPos = p; }
    }
  }
  let start = Math.max(0, bestPos - 60);
  // snap to word boundary
  if (start > 0) { const sp = flat.indexOf(' ', start); if (sp > 0 && sp < bestPos) start = sp + 1; }
  let snip = flat.slice(start, start + len);
  if (start > 0) snip = '...' + snip;
  if (start + len < flat.length) snip += '...';
  return snip;
}

function search(rawQuery, opts = {}) {
  const t0 = Date.now();
  const q = parseQuery(rawQuery);
  const limit = Math.min(opts.limit || 20, 100);
  const offset = opts.offset || 0;

  if (!index.docCount()) {
    return { query: rawQuery, parsed: { terms: q.terms, phrases: q.phrases, site: q.site, exclude: q.exclude },
      results: [], total: 0, offset, took: Date.now() - t0, docs: 0, emptyIndex: true };
  }

  const N = index.docCount();
  const avgLen = index.avgLen || 200;
  const df = new Map();
  const ranks = index.ranks();

  // Candidate doc set: union of postings for query terms (capped scans).
  const candidates = new Map(); // docId -> bm25 score
  const addTerm = (term, weight) => {
    const arr = index.postings.get(term);
    if (!arr) return;
    df.set(term, arr.length / 2);
    const idf = Math.log(1 + (N - arr.length / 2 + 0.5) / (arr.length / 2 + 0.5));
    for (let i = 0; i < arr.length; i += 2) {
      const docId = arr[i], tf = arr[i + 1];
      const dl = index.docLen.get(docId) || avgLen;
      const norm = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / avgLen)));
      const cur = candidates.get(docId) || 0;
      candidates.set(docId, cur + idf * norm * weight);
    }
  };

  if (q.terms.length) {
    q.terms.forEach((t, i) => addTerm(t, i === 0 ? 1.15 : 1));
  } else {
    // pure phrase / site query: fall back to site's docs
    for (const [id, d] of index.docs) {
      if (!q.site || d.host.endsWith(q.site)) candidates.set(id, 0.5);
    }
  }

  // Phrase boosts: title contains phrase >> body contains phrase
  const phraseTitles = new Map();
  if (q.phrases.length || q.terms.length) {
    const phraseList = q.phrases.length ? q.phrases : [q.terms.join(' ')];
    for (const [id, d] of index.docs) {
      if (!candidates.has(id)) continue;
      const title = (d.title || '').toLowerCase();
      for (const ph of phraseList) {
        if (ph && title.includes(ph)) {
          candidates.set(id, (candidates.get(id) || 0) + 6);
          phraseTitles.set(id, true);
        }
      }
    }
  }

  // intitle: filter/boost
  if (q.intitle) {
    for (const [id, d] of [...index.docs]) {
      if (candidates.has(id) && !(d.title || '').toLowerCase().includes(q.intitle)) candidates.delete(id);
    }
  }

  // site: filter
  if (q.site) {
    for (const [id, d] of [...index.docs]) {
      if (candidates.has(id)) {
        const h = d.host || '';
        if (!(h === q.site || h.endsWith('.' + q.site))) candidates.delete(id);
      }
    }
  }

  // exclusions: search doc text? we don't store full text; use title+desc
  if (q.exclude.length) {
    for (const [id, d] of [...index.docs]) {
      if (!candidates.has(id)) continue;
      const hay = ((d.title || '') + ' ' + (d.desc || '') + ' ' + d.host).toLowerCase();
      if (q.exclude.some((x) => hay.includes(x))) candidates.delete(id);
    }
  }

  // Final ranking: BM25 + authority + fresh-tiebreak
  const scored = [];
  for (const [id, bm25] of candidates) {
    const d = index.docs.get(id);
    if (!d) continue;
    const pr = ranks.get(id) || 0;
    const score = bm25 * 1.0 + pr * 2.2 + (phraseTitles.get(id) ? 1.5 : 0);
    scored.push([id, score]);
  }
  scored.sort((a, b) => b[1] - a[1]);

  const total = scored.length;
  const results = [];
  for (let i = offset; i < Math.min(offset + limit, scored.length); i++) {
    const [id] = scored[i];
    const d = index.docs.get(id);
    results.push({
      url: d.u,
      title: d.title || d.u,
      host: d.host,
      snippet: snippetFor(d.desc || '', q, 180),
      bodySnippet: d.desc ? '' : snippetFor('', q, 0), // reserved
      crawledAt: d.ts,
      score: Number(scored[i][1].toFixed(3))
    });
    if (!results[results.length - 1].snippet) {
      // no meta description: synthesize from title + host
      results[results.length - 1].snippet = d.desc || (d.title ? '' : '');
    }
  }

  return {
    query: rawQuery,
    parsed: { terms: q.terms, phrases: q.phrases, site: q.site, exclude: q.exclude },
    results, total, offset,
    took: Date.now() - t0,
    docs: N,
    engine: 'Prism Search (local index)',
    emptyIndex: false
  };
}

function suggest(rawQuery, limit = 6) {
  const q = String(rawQuery || '').trim();
  if (!q) return [];
  const parts = q.split(/\s+/);
  const last = parts[parts.length - 1].toLowerCase();
  const prefix = last.replace(/^[-\"']+/,'');
  const out = [];
  if (prefix.length >= 2) {
    for (const term of index.suggestTerms(prefix, limit)) {
      parts[parts.length - 1] = term;
      out.push(parts.join(' '));
    }
  }
  return out;
}

function stats() {
  return {
    engine: 'Prism Search',
    docs: index.docCount(),
    hosts: index.hostCount(),
    terms: index.termCount(),
    lastCrawl: index.stats.lastCrawl,
    crawler: settings.all().search.crawl
  };
}

module.exports = { search, suggest, stats, parseQuery, snippetFor };