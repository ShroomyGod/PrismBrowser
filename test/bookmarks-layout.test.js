// The bookmarks bar is in normal flow, so showing it must move the page edge
// down. This asserts the main process re-lays out when that happens, which is
// the behaviour that was previously broken (the bar overlaid the page).
const { app } = require('electron');
const path = require('path');
const M = (p) => require(path.join(__dirname, '..', 'src', 'main', p));

const bail = (m, c) => { console.error(m); try { app.exit(c || 1); } catch (_) {} };
setTimeout(() => bail('BM_TIMEOUT'), 45000);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const securestore = M('securestore');
  securestore.init();
  securestore.initCrypto();
  const settings = M('settings');
  settings.init();
  M('stores').init();

  const tabs = M('tabs');
  tabs.setSessions(M('sessions').setupPartitions(tabs));
  M('shell-ipc').registerIpc(tabs);   // required: carries prism:chrome-height
  M('menus').buildAppMenu(tabs);

  const wid = tabs.createWindow();
  const rec = tabs.windowRecord(wid);
  // The shell lives in its own topmost WebContentsView.
  const shellWc = rec.shellView.webContents;
  await new Promise((r) => shellWc.once('did-finish-load', r));
  await wait(1200);

  // Settings persist in the encrypted vault, so establish a known baseline.
  settings.set({ appearance: { bookmarksBar: false } });
  await wait(1000);

  const view = () => tabs.tabs.get(rec.tabs[0]).view;
  const barH = await shellWc.executeJavaScript(
    `Math.round(document.getElementById('bookmarksbar').getBoundingClientRect().height) || 28`
  );

  const before = rec.chromeHeight;
  const yBefore = view().getBounds().y;

  settings.set({ appearance: { bookmarksBar: true } });
  await wait(1200);

  const after = rec.chromeHeight;
  const yAfter = view().getBounds().y;
  const visible = await shellWc.executeJavaScript(
    `document.getElementById('bookmarksbar').style.display !== 'none'`
  );

  console.log('BAR_HEIGHT=' + barH);
  console.log('CHROME_BEFORE=' + before + ' CHROME_AFTER=' + after);
  console.log('PAGE_Y_BEFORE=' + yBefore + ' PAGE_Y_AFTER=' + yAfter);
  console.log('BAR_VISIBLE=' + visible);

  const grew = after === before + barH;
  const moved = yAfter === yBefore + barH;
  // The page must start exactly at the chrome edge, never inside the bar.
  const aligned = yAfter === after;

  console.log(grew ? 'CHROME_GREW_OK' : 'CHROME_GREW_FAIL');
  console.log(moved ? 'PAGE_MOVED_OK' : 'PAGE_MOVED_FAIL');
  console.log(aligned ? 'PAGE_ALIGNED_OK' : 'PAGE_ALIGNED_FAIL');
  console.log(visible ? 'BAR_SHOWN_OK' : 'BAR_SHOWN_FAIL');

  settings.set({ appearance: { bookmarksBar: false } });
  await wait(400);
  app.exit(grew && moved && aligned && visible ? 0 : 1);
}).catch((e) => bail('BM_ERROR: ' + (e && e.stack || e)));
