// theme-engine.js — shared generated themes and accessibility tokens for Prism.
// No theme assets or third-party dependencies: combinations are calculated from
// a hue, saturation, gradient family, and motion recipe at runtime.
'use strict';

(function installThemeEngine(root) {
  const GRADIENTS = ['aurora', 'sunset', 'ocean', 'candy', 'ember', 'forest', 'mono', 'none'];
  const MOTIONS = ['none', 'shimmer', 'drift', 'breathe', 'pulse', 'wave'];
  const SATURATIONS = [45, 60, 75, 90];
  const THEME_COUNT = 360 * SATURATIONS.length * GRADIENTS.length * MOTIONS.length;
  const clamp = (value, min, max, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const wrapHue = (h) => ((Math.round(h) % 360) + 360) % 360;
  const hsl = (h, s, l) => `hsl(${wrapHue(h)} ${clamp(s, 0, 100, 60)}% ${clamp(l, 0, 100, 50)}%)`;
  const hsla = (h, s, l, a) => `hsl(${wrapHue(h)} ${clamp(s, 0, 100, 60)}% ${clamp(l, 0, 100, 50)}% / ${clamp(a, 0, 1, 0.2)})`;

  const GRADIENT_OFFSETS = {
    aurora: [-45, 0, 80], sunset: [-35, 35, 105], ocean: [-20, 35, 195],
    candy: [-80, 20, 140], ember: [-18, 16, 46], forest: [-55, -10, 50],
    mono: [0, 0, 0], none: [0, 0, 0]
  };

  function normalize(input) {
    const v = input || {};
    const gradient = GRADIENTS.includes(v.gradient) ? v.gradient : 'aurora';
    const motion = MOTIONS.includes(v.motion) ? v.motion : 'none';
    return {
      hue: wrapHue(clamp(v.hue, 0, 359, 215)),
      saturation: clamp(v.saturation, 35, 95, 75),
      gradient,
      motion,
      intensity: clamp(v.intensity, 0, 100, 45)
    };
  }

  function resolve(input, baseTheme) {
    const v = normalize(input);
    const offsets = GRADIENT_OFFSETS[v.gradient];
    const dark = baseTheme !== 'light';
    const accent = hsl(v.hue, v.saturation, dark ? 70 : 42);
    const surfaceHue = v.hue;
    const a = hsla(surfaceHue + offsets[0], Math.max(30, v.saturation - 15), dark ? 58 : 46, v.gradient === 'none' ? 0 : (0.04 + v.intensity / 400));
    const b = hsla(surfaceHue + offsets[1], v.saturation, dark ? 54 : 50, v.gradient === 'none' ? 0 : (0.035 + v.intensity / 450));
    const c = hsla(surfaceHue + offsets[2], Math.max(35, v.saturation - 8), dark ? 62 : 44, v.gradient === 'none' ? 0 : (0.03 + v.intensity / 500));
    const surfaceSaturation = Math.min(24, v.saturation * 0.22);
    const darkBase = [7, 9, 12, 16];
    const lightBase = [100, 97, 92, 86];
    const base = dark ? darkBase : lightBase;
    const surface = (lightness) => hsl(surfaceHue, surfaceSaturation, lightness);
    const foreground = (lightness) => hsl(surfaceHue, 8, lightness);
    return {
      ...v,
      '--theme-hue': String(v.hue),
      '--theme-saturation': v.saturation + '%',
      '--bg': surface(base[0]),
      '--bg2': surface(base[1]),
      '--bg3': surface(base[2]),
      '--bg4': surface(base[3]),
      '--line': surface(dark ? 23 : 82),
      '--line-soft': surface(dark ? 17 : 89),
      '--text': foreground(dark ? 94 : 12),
      '--text-dim': hsl(surfaceHue, 5, dark ? 72 : 34),
      '--text-faint': hsl(surfaceHue, 4, dark ? 58 : 43),
      '--dim': hsl(surfaceHue, 5, dark ? 72 : 34),
      '--shadow': dark ? 'rgba(0,0,0,.48)' : 'rgba(0,0,0,.18)',
      '--accent': accent,
      '--accent-soft': hsla(v.hue, v.saturation, dark ? 65 : 42, dark ? 0.18 : 0.12),
      '--gradient-a': a,
      '--gradient-b': b,
      '--gradient-c': c,
      '--chrome-gradient': v.gradient === 'none' ? 'none' : `linear-gradient(${105 + (v.hue % 115)}deg, ${a}, ${b}, ${c})`,
      '--page-gradient': v.gradient === 'none' ? 'none' : `radial-gradient(ellipse at 12% 0%, ${a}, transparent 48%), radial-gradient(ellipse at 90% 10%, ${c}, transparent 46%)`,
      '--gradient-angle': (105 + (v.hue % 115)) + 'deg',
      '--gradient-text': dark ? '#ffffff' : '#141414',
      '--motion-duration': (8.5 - (v.intensity * 0.055)).toFixed(2) + 's',
      '--motion-opacity': (v.intensity / 100).toFixed(2)
    };
  }

  function apply(target, appearance) {
    if (!target) return;
    const a = appearance || {};
    const visual = normalize(a.visualTheme);
    const accessibility = a.accessibility || {};
    const resolved = resolve(visual, a.theme || 'dark');
    if (accessibility.contrast === 'high') {
      const highText = resolved['--text'];
      resolved['--line'] = highText;
      resolved['--line-soft'] = highText;
      resolved['--text-dim'] = highText;
      resolved['--text-faint'] = highText;
      resolved['--dim'] = highText;
      resolved['--accent-soft'] = hsla(0, 0, 50, 0.3);
    }
    for (const [key, value] of Object.entries(resolved)) {
      if (key.startsWith('--')) target.style.setProperty(key, value);
    }
    target.dataset.theme = a.theme || 'dark';
    target.dataset.gradient = visual.gradient;
    target.dataset.motion = visual.motion;
    target.dataset.contrast = accessibility.contrast === 'high' ? 'high' : 'normal';
    target.dataset.largeTargets = accessibility.largerTargets ? 'true' : 'false';
    target.dataset.focusVisible = accessibility.focusIndicators === false ? 'subtle' : 'strong';
    target.style.setProperty('--ui-scale', (clamp(accessibility.textScale, 80, 150, 100) / 100).toFixed(2));
    const reduce = accessibility.reducedMotion || 'system';
    target.dataset.reduceMotion = reduce === 'reduce' ? 'reduce' : reduce === 'no-preference' ? 'allow' : 'system';
  }

  function fromIndex(index) {
    let n = Math.floor(clamp(index, 0, THEME_COUNT - 1, 0));
    // Hue varies first so each visible gallery page is a colorful mix rather
    // than dozens of nearby variations in the same color family.
    const hue = n % 360; n = Math.floor(n / 360);
    const saturation = SATURATIONS[n % SATURATIONS.length]; n = Math.floor(n / SATURATIONS.length);
    const gradient = GRADIENTS[n % GRADIENTS.length]; n = Math.floor(n / GRADIENTS.length);
    const motion = MOTIONS[n % MOTIONS.length];
    return { hue, saturation, gradient, motion, intensity: 45 };
  }

  function random(previous) {
    const old = normalize(previous);
    const motions = MOTIONS.filter((m) => m !== old.motion);
    const gradients = GRADIENTS.filter((g) => g !== old.gradient);
    return {
      hue: Math.floor(Math.random() * 360),
      saturation: SATURATIONS[Math.floor(Math.random() * SATURATIONS.length)],
      gradient: gradients[Math.floor(Math.random() * gradients.length)],
      motion: motions[Math.floor(Math.random() * motions.length)],
      intensity: 25 + Math.floor(Math.random() * 66)
    };
  }

  root.PrismTheme = Object.freeze({
    GRADIENTS: Object.freeze(GRADIENTS.slice()),
    MOTIONS: Object.freeze(MOTIONS.slice()),
    SATURATIONS: Object.freeze(SATURATIONS.slice()),
    THEME_COUNT,
    normalize,
    fromIndex,
    resolve,
    apply,
    random
  });
})(window);
