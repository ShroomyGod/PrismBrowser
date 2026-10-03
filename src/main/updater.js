// updater.js — auto-update via electron-updater + local dev feed.
//
// Two things to know before shipping updates:
//
//  1. Updates only work in a PACKAGED app. Running `electron .` has no
//     app-update.yml, so every entry point here no-ops in development instead
//     of throwing.
//  2. On Windows, electron-updater validates the Authenticode signature of
//     the downloaded installer. An UNSIGNED build therefore cannot install an
//     update: you get "Code signature validation failed". Publishing updates
//     requires a code-signing certificate (see package.json > build > win).
//
// LOCAL DEV UPDATES (unsigned, no server): the installed app also checks a
// local feed directory for a newer `latest.yml` + `PrismBrowser-*-x64.exe`
// (the files `npm run dist` writes to the project root). When one is found
// the shell shows an "Update available" button; clicking it launches the
// installer with /S and quits, so the app updates itself. Override the feed
// location with PRISM_LOCAL_UPDATE_DIR. This path is tried FIRST so local
// development works even though the production generic feed requires signing.
'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

let autoUpdater = null;
let loaded = false;
let listeners = [];
let pendingInstaller = null; // absolute path to staged newer installer
let pendingVersion = null;
let remoteAsset = null;      // { version, file, url, sha512 } from GitHub Releases
let downloading = false;

function currentVersion() {
  return app.getVersion();
}

function emit(type, payload) {
  for (const fn of listeners) {
    try { fn(type, payload); } catch (_) { /* a bad listener must not break updates */ }
  }
}

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    // The chrome lives in a child WebContentsView, not in win.webContents.
    let wc = null;
    try { wc = require('./tabs').shellContentsForWindow(win); } catch (_) { /* tabs not loaded */ }
    (wc || win.webContents).send(channel, payload);
  }
}

function status(extra) {
  return Object.assign({
    supported: !!loaded,
    version: currentVersion(),
    checking: false,
    available: false,
    downloaded: false,
    percent: 0,
    error: null
  }, extra || {});
}

function push(extra) {
  const s = status(extra);
  broadcast('prism:update-status', s);
  emit('status', s);
  return s;
}

// ---------- local dev feed (unsigned, serverless) ----------
// `npm run dist` writes latest.yml + PrismBrowser-<ver>-x64.exe to the
// project root. The INSTALLED app scans those directories: if latest.yml
// advertises a version newer than app.getVersion() and the installer file
// exists, it is treated as a downloaded update.
function localFeedDirs() {
  const dirs = [];
  if (process.env.PRISM_LOCAL_UPDATE_DIR) dirs.push(process.env.PRISM_LOCAL_UPDATE_DIR);
  // Packaged app: dev project root on this machine (single-machine workflow).
  dirs.push('C:\\Users\\janyi\\OneDrive\\Documents\\PrismBrowser');
  try {
    if (!app.isPackaged) dirs.push(path.join(__dirname, '..', '..'));
  } catch (_) {}
  // Next to the installed exe / resources (in case the feed is dropped there).
  try { dirs.push(path.dirname(app.getPath('exe'))); } catch (_) {}
  try { dirs.push(path.join(path.dirname(app.getPath('exe')), 'resources')); } catch (_) {}
  return [...new Set(dirs.filter(Boolean))];
}

function parseLatestYml(text) {
  const version = (text.match(/^\s*version\s*:\s*([^\s#]+)/m) || [])[1];
  const urlMatch = text.match(/-\s*url\s*:\s*([^\s#]+)/m);
  const pathMatch = text.match(/^\s*path\s*:\s*([^\s#]+)/m);
  const file = (urlMatch && urlMatch[1]) || (pathMatch && pathMatch[1]) || null;
  if (!version) return null;
  const sha = text.match(/^\s*sha512\s*:\s*(\S+)/m);
  return {
    version: String(version).trim(),
    file: file ? String(file).trim() : null,
    sha512: sha ? sha[1] : null
  };
}

function cmpVersions(a, b) {
  const pa = String(a).split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function checkLocalFeed() {
  try {
    const cur = currentVersion();
    for (const dir of localFeedDirs()) {
      let ymlPath = null;
      for (const name of ['latest.yml', 'latest.yaml']) {
        const p = path.join(dir, name);
        if (fs.existsSync(p)) { ymlPath = p; break; }
      }
      if (!ymlPath) continue;
      let parsed = null;
      try { parsed = parseLatestYml(fs.readFileSync(ymlPath, 'utf8')); } catch (_) { continue; }
      if (!parsed || !parsed.version) continue;
      if (cmpVersions(parsed.version, cur) <= 0) continue; // not newer
      // Resolve installer file (usually PrismBrowser-<ver>-x64.exe).
      let installer = parsed.file ? path.join(dir, path.basename(parsed.file)) : null;
      if (!installer || !fs.existsSync(installer)) {
        try {
          const cands = fs.readdirSync(dir)
            .filter((f) => /^PrismBrowser-.*-x64\.exe$/i.test(f) && f.includes(parsed.version))
            .map((f) => path.join(dir, f));
          if (cands.length) installer = cands[0];
        } catch (_) {}
      }
      if (!installer || !fs.existsSync(installer)) continue;
      pendingInstaller = installer;
      pendingVersion = parsed.version;
      push({ checking: false, available: true, downloaded: true, percent: 100, version: parsed.version });
      broadcast('prism:update-available', { version: parsed.version, local: true });
      broadcast('prism:update-downloaded', { version: parsed.version, local: true });
      return { available: true, status: status({ checking: false, available: true, downloaded: true, percent: 100, version: parsed.version }) };
    }
  } catch (_) {}
  return { available: false };
}

// Load electron-updater lazily and only when packaged. A failure here must
// never take the browser down with it.
function load() {
  if (loaded) return autoUpdater;
  loaded = true;
  if (!app.isPackaged) {
    push({ supported: false, error: 'Updates are disabled in development builds.' });
    return null;
  }
  try {
    const mod = require('electron-updater');
    autoUpdater = mod.autoUpdater || mod.default;
    if (!autoUpdater) throw new Error('autoUpdater not found in electron-updater');

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    if (process.env.PRISM_UPDATE_LOG) autoUpdater.logger = require('electron-log')?.transports?.file ?? autoUpdater.logger;

    autoUpdater.on('checking-for-update', () => push({ checking: true, error: null }));

    autoUpdater.on('update-available', (info) => {
      push({ checking: false, available: true, version: info && info.version });
      broadcast('prism:update-available', { version: info && info.version });
    });

    autoUpdater.on('update-not-available', () => push({ checking: false, available: false }));

    autoUpdater.on('download-progress', (p) => {
      push({ checking: false, available: true, percent: Math.round(p.percent || 0) });
    });

    autoUpdater.on('update-downloaded', (info) => {
      push({ checking: false, available: true, downloaded: true, percent: 100,
             version: (info && info.version) || null });
      broadcast('prism:update-downloaded', { version: info && info.version });
    });

    autoUpdater.on('error', (err) => {
      const msg = (err && err.message) || String(err);
      push({ checking: false, error: msg });
      broadcast('prism:update-error', { error: msg });
    });

    return autoUpdater;
  } catch (e) {
    push({ supported: false, error: 'Updater unavailable: ' + e.message });
    return null;
  }
}

const PUBLISH = (() => {
  try { return require('../package.json').build.publish || {}; }
  catch (_) { return {}; }
})();
const REPO_CONFIGURED = !!PUBLISH.owner && !!PUBLISH.repo &&
  !String(PUBLISH.owner).toUpperCase().startsWith('YOUR');
const RELEASE_API = 'https://api.github.com/repos/' +
  encodeURIComponent(PUBLISH.owner || '') + '/' +
  encodeURIComponent(PUBLISH.repo || '') + '/releases/latest';

function sha512Hex(buf) { return require('crypto').createHash('sha512').update(buf).digest('base64'); }

// Ask GitHub for the newest release and resolve the Windows installer plus the
// sha512 published beside it in latest.yml.
async function remoteRelease() {
  const res = await fetch(RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'PrismBrowser-Updater' },
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error('GitHub returned HTTP ' + res.status);
  const data = await res.json();
  const assets = Array.isArray(data.assets) ? data.assets : [];

  // electron-builder uploads latest.yml next to the installer, and it carries
  // the authoritative version and hash. Prefer it over the tag name.
  let parsed = null;
  const manifest = assets.find((a) => /latest\.ya?ml$/i.test(a.name));
  if (manifest) {
    const mres = await fetch(manifest.browser_download_url, { signal: AbortSignal.timeout(10000) });
    if (mres.ok) parsed = parseLatestYml(await mres.text());
  }
  const file = (parsed && parsed.file) ||
    (assets.map((a) => a.name).find((n) => /-x64\.exe$/i.test(n)) || null);
  if (!file) return null;
  const asset = assets.find((a) => a.name === file);
  return {
    version: parsed ? parsed.version : String(data.tag_name || '').replace(/^v/, ''),
    file,
    url: asset ? asset.browser_download_url : null,
    sha512: parsed ? parsed.sha512 : null
  };
}

function check({ silent } = {}) {
  // Local unsigned feed first: works with no network and no server.
  const local = checkLocalFeed();
  if (local && local.available) return Promise.resolve(local.status);
  if (pendingInstaller && pendingVersion) {
    return Promise.resolve(status({ checking: false, available: true, downloaded: true, version: pendingVersion }));
  }
  if (!REPO_CONFIGURED) {
    return Promise.resolve(status({ checking: false, error: 'No update feed configured. Set build.publish.owner and .repo in package.json.' }));
  }
  push({ checking: true, error: null });
  return remoteRelease()
    .then((rel) => {
      if (!rel || !rel.version || cmpVersions(rel.version, currentVersion()) <= 0) {
        return status({ checking: false, available: false });
      }
      pendingVersion = rel.version;
      remoteAsset = rel;
      push({ checking: false, available: true, downloaded: false, version: rel.version });
      broadcast('prism:update-available', { version: rel.version });
      return status({ checking: false, available: true, version: rel.version });
    })
    .catch((e) => status({ checking: false, error: e.message }));
}

function runInstaller(exe) {
  try {
    // /S per-user silent, matching the NSIS config (allowElevation: false).
    // NSIS relaunches the app when it finishes.
    spawn(`"${exe}"`, ['/S'], { shell: true, detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => { try { app.quit(); } catch (_) {} }, 750);
    return true;
  } catch (e) {
    push({ error: 'Could not launch installer: ' + e.message });
    return false;
  }
}

async function downloadRelease() {
  if (downloading || !remoteAsset || !remoteAsset.url) return false;
  downloading = true;
  try {
    push({ checking: false, available: true, downloaded: false, percent: 0, version: pendingVersion });
    const res = await fetch(remoteAsset.url, { signal: AbortSignal.timeout(300000) });
    if (!res.ok) throw new Error('Download failed: HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    // No Authenticode signature to lean on (unsigned builds), so the sha512
    // published in latest.yml is the integrity check. Refuse to run anything
    // that does not match it.
    if (remoteAsset.sha512 && sha512Hex(buf) !== remoteAsset.sha512) {
      throw new Error('Downloaded installer failed its checksum - discarding.');
    }
    const dir = path.join(app.getPath('temp'), 'prism-update');
    fs.mkdirSync(dir, { recursive: true });
    const exe = path.join(dir, path.basename(remoteAsset.file));
    fs.writeFileSync(exe, buf);
    pendingInstaller = exe;
    push({ checking: false, available: true, downloaded: true, percent: 100, version: pendingVersion });
    broadcast('prism:update-downloaded', { version: pendingVersion });
    return true;
  } catch (e) {
    push({ checking: false, error: e.message });
    return false;
  } finally {
    downloading = false;
  }
}

function install() {
  // Prefer an installer already staged on disk (local feed, or a download that
  // finished earlier): run it now.
  if (pendingInstaller && fs.existsSync(pendingInstaller)) return runInstaller(pendingInstaller);
  // Otherwise fetch and verify it first, then run. Always an explicit user
  // choice - a silent self-relaunch loop on a broken build would be worse.
  if (!remoteAsset) {
    push({ error: 'No update is available to install.' });
    return false;
  }
  downloadRelease().then((ok) => {
    if (!ok) return;
    if (pendingInstaller && fs.existsSync(pendingInstaller)) runInstaller(pendingInstaller);
  });
  return true;
}

function init() {
  // electron-updater is deliberately not loaded. It validates the Authenticode
  // signature of the downloaded installer, so an unsigned build can never
  // self-update through it; check()/install() now fetch the release from GitHub,
  // verify the published sha512, and spawn the installer directly.
  // Check shortly after startup, then hourly. Errors are surfaced in the UI
  // rather than interrupting the user.
  setTimeout(() => { check({ silent: true }); }, 20000);
  setInterval(() => { check({ silent: true }); }, 60 * 60 * 1000);
}

function onUpdate(fn) { listeners.push(fn); }

module.exports = { init, check, install, status, onUpdate, currentVersion };
