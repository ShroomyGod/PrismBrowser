// worker.js — Prism's local AI, in a worker thread.
//
// Runs in the main process's worker pool rather than a renderer or the main
// thread: onnxruntime inference is synchronous and CPU-heavy, so it would
// otherwise freeze tab UI. `worker_threads` also keeps it off Electron's
// renderer lifecycle, which is where most GPU/memory conflicts come from.
//
// Models load lazily on first use. They are read from `localModelPath` first —
// the weights that ship inside the installer — and anything not found there is
// downloaded once into `cacheDir` (userData/models) and reused from then on. Both
// paths are handed in by ai.js, so a packaged Prism never touches the network.
'use strict';

const path = require('path');
const { parentPort, workerData } = require('worker_threads');
const tasks = require('./tasks');
const os = require('os');
const CPU_THREADS = Math.max(1, Math.min(4, typeof os.availableParallelism === 'function'
  ? os.availableParallelism()
  : os.cpus().length));
const CPU_SESSION_OPTIONS = { intraOpNumThreads: CPU_THREADS, interOpNumThreads: 1 };

// Loaded lazily on the first job. Requiring transformers.js at module scope
// costs ~100ms and pulls in sharp, which is wasted if the user never uses AI.
let transformers = null;
let vision = { model: null, processor: null };
let text = { model: null, tokenizer: null };
let translation = { model: null, tokenizer: null };
let loading = null;
// Progress is tagged with the job it belongs to so the main process can keep a
// downloading job alive without also masking a stall in an unrelated one.
let currentJobId = null;

function loadTransformers() {
  if (!transformers) {
    // eslint-disable-next-line global-require
    transformers = require('@huggingface/transformers');
    transformers.env.cacheDir = workerData.cacheDir;
    // Look in the bundled weights first; this is what makes an installed Prism
    // work with no network at all.
    if (workerData.localModelPath) transformers.env.localModelPath = workerData.localModelPath;
    // The renderer and the shell must never be blocked on a model download.
    transformers.env.allowLocalModels = true;
    // Offline mode: everything must come from the bundled weights, and a missing
    // file becomes an error rather than a surprise download. test/ai-ui.test.js
    // turns this on so a release cannot pass while quietly fetching from the
    // network instead of using what the installer shipped.
    if (workerData.offline) transformers.env.allowRemoteModels = false;
  }
  return transformers;
}

function progress(payload) {
  parentPort.postMessage({ type: 'progress', id: currentJobId, ...payload });
}

async function ensureVision() {
  if (vision.model && vision.processor) return vision;
  if (loading === 'vision') return loading;
  loading = (async () => {
    const t = loadTransformers();
    const spec = tasks.VISION_MODELS;
    progress({ stage: 'loading', model: spec.label, detail: 'SmolVLM-256M' });
    const [model, processor] = await Promise.all([
      t.SmolVLMForConditionalGeneration.from_pretrained(spec.id, {
        dtype: spec.dtype, session_options: CPU_SESSION_OPTIONS
      }),
      t.AutoProcessor.from_pretrained(spec.id)
    ]);
    vision = { model, processor };
    progress({ stage: 'loaded', model: spec.label });
    return vision;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

async function ensureText() {
  if (text.model && text.tokenizer) return text;
  if (loading === 'text') return loading;
  loading = (async () => {
    const t = loadTransformers();
    const spec = tasks.TEXT_MODELS;
    progress({ stage: 'loading', model: spec.label, detail: 'SmolLM-135M' });
    const [model, tokenizer] = await Promise.all([
      t.AutoModelForCausalLM.from_pretrained(spec.id, {
        dtype: spec.dtype, session_options: CPU_SESSION_OPTIONS
      }),
      t.AutoTokenizer.from_pretrained(spec.id)
    ]);
    text = { model, tokenizer };
    progress({ stage: 'loaded', model: spec.label });
    return text;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

async function runVision(job) {
  const { model, processor } = await ensureVision();
  const t = loadTransformers();
  const request = tasks.visionRequest(job.task, job.input);
  if (tasks.needsQuery(job.task) && !request.query) {
    throw new Error('Tell Prism Vision what to look for.');
  }

  const bytes = Buffer.from(job.image, 'base64');
  const image = await t.RawImage.fromBlob(new Blob([bytes], { type: job.mime || 'image/png' }));

  progress({ stage: 'running', model: tasks.VISION_MODELS.label });
  const messages = [{
    role: 'user',
    content: [
      { type: 'image' },
      { type: 'text', text: request.prompt }
    ]
  }];
  const prompt = processor.apply_chat_template(messages, { add_generation_prompt: true });
  const inputs = await processor(prompt, [image]);
  const ids = await model.generate({ ...inputs, max_new_tokens: 180, do_sample: false });
  const promptLength = inputs.input_ids.dims[inputs.input_ids.dims.length - 1];
  const sequence = (ids.tolist ? ids.tolist() : ids)[0];
  const generated = sequence.slice(promptLength);
  // Decode only generated tokens so the UI doesn't echo the image/query prompt.
  const output = renderVision(processor.decode(generated, { skip_special_tokens: true }));

  return {
    kind: 'vision',
    task: tasks.normaliseTaskId(job.task),
    result: { text: output },
    text: output,
    ms: Date.now() - job.startedAt
  };
}

// SmolVLM sometimes includes the role label even after slicing generated tokens.
function renderVision(text) {
  return tasks.cleanOutput(String(text || '').replace(/^assistant\s*:\s*/i, ''));
}

async function ensureTranslation() {
  if (translation.model && translation.tokenizer) return translation;
  if (loading === 'translation') return loading;
  loading = (async () => {
    const t = loadTransformers();
    const spec = tasks.TRANSLATION_MODEL;
    progress({ stage: 'loading', model: spec.label, detail: 'M2M100 ONNX · 100 languages' });
    const [model, tokenizer] = await Promise.all([
      t.AutoModelForSeq2SeqLM.from_pretrained(spec.id, {
        dtype: spec.dtype, session_options: CPU_SESSION_OPTIONS
      }),
      t.AutoTokenizer.from_pretrained(spec.id)
    ]);
    translation = { model, tokenizer };
    progress({ stage: 'loaded', model: spec.label });
    return translation;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

async function runTranslation(job) {
  const spec = tasks.translationModelFor(job.target);
  if (!spec) throw new Error('This translation language is not available offline yet.');
  const chunks = tasks.translationChunks(job.text);
  if (!chunks.length) throw new Error('There is no readable page text to translate.');
  const { model, tokenizer } = await ensureTranslation();
  const translated = [];
  const postProcessor = tokenizer._tokenizer && tokenizer._tokenizer.post_processor;
  const postProcessorConfig = postProcessor && postProcessor.config;
  const setSourceLanguage = () => {
    if (!postProcessorConfig || !Array.isArray(postProcessorConfig.single)) return false;
    let updated = false;
    for (const item of postProcessorConfig.single) {
      if (item.SpecialToken && tokenizer.languageRegex.test(item.SpecialToken.id)) {
        item.SpecialToken.id = tokenizer.lang_to_token(job.source);
        updated = true;
        break;
      }
    }
    return updated;
  };
  for (let i = 0; i < chunks.length; i++) {
    progress({ stage: 'running', model: spec.label, detail: `Part ${i + 1} of ${chunks.length}` });
    if (!setSourceLanguage()) throw new Error('Could not set the translation source language.');
    const generation = {
      src_lang: job.source,
      tgt_lang: job.target,
      max_new_tokens: 192,
      num_beams: 4,
      do_sample: false
    };
    const inputs = tokenizer._build_translation_inputs(chunks[i], {
      padding: true,
      truncation: true
    }, generation);
    const output = await model.generate({ ...inputs, ...generation });
    const text = tokenizer.batch_decode(output, { skip_special_tokens: true })[0] || '';
    translated.push(tasks.cleanOutput(text));
  }
  return {
    kind: 'translation',
    source: job.source,
    target: job.target,
    text: translated.filter(Boolean).join('\n\n'),
    truncated: !!job.truncated,
    ms: Date.now() - job.startedAt
  };
}

async function runSummary(job) {
  const body = tasks.summariseInput(job.text);
  if (tasks.summaryTooLong(body)) throw new Error('There is not enough text on this page to summarise.');

  const { model, tokenizer } = await ensureText();
  const style = tasks.summaryStyle(job.style);
  const messages = tasks.summaryMessages(body, style);

  progress({ stage: 'running', model: tasks.TEXT_MODELS.label });
  const prompt = tokenizer.apply_chat_template(messages, { tokenize: false, add_generation_prompt: true });
  const inputs = tokenizer(prompt);
  const out = await model.generate({ ...inputs, max_new_tokens: 160, do_sample: false });

  // generate() hands back a Tensor of [prompt + completion], and it has no
  // "return_full_text" option to trim it with the way the text-generation
  // pipeline does. Decode only the tokens the model actually produced,
  // otherwise the summary would start by repeating the instructions.
  const promptLen = inputs.input_ids.dims[inputs.input_ids.dims.length - 1];
  const sequence = (out.tolist ? out.tolist() : out)[0];
  const generated = sequence.slice(promptLen);

  return {
    kind: 'summary',
    style,
    text: tasks.cleanOutput(tokenizer.decode(generated, { skip_special_tokens: true })),
    truncated: tasks.summaryWasTruncated(job.text),
    ms: Date.now() - job.startedAt
  };
}

parentPort.on('message', async (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'ping') {
    parentPort.postMessage({ type: 'pong' });
    return;
  }
  // A job is anything tagged as one, or anything carrying a `kind`. The second
// half matters: the main process describes work as {kind: 'vision'} and only
// `ping` carries a type of its own, so requiring a type here silently dropped
// every real request and left the caller waiting for a timeout.
if (msg.type !== 'job' && !msg.kind) return;

  const job = { ...msg, startedAt: Date.now() };
  currentJobId = job.id;
  try {
    const result = job.kind === 'summary'
      ? await runSummary(job)
      : job.kind === 'translation'
        ? await runTranslation(job)
        : await runVision(job);
    parentPort.postMessage({ type: 'result', id: job.id, result });
  } catch (err) {
    parentPort.postMessage({
      type: 'error',
      id: job.id,
      error: (err && err.message) || 'The model could not complete that request.'
    });
  }
});

// Inference is CPU-bound and onnxruntime spawns its own threads, so let Node
// reclaim a finished model rather than pinning ~1GB for the browser's lifetime.
process.on('beforeExit', () => {
  vision = { model: null, processor: null };
  text = { model: null, tokenizer: null };
  translation = { model: null, tokenizer: null };
});

// Keep the worker's module id stable for diagnostics.
if (!workerData || !workerData.cacheDir) {
  throw new Error('worker.js requires workerData.cacheDir');
}
