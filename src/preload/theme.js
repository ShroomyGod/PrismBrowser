// preload/theme.js — injects theme CSS into web pages for site theming.
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'http:' || location.protocol === 'https:') {
  contextBridge.exposeInMainWorld('prismTheme', {
    // Called by main when theme changes
    applyTheme: (theme) => {
      // Remove existing theme style
      const existing = document.getElementById('prism-theme-style');
      if (existing) existing.remove();

      if (theme === 'off') return;

      const style = document.createElement('style');
      style.id = 'prism-theme-style';
      style.textContent = getThemeCSS(theme);
      document.documentElement.appendChild(style);
    },

    // Check if current page prefers dark/light (for 'auto' mode)
    getColorScheme: () => {
      try {
        const meta = document.querySelector('meta[name="color-scheme"]');
        if (meta) return meta.content;
        const style = getComputedStyle(document.documentElement);
        return style.colorScheme || 'auto';
      } catch (_) { return 'auto'; }
    }
  });
}

function getThemeCSS(theme) {
  // CSS variables for our theme colors
  const darkVars = `
    :root {
      --prism-bg: #0c0c0c !important;
      --prism-bg-elevated: #141414 !important;
      --shrome-text: #ececec !important;
      --prism-text-muted: #9a9a9a !important;
      --prism-border: #2b2b2b !important;
      --prism-accent: #7c9cbf !important;
    }
  `;

  const lightVars = `
    :root {
      --prism-bg: #ffffff !important;
      --prism-bg-elevated: #f7f7f7 !important;
      --shrome-text: #1c1c1c !important;
      --prism-text-muted: #616161 !important;
      --prism-border: #dcdcdc !important;
      --prism-accent: #3f6f9f !important;
    }
  `;

  // Aggressive dark mode injection - forces dark theme on all sites
  const darkModeCSS = `
    ${darkVars}
    /* Force dark color scheme */
    :root, html, body { color-scheme: dark !important; }
    html { background: var(--prism-bg) !important; }
    body { background: var(--prism-bg) !important; color: var(--shrome-text) !important; }

    /* Override common backgrounds */
    body, div, section, article, main, header, footer, aside, nav,
    .container, .wrapper, .content, .main, .page, .site, .app,
    [class*="bg-"], [class*="background"], [style*="background"] {
      background-color: var(--prism-bg) !important;
      background-image: none !important;
      border-color: var(--prism-border) !important;
    }

    /* Text colors */
    h1, h2, h3, h4, h5, h6, p, span, a, li, td, th, label, button,
    input, textarea, select, option, dt, dd, blockquote, pre, code {
      color: var(--shrome-text) !important;
      text-shadow: none !important;
    }

    /* Muted text */
    .muted, .secondary, .subtle, .dim, [class*="muted"], [class*="secondary"],
    time, .date, .timestamp, .caption, .description, .summary {
      color: var(--prism-text-muted) !important;
    }

    /* Links */
    a { color: var(--prism-accent) !important; }
    a:hover, a:focus { color: var(--prism-accent) !important; opacity: 0.8; }

    /* Borders */
    hr, .border, [class*="border"], table, th, td, fieldset, legend,
    input, textarea, select, button, .card, .panel, .box {
      border-color: var(--prism-border) !important;
    }

    /* Inputs */
    input, textarea, select, [contenteditable="true"] {
      background: var(--prism-bg-elevated) !important;
      color: var(--shrome-text) !important;
      border-color: var(--prism-border) !important;
    }
    input::placeholder, textarea::placeholder { color: var(--prism-text-muted) !important; }
    input:focus, textarea:focus, select:focus { outline-color: var(--prism-accent) !important; }

    /* Buttons */
    button, .btn, [role="button"], input[type="button"], input[type="submit"] {
      background: var(--prism-bg-elevated) !important;
      color: var(--shrome-text) !important;
      border-color: var(--prism-border) !important;
    }
    button:hover, .btn:hover, [role="button"]:hover {
      background: var(--prism-border) !important;
    }
    button.primary, .btn-primary, .primary, [class*="primary"] {
      background: var(--prism-accent) !important;
      color: var(--prism-bg) !important;
      border-color: var(--prism-accent) !important;
    }

    /* Code/pre */
    pre, code, .code, .highlight, [class*="code"] {
      background: var(--prism-bg-elevated) !important;
      color: var(--shrome-text) !important;
      border-color: var(--prism-border) !important;
    }

    /* Tables */
    table, th, td { background: transparent !important; }
    tr:nth-child(even) td { background: rgba(255,255,255,0.03) !important; }

    /* Scrollbars */
    ::-webkit-scrollbar { background: var(--prism-bg) !important; }
    ::-webkit-scrollbar-thumb { background: var(--prism-border) !important; }
    ::-webkit-scrollbar-thumb:hover { background: var(--prism-text-muted) !important; }

    /* Selection */
    ::selection { background: var(--prism-accent) !important; color: var(--prism-bg) !important; }

    /* Images/videos - slightly dim */
    img:not([src*="svg"]), video, canvas {
      filter: brightness(0.92) contrast(1.02) !important;
    }
    img[src*="logo"], img[src*="icon"], img[alt*="logo" i], img[class*="logo" i] {
      filter: none !important;
    }

    /* Forms */
    fieldset, .form-group, .form-control, .input-group {
      background: var(--prism-bg-elevated) !important;
      border-color: var(--prism-border) !important;
    }

    /* Modals, dropdowns, popovers */
    .modal, .dropdown, .popover, .tooltip, .menu, [role="dialog"],
    [role="menu"], [role="listbox"], [role="tooltip"] {
      background: var(--prism-bg-elevated) !important;
      border-color: var(--prism-border) !important;
      box-shadow: 0 10px 40px rgba(0,0,0,0.5) !important;
    }

    /* Remove bright whites */
    * { background-color: var(--prism-bg) !important; }
    *:not(img):not(video):not(canvas):not(svg):not(iframe) {
      background-image: none !important;
    }
  `;

  const lightModeCSS = `
    ${lightVars}
    :root, html, body { color-scheme: light !important; }
    html { background: var(--prism-bg) !important; }
    body { background: var(--prism-bg) !important; color: var(--shrome-text) !important; }

    body, div, section, article, main, header, footer, aside, nav,
    .container, .wrapper, .content, .main, .page, .site, .app {
      background-color: var(--prism-bg) !important;
      background-image: none !important;
      border-color: var(--prism-border) !important;
    }

    h1, h2, h3, h4, h5, h6, p, span, a, li, td, th, label, button,
    input, textarea, select, option, dt, dd, blockquote, pre, code {
      color: var(--shrome-text) !important;
    }

    .muted, .secondary, .subtle, .dim, [class*="muted"], [class*="secondary"],
    time, .date, .timestamp, .caption, .description, .summary {
      color: var(--prism-text-muted) !important;
    }

    a { color: var(--prism-accent) !important; }
    a:hover, a:focus { color: var(--prism-accent) !important; }

    hr, .border, [class*="border"], table, th, td, fieldset, legend,
    input, textarea, select, button, .card, .panel, .box {
      border-color: var(--prism-border) !important;
    }

    input, textarea, select, [contenteditable="true"] {
      background: var(--prism-bg-elevated) !important;
      color: var(--shrome-text) !important;
      border-color: var(--prism-border) !important;
    }
    input::placeholder, textarea::placeholder { color: var(--prism-text-muted) !important; }

    button, .btn, [role="button"], input[type="button"], input[type="submit"] {
      background: var(--prism-bg-elevated) !important;
      color: var(--shrome-text) !important;
      border-color: var(--prism-border) !important;
    }
    button.primary, .btn-primary, .primary, [class*="primary"] {
      background: var(--prism-accent) !important;
      color: var(--prism-bg) !important;
      border-color: var(--prism-accent) !important;
    }

    pre, code, .code, .highlight, [class*="code"] {
      background: var(--prism-bg-elevated) !important;
      color: var(--shrome-text) !important;
    }

    ::-webkit-scrollbar { background: var(--prism-bg) !important; }
    ::-webkit-scrollbar-thumb { background: var(--prism-border) !important; }
    ::selection { background: var(--prism-accent) !important; color: var(--prism-bg) !important; }

    * { background-color: var(--prism-bg) !important; }
    *:not(img):not(video):not(canvas):not(svg):not(iframe) {
      background-image: none !important;
    }
  `;

  if (theme === 'dark') return darkModeCSS;
  if (theme === 'light') return lightModeCSS;
  return '';
}