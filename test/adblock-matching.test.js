'use strict';

// Regression test for the adblock rule compiler. A legacy EasyList pattern such
// as "/addyn|*|adtech;" contains literal "|" characters; compiling those as
// regex alternation produced match-everything rules that cancelled every
// stylesheet and image request, and web pages rendered as unstyled HTML.
const Module = require('module');
const assert = require('assert');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const settingsStub = {
  _data: { privacy: { adblock: { enabled: true, perSite: {}, customRules: '' } } },
  all() { return this._data; },
  set() { return this._data; },
  get() { return undefined; },
  writeBootstrap() {}
};
const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') {
    return {
      net: { fetch: async () => ({ ok: false }) },
      app: { getPath: () => path.join(os.tmpdir(), 'prism-adblock-test'), isPackaged: false }
    };
  }
  if (request === './settings' && arguments[1] && String(arguments[1].filename).startsWith(path.join(ROOT, 'src', 'main'))) {
    return settingsStub;
  }
  return originalLoad.apply(this, arguments);
};

const adblock = require(path.join(ROOT, 'src', 'main', 'adblock.js'));

adblock.recompile([
  [
    '! Title: Prism adblock regression fixtures',
    '/addyn|*|adtech;',
    '/adiframe|*|adtech;',
    '/adunit/track-view|',
    '/ads/banner.gif$image',
    '/site-widget.css$stylesheet',
    '||ads.example-tracker.com^$third-party',
    '|https://cdn.example.com/ads/style.css',
    '||blocked-domain.invalid^'
  ].join('\n')
]);

const cases = [
  // [blocked?, resourceType, url, siteHost, description]
  [false, 'stylesheet', 'https://github.githubassets.com/assets/dark-1234.css', 'github.com',
    'a literal-pipe legacy rule must not match an unrelated stylesheet'],
  [false, 'image', 'https://avatars.githubusercontent.com/u/1?v=4', 'github.com',
    'a literal-pipe legacy rule must not match an unrelated image'],
  [false, 'stylesheet', 'https://chromewebstore.google.com/main.css', 'chromewebstore.google.com',
    'site stylesheets stay loadable'],
  [true, 'xmlhttprequest', 'https://page.example/click?ref=/addyn|*|adtech;', 'page.example',
    'the rule still matches a URL that actually contains the literal pipe'],
  [true, 'image', 'https://page.example/ads/banner.gif', 'page.example',
    'explicit $image rules still block'],
  [true, 'stylesheet', 'https://page.example/site-widget.css', 'page.example',
    'explicit $stylesheet rules still block'],
  [true, 'image', 'https://cdn.ads.example-tracker.com/pixel.gif', 'page.example',
    'anchored ||host^ third-party rules still block'],
  [true, 'stylesheet', 'https://cdn.example.com/ads/style.css', 'page.example',
    'prefix-anchored |https:// rules still block'],
  [true, 'document', 'https://blocked-domain.invalid/', '',
    'anchored ||host^ rules can still block a navigation'],
  [false, 'document', 'https://github.com/', 'github.com',
    'navigations are not blocked by unanchored rules']
];

for (const [blocked, type, url, site, description] of cases) {
  const actual = adblock.match(url, type, site);
  assert.strictEqual(actual, blocked, description + ' (got ' + actual + ' for ' + url + ')');
}

// Defense in depth: even if a future list ships another match-everything
// untyped rule, it must not be able to strip a page's styling.
adblock.recompile(['/.*/']);
assert.strictEqual(adblock.match('https://example.com/app.css', 'stylesheet', 'example.com'), false,
  'an unanchored untyped rule cannot cancel a stylesheet');
assert.strictEqual(adblock.match('https://example.com/font.woff2', 'font', 'example.com'), false,
  'an unanchored untyped rule cannot cancel a font');

console.log('adblock-matching.test.js: all assertions passed');