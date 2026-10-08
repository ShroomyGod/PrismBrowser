'use strict';

const { app } = require('electron');
const { performance } = require('perf_hooks');
const ai = require('../src/main/ai');
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
const timeout = setTimeout(() => {
  console.error('AI_PERFORMANCE_TIMEOUT');
  ai.shutdown();
  app.exit(1);
}, 180000);

app.whenReady().then(async () => {
  try {
    const progress = ai.onProgress((event) => {
      if (event && event.stage) console.log('AI_STAGE=' + event.stage + (event.model ? ':' + event.model : ''));
    });
    const started = performance.now();
    const cold = await ai.summarise(ARTICLE, { style: 'paragraph' });
    const coldWallMs = Math.round(performance.now() - started);
    const warmStarted = performance.now();
    const warm = await ai.summarise(ARTICLE, { style: 'paragraph' });
    const warmWallMs = Math.round(performance.now() - warmStarted);
    if (!cold.text || !warm.text) throw new Error('Summarizer returned empty text');
    if (/to summarize the summary|summary of the summary/i.test(warm.text) || /\bundefined\b/i.test(warm.text)) {
      throw new Error('Summarizer returned an off-topic result: ' + warm.text);
    }
    if (warm.text.trim().length < 80) throw new Error('Summarizer returned too little content: ' + warm.text);
    console.log('AI_COLD_WALL_MS=' + coldWallMs + ' AI_COLD_WORKER_MS=' + cold.ms + ' AI_COLD_CHARS=' + cold.text.length);
    console.log('AI_WARM_WALL_MS=' + warmWallMs + ' AI_WARM_WORKER_MS=' + warm.ms + ' AI_WARM_CHARS=' + warm.text.length);
    console.log('AI_WARM_SUMMARY=' + JSON.stringify(warm.text));
    console.log('AI_PERFORMANCE_OK');
    progress();
    clearTimeout(timeout);
    ai.shutdown();
    app.quit();
  } catch (error) {
    clearTimeout(timeout);
    ai.shutdown();
    console.error('AI_PERFORMANCE_ERROR=' + (error && error.stack || error));
    app.exit(1);
  }
}).catch((error) => {
  clearTimeout(timeout);
  ai.shutdown();
  console.error('AI_PERFORMANCE_BOOT_ERROR=' + (error && error.stack || error));
  app.exit(1);
});
