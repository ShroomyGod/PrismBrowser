// Verifies the encrypted vault actually persists data across process restarts.
// Each phase runs in its own Electron process, exactly like a real relaunch.
const { app } = require('electron');
const path = require('path');

const MODE = process.argv[2]; // 'write' | 'verify'
const securestore = require(path.join(__dirname, '..', 'src', 'main', 'securestore.js'));
const settings = require(path.join(__dirname, '..', 'src', 'main', 'settings.js'));

app.whenReady().then(async () => {
  securestore.init();
  securestore.initCrypto();
  settings.init();

  const st = securestore.status();
  console.log('KEYRING=' + st.keyring);
  console.log('ENCRYPTED=' + st.encrypted);

  if (MODE === 'write') {
    settings.set({ dns: { provider: 'quad9' }, search: { defaultEngine: 'bing' } });
    securestore.flushAll();
    console.log('WROTE_PROVIDER=' + settings.all().dns.provider);
    console.log('BOOTSTRAP=' + JSON.stringify(securestore.loadBootstrap()));
    app.quit(0);
    return;
  }

  if (MODE === 'verify') {
    const provider = settings.all().dns.provider;
    const engine = settings.all().search.defaultEngine;
    console.log('READ_PROVIDER=' + provider);
    console.log('READ_ENGINE=' + engine);
    const ok = provider === 'quad9' && engine === 'bing';
    console.log(ok ? 'PERSISTENCE_OK' : 'PERSISTENCE_FAIL');
    app.quit(ok ? 0 : 1);
    return;
  }

  app.quit(2);
});
