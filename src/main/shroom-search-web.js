// Retired: this module was renamed to prism-search-web.js as part of the
// Shroom -> Prism rebrand. It remains only as a forwarder so any stale
// require() keeps working; new code should require('./prism-search-web').
//
// Note: the PRISM_SEARXNG_URL / PRISM_SEARXNG_FALLBACKS overrides previously
// spelled SHROOM_*. They now read only the PRISM_* names, so any environment
// still exporting the old SHROOM_* variables must be updated.
module.exports = require('./prism-search-web');