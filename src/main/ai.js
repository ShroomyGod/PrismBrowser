// ai.js — main-process owner of Prism's local AI worker.
//
// One long-lived worker thread does all inference. The main process never
// touches onnxruntime directly, so a slow or failing model cannot stall the
// browser: jobs are queued, every one has a timeout, and a worker that dies
// mid-job fails that job rather than taking the app with it.
//
// Models ship inside the installer (see scripts/fetch-models.js and
// build.extraResources) and are read from resources/models, so an installed Prism
// works offline on first use. Anything the installer did not stage — a model added
// after this build, say — is downloaded once into userData/models and cached there.
'use strict';

const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { app } = require('electron');
const { PNG } = require('pngjs');
const tasks = require('../ai/tasks');

const WORKER_PATH = path.join(__dirname, '..', 'ai', 'worker.js');

// A cold SmolVLM load plus first inference can take a while on a laptop CPU, and a
// long page can push SmolLM past a minute. Generous, but finite.
//
// This is an *idle* timeout, not a total one: it is pushed forward every time the
// worker reports progress for the job. Without that, a first run that still has to
// download 334MB of weights would be killed mid-download and the user would be
// told the engine failed rather than that it is fetching a model. See extend().
const JOB_TIMEOUT_MS = 180000;
const START_TIMEOUT_MS = 30000;

let worker = null;
let ready = false;
let starting = null;
let queue = Promise.resolve();
const pending = new Map();
let nextId = 1;
// When true the worker refuses to reach the network at all and will only use the
// bundled weights. Restarting the worker is required for it to take effect, so
// this terminates rather than trying to reconfigure a running model.
let offline = false;

function setOffline(on) {
  const next = !!on;
  if (next === offline) return offline;
  offline = next;
  terminate();
  return offline;
}

function modelsDir() {
  return path.join(app.getPath('userData'), 'models');
}

// Where the installer puts the models that ship with Prism. electron-builder
// copies `resources/models` to `<resources>/models` (build.extraResources); in a
// dev checkout the same directory sits in the repo, so a developer who has run
// `npm run models` gets the offline path too.
//
// These files are part of the application and are treated as read-only: they are
// never written to, never counted as "downloaded", and never removed by
// clearCache(). Returns null when there is nothing bundled, which is the signal
// to fall back to downloading into modelsDir().
function bundledModelsDir() {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'models')]
    : [path.join(__dirname, '..', '..', 'resources', 'models')];
  for (const dir of candidates) {
    try {
      if (fs.statSync(dir).isDirectory()) return dir;
    } catch (_) { /* not bundled in this build */ }
  }
  return null;
}

function cacheStats() {
  const dir = modelsDir();
  let bytes = 0;
  let files = 0;
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const abs = path.join(d, entry.name);
      if (entry.isDirectory()) walk(abs);
      else {
        try { bytes += fs.statSync(abs).size; files++; } catch (_) { /* raced with a write */ }
      }
    }
  };
  walk(dir);
  return { dir, bytes, files };
}

function start() {
  if (worker) return starting || Promise.resolve(worker);
  if (starting) return starting;

  starting = new Promise((resolve, reject) => {
    let settled = false;
    const w = new Worker(WORKER_PATH, {
      workerData: {
        cacheDir: modelsDir(),
        localModelPath: bundledModelsDir(),
        offline
      }
    });
    worker = w;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      starting = null;
      // A worker that never answers to ping is not usable; drop it so the next
      // job starts clean instead of hanging forever.
      try { w.terminate(); } catch (_) { /* already gone */ }
      worker = null;
      ready = false;
      reject(new Error('The AI engine did not start.'));
    }, START_TIMEOUT_MS);

    const onPing = (msg) => {
      if (!msg || msg.type !== 'pong' || settled) return;
      settled = true;
      clearTimeout(timer);
      ready = true;
      starting = null;
      resolve(w);
    };

    w.on('message', (msg) => {
      if (!msg) return;
      if (msg.type === 'pong') return onPing(msg);
      if (msg.type === 'result') return settle(msg.id, null, msg.result);
      if (msg.type === 'error') return settle(msg.id, new Error(msg.error));
      // A job that reports progress has not stalled, so its deadline moves.
      if (msg.id !== undefined) extend(msg.id);
      return notify(msg);
    });

    w.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        starting = null;
        ready = false;
        worker = null;
        return reject(err);
      }
      notify({ stage: 'crashed', error: (err && err.message) || 'The AI engine stopped unexpectedly.' });
    });

    w.on('exit', (code) => {
      // Anything still waiting when the worker exits will never be answered.
      const message = new Error('The AI engine stopped unexpectedly.');
      for (const [, entry] of pending) entry.reject(message);
      pending.clear();
      ready = false;
      worker = null;
      starting = null;
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(message);
      }
      notify({ stage: 'stopped', code });
    });

    w.postMessage({ type: 'ping' });
  });

  return starting;
}

function notify(payload) {
  for (const fn of listeners) {
    try { fn(payload); } catch (_) { /* a bad listener must not kill the queue */ }
  }
}

const listeners = new Set();

function onProgress(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function settle(id, err, result) {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  clearTimeout(entry.timer);
  if (err) entry.reject(err);
  else entry.resolve(result);
}

function expire(id, reject) {
  pending.delete(id);
  // The worker is mid-inference and cannot be interrupted from here, so
  // terminate it and let the next job start a fresh one.
  terminate();
  reject(new Error('That took too long. The AI engine was restarted.'));
}

// Give a job that is still visibly working (downloading weights, loading a
// session, streaming progress) another full timeout window. A silently wedged
// worker sends nothing, so it still fails on the original deadline.
function extend(id) {
  const entry = pending.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => expire(id, entry.reject), JOB_TIMEOUT_MS);
}

function submit(job) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => expire(id, reject), JOB_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    try {
      // type: 'job' and kind: 'vision'|'summary' are the worker's contract; keep
      // the two in step (test/ai.test.js asserts it).
      worker.postMessage({ type: 'job', ...job, id });
    } catch (err) {
      pending.delete(id);
      clearTimeout(timer);
      reject(err);
    }
  });
}

// Serialised on purpose: two models loading at once on a laptop doubles peak
// memory and makes both slower. Queueing is invisible for a single click and
// keeps two rapid clicks from OOMing the tab process.
function enqueue(job) {
  const run = queue.then(() => start().then(() => submit(job)));
  // Keep the chain alive after a failure so one bad job does not poison the
  // queue for everything after it.
  queue = run.then(() => undefined, () => undefined);
  return run;
}

function terminate() {
  if (!worker) return;
  const w = worker;
  worker = null;
  ready = false;
  try { w.terminate(); } catch (_) { /* already gone */ }
}

function shutdown() {
  terminate();
  listeners.clear();
}

// Prism Vision accepts a pasted or dropped file as a data URL, which can be a
// 20MP phone photo. Re-encoding it at a sane size here (rather than in the
// renderer) keeps the base64 we hand to the worker small and makes the worker's
// only job inference. pngjs is a devDependency, so this stays in the main
// process where it is always available at build time but is never needed at
// runtime in the packaged app.
function downscaleDataUrl(dataUrl, maxEdge) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!match) return null;
  const [, mime, b64] = match;
  let source;
  try {
    source = PNG.sync.read(Buffer.from(b64, 'base64'));
  } catch (_) {
    // Unreadable or an exotic format: let the worker try, it has its own decoder.
    return dataUrl;
  }
  const limit = maxEdge || 1024;
  const longest = Math.max(source.width, source.height);
  if (longest <= limit) return dataUrl;

  const scale = limit / longest;
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const out = new PNG({ width, height });
  // Box filter: averaging every source pixel that falls in a destination cell.
  // Nearest-neighbour would drop thin strokes, which can hurt SmolVLM OCR.
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y / scale);
    const y1 = Math.min(source.height, Math.max(y0 + 1, Math.floor((y + 1) / scale)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x / scale);
      const x1 = Math.min(source.width, Math.max(x0 + 1, Math.floor((x + 1) / scale)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (source.width * sy + sx) << 2;
          r += source.data[i]; g += source.data[i + 1]; b += source.data[i + 2]; n++;
        }
      }
      const o = (width * y + x) << 2;
      out.data[o] = Math.round(r / n);
      out.data[o + 1] = Math.round(g / n);
      out.data[o + 2] = Math.round(b / n);
      out.data[o + 3] = 255;
    }
  }
  return 'data:image/png;base64,' + PNG.sync.write(out).toString('base64');
}

function status() {
  const bundled = bundledModelsDir();
  return {
    engine: 'transformers.js',
    running: ready,
    busy: pending.size > 0,
    queued: pending.size,
    // True when the models ship with the app and Prism Vision and summarising
    // work on a machine that has never been online.
    bundled: !!bundled,
    bundledDir: bundled,
    offline,
    cache: cacheStats(),
    vision: tasks.VISION_MODELS,
    text: tasks.TEXT_MODELS
  };
}

// --- public API -----------------------------------------------------------

// Captures the active tab and asks SmolVLM about it. Returns a data URL so
// the renderer can show exactly what was analysed.
async function analyseImage(dataUrl, options) {
  const opts = options || {};
  // Shrink before the size check: a 20MP photo is over the limit as base64 but
  // perfectly reasonable once it is 1024px on the long edge for local inference.
  const prepared = downscaleDataUrl(dataUrl, 1024);
  const match = /^data:([^;]+);base64,(.+)$/.exec(String(prepared || ''));
  if (!match) throw new Error('That image could not be read.');
  const [, mime, b64] = match;
  const MAX_BYTES = 12 * 1024 * 1024;
  if (Math.floor((b64.length * 3) / 4) > MAX_BYTES) throw new Error('That image is too large to analyse.');

  const result = await enqueue({
    kind: 'vision',
    image: b64,
    mime,
    task: opts.task || 'caption',
    input: opts.input || ''
  });
  return { ...result, image: prepared };
}

function summarise(text, options) {
  const opts = options || {};
  return enqueue({ kind: 'summary', text: String(text || ''), style: opts.style || 'paragraph' });
}

function translate(text, options) {
  const opts = options || {};
  const source = opts.source || tasks.TRANSLATION_DEFAULT_SOURCE;
  const target = opts.target || tasks.TRANSLATION_DEFAULT_TARGET;
  if (!tasks.translationLanguageFor(source) || !tasks.translationModelFor(target)) {
    return Promise.reject(new Error('Choose a language supported by the local translation model.'));
  }
  if (source === target) return Promise.reject(new Error('Choose two different languages to translate.'));
  const input = tasks.translationInput(String(text || ''));
  if (tasks.translationTooShort(input)) return Promise.reject(new Error('There is no readable page text to translate.'));
  return stageBundledTranslation().then(() => enqueue({
    kind: 'translation',
    text: input,
    truncated: tasks.translationWasTruncated(String(text || '')),
    source,
    target
  }));
}

function translationLanguages() {
  return tasks.TRANSLATION_LANGUAGES.slice();
}

function stageBundledTranslation(options) {
  const opts = options || {};
  const root = opts.root || bundledModelsDir();
  if (!root) return Promise.reject(new Error('Bundled translation model was not found.'));
  const modelRoot = path.join(root, ...tasks.TRANSLATION_MODEL.id.split('/'));
  const required = tasks.TRANSLATION_MODEL.requiredFiles.map((file) => path.join(modelRoot, ...file.split('/')));
  const missing = required.filter((file) => !fs.existsSync(file));
  if (missing.length) return Promise.reject(new Error('The bundled translation model is incomplete. Missing: ' + path.basename(missing[0])));
  // Transformers.js is already pointed at this installed model root. Return the
  // validated path for diagnostics; inference reads it in place and does not
  // copy the model into (or count it against) the profile download cache.
  return Promise.resolve(modelRoot);
}

function clearCache() {
  // Must stop the worker first: transformers.js holds open handles to the
  // files, and Windows refuses to delete a file that is mapped.
  terminate();
  // Only the download cache is touched. Bundled models belong to the install,
  // not to this user profile: deleting them would break the next launch.
  const dir = modelsDir();
  let removed = 0;
  let failed = null;
  try {
    for (const entry of fs.readdirSync(dir)) {
      fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
      removed++;
    }
  } catch (err) {
    if (err && err.code !== 'ENOENT') failed = err.message;
  }
  return { removed, error: failed };
}

module.exports = {
  analyseImage,
  summarise,
  translate,
  translationLanguages,
  stageBundledTranslation,
  status,
  cacheStats,
  clearCache,
  onProgress,
  shutdown,
  downscaleDataUrl,
  modelsDir,
  bundledModelsDir,
  setOffline,
  tasks
};
