// Verifies the layout contract in a real window: the page view must start
// exactly at the bottom of the shell chrome, so nothing overlaps the toolbar.
// Also confirms the bookmarks bar pushes the page down rather than overlaying.
const { app } = require('electron');
const path = require('path');

const M = (p) => require(path.join(__dirname, '..', 'src', 'main', p));

// Never let a failure hang the run waiting on a dialog.
const bail = (msg, code) => { console.error(msg); try { app.exit(code || 1); } catch (_) {} };
setTimeout(() => bail('LAYOUT_TIMEOUT'), 45000);

app.whenReady().then(async () => {
  // Mirror main.js boot order: bootstrap settings, then open the vault.
  const securestore = M('securestore');
  securestore.init();
  securestore.initCrypto();
  const settings = M('settings');
  settings.init();
  M('stores').init();

  const tabs = M('tabs');
  // Tabs read the session partitions for extension/adblock wiring, same as main.
  tabs.setSessions(M('sessions').setupPartitions(tabs));
  M('shell-ipc').registerIpc(tabs);   // carries prism:chrome-height/shell-extent
  M('menus').buildAppMenu(tabs);
  const wid = tabs.createWindow();
  const rec = tabs.windowRecord(wid);

  // The shell lives in its own topmost WebContentsView.
  const shellWc = rec.shellView.webContents;
  await new Promise((r) => shellWc.once('did-finish-load', r));
  await new Promise((r) => setTimeout(r, 1500)); // let the shell report its height

  const measured = await shellWc.executeJavaScript(`(() => {
    const g = (id) => document.getElementById(id);
    const cs = getComputedStyle(document.documentElement);
    return {
      topH: Math.round(g('chrome-top').getBoundingClientRect().height),
      stripH: Math.round(g('tabstrip').getBoundingClientRect().height),
      barH: Math.round(g('toolbar').getBoundingClientRect().height),
      chromeVar: cs.getPropertyValue('--chrome-h').trim(),
      bg: cs.getPropertyValue('--bg').trim(),
      accent: cs.getPropertyValue('--accent').trim(),
      omniBottom: Math.round(g('omnibox').getBoundingClientRect().bottom),
      barBottom: Math.round(g('toolbar').getBoundingClientRect().bottom),
      barPos: getComputedStyle(g('bookmarksbar')).position
    };
  })()`);

  const tab = tabs.tabs.get(rec.tabs[0]);
  const b = tab.view.getBounds();
  const winH = rec.win.getContentSize()[1];

  console.log('CHROME_TOP_H=' + measured.topH + ' (strip ' + measured.stripH + ' + toolbar ' + measured.barH + ')');
  console.log('CHROME_VAR=' + measured.chromeVar);
  console.log('MAIN_RECORD_H=' + rec.chromeHeight);
  console.log('PAGE_BOUNDS=' + JSON.stringify(b) + ' WIN_H=' + winH);
  console.log('BG=' + measured.bg + ' ACCENT=' + measured.accent);
  console.log('OMNIBOX_BOTTOM=' + measured.omniBottom + ' TOOLBAR_BOTTOM=' + measured.barBottom);
  console.log('BOOKMARKS_BAR_POSITION=' + measured.barPos);

  const noOverlap = b.y === rec.chromeHeight && rec.chromeHeight === measured.topH;
  const fillsRest = b.height === winH - rec.chromeHeight;
  const neutral = measured.bg.toLowerCase() === '#0c0c0c';
  const omniboxInside = measured.omniBottom <= measured.topH;
  const barInFlow = measured.barPos === 'static';

  // The shell must be the TOPMOST view so its popups paint above the page.
  const kids = rec.win.contentView.children;
  const shellOnTop = kids.length > 0 && kids[kids.length - 1] === rec.shellView;
  console.log('SHELL_ON_TOP=' + shellOnTop + ' CHILDREN=' + kids.length);
  console.log(shellOnTop ? 'SHELL_TOPMOST_OK' : 'SHELL_TOPMOST_FAIL');

  console.log(noOverlap ? 'NO_OVERLAP_OK' : 'NO_OVERLAP_FAIL');
  console.log(fillsRest ? 'FILL_OK' : 'FILL_FAIL');
  console.log(neutral ? 'THEME_OK' : 'THEME_FAIL');
  console.log(omniboxInside ? 'OMNIBOX_OK' : 'OMNIBOX_FAIL');
  console.log(barInFlow ? 'BOOKMARKS_IN_FLOW_OK' : 'BOOKMARKS_IN_FLOW_FAIL');

  const ok = noOverlap && fillsRest && neutral && omniboxInside && barInFlow && shellOnTop;
  app.exit(ok ? 0 : 1);
}).catch((e) => bail('LAYOUT_ERROR: ' + (e && e.stack || e)));
