// Dump the 202 body so we can see exactly what DDG is serving us.
const axios = require('axios');
(async () => {
  const r = await axios.get('https://html.duckduckgo.com/html/?q=weather+tokyo', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    timeout: 15000,
    validateStatus: () => true
  });
  console.log('status=' + r.status);
  const h = String(r.data);
  console.log('--- body ---');
  console.log(h.slice(1500, 6000).replace(/\n\s*\n/g, '\n'));
  process.exit(0);
})();
