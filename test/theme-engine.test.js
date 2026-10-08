'use strict';

// Catalog invariants for the theme engine: 35 hand-designed gallery themes
// with animated gradient frames and per-theme glowing cursors.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const pixelCursor = require('../src/pages/pixel-cursor');
assert.match(pixelCursor.css('#12abef'), /^url\("data:image\/svg\+xml,/);
assert.match(pixelCursor.css('#12abef'), /shape-rendering%3D%22crispEdges%22/);
assert.match(pixelCursor.css('#12abef'), /feDropShadow/, 'cursors glow in the theme tint');
assert.match(pixelCursor.pointer('#12abef'), /, pointer$/);
assert.match(pixelCursor.textCursor('#12abef'), /, text$/);
assert.match(pixelCursor.wait('#12abef'), /, wait$/, 'busy ring cursor is exposed');
assert.match(pixelCursor.move('#12abef'), /, move$/, 'move cursor is exposed');
assert.match(decodeURIComponent(pixelCursor.css('#12abef', 18).match(/data:image\/svg\+xml,([^"]+)/)[1]), /width="18" height="23"/, 'pointer respects the configured size');
assert.match(decodeURIComponent(pixelCursor.icon('#12abef', 'text', 18).match(/data:image\/svg\+xml,([^"]+)/)[1]), /width="18" height="24"/, 'text caret preserves its own aspect ratio');
assert.match(decodeURIComponent(pixelCursor.icon('#12abef', 'wait', 18).match(/data:image\/svg\+xml,([^"]+)/)[1]), /width="18" height="18"/, 'busy ring preserves a square aspect ratio');
assert.match(pixelCursor.stylesheet('#12abef'), /input\[type="text"\].*cursor:/);
assert.match(pixelCursor.stylesheet('#12abef'), /aria-busy/, 'page stylesheet covers busy indicators');
assert.doesNotMatch(pixelCursor.css('red'), /%23red/);
// Rainbow cursors blend rather than tint flat.
assert.match(decodeURIComponent(pixelCursor.css('#22d3ee', 20, 'rainbow').match(/data:image\/svg\+xml,([^"]+)/)[1]), /linearGradient/, 'rainbow cursor blends stops');
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'theme-engine.js'), 'utf8');
const sandbox = { window: { PrismPixelCursor: pixelCursor }, Math, Number, Object, String, Map, Set };
vm.runInNewContext(source, sandbox, { filename: 'theme-engine.js' });
const theme = sandbox.window.PrismTheme;

assert(theme, 'theme API is installed on window');
assert.strictEqual(theme.PRESETS.length, 35, 'catalog holds the 35 gallery themes');
assert.strictEqual(theme.CATEGORIES.length, 6, 'themes are grouped into 6 categories');
assert(theme.preset(theme.DEFAULT_PRESET), 'the default preset id resolves');
assert.strictEqual(theme.DEFAULT_PRESET, 'default-clean', 'the clean basic look is the default');

const categoryIds = new Set(theme.CATEGORIES.map((category) => category.id));
assert.strictEqual(categoryIds.size, 6, 'category ids are unique');
assert(theme.CATEGORIES.every((category) => typeof category.name === 'string' && category.name.length > 2), 'categories are named');
for (const category of theme.CATEGORIES) {
  assert(theme.presetsIn(category.id).length >= 3, `${category.id} retains gallery depth`);
}

// Legacy profiles keep resolving to a gallery equivalent.
assert.strictEqual(theme.preset('prism-dark').id, 'default-clean', 'legacy default maps forward');
assert.strictEqual(theme.preset('forest').id, 'forest-green', 'legacy forest maps forward');
assert.strictEqual(theme.preset('cosmic').id, 'space-galaxy', 'legacy cosmic maps forward');
assert.strictEqual(theme.preset('paper').id, 'sand-desert', 'legacy paper maps forward');

const ids = new Set();
const identities = new Set();
let animated = 0;
for (const item of theme.PRESETS) {
  assert(!ids.has(item.id), `theme id ${item.id} is unique`);
  ids.add(item.id);
  assert(typeof item.name === 'string' && item.name.length > 1, `${item.id} is named`);
  assert(categoryIds.has(item.category), `${item.id} belongs to a known category`);
  assert.strictEqual(typeof item.dark, 'boolean', `${item.id} declares light or dark`);
  for (const key of ['bg', 'ink', 'accent']) assert(theme.isHex(item[key]), `${item.id}.${key} is a hex colour`);
  assert(item.chrome || theme.isHex(item.solid), `${item.id} has a gradient or a solid frame`);
  if (item.chrome) {
    assert(item.chrome.every(theme.isHex), `${item.id} frame stops are hex colours`);
    assert(item.chrome.length >= 3, `${item.id} frame is a rich gradient, never flat`);
  }
  assert(theme.PATTERNS[item.pattern] !== undefined, `${item.id} uses a known texture`);
  assert(theme.MOTIONS.includes(item.motion), `${item.id} uses a known motion`);
  assert(typeof item.cursor === 'string' && item.cursor.length > 0, `${item.id} names a cursor variant`);
  if (item.motion !== 'none') animated += 1;
  const identity = `${item.bg}|${item.ink}|${item.accent}`;
  assert(!identities.has(identity), `${item.id} is not an exact palette clone`);
  identities.add(identity);
}
assert(animated >= 30, `most gallery themes animate (found ${animated})`);
assert(theme.PRESETS.some((item) => item.dark) && theme.PRESETS.some((item) => !item.dark), 'the catalog covers dark and light themes');
const basics = theme.presetsIn('default');
assert(basics.length === 3, 'default holds the three calm basics');
assert(basics.every((item) => item.motion === 'none'), 'basic looks sit still');

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

// Gallery frames are gradients (never flat) and carry texture + motion.
assert.match(theme.resolve('neon-purple').vars['--chrome-bg'], /linear-gradient/, 'gallery themes use a gradient frame');
assert.match(theme.resolve('matrix').vars['--chrome-bg'], /repeating-linear-gradient/, 'texture themes layer a pattern');
// Chrome layers stay valid inside `background-image`: images, sizes and
// positions travel in parallel vars, never as inline `0 0 / 26px` syntax
// (which voids the whole declaration and computes to `none`).
for (const item of theme.PRESETS) {
  const vars = theme.resolve(item.id).vars;
  assert.doesNotMatch(vars['--chrome-bg'], / \/ /, `${item.id} chrome image carries no inline position/size`);
  // Top-level commas only: gradient arguments nest rgba() calls.
  const splitTopLevel = (value) => {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const ch of String(value)) {
      if (ch === '(') depth += 1;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      if (ch === ',' && depth === 0) { parts.push(current); current = ''; }
      else current += ch;
    }
    parts.push(current);
    return parts;
  };
  const layerCount = splitTopLevel(vars['--chrome-bg']).length;
  assert(layerCount >= 1, `${item.id} chrome has at least one layer`);
  assert.strictEqual(vars['--chrome-background-size'].split(',').length, layerCount, `${item.id} sizes cover every chrome layer`);
  assert.strictEqual(vars['--chrome-background-position'].split(',').length, layerCount, `${item.id} positions cover every chrome layer`);
}
assert.strictEqual(theme.resolve('neon-purple').motion, 'shimmer', 'neon gallery theme animates');
assert.strictEqual(theme.resolve('default-clean').motion, 'none', 'basic look sits still');

// Every theme ships glowing custom cursors tinted to its accent.
for (const item of theme.PRESETS) {
  const resolved = theme.resolve(item.id);
  assert.match(resolved.vars['--cursor-image'], /data:image\/svg\+xml/, `${item.id} has a theme-colored pointer`);
  assert.match(resolved.vars['--cursor-image'], /feDropShadow/, `${item.id} pointer glows`);
  assert.match(resolved.vars['--cursor-pointer-image'], /, pointer$/, `${item.id} has a link hand cursor`);
  assert.match(resolved.vars['--cursor-text-image'], /, text$/, `${item.id} has a text caret`);
  assert.match(resolved.vars['--cursor-wait-image'], /, wait$/, `${item.id} has a busy ring cursor`);
  assert.match(resolved.vars['--cursor-move-image'], /, move$/, `${item.id} has a move cursor`);
  assert.match(resolved.vars['--cursor-icon-image'], /^url\("data:image\/svg\+xml,/, `${item.id} has a preview hand glyph`);
  assert.match(resolved.vars['--pixel-cursor-stylesheet'], /cursor:/, `${item.id} can style cursors on webpages`);
  assert.strictEqual(resolved.cursor, item.cursor, `${item.id} exposes its cursor variant`);
}

// Motion state, cursor state and custom frames stay respected.
const styleValues = {};
const element = { style: { setProperty: (key, value) => { styleValues[key] = value; } }, dataset: {} };
theme.apply(element, { themePreset: 'neon-purple', pixelCursor: true });
assert.strictEqual(element.dataset.themeMotion, 'shimmer', 'gallery motion is exposed');
assert.strictEqual(element.dataset.cursorName, 'neon', 'cursor variant is exposed');
assert.strictEqual(element.dataset.pixelCursor, 'true', 'pixel cursor preference is exposed');
assert.strictEqual(element.dataset.cursorSize, '20', 'the configured cursor size has a consistent default');
theme.apply(element, { themePreset: 'default-clean', pixelCursor: false, accessibility: { reducedMotion: 'reduce' } });
assert.strictEqual(element.dataset.themeMotion, 'none', 'basic looks do not animate');
assert.strictEqual(element.dataset.pixelCursor, 'false', 'cursor preference can be disabled');
assert.strictEqual(element.dataset.reduceMotion, 'reduce', 'reduced-motion preference remains respected');

const custom = theme.resolve({ themePreset: 'space-galaxy', customFrame: '#203040' });
assert.strictEqual(custom.vars['--chrome-gradient'], 'none', 'a custom frame is flat by choice');
assert.strictEqual(theme.resolve({ themePreset: 'sand-desert', customBackground: '#102030' }).dark, true, 'custom backgrounds determine light/dark');
assert.strictEqual(theme.resolve({ themePreset: 'sand-desert', customAccent: '#d1008a' }).vars['--accent'], '#d1008a', 'custom accent is preserved');

console.log('theme-engine.test.js: all assertions passed');
