// search.js — Prism Search results.
//
// Queries use federated SearXNG web results and the encrypted local index.
// Typing stays responsive with local results; submitting fetches live results.
'use strict';
(async function () {
  await PrismUI.boot();

  const input = document.getElementById('q');
  const resultsEl = document.getElementById('results');
  const metaEl = document.getElementById('meta');
  const sugBox = document.getElementById('sugs');
  const form = document.getElementById('sform');

  let currentQuery = null;
  let currentOffset = 0;
  let sugItems = [];
  let sugSel = -1;
  let runToken = 0;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeRe(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function highlight(text, terms) {
    if (!text) return '';
    let html = escapeHtml(text);
    const seen = new Set();
    for (const t of terms || []) {
      const key = String(t || '').toLowerCase();
      if (!t || t.length < 2 || seen.has(key)) continue;
      seen.add(key);
      html = html.replace(new RegExp('(' + escapeRe(escapeHtml(t)) + ')', 'gi'), '<b>$1</b>');
    }
    return html;
  }
  function setMeta(text) { metaEl.textContent = text || ''; }

  function readUrl() {
    const qs = new URLSearchParams(location.search);
    return { q: qs.get('q') || '', o: parseInt(qs.get('o') || '0', 10) || 0 };
  }
  function pushUrl(q, o, replace) {
    const url = q ? PrismUI.searchUrl(q) + (o ? '&o=' + o : '') : 'prism://search';
    try {
      if (replace) history.replaceState({ q, o }, '', url);
      else history.pushState({ q, o }, '', url);
    } catch (_) { location.href = url; }
  }

  function hideSugs() { sugBox.style.display = 'none'; sugItems = []; sugSel = -1; }
  function renderSugs(terms) {
    sugBox.textContent = '';
    sugItems = terms || [];
    if (!sugItems.length) { hideSugs(); return; }
    sugItems.forEach((term, i) => {
      const row = document.createElement('div');
      row.className = 'sug' + (i === sugSel ? ' sel' : '');
      row.textContent = term;
      row.addEventListener('mousedown', (event) => { event.preventDefault(); go(term); });
      sugBox.appendChild(row);
    });
    sugBox.style.display = '';
  }
  function moveSug(delta) {
    if (!sugItems.length) return;
    sugSel = (sugSel + delta + sugItems.length) % sugItems.length;
    renderSugs(sugItems);
  }

  function showLanding() {
    resultsEl.textContent = '';
    const box = PrismUI.el('div', 'build-cta');
    const img = document.createElement('img');
    img.className = 'wordmark';
    img.src = '/assets/wordmark@2x.png'; img.alt = 'Prism';
    box.appendChild(img);
    box.appendChild(PrismUI.el('h2', null, 'Prism Browser Search'));
    box.appendChild(PrismUI.el('div', 'muted',
      'Search the web through Prism Search and your private on-device index. A local SearXNG server is tried first; if unavailable, a free public instance may receive your query. Operators: "exact phrase", -exclude, site:example.com, intitle:word.'));
    resultsEl.appendChild(box);
    window.prism.searchStats().then((stats) => setMeta('Index: ' + stats.docs.toLocaleString() +
      ' pages across ' + stats.hosts.toLocaleString() + ' sites - ' + stats.terms.toLocaleString() + ' terms'))
      .catch(() => setMeta(''));
  }

  function showEmptyIndex(message) {
    resultsEl.textContent = '';
    const box = PrismUI.el('div', 'build-cta');
    const img = document.createElement('img');
    img.className = 'wordmark';
    img.src = '/assets/wordmark@2x.png'; img.alt = 'Prism';
    box.appendChild(img);
    box.appendChild(PrismUI.el('h2', null, 'No saved pages in your Prism Browser index yet'));
    box.appendChild(PrismUI.el('div', 'muted', message ||
      'Build a private encrypted index on this device to keep searching when live results are unavailable.'));
    const btn = PrismUI.el('button', 'primary', 'Crawl the web now');
    btn.style.marginTop = '18px';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = 'Crawler started - building index...';
      window.prism.crawlRun();
      poll();
    });
    box.appendChild(btn);
    box.appendChild(PrismUI.el('div', 'muted', 'The crawler is polite: robots.txt, per-site caps, rate limits.'));
    resultsEl.appendChild(box);

    function poll() {
      setTimeout(async () => {
        try {
          const status = await window.prism.crawlStatus();
          setMeta('Crawling: ' + status.progress.pages + ' pages fetched, ' + status.progress.errors +
            ' errors, ' + status.progress.queue + ' queued - ' + status.indexDocs + ' pages indexed');
          if (status.running) poll();
          else if (status.indexDocs > 0) run(currentQuery, 0, true, false);
          else { btn.disabled = false; btn.textContent = 'Crawl the web now'; }
        } catch (_) { btn.disabled = false; btn.textContent = 'Crawl the web now'; }
      }, 2000);
    }
  }

  async function renderResults(res, query) {
    resultsEl.textContent = '';
    const terms = [...(res.parsed.terms || []), ...(res.parsed.phrases || [])];
    setMeta(res.total.toLocaleString() + ' results' +
      (res.webCount ? ' · ' + res.webCount + ' live web' : '') +
      ' · ' + res.docs.toLocaleString() + ' pages in your on-device index');

    for (const result of res.results) {
      const div = PrismUI.el('div', 'result');
      const url = PrismUI.el('div', 'u');
      url.appendChild(PrismUI.el('span', null, result.host || ''));
      url.appendChild(PrismUI.el('span', null, '-'));
      url.appendChild(PrismUI.el('span', null, result.web ? 'web result' : 'saved page'));
      div.appendChild(url);
      const link = PrismUI.el('a', 't');
      link.href = result.url; link.textContent = result.title;
      link.addEventListener('click', (event) => { event.preventDefault(); location.href = result.url; });
      div.appendChild(link);
      const snippet = PrismUI.el('div', 's');
      snippet.innerHTML = highlight(result.snippet || '', terms);
      div.appendChild(snippet);
      resultsEl.appendChild(div);
    }

    if (res.total > 20 || currentOffset > 0) {
      const pager = PrismUI.el('div', 'pager');
      const pages = Math.min(8, Math.ceil(res.total / 20));
      for (let page = 0; page < pages; page++) {
        const pageOffset = page * 20;
        const button = PrismUI.el('button', 'small' + (pageOffset === currentOffset ? ' primary' : ''), String(page + 1));
        button.addEventListener('click', () => run(query, pageOffset, false, true));
        pager.appendChild(button);
      }
      resultsEl.appendChild(pager);
    }
  }

  async function run(query, offset, replaceUrl, includeWeb = false) {
    currentQuery = query;
    currentOffset = offset || 0;
    if (!query) { showLanding(); return; }
    document.title = query + ' - Prism Search';
    const token = ++runToken;
    setMeta(includeWeb ? 'Searching Prism Search...' : 'Searching your on-device index...');

    const localOffset = currentOffset;
    const localLimit = 80;
    const [local, webResults] = await Promise.all([
      window.prism.search(query, localOffset, localLimit).catch(() => ({
        query, parsed: { terms: query.split(/\s+/), phrases: [] }, results: [], total: 0, took: 0, docs: 0, emptyIndex: true
      })),
      includeWeb ? window.prism.searchWeb(query).catch(() => []) : Promise.resolve([])
    ]);
    if (token !== runToken) return;

    const localResults = local.results || [];
    const localUrls = new Set(localResults.map((result) => String(result.url || '').replace(/\/$/, '').toLowerCase()));
    const uniqueWeb = webResults.filter((result) => !localUrls.has(String(result.url || '').replace(/\/$/, '').toLowerCase()));
    const combined = [
      ...uniqueWeb.map((result) => ({ ...result, crawledAt: 0, web: true })),
      ...localResults
    ];
    const results = combined.slice(currentOffset, currentOffset + 20);
    const res = {
      ...local,
      parsed: local.parsed || { terms: query.split(/\s+/), phrases: [] },
      results,
      total: uniqueWeb.length + (local.total || 0),
      webCount: uniqueWeb.length,
      emptyIndex: !!local.emptyIndex && uniqueWeb.length === 0
    };

    pushUrl(query, currentOffset, !!replaceUrl);
    if (!results.length) {
      showEmptyIndex(includeWeb
        ? 'Live results are temporarily unavailable. Try again, or build a private encrypted index on this device.'
        : 'Press Enter to search live web results, or build a private encrypted index on this device.');
      setMeta(includeWeb ? 'Live results are temporarily unavailable.' : 'Press Enter to search Prism Search.');
      return;
    }
    await renderResults(res, query);
    if (includeWeb && !uniqueWeb.length) {
      setMeta('Live results are temporarily unavailable; showing your on-device index.');
    }
  }

  function go(query) {
    hideSugs(); input.value = query; input.focus();
    run(query, 0, false, true);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (query) go(query);
  });

  input.addEventListener('input', () => {
    const query = input.value.trim();
    sugSel = -1;
    if (!query) { hideSugs(); showLanding(); return; }
    clearTimeout(input._t);
    input._t = setTimeout(() => run(query, 0, true, false), 140);
    clearTimeout(input._st);
    input._st = setTimeout(async () => {
      try { renderSugs(await window.prism.searchSuggest(input.value.trim())); }
      catch (_) { hideSugs(); }
    }, 110);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); moveSug(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); moveSug(-1); }
    else if (event.key === 'Escape') hideSugs();
    else if (event.key === 'Enter' && sugSel >= 0 && sugItems[sugSel]) {
      event.preventDefault(); go(sugItems[sugSel]);
    }
  });
  input.addEventListener('blur', () => setTimeout(hideSugs, 120));

  window.addEventListener('popstate', () => {
    const { q, o } = readUrl(); input.value = q;
    run(q, o, true, !!q);
  });

  document.getElementById('logo').addEventListener('click', () => go(''));
  const initial = readUrl();
  input.value = initial.q;
  input.focus();
  input.setSelectionRange(initial.q.length, initial.q.length);
  run(initial.q, initial.o, true, !!initial.q);
})();
