'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');

const DEFAULT_APPS_URI = 'ms-settings:defaultapps?registeredAppUser=Prism';
const REG = 'HKCU\\Software\\Classes\\';

function urlFromArgs(argv) {
  for (const value of argv || []) {
    if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) continue;
    try {
      const url = new URL(value);
      if (url.protocol === 'http:' || url.protocol === 'https:') return value;
    } catch (_) {}
  }
  return null;
}

function registryEntries(executable) {
  const command = '"' + executable + '" "%1"';
  const icon = '"' + executable + '",0';
  const entries = [];
  const add = (key, value, data) => entries.push({ key, value, data });
  const progIds = [
    ['PrismHTML', 'Prism HTML Document'],
    ['Prism.URL.http', 'Prism HTTP URL'],
    ['Prism.URL.https', 'Prism HTTPS URL']
  ];
  for (const [id, label] of progIds) {
    const root = REG + id;
    add(root, '', label);
    if (id !== 'PrismHTML') add(root, 'URL Protocol', '');
    add(root + '\\DefaultIcon', '', icon);
    add(root + '\\shell\\open\\command', '', command);
  }
  for (const [key, value] of [
    ['ApplicationName', 'Prism'],
    ['ApplicationDescription', 'Prism is a privacy-focused desktop web browser.'],
    ['ApplicationIcon', icon]
  ]) add('HKCU\\Software\\Clients\\StartMenuInternet\\Prism\\Capabilities', key, value);
  const cap = 'HKCU\\Software\\Clients\\StartMenuInternet\\Prism\\Capabilities\\';
  add(cap + 'URLAssociations', 'http', 'Prism.URL.http');
  add(cap + 'URLAssociations', 'https', 'Prism.URL.https');
  add(cap + 'FileAssociations', '.htm', 'PrismHTML');
  add(cap + 'FileAssociations', '.html', 'PrismHTML');
  add('HKCU\\Software\\Clients\\StartMenuInternet\\Prism\\shell\\open\\command', '', '"' + executable + '"');
  add('HKCU\\Software\\RegisteredApplications', 'Prism', 'Software\\Clients\\StartMenuInternet\\Prism\\Capabilities');
  return entries;
}

function isDefaultBrowser(appApi) {
  const api = appApi || require('electron').app;
  try { return api.isDefaultProtocolClient('http') && api.isDefaultProtocolClient('https'); }
  catch (_) { return false; }
}

async function registerWindowsCapabilities(options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== 'win32') return { ok: false, reason: 'unsupported' };
  const api = options.appApi || require('electron').app;
  const run = options.runRegistry || promisify(execFile);
  const exe = api.getPath('exe');
  try {
    for (const entry of registryEntries(exe)) {
      const args = ['add', entry.key, entry.value ? '/v' : '/ve'];
      if (entry.value) args.push(entry.value);
      args.push('/t', 'REG_SZ', '/d', entry.data, '/f');
      await run('reg.exe', args, { windowsHide: true });
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error && error.message) || 'Could not register Prism with Windows.' };
  }
}

async function openDefaultAppsSettings(options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== 'win32') return { ok: false, reason: 'unsupported' };
  const registered = await (options.register || registerWindowsCapabilities)(options);
  if (!registered.ok) return registered;
  const api = options.shellApi || require('electron').shell;
  try {
    await api.openExternal(DEFAULT_APPS_URI);
    return { ok: true, isDefault: isDefaultBrowser(options.appApi) };
  } catch (error) {
    return { ok: false, error: (error && error.message) || 'Could not open Windows Default Apps.' };
  }
}

async function promptOnStartup(options) {
  const { settings, tabs } = options;
  const platform = options.platform || process.platform;
  if (platform !== 'win32' || settings.all().general.defaultBrowserPromptShown || isDefaultBrowser(options.appApi)) return false;
  settings.set({ general: { defaultBrowserPromptShown: true } });
  const electronApi = options.electronApi || require('electron');
  const wid = tabs.focusedWindowId() || tabs.windows.keys().next().value;
  const record = wid && tabs.windowRecord(wid);
  const result = await electronApi.dialog.showMessageBox(record && record.win, {
    type: 'question',
    title: 'Make Prism your default browser?',
    message: 'Use Prism whenever you open a web link?',
    detail: 'Windows will ask you to confirm Prism in Default Apps. Prism will not change your browser without your approval.',
    buttons: ['Open Default Apps', 'Not now'],
    defaultId: 0,
    cancelId: 1
  });
  if (result.response === 0) await (options.openSettings || openDefaultAppsSettings)(options);
  return true;
}

module.exports = { DEFAULT_APPS_URI, urlFromArgs, registryEntries, isDefaultBrowser, registerWindowsCapabilities, openDefaultAppsSettings, promptOnStartup };
