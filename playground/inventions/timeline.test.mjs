import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ERAS,DEFAULT_STATE,columnsFor,filterEntries,visibleEntries,readState,stateParams} from './timeline.mjs';
const data = JSON.parse(readFileSync(new URL('./data.json',import.meta.url)));

test('全84件に年代・出典・説明があり、関係の参照先が存在する',()=>{
  assert.equal(data.entries.length,84);
  const ids = new Set(data.entries.map(item=>item.id));
  assert.equal(ids.size,data.entries.length);
  for(const entry of data.entries){
    for(const field of ['title','dateLabel','dateKind','place','people','outcome','mechanism','caveat']) assert.ok(entry[field]?.trim(),`${entry.id}: ${field}`);
    assert.ok(Number.isInteger(entry.year) && entry.year !== 0);
    assert.ok(data.categories.some(category=>category.id === entry.category));
    assert.ok(entry.sources.length > 0);
    for(const source of entry.sources) assert.ok(data.sources[source]?.url.startsWith('https://'),source);
  }
  for(const relation of data.relations){
    assert.ok(ids.has(relation.from) && ids.has(relation.to));
    assert.notEqual(relation.from,relation.to);
    assert.ok(relation.label.trim());
    assert.ok(relation.sources.length);
    for(const source of relation.sources) assert.ok(data.sources[source]);
  }
});

test('すべての発明が全体の時代区分と詳細の年代区分に一度ずつ入る',()=>{
  for(const entry of data.entries){
    const eras = ERAS.filter(era=>entry.year >= era.start && entry.year <= era.end);
    assert.equal(eras.length,1,entry.id);
    assert.equal(columnsFor(eras[0].id).filter(column=>entry.year >= column.start && entry.year <= column.end).length,1,entry.id);
  }
  for(const era of ERAS){
    const boundaries = [{year:era.start},{year:era.end}];
    assert.equal(filterEntries(boundaries.map((e,i)=>({...e,id:String(i),title:'境界',people:'',place:'',outcome:'',mechanism:''})),{...DEFAULT_STATE,period:era.id}).length,2);
  }
});

test('検索は表記を正規化し、複数語と人物・地域を扱い、代表以外も探せる',()=>{
  assert.equal(filterEntries(data.entries,{...DEFAULT_STATE,q:'ＦＯＲＴＲＡＮ'})[0].id,'fortran');
  assert.ok(filterEntries(data.entries,{...DEFAULT_STATE,q:'イタリア ボルタ'}).some(e=>e.id==='volta'));
  assert.equal(visibleEntries(data.entries,{...DEFAULT_STATE,q:'ネイピア'}).length,1);
  assert.equal(filterEntries(data.entries,{...DEFAULT_STATE,q:'存在しない発明XYZ'}).length,0);
  assert.equal(filterEntries(data.entries,{...DEFAULT_STATE,period:'origins',q:'マイクロプロセッサ'}).length,0);
});

test('代表表示から全件、時代・分野の探索へ進める',()=>{
  assert.equal(visibleEntries(data.entries,DEFAULT_STATE).length,44);
  assert.equal(visibleEntries(data.entries,{...DEFAULT_STATE,showAll:true}).length,84);
  const state={...DEFAULT_STATE,category:'computing',period:'connected'};
  const result=visibleEntries(data.entries,state);
  assert.ok(result.length > 0);
  assert.ok(result.every(e=>e.category==='computing' && e.year>=1950));
  assert.ok(result.some(e=>!e.featured));
});

test('URLから条件と選択を再現し、不正な値を既定値へ戻す',()=>{
  const expected={...DEFAULT_STATE,category:'life',period:'industry',q:'麻酔',view:'list',showAll:true,selected:'ether-anesthesia'};
  assert.deepEqual(readState('?'+stateParams(expected),data),expected);
  assert.deepEqual(readState('?category=bad&period=bad&view=bad&id=bad',data),DEFAULT_STATE);
  assert.equal(readState('?q='+ '長'.repeat(500),data).q.length,200);
});
