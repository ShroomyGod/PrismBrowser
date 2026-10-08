// shell-ipc.js — every ipcMain handler: shell controls, omnibox, internal
// page APIs (history/bookmarks/downloads/passwords/settings/search),
// extensions, privacy stats, and data clearing.
const { ipcMain, app, shell, session, clipboard, nativeImage, dialog, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
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
const downloads = require('./downloads');
const ai = require('./ai');
const dataTransfer = require('./data-transfer');

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
  // The bar asks for its own list rather than reusing whatever the last state
  // push carried, so starring a page or adding one on the Bookmarks page shows
  // up immediately instead of at the next full update.
  ipcMain.handle('prism:bookmarks:bar', () => stores.barBookmarks());
  ipcMain.handle('prism:bookmarks:set-bar', (_e, { id, on }) => stores.setBookmarkBar(id, on));

  // ---------- downloads ----------
  ipcMain.handle('prism:downloads:list', () => stores.listDownloads());
  // Kept one handler for both spellings: page preload uses (path, reveal),
  // shell bridge uses (path). Both go through downloads.js now, which refuses
  // any path that is not one of our own recorded downloads.
  ipcMain.handle('prism:downloads:open', (_e, { path, reveal }) =>
    reveal ? downloads.reveal(path) : downloads.open(path));
  ipcMain.handle('prism:downloads:clear', () => { stores.clearDownloads(); return true; });

  // ---------- download file actions ----------
  // Each handler goes through downloads.js, which refuses any path that is not
  // one of our own recorded downloads, so a tampered history entry cannot be
  // used to open or delete an arbitrary file.
  ipcMain.handle('prism:downloads:run', (_e, { path }) => downloads.run(path));
  ipcMain.handle('prism:downloads:reveal', (_e, { path }) => downloads.reveal(path));
  ipcMain.handle('prism:downloads:delete-file', (_e, { path }) => {
    const result = downloads.removeFile(path);
    // The file is gone, so stop pretending the row can still be opened.
    if (result.ok) {
      const gone = path.resolve(result.path);
      for (const d of stores.listDownloads()) {
        if (d.path && path.resolve(d.path) === gone) {
          stores.updateDownload(d.id, { path: '', state: 'deleted' });
        }
      }
    }
    return result;
  });
  ipcMain.handle('prism:downloads:antivirus', () => ({
    ...downloads.antivirusStatus(),
    dir: downloads.downloadsDir(),
    prompt: !!(settings.all().general || {}).askWhereToSave
  }));
  ipcMain.handle('prism:downloads:choose-folder', async (e) => {
    const dir = await downloads.chooseFolder(winOf(e));
    if (!dir) return { ok: false, dir: downloads.downloadsDir() };
    settings.set({ general: { downloadDir: dir } });
    downloads.sync();
    return { ok: true, dir };
  });

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
  ipcMain.handle('prism:passwords:export-csv', async (e) => {
    if (privSender(e)) return { error: 'Password import and export is unavailable in a private window.' };
    try {
      const result = await dialog.showSaveDialog(winOf(e), {
        title: 'Export passwords as Google Password Manager CSV', defaultPath: 'Prism passwords.csv',
        filters: [{ name: 'CSV password export', extensions: ['csv'] }]
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      const target = /\.csv$/i.test(result.filePath) ? result.filePath : result.filePath + '.csv';
      fs.writeFileSync(target, dataTransfer.exportPasswordCsv(stores.exportPasswords()), { encoding: 'utf8', mode: 0o600, flag: 'w' });
      return { ok: true, path: target, count: stores.exportPasswords().length };
    } catch (error) { return { error: (error && error.message) || 'Could not export passwords.' }; }
  });
  ipcMain.handle('prism:passwords:import-csv', async (e) => {
    if (privSender(e)) return { error: 'Password import and export is unavailable in a private window.' };
    try {
      const result = await dialog.showOpenDialog(winOf(e), {
        title: 'Import Google Password Manager CSV', properties: ['openFile'],
        filters: [{ name: 'CSV password export', extensions: ['csv'] }]
      });
      if (result.canceled || !result.filePaths.length) return { canceled: true };
      const file = result.filePaths[0];
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > dataTransfer.CSV_LIMIT) return { error: 'CSV file is too large or invalid.' };
      const parsed = dataTransfer.parsePasswordCsv(fs.readFileSync(file, 'utf8'));
      const merged = stores.importPasswords(parsed.entries);
      return { ok: true, ...merged, rejected: parsed.rejected, total: parsed.total };
    } catch (error) { return { error: (error && error.message) || 'Could not import passwords.' }; }
  });
  ipcMain.handle('prism:cookies:export-ckz', async (e, { passphrase }) => {
    if (privSender(e)) return { error: 'Cookie import and export is unavailable in a private window.' };
    const record = tabs.windowRecord(activeWid(e));
    if (!record || record.private) return { error: 'Open a regular browser window to export cookies.' };
    try {
      const result = await dialog.showSaveDialog(winOf(e), {
        title: 'Export site cookies as encrypted CKZ', defaultPath: 'Prism cookies.ckz',
        filters: [{ name: 'Prism encrypted cookies', extensions: ['ckz'] }]
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      const cookies = await tabs.sessions.mainSession.cookies.get({});
      const archive = await dataTransfer.exportCookieArchive(cookies, passphrase);
      const target = /\.ckz$/i.test(result.filePath) ? result.filePath : result.filePath + '.ckz';
      fs.writeFileSync(target, archive, { mode: 0o600, flag: 'w' });
      return { ok: true, path: target, count: cookies.length };
    } catch (error) { return { error: (error && error.message) || 'Could not export cookies.' }; }
  });
  ipcMain.handle('prism:cookies:import-ckz', async (e, { passphrase }) => {
    if (privSender(e)) return { error: 'Cookie import and export is unavailable in a private window.' };
    const record = tabs.windowRecord(activeWid(e));
    if (!record || record.private) return { error: 'Open a regular browser window to import cookies.' };
    try {
      const result = await dialog.showOpenDialog(winOf(e), {
        title: 'Import encrypted Prism CKZ cookies', properties: ['openFile'],
        filters: [{ name: 'Prism encrypted cookies', extensions: ['ckz'] }]
      });
      if (result.canceled || !result.filePaths.length) return { canceled: true };
      const file = result.filePaths[0];
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > dataTransfer.CKZ_LIMIT) return { error: 'Cookie archive is too large or invalid.' };
      const cookies = await dataTransfer.importCookieArchive(fs.readFileSync(file), passphrase);
      let imported = 0, failed = 0;
      for (const cookie of cookies) {
        try { await tabs.sessions.mainSession.cookies.set(cookie); imported++; }
        catch (_) { failed++; }
      }
      return { ok: true, imported, failed, total: cookies.length };
    } catch (error) { return { error: (error && error.message) || 'Could not import cookie archive.' }; }
  });

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
  ipcMain.handle('prism:default-browser:status', () => ({
    supported: process.platform === 'win32',
    isDefault: require('./default-browser').isDefaultBrowser()
  }));
  ipcMain.handle('prism:default-browser:open-settings', async () =>
    require('./default-browser').openDefaultAppsSettings());

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
  ipcMain.handle('prism:extensions:open-popup', async (_e, { wid, id, anchor }) => {
    try { return await extensions.openPopup(wid, id, tabs, anchor); }
    catch (error) { return { error: (error && error.message) || 'Could not open extension popup.' }; }
  });
  ipcMain.handle('prism:extensions:load-unpacked', async (e) => {
    try {
      const win = winOf(e);
      const res = await extensions.pickAndLoadUnpacked(win);
      return res;
    } catch (err) { return { error: String(err.message || err) }; }
  });
  ipcMain.on('prism:store-install-failed', (e, { message }) => {
    const wc = tabs.shellContentsForWindow(winOf(e));
    if (wc) wc.send('prism:toast', { title: 'Extension install failed', body: message || 'Unknown error.', danger: true });
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
  ipcMain.handle('prism:security:check-local', (e, { wid }) => {
    const record = wid ? tabs.windowRecord(wid) : null;
    if (wid && !record) return { error: 'The browser window is no longer available.' };
    const url = record
      ? record.active && tabs.tabs.get(record.active)?.url
      : tabs.activeWebContents(activeWid(e))?.getURL();
    if (!/^https?:/i.test(url || '')) return { error: 'Only website URLs can be checked.' };
    return security.checkLocalUrl(url);
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

  // ---------- local AI (Prism Vision, page summaries) ----------
  // Inference happens in a worker thread (src/ai/worker.js); these handlers
  // only capture input and hand it over, so no model work touches this process.

  const visionClaims = new Map();
  const visionOverlays = new Map();

  // Model settings are also shown on prism://settings; image/text inference
  // remains restricted to an explicitly claimed Prism Vision tab.
  function aiManagementAccess(e) {
    const tab = tabs._tabByWebContentsId(e.sender);
    let page;
    try { page = new URL(e.sender.getURL()); } catch (_) { return false; }
    if (!tab || page.protocol !== 'prism:') return false;
    if (page.hostname === 'settings') return true;
    const claim = page.hostname === 'vision' && visionClaims.get(tab.id);
    return !!(claim && claim.expires >= Date.now());
  }

  ipcMain.handle('prism:ai:vision-session', (e) => {
    const tab = tabs._tabByWebContentsId(e.sender);
    let page;
    try { page = new URL(e.sender.getURL()); } catch (_) { return { error: 'Prism Vision is not available in this page.' }; }
    if (!tab || page.protocol !== 'prism:' || page.hostname !== 'vision') {
      return { error: 'Prism Vision is not available in this page.' };
    }
    const capture = pendingVisionCaptures.get(tab.id) || null;
    const previous = visionClaims.get(tab.id);
    const sourceTabId = (capture && capture.sourceTabId) ||
      (previous && previous.expires >= Date.now() && previous.sourceTabId) || null;
    if (sourceTabId) {
      const sourceTab = tabs.tabs.get(sourceTabId);
      if (!sourceTab || sourceTab.winId !== tab.winId || !/^https?:/i.test(sourceTab.view.webContents.getURL())) {
        return { error: 'The captured page is no longer available.' };
      }
    }
    visionClaims.set(tab.id, { sourceTabId, expires: Date.now() + 30 * 60 * 1000 });
    if (capture) pendingVisionCaptures.delete(tab.id);
    return { ok: true, sourceTabId, capture };
  });

  ipcMain.handle('prism:ai:status', (e) => {
    if (!aiManagementAccess(e)) return { error: 'Local AI model settings are not available in this page.' };
    return ai.status();
  });

  // Which tasks the Vision page offers is a user choice, so the filtering happens
  // here: the page must not be able to offer a task the user has switched off.
  ipcMain.handle('prism:ai:tasks', (e) => {
    if (!aiManagementAccess(e)) return { error: 'Local AI tasks are not available in this page.' };
    const allowed = settings.get('ai.visionTasks');
    const list = Array.isArray(allowed) && allowed.length
      ? ai.tasks.VISION_TASKS.filter((t) => allowed.includes(t.id))
      : ai.tasks.VISION_TASKS;
    return {
      vision: list.length ? list : ai.tasks.VISION_TASKS,
      summaryStyles: ai.tasks.SUMMARY_STYLE_IDS,
      enabled: settings.get('ai.enabled') !== false,
      summaryStyle: ai.tasks.summaryStyle(settings.get('ai.summaryStyle'))
    };
  });

  // Progress (model download, then inference) is streamed to whichever window
  // asked, so the Vision page can show what is happening instead of hanging.
  ipcMain.handle('prism:ai:watch', (e) => {
    const sender = e.sender;
    if (tabs.shellContentsForWindow(winOf(e)) !== sender) return false;
    const off = ai.onProgress((payload) => {
      if (!sender.isDestroyed()) sender.send('prism:ai:progress', payload);
    });
    e.sender.once('destroyed', off);
    return true;
  });

  function shellVisionSession(e, wid, tabId) {
    const senderWid = activeWid(e);
    if (!senderWid || (wid && senderWid !== wid)) return null;
    const record = tabs.windowRecord(senderWid);
    const sourceTab = tabId ? tabs.tabs.get(tabId) : tabs.activeTab(senderWid);
    if (!record || !sourceTab || sourceTab.winId !== senderWid || sourceTab.id !== record.active ||
        !/^https?:/i.test(sourceTab.view.webContents.getURL())) return null;
    if (tabs.shellContentsForWindow(winOf(e)) !== e.sender) return null;
    const entry = visionOverlays.get(senderWid);
    if (!entry || entry.tabId !== sourceTab.id || entry.url !== sourceTab.view.webContents.getURL() || entry.expires < Date.now()) return null;
    return { wid: senderWid, record, tab: sourceTab, entry };
  }

  ipcMain.handle('prism:vision-overlay:set', (e, { wid, open }) => {
    const senderWid = activeWid(e);
    if (tabs.shellContentsForWindow(winOf(e)) !== e.sender) return false;
    if (!senderWid || (wid && wid !== senderWid)) return false;
    if (open) return false;
    if (!open) {
      visionOverlays.delete(senderWid);
      tabs.setVisionOverlay(senderWid, false);
      return true;
    }
    return false;
  });

  ipcMain.handle('prism:vision-overlay:open', async (e, { wid, tabId }) => {
    const senderWid = activeWid(e);
    if (tabs.shellContentsForWindow(winOf(e)) !== e.sender) return { error: 'Prism Vision is only available from the browser toolbar.' };
    if (!senderWid || (wid && wid !== senderWid)) return { error: 'This window cannot capture another browser window.' };
    const record = tabs.windowRecord(senderWid);
    const tab = tabId ? tabs.tabs.get(tabId) : tabs.activeTab(senderWid);
    if (!record || !tab || tab.winId !== senderWid || tab.id !== record.active) return { error: 'There is no active page to select.' };
    const wc = tab.view.webContents;
    if (!/^https?:/i.test(wc.getURL())) return { error: 'Open a web page first.' };
    try {
      const captured = await wc.capturePage();
      const png = captured.toPNG();
      if (!png || !png.length) return { error: 'That page returned an empty screenshot.' };
      let text = '';
      try { text = await wc.executeJavaScript("(document.body && document.body.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, 6000)"); } catch (_) {}
      const entry = { tabId: tab.id, image: 'data:image/png;base64,' + png.toString('base64'), text,
        title: wc.getTitle() || '', url: wc.getURL(), expires: Date.now() + 10 * 60 * 1000 };
      visionOverlays.set(senderWid, entry);
      tabs.setVisionOverlay(senderWid, true);
      const shell = tabs.shellContents(senderWid);
      if (!shell) { visionOverlays.delete(senderWid); tabs.setVisionOverlay(senderWid, false); return { error: 'Prism Vision is unavailable.' }; }
      shell.send('prism:vision-overlay:state', { open: true, capture: { image: entry.image, title: entry.title, url: entry.url, tabId: entry.tabId } });
      return { ok: true };
    } catch (error) { return { error: (error && error.message) || 'That page could not be captured.' }; }
  });

  ipcMain.handle('prism:vision-overlay:capture', (e, { wid, tabId }) => {
    const session = shellVisionSession(e, wid, tabId);
    if (!session) return { error: 'That Prism Vision selection is no longer available.' };
    return { text: session.entry.text, title: session.entry.title, url: session.entry.url };
  });

  ipcMain.handle('prism:vision-overlay:analyse', (e, { wid, tabId, image, task }) => {
    const off = aiOff();
    if (off) return off;
    const session = shellVisionSession(e, wid, tabId);
    if (!session) return { error: 'That Prism Vision selection is no longer available.' };
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(image || ''));
    if (!match || match[1].length > 8 * 1024 * 1024) return { error: 'The selected image is invalid or too large.' };
    return ai.analyseImage(image, { task: task || 'caption' })
      .then((result) => ({ result }))
      .catch((error) => ({ error: (error && error.message) || 'Prism Vision could not analyse this selection.' }));
  });

  ipcMain.handle('prism:vision-overlay:summarise', (e, { wid, tabId }) => {
    const session = shellVisionSession(e, wid, tabId);
    const off = aiOff();
    if (off) return off;
    if (!session) return { error: 'That Prism Vision selection is no longer available.' };
    return ai.summarise(session.entry.text, { style: settings.get('ai.summaryStyle') || 'paragraph' })
      .then((result) => ({ result }))
      .catch((error) => ({ error: (error && error.message) || 'This page could not be summarised.' }));
  });

  // A capture is held only until the exact Prism Vision tab claims it.

  // A capture is held only until the exact Prism Vision tab claims it.
  const pendingVisionCaptures = new Map();

  // Screenshots the requested tab; only the current window's tab may be read.
  // capturePage returns the visible viewport, which is what the user sees.
  ipcMain.handle('prism:ai:open-vision', async (e, { wid, tabId }) => {
    const senderWid = activeWid(e);
    const targetWid = wid || senderWid;
    if (!senderWid || targetWid !== senderWid) return { error: 'This window cannot capture another browser window.' };
    const record = tabs.windowRecord(targetWid);
    if (!record) return { error: 'The browser window is no longer available.' };
    const tab = tabId ? tabs.tabs.get(tabId) : tabs.activeTab(targetWid);
    if (!tab || tab.winId !== targetWid) return { error: 'There is no active tab to look at.' };
    let url = tab.view.webContents.getURL();
    if (!/^https?:/i.test(url)) return { error: 'Open a web page first.' };
    try {
      let image = '';
      let captureError = '';
      try {
        const captured = await tab.view.webContents.capturePage();
        const png = captured.toPNG();
        if (png && png.length) image = 'data:image/png;base64,' + png.toString('base64');
        else captureError = 'That page returned an empty screenshot.';
      } catch (error) {
        captureError = (error && error.message) || 'That page could not be captured.';
      }
      let text = '';
      try { text = await tab.view.webContents.executeJavaScript("(document.body && document.body.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, 6000)"); } catch (_) {}
      let title = '';
      try { title = await tab.view.webContents.executeJavaScript('document.title || ""'); } catch (_) {}
      const source = { image, text, title, url, sourceTabId: tab.id, error: captureError };
      const visionTab = tabs.createTab(targetWid, 'about:blank');
      if (!visionTab) return { error: 'Could not open Prism Vision.' };
      const visionContents = tabs.tabs.get(visionTab).view.webContents;
      // Register the capture before navigating so the new page cannot race its
      // preload handshake and miss the screenshot payload. It is deleted after
      // a successful claim, not while the page reloads.
      pendingVisionCaptures.set(visionTab, source);
      visionContents.once('destroyed', () => {
        pendingVisionCaptures.delete(visionTab);
        visionClaims.delete(visionTab);
      });
      try { await visionContents.loadURL('prism://vision'); }
      catch (error) { return { error: (error && error.message) || 'Prism Vision could not be opened.' }; }
      return { ok: true, tabId: visionTab };
    } catch (err) {
      return { error: (err && err.message) || 'That page could not be captured.' };
    }
  });

  ipcMain.handle('prism:ai:capture', async (e, { tabId } = {}) => {
    const visionTab = tabs._tabByWebContentsId(e.sender);
    const claim = visionTab && visionClaims.get(visionTab.id);
    const linkedSource = claim && claim.sourceTabId ? tabs.tabs.get(claim.sourceTabId) : null;
    if (!visionTab || !claim || !claim.sourceTabId || !linkedSource || linkedSource.winId !== visionTab.winId || claim.expires < Date.now() || (tabId && claim.sourceTabId !== tabId)) {
      return { error: 'This capture is no longer available. Open Prism Vision from a web page to capture it.' };
    }
    const tab = linkedSource;
    const wc = linkedSource.view.webContents;
    if (!wc || wc.isDestroyed()) return { error: 'The captured page is no longer available.' };
    if (!/^https?:/i.test(wc.getURL())) return { error: 'Open a web page first.' };
    try {
      const image = await wc.capturePage();
      const png = image.toPNG();
      if (!png || !png.length) return { error: 'That page could not be captured.' };
      let text = '';
      try {
        text = await wc.executeJavaScript("(document.body && document.body.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, 6000)");
      } catch (_) { text = ''; }
      let title = '';
      try { title = await wc.executeJavaScript('document.title || ""'); } catch (_) {}
      return { image: 'data:image/png;base64,' + png.toString('base64'), text, title, url: wc.getURL(), sourceTabId: tab.id };
    } catch (err) {
      return { error: (err && err.message) || 'That page could not be captured.' };
    }
  });

  ipcMain.handle('prism:ai:copy-image', (e, { image }) => {
    const visionTab = tabs._tabByWebContentsId(e.sender);
    const claim = visionTab && visionClaims.get(visionTab.id);
    if (!claim || claim.expires < Date.now()) return { error: 'Open Prism Vision from a page before copying selections.' };
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(image || ''));
    if (!match) return { error: 'There is no image to copy.' };
    try {
      const value = nativeImage.createFromBuffer(Buffer.from(match[1], 'base64'));
      if (value.isEmpty()) return { error: 'That image could not be copied.' };
      clipboard.writeImage(value);
      return { ok: true };
    } catch (err) {
      return { error: (err && err.message) || 'That image could not be copied.' };
    }
  });

  // Local AI can be switched off in Settings; refuse clearly rather than quietly
  // running a model the user believes is off.
  const aiOff = () => (settings.get('ai.enabled') === false
    ? { error: 'Local AI is turned off in Settings.' }
    : null);

  ipcMain.handle('prism:ai:vision', (e, { image, task, input }) => {
    const off = aiOff();
    if (off) return off;
    const visionTab = tabs._tabByWebContentsId(e.sender);
    const claim = visionTab && visionClaims.get(visionTab.id);
    if (!visionTab || !/^prism:\/\/vision(?:[/?#]|$)/i.test(e.sender.getURL()) || !claim || claim.expires < Date.now()) {
      return { error: 'Open Prism Vision from a page before analysing an image.' };
    }
    return ai.analyseImage(image, { task, input })
      .then((result) => ({ result }))
      .catch((err) => ({ error: (err && err.message) || 'Prism Vision could not read that image.' }));
  });

  ipcMain.handle('prism:ai:summarise', async (e, { style }) => {
    const off = aiOff();
    if (off) return off;
    const wc = tabs.activeWebContents(activeWid(e));
    if (!wc) return { error: 'There is no active tab to summarise.' };
    let text = '';
    try {
      text = await wc.executeJavaScript("document.body ? document.body.innerText : ''");
    } catch (_) { text = ''; }
    if (!text || !text.trim()) return { error: 'This page has no text to summarise.' };
    try {
      // A menu that does not pass a style still honours the one in Settings.
      const result = await ai.summarise(text, {
        style: style || settings.get('ai.summaryStyle') || 'paragraph'
      });
      return { result };
    } catch (err) {
      return { error: (err && err.message) || 'This page could not be summarised.' };
    }
  });

  // Lets an internal page summarise text it already has (for example a
  // selection) rather than only the active tab.
  ipcMain.handle('prism:ai:summarise-text', (e, { text, style }) => {
    const off = aiOff();
    if (off) return off;
    const visionTab = tabs._tabByWebContentsId(e.sender);
    const claim = visionTab && visionClaims.get(visionTab.id);
    if (!visionTab || !/^prism:\/\/vision(?:[/?#]|$)/i.test(e.sender.getURL()) || !claim || claim.expires < Date.now()) {
      return { error: 'Open Prism Vision from a page before analysing text.' };
    }
    return ai.summarise(text, { style: style || settings.get('ai.summaryStyle') || 'paragraph' })
      .then((result) => ({ result }))
      .catch((err) => ({ error: (err && err.message) || 'That could not be summarised.' }));
  });

  ipcMain.handle('prism:ai:translation-languages', () => ai.translationLanguages());

  ipcMain.handle('prism:ai:translate-text', (e, { text, source, target }) => {
    const off = aiOff();
    if (off) return off;
    const visionTab = tabs._tabByWebContentsId(e.sender);
    const claim = visionTab && visionClaims.get(visionTab.id);
    if (!visionTab || !/^prism:\/\/vision(?:[/?#]|$)/i.test(e.sender.getURL()) || !claim || claim.expires < Date.now()) {
      return { error: 'Open Prism Vision from a page before translating text.' };
    }
    return ai.translate(text, { source, target })
      .then((result) => ({ result }))
      .catch((error) => ({ error: (error && error.message) || 'That text could not be translated.' }));
  });

  ipcMain.handle('prism:ai:translate', async (e, { wid, source, target }) => {
    const off = aiOff();
    if (off) return off;
    const effectiveWid = wid || activeWid(e);
    if (wid && !tabs.windowRecord(wid)) return { error: 'The browser window is no longer available.' };
    const wc = tabs.activeWebContents(effectiveWid);
    if (!wc) return { error: 'There is no active page to translate.' };
    if (!/^https?:/i.test(wc.getURL())) return { error: 'Open a web page first.' };
    let text = '';
    try {
      text = await wc.executeJavaScript("document.body ? document.body.innerText : ''");
    } catch (_) { text = ''; }
    try {
      return { result: await ai.translate(text, { source, target }) };
    } catch (error) {
      return { error: (error && error.message) || 'This page could not be translated.' };
    }
  });

  ipcMain.handle('prism:ai:clear-cache', (e) => {
    if (!aiManagementAccess(e)) return { error: 'Local AI model settings are not available in this page.' };
    return ai.clearCache();
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
