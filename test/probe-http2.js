// Pin down exactly what DDG is returning: dump the anomaly marker and try a
// second request with a browser UA + cookie to see whether that unblocks it.
const axios = require('axios');

const base = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://duckduckgo.com/'
};

function marker(html) {
  const checks = {
    anomaly: /anomalous traffic/i,
    challenge: /challenge-platform|_challenge/i,
    captcha: /captcha/i,
    ddg_anomaly: /Unfortunately, requests from your IP/i,
    result_link: /result__a|links_main__link/i,   // real html results
    lite_result: /result-link/i                    // real lite results
  };
  const out = {};
  for (const [k, re] of Object.entries(checks)) out[k] = re.test(html);
  return out;
}

(async () => {
  const jar = {};
  const withCookie = { ...base, Cookie: 'ax=1' };

  for (const [label, url, headers] of [
    ['html/ua', 'https://html.duckduckgo.com/html/?q=weather+tokyo', base],
    ['html/ua+cookie', 'https://html.duckduckgo.com/html/?q=weather+tokyo', withCookie],
    ['lite/ua', 'https://lite.duckduckgo.com/lite/?q=weather+tokyo', base],
    ['d.js', 'https://links.duckduckgo.com/d.js?q=weather+tokyo&kl=wt-wt&l=us-en&s=0&o=json', base]
  ]) {
    try {
      const r = await axios.get(url, { headers, timeout: 15000 });
      const html = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
      console.log(label + ' status=' + r.status + ' len=' + html.length +
        ' ' + JSON.stringify(marker(html)));
    } catch (e) {
      console.log(label + ' FAIL status=' + (e.response && e.response.status) + ' ' + e.message);
    }
    await new Promise((res) => setTimeout(res, 1200));
  }
  process.exit(0);
})();
