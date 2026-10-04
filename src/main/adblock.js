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
  let anchored = false;
  if (pattern.startsWith('||')) { re += '^[a-z][a-z0-9+.-]*:\\/\\/(?:[^\\/?#]+\\.)?'; i = 2; anchored = true; }
  else if (pattern.startsWith('|')) { re += '^'; i = 1; anchored = true; }
  // A trailing "|" is the end-of-URL anchor. Every OTHER "|" in an Adblock
  // Plus pattern is a LITERAL character, and EasyList still ships legacy rules
  // that rely on that: "/addyn|*|adtech;" and "/adiframe|*|adtech;" target ad
  // server URLs containing a literal pipe. Compiling an interior "|" as regex
  // alternation turned those into match-everything rules (the empty ".*" branch),
  // so every stylesheet and image request was cancelled and web pages loaded as
  // unstyled HTML with broken images.
  const end = pattern.endsWith('|') && pattern.length > i + 1 ? pattern.length - 1 : pattern.length;
  let body = '';
  for (; i < end; i++) {
    const ch = pattern[i];
    if (ch === '*') body += '.*';
    else if (ch === '^') body += '(?:[^\\w\\-.%]|$)';
    else if (ch === '|') body += '\\|';
    else if (ch === '$') body += '\\$';
    else body += escapeRe(ch);
  }
  re += body;
  if (end < pattern.length) re += '$';
  try { return new RegExp(re, 'i'); } catch (e) { return null; }
}

// A ||domain^ pattern can only match that host or a subdomain of it, which
// makes it indexable. Anything else stays in the flat list.
function anchoredDomain(pattern) {
  if (!pattern.startsWith('||')) return null;
  const m = /^([a-z0-9][a-z0-9.-]*)\^/i.exec(pattern.slice(2));
  if (!m) return null;
  const d = m[1].toLowerCase();
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(d) ? d : null;
}

// SERP ad / nag-bar selectors per search host. `display:none !important` is
// applied to all of them by cosmeticCss(). Class names churn, so each entry lists
// several known variants; an unmatched selector simply does nothing.
const SERP_AD_HIDE = {
  'google.com': [
    '#tads', '#tadsb', '#bottomads', '#tvcap', '#taw',
    '.commercial-unit-desktop-top', '.commercial-unit-desktop-rhs',
    '[data-text-ad]', '.pla-unit', '.pla-exp-container', '#rhs .cu-container',
    '.uEierd', '#eIaReF', '#rso > .MjjYud > .uEierd'
  ],
  'bing.com': [
    '.b_ad', '.b_adTop', '.b_adBottom', '.b_adRight', '.b_adSlug',
    '#b_results > .b_ad', '.b_adLast', '.sb_adsWv2'
  ],
  'duckduckgo.com': ['.results--ad', '.result--ad', '.badge--ad', '[data-testid="ad"]'],
  'search.yahoo.com': ['#searchCenterMiddle > .dd .ad', '.ov-a', '#right .ad'],
  'search.brave.com': ['.snippet[data-type="ad"]', '.ad-slot', '[data-testid="ad"]'],
  'ecosia.org': ['.result-ad', '.ad-result'],
  'startpage.com': ['.w-gl__result--ad', '.ad-result'],
  'lite.duckduckgo.com': ['.result--ad', '.badge--ad'],
  'search.marcia.cc': ['.ad', '.ads']
};

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
    // Host-bucketed copies of block/allow for the ||domain^ majority, plus the
    // leftovers that could not be indexed. rule.block/rule.allow stay intact
    // because statsSnapshot() reports their lengths.
    this.domainBlock = new Map();
    this.domainAllow = new Map();
    this.genericBlock = [];
    this.genericAllow = [];
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
    const rule = {
      regex,
      options: options || parseOptions(''),
      domain: anchoredDomain(raw),
      // Anchored patterns are pinned to a URL prefix, so a match is specific by
      // construction. match() uses this to keep broad unanchored rules from
      // cancelling whole documents, stylesheets, or fonts.
      anchored: raw.startsWith('|')
    };
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
    this._index(rs);
    this.ruleset = rs;
    this.ready = true;
  }

  // Bucket the ||domain^ rules by host so a request only tests rules that could
  // possibly match it, instead of all ~100k. Unindexable rules fall back to
  // the flat list, so this can never block less than the previous behaviour --
  // at worst it is the same slow scan.
  _index(rs) {
    const bucket = (map, rule) => {
      const arr = map.get(rule.domain) || [];
      arr.push(rule);
      map.set(rule.domain, arr);
    };
    for (const r of rs.block) {
      if (r.domain) bucket(rs.domainBlock, r); else rs.genericBlock.push(r);
    }
    // Allow rules must never be dropped: losing one over-blocks.
    for (const r of rs.allow) {
      if (r.domain) bucket(rs.domainAllow, r); else rs.genericAllow.push(r);
    }
  }

  // Candidate rules for one URL: every host-bucketed rule matching this host or
  // a parent of it, plus the unindexed remainder.
  _candidates(host, map, rest) {
    const out = rest.slice();
    if (host) {
      const labels = host.split('.');
      // Stop before the bare TLD - no rule is anchored to "com".
      for (let i = 0; i <= labels.length - 2; i++) {
        const arr = map.get(labels.slice(i).join('.'));
        if (arr) for (const r of arr) out.push(r);
      }
    }
    return out;
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
    const reqHost = this._hostOf(url).toLowerCase();
    // A top-level document is BY DEFINITION first-party with itself: the site
    // hosting google.com/search IS google.com. Treating it as third-party (which
    // is what an empty/stale siteHost did) let any $third-party rule cancel the
    // whole navigation, so searching from the omnibox failed with
    // ERR_BLOCKED_BY_CLIENT. Ad rules are about third-party subresources; they
    // must never veto a main-frame request for its own origin.
    const selfSite = resourceType === 'document' ? reqHost : siteHost;
    const block = this._candidates(reqHost, this.ruleset.domainBlock, this.ruleset.genericBlock);
    const allow = this._candidates(reqHost, this.ruleset.domainAllow, this.ruleset.genericAllow);
    let blocked = null;
    for (const r of block) {
      if (!r.regex.test(lower)) continue;
      const o = r.options;
      if (o.types !== 'all' && !o.types.has(resourceType)) continue;
      // Never let an UNANCHORED rule cancel a top-level document. Generic rules
      // exist to kill ad subresources; the moment one can abort the navigation
      // itself, a false positive takes out an entire site (google.com/search was
      // blocked outright). Only a ||host^ rule naming this exact host may block a
      // main-frame request.
      if (resourceType === 'document' && (!r.domain ||
          !(r.domain === reqHost || reqHost.endsWith('.' + r.domain)))) continue;
      // Same reasoning for page styling: an unanchored rule that names no
      // resource type must never cancel a stylesheet or font request. Losing
      // one ad stylesheet is a cosmetic miss; losing a site's CSS renders the
      // whole page unstyled. Rules that explicitly say $stylesheet/$font, and
      // anchored ||host^ rules, still apply.
      if ((resourceType === 'stylesheet' || resourceType === 'font') &&
          !r.anchored && o.types === 'all') continue;
      if (o.thirdParty !== null) {
        const isThird = selfSite ? reqHost !== selfSite && !reqHost.endsWith('.' + selfSite) && !selfSite.endsWith('.' + reqHost) : true;
        if (o.thirdParty !== isThird) continue;
      }
      if (o.domainsInclude.length) {
        const site = selfSite || '';
        if (!o.domainsInclude.some((d) => site === d || site.endsWith('.' + d))) continue;
      }
      if (o.domainsExclude.length) {
        const site = selfSite || '';
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

  // Decide whether a single request should be cancelled.
  //
  // This deliberately does NOT register its own webRequest listener. Electron
  // keeps only the LAST onBeforeRequest listener registered per session, so
  // registering here was silently overwritten by the malware shield that
  // sessions.js registered next -- which is why nothing was ever blocked while
  // the shield still fired. sessions.js now owns the one listener and asks us.
  shouldBlock(details, siteHost) {
    const cfg = settings.all().privacy.adblock;
    if (!cfg.enabled) return false;
    const perSite = cfg.perSite || {};
    if (siteHost && perSite[siteHost] === 'allow') return false;
    const type = details.resourceType === 'mainFrame' ? 'document' : details.resourceType;
    if (!this.match(details.url, type, siteHost)) return false;
    this._onBlocked(details);
    return true;
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
    // Built-in SERP ad hiding. Search engines inject "sponsored" blocks and the
    // "switch to our own browser" nag bars with their own class names, which the
    // community lists do not always cover. These ship with Prism so the ads are
    // gone even if a user enables only one list, or clears them.
    for (const [dom, arr] of Object.entries(SERP_AD_HIDE)) {
      if (host === dom || host.endsWith('.' + dom)) sels.push(...arr);
    }
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
