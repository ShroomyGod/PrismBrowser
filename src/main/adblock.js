// adblock.js — network filtering (EasyList / EasyPrivacy subset) plus
// cosmetic element hiding. Rules are fetched, cached on disk, compiled once.
const fs = require('fs');
const path = require('path');
const net = require('electron').net;
const { app } = require('electron');
const settings = require('./settings');

const LISTS = {
  easylist: 'https://easylist.to/easylist/easylist.txt',
  easyprivacy: 'https://easylist.to/easylist/easyprivacy.txt'
};
const COSMETIC_CAP = 4000; // safety cap on injected generic selectors

function escapeRe(s) {
  return s.replace(/[.+?${}()[\]\\]/g, '\\$&');
}

// Convert an EasyList pattern into a RegExp over the full URL.
function patternToRegex(pattern) {
  let re = '';
  let i = 0;
  if (pattern.startsWith('||')) { re += '^[a-z][a-z0-9+.-]*:\\/\\/(?:[^\\/?#]+\\.)?'; i = 2; }
  else if (pattern.startsWith('|')) { re += '^'; i = 1; }
  let body = '';
  for (; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') body += '.*';
    else if (ch === '^') body += '(?:[^\\w\\-.%]|$)';
    else if (ch === '$') body += '\\$';
    else body += escapeRe(ch);
  }
  if (body.endsWith('|')) body = body.slice(0, -1) + '$';
  else if (pattern.startsWith('|') === false && pattern.startsWith('||') === false) {
    // unanchored: match anywhere
  }
  re += body;
  try { return new RegExp(re, 'i'); } catch (e) { return null; }
}

const RESOURCE_TYPES = {
  script: 1, image: 2, stylesheet: 4, xmlhttprequest: 8, subdocument: 16,
  document: 32, other: 64, media: 128, font: 256, websocket: 512, ping: 1024
};
const EASY_TYPES = { script: 'script', img: 'image', image: 'image', stylesheet: 'stylesheet', style: 'stylesheet', xmlhttprequest: 'xmlhttprequest', xhr: 'xmlhttprequest', subdocument: 'subdocument', frame: 'subdocument', document: 'document', media: 'media', font: 'font', websocket: 'websocket', ping: 'ping', other: 'other' };

function parseOptions(optStr) {
  // Returns {types:Set|'all', thirdParty:null|bool, domains:{allow:Map,include:Map}, important, plain}
  const out = { types: 'all', thirdParty: null, domainsInclude: [], domainsExclude: [], important: false };
  if (!optStr) return out;
  for (const raw of optStr.split(',')) {
    const opt = raw.trim().toLowerCase();
    if (!opt) continue;
    if (opt === 'important') { out.important = true; continue; }
    if (opt === 'third-party') { out.thirdParty = true; continue; }
    if (opt === '~third-party' || opt === 'first-party') { out.thirdParty = false; continue; }
    if (opt.startsWith('domain=')) {
      for (const d of opt.slice(7).split('|')) {
        if (!d) continue;
        if (d.startsWith('~')) out.domainsExclude.push(d.slice(1));
        else out.domainsInclude.push(d);
      }
      continue;
    }
    if (EASY_TYPES[opt]) { if (out.types === 'all') out.types = new Set(); out.types.add(EASY_TYPES[opt]); continue; }
    if (opt.startsWith('~') && EASY_TYPES[opt.slice(1)]) continue; // ignored exclusions
    // Unknown option (csp, removeelem, match-case, webrtc, popup, ghide...) -> rule too aggressive to apply
    return null;
  }
  return out;
}

class RuleSet {
  constructor() {
    this.block = [];
    this.allow = [];
    this.cosmeticGeneric = [];
    this.cosmeticDomain = new Map(); // domain -> [selectors]
    this.count = 0;
  }
}

function parseFilterList(text, rs) {
  for (let raw of text.split(/\r?\n/)) {
    raw = raw.trim();
    if (!raw || raw.startsWith('!') || raw.startsWith('[')) continue;

    // Cosmetic rules: [domains]##selector and #@# exceptions
    const hideExc = raw.indexOf('#@#');
    if (hideExc !== -1) continue; // element-hiding exceptions: not applied (fails open)
    const hide = raw.indexOf('##');
    if (hide !== -1) {
      const domPart = raw.slice(0, hide).toLowerCase();
      const selector = raw.slice(hide + 3).trim();
      if (!selector || selector.startsWith('^') || selector.includes('+js')) continue;
      if (selector.length > 300) continue;
      if (!domPart) {
        if (rs.cosmeticGeneric.length < COSMETIC_CAP) rs.cosmeticGeneric.push(selector);
      } else {
        for (let d of domPart.split(',')) {
          d = d.trim().toLowerCase();
          if (!d) continue;
          if (d.startsWith('~')) continue;
          const arr = rs.cosmeticDomain.get(d) || [];
          if (arr.length < 400) arr.push(selector);
          rs.cosmeticDomain.set(d, arr);
        }
      }
      continue;
    }

    // Network rules
    let allow = false;
    if (raw.startsWith('@@')) { allow = true; raw = raw.slice(2); }
    const dollar = raw.lastIndexOf('$');
    let options = null;
    if (dollar !== -1 && dollar < raw.length - 1) {
      const optRaw = raw.slice(dollar + 1);
      if (/^[a-z~|,=\-._]+$/i.test(optRaw)) {
        options = parseOptions(optRaw);
        if (!options) continue;
        raw = raw.slice(0, dollar);
      }
    }
    if (!raw || raw.length < 3) continue;
    if (raw.startsWith('||') === false && raw.startsWith('|') === false && !/[.\/*]/.test(raw)) continue;
    const regex = patternToRegex(raw);
    if (!regex) continue;
    const rule = { regex, options: options || parseOptions('') };
    if (allow) rs.allow.push(rule);
    else rs.block.push(rule);
  }
  rs.count++;
}

class Adblocker {
  constructor() {
    this.ruleset = new RuleSet();
    this.ready = false;
    this.stats = { blockedTotal: 0, blockedToday: 0, day: new Date().toDateString(), dataSavedEstimateKB: 0 };
    this.perTab = new Map(); // tabId -> count
    this.lastUpdate = 0;
  }

  dir() { return path.join(app.getPath('userData'), 'adblock'); }

  async init() {
    fs.mkdirSync(this.dir(), { recursive: true });
    const cached = [];
    for (const name of Object.keys(LISTS)) {
      const f = path.join(this.dir(), name + '.txt');
      if (fs.existsSync(f)) cached.push(fs.readFileSync(f, 'utf8'));
    }
    if (cached.length) {
      this.recompile(cached);
      try { this.lastUpdate = fs.statSync(path.join(this.dir(), 'easylist.txt')).mtimeMs; } catch (_) {}
    } else {
      this.recompile([]);
    }
    this.refresh(true); // background update
  }

  recompile(texts) {
    const rs = new RuleSet();
    for (const t of texts) parseFilterList(t, rs);
    const custom = settings.get('privacy.adblock.customRules') || '';
    parseFilterList(custom, rs);
    this.ruleset = rs;
    this.ready = true;
  }

  async refresh(force = false) {
    const dayMs = 4 * 24 * 3600 * 1000;
    if (!force && Date.now() - this.lastUpdate < dayMs) return { updated: false };
    const cfg = settings.all().privacy.adblock;
    const names = [];
    if (cfg.easylist) names.push('easylist');
    if (cfg.easyprivacy) names.push('easyprivacy');
    let any = false;
    for (const name of names) {
      try {
        const res = await net.fetch(LISTS[name], { signal: AbortSignal.timeout(30000) });
        if (!res.ok) continue;
        const text = await res.text();
        if (text.length > 10000) {
          fs.writeFileSync(path.join(this.dir(), name + '.txt'), text);
          any = true;
        }
      } catch (e) { console.error('[adblock] fetch failed', name, e.message); }
    }
    if (any) {
      const cached = Object.keys(LISTS)
        .map((n) => path.join(this.dir(), n + '.txt'))
        .filter((f) => fs.existsSync(f))
        .map((f) => fs.readFileSync(f, 'utf8'));
      this.recompile(cached);
      this.lastUpdate = Date.now();
    }
    return { updated: any };
  }

  setEnabledLists() { this.refresh(true); }

  // Third-party determination from referrer (site document) host.
  _hostOf(u) { try { return new URL(u).hostname; } catch (_) { return ''; } }

  match(url, resourceType, siteHost) {
    if (!this.ready) return false;
    if (/^prism:\/\//i.test(url) || /^devtools:/i.test(url)) return false;
    const lower = url.toLowerCase();
    const block = this.ruleset.block, allow = this.ruleset.allow;
    let blocked = null;
    for (const r of block) {
      if (!r.regex.test(lower)) continue;
      const o = r.options;
      if (o.types !== 'all' && !o.types.has(resourceType)) continue;
      if (o.thirdParty !== null) {
        const reqHost = this._hostOf(url);
        const isThird = siteHost ? reqHost !== siteHost && !reqHost.endsWith('.' + siteHost) && !siteHost.endsWith('.' + reqHost) : true;
        if (o.thirdParty !== isThird) continue;
      }
      if (o.domainsInclude.length) {
        const site = siteHost || '';
        if (!o.domainsInclude.some((d) => site === d || site.endsWith('.' + d))) continue;
      }
      if (o.domainsExclude.length) {
        const site = siteHost || '';
        if (o.domainsExclude.some((d) => site === d || site.endsWith('.' + d))) continue;
      }
      blocked = r;
      if (o.important) break;
    }
    if (blocked) {
      for (const r of allow) {
        if (!r.regex.test(lower)) continue;
        const o = r.options;
        if (o.types !== 'all' && !o.types.has(resourceType)) continue;
        return false;
      }
      return true;
    }
    return false;
  }

  // Wire a session. Returns handler info for stats.
  attach(session, tabsRegistry) {
    const filter = { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] };
    session.webRequest.onBeforeRequest(filter, (details, callback) => {
      const cfg = settings.all().privacy.adblock;
      if (!cfg.enabled) return callback({});
      const siteHost = tabsRegistry ? tabsRegistry(details.webContents) : '';
      const perSite = cfg.perSite || {};
      if (siteHost && perSite[siteHost] === 'allow') return callback({});
      const type = details.resourceType === 'mainFrame' ? 'document' : details.resourceType;
      if (this.match(details.url, type, siteHost)) {
        this._onBlocked(details);
        return callback({ cancel: true });
      }
      callback({});
    });
  }

  _onBlocked(details) {
    this.stats.blockedTotal++;
    if (this.stats.day !== new Date().toDateString()) {
      this.stats.day = new Date().toDateString();
      this.stats.blockedToday = 0;
    }
    this.stats.blockedToday++;
    const wc = details.webContents;
    if (wc && !wc.isDestroyed() && this.onBlockedForTab) {
      const tabId = wc.id;
      this.perTab.set(tabId, (this.perTab.get(tabId) || 0) + 1);
      this.onBlockedForTab(tabId, this.perTab.get(tabId));
    }
  }

  countFor(tabId) { return this.perTab.get(tabId) || 0; }
  resetTab(tabId) { this.perTab.delete(tabId); }

  // Cosmetic filtering: compile CSS for a URL and inject.
  cosmeticCss(url) {
    if (!this.ready || !settings.all().privacy.adblock.enabled) return '';
    let host = '';
    try { host = new URL(url).hostname.toLowerCase(); } catch (_) { return ''; }
    const perSite = settings.all().privacy.adblock.perSite || {};
    if (perSite[host] === 'allow') return '';
    const sels = [];
    let generic = this.ruleset.cosmeticGeneric;
    if (generic.length > COSMETIC_CAP) generic = generic.slice(0, COSMETIC_CAP);
    for (const s of generic) sels.push(s);
    for (const [dom, arr] of this.ruleset.cosmeticDomain) {
      if (host === dom || host.endsWith('.' + dom)) sels.push(...arr);
    }
    if (!sels.length) return '';
    // Neutralize selectors with positional hacks that could hide the whole page.
    const safe = sels
      .filter((s) => s.length < 250)
      .slice(0, COSMETIC_CAP);
    if (!safe.length) return '';
    return safe.join(',') + '{display:none!important;visibility:hidden!important;}';
  }

  statsSnapshot() {
    return {
      enabled: settings.all().privacy.adblock.enabled,
      rulesBlocked: this.ruleset.block.length,
      rulesAllowed: this.ruleset.allow.length,
      cosmeticGeneric: this.ruleset.cosmeticGeneric.length,
      cosmeticDomain: this.ruleset.cosmeticDomain.size,
      blockedTotal: this.stats.blockedTotal,
      blockedToday: this.stats.blockedToday,
      lastUpdate: this.lastUpdate
    };
  }
}

module.exports = new Adblocker();
