// sessions.js — session partitions and all request-level wiring.
//   persist:prism      — normal profile (cookies, storage, extensions)
//   prism-private      — private windows: in-memory session, nothing on disk
//
// Renamed from persist:shroom / shroom-private in the Shroom -> Prism
// rebrand. The persistent partition's name is its on-disk directory, so any
// profile stored under the old name stays behind in userData and is no longer
// read; Prism starts from a fresh profile.
const { session } = require('electron');
const settings = require('./settings');
const adblock = require('./adblock');
const security = require('./security');
const stores = require('./stores');
const extensions = require('./extensions');

const DEFAULT_PERMISSIONS = {
  fullscreen: 'allow',
  pointerLock: 'allow',
  notifications: 'allow',
  media: 'deny',
  geolocation: 'deny',
  'clipboard-read': 'deny',
  'clipboard-sanitized-write': 'allow',
  midi: 'deny',
  'background-sync': 'deny'
};

function setupPartitions(tabs) {
  const mainSession = session.fromPartition('persist:prism');
  const privSession = session.fromPartition('prism-private');

  for (const ses of [mainSession, privSession]) {
    // ONE onBeforeRequest listener per session, deliberately. Electron keeps
    // only the last listener registered for an event, so the ad blocker and the
    // malware shield must share this slot instead of each registering their own.
    // When they raced, adblock.attach() lost and was silently replaced, which is
    // why ads were never blocked while the shield still raised false positives.
    ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
      const isMainFrame = details.resourceType === 'mainFrame';
      const siteHost = tabs.siteHostForWebContents(details.webContents);

      if (adblock.shouldBlock(details, siteHost)) return callback({ cancel: true });

      // Malware shield for top-level navigations (sync part; async Safe
      // Browsing verdicts redirect to the block page once known).
      if (isMainFrame && settings.all().security.malwareEnabled) {
        const host = (() => { try { return new URL(details.url).hostname.toLowerCase(); } catch (_) { return ''; } })();
        if (host && !security.exceptions.has(host) && security.hosts.has(host)) {
          security.stats.navBlocked++;
          if (security.onNavBlock) security.onNavBlock(details.webContents, details.url, {
            source: 'community blocklists (URLhaus / Phishing Army / OpenPhish)', threat: 'Malicious site'
          });
          return callback({ cancel: true });
        }
      }

      callback({});

      if (isMainFrame && security.checkUrl && security.safeBrowsingKeyCheckPending !== true) {
        security.checkUrl(details.url).then((verdict) => {
          if (verdict && !details.webContents.isDestroyed()) {
            security.stats.navBlocked++;
            if (security.onNavBlock) security.onNavBlock(details.webContents, details.url, verdict);
          }
        }).catch(() => {});
      }
    });

    // DNT / GPC headers
    ses.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      const headers = details.requestHeaders;
      if (settings.all().privacy.dnt) headers['DNT'] = '1';
      headers['Sec-GPC'] = '1';
      callback({ requestHeaders: headers });
    });

    // Permission gate
    ses.setPermissionRequestHandler((wc, permission, callback) => {
      let origin = '';
      try { origin = new URL(wc.getURL()).origin; } catch (_) {}
      const overrides = settings.all().permissions[origin] || {};
      const decision = overrides[permission] || DEFAULT_PERMISSIONS[permission] || 'deny';
      callback(decision === 'allow');
    });

    // Spellcheck
    try { ses.setSpellCheckerLanguages(['en-US']); } catch (_) {}
  }

  const uaOverride = settings.all().advanced.userAgent;
  if (uaOverride) {
    mainSession.setUserAgent(uaOverride);
    privSession.setUserAgent(uaOverride);
  }

  // Downloads + malware scanning. BOTH partitions get the handler: attaching it
  // to the main session only meant anything downloaded from a private window
  // bypassed the hash scan and the quarantine entirely. Incognito is a privacy
  // feature, not a way to disable antivirus.
  security.attachDownloadHandler(mainSession);
  security.attachDownloadHandler(privSession);

  // Extension host session
  extensions.init(mainSession);

  return { mainSession, privSession };
}

module.exports = { setupPartitions };
