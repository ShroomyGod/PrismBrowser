'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'theme-engine.js'), 'utf8');
const sandbox = { window: {}, Math, Number, Object, String };
vm.runInNewContext(source, sandbox, { filename: 'theme-engine.js' });
const theme = sandbox.window.PrismTheme;

assert(theme, 'theme API is installed on window');
assert.strictEqual(theme.THEME_COUNT, 69120, 'theme gallery exposes over 69,000 combinations');
assert.deepStrictEqual(Array.from(theme.GRADIENTS), ['aurora', 'sunset', 'ocean', 'candy', 'ember', 'forest', 'mono', 'none']);
assert.deepStrictEqual(Array.from(theme.MOTIONS), ['none', 'shimmer', 'drift', 'breathe', 'pulse', 'wave']);

const seen = new Set();
for (const index of [0, 1, 5, 6, 7, 8, 47, 48, 719, 720, 69119]) {
  const recipe = theme.fromIndex(index);
  assert(recipe.hue >= 0 && recipe.hue < 360, `hue is bounded for index ${index}`);
  assert(theme.GRADIENTS.includes(recipe.gradient), `gradient is valid for index ${index}`);
  assert(theme.MOTIONS.includes(recipe.motion), `motion is valid for index ${index}`);
  seen.add([recipe.hue, recipe.saturation, recipe.gradient, recipe.motion].join(':'));
}
assert.strictEqual(seen.size, 11, 'sampled generated indices map to distinct recipes');

const palette = theme.resolve({ hue: -20, saturation: 500, gradient: 'nope', motion: 'warp', intensity: -9 }, 'light');
assert.strictEqual(palette.hue, 0, 'out-of-range hue clamps to the supported range');
assert.strictEqual(palette.saturation, 95, 'saturation is clamped');
assert.strictEqual(palette.gradient, 'aurora', 'invalid gradient gets a safe default');
assert.strictEqual(palette.motion, 'none', 'invalid motion gets a safe default');
assert.match(palette['--accent'], /^hsl\(/, 'accent is a CSS HSL color');
assert.match(palette['--page-gradient'], /^radial-gradient\(/, 'page background uses a generated gradient');

const style = { values: {}, setProperty(key, value) { this.values[key] = value; } };
const element = { style, dataset: {} };
theme.apply(element, {
  theme: 'light',
  visualTheme: { hue: 190, gradient: 'ocean', motion: 'drift', intensity: 55 },
  accessibility: { textScale: 135, contrast: 'high', largerTargets: true, reducedMotion: 'reduce', focusIndicators: false }
});
assert.strictEqual(element.dataset.theme, 'light');
assert.strictEqual(element.dataset.gradient, 'ocean');
assert.strictEqual(element.dataset.motion, 'drift');
assert.strictEqual(element.dataset.contrast, 'high');
assert.strictEqual(element.dataset.largeTargets, 'true');
assert.strictEqual(element.dataset.focusVisible, 'subtle');
assert.strictEqual(element.dataset.reduceMotion, 'reduce');
assert.strictEqual(style.values['--ui-scale'], '1.35');

console.log('theme-engine.test.js: all assertions passed');
