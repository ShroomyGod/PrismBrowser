// vpngate.js — VPNGate public server directory.
//
// VPNGate (University of Tsukuba) publishes a public CSV feed at /api/iphone/.
// This module fetches it, caches it on disk, ranks the servers, and hands back
// the OpenVPN profile for a chosen one.
//
// SCOPE: this lists and exports. It does NOT establish a tunnel. VPNGate
// profiles are routed IP-layer tunnels (dev tun / proto udp), not HTTP proxies,
// so Chromium's --proxy-server cannot carry them; connecting needs a native
// OpenVPN binary plus administrator rights to create the TUN adapter, which
// Prism deliberately avoids (requestedExecutionLevel: asInvoker). Exported
// profiles are for use with a real OpenVPN client.
const fs = require('fs');
const path = require('path');
const { net, app, dialog, BrowserWindow } = require('electron');

const FEED = 'https://www.vpngate.net/api/iphone/';
const CACHE_MS = 60 * 60 * 1000; // the list churns constantly; an hour is plenty

function cacheFile() { return path.join(app.getPath('userData'), 'vpngate-servers.json'); }

// The feed is plain CSV. Config is base64 and never contains a comma, and
// Message is a short status string, but Operator is free text ("DESKTOP-X's
// owner") and may contain commas -- so the fixed columns are taken from the
// front and everything left over is rejoined as the operator.
function parseCsv(text) {
  const servers = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('*') || line.startsWith('#')) continue;
    const parts = line.split(',');
    if (parts.length < 15) continue;
    const config = parts.pop();
    const message = parts.pop();
    const operator = parts.splice(12).join(',');
    const num = (i) => { const v = Number(parts[i]); return Number.isFinite(v) ? v : 0; };
    const countryCode = (parts[6] || '').trim().toUpperCase();
    if (!parts[0] || !parts[1] || !/^[A-Z]{2}$/.test(countryCode)) continue;
    servers.push({
      host: parts[0].trim(),
      ip: parts[1].trim(),
      score: num(2),
      ping: num(3),
      speed: num(4),
      country: (parts[5] || '').trim() || countryCode,
      countryCode,
      sessions: num(7),
      uptime: num(8),
      uptimeText: (parts[11] || '').trim(),
      operator: operator.trim(),
      message: message.trim(),
      config: (config || '').trim()
    });
  }
  return servers;
}

// Drop anything the feed lists but nobody is serving, then rank what remains.
// Latency dominates how a tunnel actually feels, so it carries the most
// weight; throughput and VPNGate's own popularity score break ties between
// servers that are otherwise close. Every term is normalised to 0..1 first so
// the units do not matter.
function rank(servers) {
  const alive = servers.filter((s) => s.config && s.ping > 0 && s.ping < 5000 && s.uptime > 0);
  if (!alive.length) return [];
  const maxSpeed = Math.max(...alive.map((s) => s.speed));
  const maxScore = Math.max(...alive.map((s) => s.score));
  const minPing = Math.min(...alive.map((s) => s.ping));
  const span = (v, lo, hi) => (hi > lo ? (v - lo) / (hi - lo) : 1);
  for (const s of alive) {
    s.quality = (1 - span(s.ping, minPing, 5000)) * 0.5 +
                span(s.speed, 0, maxSpeed) * 0.3 +
                span(s.score, 0, maxScore) * 0.2;
  }
  alive.sort((a, b) => b.quality - a.quality);
  return alive;
}

// Strip the base64 blob before sending a list to the renderer. The feed is
// several hundred entries and each profile is ~1KB, which would make every
// IPC hop megabytes of text the page never uses.
function summary(s) {
  return {
    host: s.host, ip: s.ip, country: s.country, countryCode: s.countryCode,
    ping: s.ping, speed: s.speed, score: s.score, sessions: s.sessions,
    uptime: s.uptime, uptimeText: s.uptimeText, operator: s.operator,
    quality: s.quality
  };
}

function countryList(servers) {
  const map = new Map();
  for (const s of servers) {
    const e = map.get(s.countryCode) || { code: s.countryCode, name: s.country, count: 0, best: summary(s) };
    e.count++;
    if (s.quality > (map.get(s.countryCode) || { best: { quality: -1 } }).best.quality) e.best = summary(s);
    map.set(s.countryCode, e);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

let cachedServers = null;

async function load(force) {
  const file = cacheFile();
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(raw.servers) && raw.servers.length) {
      if (!force && Date.now() - raw.at < CACHE_MS) return raw.servers;
      cachedServers = raw.servers; // usable immediately while we refresh
    }
  } catch (_) { /* no cache yet */ }
  if (cachedServers && !force) {
    // Stale: hand back what we have immediately, then refresh behind the
    // caller. Returning here without kicking off a refresh meant the list never
    // updated on its own - only the manual Refresh button ever re-fetched, and
    // VPNGate servers churn constantly.
    load(true).catch(() => {});
    return cachedServers;
  }

  try {
    const res = await net.fetch(FEED, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const servers = parseCsv(await res.text());
    if (!servers.length) throw new Error('feed produced no servers');
    try { fs.writeFileSync(file, JSON.stringify({ at: Date.now(), servers })); } catch (_) {}
    cachedServers = servers;
    return servers;
  } catch (e) {
    // A stale list beats no list at all.
    if (cachedServers && cachedServers.length) return cachedServers;
    throw e;
  }
}

// Everything the page needs in one hop, so it renders in a single await.
async function directory(force) {
  const servers = rank(await load(force));
  return { total: servers.length, countries: countryList(servers), servers: servers.map(summary) };
}

async function saveProfile(host) {
  const servers = await load(false);
  const s = servers.find((x) => x.host === host);
  if (!s) throw new Error('Unknown VPNGate server: ' + host);
  const win = BrowserWindow.getFocusedWindow();
  const opts = {
    title: 'Save OpenVPN profile',
    defaultPath: 'vpngate-' + s.countryCode.toLowerCase() + '.ovpn',
    filters: [{ name: 'OpenVPN profile', extensions: ['ovpn'] }]
  };
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (res.canceled || !res.filePath) return null;
  fs.writeFileSync(res.filePath, Buffer.from(s.config, 'base64').toString('utf8'), 'utf8');
  return res.filePath;
}

module.exports = { directory, saveProfile, parseCsv, rank };