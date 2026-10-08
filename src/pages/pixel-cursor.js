// pixel-cursor.js — build a tiny crisp-edged cursor from a validated theme tint.
// Kept as a UMD helper so both the sandboxed browser UI and main process can use it.
(function installPixelCursor(root, factory) {
  const api = factory();
  root.PrismPixelCursor = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function createPixelCursor() {
  'use strict';

  function image(markup) {
    return `url("data:image/svg+xml,${encodeURIComponent(markup)}")`;
  }

  function tintOf(color) {
    return /^#[0-9a-f]{6}$/i.test(String(color || '')) ? color : '#78aaff';
  }

  function arrowSvg(tint) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 16 20" shape-rendering="crispEdges"><path fill="#071016" d="M1 0v15h4v-3h2v2h2v3h2v3h4v-5h-2v-3h-2v-3h4v-2h-4V5h-3V3H5V1H3V0z"/><path fill="#ffffff" d="M2 2v11h2V9l3 3h2v3h2v3h2v-3h-2v-3h-2v-3h4V7H9V5H7V3H5V2z"/><path fill="${tint}" d="M4 4h2v2h2v2h3v1H8v2H7L4 8z"/><path fill="#ffffff" d="M3 3v3H2V2h3v1z"/></svg>`;
  }

  function handSvg(tint) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 16 20" shape-rendering="crispEdges"><path fill="#071016" d="M3 8V3h3v5h1V1h3v7h1V4h3v6h1v4l-3 5H7l-4-5-2-4V8z"/><path fill="#fff" d="M4 8V4h1v8h2V2h1v10h2V5h1v8h2V6h1v7l-3 5H7l-3-5-2-4h1v4h1z"/><path fill="${tint}" d="M5 5v5h2V3h1v8h2V6h1v7H5z"/></svg>`;
  }

  function css(color) {
    return `${image(arrowSvg(tintOf(color)))} 2 2, auto`;
  }

  function pointer(color) {
    return `${image(handSvg(tintOf(color)))} 5 2, pointer`;
  }

  function icon(color, kind) {
    const tint = tintOf(color);
    if (kind === 'pointer') return image(handSvg(tint));
    if (kind === 'text') {
      const text = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 12 16" shape-rendering="crispEdges"><path fill="#071016" d="M1 1h10v2H7v10h3v2H2v-2h3V3H1z"/><path fill="#fff" d="M2 2h8v1H6v10h3v1H3v-1h3V3H2z"/><path fill="${tint}" d="M3 2h6v1H6v4H5V3H3z"/></svg>`;
      return image(text);
    }
    return image(arrowSvg(tint));
  }

  function textCursor(color) {
    return `${icon(color, 'text')} 12 8, text`;
  }

  function stylesheet(color) {
    const arrow = css(color);
    const hand = pointer(color);
    const text = textCursor(color);
    return `html,body,body *{cursor:${arrow}!important}a[href],button,[role="button"],[role="link"],input[type="button"],input[type="submit"],select,label{cursor:${hand}!important}input:not([type]),input[type="text"],input[type="search"],input[type="url"],input[type="email"],input[type="password"],input[type="number"],textarea,[contenteditable="true"],[role="textbox"]{cursor:${text}!important}input:disabled,button:disabled,[aria-disabled="true"]{cursor:${arrow}!important}`;
  }

  return Object.freeze({ css, pointer, icon, textCursor, stylesheet });
});
