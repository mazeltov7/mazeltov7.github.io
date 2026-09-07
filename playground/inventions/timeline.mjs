export const ERAS = [
  { id:'origins', label:'道具のはじまり', range:'先史〜499年', start:-4000000, end:499 },
  { id:'exchange', label:'技術が広がる', range:'500〜1499年', start:500, end:1499 },
  { id:'mechanisms', label:'機械への一歩', range:'1500〜1799年', start:1500, end:1799 },
  { id:'industry', label:'産業と移動', range:'1800〜1899年', start:1800, end:1899 },
  { id:'electric', label:'電気の時代', range:'1900〜1949年', start:1900, end:1949 },
  { id:'connected', label:'つながる世界', range:'1950年〜', start:1950, end:2026 }
];

export const DEFAULT_STATE = { category:'all', period:'all', q:'', showAll:false, view:'map', selected:null };
const normalize = text => text.normalize('NFKC').toLocaleLowerCase('ja').trim();

export function inPeriod(entry, period) {
  const era = ERAS.find(item => item.id === period);
  return !era || (entry.year >= era.start && entry.year <= era.end);
}

export function matchesSearch(entry, query) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const haystack = normalize([entry.title, entry.aliases || '', entry.people, entry.place, entry.outcome, entry.mechanism].join(' '));
  return words.every(word => haystack.includes(word));
}

export function filterEntries(entries, state) {
  return entries.filter(entry =>
    (state.category === 'all' || entry.category === state.category) &&
    inPeriod(entry, state.period) && matchesSearch(entry, state.q)
  ).sort((a,b) => a.year - b.year || a.id.localeCompare(b.id));
}

export function isOverview(state) { return state.period === 'all' && state.category === 'all' && !state.q.trim(); }
export function visibleEntries(entries, state) {
  const filtered = filterEntries(entries, state);
  return isOverview(state) && !state.showAll ? filtered.filter(entry => entry.featured) : filtered;
}

export function columnsFor(period) {
  if (period === 'all') return ERAS;
  if (period === 'origins') return [
    { label:'遠い先史', start:-4000000,end:-100001,range:'10万年以上前' },
    { label:'先史',start:-100000,end:-10001,range:'約10万〜1万年前' },
    { label:'定住と道具',start:-10000,end:-3001,range:'紀元前1万〜3001年' },
    { label:'古代の技術',start:-3000,end:-1001,range:'紀元前3000〜1001年' },
    { label:'紀元前',start:-1000,end:-1,range:'紀元前1000〜1年' },
    { label:'紀元後',start:1,end:499,range:'1〜499年' }
  ];
  const era = ERAS.find(item => item.id === period);
  const step = period === 'exchange' ? 200 : period === 'mechanisms' ? 50 : period === 'industry' ? 20 : period === 'electric' ? 10 : 20;
  return Array.from({ length:Math.ceil((era.end-era.start+1)/step) },(_,i) => {
    const start = era.start+i*step, end = Math.min(start+step-1,era.end);
    return { label:`${start}–${end}`,range:'年',start,end };
  });
}

export function readState(search, data) {
  const params = new URLSearchParams(search), state = {...DEFAULT_STATE};
  if (data.categories.some(item => item.id === params.get('category'))) state.category = params.get('category');
  if (ERAS.some(item => item.id === params.get('period'))) state.period = params.get('period');
  state.q = (params.get('q') || '').slice(0,200);
  state.showAll = params.get('all') === '1';
  if (params.get('view') === 'list') state.view = 'list';
  if (data.entries.some(item => item.id === params.get('id'))) state.selected = params.get('id');
  return state;
}

export function stateParams(state) {
  const params = new URLSearchParams();
  if (state.category !== 'all') params.set('category',state.category);
  if (state.period !== 'all') params.set('period',state.period);
  if (state.q) params.set('q',state.q);
  if (state.showAll) params.set('all','1');
  if (state.view !== 'map') params.set('view',state.view);
  if (state.selected) params.set('id',state.selected);
  return params.toString();
}
