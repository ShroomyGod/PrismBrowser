// store-inject.js — browser-side shim injected into Chrome/Edge store pages.
//
// Injected into the page's MAIN world by main/store-install.js (not a preload,
// so it runs after Google/Microsoft's own bundle has attached its handlers).
//
// Why this exists: both stores gate installation on "is this Chrome?", so on
// any other Chromium build the page renders a "Switch to Chrome to install
// extensions and themes" banner, an "Install Chrome" button, and a dead
// "Add to Chrome" button. Prism can install these extensions natively already
// (extensions.installFromStore downloads the CRX itself), so this shim removes
// the cross-browser nag and turns the store's own button into a working
// "Install To Prism".
//
// Both stores are single-page apps that re-render constantly, so the DOM work is
// idempotent and re-applied through a MutationObserver rather than once.
(function () {
  'use strict';

  var CHROME_HOSTS = ['chromewebstore.google.com', 'chrome.google.com'];
  var EDGE_HOSTS = ['microsoftedge.microsoft.com', 'addons.microsoft.com'];

  function storeSource() {
    var h = location.hostname;
    if (CHROME_HOSTS.indexOf(h) !== -1) return 'chrome';
    if (EDGE_HOSTS.indexOf(h) !== -1) return 'edge';
    return null;
  }

  var source = storeSource();
  // Belt and braces: main only injects on store origins, but if the page
  // navigates client-side to somewhere else, stop acting.
  if (!source) return;

  var API = window.prismStore;
  if (!API || typeof API.install !== 'function') return;

  var BTN_LABEL = 'Install To Prism';

  function extensionId() {
    var m = location.pathname.match(/\/(?:detail|addons)\/[^/]*\/([a-p]{32})/i) ||
            location.pathname.match(/\/([a-p]{32})(?:$|[/?])/i) ||
            location.search.match(/[?&]id=([a-p]{32})/i);
    return m ? m[1].toLowerCase() : null;
  }

  function makeButton(id) {
    var b = document.createElement('button');
    b.className = 'prism-install-btn';
    b.setAttribute('data-prism-install', id);
    b.textContent = BTN_LABEL;
    b.style.cssText = [
      'background:#4a7dff', 'color:#fff', 'border:0', 'border-radius:999px',
      'padding:10px 22px', 'font:600 14px/1.2 Roboto,Segoe UI,system-ui,sans-serif',
      'cursor:pointer', 'margin:0 8px'
    ].join(';');
    b.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (b.dataset.busy === '1') return;
      b.dataset.busy = '1';
      b.textContent = 'Installing…';
      b.style.opacity = '0.7';
      // prism:extensions:install resolves to {id} on success or {error} on
      // failure, so success is "no error", not "ok".
      API.install(source, id).then(function (result) {
        if (result && result.error) {
          b.textContent = 'Install failed';
          b.style.background = '#d93025';
          if (API.report) API.report(result.error);
          return;
        }
        b.textContent = 'Installed';
        b.style.background = '#1e8e3e';
      }).catch(function (err) {
        b.textContent = 'Install failed';
        b.style.background = '#d93025';
        if (API.report) API.report((err && err.message) || String(err));
      }).then(function () {
        b.dataset.busy = '0';
      });
    });
    return b;
  }

  // Google's nag: an "install on Chrome" banner. Removed rather than merely
  // hidden once, because the store re-renders and can put it back.
  //
  // Anchoring on the INNERMOST element containing the phrase matters: matching
  // every ancestor would hide large unrelated regions of the page, since a
  // banner's text is also contained in each of its parents.
  function killNag() {
    var re = /switch to chrome to install extensions and themes/i;
    var all = document.querySelectorAll('div,section,aside,span,p');
    var innermost = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (!re.test(el.textContent || '')) continue;
      // Skip if a child already matches: that child is the innermost one.
      var child = el.querySelector('div,section,aside,span,p');
      var hasMatchingChild = false;
      for (var c = 0; child && c < 1; c++) {
        var kids = child.querySelectorAll('*');
        for (var k = 0; k < kids.length; k++) {
          if (re.test(kids[k].textContent || '')) { hasMatchingChild = true; break; }
        }
      }
      if (!hasMatchingChild) innermost.push(el);
    }
    for (var m = 0; m < innermost.length; m++) {
      var node = innermost[m];
      // Hide the phrase node and the row that wraps it, which is what carries
      // the blue background and the "Install Chrome" button.
      node.style.display = 'none';
      if (node.parentElement && !/^(BODY|HTML)$/.test(node.parentElement.tagName)) {
        node.parentElement.style.display = 'none';
      }
    }
    // The standalone "Install Chrome" button inside that banner.
    var btns = document.querySelectorAll('button, a[role="button"]');
    for (var j = 0; j < btns.length; j++) {
      var b = btns[j];
      if (b.hasAttribute('data-prism-install')) continue;
      if (/^install chrome$/i.test((b.textContent || '').trim())) b.style.display = 'none';
    }
  }

  function decorate() {
    killNag();
    var id = extensionId();
    if (!id) return;
    // The listing page's own "Add to Chrome" button is what users click.
    var candidates = document.querySelectorAll('button, div[role="button"], a[role="button"]');
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (el.hasAttribute('data-prism-install')) continue;
      var label = (el.textContent || '').trim();
      if (label !== 'Add to Chrome' && label !== 'Add to Microsoft Edge' && label !== 'Add') continue;
      var slot = el.parentElement;
      if (!slot) continue;
      el.setAttribute('data-prism-replaced', '1');
      el.style.display = 'none';
      if (!slot.querySelector('.prism-install-btn')) slot.appendChild(makeButton(id));
    }
  }

  // Re-run on every meaningful DOM change; the store re-renders its whole body
  // after async data arrives, which would otherwise wipe our button.
  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      try { decorate(); } catch (_) { /* page mid-navigation */ }
    });
  }

  decorate();
  new MutationObserver(schedule).observe(document.documentElement || document, {
    childList: true, subtree: true
  });
  // Client-side navigation between listings keeps the same document alive.
  window.addEventListener('popstate', schedule);
  var push = history.pushState;
  history.pushState = function () { push.apply(history, arguments); schedule(); };
})();