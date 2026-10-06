'use strict';

// End-to-end regression test for theme controls in the shell and Settings page.
//
// The gallery changed shape on purpose: 124 curated presets in 12 categories
// replaced the old 69,120-combination generator, so the swatch count is now
// PrismTheme.PRESETS.length rather than a fixed 24 and the "1 / 2880" paging
// indicator is gone entirely (the whole catalog is on one page). These
// assertions verify the curated behaviour rather than the old generated one.
const { app } = require('electron');
const path = require('path');
const M = (name) => require(path.join(__dirname, '..', 'src', 'main', name));
const fail = (message) => { console.error(message); try { app.exit(1); } catch (_) {} };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const timeout = setTimeout(() => fail('THEME_UI_TIMEOUT'), 45000);

// The shell coalesces theme writes behind a 120ms debounce, so a fixed sleep
// races it. Background timer throttling is disabled for the same reason: the
// chrome is a WebContentsView that can be reported as occluded in a headless
// run, which stalls that debounce long past any fixed wait.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

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
      themePreset: 'forest',
      animationTheme: 'playful',
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
      count: document.querySelectorAll('#theme-grid .theme-card').length,
      presets: window.PrismTheme.PRESETS.length,
      categories: document.querySelectorAll('#theme-categories .theme-category').length,
      sections: document.querySelectorAll('#theme-grid .theme-section').length,
      selected: document.querySelectorAll('#theme-grid .theme-card[aria-pressed="true"]').length,
      selectedId: document.querySelector('#theme-grid .theme-card[aria-pressed="true"]')?.dataset.preset,
      retired: !!document.getElementById('theme-page') || !!document.getElementById('hue'),
      countLabel: document.getElementById('theme-count')?.textContent,
      theme: document.documentElement.dataset.theme,
      preset: document.documentElement.dataset.themePreset,
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      contrast: document.documentElement.dataset.contrast,
      targets: document.documentElement.dataset.largeTargets,
      motion: document.documentElement.dataset.reduceMotion,
      animationTheme: document.documentElement.dataset.animationTheme,
      scaledFont: getComputedStyle(document.body).fontSize
    })`);
    if (initial.api !== 'object' || initial.count !== initial.presets || initial.count < 100 ||
        initial.categories !== 12 || initial.sections !== 12 || initial.selected !== 1 ||
        initial.selectedId !== 'forest' || initial.retired || initial.countLabel !== initial.presets + ' themes' ||
        initial.theme !== 'dark' || initial.preset !== 'forest' || initial.accent !== '#7bd88f' ||
        initial.contrast !== 'high' || initial.targets !== 'true' || initial.motion !== 'reduce' ||
        initial.animationTheme !== 'playful' || initial.scaledFont !== '16.1px') {
      throw new Error('Initial settings appearance/accessibility did not apply: ' + JSON.stringify(initial));
    }

    // Exercise the same clicks and input/change events that the user-facing UI
    // uses, rather than only checking that controls exist in the DOM.
    await page.executeJavaScript(`document.querySelector('#theme-grid .theme-card[data-preset="nord"]').click(); true`);
    await page.executeJavaScript(`document.getElementById('theme-categories').children[5].click(); true`);
    await wait(350);
    const afterClick = await page.executeJavaScript(`({
      preset: document.documentElement.dataset.themePreset,
      selected: document.querySelector('#theme-grid .theme-card[aria-pressed="true"]')?.dataset.preset
    })`);
    if (afterClick.preset !== 'nord' || afterClick.selected !== 'nord') {
      throw new Error('Selecting a preset did not apply it: ' + JSON.stringify({ preset: afterClick.preset, selected: afterClick.selected }));
    }
    await page.executeJavaScript(`
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
    const shellList = await shellWc.executeJavaScript(`({
      rows: document.querySelectorAll('#theme-presets .theme-preset').length,
      categories: document.querySelectorAll('#theme-presets .theme-preset-category').length,
      retired: !!document.getElementById('shell-hue') || !!document.querySelector('[data-base-theme]'),
      pressed: document.querySelector('#theme-presets .theme-preset[aria-pressed="true"]')?.dataset.preset
    })`);
    if (shellList.retired || shellList.rows < 20 || shellList.pressed !== 'nord') {
      throw new Error('Shell theme popup does not list presets: ' + JSON.stringify(shellList));
    }
    await shellWc.executeJavaScript(`document.querySelector('#theme-presets .theme-preset[data-preset="paper"]').click(); true`);
    // Poll until the debounced write has actually propagated to the open
    // Settings page. This waits for the real condition rather than for a
    // guessed duration, and still asserts the same end state below.
    let propagated = false;
    for (let attempt = 0; attempt < 40 && !propagated; attempt++) {
      await wait(150);
      const seen = await Promise.all([
        shellWc.executeJavaScript(`document.documentElement.dataset.themePreset`),
        page.executeJavaScript(`document.documentElement.dataset.themePreset`)
      ]);
      propagated = seen[0] === 'paper' && seen[1] === 'paper';
    }
    if (!propagated) throw new Error('Choosing a theme in the shell never reached the Settings page');
    await page.executeJavaScript(`
      const animation = document.getElementById('animation-theme');
      animation.value = 'smooth'; animation.dispatchEvent(new Event('change', { bubbles: true }));
      true;
    `);
    await wait(400);
    const animationSetting = await page.executeJavaScript(`document.documentElement.dataset.animationTheme`);
    if (animationSetting !== 'smooth' || settings.all().appearance.animationTheme !== 'smooth') {
      throw new Error('Selecting an animation theme did not persist: ' + animationSetting);
    }
    const animatedTab = tabs.createTab(wid, 'prism://newtab', { background: true });
    let enteringTab = false;
    for (let attempt = 0; attempt < 40 && !enteringTab; attempt++) {
      enteringTab = await shellWc.executeJavaScript(`!!document.querySelector('.tab[data-tab-id="${animatedTab}"].tab-entering')`);
      if (!enteringTab) await wait(10);
    }
    if (!enteringTab) throw new Error('New tab did not animate into the tab strip');
    tabs.closeTab(animatedTab);
    let leavingTab = false;
    for (let attempt = 0; attempt < 15 && !leavingTab; attempt++) {
      leavingTab = await shellWc.executeJavaScript(`!!document.querySelector('.tab[data-tab-id="${animatedTab}"].tab-leaving')`);
      if (!leavingTab) await wait(10);
    }
    if (!leavingTab) throw new Error('Closed tab did not animate out of the tab strip');

    const shell = await shellWc.executeJavaScript(`({
      api: typeof window.PrismTheme,
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      frame: getComputedStyle(document.documentElement).getPropertyValue('--chrome-color').trim(),
      theme: document.documentElement.dataset.theme,
      preset: document.documentElement.dataset.themePreset,
      motion: document.documentElement.dataset.motion,
      privateVpnMenu: !!document.querySelector('[data-act="vpn"]')
    })`);
    const pageState = await page.executeJavaScript(`({
      count: document.querySelectorAll('#theme-grid .theme-card').length,
      theme: document.documentElement.dataset.theme,
      preset: document.documentElement.dataset.themePreset,
      frame: getComputedStyle(document.documentElement).getPropertyValue('--chrome-color').trim(),
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      contrast: document.documentElement.dataset.contrast,
      motion: document.documentElement.dataset.reduceMotion,
      animationTheme: document.documentElement.dataset.animationTheme,
      focus: document.documentElement.dataset.focusVisible
    })`);
    const stored = settings.all().appearance;
    console.log('SHELL_THEME=' + JSON.stringify(shell));
    console.log('SETTINGS_THEME=' + JSON.stringify(pageState));
    const ok = shell.api === 'object' && shell.theme === 'light' && shell.preset === 'paper' &&
      shell.motion === 'none' && !shell.privateVpnMenu &&
      shell.frame === pageState.frame && shell.accent === pageState.accent &&
      pageState.count === 124 && pageState.theme === 'light' && pageState.preset === 'paper' &&
      pageState.contrast === 'normal' && pageState.motion === 'allow' && pageState.focus === 'strong' &&
      stored.theme === 'light' && stored.themePreset === 'paper' &&
      stored.accessibility.reducedMotion === 'no-preference' &&
      stored.animationTheme === 'smooth';
    console.log(ok ? 'THEME_UI_OK' : 'THEME_UI_FAIL');

    settings.set({ appearance: originalAppearance });
    clearTimeout(timeout);
    app.exit(ok ? 0 : 1);
  } catch (error) {
    settings.set({ appearance: originalAppearance });
    fail('THEME_UI_ERROR: ' + (error && error.stack || error));
  }
}).catch((error) => fail('THEME_UI_BOOT_ERROR: ' + (error && error.stack || error)));
