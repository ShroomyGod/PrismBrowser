// securestore.js — all Prism user data is encrypted at rest.
//
// A random 256-bit master key is generated on first run. It is wrapped with
// Electron's safeStorage (OS keyring on Windows/macOS, libsecret on Linux)
// and stored in keyring.bin. Every collection file is AES-256-GCM encrypted
// with that master key. If the OS keyring is unavailable we degrade to a
// locally stored key and report the reduced protection level.
//
// IMPORTANT: safeStorage throws before `app.whenReady()`. The vault is
// therefore split into two phases:
//   init()       — pre-ready. Creates the directory only. No key is derived,
//                  because a key derived pre-ready would be a throwaway
//                  plaintext key that can never decrypt anything written by
//                  the real (keyring-backed) session.
//   initCrypto() — post-ready. Loads or creates the wrapped master key.
//
// Only non-sensitive bootstrap values (DNS provider, hardware acceleration)
// are read pre-ready, via the small plaintext sidecar below, because
// Chromium's DoH switches must be applied before the app is ready.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');

const GCM_IV = 12;
const KEY_BYTES = 32;

class SecureStore {
  constructor() {
    this.dir = null;
    this.key = null;
    this.master = null;
    this.keyring = 'uninitialized';
    this.cryptoReady = false;
    this.locked = false;
    this.buffers = new Map(); // name -> data pending write
    this.__t = new Map();     // name -> debounce timer
  }

  // Phase 1: safe to call before app ready.
  init() {
    this.dir = path.join(app.getPath('userData'), 'vault');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  // Phase 2: must be called after app.whenReady().
  initCrypto() {
    if (this.cryptoReady) return;
    this.locked = false;
    this._loadMasterKey();
    this.cryptoReady = true;
  }

  // Locking drops the master key and cached plaintext from memory. Because the
  // key material itself lives in the OS keyring, the next real access
  // transparently unwraps it again instead of leaving the app unable to read
  // its own stores.
  _ensureCrypto() {
    if (!this.cryptoReady && this.locked) this.initCrypto();
  }

  _isHexKey(buf) {
    if (!buf || buf.length !== KEY_BYTES * 2) return false;
    return /^[0-9a-f]{64}$/i.test(buf.toString('utf8'));
  }

  _loadMasterKey() {
    const keyFile = path.join(this.dir, 'keyring.bin');
    const available = safeStorage.isEncryptionAvailable();

    if (fs.existsSync(keyFile)) {
      const raw = fs.readFileSync(keyFile);
      if (available) {
        try {
          // Normal case: DPAPI/libsecret-wrapped key.
          const hex = safeStorage.decryptString(raw);
          if (this._isHexKey(Buffer.from(hex, 'utf8'))) {
            this.key = hex;
            this.keyring = 'os-keyring';
            this.master = Buffer.from(hex, 'hex');
            return;
          }
        } catch (_) { /* fall through to migration below */ }
      }
      if (this._isHexKey(raw)) {
        // Migration: an older build wrote a plaintext hex key because it ran
        // before app ready. Adopt that exact key so existing collections stay
        // readable, then re-wrap it with the OS keyring.
        this.key = raw.toString('utf8');
        this.master = Buffer.from(this.key, 'hex');
        this.keyring = available ? 'os-keyring-migrated' : 'fallback-local';
        if (available) {
          try { fs.writeFileSync(keyFile, safeStorage.encryptString(this.key)); } catch (_) {}
        }
        return;
      }
      // Unreadable key material. Do NOT silently mint a new key: that would
      // orphan every encrypted collection. Surface it and keep the file.
      this.keyring = 'unreadable';
      console.error('[securestore] keyring.bin could not be unwrapped; ' +
        'refusing to generate a new key because existing data would be lost.');
      return;
    }

    // First run.
    this.key = crypto.randomBytes(KEY_BYTES).toString('hex');
    this.master = Buffer.from(this.key, 'hex');
    this.keyring = available ? 'os-keyring' : 'fallback-local';
    try {
      fs.writeFileSync(keyFile, available ? safeStorage.encryptString(this.key) : this.key);
    } catch (e) {
      console.error('[securestore] failed to persist keyring.bin', e.message);
    }
  }

  _encrypt(plainBuf) {
    const iv = crypto.randomBytes(GCM_IV);
    const c = crypto.createCipheriv('aes-256-gcm', this.master, iv);
    const enc = Buffer.concat([c.update(plainBuf), c.final()]);
    const tag = c.getAuthTag();
    return Buffer.concat([iv, tag, enc]);
  }

  _decrypt(blob) {
    const iv = blob.subarray(0, GCM_IV);
    const tag = blob.subarray(GCM_IV, GCM_IV + 16);
    const enc = blob.subarray(GCM_IV + 16);
    const d = crypto.createDecipheriv('aes-256-gcm', this.master, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]);
  }

  // --- plaintext bootstrap sidecar (non-sensitive pre-ready values only) ---

  bootstrapPath() { return path.join(this.dir, 'bootstrap.json'); }

  loadBootstrap() {
    try {
      const f = this.bootstrapPath();
      if (!fs.existsSync(f)) return {};
      return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch (_) { return {}; }
  }

  saveBootstrap(obj) {
    try {
      fs.writeFileSync(this.bootstrapPath(), JSON.stringify(obj, null, 2));
    } catch (_) { /* best effort */ }
  }

  // Load a collection; returns fallback (deep-cloned) when missing/corrupt.
  load(name, fallback) {
    this._ensureCrypto();
    if (!this.cryptoReady) {
      console.warn('[securestore] load(' + name + ') before initCrypto; using fallback');
      return fallback;
    }
    const file = path.join(this.dir, name + '.sbox');
    try {
      if (!fs.existsSync(file)) return fallback;
      const json = this._decrypt(fs.readFileSync(file)).toString('utf8');
      return JSON.parse(json);
    } catch (e) {
      console.error('[securestore] failed to read', name, e.message);
      // Move the unreadable file aside instead of deleting user data blindly.
      try { fs.renameSync(file, file + '.corrupt-' + Date.now()); } catch (_) {}
      return fallback;
    }
  }

  // Save a collection. Debounced: write at most once per 400ms unless force.
  save(name, data, force = false) {
    this.buffers.set(name, data);
    this._ensureCrypto();
    if (!this.cryptoReady) {
      console.warn('[securestore] save(' + name + ') before initCrypto; buffered only');
      return;
    }
    const existing = this.__t.get(name);
    if (existing && !force) return;
    const write = () => {
      this.__t.delete(name);
      const buf = this.buffers.get(name);
      if (buf === undefined) return;
      try {
        const json = Buffer.from(JSON.stringify(buf), 'utf8');
        const file = path.join(this.dir, name + '.sbox');
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, this._encrypt(json));
        fs.renameSync(tmp, file);
      } catch (e) {
        console.error('[securestore] failed to write', name, e.message);
      }
    };
    if (force) { write(); return; }
    this.__t.set(name, setTimeout(write, 400));
  }

  flushAll() {
    for (const [name] of this.buffers) this.save(name, this.buffers.get(name), true);
  }

  // "Lock the vault" from the ⋮ menu. Everything pending is written first, then
  // the in-memory master key and any cached plaintext are dropped: the next
  // load() re-reads from the OS keyring. Nothing is persisted as plaintext.
  lock() {
    this.flushAll();
    this.buffers.clear();
    this.key = null;
    this.master = null;
    this.cryptoReady = false;
    this.locked = true;
    return this.status();
  }

  status() {
    return {
      encrypted: this.cryptoReady && !!this.master,
      locked: !!this.locked && !this.cryptoReady,
      keyring: this.keyring,
      algorithm: 'AES-256-GCM',
      keyWrapping: this.keyring === 'os-keyring' || this.keyring === 'os-keyring-migrated'
        ? 'OS keyring via Electron safeStorage'
        : (this.keyring === 'fallback-local'
          ? 'local fallback (OS keyring unavailable)'
          : 'unavailable'),
      dir: this.dir
    };
  }
}

module.exports = new SecureStore();
