# Prism Browser

<p align="center">
  <img src="assets/prism-logo.png" alt="Prism Browser logo" width="112">
</p>

<p align="center">
  <strong>A privacy-focused desktop browser built with Electron.</strong><br>
  Includes configurable search providers, Prism Search, and optional SearXNG integration.
</p>

<p align="center">
  <strong>Current package version:</strong> 1.0.5 · <strong>Configured installer target:</strong> Windows x64
</p>

> **Project status:** Prism is an actively changing desktop-browser project. Features described below reflect the current source tree; a successful build, live search-provider integration, store search, or security verdict must be tested in the actual packaged app before being treated as production-ready.

## Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Privacy and security](#privacy-and-security)
- [Requirements and development](#requirements-and-development)
- [Build and release](#build-and-release)
- [Tests](#tests)
- [Repository map](#repository-map)
- [Known limitations](#known-limitations)

## Overview

Prism is a Chromium-based desktop browser application. Electron provides the browser engine and native application APIs; Prism supplies a custom browser shell, tab/window management, internal pages, settings, storage, and optional privacy and security features.

The interface is assembled from an Electron main process, a dedicated shell view for browser chrome, and web-content views for tabs. Internal pages use the `prism://` scheme. The browser's custom chrome and internal pages are local application content; ordinary websites are loaded from their normal web origins.

## Features

### Browsing and search

- Tabbed windows with navigation controls, omnibox, bookmarks, history, downloads, find-in-page, and context menus.
- Google is the default search engine. Built-in alternatives include Bing, DuckDuckGo, Yahoo, Brave Search, Startpage, Ecosia, Qwant, and Wikipedia.
- Bang shortcuts are supported when enabled (for example, `!g`, `!ddg`, `!y`, `!br`, and `!w`).
- Prism Search combines the app's local index with optional SearXNG-backed web search. Its crawl/index settings are configurable; contributing visited pages is off by default.
- Dark, light, and system browser themes, plus a bookmarks bar and per-site appearance compatibility options.

### Privacy tools

- EasyList/EasyPrivacy-based network and cosmetic filtering, custom filter rules, and per-site allow settings.
- Additional built-in cosmetic selectors for ads and sponsored blocks on several search-engine result pages.
- Do Not Track and Global Privacy Control request headers, HTTPS-first navigation, and configurable Secure DNS.
- Pop-up blocking for script-opened windows that request explicit dimensions.
- Private windows use a non-persistent Electron session partition. Prism excludes private visits from its history and local search-index ingestion, clears the private partition after the last private window closes, marks private chrome distinctly, and does not restore private windows on startup.

### Security and downloads

- Community malware/phishing feeds from URLhaus, Phishing Army, and OpenPhish. URL-based feeds are matched at URL granularity where appropriate; domain feeds are matched at host granularity.
- Optional Google Safe Browsing URL checks, configured with the user's own API key.
- Completed downloads can be SHA-256 checked against URLhaus's payload API and moved to quarantine when a known malicious payload is identified.
- Permission requests have browser defaults and can be managed by origin.

### Extensions

- Load unpacked extensions and install supported packages from the Chrome Web Store or Microsoft Edge Add-ons.
- The Extensions page includes store selection, search, one-click installation for returned results, and a manual store URL/extension-ID fallback.
- The toolbar extension menu lists installed extensions and links to extension management and both stores.

Store search currently parses the stores' HTML and depends on their page markup. If a store changes its markup, search can fail even while manual installation by extension ID or URL remains available.

### Updates

The updater checks GitHub Releases for a newer version, downloads the Windows installer, verifies the published SHA-512 checksum, and offers an explicit install action. Release publishing is handled by the release build script when a GitHub token is supplied.

A checksum detects accidental or in-transit changes; it is not a publisher signature. Do not embed a GitHub token in the app or its packaged files. Windows code signing is not configured in the current build, and unsigned update/install behavior should be validated on the target Windows installation.

## Architecture

```text
Electron main process
├── Window and tab manager       src/main/tabs.js
├── Session partitions           src/main/sessions.js
├── Browser chrome view          src/shell/
├── Internal pages               src/pages/
├── Sandboxed preload bridges    src/preload/
├── Privacy / security           adblock.js, security.js, secure-dns.js
├── Settings and encrypted data  settings.js, securestore.js, stores.js
├── Search and indexing          prism-search*.js, index-store.js, crawler.js
├── Extensions                   extensions.js
├── Update service                updater.js
└── Local prism:// protocol       protocols.js
```

- **Main process** owns windows, tab WebContentsViews, session setup, native menus, downloads, protocol handlers, and privileged IPC handlers.
- **Shell view** renders the tab strip, toolbar, omnibox, menus, notifications, and extension dropdown. It is separate from the active website view.
- **Page views** render sites or Prism's internal pages. Context-isolated preload scripts expose narrow APIs rather than Node.js access.
- **Normal profile** uses the persistent `persist:prism` partition. **Private windows** use the in-memory `prism-private` partition.
- **App-owned settings and collections** are encrypted with AES-256-GCM. Electron `safeStorage` wraps the vault key with the operating-system keyring when available; a local fallback is used if the OS keyring cannot be used.

## Privacy and security

Private browsing reduces what Prism keeps locally; it does **not** make a user anonymous or conceal their activity from websites, search providers, network operators, employers, or an ISP. A search request still goes to the selected search provider. Private mode does not hide your IP address, prevent fingerprinting, or guarantee that a downloaded file is private.

Private windows share the in-memory private partition while any private window remains open, so cookies/site data can be shared between concurrently open private windows. Closing the final private window clears that partition for the next private session. Downloads still go to the normal download location and may appear in the download list; use care on shared devices.

The download check is a reputation lookup against a public hash service, **not a full local antivirus engine**. It only recognizes files already represented by the service and should supplement, not replace, Windows security software. Safe Browsing is optional and requires a separately obtained API key.

The built-in DNT/GPC headers are privacy preferences, not enforcement. Websites may ignore them. Secure DNS protects DNS lookups from some local-network observers, but does not encrypt the rest of web traffic beyond what HTTPS already provides.

## Requirements and development

### Platform

The configured distributable targets **Windows x64** (NSIS installer and portable executable). The project uses Electron; `src-tauri/` remains in the repository as legacy code and is not used by the current `start`, `build`, or `release` scripts.

Use a recent Node.js/npm toolchain compatible with the Electron toolchain in the lockfile. The current `package.json` scripts invoke `electron` and `electron-builder`, but those packages are not listed in its `devDependencies`. In a clean checkout, install them explicitly if they are not already present:

```sh
npm install
npm install --no-save electron@^37 electron-builder@^26
```

Then launch the development app:

```sh
npm start
```

The package manifest and lockfile are currently out of sync regarding dependency declarations. If dependency installation reports that the lockfile is inconsistent, do not bypass the error silently; reconcile and commit the package manifest and lockfile before relying on clean-machine setup.

### Useful commands

| Command | Purpose |
| --- | --- |
| `npm start` | Launch Electron using `src/main/main.js`. |
| `npm test` | Run search-web, generated-theme, and Electron theme/settings UI tests. |
| `npm run icons` | Regenerate icons and wordmarks from the source artwork in `assets/`. |
| `npm run build` | Build the configured Windows application directory with Electron Builder. |
| `npm run release` | Regenerate/validate icons, clean prior build outputs, build the Windows installer and portable executable, verify artifacts, and publish (replacing any same-version GitHub release) if a GitHub token is available. |

## Build and release

A local Windows release build is produced with:

```sh
npm run release
```

Expected outputs in the repository root include:

- `Prism-<version>-x64.exe` — NSIS installer
- `Prism-<version>-portable.exe` — portable build
- `Prism-<version>-x64.exe.blockmap` — installer update metadata
- `latest.yml` — Electron Builder update manifest (when generated)

The release script regenerates the icons, checks their transparent borders, removes previous matching Prism/Shroom installer artifacts and known build directories, runs Electron Builder, and checks that expected outputs exist. Review `scripts/release.js` before using it: the script removes prior generated build outputs and, when publishing is enabled, may create and push the version tag, delete the existing GitHub release for that version, and upload the new artifacts.

Release descriptions come from [`scripts/release-notes.md`](scripts/release-notes.md). That template is copied to `release-notes.md` (gitignored) at publish time with the version substituted, and Electron Builder publishes it as the GitHub release body. Edit the template to change what future releases say about Prism; the generated copy is not committed.

### Republishing the same version

`npm run release` can be run again without bumping `version`. When a GitHub token is set, the script:

1. Builds and verifies the Windows artifacts first, so a broken build never reaches GitHub.
2. Pushes the version tag (`v<version>`) if it is not on the remote yet, and stops if that fails.
3. Deletes every published GitHub release whose tag matches the version being built.
4. Uploads the new installer, portable build, blockmap, and `latest.yml` to a new release under the same tag.

This makes a same-version republish (for example a build that fixes a bug without a version bump) reach existing installs: Prism's updater compares the published installer's SHA-512, so a replaced release is offered even though the version number is unchanged. Deletion happens only after a successful local build and a confirmed remote tag, and a draft release with the same tag stops the run rather than being deleted automatically.

For GitHub publishing, configure a least-privilege token for **this repository only** with the contents permission needed to create releases, then set it only in the build shell. For PowerShell:

```powershell
$env:GITHUB_TOKEN = "<your-token>"
npm run release
```

Never commit the token, put it in `package.json`, or ship it inside Prism. Git tag pushing also requires Git itself to be authenticated for the configured remote. Commit the exact release source first, verify the current branch and remote, and inspect the version/tag before publishing. A new version in `package.json` is normally required, but republishing the same version replaces the existing release for that tag as described above.

## Tests

`npm test` runs search-web unit tests, generated-theme tests, updater identity tests, release-script tests, and a real Electron theme/settings UI test. The `test/` directory also contains Electron regression tests for browser layout, overlays, bookmarks, compatible site themes, persistence, and migration. These focused tests are not a comprehensive suite.

For meaningful changes, also test the user-facing behavior in the packaged build—for example, search navigation with ad blocking enabled, private-window cleanup, download scanning, extensions, and update installation. A passing build alone does not validate these flows.

## Repository map

| Path | Contents |
| --- | --- |
| `src/main/` | Electron main-process modules: tabs, sessions, settings, security, updater, search, and extensions. |
| `src/shell/` | Custom browser chrome and its stylesheet. |
| `src/pages/` | Internal pages for new tabs, search, settings, history, bookmarks, downloads, passwords, extensions, privacy, and errors. |
| `src/preload/` | Context-isolated IPC bridges for the shell and internal pages. |
| `assets/` | Source logo artwork and generated application icons. |
| `scripts/` | Logo processing, the Windows release build, and the release-notes template. |
| `test/` | Search-web tests and additional focused probes. |
| `src-tauri/` | Legacy Tauri/Servo-era project files; not part of the current Electron entry path. |

## Known limitations

- The shipped build configuration targets Windows x64; other operating systems are not configured as release targets.
- Extension compatibility depends on Electron/Chromium's supported extension APIs. Browser-toolbar popup UI is not implemented as a native extension popup; the toolbar menu provides extension management access instead.
- Store search relies on upstream HTML markup and may need maintenance when store pages change.
- Community reputation feeds and hash lookups are incomplete by nature and are not a substitute for an endpoint antivirus product.
- Automated tests cover only a small part of the application; packaged-app behavior still needs manual verification.
