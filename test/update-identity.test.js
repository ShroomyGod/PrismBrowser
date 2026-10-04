'use strict';

const assert = require('assert');
const { compareVersions, inspect, accept } = require('../src/main/update-identity');

assert.strictEqual(compareVersions('1.2.0', '1.2.0'), 0);
assert(compareVersions('1.2.1', '1.2.0') > 0);
assert(compareVersions('1.1.9', '1.2.0') < 0);

const key = 'github:Prism-1.2.0-x64.exe';
let state = { assets: {} };
let result = inspect(state, key, '1.2.0', 'sha512:build-a', '1.2.0', {
  candidateTime: 1000,
  installedTime: 1000
});
assert.strictEqual(result.available, false, 'matching publication timestamp establishes a baseline');
state = result.state;

result = inspect(state, key, '1.2.0', 'sha512:build-a', '1.2.0');
assert.strictEqual(result.available, false, 'unchanged artifact is not offered repeatedly');

result = inspect(state, key, '1.2.0', 'sha512:build-b', '1.2.0');
assert.strictEqual(result.available, true, 'changed same-version build is available');
assert.strictEqual(result.buildRefresh, true);
state = result.state;

result = inspect(state, key, '1.2.0', 'sha512:build-b', '1.2.0');
assert.strictEqual(result.available, true, 'unaccepted build stays available on later checks');
state = accept(state, key, '1.2.0', 'sha512:build-b');
result = inspect(state, key, '1.2.0', 'sha512:build-b', '1.2.0');
assert.strictEqual(result.available, false, 'accepted artifact does not continue prompting');

result = inspect(state, 'github:Prism-1.3.0-x64.exe', '1.3.0', 'sha512:build-c', '1.2.0');
assert.strictEqual(result.available, true, 'newer semantic version remains available');
assert.strictEqual(result.buildRefresh, false);
state = result.state;
result = inspect(state, 'github:Prism-1.3.0-x64.exe', '1.3.0', 'sha512:build-c', '1.3.0');
assert.strictEqual(result.available, true, 'new-version artifact remains pending until installation');
state = accept(state, 'github:Prism-1.3.0-x64.exe', '1.3.0', 'sha512:build-c');
result = inspect(state, 'github:Prism-1.3.0-x64.exe', '1.3.0', 'sha512:build-c', '1.3.0');
assert.strictEqual(result.available, false, 'installed new-version artifact becomes the baseline');
result = inspect(state, key, '1.2.0', null, '1.2.0');
assert.strictEqual(result.available, false, 'missing identity cannot create false same-version update');

state = { assets: {} };
result = inspect(state, key, '1.2.0', 'sha512:replacement', '1.2.0', {
  candidateTime: 3000,
  installedTime: 1000
});
assert.strictEqual(result.available, true, 'legacy installs detect a release newer than the installed executable');
state = result.state;
result = inspect(state, key, '1.2.0', 'sha512:replacement', '1.2.0');
assert.strictEqual(result.available, true, 'legacy migration keeps the refresh available until accepted');
state = accept(state, key, '1.2.0', 'sha512:replacement');
result = inspect(state, key, '1.2.0', 'sha512:replacement', '1.2.0');
assert.strictEqual(result.available, false, 'accepted legacy refresh is no longer offered');

state = { assets: {} };
result = inspect(state, key, '1.2.0', 'sha512:baseline', '1.2.0');
assert.strictEqual(result.available, false, 'without comparable timestamps, first sighting safely establishes a baseline');
state = result.state;
result = inspect(state, key, '1.2.0', 'sha512:replacement', '1.2.0');
assert.strictEqual(result.available, true, 'later checksum changes are detected without version changes');

console.log('update-identity.test.js: all assertions passed');
