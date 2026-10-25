import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  wareki, yearLabel, clampRange, shiftRange, overlaps, matchesQuery,
  filterEntries, fitEntries, timelineBuckets, attachBooks, bookKey, relatedEntries,
} from './period-model.mjs';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const data = read('./periods/meiji-ww2.json');
const originalDetails = read('./periods/meiji-ww2.details.json');
const editorial = read('./periods/meiji-ww2.explore.json');
const books = read('../my-books/books-data.json');
const details = Object.fromEntries(data.entries.map(e => [e.id, { ...originalDetails[e.id], ...editorial.entries[e.id] }]));
const byId = new Map(data.entries.map(e => [e.id, e]));
const attached = attachBooks(data.entries, books, editorial.bookLinks, data);

test('元号の切り替わる年と概数を正しく表す', () => {
  assert.equal(wareki(1867), '慶応3年');
  assert.equal(wareki(1868), '明治元年');
  assert.equal(wareki(1912), '大正元年');
  assert.equal(wareki(1926), '昭和元年');
  assert.equal(yearLabel(byId.get('ar-jazz')), '1900年代');
  assert.equal(yearLabel(byId.get('ar-jazz'), true), '1900年代');
  assert.equal(yearLabel({ year: 1900, yearPrecision: 'approx' }, true), '1900年頃');
});

test('端の期間でも幅を保って移動し、範囲外には進まない', () => {
  assert.deepEqual(shiftRange({ start: 1935, end: 1944 }, 1, data), { start: 1936, end: 1945 });
  assert.deepEqual(shiftRange({ start: 1850, end: 1859 }, -1, data), { start: 1850, end: 1859 });
  assert.deepEqual(shiftRange(data, 1, data), { start: 1850, end: 1945 });
  assert.deepEqual(clampRange(1900, 1800, data), { start: 1900, end: 1900 });
  assert.deepEqual(clampRange('x', 'y', data), { start: 1850, end: 1945 });
});

test('途中から表示しても継続中の戦争を含み、終了翌年には含まない', () => {
  const war = byId.get('wd-ww1');
  assert.equal(overlaps(war, { start: 1917, end: 1918 }), true);
  assert.equal(overlaps(war, { start: 1919, end: 1920 }), false);
  assert.equal(overlaps(byId.get('jp-pacific-war'), { start: 1945, end: 1945 }), true);
});

test('こゝろ・こころ、空白、和暦、テーマを検索できる', () => {
  const entry = byId.get('li-kokoro');
  assert.equal(matchesQuery(entry, details[entry.id], 'こころ'), true);
  assert.equal(matchesQuery(entry, details[entry.id], '夏目 漱石'), true);
  assert.equal(matchesQuery(entry, details[entry.id], '大正3年'), true);
  assert.equal(matchesQuery(entry, details[entry.id], '個人と社会'), true);
  assert.equal(matchesQuery(entry, details[entry.id], 'ボーア'), false);
});

test('検索に合わせた年代範囲と空結果が得られる', () => {
  const results = filterEntries(data.entries, details, { query: '漱石' });
  assert.equal(results.length, 12);
  assert.deepEqual(fitEntries(results, data), { start: 1905, end: 1915 });
  assert.equal(fitEntries([], data), null);
  assert.equal(filterEntries(data.entries, details, { query: 'この文字列は収録していません' }).length, 0);
});

test('カテゴリ・年代・読書の絞り込みを組み合わせる', () => {
  const results = filterEntries(attached.entries, details, { categories: new Set(['literature']), range: { start: 1913, end: 1915 }, reading: true, onlyRead: true });
  assert.deepEqual(results.map(e => e.id), ['li-gan', 'li-kojin', 'li-abe', 'li-kokoro', 'li-michikusa', 'li-sansho']);
  assert.equal(filterEntries(data.entries, details, { categories: new Set() }).length, 0);
});

test('全215項目と1945年末尾の全6項目を表示する', () => {
  assert.equal(data.entries.length, 215);
  assert.equal(new Set(data.entries.map(e => e.id)).size, 215);
  assert.equal(filterEntries(data.entries, details, { range: data }).length, 215);
  const last = filterEntries(data.entries, details, { range: { start: 1945, end: 1945 } });
  assert.equal(last.filter(e => e.year === 1945).length, 6);
  assert.ok(last.some(e => e.id === 'jp-potsdam'));
});

test('どの横幅・期間でも年表のまとまりに欠落と重複がない', () => {
  for (const range of [data, { start: 1913, end: 1915 }, { start: 1945, end: 1945 }, { start: 1850, end: 1859 }]) {
    for (const count of [1, 2, 3, 6].filter(n => n <= range.end - range.start + 1)) {
      for (const lane of data.lanes) {
        const entries = data.entries.filter(e => e.lane === lane.id);
        const expected = entries.filter(e => overlaps(e, range)).map(e => e.id).sort();
        const actual = timelineBuckets(entries, range, count).flatMap(b => b.items.map(e => e.id)).sort();
        assert.deepEqual(actual, expected);
      }
    }
  }
});

test('My Booksの32冊を35作品と未収録の1冊に接続し、合本でも冊数を重複させない', () => {
  assert.equal(attached.bookCount, 32);
  assert.equal(attached.entries.length, 216);
  assert.equal(attached.entries.filter(e => e.isReading).length, 1);
  assert.equal(attached.entries.filter(e => !e.isReading && e.bookRecords.length).length, 35);
  assert.equal(filterEntries(attached.entries, details, {}).length, 215);
  assert.equal(filterEntries(attached.entries, details, { reading: true, onlyRead: true }).length, 36);
  assert.equal(attached.entries.find(e => e.id === 'li-kokoro').bookRecords[0].title, 'こころ');
  assert.equal(attached.entries.find(e => e.id === 'li-kojin').year, 1913);
  assert.equal(attached.entries.find(e => e.id === 'li-kojin').bookRecords[0].publishedYear, 1914);
});

test('採択済みの6冊を原典の年代で作品へ接続し、自動表示との重複をなくす', () => {
  const expected = [
    ['li-shibusawa-amayogatari', '雨夜譚 渋沢栄一自伝', 1887],
    ['ph-shibusawa-rongo', '現代語訳 論語と算盤', 1916],
    ['ph-shoin-ryukonroku', '留魂録読本', 1859],
    ['li-lawrence-seven-pillars', '完全版 知恵の七柱 1', 1922],
    ['li-katsu-hikawa-seiwa', '氷川清話', 1897],
    ['li-akutagawa-kanto-quake', '大正十二年九月一日の大震に際して', 1923],
  ];
  for (const [id, title, year] of expected) {
    const entry = attached.entries.find(e => e.id === id);
    assert.equal(entry.year, year);
    assert.equal(entry.bookRecords.length, 1);
    assert.equal(entry.bookRecords[0].title, title);
    assert.equal(entry.relatedBookRecords.length, 0);
    assert.equal(attached.entries.filter(e => e.bookRecords.some(b => b.title === title)).length, 1);
    assert.ok(details[id].sourceIds.length);
    assert.ok(details[id].publication.includes(String(year)));
    assert.ok(details[id].authorBio.summary);
  }
  assert.equal(byId.get('li-katsu-hikawa-seiwa').yearEnd, 1898);
  assert.equal(details['li-shibusawa-amayogatari'].dateLabel, '口述');
  assert.equal(details['ph-shoin-ryukonroku'].dateLabel, '執筆');
  assert.equal(details['li-lawrence-seven-pillars'].dateLabel, '底本テキストの成立');
  assert.equal(attached.entries.find(e => e.id === 'li-lawrence-seven-pillars').bookRecords[0].publishedYear, 1926);
  assert.equal(attached.entries.find(e => e.isReading).title, 'アイデアのつくり方');
});

test('My Booksへのリンクは既存book.htmlと同じ識別規則', () => {
  for (const entry of attached.entries) {
    for (const record of entry.bookRecords || []) {
      assert.equal(new URL(record.url, 'http://localhost/playground/knowledge-map/').searchParams.get('id'), bookKey(record));
    }
  }
  assert.equal(bookKey({ title: '題名/補足?', cover: '' }), '題名-補足-');
});

test('合本の各作品は発表年を保ち、対応表の重複や再読で冊数を増やさない', () => {
  const base = [{ id: 'first', title: '第一作', year: 1900 }, { id: 'second', title: '第二作', year: 1920 }];
  const book = { title: '短編集', author: '著者', publishedYear: 1900 };
  const links = ['first', 'second', 'second', 'missing'].map(entryId => ({ title: book.title, author: book.author, entryId }));
  const result = attachBooks(base, { '2025': [book], '2026': [book] }, links, data);
  assert.equal(result.bookCount, 1);
  assert.equal(result.entries.length, 2);
  assert.deepEqual(result.entries.map(e => e.year), [1900, 1920]);
  for (const entry of result.entries) {
    assert.deepEqual(entry.bookRecords.map(r => r.readYear), ['2026', '2025']);
    assert.ok(entry.bookRecords.every(r => r.isCollection));
  }
  assert.equal(result.entries[0].bookRecords[0].url, result.entries[1].bookRecords[0].url);
  assert.ok(base.every(e => e.bookRecords === undefined));
  const unmatched = attachBooks(base, { '2026': [book] }, [links.at(-1)], data);
  assert.equal(unmatched.entries.filter(e => e.isReading).length, 1);
  assert.equal(unmatched.bookCount, 1);
});

test('読了した合本を作品へ分け、雁と猫の既存項目へ読書記録をまとめる', () => {
  const entry = id => attached.entries.find(e => e.id === id);
  for (const [first, second] of [['li-buncho', 'li-yumejuya'], ['li-kinosaki', 'li-kozo-no-kamisama']]) {
    const a = entry(first).bookRecords[0], b = entry(second).bookRecords[0];
    assert.equal(a.url, b.url);
    assert.equal(a.readYear, '2026');
    assert.equal(b.readYear, '2026');
    assert.equal(a.isCollection, true);
  }
  assert.equal(entry('li-kinosaki').year, 1917);
  assert.equal(entry('li-kozo-no-kamisama').year, 1920);
  assert.equal(entry('li-gan').bookRecords[0].readYear, '2026');
  assert.equal(attached.entries.some(e => e.isReading && e.title === '雁'), false);
  assert.deepEqual(entry('li-cat').bookRecords.map(r => r.readYear), ['2026', '2025']);
});

test('著者が違う同名作品・部分一致の作品を誤って読了にしない', () => {
  const fake = { '2026': [{ title: 'こころ', author: '別の著者', publishedYear: 1914 }, { title: '門外', author: '夏目漱石', publishedYear: 1910 }] };
  const result = attachBooks(data.entries, fake, editorial.bookLinks, data);
  assert.equal(result.entries.find(e => e.id === 'li-kokoro').bookRecords.length, 0);
  assert.equal(result.entries.find(e => e.id === 'li-mon').bookRecords.length, 0);
  assert.equal(result.entries.filter(e => e.isReading).length, 2);
});

test('原著年のない合本を収録作品に接続し、作品ごとの年と再読を保つ', () => {
  const collection = books['2026'].find(b => b.title === '阿部一族・舞姫');
  assert.equal(collection.publishedYear, undefined);
  for (const id of ['li-maihime', 'li-ougai-utakata', 'li-abe']) {
    const entry = attached.entries.find(e => e.id === id);
    const record = entry.bookRecords.find(b => b.title === collection.title);
    assert.equal(record.isCollection, true);
    assert.equal(record.readYear, '2026');
    assert.equal(entry.year, byId.get(id).year);
  }
  assert.ok(attached.entries.find(e => e.id === 'li-maihime').bookRecords.some(b => b.readYear === '2025'));
  assert.equal(attached.entries.find(e => e.id === 'li-yujo').year, 1919);
  assert.equal(attached.entries.find(e => e.id === 'li-yujo').bookRecords[0].publishedYear, 1920);
});

test('現代の解説書は期間外でも関連書となり、原典を読了扱いにしない', () => {
  const entry = attached.entries.find(e => e.id === 'ph-nishida');
  assert.equal(attached.relatedBookCount, 2);
  assert.equal(entry.year, 1911);
  assert.equal(entry.bookRecords.length, 0);
  assert.deepEqual(entry.relatedBookRecords.map(b => b.publishedYear).sort(), [2022, 2025]);
  assert.equal(filterEntries([entry], details, { reading: true, onlyRead: true }).length, 0);
  assert.equal(filterEntries([entry], details, { reading: true, query: '藤田正勝' }).length, 1);
  const reread = attachBooks([entry], { '2026': [entry.relatedBookRecords[0]], '2025': [entry.relatedBookRecords[0]] }, editorial.bookLinks, data);
  assert.equal(reread.relatedBookCount, 1);
  assert.equal(reread.entries.length, 1);
  assert.equal(reread.entries[0].relatedBookRecords.length, 2);
});

test('全体マップは読書追加から独立した98項目を保持する', () => {
  const world = read('./data.json'), worldDetails = read('./data.details.json');
  assert.equal(world.entries.length, 98);
  assert.equal(new Set(world.entries.map(e => e.id)).size, 98);
  assert.equal(world.bookLinks, undefined);
  for (const id of Object.keys(worldDetails)) assert.ok(world.entries.some(e => e.id === id), id);
  // 読書追加で作った項目は時代別ページに残り、全体マップには入らない。
  for (const id of ['li-maihime', 'li-ougai-utakata', 'li-abe', 'li-sansho', 'li-takase', 'li-yujo', 'li-omedeta', 'ph-nishida']) {
    assert.ok(byId.has(id), id);
    assert.equal(world.entries.some(e => e.id === id), false, id);
  }
});

test('関連項目は最大5件、重複なし、背景と同時代を区別する', () => {
  const links = relatedEntries(byId.get('li-kokoro'), data.entries, details, editorial.relations);
  assert.ok(links.length <= 5);
  assert.equal(new Set(links.map(r => r.entry.id)).size, links.length);
  assert.ok(links.some(r => r.entry.id === 'jp-taisho' && r.type === 'background'));
  assert.ok(links.some(r => r.type === 'author'));
  assert.ok(links.some(r => r.type === 'contemporary'));
  assert.ok(new Set(links.map(r => r.entry.lane)).size >= 3);
  assert.equal(links.some(r => r.entry.id === 'li-kokoro'), false);
});

test('追加解説・関係・出典の参照先が実在し、根拠がある', () => {
  for (const link of editorial.bookLinks) assert.ok(byId.has(link.entryId), link.entryId);
  for (const [id, detail] of Object.entries(editorial.entries)) {
    assert.ok(byId.has(id));
    assert.ok(detail.sourceIds?.length);
    assert.ok(details[id].context || details[id].era);
  }
  for (const relation of editorial.relations) {
    assert.ok(byId.has(relation.from)); assert.ok(byId.has(relation.to));
    if (['influence', 'background'].includes(relation.type)) assert.ok(relation.sourceIds.length);
    for (const id of relation.sourceIds) assert.ok(editorial.sources[id]);
  }
  for (const detail of Object.values(editorial.entries)) {
    for (const id of detail.sourceIds || []) assert.ok(editorial.sources[id], id);
  }
  for (const source of Object.values(editorial.sources)) assert.equal(new URL(source.url).protocol, 'https:');
});

test('発表年と舞台を分け、谷崎の受章年の誤記を残さない', () => {
  assert.match(details['li-kokoro'].publication, /1914/);
  assert.match(details['li-kokoro'].setting, /1912/);
  assert.match(details['li-rashomon'].publication, /1915/);
  assert.match(details['li-rashomon'].setting, /平安/);
  const raw = JSON.stringify(originalDetails);
  assert.doesNotMatch(raw, /1965年文化勲章/);
  assert.match(details['li-shisei'].authorBio.summary, /1949年/);
  assert.match(details['li-tanizaki'].authorBio.summary, /1949年/);
});
