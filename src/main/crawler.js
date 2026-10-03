// crawler.js — Prism Search's own web crawler.
//
// Polite, budgeted crawler that feeds index-store: per-host caps, host
// round-robin, robots.txt (User-agent: * and prismbot), crawl-delay,
// timeouts and size caps. Discovers new hosts from outlinks and promotes
// them up to settings.search.crawl.maxHosts.
const net = require('electron').net;
const settings = require('./settings');
const securestore = require('./securestore');
const { index } = require('./index-store');

const UA = 'PrismBot/1.0 (Prism Search; +https://prism.example/bot) Prism-Crawler';
const SEEDS = [
  'https://en.wikipedia.org/wiki/Main_Page',
  'https://en.wikipedia.org/wiki/Wikipedia:Featured_articles',
  'https://www.wikipedia.org',
  'https://developer.mozilla.org/en-US/docs/Web',
  'https://docs.python.org/3/',
  'https://nodejs.org/en/learn',
  'https://www.rust-lang.org/learn',
  'https://www.w3.org/standards/',
  'https://www.eff.org/issues',
  'https://www.mozilla.org/en-US/about/',
  'https://www.gnu.org/philosophy/philosophy.html',
  'https://openstreetmap.org',
  'https://archive.org',
  'https://news.ycombinator.com',
  'https://lwn.net'
];

function stripTags(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?(script|style|noscript|svg|template|iframe|head)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function decodeEntities(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '(c)', reg: '(r)', mdash: '-', ndash: '-', hellip: '...', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', middot: '-', bull: '-' };
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch (_) { return ' '; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch (_) { return ' '; } })
    .replace(/&([a-z]+);/gi, (_, n) => named[n.toLowerCase()] || ' ');
}

function extract(html, baseUrl) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
                    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i);
  const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i);

  const headings = [];
  const hre = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let hm;
  while ((hm = hre.exec(html)) && headings.length < 40) {
    const t = decodeEntities(stripTags(hm[2])).replace(/\s+/g, ' ').trim();
    if (t) headings.push(t);
  }

  const bodyStart = html.search(/<body[\s>]/i);
  let body = bodyStart >= 0 ? html.slice(bodyStart) : html;
  body = body
    .replace(/<(script|style|noscript|svg|template|iframe|form|nav|footer)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const text = decodeEntities(stripTags(body)).replace(/\s+/g, ' ').trim();

  const links = [];
  const lre = /<a\s[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let lm;
  while ((lm = lre.exec(html))) {
    const href = lm[1] || lm[2] || lm[3] || '';
    if (!href || href.startsWith('#') || /^(mailto|javascript|tel):/i.test(href)) continue;
    try {
      const abs = new URL(href, baseUrl);
      if (abs.protocol !== 'http:' && abs.protocol !== 'https:') continue;
      abs.hash = '';
      links.push(abs.href);
    } catch (_) {}
  }

  return {
    title: titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim().slice(0, 300) : '',
    description: decodeEntities((descMatch && descMatch[1]) || (ogDesc && ogDesc[1]) || '').trim(),
    text,
    headings,
    links: [...new Set(links)]
  };
}

// A stripped-down robots.txt parser (good enough for crawl politeness).
function parseRobots(text) {
  const rules = { disallow: [], allow: [], crawlDelay: 0 };
  if (text == null) return rules;
  let appliesToUs = false;
  for (let raw of text.split(/\r?\n/)) {
    raw = raw.replace(/#.*$/, '').trim();
    if (!raw) continue;
    const idx = raw.indexOf(':');
    if (idx === -1) continue;
    const key = raw.slice(0, idx).trim().toLowerCase();
    const val = raw.slice(idx + 1).trim();
    if (key === 'user-agent') {
      appliesToUs = val === '*' || val.toLowerCase().includes('prismbot');
    } else if (appliesToUs) {
      if (key === 'disallow' && val) rules.disallow.push(val);
      else if (key === 'allow' && val) rules.allow.push(val);
      else if (key === 'crawl-delay') {
        const d = parseFloat(val);
        if (!isNaN(d)) rules.crawlDelay = Math.min(d * 1000, 8000);
      }
    }
  }
  return rules;
}

function robotsAllows(rules, pathname) {
  const test = (patterns) => {
    let best = -1;
    for (const p of patterns) {
      const re = new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'));
      if (re.test(pathname)) best = Math.max(best, p.length);
    }
    return best;
  };
  const dis = test(rules.disallow);
  if (dis < 0) return true;
  const allow = test(rules.allow);
  return allow >= dis;
}

class Crawler {
  constructor() {
    this.running = false;
    this.stopRequested = false;
    this.state = { hostCounts: {}, discovered: {}, lastRun: 0, seeded: false };
    this.robotsCache = new Map(); // origin -> {rules, ts}
    this.lastHit = new Map();     // host -> ts (politeness spacing)
    this.progress = { pages: 0, errors: 0, queue: 0, lastUrl: '' };
    this.onProgress = null;
  }

  init() {
    this.state = securestore.load('crawlstate', this.state);
    if (settings.all().search.crawl.autoBuild && index.docCount() < 400 && !this.state.seeded) {
      setTimeout(() => this.run({ reason: 'first-run' }), 4000);
    }
  }

  saveState() { securestore.save('crawlstate', this.state); }

  status() {
    return {
      running: this.running,
      progress: { ...this.progress },
      hostCounts: this.state.hostCounts,
      discovered: this.state.discovered,
      indexDocs: index.docCount(),
      indexHosts: index.hostCount(),
      lastRun: this.state.lastRun
    };
  }

  async run(opts = {}) {
    if (this.running) return { started: false, reason: 'already-running' };
    const cfg = settings.all().search.crawl;
    this.running = true;
    this.stopRequested = false;
    this.progress = { pages: 0, errors: 0, queue: 0, lastUrl: '' };

    // Seed queue
    const queue = [];
    const seen = new Set();
    const push = (url, depth) => {
      try {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
        const key = index.normalizeUrl(u.href);
        if (!key || seen.has(key) || index.urlToId.has(key)) return;
        seen.add(key);
        queue.push({ url: u.href, host: u.hostname.toLowerCase(), depth });
      } catch (_) {}
    };

    for (const s of SEEDS) push(s, 0);

    // Also seed hosts we know from prior runs that still have headroom.
    for (const [host, count] of Object.entries(this.state.hostCounts)) {
      if (count < cfg.perHostCap) {
        // ask index for a known URL of this host to re-crawl from
        const anyDoc = this._anyDocOfHost(host);
        if (anyDoc) push(anyDoc, 0);
      }
    }

    const CONCURRENCY = 6;
    const MAX_PAGES = opts.maxPages || Math.max(200, cfg.perHostCap * cfg.maxHosts / 2);
    const perHost = new Map(Object.entries(this.state.hostCounts).map(([h, c]) => [h, c]));

    const fetchRobots = async (origin) => {
      const hit = this.robotsCache.get(origin);
      if (hit && Date.now() - hit.ts < 86400e3) return hit.rules;
      let rules = { disallow: [], allow: [], crawlDelay: 0 };
      if (cfg.respectRobots) {
        try {
          const res = await net.fetch(origin + '/robots.txt', {
            headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8000)
          });
          if (res.ok) rules = parseRobots(await res.text());
        } catch (_) { /* unreachable robots => default allow, still rate-limited */ }
      }
      this.robotsCache.set(origin, { rules, ts: Date.now() });
      return rules;
    };

    const worker = async () => {
      while (!this.stopRequested && this.progress.pages < MAX_PAGES && queue.length) {
        // host round-robin: pick first entry whose host we can hit now
        let idx = -1, entry = null;
        const now = Date.now();
        for (let i = 0; i < queue.length; i++) {
          const e = queue[i];
          const rules = await fetchRobots(new URL(e.url).origin);
          const delay = Math.max(rules.crawlDelay, 700);
          const last = this.lastHit.get(e.host) || 0;
          if (now - last >= delay) { idx = i; entry = e; break; }
        }
        if (!entry) { await new Promise((r) => setTimeout(r, 800)); continue; }
        queue.splice(idx, 1);
        this.progress.queue = queue.length;

        const origin = new URL(entry.url).origin;
        const rules = await fetchRobots(origin);
        const path = new URL(entry.url).pathname + (new URL(entry.url).search || '');
        if (!robotsAllows(rules, path)) continue;

        this.lastHit.set(entry.host, Date.now());
        try {
          const res = await net.fetch(entry.url, {
            headers: { 'user-agent': UA, 'accept': 'text/html,application/xhtml+xml' },
            signal: AbortSignal.timeout(12000),
            redirect: 'follow'
          });
          if (!res.ok) { this.progress.errors++; continue; }
          const ctype = res.headers.get('content-type') || '';
          if (!/text\/html|application\/xhtml/i.test(ctype)) continue;
          const buf = await res.arrayBuffer();
          if (buf.byteLength > 3 * 1024 * 1024) continue;
          const html = new TextDecoder('utf-8').decode(buf);

          const ex = extract(html, entry.url);
          const bodyText = [...ex.headings, ex.text].join('. ').slice(0, 40000);
          index.addDocument(entry.url, {
            title: ex.title || entry.url,
            description: ex.description || ex.headings.slice(0, 3).join(' - '),
            bodyText,
            links: ex.links,
            crawledAt: Date.now()
          });

          perHost.set(entry.host, (perHost.get(entry.host) || 0) + 1);
          this.state.hostCounts[entry.host] = perHost.get(entry.host);
          this.progress.pages++;
          this.progress.lastUrl = entry.url;

          // enqueue same-host links, discover external hosts
          for (const link of ex.links) {
            try {
              const u = new URL(link);
              const h = u.hostname.toLowerCase();
              if (h === entry.host) {
                if ((perHost.get(h) || 0) < cfg.perHostCap) push(link, entry.depth + 1);
              } else {
                // external: record discovery; promote later if budget allows
                this.state.discovered[h] = (this.state.discovered[h] || 0) + 1;
                const knownHosts = Object.keys(this.state.hostCounts).length;
                const queuedHosts = new Set(queue.map((q) => q.host)).size;
                if (knownHosts + queuedHosts < cfg.maxHosts &&
                    (perHost.get(h) || 0) < cfg.perHostCap) {
                  push(link, entry.depth + 1);
                }
              }
            } catch (_) {}
          }
          if (this.progress.pages % 5 === 0) {
            this._emit();
            this.saveState();
          }
        } catch (e) {
          this.progress.errors++;
        }
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    this.running = false;
    this.state.lastRun = Date.now();
    this.state.seeded = true;
    this.saveState();
    index.persist();
    this._emit();
    return { started: true, pages: this.progress.pages, errors: this.progress.errors };
  }

  _anyDocOfHost(host) {
    for (const d of index.docs.values()) {
      if (d.host === host) return d.u;
    }
    return null;
  }

  stop() {
    this.stopRequested = true;
  }

  ingestVisitedPage(url, html) {
    // Optional "contribute browsing to the index" feature.
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
      const ex = extract(html, url);
      if (!ex.text || ex.text.length < 350) return;
      index.addDocument(url, {
        title: ex.title || url,
        description: ex.description,
        bodyText: [...ex.headings, ex.text].join('. '),
        links: ex.links,
        crawledAt: Date.now()
      });
    } catch (_) {}
  }

  _emit() {
    if (this.onProgress) this.onProgress(this.status());
  }
}

module.exports = new Crawler();
