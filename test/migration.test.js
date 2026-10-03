// Simulates a vault created by the OLD buggy build: a plaintext hex keyring
// (safeStorage unavailable pre-ready). The fix must adopt that exact key so
// the old encrypted collections stay readable, then re-wrap with the OS keyring.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MODE = process.argv[2]; // 'seed-old' | 'verify-migration'
const securestore = require(path.join(__dirname, '..', 'src', 'main', 'securestore.js'));

function aesEncrypt(keyHex, text) {
  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(Buffer.from(text, 'utf8')), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]);
}

app.whenReady().then(() => {
  securestore.init();
  const keyFile = path.join(securestore.dir, 'keyring.bin');
  const sbox = path.join(securestore.dir, 'settings.sbox');

  if (MODE === 'seed-old') {
    const oldKey = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(keyFile, oldKey);                       // plaintext hex, as old build did
    fs.writeFileSync(sbox, aesEncrypt(oldKey, JSON.stringify({ search: { defaultEngine: 'ddg' } })));
    console.log('SEEDED_OLDKEY=' + oldKey.slice(0, 8) + '...');
    app.quit(0);
    return;
  }

  if (MODE === 'verify-migration') {
    securestore.initCrypto();
    const st = securestore.status();
    const data = securestore.load('settings', {});
    const engine = (data.search || {}).defaultEngine;
    const keyBytes = fs.statSync(keyFile).size;
    console.log('KEYRING=' + st.keyring);
    console.log('MIGRATED_ENGINE=' + engine);
    console.log('KEYRING_BYTES=' + keyBytes); // 64 = still plaintext, ~95 = DPAPI-wrapped
    const ok = engine === 'ddg' && st.keyring === 'os-keyring-migrated' && keyBytes !== 64;
    console.log(ok ? 'MIGRATION_OK' : 'MIGRATION_FAIL');
    app.quit(ok ? 0 : 1);
    return;
  }

  app.quit(2);
});
