// index-store.js — Prism Search's own search index.
//
// A forward store (documents) plus a compressed inverted index (term ->
// postings [docId, termFreq]) with BM25 ranking, a link graph for PageRank
// authority, and prefix vocabulary for query suggestions. Persisted through
// the encrypted securestore so the index is private to this machine.
const crypto = require('crypto');
const securestore = require('./securestore');

const SAVE_INTERVAL_MS = 20 * 1000;

class IndexStore {
  constructor() {
    this.docs = new Map();      // docId -> {u,url,host,title,desc,textLen,ts,rank}
    this.urlToId = new Map();   // normalized url -> docId
    this.postings = new Map();  // term -> array [docId, tf, ...] flat pairs
    this.docLen = new Map();    // docId -> token count
    this.outlinks = new Map();  // docId -> [docId]
    this.vocabSorted = null;    // cache for prefix suggest
    this.avgLen = 0;
    this.lastSave = 0;
    this.stats = { added: 0, updated: 0, lastCrawl: 0 };
    this._prDirty = true;
    this._prCache = null;
  }

  init() {
    const blob = securestore.load('searchindex', null);
    if (blob) this._deserialize(blob);
  }

  _serialize() {
    const docs = [];
    for (const [id, d] of this.docs) {
      docs.push({ id, u: d.u, h: d.host, t: d.title, d: d.desc, l: d.textLen, ts: d.ts });
    }
    const postings = [];
    for (const [term, arr] of this.postings) postings.push([term, arr]);
    const links = [];
    for (const [id, outs] of this.outlinks) if (outs.length) links.push([id, outs]);
    return { v: 1, docs, postings, links, stats: this.stats };
  }

  _deserialize(blob) {
    try {
      this.docs = new Map();
      this.urlToId = new Map();
      this.postings = new Map();
      this.docLen = new Map();
      this.outlinks = new Map();
      for (const d of blob.docs || []) {
        this.docs.set(d.id, { u: d.u, host: d.h, title: d.t, desc: d.d, textLen: d.l || 0, ts: d.ts || 0 });
        this.urlToId.set(d.u, d.id);
      }
      for (const [term, arr] of blob.postings || []) this.postings.set(term, arr);
      for (const [id, outs] of blob.links || []) this.outlinks.set(id, outs);
      this.stats = blob.stats || this.stats;
      // rebuild doc lengths from postings (exact enough)
      for (const arr of this.postings.values()) {
        for (let i = 0; i < arr.length; i += 2) {
          this.docLen.set(arr[i], (this.docLen.get(arr[i]) || 0) + arr[i + 1]);
        }
      }
      this._recomputeAvgLen();
      this._prDirty = true;
    } catch (e) {
      console.error('[prism-index] corrupt index, starting fresh', e.message);
    }
  }

  _recomputeAvgLen() {
    if (!this.docLen.size) { this.avgLen = 0; return; }
    let total = 0;
    for (const l of this.docLen.values()) total += l;
    this.avgLen = total / this.docLen.size;
  }

  normalizeUrl(url) {
    try {
      const u = new URL(url);
      u.hash = '';
      let s = u.origin + u.pathname.replace(/\/+$/, '');
      if (u.search) {
        const keep = [...u.searchParams.entries()].filter(([k]) => ['id','p','page','post','q','s','product','category'].includes(k.toLowerCase()));
        if (keep.length) s += '?' + keep.map(([k, v]) => k + '=' + v).join('&');
      }
      return s;
    } catch (_) { return null; }
  }

  addDocument(url, { title, description, bodyText, links, crawledAt }) {
    const norm = this.normalizeUrl(url);
    if (!norm) return null;
    let host = '';
    try { host = new URL(url).hostname.toLowerCase(); } catch (_) { return null; }

    // Truncate oversized bodies: index quality saturates long before this.
    const text = (bodyText || '').slice(0, 40000);
    const tokens = tokenize(text);
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);

    let docId = this.urlToId.get(norm);
    const isNew = !docId;
    if (isNew) {
      docId = crypto.randomUUID();
      this.urlToId.set(norm, docId);
      this.docs.set(docId, { u: norm, host, title: title || norm, desc: '', textLen: 0, ts: crawledAt || Date.now() });
      this.stats.added++;
    } else {
      this.stats.updated++;
      // remove old postings for this doc
      const old = this.docs.get(docId);
      if (old) host = old.host;
      for (const arr of this.postings.values()) {
        for (let i = 0; i < arr.length; i += 2) {
          if (arr[i] === docId) { arr.splice(i, 2); i -= 2; }
        }
      }
      this.docLen.delete(docId);
      this.outlinks.delete(docId);
    }

    const doc = this.docs.get(docId);
    doc.title = (title || norm).slice(0, 300);
    doc.desc = (description || '').slice(0, 400);
    doc.textLen = tokens.length;
    doc.ts = crawledAt || Date.now();
    doc.host = host;

    let len = 0;
    for (const [term, count] of tf) {
      len += count;
      let arr = this.postings.get(term);
      if (!arr) { arr = []; this.postings.set(term, arr); }
      arr.push(docId, count);
    }
    this.docLen.set(docId, len);

    const outIds = [];
    if (Array.isArray(links)) {
      for (const l of links.slice(0, 300)) {
        const targetId = this.urlToId.get(this.normalizeUrl(l));
        if (targetId && targetId !== docId) outIds.push(targetId);
      }
    }
    this.outlinks.set(docId, [...new Set(outIds)]);

    this._recomputeAvgLen();
    this.vocabSorted = null;
    this._prDirty = true;
    if (Date.now() - this.lastSave > SAVE_INTERVAL_MS) this.persist();
    return docId;
  }

  removeHost(host) {
    const doomed = [];
    for (const [id, d] of this.docs) if (d.host === host) doomed.push(id);
    for (const id of doomed) this.removeDocument(id);
    return doomed.length;
  }

  removeDocument(docId) {
    const doc = this.docs.get(docId);
    if (!doc) return;
    this.docs.delete(docId);
    this.urlToId.delete(doc.u);
    this.docLen.delete(docId);
    this.outlinks.delete(docId);
    for (const [term, arr] of this.postings) {
      for (let i = 0; i < arr.length; i += 2) {
        if (arr[i] === docId) { arr.splice(i, 2); i -= 2; }
      }
      if (!arr.length) this.postings.delete(term);
    }
    this._recomputeAvgLen();
    this._prDirty = true;
    this.vocabSorted = null;
  }

  hostCounts() {
    const counts = new Map();
    for (const d of this.docs.values()) counts.set(d.host, (counts.get(d.host) || 0) + 1);
    return counts;
  }

  persist() {
    this.lastSave = Date.now();
    this.stats.lastCrawl = Date.now();
    securestore.save('searchindex', this._serialize());
  }

  // ---- PageRank over the crawl link graph (iterative, damped) ----
  ranks() {
    if (!this._prDirty && this._prCache) return this._prCache;
    const ids = [...this.docs.keys()];
    const N = ids.length;
    const rank = new Map();
    if (!N) { this._prCache = rank; this._prDirty = false; return rank; }
    const D = 0.85;
    for (const id of ids) rank.set(id, 1 / N);
    const out = new Map();
    for (const id of ids) {
      const outs = (this.outlinks.get(id) || []).filter((o) => this.docs.has(o));
      out.set(id, outs);
    }
    for (let iter = 0; iter < 15; iter++) {
      const next = new Map();
      for (const id of ids) next.set(id, (1 - D) / N);
      for (const id of ids) {
        const outs = out.get(id);
        if (!outs || !outs.length) continue;
        const share = (D * rank.get(id)) / outs.length;
        for (const o of outs) next.set(o, next.get(o) + share);
      }
      for (const id of ids) rank.set(id, next.get(id));
    }
    // Normalize to 0..1-ish scale
    let max = 0;
    for (const v of rank.values()) max = Math.max(max, v);
    if (max > 0) for (const [k, v] of rank) rank.set(k, v / max);
    this._prCache = rank;
    this._prDirty = false;
    return rank;
  }

  vocab() {
    if (!this.vocabSorted) {
      this.vocabSorted = [...this.postings.keys()].sort();
      if (this.vocabSorted.length > 200000) this.vocabSorted = this.vocabSorted.slice(0, 200000);
    }
    return this.vocabSorted;
  }

  suggestTerms(prefix, limit = 5) {
    if (!prefix) return [];
    const p = prefix.toLowerCase();
    const out = [];
    for (const term of this.vocab()) {
      if (term.startsWith(p) && term !== p) {
        out.push(term);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  docCount() { return this.docs.size; }
  hostCount() { return this.hostCounts().size; }
  termCount() { return this.postings.size; }

  onDiskBytes() {
    return JSON.stringify(this._serialize()).length;
  }
}

const STOPWORDS = new Set(('a,an,and,are,as,at,be,by,for,from,has,have,he,in,is,it,its,of,on,or,that,the,to,was,were,will,with,this,but,not,you,your,we,our,they,their,i').split(','));

// Simple word tokenizer: lowercase, split on non-word, keep digits/letters.
function tokenize(text) {
  const out = [];
  const re = /[a-z0-9][a-z0-9'’]*/g;
  let m;
  const s = String(text).toLowerCase();
  while ((m = re.exec(s))) {
    let t = m[0].replace(/['’]/g, '');
    if (t.length < 2 || t.length > 32) continue;
    if (STOPWORDS.has(t)) continue;
    out.push(t);
  }
  return out;
}

module.exports = { index: new IndexStore(), tokenize, STOPWORDS };
