'use strict';

// Catalog invariants for the theme engine.
//
// The point of these assertions is the user's complaint: the old gallery was a
// hue x gradient cross-product, so swatches clashed. A curated catalog is only
// better if the properties that made it "random" are now *enforced*, so this
// test holds every theme to real contrast minimums, a monotone surface ramp,
// and a unique identity — rather than just counting swatches.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'theme-engine.js'), 'utf8');
const sandbox = { window: {}, Math, Number, Object, String };
vm.runInNewContext(source, sandbox, { filename: 'theme-engine.js' });
const theme = sandbox.window.PrismTheme;

assert(theme, 'theme API is installed on window');

// ---- shape of the catalog -------------------------------------------------
assert.strictEqual(theme.PRESETS.length, 124, 'catalog holds a Chrome-scale gallery of 124 designed themes');
assert.strictEqual(theme.CATEGORIES.length, 12, 'themes are grouped into 12 categories');
assert(theme.preset(theme.DEFAULT_PRESET), 'the default preset id resolves');

const categoryIds = new Set(theme.CATEGORIES.map((c) => c.id));
assert.strictEqual(categoryIds.size, 12, 'category ids are unique');
assert(theme.CATEGORIES.every((c) => typeof c.name === 'string' && c.name.length > 2), 'categories are named');
for (const category of theme.CATEGORIES) {
  assert(
    theme.presetsIn(category.id).length >= 10,
    `category ${category.id} holds at least 10 themes (Chrome-scale depth)`
  );
}

const ids = new Set();
const identities = new Set();
for (const item of theme.PRESETS) {
  assert(!ids.has(item.id), `theme id ${item.id} is unique`);
  ids.add(item.id);
  assert(typeof item.name === 'string' && item.name.length > 1, `${item.id} is named`);
  assert(categoryIds.has(item.category), `${item.id} belongs to a known category`);
  assert.strictEqual(typeof item.dark, 'boolean', `${item.id} declares light or dark`);

  // Authoring is four colours; anything else would be a hand-tuned override
  // that could drift away from the ramp the engine derives.
  for (const key of ['bg', 'ink', 'accent']) {
    assert(theme.isHex(item[key]), `${item.id}.${key} is a hex colour (got ${item[key]})`);
  }
  assert(item.chrome || theme.isHex(item.solid), `${item.id} has a gradient or a solid frame colour`);
  if (item.chrome) assert(item.chrome.every(theme.isHex), `${item.id} frame stops are hex colours`);
  assert(theme.PATTERNS[item.pattern] !== undefined, `${item.id} uses a known texture`);
  assert(theme.MOTIONS.includes(item.motion), `${item.id} uses a known motion`);

  // The old failure mode, made a test: two themes that share a background are
  // the same theme wearing a different label.
  const identity = `${item.bg}|${item.ink}|${item.accent}`;
  assert(!identities.has(identity), `${item.id} is not a recolour of another theme`);
  identities.add(identity);
}

const backgrounds = new Set(theme.PRESETS.map((item) => item.bg));
assert.strictEqual(backgrounds.size, theme.PRESETS.length, 'every theme has its own background');
assert(
  theme.PRESETS.some((item) => item.dark) && theme.PRESETS.some((item) => !item.dark),
  'the catalog covers both light and dark themes'
);

// ---- legibility -----------------------------------------------------------
// Asserted on the *resolved* tokens rather than the authored hexes: derivation
// is allowed to adjust an accent or muted value to reach these floors, and
// these are the colours the user actually reads.
for (const item of theme.PRESETS) {
  const vars = theme.resolve(item.id).vars;
  const text = theme.contrast(vars['--text'], vars['--bg']);
  assert(text >= 4.5, `${item.id} body text contrast is ${text.toFixed(2)}:1 (needs 4.5:1)`);
  const dim = theme.contrast(vars['--text-dim'], vars['--bg']);
  assert(dim >= 4.5, `${item.id} muted text contrast is ${dim.toFixed(2)}:1 (needs 4.5:1)`);
  const faint = theme.contrast(vars['--text-faint'], vars['--bg']);
  assert(faint >= 3, `${item.id} faint text contrast is ${faint.toFixed(2)}:1 (needs 3:1)`);
  const accent = theme.contrast(vars['--accent'], vars['--bg']);
  assert(accent >= 3, `${item.id} accent contrast is ${accent.toFixed(2)}:1 (needs 3:1)`);

  // Toolbar text sits on the frame colour, not on the page background, and a
  // solid-colour frame needs its own ink and its own accent to stay readable.
  const frame = vars['--chrome-color'];
  const frameText = theme.contrast(vars['--chrome-ink'], frame);
  assert(frameText >= 4.5, `${item.id} toolbar text contrast is ${frameText.toFixed(2)}:1 (needs 4.5:1)`);
  const frameDim = theme.contrast(vars['--chrome-ink-dim'], frame);
  assert(frameDim >= 3, `${item.id} toolbar muted text is ${frameDim.toFixed(2)}:1 (needs 3:1)`);
  const frameAccent = theme.contrast(vars['--chrome-accent'], frame);
  assert(frameAccent >= 3, `${item.id} toolbar accent is ${frameAccent.toFixed(2)}:1 (needs 3:1)`);

  // The active tab has to be visibly raised off the frame it sits on.
  const lift = theme.channelDrift(frame, vars['--chrome-active']);
  assert(lift >= 9, `${item.id} active tab lifts only ${lift.toFixed(1)}/255 off the frame (needs 9)`);
}

// ---- derived tokens -------------------------------------------------------
for (const id of [theme.DEFAULT_PRESET, 'nord', 'solid-blue', 'carbon', 'paper', 'nosuchtheme']) {
  const resolved = theme.resolve(id);
  assert(resolved && resolved.vars, `${id} resolves to a token set`);
  const expectedId = id === 'nosuchtheme' ? theme.DEFAULT_PRESET : id;
  assert.strictEqual(resolved.id, expectedId, `${id} resolves to ${expectedId}`);
  assert.strictEqual(theme.resolve(id).ink, theme.resolve(resolved).ink, 'resolution is stable');
  for (const [key, value] of Object.entries(resolved.vars)) {
    assert(key.startsWith('--'), `${id}: ${key} is a CSS custom property`);
    assert(typeof value === 'string' && value.length > 0, `${id}: ${key} has a value`);
  }
  assert(resolved.vars['--chrome-bg'] !== undefined, `${id} paints a chrome background`);
  assert.strictEqual(resolved.vars['--text'], resolved.ink, `${id} primary text is the theme ink`);
  assert(theme.contrast(resolved.vars['--text-dim'], resolved.vars['--bg']) >= 4.5, `${id} exported dim text stays legible`);

  // Surface ramp must move monotonically away from the background toward the
  // ink, and each step must be big enough to see. Measured in channel space
  // rather than WCAG contrast: adjacent UI surfaces legitimately sit near
  // 1.01:1, so a contrast ratio says nothing about whether a step is visible.
  const channels = (value) => [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
  const drift = (a, b) => {
    const left = channels(a);
    const right = channels(b);
    return (left[0] - right[0] + left[1] - right[1] + left[2] - right[2]) / 3;
  };
  const inkDirection = Math.sign(drift(resolved.bg, resolved.ink));
  const ramp = ['--bg2', '--bg3', '--bg4'].map((key) => resolved.vars[key]);
  for (let step = 0; step < ramp.length; step++) {
    const separation = Math.abs(drift(resolved.vars['--bg'], ramp[step]));
    assert(separation >= 4, `${id} raises surface ${step + 2} by ${separation.toFixed(1)}/255 (needs 4)`);
    assert(
      Math.sign(drift(resolved.vars['--bg'], ramp[step])) === inkDirection,
      `${id} surface ${step + 2} moves toward the ink, not away from it`
    );
    if (step > 0) {
      const ordered = drift(ramp[step - 1], ramp[step]);
      assert(
        Math.sign(ordered) === inkDirection && Math.abs(ordered) >= 3,
        `${id} surfaces stay ordered and visibly separated at step ${step + 2}`
      );
    }
  }
}

// Solid themes paint a flat frame through --chrome-color (no gradient layer),
// while gradient and textured themes compose --chrome-bg as one shorthand.
assert.strictEqual(theme.resolve('solid-blue').vars['--chrome-gradient'], 'none', 'solid themes have no gradient');
assert.strictEqual(theme.resolve('solid-blue').vars['--chrome-bg'], 'none', 'solid themes need no image layer');
assert.strictEqual(theme.resolve('solid-blue').vars['--chrome-color'], '#2563eb', 'solid themes keep their flat frame colour');
assert.strictEqual(theme.resolve('nord').vars['--chrome-bg'], theme.resolve('nord').vars['--chrome-gradient'],
  'an untextured gradient theme uses its gradient verbatim');
assert.match(theme.resolve('carbon').vars['--chrome-bg'], /repeating-linear-gradient/, 'textured themes layer a pattern');
assert.match(theme.resolve('nord').vars['--chrome-bg'], /linear-gradient\(105deg/, 'gradient themes keep their authored angle');
assert.strictEqual(theme.resolve('nord').dark, true, 'nord is a dark theme');
assert.strictEqual(theme.resolve('paper').dark, false, 'paper is a light theme');
assert(theme.resolve('paper').vars['--text-dim'].startsWith('#'), 'tokens are hex, not hsl math');
for (const item of theme.PRESETS) {
  const vars = theme.resolve(item.id).vars;
  for (const key of ['--bg', '--bg2', '--bg3', '--bg4', '--line', '--line-soft', '--text', '--text-dim', '--text-faint', '--accent', '--chrome-color', '--chrome-ink', '--chrome-accent', '--chrome-active']) {
    assert(theme.isHex(vars[key]), `${item.id}: ${key} resolves to hex (got ${vars[key]})`);
  }
}
// A saturated solid frame must not force white-on-white toolbar labels.
assert.notStrictEqual(theme.resolve('solid-blue').vars['--chrome-ink'], theme.resolve('solid-blue').ink,
  'a saturated frame gets its own readable ink');
assert.notStrictEqual(theme.resolve('solid-slate').vars['--chrome-accent'], theme.resolve('solid-slate').vars['--accent'],
  'a frame painted in the accent gets a separate chrome accent');

// ---- application ----------------------------------------------------------
const styleValues = {};
const documentElement = {
  style: { setProperty: (key, value) => { styleValues[key] = value; } },
  dataset: {}
};
theme.apply(documentElement, {
  themePreset: 'catppuccin-mocha',
  accessibility: { textScale: 135, contrast: 'high', largerTargets: true, reducedMotion: 'reduce', focusIndicators: false }
});
assert.strictEqual(documentElement.dataset.theme, 'dark', 'theme mode follows the preset');
assert.strictEqual(documentElement.dataset.themePreset, 'catppuccin-mocha', 'the active preset is exposed');
assert.strictEqual(documentElement.dataset.motion, 'none', 'motion follows the preset');
assert.strictEqual(documentElement.dataset.animationTheme, 'basic', 'the default animation theme is exposed');
theme.apply(documentElement, {
  themePreset: 'catppuccin-mocha',
  animationTheme: 'playful',
  accessibility: { textScale: 135, contrast: 'high', largerTargets: true, reducedMotion: 'reduce', focusIndicators: false }
});
assert.strictEqual(documentElement.dataset.animationTheme, 'playful', 'a selected animation theme is exposed');
theme.apply(documentElement, {
  themePreset: 'catppuccin-mocha',
  animationTheme: 'unsupported',
  accessibility: { textScale: 135, contrast: 'high', largerTargets: true, reducedMotion: 'reduce', focusIndicators: false }
});
assert.strictEqual(documentElement.dataset.animationTheme, 'basic', 'unknown animation themes fall back safely');
assert.strictEqual(documentElement.dataset.contrast, 'high', 'high contrast is exposed');
assert.strictEqual(documentElement.dataset.largeTargets, 'true', 'larger targets are exposed');
assert.strictEqual(documentElement.dataset.reduceMotion, 'reduce', 'reduced motion is exposed');
assert.strictEqual(documentElement.dataset.focusVisible, 'subtle', 'focus indicator setting is exposed');
assert.strictEqual(styleValues['--ui-scale'], '1.35', 'text scale is applied');
assert.strictEqual(styleValues['--text-dim'], styleValues['--text'], 'high contrast collapses muted text to the ink');
assert.strictEqual(styleValues['--line'], styleValues['--text'], 'high contrast strengthens borders');
assert.strictEqual(styleValues['--accent'], theme.resolve('catppuccin-mocha').vars['--accent'], 'accent comes from the preset');

// An unknown or missing preset must fall back to the default rather than
// leaving the UI on unstyled values.
const bare = { style: { setProperty: () => {} }, dataset: {} };
theme.apply(bare, {});
assert.strictEqual(bare.dataset.themePreset, theme.DEFAULT_PRESET, 'missing preset falls back to the default');
theme.apply(null, {});

// ---- random pick ----------------------------------------------------------
for (let i = 0; i < 200; i++) {
  const picked = theme.randomPresetId('nord');
  assert(ids.has(picked), 'random pick is always a real theme');
  assert.notStrictEqual(picked, 'nord', 'random pick is not the current theme');
}
assert.ok(theme.randomPresetId(), 'random pick works with no current theme');

console.log('theme-engine.test.js: all assertions passed');
