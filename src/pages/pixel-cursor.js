// pixel-cursor.js — crisp pixel-art cursors, tinted + glowing per theme.
//
// Each browser theme ships its own custom cursor: the classic pixel arrow,
// link hand, text caret, busy ring and move cross are all re-tinted with the
// theme accent and given a soft neon glow so they read on any background.
// Kept as a UMD helper so both the sandboxed browser UI and main process can use it.
(function installPixelCursor(root, factory) {
  const api = factory();
  root.PrismPixelCursor = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function createPixelCursor() {
  'use strict';

  function image(markup, size) {
    const px = Math.max(16, Math.min(28, Number(size) || 20));
    const match = markup.match(/width="(\d+)" height="(\d+)"/);
    const ratio = match ? Number(match[2]) / Number(match[1]) : 1.25;
    const sized = markup.replace(/width="\d+" height="\d+"/, `width="${px}" height="${Math.round(px * ratio)}"`);
    return `url("data:image/svg+xml,${encodeURIComponent(sized)}")`;
  }

  function tintOf(color) {
    return /^#[0-9a-f]{6}$/i.test(String(color || '')) ? color : '#78aaff';
  }

  function styleOf(name) {
    return String(name || 'classic').toLowerCase();
  }

  // Glow wrapper: a drop shadow in the theme tint so the cursor looks lit
  // rather than flat. stdDeviation scales the halo without blurring the crisp
  // pixel edges themselves.
  function glowDef(tint, strong) {
    const dev = strong ? '1.6' : '1.1';
    return `<filter id="pg" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="0" stdDeviation="${dev}" flood-color="${tint}" flood-opacity="0.95"/></filter>`;
  }

  // Rainbow cursors get a real multi-stop fill instead of a flat tint.
  function fillFor(tint, kind) {
    if (kind === 'rainbow') {
      return {
        defs: `<linearGradient id="rb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5a5a"/><stop offset=".25" stop-color="#ffb84d"/><stop offset=".5" stop-color="#4ade80"/><stop offset=".75" stop-color="#38bdf8"/><stop offset="1" stop-color="#a78bfa"/></linearGradient>`,
        paint: 'url(#rb)'
      };
    }
    if (kind === 'gold' || kind === 'gold-black' || kind === 'brass') {
      return {
        defs: `<linearGradient id="au" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9b0"/><stop offset=".5" stop-color="${tint}"/><stop offset="1" stop-color="#7c4a03"/></linearGradient>`,
        paint: 'url(#au)'
      };
    }
    if (kind === 'chrome' || kind === 'glass' || kind === 'station') {
      return {
        defs: `<linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="${tint}"/><stop offset="1" stop-color="#334155"/></linearGradient>`,
        paint: 'url(#ag)'
      };
    }
    return { defs: '', paint: tint };
  }

  function arrowSvg(tint, cursorName) {
    const kind = styleOf(cursorName);
    const { defs, paint } = fillFor(tint, kind);
    const strong = kind === 'neon' || kind === 'cyber' || kind === 'dragon' || kind === 'flame' || kind === 'rainbow';
    // Ember / flame tails get a jagged notch; frost gets an extra facet;
    // everything else shares the classic silhouette so the pointer stays readable.
    const emberNotch = (kind === 'flame' || kind === 'ember' || kind === 'dragon' || kind === 'blood')
      ? `<path fill="${paint}" d="M4 9h2V7h2V5h2V4h1V7H9v2H7v2H6v2H4z"/>` : '';
    const frostFacet = (kind === 'frost' || kind === 'ice-frost' || kind === 'lake' || kind === 'glass')
      ? `<path fill="#ffffff" opacity=".85" d="M5 4h1v2H5zM6 6h3v1H6z"/>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="30" viewBox="0 0 16 20" shape-rendering="crispEdges"><defs>${defs}${glowDef(tint, strong)}</defs><g filter="url(#pg)"><path fill="#071016" d="M1 0v15h4v-3h2v2h2v3h2v3h4v-5h-2v-3h-2v-3h4v-2h-4V5h-3V3H5V1H3V0z"/><path fill="#ffffff" d="M2 2v11h2V9l3 3h2v3h2v3h2v-3h-2v-3h-2v-3h4V7H9V5H7V3H5V2z"/><path fill="${paint}" d="M4 4h2v2h2v2h3v1H8v2H7L4 8z"/>${emberNotch}${frostFacet}<path fill="#ffffff" d="M3 3v3H2V2h3v1z"/></g></svg>`;
  }

  function handSvg(tint, cursorName) {
    const kind = styleOf(cursorName);
    const { defs, paint } = fillFor(tint, kind);
    const strong = kind === 'neon' || kind === 'cyber' || kind === 'bloom' || kind === 'rainbow';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="30" viewBox="0 0 16 20" shape-rendering="crispEdges"><defs>${defs}${glowDef(tint, strong)}</defs><g filter="url(#pg)"><path fill="#071016" d="M3 8V3h3v5h1V1h3v7h1V4h3v6h1v4l-3 5H7l-4-5-2-4V8z"/><path fill="#fff" d="M4 8V4h1v8h2V2h1v10h2V5h1v8h2V6h1v7l-3 5H7l-3-5-2-4h1v4h1z"/><path fill="${paint}" d="M5 5v5h2V3h1v8h2V6h1v7H5z"/></g></svg>`;
  }

  function textSvg(tint, cursorName) {
    const kind = styleOf(cursorName);
    const { defs, paint } = fillFor(tint, kind);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="24" viewBox="0 0 12 16" shape-rendering="crispEdges"><defs>${defs}${glowDef(tint, false)}</defs><g filter="url(#pg)"><path fill="#071016" d="M1 1h10v2H7v10h3v2H2v-2h3V3H1z"/><path fill="#fff" d="M2 2h8v1H6v10h3v1H3v-1h3V3H2z"/><path fill="${paint}" d="M3 2h6v1H6v4H5V3H3z"/></g></svg>`;
  }

  function waitSvg(tint, cursorName) {
    const kind = styleOf(cursorName);
    const { defs, paint } = fillFor(tint, kind);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 16 16" shape-rendering="crispEdges"><defs>${defs}${glowDef(tint, true)}</defs><g filter="url(#pg)"><path fill="#071016" d="M6 0h4v2H6zM6 14h4v2H6zM0 6h2V6h12V6h2v4h-2v-1H2v1H0z"/><path fill="none" stroke="#ffffff" stroke-width="2" d="M8 2a6 6 0 1 0 6 6"/><path fill="none" stroke="${paint}" stroke-width="2" d="M8 2a6 6 0 0 1 6 6"/></g></svg>`;
  }

  function moveSvg(tint, cursorName) {
    const kind = styleOf(cursorName);
    const { defs, paint } = fillFor(tint, kind);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 16 16" shape-rendering="crispEdges"><defs>${defs}${glowDef(tint, true)}</defs><g filter="url(#pg)"><path fill="#071016" d="M7 0h2v5h5V7h-5v2h5V7h2v2h-2v1h-5v6H7v-6H2v-1H0V7h2V5h5z"/><path fill="#ffffff" d="M7 1h2v5h5v2h-5v2h-2v-2H2V6h5z"/><path fill="${paint}" d="M7 3h2v3h3v2h-3v3H7V8H4V6h3z"/></g></svg>`;
  }

  function css(color, size, cursorName) {
    return `${image(arrowSvg(tintOf(color), cursorName), size)} 2 2, auto`;
  }

  function pointer(color, size, cursorName) {
    return `${image(handSvg(tintOf(color), cursorName), size)} 4 2, pointer`;
  }

  function textCursor(color, size, cursorName) {
    const px = Math.max(16, Math.min(28, Number(size) || 20));
    return `${image(textSvg(tintOf(color), cursorName), size)} ${Math.round(px * 0.375)} ${Math.round(px * 0.25)}, text`;
  }

  function wait(color, size, cursorName) {
    const px = Math.max(16, Math.min(28, Number(size) || 20));
    return `${image(waitSvg(tintOf(color), cursorName), size)} ${Math.round(px / 2)} ${Math.round(px / 2)}, wait`;
  }

  function move(color, size, cursorName) {
    const px = Math.max(16, Math.min(28, Number(size) || 20));
    return `${image(moveSvg(tintOf(color), cursorName), size)} ${Math.round(px / 2)} ${Math.round(px / 2)}, move`;
  }

  function icon(color, kind, size, cursorName) {
    // Backwards compatible: icon(color, kind, size). The cursor theme name is
    // an optional 4th argument; older callers that passed a size as the 3rd
    // argument keep working unchanged.
    const tint = tintOf(color);
    if (kind === 'pointer') return image(handSvg(tint, cursorName), size);
    if (kind === 'text') return image(textSvg(tint, cursorName), size);
    if (kind === 'wait') return image(waitSvg(tint, cursorName), size);
    if (kind === 'move') return image(moveSvg(tint, cursorName), size);
    return image(arrowSvg(tint, cursorName || kind), size);
  }

  function stylesheet(color, size, cursorName) {
    const arrow = css(color, size, cursorName);
    const hand = pointer(color, size, cursorName);
    const text = textCursor(color, size, cursorName);
    const busy = wait(color, size, cursorName);
    const moving = move(color, size, cursorName);
    return `html,body,body *{cursor:${arrow}!important}a[href],button,[role="button"],[role="link"],input[type="button"],input[type="submit"],select,label{cursor:${hand}!important}input:not([type]),input[type="text"],input[type="search"],input[type="url"],input[type="email"],input[type="password"],input[type="number"],textarea,[contenteditable="true"],[role="textbox"]{cursor:${text}!important}[aria-busy="true"],.loading,progress{cursor:${busy}!important}[draggable="true"],[data-drag]{cursor:${moving}!important}input:disabled,button:disabled,[aria-disabled="true"]{cursor:${arrow}!important}`;
  }

  return Object.freeze({ css, pointer, icon, textCursor, wait, move, stylesheet });
});
