// common.js — shared helpers for internal pages.
'use strict';

const PrismUI = {
  async boot(themeVariant) {
    try {
      const s = await window.prism.getSettings();
      let theme = s.appearance.theme || 'dark';
      if (theme === 'system') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      document.documentElement.dataset.theme = theme;
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
