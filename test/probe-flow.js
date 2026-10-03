// The library sends no User-Agent, so it gets challenged. Test the proper
// flow manually: fetch a vqd, then hit d.js with browser-like headers.
const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const hdrs = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://duckduckgo.com/'
};

const ok = (r) => (r.status === 200 ? '200' : String(r.status));

(async () => {
  // 1. vqd
  const home = await axios.get('https://duckduckgo.com/', {
    params: { q: 'weather tokyo' }, headers: hdrs, timeout: 15000, validateStatus: () => true
  });
  const html = String(home.data);
  console.log('HOME status=' + ok(home) + ' len=' + html.length);
  let vqd = null;
  for (const [a, b] of [['vqd="', '"'], ['vqd=', '&'], ["vqd='", "'"]]) {
    const i = html.indexOf(a);
    if (i >= 0) { vqd = html.substring(i + a.length, html.indexOf(b, i + a.length)); break; }
  }
  console.log('VQD=' + (vqd ? vqd.slice(0, 24) + '...' : 'NONE'));
  if (!vqd) { console.log('RESULT=NO_VQD'); process.exit(2); }

  // 2. results
  await new Promise((r) => setTimeout(r, 800));
  const res = await axios.get('https://links.duckduckgo.com/d.js', {
    params: { q: 'weather tokyo', vqd, kl: 'wt-wt', l: 'us-en', s: '0', o: 'json', dc: '1', v: 'l' },
    headers: hdrs, timeout: 15000, validateStatus: () => true
  });
  const body = String(res.data);
  console.log('DJS status=' + ok(res) + ' len=' + body.length);
  console.log('DJS head=' + body.slice(0, 200).replace(/\s+/g, ' '));

  if (res.status === 200) {
    try {
      const j = JSON.parse(body);
      const results = (j.results || []).slice(0, 3).map((r) => ({ t: r.title, u: r.url }));
      console.log('JSON_RESULTS=' + JSON.stringify(results));
      console.log('RESULT=' + (results.length ? 'OK' : 'EMPTY'));
    } catch (_) {
      // ddg returns a JS array literal, not strict JSON
      const m = body.match(/"t":"(.*?)".*?"u":"(.*?)"/g);
      console.log('NONJSON_MATCHES=' + (m ? m.length : 0));
      console.log('RESULT=' + (m && m.length ? 'OK_LOOSE' : 'UNKNOWN'));
    }
  } else {
    console.log('RESULT=CHALLENGE status=' + res.status);
  }
  process.exit(0);
})().catch((e) => { console.error('ERR=' + e.message); process.exit(1); });
