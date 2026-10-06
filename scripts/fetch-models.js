// fetch-models.js — stage Prism's local AI models for packaging.
//
// Installing Prism should not require the user to fetch models by hand (and
// certainly should not require them to install a separate runtime like Ollama).
// This script downloads every file the worker will ask transformers.js for, into
// `resources/models`, using transformers.js itself as the downloader so the set
// of files is exactly what a real load needs — config, tokenizer, preprocessor
// and the quantised ONNX sessions.
//
// The layout transformers.js uses for its file cache is
// `<root>/<repo-id>/<filename>`, which is byte-for-byte the layout it looks in
// for `env.localModelPath`. Staging into the cache directory therefore produces a
// directory that can be dropped straight into `process.resourcesPath` and used
// offline. test/ai.test.js asserts that the two paths agree.
//
//   npm run models                          download/stage whatever is missing
//   npm run models -- --force               re-download everything from scratch
//
// Requires network access the first time; afterwards it is a no-op.
'use strict';

const fs = require('fs');
const path = require('path');
const tasks = require('../src/ai/tasks');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'resources', 'models');
const MARKER = path.join(OUT, 'prism-models.json');

function human(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function treeSize(dir) {
  let bytes = 0;
  let files = 0;
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const abs = path.join(d, entry.name);
      if (entry.isDirectory()) walk(abs);
      else {
        try { bytes += fs.statSync(abs).size; files++; } catch (_) { /* raced */ }
      }
    }
  };
  walk(dir);
  return { bytes, files };
}

// transformers.js reports per-file download progress. Collapse it to one line
// per file so large model files do not produce megabytes of terminal noise.
function makeReporter(label) {
  const seen = new Map();
  return (payload) => {
    if (!payload || !payload.file) return;
    if (payload.status === 'progress') {
      seen.set(payload.file, payload.loaded || 0);
      return;
    }
    if (payload.status === 'done') {
      const loaded = seen.get(payload.file) || 0;
      console.log(`    ${label}/${payload.file}${loaded ? ` (${human(loaded)})` : ''}`);
    }
  };
}

async function stage(transformers, spec, loaders) {
  console.log(`  ${spec.label} — ${spec.id} (${spec.dtype})`);
  const progress_callback = makeReporter(spec.id.split('/')[1]);
  for (const [name, run] of Object.entries(loaders)) {
    process.stdout.write(`    ${name}…`);
    await run(progress_callback);
    process.stdout.write('\r');
  }
}

async function main() {
  const force = process.argv.includes('--force');
  if (force && fs.existsSync(OUT)) {
    console.log('  --force: discarding the staged models first.');
    fs.rmSync(OUT, { recursive: true, force: true });
  }

  fs.mkdirSync(OUT, { recursive: true });
  console.log(`Staging models into ${path.relative(ROOT, OUT)}`);

  // eslint-disable-next-line global-require
  const t = require('@huggingface/transformers');
  t.env.cacheDir = OUT;
  // Stage by downloading only. Local lookups are what the shipped app does at
  // runtime; here they would let a half-finished previous run masquerade as a
  // complete one.
  t.env.allowLocalModels = false;
  t.env.allowRemoteModels = true;

  const vision = tasks.VISION_MODELS;
  await stage(t, vision, {
    model: (progress_callback) =>
      t.SmolVLMForConditionalGeneration.from_pretrained(vision.id, { dtype: vision.dtype, progress_callback }),
    processor: (progress_callback) => t.AutoProcessor.from_pretrained(vision.id, { progress_callback })
  });

  const text = tasks.TEXT_MODELS;
  await stage(t, text, {
    model: (progress_callback) =>
      t.AutoModelForCausalLM.from_pretrained(text.id, { dtype: text.dtype, progress_callback }),
    tokenizer: (progress_callback) => t.AutoTokenizer.from_pretrained(text.id, { progress_callback })
  });

  const translation = tasks.TRANSLATION_MODEL;
  await stage(t, translation, {
    model: (progress_callback) =>
      t.AutoModelForSeq2SeqLM.from_pretrained(translation.id, { dtype: translation.dtype, progress_callback }),
    tokenizer: (progress_callback) => t.AutoTokenizer.from_pretrained(translation.id, { progress_callback })
  });
  const translationRoot = path.join(OUT, ...translation.id.split('/'));
  const missingTranslationFiles = translation.requiredFiles
    .map((file) => path.join(translationRoot, ...file.split('/')))
    .filter((file) => !fs.existsSync(file));
  if (missingTranslationFiles.length) {
    throw new Error('Translation model is incomplete; missing ' + path.relative(OUT, missingTranslationFiles[0]));
  }

  // Remove only the previous AI model folders after the replacements have
  // loaded successfully, so failed downloads never destroy the last usable set.
  for (const oldId of [
    'onnx-community/Florence-2-base-ft',
    'HuggingFaceTB/SmolLM2-135M-Instruct',
    'Xenova/opus-mt-en-es'
  ]) {
    fs.rmSync(path.join(OUT, ...oldId.split('/')), { recursive: true, force: true });
  }

  const size = treeSize(OUT);
  fs.writeFileSync(
    MARKER,
    `${JSON.stringify(
      {
        generatedFor: 'Prism',
        models: [vision, text, translation].map((m) => ({ id: m.id, dtype: m.dtype, label: m.label })),
        bytes: size.bytes,
        files: size.files
      },
      null,
      2
    )}\n`
  );

  console.log(`\nStaged ${size.files} files, ${human(size.bytes)}.`);
  console.log('electron-builder copies this directory into the installer via build.extraResources.');
  console.log('Run `npm run models` again after changing a model id or dtype in src/ai/tasks.js.');
}

main().catch((err) => {
  console.error('\nCould not stage the models:', (err && err.message) || err);
  console.error('Prism can still be built without them — it downloads on first use instead —');
  console.error('but the installer will then need network access on the user’s first run.');
  process.exit(1);
});