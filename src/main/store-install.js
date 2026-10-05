// store-install.js — makes the Chrome/Edge store pages work inside Prism.
//
// Both stores only install on Chrome. In any other Chromium build they show a
// "Switch to Chrome to install extensions and themes" banner and a dead "Add to
// Chrome" button. Prism already installs these extensions natively by fetching
// the CRX itself (extensions.installFromStore), so this module:
//
//   1. suppresses the stores' "Switch to Chrome?" confirm() nag, which is a
//      page dialog Prism otherwise shows verbatim;
//   2. injects preload/store-inject.js to replace the dead button with a
//      working "Install To Prism".
//
// Only store origins are touched. Suppressing dialogs everywhere would break
// ordinary confirm()/alert() on normal sites.
'use strict';

const fs = require('fs');
const path = require('path');

const CHROME_HOSTS = ['chromewebstore.google.com', 'chrome.google.com'];
const EDGE_HOSTS = ['microsoftedge.microsoft.com', 'addons.microsoft.com'];

// Loaded once; injected on every store page load and re-injection.
let _shimSource = null;
function shimSource() {
  if (_shimSource === null) {
    _shimSource = fs.readFileSync(path.join(__dirname, '..', 'preload', 'store-inject.js'), 'utf8');
  }
  return _shimSource;
}

function sourceFor(rawUrl) {
  let host;
  try { host = new URL(rawUrl).hostname.toLowerCase(); } catch (_) { return null; }
  if (CHROME_HOSTS.indexOf(host) !== -1) return 'chrome';
  if (EDGE_HOSTS.indexOf(host) !== -1) return 'edge';
  return null;
}

function isStoreUrl(rawUrl) { return sourceFor(rawUrl) !== null; }

// The nag is a page dialog. Matching on its CONTENT, not on the page, so a
// legitimate confirm() on the same store page still works.
//
// The wording varies between store versions and locales: Chrome shows
// "Switch to Chrome?" and "Google recommends using Chrome when using
// extensions and themes." Match the stable fragments of both rather than an
// exact sentence.
const NAG_RE = /switch to chrome|recommends using chrome|using extensions and themes|install extensions and themes/i;

function isBrowserNag(details) {
  if (!details) return false;
  const text = [details.message, details.type].filter(Boolean).join(' ');
  return NAG_RE.test(text);
}

function shouldSuppressDialog(rawUrl) { return isStoreUrl(rawUrl); }

async function inject(webContents) {
  if (!webContents || webContents.isDestroyed()) return false;
  if (!sourceFor(webContents.getURL())) return false;
  try {
    // Main world, so the shim sees the store's own DOM and its handlers.
    await webContents.executeJavaScript(shimSource(), true);
    return true;
  } catch (err) {
    console.warn('[store] could not inject store shim:', err.message);
    return false;
  }
}

module.exports = { sourceFor, isStoreUrl, shouldSuppressDialog, isBrowserNag, inject };