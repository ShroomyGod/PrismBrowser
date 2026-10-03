// Diagnose why the scraper fails: hit the two endpoints directly and report
// status, headers and a body sample for each.
const axios = require('axios');

const hdrs = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};

(async () => {
  for (const url of [
    'https://duckduckgo.com/?q=weather+tokyo',
    'https://html.duckduckgo.com/html/?q=weather+tokyo',
    'https://lite.duckduckgo.com/lite/?q=weather+tokyo'
  ]) {
    try {
      const r = await axios.get(url, { headers: hdrs, timeout: 15000, maxRedirects: 5 });
      const body = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
      const hasVqd = /vqd[="'']/.test(body);
      const blocked = /anomaly|challenge|captcha|robot|If this error persists/i.test(body);
      console.log('OK status=' + r.status + ' len=' + body.length +
        ' vqd=' + hasVqd + ' blocked=' + blocked + ' url=' + url);
      console.log('   sample=' + body.replace(/\s+/g, ' ').slice(0, 160));
    } catch (e) {
      const st = e.response && e.response.status;
      const data = e.response && e.response.data;
      console.log('FAIL status=' + st + ' url=' + url + ' msg=' + e.message);
      if (data) console.log('   body=' + String(data).replace(/\s+/g, ' ').slice(0, 200));
    }
  }
  process.exit(0);
})();
