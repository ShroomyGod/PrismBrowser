'use strict';

// A release name ("codename") is a short, catchy label for what the release is
// about, so a download page reads "Prism 1.0.6 — Spectrum" rather than "v1.0.6".
// It is deliberately NOT part of the git tag: Prism's updater resolves releases
// by the vX.Y.Z tag, so a tagged codename would silently break auto-update.
const NAME_SEPARATOR = ' — ';

// The notes template drives the name, not the other way round: if it does not
// ask for a name, the release does not get one. Publishing "Prism 1.0.6 — "
// with a dangling separator is worse than publishing no name at all.
function createReleaseNotes(template, version, name) {
  const source = String(template);
  if (source.includes('${name}') && !String(name == null ? '' : name).trim()) {
    throw new Error('release notes template asks for ${name} but no release name was given');
  }
  return source
    .replace(/\$\{version\}/g, String(version))
    .replace(/\$\{name\}/g, String(name == null ? '' : name).trim())
    .trim() + '\n';
}

function releaseTitle(version, name) {
  const label = String(name == null ? '' : name).trim();
  return 'Prism ' + String(version) + (label ? NAME_SEPARATOR + label : '');
}

// A codename has to survive three places it did not ask to be: a GitHub release
// title, a Markdown heading, and an environment variable handed to
// electron-builder. That rules out quotes, backslashes, newlines and control
// characters. Collapsing runs of whitespace keeps typed input from turning the
// title into a ragged mess.
function sanitizeName(raw) {
  const cleaned = String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')      // control characters, incl. newlines
    .replace(/["'`\\<>|]/g, '')                 // quoting and shell/URL metacharacters
    .replace(/[*_~[\]#]/g, '')                   // Markdown control characters
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.length > 48 ? cleaned.slice(0, 48).trim() : cleaned;
}

// Feature signals, most distinctive first. Each release theme maps to a word
// that describes it, and the theme whose keywords appear most often in the
// notes wins: a release built around a theme gallery should not be called
// "Antivirus" just because the notes also mention download scanning.
//
// Ordered deliberately, not alphabetically: ties resolve to the earlier entry.
const NAME_SIGNALS = [
  // Local models are the most distinctive thing Prism can add, and "Lumen" reads
  // correctly for both halves of the feature: vision and light. Ahead of Spectrum
  // because a release can be about both, and the newer feature should win the tie.
  { name: 'Lumen', label: 'on-device vision and language models', patterns: [/prism vision/gi, /local model/gi, /on-device model/gi, /florence/gi, /smollm/gi, /language model/gi, /\bOCR\b/i, /summari[sz]/gi, /caption/gi] },
  { name: 'Spectrum', label: 'themes and the palette gallery', patterns: [/theme/gi, /palette/gi, /colou?r/gi, /gallery/gi, /dark mode|light mode/gi] },
  { name: 'Sentinel', label: 'security scanning and malware defence', patterns: [/antivirus/gi, /malware/gi, /phishing/gi, /safe browsing/gi, /defender/gi, /scan/gi] },
  { name: 'Catalogue', label: 'an extension and add-on catalogue', patterns: [/extension/gi, /web store/gi, /add-?on/gi] },
  { name: 'Quarry', label: 'the downloads pipeline', patterns: [/download/gi] },
  { name: 'Compass', label: 'navigation and search', patterns: [/omnibox/gi, /navigation/gi, /search/gi, /address bar/gi] },
  { name: 'Bastion', label: 'privacy and the password vault', patterns: [/privacy/gi, /vault/gi, /password/gi, /encrypt/gi] },
  { name: 'Signal', label: 'blocking ads and trackers', patterns: [/ad block/gi, /tracker/gi, /filter list/gi] },
  { name: 'Archive', label: 'history, bookmarks and saved pages', patterns: [/history/gi, /bookmark/gi] }
];

const FALLBACK_NAMES = ['Prism Edition', 'Nightfall', 'Aurora'];

// The notes are cumulative: they describe the whole browser, including features
// that shipped long ago. Scoring that whole document would name a release after
// whichever long-standing feature happens to be described most often - a theme
// gallery release came out as "Bastion" (privacy) because the vault and password
// bullets have been in the notes the longest.
//
// So the name is derived from the "New in this release" section when there is
// one: the features this release actually adds. Without that section the whole
// document is the best available evidence, which is why this falls back rather
// than returning nothing.
const SIGNALS_HEADING = /^#{2,3}\s*new in this release\s*$/im;
const NEXT_HEADING = /^#{2,3}\s+/m;

function releaseSignals(notesText) {
  const text = String(notesText == null ? '' : notesText);
  const start = text.match(SIGNALS_HEADING);
  if (!start) return text;
  const after = start.index + start[0].length;
  const rest = text.slice(after);
  const next = rest.slice(1).match(NEXT_HEADING); // slice(1): the newline we cut at
  return next ? rest.slice(0, next.index + 1) : rest;
}

// Suggest codenames for a release from the text that describes it. Deterministic
// and order-stable: the same notes always produce the same shortlist, so a
// re-run of a half-finished release proposes the name it proposed first time.
// Ties break on the table order, never on timing or randomness.
//
// Strictly evidence-based: a name is only suggested when the notes actually
// mention that feature. Padding the shortlist with themes a release does not
// have would make the name a guess dressed up as a description.
function suggestNames(notesText, limit = 3) {
  const text = releaseSignals(notesText);
  // Score the bullets a theme appears in, not how many times its words appear.
  // Counting occurrences let one long paragraph outvote a whole feature: the
  // theme-gallery bullet is by far the longest in the notes, so a release whose
  // headline was a new feature came out named for the gallery. The first bullet
  // is the release's headline, so it counts double.
  const bullets = text.split('\n').filter((line) => /^\s*[-*]\s+\S/.test(line));
  const scored = [];
  for (const signal of NAME_SIGNALS) {
    // Notes written as prose rather than bullets still have to be nameable.
    const hits = bullets.length
      ? bullets.reduce((n, bullet, i) => {
          if (!signal.patterns.some((pattern) => pattern.test(bullet))) return n;
          return n + (i === 0 ? 2 : 1);
        }, 0)
      : signal.patterns.reduce((n, pattern) => n + (text.match(pattern) || []).length, 0);
    if (hits) scored.push({ name: signal.name, label: signal.label, hits });
  }
  scored.sort((a, b) => (b.hits - a.hits));
  return scored.slice(0, Math.max(1, limit)).map((entry) => ({ name: entry.name, label: entry.label }));
}

// Decide the release name. This is deliberately unattended: the top feature
// match wins every time, so `npm run release` needs no input and produces the
// same name for the same notes. `--name` overrides it when a different name is
// wanted for a specific build.
function resolveReleaseName({ requested, notesText, limit } = {}) {
  const explicit = sanitizeName(requested);
  if (explicit) return { name: explicit, source: 'argument', suggestions: [] };
  const suggestions = suggestNames(notesText, limit);
  const chosen = suggestions[0] || { name: FALLBACK_NAMES[0], label: 'a general release' };
  return { name: chosen.name, source: suggestions.length ? 'suggested' : 'fallback', suggestions };
}

// Give the published release its name.
//
// electron-builder 26.x cannot do this from package.json: `publish.releaseName`
// is rejected by its own config schema (GithubOptions sets
// additionalProperties:false and does not list it), and the GitHub publisher
// receives releaseName as a constructor argument that PublishManager never
// populates, so the created release is titled with the bare version anyway.
// Adding the key breaks the build outright, so the title is set here instead,
// once the release exists.
//
// Only exact tag matches are renamed, and drafts are refused: renaming a draft
// would silently repurpose somebody's unpublished work.
async function updateReleaseName({ request, basePath, tag, name }) {
  const label = sanitizeName(name);
  if (!label) throw new Error('refusing to publish a release with an empty name');
  const releases = await request(basePath + '/releases?per_page=100', 'GET');
  if (!Array.isArray(releases)) throw new Error('GitHub returned an unexpected releases response.');
  const match = releases.find((release) => release.tag_name === tag && !release.draft);
  if (!match) throw new Error('no published release found for tag ' + tag + ' to name');
  await request(basePath + '/releases/' + encodeURIComponent(match.id), 'PATCH', { name: label });
  return label;
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

module.exports = {
  createReleaseNotes,
  releaseTitle,
  sanitizeName,
  releaseSignals,
  suggestNames,
  resolveReleaseName,
  updateReleaseName,
  githubApiRequest,
  replaceExistingRelease
};