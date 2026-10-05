// tasks.js — what Prism's local AI can do, as pure data and pure functions.
//
// Deliberately free of electron and of @huggingface/transformers so the whole
// task surface is unit-testable without downloading 300MB of model weights.
// The worker (worker.js) imports this to drive the models; test/ai.test.js
// asserts the same table stays well formed.
'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrismAI = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  // SmolVLM is a chat-style vision-language model: each task becomes a prompt
  // paired with the image, rather than a Florence task token.
  const VISION_TASKS = [
    { id: 'caption', label: 'Describe', hint: 'A one-line description of the image.' },
    { id: 'detail', label: 'Describe in detail', hint: 'A fuller description of what is shown.' },
    { id: 'ocr', label: 'Read text', hint: 'Transcribes any text in the image.' },
    { id: 'detect', label: 'Find objects', hint: 'Names objects and where they are.' },
    { id: 'ground', label: 'Find or match', hint: 'Finds or matches something you type. Needs a query.', needsInput: true }
  ];

  const VISION_MODELS = {
    id: 'HuggingFaceTB/SmolVLM-256M-Instruct',
    label: 'SmolVLM 256M',
    // q4 is the small ONNX package intended for CPU/local inference; the
    // upstream repository includes the matching vision and decoder sessions.
    dtype: 'q4'
  };

  const TEXT_MODELS = {
    id: 'HuggingFaceTB/SmolLM-135M-Instruct',
    label: 'SmolLM 135M',
    dtype: 'q8'
  };

  function visionTask(id) {
    return VISION_TASKS.find((t) => t.id === id) || null;
  }

  function normaliseTaskId(task) {
    if (typeof task !== 'string') return 'caption';
    const id = task.trim().toLowerCase();
    return visionTask(id) ? id : 'caption';
  }

  // Tasks that take free text use it as an image-matching/search query. A long
  // or empty query produces poor results, so cap it and refuse to run without one.
  const MAX_QUERY = 120;

  function cleanQuery(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);
  }

  // Build a plain-language request for SmolVLM. `ground` supports natural
  // language matching (objects, visual details, or a description), not just
  // object detection labels.
  function visionRequest(taskId, input) {
    const task = visionTask(normaliseTaskId(taskId));
    const query = task && task.needsInput ? cleanQuery(input) : '';
    const prompts = {
      caption: 'Describe this image in one concise sentence.',
      detail: 'Describe this image in detail. Include the setting, visible objects, and their spatial relationships.',
      ocr: 'Transcribe all readable text in this image exactly. If there is no readable text, say so.',
      detect: 'List the prominent objects visible in this image and briefly describe where each one is.',
      ground: query
        ? 'Find and match this description in the image: "' + query + '". Say whether it is present and where it appears. If the request compares this image with something, explain the visual match or mismatch.'
        : ''
    };
    const prompt = task && task.needsInput && !query
      ? ''
      : (prompts[task ? task.id : 'caption'] || prompts.caption);
    return { prompt, query };
  }

  function needsQuery(taskId) {
    const task = visionTask(normaliseTaskId(taskId));
    return !!(task && task.needsInput);
  }

  // The summariser is an Instruct model, so a raw prompt makes it echo the
  // question back (verified with SmolLM-135M: it restated the text and then
  // kept going). Every request therefore goes through the chat template with
  // one system turn and one user turn.
  function summaryMessages(text, style) {
    const body = summariseInput(text);
    const instruction = SUMMARY_STYLES[style] || SUMMARY_STYLES.paragraph;
    return [
      // Phrased as a job, not as a list of things not to write. A 135M model
      // takes "no preamble, no restating the request" far too literally and
      // replies with those words; verified against the earlier SmolLM2 model.
      { role: 'system', content: 'You write summaries of web pages for someone who wants the gist in a few sentences.' },
      { role: 'user', content: instruction + '\n\nWrite that summary now, and output nothing except the summary text itself.\n\n' + body }
    ];
  }

  const SUMMARY_STYLES = {
    paragraph: 'Summarise the following in three or four sentences. Reply with the summary only.',
    bullets: 'Summarise the following as five short bullet points. Reply with the bullets only.',
    tldr: 'Summarise the following in one sentence. Reply with that sentence only.'
  };

  function summaryStyle(id) {
    return Object.prototype.hasOwnProperty.call(SUMMARY_STYLES, id) ? id : 'paragraph';
  }

  const SUMMARY_STYLE_IDS = Object.keys(SUMMARY_STYLES);

  // Page text is unbounded and the model has a small context window. Cap it and
  // tell the caller we truncated, rather than silently summarising the top.
  const MAX_SUMMARY_CHARS = 6000;

  function summariseInput(text) {
    const clean = (typeof text === 'string' ? text : '')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return clean.slice(0, MAX_SUMMARY_CHARS);
  }

  function summaryWasTruncated(text) {
    if (typeof text !== 'string') return false;
    // Collapsing whitespace also shortens the text, so "the summary is shorter
    // than the page" is not evidence that anything was cut. Only the cap is.
    return text.trim().length > MAX_SUMMARY_CHARS &&
      summariseInput(text).length === MAX_SUMMARY_CHARS;
  }

  function summaryTooLong(text) {
    return summariseInput(text).length < 40;
  }

  // Results are shown in a page and written to the clipboard, so strip control
  // characters and collapse runaway whitespace before they get there.
  function cleanOutput(text) {
    if (typeof text !== 'string') return '';
    return text
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
      .slice(0, 4000);
  }

  return {
    VISION_TASKS,
    VISION_MODELS,
    TEXT_MODELS,
    SUMMARY_STYLES,
    SUMMARY_STYLE_IDS,
    MAX_QUERY,
    MAX_SUMMARY_CHARS,
    visionTask,
    normaliseTaskId,
    cleanQuery,
    visionRequest,
    needsQuery,
    summaryMessages,
    summaryStyle,
    summariseInput,
    summaryWasTruncated,
    summaryTooLong,
    cleanOutput
  };
});
