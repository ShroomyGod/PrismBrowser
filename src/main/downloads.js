// downloads.js — where files land, and what happens to them once they finish.
//
// Three jobs, deliberately kept out of security.js so the save-path policy is
// not entangled with threat detection:
//
//   1. SAVE PATH. Chromium picks its own default, and Prism declared a
//      general.askWhereToSave setting that nothing ever implemented, so
//      downloads quietly landed wherever the OS/browser felt like. This module
//      honours the folder setting, or prompts, and never silently overwrites an
//      existing file.
//   2. FILE ACTIONS. Open, run, reveal, and delete a download from disk. Delete
//      is destructive, so it is restricted to paths we actually recorded and
//      refuses to recurse into a directory.
//   3. SCANNING. Finished downloads are handed to Windows Defender's command
//      line scanner when it is present. This is local: the file is never
//      uploaded anywhere, which is the whole point of running it on a privacy
//      browser's machine rather than a cloud sandbox.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app, dialog, shell } = require('electron');
const settings = require('./settings');

const SCAN_TIMEOUT_MS = 60000;

// Defender ships in two places depending on Windows release. The stable
// program-folder copy is a shim on current builds; the platform versioned copy
// is what actually holds the engine. Probe both rather than assuming.
function defenderCandidates() {
  const out = [];
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pd = process.env['ProgramData'] || 'C:\\ProgramData';
  out.push(path.join(pf, 'Windows Defender', 'MpCmdRun.exe'));
  const platformRoot = path.join(pd, 'Microsoft', 'Windows Defender', 'Platform');
  try {
    const versions = fs.readdirSync(platformRoot)
      .filter((d) => /^\d+(\.\d+)*$/.test(d))
      // Newest first: Defender only keeps recent platform versions.
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const v of versions) out.push(path.join(platformRoot, v, 'MpCmdRun.exe'));
  } catch (_) { /* platform dir absent on older builds */ }
  return out;
}

function findDefender() {
  for (const candidate of defenderCandidates()) {
    try { if (fs.existsSync(candidate)) return candidate; } catch (_) { /* keep probing */ }
  }
  return null;
}

// Cached because it is probed once per download and Defender's files do not
// move while the app runs.
let _defenderPath;
let _defenderProbed = false;
function defenderPath() {
  if (!_defenderProbed) { _defenderPath = findDefender(); _defenderProbed = true; }
  return _defenderPath;
}

// Only state we need in the UI. probed/available is what the Settings toggle
// and the downloads page show, so a user can tell "no antivirus" from
// "antivirus present but nothing found".
function antivirusStatus() {
  const p = defenderPath();
  return {
    engine: p ? 'Windows Defender' : null,
    available: !!p,
    path: p
  };
}

// Split a filename into stem and extension so "report (1).pdf" is deduped as
// "report (2).pdf" rather than "report (1) (1).pdf".
function splitName(filename) {
  const ext = path.extname(filename);
  return { stem: ext ? filename.slice(0, -ext.length) : filename, ext };
}

// Refuse anything that could escape the destination directory or clobber a
// directory. Windows also rejects these characters in filenames.
function safeFileName(raw, fallback) {
  let name = String(raw || '').trim();
  // A URL can hand us a full path or a device path; keep only the last segment.
  name = name.split(/[\\/]/).pop() || '';
  name = name.replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/^\.+$/, '');
  name = name.replace(/[. ]+$/, '');       // Windows: no trailing dot or space
  if (!name || name === '.' || name === '..') return fallback;
  return name.slice(0, 180);
}

// Never overwrite: "invoice.pdf" -> "invoice (1).pdf" -> "invoice (2).pdf".
function uniquePath(dir, filename) {
  const safe = safeFileName(filename, 'download');
  const { stem, ext } = splitName(safe);
  let candidate = path.join(dir, safe);
  let n = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, stem + ' (' + n + ')' + ext);
    n++;
    if (n > 9999) {                        // pathological dir; stop looping
      candidate = path.join(dir, stem + '-' + Date.now() + ext);
      break;
    }
  }
  return candidate;
}

function downloadsDir() {
  const configured = (settings.all().general || {}).downloadDir || '';
  if (configured) {
    try { if (fs.existsSync(configured) && fs.statSync(configured).isDirectory()) return configured; }
    catch (_) { /* fall through to the OS default */ }
  }
  return app.getPath('downloads');
}

// Decide where ONE download goes, and tell Chromium.
//
// Electron has no per-session "download directory" preference (there is no
// session.setPreference), so the save path is set on the DownloadItem in
// will-download, and the "ask me" behaviour comes from
// item.setSaveDialogOptions() making Chromium show its own Save dialog. Both
// must happen before the first byte is written, so this is synchronous on
// purpose and is called straight out of the will-download handler.
function prepareTarget(item) {
  const general = settings.all().general || {};
  const filename = item.getFilename();
  if (general.askWhereToSave) {
    const dir = downloadsDir();
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* may not be writable */ }
    // Chromium shows the native dialog and uses whatever the user picks,
    // including their own choice of folder.
    item.setSaveDialogOptions({ title: 'Save file', defaultPath: path.join(dir, safeFileName(filename, 'download')) });
    return { mode: 'prompt', dir };
  }
  const dir = downloadsDir();
  fs.mkdirSync(dir, { recursive: true });
  // Never overwrite: a second "report.pdf" becomes "report (1).pdf" instead of
  // destroying the first download.
  const target = uniquePath(dir, filename);
  item.setSavePath(target);
  return { mode: 'folder', dir, path: target };
}

// Make sure the destination exists so a fresh profile or a removed drive does
// not silently fail the download. Returns the resolved folder.
function sync() {
  const dir = downloadsDir();
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* may not be writable */ }
  return dir;
}

async function chooseFolder(parentWindow) {
  const res = await dialog.showOpenDialog(parentWindow || undefined, {
    title: 'Choose the download folder',
    defaultPath: downloadsDir(),
    properties: ['openDirectory', 'createDirectory']
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
}

// ---- file actions ---------------------------------------------------------
// Every one of these takes a path that came out of our own download history.
// Anything else is refused, so a tampered history entry cannot be used to read,
// run, or delete something the user never downloaded.

function isRecordedDownload(filePath) {
  if (!filePath) return false;
  const entries = require('./stores').listDownloads();
  return entries.some((d) => d.path && path.resolve(d.path) === path.resolve(filePath));
}

function resolveRecorded(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  if (!isRecordedDownload(resolved)) return null;
  let st = null;
  try { st = fs.lstatSync(resolved); } catch (_) { return null; }
  if (!st.isFile()) return null;            // never delete a directory
  return resolved;
}

function open(filePath) {
  const p = resolveRecorded(filePath);
  if (!p) return { ok: false, error: 'That file is no longer available.' };
  return { ok: true, path: shell.openPath(p) === '' ? null : undefined };
}

// "Run" is open with the OS handler, which for an .exe means executing it.
// Kept as a distinct action so the UI can label an executable honestly and so
// it can be gated separately later.
function run(filePath) {
  const p = resolveRecorded(filePath);
  if (!p) return { ok: false, error: 'That file is no longer available.' };
  const err = shell.openPath(p);
  return err ? { ok: false, error: err } : { ok: true, path: p };
}

function reveal(filePath) {
  const p = resolveRecorded(filePath);
  if (!p) return { ok: false, error: 'That file is no longer available.' };
  shell.showItemInFolder(p);
  return { ok: true, path: p };
}

function removeFile(filePath) {
  const p = resolveRecorded(filePath);
  if (!p) return { ok: false, error: 'That file is no longer available.' };
  try {
    fs.unlinkSync(p);
    return { ok: true, path: p };
  } catch (err) {
    return { ok: false, error: 'Could not delete that file: ' + ((err && err.message) || err) };
  }
}

// ---- scanning -------------------------------------------------------------
// Runs Defender's custom scan over one finished file.
//
// Resolves to { ran, threat } because "scanned and clean" and "could not scan"
// must not look the same to the user: a null threat from an engine that never
// ran would let the UI claim a file was verified safe when nothing checked it.
//   ran: true  - Defender completed a scan (clean, or found something)
//   ran: false - no engine, or it refused/timed out; threat is always null
//
// MpCmdRun exit codes: 0 clean, 2 threat found. Anything else (Defender
// disabled, signature db unavailable, real-time protection off) is reported as
// "could not scan" rather than silently treated as clean.
function scanWithDefender(filePath) {
  return new Promise((resolve) => {
    const exe = defenderPath();
    if (!exe || !filePath) return resolve({ ran: false, threat: null });
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    let child;
    try {
      child = spawn(exe, ['-Scan', '-ScanType', '3', '-File', filePath, '-DisableRemediation'], {
        windowsHide: true
      });
    } catch (err) {
      console.error('[downloads] could not start Defender:', err.message);
      return finish({ ran: false, threat: null });
    }
    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) { /* already gone */ }
      console.warn('[downloads] Defender scan timed out for', path.basename(filePath));
      finish({ ran: false, threat: null });
    }, SCAN_TIMEOUT_MS);
    let output = '';
    // Defender prints its threat table on STDOUT, not stderr. Capturing only
    // stderr lost the detection name and reduced every finding to a generic
    // "detected by Defender", which tells the user nothing.
    child.stdout.on('data', (b) => { output += String(b); });
    child.stderr.on('data', (b) => { output += String(b); });
    child.on('error', (err) => {
      clearTimeout(timer);
      console.error('[downloads] Defender scan error:', err.message);
      finish({ ran: false, threat: null });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return finish({ ran: true, threat: null });
      if (code === 2) {
        // Pull the detection name out of Defender's output when we can; the
        // exact phrasing varies by platform version, so fall back to a
        // statement that is still accurate.
        const m = output.match(/Threat\s*:\s*(.+)/i) || output.match(/Detected\s+(.+)/i);
        const name = m ? m[1].split(/\r?\n/)[0].trim() : null;
        return finish({ ran: true, threat: 'Malware detected by Windows Defender' + (name ? ': ' + name : '') });
      }
      console.warn('[downloads] Defender could not scan ' + path.basename(filePath) + ' (exit ' + code + ')');
      finish({ ran: false, threat: null });
    });
  });
}

module.exports = {
  downloadsDir,
  prepareTarget,
  sync,
  chooseFolder,
  uniquePath,
  safeFileName,
  antivirusStatus,
  scanWithDefender,
  open,
  run,
  reveal,
  removeFile
};