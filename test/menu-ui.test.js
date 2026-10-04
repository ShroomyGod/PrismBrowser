// menu-ui.test.js — end-to-end check that the ⋮ menu actually opens and works
// in a real window: rows render, submenus fly out with live data, and clicking a
// row reaches the main process (tab groups, zoom, internal pages).
'use strict';

const { app } = require('electron');
const path = require('path');
const M = (name) => require(path.join(__dirname, '..', 'src', 'main', name));
const fail = (message) => { console.error(message); try { app.exit(1); } catch (_) {} };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const timeout = setTimeout(() => fail('MENU_UI_TIMEOUT'), 45000);

// Open the ⋮ menu, hover a parent row, and click an action inside its
// submenu. renderSubmenu loads list data over IPC, so every step is polled
// instead of raced against a fixed sleep.
async function clickMenuAction(shellWc, parentId, act) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const done = await shellWc.executeJavaScript(`(async () => {
      const panel = document.getElementById('menu-panel');
      const sub = document.getElementById('menu-sub');
      if (panel.style.display === 'none') document.getElementById('menu-btn').click();
      const parent = panel.querySelector('.mi[data-id="${parentId}"]');
      if (!parent) return 'no parent row';
      parent.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      for (let i = 0; i < 50; i++) {
        const row = sub.querySelector('.mi[data-act="${act}"]');
        if (row && sub.style.display !== 'none') { row.click(); return 'clicked'; }
        await new Promise((r) => setTimeout(r, 100));
      }
      return 'submenu row never appeared';
    })()`);
    if (done === 'clicked') return;
    if (attempt === 2) throw new Error('menu action ' + act + ': ' + done);
    await wait(200);
  }
}

const protocols = M('protocols');
protocols.privilegedSchemes();
const securestore = M('securestore');
const settings = M('settings');

app.whenReady().then(async () => {
  securestore.init();
  securestore.initCrypto();
  settings.init();
  M('stores').init();
  const tabs = M('tabs');
  tabs.init();
  const sessions = M('sessions').setupPartitions(tabs);
  tabs.setSessions(sessions);
  protocols.registerHandlers();
  protocols.registerOnSession(sessions.mainSession);
  protocols.registerOnSession(sessions.privSession);
  M('shell-ipc').registerIpc(tabs);

  try {
    const wid = tabs.createWindow({ urls: ['prism://newtab'] });
    const record = tabs.windowRecord(wid);
    const shellWc = record.shellView.webContents;
    // Surface renderer errors instead of failing later with an opaque "submenu
    // did not open".
    shellWc.on('console-message', (_e, level, message, line, source) => {
      if (level >= 2) console.log('SHELL_ERROR ' + message + ' (' + source + ':' + line + ')');
    });
    const page = tabs.tabs.get(record.tabs[0]).view.webContents;
    await Promise.all([
      new Promise((resolve) => shellWc.once('did-finish-load', resolve)),
      new Promise((resolve) => page.once('did-finish-load', resolve))
    ]);
    await wait(700);

    // Open the menu the way the toolbar button does.
    await shellWc.executeJavaScript(`document.getElementById('menu-btn').click(); true`);
    await wait(200);
    const opened = await shellWc.executeJavaScript(`({
      visible: document.getElementById('menu-panel').style.display !== 'none',
      rows: Array.from(document.querySelectorAll('#menu-panel .mi')).map((r) => r.dataset.id),
      subs: Array.from(document.querySelectorAll('#menu-panel .mi[data-has-sub]')).map((r) => r.dataset.id),
      keys: Array.from(document.querySelectorAll('#menu-panel .mi-key')).map((k) => k.textContent),
      labels: Array.from(document.querySelectorAll('#menu-panel .mi-label')).map((l) => l.textContent)
    })`);
    console.log('MENU_OPEN=' + JSON.stringify(opened));
    const required = ['new-tab', 'new-window', 'new-private', 'passwords', 'history', 'downloads',
      'bookmarks', 'tab-groups', 'extensions', 'clear-data', 'zoom', 'print', 'translate', 'find',
      'share', 'more', 'help', 'settings', 'exit'];
    const missing = required.filter((id) => !opened.rows.includes(id));
    if (!opened.visible) throw new Error('menu panel did not open');
    if (missing.length) throw new Error('missing menu rows: ' + missing.join(', '));
    // Google Lens was explicitly excluded.
    if (opened.labels.some((label) => /lens/i.test(label))) throw new Error('Google Lens must not appear in the menu');

    // A submenu must fly out and carry live list data, not just a chevron.
    await shellWc.executeJavaScript(`
      const row = document.querySelector('#menu-panel .mi[data-id="tab-groups"]');
      row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      true;
    `);
    // renderSubmenu is async (it loads list data over IPC), so poll instead of
    // guessing a single wait.
    let sub = null;
    for (let i = 0; i < 40; i++) {
      sub = await shellWc.executeJavaScript(`({
      visible: document.getElementById('menu-sub').style.display !== 'none',
      rows: Array.from(document.querySelectorAll('#menu-sub .mi')).map((r) => r.dataset.act || r.dataset.id)
    })`);
      if (sub && sub.visible) break;
      await wait(100);
    }
    console.log('MENU_SUB=' + JSON.stringify(sub));
    if (!sub.visible) throw new Error('tab groups submenu did not open');
    for (const act of ['group-create', 'group-remove', 'group-close-all']) {
      if (!sub.rows.includes(act)) throw new Error('submenu is missing ' + act);
    }

    // Create a group through the menu and confirm it reaches tabs.js.
    await clickMenuAction(shellWc, 'tab-groups', 'group-create');
    await wait(400);
    const groups = tabs.listGroups(wid);
    console.log('MENU_GROUPS=' + JSON.stringify(groups.map((g) => ({ name: g.name, tabs: g.tabs.length }))));
    if (!groups.length) throw new Error('clicking Group current tab created no group');
    if (groups[0].tabs.length !== 1) throw new Error('group should contain the active tab');

    // Ungroup and close-all must reach tabs.js too, otherwise groups leak.
    // Keep a spare tab open: closing every tab would close the window and end
    // the test run before it could report.
    tabs.createTab(wid, 'prism://newtab');
    await wait(250);
    const before = tabs.windowRecord(wid).tabs.length;
    // Ungroup and Close all act on the ACTIVE tab, so make the grouped one
    // active again rather than the spare tab we just opened.
    const groupedTab = groups[0].tabs[0].id;
    tabs.activateTab(wid, groupedTab);
    await wait(200);
    await clickMenuAction(shellWc, 'tab-groups', 'group-remove');
    await wait(350);
    if (tabs.listGroups(wid).length) throw new Error('Ungroup current tab left a group behind');

    await shellWc.executeJavaScript(`window.prismShell.tabGroups('create')`);
    await wait(200);
    await shellWc.executeJavaScript(`window.prismShell.tabGroups('close-all')`);
    await wait(350);
    if (tabs.listGroups(wid).length) throw new Error('Close all groups left a group behind');
    if (tabs.windowRecord(wid).tabs.length !== before - 1) {
      throw new Error('Close all groups should have closed the one grouped tab, had ' +
        tabs.windowRecord(wid).tabs.length + ' of ' + before);
    }

    // Zoom row: the shell reads the zoom factor out of the tab snapshot.
    // Chromium persists per-origin zoom, so reset first to keep this stable.
    tabs.setZoom(wid, 0);
    await wait(200);
    tabs.setZoom(wid, 1);
    await wait(250);
    const zoomLabel = await shellWc.executeJavaScript(`(async () => {
      document.getElementById('menu-btn').click();
      document.querySelector('#menu-panel .mi[data-id="zoom"]')
        .dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 250));
      const text = document.querySelector('#menu-sub .mi[data-id="zoom-level"] .mi-label').textContent;
      document.getElementById('menu-btn').click();
      return text;
    })()`);
    console.log('MENU_ZOOM=' + zoomLabel);
    if (zoomLabel === '100%') throw new Error('zoom row did not follow the page zoom');

    // The internal pages the menu links to must actually load.
    for (const pageUrl of ['prism://clear', 'prism://shortcuts', 'prism://settings#privacy', 'prism://settings#about']) {
      const tabId = tabs.createTab(wid, pageUrl);
      const wc = tabs.tabs.get(tabId).view.webContents;
      await new Promise((resolve) => wc.once('did-finish-load', resolve));
      const info = await wc.executeJavaScript(`({
        title: document.title,
        head: (document.querySelector('h1') || {}).textContent,
        body: document.body.innerText.length,
        anchored: location.hash ? !!document.getElementById(location.hash.slice(1)) : true
      })`);
      console.log('MENU_PAGE ' + pageUrl + '=' + JSON.stringify(info));
      if (info.body < 50) throw new Error(pageUrl + ' rendered empty');
      if (pageUrl.indexOf('#privacy') !== -1 && !info.anchored) throw new Error('settings#privacy did not scroll to the Privacy heading');
    }

    // Keyboard navigation: arrows move the selection and Enter runs the row.
    const keyboard = await shellWc.executeJavaScript(`(async () => {
      document.getElementById('menu-btn').click();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      const sel = document.querySelector('#menu-panel .mi.sel');
      const id = sel && sel.dataset.id;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
      return { id, closed: document.getElementById('menu-panel').style.display === 'none' };
    })()`);
    console.log('MENU_KEYS=' + JSON.stringify(keyboard));
    if (!keyboard.id) throw new Error('arrow keys did not move the menu selection');
    if (!keyboard.closed) throw new Error('Escape did not close the menu');

    // Menu handlers in the main process that can be checked headlessly.
    const { clipboard } = require('electron');
    const wrote = await shellWc.executeJavaScript(`window.prismShell.copyText('prism-menu-test').then(() => true)`);
    if (!wrote || clipboard.readText() !== 'prism-menu-test') throw new Error('copyText did not reach the clipboard');
    const siteErr = await shellWc.executeJavaScript(`window.prismShell.clearSiteData()`);
    console.log('MENU_SITEDATA=' + JSON.stringify(siteErr));
    if (!siteErr || !siteErr.error) throw new Error('clearSiteData should refuse an internal page');
    const vault = await shellWc.executeJavaScript(`window.prismShell.lockVault()`);
    console.log('MENU_VAULT=' + JSON.stringify(vault));
    // Locking must not make the stores unreadable: they re-unwrap from the OS keyring.
    const stillReadable = await shellWc.executeJavaScript(`window.prismShell.historyList('', 5).then((l) => Array.isArray(l))`);
    if (!stillReadable) throw new Error('stores became unreadable after locking the vault');

    console.log('MENU_UI_OK');
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) {
    fail('MENU_UI_ERROR: ' + (error && error.stack || error));
  }
}).catch((error) => fail('MENU_UI_BOOT_ERROR: ' + (error && error.stack || error)));