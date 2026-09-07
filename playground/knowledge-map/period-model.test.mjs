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
  assert.equal(results.length, 6);
  assert.deepEqual(fitEntries(results, data), { start: 1905, end: 1914 });
  assert.equal(fitEntries([], data), null);
  assert.equal(filterEntries(data.entries, details, { query: 'この文字列は収録していません' }).length, 0);
});

test('カテゴリ・年代・読書の絞り込みを組み合わせる', () => {
  const results = filterEntries(attached.entries, details, { categories: new Set(['literature']), range: { start: 1913, end: 1915 }, reading: true, onlyRead: true });
  assert.deepEqual(results.map(e => e.id), ['li-kojin', 'li-kokoro']);
  assert.equal(filterEntries(data.entries, details, { categories: new Set() }).length, 0);
});

test('全196項目と1945年末尾の全6項目を表示する', () => {
  assert.equal(data.entries.length, 196);
  assert.equal(new Set(data.entries.map(e => e.id)).size, 196);
  assert.equal(filterEntries(data.entries, details, { range: data }).length, 196);
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

test('My Booksの24冊を13作品に接続し、未収録の11冊を追加する', () => {
  assert.equal(attached.bookCount, 24);
  assert.equal(attached.entries.length, 207);
  assert.equal(attached.entries.filter(e => e.isReading).length, 11);
  assert.equal(attached.entries.filter(e => !e.isReading && e.bookRecords.length).length, 13);
  assert.equal(filterEntries(attached.entries, details, {}).length, 196);
  assert.equal(filterEntries(attached.entries, details, { reading: true, onlyRead: true }).length, 24);
  assert.equal(attached.entries.find(e => e.id === 'li-kokoro').bookRecords[0].title, 'こころ');
  assert.equal(attached.entries.find(e => e.id === 'li-kojin').year, 1913);
  assert.equal(attached.entries.find(e => e.id === 'li-kojin').bookRecords[0].publishedYear, 1914);
});

test('My Booksへのリンクは既存book.htmlと同じ識別規則', () => {
  for (const entry of attached.entries) {
    for (const record of entry.bookRecords || []) {
      assert.equal(new URL(record.url, 'http://localhost/playground/knowledge-map/').searchParams.get('id'), bookKey(record));
    }
  }
  assert.equal(bookKey({ title: '題名/補足?', cover: '' }), '題名-補足-');
});

test('著者が違う同名作品・部分一致の作品を誤って読了にしない', () => {
  const fake = { '2026': [{ title: 'こころ', author: '別の著者', publishedYear: 1914 }, { title: '門', author: '夏目漱石', publishedYear: 1910 }] };
  const result = attachBooks(data.entries, fake, editorial.bookLinks, data);
  assert.equal(result.entries.find(e => e.id === 'li-kokoro').bookRecords.length, 0);
  assert.equal(result.entries.find(e => e.id === 'li-rashomon').bookRecords.length, 0);
  assert.equal(result.entries.filter(e => e.isReading).length, 2);
});

test('関連項目は最大5件、重複なし、背景と同時代を区別する', () => {
  const links = relatedEntries(byId.get('li-kokoro'), data.entries, details, editorial.relations);
  assert.ok(links.length <= 5);
  assert.equal(new Set(links.map(r => r.entry.id)).size, links.length);
  assert.ok(links.some(r => r.entry.id === 'jp-taisho' && r.type === 'background'));
  assert.ok(links.some(r => r.type === 'author'));
  assert.ok(links.some(r => r.type === 'contemporary'));
  assert.ok(new Set(links.map(r => r.entry.lane)).size >= 4);
  assert.equal(links.some(r => r.entry.id === 'li-kokoro'), false);
});

test('3ガイド・全18ステップ・関係の参照先が実在し、根拠がある', () => {
  assert.equal(editorial.courses.length, 3);
  for (const course of editorial.courses) {
    assert.equal(course.steps.length, 6);
    for (const step of course.steps) {
      assert.ok(byId.has(step.entryId));
      assert.ok(step.note.length > 10);
      assert.ok(details[step.entryId].sourceIds.length);
      assert.ok(details[step.entryId].context || details[step.entryId].era);
      assert.ok(details[step.entryId].significance);
    }
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
