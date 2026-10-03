// The package assigns `this.logger = console` but calls logger.warning(),
// which console lacks — so it always throws and swallows the failure.
// Provide a logger with the methods it expects, then probe the real API.
const ddg = require('duckduckgo-search');
ddg.logger = {
  warning: (...a) => console.error('[warn]', ...a),
  error: (...a) => console.error('[err]', ...a),
  info: () => {},
  debug: () => {},
  log: () => {}
};

(async () => {
  try {
    const gen = ddg.text('weather tokyo', 'wt-wt', 'moderate', null, 1, 'any');
    let n = 0;
    for await (const r of gen) {
      console.log('RESULT', JSON.stringify({
        title: r.title, href: r.href, body: (r.body || '').slice(0, 90)
      }));
      if (++n >= 3) break;
    }
    console.log('COUNT=' + n);
    process.exit(n > 0 ? 0 : 2);
  } catch (e) {
    console.error('ERR=' + e.message);
    process.exit(1);
  }
})();
