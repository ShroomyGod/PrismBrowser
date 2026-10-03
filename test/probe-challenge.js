// Dump the full 202 challenge so we can see what DDG wants us to compute.
const axios = require('axios');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

(async () => {
  const r = await axios.get('https://links.duckduckgo.com/d.js', {
    params: { q: 'weather tokyo', vqd: '4-7826230128347558253905', kl: 'wt-wt',
              l: 'us-en', s: '0', o: 'json' },
    headers: { 'User-Agent': UA, 'Referer': 'https://duckduckgo.com/' },
    timeout: 15000, validateStatus: () => true
  });
  console.log('status=' + r.status);
  console.log('set-cookie=' + JSON.stringify(r.headers['set-cookie']));
  console.log('content-type=' + r.headers['content-type']);
  console.log('===== BODY =====');
  console.log(String(r.data));
  process.exit(0);
})().catch((e) => { console.error('ERR=' + e.message); process.exit(1); });
