## Prism ${version}

Prism is a privacy-focused desktop browser built with Electron. This release includes the current Prism browser application and Windows x64 distribution builds.

### What’s included

- **Tabbed browsing:** Custom browser chrome, omnibox navigation, bookmarks, history, downloads, find-in-page, and private windows.
- **Main menu:** A full browser menu behind the toolbar's ⋮ button, with working submenus for history, downloads, bookmarks, tab groups, extensions, passwords, zoom, translate, find, and more tools. Arrow keys navigate it and Escape closes it.
- **Tab groups:** Group, ungroup, switch between, and close tab groups from the menu. Groups are window-level view state and are not written to the profile.
- **Privacy controls:** Ad and tracker filtering, per-site protection settings, Do Not Track and Global Privacy Control headers, HTTPS-first navigation, and configurable Secure DNS.
- **Clear browsing data:** A dedicated Delete browsing data page with basic and advanced options and time ranges, reachable from the menu and \`Ctrl+Shift+Delete\`.
- **Page tools:** Print, print to PDF, save page as HTML, copy the page address or its text, and clear cookies and site storage for the current site.
- **Password vault:** The password vault can be locked from the menu, which flushes pending writes and drops the in-memory master key; it is re-unwrapped from the OS keyring on the next access and nothing is ever written unencrypted.
- **Security and downloads:** Community phishing and malware URL feeds, optional Safe Browsing checks, and reputation checks for completed downloads.
- **Customization:** Dark, light, and system themes, appearance controls, bookmarks bar, and extension management for supported Chrome and Edge extensions.
- **Updates:** GitHub Releases update checks, SHA-512 installer integrity verification, and detection of republished same-version builds.
- **Keyboard shortcuts:** A shortcuts reference page listing Prism's accelerators, and native accelerators for printing, saving, full screen, find-again, and tab movement.

### Fixes in this release

- **Ad blocking no longer breaks pages.** Legacy filter rules containing a \`|\` character were compiled as regex alternation, so a handful of rules such as \`/addyn|*|adtech;\` matched every request and silently cancelled stylesheets and images. Interior pipes are now treated literally, and unanchored untyped rules can no longer block stylesheets or fonts. Pages that previously rendered unstyled now render correctly.
- The main menu's overlay height no longer depends on \`100vh\`, which resolved against the chrome view and collapsed the menu instead of growing it.
- Submenus are positioned from the chrome container so they open beside their parent row rather than at the edge of the window.

### Windows x64 downloads

- `Prism-${version}-x64.exe` — NSIS installer.
- `Prism-${version}-portable.exe` — portable build.
- `Prism-${version}-x64.exe.blockmap` — installer differential-update metadata.
- `latest.yml` — updater manifest and installer checksum.

### Notes

Prism's Windows builds are currently unsigned. SHA-512 verifies that the downloaded installer matches the published updater manifest; it is not a publisher digital signature. Private browsing limits local retention but does not make network activity anonymous. See the repository README for platform support, known limitations, and privacy details.
