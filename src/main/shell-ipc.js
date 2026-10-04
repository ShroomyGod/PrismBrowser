// shell-ipc.js — every ipcMain handler: shell controls, omnibox, internal
// page APIs (history/bookmarks/downloads/passwords/settings/search),
// extensions, privacy stats, and data clearing.
const { ipcMain, app, shell, session, clipboard, dialog, BrowserWindow } = require('electron');
const fs = require('fs');
const settings = require('./settings');
const stores = require('./stores');
const adblock = require('./adblock');
const security = require('./security');
const extensions = require('./extensions');
const securestore = require('./securestore');
const prismSearch = require('./prism-search');
const prismSearchWeb = require('./prism-search-web');
const crawler = require('./crawler');
const { index } = require('./index-store');
const menus = require('./menus');

function registerIpc(tabs) {
  // The shell lives in its own WebContentsView, so resolve the owning
  // window from the sender first and only fall back to Electron's lookup.
  const winOf = (e) => tabs.shellWindowFor(e.sender) || BrowserWindow.fromWebContents(e.sender);

  // ---------- auto-update ----------
  ipcMain.handle('prism:update:check', () => require('./updater').check());
  ipcMain.on('prism:update:install', () => { require('./updater').install(); });
  ipcMain.handle('prism:update:status', () => require('./updater').status());


  // ---------- shell bootstrap ----------
  ipcMain.on('prism:init', (e, { wid }) => {
    tabs.linkWindow(wid, winOf(e));
    tabs._sendFullState(wid);
  });

  // The shell measures its own chrome (tab strip + toolbar + bookmarks bar)
  // and reports the height so the page view can be placed below it. This is
  // what keeps the page from overlapping the toolbar.
  ipcMain.on('prism:chrome-height', (e, { wid, height }) => {
    tabs.setChromeHeight(wid, height);
  });

  // The shell also reports how far down its OPEN overlays (omnibox dropdown,
  // menus, findbar, toasts) reach. The shell view is stacked above the page,
  // so its bounds must grow to cover them or they would be clipped away.
  ipcMain.on('prism:shell-extent', (e, { wid, height }) => {
    tabs.setShellExtent(wid, height);
  });

  // ---------- window controls ----------
  ipcMain.on('prism:win:minimize', (e) => { const w = winOf(e); if (w) w.minimize(); });
  ipcMain.on('prism:win:maximize', (e) => {
    const w = winOf(e);
    if (!w) return;
    if (w.isMaximized()) w.unmaximize(); else w.maximize();
  });
  ipcMain.on('prism:win:close', (e) => { const w = winOf(e); if (w) w.close(); });

  // ---------- tabs ----------
  ipcMain.handle('prism:tab:new', (_e, { wid, url, background }) => tabs.createTab(wid || tabs.focusedWindowId(), url || 'prism://newtab', { background: !!background }));
  ipcMain.on('prism:tab:close', (_e, { tabId }) => tabs.closeTab(tabId));
  ipcMain.on('prism:tab:activate', (_e, { wid, tabId }) => tabs.activateTab(wid, tabId));
  ipcMain.on('prism:tab:move', (_e, { wid, from, to }) => tabs.moveTab(wid, from, to));
  ipcMain.on('prism:tab:mute', (_e, { tabId }) => tabs.toggleMute(tabId));

  // ---------- navigation ----------
  ipcMain.handle('prism:nav', (_e, { tabId, input }) => tabs.navigateTab(tabId, input));
  ipcMain.on('prism:nav:back', (_e, { wid }) => tabs.goBack(wid));
  ipcMain.on('prism:nav:forward', (_e, { wid }) => tabs.goForward(wid));
  ipcMain.on('prism:nav:reload', (_e, { wid, hard }) => tabs.reload(wid, hard));
  ipcMain.on('prism:nav:stop', (_e, { wid }) => tabs.stop(wid));
  ipcMain.on('prism:zoom', (_e, { wid, delta }) => tabs.setZoom(wid, delta));
  ipcMain.on('prism:devtools', (_e, { wid }) => tabs.toggleDevTools(wid));
  ipcMain.on('prism:https-retry', (_e, { tabId }) => tabs.retryHttp(tabId));
  ipcMain.handle('prism:proceed-anyway', (_e, { url, tabId }) => {
    let host = '';
    try { host = new URL(url).hostname.toLowerCase(); } catch (_) {}
    if (host) security.addException(host);
    if (tabId) { const tab = tabs.tabs.get(tabId); if (tab) tab.view.webContents.loadURL(url).catch(() => {}); }
    return true;
  });

  // ---------- omnibox suggestions ----------
  ipcMain.handle('prism:suggest', (_e, { text }) => {
    const out = [];
    const q = String(text || '').trim();
    if (!q) return out;
    const resolved = settings.resolveOmnibox(q);
    if (resolved && resolved.isSearch === false) {
      out.push({ type: 'url', label: q, sub: '', input: resolved.url });
    } else if (resolved) {
      const eng = settings.engineById(settings.all().search.defaultEngine);
      out.push({ type: 'search', label: q, sub: 'Search ' + eng.name, input: q });
    }
    for (const term of prismSearch.suggest(q, 3)) {
      out.push({ type: 'prism', label: term, sub: 'Prism Search index', input: term });
    }
    for (const h of stores.searchHistory(q, 4)) {
      if (out.length >= 8) break;
      out.push({ type: 'history', label: h.title || h.url, sub: h.url, input: h.url });
    }
    // dedupe by input
    const seen = new Set();
    return out.filter((o) => (seen.has(o.input) ? false : (seen.add(o.input), true))).slice(0, 8);
  });

  // ---------- find in page ----------
  ipcMain.on('prism:find', (_e, { wid, text, forward, findNext }) => tabs.findInPage(wid, text, { forward, findNext }));
  ipcMain.on('prism:find:stop', (_e, { wid }) => tabs.stopFind(wid));

  // ---------- bookmarks ----------
  ipcMain.handle('prism:bookmark:toggle', (_e, { url, title, favicon }) => stores.toggleBookmark(url, title, favicon));
  ipcMain.handle('prism:bookmark:is', (_e, { url }) => stores.isBookmarked(url));
  ipcMain.on('prism:bookmark:bar-toggle', () => {
    const cur = settings.all().appearance.bookmarksBar;
    settings.set({ appearance: { bookmarksBar: !cur } });
  });

  // ---------- history ----------
  ipcMain.handle('prism:history:list', (_e, { q, limit }) => stores.searchHistory(q, limit || 100));
  ipcMain.handle('prism:history:delete', (_e, { url }) => { stores.deleteHistory((e2) => e2.url === url); return true; });
  ipcMain.handle('prism:history:clear', () => { stores.clearHistory(); return true; });

  // ---------- bookmarks page ----------
  ipcMain.handle('prism:bookmarks:list', () => stores.listBookmarks());
  ipcMain.handle('prism:bookmarks:remove', (_e, { id }) => { stores.removeBookmark(id); return true; });

  // ---------- downloads ----------
  ipcMain.handle('prism:downloads:list', () => stores.listDownloads());
  ipcMain.handle('prism:downloads:open', (_e, { path, reveal }) => {
    if (!path) return false;
    if (reveal) shell.showItemInFolder(path);
    else shell.openPath(path);
    return true;
  });
  ipcMain.handle('prism:downloads:clear', () => { stores.clearDownloads(); return true; });

  // ---------- passwords ----------
  // A private window must not be able to read or write the permanent vault:
  // prism://passwords is reachable from any window, and a saved credential is
  // exactly the kind of thing incognito exists to keep out of reach. Writing
  // from incognito is also a lie - the user is told nothing is kept, yet the
  // password would outlive the window in the encrypted store.
  const privSender = (e) => tabs.isPrivateWebContents && tabs.isPrivateWebContents(e.sender);
  ipcMain.handle('prism:passwords:list', (e) => (privSender(e) ? [] : stores.listPasswords()));
  ipcMain.handle('prism:passwords:add', (e, { origin, username, password }) => {
    if (privSender(e)) return false;
    if (!origin || !password) return false;
    stores.addPassword(origin, username || '', password);
    return true;
  });
  ipcMain.handle('prism:passwords:remove', (e, { id }) => {
    if (privSender(e)) return false;
    stores.removePassword(id); return true;
  });
  ipcMain.handle('prism:passwords:reveal', (e, { id }) => (privSender(e) ? '' : stores.revealPassword(id)));

  // ---------- settings ----------
  ipcMain.handle('prism:settings:get', () => settings.all());
  ipcMain.handle('prism:settings:set', (_e, patch) => {
    const next = settings.set(patch);
    if (patch && patch.advanced && 'userAgent' in (patch.advanced || {})) {
      const ua = next.advanced.userAgent;
      const main = session.fromPartition('persist:prism');
      const priv = session.fromPartition('prism-private');
      if (ua) { main.setUserAgent(ua); priv.setUserAgent(ua); }
      else { main.setUserAgent(main.getUserAgent()); }
    }
    return next;
  });
  ipcMain.handle('prism:relaunch', () => { app.relaunch(); app.quit(); return true; });

  // ---------- Prism Search ----------
  ipcMain.handle('prism:search:query', (_e, { q, offset, limit }) => prismSearch.search(q, { offset, limit }));
  // Federated SearXNG web results rebranded for Prism Search. Never throws:
  // if configured instances are unavailable, the UI can fall back locally.
  ipcMain.handle('prism:search:web', (_e, { q }) => prismSearchWeb.searchWeb(q));
  ipcMain.handle('prism:search:suggest', (_e, { q }) => prismSearch.suggest(q));
  // Internal pages (the new-tab search box) cannot read settings directly, so
  // resolve the query through the user's default engine here instead of
  // hardcoding a prism:// URL in the renderer.
  ipcMain.handle('prism:search:url', (_e, { q }) =>
    settings.engineSearchUrl(settings.all().search.defaultEngine, String(q || '')));
  ipcMain.handle('prism:search:stats', () => prismSearch.stats());
  ipcMain.on('prism:crawl:run', (_e, { maxPages }) => { crawler.run({ maxPages }); });
  ipcMain.on('prism:crawl:stop', () => crawler.stop());
  ipcMain.handle('prism:crawl:status', () => crawler.status());
  ipcMain.handle('prism:index:remove-host', (_e, { host }) => { index.removeHost(host); index.persist(); return true; });

  // ---------- extensions ----------
  ipcMain.handle('prism:extensions:list', () => extensions.list());
  ipcMain.handle('prism:extensions:load-unpacked', async (e) => {
    try {
      const win = winOf(e);
      const res = await extensions.pickAndLoadUnpacked(win);
      return res;
    } catch (err) { return { error: String(err.message || err) }; }
  });
  ipcMain.handle('prism:extensions:install', async (_e, { source, input }) => {
    try {
      const id = await extensions.installFromStore(source, input);
      return { id };
    } catch (err) { return { error: String(err.message || err) }; }
  });
  // Store search + the public store URL, so installing never requires pasting
  // a link the user has to go and find first.
  ipcMain.handle('prism:extensions:search', async (_e, { source, query }) => {
    try {
      return { results: await extensions.search(source, query) };
    } catch (err) { return { error: String(err.message || err) }; }
  });
  ipcMain.handle('prism:extensions:store-url', (_e, { source }) => extensions.storeUrl(source));
  ipcMain.handle('prism:extensions:open-page', (e, { source }) => {
    const wid = tabs.focusedWindowId() || [...tabs.windows.keys()][0];
    if (!wid) return false;
    tabs.createTab(wid, extensions.storeUrl(source));
    return true;
  });
  ipcMain.handle('prism:extensions:remove', (_e, { id }) => extensions.remove(id));
  ipcMain.handle('prism:extensions:reload', (_e, { id }) => extensions.reload(id));

  // ---------- privacy dashboard / lists ----------
  ipcMain.handle('prism:privacy:stats', () => ({
    adblock: adblock.statsSnapshot(),
    security: security.statsSnapshot(),
    storage: securestore.status(),
    dns: { ...settings.all().dns, activeTemplate: settings.dnsTemplate(), appliedThisRun: require('./secure-dns').appliedTemplate || null },
    history: stores.historyStats(),
    search: prismSearch.stats()
  }));
  ipcMain.handle('prism:lists:update', async () => {
    const a = await adblock.refresh(true);
    const s = await security.refresh();
    return { adblock: a, security: s };
  });

  // ---------- clear browsing data ----------
  ipcMain.handle('prism:clear-data', async (_e, opts) => {
    const o = opts || {};
    const main = session.fromPartition('persist:prism');
    if (o.history) stores.clearHistory();
    if (o.downloads) stores.clearDownloads();
    if (o.passwords) { stores.passwords.ensure().entries = []; stores.passwords.persist(); }
    if (o.cache) await main.clearCache();
    if (o.cookies || o.siteData) {
      await main.clearStorageData({
        storages: o.cookies && o.siteData
          ? ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'websql', 'shadercache']
          : ['cookies']
      });
    }
    return true;
  });

  // ---------- misc ----------
  ipcMain.handle('prism:versions', () => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node
  }));
  ipcMain.on('prism:open-external', (_e, { url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:') shell.openExternal(url);
    } catch (_) {}
  });
  ipcMain.on('prism:tab-context-menu', (_e, { wid, tabId }) => menus.showTabContextMenu(wid, tabId, tabs));
  ipcMain.on('prism:new-private-window', () => tabs.createWindow({ private: true }));
  ipcMain.on('prism:new-window', () => tabs.createWindow());

  // ---------- ⋮ main menu ----------
  // The shell menu is data-driven (src/shell/menu-items.js); every row resolves
  // to one of these handlers, so this block is the whole main-process surface
  // behind the menu.

  const activeWid = (e) => {
    const w = winOf(e);
    return (w && tabs.windowIdFor ? tabs.windowIdFor(w) : null) || tabs.focusedWindowId();
  };

  // Locking the vault flushes pending writes and drops the in-memory master key
  // and cached plaintext; the key itself is re-unwrapped from the OS keyring on
  // the next access, so nothing is ever written unencrypted.
  ipcMain.handle('prism:vault:lock', () => securestore.lock());

  ipcMain.handle('prism:tab:groups', (e, { op, groupId, name }) => {
    const wid = activeWid(e);
    if (op === 'list') return tabs.listGroups(wid);
    if (op === 'create') return tabs.groupActiveTab(wid, name);
    if (op === 'group-active') return tabs.groupActiveTab(wid);
    if (op === 'ungroup') return tabs.ungroupActiveTab(wid);
    if (op === 'close-all') return tabs.closeAllGroups(wid);
    if (op === 'focus') return tabs.focusGroup(wid, groupId);
    return null;
  });

  ipcMain.on('prism:win:fullscreen', (e) => {
    const w = winOf(e);
    if (!w) return;
    w.setFullScreen(!w.isFullScreen());
  });

  ipcMain.handle('prism:page:print', (e) => {
    const wc = tabs.activeWebContents(activeWid(e));
    if (!wc) return { error: 'No active tab to print.' };
    return new Promise((resolve) => {
      wc.print({ silent: false, printBackground: true }, (ok, reason) => {
        resolve(ok ? { ok: true } : { error: reason === 'cancelled' ? null : (reason || 'Printing failed.') });
      });
    });
  });

  ipcMain.handle('prism:page:print-pdf', async (e) => {
    const wc = tabs.activeWebContents(activeWid(e));
    if (!wc) return { error: 'No active tab to save.' };
    const url = wc.getURL();
    const suggested = (suggestedPdfName(url) || 'page') + '.pdf';
    const win = winOf(e);
    const res = await dialog.showSaveDialog(win, { defaultPath: suggested, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (res.canceled || !res.filePath) return { ok: false };
    try {
      const pdf = await wc.printToPDF({ printBackground: true, pageSize: 'A4' });
      fs.writeFileSync(res.filePath, pdf);
      return { ok: true, path: res.filePath };
    } catch (err) {
      return { error: (err && err.message) || 'Could not save the PDF.' };
    }
  });

  ipcMain.handle('prism:page:save', async (e) => {
    const wc = tabs.activeWebContents(activeWid(e));
    if (!wc) return { error: 'No active tab to save.' };
    const url = wc.getURL();
    if (!/^https?:/i.test(url)) return { error: 'Only web pages can be saved. Internal Prism pages cannot.' };
    const win = winOf(e);
    const res = await dialog.showSaveDialog(win, { defaultPath: suggestedPdfName(url) + '.html' });
    if (res.canceled || !res.filePath) return { ok: false };
    try {
      const html = await wc.executeJavaScript('document.documentElement.outerHTML');
      fs.writeFileSync(res.filePath, String(html), 'utf8');
      return { ok: true, path: res.filePath };
    } catch (err) {
      return { error: (err && err.message) || 'Could not save the page.' };
    }
  });

  ipcMain.handle('prism:clipboard:write', (_e, { text }) => {
    if (typeof text !== 'string' || !text) return false;
    clipboard.writeText(text);
    return true;
  });

  ipcMain.handle('prism:page:text', async (e) => {
    const wc = tabs.activeWebContents(activeWid(e));
    if (!wc) return '';
    try {
      return await wc.executeJavaScript(
        "(document.body && document.body.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim()"
      );
    } catch (_) { return ''; }
  });ipcMain.handle('prism:site:clear-data', async (e) => {
    const wid = activeWid(e);
    const wc = tabs.activeWebContents(wid);
    if (!wc) return { error: 'No active tab.' };
    const url = wc.getURL();
    // Only real web sites have site data. prism:// and view-source: must be
    // refused rather than "clearing" a made-up host.
    if (!/^https?:/i.test(url)) return { error: 'This tab is not showing a web site.' };
    let host = '';
    try { host = new URL(url).hostname; } catch (_) {}
    if (!host) return { error: 'This tab is not showing a web site.' };
// Ask the webContents for its own session so private windows clear their own
// partition instead of guessing at partition names.
const sess = wc.session || session.fromPartition('persist:prism');
const origin = url.startsWith('https') ? 'https://' + host : 'http://' + host;
try {
      // Cookies come back under the registered scheme, storage under the page's
      // own scheme, so both origins are cleared.
      await sess.clearStorageData({ origin, storages: SITE_DATA_STORAGES });
      await sess.clearStorageData({ origin: 'https://' + host, storages: SITE_DATA_STORAGES });
      wc.reload();
      return { ok: true, host };
    } catch (err) {
      return { error: (err && err.message) || 'Could not clear site data.' };
    }
  });

  ipcMain.on('prism:app:exit', () => {
    tabs.saveSession();
    app.quit();
  });
}

const SITE_DATA_STORAGES = ['cookies', 'localstorage', 'indexdb', 'shadercache', 'websql', 'serviceworkers', 'cachestorage'];

function suggestedPdfName(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const base = (u.hostname + (u.pathname === '/' ? '' : u.pathname))
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    return base || 'page';
  } catch (_) {
    return 'page';
  }
}

module.exports = { registerIpc };
