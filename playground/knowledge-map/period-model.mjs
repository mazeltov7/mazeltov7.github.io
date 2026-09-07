// 時間・検索・読書・関係性の規則。DOMに依存させず、境界条件を検証する。
export const ERAS = [
  ['嘉永', 1848], ['安政', 1854], ['万延', 1860], ['文久', 1861],
  ['元治', 1864], ['慶応', 1865], ['明治', 1868], ['大正', 1912], ['昭和', 1926],
];

export function wareki(year) {
  const era = ERAS.findLast(([, start]) => year >= start);
  if (!era) return `${year}年`;
  const n = year - era[1] + 1;
  return `${era[0]}${n === 1 ? '元' : n}年`;
}

export function yearLabel(entry, withUnit = false) {
  const approximate = ['approx', 'circa'].includes(entry.yearPrecision);
  const decade = entry.yearPrecision === 'decade';
  const years = `${entry.year}${entry.yearEnd != null && entry.yearEnd !== entry.year ? `–${entry.yearEnd}` : ''}`;
  if (decade) return `${years}年代`;
  return `${years}${withUnit ? '年' : ''}${approximate ? '頃' : ''}`;
}

export function clampRange(start, end, bounds) {
  start = Number.isFinite(Number(start)) ? Math.round(Number(start)) : bounds.start;
  end = Number.isFinite(Number(end)) ? Math.round(Number(end)) : bounds.end;
  start = Math.max(bounds.start, Math.min(bounds.end, start));
  end = Math.max(start, Math.min(bounds.end, end));
  return { start, end };
}

export function shiftRange(range, direction, bounds) {
  const width = range.end - range.start;
  const start = Math.max(bounds.start, Math.min(bounds.end - width, range.start + direction * (width + 1)));
  return { start, end: start + width };
}

export function overlaps(entry, range) {
  return entry.year <= range.end && (entry.yearEnd ?? entry.year) >= range.start;
}

export function normalize(text = '') {
  return String(text).normalize('NFKC').toLowerCase().replaceAll('こゝろ', 'こころ')
    .replaceAll('鷗', '鴎').replaceAll('龍之介', '竜之介').replace(/[\s・「」『』、。]/g, '');
}

export function matchesQuery(entry, detail, query) {
  const haystack = normalize([
    entry.title, entry.author, entry.where, entry.summary, entry.year, entry.yearEnd,
    wareki(entry.year), detail?.setting, ...(detail?.themes || []),
  ].filter(Boolean).join(' '));
  return query.trim().split(/\s+/).every(term => haystack.includes(normalize(term)));
}

export function filterEntries(entries, details, { categories, query = '', range, reading = false, onlyRead = false }) {
  return entries.filter(e =>
    (!e.isReading || reading) && (!onlyRead || e.bookRecords?.length) &&
    (!categories || categories.has(e.category)) &&
    (!range || overlaps(e, range)) && matchesQuery(e, details[e.id], query)
  ).sort((a, b) => a.year - b.year || a.title.localeCompare(b.title, 'ja'));
}

export function fitEntries(entries, bounds) {
  if (!entries.length) return null;
  return clampRange(Math.min(...entries.map(e => e.year)), Math.max(...entries.map(e => e.yearEnd ?? e.year)), bounds);
}

// 同じ表示領域に入る項目をまとめる。期間をまたぐ出来事も欠落させない。
export function timelineBuckets(entries, range, count) {
  const buckets = Array.from({ length: count }, () => []);
  const size = range.end - range.start + 1;
  entries.filter(e => overlaps(e, range)).forEach(entry => {
    const position = Math.max(range.start, entry.year);
    const index = Math.min(count - 1, Math.floor((position - range.start) / size * count));
    buckets[index].push(entry);
  });
  return buckets.map((items, index) => ({
    start: range.start + Math.ceil(index * size / count),
    end: Math.min(range.end, range.start + Math.ceil((index + 1) * size / count) - 1),
    items: items.sort((a, b) => a.year - b.year || a.title.localeCompare(b.title, 'ja')),
  }));
}

// My Booksと同じURL識別規則。順序が変わっても既存の書籍URLを保つ。
export function bookKey(book) {
  const asin = book.cover?.match(/m\.media-amazon\.com\/images\/P\/([A-Z0-9]{10})/);
  return asin ? asin[1] : book.title.replace(/[\/\\?#&%]+/g, '-');
}

export function attachBooks(baseEntries, bookData, links, bounds) {
  const entries = baseEntries.map(e => ({ ...e, bookRecords: [] }));
  const byId = new Map(entries.map(e => [e.id, e]));
  const synthetic = new Map();
  const seen = new Set();
  for (const [readYear, books] of Object.entries(bookData).sort(([a], [b]) => Number(b) - Number(a))) {
    for (const book of books) {
      if (!Number.isFinite(book.publishedYear) || book.publishedYear < bounds.start || book.publishedYear > bounds.end) continue;
      const key = bookKey(book);
      const record = { ...book, readYear, url: `../my-books/book.html?id=${encodeURIComponent(key)}` };
      const mapping = links.find(link => normalize(link.title) === normalize(book.title) && normalize(link.author) === normalize(book.author));
      let entry = mapping && byId.get(mapping.entryId);
      if (!entry) {
        entry = synthetic.get(key);
        if (!entry) {
          entry = {
            id: `reading:${key}`, title: book.title, author: book.author,
            year: book.publishedYear, category: 'reading', lane: 'reading', where: '',
            summary: `${book.author}の著作。My Booksの原著発行年に配置しています。`,
            isReading: true, bookRecords: [],
          };
          synthetic.set(key, entry);
          entries.push(entry);
        }
      }
      entry.bookRecords.push(record);
      seen.add(key);
    }
  }
  return { entries, bookCount: seen.size };
}

export const RELATION_LABELS = {
  background: '作品の背景', influence: '影響関係', theme: '共通するテーマ',
  author: '同じ著者', contemporary: '同時代',
};

function authorOf(entry) {
  return normalize(entry.author || (entry.title.includes('『') ? entry.title.split('『')[0] : ''));
}

export function relatedEntries(entry, entries, details, relations = [], limit = 5) {
  const found = [];
  const seen = new Set([entry.id]);
  const byId = new Map(entries.map(e => [e.id, e]));
  function add(other, type, note, sourceIds = []) {
    if (!other || seen.has(other.id) || found.length >= limit) return;
    seen.add(other.id);
    found.push({ entry: other, type, note, sourceIds });
  }
  relations.filter(r => r.from === entry.id || r.to === entry.id).forEach(r => {
    add(byId.get(r.from === entry.id ? r.to : r.from), r.type, r.note, r.sourceIds);
  });
  const others = entries.filter(e => e.id !== entry.id).sort((a, b) => Math.abs(a.year - entry.year) - Math.abs(b.year - entry.year));
  const author = authorOf(entry);
  if (author) {
    const sibling = others.find(e => authorOf(e) === author);
    add(sibling, 'author', '同じ著者の別の作品。発表時期と主題を比べられます。');
  }
  const themes = new Set(details[entry.id]?.themes || []);
  const common = others.find(e => e.lane !== entry.lane && (details[e.id]?.themes || []).some(t => themes.has(t)));
  if (common) add(common, 'theme', `共通のテーマ：${(details[common.id]?.themes || []).filter(t => themes.has(t)).join('・')}。影響関係を示すものではありません。`);
  const candidates = others.filter(e => overlaps(e, { start: entry.year - 2, end: (entry.yearEnd ?? entry.year) + 2 }));
  const usedLanes = new Set([entry.lane, ...found.map(r => r.entry.lane)]);
  for (const other of candidates) {
    if (usedLanes.has(other.lane)) continue;
    add(other, 'contemporary', `${yearLabel(other, true)}。近い時期の別分野の項目です。直接の影響を意味しません。`);
    usedLanes.add(other.lane);
  }
  for (const other of candidates) add(other, 'contemporary', `${yearLabel(other, true)}。同じ時期の出来事・作品として比較できます。`);
  return found;
}
