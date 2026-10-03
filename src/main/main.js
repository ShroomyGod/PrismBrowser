// main.js — Prism entry point.
// Boot order matters: DoH flags must be applied before app ready, but the
// encrypted vault can only be opened after app ready (Electron's safeStorage
// throws earlier). So we run a two-phase init:
//
//   pre-ready  : create vault dir, load non-sensitive settings from the
//                plaintext sidecar, apply DoH/GPU command-line switches.
//   post-ready : open the OS keyring, load real encrypted settings + stores.
const { app } = require('electron');
const securestore = require('./securestore');
const settings = require('./settings');
const stores = require('./stores');
const secureDns = require('./secure-dns');
const protocols = require('./protocols');
const tabs = require('./tabs');
const sessions = require('./sessions');
const shellIpc = require('./shell-ipc');
const menus = require('./menus');
const crawler = require('./crawler');
const { index } = require('./index-store');
const adblock = require('./adblock');
const security = require('./security');
const updater = require('./updater');

const SMOKE = process.argv.includes('--smoke');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const wid = tabs.focusedWindowId();
    if (wid) {
      const rec = tabs.windowRecord(wid);
      if (rec) { if (rec.win.isMinimized()) rec.win.restore(); rec.win.focus(); }
    } else if (!SMOKE) {
      tabs.createWindow();
    }
  });

  // --- pre-ready: vault dir + bootstrap settings (DoH depends on these) ---
  try {
    securestore.init();
    settings.initBootstrap();
  } catch (e) {
    console.error('[prism] pre-ready init failed', e);
  }
  if (settings.all().advanced.hardwareAcceleration === false) app.disableHardwareAcceleration();
  secureDns.applyAtStartup();
  protocols.privilegedSchemes();

  app.whenReady().then(() => {
    // --- post-ready: OS keyring is available, open the real encrypted vault ---
    try {
      securestore.initCrypto();
      settings.init();
      stores.init();
      const st = securestore.status();
      if (!st.encrypted) {
        console.error('[prism] vault unavailable; running with defaults only');
      }
    } catch (e) {
      console.error('[prism] vault init failed', e);
    }

    protocols.registerHandlers();

    tabs.init();
    const s = sessions.setupPartitions(tabs);
    tabs.setSessions(s);
    // The prism:// handler must exist on each partition session, not just the
    // default one, or tab views (which are bound to a partition) never resolve
    // internal pages and render blank.
    for (const ses of [s.mainSession, s.privSession]) protocols.registerOnSession(ses);

    shellIpc.registerIpc(tabs);
    menus.buildAppMenu(tabs);

    index.init();
    adblock.init();
    security.init();
    updater.init();

    crawler.init();
    crawler.onProgress = () => {
      tabs.broadcastAll('prism:crawl-progress', crawler.status());
    };
    security.onEvent = (type, payload) => tabs.broadcastAll('prism:' + type, payload);

    // Persist pending writes and the session on the way out.
    app.on('before-quit', () => {
      try { securestore.flushAll(); } catch (e) { console.error('[prism] flush', e); }
    });

    // First window (or restored session)
    if (!tabs.restoreSession()) {
      tabs.createWindow({ urls: ['prism://newtab'] });
    }

    if (SMOKE) {
      setTimeout(() => {
        console.log('PRISM SMOKE OK — index docs: ' + index.docCount() +
          ', adblock rules: ' + adblock.statsSnapshot().rulesBlocked +
          ', vault: ' + securestore.status().keyring);
        app.quit(0);
      }, 4000);
      setTimeout(() => { console.error('PRISM SMOKE TIMEOUT'); app.quit(1); }, 12000);
    }

    app.on('activate', () => {
      if (!tabs.focusedWindowId() && tabs.windows.size === 0) tabs.createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (SMOKE || process.platform !== 'darwin') app.quit();
  });

  process.on('uncaughtException', (err) => {
    console.error('[prism] uncaught', err);
    if (SMOKE) { console.error('PRISM SMOKE FAIL'); app.quit(1); }
  });
  process.on('unhandledRejection', (err) => {
    console.error('[prism] unhandled rejection', err);
  });
}
