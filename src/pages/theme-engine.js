// theme-engine.js — Prism's theme catalog and design tokens.
//
// Every theme below is hand-designed to match the gallery mockups: a rich
// multi-stop gradient frame (never a flat colour, except that the three basic
// looks are allowed to stay calm and static), an animated chrome motion on
// almost all of them, a texture overlay where it adds depth, and a custom
// glowing cursor tinted to the theme.
//
// The surface ramp, borders, muted text and chrome highlight are derived from
// one background, one ink and one accent by mixing toward the ink, which keeps
// the catalog internally consistent across light and dark looks.
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

  // Split a comma-joined background value into its layers, ignoring commas
  // nested inside gradient functions.
  function splitLayers(value) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const ch of String(value || '')) {
      if (ch === '(') depth += 1;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      if (ch === ',' && depth === 0) {
        if (current.trim()) parts.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  // ---- texture overlays ---------------------------------------------------
  // Repeating-gradient layers over the frame colour. Image and size are stored
  // separately on purpose: --chrome-bg feeds `background-image`, where
  // position/size syntax is invalid and would void the whole declaration,
  // while --chrome-background-size carries the matching sizes layer by layer.
  // (Embedding `0 0 / 26px` into background-image silently computes to `none`,
  // which is why textures must never inline their tiling.)
  const PATTERNS = {
    none: null,
    grain: { image: 'repeating-linear-gradient(115deg, rgba(255,255,255,.045) 0 1px, rgba(0,0,0,.05) 1px 3px)', size: '100% 100%' },
    weave: { image: 'repeating-linear-gradient(0deg, rgba(255,255,255,.05) 0 1px, transparent 1px 4px), repeating-linear-gradient(90deg, rgba(0,0,0,.07) 0 1px, transparent 1px 4px)', size: '100% 100%, 100% 100%' },
    grid: { image: 'repeating-linear-gradient(0deg, rgba(255,255,255,.055) 0 1px, transparent 1px 24px), repeating-linear-gradient(90deg, rgba(255,255,255,.055) 0 1px, transparent 1px 24px)', size: '100% 100%, 100% 100%' },
    lattice: { image: 'repeating-linear-gradient(60deg, rgba(255,255,255,.05) 0 1px, transparent 1px 11px), repeating-linear-gradient(-60deg, rgba(255,255,255,.05) 0 1px, transparent 1px 11px)', size: '100% 100%, 100% 100%' },
    scan: { image: 'repeating-linear-gradient(0deg, rgba(0,0,0,.22) 0 1px, transparent 1px 3px)', size: '100% 100%' },
    brush: { image: 'repeating-linear-gradient(100deg, rgba(255,255,255,.05) 0 2px, rgba(0,0,0,.06) 2px 5px)', size: '100% 100%' },
    carbon: { image: 'repeating-linear-gradient(45deg, rgba(255,255,255,.035) 0 2px, transparent 2px 5px), repeating-linear-gradient(-45deg, rgba(0,0,0,.06) 0 2px, transparent 2px 5px)', size: '100% 100%, 100% 100%' },
    marble: { image: 'radial-gradient(130% 90% at 18% -10%, rgba(255,255,255,.12), transparent 55%), radial-gradient(90% 70% at 85% 110%, rgba(0,0,0,.16), transparent 60%)', size: '100% 100%, 100% 100%' },
    speck: { image: 'radial-gradient(rgba(255,255,255,.11) 1.2px, transparent 1.4px), radial-gradient(rgba(0,0,0,.09) 1.2px, transparent 1.4px)', size: '15px 15px, 15px 15px', position: '0 0, 7px 8px' },
    // Gallery textures: starfields, falling rain, rising bubbles, soft waves
    // and drifting embers. All pure CSS so every theme stays animated without
    // shipping image files.
    stars: { image: 'radial-gradient(rgba(255,255,255,.5) 1px, transparent 1.5px), radial-gradient(rgba(255,255,255,.25) 1px, transparent 1.5px), radial-gradient(rgba(255,255,255,.14) 1px, transparent 1.5px)', size: '26px 26px, 30px 30px, 20px 20px', position: '0 0, 13px 15px, 6px 22px' },
    rain: { image: 'repeating-linear-gradient(90deg, rgba(255,255,255,.07) 0 1px, transparent 1px 13px), repeating-linear-gradient(90deg, rgba(0,0,0,.08) 0 1px, transparent 1px 29px)', size: '100% 100%, 100% 100%' },
    bubbles: { image: 'radial-gradient(rgba(255,255,255,.16) 2.5px, transparent 3.2px), radial-gradient(rgba(255,255,255,.1) 1.6px, transparent 2.2px)', size: '34px 34px, 26px 26px', position: '4px 6px, 20px 18px' },
    waves: { image: 'repeating-linear-gradient(115deg, rgba(255,255,255,.05) 0 3px, transparent 3px 12px), radial-gradient(120% 80% at 50% 120%, rgba(255,255,255,.09), transparent 55%)', size: '100% 100%, 100% 100%' },
    ember: { image: 'radial-gradient(rgba(255,170,80,.2) 1.6px, transparent 2.4px), radial-gradient(rgba(255,90,30,.16) 1.2px, transparent 2px)', size: '24px 24px, 30px 30px', position: '3px 5px, 15px 14px' }
  };

  // Motion is a property of a theme: the three basic looks stay still while
  // every gallery theme drifts, shimmers, breathes, pulses or waves.
  const MOTION_DURATIONS = {
    none: '0s', shimmer: '9s', drift: '15s', breathe: '11s', pulse: '7s', wave: '17s'
  };
  const MOTIONS = Object.keys(MOTION_DURATIONS);

  const CATEGORIES = [
    { id: 'default', name: 'Default' },
    { id: 'glow', name: 'Neon & Glow' },
    { id: 'waters', name: 'Oceans & Nature' },
    { id: 'ember', name: 'Fire & Dark' },
    { id: 'dream', name: 'Dreams & Space' },
    { id: 'retro', name: 'Retro & Tech' }
  ];

  const DEFAULT_PRESET = 'default-clean';

  // Old preset ids from previous catalogs keep resolving so stored profiles
  // never end up on a missing theme after an update.
  const LEGACY_ALIASES = {
    'prism-dark': 'default-clean',
    'prism-midnight': 'space-galaxy',
    'prism-dusk': 'cursed-purple-smoke',
    'prism-noir': 'dark-gothic',
    'prism-light': 'minimal-glass',
    'prism-daylight': 'pastel-dreams',
    'prism-warm': 'sunset',
    'prism-cool': 'ocean-blue',
    'prism-contrast-dark': 'dark-gothic',
    'prism-contrast-light': 'black-white',
    'forest': 'forest-green',
    'ocean': 'ocean-blue',
    'desert': 'sand-desert',
    'nord': 'space-station',
    'catppuccin-mocha': 'neon-purple',
    'dracula': 'cursed-purple-smoke',
    'tokyo-night': 'indigo',
    'paper': 'sand-desert',
    'cosmic': 'space-galaxy',
    'graffiti': 'cyberpunk',
    'cyber-nature': 'custom-alien',
    'neon-avenue': 'neon-purple',
    'vhs': 'retro-90s',
    'terminal-green': 'matrix',
    'arcade': 'cyberpunk'
  };

  // ---- authoring helpers --------------------------------------------------
  // A theme is four colours plus presentation switches; the ramp is derived.
  // `cursor` names the glowing cursor variant (see pixel-cursor.js). When it
  // is omitted the classic arrow style is used in the theme accent colour.
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
      pattern: 'none',
      cursor: 'classic'
    }, extra || {});
  }

  // ---- the catalog --------------------------------------------------------
  // 35 gallery themes matching the mockups. The three Default looks are calm
  // and static; everything else pairs a multi-stop gradient frame with an
  // animation and a custom cursor, so no gallery theme is ever a flat colour.

  const PRESETS = [
    // Default — the three calm basics. Subtle gradients, no motion, classic
    // cursors. These are the only themes allowed to sit still.
    preset('default-clean', 'Default / Clean', 'default', true, '#14161c', '#f2f5f9', '#7aa2f7', ['#1d2230', '#14161c', '#262d3f'], { motion: 'none', cursor: 'classic' }),
    preset('black-white', 'Black and White', 'default', false, '#f4f4f5', '#111114', '#3f3f46', ['#ffffff', '#ececee', '#d4d4d8'], { angle: 100, motion: 'none', cursor: 'mono' }),
    preset('minimal-glass', 'Minimal Glass', 'default', false, '#eef4f8', '#16202a', '#2f7fd0', ['#ffffff', '#dfeaf4', '#bcd4e8'], { angle: 115, motion: 'none', pattern: 'waves', cursor: 'glass' }),

    // Neon & Glow
    preset('neon-purple', 'Neon Purple', 'glow', true, '#0e0720', '#f3e8ff', '#b026ff', ['#1d0b3d', '#0e0720', '#3a1470'], { angle: 115, motion: 'shimmer', pattern: 'grid', cursor: 'neon' }),
    preset('cyberpunk', 'Cyberpunk', 'glow', true, '#0a0618', '#ffe9ff', '#ff2ec4', ['#1c0b38', '#0a0618', '#3d0f5a'], { angle: 120, motion: 'pulse', pattern: 'scan', cursor: 'cyber' }),
    preset('neon-teal', 'Neon Teal', 'glow', true, '#04181a', '#e2fffa', '#2dd4bf', ['#0a2e33', '#04181a', '#0f4f57'], { angle: 110, motion: 'shimmer', pattern: 'grid', cursor: 'teal' }),
    preset('indigo', 'Indigo', 'glow', true, '#0c0e2a', '#e8ebff', '#818cf8', ['#1a1e4d', '#0c0e2a', '#2b2f7a'], { angle: 120, motion: 'drift', pattern: 'stars', cursor: 'indigo' }),
    preset('purple-crystal', 'Purple Crystal', 'glow', true, '#120826', '#f2e9ff', '#a855f7', ['#221044', '#120826', '#3d1a78'], { angle: 125, motion: 'breathe', pattern: 'lattice', cursor: 'crystal' }),
    preset('cursed-purple-smoke', 'Cursed / Purple Smoke', 'glow', true, '#0d0716', '#efe6ff', '#8b5cf6', ['#1a0e30', '#0d0716', '#2e1a55'], { angle: 115, motion: 'wave', pattern: 'marble', cursor: 'smoke' }),
    preset('aurora', 'Aurora', 'glow', true, '#071a1e', '#e0fff4', '#34d399', ['#0e3240', '#071a1e', '#134e4a'], { angle: 115, motion: 'wave', pattern: 'waves', cursor: 'aurora' }),

    // Oceans & Nature
    preset('ocean-blue', 'Ocean Blue', 'waters', true, '#082032', '#e6f4ff', '#38bdf8', ['#0f3a5c', '#082032', '#155e8a'], { angle: 115, motion: 'drift', pattern: 'waves', cursor: 'ocean' }),
    preset('forest-green', 'Forest Green', 'waters', true, '#0a1f14', '#e6f7e9', '#4ade80', ['#143a24', '#0a1f14', '#1f5c33'], { angle: 120, motion: 'breathe', pattern: 'weave', cursor: 'leaf' }),
    preset('aqua-underwater', 'Aqua / Underwater', 'waters', true, '#062a33', '#dcfbff', '#22d3ee', ['#0c4a5a', '#062a33', '#0e6b80'], { angle: 110, motion: 'drift', pattern: 'bubbles', cursor: 'bubble' }),
    preset('crystal-lake', 'Crystal Lake', 'waters', true, '#0a2233', '#e8f6ff', '#7dd3fc', ['#14395a', '#0a2233', '#1d5a8a'], { angle: 120, motion: 'shimmer', pattern: 'marble', cursor: 'lake' }),
    preset('nature-leaves', 'Nature / Leaves', 'waters', true, '#0e2412', '#ecf7e4', '#84cc16', ['#1d3d1c', '#0e2412', '#2f5c26'], { angle: 115, motion: 'breathe', pattern: 'weave', cursor: 'leaf' }),
    preset('woodland', 'Woodland', 'waters', true, '#171307', '#f2ecd8', '#d4a373', ['#2a2210', '#171307', '#3d3016'], { angle: 110, motion: 'breathe', pattern: 'grain', cursor: 'wood' }),
    preset('sand-desert', 'Sand / Desert', 'waters', false, '#f5e8d0', '#3d2c17', '#b45309', ['#f9edd6', '#e8d3ae', '#d4b078'], { angle: 110, motion: 'drift', pattern: 'grain', cursor: 'dune' }),

    // Fire & Dark
    preset('sunset', 'Sunset', 'ember', true, '#1e0f1e', '#ffe9d6', '#fb923c', ['#3d1c30', '#1e0f1e', '#6b2f22'], { angle: 110, motion: 'breathe', pattern: 'marble', cursor: 'ember' }),
    preset('fire-lava', 'Fire / Lava', 'ember', true, '#1a0805', '#ffe8de', '#ff5a1f', ['#3a1208', '#1a0805', '#5c1e0a'], { angle: 105, motion: 'pulse', pattern: 'ember', cursor: 'flame' }),
    preset('blood-darkred', 'Blood / Dark Red', 'ember', true, '#160505', '#ffe4e0', '#ef4444', ['#2e0a0a', '#160505', '#4d1010'], { angle: 110, motion: 'pulse', pattern: 'marble', cursor: 'blood' }),
    preset('dragon', 'Dragon', 'ember', true, '#150505', '#ffe7e2', '#f87171', ['#2f0d0d', '#150505', '#521414'], { angle: 120, motion: 'pulse', pattern: 'carbon', cursor: 'dragon' }),
    preset('gold-black', 'Gold & Black', 'ember', true, '#0e0c06', '#f9f0d4', '#fbbf24', ['#221a0a', '#0e0c06', '#3a2c10'], { angle: 115, motion: 'shimmer', pattern: 'brush', cursor: 'gold' }),
    preset('metal-chrome', 'Metal / Chrome', 'ember', false, '#eef1f4', '#17191d', '#475569', ['#ffffff', '#dfe4ea', '#aeb8c4'], { angle: 100, motion: 'shimmer', pattern: 'brush', cursor: 'chrome' }),
    preset('steampunk', 'Steampunk', 'ember', true, '#17100a', '#f3e6cf', '#d97706', ['#2b1d10', '#17100a', '#422a14'], { angle: 110, motion: 'drift', pattern: 'lattice', cursor: 'brass' }),

    // Dreams & Space
    preset('pastel-dreams', 'Pastel Dreams', 'dream', false, '#fdf0f5', '#4a2b3d', '#db2777', ['#fff7fb', '#f5d3e6', '#d9a8d0'], { angle: 115, motion: 'drift', pattern: 'bubbles', cursor: 'pastel' }),
    preset('space-galaxy', 'Space / Galaxy', 'dream', true, '#0b0a24', '#ecebff', '#818cf8', ['#1a1848', '#0b0a24', '#2e2a6e'], { angle: 120, motion: 'drift', pattern: 'stars', cursor: 'galaxy' }),
    preset('sakura', 'Sakura / Cherry Blossom', 'dream', true, '#1c0e1c', '#ffedf4', '#f472b6', ['#331631', '#1c0e1c', '#55264e'], { angle: 115, motion: 'breathe', pattern: 'speck', cursor: 'bloom' }),
    preset('rainbow', 'Rainbow', 'dream', true, '#0d0d18', '#f4f4f8', '#22d3ee', ['#ff5a5a', '#7c3aad', '#38bdf8', '#4ade80'], { angle: 110, motion: 'wave', pattern: 'none', cursor: 'rainbow' }),
    preset('ice-frost', 'Ice / Frost', 'dream', true, '#0a1c28', '#e8f7ff', '#7dd3fc', ['#163a52', '#0a1c28', '#245a7e'], { angle: 120, motion: 'shimmer', pattern: 'lattice', cursor: 'frost' }),
    preset('space-station', 'Space Station', 'dream', true, '#081420', '#e2f0ff', '#38bdf8', ['#10283d', '#081420', '#1a3d5c'], { angle: 100, motion: 'drift', pattern: 'grid', cursor: 'station' }),

    // Retro & Tech
    preset('retro-90s', 'Retro 90s', 'retro', false, '#dfdfdf', '#0a0a0a', '#0000aa', ['#f2f2f2', '#dfdfdf', '#bdbdc2'], { angle: 90, motion: 'none', pattern: 'scan', cursor: 'retro' }),
    preset('matrix', 'Matrix', 'retro', true, '#020f06', '#d1ffe0', '#4ade80', ['#062417', '#020f06', '#0a3a1f'], { angle: 110, motion: 'shimmer', pattern: 'rain', cursor: 'matrix' }),
    preset('dark-gothic', 'Dark Gothic', 'retro', true, '#0b0b0e', '#e8e8ec', '#a1a1aa', ['#17171d', '#0b0b0e', '#23232b'], { angle: 115, motion: 'breathe', pattern: 'grain', cursor: 'gothic' }),
    preset('circuit-tech', 'Circuit / Tech', 'retro', true, '#06121a', '#dff6ff', '#00e5ff', ['#0d2836', '#06121a', '#14465c'], { angle: 100, motion: 'pulse', pattern: 'grid', cursor: 'circuit' }),
    preset('custom-alien', 'Custom / Alien', 'retro', true, '#071a0c', '#e2ffe8', '#4ade80', ['#0f3520', '#071a0c', '#1a5c30'], { angle: 115, motion: 'wave', pattern: 'speck', cursor: 'alien' })
  ].map(Object.freeze);

  const BY_ID = new Map(PRESETS.map((item) => [item.id, item]));
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
  // dim text stays dim in both modes. The ramp walks toward the background
  // only as far as the legibility floor allows.
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

  // Walk the accent away from its own background until it can carry interface
  // text, keeping the hue as long as possible.
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

  // Walk a surface away from its neighbour until the step is actually visible.
  function raised(base, towards, minDrift) {
    let result = base;
    for (let step = 0.04; step <= 0.6; step += 0.02) {
      result = mix(base, towards, step);
      if (channelDrift(base, result) >= minDrift) return result;
    }
    return towards;
  }

  // Saturated frames often cannot carry the theme's own ink. Fall back to
  // plain paper white or near-black — whichever contrasts more.
  const INK_LIGHT = '#ffffff';
  const INK_DARK = '#0b0d10';

  function frameInk(ink, frame) {
    if (contrast(ink, frame) >= 4.5) return ink;
    return contrast(INK_LIGHT, frame) >= contrast(INK_DARK, frame) ? INK_LIGHT : INK_DARK;
  }

  function presetById(id) {
    if (typeof id !== 'string') return null;
    const direct = BY_ID.get(id);
    if (direct) return direct;
    const aliased = LEGACY_ALIASES[id];
    if (aliased) return BY_ID.get(aliased) || null;
    return BY_ID.get(DEFAULT_PRESET);
  }

  function cursorApi() {
    return root.PrismPixelCursor || null;
  }

  function resolve(input) {
    const config = input && typeof input === 'object' ? input : {};
    const cursorSize = Math.max(16, Math.min(28, Number(config.cursorSize) || 20));
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
    // Split on top-level commas only: gradient arguments nest rgba() calls,
    // so a flat regex would shred colour stops into bogus layers.
    const patternLayers = splitLayers(pattern ? pattern.image : '');
    const patternSizes = pattern && pattern.size ? pattern.size.split(',').map((part) => part.trim()) : [];
    const patternPositions = pattern && pattern.position ? pattern.position.split(',').map((part) => part.trim()) : [];
    const artwork = source.artwork && !hasCustomFrame && !hasCustomBackground ? source.artwork : null;
    const cursorName = source.cursor || 'classic';
    // Everything below is derived *with legibility as a constraint*, so a
    // hand-picked pastel accent cannot produce an unreadable UI.
    const dim = mutedToward(ink, bg, MUTED_FLOOR.dim);
    const faint = mutedToward(ink, bg, MUTED_FLOOR.faint);
    const accent = ensureContrast(source.accent, bg, 3);
    const chromeAccent = ensureContrast(accent, frameBase, 3);
    const chromeText = frameInk(ink, frameBase);
    // First background layer paints on top, so the texture goes before the
    // gradient and the gradient before the flat colour. Images, sizes and
    // positions are tracked in parallel so every layer stays valid inside
    // `background-image` (which forbids inline position/size syntax).
    const layers = patternLayers.slice();
    const sizes = patternSizes.slice();
    const positions = patternLayers.map((_, index) => patternPositions[index] || '0 0');
    if (artwork) {
      // Signature artwork replaces (rather than sits under) the opaque palette
      // gradient. A restrained veil preserves toolbar legibility over details.
      layers.push('linear-gradient(rgba(3, 7, 12, .44), rgba(3, 7, 12, .44))', `url("prism://assets/${source.artwork}")`);
      sizes.push('100% 100%', 'cover');
      positions.push('center top', 'center top');
    } else if (source.chrome) {
      layers.push(`linear-gradient(${source.angle}deg, ${source.chrome.join(', ')})`);
      sizes.push('220% 220%');
      positions.push('center top');
    }
    const backgroundSize = sizes.length ? sizes.join(', ') : '220% 220%';
    const backgroundPosition = positions.length ? positions.join(', ') : 'center top';
    const pixel = cursorApi();
    const cursorImage = pixel ? pixel.css(accent, cursorSize, cursorName) : 'auto';
    const cursorPointerImage = pixel ? pixel.pointer(accent, cursorSize, cursorName) : 'pointer';
    const cursorTextImage = pixel ? pixel.textCursor(accent, cursorSize, cursorName) : 'text';
    const cursorWaitImage = pixel ? pixel.wait(accent, cursorSize, cursorName) : 'wait';
    const cursorMoveImage = pixel ? pixel.move(accent, cursorSize, cursorName) : 'move';
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
      // Text drawn on the frame itself. Kept as its own pair so the shell can
      // label a saturated frame without tinting the rest of the browser.
      '--chrome-ink': chromeText,
      '--chrome-ink-dim': mutedToward(chromeText, frameBase, 3),
      '--chrome-accent': chromeAccent,
      '--chrome-gradient': source.chrome ? `linear-gradient(${source.angle}deg, ${source.chrome.join(', ')})` : 'none',
      '--chrome-bg': layers.length ? layers.join(', ') : 'none',
      '--chrome-background-size': backgroundSize,
      '--chrome-background-position': backgroundPosition,
      '--chrome-artwork': artwork ? `url("prism://assets/${artwork}")` : 'none',
      '--page-artwork': artwork ? `url("prism://assets/${artwork}")` : 'none',
      // Per-theme glowing cursors: arrow, link hand, text caret, busy ring
      // and move cross, all tinted with the resolved accent.
      '--cursor-name': cursorName,
      '--cursor-image': cursorImage,
      '--cursor-pointer-image': cursorPointerImage,
      '--cursor-text-image': cursorTextImage,
      '--cursor-wait-image': cursorWaitImage,
      '--cursor-move-image': cursorMoveImage,
      '--cursor-icon-image': pixel ? pixel.icon(accent, 'pointer', cursorSize, cursorName) : 'none',
      '--pixel-cursor-stylesheet': pixel ? pixel.stylesheet(accent, cursorSize, cursorName) : '',
      // Glow tokens so chrome UI (active tab, focused omnibox) can echo the
      // theme accent instead of sitting flat on the gradient.
      '--cursor-glow': alpha(accent, source.dark ? 0.55 : 0.35),
      '--chrome-glow': alpha(chromeAccent, source.dark ? 0.4 : 0.28),
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
      cursor: cursorName,
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
    target.dataset.cursorName = resolved.cursor;
    target.dataset.pixelCursor = a.pixelCursor === false ? 'false' : 'true';
    target.dataset.cursorSize = String(Math.max(16, Math.min(28, Number(a.cursorSize) || 20)));
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

  // "Surprise me" jumps to another gallery theme instead of inventing a
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
