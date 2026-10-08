'use strict';

const crypto = require('crypto');

const CSV_LIMIT = 10 * 1024 * 1024;
const CKZ_LIMIT = 64 * 1024 * 1024;
const COOKIE_LIMIT = 50000;
const CKZ_MAGIC = Buffer.from('PRISM-CKZ-1\n', 'ascii');
const SAME_SITE = new Set(['unspecified', 'no_restriction', 'lax', 'strict']);

function csvCell(value) {
  const text = String(value == null ? '' : value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function parseCsv(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > CSV_LIMIT) throw new Error('CSV file is too large or invalid.');
  const rows = [];
  let row = [], cell = '', quoted = false, closed = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else cell += ch;
      continue;
    }
    if (closed && ch !== ',' && ch !== '\r' && ch !== '\n') throw new Error('Invalid CSV: characters after a closing quote.');
    if (ch === '"') {
      if (cell || closed) throw new Error('Invalid CSV: unexpected quote.');
      quoted = true;
    } else if (ch === ',') {
      row.push(cell); cell = ''; closed = false;
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = ''; closed = false;
    } else { cell += ch; }
    if (cell.length > 1024 * 1024) throw new Error('CSV cell is too large.');
  }
  if (quoted) throw new Error('Invalid CSV: unterminated quoted field.');
  if (cell || row.length || closed) { row.push(cell); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function parsePasswordCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('The CSV file is empty.');
  const headers = rows[0].map((x) => x.trim().toLowerCase());
  const column = (name) => headers.indexOf(name);
  const urlColumn = column('url'), usernameColumn = column('username'), passwordColumn = column('password');
  if (urlColumn < 0 || usernameColumn < 0 || passwordColumn < 0) {
    throw new Error('CSV must include Google Password Manager columns: url, username, password.');
  }
  const nameColumn = column('name');
  const entries = [], rejected = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length !== headers.length) { rejected.push({ row: i + 1, reason: 'Column count does not match the header.' }); continue; }
    const url = (row[urlColumn] || '').trim();
    const username = row[usernameColumn] || '';
    const password = row[passwordColumn] || '';
    let parsed;
    try { parsed = new URL(url); } catch (_) {}
    if (!parsed || !['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      rejected.push({ row: i + 1, reason: 'URL must be a valid HTTP or HTTPS login address.' }); continue;
    }
    if (!password) { rejected.push({ row: i + 1, reason: 'Password is empty.' }); continue; }
    if (url.length > 2048 || username.length > 4096 || password.length > 65536) {
      rejected.push({ row: i + 1, reason: 'Credential field exceeds its size limit.' }); continue;
    }
    entries.push({ origin: url, username, password, name: nameColumn < 0 ? '' : (row[nameColumn] || '') });
  }
  return { entries, rejected, total: rows.length - 1 };
}

function exportPasswordCsv(entries) {
  const rows = [['name', 'url', 'username', 'password']];
  for (const entry of entries || []) {
    let name = '';
    try { name = new URL(entry.origin || entry.url).hostname; } catch (_) {}
    rows.push([name, entry.origin || entry.url || '', entry.username || '', entry.password || '']);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function deriveKey(passphrase, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }, (err, key) => err ? reject(err) : resolve(key));
  });
}

function cookieForArchive(cookie) {
  if (!cookie || typeof cookie !== 'object') throw new Error('Cookie entry is invalid.');
  const name = String(cookie.name || ''), value = String(cookie.value || '');
  let rawDomain = String(cookie.domain || '');
  if (!rawDomain && cookie.url) {
    try {
      const parsedUrl = new URL(cookie.url);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') throw new Error('Invalid cookie URL.');
      rawDomain = cookie.hostOnly === false ? '.' + parsedUrl.hostname : parsedUrl.hostname;
    } catch (_) { throw new Error('Cookie URL or domain is invalid.'); }
  }
  const host = rawDomain.replace(/^\./, '').toLowerCase();
  if (!name || name.length > 4096 || value.length > 65536 || !host || host.length > 253 || (host !== 'localhost' && !host.includes('.') && !host.includes(':')) || /[\s/@?#]/.test(host)) {
    throw new Error('Cookie name, value, or domain is invalid.');
  }
  const secure = !!cookie.secure;
  const hostOnly = cookie.hostOnly === undefined ? !rawDomain.startsWith('.') : !!cookie.hostOnly;
  const path = typeof cookie.path === 'string' && cookie.path.startsWith('/') ? cookie.path : '/';
  if (path.length > 4096) throw new Error('Cookie path is too long.');
  const sameSite = SAME_SITE.has(cookie.sameSite) ? cookie.sameSite : 'unspecified';
  const out = { url: (secure ? 'https://' : 'http://') + host + path, name, value, path, secure, httpOnly: !!cookie.httpOnly, sameSite, hostOnly };
  if (!hostOnly) out.domain = '.' + host;
  if (Number.isFinite(cookie.expirationDate) && cookie.expirationDate > 0) out.expirationDate = cookie.expirationDate;
  return out;
}

function validateCookieForImport(cookie) {
  const safe = cookieForArchive(cookie);
  if (safe.expirationDate && safe.expirationDate <= Date.now() / 1000) return null;
  const parsed = new URL(safe.url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Cookie URL must use HTTP or HTTPS.');
  return {
    url: safe.url, name: safe.name, value: safe.value, path: safe.path,
    secure: safe.secure, httpOnly: safe.httpOnly, sameSite: safe.sameSite,
    ...(safe.hostOnly ? {} : { domain: safe.domain }),
    ...(safe.expirationDate ? { expirationDate: safe.expirationDate } : {})
  };
}

async function exportCookieArchive(cookies, passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 8 || passphrase.length > 1024) throw new Error('Choose a cookie archive passphrase with at least 8 characters.');
  if (!Array.isArray(cookies) || cookies.length > COOKIE_LIMIT) throw new Error('Cookie count exceeds the archive limit.');
  const payload = Buffer.from(JSON.stringify({ format: 'Prism CKZ', version: 1, cookies: cookies.map(cookieForArchive) }), 'utf8');
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = await deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(CKZ_MAGIC);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const archive = Buffer.concat([CKZ_MAGIC, salt, iv, cipher.getAuthTag(), ciphertext]);
  if (archive.length > CKZ_LIMIT) throw new Error('Cookie archive exceeds the file size limit.');
  return archive;
}

async function importCookieArchive(archive, passphrase) {
  const data = Buffer.isBuffer(archive) ? archive : Buffer.from(archive || []);
  const headerLength = CKZ_MAGIC.length + 16 + 12 + 16;
  if (data.length < headerLength + 2 || data.length > CKZ_LIMIT || !data.subarray(0, CKZ_MAGIC.length).equals(CKZ_MAGIC)) {
    throw new Error('This is not a valid Prism .ckz cookie archive.');
  }
  if (typeof passphrase !== 'string' || passphrase.length < 8 || passphrase.length > 1024) throw new Error('Enter the passphrase used to export this cookie archive.');
  let offset = CKZ_MAGIC.length;
  const salt = data.subarray(offset, offset += 16), iv = data.subarray(offset, offset += 12), tag = data.subarray(offset, offset += 16);
  const key = await deriveKey(passphrase, salt);
  let plaintext;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(CKZ_MAGIC); decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(data.subarray(offset)), decipher.final()]);
  } catch (_) { throw new Error('Could not unlock the .ckz archive. Check the passphrase and file integrity.'); }
  let payload;
  try { payload = JSON.parse(plaintext.toString('utf8')); } catch (_) { throw new Error('Cookie archive contents are invalid.'); }
  if (!payload || payload.format !== 'Prism CKZ' || payload.version !== 1 || !Array.isArray(payload.cookies) || payload.cookies.length > COOKIE_LIMIT) {
    throw new Error('Unsupported or malformed Prism cookie archive.');
  }
  const cookies = [];
  for (let i = 0; i < payload.cookies.length; i++) {
    try {
      const cookie = validateCookieForImport(payload.cookies[i]);
      if (cookie) cookies.push(cookie);
    } catch (_) { throw new Error('Cookie archive contains an invalid cookie at entry ' + (i + 1) + '.'); }
  }
  return cookies;
}

module.exports = {
  CSV_LIMIT, CKZ_LIMIT, CKZ_MAGIC, parseCsv, parsePasswordCsv, exportPasswordCsv,
  cookieForArchive, validateCookieForImport, exportCookieArchive, importCookieArchive
};
