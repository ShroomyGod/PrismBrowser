// ai.test.js — unit tests for Prism's local AI task layer.
//
// Covers src/ai/tasks.js (pure, no model download) plus the packaging and
// wiring invariants that are easy to break silently: native bindings must be
// unpacked from the asar, the model cache must live in userData rather than the
// repo, and every AI menu action must actually be handled.
//
// The Electron end-to-end test in test/ai-ui.test.js is what proves inference
// really runs; this file is the fast gate that runs first.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..');
const tasks = require(path.join(ROOT, 'src', 'ai', 'tasks'));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed++;
    return true;
  }
  failed++;
  failures.push(name + (detail ? ' - ' + detail : ''));
  return false;
}

// ---------- task table ----------

check('vision tasks exist', Array.isArray(tasks.VISION_TASKS) && tasks.VISION_TASKS.length >= 4);
check('every vision task has an id and label',
  tasks.VISION_TASKS.every((t) => t.id && t.label),
  JSON.stringify(tasks.VISION_TASKS.filter((t) => !t.id || !t.label)));
check('vision task ids are unique',
  new Set(tasks.VISION_TASKS.map((t) => t.id)).size === tasks.VISION_TASKS.length);
check('a task that needs input is declared',
  tasks.VISION_TASKS.some((t) => t.needsInput) && tasks.VISION_TASKS.some((t) => !t.needsInput));

check('every query-taking task is flagged needsInput',
  tasks.VISION_TASKS.filter((t) => t.id === 'ground').every((t) => t.needsInput === true));

// ---------- models ----------

check('vision model is SmolVLM 256M', /SmolVLM-256M-Instruct/i.test(tasks.VISION_MODELS.id), tasks.VISION_MODELS.id);
check('text model is SmolLM 135M', /SmolLM-135M-Instruct/i.test(tasks.TEXT_MODELS.id), tasks.TEXT_MODELS.id);
check('local translation uses the quantized multilingual M2M100 model',
  tasks.TRANSLATION_MODEL.id === 'Xenova/m2m100_418M' && tasks.TRANSLATION_MODEL.dtype === 'q8');
check('translation advertises 100 unique supported languages',
  tasks.TRANSLATION_LANGUAGES.length === 100 &&
  new Set(tasks.TRANSLATION_LANGUAGES.map((language) => language.id)).size === 100);
check('translation accepts any supported source and target',
  tasks.translationModelFor('fr') === tasks.TRANSLATION_MODEL && tasks.translationLanguageFor('hi'));
check('translation refuses unsupported target languages', tasks.translationModelFor('xx') === null);
check('translation input strips control characters and normalises spaces',
  tasks.translationInput('  Hello\r\n\u0000world  ') === 'Hello\nworld');
check('translation splits long text at readable boundaries',
  tasks.translationChunks(('First sentence. Second sentence. ').repeat(50), 140).every((chunk) => chunk.length <= 140));
check('translation records truncation past its input cap',
  tasks.translationWasTruncated('x'.repeat(tasks.MAX_TRANSLATION_CHARS + 1)));
check('Transformers.js exports the requested SmolVLM model class',
  typeof require('@huggingface/transformers').SmolVLMForConditionalGeneration === 'function');
check('Transformers.js exports the causal LM class for SmolLM',
  typeof require('@huggingface/transformers').AutoModelForCausalLM === 'function');
check('models use a quantised dtype',
  ['q4', 'q8', 'int8', 'fp16'].includes(tasks.VISION_MODELS.dtype) &&
  ['q4', 'q8', 'int8', 'fp16'].includes(tasks.TEXT_MODELS.dtype),
  tasks.VISION_MODELS.dtype + '/' + tasks.TEXT_MODELS.dtype);
check('SmolVLM-256M has a published q4 ONNX dtype', tasks.VISION_MODELS.dtype === 'q4');
check('SmolLM-135M uses the published q8 quantized variant', tasks.TEXT_MODELS.dtype === 'q8');

// ---------- normalisation ----------

check('known task id resolves', tasks.visionTask('ocr').id === 'ocr');
check('unknown task id is null', tasks.visionTask('nope') === null);
check('unknown task falls back to caption', tasks.normaliseTaskId('nope') === 'caption');
check('non-string task falls back to caption', tasks.normaliseTaskId(null) === 'caption');
check('task id is case insensitive', tasks.normaliseTaskId(' OCR ') === 'ocr');

check('needsQuery true for grounding', tasks.needsQuery('ground') === true);
check('needsQuery false for ocr', tasks.needsQuery('ocr') === false);

// ---------- query handling ----------

check('query is whitespace collapsed', tasks.cleanQuery('  a \n  b ') === 'a b');
check('query is capped', tasks.cleanQuery('x'.repeat(500)).length === tasks.MAX_QUERY);
check('non-string query becomes empty', tasks.cleanQuery(undefined) === '');
check('grounding carries the query', tasks.visionRequest('ground', 'red shoes').query === 'red shoes');
check('caption ignores a stray query', tasks.visionRequest('caption', 'ignored').query === '');
check('unknown task falls back to the caption prompt', tasks.visionRequest('bogus').prompt === tasks.visionRequest('caption').prompt);
check('caption has a natural-language image prompt', /describe this image/i.test(tasks.visionRequest('caption').prompt));
check('OCR prompt asks to transcribe readable text', /transcribe all readable text/i.test(tasks.visionRequest('ocr').prompt));
check('object-finding prompt asks for locations', /prominent objects/.test(tasks.visionRequest('detect').prompt));
check('image matching prompt includes the bounded user query', tasks.visionRequest('ground', 'red shoes').prompt.includes('red shoes'));
check('grounding prompt is empty without a query', tasks.visionRequest('ground', '').prompt === '');

// ---------- summarisation ----------

check('summary styles are non-empty', tasks.SUMMARY_STYLE_IDS.length >= 2);
check('plain-language style is available for accessibility', tasks.summaryStyle('plain') === 'plain');
check('plain-language style uses simple wording instructions', /simple everyday language/.test(tasks.SUMMARY_STYLES.plain));
check('unknown style falls back to paragraph', tasks.summaryStyle('bogus') === 'paragraph');
check('known style is kept', tasks.summaryStyle('bullets') === 'bullets');

const messages = tasks.summaryMessages('Some long article text here.', 'tldr');
check('summary uses a chat template, not a raw prompt', Array.isArray(messages) && messages.length === 2);
check('summary roles are system then user',
  messages[0].role === 'system' && messages[1].role === 'user');
check('summary body is included', messages[1].content.includes('Some long article text here.'));
// SmolLM echoes a raw prompt back and then keeps rambling, so the request goes
// through the chat template. It also takes a system turn that *lists forbidden
// content* far too literally: told "no preamble, no restating the request", the
// model replied "No preamble, no restating the request, no closing remarks." So
// the instruction to output only the summary has to survive somewhere - verified
// against the real model, not assumed.
check('summary system turn describes the job', messages[0].content.length > 20,
  messages[0].content);
check('summary user turn demands the summary alone',
  /output nothing except the summary/i.test(messages[1].content));
check('summary user turn still carries the page text last',
  messages[1].content.trim().endsWith('Some long article text here.'));

check('page text is collapsed', tasks.summariseInput('a\r\n\r\n\r\n\r\nb') === 'a\n\nb');
check('truncation is reported', tasks.summaryWasTruncated('x'.repeat(20000)) === true);
check('short text is not reported as truncated', tasks.summaryWasTruncated('short page') === false);
// Indented page text collapses to fewer characters without anything being cut,
// and reporting that as truncation would tell the user their page was shortened
// when it was not.
check('whitespace collapsing is not reported as truncated',
  tasks.summaryWasTruncated(['', '    line one', '    line two', ''].join(String.fromCharCode(10))) === false);
check('text exactly at the cap is not reported as truncated',
  tasks.summaryWasTruncated('x'.repeat(tasks.MAX_SUMMARY_CHARS)) === false);
check('too-short text is detected', tasks.summaryTooLong('hi') === true);
check('normal text is long enough', tasks.summaryTooLong('A page with a reasonable amount of readable text on it.') === false);

// ---------- output hygiene ----------

check('output strips control characters', tasks.cleanOutput('a\u0000b\u001fc') === 'abc');
check('output normalises newlines', tasks.cleanOutput('a\r\nb') === 'a\nb');
check('output collapses runs of spaces', tasks.cleanOutput('a     b') === 'a b');
check('output is trimmed', tasks.cleanOutput('  hi  ') === 'hi');
check('non-string output is empty', tasks.cleanOutput(undefined) === '');
check('output is capped', tasks.cleanOutput('y'.repeat(9000)).length === 4000);

// ---------- packaging ----------

// A native binding inside a packed asar cannot be dlopen'd, so the failure only
// shows up in a built installer, never in `npm test` or `npm start`.
const unpack = pkg.build.asarUnpack || [];
check('asarUnpack is configured', unpack.length > 0);
check('onnxruntime native binaries are unpacked',
  unpack.some((g) => g.includes('onnxruntime-node')), JSON.stringify(unpack));
check('sharp native binaries are unpacked', unpack.some((g) => g.includes('sharp') || g.includes('@img')));
check('onnxruntime-web wasm is unpacked', unpack.some((g) => g.includes('onnxruntime-web')));

// Only win32-x64 can run in this build; shipping the rest is ~155MB of dead weight.
const files = pkg.build.files || [];
check('non-win32 onnxruntime binaries are excluded',
  files.some((f) => f.includes('darwin')) && files.some((f) => f.includes('linux')),
  JSON.stringify(files.filter((f) => f.startsWith('!'))));

// A devDependency is not packaged, and ai.js needs pngjs at runtime.
check('pngjs is a production dependency', !!(pkg.dependencies && pkg.dependencies.pngjs));
check('pngjs is not dev-only', !(pkg.devDependencies && pkg.devDependencies.pngjs));
check('transformers is a production dependency',
  !!(pkg.dependencies && pkg.dependencies['@huggingface/transformers']));

// ---------- source invariants ----------

const aiSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ai.js'), 'utf8');
const workerSrc = fs.readFileSync(path.join(ROOT, 'src', 'ai', 'worker.js'), 'utf8');

check('model cache lives in userData', /getPath\(['"]userData['"]\)/.test(aiSrc));
check('cache dir is under models', /['"]models['"]/.test(aiSrc));
check('inference runs in a worker thread', /require\(['"]worker_threads['"]\)/.test(aiSrc));
check('worker is terminated on timeout', /terminate\(\)/.test(aiSrc));
check('the worker caches to the dir it was given', /cacheDir\s*=\s*workerData\.cacheDir/.test(workerSrc));
check('the worker loads transformers lazily', /if \(!transformers\)/.test(workerSrc));
check('the summariser uses the chat template', /apply_chat_template/.test(workerSrc));
check('generation is deterministic', /do_sample:\s*false/.test(workerSrc));
check('the worker does not run on the main thread', !/require\(['"]@huggingface\/transformers['"]\)/.test(aiSrc));

// ---------- menu wiring ----------

const menu = require(path.join(ROOT, 'src', 'shell', 'menu-items.js'));
const shellSrc = fs.readFileSync(path.join(ROOT, 'src', 'shell', 'shell.js'), 'utf8');
const shellCss = fs.readFileSync(path.join(ROOT, 'src', 'shell', 'shell.css'), 'utf8');
const themeEngineSrc = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'theme-engine.js'), 'utf8');
const preloadSrc = fs.readFileSync(path.join(ROOT, 'src', 'preload', 'shell.js'), 'utf8');
const ipcSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'shell-ipc.js'), 'utf8');

// Walks the whole tree, not just `submenu`: a section holds its rows under
// `items`, so a submenu-only walk finds nothing at all.
function collect(node, out) {
  if (Array.isArray(node)) { node.forEach((n) => collect(n, out)); return out; }
  if (node && typeof node === 'object') {
    if (node.action) out.push(node.action);
    if (node.items) collect(node.items, out);
    if (node.submenu) collect(node.submenu, out);
  }
  return out;
}

const actions = collect(menu.sections, []);
const aiActions = actions.filter((a) => a.startsWith('ai-'));
check('AI menu actions exist', aiActions.length >= 3, JSON.stringify(aiActions));
for (const action of aiActions) {
  check('shell handles ' + action, new RegExp("'" + action + "'\\s*:").test(shellSrc));
}
check('AI menu has a Vision entry', actions.includes('ai-vision'));
check('AI menu has a summarise entry', actions.includes('ai-summarise'));

const usedBridge = [...shellSrc.matchAll(/\bS\.(ai[A-Za-z]+)\s*\(/g)].map((m) => m[1]);
check('the shell actually calls AI bridge methods', usedBridge.length > 0, JSON.stringify([...new Set(usedBridge)]));
for (const fn of new Set(usedBridge)) {
  check('preload exposes S.' + fn, new RegExp('\\b' + fn + '\\s*:').test(preloadSrc));
}

// Every AI channel the UI needs must have an ipcMain handler behind it.
for (const channel of ['prism:ai:status', 'prism:ai:vision', 'prism:ai:summarise', 'prism:ai:capture', 'prism:ai:watch', 'prism:ai:tasks', 'prism:ai:clear-cache']) {
  check('ipcMain handles ' + channel, ipcSrc.includes("'" + channel + "'"));
}

const pageSrc = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'vision.html'), 'utf8');
check('the Vision page exists as a page', fs.existsSync(path.join(ROOT, 'src', 'pages', 'vision.html')));
check('tabs resolves Vision IPC by WebContents identity or id',
  /const id = typeof wcId === 'number' \? wcId : wcId && wcId\.id/.test(fs.readFileSync(path.join(ROOT, 'src', 'main', 'tabs.js'), 'utf8')));
check('the Vision page builds Prism UI', /src="\/common\.js"/.test(pageSrc) && /src="\/vision-ui\.js"/.test(pageSrc));
check('the Vision page renders from the task table', /aiTasks\(\)/.test(fs.readFileSync(path.join(ROOT, 'src', 'pages', 'vision-ui.js'), 'utf8')));
check('the Lens-style Vision page has a capture stage and right-side overview',
  /class="capture-column"/.test(pageSrc) && /class="aside"/.test(pageSrc) && /id="overview-text"/.test(pageSrc));
check('Vision does not claim to return online matches', /never uploads your image to a search engine/.test(pageSrc));
check('Vision discloses an unavailable screen capture instead of treating it as a fatal open failure',
  /captureError =/.test(ipcSrc) && /Screenshot capture was unavailable/.test(fs.readFileSync(path.join(ROOT, 'src', 'pages', 'vision-ui.js'), 'utf8')));
check('the Vision preload only exposes the private local capture API',
  /aiTakeCapture: \(\) => ipcRenderer\.invoke\('prism:ai:vision-session'\)/.test(fs.readFileSync(path.join(ROOT, 'src', 'preload', 'page.js'), 'utf8')) &&
  /aiCopyImage:/.test(fs.readFileSync(path.join(ROOT, 'src', 'preload', 'page.js'), 'utf8')));
check('Prism Vision opens as a capture-backed in-browser overlay instead of a new tab',
  /prism:vision-overlay:open/.test(ipcSrc) && /'ai-vision': \(\) => openVisionOverlay\(\)/.test(shellSrc) &&
  /S\.aiOpenVision\(WID, state\.active\.id\)/.test(shellSrc) && /tabs\.setVisionOverlay\(senderWid, true\)/.test(ipcSrc) &&
  /id="prism-vision-overlay"/.test(fs.readFileSync(path.join(ROOT, 'src', 'shell', 'index.html'), 'utf8')));
check('Vision page initializes its local AI session after opening from the shell',
  /prism:ai:vision-session/.test(ipcSrc) && /aiTakeCapture:/.test(fs.readFileSync(path.join(ROOT, 'src', 'preload', 'page.js'), 'utf8')) &&
  /window\.prism\.aiTakeCapture\(\)/.test(fs.readFileSync(path.join(ROOT, 'src', 'pages', 'vision-ui.js'), 'utf8')));
check('local AI settings APIs remain available to the internal Settings page',
  /function aiManagementAccess\(e\)/.test(ipcSrc) && /page\.hostname === 'settings'/.test(ipcSrc) &&
  /ipcMain\.handle\('prism:ai:status', \(e\) => \{\s*if \(!aiManagementAccess\(e\)\)/.test(ipcSrc) &&
  /ipcMain\.handle\('prism:ai:clear-cache', \(e\) => \{\s*if \(!aiManagementAccess\(e\)\)/.test(ipcSrc));
check('the integration smoke verifies drag analysis and Escape dismissal without opening a tab',
  /sourceUrl/.test(fs.readFileSync(path.join(ROOT, 'test', 'vision-ui.test.js'), 'utf8')) &&
  /pointerdown/.test(fs.readFileSync(path.join(ROOT, 'test', 'vision-ui.test.js'), 'utf8')) &&
  /must not add or activate a new browser tab/.test(fs.readFileSync(path.join(ROOT, 'test', 'vision-ui.test.js'), 'utf8')) &&
  /Escape to close Vision/.test(fs.readFileSync(path.join(ROOT, 'test', 'vision-ui.test.js'), 'utf8')));
check('the model worker configures bounded CPU session threads',
  /intraOpNumThreads:\s*CPU_THREADS/.test(workerSrc) && /interOpNumThreads:\s*1/.test(workerSrc));

// ---------- downscaling ----------

// src/main/ai.js requires electron, so exercise the same algorithm on a real
// PNG here rather than importing it: a downscaled image must stay a valid PNG
// with the expected dimensions and no dropped alpha.
function boxDownscale(src, limit) {
  const scale = limit / Math.max(src.width, src.height);
  const width = Math.max(1, Math.round(src.width * scale));
  const height = Math.max(1, Math.round(src.height * scale));
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y / scale), y1 = Math.min(src.height, Math.max(y0 + 1, Math.floor((y + 1) / scale)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x / scale), x1 = Math.min(src.width, Math.max(x0 + 1, Math.floor((x + 1) / scale)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
        const i = (src.width * sy + sx) << 2;
        r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2]; n++;
      }
      const o = (width * y + x) << 2;
      out.data[o] = Math.round(r / n); out.data[o + 1] = Math.round(g / n);
      out.data[o + 2] = Math.round(b / n); out.data[o + 3] = 255;
    }
  }
  return out;
}

const big = new PNG({ width: 400, height: 200 });
for (let y = 0; y < 200; y++) for (let x = 0; x < 400; x++) {
  const i = (400 * y + x) << 2;
  big.data[i] = (x * 255 / 399) | 0; big.data[i + 1] = 20; big.data[i + 2] = 200; big.data[i + 3] = 255;
}
const small = boxDownscale(big, 100);
check('downscale honours the long edge', small.width === 100 && small.height === 50,
  small.width + 'x' + small.height);
check('downscale keeps full alpha', small.data[3] === 255 && small.data[(50 * 25 + 50) * 4 + 3] === 255);
const reRead = PNG.sync.read(PNG.sync.write(small));
check('downscale output is still a valid PNG', reRead.width === 100 && reRead.height === 50);
// The gradient rises in red from left to right while blue stays constant, so a
// correct box filter keeps the left edge blue-dominant and the right edge
// red-dominant. This catches a transposed or dropped channel.
check('downscale keeps the left edge blue-dominant', reRead.data[2] > reRead.data[0], 'rgba ' + [0, 1, 2].map((i) => reRead.data[i]).join(','));
check('downscale keeps the right edge red-dominant', reRead.data[4 * 99] > reRead.data[4 * 99 + 2], 'rgba ' + [4 * 99, 4 * 99 + 1, 4 * 99 + 2].map((i) => reRead.data[i]).join(','));
check('downscale preserves the green channel', reRead.data[4 * 50 + 1] === 20, 'got ' + reRead.data[4 * 50 + 1]);

// ---------- bundled models ----------
//
// Prism ships SmolVLM and SmolLM inside the installer, so an installed copy
// runs offline on first use instead of downloading hundreds of MB when someone first
// clicks. That only works if three things stay true: electron-builder copies the
// staged directory, transformers.js is pointed at it before the network, and the
// layout of the staged files is the layout it looks in.

const hubSrc = fs.readFileSync(
  path.join(ROOT, 'node_modules', '@huggingface', 'transformers', 'src', 'utils', 'hub.js'), 'utf8');
const cacheSrc = fs.readFileSync(
  path.join(ROOT, 'node_modules', '@huggingface', 'transformers', 'src', 'utils', 'cache', 'FileCache.js'), 'utf8');

// The whole staging trick rests on the file cache and env.localModelPath using
// the same "<root>/<repo-id>/<filename>" shape. If a transformers.js upgrade ever
// changes that, fetch-models.js produces a directory the app cannot read, so pin
// the assumption here rather than discovering it as a broken release.
check('localModelPath is <localModelPath>/<repo>/<file>',
  /pathJoin\(env\.localModelPath, requestURL\)/.test(hubSrc));
check('the file cache is <cacheDir>/<repo>/<file>',
  /path\.join\(this\.path, request\)/.test(cacheSrc),
  'FileCache.js no longer joins its root with the cache key');
check('a missing local file still falls back to a download',
  /Unable to load from local path/.test(hubSrc) && /getFile\(remoteURL\)/.test(hubSrc));

const resources = pkg.build.extraResources || [];
const modelsResource = resources.find((r) => r.from === 'resources/models' && r.to === 'models');
check('electron-builder copies the staged models into the app', !!modelsResource,
  JSON.stringify(resources));
check('the staged weights are not committed to git',
  /^\/resources\/models\/$/m.test(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')));
check('npm run models stages them', /node scripts\/fetch-models\.js/.test(pkg.scripts.models || ''));
check('the fetch script exists', fs.existsSync(path.join(ROOT, 'scripts', 'fetch-models.js')));

const fetchSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'fetch-models.js'), 'utf8');
check('fetch-models stages the three local models through Transformers.js',
  /SmolVLMForConditionalGeneration\.from_pretrained/.test(fetchSrc) &&
  /AutoProcessor\.from_pretrained/.test(fetchSrc) &&
  /AutoModelForCausalLM\.from_pretrained/.test(fetchSrc) &&
  /AutoModelForSeq2SeqLM\.from_pretrained/.test(fetchSrc) &&
  /AutoTokenizer\.from_pretrained/.test(fetchSrc));
check('fetch-models stages into the cache dir, so the layout is the one the app reads',
  /env\.cacheDir = OUT/.test(fetchSrc));
check('fetch-models removes old model checkpoints only after the new downloads load',
  /await stage\(t, text[\s\S]*?fs\.rmSync\(path\.join\(OUT, \.\.\.oldId\.split/.test(fetchSrc));
check('fetch-models removes old model checkpoints only after new loads complete',
  /await stage\(t, text[\s\S]*?fs\.rmSync\(path\.join\(OUT, \.\.\.oldId\.split\('\/'\)\)/.test(fetchSrc));
check('fetch-models refuses to settle for a half-finished run', /allowLocalModels = false/.test(fetchSrc));
check('fetch-models validates required multilingual translation assets',
  /translation\.requiredFiles/.test(fetchSrc) && /missingTranslationFiles/.test(fetchSrc) &&
  /requiredFiles/.test(fs.readFileSync(path.join(ROOT, 'src', 'ai', 'tasks.js'), 'utf8')));

check('the worker reads the bundled models first',
  /env\.localModelPath = workerData\.localModelPath/.test(workerSrc));
check('the worker uses SmolVLMForConditionalGeneration for images',
  /SmolVLMForConditionalGeneration\.from_pretrained\(spec\.id/.test(workerSrc));
check('SmolVLM gets the chat prompt and image through its processor',
  /processor\.apply_chat_template\(messages[\s\S]{0,150}processor\(prompt, \[image\]\)/.test(workerSrc));
check('vision completion decodes only newly generated tokens',
  /promptLength = inputs\.input_ids\.dims[\s\S]{0,180}sequence\.slice\(promptLength\)/.test(workerSrc));
check('SmolLM uses the requested local text checkpoint',
  /AutoModelForCausalLM\.from_pretrained\(spec\.id/.test(workerSrc));
check('the worker loads M2M100 and sets the requested source and target codes',
  /AutoModelForSeq2SeqLM\.from_pretrained\(spec\.id/.test(workerSrc) && /runTranslation/.test(workerSrc) &&
  /_build_translation_inputs/.test(workerSrc) && /src_lang: job\.source/.test(workerSrc) && /tgt_lang: job\.target/.test(workerSrc) &&
  /postProcessorConfig\.single/.test(workerSrc) && /item\.SpecialToken\.id = tokenizer\.lang_to_token\(job\.source\)/.test(workerSrc));
check('AI menu offers a plain-language accessibility summary',
  /ai-accessibility/.test(shellSrc) && /summariseActivePage\('plain', 'Plain-language summary'\)/.test(shellSrc));
check('animation styles are selectable and include a reduced-motion path',
  /animation-theme/.test(fs.readFileSync(path.join(ROOT, 'src', 'pages', 'settings.html'), 'utf8')) &&
  /data-animation-theme="playful"/.test(shellCss) && /prefers-reduced-motion: reduce/.test(shellCss) &&
  /animationTheme = animationThemes\.includes/.test(themeEngineSrc));
check('new tabs are animated without disabling reduced-motion support',
  /tab-entering/.test(shellSrc) && /tab-leaving/.test(shellSrc) && /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(shellSrc));
check('AI menu offers a local threat-list lookup',
  /ai-security-check/.test(shellSrc) && /securityCheckLocal\(WID\)/.test(shellSrc));
check('local threat lookup uses cached lists without a network request',
  /checkLocalUrl\(url\)/.test(fs.readFileSync(path.join(ROOT, 'src', 'main', 'security.js'), 'utf8')) &&
  /security:check-local/.test(fs.readFileSync(path.join(ROOT, 'src', 'main', 'shell-ipc.js'), 'utf8')));
check('the worker still allows a download for anything not bundled',
  /env\.allowLocalModels = true/.test(workerSrc) &&
  (workerSrc.match(/allowRemoteModels/g) || []).length === 1,
  'remote models must only be disabled behind the offline flag, or a bundled set that is missing one file could never fetch it');
check('remote models are only refused when offline mode asks for it',
  /if \(workerData\.offline\) transformers\.env\.allowRemoteModels = false;/.test(workerSrc));

check('the worker is started with the bundled path',
  /workerData:\s*\{[^}]*cacheDir: modelsDir\(\)[^}]*localModelPath: bundledModelsDir\(\)[^}]*offline[^}]*\}/s.test(aiSrc),
  (/\/\/ workerData[\s\S]{0,200}/.exec(aiSrc) || [''])[0]);
check('a packaged build looks for models in process.resourcesPath',
  /path\.join\(process\.resourcesPath, 'models'\)/.test(aiSrc));
check('a missing models directory is not an error',
  /bundledModelsDir[\s\S]{0,900}return null;/.test(aiSrc));
check('status reports whether the models are bundled', /bundled: !!bundled/.test(aiSrc));

// Deleting the download cache must never take the installed models with it.
const clearBody = /function clearCache\(\) \{[\s\S]*?\n\}/.exec(aiSrc);
check('clearCache exists to inspect', !!clearBody);
check('clearCache does not touch the bundled models', clearBody && !/bundledModelsDir/.test(clearBody[0]));
check('clearCache only deletes the download cache',
  clearBody && /modelsDir\(\)/.test(clearBody[0]) && /rmSync/.test(clearBody[0]));

// A first run has to download several hundred MB without being killed mid-transfer
// by the per-job timeout, so the deadline must move when the worker reports
// progress.
check('the job timeout is idle-based, not a hard cap',
  /function extend\(id\)/.test(aiSrc) && /entry\.timer = setTimeout/.test(aiSrc));
check('progress events push the deadline out',
  /if \(msg\.id !== undefined\) extend\(msg\.id\);/.test(aiSrc) &&
  /msg\.id !== undefined\) extend\(msg\.id\);[\s\S]{0,80}return notify\(msg\)/.test(aiSrc));
check('progress events carry the job they belong to', /id: currentJobId/.test(workerSrc));

// The contract between the two halves of the feature: the main process posts a
// job, the worker has to recognise one. Getting this wrong is invisible until an
// inference is requested - the worker ignores the message and the caller waits
// for its timeout - so it is pinned here.
check('the main process tags a job the way the worker expects',
  /worker\.postMessage\(\{ type: 'job',/.test(aiSrc));
// Ordering inside the message handler: a result has to settle the caller before
// the handler falls through to "this is progress, keep the deadline alive".
// Swallowing results that way leaves the caller waiting for its timeout while the
// answer has already arrived, which looks exactly like a hung model.
const msgHandler = /w\.on\('message',[\s\S]*?\n {4}\}\);/.exec(aiSrc);
check('a result is handled before anything is treated as progress',
  !!msgHandler && msgHandler[0].indexOf("msg.type === 'result'") < msgHandler[0].indexOf('return notify(msg)'));
check('an error is handled before anything is treated as progress',
  !!msgHandler && msgHandler[0].indexOf("msg.type === 'error'") < msgHandler[0].indexOf('return notify(msg)'));
check('the worker accepts anything carrying a kind',
  /msg\.type !== 'job' && !msg\.kind/.test(workerSrc) &&
  /job\.kind === 'summary'/.test(workerSrc) && /job\.kind === 'translation'/.test(workerSrc));

const releaseSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'release.js'), 'utf8');
check('a release refuses to build without the models', /function requireModels\(\)/.test(releaseSrc));
check('a release checks all staged models match the task table',
  /staged\.models\.some/.test(releaseSrc) && /VISION_MODELS/.test(releaseSrc) && /TRANSLATION_MODEL/.test(releaseSrc));
check('a release verifies the models reached the built app',
  /function verifyPackagedModels\(\)/.test(releaseSrc) && /TRANSLATION_MODEL/.test(releaseSrc) &&
  /win-unpacked', 'resources', 'models'/.test(releaseSrc));
check('the release gates on both model steps',
  /requireModels\(\);[\s\S]{0,400}electron-builder/.test(releaseSrc) &&
  /verifyPackagedModels\(\);/.test(releaseSrc));

// The Vision page must not claim models are downloaded when they are not.
check('the Vision page distinguishes bundled from downloaded models',
  /info\.bundled/.test(fs.readFileSync(path.join(ROOT, 'src', 'pages', 'vision-ui.js'), 'utf8')) && /works offline/.test(fs.readFileSync(path.join(ROOT, 'src', 'pages', 'vision-ui.js'), 'utf8')));
check('the Vision page only offers to delete the extra downloads',
  /Delete extra downloads/.test(pageSrc));

// ---------- user-facing settings ----------
//
// ai.enabled, ai.visionTasks and ai.summaryStyle exist in the defaults. A setting
// nothing reads is worse than no setting at all: the page would show a control
// that changes nothing, so each one is pinned to the code that honours it.

const settingsSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'settings.js'), 'utf8');
const settingsPage = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'settings.html'), 'utf8');

check('ai settings have defaults', /ai: \{[\s\S]{0,200}enabled: true/.test(settingsSrc));
check('the task filter reads ai.visionTasks',
  /settings\.get\('ai\.visionTasks'\)/.test(ipcSrc) &&
  /VISION_TASKS\.filter\(\(t\) => allowed\.includes\(t\.id\)\)/.test(ipcSrc));
check('a user who switches every task off still gets a working page',
  /list\.length \? list : ai\.tasks\.VISION_TASKS/.test(ipcSrc));
check('turning local AI off refuses vision requests',
  /const aiOff = \(\) => \(settings\.get\('ai\.enabled'\) === false/.test(ipcSrc) &&
  /prism:ai:vision[\s\S]{0,200}aiOff\(\)/.test(ipcSrc));
check('turning local AI off refuses summaries',
  /prism:ai:summarise', async[\s\S]{0,120}aiOff\(\)/.test(ipcSrc));
check('the stored summary style is used when the caller passes none',
  /style: style \|\| settings\.get\('ai\.summaryStyle'\)/.test(ipcSrc));
check('the Settings page offers an AI section', /id="aiCard"/.test(settingsPage) && /#ai'\)/.test(settingsPage));
check('the Settings page saves the summary style',
  /save\(\{ ai: \{ summaryStyle: styleSel\.value \} \}\)/.test(settingsPage));
check('the Settings page saves the chosen tasks',
  /save\(\{ ai: \{ visionTasks: \[\.\.\.chosen\] \} \}\)/.test(settingsPage));
check('the Settings page says where the models came from',
  /Included with Prism, so they work offline/.test(settingsPage));

check('npm test runs the AI unit tests', /node test\/ai\.test\.js/.test(pkg.scripts.test));
check('npm test runs the AI end-to-end test', /electron test\/ai-ui\.test\.js/.test(pkg.scripts.test));
check('the Vision UI smoke test exists', fs.existsSync(path.join(ROOT, 'test', 'vision-ui.test.js')));

// If the models have been staged, check the staged tree really is loadable: one
// directory per repo id, with config.json and at least one ONNX session in it.
const staged = path.join(ROOT, 'resources', 'models');
const oldVisionDir = path.join(staged, 'onnx-community', 'Florence-2-base-ft');
const oldTextDir = path.join(staged, 'HuggingFaceTB', 'SmolLM2-135M-Instruct');
const oldTranslationDir = path.join(staged, 'Xenova', 'opus-mt-en-ROMANCE');
const stagedMatchesRequested = fs.existsSync(path.join(staged, ...tasks.VISION_MODELS.id.split('/'))) &&
  fs.existsSync(path.join(staged, ...tasks.TEXT_MODELS.id.split('/'))) &&
  fs.existsSync(path.join(staged, ...tasks.TRANSLATION_MODEL.id.split('/')));
if (fs.existsSync(staged) && stagedMatchesRequested) {
  for (const spec of [tasks.VISION_MODELS, tasks.TEXT_MODELS, tasks.TRANSLATION_MODEL]) {
    const dir = path.join(staged, ...spec.id.split('/'));
    let onnx = [];
    try { onnx = fs.readdirSync(path.join(dir, 'onnx')); } catch (_) { onnx = []; }
    check('staged ' + spec.label + ' has its config', fs.existsSync(path.join(dir, 'config.json')));
    check('staged ' + spec.label + ' has ONNX sessions', onnx.some((f) => f.endsWith('.onnx')), JSON.stringify(onnx));
    const matches = spec.dtype === 'q8'
      ? onnx.some((f) => f.includes('quantized') || f.includes('q8') || f.includes('int8'))
      : onnx.some((f) => f.includes('q4') || f.includes('quantized'));
    check('staged ' + spec.label + ' matches its declared dtype (' + spec.dtype + ')', matches, JSON.stringify(onnx));
  }
  for (const file of tasks.TRANSLATION_MODEL.requiredFiles) {
    check('staged translation requires ' + file,
      fs.existsSync(path.join(staged, ...tasks.TRANSLATION_MODEL.id.split('/'), ...file.split('/'))));
  }
  const marker = path.join(staged, 'prism-models.json');
  check('the staged models are described by a marker file', fs.existsSync(marker));
  if (fs.existsSync(marker)) {
    const described = JSON.parse(fs.readFileSync(marker, 'utf8'));
    check('the marker lists the models the app asks for',
      [tasks.VISION_MODELS, tasks.TEXT_MODELS, tasks.TRANSLATION_MODEL].every((s) =>
        described.models.some((m) => m.id === s.id && m.dtype === s.dtype)));
    check('the translation model staged its quantized ONNX assets',
      tasks.TRANSLATION_MODEL.requiredFiles.every((file) =>
        fs.existsSync(path.join(staged, ...tasks.TRANSLATION_MODEL.id.split('/'), ...file.split('/')))));
    check('the marker records a plausible size', described.bytes > 50 * 1024 * 1024,

      String(described.bytes));
  }
} else {
  if (fs.existsSync(staged) && (fs.existsSync(oldVisionDir) || fs.existsSync(oldTextDir) || fs.existsSync(oldTranslationDir))) {
    check('staged models are current for the requested model ids', false,
      'run `npm run models` to stage SmolVLM, SmolLM and M2M100');
  } else {
    console.log('  (resources/models not staged - run `npm run models` to check the staged layout too)');
  }
}

// ---------- report ----------

if (failed) {
  console.error('\n' + failures.length + ' AI check(s) failed:');
  for (const f of failures) console.error('  - ' + f);
  console.error('\nAI_TESTS_FAILED');
  process.exit(1);
}
console.log('all ' + passed + ' AI checks passed');
console.log('AI_TESTS_OK');
