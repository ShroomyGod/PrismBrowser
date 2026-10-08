// theme-engine.js — Prism's theme catalog and design tokens.
//
// Themes here are *designed*, not generated. The earlier implementation was a
// cross-product of 360 hues x 4 saturations x 8 gradients x 6 motions, which
// produced 69,120 recipes that mostly did not hang together: the accent came
// from one hue while the chrome gradient was sampled at fixed offsets from a
// different part of the wheel, so neighbouring swatches clashed and none of
// them resembled a real product's palette.
//
// Instead every entry below is a hand-picked palette that already works: one
// background, one ink, one accent, one frame colour. Everything else (the
// surface ramp, borders, muted text, chrome highlight, texture overlay) is
// derived from those four by mixing toward the ink, which is what keeps the
// catalog internally consistent. Most themes use CSS finishes; a few signature
// themes pair their palette with original, local SVG chrome artwork.
'use strict';

(function installThemeEngine(root) {
  // ---- colour maths -------------------------------------------------------
  // Small and dependency-free on purpose: the catalog is data, and the tests
  // need contrast ratios, so the maths has to be reachable and inspectable.

  const clamp = (value, min, max, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };

  function parseHex(input, fallback) {
    const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(String(input == null ? '' : input).trim());
    if (!match) return parseHex(fallback, '#808080');
    let hex = match[1];
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16)
    ];
  }

  const toHex = (rgb) => '#' + rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

  // Mix two colours. Every derived surface in the catalog goes through here
  // toward the theme's own ink, which is why light and dark themes can share
  // one ramp recipe: on a dark theme the ink is light and surfaces rise, on a
  // light theme it is the reverse.
  function mix(from, to, amount) {
    const a = parseHex(from);
    const b = parseHex(to);
    const t = clamp(amount, 0, 1, 0);
    return toHex([
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t
    ]);
  }

  const alpha = (color, value) => {
    const rgb = parseHex(color);
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${clamp(value, 0, 1, 0).toFixed(3)})`;
  };

  // WCAG relative luminance, exposed so tests can hold every preset to a real
  // contrast minimum instead of trusting that the hexes look fine.
  function luminance(color) {
    const channel = (raw) => {
      const c = raw / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const rgb = parseHex(color);
    return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  }

  function contrast(foreground, background) {
    const a = luminance(foreground);
    const b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  const isHex = (value) => /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(String(value || '').trim());

  // ---- texture overlays ---------------------------------------------------
  // Textures are the one "Chrome gallery" idea worth copying without shipping
  // a single image file: a repeating gradient layered over the frame colour.
  // Each value is a complete background layer - image *and* size - so it can be
  // joined into one `background` shorthand. The explicit size matters: the
  // chrome animates background-size for its motion themes, which would
  // otherwise stretch the texture along with it.
  const FULL = ' / 100% 100%';
  const PATTERNS = {
    none: null,
    grain: `repeating-linear-gradient(115deg, rgba(255,255,255,.045) 0 1px, rgba(0,0,0,.05) 1px 3px)${FULL}`,
    weave: `repeating-linear-gradient(0deg, rgba(255,255,255,.05) 0 1px, transparent 1px 4px)${FULL}, repeating-linear-gradient(90deg, rgba(0,0,0,.07) 0 1px, transparent 1px 4px)${FULL}`,
    grid: `repeating-linear-gradient(0deg, rgba(255,255,255,.055) 0 1px, transparent 1px 24px)${FULL}, repeating-linear-gradient(90deg, rgba(255,255,255,.055) 0 1px, transparent 1px 24px)${FULL}`,
    lattice: `repeating-linear-gradient(60deg, rgba(255,255,255,.05) 0 1px, transparent 1px 11px)${FULL}, repeating-linear-gradient(-60deg, rgba(255,255,255,.05) 0 1px, transparent 1px 11px)${FULL}`,
    scan: `repeating-linear-gradient(0deg, rgba(0,0,0,.22) 0 1px, transparent 1px 3px)${FULL}`,
    brush: `repeating-linear-gradient(100deg, rgba(255,255,255,.05) 0 2px, rgba(0,0,0,.06) 2px 5px)${FULL}`,
    carbon: `repeating-linear-gradient(45deg, rgba(255,255,255,.035) 0 2px, transparent 2px 5px)${FULL}, repeating-linear-gradient(-45deg, rgba(0,0,0,.06) 0 2px, transparent 2px 5px)${FULL}`,
    marble: `radial-gradient(130% 90% at 18% -10%, rgba(255,255,255,.12), transparent 55%)${FULL}, radial-gradient(90% 70% at 85% 110%, rgba(0,0,0,.16), transparent 60%)${FULL}`,
    speck: 'radial-gradient(rgba(255,255,255,.11) 1.2px, transparent 1.4px) 0 0 / 15px 15px, radial-gradient(rgba(0,0,0,.09) 1.2px, transparent 1.4px) 7px 8px / 15px 15px'
  };

  // Motion is now a property of a theme rather than a random switch: only the
  // themes whose artwork implies movement (aurora, neon, scanlines) animate.
  const MOTION_DURATIONS = {
    none: '0s', shimmer: '9s', drift: '15s', breathe: '11s', pulse: '7s', wave: '17s'
  };
  const MOTIONS = Object.keys(MOTION_DURATIONS);

  const CATEGORIES = [
    { id: 'default', name: 'Default' },
    { id: 'solid', name: 'Solid colours' },
    { id: 'developer', name: 'Developer classics' },
    { id: 'light', name: 'Light and paper' },
    { id: 'nature', name: 'Landscapes' },
    { id: 'textures', name: 'Textures' },
    { id: 'earth', name: 'Earth tones' },
    { id: 'vivid', name: 'Vivid and neon' },
    { id: 'pastel', name: 'Pastel and soft' },
    { id: 'retro', name: 'Retro and arcade' },
    { id: 'cinematic', name: 'Cinematic' },
    { id: 'monochrome', name: 'Monochrome' }
  ];

  const DEFAULT_PRESET = 'prism-dark';
  const MIN_ILLUSTRATED_THEMES = 40;

  // ---- authoring helpers --------------------------------------------------
  // Compact on purpose: a theme is four colours and a couple of switches, and
  // the ramp is derived. Spelling out 15 CSS variables per theme is how
  // catalogs drift out of sync with each other.
  function preset(id, name, category, dark, bg, ink, accent, chrome, extra) {
    const stops = Array.isArray(chrome) ? chrome.slice() : [chrome];
    return Object.assign({
      id,
      name,
      category,
      dark: Boolean(dark),
      bg,
      ink,
      accent,
      chrome: stops.length > 1 ? stops : null,   // null means a flat solid frame
      solid: stops.length > 1 ? null : stops[0],
      angle: 110,
      motion: 'none',
      pattern: 'none'
    }, extra || {});
  }

  // "Solid colours" is literally one colour: derive a tinted paper and a deep
  // ink from the same hue so the page and the frame always belong together.
  const solid = (id, name, color) => preset(
    id, name, 'solid', false,
    mix(color, '#ffffff', 0.945), mix(color, '#0b0d10', 0.88), color, color
  );

  // ---- the catalog --------------------------------------------------------

  const PRESETS = [
    // Default — Prism's own four looks, tuned to be legible first.
    preset('prism-dark', 'Prism Dark', 'default', true, '#14161c', '#f2f5f9', '#7aa2f7', ['#1d2230', '#14161c', '#262d3f'], { motion: 'shimmer' }),
    preset('prism-light', 'Prism Light', 'default', false, '#f6f7f9', '#16181d', '#2f6bff', ['#ffffff', '#f2f4f8', '#e8ecf3']),
    preset('prism-midnight', 'Prism Midnight', 'default', true, '#0b0d12', '#e6ebf5', '#5eead4', ['#0f141c', '#0b0d12', '#141b26'], { motion: 'drift' }),
    preset('prism-dusk', 'Prism Dusk', 'default', true, '#191a24', '#eceaf6', '#b39dfb', ['#232437', '#191a24', '#2d2c45'], { motion: 'breathe' }),
    preset('prism-noir', 'Prism Noir', 'default', true, '#0a0a0a', '#fafafa', '#d7d7dc', ['#141414', '#0a0a0a', '#1f1f1f']),
    preset('prism-daylight', 'Prism Daylight', 'default', false, '#f2f4f7', '#1a1d23', '#0f766e', ['#fbfcfd', '#eef1f5', '#e0e5ec']),
    preset('prism-warm', 'Prism Warm', 'default', true, '#1a1512', '#f5ece4', '#e8a05c', ['#241d18', '#1a1512', '#302620']),
    preset('prism-cool', 'Prism Cool', 'default', true, '#111519', '#e9f0f5', '#6fb3d9', ['#1a2128', '#111519', '#232c35'], { angle: 120 }),
    // Maximum-contrast pair for users who need the browser to be as plain as
    // possible; still a real theme rather than an accessibility afterthought.
    preset('prism-contrast-dark', 'Prism Contrast Dark', 'default', true, '#000000', '#ffffff', '#ffdd33', '#000000'),
    preset('prism-contrast-light', 'Prism Contrast Light', 'default', false, '#ffffff', '#000000', '#0b3ea8', '#ffffff'),

    // Solid colours — flat frames, tinted pages, no gradients at all.
    solid('solid-blue', 'Blue', '#2563eb'),
    solid('solid-teal', 'Teal', '#0d9488'),
    solid('solid-green', 'Green', '#16a34a'),
    solid('solid-olive', 'Olive', '#65a30d'),
    solid('solid-amber', 'Amber', '#ca8a04'),
    solid('solid-orange', 'Orange', '#ea580c'),
    solid('solid-red', 'Red', '#dc2626'),
    solid('solid-rose', 'Rose', '#e11d48'),
    solid('solid-pink', 'Pink', '#db2777'),
    solid('solid-purple', 'Purple', '#7c3aed'),
    solid('solid-indigo', 'Indigo', '#4f46e5'),
    solid('solid-slate', 'Slate', '#475569'),

    // Developer classics — real design systems, with their published values.
    preset('nord', 'Nord', 'developer', true, '#2e3440', '#eceff4', '#88c0d0', ['#3b4252', '#2e3440', '#434c5e'], { angle: 105 }),
    preset('catppuccin-mocha', 'Catppuccin Mocha', 'developer', true, '#1e1e2e', '#cdd6f4', '#cba6f7', ['#313244', '#1e1e2e', '#45475a'], { angle: 120 }),
    preset('dracula', 'Dracula', 'developer', true, '#282a36', '#f8f8f2', '#bd93f9', ['#343746', '#282a36', '#44475a']),
    preset('tokyo-night', 'Tokyo Night', 'developer', true, '#1a1b26', '#c0caf5', '#7aa2f7', ['#24283b', '#1a1b26', '#2f3449'], { angle: 100 }),
    preset('gruvbox-dark', 'Gruvbox Dark', 'developer', true, '#282828', '#ebdbb2', '#fabd2f', ['#3c3836', '#282828', '#504945'], { angle: 115 }),
    preset('one-dark', 'One Dark', 'developer', true, '#282c34', '#abb2bf', '#61afef', ['#21252b', '#282c34', '#3e4451'], { angle: 95 }),
    preset('rose-pine', 'Rosé Pine', 'developer', true, '#191724', '#e0def4', '#ebbcba', ['#26233a', '#191724', '#403d52']),
    preset('ayu-mirage', 'Ayu Mirage', 'developer', true, '#1f2430', '#e6e1cf', '#ffcc66', ['#1a1f29', '#1f2430', '#2c313d'], { angle: 125 }),
    preset('kanagawa', 'Kanagawa', 'developer', true, '#1f1f28', '#dcd7ba', '#7e9cd8', ['#2a2a37', '#1f1f28', '#363646']),
    preset('zenburn', 'Zenburn', 'developer', true, '#363636', '#dcdccc', '#7f9fcf', ['#4e4e4e', '#363636', '#5f5f5f'], { angle: 110, pattern: 'grain' }),

    // Light and paper — reading-first palettes.
    preset('catppuccin-latte', 'Catppuccin Latte', 'light', false, '#eff1f5', '#4c4f69', '#8839ef', ['#e6e9ef', '#eff1f5', '#dce0e8'], { angle: 120 }),
    preset('solarized-light', 'Solarized Light', 'light', false, '#fdf6e3', '#586e75', '#268bd2', ['#f4ecd8', '#fdf6e3', '#eee8d5']),
    // GitHub's page is pure white; the one-off value here keeps it distinct
    // from the maximum-contrast light theme, which must stay #ffffff.
    preset('github-light', 'GitHub Light', 'light', false, '#fcfcfd', '#24292f', '#0969da', ['#f6f8fa', '#ffffff', '#eaeef2'], { angle: 100 }),
    preset('rose-pine-dawn', 'Rosé Pine Dawn', 'light', false, '#faf4ed', '#575279', '#eb6f92', ['#fffaf3', '#faf4ed', '#f2e9e1']),
    preset('gruvbox-light', 'Gruvbox Light', 'light', false, '#fbf1c7', '#3c3836', '#79740e', ['#f2e5bc', '#fbf1c7', '#ebdbb2'], { angle: 115 }),
    preset('vitesse-light', 'Vitesse Light', 'light', false, '#fdfdfc', '#393a34', '#1c6b48', ['#f7f7f5', '#fdfdfc', '#ededec'], { angle: 100 }),
    preset('snazzy-light', 'Snazzy Light', 'light', false, '#f7f7f7', '#49483e', '#ff5c57', ['#ffffff', '#f7f7f7', '#eeece8'], { angle: 120 }),
    preset('one-light', 'One Light', 'light', false, '#fafafa', '#383a42', '#4078f2', ['#ffffff', '#fafafa', '#eaeaeb'], { angle: 100 }),
    preset('atelier-plateau', 'Atelier Plateau', 'light', false, '#fff1e5', '#4f424c', '#c46c70', ['#fff7ed', '#fff1e5', '#ffe9d6']),
    preset('paper', 'Paper', 'light', false, '#fdfcf9', '#1a1a1a', '#0b7285', ['#ffffff', '#f6f5f0', '#eae8e1'], { pattern: 'grain' }),

    // Landscapes — frames coloured like places.
    preset('forest', 'Forest', 'nature', true, '#14201a', '#e8f2ea', '#7bd88f', ['#1b2c22', '#14201a', '#24402f'], { angle: 120 }),
    preset('ocean', 'Ocean', 'nature', true, '#0c1c2b', '#e6f1f8', '#57c4e5', ['#123049', '#0c1c2b', '#1a4463'], { angle: 115, motion: 'drift' }),
    preset('desert', 'Desert', 'nature', true, '#241a12', '#f6ecdd', '#e0a35c', ['#33251a', '#241a12', '#453322'], { angle: 110 }),
    preset('glacier', 'Glacier', 'nature', true, '#101c24', '#e8f4fa', '#8fd4ee', ['#182b36', '#101c24', '#22404f'], { angle: 120 }),
    preset('aurora-fields', 'Aurora Fields', 'nature', true, '#0d1a1e', '#e4f6f2', '#6ee7b7', ['#12262b', '#0d1a1e', '#1c3b41'], { angle: 115, motion: 'drift' }),
    preset('mountain', 'Mountain', 'nature', true, '#1a1a1c', '#ececec', '#b0b7c3', ['#252528', '#1a1a1c', '#33333a'], { angle: 125 }),
    preset('meadow', 'Meadow', 'nature', true, '#16200f', '#eef5e2', '#a3d977', ['#1f2d16', '#16200f', '#2b3d1f'], { angle: 115 }),
    preset('lagoon', 'Lagoon', 'nature', true, '#0b2226', '#e0f4f2', '#4fd1c5', ['#12333a', '#0b2226', '#1a4a52'], { angle: 120, motion: 'breathe' }),
    preset('sunset-ridge', 'Sunset Ridge', 'nature', true, '#221420', '#f8e7f0', '#ff9e6b', ['#301c2c', '#221420', '#432a3d'], { angle: 110, motion: 'breathe' }),
    preset('rainforest', 'Rainforest', 'nature', true, '#0c1f14', '#e4f5e6', '#58c98a', ['#122c1d', '#0c1f14', '#1b4029'], { angle: 125 }),
    preset('cyber-nature', 'Cyber Nature', 'nature', true, '#091719', '#e4fff8', '#5df0c1', ['#102b2b', '#0b1c20', '#123a36'], { artwork: 'theme-cyber-nature.svg', motion: 'breathe' }),

    // Textures — flat frames with a repeating overlay instead of artwork.
    preset('concrete', 'Concrete', 'textures', true, '#16181a', '#eceeee', '#9aa3ab', '#26292c', { pattern: 'grain' }),
    preset('sandstone', 'Sandstone', 'textures', false, '#efe3d2', '#3b3227', '#b4793f', '#e2d0b6', { pattern: 'grain' }),
    preset('linen', 'Linen', 'textures', false, '#f4f1ea', '#33302a', '#9a8f7a', '#ebe7dd', { pattern: 'weave' }),
    preset('slate-tiles', 'Slate Tiles', 'textures', true, '#131519', '#e9edf2', '#7f8ea3', '#1d2129', { pattern: 'lattice' }),
    preset('brushed-metal', 'Brushed Metal', 'textures', true, '#1a1c1f', '#eceef1', '#9aa5b1', '#24282d', { pattern: 'brush' }),
    preset('carbon', 'Carbon', 'textures', true, '#0d0d0f', '#f0f0f2', '#ff6b5b', '#151517', { pattern: 'carbon' }),
    preset('marble-light', 'Marble Light', 'textures', false, '#f7f7f5', '#26282b', '#4f6d7a', '#eeeeec', { pattern: 'marble' }),
    preset('marble-dark', 'Marble Dark', 'textures', true, '#14151a', '#eef0f4', '#96a0b0', '#1d1f26', { pattern: 'marble' }),
    preset('terrazzo', 'Terrazzo', 'textures', false, '#f6f1ea', '#33302c', '#c0567a', '#e9e1d6', { pattern: 'speck' }),
    preset('woven-dark', 'Woven Dark', 'textures', true, '#12141a', '#e7e9ef', '#7f9cc4', '#1b1e26', { pattern: 'weave' }),

    // Earth tones — minerals, soil and clay.
    preset('basalt', 'Basalt', 'earth', true, '#17181a', '#eceae6', '#8c8578', '#232425', { pattern: 'grain' }),
    preset('loam', 'Loam', 'earth', true, '#1e1a14', '#f0e8da', '#b58963', '#2b2419', { pattern: 'grain' }),
    preset('moss', 'Moss', 'earth', true, '#141a11', '#e9f0e2', '#8fae5f', ['#1f2718', '#141a11', '#2b3520'], { angle: 115 }),
    preset('claybank', 'Claybank', 'earth', true, '#221a15', '#f3e8dd', '#d08c60', ['#31251d', '#221a15', '#403126'], { angle: 110 }),
    preset('pumice', 'Pumice', 'earth', true, '#1e1d1b', '#f0eee9', '#b0a894', '#2b2a27', { pattern: 'grain' }),
    preset('dune', 'Dune', 'earth', true, '#1f1a12', '#f6ecd8', '#dcb26a', ['#2c2418', '#1f1a12', '#3b3020'], { angle: 115 }),
    preset('tundra', 'Tundra', 'earth', true, '#15171a', '#eef1f4', '#93b0c9', '#212529'),
    preset('peat', 'Peat', 'earth', true, '#16120f', '#ece5db', '#a07b56', '#211a15', { pattern: 'grain' }),
    preset('shale', 'Shale', 'earth', true, '#14161a', '#e9ecf1', '#7e8aa0', ['#1f232a', '#14161a', '#2b313b'], { angle: 120 }),
    preset('terracotta', 'Terracotta', 'earth', true, '#20140f', '#f7e8dd', '#e0785a', '#2f1d15', { pattern: 'grain' }),

    // Vivid and neon — the themes that are allowed to be loud.
    preset('neon-grid', 'Neon Grid', 'vivid', true, '#0a0714', '#f2e9ff', '#ff2ec4', ['#160b2a', '#0a0714', '#241248'], { angle: 115, pattern: 'grid', motion: 'shimmer' }),
    preset('synth-city', 'Synth City', 'vivid', true, '#140a2b', '#ffe9ff', '#ff4ecd', ['#1f0d45', '#140a2b', '#2e1560'], { angle: 120, motion: 'shimmer' }),
    preset('candy-pop', 'Candy Pop', 'vivid', true, '#1a0f1c', '#ffeef8', '#ff5fa2', ['#2a1428', '#1a0f1c', '#3d1d3a'], { angle: 110 }),
    preset('watermelon', 'Watermelon', 'vivid', true, '#12200f', '#eafbe8', '#ff4d6d', ['#1b3316', '#12200f', '#26481e'], { angle: 120 }),
    preset('sorbet', 'Sorbet', 'vivid', true, '#1c1524', '#f6ecfb', '#c77dff', ['#291d36', '#1c1524', '#3a294b'], { angle: 115 }),
    preset('electric', 'Electric', 'vivid', true, '#07131c', '#e6f6ff', '#00d4ff', ['#0d2233', '#07131c', '#12314a'], { angle: 100, motion: 'shimmer' }),
    preset('bubblegum', 'Bubblegum', 'vivid', true, '#1b0f18', '#ffe9f4', '#ff8ad4', ['#2a1726', '#1b0f18', '#3d2136'], { angle: 115 }),
    preset('carnival', 'Carnival', 'vivid', true, '#1a0f08', '#ffeee0', '#ff7a1a', ['#2b1a0e', '#1a0f08', '#40270f'], { angle: 110 }),
    preset('prism-spectra', 'Spectra', 'vivid', true, '#0f0f14', '#f4f4f8', '#a78bfa', ['#1c1c28', '#0f0f14', '#2a2a3d'], { angle: 125, motion: 'wave' }),
    preset('neon-nights', 'Neon Nights', 'vivid', true, '#08060f', '#eae6ff', '#8b5cf6', ['#120e22', '#08060f', '#1d1736'], { angle: 115, motion: 'drift' }),
    preset('disco', 'Disco', 'vivid', true, '#150a1e', '#ffeaff', '#ff6ec7', ['#231129', '#150a1e', '#341a41'], { angle: 120, motion: 'pulse' }),
    preset('ultraviolet', 'Ultraviolet', 'vivid', true, '#0b0616', '#f0e6ff', '#b026ff', ['#150c26', '#0b0616', '#211138'], { angle: 115, motion: 'shimmer' }),
    preset('cosmic', 'Cosmic', 'vivid', true, '#0b0d24', '#f3edff', '#b78bff', ['#13143b', '#10102b', '#241540'], { artwork: 'theme-cosmic.svg', motion: 'drift' }),
    preset('graffiti', 'Graffiti', 'vivid', true, '#080d09', '#efffea', '#58ff24', ['#101e12', '#07120a', '#0d2815'], { artwork: 'theme-graffiti.svg' }),

    // Pastel and soft.
    // Forty signature editions: bespoke scene art plus an individually tuned palette.
    preset('neon-avenue', 'Neon Avenue', 'cinematic', true, '#10091b', '#f5edff', '#ff69c6', ['#170d29', '#10091b', '#351741'], { artwork: 'theme-neon-avenue.svg', motion: 'drift' }),
    preset('violet-nebula', 'Violet Nebula', 'cinematic', true, '#110a26', '#f4efff', '#c68cff', ['#1b1038', '#110a26', '#352050'], { artwork: 'theme-violet-nebula.svg', motion: 'shimmer' }),
    preset('aurora-fjord', 'Aurora Fjord', 'cinematic', true, '#091720', '#e8f7ff', '#6eead1', ['#102b3b', '#091720', '#164039'], { artwork: 'theme-aurora-fjord.svg', motion: 'breathe' }),
    preset('eclipse-temple', 'Eclipse Temple', 'cinematic', true, '#100d23', '#f2edff', '#ffbe77', ['#201331', '#100d23', '#3b2548'], { artwork: 'theme-eclipse-temple.svg', motion: 'pulse' }),
    preset('emerald-circuit', 'Emerald Circuit', 'cinematic', true, '#071817', '#e5fff5', '#51edba', ['#0d3028', '#071817', '#155044'], { artwork: 'theme-emerald-circuit.svg', motion: 'drift' }),
    preset('deep-sea-signal', 'Deep Sea Signal', 'cinematic', true, '#061522', '#e4f8ff', '#42dfff', ['#0b2b43', '#061522', '#104b55'], { artwork: 'theme-deep-sea-signal.svg', motion: 'breathe' }),
    preset('last-light', 'Last Light', 'cinematic', true, '#20101d', '#fff0dc', '#ff9b68', ['#3a1830', '#20101d', '#523126'], { artwork: 'theme-last-light.svg', motion: 'shimmer' }),
    preset('chrome-dream', 'Chrome Dream', 'cinematic', true, '#101324', '#f2f5ff', '#a5baff', ['#1b2340', '#101324', '#3b2c55'], { artwork: 'theme-chrome-dream.svg', motion: 'wave' }),
    preset('synthwave-coast', 'Synthwave Coast', 'vivid', true, '#110925', '#fff0ff', '#ff68d2', ['#211044', '#110925', '#40215b'], { artwork: 'theme-synthwave-coast.svg', motion: 'drift' }),
    preset('stardust-bloom', 'Stardust Bloom', 'vivid', true, '#100a21', '#f5edff', '#ff94dd', ['#21133b', '#100a21', '#432655'], { artwork: 'theme-stardust-bloom.svg', motion: 'shimmer' }),
    preset('pixel-comet', 'Pixel Comet', 'retro', true, '#080d22', '#ecf6ff', '#52ddff', ['#101c3a', '#080d22', '#223e58'], { artwork: 'theme-pixel-comet.svg', motion: 'pulse' }),
    preset('neon-koi', 'Neon Koi', 'vivid', true, '#07171b', '#e9fff7', '#ff7b70', ['#0c2c32', '#07171b', '#144850'], { artwork: 'theme-neon-koi.svg', motion: 'breathe' }),
    preset('ultraviolet-forest', 'Ultraviolet Forest', 'vivid', true, '#100a20', '#f2eaff', '#d78bff', ['#1c1031', '#100a20', '#3a2150'], { artwork: 'theme-ultraviolet-forest.svg', motion: 'drift' }),
    preset('chromatic-crash', 'Chromatic Crash', 'vivid', true, '#11101c', '#fff0fb', '#ff77a8', ['#211229', '#11101c', '#392343'], { artwork: 'theme-chromatic-crash.svg', motion: 'wave' }),
    preset('prism-canyon', 'Prism Canyon', 'vivid', true, '#1c1020', '#fff1df', '#ff9a75', ['#351c32', '#1c1020', '#51302a'], { artwork: 'theme-prism-canyon.svg', motion: 'breathe' }),
    preset('night-drive', 'Night Drive', 'vivid', true, '#080d1d', '#eaf4ff', '#54d7ff', ['#10172d', '#080d1d', '#26304b'], { artwork: 'theme-night-drive.svg', motion: 'drift' }),
    preset('solar-flare', 'Solar Flare', 'vivid', true, '#1b0b18', '#fff0dd', '#ff9b46', ['#341426', '#1b0b18', '#502821'], { artwork: 'theme-solar-flare.svg', motion: 'pulse' }),
    preset('electric-meadow', 'Electric Meadow', 'vivid', true, '#091a16', '#efffee', '#77f06f', ['#102d1c', '#091a16', '#194330'], { artwork: 'theme-electric-meadow.svg', motion: 'shimmer' }),
    preset('alpine-moon', 'Alpine Moon', 'nature', true, '#10172a', '#eff4ff', '#9ebaff', ['#192844', '#10172a', '#32435d'], { artwork: 'theme-alpine-moon.svg', motion: 'breathe' }),
    preset('sakura-afterglow', 'Sakura Afterglow', 'nature', true, '#1d1020', '#fff0f4', '#ff9ebd', ['#321b34', '#1d1020', '#553043'], { artwork: 'theme-sakura-afterglow.svg', motion: 'shimmer' }),
    preset('emberwood', 'Emberwood', 'nature', true, '#1b120e', '#fff0df', '#ff995c', ['#302019', '#1b120e', '#4b3022'], { artwork: 'theme-emberwood.svg', motion: 'breathe' }),
    preset('coral-cathedral', 'Coral Cathedral', 'nature', true, '#071b23', '#e4fbf8', '#64efce', ['#103543', '#071b23', '#15505a'], { artwork: 'theme-coral-cathedral.svg', motion: 'drift' }),
    preset('moon-garden', 'Moon Garden', 'nature', true, '#111223', '#f1f0ff', '#c5a2ff', ['#211b38', '#111223', '#34314c'], { artwork: 'theme-moon-garden.svg', motion: 'pulse' }),
    preset('jade-canopy', 'Jade Canopy', 'nature', true, '#091a18', '#e5fff3', '#63e6a3', ['#10332c', '#091a18', '#195142'], { artwork: 'theme-jade-canopy.svg', motion: 'breathe' }),
    preset('glacier-veil', 'Glacier Veil', 'nature', true, '#0a1720', '#ebf8ff', '#7ddfff', ['#132b3a', '#0a1720', '#1c4555'], { artwork: 'theme-glacier-veil.svg', motion: 'drift' }),
    preset('desert-bloom', 'Desert Bloom', 'nature', true, '#21140d', '#fff0dc', '#ffad68', ['#382218', '#21140d', '#5a3522'], { artwork: 'theme-desert-bloom.svg', motion: 'shimmer' }),
    preset('tidal-forest', 'Tidal Forest', 'nature', true, '#071914', '#e7fff0', '#7be7bd', ['#0f3027', '#071914', '#1e5140'], { artwork: 'theme-tidal-forest.svg', motion: 'wave' }),
    preset('wildflower-dusk', 'Wildflower Dusk', 'nature', true, '#171326', '#f5efff', '#f59bcb', ['#29203f', '#171326', '#49324e'], { artwork: 'theme-wildflower-dusk.svg', motion: 'breathe' }),
    preset('8bit-dreamscape', '8-Bit Dreamscape', 'retro', true, '#090f22', '#eef8ff', '#ffd85b', ['#172348', '#090f22', '#342b58'], { artwork: 'theme-8bit-dreamscape.svg', motion: 'pulse' }),
    preset('cassette-sunset', 'Cassette Sunset', 'retro', true, '#1b1018', '#fff0dc', '#ff9b62', ['#321b2b', '#1b1018', '#4b2930'], { artwork: 'theme-cassette-sunset.svg', motion: 'drift' }),
    preset('pixel-planet', 'Pixel Planet', 'retro', true, '#080d21', '#edf3ff', '#88a8ff', ['#131d3c', '#080d21', '#2b3159'], { artwork: 'theme-pixel-planet.svg', motion: 'shimmer' }),
    preset('arcade-rain', 'Arcade Rain', 'retro', true, '#07141a', '#e4fff7', '#55efc4', ['#0d2930', '#07141a', '#12473f'], { artwork: 'theme-arcade-rain.svg', motion: 'wave' }),
    preset('neon-boardwalk', 'Neon Boardwalk', 'retro', true, '#111024', '#fff0fb', '#ff8bcf', ['#211939', '#111024', '#3b2851'], { artwork: 'theme-neon-boardwalk.svg', motion: 'breathe' }),
    preset('cloud-garden', 'Cloud Garden', 'pastel', true, '#22213a', '#fff7f3', '#ffafd0', ['#383451', '#22213a', '#514258'], { artwork: 'theme-cloud-garden.svg', motion: 'breathe' }),
    preset('peony-sky', 'Peony Sky', 'pastel', true, '#1d1830', '#fff4fa', '#ffa8d1', ['#332546', '#1d1830', '#4b3454'], { artwork: 'theme-peony-sky.svg', motion: 'shimmer' }),
    preset('lavender-coast', 'Lavender Coast', 'pastel', true, '#14192f', '#f1f3ff', '#b9b6ff', ['#24294a', '#14192f', '#394564'], { artwork: 'theme-lavender-coast.svg', motion: 'drift' }),
    preset('dawn-meadow', 'Dawn Meadow', 'pastel', true, '#201c2a', '#fff5e9', '#ffbd91', ['#393044', '#201c2a', '#50413b'], { artwork: 'theme-dawn-meadow.svg', motion: 'breathe' }),
    preset('copper-canyon', 'Copper Canyon', 'earth', true, '#20140e', '#f8ecdb', '#e39a62', ['#392318', '#20140e', '#59361f'], { artwork: 'theme-copper-canyon.svg', motion: 'drift' }),
    preset('mossstone', 'Mossstone', 'earth', true, '#101710', '#eef2dc', '#b6ce73', ['#222a1d', '#101710', '#36452a'], { artwork: 'theme-mossstone.svg', motion: 'breathe' }),
    preset('amber-atlas', 'Amber Atlas', 'earth', true, '#211909', '#fff2ce', '#f0c36c', ['#3a2910', '#211909', '#574016'], { artwork: 'theme-amber-atlas.svg', motion: 'shimmer' }),

    preset('sage', 'Sage', 'pastel', false, '#eef2ea', '#2f3a2c', '#7fa07a', ['#f7faf4', '#eef2ea', '#e3e9dd'], { angle: 120 }),
    preset('blush', 'Blush', 'pastel', false, '#fdeef1', '#4a2b34', '#e2728f', ['#fff7f9', '#fdeef1', '#f7e0e6']),
    preset('powder', 'Powder', 'pastel', false, '#eaf1f8', '#28374a', '#5b87c4', ['#f6fafe', '#eaf1f8', '#dde8f2'], { angle: 115 }),
    preset('peach', 'Peach', 'pastel', false, '#fdeee3', '#4a342a', '#ef9a6a', ['#fff8f3', '#fdeee3', '#f7e2d1']),
    preset('lilac', 'Lilac', 'pastel', false, '#f0ecf8', '#372f4a', '#8b72c9', ['#f9f7fd', '#f0ecf8', '#e4def2'], { angle: 120 }),
    preset('mint', 'Mint', 'pastel', false, '#e6f5ee', '#254037', '#4fae8b', ['#f4fcf8', '#e6f5ee', '#d8ebe1'], { angle: 115 }),
    preset('butter', 'Butter', 'pastel', false, '#fbf6e2', '#453d22', '#c9a227', ['#fffdf4', '#fbf6e2', '#f2ecd4']),
    preset('rose-water', 'Rose Water', 'pastel', false, '#f6eef7', '#3f2b45', '#a86fb0', ['#fdf8fe', '#f6eef7', '#ebe0ec'], { angle: 120 }),
    preset('fog', 'Fog', 'pastel', false, '#eceff1', '#2e3438', '#7d8b93', ['#f7f9fa', '#eceff1', '#e0e5e8']),
    preset('meadow-light', 'Meadow Light', 'pastel', false, '#eef5e8', '#31402a', '#84b366', ['#f8fbf5', '#eef5e8', '#e2ecda'], { angle: 120 }),

    // Retro and arcade — CRT, tape and 8-bit.
    preset('vhs', 'VHS', 'retro', true, '#1a1620', '#ffeaf2', '#ff4d6d', '#251d2c', { pattern: 'scan' }),
    preset('terminal-green', 'Terminal Green', 'retro', true, '#04120a', '#c8ffd0', '#33ff66', '#062012', { pattern: 'scan' }),
    preset('amber-crt', 'Amber CRT', 'retro', true, '#150f04', '#ffcf6b', '#ffab1f', '#221806', { pattern: 'scan' }),
    preset('sepia', 'Sepia', 'retro', false, '#f3e9d8', '#3d3222', '#a5703c', '#fbf4e6', { pattern: 'grain' }),
    preset('commodore', 'Commodore', 'retro', true, '#101024', '#c8c8e8', '#9a7fe0', '#191934', { pattern: 'scan' }),
    preset('gameboy', 'Game Boy', 'retro', false, '#a8bb92', '#141a09', '#3d5a1f', '#b0c39c', { pattern: 'grain' }),
    preset('cassette', 'Cassette', 'retro', true, '#191720', '#efe7dc', '#e08a3c', '#252231', { pattern: 'grain' }),
    preset('newspaper', 'Newspaper', 'retro', false, '#f4f2ed', '#1d1d1b', '#333333', '#fbfaf7', { pattern: 'grain' }),
    preset('blueprint', 'Blueprint', 'retro', true, '#0d2742', '#d8ecff', '#7cc0ff', ['#123456', '#0d2742', '#1a4570'], { pattern: 'grid', angle: 135 }),
    preset('arcade', 'Arcade', 'retro', true, '#0b0a14', '#f2e9ff', '#ffd23f', ['#16142a', '#0b0a14', '#231f42'], { angle: 115, motion: 'pulse' }),

    // Cinematic — colour-graded sets.
    preset('teal-orange', 'Teal and Orange', 'cinematic', true, '#0f1416', '#f0ece7', '#ff9b54', ['#1b2226', '#0f1416', '#263236'], { angle: 115 }),
    preset('midnight-city', 'Midnight City', 'cinematic', true, '#0c0e14', '#e7e9f0', '#5f8cff', ['#151925', '#0c0e14', '#1f2436'], { angle: 120 }),
    preset('golden-hour', 'Golden Hour', 'cinematic', true, '#1a1409', '#f8efdd', '#f2b544', ['#28200f', '#1a1409', '#3a2e16'], { angle: 110, motion: 'breathe' }),
    preset('noir', 'Noir', 'cinematic', true, '#08080a', '#f2f2f4', '#d4d4d8', ['#131316', '#08080a', '#1c1c20'], { angle: 115 }),
    preset('neon-noir', 'Neon Noir', 'cinematic', true, '#0a0a12', '#eae8f6', '#ff2d78', ['#151526', '#0a0a12', '#202036'], { angle: 115, motion: 'shimmer' }),
    preset('cyber-noir', 'Cyber Noir', 'cinematic', true, '#08111a', '#e6f1f8', '#00e5c0', ['#0f1f2c', '#08111a', '#163244'], { angle: 100, motion: 'drift' }),
    preset('moody-forest', 'Moody Forest', 'cinematic', true, '#10160f', '#e9f0e4', '#9ec46a', ['#1a2318', '#10160f', '#263322'], { angle: 125 }),
    preset('cold-desert', 'Cold Desert', 'cinematic', true, '#161412', '#f1ece4', '#d9a066', ['#221e19', '#161412', '#2f2a23'], { angle: 115 }),
    preset('monochrome-film', 'Monochrome Film', 'cinematic', true, '#131313', '#f0f0f0', '#9a9a9a', ['#1e1e1e', '#131313', '#2a2a2a'], { pattern: 'grain' }),
    preset('deep-space', 'Deep Space', 'cinematic', true, '#070a12', '#e4ecff', '#6ea8ff', ['#101828', '#070a12', '#1a2740'], { angle: 120, motion: 'drift' }),

    // Monochrome — value only, no hue in the frame at all.
    preset('graphite', 'Graphite', 'monochrome', true, '#1a1a1a', '#f5f5f5', '#e0e0e0', '#262626'),
    preset('silver', 'Silver', 'monochrome', false, '#f2f2f2', '#1a1a1a', '#3a3a3a', '#ffffff'),
    preset('ink', 'Ink', 'monochrome', true, '#0f0f10', '#fafafa', '#c8c8c8', '#1a1a1c'),
    preset('slate-mono', 'Slate Mono', 'monochrome', true, '#16181c', '#eceef2', '#b6bcc6', '#212429', { pattern: 'grain' }),
    preset('charcoal', 'Charcoal', 'monochrome', true, '#232323', '#f0f0f0', '#bdbdbd', '#2e2e2e'),
    preset('pearl', 'Pearl', 'monochrome', false, '#f6f6f6', '#1c1c1c', '#5a5a5a', '#fbfbfb'),
    preset('ash', 'Ash', 'monochrome', true, '#1b1d1f', '#eef0f1', '#a8aeb2', '#252829', { pattern: 'grain' }),
    preset('platinum', 'Platinum', 'monochrome', false, '#f4f5f6', '#202225', '#6b7175', '#ffffff'),
    preset('smoke', 'Smoke', 'monochrome', true, '#131416', '#e9ebed', '#9aa0a6', '#1d1f22'),
    preset('bone', 'Bone', 'monochrome', false, '#e9e6df', '#2a2723', '#6f6a61', '#f3f1ec', { pattern: 'grain' })
  ].map(Object.freeze);

  const BY_ID = new Map(PRESETS.map((item) => [item.id, item]));
  if (PRESETS.filter((item) => item.artwork).length < MIN_ILLUSTRATED_THEMES) {
    throw new Error('Signature theme catalog is missing illustrated presets');
  }
  const FROZEN_PRESETS = Object.freeze(PRESETS);
  const FROZEN_CATEGORIES = Object.freeze(CATEGORIES.map((category) => Object.freeze(category)));

  // ---- resolution ---------------------------------------------------------

  // Ramp steps, shared by every theme. Surfaces rise toward the ink on dark
  // themes and sink toward it on light ones, so one recipe covers both.
  const SURFACE_STEPS = {
    bg2: 0.035,
    bg3: 0.07,
    bg4: 0.105,
    'line-soft': 0.085,
    line: 0.17
  };
  // Muted text pulls back toward the background rather than toward the ink, so
  // dim text stays dim in both modes. Pastel themes are the reason this is a
  // search and not a constant: mixing a soft ink toward a near-white page
  // quickly lands below readable contrast, so the ramp walks toward the
  // background only as far as the legibility floor allows.
  const MUTED_FLOOR = { dim: 4.5, faint: 3 };

  function mutedToward(ink, background, minContrast) {
    let amount = 0;
    while (amount < 0.6) {
      const next = mix(ink, background, amount + 0.01);
      if (contrast(next, background) < minContrast) break;
      amount += 0.01;
    }
    return mix(ink, background, amount);
  }

  // Accents are the other half of the problem: a pastel accent on a pastel
  // page is decoration, not an affordance. Walk the accent away from its own
  // background until it can carry interface text, keeping the hue as long as
  // possible.
  function ensureContrast(color, background, min) {
    if (contrast(color, background) >= min) return color;
    // Pick the direction that can actually reach the target. Comparing the
    // colour's own luminance to the background's picks black for a mid-tone
    // accent on itself, where white is the only reachable answer.
    const towards = contrast('#ffffff', background) >= contrast('#000000', background) ? '#ffffff' : '#000000';
    let result = color;
    for (let step = 0.02; step <= 1; step += 0.02) {
      result = mix(color, towards, step);
      if (contrast(result, background) >= min) return result;
    }
    return towards;
  }

  // Average per-channel distance, used where WCAG contrast is the wrong tool:
  // an active tab only has to be *visibly* raised from the frame behind it,
  // which is a channel-space judgement, not a text-legibility one.
  function channelDrift(from, to) {
    const a = parseHex(from);
    const b = parseHex(to);
    return (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;
  }

  // Walk a surface away from its neighbour until the step is actually visible,
  // so themes with a narrow ink-to-background range (Gruvbox, Solarized) do
  // not end up with an active tab that is indistinguishable from the frame.
  function raised(base, towards, minDrift) {
    let result = base;
    for (let step = 0.04; step <= 0.6; step += 0.02) {
      result = mix(base, towards, step);
      if (channelDrift(base, result) >= minDrift) return result;
    }
    return towards;
  }

  // Solid-colour frames are saturated by definition, so the theme's own ink
  // often cannot sit on them. Fall back to plain paper white or near-black —
  // whichever contrasts more — rather than shipping a toolbar nobody can read.
  const INK_LIGHT = '#ffffff';
  const INK_DARK = '#0b0d10';

  function frameInk(ink, frame) {
    if (contrast(ink, frame) >= 4.5) return ink;
    return contrast(INK_LIGHT, frame) >= contrast(INK_DARK, frame) ? INK_LIGHT : INK_DARK;
  }

  function presetById(id) {
    if (typeof id !== 'string') return null;
    const found = BY_ID.get(id);
    if (found) return found;
    return BY_ID.get(DEFAULT_PRESET);
  }

  function resolve(input) {
    const config = input && typeof input === 'object' ? input : {};
    const presetId = typeof input === 'string' ? input : (config.themePreset || config.id || DEFAULT_PRESET);
    const hasCustomFrame = isHex(config.customFrame);
    const hasCustomBackground = isHex(config.customBackground);
    const base = presetById(presetId) || presetById(DEFAULT_PRESET);
    const source = Object.assign({}, base);
    if (hasCustomBackground) {
      source.bg = config.customBackground;
      source.dark = luminance(source.bg) < 0.35;
      source.ink = contrast('#ffffff', source.bg) >= contrast('#111318', source.bg) ? '#ffffff' : '#111318';
    }
    if (isHex(config.customAccent)) source.accent = config.customAccent;
    if (hasCustomFrame) {
      source.chrome = null;
      source.solid = config.customFrame;
    }
    const ink = source.ink;
    const bg = source.bg;
    const surface = (amount) => mix(bg, ink, amount);
    const frameBase = source.chrome ? source.chrome[0] : source.solid;
    const frameLast = source.chrome ? source.chrome[source.chrome.length - 1] : source.solid;
    const frameAccent = source.chrome && source.chrome[1] ? source.chrome[1] : frameBase;
    const pattern = PATTERNS[source.pattern] || null;
    const artwork = source.artwork && !hasCustomFrame && !hasCustomBackground ? source.artwork : null;
    // Everything below is derived *with legibility as a constraint*, so a
    // hand-picked pastel accent cannot produce an unreadable UI.
    const dim = mutedToward(ink, bg, MUTED_FLOOR.dim);
    const faint = mutedToward(ink, bg, MUTED_FLOOR.faint);
    const accent = ensureContrast(source.accent, bg, 3);
    // A solid-colour theme paints its frame *in* the accent, so the page accent
    // and the frame need different treatments: no single colour can carry 3:1
    // against both a near-white page and a saturated frame. Hence two tokens.
    const chromeAccent = ensureContrast(accent, frameBase, 3);
    const chromeText = frameInk(ink, frameBase);
    // First background layer paints on top, so the texture goes before the
    // gradient and the gradient before the flat colour.
    const layers = [];
    if (pattern) layers.push(pattern);
    if (artwork) {
      // Signature artwork replaces (rather than sits under) the opaque palette
      // gradient. A restrained veil preserves toolbar legibility over details.
      layers.push('linear-gradient(rgba(3, 7, 12, .44), rgba(3, 7, 12, .44))');
      layers.push(`url("prism://assets/${source.artwork}")`);
    } else if (source.chrome) {
      layers.push(`linear-gradient(${source.angle}deg, ${source.chrome.join(', ')})`);
    }
    const vars = {
      '--bg': bg,
      '--bg2': surface(SURFACE_STEPS.bg2),
      '--bg3': surface(SURFACE_STEPS.bg3),
      '--bg4': surface(SURFACE_STEPS.bg4),
      '--line-soft': surface(SURFACE_STEPS['line-soft']),
      '--line': surface(SURFACE_STEPS.line),
      '--text': ink,
      '--text-dim': dim,
      '--text-faint': faint,
      '--dim': dim,
      '--shadow': source.dark ? 'rgba(0,0,0,.48)' : 'rgba(0,0,0,.18)',
      '--accent': accent,
      '--accent-soft': alpha(accent, source.dark ? 0.2 : 0.14),
      // Chrome frame. --chrome-color is the flat fallback, --chrome-bg is the
      // full background shorthand so textures and gradients compose in one go.
      '--chrome-color': frameBase,
      '--chrome-active': raised(frameBase, chromeText, 9),
      '--chrome-line': mix(frameLast, ink, 0.2),
      // Text drawn on the frame itself, which for solid-colour themes is not
      // the theme ink. Kept as its own pair so the shell can label a saturated
      // frame without tinting the rest of the browser to match.
      '--chrome-ink': chromeText,
      '--chrome-ink-dim': mutedToward(chromeText, frameBase, 3),
      '--chrome-accent': chromeAccent,
      '--chrome-gradient': source.chrome ? `linear-gradient(${source.angle}deg, ${source.chrome.join(', ')})` : 'none',
      '--chrome-bg': layers.length ? layers.join(', ') : 'none',
      '--chrome-background-size': artwork ? '100% 100%, cover' : '220% 220%',
      '--chrome-artwork': artwork ? `url("prism://assets/${artwork}")` : 'none',
      '--page-artwork': artwork ? `url("prism://assets/${artwork}")` : 'none',
      '--cursor-image': root.PrismPixelCursor ? root.PrismPixelCursor.css(accent) : 'auto',
      '--cursor-pointer-image': root.PrismPixelCursor ? root.PrismPixelCursor.pointer(accent) : 'pointer',
      '--cursor-icon-image': root.PrismPixelCursor ? root.PrismPixelCursor.icon(accent, 'pointer') : 'none',
      '--pixel-cursor-stylesheet': root.PrismPixelCursor ? root.PrismPixelCursor.stylesheet(accent) : '',
      // Small tab/omnibox washes that echo the frame without clashing with it.
      '--gradient-a': alpha(frameBase, source.dark ? 0.55 : 0.4),
      '--gradient-b': alpha(frameAccent, source.dark ? 0.35 : 0.22),
      '--gradient-c': alpha(frameLast, source.dark ? 0.5 : 0.35),
      '--page-gradient': `radial-gradient(130% 90% at 12% -12%, ${alpha(accent, source.dark ? 0.11 : 0.09)}, transparent 55%), radial-gradient(90% 80% at 92% 4%, ${alpha(frameLast, source.dark ? 0.12 : 0.07)}, transparent 52%)`,
      '--motion-duration': MOTION_DURATIONS[source.motion] || MOTION_DURATIONS.none,
      '--motion-opacity': '1'
    };
    return {
      id: source.id,
      name: source.name,
      category: source.category,
      dark: source.dark,
      motion: source.motion,
      pattern: source.pattern,
      artwork,
      ink,
      accent,
      bg,
      frame: frameBase,
      swatch: source.chrome ? source.chrome.slice() : [source.solid, mix(source.solid, ink, 0.18)],
      vars
    };
  }

  function apply(target, appearance) {
    if (!target) return;
    const a = appearance || {};
    const resolved = resolve(a);
    const accessibility = a.accessibility || {};
    const animationAliases = { basic: 'fluent', smooth: 'fluent', playful: 'spring' };
    const animationThemes = ['fluent', 'spring', 'arcade', 'minimal', 'off'];
    const requestedAnimation = animationAliases[a.animationTheme] || a.animationTheme;
    const animationTheme = animationThemes.includes(requestedAnimation) ? requestedAnimation : 'fluent';
    const densityOptions = ['compact', 'comfortable', 'spacious'];
    const density = densityOptions.includes(a.uiDensity) ? a.uiDensity : 'comfortable';
    const tabStyles = ['rounded', 'pill', 'underline', 'block'];
    const tabStyle = tabStyles.includes(a.tabStyle) ? a.tabStyle : 'rounded';
    const uiFonts = ['system', 'rounded', 'mono'];
    const uiFont = uiFonts.includes(a.uiFont) ? a.uiFont : 'system';
    const vars = Object.assign({}, resolved.vars);
    if (accessibility.contrast === 'high') {
      // High contrast flattens the ramp: every muted value becomes the main
      // ink and borders take the ink's full strength.
      vars['--line'] = vars['--text'];
      vars['--line-soft'] = vars['--text'];
      vars['--text-dim'] = vars['--text'];
      vars['--text-faint'] = vars['--text'];
      vars['--dim'] = vars['--text'];
      vars['--accent-soft'] = 'rgba(127,127,127,.3)';
      vars['--chrome-line'] = vars['--text'];
    }
    for (const [key, value] of Object.entries(vars)) target.style.setProperty(key, value);
    target.dataset.theme = resolved.dark ? 'dark' : 'light';
    target.dataset.themePreset = resolved.id;
    target.dataset.motion = resolved.motion;
    target.dataset.themeArtwork = resolved.artwork ? 'true' : 'false';
    target.dataset.themeMotion = ['shimmer', 'wave', 'drift', 'breathe', 'pulse'].includes(resolved.motion) ? resolved.motion : 'none';
    target.dataset.pixelCursor = a.pixelCursor === false ? 'false' : 'true';
    target.dataset.animationTheme = animationTheme;
    target.dataset.uiDensity = density;
    target.dataset.tabStyle = tabStyle;
    target.dataset.uiFont = uiFont;
    target.style.setProperty('--tab-w', clamp(a.tabWidth, 160, 320, 220) + 'px');
    const fontStacks = {
      system: '"Segoe UI", system-ui, sans-serif',
      rounded: '"Trebuchet MS", "Arial Rounded MT Bold", system-ui, sans-serif',
      mono: '"Cascadia Code", Consolas, monospace'
    };
    target.style.setProperty('--ui-font', fontStacks[uiFont]);
    target.dataset.contrast = accessibility.contrast === 'high' ? 'high' : 'normal';
    target.dataset.largeTargets = accessibility.largerTargets ? 'true' : 'false';
    target.dataset.focusVisible = accessibility.focusIndicators === false ? 'subtle' : 'strong';
    target.style.setProperty('--ui-scale', (clamp(accessibility.textScale, 80, 150, 100) / 100).toFixed(2));
    const reduce = accessibility.reducedMotion || 'system';
    target.dataset.reduceMotion = reduce === 'reduce' ? 'reduce' : reduce === 'no-preference' ? 'allow' : 'system';
  }

  // Coordinated animation packs are shared by Settings, shell chrome and tests.
  const ANIMATION_PACKS = Object.freeze([
    Object.freeze({ id: 'fluent', name: 'Fluent', description: 'Soft and polished' }),
    Object.freeze({ id: 'spring', name: 'Spring', description: 'Lively with gentle bounce' }),
    Object.freeze({ id: 'arcade', name: 'Arcade', description: 'Crisp, graphic transitions' }),
    Object.freeze({ id: 'minimal', name: 'Minimal', description: 'Quiet fades' }),
    Object.freeze({ id: 'off', name: 'Off', description: 'No animation' })
  ]);

  // "Surprise me" now jumps to another curated theme instead of inventing a
  // gradient, so a random pick is still a palette somebody designed.
  function randomPresetId(current) {
    if (PRESETS.length < 2) return DEFAULT_PRESET;
    let next = DEFAULT_PRESET;
    while (next === current) next = PRESETS[Math.floor(Math.random() * PRESETS.length)].id;
    return next;
  }

  function presetsIn(categoryId) {
    return FROZEN_PRESETS.filter((item) => item.category === categoryId);
  }

  root.PrismTheme = Object.freeze({
    PRESETS: FROZEN_PRESETS,
    CATEGORIES: FROZEN_CATEGORIES,
    PATTERNS: Object.freeze(Object.assign({}, PATTERNS)),
    MOTIONS: Object.freeze(MOTIONS.slice()),
    ANIMATION_PACKS,
    DEFAULT_PRESET,
    preset: presetById,
    presetsIn,
    resolve,
    apply,
    randomPresetId,
    mix,
    contrast,
    channelDrift,
    luminance,
    isHex
  });
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.PrismTheme;
