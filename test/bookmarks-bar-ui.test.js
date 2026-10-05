// bookmarks-bar-ui.test.js — the bookmarks bar actually shows bookmarks.
//
// This exists because the bar could never show anything: the address-bar star
// saved every bookmark with bar: false, and nothing in the app set that flag, so
// stores.barBookmarks() was always empty no matter how many pages were starred.
// The bar even told the user to "use the star in the address bar" - which is
// exactly the path that produced the invisible bookmarks.
//
// So this drives the real thing end to end: real stores, real ipcMain handlers,
// real preload bridge, real shell DOM. No mocks, because the bug lived in the
// seam between them.
'use strict';

const { app } = require('electron');
const path = require('path');
const M = (name) => require(path.join(__dirname, '..', 'src', 'main', name));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const timeout = setTimeout(() => {
  console.error('BOOKMARKS_BAR_TIMEOUT');
  try { app.exit(1); } catch (_) {}
}, 60000);

let failures = 0;
function check(name, condition, detail) {
  if (condition) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail !== undefined ? ' — ' + detail : '')); }
}

const protocols = M('protocols');
protocols.privilegedSchemes();
const securestore = M('securestore');
const settings = M('settings');

app.whenReady().then(async () => {
  securestore.init();
  securestore.initCrypto();
  settings.init();
  const stores = M('stores');
  stores.init();
  const tabs = M('tabs');
  tabs.init();
  const sessions = M('sessions').setupPartitions(tabs);
  tabs.setSessions(sessions);
  protocols.registerHandlers();
  protocols.registerOnSession(sessions.mainSession);
  protocols.registerOnSession(sessions.privSession);
  M('shell-ipc').registerIpc(tabs);

  try {
    // Start from a known state: the bar on, and no leftover bookmarks.
    settings.set({ appearance: { bookmarksBar: true } });
    for (const b of stores.listBookmarks()) stores.removeBookmark(b.id);

    const wid = tabs.createWindow({ urls: ['https://example.com/'] });
    const record = tabs.windowRecord(wid);
    const shellWc = record.shellView.webContents;
    const page = tabs.tabs.get(record.tabs[0]).view.webContents;
    await Promise.all([
      new Promise((resolve) => shellWc.once('did-finish-load', resolve)),
      new Promise((resolve) => page.once('did-finish-load', resolve))
    ]);
    await wait(700);

    const barState = () => shellWc.executeJavaScript(`({
      visible: document.getElementById('bookmarksbar').style.display !== 'none',
      chips: Array.from(document.querySelectorAll('#bookmarksbar .bm'))
        .map((c) => ({ label: c.textContent, title: c.title }))
    })`);

    // ---- empty state ----
    let bar = await barState();
    check('the bookmarks bar is visible when the setting is on', bar.visible, JSON.stringify(bar));
    check('an empty bar explains itself', bar.chips.length === 0);

    // ---- starring a page, the way a user does it ----
    // The real star button in the real shell, on a real http tab: the star,
    // the ipc handler, the store and the repaint are all the ones shipped.
    // (The shell's bridge is window.prismShell, not window.prism.)
    // The omnibox is cleared until it is focused, so the tab's URL is not read
    // from there; the chip's own tooltip below is what proves it was a real
    // http page.
    await shellWc.executeJavaScript("document.getElementById('star').click(); true");
    await wait(700);
    bar = await barState();
    check('starring the open page puts a chip on the bar',
      bar.chips.length === 1, JSON.stringify(bar));
    check('the chip is labelled with the page title',
      bar.chips.length === 1 && bar.chips[0].label.length > 0, JSON.stringify(bar));
    check('the chip carries the page URL as its tooltip',
      bar.chips.length === 1 && /^https?:/.test(bar.chips[0].title.split(String.fromCharCode(10))[1] || ''),
      JSON.stringify(bar));
    const afterStar = stores.listBookmarks();
    check('the bookmark is stored with the bar flag set',
      afterStar.length === 1 && afterStar[0].bar === true, JSON.stringify(afterStar));

    // A second bookmark has to appear without any full state push, which is
    // what proves the bar fetches its own list instead of painting a snapshot.
    await shellWc.executeJavaScript(
      "(async () => { await window.prismShell.toggleBookmark('https://example.org/second', 'Second Page', null); })(); true");
    await wait(700);
    bar = await barState();
    check('a second starred page appears too',
      bar.chips.length === 2 && bar.chips.some((c) => /Second Page/.test(c.label)),
      JSON.stringify(bar));

    // ---- un-starring removes it from the bar ----
    await shellWc.executeJavaScript(
      "(async () => { await window.prismShell.toggleBookmark('https://example.org/second', 'Second Page', null); })(); true");
    await wait(700);
    bar = await barState();
    check('un-starring a page takes it off the bar', bar.chips.length === 1, JSON.stringify(bar));
    check('the bookmark itself is gone too, as starring removes it',
      stores.listBookmarks().length === 1, String(stores.listBookmarks().length));

    // ---- removing from the bar must not delete the bookmark ----
    const remaining = stores.listBookmarks()[0];
    check('the bookmark is still in the store before the bar action',
      !!remaining && remaining.bar === true, JSON.stringify(remaining));

    // The shell's context menu asks before removing; answer yes by overriding
    // confirm for this one call.
    await shellWc.executeJavaScript(
      "window.confirm = () => true;" +
      "const chip = document.querySelector('#bookmarksbar .bm');" +
      "chip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); true");
    await wait(700);
    bar = await barState();
    check('removing from the bar clears the chip', bar.chips.length === 0, JSON.stringify(bar));

    const stillThere = stores.listBookmarks();
    check('the bookmark survives being removed from the bar',
      stillThere.length === 1, JSON.stringify(stillThere.map((b) => ({ url: b.url, bar: b.bar }))));
    check('and it is no longer marked for the bar',
      stillThere.length === 1 && stillThere[0].bar === false, JSON.stringify(stillThere[0]));

    // ---- putting it back, the way the Bookmarks page does ----
    check('setBookmarkBar puts it back on', stores.setBookmarkBar(stillThere[0].id, true) === true);
    check('the bar list has it again',
      stores.barBookmarks().some((b) => b.id === stillThere[0].id));
    check('setting the same state again reports no change',
      stores.setBookmarkBar(stillThere[0].id, true) === false);
    check('an unknown bookmark id is refused', stores.setBookmarkBar('nope', true) === false);

    // ---- the bar hides when the setting is off ----
    settings.set({ appearance: { bookmarksBar: false } });
    await tabs._sendFullState(wid);
    await wait(600);
    bar = await barState();
    check('the bar hides when the setting is off', bar.visible === false, JSON.stringify(bar));

    console.log('BOOKMARKS_BAR_RESULT failures=' + failures);
    clearTimeout(timeout);
    if (failures) {
      console.error('BOOKMARKS_BAR_FAILED');
      try { app.exit(1); } catch (_) {}
    } else {
      console.log('BOOKMARKS_BAR_OK');
      app.quit();
    }
  } catch (err) {
    console.error('BOOKMARKS_BAR_ERROR ' + ((err && err.stack) || err));
    clearTimeout(timeout);
    try { app.exit(1); } catch (_) {}
  }
});