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
    // Ad blocker
    adblock.attach(ses, (wc) => tabs.siteHostForWebContents(wc));

    // Malware shield for top-level navigations (sync part; async Safe
    // Browsing verdicts redirect to the block page once known).
    ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      if (details.resourceType !== 'mainFrame' || !settings.all().security.malwareEnabled) return callback({});
      const host = (() => { try { return new URL(details.url).hostname.toLowerCase(); } catch (_) { return ''; } })();
      if (security.exceptions.has(host)) return callback({});
      if (security.hosts.has(host)) {
        security.stats.navBlocked++;
        if (security.onNavBlock) security.onNavBlock(details.webContents, details.url, {
          source: 'community blocklists (URLhaus / Phishing Army / OpenPhish)', threat: 'Malicious site'
        });
        return callback({ cancel: true });
      }
      callback({});
      if (security.checkUrl && security.safeBrowsingKeyCheckPending !== true) {
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

  // Downloads + malware scanning (normal profile only)
  security.attachDownloadHandler(mainSession);

  // Extension host session
  extensions.init(mainSession);

  return { mainSession, privSession };
}

module.exports = { setupPartitions };
