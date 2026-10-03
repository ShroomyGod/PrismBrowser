// menus.js — application menu (accelerators live here), tab context menu,
// and page context menu.
const { Menu, app, shell, clipboard, dialog, net } = require('electron');
const fs = require('fs');
const path = require('path');
const settings = require('./settings');
const stores = require('./stores');

let tabs = null;
function setTabs(t) { tabs = t; }

function focused() { return tabs ? tabs.focusedWindowId() : null; }

function act(fn) {
  const wid = focused();
  if (wid && tabs) fn(wid);
}

function sendCmd(cmd) {
  const wid = focused();
  if (!wid || !tabs) return;
  // The chrome lives in the shell's WebContentsView, not in win.webContents.
  const wc = tabs.shellContents(wid);
  if (wc) wc.send('prism:cmd', cmd);
}

function openPrismPage(page) {
  const wid = focused() || (tabs ? [...tabs.windows.keys()][0] : null);
  if (wid && tabs) tabs.createTab(wid, 'prism://' + page);
}

function template() {
  return [
    {
      label: 'Prism',
      submenu: [
        { label: 'About Prism', click: () => openPrismPage('settings#about') },
        { type: 'separator' },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => openPrismPage('settings') },
        { label: 'Privacy Dashboard', click: () => openPrismPage('privacy') },
        { type: 'separator' },
        { label: 'Check for List Updates', click: async () => {
            await require('./adblock').refresh(true);
            await require('./security').refresh();
          } },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Prism' }
      ]
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => tabs && tabs.createWindow() },
        { label: 'New Private Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => tabs && tabs.createWindow({ private: true }) },
        { type: 'separator' },
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => act((wid) => tabs.createTab(wid, 'prism://newtab')) },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => act((wid) => {
            const rec = tabs.windowRecord(wid);
            if (rec && rec.active) tabs.closeTab(rec.active);
          }) },
        { type: 'separator' },
        { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', click: () => act((wid) => tabs.reopenClosedTab(wid)) }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find in Page', accelerator: 'CmdOrCtrl+F', click: () => sendCmd('open-find') },
        { label: 'Focus Address Bar', accelerator: 'CmdOrCtrl+L', click: () => sendCmd('focus-omnibox') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => act((wid) => tabs.reload(wid)) },
        { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', click: () => act((wid) => tabs.reload(wid, true)) },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => act((wid) => tabs.setZoom(wid, 0.5)) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => act((wid) => tabs.setZoom(wid, -0.5)) },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', click: () => act((wid) => tabs.setZoom(wid, 0)) },
        { type: 'separator' },
        { label: 'Bookmarks Bar', accelerator: 'CmdOrCtrl+Shift+B', click: () => sendCmd('toggle-bookmarks-bar') },
        { type: 'separator' },
        { label: 'Developer Tools', accelerator: 'F12', click: () => act((wid) => tabs.toggleDevTools(wid)) }
      ]
    },
    {
      label: 'History',
      submenu: [
        { label: 'Back', accelerator: 'Alt+Left', click: () => act((wid) => tabs.goBack(wid)) },
        { label: 'Forward', accelerator: 'Alt+Right', click: () => act((wid) => tabs.goForward(wid)) },
        { type: 'separator' },
        { label: 'Show History', accelerator: 'CmdOrCtrl+H', click: () => openPrismPage('history') },
        { label: 'Show Downloads', accelerator: 'CmdOrCtrl+J', click: () => openPrismPage('downloads') },
        { type: 'separator' },
        { label: 'Clear Browsing Data', accelerator: 'CmdOrCtrl+Shift+Delete', click: () => openPrismPage('settings#clear') }
      ]
    },
    {
      label: 'Bookmarks',
      submenu: [
        { label: 'Bookmark This Page', accelerator: 'CmdOrCtrl+D', click: () => act((wid) => {
            const tab = tabs.activeTab(wid);
            if (tab) stores.toggleBookmark(tab.url, tab.title, tab.favicon);
          }) },
        { label: 'Show Bookmarks', accelerator: 'CmdOrCtrl+Shift+O', click: () => openPrismPage('bookmarks') }
      ]
    },
    {
      label: 'Tabs',
      submenu: [
        { label: 'Next Tab', accelerator: 'CmdOrCtrl+Tab', click: () => act((wid) => cycleTab(wid, 1)) },
        { label: 'Previous Tab', accelerator: 'CmdOrCtrl+Shift+Tab', click: () => act((wid) => cycleTab(wid, -1)) },
        { type: 'separator' },
        { label: 'Mute Tab', accelerator: 'CmdOrCtrl+M', click: () => act((wid) => {
            const rec = tabs.windowRecord(wid);
            if (rec && rec.active) tabs.toggleMute(rec.active);
          }) },
        { label: 'Duplicate Tab', accelerator: 'CmdOrCtrl+Shift+D', click: () => act((wid) => {
            const rec = tabs.windowRecord(wid);
            if (rec && rec.active) tabs.duplicateTab(wid, rec.active);
          }) }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Prism Search: About the Engine', click: () => openPrismPage('search') },
        { label: 'Extensions Page', click: () => openPrismPage('extensions') }
      ]
    }
  ];
}

function cycleTab(wid, dir) {
  const rec = tabs.windowRecord(wid);
  if (!rec || !rec.tabs.length) return;
  const idx = rec.tabs.indexOf(rec.active);
  const next = (idx + dir + rec.tabs.length) % rec.tabs.length;
  tabs.activateTab(wid, rec.tabs[next]);
}

function buildAppMenu(t) {
  setTabs(t);
  Menu.setApplicationMenu(Menu.buildFromTemplate(template()));
}

// ---------- Context menus ----------
// "Save Image As..." has to actually prompt. wc.downloadURL() would quietly
// drop the file into the downloads folder instead, which is not what the menu
// item promises. net.fetch() runs in the main process, so it is not bound by
// the page's CORS policy and can read cross-origin images.
async function saveRemoteAs(wc, url, kind) {
  if (!url || !/^(https?:|data:|blob:)/i.test(url)) return;
  const win = BrowserWindowFromWc(wc);
  let name = kind === 'image' ? 'image.png' : 'page.html';
  try {
    const base = path.basename(new URL(url).pathname);
    if (base && /\.[a-z0-9]{2,5}$/i.test(base)) name = base;
  } catch (_) { /* data: and blob: have no useful pathname */ }
  const opts = { defaultPath: name };
  try {
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (res.canceled || !res.filePath) return;
    const response = await net.fetch(url);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    fs.writeFileSync(res.filePath, Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    const msg = (err && err.message) || String(err);
    if (win && !win.isDestroyed()) {
      dialog.showMessageBox(win, { type: 'error', message: 'Could not save that file', detail: msg });
    }
  }
}

function showPageContextMenu(wc, params, tabsMgr) {
  const items = [];
  const hasLink = !!params.linkURL;
  if (hasLink) {
    items.push(
      { label: 'Open Link in New Tab', click: () => { const wid = focused(); if (wid) tabsMgr.createTab(wid, params.linkURL, { background: true }); } },
      { label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) },
      { type: 'separator' }
    );
  }
  if (params.mediaType === 'image' && params.srcURL) {
    items.push(
      { label: 'Open Image in New Tab', click: () => { const wid = focused(); if (wid) tabsMgr.createTab(wid, params.srcURL, { background: true }); } },
      { label: 'Save Image As...', click: () => saveRemoteAs(wc, params.srcURL, 'image') },
      { label: 'Copy Image Address', click: () => clipboard.writeText(params.srcURL) },
      { type: 'separator' }
    );
  }
  if (params.selectionText) {
    const engine = settings.defaultEngine();
    items.push(
      { label: 'Search ' + engine.name + ' for "' + params.selectionText.slice(0, 24) + '"',
        click: () => { const wid = focused(); if (wid) tabsMgr.createTab(wid, settings.engineSearchUrl(engine.id, params.selectionText)); } },
      { label: 'Copy', role: 'copy' },
      { type: 'separator' }
    );
  }
  if (params.isEditable) {
    items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' });
  }
  items.push(
    { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
    { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
    { label: 'Reload', click: () => wc.reload() },
    { type: 'separator' },
    { label: 'Save Page As...', click: () => wc.downloadURL(wc.getURL()) },
    { label: 'View Page Source', click: () => { const wid = focused(); if (wid) tabsMgr.createTab(wid, 'view-source:' + wc.getURL()); } },
    { label: 'Inspect', click: () => wc.inspectElement(params.x, params.y) }
  );
  Menu.buildFromTemplate(items).popup({ window: BrowserWindowFromWc(wc) });
}

function BrowserWindowFromWc(wc) {
  const { BrowserWindow } = require('electron');
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents === wc || win.webContents.hostWebContents === wc) return win;
  }
  return BrowserWindow.getFocusedWindow();
}

function showTabContextMenu(wid, tabId, tabsMgr) {
  const tab = tabsMgr.tabs.get(tabId);
  if (!tab) return;
  const rec = tabsMgr.windowRecord(wid);
  Menu.buildFromTemplate([
    { label: 'Reload', click: () => { tabsMgr.activateTab(wid, tabId); tabsMgr.reload(wid); } },
    { label: 'Duplicate', click: () => tabsMgr.duplicateTab(wid, tabId) },
    { label: tab.muted ? 'Unmute Tab' : 'Mute Tab', click: () => tabsMgr.toggleMute(tabId) },
    { type: 'separator' },
    { label: 'Close Other Tabs', enabled: rec && rec.tabs.length > 1, click: () => {
        for (const t of [...rec.tabs]) if (t !== tabId) tabsMgr.closeTab(t);
      } },
    { label: 'Close Tab', click: () => tabsMgr.closeTab(tabId) }
  ]).popup({ window: rec.win });
}

module.exports = { buildAppMenu, showPageContextMenu, showTabContextMenu };
