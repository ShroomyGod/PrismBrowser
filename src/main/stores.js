// stores.js — history, bookmarks, downloads, passwords. Encrypted at rest
// through securestore.
const crypto = require('crypto');
const securestore = require('./securestore');

const HISTORY_CAP = 10000;
const DOWNLOADS_CAP = 500;

class Collection {
  constructor(name, fallback) {
    this.name = name;
    this.data = structuredClone(fallback);
    this.loaded = false;
  }

  ensure() {
    if (!this.loaded) {
      this.data = securestore.load(this.name, this.data);
      this.loaded = true;
    }
    return this.data;
  }

  persist() {
    securestore.save(this.name, this.data);
  }
}

class Stores {
  constructor() {
    this.history = new Collection('history', { entries: [] });
    this.bookmarks = new Collection('bookmarks', { entries: [] }); // {id,url,title,favicon,bar,added}
    this.downloads = new Collection('downloads', { entries: [] }); // {id,url,filename,path,state,threat,sha256,ts,size}
    this.passwords = new Collection('passwords', { entries: [] }); // {id,origin,username,password,created}
  }

  init() {
    this.history.ensure();
    this.bookmarks.ensure();
    this.downloads.ensure();
    this.passwords.ensure();
  }

  flushAll() {
    for (const c of [this.history, this.bookmarks, this.downloads, this.passwords]) c.persist();
  }

  // ---- History ----
  addVisit(url, title) {
    const h = this.history.ensure();
    if (/^prism:\/\//i.test(url) || url === 'about:blank') return;
    const now = Date.now();
    const last = h.entries[h.entries.length - 1];
    if (last && last.url === url && now - last.time < 3000) return;
    h.entries.push({ url, title: title || url, time: now });
    if (h.entries.length > HISTORY_CAP) h.entries.splice(0, h.entries.length - HISTORY_CAP);
    this.history.persist();
  }

  updateTitle(url, title, favicon) {
    if (!title) return;
    const h = this.history.ensure();
    for (let i = h.entries.length - 1; i >= 0 && i >= h.entries.length - 10; i--) {
      const e = h.entries[i];
      if (e.url === url) { e.title = title; if (favicon) e.favicon = favicon; break; }
    }
    this.history.persist();
  }

  searchHistory(q, limit = 50) {
    const h = this.history.ensure();
    const needle = (q || '').toLowerCase();
    const out = [];
    for (let i = h.entries.length - 1; i >= 0 && out.length < limit; i--) {
      const e = h.entries[i];
      if (!needle || e.url.toLowerCase().includes(needle) || (e.title || '').toLowerCase().includes(needle)) {
        out.push(e);
      }
    }
    return out;
  }

  topSites(limit = 8) {
    const h = this.history.ensure();
    const counts = new Map();
    for (const e of h.entries) {
      try {
        const u = new URL(e.url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
        const key = u.origin;
        const cur = counts.get(key) || { url: key, title: u.hostname, count: 0, last: 0, favicon: null };
        cur.count++;
        cur.last = Math.max(cur.last, e.time);
        counts.set(key, cur);
      } catch (_) {}
    }
    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit);
  }

  deleteHistory(predicate) {
    const h = this.history.ensure();
    h.entries = h.entries.filter((e) => !predicate(e));
    this.history.persist();
  }

  clearHistory() { this.history.ensure().entries = []; this.history.persist(); }

  historyStats() {
    const h = this.history.ensure();
    const day = Date.now() - 86400e3;
    return { total: h.entries.length, today: h.entries.filter((e) => e.time >= day).length };
  }

  // ---- Bookmarks ----
  isBookmarked(url) {
    return this.bookmarks.ensure().entries.some((b) => b.url === url);
  }

  // bar defaults to true: the address-bar star is the only way Prism puts a
  // bookmark on the bookmarks bar, and the bar's empty state tells the user to
  // use it. Defaulting to false made every starred bookmark invisible there.
  addBookmark(url, title, favicon, bar = true) {
    const b = this.bookmarks.ensure();
    const found = b.entries.find((x) => x.url === url);
    // Never clear an existing bar flag by re-saving the bookmark.
    if (found) { found.title = title || found.title; found.bar = found.bar || bar; }
    else b.entries.push({ id: crypto.randomUUID(), url, title: title || url, favicon: favicon || null, bar, added: Date.now() });
    this.bookmarks.persist();
    this._emitBookmarksChanged();
    return url;
  }

  toggleBookmark(url, title, favicon) {
    const b = this.bookmarks.ensure();
    const idx = b.entries.findIndex((x) => x.url === url);
    if (idx >= 0) { b.entries.splice(idx, 1); this.bookmarks.persist(); this._emitBookmarksChanged(); return false; }
    this.addBookmark(url, title, favicon);
    return true;
  }

  removeBookmark(id) {
    const b = this.bookmarks.ensure();
    b.entries = b.entries.filter((x) => x.id !== id);
    this.bookmarks.persist();
    this._emitBookmarksChanged();
  }

  listBookmarks() { return this.bookmarks.ensure().entries.slice().reverse(); }

  barBookmarks() { return this.bookmarks.ensure().entries.filter((b) => b.bar); }

  // The bookmarks bar lives in the shell, which cannot know a bookmark changed
  // until something says so. Without this, a page starred or removed on the
  // Bookmarks page left the bar showing whatever it had last painted.
  // Same shape as the extensions dropdown's change notification.
  _emitBookmarksChanged() {
    let BrowserWindow;
    try { ({ BrowserWindow } = require('electron')); } catch (_) { return; }
    if (!BrowserWindow) return;
    for (const win of BrowserWindow.getAllWindows()) {
      let wc = null;
      // The chrome is a child WebContentsView, not win.webContents.
      try { wc = require('./tabs').shellContentsForWindow(win); } catch (_) { /* tabs not loaded */ }
      try { (wc || win.webContents).send('prism:bookmarks:changed'); } catch (_) {}
    }
  }

  // Move a bookmark on or off the bookmarks bar without touching the bookmark
  // itself. Returns whether anything changed, so a caller can tell "already in
  // that state" from "no such bookmark".
  setBookmarkBar(id, on) {
    const b = this.bookmarks.ensure();
    const found = b.entries.find((x) => x.id === id);
    if (!found) return false;
    const next = !!on;
    if (found.bar === next) return false;
    found.bar = next;
    this.bookmarks.persist();
    this._emitBookmarksChanged();
    return true;
  }

  // ---- Downloads ----
  addDownload(entry) {
    const d = this.downloads.ensure();
    d.entries.push(entry);
    if (d.entries.length > DOWNLOADS_CAP) d.entries.splice(0, d.entries.length - DOWNLOADS_CAP);
    this.downloads.persist();
  }

  updateDownload(id, patch) {
    const d = this.downloads.ensure();
    const e = d.entries.find((x) => x.id === id);
    if (e) Object.assign(e, patch);
    this.downloads.persist();
  }

  listDownloads() { return this.downloads.ensure().entries.slice().reverse(); }

  clearDownloads() { this.downloads.ensure().entries = []; this.downloads.persist(); }

  // ---- Passwords ----
  addPassword(origin, username, password) {
    const p = this.passwords.ensure();
    const found = p.entries.find((x) => x.origin === origin && x.username === username);
    if (found) found.password = password;
    else p.entries.push({ id: crypto.randomUUID(), origin, username, password, created: Date.now() });
    this.passwords.persist();
  }

  removePassword(id) {
    const p = this.passwords.ensure();
    p.entries = p.entries.filter((x) => x.id !== id);
    this.passwords.persist();
  }

  listPasswords() {
    return this.passwords.ensure().entries.map((x) => ({ ...x, password: undefined, hasPassword: true }));
  }

  revealPassword(id) {
    const p = this.passwords.ensure();
    const e = p.entries.find((x) => x.id === id);
    return e ? e.password : null;
  }
}

module.exports = new Stores();
