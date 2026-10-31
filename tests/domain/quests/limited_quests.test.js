'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const event=require('../../../data/quests/limited/2026-halloween.json');
const {listRelatedQuests,evaluateFleetRequirements}=require('../../../src/domain/quests/quest_requirements');
const byCode=new Map(event.quests.map(q=>[q.code,q]));
const observed=(code,overrides={})=>{const q=byCode.get(code);return {api_no:q.ids[0],api_title:q.title,api_state:2,...overrides};};
function fixture(ships){
  const state={info:{ships:{}},const:{$ships:{}}};
  const slots=ships.map(([id,name,type=2,ctype=1])=>{
    state.info.ships[id]={api_id:id,api_ship_id:id,api_slot:[],api_slot_ex:0};
    state.const.$ships[id]={api_id:id,api_name:name,api_stype:type,api_ctype:ctype};
    return {id,slots:[],ex:-1};
  });
  return {state,slots};
}
const query=(tasks,mapId='1-3',options={})=>listRelatedQuests({state:{},slots:[],mapId,
  questState:{known:true,tasks},now:Date.parse('2026-10-31T00:00:00+09:00'),...options});

test('festival records separate activity dates, categories, game IDs and sources',()=>{
  assert.equal(event.startDate,'2026-10-14');assert.equal(event.endDate,null);assert.equal(event.timeZone,'Asia/Tokyo');
  assert.equal(event.quests.length,11);assert.equal(event.quests.filter(q=>q.category==='B').length,8);
  assert.equal(event.quests.filter(q=>q.category==='C').length,1);assert.equal(event.quests.filter(q=>q.category==='F').length,2);
  assert.equal(new Set(event.quests.flatMap(q=>q.ids)).size,11);
  assert(event.quests.every(q=>q.requireTitleMatch&&q.source.url&&q.source.idSource));
});

test('only active or available matching event tasks appear on their specified maps',()=>{
  const tasks=event.quests.map(q=>observed(q.code));
  const expected={'2610B1':[['1-3','1-4','2-1'],2],'2610B2':[['1-2','1-5','2-2','2-3'],1],
    '2610B3':[['2-1','2-5','3-1'],2],'2610B4':[['4-2','4-3','4-4'],1],
    '2610B5':[['1-1','1-3'],4],'2610B6':[['1-2','1-4','1-5'],1],
    '2610B7':[['2-1','2-2'],2],'2610B8':[['3-2','3-4','3-5'],1]};
  for(const [code,[maps,count]] of Object.entries(expected)){
    for(const map of maps){const result=query(tasks,map).tasks.find(q=>q.code===code);
      assert(result,`${code} ${map}`);assert.equal(result.goals[0].count,count);assert.equal(result.goals[0].rankMin,'S');}
    assert(!query(tasks,'6-5').tasks.some(q=>q.code===code));
  }
  assert.equal(query([observed('2610B1',{api_state:3})]).tasks.length,0);
  assert.equal(query([observed('2610B1',{api_title:'不同任务'})]).tasks.length,0);
  assert.equal(query([observed('2610B1')],'1-3',{now:Date.parse('2026-10-13T23:59:59+09:00')}).tasks.length,0);
  assert.equal(query([observed('2610B1')],'1-3',{now:Date.parse('2026-10-14T00:00:00+09:00')}).tasks.length,1);
  assert.equal(query([observed('2610C1'),observed('2610F1'),observed('2610F2')]).tasks.length,0);
});

test('pumpkin escort quest retains all map goals and highlights the current map',()=>{
  const task=query([observed('2610B2')],'1-2').tasks[0];
  assert.deepEqual(task.goals.map(goal=>[goal.map,goal.relatedToCurrent]),[['1-2',true],['1-5',false],['2-2',false],['2-3',false]]);
});

test('a confirmed end date is inclusive in Japan and hides an expired event',()=>{
  event.endDate='2026-10-31';
  try{
    assert.equal(query([observed('2610B1')],'1-3',{now:Date.parse('2026-10-31T23:59:59+09:00')}).tasks.length,1);
    assert.equal(query([observed('2610B1')],'1-3',{now:Date.parse('2026-11-01T00:00:00+09:00')}).tasks.length,0);
  }finally{event.endDate=null;}
});

test('flagship and companion counts, named remodels and coastal escort class are evaluated',()=>{
  let f=fixture([[508,'鈴谷航改二',7],[2,'夕立改二'],[3,'村雨改二']]);
  const opening=byCode.get('2610B1');
  assert.equal(evaluateFleetRequirements(opening.fleet,f.state,f.slots,1).status,'met');
  assert.equal(evaluateFleetRequirements(opening.fleet,f.state,f.slots.slice(0,2),1).status,'unmet');
  f=fixture([[1,'非指定舰'],[2,'夕立'],[3,'村雨'],[4,'鈴谷']]);
  assert.equal(evaluateFleetRequirements(opening.fleet,f.state,f.slots,1).status,'unmet');
  f=fixture([[530,'伊504',13],[2,'村雨'],[3,'朧']]);
  assert.equal(evaluateFleetRequirements(byCode.get('2610B4').fleet,f.state,f.slots,1).status,'met');
  f=fixture([[1,'第四号海防艦',1,104],[2,'第二十二号海防艦',1,104],[3,'第三〇号海防艦',1,104],[4,'樫',2]]);
  assert.equal(evaluateFleetRequirements(byCode.get('2610B6').fleet,f.state,f.slots,1).status,'met');
  f=fixture([[1,'迅鯨',20],[2,'朧'],[3,'夕立']]);
  assert.equal(evaluateFleetRequirements(byCode.get('2610B7').fleet,f.state,f.slots,1).status,'unmet');
  f.state.const.$ships[1].api_name='迅鯨改';
  assert.equal(evaluateFleetRequirements(byCode.get('2610B7').fleet,f.state,f.slots,1).status,'met');
});
