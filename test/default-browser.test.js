'use strict';

const assert = require('assert');
const { DEFAULT_APPS_URI, urlFromArgs, registryEntries, isDefaultBrowser, registerWindowsCapabilities, openDefaultAppsSettings, promptOnStartup } = require('../src/main/default-browser');

async function main() {
  assert.strictEqual(urlFromArgs(['electron', 'main.js', '--', 'https://example.com/a?x=1']), 'https://example.com/a?x=1');
  assert.strictEqual(urlFromArgs(['electron', '--https://example.com']), null);
  assert.strictEqual(urlFromArgs(['electron', 'javascript:alert(1)']), null);
  assert.strictEqual(urlFromArgs(['electron', 'file:///tmp/a.html']), null);

  const entries = registryEntries('C:\\Program Files\\Prism\\Prism.exe');
  const entry = (key, value) => entries.find((item) => item.key === key && item.value === value);
  assert.strictEqual(entry('HKCU\\Software\\RegisteredApplications', 'Prism').data,
    'Software\\Clients\\StartMenuInternet\\Prism\\Capabilities');
  assert.strictEqual(entry('HKCU\\Software\\Clients\\StartMenuInternet\\Prism\\Capabilities\\URLAssociations', 'http').data, 'Prism.URL.http');
  assert.strictEqual(entry('HKCU\\Software\\Clients\\StartMenuInternet\\Prism\\Capabilities\\URLAssociations', 'https').data, 'Prism.URL.https');
  assert(entry('HKCU\\Software\\Classes\\Prism.URL.http', 'URL Protocol'));
  assert(entry('HKCU\\Software\\Classes\\Prism.URL.https', 'URL Protocol'));
  assert(entry('HKCU\\Software\\Classes\\Prism.URL.http\\shell\\open\\command', '').data.includes('"C:\\Program Files\\Prism\\Prism.exe" "%1"'));

  assert.strictEqual(isDefaultBrowser({ isDefaultProtocolClient: (protocol) => protocol === 'http' }), false);
  assert.strictEqual(isDefaultBrowser({ isDefaultProtocolClient: () => true }), true);

  const commands = [];
  const registered = await registerWindowsCapabilities({
    platform: 'win32',
    appApi: { getPath: () => 'C:\\Program Files\\Prism\\Prism.exe' },
    runRegistry: async (...args) => { commands.push(args); }
  });
  assert.deepStrictEqual(registered, { ok: true });
  assert(commands.length >= 10);
  assert(commands.every(([exe, args]) => exe === 'reg.exe' && args[0] === 'add' && args.includes('/f')));
  assert.strictEqual((await registerWindowsCapabilities({ platform: 'linux' })).reason, 'unsupported');

  let opened = '';
  const settingsResult = await openDefaultAppsSettings({
    platform: 'win32',
    register: async () => ({ ok: true }),
    shellApi: { openExternal: async (uri) => { opened = uri; } },
    appApi: { isDefaultProtocolClient: () => false }
  });
  assert.strictEqual(opened, DEFAULT_APPS_URI);
  assert.deepStrictEqual(settingsResult, { ok: true, isDefault: false });

  let prompted = 0;
  let saved = 0;
  let openedSettings = 0;
  const options = {
    platform: 'win32',
    settings: {
      all: () => ({ general: { defaultBrowserPromptShown: false } }),
      set: (patch) => { saved++; assert.strictEqual(patch.general.defaultBrowserPromptShown, true); }
    },
    tabs: { focusedWindowId: () => 'w1', windowRecord: () => ({ win: 'window' }), windows: new Map([['w1', {}]]) },
    appApi: { isDefaultProtocolClient: () => false },
    electronApi: { dialog: { showMessageBox: async (win, spec) => {
      prompted++;
      assert.strictEqual(win, 'window');
      assert.deepStrictEqual(spec.buttons, ['Open Default Apps', 'Not now']);
      return { response: 0 };
    } } },
    openSettings: async () => { openedSettings++; return { ok: true }; }
  };
  assert.strictEqual(await promptOnStartup(options), true);
  assert.strictEqual(prompted, 1);
  assert.strictEqual(saved, 1);
  assert.strictEqual(openedSettings, 1);
  assert.strictEqual(await promptOnStartup({ ...options, platform: 'linux' }), false);
  assert.strictEqual(await promptOnStartup({ ...options, appApi: { isDefaultProtocolClient: () => true } }), false);
  assert.strictEqual(await promptOnStartup({ ...options, settings: { all: () => ({ general: { defaultBrowserPromptShown: true } }), set: () => { throw new Error('must not ask twice'); } } }), false);

  console.log('default-browser.test.js: all assertions passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
