// The library sends no User-Agent, so DDG challenges it. Axios lets us inject
// browser defaults, which its request() call will inherit. Verify that makes
// the library return real results.
const axios = require('axios');

axios.defaults.headers.common['User-Agent'] =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
axios.defaults.headers.common['Accept-Language'] = 'en-US,en;q=0.9';
axios.defaults.headers.common['Accept'] =
  'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
axios.defaults.headers.common['Sec-Fetch-Dest'] = 'document';
axios.defaults.headers.common['Sec-Fetch-Mode'] = 'navigate';
axios.defaults.headers.common['Sec-Fetch-Site'] = 'none';
axios.defaults.headers.common['sec-ch-ua-platform'] = '"Windows"';

const ddg = require('duckduckgo-search');
ddg.logger = {
  warning: (...a) => console.error('[warn]', ...a.join(' ')),
  error: (...a) => console.error('[err]', ...a.join(' ')),
  info: () => {}, debug: () => {}, log: () => {}
};

(async () => {
  try {
    const gen = ddg.text('weather tokyo');
    let n = 0;
    for await (const r of gen) {
      console.log('HIT ' + JSON.stringify({
        t: r.title, u: r.href || r.url, b: (r.body || '').slice(0, 60)
      }));
      if (++n >= 4) break;
    }
    console.log('COUNT=' + n);
    console.log(n > 0 ? 'LIB_OK' : 'LIB_EMPTY');
    process.exit(n > 0 ? 0 : 2);
  } catch (e) {
    console.error('ERR=' + e.message);
    process.exit(1);
  }
})();
