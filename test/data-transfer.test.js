'use strict';

const assert = require('assert');
const transfer = require('../src/main/data-transfer');

(async () => {
  const sample = '\ufeffname,url,username,password,note\r\n"Example, Inc.",https://example.com/login,"person@example.com","p,ass""word","line 1\nline 2"\r\nGoogle,https://accounts.google.com/,user,secret,\r\n';
  const imported = transfer.parsePasswordCsv(sample);
  assert.strictEqual(imported.entries.length, 2);
  assert.strictEqual(imported.entries[0].username, 'person@example.com');
  assert.strictEqual(imported.entries[0].password, 'p,ass"word');
  assert.strictEqual(imported.entries[0].name, 'Example, Inc.');
  assert.strictEqual(imported.rejected.length, 0);

  const exported = transfer.exportPasswordCsv(imported.entries);
  const reparsed = transfer.parsePasswordCsv(exported);
  assert.deepStrictEqual(reparsed.entries.map(({ origin, username, password }) => ({ origin, username, password })),
    imported.entries.map(({ origin, username, password }) => ({ origin, username, password })));
  assert.throws(() => transfer.parsePasswordCsv('website,username,password\nhttps://example.com,a,b'), /must include/);
  const invalid = transfer.parsePasswordCsv('url,username,password\nfile:///etc/passwd,a,b\nhttps://example.com,a,');
  assert.strictEqual(invalid.entries.length, 0);
  assert.strictEqual(invalid.rejected.length, 2);
  assert.throws(() => transfer.parsePasswordCsv('url,username,password\n"unterminated,a,b'), /unterminated/);
  assert.strictEqual(transfer.exportPasswordCsv([]).split('\r\n')[0], 'name,url,username,password');

  const cookies = [
    { name: 'sid', value: 'secret=value', domain: '.example.com', path: '/', secure: true, httpOnly: true,
      sameSite: 'no_restriction', expirationDate: Math.floor(Date.now() / 1000) + 3600 },
    { name: 'session', value: 'temporary', domain: 'localhost', path: '/app', secure: false, httpOnly: false,
      sameSite: 'lax', session: true }
  ];
  const archive = await transfer.exportCookieArchive(cookies, 'a strong passphrase');
  assert(archive.subarray(0, transfer.CKZ_MAGIC.length).equals(transfer.CKZ_MAGIC));
  assert(!archive.includes(Buffer.from('secret=value')), 'archive must not expose cookie plaintext');
  const restored = await transfer.importCookieArchive(archive, 'a strong passphrase');
  assert.strictEqual(restored.length, 2);
  assert.strictEqual(restored[0].url, 'https://example.com/');
  assert.strictEqual(restored[0].domain, '.example.com');
  assert.strictEqual(restored[0].httpOnly, true);
  assert.strictEqual(restored[1].url, 'http://localhost/app');
  assert(!Object.prototype.hasOwnProperty.call(restored[1], 'expirationDate'), 'session cookie remains session-scoped');
  await assert.rejects(() => transfer.importCookieArchive(archive, 'wrong passphrase'), /Could not unlock/);
  const tampered = Buffer.from(archive); tampered[tampered.length - 1] ^= 1;
  await assert.rejects(() => transfer.importCookieArchive(tampered, 'a strong passphrase'), /Could not unlock/);
  await assert.rejects(() => transfer.exportCookieArchive(cookies, 'short'), /at least 8/);

  console.log('DATA_TRANSFER_OK');
})().catch((error) => {
  console.error('DATA_TRANSFER_FAILED ' + (error && error.stack || error));
  process.exitCode = 1;
});
