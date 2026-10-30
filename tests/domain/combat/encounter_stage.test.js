'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {encounterStage,filterFormations}=require('../../../src/domain/combat/encounter_stage');
const {formationRecords,routeEncounters}=require('../../../src/domain/combat/combat_encounters');
const store=(id,row)=>({info:{maps:{[id]:row}}});
const phases=(area,id)=>formationRecords(require(`../../../data/sortie/encounters/${area}.json`).nodes[id]).formations;

test('gauge counters distinguish reduction, final and cleared even after historical clear',()=>{
  const map={api_gauge_type:1,api_required_defeat_count:4,api_defeat_count:0,api_cleared:1};
  assert.equal(encounterStage(store(35,map),'3-5'),'before');
  map.api_defeat_count=3;assert.equal(encounterStage(store(35,map),'3-5'),'final');
  map.api_defeat_count=4;assert.equal(encounterStage(store(35,map),'3-5'),'after');
  delete map.api_required_defeat_count;delete map.api_defeat_count;
  assert.equal(encounterStage(store(35,map),'3-5'),'unknown');
  map.api_defeat_count=0;assert.equal(encounterStage(store(35,map),'3-5'),'unknown');
  delete map.api_defeat_count;delete map.api_cleared;
  assert.equal(encounterStage(store(35,map),'3-5'),'unknown');
  map.api_required_defeat_count=4;map.api_defeat_count=5;
  assert.equal(encounterStage(store(35,map),'3-5'),'unknown');
  map.api_defeat_count=4;assert.equal(encounterStage(store(35,map),'3-5'),'after');
});
test('selected multi-gauge phase never borrows a different active gauge counter',()=>{
  const map={api_gauge_type:1,api_gauge_num:2,api_required_defeat_count:2,api_defeat_count:1};
  assert.equal(encounterStage(store(56,map),'5-6','gauge1'),'notCleared');
  assert.equal(encounterStage(store(56,map),'5-6','gauge2'),'final');
  assert.equal(encounterStage(store(56,map),'5-6','gauge3'),'notCleared');
  assert.equal(encounterStage(store(56,map),'5-6'),'unknown');
  map.api_gauge_type=2;assert.equal(encounterStage(store(56,map),'5-6','gauge2'),'unknown');
  delete map.api_required_defeat_count;delete map.api_defeat_count;map.api_cleared=1;
  assert.equal(encounterStage(store(56,map),'5-6','gauge2'),'unknown');
});
test('a bare historical clear flag is not proof a monthly gauge is cleared this month',()=>{
  for(const [id,area] of [[35,'3-5'],[45,'4-5'],[55,'5-5'],[65,'6-5'],[74,'7-4']])
    assert.equal(encounterStage(store(id,{api_cleared:1} ),area),'unknown');
  assert.equal(encounterStage(store(64,{api_cleared:1}),'6-4'),'after');
});
test('3-5 final prioritizes marked forms without discarding unlabelled alternatives',()=>{
  for(const id of ['E','F','G','H','K']){
    const rows=phases('3-5',id),before=filterFormations('3-5',id,rows,'before');
    assert(before.length&&before.every(row=>row.finalForm!==true));
    for(const stage of ['final','after']){
      const result=filterFormations('3-5',id,rows,stage);
      assert.equal(result[0].finalForm,true);
      if(['G','H'].includes(id))assert(result.every(row=>row.finalForm===true));
      else assert.equal(result.length,rows.length);
    }
  }
});
test('5-5 before and final preserve pre-clear patterns and after uses distinct post-clear set',()=>{
  const rows=phases('5-5','S');
  for(const stage of ['before','final'])assert.deepEqual(filterFormations('5-5','S',rows,stage).map(r=>r.pattern),[1,2,3,4,5]);
  assert.deepEqual(filterFormations('5-5','S',rows,'after').map(r=>r.pattern),[6,7,8]);
  assert.equal(filterFormations('5-5','S',rows,'unknown').length,8);
});
test('4-5 T final uses only the documented strengthened boss formations',()=>{
  const rows=phases('4-5','T');
  assert.deepEqual(filterFormations('4-5','T',rows,'before').map(row=>row.pattern),[1,2,3]);
  assert.deepEqual(filterFormations('4-5','T',rows,'final').map(row=>row.pattern),[4,5,6]);
  assert.deepEqual(filterFormations('4-5','T',rows,'after').map(row=>row.pattern),[1,2,3]);
  const {routeAirReference}=require('../../../src/domain/routes/route_air');
  const air=stage=>routeAirReference({},'4-5',{examples:[['T']],encounterStage:stage}).enemyAirPower;
  assert.equal(air('before'),138);assert.equal(air('final'),111);assert.equal(air('after'),138);
});
test('5-6 final prioritizes marked forms while clear selects explicitly post-clear variants',()=>{
  for(const id of ['X','Z']){
    const rows=phases('5-6',id);
    assert.deepEqual(filterFormations('5-6',id,rows,'before').map(r=>r.pattern),[1,2,3]);
    assert.deepEqual(filterFormations('5-6',id,rows,'final').map(r=>r.pattern),[4,5,6,1,2,3]);
    assert.deepEqual(filterFormations('5-6',id,rows,'after').map(r=>r.pattern),[7,8,9]);
    assert.deepEqual(filterFormations('5-6',id,rows,'notCleared').map(r=>r.pattern),[1,2,3,4,5,6]);
  }
});
test('6-5 final prioritizes marked forms; after clear excludes them at boss and en route',()=>{
  for(const id of ['A','C','F','G','H','M']){
    const rows=phases('6-5',id);
    assert.equal(filterFormations('6-5',id,rows,'final')[0].finalForm,true);
    assert(filterFormations('6-5',id,rows,'after').every(row=>row.finalForm!==true));
  }
});
test('structured route encounters use the same stage filter for each visited battle',()=>{
  const data=require('../../../data/sortie/encounters/6-5.json');
  const profile={area:'6-5',encounterStage:'final',routePaths:[{nodes:['F','M']}],targetNodes:['M'],mapPreview:{nodes:[{id:'F'},{id:'M'}]}};
  const evidence=routeEncounters(profile,data);
  assert.equal(evidence.status,'known');
  for(const node of evidence.nodes)assert.equal(node.formations[0].finalForm,true);
});
