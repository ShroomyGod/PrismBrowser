// menu-items.js — the main menu, as data.
//
// Single source of truth for the ⋮ menu: shell.js renders this tree and
// dispatches each item's `action` id, and test/menu-items.test.js asserts the
// tree stays well formed and that every action is actually handled. Works both
// as a plain <script> in the shell and as a CommonJS module in tests.
'use strict';

(function (root, factory) {
  const items = factory();
  if (typeof module === 'object' && module.exports) module.exports = items;
  else root.PRISM_MENU = items;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const ic = {
    tab: '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>',
    window: '<svg viewBox="0 0 16 16" width="15" height="15"><rect x="2.5" y="3.5" width="11" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M2.5 6.5h11" stroke="currentColor" stroke-width="1.3"/></svg>',
    incognito: '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M2.5 7.5h11M5 7.5L3.6 4.2a1 1 0 0 1 .9-1.4h7a1 1 0 0 1 .9 1.4L11 7.5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/><path d="M4 10.5h3m2 0h3" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>',
    key: '<svg viewBox="0 0 16 16" width="15" height="15"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M5.5 7V5.5a2.5 2.5 0 0 1 5 0V7" stroke="currentColor" stroke-width="1.3" fill="none"/><circle cx="8" cy="10.2" r="1" fill="currentColor"/></svg>',
    history: '<svg viewBox="0 0 16 16" width="15" height="15"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M8 4.5V8l2.5 1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none"/></svg>',
    download: '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M8 2.5v7M5 7l3 3 3-3M3 13h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
    bookmark: '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M4 2.5h8V14l-4-2.6L4 14z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/></svg>',
    group: '<svg viewBox="0 0 16 16" width="15" height="15"><rect x="2.5" y="4" width="11" height="3.5" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/><rect x="2.5" y="8.5" width="7" height="3.5" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>',
    puzzle: '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M6.5 2.5h3v2a1.5 1.5 0 1 0 0 2v2h2a1.5 1.5 0 1 1-2 0h-2v-2h-2a1.5 1.5 0 1 0 0-3z" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linejoin="round" transform="translate(1.5 1.5)"/></svg>',
    trash: '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.7 8h4.6l.7-8" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    zoom: '<svg viewBox="0 0 16 16" width="15" height="15"><circle cx="7" cy="7" r="4.4" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M10.4 10.4L14 14M5.2 7h3.6M7 5.2v3.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none"/></svg>',
    print: '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M5 6V3h6v3M5 12H3.5V7.5h9V12H11" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><rect x="5" y="10" width="6" height="3.5" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>',
    translate: '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M2.5 4h6M5.5 4v1.5c0 2.2-1.2 4-3 5M4 6.5c1 1.8 2.3 3 3.8 3.8M8.5 13.5l2.8-7 2.8 7M9.6 11.4h3.4" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    find: '<svg viewBox="0 0 16 16" width="15" height="15"><circle cx="7" cy="7" r="4.2" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M10.3 10.3L14 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/></svg>',
    share: '<svg viewBox="0 0 16 16" width="15" height="15"><circle cx="12" cy="3.5" r="1.8" stroke="currentColor" stroke-width="1.3" fill="none"/><circle cx="4" cy="8" r="1.8" stroke="currentColor" stroke-width="1.3" fill="none"/><circle cx="12" cy="12.5" r="1.8" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M5.7 7.1l4.6-2.4M5.7 8.9l4.6 2.4" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>',
    tools: '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M10.4 2.6a3.4 3.4 0 0 0-3.2 4.6l-4.6 4.6 1.6 1.6 4.6-4.6a3.4 3.4 0 0 0 4.6-3.2l-2.2 2.2-1.6-1.6z" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linejoin="round"/></svg>',
    help: '<svg viewBox="0 0 16 16" width="15" height="15"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M6.4 6.2a1.7 1.7 0 1 1 2.2 1.6c-.4.2-.6.5-.6.9v.3M8 11.4v.2" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>',
    gear: '<svg viewBox="0 0 16 16" width="15" height="15"><circle cx="8" cy="8" r="2.2" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6L11 5M5 11l-1.4 1.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none"/></svg>',
    exit: '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M6 3.5H4a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 4 12.5h2M10 5.5L13 8l-3 2.5M13 8H6" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    search: '<svg viewBox="0 0 16 16" width="15" height="15"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/></svg>',
    shield: '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M8 1.8l5 1.8v3.6c0 3.3-2.1 5.9-5 7-2.9-1.1-5-3.7-5-7V3.6z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/></svg>',
    copy: '<svg viewBox="0 0 16 16" width="15" height="15"><rect x="5.5" y="5.5" width="8" height="8" rx="1.3" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M10.5 3.5h-7a1 1 0 0 0-1 1v7" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>',
    spark: '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M8 1.8l1.4 4.1 4.1 1.4-4.1 1.4L8 12.8 6.6 8.7 2.5 7.3l4.1-1.4z" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linejoin="round"/></svg>',
    eye: '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M1.8 8S4 4 8 4s6.2 4 6.2 4-2.2 4-6.2 4S1.8 8 1.8 8z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.9" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>'
  };

  return {
    icons: ic,
    sections: [
      {
        items: [
          { id: 'new-tab', label: 'New tab', icon: ic.tab, shortcut: 'Ctrl+T', action: 'new-tab' },
          { id: 'new-window', label: 'New window', icon: ic.window, shortcut: 'Ctrl+N', action: 'new-window' },
          { id: 'new-private', label: 'New incognito window', icon: ic.incognito, shortcut: 'Ctrl+Shift+N', action: 'new-private' }
        ]
      },
      {
        // Local profile row: Prism has no account sync, so this is the local
        // profile rather than a signed-in Google account.
        items: [
          { id: 'profile', label: 'Prism profile', detail: 'This device', icon: ic.shield, profile: true, submenu: [
            { id: 'profile-settings', label: 'Settings', action: 'settings' },
            { id: 'profile-privacy', label: 'Privacy and security', action: 'privacy' },
            { id: 'profile-extensions', label: 'Extensions', action: 'extensions-page' },
            { id: 'profile-about', label: 'About Prism', action: 'about' }
          ] }
        ]
      },
      {
        items: [
          { id: 'passwords', label: 'Passwords and autofill', icon: ic.key, submenu: [
            { id: 'passwords-page', label: 'Saved passwords', action: 'passwords-page' },
            { id: 'passwords-settings', label: 'Password settings', action: 'password-settings' },
            { separator: true, id: 'passwords-sep' },
            { id: 'passwords-lock', label: 'Lock the password vault', action: 'lock-vault' }
          ] },
          { id: 'history', label: 'History', icon: ic.history, submenu: [
            { id: 'history-recent', label: 'Recent history', list: 'history' },
            { separator: true, id: 'history-sep' },
            { id: 'history-search', label: 'Search history', action: 'history-page' },
            { id: 'history-clear', label: 'Clear browsing history', action: 'history-clear' }
          ] },
          { id: 'downloads', label: 'Downloads', icon: ic.download, submenu: [
            { id: 'downloads-recent', label: 'Recent downloads', list: 'downloads' },
            { separator: true, id: 'downloads-sep' },
            { id: 'downloads-show', label: 'Show all downloads', action: 'downloads-page' },
            { id: 'downloads-folder', label: 'Change download folder', action: 'downloads-folder' },
            { id: 'downloads-clear', label: 'Clear download list', action: 'downloads-clear' }
          ] },
          { id: 'bookmarks', label: 'Bookmarks and lists', icon: ic.bookmark, submenu: [
            { id: 'bookmarks-manager', label: 'Bookmark manager', action: 'bookmarks-page' },
            { id: 'bookmarks-bar', label: 'Show bookmarks bar', action: 'bookmarks-bar' },
            { separator: true, id: 'bookmarks-sep' },
            { id: 'bookmarks-all', label: 'All bookmarks', list: 'bookmarks' }
          ] },
          { id: 'tab-groups', label: 'Tab groups', icon: ic.group, submenu: [
            { id: 'groups-list', label: 'Your tab groups', list: 'groups' },
            { separator: true, id: 'groups-sep' },
            { id: 'groups-create', label: 'Group current tab', action: 'group-create' },
            { id: 'groups-remove', label: 'Ungroup current tab', action: 'group-remove' },
            { id: 'groups-close', label: 'Close all groups', action: 'group-close-all' }
          ] },
          { id: 'extensions', label: 'Extensions', icon: ic.puzzle, submenu: [
            { id: 'extensions-installed', label: 'Installed extensions', list: 'extensions' },
            { separator: true, id: 'extensions-sep' },
            { id: 'extensions-manage', label: 'Manage extensions', action: 'extensions-page' }
          ] },
          { id: 'clear-data', label: 'Delete browsing data…', icon: ic.trash, shortcut: 'Ctrl+Shift+Delete', action: 'clear-data' }
        ]
      },
      {
        items: [
          { id: 'zoom', label: 'Zoom', icon: ic.zoom, submenu: [
            { id: 'zoom-out', label: 'Zoom out', shortcut: 'Ctrl+-', action: 'zoom-out' },
            { id: 'zoom-level', label: '100%', action: 'zoom-reset' },
            { id: 'zoom-in', label: 'Zoom in', shortcut: 'Ctrl+=', action: 'zoom-in' },
            { separator: true, id: 'zoom-sep' },
            { id: 'zoom-fullscreen', label: 'Full screen', shortcut: 'F11', action: 'fullscreen' }
          ] },
          { id: 'print', label: 'Print…', icon: ic.print, shortcut: 'Ctrl+P', action: 'print' },
          { id: 'translate', label: 'Translate…', icon: ic.translate, action: 'translate' },
          { id: 'find', label: 'Find and edit', icon: ic.find, submenu: [
            { id: 'find-open', label: 'Find…', shortcut: 'Ctrl+F', action: 'find-open' },
            { id: 'find-next', label: 'Find next', action: 'find-next' },
            { id: 'find-prev', label: 'Find previous', action: 'find-prev' },
            { separator: true, id: 'find-sep' },
            { id: 'find-copy-link', label: 'Copy link address', icon: ic.copy, action: 'copy-link' },
            { id: 'find-copy-page', label: 'Copy page address', icon: ic.copy, action: 'copy-page-url' }
          ] },
          { id: 'share', label: 'Cast, save and share', icon: ic.share, submenu: [
            { id: 'share-save', label: 'Save page as…', action: 'save-page' },
            { id: 'share-pdf', label: 'Print to PDF…', action: 'print-pdf' },
            { separator: true, id: 'share-sep' },
            { id: 'share-link', label: 'Copy link to this page', icon: ic.copy, action: 'copy-page-url' },
            { id: 'share-cwd', label: 'Copy page text', icon: ic.copy, action: 'copy-page-text' }
          ] },
          // Local AI. Everything here runs on this machine via a worker thread
          // (src/ai/worker.js) -- no request leaves the device.
          { id: 'ai', label: 'Prism AI', icon: ic.spark, submenu: [
            { id: 'ai-vision', label: 'Prism Vision', icon: ic.eye, action: 'ai-vision' },
            { id: 'ai-summarise', label: 'Summarise this page', action: 'ai-summarise' },
            { id: 'ai-accessibility', label: 'Plain-language summary', action: 'ai-accessibility' },
            { id: 'ai-security-check', label: 'Check local threat lists', icon: ic.shield, action: 'ai-security-check' },
            { separator: true, id: 'ai-sep' },
            { id: 'ai-models', label: 'Manage local models', action: 'ai-models' }
          ] },
          { id: 'more', label: 'More tools', icon: ic.tools, submenu: [
            { id: 'more-devtools', label: 'Developer tools', shortcut: 'Ctrl+Shift+I', action: 'devtools' },
            { id: 'more-reload', label: 'Reload', shortcut: 'Ctrl+R', action: 'reload' },
            { id: 'more-hard-reload', label: 'Hard reload', shortcut: 'Ctrl+Shift+R', action: 'hard-reload' },
            { separator: true, id: 'more-sep' },
            { id: 'more-search', label: 'Prism Search', icon: ic.search, action: 'search-home' },
            { id: 'more-shortcuts', label: 'Keyboard shortcuts', action: 'shortcuts' },
            { id: 'more-lists', label: 'Update protection lists', icon: ic.shield, action: 'update-lists' },
            { id: 'more-security-check', label: 'Check local threat lists', icon: ic.shield, action: 'ai-security-check' },
            { id: 'more-clear-site', label: 'Clear site data for this site', action: 'clear-site-data' }
          ] }
        ]
      },
      {
        items: [
          { id: 'help', label: 'Help', icon: ic.help, submenu: [
            { id: 'help-shortcuts', label: 'Keyboard shortcuts', action: 'shortcuts' },
            { id: 'help-docs', label: 'Prism on GitHub', action: 'open-repo' },
            { id: 'help-issues', label: 'Report an issue', action: 'open-issues' },
            { separator: true, id: 'help-sep' },
            { id: 'help-update', label: 'Check for updates', action: 'check-update' }
          ] },
          { id: 'settings', label: 'Settings', icon: ic.gear, action: 'settings' },
          { id: 'exit', label: 'Exit', icon: ic.exit, shortcut: 'Ctrl+Shift+Q', action: 'exit' }
        ]
      }
    ]
  };
});