// preload/shell.js — bridge for the browser chrome (tab strip, toolbar).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('prismShell', {
  init: (wid) => ipcRenderer.send('prism:init', { wid }),

  // Measured height of the shell chrome, so main can place the page below it.
  reportChromeHeight: (wid, height) =>
    ipcRenderer.send('prism:chrome-height', { wid, height: Math.round(height) }),

  // Bottom edge the shell view must cover: chrome + any open overlay
  // (dropdown, menus, findbar, toasts). The shell sits above the page, so
  // without this those overlays would be clipped away.
  reportShellExtent: (wid, height) =>
    ipcRenderer.send('prism:shell-extent', { wid, height: Math.round(height) }),

  minimize: () => ipcRenderer.send('prism:win:minimize'),
  maximize: () => ipcRenderer.send('prism:win:maximize'),
  close: () => ipcRenderer.send('prism:win:close'),

  newTab: (wid, url, background) => ipcRenderer.invoke('prism:tab:new', { wid, url, background }),
  closeTab: (tabId) => ipcRenderer.send('prism:tab:close', { tabId }),
  activateTab: (wid, tabId) => ipcRenderer.send('prism:tab:activate', { wid, tabId }),
  moveTab: (wid, from, to) => ipcRenderer.send('prism:tab:move', { wid, from, to }),
  muteTab: (tabId) => ipcRenderer.send('prism:tab:mute', { tabId }),
  tabContextMenu: (wid, tabId) => ipcRenderer.send('prism:tab-context-menu', { wid, tabId }),

  navigate: (tabId, input) => ipcRenderer.invoke('prism:nav', { tabId, input }),
  back: (wid) => ipcRenderer.send('prism:nav:back', { wid }),
  forward: (wid) => ipcRenderer.send('prism:nav:forward', { wid }),
  reload: (wid, hard) => ipcRenderer.send('prism:nav:reload', { wid, hard }),
  stop: (wid) => ipcRenderer.send('prism:nav:stop', { wid }),
  zoom: (wid, delta) => ipcRenderer.send('prism:zoom', { wid, delta }),
  devtools: (wid) => ipcRenderer.send('prism:devtools', { wid }),
  httpsRetry: (tabId) => ipcRenderer.send('prism:https-retry', { tabId }),
  proceedAnyway: (url, tabId) => ipcRenderer.invoke('prism:proceed-anyway', { url, tabId }),

  suggest: (text) => ipcRenderer.invoke('prism:suggest', { text }),

  find: (wid, text, opts) => ipcRenderer.send('prism:find', { wid, text, ...opts }),
  findStop: (wid) => ipcRenderer.send('prism:find:stop', { wid }),

  toggleBookmark: (url, title, favicon) => ipcRenderer.invoke('prism:bookmark:toggle', { url, title, favicon }),
  isBookmarked: (url) => ipcRenderer.invoke('prism:bookmark:is', { url }),
  bookmarksBarToggle: () => ipcRenderer.send('prism:bookmark:bar-toggle'),

  newWindow: () => ipcRenderer.send('prism:new-window'),
  newPrivateWindow: () => ipcRenderer.send('prism:new-private-window'),

  checkForUpdates: () => ipcRenderer.invoke('prism:update:check'),
  installUpdate: () => ipcRenderer.send('prism:update:install'),
  updateStatus: () => ipcRenderer.invoke('prism:update:status'),
  onUpdateStatus: (fn) => ipcRenderer.on('prism:update-status', (_e, d) => fn(d)),
  onUpdateDownloaded: (fn) => ipcRenderer.on('prism:update-downloaded', (_e, d) => fn(d)),
  onUpdateAvailable: (fn) => ipcRenderer.on('prism:update-available', (_e, d) => fn(d)),

  getSettings: () => ipcRenderer.invoke('prism:settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('prism:settings:set', patch),
  removeBookmark: (id) => ipcRenderer.invoke('prism:bookmarks:remove', { id }),
  onDownloadThreat: (fn) => ipcRenderer.on('prism:download-threat', (_e, d) => fn(d)),
  onDownloadsChanged: (fn) => ipcRenderer.on('prism:downloads-changed', () => fn()),

  // events from main
  onTabs: (fn) => ipcRenderer.on('prism:tabs', (_e, data) => fn(data)),
  onOmnibox: (fn) => ipcRenderer.on('prism:omnibox', (_e, data) => fn(data)),
  onAdblock: (fn) => ipcRenderer.on('prism:adblock', (_e, data) => fn(data)),
  onCmd: (fn) => ipcRenderer.on('prism:cmd', (_e, cmd) => fn(cmd)),
  onTargetUrl: (fn) => ipcRenderer.on('prism:target-url', (_e, data) => fn(data)),
  onFindResult: (fn) => ipcRenderer.on('prism:find-result', (_e, data) => fn(data)),
  onHtmlFullscreen: (fn) => ipcRenderer.on('prism:html-fullscreen', (_e, on) => fn(on)),
  onPageFocused: (fn) => ipcRenderer.on('prism:page-focused', () => fn()),
  onChromeMode: (fn) => ipcRenderer.on('prism:chrome-mode', (_e, mode) => fn(mode)),
  onSettingsChanged: (fn) => ipcRenderer.on('prism:settings-changed', (_e, s) => fn(s))
});
