// downloads-ui.test.js — end-to-end check that a real download lands where the
// user asked, does not clobber an existing file, gets scanned, and can be
// opened, revealed, and deleted from disk.
'use strict';

const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const M = (name) => require(path.join(__dirname, '..', 'src', 'main', name));
const fail = (message) => { console.error(message); try { app.exit(1); } catch (_) {} };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const timeout = setTimeout(() => fail('DOWNLOADS_UI_TIMEOUT'), 180000);

const protocols = M('protocols');
protocols.privilegedSchemes();
const securestore = M('securestore');
const settings = M('settings');

app.whenReady().then(async () => {
  securestore.init();
  securestore.initCrypto();
  settings.init();
  const originalGeneral = JSON.parse(JSON.stringify(settings.all().general || {}));
  const originalSecurity = JSON.parse(JSON.stringify(settings.all().security || {}));
  const stores = M('stores');
  stores.init();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-downloads-'));
  // This test drives the REAL stores, so the user's actual download history
  // must be put back afterwards. Calling clearDownloads() to tidy up would
  // destroy their data, which is exactly what this test must never do.
  const savedHistory = JSON.parse(JSON.stringify(stores.downloads.ensure().entries));
  function restoreHistory() {
    stores.downloads.ensure().entries = savedHistory;
    stores.downloads.persist();
  }
  // Point the browser at a temp folder so the test never writes into the real
  // user's Downloads directory.
  settings.set({ general: { downloadDir: dir, askWhereToSave: false } });

  const tabs = M('tabs');
  tabs.init();
  const sessions = M('sessions').setupPartitions(tabs);
  tabs.setSessions(sessions);
  protocols.registerHandlers();
  protocols.registerOnSession(sessions.mainSession);
  protocols.registerOnSession(sessions.privSession);
  M('shell-ipc').registerIpc(tabs);
  const downloads = M('downloads');

  try {
    const av = downloads.antivirusStatus();
    console.log('DOWNLOADS_AV=' + JSON.stringify(av));
    console.log('DOWNLOADS_DIR=' + downloads.downloadsDir());
    if (downloads.downloadsDir() !== dir) throw new Error('configured download folder was not honoured');

    const wid = tabs.createWindow({ urls: ['prism://newtab'] });
    const record = tabs.windowRecord(wid);
    const wc = tabs.tabs.get(record.tabs[0]).view.webContents;
    await new Promise((resolve) => wc.once('did-finish-load', resolve));
    await wait(400);

    // A data: URL keeps the test hermetic: no server, no network, and the
    // Content-Disposition filename is what a real download would report.
    const before = stores.listDownloads().length;
    wc.downloadURL('data:text/plain;base64,' + Buffer.from('prism download test').toString('base64'));

    // will-download -> file written -> scan runs -> history row settles.
    let entry = null;
    for (let i = 0; i < 120; i++) {
      await wait(250);
      const list = stores.listDownloads();
      if (list.length > before) {
        entry = list[0];
        const state = String(entry.state || '');
        if (state === 'completed' || state === 'quarantined' || state === 'blocked' || state === 'deleted') break;
      }
    }
    if (!entry) throw new Error('no download history entry was recorded');
    console.log('DOWNLOADS_ENTRY=' + JSON.stringify({
      state: entry.state, filename: entry.filename, scannedBy: entry.scannedBy,
      threat: entry.threat, sha256: !!entry.sha256, path: entry.path
    }));
    if (entry.state === 'blocked' || entry.state === 'quarantined') {
      // A false positive on a plain text file would be a bug, not a feature.
      throw new Error('a harmless text file was flagged: ' + entry.threat);
    }
    if (entry.state !== 'completed') throw new Error('download did not complete, state=' + entry.state);

    // Landed in the configured folder.
    const saved = entry.path;
    if (!saved) throw new Error('download has no path recorded');
    if (path.resolve(path.dirname(saved)) !== path.resolve(dir)) {
      throw new Error('download did not land in the configured folder: ' + saved);
    }
    if (!fs.existsSync(saved)) throw new Error('downloaded file is missing on disk: ' + saved);
    console.log('DOWNLOADS_SAVED=' + saved);

    // The scan ran and recorded an honest verdict either way: when Defender is
    // present the row must name it, and when it is not the row must NOT claim
    // a scan happened.
    if (av.available && entry.scannedBy !== 'Windows Defender') {
      throw new Error('Defender was available but the row did not record it: ' + JSON.stringify(entry.scannedBy));
    }
    if (!av.available && entry.scannedBy) {
      throw new Error('claimed a scan from ' + entry.scannedBy + ' but no engine was available');
    }

    // Downloading the same name again must not clobber the first file.
    wc.downloadURL('data:text/plain;base64,' + Buffer.from('second copy').toString('base64'));
    let second = null;
    const startCount = stores.listDownloads().length;
    for (let i = 0; i < 120; i++) {
      await wait(250);
      const list = stores.listDownloads();
      if (list.length > startCount) {
        const candidate = list[0];
        if (String(candidate.state) === 'completed' || String(candidate.state) === 'quarantined') { second = candidate; break; }
      }
    }
    if (!second) throw new Error('second download never settled');
    if (path.resolve(second.path) === path.resolve(saved)) {
      throw new Error('second download overwrote the first: ' + second.path);
    }
    if (fs.readFileSync(saved, 'utf8') !== 'prism download test') {
      throw new Error('the first download was modified by the second');
    }
    console.log('DOWNLOADS_SECOND=' + second.path);

    // Detection actually detects. EICAR is the industry's standard harmless test
// string: every real AV engine flags it, and it is not malware. Scanning it
// proves the quarantine path fires rather than only proving clean files pass.
// -DisableRemediation means Defender reports without deleting it.
    if (av.available) {
      const eicar = path.join(dir, 'eicar.com.txt');
      fs.writeFileSync(eicar, 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
      const found = await downloads.scanWithDefender(eicar);
      console.log('DOWNLOADS_EICAR=' + JSON.stringify(found));
      if (!found.ran) throw new Error('EICAR scan did not run');
      if (!found.threat) throw new Error('EICAR was not detected - the antivirus integration is not working');
      if (!/EICAR/i.test(found.threat)) {
        throw new Error('threat was reported without Defender\'s detection name: ' + found.threat);
      }
      if (!fs.existsSync(eicar)) throw new Error('test file was removed despite -DisableRemediation');
      fs.unlinkSync(eicar);
    } else {
      console.log('DOWNLOADS_EICAR=skipped (no engine)');
    }

    // Reveal does not throw and resolves the path.
    const revealed = downloads.reveal(second.path);
    if (!revealed.ok) throw new Error('show in folder failed: ' + revealed.error);

    // Refuse a path that was never a download: the handlers must not become a
    // general-purpose "delete any file" channel.
    const outsider = path.join(dir, 'not-a-download.txt');
    fs.writeFileSync(outsider, 'keep me');
    const refused = downloads.removeFile(outsider);
    if (refused.ok) throw new Error('removeFile deleted a file that was never a download');
    if (!fs.existsSync(outsider)) throw new Error('removeFile deleted an unrecorded file');
    console.log('DOWNLOADS_REFUSED=' + JSON.stringify(refused));

    // Delete really removes the file.
    const deleted = downloads.removeFile(second.path);
    if (!deleted.ok) throw new Error('delete file failed: ' + deleted.error);
    if (fs.existsSync(second.path)) throw new Error('delete file left the file on disk');
    if (!fs.existsSync(saved)) throw new Error('deleting one download removed another');
    console.log('DOWNLOADS_DELETED=' + second.path);

    // Clearing the list must not touch what is still on disk. Verified on the
    // test's own entries, then the user's real history is restored verbatim.
    stores.clearDownloads();
    if (stores.listDownloads().length) throw new Error('clear list did not empty the history');
    if (!fs.existsSync(saved)) throw new Error('clearing the list deleted a file');
    restoreHistory();
    if (stores.listDownloads().length !== savedHistory.length) {
      throw new Error('failed to restore the user\'s download history');
    }
    console.log('DOWNLOADS_LIST_CLEARED=ok');

    fs.rmSync(dir, { recursive: true, force: true });
    settings.set({ general: originalGeneral, security: originalSecurity });
    console.log('DOWNLOADS_UI_OK');
    clearTimeout(timeout);
    // app.exit() force-kills the process without letting Chromium close its
    // windows and sessions, which intermittently segfaulted and turned a
    // passing run into exit 139 under `npm test`. Quit properly instead.
    process.exitCode = 0;
    app.quit();
  } catch (error) {
    try { restoreHistory(); } catch (_) { /* best effort */ }
    try {
      settings.set({ general: originalGeneral, security: originalSecurity });
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) { /* best effort */ }
    fail('DOWNLOADS_UI_ERROR: ' + (error && error.stack || error));
  }
}).catch((error) => fail('DOWNLOADS_UI_BOOT_ERROR: ' + (error && error.stack || error)));