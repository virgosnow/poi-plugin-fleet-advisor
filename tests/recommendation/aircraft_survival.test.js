'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {aircraftSurvival,survivalPenalty}=require('../../src/recommendation/loadout/aircraft_survival');
const {reconSurvivalLoadout}=require('../../src/recommendation/loadout/aircraft_survival');
const air=(type=11,n=4)=>({slots:[{shipId:1,slot:0,aircraftType:type,planes:[n,n]}]});
test('known strong AA losses reduce aircraft credit while keeping fighter/recon slots exempt',()=>{
  const estimate={paths:[{steps:[{aircraft:[{shipId:1,slot:0,planes:[0,4]}]}]}]};
  assert.equal(aircraftSurvival(air(),{},estimate).slots[0].risk,.5);
  for(const type of [6,9,10,45])assert.equal(aircraftSurvival(air(type),{},estimate).slots.length,0);
  assert.equal(aircraftSurvival(air(),{},null).slots[0].risk,0);
});
test('unquantified enemy AACI remains unknown and adds greater fragility to small attack slots',()=>{
  const reference={nodes:[{id:'K',kind:'battle',antiAir:{status:'unknown',reason:'敌方特殊对空迎击尚未定量'}}]};
  const small=aircraftSurvival(air(11,4),reference),large=aircraftSurvival(air(11,24),reference);
  assert(small.slots[0].risk>large.slots[0].risk);assert.equal(small.slots[0].remainingLowerBound,null);
  assert.deepEqual(small.uncertainNodes,['K']);
  assert.equal(aircraftSurvival(air(),{nodes:[{...reference.nodes[0],kind:'aerialRaid'}]}).slots[0].risk,0);
});
test('a recon backup avoids losing all observation utility when the only seaplane bomber is fragile',()=>{
  const store={info:{ships:{1:{api_ship_id:1,api_onslot:[4,1]}},equips:{1:{api_slotitem_id:1},2:{api_slotitem_id:2}}},const:{$ships:{1:{api_stype:10}},$equips:{1:{api_type:[0,0,11],api_baku:8},2:{api_type:[0,0,10]}}}};
  const estimate={paths:[{steps:[{aircraft:[{shipId:1,slot:0,planes:[0,4]}]}]}]};
  const bomber=survivalPenalty(store,{ships:[{id:1,slots:[1]}]},air(),{},estimate);
  const backup=survivalPenalty(store,{ships:[{id:1,slots:[1,2]}]},air(),{},estimate);
  assert(bomber.penalty>backup.penalty);assert(backup.penalty>0);
  store.info.ships[1].api_onslot[1]=0;
  assert.equal(survivalPenalty(store,{ships:[{id:1,slots:[1,2]}]},air(),{},estimate).penalty,bomber.penalty);
});
test('real ordinary simulation feeds survival scoring, including terminal interception without changing arrival margins',()=>{
  const {simulateAirPath}=require('../../src/domain/routes/route_air');
  const input=air(11,4);input.status='range';Object.assign(input.slots[0],{effectiveAntiAir:[3,3],proficiencyBonus:[9,9]});
  const node={id:'B',kind:'battle',enemyAirPower:0,antiAir:{status:'known',proportion:.2,fixed:4}};
  const full=simulateAirPath(input,[node]),brief=simulateAirPath(input,[node],false);
  assert.deepEqual(full.margins,brief.margins);
  const score=aircraftSurvival(input,{nodes:[node]},{paths:[full]});
  assert.equal(score.slots[0].remainingLowerBound,0);assert.equal(score.slots[0].risk,.5);
  const safe={...node,antiAir:{status:'known',proportion:0,fixed:0}};
  assert(score.slots[0].risk>aircraftSurvival(input,{nodes:[safe]},{paths:[simulateAirPath(input,[safe])]}).slots[0].risk);
  const unknown={...node,antiAir:{status:'unknown',reason:'敌方特殊对空迎击尚未定量'}};
  assert.equal(simulateAirPath(input,[unknown]).status,'estimated','terminal unknown AA does not invalidate arrival air control');
});
test('fragile cruiser bombers get one real recon alternative while held slots and inventory remain intact',()=>{
  const store=require('../helpers/workbench_fixture')();
  store.const.$ships[1].api_stype=6;store.info.ships[1].api_onslot=[0,4];
  store.const.$shipTypes[6]={api_equip_type:{10:1,11:1}};
  store.const.$equips[1001]={api_id:1001,api_type:[0,0,11],api_baku:8};
  store.const.$equips[1002]={api_id:1002,api_type:[0,0,10],api_saku:7};
  for(const id of [1001,1002])store.info.equips[id]={api_id:id,api_slotitem_id:id};
  const inventory=[{id:1002,master:store.const.$equips[1002]}],scheme={fleet:1,ships:[{id:1,slots:[-1,1001],ex:-1}]};
  const risk={slots:[{shipId:1,slot:1,type:11,risk:.5,planes:4}]},before=JSON.stringify({store,scheme});
  const next=reconSurvivalLoadout(store,scheme,inventory,risk);
  assert.deepEqual(next.ships[0].slots,[-1,1002]);assert.equal(JSON.stringify({store,scheme}),before);
  assert.equal(reconSurvivalLoadout(store,scheme,inventory,risk,[{id:1,keep:{1:true}}]),null);
  assert.equal(reconSurvivalLoadout(store,scheme,[],risk),null);
  assert.equal(reconSurvivalLoadout(store,scheme,inventory,{slots:[{...risk.slots[0],risk:.1}]}),null);
});
