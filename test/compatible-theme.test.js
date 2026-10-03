// Site-theme compatibility regression test.
// The browser appearance must never recolor page content. A color-scheme hint
// is allowed only when the site opts in with a color-scheme declaration.
const { app, BrowserWindow, WebContentsView } = require('electron');
const path = require('path');
const M = (p) => require(path.join(__dirname, '..', 'src', 'main', p));

const fail = (message) => { console.error(message); try { app.exit(1); } catch (_) {} };
setTimeout(() => fail('SITE_THEME_TIMEOUT'), 30000);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const securestore = M('securestore');
  securestore.init();
  securestore.initCrypto();
  const settings = M('settings');
  settings.init();
  settings.set({ appearance: { theme: 'dark', siteTheme: 'dark' } });

  const win = new BrowserWindow({ show: false, width: 640, height: 480 });
  const view = new WebContentsView();
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 640, height: 480 });
  const tabs = M('tabs');

  const checkPage = async (markup) => {
    await view.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(markup));
    const tab = { url: 'https://theme-check.invalid/', view };
    tabs._applyCompatibleSiteTheme(tab);
    await wait(100);
    return view.webContents.executeJavaScript(`({
      marker: !!document.getElementById('prism-compatible-color-scheme'),
      background: getComputedStyle(document.body).backgroundColor,
      color: getComputedStyle(document.body).color,
      forcedStyle: !!document.getElementById('prism-theme-style')
    })`);
  };

  const unsupported = await checkPage('<!doctype html><html><body style="background: rgb(1, 2, 3); color: rgb(4, 5, 6)">site colors</body></html>');
  console.log('UNSUPPORTED=' + JSON.stringify(unsupported));
  const compatible = await checkPage('<!doctype html><html><head><meta name="color-scheme" content="light dark"></head><body style="background: rgb(1, 2, 3); color: rgb(4, 5, 6)">site colors</body></html>');
  console.log('COMPATIBLE=' + JSON.stringify(compatible));

  const ok = !unsupported.marker && !unsupported.forcedStyle &&
    unsupported.background === 'rgb(1, 2, 3)' && unsupported.color === 'rgb(4, 5, 6)' &&
    compatible.marker && !compatible.forcedStyle &&
    compatible.background === 'rgb(1, 2, 3)' && compatible.color === 'rgb(4, 5, 6)';
  console.log(ok ? 'SITE_THEME_OK' : 'SITE_THEME_FAIL');
  app.exit(ok ? 0 : 1);
}).catch((e) => fail('SITE_THEME_ERROR: ' + (e && e.stack || e)));
