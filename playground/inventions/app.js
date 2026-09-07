import { ERAS, DEFAULT_STATE, filterEntries, visibleEntries, isOverview, columnsFor, readState, stateParams } from './timeline.mjs';

const $ = id => document.getElementById(id);
const mobile = matchMedia('(max-width: 760px)');
const expandedCells = new Set();
let data, state, categoryMap, entryMap;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, className, handler) {
  const node = element('button',className,text);
  node.type = 'button';
  node.addEventListener('click',handler);
  return node;
}

function swatch(category) {
  const node = element('span','swatch');
  node.style.setProperty('--category-color',category.color);
  node.setAttribute('aria-hidden','true');
  return node;
}

function updateURL(push = false) {
  const query = stateParams(state);
  history[push ? 'pushState' : 'replaceState'](null,'',location.pathname + (query ? `?${query}` : ''));
}

function change(patch, push = false) {
  state = {...state,...patch};
  if (state.selected && !filterEntries(data.entries,state).some(item => item.id === state.selected)) state.selected = null;
  updateURL(push);
  render();
}

function entryCellKey(entry) {
  const era = ERAS.find(era=>entry.year >= era.start && entry.year <= era.end);
  return `${entry.category}:${era.id}`;
}

function displayedEntries() {
  if (!isOverview(state) || state.showAll) return visibleEntries(data.entries,state);
  return filterEntries(data.entries,state).filter(entry=>entry.featured || expandedCells.has(entryCellKey(entry)));
}

function updateResultCount() {
  const entries = displayedEntries();
  if (isOverview(state) && !state.showAll) {
    const featured = visibleEntries(data.entries,state).length;
    const additional = entries.length-featured;
    $('result-count').textContent = additional
      ? `${entries.length} 件を表示（代表 ${featured} 件 + 展開 ${additional} 件） / 全 ${data.entries.length} 件`
      : `代表的な ${featured} 件を表示 / 全 ${data.entries.length} 件`;
  } else {
    $('result-count').textContent = `${entries.length} 件を表示 / 全 ${data.entries.length} 件`;
  }
  $('reset').hidden = isOverview(state) && !state.showAll && expandedCells.size === 0;
}

function selectEntry(id, fromRelation = false) {
  if (fromRelation) state = {...state,category:'all',period:'all',q:'',showAll:true};
  const entry = entryMap.get(id);
  if (!entry) return;
  if (!displayedEntries().some(item => item.id === id)) state.showAll = true;
  change({selected:id},true);
  const detail = $('invention-detail');
  detail.querySelector('h2').focus({preventScroll:true});
  if (mobile.matches || innerWidth < 1200) detail.scrollIntoView({block:'nearest',behavior:'instant'});
}

function closeDetail() {
  const id = state.selected;
  change({selected:null},true);
  document.querySelector(`[data-invention="${CSS.escape(id)}"]`)?.focus({preventScroll:true});
}

function entryButton(entry, list = false) {
  const category = categoryMap.get(entry.category);
  const node = button('', 'invention', () => state.selected === entry.id ? closeDetail() : selectEntry(entry.id));
  node.style.setProperty('--category-color',category.color);
  node.dataset.invention = entry.id;
  node.setAttribute('aria-expanded',String(state.selected === entry.id));
  node.setAttribute('aria-label',`${entry.dateLabel}、${entry.title}の詳細`);
  if (state.selected === entry.id) node.setAttribute('aria-controls','invention-detail');
  node.append(element('time','',entry.dateLabel));
  const title = element('strong','',entry.title);
  if (list) {
    const label = element('span','entry-category');
    label.append(swatch(category),document.createTextNode(category.shortLabel));
    title.append(label);
  }
  node.append(title);
  if (list) node.append(element('span','entry-summary',entry.outcome));
  return node;
}

function cellDisclosure(category, column, entries) {
  const key = `${category.id}:${column.id}`;
  const disclosure = element('div','cell-disclosure');
  const extra = element('div','cell-extra');
  extra.id = `extra-${category.id}-${column.id}`;
  const clip = element('div','cell-extra-clip');
  const list = element('div','cell-extra-list');
  for (const entry of entries) list.append(entryButton(entry));
  clip.append(list);
  extra.append(clip);

  const toggle = button('','more-button',()=>{
    const opening = !expandedCells.has(key);
    opening ? expandedCells.add(key) : expandedCells.delete(key);
    if (!opening && entries.some(entry=>entry.id === state.selected)) {
      change({selected:null},true);
      $(toggle.id)?.focus({preventScroll:true});
      return;
    }
    sync();
    updateResultCount();
  });
  toggle.id = `toggle-${extra.id}`;
  toggle.setAttribute('aria-controls',extra.id);
  function sync() {
    const expanded = expandedCells.has(key);
    toggle.textContent = expanded ? '折りたたむ ⌃' : `ほか ${entries.length} 件 ⌄`;
    toggle.setAttribute('aria-expanded',String(expanded));
    extra.classList.toggle('is-expanded',expanded);
    extra.inert = !expanded;
  }
  sync();
  disclosure.append(toggle,extra);
  return disclosure;
}

function renderGrid(entries, allFiltered) {
  const columns = columnsFor(state.period);
  const grid = element('div','era-grid');
  grid.style.setProperty('--columns',columns.length);
  grid.append(element('div','era-label','分野 / 年代'));
  for (const column of columns) {
    const heading = column.id ? button(column.label,'era-label',()=>{change({period:column.id,selected:null},true);$('period').focus({preventScroll:true});}) : element('div','era-label',column.label);
    heading.append(element('small','',column.range));
    if (column.id) heading.setAttribute('aria-label',`${column.range}を詳しく見る`);
    grid.append(heading);
  }
  const categories = data.categories.filter(category => state.category === 'all' || state.category === category.id);
  for (const category of categories) {
    const label = element('div','category-label');
    label.append(swatch(category),document.createTextNode(category.label));
    grid.append(label);
    for (const column of columns) {
      const cell = element('div','era-cell');
      cell.setAttribute('aria-label',`${category.label}、${column.label}`);
      const cellEntries = entries.filter(entry => entry.category === category.id && entry.year >= column.start && entry.year <= column.end);
      for (const entry of cellEntries) cell.append(entryButton(entry));
      const remaining = allFiltered.filter(entry => entry.category === category.id && entry.year >= column.start && entry.year <= column.end && !cellEntries.some(visible=>visible.id === entry.id));
      if (remaining.length) cell.append(cellDisclosure(category,column,remaining));
      if (!cellEntries.length && !remaining.length) cell.append(element('span','vacant','—'));
      grid.append(cell);
    }
  }
  $('timeline').append(grid);
}

function renderList(entries) {
  const list = element('div','reading-list');
  for (const era of ERAS) {
    const eraEntries = entries.filter(entry => entry.year >= era.start && entry.year <= era.end);
    if (!eraEntries.length) continue;
    list.append(element('h2','list-era',`${era.label}　${era.range}`));
    for (const entry of eraEntries) {
      const row = element('div','list-entry');
      row.append(entryButton(entry,true));
      if (mobile.matches && state.selected === entry.id) row.append(buildDetail(entry));
      list.append(row);
    }
  }
  $('timeline').append(list);
}

function buildDetail(entry) {
  const category = categoryMap.get(entry.category);
  const detail = element('article','detail');
  detail.id = 'invention-detail';
  detail.style.setProperty('--category-color',category.color);
  detail.setAttribute('aria-labelledby','detail-title');
  const top = element('div','detail-top'), label = element('span','detail-category');
  label.append(swatch(category),document.createTextNode(category.label));
  const close = button('×','close-detail',closeDetail);
  close.setAttribute('aria-label','詳細を閉じる');
  top.append(label,close);
  const date = element('p','detail-date',entry.dateLabel);
  date.append(element('span','date-kind',entry.dateKind));
  const title = element('h2','',entry.title);
  title.id = 'detail-title';
  title.tabIndex = -1;
  detail.append(top,date,title,element('p','outcome',entry.outcome));
  detail.append(element('h3','','どこが新しかった？'),element('p','',entry.mechanism));
  const meta = element('dl');
  for (const [key,value] of [['地域',entry.place],['担い手',entry.people]]) meta.append(element('dt','',key),element('dd','',value));
  detail.append(meta,element('p','caveat',entry.caveat));
  const before = data.relations.filter(relation => relation.to === entry.id);
  const after = data.relations.filter(relation => relation.from === entry.id);
  for (const [heading,relations,key] of [['土台・関連する先行技術',before,'from'],['この先につながる発明',after,'to']]) {
    if (!relations.length) continue;
    detail.append(element('h3','',heading));
    for (const relation of relations) {
      const target = entryMap.get(relation[key]);
      const link = button('','relation',()=>selectEntry(target.id,true));
      link.append(element('span','',`${key === 'from' ? '←' : '→'} ${target.title}`),element('small','',relation.label));
      detail.append(link);
    }
  }
  detail.append(element('h3','','出典・関連を調べる'));
  const sources = element('ol','sources');
  const sourceIDs = new Set([...entry.sources,...before.flatMap(relation=>relation.sources),...after.flatMap(relation=>relation.sources)]);
  for (const sourceID of sourceIDs) {
    const source = data.sources[sourceID];
    const item = element('li'), link = element('a','',source.label);
    link.href = source.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    item.append(link);
    sources.append(item);
  }
  detail.append(sources);
  const permalink = element('a','permalink','この発明へのリンク ↗');
  permalink.href = `?id=${encodeURIComponent(entry.id)}&all=1`;
  detail.append(permalink);
  return detail;
}

function renderControls() {
  if ($('search').value !== state.q) $('search').value = state.q;
  $('period').value = state.period;
  $('show-all').checked = state.showAll;
  $('show-all').closest('label').hidden = !isOverview(state);
  $('categories').replaceChildren();
  const all = button('すべて','',()=>change({category:'all',selected:null},true));
  all.dataset.category = 'all';
  all.setAttribute('aria-pressed',String(state.category === 'all'));
  $('categories').append(all);
  for (const category of data.categories) {
    const node = button('','',()=>change({category:state.category === category.id ? 'all' : category.id,selected:null},true));
    node.dataset.category = category.id;
    node.append(swatch(category),document.createTextNode(category.label));
    node.setAttribute('aria-pressed',String(state.category === category.id));
    $('categories').append(node);
  }
  document.querySelectorAll('[data-view]').forEach(node=>node.setAttribute('aria-pressed',String(state.view === node.dataset.view)));
}

function render() {
  if (!data) return;
  const selected = entryMap.get(state.selected);
  if (selected && !selected.featured && isOverview(state) && !state.showAll) expandedCells.add(entryCellKey(selected));
  const active = document.activeElement;
  const focusedCategory = active?.dataset.category;
  const focusedInvention = active?.dataset.invention;
  const focusedID = active?.id;
  renderControls();
  const filtered = filterEntries(data.entries,state), entries = displayedEntries();
  const showList = mobile.matches || state.view === 'list';
  $('timeline').replaceChildren();
  $('detail-slot').replaceChildren();
  $('detail-slot').hidden = mobile.matches || !state.selected;
  $('workspace').classList.toggle('has-selection',!mobile.matches && Boolean(state.selected));
  $('empty').hidden = entries.length > 0;
  updateResultCount();
  $('scale-note').textContent = showList ? '古いものから順に表示' : '時代ごとに集約しています。列幅は年数に比例しません。';
  if (entries.length) showList ? renderList(entries) : renderGrid(visibleEntries(data.entries,state),filtered);
  if (state.selected && !mobile.matches) $('detail-slot').append(buildDetail(entryMap.get(state.selected)));
  const focusTarget = focusedCategory ? document.querySelector(`[data-category="${CSS.escape(focusedCategory)}"]`) : focusedInvention ? document.querySelector(`[data-invention="${CSS.escape(focusedInvention)}"]`) : focusedID ? $(focusedID) : null;
  if (focusTarget && !focusTarget.hidden && focusTarget !== document.activeElement) focusTarget.focus({preventScroll:true});
}

function reset() { expandedCells.clear();change({...DEFAULT_STATE,view:state.view},true);$('search').focus({preventScroll:true}); }

async function load() {
  const fromRetry = document.activeElement === $('retry');
  $('error').hidden = true;
  $('result-count').textContent = '年表を読み込んでいます…';
  try {
    const response = await fetch('data.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
    categoryMap = new Map(data.categories.map(category=>[category.id,category]));
    entryMap = new Map(data.entries.map(entry=>[entry.id,entry]));
    state = readState(location.search,data);
    if (state.selected && !visibleEntries(data.entries,state).some(entry=>entry.id === state.selected)) state = {...state,category:'all',period:'all',q:'',showAll:true};
    $('period').replaceChildren(new Option('すべての時代','all'),...ERAS.map(era=>new Option(era.range,era.id)));
    $('collection-note').textContent = `${data.entries.length}の発明と技術 · 出典確認 ${data.meta.reviewedAt}`;
    render();
    if (fromRetry) $('search').focus({preventScroll:true});
    if (state.selected && mobile.matches) $('invention-detail')?.scrollIntoView({block:'nearest'});
  } catch (error) {
    data = null;
    $('timeline').replaceChildren();
    $('error').hidden = false;
    $('result-count').textContent = '読み込みに失敗しました';
    console.error('発明の年表:',error);
  }
}

$('search').addEventListener('input',event=>{ if(data) change({q:event.target.value,selected:null}); });
$('period').addEventListener('change',event=>{ if(data) change({period:event.target.value,selected:null},true); });
$('show-all').addEventListener('change',event=>{ if(data) change({showAll:event.target.checked,selected:null},true); });
$('reset').addEventListener('click',reset);
$('empty-reset').addEventListener('click',reset);
$('retry').addEventListener('click',load);
document.querySelectorAll('[data-view]').forEach(node=>node.addEventListener('click',()=>{if(data)change({view:node.dataset.view},true);}));
addEventListener('popstate',()=>{ if(data){state = readState(location.search,data);render();} });
mobile.addEventListener('change',render);
document.addEventListener('keydown',event=>{if(event.key === 'Escape' && state?.selected)closeDetail();});
load();
