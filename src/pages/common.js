// common.js — shared helpers for internal pages.
'use strict';

const PrismUI = {
  async boot(themeVariant) {
    try {
      // Every internal page shares generated theme/accessibility tokens, not
      // just Settings. Load once on-demand to keep the common page bootstrap
      // backwards-compatible with existing internal HTML.
      if (!window.PrismTheme) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'prism://settings/shared/theme-engine.js';
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }
      const s = await window.prism.getSettings();
      let activeAppearance = s.appearance || {};
      const applyAppearance = (appearance) => {
        activeAppearance = appearance || {};
        let current = activeAppearance.theme || 'dark';
        if (current === 'system') current = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        if (window.PrismTheme) window.PrismTheme.apply(document.documentElement, Object.assign({}, activeAppearance, { theme: current }));
        else document.documentElement.dataset.theme = current;
      };
      applyAppearance(activeAppearance);
      if (window.prism.onSettingsChanged) window.prism.onSettingsChanged((next) => applyAppearance(next.appearance || {}));
      const media = matchMedia('(prefers-color-scheme: dark)');
      media.addEventListener && media.addEventListener('change', () => {
        if (activeAppearance.theme === 'system') applyAppearance(activeAppearance);
      });
      return s;
    } catch (_) { return null; }
  },
  el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  },
  fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleString();
  },
  fmtBytes(n) {
    if (!n && n !== 0) return '';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0, v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 10 || i === 0 ? 0 : 1) + ' ' + u[i];
  },
  hostname(url) {
    try { return new URL(url).hostname; } catch (_) { return url; }
  },
  nav(url) { location.href = url; },
  searchUrl(q) { return 'prism://search?q=' + encodeURIComponent(q); },
  // simple switch row builder
  switchRow(title, desc, checked, onChange) {
    const line = this.el('div', 'setting-line');
    const info = this.el('div', 'info');
    info.appendChild(this.el('b', null, title));
    if (desc) info.appendChild(this.el('div', 'muted', desc));
    const label = this.el('label', 'switch');
    const input = document.createElement('input');
    input.type = 'checkbox'; input.checked = !!checked;
    const slider = this.el('span', 'slider');
    label.append(input, slider);
    input.addEventListener('change', () => onChange(input.checked));
    line.append(info, label);
    return { line, input };
  }
};
window.PrismUI = PrismUI;
