'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const {
  createReleaseNotes,
  releaseTitle,
  sanitizeName,
  releaseSignals,
  suggestNames,
  resolveReleaseName,
  updateReleaseName,
  githubApiRequest,
  replaceExistingRelease
} = require('../scripts/release-helper');

const template = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'release-notes.md'), 'utf8');

// The release is named as well as versioned: the notes heading carries both, and
// a title that is only a version number is exactly what this replaces.
const notes = createReleaseNotes(template, '1.2.3', 'Spectrum');
assert(notes.includes('## Prism 1.2.3 — Spectrum'), 'release notes are titled with the version and the release name');
assert(!notes.includes('${version}'), 'no unsubstituted version placeholders remain');
assert(!notes.includes('${name}'), 'no unsubstituted name placeholders remain');
assert(notes.length > 400, 'release notes are comprehensive, not a one-line default');
assert.strictEqual(releaseTitle('1.2.3', 'Spectrum'), 'Prism 1.2.3 — Spectrum', 'the release title pairs the version with the name');
assert.strictEqual(releaseTitle('1.2.3', ''), 'Prism 1.2.3', 'an unnamed release degrades to the version alone');

// Publishing "Prism 1.2.3 — " with a dangling separator would be worse than
// publishing no name, so a template that asks for a name refuses an empty one.
let refused = '';
try {
  createReleaseNotes(template, '1.2.3', '   ');
} catch (error) {
  refused = error.message;
}
assert(/release name/i.test(refused), 'notes are not generated without a name: ' + refused);
assert.strictEqual(createReleaseNotes('## Prism ${version}', '1.2.3', ''), '## Prism 1.2.3\n',
  'a template that does not ask for a name still works');

// Names land in a GitHub title, a Markdown heading and an environment variable,
// so they have to survive all three.
assert.strictEqual(sanitizeName('  Prism   Spectrum  '), 'Prism Spectrum', 'runs of whitespace collapse');
assert.strictEqual(sanitizeName('He said "hi"'), 'He said hi', 'quotes and shell metacharacters are stripped');
assert.strictEqual(sanitizeName('line one\nline two'), 'line one line two', 'newlines cannot break the title');
assert.strictEqual(sanitizeName('back\\slash'), 'backslash', 'backslashes are stripped');
assert.strictEqual(sanitizeName('## markdown **stars**'), 'markdown stars', 'Markdown control characters are stripped');
assert.strictEqual(sanitizeName(''), '', 'an empty name stays empty');
assert.strictEqual(sanitizeName('***'), '', 'a name made only of stripped characters is empty');
assert.strictEqual(sanitizeName('x'.repeat(80)).length, 48, 'very long names are capped');
assert.strictEqual(sanitizeName('a\tb'), 'a b', 'tabs become spaces rather than reaching the title');

// The name has to describe the features, so it is derived from the notes that
// describe the features. Deterministic order matters: re-running a half-finished
// release must propose the same shortlist it proposed the first time.
const themeNotes = 'A theme gallery of 124 themes with a colour picker and dark mode.';
const securityNotes = 'Antivirus scanning of downloads with Windows Defender, phishing and malware checks.';
assert.strictEqual(suggestNames(themeNotes)[0].name, 'Spectrum', 'a theming release is named for its themes');
assert.strictEqual(suggestNames(securityNotes)[0].name, 'Sentinel', 'a scanning release is named for its scanning');
assert.deepStrictEqual(suggestNames(themeNotes), suggestNames(themeNotes), 'suggestions are deterministic');
assert.deepStrictEqual(suggestNames('nothing noteworthy here'), [], 'unrelated notes produce no suggestions');

// The notes are cumulative, so only "New in this release" may decide the name.
// Scoring the whole document named a theme-gallery release after whichever
// long-standing feature was described most often.
const cumulative = '## New in this release\n\n- **Theme gallery:** 124 themes.\n\n### Everything else\n\n- **Password vault:** the vault can be locked.\n- **Privacy controls:** ad filtering and Do Not Track.\n';
assert(!releaseSignals(cumulative).includes('Password vault'), 'the "New in this release" section ends at the next heading');
assert(releaseSignals(cumulative).includes('Theme gallery'), 'the signals section is extracted');
assert.strictEqual(suggestNames(cumulative)[0].name, 'Spectrum', 'only what this release adds decides the name');
// A long paragraph about one theme must not outvote a release whose headline is a
// different feature: the bullets are counted, not the words.
const headline = '## New in this release\n\n' +
  '- **Local models:** Prism Vision reads images on-device, and SmolLM2 writes local summaries offline.\n' +
  '- **Theme gallery:** 124 hand-designed themes in 12 categories, browsable like a gallery with a category rail and large previews, each one painting a mock tab strip so you can see the palette, the text contrast and the accent colour before applying it.\n';
assert.strictEqual(suggestNames(headline)[0].name, 'Lumen', 'the headline bullet outvotes a longer bullet about something else');
assert.strictEqual(releaseSignals('no headings at all here'), 'no headings at all here', 'notes without the section are used whole');

// The real template is the input, so assert the shipped one actually suggests.
const realSuggestions = suggestNames(template);
assert(realSuggestions.length > 0, 'the shipped release notes produce suggestions');
// The headline feature of the current notes decides this, and it is the local AI
// work rather than the theme gallery that also shipped in the same release.
assert.strictEqual(realSuggestions[0].name, 'Lumen', 'the current release is named for its local AI feature');
assert(template.includes('### New in this release'), 'the shipped notes carry the section the name is derived from');

// --name always wins, so re-publishing a version keeps the name it had.
assert.deepStrictEqual(
  resolveReleaseName({ requested: '  Nightfall ', notesText: themeNotes }),
  { name: 'Nightfall', source: 'argument', suggestions: [] },
  'an explicit name overrides the chosen one'
);
assert.strictEqual(resolveReleaseName({ notesText: '' }).name, 'Prism Edition', 'notes with no features still get a name');
// A release with no feature evidence cannot be named after a feature it lacks.
assert.strictEqual(resolveReleaseName({ notesText: 'nothing noteworthy here' }).name, 'Prism Edition',
  'a release is never named for a feature it does not have');
assert.strictEqual(resolveReleaseName().name, 'Prism Edition', 'a bare call still returns a usable name');

// The name is chosen unattended, so resolution must be deterministic and must
// never depend on who is running it or whether a terminal is attached.
assert.deepStrictEqual(resolveReleaseName({ notesText: template }), resolveReleaseName({ notesText: template }),
  'the same notes always produce the same name');
assert.deepStrictEqual(resolveReleaseName({ notesText: template }).suggestions, suggestNames(template),
  'the runners-up reported to the console are the real shortlist');

// The release title is NOT configured in package.json. Setting
// `publish.releaseName` there looks right and is how it is done for some
// electron-builder versions, but 26.x rejects it outright: its GithubOptions
// schema sets additionalProperties:false and does not list the key, so the whole
// build dies with "configuration.publish.provider must be equal to constant"
// before a single file is packaged. The name is applied through the API after
// publishing instead, so package.json must not carry it.
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
assert.strictEqual(pkg.build.publish.releaseName, undefined,
  'package.json does not set publish.releaseName, which electron-builder 26.x rejects');
assert(pkg.build.publish.tagPrefix === undefined || pkg.build.publish.tagPrefix === 'v',
  'the tag stays vX.Y.Z so the updater keeps finding releases');

// Run electron-builder's own schema validator over the real config. This is the
// check the failing build tripped, so it belongs here rather than being
// rediscovered by running a five-minute release.
const validateSchema = (() => {
  try {
    const { validateConfiguration } = require('../node_modules/app-builder-lib/out/util/config/config.js');
    return (config) => validateConfiguration(config, { isEnabled: false, add() {} });
  } catch (_) {
    return null; // app-builder-lib is a build-time dependency; skip if absent
  }
})();
if (validateSchema) {
  console.log('  app-builder-lib present - config schema validation runs below');
}

// Source-level guards on the release script. It cannot be run here without
// triggering a full installer build, but these are the difference between a
// named release and a version-only one, and each has been broken by accident:
// the rename call omitted (title silently stays the bare version), the notes
// written without the name (heading reads "Prism 1.0.6 — "), and --help placed
// after cleanStale() (which deletes the previous build's installer before
// printing help).
const releaseScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'release.js'), 'utf8');
const releaseGitScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'release-git.js'), 'utf8');
const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
assert(
  releaseScript.includes('await renamePublishedRelease(RELEASE.name)'),
  'the release script names the published release'
);
assert(
  releaseScript.includes('writeReleaseNotes(RELEASE.name)'),
  'the generated notes are stamped with the same name as the title'
);
assert(
  releaseScript.indexOf('if (ARGS.help)') < releaseScript.indexOf('generateIcons();'),
  '--help is handled before anything with a side effect runs'
);
assert(
  releaseScript.indexOf('const RELEASE = resolveNameForBuild();') < releaseScript.indexOf("run('npx', ['electron-builder', '--win'"),
  'the name is resolved before the long installer build starts'
);
// The name is chosen unattended, so the release must never stop to ask. A prompt
// left in place would hang any run without an attached terminal.
assert(!/readline|askLineSync|askForName/.test(releaseScript), 'the release never prompts for a name');
assert(/releaseGit\.checkGitReady\(ROOT\)/.test(releaseScript),
  'Git branch/index/remote readiness is checked before build side effects');
assert(/releaseGit\.commitAndPush\(ROOT, VERSION\)/.test(releaseScript),
  'a successful local build commits and pushes the current source branch');
assert(releaseScript.indexOf('verifyArtifacts();') < releaseScript.indexOf('releaseGit.commitAndPush(ROOT, VERSION)'),
  'source is committed and pushed only after installer verification');
assert(releaseScript.indexOf('releaseGit.commitAndPush(ROOT, VERSION)') < releaseScript.indexOf('if (!GH_TOKEN)'),
  'branch source is pushed even when GitHub Releases publishing is not configured');
assert(/Generated build artifacts are staged/.test(releaseGitScript) && /detached/.test(releaseGitScript),
  'release git automation refuses staged build outputs and detached HEADs while allowing staged source');
assert(/\*\.nsis\.7z/.test(releaseGitScript) && /latest\.yml/.test(releaseGitScript),
  'generated installers and updater metadata are excluded from the source commit');
assert(/commits source changes and pushes the current branch/.test(readme),
  'README explains that releases commit and push source automatically');

// The updater is what a named release must not break. It asks GitHub for
// /releases/latest and reads the authoritative version out of latest.yml, so
// neither the release title nor the tag can affect which build a user is offered.
// If someone ever switched it to parse the title, "Prism 1.0.6 - Spectrum" would
// stop parsing as a version and updates would silently never appear.
const updater = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'updater.js'), 'utf8');
assert(updater.includes('/releases/latest'), 'the updater resolves the newest published release');
assert(/assets\.find\(\(a\) => \/latest\\\.ya\?ml\$\/i\.test\(a\.name\)\)/.test(updater),
  'the updater reads the version from latest.yml');

assert(/version: parsed \? parsed\.version : String\(data\.tag_name/.test(updater),
  'the version comes from latest.yml, with the tag as a fallback when it is missing');
assert(updater.includes("replace(/^v/, '')"),
  'the tag fallback only strips the v prefix, so the tag must stay vX.Y.Z');
assert(!/data\.name\b|release\.name\b/.test(updater),
  'the release title is never read by the updater, so a codename cannot break it');
assert(/parsed && parsed\.file/.test(updater),
  'the installer filename also comes from latest.yml, not from the release title');

(async () => {
  const basePath = '/repos/shroomygod/PrismBrowser';

  // The real config, through electron-builder's own validator. This is the exact
  // check a failing release tripped, so a bad key can never reach the build again.
  if (validateSchema) {
    await validateSchema(Object.assign({}, pkg.build, { extraMetadata: {} }));
    console.log('  package.json validates against the electron-builder schema');
  }

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

  // Naming the published release: exact tag only, drafts refused.
  const renameCalls = [];
  const renamed = await updateReleaseName({
    basePath,
    tag: 'v1.2.3',
    name: '  Spectrum  ',
    request: async (apiPath, method, body) => {
      renameCalls.push([method, apiPath, body]);
      if (method === 'GET') {
        return [
          { id: 1, tag_name: 'v1.2.2' },
          { id: 2, tag_name: 'v1.2.3' },
          { id: 3, tag_name: 'v1.2.3-draft', draft: true }
        ];
      }
      return null;
    }
  });
  assert.strictEqual(renamed, 'Spectrum', 'the sanitised name is what gets published');
  assert.deepStrictEqual(renameCalls, [
    ['GET', basePath + '/releases?per_page=100', undefined],
    ['PATCH', basePath + '/releases/2', { name: 'Spectrum' }]
  ], 'only the published release carrying the exact tag is renamed');

  let renamedEmpty = '';
  try {
    await updateReleaseName({ basePath, tag: 'v1.2.3', name: '***', request: async () => [] });
  } catch (error) {
    renamedEmpty = error.message;
  }
  assert(/empty name/i.test(renamedEmpty), 'a name that sanitises to nothing is refused: ' + renamedEmpty);

  let renamedMissing = '';
  try {
    await updateReleaseName({ basePath, tag: 'v9.9.9', name: 'Spectrum', request: async () => [{ id: 1, tag_name: 'v1.2.3' }] });
  } catch (error) {
    renamedMissing = error.message;
  }
  assert(/no published release/i.test(renamedMissing), 'a missing release is reported, not silently ignored: ' + renamedMissing);

  // A draft for the same tag must not be hijacked into being the named release.
  let renamedDraft = '';
  try {
    await updateReleaseName({ basePath, tag: 'v1.2.3', name: 'Spectrum', request: async () => [{ id: 4, tag_name: 'v1.2.3', draft: true }] });
  } catch (error) {
    renamedDraft = error.message;
  }
  assert(/no published release/i.test(renamedDraft), 'drafts are never renamed: ' + renamedDraft);

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