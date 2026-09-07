import {
  wareki, yearLabel, clampRange, shiftRange, overlaps, filterEntries, fitEntries,
  timelineBuckets, attachBooks, relatedEntries, RELATION_LABELS,
} from './period-model.mjs';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const paragraphs = text => String(text || '').split(/\n\n+/).filter(p => p.trim()).map(p => `<p>${esc(p).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replaceAll('\n', '<br>')}</p>`).join('');
const mobile = window.matchMedia('(max-width: 760px)');
const state = {
  data: null, editorial: null, details: {}, entries: [], categories: new Set(),
  range: { start: 1913, end: 1915 }, query: '', reading: false, onlyRead: false,
  view: mobile.matches ? 'list' : 'timeline', viewChosen: false, selectedId: null,
  guideId: null, step: 0, beforeSearch: null, visible: [],
};
let categoryMap = {}, laneMap = {}, byId = new Map();
let returnFocus = null;
let lastTimelineWidth = 0;
let readingError = false;

async function getJSON(url, optional = false) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`${response.status}: ${url}`);
    return await response.json();
  } catch (error) {
    if (optional) return null;
    throw error;
  }
}

async function init() {
  try {
    const periodId = new URLSearchParams(location.search).get('id') || 'meiji-ww2';
    const manifest = await getJSON('periods/manifest.json');
    if (!manifest.periods.some(p => p.id === periodId)) throw new Error('unknown-period');
    const [data, details, editorial, books] = await Promise.all([
      getJSON(`periods/${periodId}.json`), getJSON(`periods/${periodId}.details.json`, true),
      getJSON(`periods/${periodId}.explore.json`, true), getJSON('../my-books/books-data.json', true),
    ]);
    state.data = data;
    state.editorial = editorial || { courses: [], entries: {}, sources: {}, relations: [], bookLinks: [] };
    state.details = { ...(details || {}) };
    for (const [id, content] of Object.entries(state.editorial.entries)) {
      state.details[id] = { ...state.details[id], ...content };
    }
    const attached = attachBooks(data.entries, books || {}, state.editorial.bookLinks, data);
    state.entries = attached.entries;
    readingError = books === null;
    for (const entry of state.entries.filter(e => e.isReading)) {
      const book = entry.bookRecords[0];
      state.details[entry.id] = { era: book.era, authorBio: book.authorBio, themes: book.themes || [], dateLabel: '原著発行', sourceIds: [] };
    }
    categoryMap = Object.fromEntries([...data.categories, { id: 'reading', label: '読書', color: '#536448' }].map(c => [c.id, c]));
    laneMap = Object.fromEntries([...data.lanes, { id: 'reading', label: '読書の記録' }].map(l => [l.id, l]));
    byId = new Map(state.entries.map(e => [e.id, e]));
    state.categories = new Set(Object.keys(categoryMap));
    $('periodTitle').textContent = data.label;
    document.title = `${data.label} — 人類知マップ`;
    $('bookCount').textContent = readingError ? '読込不可' : `${attached.bookCount}冊`;
    $('readingToggle').disabled = readingError;
    $('loading').hidden = true;
    if (!details) announce('詳しい解説を読み込めませんでした。概要と年表は利用できます。');
    bindEvents();
    restoreURL();
    render();
    if (state.selectedId) renderDetail();
    const observer = new ResizeObserver(() => {
      const width = Math.round($('timelineView').clientWidth);
      if (width > 0 && width !== lastTimelineWidth && state.view === 'timeline') renderTimeline();
    });
    observer.observe($('timelineView'));
  } catch (error) {
    $('loading').hidden = true;
    $('errorState').hidden = false;
    $('errorState').innerHTML = `<h3>${error.message === 'unknown-period' ? 'この時代は見つかりませんでした' : '年表を読み込めませんでした'}</h3><p>ページを再読み込みするか、目次から時代を選び直してください。</p><a href="./">人類知マップの目次へ</a>`;
    console.error(error);
  }
}

function announce(message) { $('announcement').textContent = message; }
function activeEntries() { return state.entries.filter(e => !e.isReading || state.reading); }
function searchMatches() { return filterEntries(state.entries, state.details, { ...state, range: null }); }
function availableCategories() { return Object.values(categoryMap).filter(c => c.id !== 'reading' || state.reading); }
function resetCategories() { state.categories = new Set(Object.keys(categoryMap)); state.onlyRead = false; }

function writeURL(push = false) {
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('id', state.data.id);
  url.searchParams.set('from', state.range.start);
  url.searchParams.set('to', state.range.end);
  url.searchParams.set('view', state.view);
  if (state.query) url.searchParams.set('q', state.query);
  if (state.reading) url.searchParams.set('reading', '1');
  if (state.onlyRead) url.searchParams.set('read', '1');
  if (state.categories.size !== Object.keys(categoryMap).length) url.searchParams.set('categories', [...state.categories].join(','));
  if (state.selectedId) url.searchParams.set('entry', state.selectedId);
  if (state.guideId) { url.searchParams.set('guide', state.guideId); url.searchParams.set('step', state.step); }
  if (push && url.href !== location.href) history.pushState({}, '', url);
  else history.replaceState({}, '', url);
}

function restoreURL() {
  const params = new URLSearchParams(location.search);
  state.range = clampRange(params.get('from') ?? 1913, params.get('to') ?? 1915, state.data);
  state.view = ['list', 'timeline'].includes(params.get('view')) ? params.get('view') : mobile.matches ? 'list' : 'timeline';
  state.viewChosen = params.has('view');
  state.query = params.get('q') || '';
  state.reading = params.get('reading') === '1' && !readingError;
  state.onlyRead = state.reading && params.get('read') === '1';
  state.categories = params.has('categories') ? new Set(params.get('categories').split(',').filter(id => categoryMap[id])) : new Set(Object.keys(categoryMap));
  state.selectedId = byId.has(params.get('entry')) ? params.get('entry') : null;
  if (byId.get(state.selectedId)?.isReading) state.reading = true;
  const guide = state.editorial.courses.find(c => c.id === params.get('guide'));
  state.guideId = guide?.id || null;
  state.step = guide ? Math.max(0, Math.min(guide.steps.length - 1, Number.parseInt(params.get('step'), 10) || 0)) : 0;
  state.beforeSearch = null;
  $('search').value = state.query;
}

function clearQuery(restore = false) {
  if (restore && state.beforeSearch) {
    state.range = state.beforeSearch.range;
    state.view = state.beforeSearch.view;
  }
  state.query = '';
  state.beforeSearch = null;
  $('search').value = '';
}

function setRange(range) {
  $('rangeError').hidden = true;
  clearQuery();
  state.range = clampRange(range.start, range.end, state.data);
  state.guideId = null;
  closeDetail(false);
  render();
  writeURL(true);
}

function runSearch(value) {
  if (!state.query && value.trim()) state.beforeSearch = { range: { ...state.range }, view: state.view };
  state.query = value.trim();
  state.guideId = null;
  closeDetail(false);
  if (state.query) {
    state.view = 'list';
    const fit = fitEntries(searchMatches(), state.data);
    if (fit) state.range = fit;
  } else clearQuery(true);
  render();
  writeURL();
}

function bindEvents() {
  $('search').addEventListener('input', event => runSearch(event.target.value));
  $('clearSearch').addEventListener('click', () => { runSearch(''); $('search').focus(); });
  $('previousRange').addEventListener('click', () => setRange(shiftRange(state.range, -1, state.data)));
  $('nextRange').addEventListener('click', () => setRange(shiftRange(state.range, 1, state.data)));
  function rangeInput() {
    const start = Number($('rangeStart').value), end = Number($('rangeEnd').value);
    const valid = $('rangeStart').value !== '' && $('rangeEnd').value !== '' && Number.isInteger(start) && Number.isInteger(end) && start >= state.data.start && end <= state.data.end && start <= end;
    $('rangeError').hidden = valid;
    if (!valid) { $('rangeError').textContent = `${state.data.start}〜${state.data.end}年の範囲で、開始年が終了年以下になるように入力してください。`; return; }
    setRange({ start, end });
  }
  for (const id of ['rangeStart', 'rangeEnd']) {
    $(id).addEventListener('change', rangeInput);
    $(id).addEventListener('keydown', event => { if (event.key === 'Enter') rangeInput(); });
  }
  document.querySelectorAll('[data-window]').forEach(button => button.addEventListener('click', () => {
    const n = button.dataset.window;
    if (n === 'all') return setRange(state.data);
    const width = Number(n) - 1;
    const start = Math.min(state.range.start, state.data.end - width);
    setRange({ start, end: start + width });
  }));
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
    state.view = button.dataset.view; state.viewChosen = true; renderResults(); writeURL();
  }));
  $('resetFilters').addEventListener('click', () => { resetCategories(); refilter(); });
  $('resetAll').addEventListener('click', () => { resetCategories(); setRange(state.data); });
  $('readingToggle').addEventListener('change', event => {
    state.reading = event.target.checked;
    if (!state.reading) { state.onlyRead = false; if (byId.get(state.selectedId)?.isReading) closeDetail(false); }
    refilter();
    if (state.selectedId) renderDetail();
  });
  $('onlyRead').addEventListener('change', event => { state.onlyRead = event.target.checked; refilter(); });
  $('closeDetail').addEventListener('click', () => closeDetail());
  $('detailBackdrop').addEventListener('click', () => closeDetail());
  document.addEventListener('keydown', event => {
    if ($('detailPane').hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); closeDetail(); }
    if (mobile.matches && event.key === 'Tab') {
      const focusable = [...$('detailPane').querySelectorAll('button:not(:disabled),a[href],summary,input')].filter(el => el.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  window.addEventListener('popstate', () => {
    restoreURL(); render();
    if (state.selectedId) renderDetail(); else hidePane();
  });
  mobile.addEventListener('change', () => {
    if (!state.viewChosen) state.view = mobile.matches ? 'list' : 'timeline';
    syncPaneMode(); renderResults();
  });
}

function refilter() {
  if (state.query) {
    const fit = fitEntries(searchMatches(), state.data);
    if (fit) state.range = fit;
  }
  render(); writeURL();
}

function render() {
  renderGuides(); renderOverview(); renderFilters(); renderResults();
}

function renderOverview() {
  const all = activeEntries();
  const yearCounts = Array.from({ length: state.data.end - state.data.start + 1 }, (_, i) => all.filter(e => e.year === state.data.start + i).length);
  const max = Math.max(1, ...yearCounts);
  const startDecade = Math.floor(state.data.start / 10) * 10;
  const buttons = [];
  for (let year = startDecade; year <= state.data.end; year += 10) {
    const start = Math.max(year, state.data.start), end = Math.min(year + 9, state.data.end);
    const selected = start <= state.range.end && end >= state.range.start;
    const count = all.filter(e => overlaps(e, { start, end })).length;
    const bars = Array.from({ length: end - start + 1 }, (_, i) => `<span class="decade-bar" style="height:${Math.max(4, yearCounts[start + i - state.data.start] / max * 100)}%"></span>`).join('');
    buttons.push(`<button class="decade" type="button" data-decade="${start}" aria-pressed="${selected}" aria-label="${start}〜${end}年を表示・${count}項目"><span class="decade-plot" aria-hidden="true">${bars}</span><span class="decade-year">${year}</span></button>`);
  }
  $('overview').innerHTML = buttons.join('');
  $('overview').querySelectorAll('[data-decade]').forEach(button => button.addEventListener('click', () => setRange({ start: Number(button.dataset.decade), end: Math.min(Number(button.dataset.decade) + 9, state.data.end) })));
  $('overviewCaption').textContent = `${state.data.start}–${state.data.end} · 棒の高さは項目数`;
  $('rangeStart').value = state.range.start;
  $('rangeEnd').value = state.range.end;
  $('rangeWareki').textContent = `${wareki(state.range.start)}${state.range.end === state.range.start ? '' : `〜${wareki(state.range.end)}`}`;
  $('previousRange').disabled = state.range.start <= state.data.start;
  $('nextRange').disabled = state.range.end >= state.data.end;
  const width = state.range.end - state.range.start + 1;
  document.querySelectorAll('[data-window]').forEach(button => button.setAttribute('aria-pressed', button.dataset.window === 'all' ? width === state.data.end - state.data.start + 1 : width === Number(button.dataset.window)));
}

function renderFilters() {
  $('categoryFilters').innerHTML = availableCategories().map(c => `<button type="button" class="category-filter" data-category="${c.id}" aria-pressed="${state.categories.has(c.id)}" style="--category-color:${c.color}">${esc(c.label)}</button>`).join('');
  $('categoryFilters').querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
    const id = button.dataset.category;
    if (state.categories.has(id)) state.categories.delete(id); else state.categories.add(id);
    refilter();
  }));
  $('resetFilters').hidden = availableCategories().every(c => state.categories.has(c.id)) && !state.onlyRead;
  $('readFilter').hidden = !state.reading;
  $('readingNote').hidden = !state.reading;
  $('readingToggle').checked = state.reading;
  $('onlyRead').checked = state.onlyRead;
  $('clearSearch').hidden = !state.query;
}

function renderResults() {
  state.visible = filterEntries(state.entries, state.details, state);
  const total = activeEntries().length;
  const { start, end } = state.range;
  $('resultsTitle').textContent = state.query ? `「${state.query}」の検索結果` : `${start}${start === end ? '' : `–${end}`}年を見渡す`;
  $('resultCount').textContent = `${state.visible.length}項目 / 全${total}項目`;
  const lanes = new Set(state.visible.map(e => e.lane));
  $('resultNote').textContent = state.query ? '全期間のタイトル・概要・著者・テーマから検索しています。項目を選ぶと、背景と関連項目が開きます。' : `${lanes.size}分野を横断。作品は発表年、出来事は発生年・継続期間で配置しています。`;
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', button.dataset.view === state.view));
  const empty = !state.visible.length;
  $('emptyState').hidden = !empty;
  $('timelineView').hidden = empty || state.view !== 'timeline';
  $('listView').hidden = empty || state.view !== 'list';
  $('mapNote').hidden = empty || state.view !== 'timeline';
  if (!empty) {
    if (state.view === 'timeline') renderTimeline(); else renderList();
  }
}

function entryCard(entry, compact = false) {
  const category = categoryMap[entry.category];
  return `<button type="button" class="entry-card${state.selectedId === entry.id ? ' active' : ''}" data-entry="${esc(entry.id)}" style="--entry-color:${category.color}">
    <span class="entry-year">${esc(yearLabel(entry))}</span><span class="entry-body"><strong>${esc(entry.title)}</strong>
    ${!compact ? `<small class="entry-summary">${esc(entry.summary)}</small>` : ''}
    <small><span class="entry-kind">${esc(category.label)}</span>${state.reading && entry.bookRecords?.length ? ' <span class="read-mark">✓ My Books</span>' : ''}</small></span></button>`;
}

function bindEntryButtons(container) {
  container.querySelectorAll('[data-entry]').forEach(button => button.addEventListener('click', () => selectEntry(button.dataset.entry)));
}

function renderList() {
  $('listView').innerHTML = Object.values(laneMap).map(lane => {
    const entries = state.visible.filter(e => e.lane === lane.id);
    if (!entries.length) return '';
    return `<section aria-labelledby="lane-${lane.id}"><h3 class="lane-list-title" id="lane-${lane.id}">${esc(lane.label)}<span>${entries.length}項目</span></h3><div class="entry-grid">${entries.map(e => entryCard(e)).join('')}</div></section>`;
  }).join('');
  bindEntryButtons($('listView'));
}

function renderTimeline() {
  const width = $('timelineView').clientWidth || $('pageContent').clientWidth;
  lastTimelineWidth = Math.round(width);
  const availableColumns = Math.floor((width - (mobile.matches ? 80 : 110)) / 145);
  const count = Math.min(state.range.end - state.range.start + 1, Math.max(1, Math.min(6, availableColumns)));
  const columns = timelineBuckets([], state.range, count);
  const selected = byId.get(state.selectedId);
  const relatedIds = new Set(selected ? relatedEntries(selected, activeEntries(), state.details, state.editorial.relations).map(r => r.entry.id) : []);
  const groups = [];
  const header = `<div class="timeline-header"><span class="timeline-corner">分野 / 西暦</span><div class="timeline-years">${columns.map(c => `<button type="button" data-range-start="${c.start}" data-range-end="${c.end}" aria-label="${c.start}〜${c.end}年の同時代一覧を開く">${c.start}${c.start === c.end ? '' : `–${c.end}`}<small>${wareki(c.start)}</small></button>`).join('')}</div></div>`;
  const rows = Object.values(laneMap).map(lane => {
    const entries = state.visible.filter(e => e.lane === lane.id);
    if (!entries.length) return '';
    const buckets = timelineBuckets(entries, state.range, count);
    return `<div class="timeline-row"><div class="lane-title">${esc(lane.label)}<small>${entries.length}</small></div><div class="lane-cells">${buckets.map(bucket => {
      if (!bucket.items.length) return '<div class="timeline-cell"></div>';
      const representative = bucket.items.find(e => e.id === state.selectedId) || bucket.items[0];
      const index = groups.push({ ...bucket, lane }) - 1;
      const active = bucket.items.some(e => e.id === state.selectedId);
      const related = !active && bucket.items.some(e => relatedIds.has(e.id));
      const first = bucket.items[0], last = bucket.items.at(-1);
      const years = first.year === last.year ? yearLabel(first) : `${first.year}–${last.year}`;
      const spokenYears = first.year === last.year ? yearLabel(first, true) : `${first.year}–${last.year}年`;
      return `<div class="timeline-cell"><button type="button" class="bucket${active ? ' active' : ''}${related ? ' related' : ''}" data-bucket="${index}" style="--entry-color:${categoryMap[representative.category].color}" aria-label="${esc(lane.label)}、${esc(spokenYears)}、${bucket.items.length}項目：${esc(bucket.items.map(e => e.title).join('、'))}"><span class="bucket-meta"><span>${esc(years)}</span>${bucket.items.length > 1 ? `<span>全${bucket.items.length}項目</span>` : ''}</span><strong>${esc(representative.title)}</strong>${bucket.items.length > 1 ? `<span class="bucket-meta">ほか${bucket.items.length - 1}項目を開く</span>` : ''}${state.reading && bucket.items.some(e => e.bookRecords?.length) ? '<span class="read-mark">✓ My Books</span>' : ''}</button></div>`;
    }).join('')}</div></div>`;
  }).join('');
  $('timelineView').style.setProperty('--columns', count);
  $('timelineView').innerHTML = header + rows;
  $('timelineView').querySelectorAll('[data-bucket]').forEach(button => button.addEventListener('click', () => {
    const group = groups[Number(button.dataset.bucket)];
    if (group.items.length === 1) selectEntry(group.items[0].id); else openCluster(group);
  }));
  $('timelineView').querySelectorAll('[data-range-start]').forEach(button => button.addEventListener('click', () => {
    state.view = 'list'; state.viewChosen = true;
    setRange({ start: Number(button.dataset.rangeStart), end: Number(button.dataset.rangeEnd) });
  }));
}

function renderGuides() {
  $('guidesDisclosure').hidden = !state.editorial.courses.length;
  if (state.guideId) $('guidesDisclosure').open = true;
  $('guideOptions').innerHTML = state.editorial.courses.map((course, i) => `<button class="guide-button" type="button" data-guide="${course.id}" aria-pressed="${state.guideId === course.id}"><span class="guide-number">0${i + 1}</span><span><strong>${esc(course.title)}</strong><small>${esc(course.subtitle)}</small></span></button>`).join('');
  $('guideOptions').querySelectorAll('[data-guide]').forEach(button => button.addEventListener('click', () => openGuide(button.dataset.guide, 0)));
  const course = state.editorial.courses.find(c => c.id === state.guideId);
  $('guideProgress').hidden = !course;
  if (!course) return;
  const step = course.steps[state.step];
  $('guideProgress').innerHTML = `<div class="guide-step-head"><strong>${state.step + 1} / ${course.steps.length} · ${esc(byId.get(step.entryId).title)}</strong><button type="button" class="text-button" id="endGuide">ガイドを閉じる</button></div><p>${esc(step.note)}</p><div class="guide-step-actions"><button type="button" id="previousStep"${state.step === 0 ? ' disabled' : ''}>← 前の項目</button><div class="guide-dots">${course.steps.map((s, i) => `<button type="button" data-step="${i}" aria-label="${i + 1}：${esc(byId.get(s.entryId).title)}"${i === state.step ? ' aria-current="step"' : ''}>${i + 1}</button>`).join('')}</div><button type="button" id="nextStep"${state.step === course.steps.length - 1 ? ' disabled' : ''}>次の項目 →</button><button type="button" id="showGuideDetail">解説を開く</button></div>`;
  $('previousStep').addEventListener('click', () => openGuide(course.id, state.step - 1));
  $('nextStep').addEventListener('click', () => openGuide(course.id, state.step + 1));
  $('showGuideDetail').addEventListener('click', () => selectEntry(step.entryId));
  $('endGuide').addEventListener('click', () => { state.guideId = null; renderGuides(); writeURL(); });
  $('guideProgress').querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => openGuide(course.id, Number(button.dataset.step))));
}

function openGuide(id, step) {
  const course = state.editorial.courses.find(c => c.id === id);
  if (!course || !course.steps[step]) return;
  clearQuery(); resetCategories();
  state.guideId = id; state.step = step;
  const entry = byId.get(course.steps[step].entryId);
  state.range = clampRange(entry.year - 2, (entry.yearEnd ?? entry.year) + 2, state.data);
  state.selectedId = entry.id;
  render();
  // スマホではガイドの前後操作を隠さず、解説はボタンから開く。
  if (mobile.matches) hidePane(); else renderDetail();
  writeURL(true);
  announce(`${course.title}、${step + 1}項目目。${entry.title}`);
}

function selectEntry(id, push = true) {
  const entry = byId.get(id);
  if (!entry) return;
  const wasHidden = $('detailPane').hidden;
  if (wasHidden) returnFocus = document.activeElement;
  state.selectedId = id;
  if (entry.isReading) state.reading = true;
  // 関連項目が現在の絞り込み外でも、選択した項目を必ず地図で確認できる。
  const currentlyVisible = state.visible.some(e => e.id === id);
  if (!currentlyVisible) {
    clearQuery(); resetCategories();
    state.range = clampRange(entry.year - 2, (entry.yearEnd ?? entry.year) + 2, state.data);
  }
  renderDetail(); render();
  writeURL(push);
  if (wasHidden) $('closeDetail').focus({ preventScroll: true });
  announce(`${entry.title}の詳細を開きました`);
}

function section(title, html) { return html ? `<section class="detail-section"><h3>${title}</h3>${html}</section>` : ''; }
function sourceLinks(ids) {
  return [...new Set(ids)].map(id => state.editorial.sources[id]).filter(Boolean).map(source => `<li><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title)} ↗</a><small>${esc(source.publisher)}${source.scope ? ` · ${esc(source.scope)}` : ''}</small></li>`).join('');
}

function renderDetail() {
  const entry = byId.get(state.selectedId);
  if (!entry) return;
  const detail = state.details[entry.id] || {};
  const category = categoryMap[entry.category];
  const related = relatedEntries(entry, activeEntries(), state.details, state.editorial.relations);
  const dateLabel = detail.dateLabel || (entry.title.includes('『') ? '発表' : entry.yearEnd ? '期間' : '年代');
  const facts = `<dl class="date-facts"><dt>${esc(dateLabel)}</dt><dd>${esc(detail.publication || yearLabel(entry, true))}<br>${esc(wareki(entry.year))}</dd>${detail.setting ? `<dt>作品の舞台</dt><dd>${esc(detail.setting)}</dd>` : ''}${entry.where ? `<dt>場所</dt><dd>${esc(entry.where)}</dd>` : ''}</dl>`;
  const relations = `<p class="relation-note">同時代・共通テーマは、直接の影響を示すものではありません。</p>${related.map(r => `<button type="button" class="related-item" data-related="${esc(r.entry.id)}"><span class="relation-label">${RELATION_LABELS[r.type]}</span><strong>${esc(r.entry.title)} →</strong><small>${esc(r.note)}</small></button>`).join('')}`;
  const ids = [...(detail.sourceIds || []), ...related.flatMap(r => r.sourceIds || [])];
  const sources = sourceLinks(ids);
  const findUrl = `https://ndlsearch.ndl.go.jp/search?keyword=${encodeURIComponent(entry.title)}`;
  const sourceSection = `${sources ? `<ul class="sources-list">${sources}</ul>` : '<p class="source-status">この項目の出典は整理中です。</p>'}<a href="${findUrl}" target="_blank" rel="noopener noreferrer">国立国会図書館で資料を探す ↗</a>`;
  const course = state.editorial.courses.find(c => c.id === state.guideId);
  const courseStep = course?.steps[state.step];
  const guideNote = courseStep?.entryId === entry.id ? section('このガイドの視点', paragraphs(courseStep.note)) : '';
  const books = state.reading && entry.bookRecords?.length ? entry.bookRecords.map(book => `<div class="book-record"><a href="${esc(book.url)}" target="_blank" rel="noopener">${esc(book.title)} ↗</a><small>${esc(book.readYear)}年に読了 · ${esc(book.author)}</small><small>原著発行年：${book.publishedYear}（My Booksの記録）</small></div>`).join('') : '';
  const bio = detail.authorBio ? `<details><summary>著者について${detail.authorBio.born ? ` · ${detail.authorBio.born}–${detail.authorBio.died || ''}` : ''}</summary><div>${paragraphs(detail.authorBio.summary)}</div></details>` : '';
  $('detailEyebrow').textContent = `${laneMap[entry.lane].label} / ${yearLabel(entry)}`;
  $('detailContent').innerHTML = `<h2 id="detailTitle">${esc(entry.title)}</h2><div class="detail-meta"><span class="entry-kind" style="--entry-color:${category.color}">${esc(category.label)}</span>${detail.sourceIds?.length ? '<span>出典付き</span>' : ''}</div><p class="detail-summary">${esc(entry.summary)}</p>${facts}${guideNote}${section('背景と位置づけ', paragraphs(detail.context || detail.era))}${section('何が変わったか', paragraphs(detail.significance))}${section('My Booksの読書記録', books)}${section('つながりをたどる', related.length ? relations : '')}${section('テーマから探す', detail.themes?.length ? `<div class="theme-tags">${detail.themes.map(t => `<button type="button" data-theme="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : '')}${section('詳しく読む', bio)}${section('出典・原文', sourceSection)}<div class="detail-actions"><button type="button" id="showContemporaries">この時代の一覧を見る</button><button type="button" id="copyLink">この項目のリンクをコピー</button></div>`;
  $('detailContent').querySelectorAll('[data-related]').forEach(button => button.addEventListener('click', () => selectEntry(button.dataset.related)));
  $('detailContent').querySelectorAll('[data-theme]').forEach(button => button.addEventListener('click', () => {
    const theme = button.dataset.theme; closeDetail(false); $('search').value = theme; runSearch(theme);
    $('search').focus();
  }));
  $('showContemporaries').addEventListener('click', () => {
    state.view = 'list'; state.viewChosen = true; resetCategories();
    setRange(clampRange(entry.year - 2, (entry.yearEnd ?? entry.year) + 2, state.data));
    $('explore').scrollIntoView({ block: 'start' });
  });
  $('copyLink').addEventListener('click', async () => {
    const button = $('copyLink');
    try { await navigator.clipboard.writeText(location.href); button.textContent = 'コピーしました'; }
    catch { button.textContent = 'アドレスバーからコピーできます'; }
  });
  showPane();
  $('detailPane').scrollTop = 0;
}

function openCluster(group) {
  returnFocus = document.activeElement;
  state.selectedId = null;
  $('detailEyebrow').textContent = `${group.lane.label} / ${group.items.length}項目`;
  $('detailContent').innerHTML = `<h2 id="detailTitle">${group.start}${group.start === group.end ? '' : `–${group.end}`}年の${esc(group.lane.label)}</h2><p class="detail-summary">この年代区分にある項目です。読みたい項目を選んでください。</p><div class="cluster-list">${group.items.map(e => entryCard(e, true)).join('')}</div>`;
  bindEntryButtons($('detailContent'));
  showPane(); renderResults(); writeURL();
  $('detailPane').scrollTop = 0; $('closeDetail').focus({ preventScroll: true });
}

function syncPaneMode() {
  const open = !$('detailPane').hidden;
  $('pageContent').inert = open && mobile.matches;
  $('detailBackdrop').hidden = !open || !mobile.matches;
  document.body.classList.toggle('detail-open', open && mobile.matches);
  if (open && mobile.matches) {
    $('detailPane').setAttribute('role', 'dialog'); $('detailPane').setAttribute('aria-modal', 'true');
  } else {
    $('detailPane').removeAttribute('role'); $('detailPane').removeAttribute('aria-modal');
  }
}

function showPane() { $('detailPane').hidden = false; $('pageShell').classList.add('has-detail'); syncPaneMode(); }
function hidePane() { $('detailPane').hidden = true; $('pageShell').classList.remove('has-detail'); syncPaneMode(); }
function closeDetail(update = true) {
  state.selectedId = null; hidePane();
  if (update) {
    renderResults(); writeURL();
    if (returnFocus?.isConnected && !returnFocus.closest('#detailPane')) returnFocus.focus({ preventScroll: true });
    else $('search').focus({ preventScroll: true });
  }
}

init();
