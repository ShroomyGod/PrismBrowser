// Overlay test — the bug the user actually saw: omnibox suggestions, the "..."
// menu and the findbar were drawn BEHIND the page because the page is a
// native view stacked above the shell's webContents.
//
// The fix: the shell lives in its own WebContentsView stacked LAST (topmost),
// and its bounds grow to cover open overlays. This test drives a real window:
//   1. shell view is the topmost child
//   2. opening the omnibox dropdown grows the shell view past the chrome edge
//      (so the dropdown is no longer clipped/covered by the page)
//   3. the page view stays put at y=chromeHeight (no toolbar overlap)
//   4. closing the dropdown shrinks the shell view back
//   5. the shell body is transparent below the chrome
const { app } = require('electron');
const path = require('path');
const M = (p) => require(path.join(__dirname, '..', 'src', 'main', p));

const bail = (m, c) => { console.error(m); try { app.exit(c || 1); } catch (_) {} };
setTimeout(() => bail('OVERLAY_TIMEOUT'), 45000);
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
  M('shell-ipc').registerIpc(tabs);   // carries chrome-height + shell-extent
  M('menus').buildAppMenu(tabs);

  const wid = tabs.createWindow();
  const rec = tabs.windowRecord(wid);
  const shellWc = rec.shellView.webContents;
  await new Promise((r) => shellWc.once('did-finish-load', r));
  await wait(1200); // let the shell report its chrome height

  // 1. Shell must be the topmost child so its overlays paint above the page.
  const kids = rec.win.contentView.children;
  const topmost = kids.length > 0 && kids[kids.length - 1] === rec.shellView;

  const chrome = rec.chromeHeight;
  const shellB0 = rec.shellView.getBounds();
  const pageB0 = tabs.tabs.get(rec.tabs[0]).view.getBounds();

  console.log('CHILDREN=' + kids.length + ' TOPMOST=' + topmost);
  console.log('CHROME=' + chrome + ' SHELL_BOUNDS=' + JSON.stringify(shellB0) +
    ' PAGE_BOUNDS=' + JSON.stringify(pageB0));

  // Shell body must be transparent so the page shows around open popups.
  const bodyBg = await shellWc.executeJavaScript(
    `getComputedStyle(document.body).backgroundColor`);
  console.log('BODY_BG=' + bodyBg);

  // 2. Open the omnibox dropdown the same way shell.js does.
  await shellWc.executeJavaScript(`
    omniRows = [
      { label: 'electron', sub: 'Search Prism Search', input: 'electron', type: 'search' },
      { label: 'electronjs.org', sub: '', input: 'https://electronjs.org', type: 'url' },
      { label: 'electron browser', sub: 'history', input: 'https://example.com', type: 'history' }
    ];
    omniSel = -1;
    renderDropdown();
    true;
  `);
  await wait(500); // rAF -> IPC -> setShellExtent -> layout

  const ddBottom = await shellWc.executeJavaScript(
    `Math.ceil(document.getElementById('omni-dropdown').getBoundingClientRect().bottom)`);
  const shellB1 = rec.shellView.getBounds();
  const pageB1 = tabs.tabs.get(rec.tabs[0]).view.getBounds();

  console.log('DROPDOWN_BOTTOM=' + ddBottom);
  console.log('SHELL_AFTER_OPEN=' + JSON.stringify(shellB1) +
    ' EXTENT=' + rec.shellExtent + ' PAGE_AFTER=' + JSON.stringify(pageB1));

  const grew = shellB1.height > chrome;
  const coversDropdown = shellB1.height >= ddBottom;
  const pageUnmoved = pageB1.y === chrome && pageB1.height === pageB0.height;
  const chromeStillBottom = shellB1.height >= chrome;

  console.log(grew ? 'SHELL_GREW_OK' : 'SHELL_GREW_FAIL');
  console.log(coversDropdown ? 'DROPDOWN_COVERED_OK' : 'DROPDOWN_COVERED_FAIL');
  console.log(pageUnmoved ? 'PAGE_UNMOVED_OK' : 'PAGE_UNMOVED_FAIL');

  // 3. Close it again — the shell view must shrink back so it can't eat
  //    clicks meant for the page.
  await shellWc.executeJavaScript(`hideDropdown(); true;`);
  await wait(500);
  const shellB2 = rec.shellView.getBounds();
  const shrunk = shellB2.height === chrome;
  console.log('SHELL_AFTER_CLOSE=' + JSON.stringify(shellB2));
  console.log(shrunk ? 'SHELL_SHRUNK_OK' : 'SHELL_SHRUNK_FAIL');

  // 4. The "..." menu must be covered too (it was one of the reported symptoms).
  await shellWc.executeJavaScript(
    `document.getElementById('menu-panel').style.display = ''; true;`);
  await wait(500);
  const menuBottom = await shellWc.executeJavaScript(
    `Math.ceil(document.getElementById('menu-panel').getBoundingClientRect().bottom)`);
  const shellB3 = rec.shellView.getBounds();
  const menuCovered = shellB3.height >= menuBottom;
  console.log('MENU_BOTTOM=' + menuBottom + ' SHELL=' + shellB3.height);
  console.log(menuCovered ? 'MENU_COVERED_OK' : 'MENU_COVERED_FAIL');
  await shellWc.executeJavaScript(
    `document.getElementById('menu-panel').style.display = 'none'; true;`);
  await wait(300);

  const transparent = bodyBg === 'rgba(0, 0, 0, 0)';
  console.log(transparent ? 'BODY_TRANSPARENT_OK' : 'BODY_TRANSPARENT_FAIL');

  const ok = topmost && grew && coversDropdown && pageUnmoved && shrunk &&
    menuCovered && transparent;
  console.log(ok ? 'OVERLAY_OK' : 'OVERLAY_FAIL');
  app.exit(ok ? 0 : 1);
}).catch((e) => bail('OVERLAY_ERROR: ' + (e && e.stack || e)));
