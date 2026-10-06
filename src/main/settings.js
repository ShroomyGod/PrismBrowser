// settings.js — defaults, deep-merge updates, change events.
// Persisted through the encrypted securestore.
//
// Two-phase init: the secure vault cannot be opened before app ready (see
// securestore.js), but Chromium's DoH switches must be applied before ready.
// So we first build a minimal in-memory config from a small plaintext sidecar
// (`bootstrap.json`, non-sensitive values only), then reload the real
// encrypted settings once the OS keyring is available.
const { BrowserWindow } = require('electron');
const securestore = require('./securestore');

const DEFAULTS = {
  general: {
    startup: 'newtab',        // 'newtab' | 'restore'
    // '' means the OS Downloads folder. Set to an absolute path to override.
    downloadDir: '',
    // Prompts with a Save dialog per download. Declared for a long time and
    // never implemented; downloads.js now honours it.
    askWhereToSave: false
  },
  search: {
    defaultEngine: 'google',
    bangsEnabled: true,
    contributeHistory: false, // let visited pages feed the Prism Search index
    searxngUrl: '',          // optional local SearXNG URL; blank checks localhost:8080 then a free public fallback
    searxngFallbacks: '',    // optional comma-separated SearXNG endpoints, checked before built-in free fallback
    crawl: {
      autoBuild: true,
      maxHosts: 60,
      perHostCap: 40,
      dailyTopup: 150,
      respectRobots: true
    }
  },
  appearance: {
    // 'theme' is derived from the chosen preset (each one is light or dark) and
    // kept separately because site theming, the window frame and the shell
    // read it directly.
    theme: 'dark',            // 'dark' | 'light' | 'system'
    bookmarksBar: false,
    siteTheme: 'auto',        // 'auto' follows browser appearance only on sites that advertise scheme support; dark/light/off are optional hints
    // Id from PrismTheme.PRESETS. Replaces the old free hue/saturation/gradient
    // generator, which produced mismatched colour combinations.
    themePreset: 'prism-dark',
    animationTheme: 'basic', // basic | smooth | playful | off
    accessibility: {
      textScale: 100, contrast: 'normal', largerTargets: false,
      reducedMotion: 'system', focusIndicators: true
    }
  },
  privacy: {
    adblock: {
      enabled: true,
      easylist: true,
      easyprivacy: true,
      customRules: '',
      perSite: {}             // domain -> 'allow' (disabled on that site)
    },
    httpsFirst: true,
    dnt: true,
    popupBlocking: true      // deny window.open() calls that request an explicit size
  },
  security: {
    malwareEnabled: true,
    downloadScan: true,
    defenderScan: true,       // scan finished downloads with Windows Defender
    safeBrowsingKey: ''
  },
  dns: {
    secureDns: 'automatic',   // 'automatic' | 'custom' | 'off'
    provider: 'cloudflare',   // cloudflare | google | quad9 | custom
    customTemplate: ''
  },
  permissions: {},            // origin -> { geolocation: 'allow'|'deny', ... }
  engines: [],
  extensions: { registry: [] },
  ai: {
    // Local models only. Nothing here is sent to a server; the toggles control
    // whether the worker is allowed to start and which task set is offered.
    enabled: true,
    visionTasks: ['caption', 'detail', 'ocr', 'detect'],
    summaryStyle: 'paragraph'
  },
  advanced: {
    userAgent: '',
    spellcheck: true,
    hardwareAcceleration: true
  }
};

const BUILTIN_ENGINES = [
  { id: 'google',   name: 'Google',        template: 'https://www.google.com/search?q=%s',  builtin: true },
  { id: 'bing',     name: 'Bing',          template: 'https://www.bing.com/search?q=%s',    builtin: true },
  { id: 'ddg',      name: 'DuckDuckGo',    template: 'https://duckduckgo.com/?q=%s',        builtin: true },
  { id: 'yahoo',    name: 'Yahoo',         template: 'https://search.yahoo.com/search?p=%s', builtin: true },
  { id: 'brave',    name: 'Brave Search',  template: 'https://search.brave.com/search?q=%s',builtin: true },
  { id: 'startpage',name: 'Startpage',     template: 'https://www.startpage.com/sp/search?query=%s', builtin: true },
  { id: 'ecosia',   name: 'Ecosia',        template: 'https://www.ecosia.org/search?q=%s',  builtin: true },
  { id: 'qwant',    name: 'Qwant',        template: 'https://www.qwant.com/?q=%s',         builtin: true },
  { id: 'wikipedia',name: 'Wikipedia',     template: 'https://en.wikipedia.org/w/index.php?search=%s', builtin: true }
];

const BANGS = {
  g: 'google', b: 'bing', d: 'ddg', ddg: 'ddg', y: 'yahoo', br: 'brave', sp: 'startpage',
  e: 'ecosia', q: 'qwant', w: 'wikipedia', s: 'ddg', yt: 'youtube', gh: 'github'
};

const SPECIAL_TEMPLATES = {
  youtube: 'https://www.youtube.com/results?search_query=%s',
  github: 'https://github.com/search?q=%s'
};

function merge(base, patch) {
  if (Array.isArray(base) || Array.isArray(patch)) return patch !== undefined ? patch : base;
  if (typeof base === 'object' && base && typeof patch === 'object' && patch) {
    const out = { ...base };
    for (const k of Object.keys(patch)) out[k] = merge(base[k], patch[k]);
    return out;
  }
  return patch !== undefined ? patch : base;
}

class Settings {
  constructor() {
    this.data = null;
  }

  // Phase 1 — pre-ready. Uses the plaintext sidecar for the few values that
  // must be known before `app.whenReady()` (DoH template, GPU preference).
  initBootstrap() {
    const boot = securestore.loadBootstrap() || {};
    this.data = merge(DEFAULTS, {
      dns: boot.dns || undefined,
      advanced: boot.advanced || undefined
    });
    this.data = merge(this.data, {
      search: {
        defaultEngine: this.all().search.defaultEngine,
        searxngUrl: this.all().search.searxngUrl,
        searxngFallbacks: this.all().search.searxngFallbacks
      }
    });
    return this.data;
  }

  // Phase 2 — post-ready. Real encrypted settings.
  init() {
    const stored = securestore.load('settings', {});
    this.data = merge(DEFAULTS, stored);
    if (!Array.isArray(this.data.engines)) this.data.engines = [];
    // Re-seed builtin engines so new builds gain engines added later.
    if (!this.data.search || typeof this.data.search !== 'object') this.data.search = { ...DEFAULTS.search };
    const customs = this.data.engines.filter((e) => !e.builtin);
    this.data.engines = [...BUILTIN_ENGINES, ...customs];
    // One-time migration. Stored settings win over DEFAULTS, so a profile
    // created before 1.0.3 still carries defaultEngine 'ddg' and would keep it
    // forever - the new default in DEFAULTS would look like it never applied.
    // Guarded by a flag so it fires exactly once: without it, deliberately
    // choosing DuckDuckGo later would be silently reverted on every launch.
    if (!this.data.search.defaultEngineMigrated) {
      if (this.data.search.defaultEngine === 'ddg') this.data.search.defaultEngine = 'google';
      this.data.search.defaultEngineMigrated = true;
    }
    if (!this.data.engines.find((e) => e.id === this.all().search.defaultEngine)) {
      this.all().search.defaultEngine = 'google';
    }
    // Drop the retired colour generator. Keeping a stale visualTheme around
    // would let it be re-applied by an older window still open, and it is dead
    // weight now that themes are curated presets.
    if (this.data.appearance && this.data.appearance.visualTheme) {
      delete this.data.appearance.visualTheme;
    }
    if (!this.data.appearance.themePreset) {
      this.data.appearance.themePreset = DEFAULTS.appearance.themePreset;
      // The preset now decides light or dark, so a stored 'system' would be a
      // value nothing reads. Only reset it on the upgrade that drops the old
      // visualTheme, so a deliberate choice is never overwritten later.
      if (this.data.appearance.theme === 'system') this.data.appearance.theme = 'dark';
    }
    securestore.save('settings', this.data);
    this.writeBootstrap();
  }

  // Keep the pre-ready sidecar in sync with the values it carries.
  writeBootstrap() {
    if (!this.data) return;
    securestore.saveBootstrap({
      dns: this.data.dns,
      advanced: { hardwareAcceleration: this.data.advanced.hardwareAcceleration }
    });
  }

  // Never return null: callers (tab snapshots, IPC, the shell) dereference this
  // without guarding, and a failed vault init must not take down every window.
  all() { return this.data || (this.data = merge(DEFAULTS, {})); }

  get(pathStr) {
    let cur = this.data;
    for (const part of pathStr.split('.')) {
      if (cur == null) return undefined;
      cur = cur[part];
    }
    return cur;
  }

  set(patch) {
    this.data = merge(this.data, patch);
    securestore.save('settings', this.data);
    this.writeBootstrap();
    const tabs = require('./tabs');
    const siteThemeChanged = patch && patch.appearance && 'siteTheme' in patch.appearance;
    const searchConfigChanged = patch && patch.search && ('searxngUrl' in patch.search || 'searxngFallbacks' in patch.search);
    if (searchConfigChanged) require('./prism-search-web')._reset();
    for (const win of BrowserWindow.getAllWindows()) {
      // The chrome lives in a child WebContentsView, not in win.webContents.
      let wc = null;
      try { wc = tabs.shellContentsForWindow(win); } catch (_) { /* tabs not loaded yet */ }
      const snapshot = this.all();
      (wc || win.webContents).send('prism:settings-changed', snapshot);
      // Internal pages run in WebContentsViews separate from the BrowserWindow's
      // own webContents. Notify those page renderers too so shared appearance
      // settings apply immediately outside the shell.
      if (tabs.tabs && tabs.windowRecord) {
        for (const tab of tabs.tabs.values()) {
          const record = tabs.windowRecord(tab.winId);
          if (!record || record.win !== win || !tab.url.startsWith('prism://')) continue;
          const page = tab.view && tab.view.webContents;
          if (page && !page.isDestroyed()) page.send('prism:settings-changed', snapshot);
        }
      }
      if (siteThemeChanged || (patch && patch.appearance && 'theme' in patch.appearance)) {
        tabs.reapplyCompatibleSiteThemeToAllTabs();
      }
    }
    return this.data;
  }

  engines() { return this.all().engines; }

  engineById(id) {
    const list = this.all().engines;
    return list.find((e) => e.id === id) || list[0];
  }

  defaultEngine() { return this.engineById(this.all().search.defaultEngine); }

  // Build a search URL for an engine id, expanding %s.
  engineSearchUrl(id, query) {
    const eng = this.engineById(id);
    if (!eng) return null;
    let template = SPECIAL_TEMPLATES[id] || eng.template;
    return template.replace('%s', encodeURIComponent(query));
  }

  // Parse omnibox input: returns { url, engineId?, isSearch } or null.
  resolveOmnibox(input) {
    const text = input.trim();
    if (!text) return null;
    if (this.all().search.bangsEnabled && text.startsWith('!')) {
      const m = text.match(/^!(\S+)\s*([\s\S]*)$/);
      if (m && BANGS[m[1].toLowerCase()]) {
        const engId = BANGS[m[1].toLowerCase()];
        const rest = m[2].trim();
        if (!rest) return { url: 'prism://search', isSearch: false };
        return { url: this.engineSearchUrl(engId, rest), engineId: engId, isSearch: true };
      }
    }
    if (/^prism:\/\//i.test(text) || /^[a-z][a-z0-9+.-]*:/i.test(text)) {
      return { url: text, isSearch: false };
    }
    // Internal browser pages: recognize keywords and navigate directly.
    const INTERNAL_PAGES = ['settings', 'history', 'bookmarks', 'downloads', 'passwords', 'extensions', 'privacy', 'search', 'newtab', 'blocked', 'error'];
    const lower = text.toLowerCase();
    if (INTERNAL_PAGES.includes(lower)) {
      return { url: 'prism://' + lower, isSearch: false };
    }
    // Host-like: contains a dot with no spaces, or localhost with a port.
    const hostLike = /^[^\s]+\.[^\s]{2,}$/.test(text) || /^localhost(:\d+)?(\/\S*)?$/.test(text);
    if (hostLike && !/[\s"]/.test(text)) {
      return { url: 'http://' + text, isSearch: false };
    }
    return { url: this.engineSearchUrl(this.all().search.defaultEngine, text), isSearch: true };
  }

  dnsTemplate() {
    const { secureDns, provider, customTemplate } = this.all().dns;
    if (secureDns === 'off') return null;
    const T = {
      cloudflare: 'https://cloudflare-dns.com/dns-query',
      google: 'https://dns.google/dns-query',
      quad9: 'https://dns.quad9.net/dns-query'
    };
    return provider === 'custom' ? (customTemplate || null) : T[provider] || T.cloudflare;
  }

  secureDnsEnabled() {
    const dns = this.all().dns;
    return dns.secureDns !== 'off' &&
      (dns.provider !== 'custom' || !!dns.customTemplate);
  }
}

module.exports = new Settings();
