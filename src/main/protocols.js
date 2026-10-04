// protocols.js — the prism:// scheme. Serves internal browser pages
// (newtab, search, settings, ...) from src/pages plus app assets and
// extension icons. Path traversal is impossible: fixed roots + allowlists.
const path = require('path');
const fs = require('fs');
const { app, protocol, net } = require('electron');
const extensions = require('./extensions');

const PAGES_ROOT = path.join(__dirname, '..', 'pages');
const ASSETS_ROOT = path.join(__dirname, '..', '..', 'assets');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2'
};

function privilegedSchemes() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'prism', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
  ]);
}

function safeJoin(root, rel) {
  const abs = path.normalize(path.join(root, rel));
  if (!abs.startsWith(root)) return null;
  return abs;
}

function serveFile(absPath) {
  try {
    const data = fs.readFileSync(absPath);
    const type = MIME[path.extname(absPath).toLowerCase()] || 'application/octet-stream';
    return new Response(data, { headers: { 'content-type': type, 'cache-control': 'no-cache' } });
  } catch (_) {
    return new Response('Not found', { status: 404 });
  }
}

function handlePrism(request) {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname || '/');
    // For prism://settings, the parsed URL has hostname "settings" and path "/".
    // Resolve that bare host as the internal page name instead of falling
    // through to /newtab (which made Settings, Extensions, Search, etc. appear
    // to open a new tab without ever reaching their page).
    const pageName = (url.hostname || '').toLowerCase();
    if (pageName && (pathname === '/' || pathname === '')) pathname = '/' + pageName;
    if (pathname === '/' || pathname === '') pathname = '/newtab';

    // App assets: prism://assets/icon-32.png
    if (pathname.startsWith('/assets/')) {
      const rel = pathname.slice('/assets/'.length);
      // '@' must be allowed: wordmark@2x.png is a 2x asset and \w does not
      // include it, which 403'd the wordmark on every internal page. Traversal
      // is unaffected -- safeJoin() below normalizes and re-checks the root.
      if (!/^[\w.@-]+(\.png|\.ico|\.svg)$/.test(rel)) return new Response('Forbidden', { status: 403 });
      const abs = safeJoin(ASSETS_ROOT, rel);
      return abs ? serveFile(abs) : new Response('Not found', { status: 404 });
    }

    // Internal shared page scripts/styles: prism://shared/<file>.
    // These are served from src/pages with an allowlist rather than exposing
    // arbitrary repository paths through the custom scheme.
    if (pathname.startsWith('/shared/')) {
      const rel = pathname.slice('/shared/'.length);
      if (!/^(theme-engine|common)(\.js|\.css)$/.test(rel)) return new Response('Forbidden', { status: 403 });
      const abs = safeJoin(PAGES_ROOT, rel);
      return abs ? serveFile(abs) : new Response('Not found', { status: 404 });
    }

    // Extension icons: prism://exticon/<extensionId>
    if (pathname.startsWith('/exticon/')) {
      const id = pathname.slice('/exticon/'.length);
      const entry = (settings_registry() || []).find((e) => e.id === id);
      if (entry && entry.icon && fs.existsSync(entry.icon)) return serveFile(entry.icon);
      const fallback = path.join(ASSETS_ROOT, 'icon-32.png');
      return serveFile(fallback);
    }

    // Internal pages: exact page name or a file within src/pages
    const rel = pathname.replace(/^\/+/, '');
    if (rel.includes('..') || rel.includes('\\')) return new Response('Forbidden', { status: 403 });
    const htmlCandidate = safeJoin(PAGES_ROOT, rel + '.html');
    if (htmlCandidate && fs.existsSync(htmlCandidate)) return serveFile(htmlCandidate);
    const fileCandidate = safeJoin(PAGES_ROOT, rel);
    if (fileCandidate && fs.existsSync(fileCandidate) && fs.statSync(fileCandidate).isFile()) {
      return serveFile(fileCandidate);
    }
    return new Response('Not found', { status: 404 });
}

function registerHandlers() {
  protocol.handle('prism', handlePrism);
}

// Tab views are created with `webPreferences.session` pointing at a custom
// partition (persist:prism / prism-private), and protocol.handle() on the
// top-level module only installs the handler on the DEFAULT session. Without
// this, no tab ever consults a handler, every prism:// load fails, and each
// page renders blank - which is exactly what happened.
function registerOnSession(ses) {
  if (ses && ses.protocol && typeof ses.protocol.handle === 'function') {
    ses.protocol.handle('prism', handlePrism);
  }
}

function settings_registry() {
  try { return require('./settings').all().extensions.registry; } catch (_) { return null; }
}

module.exports = { privilegedSchemes, registerHandlers, registerOnSession };
