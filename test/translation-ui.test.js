// translation-ui.test.js — real Electron smoke test for the local language picker.
'use strict';

const { app } = require('electron');
const path = require('path');
const M = (name) => require(path.join(__dirname, '..', 'src', 'main', name));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const timeout = setTimeout(() => {
  console.error('TRANSLATION_UI_TIMEOUT');
  try { app.exit(1); } catch (_) {}
}, 30000);
const protocols = M('protocols');
protocols.privilegedSchemes();

app.whenReady().then(async () => {
  try {
    M('securestore').init();
    M('securestore').initCrypto();
    M('settings').init();
    M('stores').init();
    const tabs = M('tabs');
    tabs.init();
    const sessions = M('sessions').setupPartitions(tabs);
    tabs.setSessions(sessions);
    protocols.registerHandlers();
    protocols.registerOnSession(sessions.mainSession);
    protocols.registerOnSession(sessions.privSession);
    M('shell-ipc').registerIpc(tabs);

    const wid = tabs.createWindow({ urls: ['https://example.com'] });
    const record = tabs.windowRecord(wid);
    const shell = record.shellView.webContents;
    for (let i = 0; i < 120 && (!shell.getURL() || shell.isLoading()); i++) await wait(100);
    if (!shell.getURL() || shell.isLoading()) throw new Error('shell did not finish loading: ' + shell.getURL());
    await wait(500);
    const list = await shell.executeJavaScript(`(async () => {
      const result = await window.prismShell.aiTranslationLanguages();
      document.getElementById('menu-btn').click();
      const row = document.querySelector('#menu-panel .mi[data-id="translate"]');
      if (!row) return { error: 'translate menu item missing', count: result.length };
      // Click the real menu item and wait for its action to fetch/populate the
      // language options through the preload and IPC bridge.
      row.click();
      for (let i = 0; i < 100; i++) {
        const source = document.getElementById('translation-source');
        const target = document.getElementById('translation-target');
        if (source && target && source.options.length) return {
          count: result.length,
          sourceCount: source.options.length,
          targetCount: target.options.length,
          first: source.options[0].textContent,
          hasEnglish: Array.from(source.options).some((option) => option.value === 'en' && option.textContent === 'English'),
          hasHindi: Array.from(target.options).some((option) => option.value === 'hi' && option.textContent === 'Hindi'),
          hasChinese: Array.from(target.options).some((option) => option.value === 'zh' && option.textContent === 'Chinese'),
          modelNote: document.querySelector('.translation-note').textContent,
          panelVisible: document.getElementById('translation-pop').style.display !== 'none'
        };
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return { error: 'picker options never loaded', count: result.length };
    })()`);
    console.log('TRANSLATION_PICKER=' + JSON.stringify(list));
    if (list.error || list.count !== 100 || list.sourceCount !== 100 || list.targetCount !== 100 ||
      !list.hasEnglish || !list.hasHindi || !list.hasChinese || !list.panelVisible || !/100 languages/.test(list.modelNote)) {
      throw new Error('language picker did not render the 100-language local model correctly');
    }
    console.log('TRANSLATION_UI_OK');
    clearTimeout(timeout);
    app.quit();
  } catch (error) {
    console.error('TRANSLATION_UI_ERROR ' + ((error && error.stack) || error));
    clearTimeout(timeout);
    try { app.exit(1); } catch (_) {}
  }
});
