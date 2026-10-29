'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../../helpers/workbench_fixture');
const {canEquip}=require('../../../src/domain/fleet/equipment_rules');
const {evaluateNormalRoute}=require('../../../src/domain/routes/normal_routes');
const P=require('../../../src/domain/routes/route_plans');
const W=require('../../../src/ui/workbench/workbench_model');
const {recommendNormalFleet,recommendNormalEquipment}=require('../../../src/recommendation');

const ids=[1,2,3,4,5,6],boilerId=900;
// Routing regression for legal manually selected fleets, independent of presets.
const option=()=>({key:'A>C>D>G>I>J>P',phase:'gauge2',nodes:[...'ACDGJP'],paths:[[...'ACDGJP'],[...'ACDGIJP']],pathLabel:'A→C→D→G→(I)→J→P'});
function fleet({submarine=true}={}){
  const store=fixture(),types=[submarine?13:5,5,5,2,2,2];
  const names=[submarine?'伊201改':'妙高改二','羽黒改二','足柄改二','测试驱逐甲','测试驱逐乙','测试驱逐丙'];
  for(const id of Object.keys(store.info.ships)){
    const index=Number(id)-1;
    if(index>=ids.length){delete store.info.ships[id];delete store.const.$ships[id];continue;}
    const hullSpeed=submarine&&index===0?5:10;
    Object.assign(store.const.$ships[id],{api_stype:types[index],api_name:names[index],api_soku:hullSpeed});
    Object.assign(store.info.ships[id],{api_lv:99,api_soku:hullSpeed,api_sakuteki:[200,200]});
  }
  store.info.equips[boilerId]={api_id:boilerId,api_slotitem_id:87,api_level:0};
  store.const.$equips[87]={api_id:87,api_name:'新型高温高圧缶',api_type:[0,0,17,19],api_saku:0};
  for(const type of new Set(types))store.const.$shipTypes[type]={api_equip_type:{17:1}};
  return store;
}
const scheme=boost=>({fleet:1,ships:ids.map(id=>({id,slots:id===1&&boost?[boilerId,-1]:[-1,-1],ex:-1}))});
const assess=(store,draft)=>evaluateNormalRoute(store,{area:'7-3',phase:'gauge2',scheme:draft});
const chance=(route,path)=>P.planningPath(route,[...path],{allowTentative:false}).chance.probability;

test('7-3 no-Kamikaze guide only merges the harmless I transit before J',()=>{
  const selected=option();
  assert.deepEqual(P.optionPaths(selected),[[...'ACDGJP'],[...'ACDGIJP']]);
  assert(P.optionPaths(selected).every(nodes=>!nodes.includes('M')&&!nodes.includes('K')&&!nodes.includes('L')));
  assert.equal(selected.pathLabel,'A→C→D→G→(I)→J→P');
});

test('7-3 unboosted I-201 detour through battle M is not counted as the selected merged route',()=>{
  const store=fleet(),route=assess(store,scheme(false)),selected=option();
  assert.equal(store.const.$ships[1].api_soku,5);assert.equal(store.info.ships[1].api_soku,5);
  assert.equal(route.speed.fleetSpeed,'slow');
  assert.equal(chance(route,'ACDGJP'),0);assert.equal(chance(route,'ACDGIJP'),0);
  assert.equal(chance(route,'ACDGIJMP'),1);assert.equal(route.probability,1);
  assert.equal(P.optionPlanning(route,selected).chance.probability,0);
  assert.equal(W.routeArrival({route},selected,true).unreachable,true);
});

test('7-3 actual new-boiler speed calculation opens the I-J branch without changing live hull speed',()=>{
  const store=fleet(),before=JSON.stringify(store);
  assert.equal(canEquip(store,1,boilerId,0),true);
  const route=assess(store,scheme(true)),selected=option(),shipSpeed=route.speed.ships.find(ship=>ship.shipId===1);
  assert.equal(shipSpeed.status,'computed');assert.equal(shipSpeed.group,'slowD');assert.equal(shipSpeed.speed,'fast');
  assert.equal(shipSpeed.propulsion.newBoilers,1);assert.equal(shipSpeed.propulsion.turbines,0);
  assert.equal(route.speed.fleetSpeed,'fast');
  assert.equal(chance(route,'ACDGJP'),0);assert.equal(chance(route,'ACDGIJP'),1);assert.equal(chance(route,'ACDGIJMP'),0);
  assert.deepEqual(P.optionPlanning(route,selected).branches.map(branch=>branch.chance.probability),[0,1]);
  assert.equal(P.optionPlanning(route,selected).chance.probability,1);
  assert.equal(W.routeArrival({route},selected,true).value,'固定到达');
  assert.deepEqual(P.routeDiagnostics(route,selected).warnings,[]);
  assert.equal(JSON.stringify(store),before);
});

test('7-3 all-fast three-heavy-cruiser control retains the original direct G-J branch',()=>{
  const store=fleet({submarine:false}),route=assess(store,scheme(false)),selected=option();
  assert.equal(route.speed.fleetSpeed,'fast');
  assert.deepEqual(P.optionPlanning(route,selected).branches.map(branch=>branch.chance.probability),[1,0]);
  assert.equal(P.optionPlanning(route,selected).chance.probability,1);
  assert.equal(P.fleetRequirementAssessment(route,selected).eligible,true);
});

test('7-3 original two-heavy-cruiser and aviation-cruiser fleet keeps the same direct G-J branch',()=>{
  const store=fleet({submarine:false});
  Object.assign(store.const.$ships[1],{api_stype:6,api_name:'最上改二特'});
  const route=assess(store,scheme(false)),selected=option();
  assert.deepEqual(P.optionPlanning(route,selected).branches.map(branch=>branch.chance.probability),[1,0]);
  assert.equal(P.optionPlanning(route,selected).chance.probability,1);
  assert.equal(P.fleetRequirementAssessment(route,selected).eligible,true);
});

test('7-3 recommendation and manual refitting preserve the real speed item and selected I-J branch',()=>{
  const store=fleet(),before=JSON.stringify(store),selected=option();
  const heldSlots=[{...scheme(true).ships[0],pin:true,keep:{0:true}}];
  const heldBefore=JSON.stringify(heldSlots);
  const result=recommendNormalFleet(store,{area:'7-3',phase:'gauge2',routeKey:selected.key,fixedShipIds:ids,heldSlots});
  const found=result.routeResults.find(row=>row.key===selected.key);
  assert.equal(found.status,'available',found.message);assert.equal(found.chance.probability,1);
  const row=result.recommendations[found.recommendationIndex];
  assert.deepEqual(row.selectedPath,[...'ACDGIJP']);assert.equal(row.pathChance.probability,1);
  assert.equal(row.scheme.ships[0].id,1);assert.equal(row.scheme.ships[0].slots[0],boilerId);
  assert.deepEqual(row.scheme.ships.map(ship=>ship.id).sort((a,b)=>a-b),ids);
  const adjusted=recommendNormalEquipment(store,{area:'7-3',phase:'gauge2',routeKey:selected.key,scheme:row.scheme,heldSlots});
  assert.equal(adjusted.pathChance.probability,1);assert.deepEqual(adjusted.selectedPath,[...'ACDGIJP']);
  assert.deepEqual(adjusted.scheme.ships.map(ship=>ship.id),row.scheme.ships.map(ship=>ship.id));
  assert.equal(adjusted.scheme.ships[0].slots[0],boilerId);
  assert.equal(assess(store,adjusted.scheme).speed.ships.find(ship=>ship.shipId===1).status,'computed');
  assert.equal(JSON.stringify(heldSlots),heldBefore);assert.equal(JSON.stringify(store),before);
});
