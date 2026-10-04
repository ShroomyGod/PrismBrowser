'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { createReleaseNotes, githubApiRequest, replaceExistingRelease } = require('../scripts/release-helper');

const template = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'release-notes.md'), 'utf8');
const notes = createReleaseNotes(template, '1.2.3');
assert(notes.includes('## Prism 1.2.3'), 'release notes are titled with the built version');
assert(!notes.includes('${version}'), 'no unsubstituted version placeholders remain');
assert(notes.length > 400, 'release notes are comprehensive, not a one-line default');

(async () => {
  const basePath = '/repos/shroomygod/PrismBrowser';

  // Same version republish: only releases whose tag matches exactly are replaced.
  const calls = [];
  let removed = await replaceExistingRelease({
    basePath,
    tag: 'v1.2.3',
    request: async (apiPath, method) => {
      calls.push([method, apiPath]);
      if (method === 'GET') {
        return [{ id: 1, tag_name: 'v1.2.2' }, { id: 2, tag_name: 'v1.2.3' }, { id: 3, tag_name: 'v1.2.3' }];
      }
      return null;
    }
  });
  assert.strictEqual(removed, 2, 'every published release carrying the same tag is replaced');
  assert.deepStrictEqual(calls, [
    ['GET', basePath + '/releases?per_page=100&page=1'],
    ['DELETE', basePath + '/releases/2'],
    ['DELETE', basePath + '/releases/3']
  ], 'other versions are never touched');

  // An in-progress draft is a decision this script must not make.
  let draftRejected = false;
  try {
    await replaceExistingRelease({
      basePath,
      tag: 'v1.2.3',
      request: async (apiPath, method) => {
        if (method === 'GET') return [{ id: 9, tag_name: 'v1.2.3', draft: true }];
        throw new Error('no deletes should happen when a draft exists');
      }
    });
  } catch (error) {
    draftRejected = /draft/i.test(error.message);
  }
  assert(draftRejected, 'an existing draft blocks the destructive replace');

  removed = await replaceExistingRelease({
    basePath,
    tag: 'v9.9.9',
    request: async (apiPath, method) => {
      assert.strictEqual(method, 'GET', 'nothing is deleted when the tag has no release yet');
      return [{ id: 1, tag_name: 'v1.2.3' }];
    }
  });
  assert.strictEqual(removed, 0, 'a first release for a new tag deletes nothing');

  // Releases past the first page are still found, so an old release cannot
  // survive just because it is not in the newest 100.
  removed = await replaceExistingRelease({
    basePath,
    tag: 'v0.9.0',
    request: async (apiPath, method) => {
      if (method === 'DELETE') return null;
      const page = Number(apiPath.match(/page=(\d+)/)[1]);
      return page === 1 ? new Array(100).fill(0).map((_, i) => ({ id: i, tag_name: 'v' + (900 - i) })) : [{ id: 42, tag_name: 'v0.9.0' }];
    }
  });
  assert.strictEqual(removed, 1, 'releases beyond the first page are replaced too');

  // The REST helper itself, against a local server: headers, status handling, error text.
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
    if (req.url === '/ok') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([{ id: 7, tag_name: 'v1.2.3' }]));
      return;
    }
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Resource not accessible by integration' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const options = { hostname: '127.0.0.1', port, headers: { Authorization: 'Bearer test-token' } };
  try {
    const data = await githubApiRequest(Object.assign({ path: '/ok', method: 'GET' }, options));
    assert.strictEqual(data[0].tag_name, 'v1.2.3', 'successful responses are parsed as JSON');
    assert.strictEqual(seen[0].authorization, 'Bearer test-token', 'the token is sent as a bearer credential');
    let failure = '';
    try {
      await githubApiRequest(Object.assign({ path: '/denied', method: 'DELETE' }, options));
    } catch (error) {
      failure = error.message;
    }
    assert(/Resource not accessible by integration/.test(failure), 'GitHub error messages are surfaced: ' + failure);
    assert.strictEqual(seen[1].method, 'DELETE', 'the HTTP method is preserved for deletes');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('release-helper.test.js: all assertions passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});