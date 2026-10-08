'use strict';

// Catalog invariants for the theme engine, including all artwork-backed themes.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const pixelCursor = require('../src/pages/pixel-cursor');
assert.match(pixelCursor.css('#12abef'), /^url\("data:image\/svg\+xml,/);
assert.match(pixelCursor.css('#12abef'), /shape-rendering%3D%22crispEdges%22/);
assert.match(pixelCursor.pointer('#12abef'), /, pointer$/);
assert.match(pixelCursor.textCursor('#12abef'), /, text$/);
assert.match(pixelCursor.stylesheet('#12abef'), /input\[type="text"\].*cursor:/);
assert.doesNotMatch(pixelCursor.css('red'), /%23red/);
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'theme-engine.js'), 'utf8');
const sandbox = { window: { PrismPixelCursor: pixelCursor }, Math, Number, Object, String, Map, Set };
vm.runInNewContext(source, sandbox, { filename: 'theme-engine.js' });
const theme = sandbox.window.PrismTheme;

assert(theme, 'theme API is installed on window');
assert.strictEqual(theme.PRESETS.length, 167, 'catalog includes the 124 existing palettes and 43 illustrated themes');
assert.strictEqual(theme.CATEGORIES.length, 12, 'themes are grouped into 12 categories');
assert(theme.preset(theme.DEFAULT_PRESET), 'the default preset id resolves');

const categoryIds = new Set(theme.CATEGORIES.map((category) => category.id));
assert.strictEqual(categoryIds.size, 12, 'category ids are unique');
assert(theme.CATEGORIES.every((category) => typeof category.name === 'string' && category.name.length > 2), 'categories are named');
for (const category of theme.CATEGORIES) {
  assert(theme.presetsIn(category.id).length >= 10, `${category.id} retains gallery depth`);
}

const ids = new Set();
const identities = new Set();
const assets = new Set();
for (const item of theme.PRESETS) {
  assert(!ids.has(item.id), `theme id ${item.id} is unique`);
  ids.add(item.id);
  assert(typeof item.name === 'string' && item.name.length > 1, `${item.id} is named`);
  assert(categoryIds.has(item.category), `${item.id} belongs to a known category`);
  assert.strictEqual(typeof item.dark, 'boolean', `${item.id} declares light or dark`);
  for (const key of ['bg', 'ink', 'accent']) assert(theme.isHex(item[key]), `${item.id}.${key} is a hex colour`);
  assert(item.chrome || theme.isHex(item.solid), `${item.id} has a gradient or a solid frame`);
  if (item.chrome) assert(item.chrome.every(theme.isHex), `${item.id} frame stops are hex colours`);
  assert(theme.PATTERNS[item.pattern] !== undefined, `${item.id} uses a known texture`);
  assert(theme.MOTIONS.includes(item.motion), `${item.id} uses a known motion`);
  if (item.artwork) {
    assert(!assets.has(item.artwork), `${item.id} uses a distinct illustration`);
    assets.add(item.artwork);
    assert(fs.existsSync(path.join(__dirname, '..', 'assets', item.artwork)), `${item.id} illustration is present`);
  }
  const identity = `${item.bg}|${item.ink}|${item.accent}`;
  assert(!identities.has(identity), `${item.id} is not an exact palette clone`);
  identities.add(identity);
}
assert.strictEqual(assets.size, 43, 'the three reference themes and forty distinct scene themes are illustrated');
assert(theme.PRESETS.some((item) => item.dark) && theme.PRESETS.some((item) => !item.dark), 'the catalog covers dark and light themes');

// Palette token contrast invariants remain in force for every new theme.
for (const item of theme.PRESETS) {
  const vars = theme.resolve(item.id).vars;
  assert(theme.contrast(vars['--text'], vars['--bg']) >= 4.5, `${item.id} body text is readable`);
  assert(theme.contrast(vars['--text-dim'], vars['--bg']) >= 4.5, `${item.id} muted text is readable`);
  assert(theme.contrast(vars['--text-faint'], vars['--bg']) >= 3, `${item.id} faint text is visible`);
  assert(theme.contrast(vars['--accent'], vars['--bg']) >= 3, `${item.id} accent is visible`);
  assert(theme.contrast(vars['--chrome-ink'], vars['--chrome-color']) >= 4.5, `${item.id} chrome text is readable`);
  assert(theme.contrast(vars['--chrome-ink-dim'], vars['--chrome-color']) >= 3, `${item.id} muted chrome text is visible`);
  assert(theme.contrast(vars['--chrome-accent'], vars['--chrome-color']) >= 3, `${item.id} chrome accent is visible`);
  assert(theme.channelDrift(vars['--chrome-color'], vars['--chrome-active']) >= 9, `${item.id} active tab is distinguishable`);
}

assert.strictEqual(theme.resolve('solid-blue').vars['--chrome-gradient'], 'none', 'solid themes have no gradient');
assert.strictEqual(theme.resolve('solid-blue').vars['--chrome-bg'], 'none', 'solid themes have no image layer');
assert.strictEqual(theme.resolve('nord').vars['--chrome-bg'], theme.resolve('nord').vars['--chrome-gradient'], 'gradient themes use their CSS gradient');
assert.match(theme.resolve('carbon').vars['--chrome-bg'], /repeating-linear-gradient/, 'texture themes layer a pattern');
for (const item of theme.PRESETS.filter((preset) => preset.artwork)) {
  const resolved = theme.resolve(item.id);
  assert.match(resolved.vars['--chrome-bg'], new RegExp(`prism://assets/${item.artwork}`), `${item.id} layers local artwork into chrome`);
  assert.match(resolved.vars['--chrome-bg'], /linear-gradient\(rgba\(3, 7, 12, \.44\)/, `${item.id} preserves toolbar legibility`);
  assert.strictEqual(resolved.vars['--page-artwork'], `url("prism://assets/${item.artwork}")`, `${item.id} uses its scene on internal pages`);
  assert.strictEqual(resolved.vars['--chrome-background-size'], '100% 100%, cover', `${item.id} sizes its chrome art properly`);
  assert.match(resolved.vars['--cursor-image'], /data:image\/svg\+xml/, `${item.id} has a theme-colored pixel-art pointer`);
  assert.match(resolved.vars['--cursor-pointer-image'], /, pointer$/, `${item.id} has a pixel-art link cursor`);
  assert.match(resolved.vars['--cursor-icon-image'], /^url\("data:image\/svg\+xml,/, `${item.id} has a preview hand glyph`);
  assert.match(resolved.vars['--pixel-cursor-stylesheet'], /cursor:/, `${item.id} can style cursors on webpages`);
}

// A scene theme has opt-in motion; accessible motion and custom frames stay respected.
const styleValues = {};
const element = { style: { setProperty: (key, value) => { styleValues[key] = value; } }, dataset: {} };
theme.apply(element, { themePreset: 'neon-avenue', pixelCursor: false });
assert.strictEqual(element.dataset.themeArtwork, 'true', 'illustrated chrome state is exposed');
assert.strictEqual(element.dataset.themeMotion, 'drift', 'illustrated motion is exposed');
assert.strictEqual(element.dataset.pixelCursor, 'false', 'pixel cursor preference is exposed');
theme.apply(element, { themePreset: 'catppuccin-mocha', pixelCursor: true, accessibility: { reducedMotion: 'reduce' } });
assert.strictEqual(element.dataset.themeArtwork, 'false', 'regular themes clear artwork state');
assert.strictEqual(element.dataset.themeMotion, 'none', 'static palettes do not animate scene art');
assert.strictEqual(element.dataset.pixelCursor, 'true', 'cursor preference can be enabled');
assert.strictEqual(element.dataset.reduceMotion, 'reduce', 'reduced-motion preference remains respected');

const custom = theme.resolve({ themePreset: 'cosmic', customFrame: '#203040' });
assert.strictEqual(custom.vars['--page-artwork'], 'none', 'a custom frame is not silently covered by page art');
assert(!custom.vars['--chrome-bg'].includes('theme-cosmic.svg'), 'custom frame takes precedence over chrome artwork');
assert.strictEqual(theme.resolve({ themePreset: 'paper', customBackground: '#102030' }).dark, true, 'custom backgrounds determine light/dark');
assert.strictEqual(theme.resolve({ themePreset: 'paper', customAccent: '#ff00aa' }).vars['--accent'], '#ff00aa', 'custom accent is preserved');

console.log('theme-engine.test.js: all assertions passed');
