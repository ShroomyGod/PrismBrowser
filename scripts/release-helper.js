'use strict';

function createReleaseNotes(template, version) {
  return String(template).replace(/\$\{version\}/g, String(version)).trim() + '\n';
}

// Minimal GitHub REST helper. `hostname`/`port` are injectable so the request
// path, error handling, and status handling can be exercised against a local
// server in tests instead of against github.com.
async function githubApiRequest({ hostname, port, path, method, headers, body }) {
  const scheme = port ? 'http' : 'https';
  const url = scheme + '://' + hostname + (port ? ':' + port : '') + path;
  const response = await fetch(url, {
    method,
    headers: body ? Object.assign({ 'Content-Type': 'application/json' }, headers) : headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { /* keep the raw text for the error message */ }
  if (!response.ok) {
    const detail = (data && data.message) || text || ('HTTP ' + response.status);
    throw new Error(method + ' ' + path + ' failed: ' + detail);
  }
  return data;
}

// Deletes every published release carrying exactly `tag`. Only exact tag
// matches are removed: matching on a version substring would destroy unrelated
// releases. A draft with the same tag is left alone and reported, because
// deleting someone else's in-progress draft is not a decision this script can
// make safely.
async function replaceExistingRelease({ request, basePath, tag }) {
  let releases = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await request(basePath + '/releases?per_page=100&page=' + page, 'GET');
    if (!Array.isArray(batch)) throw new Error('GitHub returned an unexpected releases response.');
    releases = releases.concat(batch);
    if (batch.length < 100) break;
  }

  const matching = releases.filter((release) => release.tag_name === tag);
  const draft = matching.find((release) => release.draft);
  if (draft) {
    throw new Error('Release ' + tag + ' already has a draft (id ' + draft.id + '). Publish or delete that draft before retrying.');
  }

  for (const release of matching) {
    await request(basePath + '/releases/' + encodeURIComponent(release.id), 'DELETE');
  }
  return matching.length;
}

module.exports = { createReleaseNotes, githubApiRequest, replaceExistingRelease };