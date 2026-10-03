// secure-dns.js — DNS-over-HTTPS via Chromium's built-in async resolver.
// Flags must be applied before app ready; changing providers requires a
// restart, which the settings page offers as a one-click action.
const { app } = require('electron');
const settings = require('./settings');

let appliedTemplate = null;

function applyAtStartup() {
  const enabled = settings.secureDnsEnabled();
  const template = settings.dnsTemplate();
  if (!enabled || !template) return;
  appliedTemplate = template;
  // Chromium field-trial incantation for the built-in DoH client.
  app.commandLine.appendSwitch('enable-features', 'DnsOverHttps<DoHTrial');
  app.commandLine.appendSwitch('force-fieldtrials', 'DoHTrial/Group1/');
  app.commandLine.appendSwitch('force-fieldtrial-params',
    'DoHTrial.Group1:Fallback/' + (settings.all().dns.secureDns === 'custom' ? 'false' : 'true') +
    ',DnsOverHttpsTemplates/' + template);
}

module.exports = { applyAtStartup, get appliedTemplate() { return appliedTemplate; } };
