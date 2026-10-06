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
const updateIdentity = require('./update-identity');

let autoUpdater = null;
let loaded = false;
let listeners = [];
let pendingInstaller = null; // absolute path to staged newer installer
let pendingVersion = null;
let remoteAsset = null;      // { version, file, url, sha512, identity } from GitHub Releases
let pendingUpdateIdentity = null; // { key, identity } for the installer being applied
let pendingBuildRefresh = false;
let downloading = false;

function currentVersion() {
  return app.getVersion();
}

function installedBuildTime() {
  try { return fs.statSync(app.getPath('exe')).mtimeMs; } catch (_) { return null; }
}

// Remember published build identities per feed so subsequent replacements of
// the same-version installer can be surfaced without changing the version tag.
function updateStatePath() {
  return path.join(app.getPath('userData'), 'update-state.json');
}
function readUpdateState() {
  try {
    const value = JSON.parse(fs.readFileSync(updateStatePath(), 'utf8'));
    return value && typeof value === 'object' && value.assets && typeof value.assets === 'object'
      ? value : { assets: {} };
  } catch (_) {
    return { assets: {} };
  }
}
function writeUpdateState(state) {
  try {
    const file = updateStatePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, file);
  } catch (error) {
    console.warn('[updater] could not persist build identity:', error.message);
  }
}
function candidateBuild(key, version, identity, times) {
  const result = updateIdentity.inspect(readUpdateState(), key, version, identity, currentVersion(), times);
  if (result.newlySeen) writeUpdateState(result.state);
  return result;
}
function acceptUpdateIdentity(identity) {
  if (!identity || !identity.key || !identity.identity) return;
  writeUpdateState(updateIdentity.accept(readUpdateState(), identity.key, pendingVersion, identity.identity));
  pendingBuildRefresh = false;
  pendingUpdateIdentity = null;
}

function refreshBuildIdentity(identity, version) {
  if (!identity || !identity.key || !identity.identity) return;
  const state = readUpdateState();
  const previous = state.assets[identity.key];
  if (!previous || previous.version !== version || previous.identity !== identity.identity) return;
  state.assets[identity.key] = Object.assign({}, previous, { acceptedIdentity: identity.identity });
  writeUpdateState(state);
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
// project root. The installed app scans these directories; newer versions are
// accepted normally, while same-version builds are identified by the installer
// hash from latest.yml (or its size and modification time as a fallback).
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

const cmpVersions = updateIdentity.compareVersions;

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
      let installerStat;
      try { installerStat = fs.statSync(installer); } catch (_) { continue; }
      const identity = {
        key: 'local:' + path.resolve(dir) + ':' + path.basename(installer),
        identity: parsed.sha512 || String(installerStat.size) + ':' + String(installerStat.mtimeMs)
      };
      const versionOrder = cmpVersions(parsed.version, cur);
      const sameVersionRefresh = versionOrder === 0;
      const build = versionOrder >= 0
        ? candidateBuild(identity.key, parsed.version, identity.identity, sameVersionRefresh ? {
          candidateTime: installerStat.mtimeMs,
          installedTime: installedBuildTime()
        } : undefined)
        : { available: false, buildRefresh: false };
      if (!build.available) continue;
      pendingInstaller = installer;
      pendingVersion = parsed.version;
      pendingUpdateIdentity = identity;
      pendingBuildRefresh = !!build.buildRefresh;
      push({ checking: false, available: true, downloaded: true, percent: 100, version: parsed.version, buildRefresh: pendingBuildRefresh });
      broadcast('prism:update-available', { version: parsed.version, local: true, buildRefresh: pendingBuildRefresh });
      broadcast('prism:update-downloaded', { version: parsed.version, local: true, buildRefresh: pendingBuildRefresh });
      return { available: true, status: status({ checking: false, available: true, downloaded: true, percent: 100, version: parsed.version, buildRefresh: pendingBuildRefresh }) };
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
             version: (info && info.version) || null, buildRefresh: pendingBuildRefresh });
      broadcast('prism:update-downloaded', { version: info && info.version, buildRefresh: pendingBuildRefresh });
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

// electron-builder strips the `build` section out of the package.json it packs
// into app.asar. So `require('../../package.json').build` is undefined in a
// shipped build no matter how correct the path is, and reading the feed config
// from package.json only ever works in a dev checkout. That is why the feed
// read as unconfigured even with the path fixed.
//
// These constants are the shipped source of truth and must match build.publish
// in package.json, which is what electron-builder publishes to. The dev-only
// check below catches drift at development time instead of letting updates
// quietly target the wrong repository once shipped.
const PUBLISH = { owner: 'shroomygod', repo: 'PrismBrowser' };

try {
  if (!app.isPackaged) {
    const pkg = require('../../package.json');
    const declared = (pkg.build && pkg.build.publish) || {};
    if (declared.owner && declared.repo &&
        (declared.owner !== PUBLISH.owner || declared.repo !== PUBLISH.repo)) {
      console.warn('[updater] build.publish is ' + declared.owner + '/' + declared.repo +
        ' but updater.js ships ' + PUBLISH.owner + '/' + PUBLISH.repo +
        ' - updates will target the wrong repository.');
    }
  }
} catch (_) { /* dev-only drift check; never fatal */ }
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
  if (!res.ok) {
    if (res.status === 404) {
      // 404 covers two unrelated situations that a bare status cannot tell
      // apart: a public repo with no release published yet, and a PRIVATE repo,
      // whose releases GitHub hides from unauthenticated callers. This request
      // sends no token, and never will -- a token baked into the app would ship
      // to every user who installs it.
      throw new Error('GitHub returned HTTP 404. Either no release has been published yet, or the repo is private - GitHub hides releases from unauthenticated requests, and this updater sends no token.');
    }
    throw new Error('GitHub returned HTTP ' + res.status);
  }
  const data = await res.json();
  const assets = Array.isArray(data.assets) ? data.assets : [];

  // electron-builder uploads latest.yml next to the installer, and it carries
  // the authoritative version and hash. Prefer it over the tag name; the hash
  // also distinguishes republished same-version builds.
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
    sha512: parsed ? parsed.sha512 : null,
    // GitHub's asset digest is content-addressed. Fall back to its publication
    // time only when neither the manifest nor API provides a content hash.
    identity: (parsed && parsed.sha512) || (asset && asset.digest) ||
      (asset && asset.updated_at ? asset.updated_at : null),
    identityKey: 'github:' + file,
    publishedAt: asset && asset.updated_at ? asset.updated_at : null
  };
}

function check({ silent } = {}) {
  // Local unsigned feed first: works with no network and no server.
  const local = checkLocalFeed();
  if (local && local.available) return Promise.resolve(local.status);
  if (pendingInstaller && pendingVersion) {
    return Promise.resolve(status({ checking: false, available: true, downloaded: true, version: pendingVersion, buildRefresh: pendingBuildRefresh }));
  }
  if (!REPO_CONFIGURED) {
    // Report what was actually read. A blank owner here means package.json was
    // not found at all, which is a different bug from an unconfigured repo --
    // without this the two are indistinguishable from the UI.
    return Promise.resolve(status({ checking: false, error:
      'No update feed configured (read owner=' + JSON.stringify(PUBLISH.owner || null) +
      ', repo=' + JSON.stringify(PUBLISH.repo || null) +
      '). Set build.publish.owner and .repo in package.json.' }));
  }
  push({ checking: true, error: null });
  return remoteRelease()
    .then((rel) => {
      const installedVersion = currentVersion();
      if (!rel || !rel.version) return status({ checking: false, available: false });
      const versionOrder = cmpVersions(rel.version, installedVersion);
      const buildRefresh = versionOrder === 0;
      const identity = { key: rel.identityKey, identity: rel.identity };
      const build = versionOrder >= 0 && identity.identity
        ? candidateBuild(identity.key, rel.version, rel.identity, buildRefresh ? {
          candidateTime: rel.publishedAt,
          installedTime: installedBuildTime()
        } : undefined)
        : { available: versionOrder > 0, buildRefresh: false };
      if (!build.available) return status({ checking: false, available: false });
      pendingVersion = rel.version;
      remoteAsset = rel;
      pendingUpdateIdentity = identity;
      pendingBuildRefresh = !!build.buildRefresh;
      push({ checking: false, available: true, downloaded: false, version: rel.version, buildRefresh: pendingBuildRefresh });
      broadcast('prism:update-available', { version: rel.version, buildRefresh: pendingBuildRefresh });
      return status({ checking: false, available: true, version: rel.version, buildRefresh: pendingBuildRefresh });
    })
    .catch((e) => status({ checking: false, error: e.message }));
}

function runInstaller(exe) {
  try {
    // NSIS recognizes electron-builder's /S and --updated flags. The latter
    // preserves the existing install path and lets the assisted installer
    // restart the same app after replacing it. Never use shell quoting here:
    // the installer path is a single argv item, even when it contains spaces.
    const installerPath = path.resolve(exe);
    // --force-run is required with the assisted NSIS installer: it closes the
    // final page silently and otherwise would leave Prism shut down.
    spawn(installerPath, ['/S', '--updated', '--force-run'], { shell: false, detached: true, stdio: 'ignore' }).unref();
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
    push({ checking: false, available: true, downloaded: true, percent: 100, version: pendingVersion, buildRefresh: pendingBuildRefresh });
    broadcast('prism:update-downloaded', { version: pendingVersion, buildRefresh: pendingBuildRefresh });
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
  if (pendingInstaller && fs.existsSync(pendingInstaller)) {
    const started = runInstaller(pendingInstaller);
    if (started) {
      if (pendingBuildRefresh) acceptUpdateIdentity(pendingUpdateIdentity);
      else refreshBuildIdentity(pendingUpdateIdentity, pendingVersion);
    }
    return started;
  }
  // Otherwise fetch and verify it first, then run. Always an explicit user
  // choice - a silent self-relaunch loop on a broken build would be worse.
  if (!remoteAsset) {
    push({ error: 'No update is available to install.' });
    return false;
  }
  downloadRelease().then((ok) => {
    if (!ok || !pendingInstaller || !fs.existsSync(pendingInstaller)) return;
    const started = runInstaller(pendingInstaller);
    if (started) {
      if (pendingBuildRefresh) acceptUpdateIdentity(pendingUpdateIdentity);
      else refreshBuildIdentity(pendingUpdateIdentity, pendingVersion);
    }
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
