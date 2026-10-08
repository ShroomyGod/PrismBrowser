'use strict';

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const M = (name) => require(path.join(__dirname, '..', 'src', 'main', name));
const fail = (error) => {
  console.error('VISION_UI_FAILED ' + ((error && error.stack) || error));
  try { app.exit(1); } catch (_) {}
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (check, label, timeoutMs = 15000) => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try { const result = await check(); if (result) return result; } catch (_) {}
    await wait(100);
  }
  throw new Error('Timed out waiting for ' + label);
};
const timer = setTimeout(() => fail(new Error('VISION_UI_TIMEOUT')), 60000);

M('protocols').privilegedSchemes();
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

app.whenReady().then(async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Vision capture fixture</title><body><h1>Capture source</h1><p>Prism Vision screenshot handoff test.</p></body>');
  });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const sourceUrl = 'http://127.0.0.1:' + server.address().port + '/';
    const protocols = M('protocols');
    const securestore = M('securestore');
    securestore.init(); securestore.initCrypto();
    M('settings').init(); M('stores').init();
    const tabs = M('tabs'); tabs.init();
    const sessions = M('sessions').setupPartitions(tabs); tabs.setSessions(sessions);
    protocols.registerHandlers();
    protocols.registerOnSession(sessions.mainSession);
    protocols.registerOnSession(sessions.privSession);
    const ai = M('ai');
    ai.analyseImage = async (image) => ({ text: 'Mock local visual summary of selected page region.', ms: 12, image });
    ai.summarise = async () => ({ text: 'Mock local page summary.', ms: 9 });
    M('shell-ipc').registerIpc(tabs);

    const wid = tabs.createWindow({ urls: [sourceUrl] });
    const record = tabs.windowRecord(wid);
    const sourceTab = tabs.tabs.get(record.active);
    const sourcePage = sourceTab.view.webContents;
    const shell = record.shellView.webContents;
    await waitFor(async () => await sourcePage.executeJavaScript('document.title') === 'Vision capture fixture', 'local source page');
    await waitFor(async () => await shell.executeJavaScript('!!window.prismShell'), 'browser shell preload');
    await waitFor(() => record.win.isVisible(), 'visible browser window');

    const startingTabCount = record.tabs.length;
    await shell.executeJavaScript("document.getElementById('menu-btn').click(); true;");
    const clickedVision = await shell.executeJavaScript(`(async () => {
      const panel = document.getElementById('menu-panel');
      const parent = panel.querySelector('.mi[data-id="ai"]');
      parent.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      for (let i = 0; i < 50; i++) {
        const row = document.querySelector('#menu-sub .mi[data-act="ai-vision"]');
        if (row && document.getElementById('menu-sub').style.display !== 'none') { row.click(); return 'clicked'; }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return 'Vision submenu action did not appear';
    })()`);
    assert(clickedVision === 'clicked', 'Prism Vision menu action should be clickable: ' + clickedVision);
    await waitFor(async () => await shell.executeJavaScript("!document.getElementById('prism-vision-overlay').hidden"), 'browser-owned Vision overlay visibility');
    await waitFor(async () => await shell.executeJavaScript("!!document.getElementById('vision-overlay-image').naturalWidth"), 'captured screenshot display');
    const overlay = await shell.executeJavaScript(`({
      visible: !document.getElementById('prism-vision-overlay').hidden,
      title: document.getElementById('vision-overlay-source').textContent,
      screenshot: document.getElementById('vision-overlay-image').src,
      panel: !!document.querySelector('.vision-overlay-panel'),
      width: document.getElementById('vision-overlay-image').naturalWidth,
      height: document.getElementById('vision-overlay-image').naturalHeight
    })`);
    assert(overlay.visible && overlay.panel, 'Vision should be a side-panel overlay in the browser shell');
    assert(overlay.title === 'Vision capture fixture', 'overlay should show source-page title: ' + JSON.stringify(overlay));
    assert(/^data:image\/png;base64,/.test(overlay.screenshot) && overlay.width > 0 && overlay.height > 0,
      'overlay should display the captured page screenshot');
    assert(record.tabs.length === startingTabCount && tabs.activeTab(wid).id === sourceTab.id,
      'opening Prism Vision must not add or activate a new browser tab');
    assert(record.shellView.getBounds().height === record.win.getContentSize()[1],
      'the shell overlay should cover the full window while Vision is open');

    await shell.executeJavaScript(`
      const stage = document.getElementById('vision-overlay-stage');
      const image = document.getElementById('vision-overlay-image');
      stage.setPointerCapture = () => {};
      stage.releasePointerCapture = () => {};
      const r = image.getBoundingClientRect();
      const emit = (type, x, y) => stage.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: x, clientY: y }));
      emit('pointerdown', r.left + 20, r.top + 20);
      emit('pointermove', r.left + Math.min(180, r.width - 8), r.top + Math.min(120, r.height - 8));
      emit('pointerup', r.left + Math.min(180, r.width - 8), r.top + Math.min(120, r.height - 8));
      true;
    `);
    await waitFor(async () => await shell.executeJavaScript("document.getElementById('vision-overlay-summary').textContent.includes('Mock local visual summary')"), 'local side-panel analysis');
    const selected = await shell.executeJavaScript(`({
      selectionVisible: !document.getElementById('vision-overlay-selection').hidden,
      summary: document.getElementById('vision-overlay-summary').textContent,
      status: document.getElementById('vision-overlay-status').textContent
    })`);
    assert(selected.selectionVisible, 'drag should draw a selection rectangle');
    assert(selected.summary.includes('Mock local visual summary'), 'selection analysis should populate the side panel');
    assert(selected.status.includes('locally') || selected.status.includes('on-device'), 'panel should label analysis as local');
    await shell.executeJavaScript("document.getElementById('vision-overlay-read').click(); true;");
    await waitFor(async () => await shell.executeJavaScript("document.getElementById('vision-overlay-summary').textContent.includes('Mock local page summary')"), 'local page-text summary');
    await shell.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true;");
    await waitFor(async () => await shell.executeJavaScript("document.getElementById('prism-vision-overlay').hidden"), 'Escape to close Vision');
    await waitFor(() => record.shellView.getBounds().height === record.chromeHeight, 'shell bounds to shrink after close');
    assert(record.tabs.length === startingTabCount && tabs.activeTab(wid).id === sourceTab.id,
      'closing Vision should leave the current page and tab strip untouched');

    console.log('VISION_UI_OK');
    clearTimeout(timer);
    server.close();
    app.quit();
  } catch (error) {
    clearTimeout(timer);
    server.close();
    fail(error);
  }
});
