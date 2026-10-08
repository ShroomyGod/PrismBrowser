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
const enteringTabIds = new Set();
function renderTabs() {
  const wrap = $('tabs');
  const existing = new Map(Array.from(wrap.children)
    .filter((node) => node.classList.contains('tab') && !node.classList.contains('tab-leaving'))
    .map((node) => [node.dataset.tabId, node]));
  const currentIds = new Set(state.tabs.map((tab) => tab.id));
  const animationTheme = document.documentElement.dataset.animationTheme || 'fluent';
  const reduceMotion = animationTheme === 'off' ||
    document.documentElement.dataset.reduceMotion === 'reduce' ||
    (document.documentElement.dataset.reduceMotion === 'system' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const animateTabs = animationTheme !== 'off' && !reduceMotion;
  const enteringDuration = { fluent: 320, spring: 390, arcade: 250, minimal: 220 }[animationTheme] || 320;
  const leavingDuration = { fluent: 260, spring: 330, arcade: 200, minimal: 180 }[animationTheme] || 260;
  const leaving = animateTabs
    ? Array.from(existing.values()).filter((node) => !currentIds.has(node.dataset.tabId))
    : [];
  wrap.textContent = '';
  for (const t of state.tabs) {
    const div = el('div', 'tab' + (state.active && t.id === state.active.id ? ' active' : ''));
    div.dataset.tabId = t.id;
    if (animateTabs && !existing.has(t.id) && !enteringTabIds.has(t.id)) {
      enteringTabIds.add(t.id);
      const duration = enteringDuration + 40;
      setTimeout(() => {
        enteringTabIds.delete(t.id);
        const current = wrap.querySelector('.tab[data-tab-id="' + t.id + '"]');
        if (current) current.classList.remove('tab-entering');
      }, duration);
    }
    if (animateTabs && enteringTabIds.has(t.id)) div.classList.add('tab-entering');
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
  for (const node of leaving) {
    node.classList.add('tab-leaving');
    wrap.appendChild(node);
    setTimeout(() => node.remove(), leavingDuration);
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

// ---------- Prism Vision overlay ----------
let visionTabId = null;
let visionImage = new Image();
let visionDragging = false;
let visionStart = null;
let visionRect = null;
let visionBusy = false;
let visionOverlayActive = false;

function setVisionStatus(message) { $('vision-overlay-status').textContent = message || ''; }
function closeVisionOverlay() {
  visionTabId = null;
  visionDragging = false;
  visionStart = null;
  visionRect = null;
  $('prism-vision-overlay').hidden = true;
  $('vision-overlay-image').removeAttribute('src');
  $('vision-overlay-selection').hidden = true;
  if (visionOverlayActive) S.setVisionOverlay(WID, false);
  visionOverlayActive = false;
  syncExtentNow();
}

async function openVisionOverlay() {
  if (state.settings && state.settings.ai && state.settings.ai.enabled === false) {
    return toast('Local AI is off', 'Turn it back on in Settings to use Prism Vision.');
  }
  if (!state.active || !/^https?:/i.test(state.active.url || '')) {
    return toast('Prism Vision', 'Open a website first, then select anything you want to explore.');
  }
  const summary = $('vision-overlay-summary');
  summary.textContent = 'Capturing the visible page…';
  $('vision-overlay-source').textContent = state.active.title || state.active.url;
  $('vision-overlay-describe').disabled = true;
  $('vision-overlay-read').disabled = true;
  $('prism-vision-overlay').hidden = false;
  visionOverlayActive = false;
  syncExtentNow();
  try {
    const result = await S.aiOpenVision(WID, state.active.id);
    if (!result || result.error) throw new Error((result && result.error) || 'Could not capture this page.');
  } catch (error) {
    closeVisionOverlay();
    toast('Prism Vision unavailable', error.message || 'Could not capture this page.', true);
  }
}

S.onVisionPageFocused(() => { if (!$('prism-vision-overlay').hidden) closeVisionOverlay(); });
S.onVisionOverlay(({ open, capture }) => {
  if (!open) { closeVisionOverlay(); return; }
  visionTabId = capture && capture.tabId;
  if (!capture || !capture.image || !visionTabId || !state.active || state.active.id !== visionTabId) {
    setVisionStatus('Screenshot unavailable');
    $('vision-overlay-summary').textContent = 'This page could not be captured. Try another page.';
    return;
  }
  visionOverlayActive = true;
  $('vision-overlay-source').textContent = capture.title || capture.url || 'Current page';
  const image = $('vision-overlay-image');
  image.onload = () => {
    visionRect = null;
    $('vision-overlay-selection').hidden = true;
    $('vision-overlay-summary').textContent = 'Drag across the page to select an area. Prism will describe it using on-device AI.';
    setVisionStatus('Drag to select');
    $('vision-overlay-describe').disabled = true;
    $('vision-overlay-read').disabled = false;
  };
  image.src = capture.image;
});
S.watchAi();
S.onVisionProgress((event) => {
  if (event && event.stage === 'loading') setVisionStatus('Loading local model…');
  else if (event && event.stage === 'running') setVisionStatus('Analysing on this device…');
  else if (event && event.stage === 'crashed') setVisionStatus(event.error || 'Local AI stopped');
});

function visionPoint(event) {
  const rect = $('vision-overlay-image').getBoundingClientRect();
  return { x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)) + rect.left - $('vision-overlay-stage').getBoundingClientRect().left,
    y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)) + rect.top - $('vision-overlay-stage').getBoundingClientRect().top };
}
function paintVisionSelection() {
  const frame = $('vision-overlay-selection');
  if (!visionRect) { frame.hidden = true; $('vision-overlay-describe').disabled = true; return; }
  frame.hidden = false;
  frame.style.left = visionRect.x + 'px'; frame.style.top = visionRect.y + 'px';
  frame.style.width = visionRect.width + 'px'; frame.style.height = visionRect.height + 'px';
  $('vision-overlay-describe').disabled = visionBusy || visionRect.width < 12 || visionRect.height < 12;
}

async function visionSelectedImage() {
  const img = $('vision-overlay-image');
  if (!img.naturalWidth || !visionRect) return '';
  const imageBox = img.getBoundingClientRect();
  const stageBox = $('vision-overlay-stage').getBoundingClientRect();
  const x = visionRect.x - (imageBox.left - stageBox.left);
  const y = visionRect.y - (imageBox.top - stageBox.top);
  const sx = img.naturalWidth / imageBox.width, sy = img.naturalHeight / imageBox.height;
  const rect = { x: x * sx, y: y * sy, width: visionRect.width * sx, height: visionRect.height * sy };
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect.width)); canvas.height = Math.max(1, Math.round(rect.height));
  canvas.getContext('2d').drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

async function analyseVisionSelection(task) {
  if (!visionRect || !visionTabId || visionBusy) return;
  visionBusy = true;
  $('vision-overlay-describe').disabled = true;
  $('vision-overlay-read').disabled = true;
  setVisionStatus('Analysing on this device…');
  $('vision-overlay-summary').textContent = 'Prism is looking at your selection locally…';
  try {
    const image = await visionSelectedImage();
    const response = await S.analyseVisionSelection(WID, visionTabId, image, task || 'caption');
    if (response && response.error) throw new Error(response.error);
    const result = response && response.result;
    $('vision-overlay-summary').textContent = (result && result.text) || 'The local model returned no description.';
    setVisionStatus(result && result.ms ? 'Generated locally in ' + (result.ms / 1000).toFixed(1) + 's' : 'Generated by on-device AI');
  } catch (error) {
    $('vision-overlay-summary').textContent = error.message || 'Could not analyse this selection.';
    setVisionStatus('Local analysis failed');
  } finally {
    visionBusy = false;
    $('vision-overlay-read').disabled = false;
    paintVisionSelection();
  }
}

$('vision-overlay-stage').addEventListener('pointerdown', (event) => {
  const imageBox = $('vision-overlay-image').getBoundingClientRect();
  if ($('prism-vision-overlay').hidden || visionBusy || !imageBox.width || !imageBox.height ||
      event.clientX < imageBox.left || event.clientX > imageBox.right || event.clientY < imageBox.top || event.clientY > imageBox.bottom) return;
  event.preventDefault();
  visionDragging = true;
  visionStart = visionPoint(event);
  visionRect = { x: visionStart.x, y: visionStart.y, width: 0, height: 0 };
  $('vision-overlay-stage').setPointerCapture(event.pointerId);
  paintVisionSelection();
});
$('vision-overlay-stage').addEventListener('pointermove', (event) => {
  if (!visionDragging || !visionStart) return;
  const end = visionPoint(event);
  visionRect = { x: Math.min(visionStart.x, end.x), y: Math.min(visionStart.y, end.y),
    width: Math.abs(end.x - visionStart.x), height: Math.abs(end.y - visionStart.y) };
  paintVisionSelection();
});
$('vision-overlay-stage').addEventListener('pointerup', (event) => {
  if (!visionDragging) return;
  visionDragging = false;
  try { $('vision-overlay-stage').releasePointerCapture(event.pointerId); } catch (_) {}
  if (visionRect && visionRect.width >= 12 && visionRect.height >= 12) analyseVisionSelection('caption');
  else { visionRect = null; paintVisionSelection(); }
});
$('vision-overlay-stage').addEventListener('pointercancel', () => { visionDragging = false; });
$('vision-overlay-describe').addEventListener('click', () => analyseVisionSelection('detail'));
$('vision-overlay-read').addEventListener('click', async () => {
  if (!visionTabId || visionBusy) return;
  try {
    const capture = await S.captureVisionSelection(WID, visionTabId);
    if (capture && capture.error) throw new Error(capture.error);
    if (!capture.text || capture.text.trim().length < 40) throw new Error('There is not enough readable page text to summarize. Select a visual region instead.');
    visionBusy = true; $('vision-overlay-read').disabled = true; $('vision-overlay-describe').disabled = true;
    setVisionStatus('Summarising page text locally…'); $('vision-overlay-summary').textContent = 'Writing a local AI Overview…';
    const response = await S.aiSummariseText(WID, visionTabId, capture.text);
    if (response && response.error) throw new Error(response.error);
    $('vision-overlay-summary').textContent = response.result && response.result.text || 'No summary was returned.';
    setVisionStatus('Generated by on-device AI');
  } catch (error) { $('vision-overlay-summary').textContent = error.message || 'Could not summarise page text.'; setVisionStatus('Ready'); }
  finally { visionBusy = false; $('vision-overlay-read').disabled = false; paintVisionSelection(); }
});
$('vision-overlay-close').addEventListener('click', closeVisionOverlay);

// ---------- shell extent ----------
// The shell is a native view stacked ABOVE the page, so its bounds must grow
// to cover anything that hangs below the chrome (dropdown, menus, findbar,
// toasts) — otherwise the page hides them. Poll once per frame and report the
// bottom edge; main applies it as the shell view's height. Overlays are all
// top-anchored so a single rectangle from y=0 always covers them.
const OVERLAY_IDS = ['omni-dropdown', 'menu-panel', 'menu-sub', 'shield-pop', 'ext-pop', 'theme-pop', 'translation-pop', 'findbar', 'load-progress', 'toasts', 'status-bubble', 'prism-vision-overlay'];
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
  if (!$('menu-panel').contains(ev.target) && !$('menu-sub').contains(ev.target) && ev.target.closest && !ev.target.closest('#menu-btn') && $('menu-panel').style.display !== 'none') { closeMenu(); changed = true; }
  if (!$('ext-pop').contains(ev.target) && ev.target.closest && !ev.target.closest('#ext-btn') && $('ext-pop').style.display !== 'none') { $('ext-pop').style.display = 'none'; changed = true; }
  if (!$('theme-pop').contains(ev.target) && ev.target.closest && !ev.target.closest('#theme-btn') && $('theme-pop').style.display !== 'none') { $('theme-pop').style.display = 'none'; changed = true; }
  if (!$('translation-pop').contains(ev.target) && !$('menu-panel').contains(ev.target) && !$('menu-sub').contains(ev.target) && $('translation-pop').style.display !== 'none') { $('translation-pop').style.display = 'none'; changed = true; }
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
  closeMenu();
  $('ext-pop').style.display = 'none';
  $('translation-pop').style.display = 'none';
  pop.style.display = show ? '' : 'none';
  if (show) refreshShieldPop();
  syncExtentNow();
});
// ---------- extensions dropdown (the toolbar "puzzle piece") ----------
// Action popup pages open in a small Prism-owned window; extensions without
// one keep their management-page shortcut. Electron still supports only a
// subset of Chrome's extension APIs.
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
    const icon = el('span', 'ext-icon');
    if (x.icon || x.id) {
      const img = el('img');
      img.src = x.icon && x.icon.startsWith('prism:') ? x.icon : 'prism://exticon/' + encodeURIComponent(x.id);
      img.alt = '';
      img.onerror = () => { img.remove(); icon.textContent = '◇'; };
      icon.appendChild(img);
    } else icon.textContent = '◇';
    const nm = el('span', 'ext-name');
    nm.textContent = x.name || x.id;
    nm.title = x.name || x.id;
    const action = el('span', 'ext-action');
    action.textContent = x.popup ? '↗' : '⋯';
    row.append(icon, nm, action);      row.title = x.popup

      ? (x.name || x.id) + ' — open extension popup'
      : (x.name || x.id) + ' — manage extension';
    row.addEventListener('click', () => {
      extPop.style.display = 'none';
      if (x.popup) {
        const button = $('ext-btn').getBoundingClientRect();
        S.extensionsOpenPopup(WID, x.id, { right: button.right, bottom: button.bottom });
      }
      else S.newTab(WID, 'prism://extensions');
      syncExtentNow();
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
  closeMenu();
  $('shield-pop').style.display = 'none';
  $('translation-pop').style.display = 'none';
  extPop.style.display = show ? '' : 'none';
  if (show) refreshExtList();
  syncExtentNow();
});
$('ext-store-chrome').addEventListener('click', () => { extPop.style.display = 'none'; S.extensionsOpenPage('chrome'); syncExtentNow(); });
$('ext-store-edge').addEventListener('click', () => { extPop.style.display = 'none'; S.extensionsOpenPage('edge'); syncExtentNow(); });
$('ext-manage').addEventListener('click', () => { extPop.style.display = 'none'; S.newTab(WID, 'prism://extensions'); syncExtentNow(); });
S.onExtensionsChanged(() => refreshExtList());
// A bookmark can be added or removed from the Bookmarks page as well as from
// the star, so the bar repaints when the store says so rather than only when the
// star itself changes something.
S.onBookmarksChanged(() => renderBookmarksBar());
// Prime the count/badge at boot rather than waiting for the first popup open,
// so the toolbar button reflects reality from the first frame.
refreshExtList();

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
$('security-check-local').addEventListener('click', () => { checkActivePageThreatLists(); });

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

// ---------- main menu ----------
// The tree lives in menu-items.js; this renders it, flies out submenus, and
// dispatches each item's action. Keeping the actions in one table (rather than a
// long if/else chain) is what lets test/menu-items.test.js prove no menu item is
// left without a handler.
const MENU = window.PRISM_MENU;
let openSubmenuFor = null;
let submenuGeneration = 0;
let submenuCloseTimer = null;

function cancelSubmenuClose() {
  clearTimeout(submenuCloseTimer);
  submenuCloseTimer = null;
}

function scheduleSubmenuClose() {
  cancelSubmenuClose();
  submenuCloseTimer = setTimeout(() => {
    submenuCloseTimer = null;
    closeSubmenu();
    syncExtentNow();
  }, 160);
}

// History, bookmark, and extension names are user data and are not guaranteed
// to be parseable URLs, so hostname extraction must never throw.
function menuHostname(raw) {
  try { return new URL(raw).hostname; } catch (_) { return ''; }
}

function menuRow(item, inSub) {
  if (item.separator) return el('div', 'msep');
  const row = el('button', 'mi');
  row.dataset.id = item.id;
  if (item.list) row.dataset.list = item.list;
  if (item.action) row.dataset.act = item.action;
  if (item.target) row.dataset.target = item.target;
  if (item.submenu) row.dataset.hasSub = '1';
  if (item.icon) row.innerHTML = item.icon;
  const label = el('span', 'mi-label');
  label.textContent = item.label;
  row.appendChild(label);
  if (item.detail) {
    const detail = el('span', 'mi-detail');
    detail.textContent = item.detail;
    row.appendChild(detail);
  }
  if (item.shortcut) {
    const key = el('span', 'mi-key');
    key.textContent = item.shortcut;
    row.appendChild(key);
  }
  if (item.submenu) row.appendChild(el('span', 'mi-chevron'));
  if (item.id === 'profile') row.classList.add('profile-row');
  return row;
}

// A couple of rows read live state, so they are re-labelled on each open
// instead of carrying stale text from the static tree.
function liveMenuItem(item) {
  if (item.id === 'bookmarks-bar') {
    return Object.assign({}, item, { label: state.bookmarksBar ? 'Hide bookmarks bar' : 'Show bookmarks bar' });
  }
  if (item.id === 'zoom-level') {
    const zoom = (state.active && state.active.zoom) || 1;
    return Object.assign({}, item, { label: Math.round(zoom * 100) + '%' });
  }
  return item;
}

function renderMenu() {
  const panel = $('menu-panel');
  panel.textContent = '';
  for (const section of MENU.sections) {
    for (const item of section.items) {
      panel.appendChild(menuRow(liveMenuItem(item), false));
      // Section rules mirror Chrome's grouping rather than hard-coded blanks.
      if (item.id === 'new-private' || item.id === 'clear-data' || item.id === 'share') {
        panel.appendChild(el('div', 'msep'));
      }
    }
  }
}

function closeMenu() {
  $('menu-panel').style.display = 'none';
  closeSubmenu();
  syncExtentNow();
}

function closeSubmenu() {
  cancelSubmenuClose();
  submenuGeneration++;
  const sub = $('menu-sub');
  sub.style.display = 'none';
  sub.textContent = '';
  openSubmenuFor = null;
}

function submenuItemsFor(id) {
  for (const section of MENU.sections) {
    for (const item of section.items) {
      if (item.id === id) return item.submenu || [];
    }
  }
  return [];
}

async function renderSubmenu(parentRow) {
  const parentId = parentRow.dataset.id;
  const generation = ++submenuGeneration;
  const sub = $('menu-sub');
  if (openSubmenuFor !== parentId) {
    sub.style.display = 'none';
    sub.textContent = '';
  }
  openSubmenuFor = parentId;
  const children = submenuItemsFor(parentId);
  const content = document.createDocumentFragment();
  let listed = false;
  for (const child of children) {
    if (child.list) {
      listed = true;
      const rows = await loadMenuList(child.list);
      // A slower list request must not replace a submenu the pointer has
      // already moved to, or resurrect one after the menu was closed.
      if (generation !== submenuGeneration || !parentRow.isConnected) return;
      for (const row of rows) content.appendChild(row);
      if (!rows.length) {
        const note = el('div', 'pop-note');
        note.textContent = emptyListText(child.list);
        content.appendChild(note);
      }
      continue;
    }
    if (child.separator) {
      content.appendChild(el('div', 'msep'));
      continue;
    }
    content.appendChild(menuRow(liveMenuItem(child), true));
  }
  if (generation !== submenuGeneration || !parentRow.isConnected) return;
  if (listed) content.appendChild(el('div', 'msep'));
  sub.replaceChildren(content);
  sub.style.display = '';

  // Position against the row. #menu-sub is absolutely positioned but its
  // containing block is #chrome, not #menu-panel, so BOTH offsets must be
  // computed from #chrome. Leaving left/right unset would fall back to the
  // static position and strand the flyout at the far left of the window.
  const chromeBox = $('chrome').getBoundingClientRect();
  const panelBox = $('menu-panel').getBoundingClientRect();
  // The flyout touches the menu edge. Even a small visual gap makes the hover
  // path cross a dead region and causes the submenu to disappear before entry.
  const gap = 0;
  const subWidth = sub.offsetWidth;
  const subHeight = sub.offsetHeight;
  const panelLeft = panelBox.left - chromeBox.left;
  // The menu is right-anchored, so the flyout opens leftwards; if there is no
  // room it goes to the right of the panel instead of off-screen.
  let left = panelLeft - subWidth - gap;
  if (left < 0) left = panelLeft + panelBox.width + gap;
  sub.style.left = Math.round(left) + 'px';

  // Keep it inside the vertical span the shell view actually covers.
  // The panel scrolls once it exceeds max-height, and growing the native shell
  // view can shift that scroll, so bring the parent row back into view before
  // measuring it or the flyout tracks a row the user cannot see.
  parentRow.scrollIntoView({ block: 'nearest' });
  const rowBox2 = parentRow.getBoundingClientRect();
  let top = rowBox2.top - chromeBox.top;
  const maxTop = Math.max(0, chromeBox.height - subHeight);
  if (top + subHeight > chromeBox.height) top = Math.max(0, maxTop);
  sub.style.top = Math.round(top) + 'px';
  syncExtentNow();
}

function emptyListText(kind) {
  if (kind === 'history') return 'No browsing history yet.';
  if (kind === 'downloads') return 'No downloads yet.';
  if (kind === 'bookmarks') return 'No bookmarks yet.';
  if (kind === 'extensions') return 'No extensions installed.';
  if (kind === 'groups') return 'No tab groups yet.';
  return '';
}

function menuListRow(label, sublabel, act, payload) {
  const row = el('button', 'mi menu-list-row');
  if (act) row.dataset.act = act;
  if (payload) row.dataset.payload = payload;
  const text = el('span', 'menu-list-text');
  const l = el('span', 'l');
  l.textContent = label;
  text.appendChild(l);
  if (sublabel) {
    const s = el('span', 's');
    s.textContent = sublabel;
    text.appendChild(s);
  }
  row.appendChild(text);
  return row;
}

async function loadMenuList(kind) {
  try {
    if (kind === 'history') {
      const entries = (await S.historyList('', 6)) || [];
      return entries.map((h) => menuListRow(h.title || h.url, menuHostname(h.url), 'open-url', h.url));
    }
    if (kind === 'downloads') {
      const entries = (await S.downloadsList()) || [];
      return entries.slice(0, 6).map((d) => menuListRow(d.filename || d.name || 'Download', d.status || '', 'open-download', d.path));
    }
    if (kind === 'bookmarks') {
      const entries = (await S.bookmarksList()) || [];
      return entries.slice(0, 8).map((b) => menuListRow(b.title || b.url, menuHostname(b.url), 'open-url', b.url));
    }
    if (kind === 'extensions') {
      const entries = (await S.extensionsList()) || [];
      return entries.slice(0, 8).map((x) => menuListRow(x.name || x.id, x.active === false ? 'Paused' : 'Active', 'extensions-page'));
    }
    if (kind === 'groups') {
      const groups = (await S.tabGroups('list')) || [];
      return groups.map((g) => menuListRow(g.name, g.tabs.length + (g.tabs.length === 1 ? ' tab' : ' tabs'), 'focus-group', g.id));
    }
  } catch (error) {
    console.warn('[menu] could not load ' + kind, (error && error.message) || error);
  }
  return [];
}

// Actions reachable from menu rows, including the dynamic list rows.
const MENU_ACTIONS = {
  'new-tab': () => S.newTab(WID),
  'new-window': () => S.newWindow(),
  'new-private': () => S.newPrivateWindow(),
  'settings': () => S.newTab(WID, 'prism://settings'),
  'privacy': () => S.newTab(WID, 'prism://privacy'),
  'about': () => S.newTab(WID, 'prism://settings#about'),
  'extensions-page': () => S.newTab(WID, 'prism://extensions'),
  'passwords-page': () => S.newTab(WID, 'prism://passwords'),
  'password-settings': () => S.newTab(WID, 'prism://settings#privacy'),
  'lock-vault': () => S.lockVault(),
  'history-page': () => S.newTab(WID, 'prism://history'),
  'history-clear': () => S.historyClear(),
  'downloads-page': () => S.newTab(WID, 'prism://downloads'),
  'downloads-clear': () => S.downloadsClear(),
  'downloads-folder': () => S.chooseDownloadFolder().then((result) =>
    result && result.ok
      ? toast('Download folder changed', 'New downloads will be saved to ' + result.dir)
      : null),
  'bookmarks-page': () => S.newTab(WID, 'prism://bookmarks'),
  'bookmarks-bar': () => S.bookmarksBarToggle(),
  'clear-data': () => S.newTab(WID, 'prism://clear'),
  'zoom-in': () => S.zoom(WID, 1),
  'zoom-out': () => S.zoom(WID, -1),
  'zoom-reset': () => S.zoom(WID, 0),
  'fullscreen': () => S.toggleFullscreen(),
  'print': () => S.printPage(),
  'print-pdf': () => S.printPdf(),
  'save-page': () => S.savePage(),
  'copy-link': () => copyActiveUrl(true),
  'copy-page-url': () => copyActiveUrl(false),
  'copy-page-text': () => S.copyPageText().then((text) => {
    if (!text) return toast('Nothing to copy', 'This page has no selectable text.');
    return S.copyText(text).then(() => toast('Page text copied', text.length + ' characters on the clipboard.'));
  }),
  'find-open': () => openFind(),
  'find-next': () => stepFind(1),
  'find-prev': () => stepFind(-1),
  'group-create': () => S.tabGroups('create').then((group) =>
    toast('Tab grouped', group ? 'Added to ' + group.name + '.' : '')),
  'group-remove': () => S.tabGroups('ungroup').then((group) =>
    toast('Tab ungrouped', group ? 'Removed from ' + group.name + '.' : '')),
  'group-close-all': () => S.tabGroups('close-all').then(() => toast('Tab groups closed', 'Grouped tabs were closed.')),
  'focus-group': (row) => S.tabGroups('focus', row.dataset.payload),
  'translate': () => translateActivePage(),
  // Prism AI captures the active web page before opening Vision; summarise runs
  // against the active tab and reports back as a toast.
  // Local AI can be switched off in Settings. Say so before opening Vision.
  // whose only purpose is to run a model the user has turned off.
  'ai-vision': () => openVisionOverlay(),
  'ai-summarise': () => summariseActivePage(),
  'ai-accessibility': () => summariseActivePage('plain', 'Plain-language summary'),
  'ai-security-check': () => checkActivePageThreatLists(),
  'ai-models': () => S.newTab(WID, 'prism://vision#models'),
  'devtools': () => S.devtools(WID),
  'reload': () => S.reload(WID),
  'hard-reload': () => S.reload(WID, true),
  'search-home': () => S.newTab(WID, 'prism://search'),
  'shortcuts': () => S.newTab(WID, 'prism://shortcuts'),
  'update-lists': () => S.updateLists().then((result) =>
    result && result.error
      ? toast('List update failed', result.error, true)
      : toast('Protection lists updated', 'Ad-block and malware feeds are current.')),
  'clear-site-data': () => S.clearSiteData().then((result) =>
    result && result.error
      ? toast('Could not clear site data', result.error, true)
      : toast('Site data cleared', 'Cookies and storage for this site were removed.')),
  'open-repo': () => S.newTab(WID, 'https://github.com/shroomygod/PrismBrowser'),
  'open-issues': () => S.newTab(WID, 'https://github.com/shroomygod/PrismBrowser/issues'),
  'open-url': (row) => S.newTab(WID, row.dataset.payload),
  'open-download': (row) => S.openDownload(row.dataset.payload),
  'exit': () => S.exitApp(),
  'check-update': () => runUpdateCheck()
};

async function summariseActivePage(style, label) {
  if (state.settings && state.settings.ai && state.settings.ai.enabled === false) {
    return toast('Local AI is off', 'Turn it back on in Settings to summarise pages.');
  }
  const url = (state.active && state.active.url) || '';
  if (!/^https?:/i.test(url)) return toast('Nothing to summarise', 'Open a web page first.');
  const pending = toast('Summarising this page...', 'Prism is reading the page and writing a summary on this device.');
  try {
    const res = await S.aiSummarise(style);
    if (res && res.error) return toast('Could not summarise', res.error, true);
    const result = res && res.result;
    if (!result || !result.text) return toast('Nothing to summarise', 'The model returned an empty summary.');
    await S.copyText(result.text);
    toast(label || 'Summary ready', result.text.length + ' characters, copied to the clipboard.');
  } catch (err) {
    toast('Could not summarise', (err && err.message) || 'The local model failed.', true);
  } finally {
    pending();
  }
}async function checkActivePageThreatLists() {
  if (!state.active || !/^https?:/i.test(state.active.url || '')) {
    return toast('No web page to check', 'Open a website to check its address against Prism’s local threat lists.');
  }
  try {
    const result = await S.securityCheckLocal(WID);
    if (!result || result.error) return toast('Threat-list check unavailable', result && result.error || 'Could not inspect this address.', true);
    const detail = result.status === 'match'
      ? 'This address matches a local ' + result.matchType + ' threat entry (' + result.host + '). Do not continue unless you are certain.'
      : result.status === 'exception'
        ? result.host + ' is on your local allow-list, so Prism’s warning is bypassed for this host.'
        : 'No match for ' + result.host + ' in the local lists (' + result.hostEntries.toLocaleString() + ' domains, ' + result.urlEntries.toLocaleString() + ' URLs). This is not a guarantee that the site is safe.';
    toast(result.status === 'match' ? 'Local threat match' : 'Local threat-list check', detail, result.status === 'match');
  } catch (error) {
    toast('Threat-list check unavailable', (error && error.message) || 'Could not inspect this address.', true);
  }
}

let translationLanguages = null;

async function loadTranslationLanguages() {
  if (translationLanguages) return translationLanguages;
  const languages = await S.aiTranslationLanguages();
  if (!Array.isArray(languages) || !languages.length) throw new Error('The local model has no available translation languages.');
  translationLanguages = languages;
  let sourceSelection = 'en';
  let targetSelection = 'es';
  for (const id of ['translation-source', 'translation-target']) {
    const select = $(id);
    const previous = select.value;
    if (previous && languages.some((language) => language.id === previous)) {
      if (id === 'translation-source') sourceSelection = previous;
      else targetSelection = previous;
    }
    select.replaceChildren();
    for (const language of languages) {
      const option = document.createElement('option');
      option.value = language.id;
      option.textContent = language.label;
      select.appendChild(option);
    }
    if (languages.some((language) => language.id === previous)) select.value = previous;
  }
  $('translation-source').value = sourceSelection;
  $('translation-target').value = targetSelection;
  return languages;
}

async function translateActivePage(source, target) {
  if (state.settings && state.settings.ai && state.settings.ai.enabled === false) {
    return toast('Local AI is off', 'Turn it back on in Settings to translate this page.');
  }
  if ((source || target) && (!state.active || !/^https?:/i.test(state.active.url || ''))) {
    return toast('Nothing to translate', 'Open a web page first.');
  }
  const pop = $('translation-pop');
  pop.style.display = '';
  $('translation-content').textContent = '';
  try {
    await loadTranslationLanguages();
    if (!source && !target) {
      $('translation-title').textContent = 'Translate this page';
      $('translation-content').textContent = 'Choose a source and target language, then select Translate.';
      return;
    }
    const sourceLanguage = source || $('translation-source').value || 'en';
    const targetLanguage = target || $('translation-target').value || 'es';
    $('translation-source').value = sourceLanguage;
    $('translation-target').value = targetLanguage;
    if (sourceLanguage === targetLanguage) return toast('Choose another language', 'The source and target languages must be different.', true);
    const sourceName = $('translation-source').selectedOptions[0].textContent;
    const targetName = $('translation-target').selectedOptions[0].textContent;
    const pending = toast('Translating this page...', 'The page text stays on this device while the local model works.');
    $('translation-run').disabled = true;
    try {
      const response = await S.aiTranslate(WID, sourceLanguage, targetLanguage);
      if (!response || response.error) return toast('Could not translate', response && response.error || 'The local model failed.', true);
      const result = response.result;
      if (!result || !result.text) return toast('Nothing to translate', 'This page has no readable text.');
      $('translation-title').textContent = sourceName + ' → ' + targetName;
      $('translation-content').textContent = result.text;
      const suffix = result.truncated ? ' Showing the first 24,000 characters.' : '';
      toast(targetName + ' translation ready', result.text.length + ' characters, translated on this device.' + suffix);
    } finally {
      $('translation-run').disabled = false;
      pending();
    }
  } catch (error) {
    toast('Could not translate', (error && error.message) || 'The local model failed.', true);
  } finally {
    syncExtentNow();
  }
}

$('translation-run').addEventListener('click', () =>
  translateActivePage($('translation-source').value, $('translation-target').value));
for (const id of ['translation-source', 'translation-target']) {
  $(id).addEventListener('change', () => {
    if (id === 'translation-source' && $('translation-source').value === $('translation-target').value) {
      const alternative = translationLanguages.find((language) => language.id !== $('translation-source').value);
      if (alternative) $('translation-target').value = alternative.id;
    } else if (id === 'translation-target' && $('translation-target').value === $('translation-source').value) {
      const alternative = translationLanguages.find((language) => language.id !== $('translation-target').value);
      if (alternative) $('translation-source').value = alternative.id;
    }
  });
}
$('translation-close').addEventListener('click', () => {
  $('translation-pop').style.display = 'none';
  syncExtentNow();
});
$('translation-copy').addEventListener('click', async () => {
  const text = $('translation-content').textContent;
  await S.copyText(text);
  toast('Translation copied', text.length + ' characters copied to the clipboard.');
});

function copyActiveUrl(webOnly) {
  const url = (state.active && state.active.url) || '';
  if (!url || (webOnly && !/^https?:/i.test(url))) {
    return toast(webOnly ? 'No link on this page' : 'No page address', 'This tab is not showing a web page.');
  }
  S.copyText(url).then(() => toast('Copied to clipboard', url));
}

function stepFind(delta) {
  const term = $('find-input') ? $('find-input').value.trim() : '';
  if (!term) return openFind();
  S.find(WID, term, { forward: delta > 0, findNext: true });
}

// Shared by the menu item and the toolbar button so both report the same thing.
async function runUpdateCheck() {
  const pending = toast('Checking for updates...', 'Checking for the latest Prism release.');
  try {
    const st = await S.checkForUpdates();
    if (st && st.error) toast('Update check failed', st.error, true);
    else if (st && st.downloaded) {
      pendingUpdate = { version: st.version, downloaded: true, buildRefresh: !!st.buildRefresh };
      showUpdateButton(pendingUpdate);
      toast('Update ready', 'Prism ' + st.version + ' is ready to install.', false, 'Update now', () => S.installUpdate());
    } else if (st && st.available) {
      pendingUpdate = { version: st.version, downloaded: false, buildRefresh: !!st.buildRefresh };
      showUpdateButton(pendingUpdate);
      toast('Update available', 'Downloading Prism ' + st.version + '...');
    } else toast('You are up to date', 'Prism ' + (st && st.version) + ' is the latest version.');
  } catch (error) {
    toast('Update check failed', (error && error.message) || String(error), true);
  } finally {
    pending();
  }
}

async function runMenuAction(row) {
  const act = row.dataset.act;
  const handler = MENU_ACTIONS[act];
  if (!handler) {
    console.warn('[menu] no handler for action', act);
    return;
  }
  return handler(row);
}

$('menu-btn').addEventListener('click', () => {
  const panel = $('menu-panel');
  const show = panel.style.display === 'none';
  $('shield-pop').style.display = 'none';
  $('ext-pop').style.display = 'none';
  $('translation-pop').style.display = 'none';
  if (!show) return closeMenu();
  $('theme-pop').style.display = 'none';
  $('translation-pop').style.display = 'none';
  renderMenu();
  panel.style.display = '';
  closeSubmenu();
  syncExtentNow();
});

$('menu-panel').addEventListener('pointerenter', cancelSubmenuClose);
$('menu-panel').addEventListener('pointermove', (ev) => {
  const row = ev.target.closest('.mi[data-has-sub]');
  if (!row) return;
  cancelSubmenuClose();
  if (openSubmenuFor !== row.dataset.id) renderSubmenu(row);
});
$('menu-sub').addEventListener('pointerenter', cancelSubmenuClose);
$('menu-panel').addEventListener('pointerleave', (ev) => {
  if (ev.relatedTarget && $('menu-sub').contains(ev.relatedTarget)) return;
  scheduleSubmenuClose();
});
$('menu-sub').addEventListener('pointerleave', (ev) => {
  if (ev.relatedTarget && $('menu-panel').contains(ev.relatedTarget)) return;
  scheduleSubmenuClose();
});
$('menu-panel').addEventListener('mouseover', (ev) => {
  const row = ev.target.closest('.mi');
  if (!row || !row.dataset.hasSub) {
    // Leave a small grace period to cross the panel/flyout seam, but still
    // dismiss the old flyout when the pointer settles on a non-parent row.
    if (openSubmenuFor) scheduleSubmenuClose();
    return;
  }
  cancelSubmenuClose();
  if (openSubmenuFor === row.dataset.id) return;
  renderSubmenu(row);
});

async function handleMenuClick(ev) {
  const row = ev.target.closest('.mi');
  if (!row || row.dataset.hasSub) return;
  closeMenu();
  await runMenuAction(row);
}
$('menu-panel').addEventListener('click', handleMenuClick);
$('menu-sub').addEventListener('click', handleMenuClick);

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
  // Fetch the bar's own list instead of painting the last state snapshot. The
  // star writes a bookmark and repaints immediately, so a snapshot would not
  // contain it until some unrelated full update happened to arrive.
  S.bookmarksBar().then((list) => paintBookmarksBar(bar, list || [])).catch(() => {});
}

function paintBookmarksBar(bar, bookmarks) {
  bar.textContent = '';
  for (const b of bookmarks) {
    const chip = el('div', 'bm');
    chip.title = b.title + '\n' + b.url;
    if (b.favicon) { const img = el('img'); img.src = b.favicon; chip.appendChild(img); }
    const s = el('span'); s.textContent = b.title || b.url; chip.appendChild(s);
    chip.addEventListener('click', () => { if (state.active) S.navigate(state.active.id, b.url); });
    chip.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      // Take it off the bar, not out of Prism. The star puts every bookmark on
      // the bar, so deleting from here would quietly destroy bookmarks the user
      // still expects on the Bookmarks page. Deleting stays on that page.
      if (confirm('Remove "' + (b.title || b.url) + '" from the bookmarks bar?')) {
        (async () => {
          await S.setBookmarkBar(b.id, false);
          renderBookmarksBar();
        })();
      }
    });
    bar.appendChild(chip);
  }
  if (!bookmarks.length) {
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
  const appearance = Object.assign({}, state.appearance || {});
  if (window.PrismTheme) {
    window.PrismTheme.apply(document.documentElement, appearance);
  } else document.documentElement.dataset.theme = state.theme || 'dark';
  const cursor = appearance.pixelCursor === false ? 'pointer' : 'var(--cursor-pointer-image, var(--cursor-image, auto))';
  document.documentElement.style.setProperty('--cursor-pointer', cursor);
  document.documentElement.style.setProperty('--cursor-text', appearance.pixelCursor === false ? 'text' : 'var(--cursor-text-image, text)');
  // Keep the shell's own mirror in step; internal pages do the same from the
  // preset, and the site-theme path in the main process reads it.
  if (window.PrismTheme) state.theme = document.documentElement.dataset.theme;
  document.documentElement.dataset.motionPreference =
    (state.appearance && state.appearance.accessibility && state.appearance.accessibility.reducedMotion) || 'system';
  document.documentElement.dataset.animationTheme =
    ({ basic: 'fluent', smooth: 'fluent', playful: 'spring' })[appearance.animationTheme] ||
    (['fluent', 'spring', 'arcade', 'minimal', 'off'].includes(appearance.animationTheme) ? appearance.animationTheme : 'fluent');
}

// ---------- quick theme controls ----------
// The popup shows a scrollable list of curated presets grouped by category
// rather than the old hue/gradient/motion inputs: every row is a complete,
// designed palette rather than a generated combination.
const SHELL_CATEGORY_LIMIT = 6;
function shellPresetCategories() {
  if (!window.PrismTheme) return [];
  return window.PrismTheme.CATEGORIES.map((category) => ({ category, items: window.PrismTheme.presetsIn(category.id) }));
}
function renderThemePresets() {
  const host = $('theme-presets');
  if (!host) return;
  const active = (state.appearance && state.appearance.themePreset) || '';
  host.textContent = '';
  let shown = 0;
  let shownThemes = 0;
  for (const { category, items } of shellPresetCategories()) {
    if (!items.length || shown >= SHELL_CATEGORY_LIMIT) continue;
    shown++;
    shownThemes += items.length;
    const heading = document.createElement('div');
    heading.className = 'theme-preset-category';
    heading.textContent = category.name;
    const list = document.createElement('div');
    list.className = 'theme-preset-grid';
    for (const item of items) {
      const resolved = window.PrismTheme.resolve({ themePreset: item.id });
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'theme-preset';
      button.dataset.preset = item.id;
      button.setAttribute('aria-pressed', String(item.id === active));
      button.title = item.name;
      const chip = document.createElement('span');
      chip.className = 'theme-preset-chip';
      chip.setAttribute('aria-hidden', 'true');
      chip.style.setProperty('--chip-color', resolved.vars['--chrome-color']);
      chip.style.setProperty('--chip-image', resolved.vars['--chrome-bg']);
      chip.style.setProperty('--chip-size', resolved.vars['--chrome-background-size']);
      chip.style.setProperty('--chip-position', resolved.vars['--chrome-background-position']);
      chip.style.setProperty('--chip-page', resolved.vars['--bg']);
      button.appendChild(chip);
      const label = document.createElement('span');
      label.className = 'theme-preset-name';
      label.textContent = item.name;
      button.appendChild(label);
      button.addEventListener('click', () => applyThemePatch({
        themePreset: item.id,
        theme: resolved.dark ? 'dark' : 'light',
        customBackground: null,
        customAccent: null,
        customFrame: null
      }));
      list.appendChild(button);
    }
    host.append(heading, list);
  }
  if (!shown) return;
  // Say what the popup is holding back, so the Settings link reads as "there is
  // more" rather than as the whole catalog.
  const more = document.createElement('div');
  more.className = 'theme-preset-category';
  const hidden = window.PrismTheme.PRESETS.length - shownThemes;
  more.textContent = hidden > 0 ? `${hidden} more in Settings` : '';
  host.appendChild(more);
}
function syncThemeControls() {
  renderThemePresets();
}
function applyThemePatch(patch) {
  const appearance = Object.assign({}, state.appearance || {}, patch);
  state.appearance = appearance;
  if (Object.prototype.hasOwnProperty.call(patch, 'customBackground') && window.PrismTheme) {
    appearance.theme = window.PrismTheme.resolve(appearance).dark ? 'dark' : 'light';
  }
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
        // A change made elsewhere arrived while this write was in flight. Ours
        // was issued first, so it looked newer than theirs; replay theirs now
        // that the write has settled, otherwise the shell and Settings disagree.
        const external = queuedExternalAppearance;
        queuedExternalAppearance = null;
        if (external && JSON.stringify(external) !== JSON.stringify(latest.appearance)) {
          applyThemePatch(external);
        }
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
let queuedExternalAppearance = null;
const themePop = $('theme-pop');
$('theme-btn').addEventListener('click', () => {
  const show = themePop.style.display === 'none';
  closeMenu(); $('ext-pop').style.display = 'none'; $('shield-pop').style.display = 'none';
  if ($('omni-dropdown').style.display !== 'none') hideDropdown();
  themePop.style.display = show ? '' : 'none';
  if (show) { $('translation-pop').style.display = 'none'; syncThemeControls(); }
  syncExtentNow();
});
$('theme-random').addEventListener('click', () => {
  const current = (state.appearance && state.appearance.themePreset) || '';
  const id = window.PrismTheme.randomPresetId(current);
  const resolved = window.PrismTheme.resolve(id);
  applyThemePatch({
    themePreset: id,
    theme: resolved.dark ? 'dark' : 'light',
    customBackground: null,
    customAccent: null,
    customFrame: null
  });
});
$('theme-all').addEventListener('click', () => { themePop.style.display = 'none'; S.newTab(WID, 'prism://settings#appearance'); syncExtentNow(); });
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
  if ($('menu-panel').style.display !== 'none' || $('menu-sub').style.display !== 'none') { closeMenu(); changed = true; }
  if ($('shield-pop').style.display !== 'none') { $('shield-pop').style.display = 'none'; changed = true; }
  if ($('ext-pop').style.display !== 'none') { $('ext-pop').style.display = 'none'; changed = true; }
  if ($('theme-pop').style.display !== 'none') { $('theme-pop').style.display = 'none'; changed = true; }
  if ($('translation-pop').style.display !== 'none') { $('translation-pop').style.display = 'none'; changed = true; }
  if (changed) syncExtentNow();
});

S.onCmd((cmd) => {
  if (cmd === 'focus-omnibox') { omni.focus(); omni.select(); }
  else if (cmd === 'search-web') { omni.value = ''; suggestFor(''); omni.focus(); }
  else if (cmd === 'open-find') openFind();
  else if (cmd === 'find-next') stepFind(1);
  else if (cmd === 'find-prev') stepFind(-1);
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
  const buildLabel = 'Prism ' + (d && d.version ? d.version : '');
  toast('Update ready to install',
    buildLabel + ' has been downloaded.',
    false, 'Update now', () => S.installUpdate());
});
S.onUpdateAvailable((d) => {
  pendingUpdate = { version: d && d.version, downloaded: !!(d && d.downloaded), buildRefresh: !!(d && d.buildRefresh) };
  showUpdateButton(pendingUpdate);
  const updateLabel = 'Prism ' + (d && d.version);
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
// finds a release installer (startup check + hourly + "Check for updates").
// Clicking it re-checks, then installs: the installer runs silent (/S) and
// the app quits so files can be replaced — a one-click self-update.
let pendingUpdate = null;
function showUpdateButton(info) {
  const btn = $('update-btn');
  if (!btn) return;
  btn.style.display = '';
  btn.title = info && info.version
    ? 'Update Prism to ' + info.version + ' (click to install)'
    : 'Update available (click to install)';
  syncExtentNow();
}
$('update-btn').addEventListener('click', async () => {
  if (pendingUpdate && pendingUpdate.downloaded) { S.installUpdate(); return; }
  await runUpdateCheck();
});

S.onSettingsChanged((s) => {
  const prevBar = state.bookmarksBar;
  state.settings = s;
  state.adblockEnabled = s.privacy.adblock.enabled;
  // Do not let a delayed snapshot overwrite a value still being coalesced; the
  // snapshot is queued instead and replayed once the shell's write settles.
  if (themeSavePending) queuedExternalAppearance = s.appearance;
  else {
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

S.onToast(({ title, body, danger }) => {
  if (title) toast(title, body || '', !!danger);
});

S.onDownloadThreat(({ filename, threat }) => {
  toast('Download blocked', filename + '\n' + threat, true);
});

window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    if (!$('prism-vision-overlay').hidden) closeVisionOverlay();
    else if ($('menu-panel').style.display !== 'none' || $('menu-sub').style.display !== 'none') closeMenu();
    else if ($('translation-pop').style.display !== 'none') { $('translation-pop').style.display = 'none'; syncExtentNow(); }
    else if (findVisible) closeFind();
  }
  // Arrow keys walk the open menu, then its submenu, like any native menu.
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    if ($('menu-panel').style.display === 'none') return;
    const sub = $('menu-sub');
    const scope = sub.style.display !== 'none' ? sub : $('menu-panel');
    moveMenuSelection(scope, ev.key === 'ArrowDown' ? 1 : -1);
    ev.preventDefault();
  } else if (ev.key === 'ArrowRight') {
    const focused = $('menu-panel').querySelector('.mi.sel[data-has-sub]');
    if (focused) { cancelSubmenuClose(); renderSubmenu(focused); }
  } else if (ev.key === 'ArrowLeft') {
    if ($('menu-sub').style.display !== 'none') { closeSubmenu(); syncExtentNow(); }
  } else if (ev.key === 'Enter' && $('menu-panel').style.display !== 'none') {
    const focused = $('menu-panel').querySelector('.mi.sel');
    if (focused) { ev.preventDefault(); handleMenuClick({ target: focused }); }
  }
});

function moveMenuSelection(scope, delta) {
  const rows = Array.from(scope.querySelectorAll('.mi'));
  if (!rows.length) return;
  let index = rows.findIndex((r) => r.classList.contains('sel'));
  index = (index + delta + rows.length) % rows.length;
  for (const row of rows) row.classList.remove('sel');
  const next = rows[index];
  next.classList.add('sel');
  next.scrollIntoView({ block: 'nearest' });
  // Hovering a parent row opens its submenu, which is what makes arrow-key
  // navigation feel like a real menu instead of a listbox.
  if (scope.id === 'menu-panel' && next.dataset.hasSub) { cancelSubmenuClose(); renderSubmenu(next); }
}
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
