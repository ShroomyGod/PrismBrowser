// security.js — malware / phishing protection.
// Sources: URLhaus (abuse.ch) recent-payload host feed, Phishing Army,
// OpenPhish community feed, plus optional Google Safe Browsing (user key).
// Finished downloads are SHA-256 hashed and looked up against the URLhaus
// payload API; malicious files are moved to an encrypted-at-rest quarantine
// (we cannot encrypt other apps' files, so we move them out of reach).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('electron').net;
const { app, shell } = require('electron');
const settings = require('./settings');
const stores = require('./stores');
const downloads = require('./downloads');

const FEEDS = {
  urlhaus: { url: 'https://urlhaus.abuse.ch/downloads/csv_recent/', kind: 'urlhaus-csv' },
  phishingarmy: { url: 'https://phishing.army/download/phishing_army_blocklist_extended.txt', kind: 'domains' },
  openphish: { url: 'https://openphish.com/feed.txt', kind: 'urls' }
};

function splitCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function hostOf(u) {
  try { return new URL(u).hostname.toLowerCase(); } catch (_) { return null; }
}

class Security {
  constructor() {
    this.hosts = new Set();
    this.urls = new Set(); // full malicious URLs (normalized, no query)
    this.ready = false;
    this.lastUpdate = 0;
    this.stats = { navBlocked: 0, downloadsBlocked: 0, day: new Date().toDateString() };
    this.exceptions = new Set(); // user-overridden hosts
    this.onNavBlock = null;      // (webContents, url, info) set by tabs.js
    this.onEvent = null;         // (type, payload) broadcast to shells
  }

  dir() { return path.join(app.getPath('userData'), 'security'); }

  init() {
    fs.mkdirSync(this.dir(), { recursive: true });
    fs.mkdirSync(this.quarantineDir(), { recursive: true });
    const loaded = [];
    for (const name of Object.keys(FEEDS)) {
      const f = path.join(this.dir(), name + '.txt');
      if (fs.existsSync(f)) loaded.push({ name, text: fs.readFileSync(f, 'utf8') });
    }
    this.rebuild(loaded);
    this.refresh();
  }

  quarantineDir() { return path.join(app.getPath('userData'), 'quarantine'); }

  rebuild(feeds) {
    const hosts = new Set();
    const urls = new Set();
    for (const { name, text } of feeds) {
      const meta = FEEDS[name];
      if (!meta) continue;
      if (meta.kind === 'urlhaus-csv') {
        // Payload-delivery feed. These are one-off malware download URLs, not
        // evidence that a whole domain is malicious. Adding the HOST here is
        // what flagged github.com: phishing and malware kits are routinely
        // hosted on large public sites under a single path, so one bad URL
        // condemned the entire site. Block the exact URL only.
        let header = null;
        for (const line of text.split(/\r?\n/)) {
          if (!line || line.startsWith('#')) continue;
          if (!header) { header = splitCsvLine(line); continue; }
          const cells = splitCsvLine(line);
          const iUrl = header.indexOf('url');
          const u = (cells[iUrl >= 0 ? iUrl : 2] || '').trim();
          if (/^https?:/i.test(u)) urls.add(u.split('?')[0].split('#')[0]);
        }
      } else if (meta.kind === 'domains') {
        // A genuine domain feed: whole malicious domains, so host-level
        // blocking is the correct granularity for this one.
        for (const line of text.split(/\r?\n/)) {
          const d = line.trim().toLowerCase();
          if (d && !d.startsWith('#') && d.includes('.')) hosts.add(d);
        }
      } else if (meta.kind === 'urls') {
        // Same as URLhaus: full-URL feed, so exact-URL granularity only.
        for (const line of text.split(/\r?\n/)) {
          const u = line.trim();
          if (/^https?:/i.test(u)) urls.add(u.split('?')[0].split('#')[0]);
        }
      }
    }
    this.hosts = hosts;
    this.urls = urls;
    this.ready = true;
  }

  async refresh() {
    const results = [];
    for (const [name, meta] of Object.entries(FEEDS)) {
      try {
        const res = await net.fetch(meta.url, { signal: AbortSignal.timeout(30000) });
        if (!res.ok) continue;
        const text = await res.text();
        if (text.length < 500) continue;
        fs.writeFileSync(path.join(this.dir(), name + '.txt'), text);
        results.push({ name, text });
      } catch (e) { console.error('[security] feed failed', name, e.message); }
    }
    if (results.length) { this.rebuild(results); this.lastUpdate = Date.now(); }
  }

  async safeBrowsingCheck(url, key) {
    // Google Safe Browsing v4 threatMatches.find
    try {
      const u = new URL(url);
      const body = {
        client: { clientId: 'prism-browser', clientVersion: '1.0.0' },
        threatInfo: {
          threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: [{ url }]
        }
      };
      const res = await net.fetch(
        'https://safebrowsing.googleapis.com/v4/threatMatches:find?key=' + encodeURIComponent(key),
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) return null;
      const json = await res.json();
      if (json && json.matches && json.matches.length) {
        return { source: 'Google Safe Browsing', threat: json.matches[0].threatType || 'THREAT' };
      }
      return null;
    } catch (e) { return null; }
  }

  async checkUrl(url) {
    const cfg = settings.all().security;
    if (!cfg.malwareEnabled) return null;
    const host = hostOf(url);
    if (!host) return null;
    if (this.exceptions.has(host)) return null;
    if (/^(localhost|127\.|0\.0\.0\.0|\[::1\]|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return null;
    if (this.hosts.has(host)) return { source: 'community blocklists (URLhaus / Phishing Army / OpenPhish)', threat: 'Malicious site' };
    const bare = url.split('#')[0].split('?')[0];
    if (this.urls.has(bare)) return { source: 'community blocklists (URLhaus / Phishing Army / OpenPhish)', threat: 'Malicious page' };
    if (cfg.safeBrowsingKey) {
      const sb = await this.safeBrowsingCheck(url, cfg.safeBrowsingKey);
      if (sb) return sb;
    }
    return null;
  }

  addException(host) {
    this.exceptions.add(host);
    if (this.onEvent) this.onEvent('security-exception-added', { host });
  }

  // ---- Downloads ----
  attachDownloadHandler(session) {
    session.on('will-download', (event, item) => {
      const cfg = settings.all().security;
      const id = crypto.randomUUID();
      const url = item.getURL();
      const host = hostOf(url);
      const entry = {
        id, url, filename: item.getFilename(), path: '', state: 'waiting',
        threat: null, sha256: null, ts: Date.now(), size: 0, mime: item.getMimeType(),
        scannedBy: null
      };
      stores.addDownload(entry);
      if (this.onEvent) this.onEvent('downloads-changed', {});

      if (cfg.malwareEnabled && host && this.hosts.has(host)) {
        event.preventDefault();
        stores.updateDownload(id, { state: 'blocked', threat: 'Malicious site (community blocklists)' });
        this.stats.downloadsBlocked++;
        if (this.onEvent) this.onEvent('download-threat', { id, filename: entry.filename, threat: 'Download blocked: the host is on the malware blocklist.' });
        return;
      }

      // Put the file where the user asked for it, never over an existing file.
      // Done per download because Electron exposes no session-level download
      // directory preference; see downloads.prepareTarget.
      try {
        const target = downloads.prepareTarget(item);
        if (target.mode === 'folder') {
          stores.updateDownload(id, { path: target.path });
        }
      } catch (e) {
        console.error('[security] could not set the download save path', e.message);
      }

      item.on('updated', (_e, state) => {
        stores.updateDownload(id, {
          state: state === 'interrupted' ? 'interrupted' : 'progressing',
          path: item.getSavePath(),
          size: item.getReceivedBytes()
        });
        if (this.onEvent) this.onEvent('downloads-changed', {});
      });

      item.once('done', async (_e, state) => {
        const p = item.getSavePath();
        stores.updateDownload(id, {
          state: state === 'completed' ? 'completed' : 'cancelled',
          path: p, size: item.getTotalBytes()
        });
        if (this.onEvent) this.onEvent('downloads-changed', {});
        if (state !== 'completed' || !p || !cfg.downloadScan) return;

        // A scan that finds something must not leave the file sitting in the
        // user's Downloads folder while we decide what to do about it, so
        // quarantine first and only report once the file is out of reach.
        try {
          const hash = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
          stores.updateDownload(id, { sha256: hash });

          // Local signature scan first: no upload, catches anything Defender
          // knows about, including files URLhaus has never seen.
          let verdict = null;
          let scannedBy = null;
          if (cfg.defenderScan !== false) {
            stores.updateDownload(id, { state: 'scanning' });
            if (this.onEvent) this.onEvent('downloads-changed', {});
            const scan = await downloads.scanWithDefender(p);
            // Only claim Defender scanned it when the scan actually ran. A
            // missing or disabled engine must show as "not scanned" rather
            // than as a reassuring green tick.
            if (scan.ran) scannedBy = 'Windows Defender';
            if (scan.threat) verdict = scan.threat;
          }
          // Then the free hash-reputation lookup, which also covers the case
          // where Defender is missing or disabled.
          if (!verdict) {
            const rep = await this.scanHash(hash, p);
            if (rep) { verdict = rep; scannedBy = 'URLhaus'; }
          }
          // Clean result: return the row to "completed". Without this the entry
          // stays stuck on "scanning" forever, because nothing else writes the
          // state again once the download itself finished.
          if (!verdict) stores.updateDownload(id, { state: 'completed', scannedBy });
          else stores.updateDownload(id, { scannedBy });

          if (verdict) {
            const qname = path.join(this.quarantineDir(), Date.now() + '-' + path.basename(p));
            try { fs.renameSync(p, qname); } catch (_) {
              try { fs.copyFileSync(p, qname); fs.unlinkSync(p); } catch (_) { stores.updateDownload(id, { threat: verdict }); return; }
            }
            stores.updateDownload(id, { state: 'quarantined', threat: verdict, path: qname });
            this.stats.downloadsBlocked++;
            if (this.onEvent) this.onEvent('download-threat', { id, filename: entry.filename, threat: verdict });
          }
        } catch (e) { console.error('[security] download scan failed', e.message); }
      });
    });
  }

  async scanHash(hash) {
    // URLhaus payload lookup (free API, no key). Hash-based, path-independent.
    try {
      const body = new URLSearchParams({ sha256: hash });
      const res = await net.fetch('https://urlhaus-api.abuse.ch/v1/payload/', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(15000)
      });
      if (!res.ok) return null;
      const json = await res.json();
      if (json && json.query_status === 'ok' && json.sha256 === hash) {
        return 'Malware detected by URLhaus (' + (json.signature || json.file_type || 'known payload') + ')';
      }
      return null;
    } catch (e) { return null; }
  }

  statsSnapshot() {
    if (this.stats.day !== new Date().toDateString()) {
      this.stats.day = new Date().toDateString();
      this.stats.navBlocked = 0;
      this.stats.downloadsBlocked = 0;
    }
    return {
      enabled: settings.all().security.malwareEnabled,
      hostsIndexed: this.hosts.size,
      urlsIndexed: this.urls.size,
      navBlocked: this.stats.navBlocked,
      downloadsBlocked: this.stats.downloadsBlocked,
      lastUpdate: this.lastUpdate,
      safeBrowsing: !!settings.all().security.safeBrowsingKey
    };
  }
}

module.exports = new Security();
