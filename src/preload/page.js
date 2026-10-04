// preload/page.js — bridge for internal prism:// pages only. Never exposed
// to web content: we check the origin before defining window.prism.
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'prism:') {
  contextBridge.exposeInMainWorld('prism', {
    // settings
    getSettings: () => ipcRenderer.invoke('prism:settings:get'),
    setSettings: (patch) => ipcRenderer.invoke('prism:settings:set', patch),
    relaunch: () => ipcRenderer.invoke('prism:relaunch'),
    versions: () => ipcRenderer.invoke('prism:versions'),

    // VPNGate directory (lists and exports profiles; does not connect)
    vpnDirectory: (refresh) => ipcRenderer.invoke('prism:vpn:directory', { refresh: !!refresh }),
    vpnSaveProfile: (host) => ipcRenderer.invoke('prism:vpn:save', { host }),

    // prism search
    search: (q, offset, limit) => ipcRenderer.invoke('prism:search:query', { q, offset, limit }),
    searchWeb: (q) => ipcRenderer.invoke('prism:search:web', { q }),
    searchSuggest: (q) => ipcRenderer.invoke('prism:search:suggest', { q }),
    searchUrlFor: (q) => ipcRenderer.invoke('prism:search:url', { q }),
    searchStats: () => ipcRenderer.invoke('prism:search:stats'),
    crawlRun: (maxPages) => ipcRenderer.send('prism:crawl:run', { maxPages }),
    crawlStop: () => ipcRenderer.send('prism:crawl:stop'),
    crawlStatus: () => ipcRenderer.invoke('prism:crawl:status'),
    removeHost: (host) => ipcRenderer.invoke('prism:index:remove-host', { host }),
    onCrawlProgress: (fn) => ipcRenderer.on('prism:crawl-progress', (_e, s) => fn(s)),

    // history
    historyList: (q, limit) => ipcRenderer.invoke('prism:history:list', { q, limit }),
    historyDelete: (url) => ipcRenderer.invoke('prism:history:delete', { url }),
    historyClear: () => ipcRenderer.invoke('prism:history:clear'),

    // bookmarks
    bookmarksList: () => ipcRenderer.invoke('prism:bookmarks:list'),
    bookmarksRemove: (id) => ipcRenderer.invoke('prism:bookmarks:remove', { id }),

    // downloads
    downloadsList: () => ipcRenderer.invoke('prism:downloads:list'),
    downloadsOpen: (path, reveal) => ipcRenderer.invoke('prism:downloads:open', { path, reveal }),
    downloadsClear: () => ipcRenderer.invoke('prism:downloads:clear'),
    onDownloadThreat: (fn) => ipcRenderer.on('prism:download-threat', (_e, d) => fn(d)),
    onDownloadsChanged: (fn) => ipcRenderer.on('prism:downloads-changed', () => fn()),

    // passwords
    passwordsList: () => ipcRenderer.invoke('prism:passwords:list'),
    passwordsAdd: (origin, username, password) => ipcRenderer.invoke('prism:passwords:add', { origin, username, password }),
    passwordsRemove: (id) => ipcRenderer.invoke('prism:passwords:remove', { id }),
    passwordsReveal: (id) => ipcRenderer.invoke('prism:passwords:reveal', { id }),

    // extensions
    extensionsList: () => ipcRenderer.invoke('prism:extensions:list'),
    extensionsLoadUnpacked: () => ipcRenderer.invoke('prism:extensions:load-unpacked'),
    extensionsInstall: (source, input) => ipcRenderer.invoke('prism:extensions:install', { source, input }),
    extensionsSearch: (source, query) => ipcRenderer.invoke('prism:extensions:search', { source, query }),
    extensionsStoreUrl: (source) => ipcRenderer.invoke('prism:extensions:store-url', { source }),
    extensionsOpenStore: (source) => ipcRenderer.invoke('prism:extensions:open-page', { source }),
    extensionsRemove: (id) => ipcRenderer.invoke('prism:extensions:remove', { id }),
    extensionsReload: (id) => ipcRenderer.invoke('prism:extensions:reload', { id }),
    onExtensionsChanged: (fn) => ipcRenderer.on('prism:extensions-changed', (_e, list) => fn(list)),

    // privacy
    privacyStats: () => ipcRenderer.invoke('prism:privacy:stats'),
    listsUpdate: () => ipcRenderer.invoke('prism:lists:update'),
    clearData: (opts) => ipcRenderer.invoke('prism:clear-data', opts),

    // navigation helpers
    openExternal: (url) => ipcRenderer.send('prism:open-external', { url }),

    // generic events
    onSettingsChanged: (fn) => ipcRenderer.on('prism:settings-changed', (_e, s) => fn(s))
  });
}
