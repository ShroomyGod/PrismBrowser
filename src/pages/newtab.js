// newtab.js — new tab: brand plus a search box.
//
// Queries are resolved by the main process against the user's default search
// engine (see prism:search:url). They are deliberately NOT hardcoded to
// prism://search here: the renderer has no access to settings, and picking an
// engine in Settings would otherwise have no effect on this box.
'use strict';
(async function () {
  await PrismUI.boot();

  const form = document.getElementById('form');
  const q = document.getElementById('q');

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const v = q.value.trim();
    if (!v) return;

    const lower = v.toLowerCase();
    // Bare internal page names still jump straight to the page.
    const INTERNAL_PAGES = ['settings', 'history', 'bookmarks', 'downloads', 'passwords', 'extensions', 'privacy', 'search', 'blocked', 'error', 'newtab'];
    if (INTERNAL_PAGES.includes(lower)) {
      location.href = 'prism://' + lower;
      return;
    }
    // Anything that looks like a URL is opened as one.
    if (/^(https?:\/\/|prism:\/\/)/i.test(v)) { location.href = v; return; }
    if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v)) { location.href = 'http://' + v; return; }

    // Everything else goes to the configured default engine. Fall back to the
    // omnibox behaviour (a plain search) if the bridge is unavailable.
    const go = (url) => { if (url) location.href = url; };
    if (window.prism && typeof window.prism.searchUrlFor === 'function') {
      window.prism.searchUrlFor(v).then(go).catch(() => go('https://duckduckgo.com/?q=' + encodeURIComponent(v)));
    } else {
      go('https://duckduckgo.com/?q=' + encodeURIComponent(v));
    }
  });
})();