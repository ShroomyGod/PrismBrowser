// extensions.js — extension support for Prism.
//
// Electron exposes Chromium's extension system per-session. Prism adds:
//  - "Load unpacked" from a local directory
//  - Install from the Chrome Web Store (CRX3 endpoint) by URL or ID
//  - Install from Edge Add-ons (CRX endpoint) by URL or ID
// CRX2 and CRX3 containers are parsed by hand (skip header, unzip payload).
// Note: Electron supports a large MV2/MV3 subset; toolbar popups are the
// main gap. The extensions page in the app states this plainly.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('electron').net;
const { app, dialog, BrowserWindow } = require('electron');
const { extract } = require('./unzip');
const settings = require('./settings');

const WEBSTORE_CRX = 'https://clients2.google.com/service/update2/crx';
const EDGE_CRX = 'https://edge.microsoft.com/extensionwebstorebase/v1/crx';

function extIdFromInput(input) {
  const s = String(input || '').trim();
  if (/^[a-p]{32}$/i.test(s)) return s.toLowerCase();
  const m = s.match(/(?:detail\/[^/]+\/|\/detail\/|id=|%3D|bhlom\?id=)([a-p]{32})/i);
  if (m) return m[1].toLowerCase();
  const m2 = s.match(/([a-p]{32})/i);
  return m2 ? m2[1].toLowerCase() : null;
}

// Returns Buffer of the ZIP payload inside a CRX2/CRX3 blob, or null.
function crxToZip(buf) {
  if (buf.length < 16) return null;
  if (buf.readUInt32BE(0) !== 0x43723234) return null; // 'Cr24'
  const version = buf.readUInt32LE(4);
  if (version === 3) {
    const headerLen = buf.readUInt32LE(8);
    const zipStart = 12 + headerLen;
    if (zipStart >= buf.length) return null;
    return buf.subarray(zipStart);
  }
  if (version === 2) {
    const pubLen = buf.readUInt32LE(8);
    const sigLen = buf.readUInt32LE(12);
    const zipStart = 16 + pubLen + sigLen;
    if (zipStart >= buf.length) return null;
    return buf.subarray(zipStart);
  }
  return null;
}

function extDir() {
  return path.join(app.getPath('userData'), 'extensions', 'installed');
}

function manifestIcons(manifest, base) {
  const icons = (manifest && (manifest.icons || (manifest.action && manifest.action.default_icon) ||
    (manifest.browser_action && manifest.browser_action.default_icon))) || {};
  const sizes = Object.keys(icons).map(Number).sort((a, b) => b - a);
  if (!sizes.length) return null;
  return path.join(base, icons[sizes[0]]);
}

class Extensions {
  constructor() {
    this.session = null;
  }

  init(session) {
    this.session = session;
    fs.mkdirSync(extDir(), { recursive: true });
    // Re-load persisted extensions (Electron does not persist custom-session extensions).
    const registry = settings.all().extensions.registry || [];
    for (const entry of registry) {
      try {
        if (fs.existsSync(entry.path)) this.session.loadExtension(entry.path, { allowFileAccess: true });
        else this._unregister(entry.id);
      } catch (e) {
        console.error('[extensions] failed to load', entry.name, e.message);
      }
    }
  }

  _emit() {
    for (const win of BrowserWindow.getAllWindows()) {
      // The chrome lives in a child WebContentsView, not in win.webContents.
      let wc = null;
      try { wc = require('./tabs').shellContentsForWindow(win); } catch (_) { /* tabs not loaded */ }
      (wc || win.webContents).send('prism:extensions-changed', this.list());
    }
  }

  list() {
    if (!this.session) return [];
    const loaded = new Map();
    try {
      for (const ext of this.session.getAllExtensions()) loaded.set(ext.id, ext);
    } catch (_) {}
    const registry = settings.all().extensions.registry || [];
    const out = [];
    for (const entry of registry) {
      const live = loaded.get(entry.id);
      out.push({
        id: entry.id, name: entry.name, version: entry.version,
        source: entry.source, path: entry.path, icon: entry.icon || null,
        installedAt: entry.installedAt, active: !!live
      });
    }
    return out;
  }

  _unregister(id) {
    const reg = settings.all().extensions;
    reg.registry = (reg.registry || []).filter((e) => e.id !== id);
    settings.set({ extensions: reg });
  }

  _register(entry) {
    const reg = settings.all().extensions;
    reg.registry = (reg.registry || []).filter((e) => e.id !== entry.id);
    reg.registry.push(entry);
    settings.set({ extensions: reg });
  }

  async loadUnpacked(dir) {
    if (!this.session) throw new Error('Session not ready');
    const ext = await this.session.loadExtension(dir, { allowFileAccess: true });
    this._register({
      id: ext.id, name: ext.name, version: ext.version,
      source: 'unpacked', path: dir,
      icon: manifestIcons(ext.manifest, dir),
      installedAt: Date.now()
    });
    this._emit();
    return ext.id;
  }

  async pickAndLoadUnpacked(win) {
    const res = await dialog.showOpenDialog(win || BrowserWindow.getFocusedWindow(), {
      title: 'Load unpacked extension',
      properties: ['openDirectory'],
      buttonLabel: 'Load extension'
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    const id = await this.loadUnpacked(res.filePaths[0]);
    return { id };
  }

  async installFromStore(source, input) {
    if (!this.session) throw new Error('Session not ready');
    const id = extIdFromInput(input);
    if (!id) throw new Error('Could not read an extension ID from that input. Paste the store URL or the 32-letter ID.');

    const prodVersion = process.versions.chrome || '126.0.0.0';
    const url = source === 'edge'
      ? `${EDGE_CRX}?response=redirect&prod=chromiumcrx&prodchannel=beta&x=${encodeURIComponent('id=' + id + '&uc')}`
      : `${WEBSTORE_CRX}?response=redirect&acceptformat=crx2,crx3&prodversion=${prodVersion}&prodchannel=stable&os=win&arch=x64&x=${encodeURIComponent('id=' + id + '&uc')}`;

    const res = await net.fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error('Store returned HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    const zip = crxToZip(buf);
    if (!zip) throw new Error('The downloaded file is not a valid CRX package.');

    const target = path.join(extDir(), id + '-' + crypto.randomUUID().slice(0, 8));
    fs.mkdirSync(target, { recursive: true });
    const zipPath = path.join(target, 'ext.zip');
    fs.writeFileSync(zipPath, zip);
    extract(zipPath, target);
    fs.unlinkSync(zipPath);
    if (!fs.existsSync(path.join(target, 'manifest.json'))) {
      fs.rmSync(target, { recursive: true, force: true });
      throw new Error('Package did not contain a manifest.json.');
    }

    const ext = await this.session.loadExtension(target, { allowFileAccess: true });
    this._register({
      id: ext.id, name: ext.name, version: ext.version,
      source: source === 'edge' ? 'edge-addons' : 'chrome-webstore',
      path: target, icon: manifestIcons(ext.manifest, target),
      installedAt: Date.now()
    });
    this._emit();
    return ext.id;
  }

  async remove(id) {
    try { this.session.removeExtension(id); } catch (_) {}
    const entry = (settings.all().extensions.registry || []).find((e) => e.id === id);
    this._unregister(id);
    if (entry && entry.source !== 'unpacked' && entry.path && entry.path.startsWith(extDir())) {
      try { fs.rmSync(entry.path, { recursive: true, force: true }); } catch (_) {}
    }
    this._emit();
  }

  async reload(id) {
    const entry = (settings.all().extensions.registry || []).find((e) => e.id === id);
    if (!entry) return;
    try { this.session.removeExtension(id); } catch (_) {}
    const ext = await this.session.loadExtension(entry.path, { allowFileAccess: true });
    entry.version = ext.version;
    this._register(entry);
    this._emit();
  }
}

module.exports = new Extensions();
