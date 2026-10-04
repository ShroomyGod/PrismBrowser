'use strict';

// End-to-end regression test for theme controls in the shell and Settings page.
const { app } = require('electron');
const path = require('path');
const M = (name) => require(path.join(__dirname, '..', 'src', 'main', name));
const fail = (message) => { console.error(message); try { app.exit(1); } catch (_) {} };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const timeout = setTimeout(() => fail('THEME_UI_TIMEOUT'), 45000);

const protocols = M('protocols');
protocols.privilegedSchemes();
const securestore = M('securestore');
const settings = M('settings');

app.whenReady().then(async () => {
  securestore.init();
  securestore.initCrypto();
  settings.init();
  M('stores').init();
  const originalAppearance = JSON.parse(JSON.stringify(settings.all().appearance));
  const tabs = M('tabs');
  tabs.init();
  const sessions = M('sessions').setupPartitions(tabs);
  tabs.setSessions(sessions);
  protocols.registerHandlers();
  protocols.registerOnSession(sessions.mainSession);
  protocols.registerOnSession(sessions.privSession);
  M('shell-ipc').registerIpc(tabs);
  M('menus').buildAppMenu(tabs);

  try {
    settings.set({ appearance: {
      theme: 'dark',
      visualTheme: { hue: 142, saturation: 75, gradient: 'forest', motion: 'drift', intensity: 45 },
      accessibility: { textScale: 115, contrast: 'high', largerTargets: true, reducedMotion: 'reduce', focusIndicators: true }
    } });
    const wid = tabs.createWindow({ urls: ['prism://settings'] });
    const record = tabs.windowRecord(wid);
    const shellWc = record.shellView.webContents;
    const page = tabs.tabs.get(record.tabs[0]).view.webContents;
    await Promise.all([
      new Promise((resolve) => shellWc.once('did-finish-load', resolve)),
      new Promise((resolve) => page.once('did-finish-load', resolve))
    ]);
    await wait(900);
    const initial = await page.executeJavaScript(`({
      api: typeof window.PrismTheme,
      count: document.querySelectorAll('#theme-grid .theme-swatch').length,
      page: document.querySelector('#theme-page')?.textContent,
      theme: document.documentElement.dataset.theme,
      hue: getComputedStyle(document.documentElement).getPropertyValue('--theme-hue').trim(),
      contrast: document.documentElement.dataset.contrast,
      targets: document.documentElement.dataset.largeTargets,
      motion: document.documentElement.dataset.reduceMotion,
      scaledFont: getComputedStyle(document.body).fontSize
    })`);
    if (initial.api !== 'object' || initial.count !== 24 || initial.page !== '1 / 2880' ||
        initial.theme !== 'dark' || initial.hue !== '142' || initial.contrast !== 'high' ||
        initial.targets !== 'true' || initial.motion !== 'reduce' || initial.scaledFont !== '16.1px') {
      throw new Error('Initial settings appearance/accessibility did not apply: ' + JSON.stringify(initial));
    }

    // Exercise the same clicks and input/change events that the user-facing UI
    // uses, rather than only checking that controls exist in the DOM.
    await page.executeJavaScript(`document.querySelector('#theme-grid .theme-swatch:nth-child(6)').click(); true`);
    await page.executeJavaScript(`document.getElementById('theme-next').click(); true`);
    await wait(150);
    const nextPage = await page.executeJavaScript(`document.getElementById('theme-page').textContent`);
    await page.executeJavaScript(`document.getElementById('theme-prev').click(); true`);
    await wait(150);
    const firstPage = await page.executeJavaScript(`document.getElementById('theme-page').textContent`);
    if (nextPage !== '2 / 2880' || firstPage !== '1 / 2880') throw new Error('Theme gallery pagination failed');
    await wait(350);
    await page.executeJavaScript(`
      const hue = document.getElementById('hue');
      hue.value = '205'; hue.dispatchEvent(new Event('input', { bubbles: true }));
      hue.dispatchEvent(new Event('change', { bubbles: true }));
      const contrast = document.getElementById('contrast');
      contrast.value = 'normal'; contrast.dispatchEvent(new Event('change', { bubbles: true }));
      const motion = document.getElementById('reduced-motion');
      motion.value = 'no-preference'; motion.dispatchEvent(new Event('change', { bubbles: true }));
      true;
    `);
    await wait(450);

    // Exercise shell popup controls, including the real preference write back
    // into the open Settings page and the stored profile.
    await shellWc.executeJavaScript(`document.getElementById('theme-btn').click()`);
    await shellWc.executeJavaScript(`
      const gradient = document.getElementById('shell-gradient');
      gradient.value = 'ocean'; gradient.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('[data-base-theme="light"]').click();
      true;
    `);
    await wait(700);

    const shell = await shellWc.executeJavaScript(`({
      api: typeof window.PrismTheme,
      hue: getComputedStyle(document.documentElement).getPropertyValue('--theme-hue').trim(),
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      theme: document.documentElement.dataset.theme,
      motion: document.documentElement.dataset.motion,
      gradient: document.documentElement.dataset.gradient,
      privateVpnMenu: !!document.querySelector('[data-act="vpn"]')
    })`);
    const pageState = await page.executeJavaScript(`({
      count: document.querySelectorAll('#theme-grid .theme-swatch').length,
      theme: document.documentElement.dataset.theme,
      hue: getComputedStyle(document.documentElement).getPropertyValue('--theme-hue').trim(),
      gradient: document.documentElement.dataset.gradient,
      contrast: document.documentElement.dataset.contrast,
      motion: document.documentElement.dataset.reduceMotion,
      focus: document.documentElement.dataset.focusVisible
    })`);
    const stored = settings.all().appearance;
    console.log('SHELL_THEME=' + JSON.stringify(shell));
    console.log('SETTINGS_THEME=' + JSON.stringify(pageState));
    const ok = shell.api === 'object' && shell.theme === 'light' && shell.gradient === 'ocean' &&
      shell.hue === '205' && shell.motion === 'shimmer' && !shell.privateVpnMenu &&
      pageState.count === 24 && pageState.theme === 'light' && pageState.hue === '205' &&
      pageState.gradient === 'ocean' && pageState.contrast === 'normal' &&
      pageState.motion === 'allow' && pageState.focus === 'strong' &&
      stored.theme === 'light' && stored.visualTheme.gradient === 'ocean' && stored.visualTheme.hue === 205 &&
      stored.accessibility.reducedMotion === 'no-preference';
    console.log(ok ? 'THEME_UI_OK' : 'THEME_UI_FAIL');

    settings.set({ appearance: originalAppearance });
    clearTimeout(timeout);
    app.exit(ok ? 0 : 1);
  } catch (error) {
    settings.set({ appearance: originalAppearance });
    fail('THEME_UI_ERROR: ' + (error && error.stack || error));
  }
}).catch((error) => fail('THEME_UI_BOOT_ERROR: ' + (error && error.stack || error)));
