// shell.js — browser chrome controller. Talks to main via window.prismShell.
'use strict';

const params = new URLSearchParams(location.search);
const WID = params.get('wid');
const S = window.prismShell;
const CHROME_FALLBACK_ICON = 'prism://assets/icon-16.png';

let state = {
  tabs: [],
  active: null,        // tab snapshot object
  adblockEnabled: true,
  theme: 'dark',
  appearance: null,
  bookmarksBar: false,
  private: false,      // this whole window is an incognito window
  settings: null
};

const $ = (id) => document.getElementById(id);
const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

// ---------- chrome geometry ----------
// The page view is a native layer positioned by the main process, which cannot
// read our stylesheet. So we measure the real height of the chrome and report
// it. --chrome-h mirrors the same number for CSS overlays (dropdowns, progress
// bar), keeping the two in agreement.
let lastReportedHeight = 0;
function syncChromeHeight() {
  const top = $('chrome-top');
  if (!top) return;
  const h = Math.round(top.getBoundingClientRect().height);
  if (!h) return;
  document.documentElement.style.setProperty('--chrome-h', h + 'px');
  if (h !== lastReportedHeight) {
    lastReportedHeight = h;
    S.reportChromeHeight(WID, h);
  }
}

// Keep the dropdown aligned to the omnibox rather than guessing at offsets.
function alignOmniDropdown() {
  const box = $('omnibox');
  const dd = $('omni-dropdown');
  if (!box || !dd) return;
  const r = box.getBoundingClientRect();
  const host = $('chrome-top').getBoundingClientRect();
  dd.style.left = Math.round(r.left - host.left) + 'px';
  dd.style.right = Math.round(host.right - r.right) + 'px';
}

// ---------- icons ----------
const ICONS = {
  close: '<svg viewBox="0 0 16 16" width="11" height="11"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>',
  audio: '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 6v4h2.5L9 13V3L5.5 6z" fill="currentColor"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>',
  muted: '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 6v4h2.5L9 13V3L5.5 6z" fill="currentColor"/><path d="M11 6l3 4M14 6l-3 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none"/></svg>',
  spinner: '<svg viewBox="0 0 16 16" width="14" height="14" class="spin"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-dasharray="26" stroke-dashoffset="8" stroke-linecap="round"/></svg>',
  prism: '<img class="fav-fallback" src="' + CHROME_FALLBACK_ICON + '" alt="">',
  globe: '<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M2.5 8h11M8 2.5c-4 3.5-4 7.5 0 11 4-3.5 4-7.5 0-11z" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>',
  search: '<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/></svg>',
  clock: '<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M8 5v3l2 1.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none"/></svg>'
};
const styleTag = document.createElement('style');
styleTag.textContent = '.spin{animation:rot .9s linear infinite}@keyframes rot{to{transform:rotate(360deg)}}';
document.head.appendChild(styleTag);

// ---------- tabs rendering ----------
function renderTabs() {
  const wrap = $('tabs');
  wrap.textContent = '';
  for (const t of state.tabs) {
    const div = el('div', 'tab' + (state.active && t.id === state.active.id ? ' active' : ''));
    div.dataset.tabId = t.id;
    div.title = t.title + (t.url && t.url.startsWith('http') ? '\n' + t.url : '');

    if (t.loading) {
      const sp = el('span', 'fav'); sp.innerHTML = ICONS.spinner; div.appendChild(sp);
    } else if (t.favicon) {
      const img = el('img', 'fav'); img.src = t.favicon; img.onerror = () => { img.replaceWith(prismIcon()); };
      div.appendChild(img);
    } else {
      div.appendChild(prismIcon());
    }

    const title = el('span', 't');
    title.textContent = t.title || 'New Tab';
    div.appendChild(title);

    if (t.muted || t.audio) {
      const a = el('span'); a.className = 'audio-ind'; a.innerHTML = t.muted ? ICONS.muted : ICONS.audio;
      a.title = t.muted ? 'Muted' : 'Playing audio';
      a.addEventListener('click', (ev) => { ev.stopPropagation(); S.muteTab(t.id); });
      div.appendChild(a);
    }

    const x = el('button', 'x');
    x.innerHTML = ICONS.close;
    x.title = 'Close tab';
    x.addEventListener('click', (ev) => { ev.stopPropagation(); S.closeTab(t.id); });
    div.appendChild(x);

    if (t.adCount > 0 && t.id === (state.active && state.active.id)) {
      // badge lives on the toolbar shield instead
    }

    div.addEventListener('click', () => S.activateTab(WID, t.id));
    div.addEventListener('auxclick', (ev) => { if (ev.button === 1) S.closeTab(t.id); });
    div.addEventListener('contextmenu', (ev) => { ev.preventDefault(); S.tabContextMenu(WID, t.id); });
    wrap.appendChild(div);
  }
}

function prismIcon() {
  const span = el('span');
  span.innerHTML = ICONS.prism;
  const img = span.firstChild;
  img.style.width = '16px'; img.style.height = '16px'; img.style.borderRadius = '3px';
  return span.firstChild ? img : span;
}

// ---------- omnibox ----------
const omni = $('omni-input');
let omniRows = [];
let omniSel = -1;

function prettyUrl(url) {
  if (!url) return '';
  if (url.startsWith('prism://')) {
    // Keep the omnibox clean and professional: internal landing pages show
    // as empty (placeholder) instead of filling the address bar with labels.
    // For search, surface the actual query so Back/forward keeps context.
    try {
      const u = new URL(url);
      const name = (u.hostname || u.pathname.replace(/^\/+/, '').split('/')[0] || '').toLowerCase();
      if (name === 'newtab') return '';
      if (name === 'search') return u.searchParams.get('q') || '';
      // Other internal pages stay empty too — no "Prism"/"New Tab" text
      // in the address bar.
      return '';
    } catch (_) {
      return '';
    }
  }
  return url.replace(/^https:\/\//, '').replace(/^http:\/\//, 'http://');
}

function setOmniboxFromState(tab) {
  if (document.activeElement === omni) return;
  omni.value = prettyUrl(tab ? tab.url : '');
  updateSecurityIcon(tab);
  updateStar(tab);
}

function updateSecurityIcon(tab) {
  const sec = tab ? tab.security : 'none';
  const box = $('sec-icon');
  box.className = sec === 'insecure' ? 'insecure' : (sec === 'secure' ? '' : 'prism');
  $('ic-lock').style.display = sec === 'secure' ? '' : 'none';
  $('ic-info').style.display = sec === 'insecure' ? '' : 'none';
  $('ic-prism').style.display = (sec !== 'secure' && sec !== 'insecure') ? '' : 'none';
  box.title = sec === 'secure' ? 'Secure connection (HTTPS)'
    : sec === 'insecure' ? 'Not secure: this page used plain HTTP'
    : sec === 'prism' ? 'Internal Prism page'
    : 'Connection info unavailable';
}

async function updateStar(tab) {
  const btn = $('star');
  if (!tab || !tab.url || !(tab.url.startsWith('http'))) { btn.classList.remove('bookmarked'); return; }
  const marked = await S.isBookmarked(tab.url);
  btn.classList.toggle('bookmarked', !!marked);
}

omni.addEventListener('focus', () => {
  omni.select();
  if (state.active) suggestFor(omni.value.trim());
});

omni.addEventListener('input', () => {
  clearTimeout(omni._t);
  omni._t = setTimeout(() => suggestFor(omni.value.trim()), 110);
});

omni.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    // omniSel is only >= 0 after an explicit arrow-key choice, so typing a
    // query and pressing Enter searches for exactly what was typed.
    const pick = omniSel >= 0 ? omniRows[omniSel] : null;
    const input = pick ? pick.input : omni.value.trim();
    hideDropdown();
    omni.blur();
    if (input && state.active) S.navigate(state.active.id, input);
  } else if (ev.key === 'ArrowDown') {
    ev.preventDefault(); moveSel(1);
  } else if (ev.key === 'ArrowUp') {
    ev.preventDefault(); moveSel(-1);
  } else if (ev.key === 'Escape') {
    hideDropdown();
    omni.blur();
    setOmniboxFromState(state.active);
  }
});

function moveSel(d) {
  if (!omniRows.length) return;
  omniSel = (omniSel + d + omniRows.length) % omniRows.length;
  renderDropdown();
}

async function suggestFor(text) {
  if (!text) { hideDropdown(); return; }
  omniRows = await S.suggest(text);
  // Do not preselect: preselecting made Enter jump to a suggestion instead of
  // searching the typed text. Arrow keys still work.
  omniSel = -1;
  renderDropdown();
}

function renderDropdown() {
  const dd = $('omni-dropdown');
  if (!omniRows.length) { dd.style.display = 'none'; syncExtentNow(); return; }
  dd.textContent = '';
  omniRows.forEach((r, i) => {
    const row = el('div', 'omni-row' + (i === omniSel ? ' sel' : ''));
    const ic = el('span', 'ic');
    ic.innerHTML = r.type === 'history' ? ICONS.clock : r.type === 'url' ? ICONS.globe
      : r.type === 'prism' ? ICONS.search : ICONS.search;
    row.appendChild(ic);
    const l = el('span', 'l'); l.textContent = r.label; row.appendChild(l);
    if (r.sub) { const s = el('span', 's'); s.textContent = r.sub; row.appendChild(s); }
    row.addEventListener('click', () => {
      hideDropdown(); omni.blur();
      if (state.active) S.navigate(state.active.id, r.input);
    });
    dd.appendChild(row);
  });
  dd.style.display = '';
  alignOmniDropdown();
  syncExtentNow();
}

function hideDropdown() {
  const dd = $('omni-dropdown');
  if (dd && dd.style.display !== 'none') {
    dd.style.display = 'none';
    syncExtentNow();
  } else if (dd) {
    dd.style.display = 'none';
  }
  omniRows = []; omniSel = -1;
}

// ---------- shell extent ----------
// The shell is a native view stacked ABOVE the page, so its bounds must grow
// to cover anything that hangs below the chrome (dropdown, menus, findbar,
// toasts) — otherwise the page hides them. Poll once per frame and report the
// bottom edge; main applies it as the shell view's height. Overlays are all
// top-anchored so a single rectangle from y=0 always covers them.
const OVERLAY_IDS = ['omni-dropdown', 'menu-panel', 'shield-pop', 'ext-pop', 'theme-pop', 'findbar', 'load-progress', 'toasts', 'status-bubble'];
let lastExtent = -1;
function computeNeed() {
  try {
    const top = $('chrome-top');
    let need = top ? Math.round(top.getBoundingClientRect().height) : 0;
    if (need > 0 && !document.body.classList.contains('html-fullscreen')) {
      for (const id of OVERLAY_IDS) {
        const e = $(id);
        if (!e) continue;
        // Hidden via inline display:none -> skipped. #toasts has no inline
        // display, so rely on its measured height (0 when empty).
        if (e.style.display === 'none') continue;
        if (e.id === 'toasts' && e.childElementCount === 0) continue;
        const r = e.getBoundingClientRect();
        if (r.height > 0 && r.bottom > 0) need = Math.max(need, Math.ceil(r.bottom));
      }
    }
    return need;
  } catch (_) { return 0; }
}
// Immediate report: call right after any overlay visibility change so the
// native shell view grows in the same task — no one-frame flash where the
// page paints over the dropdown/menu/shield popup.
function syncExtentNow() {
  try {
    const need = computeNeed();
    if (need > 0 && need !== lastExtent) {
      lastExtent = need;
      S.reportShellExtent(WID, need);
    }
    // Keep the dropdown glued to the omnibox after resizes/zoom.
    alignOmniDropdown();
  } catch (_) { /* never let the reporter kill the shell */ }
  if (hasOpenOverlay()) startExtentLoop();
}
function hasOpenOverlay() {
  for (const id of OVERLAY_IDS) {
    const e = $(id);
    // #toasts has no inline display, so `style.display !== 'none'` was always
    // true for it and this returned true permanently, keeping the rAF extent
    // loop running for the life of the window. Test emptiness for it instead.
    if (id === 'toasts') { if (e && e.childElementCount) return true; continue; }
    if (e && e.style.display !== 'none') return true;
  }
  return false;
}
function reportExtent() {
  try {
    const need = computeNeed();
    if (need > 0 && need !== lastExtent) {
      lastExtent = need;
      S.reportShellExtent(WID, need);
    }
  } catch (_) { /* never let the reporter kill the shell */ }
  // Measure on consecutive frames only while an overlay is actually open, then
  // stop. The ResizeObserver/MutationObserver above and the 150ms interval
  // below already catch overlay show/hide and chrome resizes, so an always-on
  // loop just forced a synchronous layout 60 times a second for no benefit.
  extentRaf = hasOpenOverlay() ? requestAnimationFrame(reportExtent) : 0;
}
let extentRaf = 0;
function startExtentLoop() {
  if (!extentRaf) extentRaf = requestAnimationFrame(reportExtent);
}
startExtentLoop();
// rAF can be throttled/paused in a backgrounded WebContentsView (seen in the
// wild: overlay opens but no frame fires, so the page paints over the menu).
// Belt-and-braces: interval fallback + observers so ANY overlay geometry
// change grows the native shell view even when frames don't run.
setInterval(syncExtentNow, 150);
if (typeof ResizeObserver !== 'undefined') {
  try {
    const ro = new ResizeObserver(() => syncExtentNow());
    for (const id of OVERLAY_IDS) {
      const e = $(id);
      if (e) ro.observe(e);
    }
  } catch (_) {}
}
if (typeof MutationObserver !== 'undefined') {
  try {
    const mo = new MutationObserver(() => syncExtentNow());
    for (const id of OVERLAY_IDS) {
      const e = $(id);
      if (e) mo.observe(e, { attributes: true, attributeFilter: ['style', 'class'], childList: true, subtree: true });
    }
  } catch (_) {}
}

// Any chrome change (bookmarks bar, window resize, zoom) must be re-reported.
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => { syncChromeHeight(); syncExtentNow(); }).observe($('chrome-top'));
}
window.addEventListener('resize', () => { syncChromeHeight(); alignOmniDropdown(); syncExtentNow(); });
document.addEventListener('click', (ev) => {
  let changed = false;
  if (!$('omni-dropdown').contains(ev.target) && ev.target !== omni && $('omni-dropdown').style.display !== 'none') { hideDropdown(); changed = true; }
  if (!$('menu-panel').contains(ev.target) && ev.target.closest && !ev.target.closest('#menu-btn') && $('menu-panel').style.display !== 'none') { $('menu-panel').style.display = 'none'; changed = true; }
  if (!$('ext-pop').contains(ev.target) && ev.target.closest && !ev.target.closest('#ext-btn') && $('ext-pop').style.display !== 'none') { $('ext-pop').style.display = 'none'; changed = true; }
  if (!$('theme-pop').contains(ev.target) && ev.target.closest && !ev.target.closest('#theme-btn') && $('theme-pop').style.display !== 'none') { $('theme-pop').style.display = 'none'; changed = true; }
  if (!$('shield-pop').contains(ev.target) && ev.target.closest && !ev.target.closest('#shield') && $('shield-pop').style.display !== 'none') { $('shield-pop').style.display = 'none'; changed = true; }
  if (changed) syncExtentNow();
});

// ---------- toolbar buttons ----------
$('nav-back').addEventListener('click', () => S.back(WID));
$('nav-forward').addEventListener('click', () => S.forward(WID));
$('nav-reload').addEventListener('click', () => {
  if (state.active && state.active.loading) S.stop(WID); else S.reload(WID);
});
// Home navigates the CURRENT tab rather than opening a new one, which is what
// every other browser does. prism://newtab is this app's start page.
$('nav-home').addEventListener('click', () => {
  if (state.active) S.navigate(state.active.id, 'prism://newtab');
});
$('tab-new').addEventListener('click', () => S.newTab(WID));
$('win-min').addEventListener('click', () => S.minimize());
$('win-max').addEventListener('click', () => S.maximize());
$('win-close').addEventListener('click', () => S.close());
$('star').addEventListener('click', async () => {
  const t = state.active;
  if (!t || !t.url || !t.url.startsWith('http')) return;
  await S.toggleBookmark(t.url, t.title, t.favicon);
  updateStar(t);
  renderBookmarksBar();
});
$('shield').addEventListener('click', () => {
  const pop = $('shield-pop');
  const show = pop.style.display === 'none';
  $('menu-panel').style.display = 'none';
  $('ext-pop').style.display = 'none';
  pop.style.display = show ? '' : 'none';
  if (show) refreshShieldPop();
  syncExtentNow();
});
// ---------- extensions dropdown (the toolbar "puzzle piece") ----------
// Lists what is installed and opens each one's management page. Electron's
// extension support has no toolbar-popup surface, so an extension whose UI is
// only a popup cannot be shown here; we point at its management page instead.
const extPop = $('ext-pop');
const extList = $('ext-list');
let extItems = [];

function renderExtList() {
  extList.textContent = '';
  const badge = $('ext-count');
  badge.style.display = extItems.length ? '' : 'none';
  badge.textContent = String(extItems.length);
  if (!extItems.length) {
    const empty = el('div', 'pop-note');
    empty.textContent = 'No extensions installed yet.';
    extList.appendChild(empty);
    return;
  }
  for (const x of extItems) {
    const row = el('button', 'ext-row');
    const dot = el('span', 'ext-dot' + (x.active ? '' : ' off'));
    const nm = el('span', 'ext-name');
    nm.textContent = x.name || x.id;
    nm.title = x.name || x.id;
    row.append(dot, nm);
    row.title = (x.name || x.id) + '  -  click to open its page';
    row.addEventListener('click', () => {
      extPop.style.display = 'none';
      S.newTab(WID, 'prism://extensions');
    });
    extList.appendChild(row);
  }
}

async function refreshExtList() {
  try {
    const list = await S.extensionsList();
    extItems = Array.isArray(list) ? list : [];
  } catch (_) { extItems = []; }
  renderExtList();
}

$('ext-btn').addEventListener('click', () => {
  const show = extPop.style.display === 'none';
  // Only one toolbar popup at a time.
  $('menu-panel').style.display = 'none';
  $('shield-pop').style.display = 'none';
  extPop.style.display = show ? '' : 'none';
  if (show) refreshExtList();
  syncExtentNow();
});
$('ext-store-chrome').addEventListener('click', () => { extPop.style.display = 'none'; S.extensionsOpenPage('chrome'); syncExtentNow(); });
$('ext-store-edge').addEventListener('click', () => { extPop.style.display = 'none'; S.extensionsOpenPage('edge'); syncExtentNow(); });
$('ext-manage').addEventListener('click', () => { extPop.style.display = 'none'; S.newTab(WID, 'prism://extensions'); syncExtentNow(); });
S.onExtensionsChanged(() => refreshExtList());
// Prime the count/badge at boot rather than waiting for the first popup open,
// so the toolbar button reflects reality from the first frame.
refreshExtList();

$('menu-btn').addEventListener('click', () => {
  const panel = $('menu-panel');
  const show = panel.style.display === 'none';
  $('shield-pop').style.display = 'none';
  panel.style.display = show ? '' : 'none';
  $('mi-bookmarksbar').textContent = state.bookmarksBar ? 'Hide bookmarks bar' : 'Show bookmarks bar';
  syncExtentNow();
});

$('shield-global').addEventListener('change', async (ev) => {
  const on = ev.target.checked;
  const p = settingsPatch();
  p.privacy.adblock.enabled = on;
  await S.setSettings(p);
  refreshShieldPop();
});
$('shield-site').addEventListener('change', async (ev) => {
  const host = $('shield-site').dataset.host;
  if (!host) return;
  const allow = !ev.target.checked; // checkbox "on" = protection on
  const p = settingsPatch();
  p.privacy.adblock.perSite = p.privacy.adblock.perSite || {};
  if (allow) p.privacy.adblock.perSite[host] = 'allow';
  else delete p.privacy.adblock.perSite[host];
  await S.setSettings(p);
  refreshShieldPop();
});
$('open-privacy').addEventListener('click', () => { S.newTab(WID, 'prism://privacy'); });

function settingsPatch() {
  return JSON.parse(JSON.stringify({ privacy: state.settings.privacy }));
}

async function refreshShieldPop() {
  const t = state.active;
  $('shield-global').checked = state.adblockEnabled;
  let host = '';
  try { host = t && t.url && t.url.startsWith('http') ? new URL(t.url).hostname : ''; } catch (_) {}
  const perSite = (state.settings && state.settings.privacy.adblock.perSite) || {};
  const siteAllowed = host && perSite[host] === 'allow';
  $('shield-site-row').style.display = host ? '' : 'none';
  if (host) {
    $('shield-site-label').textContent = 'Protection on ' + host;
    $('shield-site').checked = !siteAllowed;
    $('shield-site').dataset.host = host;
  }
  const counts = state.adblockEnabled ? 'Blocked on this tab: ' + ((t && t.adCount) || 0) : 'Ad blocking is off.';
  $('shield-note').textContent = counts;
}

// ---------- menu panel ----------
$('menu-panel').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('.mi');
  if (!btn) return;
  $('menu-panel').style.display = 'none';
  syncExtentNow();
  const act = btn.dataset.act;
  const pages = { history: 'history', bookmarks: 'bookmarks', downloads: 'downloads', passwords: 'passwords', extensions: 'extensions', settings: 'settings', privacy: 'privacy' };
  if (act === 'new-tab') S.newTab(WID);
  else if (act === 'private') S.newPrivateWindow();
  else if (act === 'search-home') S.newTab(WID, 'prism://search');
  else if (act === 'update-lists') { toast('Updating protection lists...', 'Updating ad-block and malware feeds in the background.'); }
  else if (act === 'check-update') {
    const pending = toast('Checking for updates...', 'Checking for a newer version or bug-fix build.');
    try {
      const st = await S.checkForUpdates();
      if (st && st.error) toast('Update check failed', st.error, true);
      else if (st && st.downloaded) {
        pendingUpdate = { version: st.version, downloaded: true, buildRefresh: !!st.buildRefresh };
        showUpdateButton(pendingUpdate);
        const readyMessage = st.buildRefresh
          ? 'The latest same-version bug-fix build is ready to install.'
          : 'Version ' + st.version + ' is ready to install.';
        toast('Update ready', readyMessage, false, 'Update now', () => S.installUpdate());
      }
      else if (st && st.available) {
        pendingUpdate = { version: st.version, downloaded: false, buildRefresh: !!st.buildRefresh };
        showUpdateButton(pendingUpdate);
        const updateLabel = st.buildRefresh ? 'the latest same-version bug-fix build' : 'version ' + st.version;
        toast('Update downloading', 'Downloading ' + updateLabel + ' - ' + (st.percent || 0) + '%');
      }
      else toast('You are up to date', 'Prism ' + (st && st.version) + ' is the latest version.');
    } catch (e) {
      toast('Update check failed', (e && e.message) || String(e), true);
    } finally {
      pending(); // the answer replaces the progress notice, it does not stack on it
    }
  }
  else if (act === 'bookmarks-bar') S.bookmarksBarToggle();
  else if (act === 'about') S.newTab(WID, 'prism://settings#about');
  else if (pages[act]) S.newTab(WID, 'prism://' + pages[act]);
});

// ---------- bookmarks bar ----------
function renderBookmarksBar() {
  const bar = $('bookmarksbar');
  bar.style.display = state.bookmarksBar ? '' : 'none';
  // The bar is in flow, so showing/hiding it moves the page edge.
  // Do NOT rely on rAF (throttled in WebContentsView): measure synchronously
  // (forces reflow) and again on timers to guarantee the main process moves
  // the page below the bar instead of overlapping it.
  syncChromeHeight(); syncExtentNow();
  setTimeout(() => { syncChromeHeight(); syncExtentNow(); }, 50);
  requestAnimationFrame(() => { syncChromeHeight(); syncExtentNow(); });
  bar.textContent = '';
  for (const b of (state.tabs._bookmarks || [])) {
    const chip = el('div', 'bm');
    chip.title = b.title + '\n' + b.url;
    if (b.favicon) { const img = el('img'); img.src = b.favicon; chip.appendChild(img); }
    const s = el('span'); s.textContent = b.title || b.url; chip.appendChild(s);
    chip.addEventListener('click', () => { if (state.active) S.navigate(state.active.id, b.url); });
    chip.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      if (confirm('Remove bookmark "' + (b.title || b.url) + '"?')) {
        (async () => {
          await S.removeBookmark(b.id);
          state.tabs._bookmarks = (state.tabs._bookmarks || []).filter((x) => x.id !== b.id);
          renderBookmarksBar();
        })();
      }
    });
    bar.appendChild(chip);
  }
  if (!(state.tabs._bookmarks || []).length) {
    const hint = el('span');
    hint.style.cssText = 'color:var(--text-dim);font-size:11px;padding:0 6px;';
    hint.textContent = 'Use the star in the address bar to bookmark sites. Toggle this bar with Ctrl+Shift+B.';
    bar.appendChild(hint);
  }
}

// ---------- find bar ----------
let findVisible = false;
function openFind() {
  findVisible = true;
  $('findbar').style.display = '';
  $('find-input').focus();
  $('find-input').select();
  syncExtentNow();
}
function closeFind() {
  findVisible = false;
  $('findbar').style.display = 'none';
  $('find-count').textContent = '';
  S.findStop(WID);
  syncExtentNow();
}
$('find-close').addEventListener('click', closeFind);
$('find-next').addEventListener('click', () => runFind(true));
$('find-prev').addEventListener('click', () => runFind(false, false));
$('find-input').addEventListener('input', () => { if ($('find-input').value) runFind(true, true); else $('find-count').textContent = ''; });
$('find-input').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') runFind(!ev.shiftKey, false);
  if (ev.key === 'Escape') closeFind();
});
function runFind(forward, findNext) {
  const text = $('find-input').value;
  if (!text) return;
  S.find(WID, text, { forward: forward !== false, findNext: !!findNext });
}

// ---------- toasts ----------
// Returns a dismiss() handle so a caller can retire an in-progress toast when
// its result arrives, instead of leaving "Checking..." stacked above the answer.
function toast(title, body, danger, actionLabel, action) {
  const t = el('div', 'toast' + (danger ? ' danger' : ''));
  let gone = false;
  const dismiss = () => {
    if (gone) return;
    gone = true;
    t.remove();
    syncExtentNow();
  };
  const tt = el('div', 't-title'); tt.textContent = title; t.appendChild(tt);
  if (body) { const b = el('div'); b.textContent = body; t.appendChild(b); }
  if (actionLabel) {
    const btn = el('button', 't-action'); btn.textContent = actionLabel;
    btn.addEventListener('click', () => { action && action(); dismiss(); });
    t.appendChild(btn);
  }
  // Explicit close control. The 12s timer is a fallback, not the only way out:
  // an update prompt the user is still reading must not vanish under them.
  const x = el('button', 't-close');
  x.title = 'Dismiss';
  x.setAttribute('aria-label', 'Dismiss notification');
  x.innerHTML = ICONS.close;
  x.addEventListener('click', dismiss);
  t.appendChild(x);
  $('toasts').appendChild(t);
  syncExtentNow();
  setTimeout(dismiss, 12000);
  return dismiss;
}

// ---------- theme ----------
function applyTheme() {
  let theme = state.theme || 'dark';
  if (theme === 'system') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  if (window.PrismTheme) {
    const appearance = Object.assign({}, state.appearance || {}, { theme, visualTheme: state.appearance && state.appearance.visualTheme });
    window.PrismTheme.apply(document.documentElement, appearance);
  } else document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.motionPreference =
    (state.appearance && state.appearance.accessibility && state.appearance.accessibility.reducedMotion) || 'system';
}

// ---------- quick theme controls ----------
function syncThemeControls() {
  const appearance = state.appearance || {};
  const visual = appearance.visualTheme || { hue: 215, gradient: 'aurora', motion: 'none' };
  if ($('shell-hue')) $('shell-hue').value = Number.isFinite(Number(visual.hue)) ? visual.hue : 215;
  if ($('shell-gradient')) $('shell-gradient').value = visual.gradient || 'aurora';
  if ($('shell-motion')) $('shell-motion').value = visual.motion || 'none';
}
function applyThemePatch(patch) {
  const appearance = Object.assign({}, state.appearance || {});
  if (patch.visualTheme) appearance.visualTheme = Object.assign({}, appearance.visualTheme || {}, patch.visualTheme);
  Object.assign(appearance, patch);
  state.appearance = appearance;
  state.theme = appearance.theme || state.theme;
  applyTheme();
  // Update immediately but coalesce the encrypted persistence write while a
  // slider is being dragged. Revisions prevent an older in-flight IPC response
  // or its settings broadcast from replacing a more recent control value.
  const revision = ++themeSaveRevision;
  themeSavePending = true;
  clearTimeout(themeSaveTimer);
  themeSaveTimer = setTimeout(async () => {
    const savedAppearance = state.appearance;
    themeSaveTimer = null;
    try {
      const latest = await S.setSettings({ appearance: savedAppearance });
      if (revision === themeSaveRevision && latest && latest.appearance) {
        themeSavePending = false;
        state.appearance = latest.appearance;
        state.theme = latest.appearance.theme || state.theme;
        applyTheme();
        syncThemeControls();
      }
    } catch (error) {
      if (revision === themeSaveRevision) themeSavePending = false;
      toast('Could not save appearance', (error && error.message) || String(error), true);
    }
  }, 120);
  syncThemeControls();
}
let themeSaveTimer = null;
let themeSaveRevision = 0;
let themeSavePending = false;
const themePop = $('theme-pop');
$('theme-btn').addEventListener('click', () => {
  const show = themePop.style.display === 'none';
  $('menu-panel').style.display = 'none'; $('ext-pop').style.display = 'none'; $('shield-pop').style.display = 'none';
  if ($('omni-dropdown').style.display !== 'none') hideDropdown();
  themePop.style.display = show ? '' : 'none';
  if (show) syncThemeControls();
  syncExtentNow();
});
themePop.querySelectorAll('[data-base-theme]').forEach((button) => button.addEventListener('click', () => applyThemePatch({ theme: button.dataset.baseTheme })));
$('shell-hue').addEventListener('input', () => applyThemePatch({ visualTheme: { hue: Number($('shell-hue').value) } }));
$('shell-gradient').addEventListener('change', () => applyThemePatch({ visualTheme: { gradient: $('shell-gradient').value } }));
$('shell-motion').addEventListener('change', () => applyThemePatch({ visualTheme: { motion: $('shell-motion').value } }));
$('theme-random').addEventListener('click', () => {
  const visual = (state.appearance && state.appearance.visualTheme) || {};
  applyThemePatch({ visualTheme: window.PrismTheme.random(visual) });
});
$('theme-accessibility').addEventListener('click', () => { themePop.style.display = 'none'; S.newTab(WID, 'prism://settings#accessibility'); syncExtentNow(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (state.theme === 'system') applyTheme(); });

// ---------- private / incognito chrome ----------
// Driven by the `private` flag the main process puts on every snapshot. It is a
// property of the WINDOW, not the tab, so it is set once per snapshot rather
// than per tab: recolouring, the pill and the window title all key off it.
function applyPrivate() {
  const priv = !!state.private;
  document.body.classList.toggle('private', priv);
  const badge = $('priv-badge');
  if (badge) badge.style.display = priv ? '' : 'none';
  // With frame:false the native title is what Windows shows in the taskbar and
  // Alt+Tab, so this is the only thing that marks the window outside Prism.
  document.title = priv ? 'Incognito — Prism Browser' : 'Prism Browser';
  if (priv && !state.privateAnnounced) {
    state.privateAnnounced = true;
    toast('Incognito', 'Nothing from this window is saved to your device. Cookies, history and site data are cleared when you close it.', null);
  }
}

// ---------- events from main ----------
S.onTabs((data) => {
  state.tabs = data.tabs;
  state.active = data.active;
  state.bookmarksBar = !!data.bookmarksBar;
  state.private = !!data.private;
  state.tabs._bookmarks = data.bookmarks || [];
  applyPrivate();
  renderTabs();
  renderBookmarksBar();
  setOmniboxFromState(data.active);
  $('nav-back').disabled = !data.active || !data.active.canBack;
  $('nav-forward').disabled = !data.active || !data.active.canForward;
  $('load-progress').style.display = data.active && data.active.loading ? '' : 'none';
  syncExtentNow();
});

S.onOmnibox((data) => {
  if (!state.active || data.tabId !== state.active.id) return;
  Object.assign(state.active, { url: data.url, security: data.security, loading: data.loading, canBack: data.canBack, canForward: data.canForward });
  setOmniboxFromState(state.active);
  $('nav-back').disabled = !data.canBack;
  $('nav-forward').disabled = !data.canForward;
  $('load-progress').style.display = data.loading ? '' : 'none';
  syncExtentNow();
});

S.onAdblock(({ tabId, count }) => {
  const t = state.tabs.find((x) => x.id === tabId);
  if (t) t.adCount = count;
  if (state.active && state.active.id === tabId) {
    state.active.adCount = count;
    updateShieldBadge();
    if ($('shield-pop').style.display !== 'none') refreshShieldPop();
  }
});

function updateShieldBadge() {
  const count = (state.active && state.active.adCount) || 0;
  const badge = $('shield-count');
  badge.style.display = count ? '' : 'none';
  badge.textContent = String(count);
  $('shield').classList.toggle('active', state.adblockEnabled);
}

S.onTargetUrl(({ url }) => {
  const bubble = $('status-bubble');
  if (url) { bubble.textContent = url; bubble.style.display = ''; }
  else bubble.style.display = 'none';
  syncExtentNow();
});

S.onFindResult(({ total, active }) => {
  $('find-count').textContent = total ? (active + ' / ' + total) : '0 / 0';
});

S.onHtmlFullscreen((on) => document.body.classList.toggle('html-fullscreen', !!on));
S.onChromeMode((mode) => document.body.classList.toggle('html-fullscreen', mode === 'fullscreen'));

// Clicking the page closes floating shell overlays (the click never reaches
// this document, so main tells us the page took focus).
S.onPageFocused(() => {
  let changed = false;
  if ($('omni-dropdown').style.display !== 'none') { hideDropdown(); changed = true; }
  if ($('menu-panel').style.display !== 'none') { $('menu-panel').style.display = 'none'; changed = true; }
  if ($('shield-pop').style.display !== 'none') { $('shield-pop').style.display = 'none'; changed = true; }
  if ($('ext-pop').style.display !== 'none') { $('ext-pop').style.display = 'none'; changed = true; }
  if ($('theme-pop').style.display !== 'none') { $('theme-pop').style.display = 'none'; changed = true; }
  if (changed) syncExtentNow();
});

S.onCmd((cmd) => {
  if (cmd === 'focus-omnibox') { omni.focus(); omni.select(); }
  else if (cmd === 'open-find') openFind();
  else if (cmd === 'toggle-bookmarks-bar') S.bookmarksBarToggle();
});

// Pop-ups are denied in the main process, so report them here. A blocked
// window that leaves no trace at all is indistinguishable from a page that
// simply failed to work.
S.onPopupBlocked(({ url }) => {
  let host = '';
  try { host = new URL(url).hostname; } catch (_) {}
  toast('Pop-up blocked', host ? 'Prism blocked a pop-up from ' + host : 'Prism blocked a pop-up.');
});

S.onUpdateDownloaded((d) => {
  pendingUpdate = { version: d && d.version, downloaded: true, buildRefresh: !!(d && d.buildRefresh) };
  showUpdateButton(pendingUpdate);
  const buildLabel = pendingUpdate.buildRefresh ? 'a same-version bug-fix build' : 'Prism ' + (d && d.version ? d.version : '');
  toast('Update ready to install',
    buildLabel + ' has been downloaded.',
    false, 'Update now', () => S.installUpdate());
});
S.onUpdateAvailable((d) => {
  pendingUpdate = { version: d && d.version, downloaded: !!(d && d.downloaded), buildRefresh: !!(d && d.buildRefresh) };
  showUpdateButton(pendingUpdate);
  const updateLabel = pendingUpdate.buildRefresh ? 'a same-version bug-fix build' : 'Prism ' + (d && d.version);
  if (pendingUpdate.downloaded) {
    toast('Update ready to install',
      updateLabel + ' is ready.',
      false, 'Update now', () => S.installUpdate());
  } else {
    toast('Update available', 'Downloading ' + updateLabel + '...');
  }
});

// ---------- in-app update button ----------
// Persistent toolbar affordance: appears automatically when the main process
// finds a newer version or a changed same-version build (startup check + hourly + "Check for updates").
// Clicking it re-checks, then installs: the installer runs silent (/S) and
// the app quits so files can be replaced — a one-click self-update.
let pendingUpdate = null;
function showUpdateButton(info) {
  const btn = $('update-btn');
  if (!btn) return;
  btn.style.display = '';
  btn.title = info && info.buildRefresh
    ? 'Install the latest bug-fix build (same version)'
    : info && info.version
      ? 'Update to ' + info.version + ' (click to update now)'
      : 'Update available (click to update now)';
  syncExtentNow();
}
$('update-btn').addEventListener('click', async () => {
  if (pendingUpdate && pendingUpdate.downloaded) { S.installUpdate(); return; }
  const pending = toast('Checking for updates...', 'Checking for a newer version or bug-fix build.');
  try {
    const st = await S.checkForUpdates();
    if (st && st.downloaded) {
      pendingUpdate = { version: st.version, downloaded: true, buildRefresh: !!st.buildRefresh };
      showUpdateButton(pendingUpdate);
      toast('Update ready to install', st.buildRefresh ? 'The latest bug-fix build is ready.' : 'Prism ' + (st.version || '') + ' is ready.',
        false, 'Update now', () => S.installUpdate());
    } else if (st && st.available) {
      pendingUpdate = { version: st.version, downloaded: false, buildRefresh: !!st.buildRefresh };
      showUpdateButton(pendingUpdate);
      toast('Update available', st.buildRefresh ? 'Downloading the latest bug-fix build...' : 'Downloading version ' + (st.version || '') + '...');
    } else if (st && st.error) {
      toast('Update check failed', st.error, true);
    } else {
      toast('You are up to date', 'Prism ' + (st && st.version) + ' is the latest version.');
    }
  } catch (e) {
    toast('Update check failed', (e && e.message) || String(e), true);
  } finally {
    pending();
  }
});

S.onSettingsChanged((s) => {
  const prevBar = state.bookmarksBar;
  state.settings = s;
  state.adblockEnabled = s.privacy.adblock.enabled;
  // Do not let a delayed snapshot overwrite a value still being coalesced.
  if (!themeSavePending) {
    state.theme = s.appearance.theme;
    state.appearance = s.appearance;
  }
  syncThemeControls();
  // The bar's visibility is chrome height, so keep it in sync and re-render:
  // renderBookmarksBar re-reports the measured height to the main process.
  state.bookmarksBar = !!(s.appearance && s.appearance.bookmarksBar);
  applyTheme();
  updateShieldBadge();
  if (prevBar !== state.bookmarksBar) renderBookmarksBar();
  if ($('shield-pop').style.display !== 'none') refreshShieldPop();
});

S.onDownloadThreat(({ filename, threat }) => {
  toast('Download blocked', filename + '\n' + threat, true);
});

window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    if (findVisible) closeFind();
  }
});
window.addEventListener('dblclick', (ev) => {
  if (ev.target.id === 'drag-space' || ev.target.id === 'tabstrip') S.maximize();
});

// ---------- boot ----------
(async function boot() {
  state.settings = await S.getSettings();
  state.adblockEnabled = state.settings.privacy.adblock.enabled;
  state.theme = state.settings.appearance.theme;
  state.appearance = state.settings.appearance;
  applyTheme();
  syncThemeControls();
  S.init(WID);
})();
