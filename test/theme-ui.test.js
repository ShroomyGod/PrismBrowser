'use strict';

// End-to-end regression test for theme controls in the shell and Settings page.
//
// The gallery presents 35 hand-designed presets in 6 categories: rich gradient
// frames (never flat outside the three calm Default basics), animated chrome
// on 31 of them, and a custom glowing cursor per theme. The whole catalog is
// on one page. These assertions verify the gallery behaviour.
const { app } = require('electron');
const path = require('path');
const http = require('http');
const M = (name) => require(path.join(__dirname, '..', 'src', 'main', name));
let cursorFixtureServer = null;
function closeCursorFixtureServer() {
  if (!cursorFixtureServer) return;
  cursorFixtureServer.close();
  cursorFixtureServer = null;
}
const fail = (message) => { console.error(message); closeCursorFixtureServer(); try { app.exit(1); } catch (_) {} };
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
      themePreset: 'forest-green',
      animationTheme: 'spring',
      customBackground: null,
      customAccent: null,
      customFrame: null,
      pixelCursor: true,
      cursorSize: 18,
      uiDensity: 'comfortable',
      tabStyle: 'rounded',
      uiFont: 'system',
      tabWidth: 220,
      accessibility: { textScale: 115, contrast: 'high', largerTargets: true, reducedMotion: 'reduce', focusIndicators: true }
    } });
    cursorFixtureServer = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html><body><button id="fixture-button">Open</button><input id="fixture-input"><a href="#">Link</a></body></html>');
    });
    await new Promise((resolve, reject) => {
      cursorFixtureServer.once('error', reject);
      cursorFixtureServer.listen(0, '127.0.0.1', resolve);
    });
    const cursorFixtureUrl = 'http://127.0.0.1:' + cursorFixtureServer.address().port;
    const wid = tabs.createWindow({ urls: ['prism://settings'] });
    const record = tabs.windowRecord(wid);
    const shellWc = record.shellView.webContents;
    const page = tabs.tabs.get(record.tabs[0]).view.webContents;
    await Promise.all([
      new Promise((resolve) => shellWc.once('did-finish-load', resolve)),
      new Promise((resolve) => page.once('did-finish-load', resolve))
    ]);
    await wait(900);
    const shellCursor = await shellWc.executeJavaScript(`(() => {
      const tab = document.querySelector('.tab');
      const bookmark = document.createElement('div'); bookmark.className = 'bm'; document.getElementById('bookmarksbar').append(bookmark);
      const input = document.createElement('input'); input.type = 'text'; document.getElementById('chrome-top').append(input);
      return {
        tab: getComputedStyle(tab).cursor,
        bookmark: getComputedStyle(bookmark).cursor,
        text: getComputedStyle(input).cursor,
        size: document.documentElement.dataset.cursorSize
      };
    })()`);
    if (!shellCursor.tab.includes('data:image/svg+xml') || !shellCursor.bookmark.includes('data:image/svg+xml') ||
        !shellCursor.text.includes('data:image/svg+xml') || !shellCursor.text.endsWith(', text') || shellCursor.size !== '18') {
      throw new Error('Shell tabs, bookmark chips, and text boxes should use configured pixel cursors: ' + JSON.stringify(shellCursor));
    }
    await page.loadURL('prism://newtab');
    await wait(150);
    const newtabSearchFocus = await page.executeJavaScript(`(() => {
      const input = document.getElementById('q');
      const wrapper = document.getElementById('form');
      document.documentElement.dataset.focusVisible = 'strong';
      input.focus();
      return {
        hasInput: !!input,
        inputOutline: input && getComputedStyle(input).outlineStyle,
        wrapperFocus: wrapper && wrapper.matches(':focus-within'),
        wrapperShadow: wrapper && getComputedStyle(wrapper).boxShadow
      };
    })()`);
    if (!newtabSearchFocus.hasInput || newtabSearchFocus.inputOutline !== 'none' ||
        !newtabSearchFocus.wrapperFocus || !newtabSearchFocus.wrapperShadow || newtabSearchFocus.wrapperShadow === 'none') {
      throw new Error('New-tab search should show only the visible wrapper focus ring: ' + JSON.stringify(newtabSearchFocus));
    }
    await page.loadURL('prism://settings');
    await wait(500);
    const initial = await page.executeJavaScript(`({
      api: typeof window.PrismTheme,
      count: document.querySelectorAll('#theme-grid .theme-card').length,
      presets: window.PrismTheme.PRESETS.length,
      animatedThemes: window.PrismTheme.PRESETS.filter((item) => item.motion && item.motion !== 'none').map((item) => item.id).sort(),
      cursorEnabled: document.documentElement.dataset.pixelCursor,
      cursorStyle: getComputedStyle(document.documentElement).getPropertyValue('--cursor-image'),
      cursorPointerStyle: getComputedStyle(document.documentElement).getPropertyValue('--cursor-pointer-image'),
      cursorTextStyle: getComputedStyle(document.documentElement).getPropertyValue('--cursor-text-image'),
      cursorSize: document.documentElement.dataset.cursorSize,
      categories: document.querySelectorAll('#theme-categories .theme-category').length,
      sections: document.querySelectorAll('#theme-grid .theme-section').length,
      selected: document.querySelectorAll('#theme-grid .theme-card[aria-pressed="true"]').length,
      selectedId: document.querySelector('#theme-grid .theme-card[aria-pressed="true"]')?.dataset.preset,
      retired: !!document.getElementById('theme-page') || !!document.getElementById('hue'),
      countLabel: document.getElementById('theme-count')?.textContent,
      defaultBrowserButton: document.getElementById('set-default-browser')?.textContent,
      defaultBrowserNote: document.getElementById('default-browser-status')?.textContent,
      theme: document.documentElement.dataset.theme,
      preset: document.documentElement.dataset.themePreset,
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      pixelCursor: document.documentElement.dataset.pixelCursor,
      cursorPointer: getComputedStyle(document.querySelector('.theme-card[data-preset="space-galaxy"]')).cursor,
      contrast: document.documentElement.dataset.contrast,
      targets: document.documentElement.dataset.largeTargets,
      motion: document.documentElement.dataset.reduceMotion,
      animationTheme: document.documentElement.dataset.animationTheme,
      animationPacks: document.querySelectorAll('.animation-pack').length,
      density: document.documentElement.dataset.uiDensity,
      tabStyle: document.documentElement.dataset.tabStyle,
      scaledFont: getComputedStyle(document.body).fontSize
    })`);
    if (initial.api !== 'object' || initial.count !== initial.presets || initial.count !== 35 ||
        initial.presets !== 35 || initial.animatedThemes.length !== 31 ||
        !initial.animatedThemes.includes('space-galaxy') || !initial.animatedThemes.includes('cyberpunk') || !initial.animatedThemes.includes('custom-alien') ||
        initial.cursorEnabled !== 'true' || !initial.cursorStyle.includes('data:image/svg+xml') ||
        !initial.cursorPointerStyle.includes('data:image/svg+xml') ||
        !initial.cursorTextStyle.includes('data:image/svg+xml') || initial.cursorSize !== '18' ||
        initial.categories !== 6 || initial.sections !== 6 || initial.selected !== 1 ||
        initial.selectedId !== 'forest-green' || initial.retired || initial.countLabel !== initial.presets + ' themes · 31 animated' ||
        !['Set as default', 'Default browser'].includes(initial.defaultBrowserButton) ||
        !initial.defaultBrowserNote || initial.defaultBrowserNote.includes('Checking') ||
        initial.theme !== 'dark' || initial.preset !== 'forest-green' || initial.accent !== '#4ade80' ||
        initial.contrast !== 'high' || initial.targets !== 'true' || initial.motion !== 'reduce' ||
        initial.animationTheme !== 'spring' || initial.scaledFont !== '16.1px' ||
        initial.animationPacks !== 5 || initial.density !== 'comfortable' || initial.tabStyle !== 'rounded') {
      throw new Error('Initial settings appearance/accessibility did not apply: ' + JSON.stringify(initial));
    }

    // Exercise the same clicks and input/change events that the user-facing UI
    // uses, rather than only checking that controls exist in the DOM.
    await page.executeJavaScript(`document.querySelector('#theme-grid .theme-card[data-preset="neon-purple"]').click(); true`);
    await page.executeJavaScript(`document.getElementById('theme-categories').children[5].click(); true`);
    await wait(350);
    const afterClick = await page.executeJavaScript(`({
      preset: document.documentElement.dataset.themePreset,
      selected: document.querySelector('#theme-grid .theme-card[aria-pressed="true"]')?.dataset.preset
    })`);
    if (afterClick.preset !== 'neon-purple' || afterClick.selected !== 'neon-purple') {
      throw new Error('Selecting a preset did not apply it: ' + JSON.stringify({ preset: afterClick.preset, selected: afterClick.selected }));
    }
    await page.executeJavaScript(`document.querySelector('#theme-grid .theme-card[data-preset="space-galaxy"]').click(); true`);
    await wait(300);
    const artSelection = await Promise.all([
      page.executeJavaScript(`({ preset: document.documentElement.dataset.themePreset, cursor: document.documentElement.dataset.cursorName, motion: document.documentElement.dataset.themeMotion, chrome: getComputedStyle(document.documentElement).getPropertyValue('--chrome-bg') })`),
      shellWc.executeJavaScript(`({ cursor: document.documentElement.dataset.cursorName, motion: document.documentElement.dataset.themeMotion, image: getComputedStyle(document.getElementById('chrome-top')).backgroundImage, animation: getComputedStyle(document.getElementById('chrome-top')).animationName })`)
    ]);
    if (artSelection[0].preset !== 'space-galaxy' || artSelection[0].cursor !== 'galaxy' ||
        !artSelection[0].chrome.includes('linear-gradient') || artSelection[1].cursor !== 'galaxy' ||
        artSelection[1].motion !== 'drift' || !artSelection[1].image.includes('linear-gradient')) {
      throw new Error('Selecting an animated theme did not render its gradient and cursor in the page and shell: ' + JSON.stringify(artSelection));
    }
    await page.executeJavaScript(`document.querySelector('#theme-grid .theme-card[data-preset="neon-purple"]').click(); true`);
    await wait(250);
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
    if (shellList.retired || shellList.rows < 20 || shellList.pressed !== 'neon-purple') {
      throw new Error('Shell theme popup does not list presets: ' + JSON.stringify(shellList));
    }
    await shellWc.executeJavaScript(`document.querySelector('#theme-presets .theme-preset[data-preset="sand-desert"]').click(); true`);
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
      propagated = seen[0] === 'sand-desert' && seen[1] === 'sand-desert';
    }
    if (!propagated) throw new Error('Choosing a theme in the shell never reached the Settings page');
    await page.executeJavaScript(`
      document.querySelector('.animation-pack[data-animation="fluent"]').click();
      document.getElementById('ui-density').value = 'spacious';
      document.getElementById('ui-density').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('tab-style').value = 'pill';
      document.getElementById('tab-style').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('ui-font').value = 'mono';
      document.getElementById('ui-font').dispatchEvent(new Event('change', { bubbles: true }));
      const tabWidth = document.getElementById('tab-width');
      tabWidth.value = '260'; tabWidth.dispatchEvent(new Event('input', { bubbles: true })); tabWidth.dispatchEvent(new Event('change', { bubbles: true }));
      const customAccent = document.getElementById('custom-accent');
      customAccent.value = '#d1008a'; customAccent.dispatchEvent(new Event('input', { bubbles: true }));
      true;
    `);
    await page.executeJavaScript(`document.getElementById('tab-width').dispatchEvent(new Event('change', { bubbles: true })); true`);
    await wait(650);
    const customization = await page.executeJavaScript(`({
      animation: document.documentElement.dataset.animationTheme,
      density: document.documentElement.dataset.uiDensity,
      tabStyle: document.documentElement.dataset.tabStyle,
      font: document.documentElement.dataset.uiFont,
      fontStack: getComputedStyle(document.documentElement).getPropertyValue('--ui-font').trim(),
      tabWidth: getComputedStyle(document.documentElement).getPropertyValue('--tab-w').trim(),
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      preview: document.getElementById('appearance-preview').dataset.tabStyle,
      pixelCursor: document.documentElement.dataset.pixelCursor,
      cursorPointer: getComputedStyle(document.querySelector('.theme-card[data-preset="space-galaxy"]')).cursor,
      cursorName: document.querySelector('.theme-card[data-preset="space-galaxy"]').dataset.preset,
      thumbCursor: getComputedStyle(document.querySelector('.theme-card[data-preset="space-galaxy"] .theme-thumb-cursor')).backgroundImage,
      thumbBackground: getComputedStyle(document.querySelector('.theme-card[data-preset="cyberpunk"] .theme-thumb')).backgroundImage,
      thumbWait: getComputedStyle(document.documentElement).getPropertyValue('--cursor-wait-image'),
      thumbMove: getComputedStyle(document.documentElement).getPropertyValue('--cursor-move-image')
    })`);
    if (customization.animation !== 'fluent' || customization.density !== 'spacious' ||
        customization.tabStyle !== 'pill' || customization.font !== 'mono' || !customization.fontStack.includes('Cascadia Code') ||
        customization.tabWidth !== '260px' || customization.accent.toLowerCase() !== '#d1008a' || customization.preview !== 'pill' ||
        customization.cursorName !== 'space-galaxy' || !customization.thumbBackground.includes('linear-gradient') ||
        !customization.thumbWait.includes('data:image/svg+xml') ||
        !customization.thumbMove.includes('data:image/svg+xml') ||
        !customization.thumbCursor.includes('data:image/svg+xml') || customization.pixelCursor !== 'true' ||
        !customization.cursorPointer.includes('data:image/svg+xml') ||
        settings.all().appearance.animationTheme !== 'fluent' || settings.all().appearance.tabWidth !== 260) {
      throw new Error('Custom appearance controls did not apply and persist: ' + JSON.stringify(customization));
    }
    const webTabId = tabs.createTab(wid, cursorFixtureUrl, { background: true });
    const webTab = tabs.tabs.get(webTabId);
    let webCursorApplied = false;
    for (let attempt = 0; attempt < 50 && !webCursorApplied; attempt++) {
      try {
        webCursorApplied = await webTab.view.webContents.executeJavaScript(`getComputedStyle(document.body).cursor.includes('data:image/svg+xml') && getComputedStyle(document.getElementById('fixture-button')).cursor.includes('data:image/svg+xml') && getComputedStyle(document.getElementById('fixture-input')).cursor.includes('data:image/svg+xml') && getComputedStyle(document.getElementById('fixture-input')).cursor.endsWith(', text')`);
      } catch (_) {}
      if (!webCursorApplied) await wait(40);
    }
    if (!webCursorApplied) throw new Error('Theme-tinted pixel cursors were not injected into an actual web page');
    await page.executeJavaScript(`document.getElementById('pixel-cursor').checked = false; document.getElementById('pixel-cursor').dispatchEvent(new Event('change', { bubbles: true })); true`);
    for (let attempt = 0; attempt < 50 && settings.all().appearance.pixelCursor !== false; attempt++) await wait(40);
    let webCursorDisabled = false;
    for (let attempt = 0; attempt < 50 && !webCursorDisabled; attempt++) {
      webCursorDisabled = await webTab.view.webContents.executeJavaScript(`!getComputedStyle(document.body).cursor.includes('data:image/svg+xml') && !getComputedStyle(document.getElementById('fixture-button')).cursor.includes('data:image/svg+xml')`);
      if (!webCursorDisabled) await wait(40);
    }
    if (settings.all().appearance.pixelCursor !== false || !webCursorDisabled) {
      throw new Error('Disabling pixel cursors did not remove them from the web page');
    }
    await page.executeJavaScript(`document.getElementById('pixel-cursor').checked = true; document.getElementById('pixel-cursor').dispatchEvent(new Event('change', { bubbles: true })); true`);
    for (let attempt = 0; attempt < 50 && settings.all().appearance.pixelCursor !== true; attempt++) await wait(40);
    let webCursorRestored = false;
    for (let attempt = 0; attempt < 50 && !webCursorRestored; attempt++) {
      webCursorRestored = await webTab.view.webContents.executeJavaScript(`getComputedStyle(document.body).cursor.includes('data:image/svg+xml') && getComputedStyle(document.getElementById('fixture-button')).cursor.includes('data:image/svg+xml')`);
      if (!webCursorRestored) await wait(40);
    }
    if (settings.all().appearance.pixelCursor !== true || !webCursorRestored) {
      throw new Error('Re-enabling pixel cursors did not restore them to the web page');
    }
    tabs.closeTab(webTabId);
    closeCursorFixtureServer();

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
      alienCursor: document.documentElement.dataset.cursorName,
      cursorEnabled: document.documentElement.dataset.pixelCursor,
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
    const ok = shell.api === 'object' && shell.theme === 'light' && shell.preset === 'sand-desert' &&
      shell.motion === 'drift' && !shell.privateVpnMenu &&
      shell.frame === pageState.frame && shell.accent === pageState.accent &&
      pageState.count === 35 && pageState.alienCursor === 'dune' && pageState.cursorEnabled === 'true' && pageState.theme === 'light' && pageState.preset === 'sand-desert' &&
      pageState.contrast === 'normal' && pageState.motion === 'allow' && pageState.focus === 'strong' &&
      stored.theme === 'light' && stored.themePreset === 'sand-desert' &&
      stored.accessibility.reducedMotion === 'no-preference' &&
      stored.animationTheme === 'fluent' && stored.uiDensity === 'spacious' && stored.tabStyle === 'pill' &&
      stored.uiFont === 'mono' && stored.tabWidth === 260 && stored.customAccent.toLowerCase() === '#d1008a';
    console.log(ok ? 'THEME_UI_OK' : 'THEME_UI_FAIL');

    settings.set({ appearance: originalAppearance });
    closeCursorFixtureServer();
    clearTimeout(timeout);
    app.exit(ok ? 0 : 1);
  } catch (error) {
    settings.set({ appearance: originalAppearance });
    closeCursorFixtureServer();
    fail('THEME_UI_ERROR: ' + (error && error.stack || error));
  }
}).catch((error) => fail('THEME_UI_BOOT_ERROR: ' + (error && error.stack || error)));
