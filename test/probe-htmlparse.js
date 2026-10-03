// Probe: GET html.duckduckgo.com/html/ with full Chromium headers.
// Prints status, result count, and a slice around the first result block.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

async function go(q, s) {
  const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q) + (s ? '&s=' + s : '');
  const resp = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1'
    },
    signal: AbortSignal.timeout(10000)
  });
  const html = await resp.text();
  console.log('status=' + resp.status, 'len=' + html.length, 'q=' + q, 's=' + (s || 0));
  const n = (html.match(/result__a/g) || []).length;
  const ns = (html.match(/result__snippet/g) || []).length;
  const nad = (html.match(/result--ad/g) || []).length;
  console.log('result__a=' + n, 'result__snippet=' + ns, 'result--ad=' + nad);
  const i = html.indexOf('result__title');
  console.log('--- slice around first result__title ---');
  console.log(html.slice(Math.max(0, i - 400), i + 1400));
  const j = html.indexOf('result--ad');
  if (j >= 0) {
    console.log('--- slice around first ad ---');
    console.log(html.slice(Math.max(0, j - 300), j + 500));
  }
  return html;
}

(async () => {
  const html = await go('electron browser', 0);
  console.log('\n===== PAGINATION s=30 =====');
  try { await go('electron browser', 30); } catch (e) { console.log('pag fail', e.message); }
  // Different query to see if a challenge (202/anomaly) triggers on rapid repeat
  console.log('\n===== SECONDARY QUERY =====');
  try { await go('prism mushroom facts', 0); } catch (e) { console.log('fail', e.message); }
  process.exit(0);
})();
