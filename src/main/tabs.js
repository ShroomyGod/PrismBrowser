// tabs.js — windows and tabs. Each tab is a WebContentsView hosted under
// the shell chrome (tabs strip + toolbar + bookmarks bar).
//
// LAYOUT: the chrome and the page live in SEPARATE native views. The shell
// is its own WebContentsView stacked LAST (topmost) in the window, so its
// dropdowns/menus/findbar paint above the page instead of behind it. The
// shell view's bounds cover exactly the chrome plus any open overlay
// (reported by the renderer via setShellExtent()); the page views start at
// rec.chromeHeight and fill the rest. The main process cannot read the
// stylesheet, so the shell renderer measures its chrome and reports it via
// setChromeHeight(); rec.chromeHeight is authoritative and
// DEFAULT_CHROME_HEIGHT is only a pre-measurement fallback.
const path = require('path');
const crypto = require('crypto');
const { app, BrowserWindow, WebContentsView, ipcMain, shell } = require('electron');
const settings = require('./settings');
const stores = require('./stores');
const adblock = require('./adblock');
const security = require('./security');
const crawler = require('./crawler');
const securestore = require('./securestore');

const DEFAULT_CHROME_HEIGHT = 84; // fallback until the shell reports its real height
const PAGE_PRELOAD = path.join(__dirname, '..', 'preload', 'page.js');
const SHELL_PRELOAD = path.join(__dirname, '..', 'preload', 'shell.js');

function classifyUrl(url) {
  if (!url) return 'none';
  if (url.startsWith('prism://')) return 'prism';
  if (url.startsWith('https://')) return 'secure';
  if (url.startsWith('http://')) return 'insecure';
  if (url.startsWith('file://')) return 'file';
  return 'none';
}

class TabsManager {
  constructor() {
    this.windows = new Map();  // wid -> {win, tabs:[tabId], active, private, closed:[]}
    this.tabs = new Map();     // tabId -> tab
    this.sessions = null;
    this.findState = new Map(); // wid -> {text}
    this._quitting = false;
  }

  setSessions(sessions) { this.sessions = sessions; }

  init() {
    adblock.onBlockedForTab = (wcId, count) => {
      const tab = this._tabByWebContentsId(wcId);
      if (tab) this._sendToShell(tab.winId, 'prism:adblock', { tabId: tab.id, count });
    };
    security.onNavBlock = (wc, url, verdict) => {
      const tab = this._tabByWebContentsId(wc.id);
      if (!tab || tab.view.webContents.isDestroyed()) return;
      const blocked = 'prism://blocked?u=' + encodeURIComponent(url) +
        '&src=' + encodeURIComponent(verdict.source || '') +
        '&threat=' + encodeURIComponent(verdict.threat || '');
      try { tab.view.webContents.loadURL(blocked); } catch (_) {}
    };
    app.on('before-quit', () => { this._quitting = true; this.saveSession(); });
  }

  _tabByWebContentsId(wcId) {
    for (const tab of this.tabs.values()) {
      if (tab.view && !tab.view.webContents.isDestroyed() && tab.view.webContents.id === wcId) return tab;
    }
    return null;
  }

  siteHostForWebContents(wc) {
    const tab = this._tabByWebContentsId(wc);
    if (!tab) return '';
    try { return new URL(tab.url).hostname.toLowerCase(); } catch (_) { return ''; }
  }

  // ---------- Windows ----------
  createWindow(opts = {}) {
    const priv = !!opts.private;
    const win = new BrowserWindow({
      width: opts.width || 1280,
      height: opts.height || 860,
      minWidth: 940,
      minHeight: 600,
      frame: false,
      show: false,
      backgroundColor: '#0c0c0c', // rgb(12,12,12) generic dark
      icon: path.join(__dirname, '..', '..', 'assets', 'prism.ico'),
      title: 'Prism',
      webPreferences: {
        preload: SHELL_PRELOAD,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    });
    const wid = crypto.randomUUID();
    const record = {
      win, tabs: [], active: null, private: priv, closed: [], wid,
      htmlFullscreen: false,
      chromeHeight: DEFAULT_CHROME_HEIGHT, // updated by setChromeHeight()
      shellView: null,   // topmost WebContentsView holding the browser chrome
      shellExtent: 0     // bottom edge the shell needs (chrome + open overlays)
    };
    this.windows.set(wid, record);

    // The shell gets its OWN view, stacked above every page view, so its
    // popups (omnibox suggestions, menus, findbar) are never covered by the
    // page. Its background is transparent below the chrome so the page shows
    // through around open popups.
    const shellView = new WebContentsView({
      webPreferences: {
        preload: SHELL_PRELOAD,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    });
    shellView.setBackgroundColor('#00000000');
    record.shellView = shellView;
    win.contentView.addChildView(shellView);
    shellView.setBounds({ x: 0, y: 0, width: win.getContentSize()[0], height: DEFAULT_CHROME_HEIGHT });
    shellView.webContents.loadFile(path.join(__dirname, '..', 'shell', 'index.html'), { query: { wid } });
    shellView.webContents.on('did-finish-load', () => {
      this._sendFullState(wid);
      if (!win.isDestroyed()) win.show();
    });
    win.on('resize', () => this._layoutWindow(wid));
    win.on('maximize', () => this._layoutWindow(wid));
    win.on('unmaximize', () => this._layoutWindow(wid));
    win.on('enter-full-screen', () => this._layoutWindow(wid));
    win.on('leave-full-screen', () => this._layoutWindow(wid));
    win.on('closed', () => {
      const rec = this.windows.get(wid);
      if (rec) { for (const t of rec.tabs) this.tabs.delete(t); this.windows.delete(wid); }
    });
    shellView.webContents.on('render-process-gone', (_e, details) => {
      if (this._quitting) return;
      console.error('[shell] renderer gone', details.reason);
      // Recreate the shell so the browser stays usable.
      if (!win.isDestroyed() && !shellView.webContents.isDestroyed()) {
        shellView.webContents.loadFile(path.join(__dirname, '..', 'shell', 'index.html'), { query: { wid } });
      }
    });

    const urls = opts.urls && opts.urls.length ? opts.urls : ['prism://newtab'];
    for (const u of urls) this.createTab(wid, u, { activate: false });
    const first = record.tabs[0];
    if (first) this.activateTab(wid, first);
    return wid;
  }

  windowRecord(wid) { return this.windows.get(wid); }
  focusedWindowId() {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;
    for (const [wid, rec] of this.windows) if (rec.win === win) return wid;
    return null;
  }
  activeTab(wid) {
    const rec = this.windows.get(wid || this.focusedWindowId());
    return rec ? this.tabs.get(rec.active) : null;
  }

  // ---------- Tabs ----------
  createTab(wid, url, opts = {}) {
    const rec = this.windows.get(wid);
    if (!rec) return null;
    const priv = rec.private;
    const ses = priv ? this.sessions.privSession : this.sessions.mainSession;
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        preload: PAGE_PRELOAD,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        scrollBounce: true
      }
    });
    view.setBackgroundColor('#0c0c0c');
    const tab = {
      id: crypto.randomUUID(),
      winId: wid,
      view,
      url: 'prism://newtab',
      title: 'New Tab',
      favicon: null,
      loading: false,
      muted: false,
      private: priv,
      adCount: 0
    };
    this.tabs.set(tab.id, tab);
    rec.tabs.push(tab.id);
    this._wireTab(tab);
    rec.win.contentView.addChildView(view);
    this._raiseShell(rec); // page views must never cover the chrome
    if (opts.activate !== false && !opts.background) this.activateTab(wid, tab.id);
    const target = url || 'prism://newtab';
    view.webContents.loadURL(target).catch(() => {});
    this._broadcast(rec);
    return tab.id;
  }

  _wireTab(tab) {
    const wc = tab.view.webContents;

    // Clicking the page closes shell overlays (dropdown/menus) that were
    // floating above it — same as clicking away in any browser.
    wc.on('focus', () => { this._sendToShell(tab.winId, 'prism:page-focused'); });

    // Chrome-style right-click menu. showPageContextMenu() has existed in
    // menus.js all along, but nothing ever bound it to this event, so
    // right-click did nothing on pages and images could not be saved.
    // preventDefault() matters: with a listener attached Chromium stays silent
    // until we build a template, so it is required for OUR menu to appear.
    wc.on('context-menu', (e, params) => {
      e.preventDefault();
      require('./menus').showPageContextMenu(wc, params, this);
    });

    wc.on('did-start-loading', () => { tab.loading = true; this._broadcast(this.windows.get(tab.winId)); });
    wc.on('did-stop-loading', () => { tab.loading = false; this._broadcast(this.windows.get(tab.winId)); this._sendOmnibox(tab); });
    wc.on('did-navigate', (_e, url) => {
      tab.url = url; tab.favicon = null; adblock.resetTab(wc.id);
      if (!tab.private) stores.addVisit(url, tab.title);
      this._broadcast(this.windows.get(tab.winId));
      this._sendOmnibox(tab);
      this._maybeIngest(tab);
    });
    wc.on('dom-ready', () => this._applyCompatibleSiteTheme(tab));
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (!isMainFrame) return;
      tab.url = url;
      if (!tab.private) stores.addVisit(url, tab.title);
      this._broadcast(this.windows.get(tab.winId));
      this._sendOmnibox(tab);
      this._applyCompatibleSiteTheme(tab);
    });
    wc.on('page-title-updated', (_e, title) => {
      tab.title = title;
      if (!tab.private) stores.updateTitle(tab.url, title, tab.favicon);
      this._broadcast(this.windows.get(tab.winId));
    });
    wc.on('page-favicon-updated', (_e, icons) => {
      tab.favicon = (icons && icons[icons.length - 1]) || null;
      if (!tab.private) stores.updateTitle(tab.url, tab.title, tab.favicon);
      this._broadcast(this.windows.get(tab.winId));
    });
    wc.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
      if (!isMainFrame || code === -3 /* ABORTED */) return;
      const target = String(url);
      const isInternal = target.startsWith('prism://');
      const httpOriginal = this._httpsFirstTry.get(wc.id);
      this._httpsFirstTry.delete(wc.id);
      // Internal pages used to be excluded here, so a failed prism:// load
      // produced a blank tab with no error anywhere - not in the page, not in
      // the console. Surface them the same way as web pages. prism://error is
      // itself exempt, otherwise a failing error page would reload itself
      // forever.
      if (isInternal && target.startsWith('prism://error')) return;
      const params = new URLSearchParams({
        code: String(code),
        desc: desc || (isInternal ? 'Internal page failed to load' : ''),
        url,
        http: !isInternal && httpOriginal ? '1' : ''
      });
      try { wc.loadURL('prism://error?' + params.toString()); } catch (_) {}
    });
    wc.on('render-process-gone', (_e, details) => {
      if (this._quitting) return;
      try { wc.loadURL('prism://error?code=crash&desc=' + encodeURIComponent(details.reason)); } catch (_) {}
    });
    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (/^https?:/i.test(url)) {
        // external protocols open in OS; http(s) open as tabs
        try {
          const u = new URL(url);
          if (u.protocol === 'http:' || u.protocol === 'https:') {
            this.createTab(tab.winId, url, { background: disposition === 'background' });
            return { action: 'deny' };
          }
        } catch (_) {}
      }
      if (/^(mailto|tel|magnet):/i.test(url)) { try { shell.openExternal(url); } catch (_) {} return { action: 'deny' }; }
      if (/^(blob|data):/i.test(url)) return { action: 'deny' };
      this.createTab(tab.winId, url);
      return { action: 'deny' };
    });
    wc.on('media-started-playing', () => { tab.audio = true; this._broadcast(this.windows.get(tab.winId)); });
    wc.on('media-paused', () => { tab.audio = false; this._broadcast(this.windows.get(tab.winId)); });
    wc.on('enter-html-full-screen', () => {
      const rec = this.windows.get(tab.winId);
      if (!rec || rec.win.isDestroyed()) return;
      rec.htmlFullscreen = true;
      this._sendToShell(tab.winId, 'prism:html-fullscreen', true);
      this._layoutWindow(tab.winId);
    });
    wc.on('leave-html-full-screen', () => {
      const rec = this.windows.get(tab.winId);
      if (!rec || rec.win.isDestroyed()) return;
      rec.htmlFullscreen = false;
      this._sendToShell(tab.winId, 'prism:html-fullscreen', false);
      this._layoutWindow(tab.winId);
    });
    wc.on('update-target-url', (_e, url) => {
      this._sendToShell(tab.winId, 'prism:target-url', { tabId: tab.id, url: url || '' });
    });
    wc.on('found-in-page', (_e, result) => {
      this._sendToShell(tab.winId, 'prism:find-result', {
        tabId: tab.id,
        active: result.activeMatchOrdinal,
        total: result.matches
      });
    });
  }

  _maybeIngest(tab) {
    if (!settings.all().search.contributeHistory) return;
    if (tab.private) return;
    if (!/^https?:/i.test(tab.url)) return;
    const wc = tab.view.webContents;
    if (wc.isDestroyed()) return;
    setTimeout(() => {
      if (wc.isDestroyed() || tab.url !== tab.view.webContents.getURL()) return;
      wc.executeJavaScript('document.documentElement ? document.documentElement.outerHTML.slice(0, 2000000) : ""', true)
        .then((html) => { if (html) crawler.ingestVisitedPage(tab.url, html); })
        .catch(() => {});
    }, 4000);
  }

  // HTTPS-First: remember original http URL when we upgrade, so the error
  // page can offer a plain-HTTP retry.
  get _httpsFirstTry() {
    if (!this.__hf) this.__hf = new Map();
    return this.__hf;
  }

  recordHttpsFirstUpgrade(webContentsId, httpUrl) {
    this._httpsFirstTry.set(webContentsId, httpUrl);
  }

  closeTab(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    const rec = this.windows.get(tab.winId);
    if (!rec) return;
    rec.closed.push({ url: tab.url, title: tab.title });
    if (rec.closed.length > 20) rec.closed.shift();
    const idx = rec.tabs.indexOf(tabId);
    rec.tabs = rec.tabs.filter((t) => t !== tabId);
    this.tabs.delete(tabId);
    if (tab.view && !tab.view.webContents.isDestroyed()) {
      try { tab.view.webContents.close(); } catch (_) {}
      rec.win.contentView.removeChildView(tab.view);
    }
    if (!rec.tabs.length) {
      rec.win.close();
      return;
    }
    if (rec.active === tabId) {
      const next = rec.tabs[Math.min(idx, rec.tabs.length - 1)];
      this.activateTab(tab.winId, next);
    } else {
      this._broadcast(rec);
    }
  }

  reopenClosedTab(wid) {
    const rec = this.windows.get(wid);
    if (!rec || !rec.closed.length) return;
    const last = rec.closed.pop();
    this.createTab(wid, last.url);
  }

  activateTab(wid, tabId) {
    const rec = this.windows.get(wid);
    const tab = this.tabs.get(tabId);
    if (!rec || !tab || tab.winId !== wid) return;
    for (const t of rec.tabs) {
      const other = this.tabs.get(t);
      if (other && other !== tab && !other.view.webContents.isDestroyed()) {
        rec.win.contentView.removeChildView(other.view);
      }
    }
    rec.active = tabId;
    rec.win.contentView.addChildView(tab.view);
    this._raiseShell(rec); // re-adding the page lifted it above the shell
    this._layoutWindow(wid);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.focus();
    this._broadcast(rec);
    this._sendOmnibox(tab);
  }

  moveTab(wid, from, to) {
    const rec = this.windows.get(wid);
    if (!rec) return;
    const arr = rec.tabs;
    if (from < 0 || from >= arr.length) return;
    const [id] = arr.splice(from, 1);
    arr.splice(Math.max(0, Math.min(to, arr.length)), 0, id);
    this._broadcast(rec);
  }

  navigateTab(tabId, input) {
    const tab = this.tabs.get(tabId);
    if (!tab) return null;
    const resolved = settings.resolveOmnibox(input);
    if (!resolved || !resolved.url) return null;
    // HTTPS-First bookkeeping
    if (settings.all().privacy.httpsFirst && resolved.url.startsWith('http://')) {
      try {
        const u = new URL(resolved.url);
        const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\]|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname) || u.hostname.endsWith('.local');
        if (!local) {
          this.recordHttpsFirstUpgrade(tab.view.webContents.id, resolved.url);
          resolved.url = 'https://' + resolved.url.slice(7);
        }
      } catch (_) {}
    }
    tab.view.webContents.loadURL(resolved.url).catch(() => {});
    return resolved;
  }

  activeWebContents(wid) {
    const tab = this.activeTab(wid);
    return tab && !tab.view.webContents.isDestroyed() ? tab.view.webContents : null;
  }

  // ---------- Commands from shell / menu ----------
  goBack(wid) { const wc = this.activeWebContents(wid); if (wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); }
  goForward(wid) { const wc = this.activeWebContents(wid); if (wc && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); }
  reload(wid, hard) {
    const wc = this.activeWebContents(wid);
    if (!wc) return;
    if (hard) wc.reloadIgnoringCache(); else wc.reload();
  }
  stop(wid) { const wc = this.activeWebContents(wid); if (wc) wc.stop(); }
  setZoom(wid, delta) {
    const wc = this.activeWebContents(wid);
    if (!wc) return;
    if (delta === 0) { wc.setZoomLevel(0); return; }
    const cur = wc.getZoomLevel();
    const next = Math.max(-4, Math.min(4, cur + delta));
    wc.setZoomLevel(next);
  }
  toggleMute(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    tab.muted = !tab.muted;
    tab.view.webContents.setAudioMuted(tab.muted);
    this._broadcast(this.windows.get(tab.winId));
  }
  toggleDevTools(wid) {
    const wc = this.activeWebContents(wid);
    if (!wc) return;
    if (wc.isDevToolsOpened()) wc.closeDevTools();
    else wc.openDevTools({ mode: 'detach' });
  }
  findInPage(wid, text, opts = {}) {
    const wc = this.activeWebContents(wid);
    if (!wc) return;
    if (!text) { wc.stopFindInPage('clearSelection'); return; }
    wc.findInPage(text, opts);
  }
  stopFind(wid) {
    const wc = this.activeWebContents(wid);
    if (wc) wc.stopFindInPage('clearSelection');
  }
  retryHttp(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    const httpUrl = this._httpsFirstTry.get(tab.view.webContents.id);
    if (httpUrl) tab.view.webContents.loadURL(httpUrl).catch(() => {});
  }
  duplicateTab(wid, tabId) {
    const tab = this.tabs.get(tabId);
    if (tab) this.createTab(wid, tab.url);
  }

  // Apply only a compatible color-scheme hint. Browser appearance never
  // rewrites site backgrounds, text, images, or layout. In auto mode, match
  // the browser theme only when the page explicitly advertises support for it.
  _applyCompatibleSiteTheme(tab) {
    if (!tab || tab.view.webContents.isDestroyed()) return;
    const url = tab.url || tab.view.webContents.getURL();
    if (!/^https?:/i.test(url || '')) return;

    const appearance = settings.all().appearance || {};
    let theme = appearance.siteTheme || 'auto';
    if (theme === 'off') theme = '';
    else if (theme === 'auto') {
      theme = appearance.theme || 'system';
      if (theme === 'system') theme = require('electron').nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    }
    if (theme !== 'dark' && theme !== 'light') theme = '';

    const wc = tab.view.webContents;
    const script = `(() => {
      const root = document.documentElement;
      if (!root) return false;
      const id = 'prism-compatible-color-scheme';
      const previous = document.getElementById(id);
      if (previous) previous.remove();
      // Clean up markers/styles left by older builds. The shroom-* ids are the
      // pre-rebrand names; removing them too means an upgraded session can
      // never end up with two competing color-scheme <style> tags.
      for (const legacyId of ['prism-theme-style', 'shroom-compatible-color-scheme', 'shroom-theme-style']) {
        const legacy = document.getElementById(legacyId);
        if (legacy) legacy.remove();
      }
      const requested = ${JSON.stringify(theme)};
      if (!requested) return false;
      const meta = document.querySelector('meta[name="color-scheme" i]');
      const metaSchemes = meta ? meta.content.toLowerCase().match(/\\b(light|dark)\\b/g) || [] : [];
      const declared = getComputedStyle(root).colorScheme.toLowerCase().match(/\\b(light|dark)\\b/g) || [];
      if (!metaSchemes.includes(requested) && !declared.includes(requested)) return false;
      const style = document.createElement('style');
      style.id = id;
      style.textContent = ':root { color-scheme: ' + requested + '; }';
      root.appendChild(style);
      return true;
    })()`;
    wc.executeJavaScript(script).catch(() => {});
  }

  snapshotFor(wid) {
    const rec = this.windows.get(wid);
    if (!rec) return { tabs: [], active: null };
    const activeTab = this.tabs.get(rec.active);
    return {
      wid,
      private: rec.private,
      bookmarksBar: settings.all().appearance.bookmarksBar,
      bookmarks: stores.barBookmarks(),
      active: activeTab ? this._tabSnapshot(activeTab) : null,
      tabs: rec.tabs.map((t) => this._tabSnapshot(this.tabs.get(t))).filter(Boolean)
    };
  }

  _tabSnapshot(tab) {
    if (!tab || tab.view.webContents.isDestroyed()) return null;
    let canBack = false, canForward = false;
    try {
      canBack = tab.view.webContents.navigationHistory.canGoBack();
      canForward = tab.view.webContents.navigationHistory.canGoForward();
    } catch (_) {}
    return {
      id: tab.id, url: tab.url, title: tab.title, favicon: tab.favicon,
      loading: tab.loading, muted: tab.muted, audio: !!tab.audio,
      adCount: adblock.countFor(tab.view.webContents.id),
      private: tab.private,
      security: classifyUrl(tab.url),
      canBack, canForward
    };
  }

  _sendToShell(wid, channel, payload) {
    const wc = this._shellWc(this.windows.get(wid));
    if (wc) wc.send(channel, payload);
  }

  // The shell's WebContentsView webContents, or null.
  _shellWc(rec) {
    const sv = rec && rec.shellView;
    return sv && !sv.webContents.isDestroyed() ? sv.webContents : null;
  }

  // Public helpers for modules that must reach the SHELL (settings changes,
  // menus, updates, extensions) rather than the window's own webContents,
  // which sits below the page views and never hosts the chrome.
  shellContents(wid) { return this._shellWc(this.windows.get(wid)); }

  shellContentsForWindow(win) {
    for (const rec of this.windows.values()) if (rec.win === win) return this._shellWc(rec);
    return null;
  }

  shellWindowFor(wc) {
    if (!wc) return null;
    for (const rec of this.windows.values()) {
      if (rec.win.webContents === wc) return rec.win;
      if (rec.shellView && rec.shellView.webContents === wc) return rec.win;
    }
    return null;
  }

  // Keep the shell on top: page views are added above it when tabs are
  // created/activated, so lift the shell back after each.
  _raiseShell(rec) {
    const sv = rec && rec.shellView;
    if (!sv || sv.webContents.isDestroyed()) return;
    const cv = rec.win.contentView;
    const kids = cv.children;
    if (kids.length && kids[kids.length - 1] === sv) return;
    if (kids.includes(sv)) cv.removeChildView(sv);
    cv.addChildView(sv);
  }

  _sendFullState(wid) {
    const rec = this.windows.get(wid);
    if (!rec) return;
    this._broadcast(rec);
    const tab = this.tabs.get(rec.active);
    if (tab) this._sendOmnibox(tab);
  }

  _broadcast(rec) {
    const wc = this._shellWc(rec);
    if (wc) wc.send('prism:tabs', this.snapshotFor(rec.wid));
  }

  _sendOmnibox(tab) {
    const rec = this.windows.get(tab.winId);
    const wc = this._shellWc(rec);
    if (!wc) return;
    wc.send('prism:omnibox', {
      tabId: tab.id,
      url: tab.url,
      title: tab.title,
      security: classifyUrl(tab.url),
      loading: tab.loading,
      canBack: tab.view.webContents.navigationHistory.canGoBack(),
      canForward: tab.view.webContents.navigationHistory.canGoForward(),
      zoom: tab.view.webContents.getZoomLevel()
    });
  }

  // Called by the shell renderer with the measured height of its chrome.
  // Re-laying out here is what keeps the page from overlapping the toolbar.
  setChromeHeight(wid, h) {
    const rec = this.windows.get(wid);
    if (!rec || rec.win.isDestroyed()) return;
    const v = Math.max(0, Math.round(Number(h) || 0));
    if (!v || v === rec.chromeHeight) return;
    rec.chromeHeight = v;
    this._layoutWindow(wid);
  }

  // The shell reports how far down its OPEN overlays reach (omnibox dropdown,
  // menu panel, shield popup, findbar, toasts). Its view is stacked above the
  // page, so these bounds must grow to cover them or they get clipped.
  setShellExtent(wid, h) {
    const rec = this.windows.get(wid);
    if (!rec || rec.win.isDestroyed()) return;
    const v = Math.max(0, Math.round(Number(h) || 0));
    if (v === rec.shellExtent) return;
    rec.shellExtent = v;
    this._layoutWindow(wid);
  }

  _layoutWindow(wid) {
    const rec = this.windows.get(wid);
    if (!rec || rec.win.isDestroyed()) return;
    // The shell must stay topmost: any addChildView (page activation, resize
    // on some platforms) can lift a page above it, which reads as "the page
    // overlaps the dropdown / shield / menu". Re-assert order on every layout.
    this._raiseShell(rec);
    const [w, h] = rec.win.getContentSize();
    const fs = rec.htmlFullscreen;
    const top = fs ? 0 : (rec.chromeHeight || DEFAULT_CHROME_HEIGHT);
    for (const t of rec.tabs) {
      const tab = this.tabs.get(t);
      if (tab && !tab.view.webContents.isDestroyed()) {
        tab.view.setBounds({ x: 0, y: top, width: w, height: Math.max(0, h - top) });
      }
    }
    // The shell view floats above the page: exactly the chrome tall, grown to
    // cover open overlays, and collapsed to nothing in HTML fullscreen so the
    // video owns the whole window.
    const sv = rec.shellView;
    if (sv && !sv.webContents.isDestroyed()) {
      const sh = fs ? 0 : Math.min(h, Math.max(top, rec.shellExtent || 0));
      sv.setBounds({ x: 0, y: 0, width: w, height: sh });
    }
    // Bounds changes must not reorder views behind our back — keep the shell
    // above the page after resizing too.
    this._raiseShell(rec);
    const wc = this._shellWc(rec);
    if (wc) wc.send('prism:chrome-mode', fs ? 'fullscreen' : 'normal');
  }

    // Wid linking retained for API symmetry.
  linkWindow(wid, win) {
    const rec = this.windows.get(wid);
    if (rec) rec.win.__wid = wid;
    return rec;
  }

  // Re-apply the compatibility-checked color hint after appearance changes.
  reapplyCompatibleSiteThemeToAllTabs() {
    for (const tab of this.tabs.values()) this._applyCompatibleSiteTheme(tab);
  }

  // ---------- Session restore ----------
  saveSession() {
    const windows = [];
    for (const rec of this.windows.values()) {
      const urls = rec.tabs.map((t) => { const tab = this.tabs.get(t); return tab ? tab.url : null; }).filter(Boolean);
      if (urls.length) windows.push({ private: rec.private, urls });
    }
    securestore.save('session', { windows });
  }

  restoreSession() {
    if (settings.all().general.startup !== 'restore') return false;
    const saved = securestore.load('session', { windows: [] });
    let restored = false;
    for (const w of saved.windows || []) {
      this.createWindow({ private: w.private, urls: w.urls });
      restored = true;
    }
    return restored;
  }

  broadcastAll(channel, payload) {
    for (const rec of this.windows.values()) {
      const wc = this._shellWc(rec);
      if (wc) wc.send(channel, payload);
    }
  }
}

module.exports = new TabsManager();
