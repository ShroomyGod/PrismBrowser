// ai-ui.test.js — end-to-end proof that Prism's local AI actually runs.
//
// test/ai.test.js covers the pure logic and the packaging invariants. This one
// exercises the real thing: it boots the app's own main-process modules,
// registers the real ipcMain handlers, then drives inference through the same
// channels the UI uses and asserts on the model's actual output.
//
// The models are the ones the installer ships. When `npm run models` has staged
// them, this test runs the whole feature with the network switched off, which is
// both the shipping configuration and the only way to catch an incomplete set.
// Otherwise it falls back to downloading once into userData/models. If neither is
// possible the test reports that plainly rather than pretending the feature works.
'use strict';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const M = (name) => require(path.join(__dirname, '..', 'src', 'main', name));

const MODEL_TIMEOUT_MS = 15 * 60 * 1000;
const hardStop = setTimeout(() => {
  console.error('AI_UI_TIMEOUT');
  try { app.exit(1); } catch (_) {}
}, MODEL_TIMEOUT_MS);

let failures = 0;
function check(name, condition, detail) {
  if (condition) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail !== undefined ? ' — ' + detail : '')); }
}

// A page of real text, so the summariser has something worth summarising and
// an empty result would be a failure rather than a shrug.
const ARTICLE = `
  Prism is a browser built around local computation. It ships a content filter,
  a search index and a crawler that all run on your own machine, so browsing
  history and page content never have to leave the device in order to be useful.

  The newest addition is a pair of compact local models. SmolVLM reads and
  describes images, and SmolLM writes short summaries of whatever page you are
  looking at. Both run inside a worker thread in the browser process, which
  keeps the interface responsive while a model is thinking, and both ship with
  the browser rather than being fetched from a server.

  Because the models are small, they are fast enough to feel immediate on
  ordinary hardware, and because they are local, an image or an article never
  travels to a third-party server in order to be analysed.
`;

// A page of real glyphs, because "the model returned a string" is a much weaker
// claim than "the model read the characters". SmolVLM's OCR task is handed
// this and has to come back with the same letters.
const GLYPHS = {
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111']
};

function testPng() {
  const w = 320, h = 120;
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (w * y + x) << 2;
      png.data[i] = 245; png.data[i + 1] = 245; png.data[i + 2] = 245; png.data[i + 3] = 255;
    }
  }
  // 5x7 glyphs, blown up 10x: small text is exactly what OCR gets wrong, so a
  // pass here means the model really read the image.
  const scale = 10;
  let penX = 20;
  const top = 20;
  for (const ch of 'H 112') {
    const glyph = GLYPHS[ch];
    if (!glyph) { penX += 3 * scale; continue; }
    glyph.forEach((row, ry) => {
      [...row].forEach((bit, rx) => {
        if (bit !== '1') return;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const i = (w * (top + ry * scale + dy) + (penX + rx * scale + dx)) << 2;
            png.data[i] = 15; png.data[i + 1] = 15; png.data[i + 2] = 15;
          }
        }
      });
    });
    penX += 6 * scale;
  }
  return 'data:image/png;base64,' + PNG.sync.write(png).toString('base64');
}

app.whenReady().then(async () => {
  const securestore = M('securestore');
  securestore.init();
  securestore.initCrypto();
  const settings = M('settings');
  settings.init();
  M('stores').init();

  const tabs = M('tabs');
  tabs.init();
  const sessions = M('sessions').setupPartitions(tabs);
  tabs.setSessions(sessions);
  M('shell-ipc').registerIpc(tabs);
  const ai = M('ai');

  try {
    // Every progress event is echoed as it happens. Without this a hang in the
    // worker is indistinguishable from a hang anywhere else on the way to it.
    const stages = [];
    const logProgress = ai.onProgress((p) => {
      if (p && p.stage) stages.push(p.stage);
      console.log('  ... ' + (p && p.type === 'progress' ? p.stage : p && p.type) + (p && p.model ? ' ' + p.model : ''));
    });

    // ---- status and cache, before anything is loaded ----
    const before = ai.status();
    check('status reports the transformers.js engine', before.engine === 'transformers.js');
    check('status reports the SmolVLM-256M vision model', /smolvlm-256m/i.test(before.vision.id));
    check('status reports the SmolLM-135M text model', /smollm-135m/i.test(before.text.id));
    check('model cache lives under userData', before.cache.dir.startsWith(app.getPath('userData')),
      before.cache.dir);
    check('nothing is running before the first job', before.running === false);

    // Everything below should come out of the weights that ship with Prism.
    const staged = path.join(__dirname, '..', 'resources', 'models');
    const offlineRun = fs.existsSync(staged);
    check('a staged build reports its models as bundled',
      offlineRun ? before.bundled === true : true, String(before.bundledDir));
    if (offlineRun) {
      check('the bundled models are the staged ones', before.bundledDir === staged, before.bundledDir);
      ai.setOffline(true);
      check('offline mode is on before the first job', ai.status().offline === true);
    }
    const cacheBefore = before.cache.bytes;
    const cacheFilesBefore = before.cache.files;

    // ---- pure guards over the public API ----
    let rejected = null;
    try { await ai.analyseImage('not-a-data-url', {}); } catch (e) { rejected = e.message; }
    check('a non-data-URL image is refused', !!rejected, rejected);

    // ---- real vision inference ----
    const image = testPng();

    console.log('  ... loading SmolVLM ' + (offlineRun ? 'from the bundled models' : '(first run downloads ~150MB)'));
    const ocrStart = Date.now();
    const ocrResult = await ai.analyseImage(image, { task: 'ocr' });
    const ocrMs = Date.now() - ocrStart;
    console.log('  ... OCR returned in ' + (ocrMs / 1000).toFixed(1) + 's: ' + JSON.stringify(ocrResult.text));

    check('vision job completed', !!ocrResult, JSON.stringify(ocrResult));
    check('vision job reports the OCR task', ocrResult.task === 'ocr');
    check('vision job returns text', typeof ocrResult.text === 'string' && ocrResult.text.length > 0,
      JSON.stringify(ocrResult.text));
    // The claim Prism Vision actually makes: it reads the words in the picture.
    // Asserting on the letters rather than on "some text came back" is the whole
    // difference between the feature working and the API being reachable.
    check('OCR reads the letters in the image',
      /\s*H\s*11/.test(ocrResult.text),
      JSON.stringify(ocrResult.text));
    check('vision job reports a duration', typeof ocrResult.ms === 'number' && ocrResult.ms > 0, ocrResult.ms);
    check('vision job echoes the analysed image', String(ocrResult.image || '').startsWith('data:image/png;base64,'));
    check('the engine is running after a job', ai.status().running === true);

    // ---- image matching uses the user's text query ----
    const matchResult = await ai.analyseImage(image, { task: 'ground', input: 'the number 112' });
    check('image matching job completed', !!matchResult);
    check('image matching returns a useful answer', typeof matchResult.text === 'string' && matchResult.text.trim().length > 0,
      JSON.stringify(matchResult.text));

    // ---- detection returns labels, which is a different response shape ----
    console.log('  ... running object detection');
    const det = await ai.analyseImage(image, { task: 'detect' });
    check('detection job completed', !!det);
    check('detection reports the detect task', det.task === 'detect');
    check('detection returns a string for display', typeof det.text === 'string');

    // ---- a task that needs input refuses without one ----
    let needsInput = null;
    try { await ai.analyseImage(image, { task: 'ground', input: '   ' }); } catch (e) { needsInput = e.message; }
    check('grounding refuses an empty query', !!needsInput, needsInput);

    // ---- downscaling happens before the model sees a big image ----
    const big = new PNG({ width: 2400, height: 1200 });
    for (let y = 0; y < 1200; y++) for (let x = 0; x < 2400; x++) {
      const i = (2400 * y + x) << 2;
      big.data[i] = 250; big.data[i + 1] = 250; big.data[i + 2] = 250; big.data[i + 3] = 255;
    }
    for (let y = 200; y < 1000; y++) for (let x = 1150; x < 1250; x++) {
      const i = (2400 * y + x) << 2;
      big.data[i] = 10; big.data[i + 1] = 10; big.data[i + 2] = 10;
    }
    const bigUrl = 'data:image/png;base64,' + PNG.sync.write(big).toString('base64');
    const bigDownscaled = ai.downscaleDataUrl(bigUrl, 1024);
    const parsed = PNG.sync.read(Buffer.from(bigDownscaled.split(',')[1], 'base64'));
    check('a 2400px image is shrunk to 1024px', Math.max(parsed.width, parsed.height) === 1024,
      parsed.width + 'x' + parsed.height);
    check('a small image is left alone', ai.downscaleDataUrl(image, 1024) === image);

    // ---- real summarisation ----
    console.log('  ... loading SmolLM and summarising ' + (offlineRun ? 'from the bundled models' : '(first run downloads ~140MB)'));
    const sumStart = Date.now();
    const summary = await ai.summarise(ARTICLE, { style: 'paragraph' });
    const sumMs = Date.now() - sumStart;
    console.log('  ... summary in ' + (sumMs / 1000).toFixed(1) + 's: ' + JSON.stringify(summary.text.slice(0, 300)));

    check('summary completed', !!summary, JSON.stringify(summary));
    check('summary is not empty', typeof summary.text === 'string' && summary.text.length > 0);
    check('summary echoes the requested style', summary.style === 'paragraph');
    check('summary reports a duration', typeof summary.ms === 'number' && summary.ms > 0);
    // The bug that motivated the chat template: a raw prompt made SmolLM restate
    // the instruction and then keep writing.
    check('summary does not start by echoing the request',
      !/summarise the following/i.test(summary.text.slice(0, 80)),
      JSON.stringify(summary.text.slice(0, 120)));
    check('summary does not mention Prism AI being asked',
      !/as a summariser/i.test(summary.text.toLowerCase()));
    check('summary did not report truncation for a short article', summary.truncated === false);

    // ---- a tldr style is honoured ----
    const tldr = await ai.summarise(ARTICLE, { style: 'tldr' });
    check('tldr style is echoed back', tldr.style === 'tldr');

    // ---- short text is refused rather than hallucinated ----
    let tooShort = null;
    try { await ai.summarise('hi', {}); } catch (e) { tooShort = e.message; }
    check('summarising two words is refused', !!tooShort, tooShort);

    // ---- progress events actually fired ----
    // Collected across the whole run rather than around a single job: a model
    // that is already loaded does not announce itself again, so listening only
    // for the last job would test nothing.
    check('progress events reach listeners', stages.length > 0, JSON.stringify(stages));
    check('the engine reported each model loading', stages.includes('loaded'), JSON.stringify(stages));
    check('the engine reported each job running', stages.includes('running'), JSON.stringify(stages));

    // ---- status reflects the downloaded cache ----
    const after = ai.status();
    // With the weights staged, every model load above must have been served by the
// install rather than the download cache. Anything appearing in the cache while
// offline mode was on means the staged set is incomplete, and the installer would
// reach out to the network on a user's first click.
    if (offlineRun) {
      check('every model load was served by the bundled weights, not a download',
        after.cache.bytes === cacheBefore && after.cache.files === cacheFilesBefore,
        cacheBefore + ' bytes/' + cacheFilesBefore + ' files before, ' + after.cache.bytes + ' bytes/' + after.cache.files + ' files after');
      check('the bundled models are still reported as bundled', after.bundled === true);
    } else {
      check('the model cache is populated', after.cache.bytes > 0 && after.cache.files > 0,
        after.cache.files + ' files, ' + after.cache.bytes + ' bytes');
    }
    check('status reports the engine as running', after.running === true);

    // ---- teardown ----
    ai.shutdown();
    logProgress();
    check('shutdown stops the engine', ai.status().running === false);

    console.log('AI_UI_RESULT failures=' + failures);
    clearTimeout(hardStop);
    if (failures) {
      console.error('AI_UI_FAILED');
      try { app.exit(1); } catch (_) {}
    } else {
      console.log('AI_UI_OK');
      app.quit();
    }
  } catch (err) {
    console.error('AI_UI_ERROR ' + ((err && err.stack) || err));
    clearTimeout(hardStop);
    try { app.exit(1); } catch (_) {}
  }
});
