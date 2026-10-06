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

  // M2M100 translates directly between 100 languages. The Xenova ONNX port is
  // MIT-licensed and quantized for local CPU inference; it supports language
  // tokens listed below (ISO 639-1/3 codes), not arbitrary language guesses.
  const TRANSLATION_MODEL = {
    id: 'Xenova/m2m100_418M',
    label: 'M2M100 · 100 languages',
    dtype: 'q8',
    source: 'en',
    target: 'es',
    requiredFiles: [
      'config.json',
      'tokenizer.json',
      'onnx/encoder_model_quantized.onnx',
      'onnx/decoder_model_merged_quantized.onnx'
    ]
  };
  const TRANSLATION_LANGUAGE_CODES = [
    'af', 'am', 'ar', 'ast', 'az', 'ba', 'be', 'bg', 'bn', 'br', 'bs', 'ca', 'ceb', 'cs', 'cy',
    'da', 'de', 'el', 'en', 'es', 'et', 'fa', 'ff', 'fi', 'fr', 'fy', 'ga', 'gd', 'gl', 'gu',
    'ha', 'he', 'hi', 'hr', 'ht', 'hu', 'hy', 'id', 'ig', 'ilo', 'is', 'it', 'ja', 'jv', 'ka',
    'kk', 'km', 'kn', 'ko', 'lb', 'lg', 'ln', 'lo', 'lt', 'lv', 'mg', 'mk', 'ml', 'mn', 'mr',
    'ms', 'my', 'ne', 'nl', 'no', 'ns', 'oc', 'or', 'pa', 'pl', 'ps', 'pt', 'ro', 'ru', 'sd',
    'si', 'sk', 'sl', 'so', 'sq', 'sr', 'ss', 'su', 'sv', 'sw', 'ta', 'th', 'tl', 'tn', 'tr',
    'uk', 'ur', 'uz', 'vi', 'wo', 'xh', 'yi', 'yo', 'zh', 'zu'
  ];
  const MAX_TRANSLATION_CHARS = 24000;
  const MAX_TRANSLATION_CHUNK = 700;
  const LANGUAGE_LABELS = {
    af: 'Afrikaans', am: 'Amharic', ar: 'Arabic', ast: 'Asturian', az: 'Azerbaijani', ba: 'Bashkir',
    be: 'Belarusian', bg: 'Bulgarian', bn: 'Bengali', br: 'Breton', bs: 'Bosnian', ca: 'Catalan',
    ceb: 'Cebuano', cs: 'Czech', cy: 'Welsh', da: 'Danish', de: 'German', el: 'Greek', en: 'English',
    es: 'Spanish', et: 'Estonian', fa: 'Persian', ff: 'Fula', fi: 'Finnish', fr: 'French',
    fy: 'Western Frisian', ga: 'Irish', gd: 'Scottish Gaelic', gl: 'Galician', gu: 'Gujarati',
    ha: 'Hausa', he: 'Hebrew', hi: 'Hindi', hr: 'Croatian', ht: 'Haitian Creole', hu: 'Hungarian',
    hy: 'Armenian', id: 'Indonesian', ig: 'Igbo', ilo: 'Iloko', is: 'Icelandic', it: 'Italian',
    ja: 'Japanese', jv: 'Javanese', ka: 'Georgian', kk: 'Kazakh', km: 'Khmer', kn: 'Kannada',
    ko: 'Korean', lb: 'Luxembourgish', lg: 'Ganda', ln: 'Lingala', lo: 'Lao', lt: 'Lithuanian',
    lv: 'Latvian', mg: 'Malagasy', mk: 'Macedonian', ml: 'Malayalam', mn: 'Mongolian', mr: 'Marathi',
    ms: 'Malay', my: 'Burmese', ne: 'Nepali', nl: 'Dutch', no: 'Norwegian', ns: 'Northern Sotho',
    oc: 'Occitan', or: 'Odia', pa: 'Punjabi', pl: 'Polish', ps: 'Pashto', pt: 'Portuguese',
    ro: 'Romanian', ru: 'Russian', sd: 'Sindhi', si: 'Sinhala', sk: 'Slovak', sl: 'Slovenian',
    so: 'Somali', sq: 'Albanian', sr: 'Serbian', ss: 'Swati', su: 'Sundanese', sv: 'Swedish',
    sw: 'Swahili', ta: 'Tamil', th: 'Thai', tl: 'Tagalog', tn: 'Tswana', tr: 'Turkish',
    uk: 'Ukrainian', ur: 'Urdu', uz: 'Uzbek', vi: 'Vietnamese', wo: 'Wolof', xh: 'Xhosa',
    yi: 'Yiddish', yo: 'Yoruba', zh: 'Chinese', zu: 'Zulu'
  };
  const TRANSLATION_LANGUAGES = TRANSLATION_LANGUAGE_CODES.map((id) => ({
    id,
    label: LANGUAGE_LABELS[id]
  })).sort((a, b) => a.label.localeCompare(b.label));
  const TRANSLATION_DEFAULT_SOURCE = 'en';
  const TRANSLATION_DEFAULT_TARGET = 'es';
  const TRANSLATION_DEFAULT = { source: TRANSLATION_DEFAULT_SOURCE, target: TRANSLATION_DEFAULT_TARGET };

  function translationInput(text) {
    return (typeof text === 'string' ? text : '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, MAX_TRANSLATION_CHARS);
  }

  function translationWasTruncated(text) {
    if (typeof text !== 'string') return false;
    const clean = text
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return clean.length > MAX_TRANSLATION_CHARS;
  }

  function translationChunks(text, maxLength) {
    const input = translationInput(text);
    const limit = Math.max(100, Number(maxLength) || MAX_TRANSLATION_CHUNK);
    const chunks = [];
    let rest = input;
    while (rest.length > limit) {
      let end = Math.max(rest.lastIndexOf('\n\n', limit), rest.lastIndexOf('\n', limit));
      const sentence = Math.max(rest.lastIndexOf('. ', limit), rest.lastIndexOf('! ', limit), rest.lastIndexOf('? ', limit));
      if (sentence > limit * 0.45) end = Math.max(end, sentence + 1);
      if (end < limit * 0.45) end = rest.lastIndexOf(' ', limit);
      if (end <= 0) end = limit;
      const chunk = rest.slice(0, end).trim();
      if (chunk) chunks.push(chunk);
      rest = rest.slice(end).trim();
    }
    if (rest) chunks.push(rest);
    return chunks;
  }

  function translationLanguageFor(id) {
    return TRANSLATION_LANGUAGES.find((language) => language.id === id) || null;
  }

  function translationModelFor(target) {
    return translationLanguageFor(target) ? TRANSLATION_MODEL : null;
  }

  function translationTooShort(text) {
    return translationInput(text).length < 2;
  }

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
    tldr: 'Summarise the following in one sentence. Reply with that sentence only.',
    plain: 'Explain the following in simple everyday language for a reader who may find dense text difficult. Keep the important facts, define unavoidable jargon briefly, and use short sentences. Reply with the explanation only.'
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
    TRANSLATION_MODEL,
    TRANSLATION_LANGUAGES,
    TRANSLATION_LANGUAGE_CODES,
    TRANSLATION_DEFAULT_SOURCE,
    TRANSLATION_DEFAULT_TARGET,
    TRANSLATION_DEFAULT,
    MAX_TRANSLATION_CHARS,
    MAX_TRANSLATION_CHUNK,
    translationInput,
    translationWasTruncated,
    translationChunks,
    translationLanguageFor,
    translationModelFor,
    translationTooShort,
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
