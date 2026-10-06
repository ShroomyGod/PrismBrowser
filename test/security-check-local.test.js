'use strict';

const assert = require('assert');
const Module = require('module');
const os = require('os');
const path = require('path');

const settingsStub = {
  all: () => ({ security: { malwareEnabled: true, safeBrowsingKey: '' } }),
  get: () => undefined,
  set: () => {}
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return {
    net: { fetch: async () => { throw new Error('network must not be used by local threat check'); } },
    app: { getPath: () => os.tmpdir() },
    shell: {}
  };
  if (request === './settings' && parent && /src[\\/]main[\\/]security\.js$/.test(parent.filename)) return settingsStub;
  if (request === './stores' && parent && /src[\\/]main[\\/]security\.js$/.test(parent.filename)) return {};
  if (request === './downloads' && parent && /src[\\/]main[\\/]security\.js$/.test(parent.filename)) return {};
  return originalLoad.call(this, request, parent, isMain);
};

try {
  const security = require('../src/main/security');
  security.rebuild([
    { name: 'phishingarmy', text: 'bad.example\nmalware.test' },
    { name: 'openphish', text: 'https://safe.example/login\nhttps://path-bad.test/payload' }
  ]);
  assert.deepStrictEqual(security.checkLocalUrl('https://bad.example/'), {
    status: 'match', matchType: 'domain', host: 'bad.example', hostEntries: 2, urlEntries: 2
  });
  assert.strictEqual(security.checkLocalUrl('https://sub.bad.example/path').status, 'match', 'listed domains include their subdomains');
  assert.strictEqual(security.checkLocalUrl('https://safe.example/login?tracking=1').status, 'match', 'URL matching ignores query strings');
  assert.strictEqual(security.checkLocalUrl('https://safe.example/').status, 'clear', 'URL-only entries do not condemn an entire domain');
  assert.strictEqual(security.checkLocalUrl('https://clean.example/').status, 'clear');
  security.addException('bad.example');
  assert.strictEqual(security.checkLocalUrl('https://bad.example/').status, 'exception');
  assert.strictEqual(security.checkLocalUrl('file:///tmp/a').status, 'invalid');
  console.log('security-check-local.test.js: all assertions passed');
} finally {
  Module._load = originalLoad;
}
