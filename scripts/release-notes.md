## Prism ${version} — ${name}

Prism is a privacy-focused desktop browser built with Electron. This release includes the current Prism browser application and Windows x64 distribution builds.

### New in this release

<!-- The release script reads this section to suggest a name for the release, so keep it to what this build actually adds. The sections below describe the browser as a whole. -->

- **Prism Vision:** A new page that looks at an image without sending it anywhere. Drop, paste or choose a picture and Prism can describe it, describe it in detail, transcribe the text in it, list the objects in it, or find a specific thing you name. It works on the page you are looking at, on a file from disk, or on a screenshot.
- **Local summaries:** Any page can be summarised as a paragraph, a short tldr or a list of bullets, in one click from the menu. The whole thing runs on your own hardware, so the text of the page never travels to a server to be shortened.
- **Models that arrive with Prism:** SmolVLM-256M and SmolLM-135M are included in the installer. There is nothing to download, nothing to install alongside Prism, and Prism Vision and summaries work on a machine that has never been online.
- **Theme gallery:** 124 hand-designed themes in 12 categories, browsable like a gallery with a category rail and large previews, instead of generated hue combinations. Every theme is a complete palette held to text, accent and toolbar contrast minimums, and each one paints a mock tab strip and page so you can see it before applying it.
- **Downloads:** A traditional download history with a downloads folder picker, per-file Open, Show in folder, Run and Delete actions, and Windows Defender scanning of every completed download reported on the file's own row.
- **Install To Prism:** The Chrome Web Store’s “Switch to Chrome?” nag is suppressed, and its install button becomes **Install To Prism**, so supported extensions install without leaving Prism.
- **Theme consistency:** Changing the theme from the toolbar and the same change reaching an open Settings page no longer race, so the shell and the page always agree.

### What’s included

- **Local AI:** Prism Vision and local page summarisation, powered by SmolVLM-256M and SmolLM-135M running through Transformers.js in a worker thread in the browser process. The models ship inside the installer, so both features work offline on first use, and neither sends an image or a page to a third party.
- **Tabbed browsing:** Custom browser chrome, omnibox navigation, bookmarks, history, downloads, find-in-page, and private windows.
- **Main menu:** A full browser menu behind the toolbar's ⋮ button, with working submenus for history, downloads, bookmarks, tab groups, extensions, passwords, zoom, translate, find, and more tools. Arrow keys navigate it and Escape closes it.
- **Tab groups:** Group, ungroup, switch between, and close tab groups from the menu. Groups are window-level view state and are not written to the profile.
- **Privacy controls:** Ad and tracker filtering, per-site protection settings, Do Not Track and Global Privacy Control headers, HTTPS-first navigation, and configurable Secure DNS.
- **Clear browsing data:** A dedicated Delete browsing data page with basic and advanced options and time ranges, reachable from the menu and \`Ctrl+Shift+Delete\`.
- **Page tools:** Print, print to PDF, save page as HTML, copy the page address or its text, and clear cookies and site storage for the current site.
- **Password vault:** The password vault can be locked from the menu, which flushes pending writes and drops the in-memory master key; it is re-unwrapped from the OS keyring on the next access and nothing is ever written unencrypted.
- **Downloads:** A traditional download history with a downloads folder picker, per-file Open, Show in folder, Run and Delete actions, and Windows Defender scanning of every completed download reported on the file's row.
- **Security:** Community phishing and malware URL feeds, optional Safe Browsing checks, and antivirus scanning of downloads.
- **Theme gallery:** 124 hand-designed themes in 12 categories, browsable like a gallery with a category rail and large previews, instead of generated hue combinations. Every theme is a complete palette, and each one is held to text, accent and toolbar contrast minimums with a visibly raised active tab.
- **Extension support:** Extension management for supported Chrome and Edge extensions, and an **Install To Prism** button on the Chrome Web Store that installs without leaving Prism.
- **Updates:** GitHub Releases update checks, SHA-512 installer integrity verification, and detection of republished same-version builds.
- **Keyboard shortcuts:** A shortcuts reference page listing Prism's accelerators, and native accelerators for printing, saving, full screen, find-again, and tab movement.

### Fixes in this release

- **Changing the theme no longer leaves two windows disagreeing.** A theme applied from the toolbar and the same change arriving at an open Settings page raced each other, so the shell and the page could end up showing different themes. The later change now wins in both places.

- **Ad blocking no longer breaks pages.** Legacy filter rules containing a \`|\` character were compiled as regex alternation, so a handful of rules such as \`/addyn|*|adtech;\` matched every request and silently cancelled stylesheets and images. Interior pipes are now treated literally, and unanchored untyped rules can no longer block stylesheets or fonts. Pages that previously rendered unstyled now render correctly.
- The main menu's overlay height no longer depends on \`100vh\`, which resolved against the chrome view and collapsed the menu instead of growing it.
- Submenus are positioned from the chrome container so they open beside their parent row rather than at the edge of the window.

### Windows x64 downloads

- `Prism-${version}-x64.exe` — NSIS installer.
- `Prism-${version}-portable.exe` — portable build.
- `Prism-${version}-x64.exe.blockmap` — installer differential-update metadata.
- `latest.yml` — updater manifest and installer checksum.

### Notes

The installer now carries the two quantised AI models (about 387MB staged) rather than fetching them on first use. They are the reason Prism Vision and summaries work immediately and offline.

Prism's Windows builds are currently unsigned. SHA-512 verifies that the downloaded installer matches the published updater manifest; it is not a publisher digital signature. Private browsing limits local retention but does not make network activity anonymous. See the repository README for platform support, known limitations, and privacy details.
