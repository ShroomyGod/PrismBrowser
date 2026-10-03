// Does DDG challenge us because our headers look non-browser? Try the classic
// POST form endpoint and the lite endpoint with a complete Chromium header set.
const axios = require('axios');

const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'Connection': 'keep-alive'
};

function summarize(label, status, data) {
  const h = typeof data === 'string' ? data : JSON.stringify(data || '');
  const hasAnomaly = /anomaly-modal|Unfortunately, bots/i.test(h);
  const hasResults = /result__a|result-link|links_main/i.test(h);
  console.log(label + ' status=' + status + ' len=' + h.length +
    ' anomaly=' + hasAnomaly + ' results=' + hasResults);
  if (!hasAnomaly && !hasResults) console.log('   head=' + h.slice(0, 140).replace(/\s+/g, ' '));
}

(async () => {
  // 1. POST form (classic html endpoint)
  try {
    const r = await axios.post('https://html.duckduckgo.com/html/',
      new URLSearchParams({ q: 'weather tokyo', b: '', kl: 'wt-wt' }).toString(),
      { headers: { ...H, 'Content-Type': 'application/x-www-form-urlencoded',
                   Referer: 'https://html.duckduckgo.com/' },
        timeout: 15000, validateStatus: () => true });
    summarize('POST-html', r.status, r.data);
  } catch (e) { console.log('POST-html FAIL ' + e.message); }

  await new Promise((r) => setTimeout(r, 1500));

  // 2. GET lite with full headers
  try {
    const r = await axios.get('https://lite.duckduckgo.com/lite/',
      { params: { q: 'weather tokyo', kl: 'wt-wt' }, headers: H,
        timeout: 15000, validateStatus: () => true });
    summarize('GET-lite', r.status, r.data);
  } catch (e) { console.log('GET-lite FAIL ' + e.message); }

  await new Promise((r) => setTimeout(r, 1500));

  // 3. html GET with full headers
  try {
    const r = await axios.get('https://html.duckduckgo.com/html/',
      { params: { q: 'weather tokyo' }, headers: H,
        timeout: 15000, validateStatus: () => true });
    summarize('GET-html', r.status, r.data);
  } catch (e) { console.log('GET-html FAIL ' + e.message); }

  process.exit(0);
})().catch((e) => { console.error('ERR=' + e.message); process.exit(1); });
