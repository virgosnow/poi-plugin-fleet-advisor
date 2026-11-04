'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../../helpers/workbench_fixture');
const {estimate,estimateForecast,cumulative,training,admiralXP}=require('../../../src/domain/combat/practice_experience');
test('cumulative level XP matches source boundaries including all post-marriage bands',()=>{
 for(const [lv,exp] of [[1,0],[30,43500],[50,122500],[51,127500],[61,188500],[71,275000],
  [81,397000],[91,564500],[98,851500],[99,1000000],[100,1000000],[101,1010000],[102,1011000],
  [111,1065000],[116,1145000],[121,1290000],[131,1860000],[140,2760000],[150,4360000],
  [155,5470000],[156,5720000],[165,7820000],[175,10950000],[180,13000000],[185,16000000],[188,20200000]])
  assert.equal(cumulative(lv),exp,`level ${lv}`);
 assert.equal(cumulative(189),null);assert.equal(cumulative(0),null);
});
test('opponent single ship differs from a second ship whose level is missing',()=>{
 const s=fixture(),scheme={ships:[{id:1},{id:2}]};
 const solo=estimate(s,scheme,{ships:[{level:30}]});
 assert.equal(solo.status,'estimated');assert.deepEqual(solo.rawBase,{min:435,max:438});
 assert.deepEqual(solo.base,{min:522,max:525});assert.equal(solo.ships[0].flagship,true);
 assert.deepEqual(solo.ships[0].normal,{min:783,max:787});assert.deepEqual(solo.ships[0].mvp,{min:1566,max:1575});
 assert.equal(estimate(s,scheme,{ships:[{level:30},{level:null}]}).status,'unknown');
 assert.equal(estimate(s,scheme,{ships:[{level:30},{level:189}]}).status,'unknown');
});
test('rank multipliers use the exercise table, including defeats',()=>{
 const s=fixture(),opponent={ships:[{level:99},{level:99}]},scheme={ships:[{id:1},{id:2}]};
 for(const [rank,value] of [['S',735],['A',613],['B',613],['C',392],['D',343],['E',245]]){
  const result=estimate(s,scheme,opponent,{rank});assert.equal(result.base.min,value,rank);
  assert.equal(result.ships[1].normal.min,value,rank);
 }
 assert.equal(estimate(s,scheme,opponent,{rank:'E'}).ships[0].mvp,null);
});
test('high-level estimate encloses variation before and after the soft cap',()=>{
 const s=fixture(),result=estimate(s,{ships:[{id:1},{id:2}]},{ships:[{level:99},{level:99}]},{rank:'S'});
 assert.deepEqual(result.rawBase,{min:613,max:616});assert.deepEqual(result.base,{min:735,max:739});
 assert.deepEqual(result.ships[0].normal,{min:1102,max:1108});
 assert.deepEqual(result.ships[0].mvp,{min:2205,max:2217});
 assert(!result.notes.join(' ').includes('随机'));
});
test('training estimate encloses either published bonus rounding order',()=>{
 const s=fixture();Object.assign(s.const.$ships[1],{api_stype:21,api_name:'香取改'});s.info.ships[1].api_lv=100;
 const result=estimate(s,{ships:[{id:1},{id:2}]},{ships:[{level:99},{level:99}]},{rank:'S'});
 assert.deepEqual(result.ships[0].normal,{min:1322,max:1330});
});
test('Katori-class bonuses depend on level, position and number',()=>{
 const s=fixture();Object.assign(s.const.$ships[1],{api_stype:21,api_name:'香取改'});s.info.ships[1].api_lv=99;
 Object.assign(s.const.$ships[2],{api_stype:21,api_name:'鹿島改'});s.info.ships[2].api_lv=100;
 assert.equal(training(s,[{id:1},{id:3}]).surface,1150);
 assert.equal(training(s,[{id:3},{id:1}]).surface,1100);
 assert.equal(training(s,[{id:1},{id:2}]).surface,1200);
 assert.equal(training(s,[{id:3},{id:1},{id:2}]).surface,1175);
 assert.match(training(s,[{id:3},{id:1},{id:2}]).notes[0],/未完全验证/);
});
test('Asahi scenarios distinguish surface and submarine training multipliers',()=>{
 const s=fixture();Object.assign(s.const.$ships[1],{api_stype:21,api_name:'朝日'});s.info.ships[1].api_lv=99;
 Object.assign(s.const.$ships[2],{api_stype:21,api_name:'香取改'});s.info.ships[2].api_lv=99;
 let a=training(s,[{id:1},{id:3}]);assert.equal(a.surface,690);assert.equal(a.submarine,1495);
 a=training(s,[{id:3},{id:1}]);assert.equal(a.surface,1000);assert.equal(a.submarine,1000);
 a=training(s,[{id:1},{id:2}]);assert.equal(a.surface,1207.5);assert.equal(a.submarine,1667.5);
});
test('admiral experience is rank- and level-difference based',()=>{
 assert.equal(admiralXP(120,125,'S'),160);assert.equal(admiralXP(120,120,'B'),32);
 assert.equal(admiralXP(120,100,'D'),10);assert.equal(admiralXP(120,null,'S'),null);
});
test('forecast experience retains all sampled ranks even if a rare percentage rounds to zero',()=>{
 const store=fixture(),scheme={ships:[{id:1},{id:2}]},opponent={ships:[{level:99},{level:99}]};
 const forecast={status:'estimated',samples:1000,rows:[{label:'S',count:999,percent:100},{label:'D',count:1,percent:0}]};
 const result=estimateForecast(store,scheme,opponent,forecast);
 const worst=estimate(store,scheme,opponent,{rank:'D'}),best=estimate(store,scheme,opponent,{rank:'S'});
 assert.equal(result.status,'estimated');assert.equal(result.sOnly,false);
 assert.deepEqual(result.ships[0].normal,{min:worst.ships[0].normal.min,max:best.ships[0].normal.max});
 assert.equal(result.ships[0].representativeNormal,null);
 assert.match(result.notes.join(' '),/不含 MVP 或被击沉/);
});
test('single sampled S rank exposes an approximate midpoint while preserving its actual interval',()=>{
 const store=fixture(),scheme={ships:[{id:1},{id:2}]},opponent={ships:[{level:99},{level:99}]};
 const result=estimateForecast(store,scheme,opponent,{status:'estimated',samples:256,rows:[{label:'S',count:256,percent:100}]});
 assert.equal(result.sOnly,true);assert.deepEqual(result.ships[0].normal,{min:1102,max:1108});
 assert.equal(result.ships[0].representativeNormal,1105);assert.deepEqual(result.ships[0].mvp,{min:2205,max:2217});
 assert.match(result.notes.join(' '),/中间参考值/);
});
test('forecast experience requires complete valid simulation counts and opponent levels',()=>{
 const store=fixture(),scheme={ships:[{id:1}]},opponent={ships:[{level:99}]};
 assert.equal(estimateForecast(store,scheme,opponent,null).status,'unknown');
 assert.equal(estimateForecast(store,scheme,opponent,{status:'estimated',samples:2,rows:[{label:'S',count:1}]}).status,'unknown');
 assert.equal(estimateForecast(store,scheme,opponent,{status:'estimated',samples:1,rows:[{label:'X',count:1}]}).status,'unknown');
 assert.equal(estimateForecast(store,scheme,{ships:[{level:null}]},{status:'estimated',samples:1,rows:[{label:'S',count:1}]}).status,'unknown');
});
