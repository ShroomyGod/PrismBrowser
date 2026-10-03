// prism-search-web.js — federated web results for Prism Browser Search.
//
// SearXNG is a self-hosted metasearch service, not a client-side Node package.
// Prefer a local instance (settings or PRISM_SEARXNG_URL), then try a small
// fallback list of free public instances. Each instance aggregates engines;
// normalize and deduplicate its results here, without exposing instance or
// provider branding in the Prism Browser Search UI.
'use strict';

const ENGINE_NAME = 'Prism Search';
const LOCAL_DEFAULT = 'http://127.0.0.1:8080';
const PUBLIC_FALLBACKS = [
  // These public instances currently offer JSON search endpoints. They are
  // best-effort shared services and can impose rate limits or change policy.
  'https://etsi.me'
];
const TIMEOUT_MS = 6500;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 80;
const MAX_RESULTS = 20;
const LOCAL_TIMEOUT_MS = 900;
const MAX_CONCURRENT_INSTANCES = 4;

const cache = new Map();
const inflight = new Map();
const instanceCooldowns = new Map();

function normalizeBase(value) {
  try {
    const u = new URL(String(value || '').trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.username = '';
    u.password = '';
    u.search = '';
    u.hash = '';
    return u.toString().replace(/\/+$/, '');
  } catch (_) { return null; }
}

function configuredInstances() {
  const settings = require('./settings').all().search || {};
  const local = normalizeBase(process.env.PRISM_SEARXNG_URL || settings.searxngUrl || LOCAL_DEFAULT);
  const userList = [process.env.PRISM_SEARXNG_FALLBACKS, settings.searxngFallbacks]
    .filter(Boolean).join(',').split(',').map(normalizeBase).filter(Boolean);
  const bases = [local, ...userList, ...PUBLIC_FALLBACKS].filter(Boolean);
  return [...new Set(bases)];
}

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function resultUrl(value) {
  try {
    const u = new URL(String(value || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.toString();
  } catch (_) { return null; }
}

function normalizeResults(payload, sourceBase = '') {
  const sourceHost = normalizeBase(sourceBase);
  const sourceHostname = sourceHost ? new URL(sourceHost).hostname.toLowerCase() : '';
  const items = Array.isArray(payload) ? payload : payload && payload.results;
  if (!Array.isArray(items)) return [];
  const rows = [];
  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const url = resultUrl(item.url || item.link);
    const title = cleanText(item.title);
    if (!url || !title) continue;
    if (sourceHostname && new URL(url).hostname.toLowerCase() === sourceHostname) continue;
    const key = url.replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./i, ''); } catch (_) {}
    rows.push({
      url,
      title,
      host,
      snippet: cleanText(item.content || item.snippet || item.description || title),
      web: true,
      score: Number.isFinite(Number(item.score)) ? Number(item.score) : 0,
      _engines: Array.isArray(item.engines) ? item.engines : []
    });
  }
  return rows;
}

async function queryInstance(base, query) {
  const cooldown = instanceCooldowns.get(base) || 0;
  if (Date.now() < cooldown) return [];
  const endpoint = new URL('/search', base);
  endpoint.searchParams.set('q', query);
  endpoint.searchParams.set('format', 'json');
  endpoint.searchParams.set('safesearch', '1');
  try {
    const response = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'PrismBrowser/1.0 (Prism Browser Search; federated web search)'
      },
      signal: AbortSignal.timeout(/^(localhost|127\.)/.test(new URL(base).hostname) ? LOCAL_TIMEOUT_MS : TIMEOUT_MS)
    });
    if (!response.ok) {
      if (response.status === 403 || response.status === 429 || response.status >= 500) {
        instanceCooldowns.set(base, Date.now() + 60_000);
      }
      return [];
    }
    const contentType = response.headers && response.headers.get
      ? response.headers.get('content-type') || '' : '';
    if (contentType && !/json/i.test(contentType)) {
      instanceCooldowns.set(base, Date.now() + 60_000);
      return [];
    }
    const payload = await response.json();
    const rows = normalizeResults(payload, base);
    if (!rows.length && !(payload && Array.isArray(payload.results))) {
      instanceCooldowns.set(base, Date.now() + 60_000);
    }
    return rows;
  } catch (_) {
    instanceCooldowns.set(base, Date.now() + 60_000);
    return [];
  }
}

async function searchInstances(query) {
  const bases = configuredInstances().filter((base) => Date.now() >= (instanceCooldowns.get(base) || 0));
  // First test the local instance on its own, so a local server avoids
  // disclosing queries to third parties whenever it is running.
  const searchSettings = require('./settings').all().search || {};
  const local = normalizeBase(process.env.PRISM_SEARXNG_URL || searchSettings.searxngUrl || LOCAL_DEFAULT);
  if (local && bases.includes(local)) {
    const rows = await queryInstance(local, query);
    if (rows.length) return rows.slice(0, MAX_RESULTS);
  }

  // No local results: try free public SearXNG instances one at a time. This
  // avoids disclosing every query to multiple unrelated instance operators;
  // each SearXNG server already aggregates its configured search engines.
  const publicBases = bases.filter((base) => base !== local).slice(0, MAX_CONCURRENT_INSTANCES);
  for (const base of publicBases) {
    const rows = await queryInstance(base, query);
    if (rows.length) return rows.slice(0, MAX_RESULTS);
  }
  return [];
}

function mergeBatches(batches) {
  const merged = new Map();
  for (const rows of batches) {
    for (const row of rows || []) {
      const key = row.url.replace(/\/$/, '').toLowerCase();
      const existing = merged.get(key);
      if (!existing) merged.set(key, { ...row, _engines: [...(row._engines || [])] });
      else {
        existing._engines = [...new Set([...existing._engines, ...(row._engines || [])])];
        if (row.snippet.length > existing.snippet.length) existing.snippet = row.snippet;
        existing.score = Math.max(existing.score, row.score);
      }
    }
  }
  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
}

async function searchWeb(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const key = q.toLocaleLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rows.map(publicResult);
  if (inflight.has(key)) return (await inflight.get(key)).map(publicResult);

  const job = searchInstances(q).then((rows) => {
    const publicRows = rows.map(publicResult);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    if (publicRows.length) cache.set(key, { at: Date.now(), rows: publicRows });
    return publicRows;
  }).catch(() => []);
  inflight.set(key, job);
  try { return (await job).map(publicResult); }
  finally { inflight.delete(key); }
}

function publicResult(row) {
  return { url: row.url, title: row.title, host: row.host, snippet: row.snippet, web: true };
}

function stats() {
  return {
    engine: ENGINE_NAME,
    cached: cache.size,
    localConfigured: !!normalizeBase(process.env.PRISM_SEARXNG_URL || (require('./settings').all().search || {}).searxngUrl || LOCAL_DEFAULT),
    availableFallbacks: configuredInstances().filter((base) => Date.now() >= (instanceCooldowns.get(base) || 0)).length
  };
}

module.exports = {
  searchWeb,
  stats,
  normalizeResults,
  _queryInstance: queryInstance,
  _mergeResults: mergeBatches,
  _configuredInstances: configuredInstances,
  _reset() { cache.clear(); inflight.clear(); instanceCooldowns.clear(); }
};