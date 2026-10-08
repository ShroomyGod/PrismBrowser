'use strict';

(async function () {
  await PrismUI.boot();
  const $ = (id) => document.getElementById(id);
  const imageEl = $('screen-image');
  const stage = $('screen-stage');
  const frame = $('selection');
  const file = $('image-file');
  const summary = $('overview-text');
  const status = $('status');
  const progress = $('progress');
  const taskSelect = $('task-select');
  const query = $('vision-query');
  const sourceLanguage = $('source-language');
  const targetLanguage = $('target-language');
  let imageUrl = '';
  let sourceText = '';
  let sourceTabId = null;
  let resultText = '';
  let resultTask = '';
  let cropRect = null;
  let start = null;
  let dragging = false;
  let taskList = [];
  let currentTask = 'caption';
  let aiEnabled = true;

  function say(text) { status.textContent = text || ''; }

  function updateActions() {
    const disabled = !imageUrl || !aiEnabled;
    $('describe').disabled = disabled;
    $('describe').textContent = cropRect ? '✦  Describe selection' : '✦  Describe image';
    $('copy-text').disabled = disabled;
    $('translate').disabled = disabled;
    $('copy-image').disabled = disabled;
  }

  function busy(on, message) {
    progress.classList.toggle('on', !!on);
    if (message) say(message);
    if (on) document.querySelectorAll('.action').forEach((button) => { button.disabled = true; });
    else updateActions();
  }

  function setImage(url) {
    imageUrl = url || '';
    resultText = '';
    resultTask = '';
    cropRect = null;
    frame.hidden = true;
    $('empty-screen').hidden = !!imageUrl;
    imageEl.hidden = !imageUrl;
    $('mini-image').hidden = !imageUrl;
    $('visual-image').hidden = !imageUrl;
    $('result-card').hidden = true;
    if (imageUrl) {
      imageEl.onload = () => requestAnimationFrame(() => {
        stage.style.setProperty('--image-aspect', imageEl.naturalWidth + ' / ' + imageEl.naturalHeight);
        $('mini-image').src = imageUrl;
        $('visual-image').src = imageUrl;
      });
      imageEl.src = imageUrl;
    } else imageEl.removeAttribute('src');
    updateActions();
  }

  function point(event) {
    const bounds = imageEl.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top))
    };
  }

  function drawFrame() {
    if (!cropRect) { frame.hidden = true; updateActions(); return; }
    frame.hidden = false;
    frame.style.left = cropRect.x + 'px';
    frame.style.top = cropRect.y + 'px';
    frame.style.width = cropRect.width + 'px';
    frame.style.height = cropRect.height + 'px';
    updateActions();
  }

  imageEl.addEventListener('pointerdown', (event) => {
    if (!imageUrl || !aiEnabled) return;
    event.preventDefault();
    imageEl.setPointerCapture(event.pointerId);
    start = point(event);
    cropRect = { x: start.x, y: start.y, width: 0, height: 0 };
    dragging = true;
    drawFrame();
  });
  imageEl.addEventListener('pointermove', (event) => {
    if (!dragging || !start) return;
    const end = point(event);
    cropRect = {
      x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y)
    };
    drawFrame();
  });
  imageEl.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    if (!cropRect || cropRect.width < 12 || cropRect.height < 12) {
      cropRect = null;
      frame.hidden = true;
      updateActions();
    } else say('Selection ready · drag again to change it, or clear the frame.');
  });
  imageEl.addEventListener('pointercancel', () => { dragging = false; });
  frame.addEventListener('click', (event) => {
    event.stopPropagation();
    cropRect = null;
    frame.hidden = true;
    updateActions();
    say('Using the full image.');
  });

  function selectedRect() {
    const bounds = imageEl.getBoundingClientRect();
    if (!cropRect || cropRect.width < 10 || cropRect.height < 10) {
      return { x: 0, y: 0, width: imageEl.naturalWidth, height: imageEl.naturalHeight };
    }
    return {
      x: cropRect.x * imageEl.naturalWidth / bounds.width,
      y: cropRect.y * imageEl.naturalHeight / bounds.height,
      width: cropRect.width * imageEl.naturalWidth / bounds.width,
      height: cropRect.height * imageEl.naturalHeight / bounds.height
    };
  }

  async function selectedImage() {
    if (!imageUrl || !imageEl.naturalWidth) return '';
    if (!cropRect || cropRect.width < 10 || cropRect.height < 10) return imageUrl;
    const rect = selectedRect();
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(rect.width));
    canvas.height = Math.max(1, Math.round(rect.height));
    canvas.getContext('2d').drawImage(imageEl, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }

  async function runVision(task, input) {
    if (!imageUrl || !aiEnabled) return null;
    busy(true, 'Analysing locally…');
    try {
      const response = await window.prism.aiVision(await selectedImage(), task, input || '');
      if (response && response.error) throw new Error(response.error);
      const result = response.result || {};
      resultText = result.text || '';
      resultTask = task;
      $('result-text').textContent = resultText || 'The local model returned no text.';
      $('visual-local-result').textContent = resultText;
      $('visual-caption').textContent = resultText || 'No local description returned.';
      summary.textContent = resultText || 'The local model returned no text.';
      $('summary-time').textContent = result.ms ? 'Generated locally in ' + (result.ms / 1000).toFixed(1) + 's' : 'Generated by the on-device model';
      $('result-card').hidden = false;
      say('Local image analysis complete' + (result.ms ? ' · ' + (result.ms / 1000).toFixed(1) + 's' : ''));
      return result;
    } catch (error) {
      say(error.message || 'Prism Vision could not analyse this image.');
      return null;
    } finally { busy(false); }
  }

  async function runSummary(text) {
    if (!aiEnabled || !text || text.trim().length < 40) return null;
    busy(true, 'Writing a local AI Overview…');
    summary.textContent = 'Summarising on this device…';
    try {
      const response = await window.prism.aiSummariseText(text, 'paragraph');
      if (response && response.error) throw new Error(response.error);
      const result = response.result || {};
      summary.textContent = result.text || 'The local model returned no summary.';
      $('summary-time').textContent = result.ms ? 'Generated locally in ' + (result.ms / 1000).toFixed(1) + 's' : 'Generated by the on-device model';
      return result;
    } catch (error) {
      summary.textContent = error.message || 'Could not summarise this page.';
      return null;
    } finally { busy(false); }
  }

  function acceptFile(imageFile) {
    if (!imageFile || !/^image\//.test(imageFile.type)) return;
    const reader = new FileReader();
    reader.onload = () => {
      sourceText = '';
      sourceTabId = null;
      $('recapture').hidden = true;
      $('source-title').textContent = 'Image from this device';
      $('source-url').textContent = 'Private · processed only on this device';
      $('source-info').textContent = 'Image selected from your device · processed locally';
      setImage(String(reader.result));
      summary.textContent = 'Choose “Describe selection” for a local image overview, or use Copy text / Translate.';
      $('summary-time').textContent = 'No content is uploaded or searched online.';
      $('visual-caption').textContent = 'Run local analysis to describe this image.';
      say('Image ready. Drag over a region to select it.');
    };
    reader.readAsDataURL(imageFile);
  }

  $('describe').addEventListener('click', () => runVision(currentTask, query.value));
  $('copy-text').addEventListener('click', async () => {
    let text = resultText;
    if (!text || resultTask !== 'ocr') {
      const result = await runVision('ocr');
      text = result && result.text;
    }
    if (!text) return;
    const copied = await window.prism.copyText(text);
    say(copied ? 'Recognised text copied.' : 'Could not copy recognised text.');
  });
  $('translate').addEventListener('click', async () => {
    let text = resultText;
    if (!text || resultTask !== 'ocr') {
      const result = await runVision('ocr');
      text = result && result.text;
    }
    if (!text) return;
    busy(true, 'Translating locally…');
    try {
      const response = await window.prism.aiTranslateText(text, sourceLanguage.value, targetLanguage.value);
      if (response && response.error) throw new Error(response.error);
      const result = response.result || {};
      resultText = result.text || '';
      resultTask = 'translation';
      $('result-text').textContent = resultText;
      $('visual-local-result').textContent = resultText;
      $('visual-caption').textContent = resultText;
      $('result-card').hidden = false;
      summary.textContent = resultText;
      say('Translated locally' + (result.ms ? ' · ' + (result.ms / 1000).toFixed(1) + 's' : ''));
    } catch (error) { say(error.message || 'Could not translate the selection.'); }
    finally { busy(false); }
  });
  $('copy-image').addEventListener('click', async () => {
    try {
      const response = await window.prism.aiCopyImage(await selectedImage());
      if (response && response.error) throw new Error(response.error);
      say('Selected image copied.');
    } catch (error) { say(error.message || 'Could not copy the image.'); }
  });
  $('upload').addEventListener('click', () => file.click());
  file.addEventListener('change', () => acceptFile(file.files && file.files[0]));
  $('drop-overlay').addEventListener('click', () => file.click());
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    const dropped = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    acceptFile(dropped);
  });

  $('recapture').addEventListener('click', async () => {
    if (!sourceTabId) { say('This tab was not opened from a captured web page.'); return; }
    busy(true, 'Capturing the source page…');
    try {
      const response = await window.prism.aiCapture(sourceTabId);
      if (response && response.error) throw new Error(response.error);
      sourceText = response.text || '';
      $('source-title').textContent = response.title || 'Captured web page';
      $('source-url').textContent = response.url || 'Visible viewport capture';
      $('source-info').textContent = 'Captured from this tab · ' + (response.url || 'website') + ' · handled locally';
      setImage(response.image);
      if (sourceText.trim().length >= 40) await runSummary(sourceText);
      else {
        summary.textContent = 'There is not enough readable page text for a summary. Describe the selected region to ask the local vision model about the screenshot.';
        $('summary-time').textContent = 'Local only · no online visual search';
      }
    } catch (error) { say(error.message || 'Could not capture the source page.'); }
    finally { busy(false); }
  });
  $('clear-selection').addEventListener('click', () => {
    cropRect = null;
    frame.hidden = true;
    updateActions();
    say('Using the full image.');
  });
  $('retry-summary').addEventListener('click', () => runSummary(sourceText));
  taskSelect.addEventListener('change', (event) => {
    currentTask = event.target.value;
    const task = taskList.find((entry) => entry.id === currentTask);
    query.hidden = !(task && task.needsInput);
    if (task && task.needsInput) query.focus();
  });

  function setTab(tab) {
    document.querySelectorAll('[data-tab]').forEach((item) => item.classList.toggle('selected', item.dataset.tab === tab));
    document.querySelectorAll('[data-panel]').forEach((panel) => { panel.hidden = tab !== 'all' && panel.dataset.panel !== tab; });
    if (tab === 'exact') say('Exact-match search is unavailable offline. Prism does not upload images to a visual-search service.');
    else if (tab === 'visual') say('Visual descriptions are generated locally; no internet results are shown.');
  }
  $('exact-tab').addEventListener('click', () => setTab('exact'));
  $('all-tab').addEventListener('click', () => setTab('all'));
  $('visual-tab').addEventListener('click', () => setTab('visual'));

  let pageSession = null;
  try { pageSession = await window.prism.aiTakeCapture(); } catch (_) {}
  try {
    const meta = await window.prism.aiTasks();
    if (meta && meta.error) throw new Error(meta.error);
    taskList = meta.vision || [];
    taskSelect.textContent = '';
    for (const task of taskList) {
      const option = document.createElement('option');
      option.value = task.id;
      option.textContent = task.label;
      taskSelect.appendChild(option);
    }
    if (!taskList.some((task) => task.id === currentTask)) currentTask = taskList[0] ? taskList[0].id : 'caption';
    taskSelect.value = currentTask;
    const selectedTask = taskList.find((task) => task.id === currentTask);
    query.hidden = !(selectedTask && selectedTask.needsInput);
    if (meta.enabled === false) {
      aiEnabled = false;
      say('Local AI is turned off in Settings.');
      updateActions();
    }
  } catch (error) { say((error && error.message) || 'Local AI is unavailable.'); }

  window.prism.aiWatch();
  window.prism.onAiProgress((event) => {
    if (!event) return;
    if (event.stage === 'loading') say('Loading ' + (event.model || 'the local model') + ' for the first time…');
    else if (event.stage === 'running') say('Running ' + (event.model || 'the local model') + ' on this device…');
    else if (event.stage === 'crashed') { busy(false); say(event.error || 'The local AI engine stopped.'); }
  });

  const capture = pageSession && pageSession.capture;
  if (capture) {
    sourceText = capture.text || '';
    sourceTabId = capture.sourceTabId || null;
    $('recapture').hidden = !sourceTabId;
    $('source-title').textContent = capture.title || 'Captured web page';
    $('source-url').textContent = capture.url || 'Visible viewport capture';
    $('source-info').textContent = 'Captured from this tab · ' + (capture.url || 'website') + ' · handled locally';
    if (capture.image) setImage(capture.image);
    else {
      $('source-info').textContent = capture.error || 'Screenshot capture was unavailable; you can still analyse the page text.';
      $('visual-caption').textContent = 'Screenshot is not available for this page.';
    }
    if (sourceText.trim().length >= 40) await runSummary(sourceText);
    else {
      summary.textContent = 'This page has little readable text. Describe the selected region for a local AI Overview.';
      $('summary-time').textContent = 'Local only · no online visual search';
    }
  } else if (location.hash === '#models') {
    $('models').open = true;
    summary.textContent = 'Local model settings.';
  } else {
    summary.textContent = 'Capture a web page from the browser menu, drop an image, or open a local image to begin.';
    say('Prism Vision runs locally. No image is sent to a search service.');
  }

  if (!pageSession || pageSession.error) {
    aiEnabled = false;
    say((pageSession && pageSession.error) || 'Open Prism Vision from the browser menu to enable local AI actions.');
    updateActions();
    $('retry-summary').disabled = true;
    $('clear-cache').disabled = true;
  } else  if (pageSession && pageSession.sourceTabId) {
    sourceTabId = pageSession.sourceTabId;
    $('recapture').hidden = false;
  }


  $('clear-cache').addEventListener('click', async () => {
    $('clear-cache').disabled = true;
    const response = await window.prism.aiClearCache();
    $('clear-cache').disabled = false;
    if (response && response.error) { $('model-note').textContent = 'Could not clear downloads: ' + response.error; return; }
    await refreshModels();
  });

  async function refreshModels() {
    try {
      const info = await window.prism.aiStatus();
      if (info && info.error) throw new Error(info.error);
      $('model-note').innerHTML = '<div>Vision: <code>' + info.vision.id + '</code> (' + info.vision.dtype + ')</div>' +
        '<div>Text: <code>' + info.text.id + '</code> (' + info.text.dtype + ')</div>' +
        '<div class="models-origin">' + (info.bundled ? 'Included with Prism · works offline.' : 'Not bundled · fetched on first use.') + '</div>' +
        '<div>' + (info.cache.files ? info.cache.files + ' additional cached files · ' + (info.cache.bytes / 1048576).toFixed(1) + ' MB' : 'No additional downloads.') + '</div>';
    } catch (error) {
      $('model-note').textContent = error.message || 'Local AI is unavailable.';
    }
  }
  await refreshModels();
  updateActions();
})();
