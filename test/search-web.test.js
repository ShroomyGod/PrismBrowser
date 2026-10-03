// Prism Search / SearXNG backend tests. Fully offline and deterministic:
// substitute environment endpoints and mock their JSON responses.
const sw = require('../src/main/prism-search-web');

function assert(condition, message) {
  if (!condition) throw new Error('FAIL: ' + message);
  console.log('OK: ' + message);
}

(async () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.PRISM_SEARXNG_URL;
  const originalFallbacks = process.env.PRISM_SEARXNG_FALLBACKS;
  let fetches = [];
  try {
    process.env.PRISM_SEARXNG_URL = 'http://local.test:8080';
    process.env.PRISM_SEARXNG_FALLBACKS = 'https://one.test,https://two.test';
    sw._reset();
    global.fetch = async (url) => {
      const u = new URL(url);
      fetches.push(u);
      if (u.hostname === 'local.test') return { ok: false, status: 404 };
      if (u.hostname === 'one.test') return {
        ok: true, status: 200,
        json: async () => ({ results: [
          { url: 'https://example.test/a#top', title: '<b>Example A</b>', content: '<p>First snippet</p>', score: 2, engines: ['one'] },
          { url: 'https://shared.test/item', title: 'Shared item', content: 'One source', score: 1, engines: ['one'] },
          { url: 'https://one.test/own', title: 'Instance home', content: 'Must be filtered' }
        ] })
      };
      return {
        ok: true, status: 200,
        json: async () => ({ results: [
          { url: 'https://shared.test/item', title: 'Shared item', content: 'A longer merged snippet', score: 4, engines: ['two'] },
          { url: 'https://two.test/own', title: 'Instance home', content: 'Must be filtered' }
        ] })
      };
    };

    const rows = await sw.searchWeb('sample query');
    assert(fetches.length === 2, 'local is tried first, then one free public instance is used as fallback');
    assert(fetches[0].hostname === 'local.test' && fetches[1].hostname === 'one.test', 'local SearXNG is preferred before public services');
    assert(fetches.every((u) => u.pathname === '/search' && u.searchParams.get('format') === 'json'), 'requests use the documented JSON search API');
    assert(rows.length === 2, 'SearXNG result set is normalized and filtered');
    assert(rows[0].url === 'https://example.test/a', 'result URL fragment is removed');
    assert(rows[0].title === 'Example A' && rows[0].host === 'example.test', 'HTML fields are normalized');
    assert(rows.find((r) => r.url === 'https://shared.test/item').snippet === 'One source', 'snippet metadata is retained');
    assert(rows.every((r) => r.web && !JSON.stringify(r).toLowerCase().includes('searx') && !JSON.stringify(r).toLowerCase().includes('duckduckgo')), 'public results show Prism branding only');

    const count = fetches.length;
    const cached = await sw.searchWeb('SAMPLE QUERY');
    assert(cached.length === rows.length && fetches.length === count, 'case-insensitive repeat query is cached');
    assert(sw.stats().engine === 'Prism Search', 'backend reports Prism Search branding');

    sw._reset();
    fetches = [];
    global.fetch = async (url) => {
      fetches.push(new URL(url));
      return { ok: false, status: 403 };
    };
    const failed = await sw.searchWeb('failure query');
    assert(Array.isArray(failed) && failed.length === 0, 'unavailable JSON APIs fail gracefully for local-index fallback');
    const afterFailure = fetches.length;
    await sw.searchWeb('another failure query');
    assert(fetches.length === afterFailure, 'failing instances are temporarily cooled down');
    assert((await sw.searchWeb('')).length === 0, 'empty query returns no results');

    console.log('SEARCH_WEB_OK');
  } finally {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.PRISM_SEARXNG_URL;
    else process.env.PRISM_SEARXNG_URL = originalUrl;
    if (originalFallbacks === undefined) delete process.env.PRISM_SEARXNG_FALLBACKS;
    else process.env.PRISM_SEARXNG_FALLBACKS = originalFallbacks;
    sw._reset();
  }
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
