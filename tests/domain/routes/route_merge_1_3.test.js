'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../../helpers/workbench_fixture');
const {evaluateNormalRoute}=require('../../../src/domain/routes/normal_routes');
const P=require('../../../src/domain/routes/route_plans');
const W=require('../../../src/ui/workbench/workbench_model');
const {recommendNormalFleet,recommendNormalEquipment}=require('../../../src/recommendation');

function fleet(types){
  const state=fixture();
  for(const id of Object.keys(state.info.ships)){
    if(Number(id)>types.length){delete state.info.ships[id];delete state.const.$ships[id];continue;}
    state.const.$ships[id].api_stype=types[Number(id)-1];
    state.info.ships[id].api_lv=99;
  }
  return state;
}
const upper=()=>P.routeOptions('1-3').find(option=>option.key==='A>E>F>J');
const assess=state=>evaluateNormalRoute(state,{area:'1-3',scheme:{fleet:1,ships:Object.keys(state.info.ships).map(Number)}});

test('1-3 upper guide includes both temporary branches through their actual E merge',()=>{
  const option=upper();
  assert.equal(option.name,'上路迂回流');assert.equal(P.routeOptions('1-3').length,2);
  assert.deepEqual(P.optionPaths(option),[[...'AEFJ'],[...'ADBEFJ']]);
  assert.equal(option.pathLabel,'A→(D→B)→E→F→J');
  assert(P.routeOptions('1-3').every(option=>option.basis==='guide'));
});

test('1-3 water-tender fleet sums A-E 20% and A-D-B-E 80% to fixed arrival',()=>{
  const state=fleet([16,3,2,2,2,2]),route=assess(state),option=upper();
  assert.equal(P.planningPath(route,option.nodes).chance.probability,.2,'old single-path interpretation is reproduced');
  const grouped=P.optionPlanning(route,option);
  assert.deepEqual(grouped.branches.map(branch=>branch.chance.probability),[.2,.8]);
  assert.equal(grouped.chance.probability,1);
  assert.equal(W.routeArrival({route},option,true).value,'固定到达');
  assert.deepEqual(P.routeDiagnostics(route,option).warnings,[]);
  const profile=W.selectedMapProfile(W.mapOverview('1-3'),option.key);
  assert.deepEqual(profile.highlightPaths,option.paths);assert.deepEqual(profile.examples,option.paths);
});

test('1-3 fixed D branch stays usable when the representative direct E path is impossible',()=>{
  const state=fleet([22,3,2,2,2,2]),route=assess(state),option=upper(),grouped=P.optionPlanning(route,option);
  assert.deepEqual(grouped.branches.map(branch=>branch.chance.probability),[0,1]);
  assert.deepEqual(grouped.nodes,[...'ADBEFJ']);
  assert.equal(grouped.chance.probability,1);assert.deepEqual(P.routeDiagnostics(route,option).warnings,[]);
});

test('1-3 selected upper strategy never borrows a different C start',()=>{
  const state=fleet([3,3,2,2,2,2]),route=assess(state),option=upper();
  assert.equal(route.probability,1,'the whole fleet can still reach Boss through either start');
  assert.equal(P.optionPlanning(route,option).chance.probability,.5,'only the chosen A-start strategy counts');
  assert.equal(W.routeArrival({route},option,true).value,'到达概率 50%');
});

test('1-3 true F-H diversions do not become success merely because H can also reach Boss',()=>{
  for(const [types,expected] of [[[16,3,3,2,2,2],.5],[[16,11,2,2,2,2],0]]){
    const state=fleet(types),route=assess(state),option=upper();
    assert.equal(route.probability,1);
    assert.equal(P.optionPlanning(route,option).chance.probability,expected);
    const card=W.routeArrival({route},option,true);
    assert.notEqual(card.value,'固定到达');assert.equal(card.unreachable,expected===0);
    assert(P.routeDiagnostics(route,option).warnings.length>0);
  }
});

test('1-3 recommendation and equipment reevaluation share the explicit merged strategy',()=>{
  for(const type of [16,22]){
    const state=fleet([type,3,2,2,2,2]),ids=[1,2,3,4,5,6],before=JSON.stringify(state),option=upper();
    const result=recommendNormalFleet(state,{area:'1-3',fixedShipIds:ids});
    const selected=result.routeResults.find(row=>row.key===option.key);
    assert.equal(selected.status,'available',selected.message);assert.equal(selected.chance.probability,1);
    const row=result.recommendations[selected.recommendationIndex];
    assert.equal(row.pathChance.probability,1);
    const adjusted=recommendNormalEquipment(state,{area:'1-3',routeKey:option.key,scheme:row.scheme});
    assert.equal(adjusted.pathChance.probability,1);
    assert.deepEqual(adjusted.scheme.ships.map(ship=>ship.id),row.scheme.ships.map(ship=>ship.id));
    assert.equal(JSON.stringify(state),before);
  }
});
