'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, dialog } = require('electron');
const M = (name) => require(path.join(__dirname, '..', 'src', 'main', name));
const fail = (error) => { console.error('PASSWORD_TRANSFER_UI_FAILED ' + (error && error.stack || error)); try { app.exit(1); } catch (_) {} };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { try { const value = await check(); if (value) return value; } catch (_) {} await wait(100); }
  throw new Error('Timed out waiting for ' + label);
}
const timeout = setTimeout(() => fail(new Error('PASSWORD_TRANSFER_UI_TIMEOUT')), 60000);

M('protocols').privilegedSchemes();
app.whenReady().then(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-transfer-'));

  try {
    const securestore = M('securestore'); securestore.init(); securestore.initCrypto();
    M('settings').init(); M('stores').init();
    const tabs = M('tabs'); tabs.init();
    const sessions = M('sessions').setupPartitions(tabs); tabs.setSessions(sessions);
    M('protocols').registerHandlers();
    M('protocols').registerOnSession(sessions.mainSession);
    M('protocols').registerOnSession(sessions.privSession);
    M('shell-ipc').registerIpc(tabs);

    const csvPath = path.join(temp, 'import.csv');
    const exportedCsv = path.join(temp, 'export.csv');
    const exportedCkz = path.join(temp, 'cookies.ckz');
    const user = 'transfer-' + Date.now() + '@example.test';
    const origin = 'https://transfer-' + Date.now() + '.example.test/login';
    fs.writeFileSync(csvPath, 'name,url,username,password,note\nExample,' + origin + ',' + user + ',"p,assword",\n');
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [csvPath] });
    dialog.showSaveDialog = async (_win, options) => ({ canceled: false, filePath: options.filters[0].extensions[0] === 'ckz' ? exportedCkz : exportedCsv });

    const wid = tabs.createWindow({ urls: ['prism://passwords'] });
    const record = tabs.windowRecord(wid);
    const page = tabs.tabs.get(record.active).view.webContents;
    await waitFor(async () => await page.executeJavaScript("!!document.getElementById('password-import') && !!window.prism && !!window.PrismUI"), 'Passwords transfer controls');
    await wait(700);

    await page.executeJavaScript("document.getElementById('password-import').click(); true;");
    await waitFor(async () => (await page.executeJavaScript("document.getElementById('password-transfer-status').textContent" )).includes('Imported '), 'CSV import result');
    const saved = M('stores').exportPasswords();
    assert(saved.some((item) => item.origin === origin && item.username === user && item.password === 'p,assword'), 'CSV import should populate the encrypted password vault');

    await page.executeJavaScript("document.getElementById('password-export').click(); true;");
    await waitFor(() => fs.existsSync(exportedCsv), 'CSV export file');
    const exported = fs.readFileSync(exportedCsv, 'utf8');
    assert(exported.startsWith('name,url,username,password\r\n'), 'export should use Google Password Manager CSV headers');
    assert(exported.includes('p,assword'), 'export should carry credentials in the selected CSV file');

    await sessions.mainSession.cookies.set({ url: 'https://example.com/', name: 'session_id', value: 'cookie-secret', httpOnly: true, secure: true, sameSite: 'lax' });
    await page.executeJavaScript(`document.getElementById('cookie-passphrase').value = 'transfer passphrase'; document.getElementById('cookie-export').click(); true;`);
    await waitFor(() => fs.existsSync(exportedCkz), 'encrypted CKZ export file');
    const archive = fs.readFileSync(exportedCkz);
    assert(!archive.includes(Buffer.from('cookie-secret')), 'CKZ file must not contain cookie plaintext');

    await sessions.mainSession.cookies.remove('https://example.com/', 'session_id');
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [exportedCkz] });
    await page.executeJavaScript(`document.getElementById('cookie-passphrase').value = 'transfer passphrase'; document.getElementById('cookie-import').click(); true;`);
    await waitFor(async () => (await sessions.mainSession.cookies.get({ url: 'https://example.com/' })).some((cookie) => cookie.name === 'session_id'), 'CKZ cookie import');
    assert((await sessions.mainSession.cookies.get({ url: 'https://example.com/' })).some((cookie) => cookie.value === 'cookie-secret'), 'CKZ should restore the original cookie value');

    console.log('PASSWORD_TRANSFER_UI_OK');
    clearTimeout(timeout); app.quit();
  } catch (error) { clearTimeout(timeout); fail(error); }
  finally { try { fs.rmSync(temp, { recursive: true, force: true }); } catch (_) {} }
});
