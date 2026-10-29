'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../../../src/domain/routes/route_plans');
const W=require('../../../src/ui/workbench/workbench_model');
const witnesses=require('../../fixtures/route_catalog_witnesses.json');
const catalog=require('../../../data/normal_route_guides.json').maps;
function sample(w){
  const guide=catalog[w.catalog],area=w.catalog.split(':')[0];
  const option=P.routeOptions(area,guide.target,guide.phase||undefined).find(o=>o.id===w.id);
  const ships=w.types.map((stype,i)=>({instanceId:i+1,stype,name:w.names[i]||'测试舰'+i,
    openingTorpedo:[3,4,13,14,16].includes(stype),radarEquipped:i<w.radars,
    drumEquipped:i<w.drums,landingCraftEquipped:false}));
  return {option,route:{area,phase:guide.phase,targetNodes:[w.paths[0].at(-1)],ships,
    probability:null,chanceRange:[0,1],
    speed:{status:'observed',fleetSpeed:w.speed,ships:ships.map(s=>({shipId:s.instanceId,speed:w.speed,status:'observed'}))},
    lineOfSight:{status:'computed',rawScoresByCoefficient:Object.fromEntries([1,2,3,4].map(c=>[c,w.los])),thresholdMargin:0}}};
}
const middle=()=>sample(witnesses.find(w=>w.id==='5-6-17'));

test('5-6 middle carrier route follows I-O and O-Q instead of including unchosen manual exits',()=>{
  const {route,option}=middle(),before=JSON.stringify({route,option});
  assert.equal(P.optionPlanning(route,option).chance.probability,1);
  const chance=P.bossArrivalChance(route,option);
  assert.equal(chance.probability,1);
  assert.deepEqual(chance.playerChoices,[{from:'I',to:'O'},{from:'O',to:'Q'}]);
  for(const selected of [option,{...option,paths:undefined}]){
    const card=W.routeArrival({route},selected,true);
    assert.equal(card.value,'固定到达');assert.equal(card.tone,'good');
    assert.match(card.note,/I 点选 O，O 点选 Q/);
  }
  assert.equal(JSON.stringify({route,option}),before,'the unselected graph and draft remain unchanged');
});

test('5-6 still checks the X-Z coefficient-4 boundary and real LoS uncertainty',()=>{
  for(const [score,expected]of [[88,1],[87.999,0]]){
    const {route,option}=middle();route.lineOfSight.rawScoresByCoefficient[4]=score;
    assert.equal(P.bossArrivalChance(route,option).probability,expected);
    const card=W.routeArrival({route},option,true);
    assert.equal(card.value,expected?'固定到达':'无法抵达 Boss');
    assert.equal(card.unreachable,!expected);
  }
  const {route,option}=middle();
  route.lineOfSight={status:'estimate',rawScoresByCoefficient:{4:88},
    lowerBoundScoresByCoefficient:{4:87},upperBoundScoresByCoefficient:{4:89}};
  assert.equal(W.routeArrival({route},option,true).value,'到达率待确认');
  route.lineOfSight.lowerBoundScoresByCoefficient[4]=88;
  assert.equal(W.routeArrival({route},option,true).value,'固定到达');
});

test('known draft propulsion is usable but a locked phase or ambiguous manual exit is not assumed',()=>{
  const {route,option}=middle();
  route.speed={...route.speed,status:'estimated',ships:route.speed.ships.map(s=>({...s,status:'estimated'}))};
  assert.equal(P.bossArrivalChance(route,option).probability,1);
  assert.notEqual(P.bossArrivalChance({...route,phase:'gauge2'},option).probability,1);
  const ambiguous={...option,paths:[option.nodes,['I','J','K','L','N']]};
  assert.notEqual(P.bossArrivalChance(route,ambiguous).probability,1);
  assert(!P.bossArrivalChance(route,ambiguous).playerChoices.some(p=>p.from==='I'));
  const invalid={...option,paths:[['I','Z']]};
  assert.notEqual(P.bossArrivalChance(route,invalid).probability,1);
});

test('all catalog manual-choice routes retain their proven path odds and fixed arrivals',()=>{
  const checked=new Set();
  for(const w of witnesses){
    const {route,option}=sample(w);
    if(option.arrivalMode!=='boss')continue;
    const chance=P.bossArrivalChance(route,option);
    if(!chance.playerChoices.length)continue;
    checked.add(route.area);
    assert(chance.min>=w.probability-1e-8,`${w.id}: selected ${w.probability}, total ${chance.min}`);
    if(w.probability===1)assert.equal(chance.probability,1,w.id);
  }
  for(const area of ['4-5','5-3','5-5','5-6','6-3','7-4','7-5'])assert(checked.has(area),area);
});

test('random Boss-bound detours stay included and maps without manual choices keep their graph odds',()=>{
  const detour=sample(witnesses.find(w=>w.id==='4-5-09'));
  detour.route.lineOfSight.rawScoresByCoefficient[2]=65;
  assert.equal(P.optionPlanning(detour.route,detour.option).chance.probability,.5);
  assert.equal(P.bossArrivalChance(detour.route,detour.option).probability,1,
    'the K-L detour can still reach Boss and must not be discarded');
  const diversion=sample(witnesses.find(w=>w.id==='5-5-01'));
  diversion.route.lineOfSight.rawScoresByCoefficient[2]=75;
  assert.equal(P.bossArrivalChance(diversion.route,diversion.option).probability,.5,
    'choosing F-J must not bypass the later random P-Q failure');
  assert.equal(W.routeArrival({route:diversion.route},diversion.option,true).value,'到达概率 50%');
  const fixture=require('../../helpers/workbench_fixture');
  const {evaluateNormalRoute}=require('../../../src/domain/routes/normal_routes');
  const store=fixture();
  for(let id=1;id<=6;id++)store.const.$ships[id].api_stype=13;
  const route=evaluateNormalRoute(store,{area:'2-3',scheme:{fleet:1,ships:[1,2,3,4,5,6]}});
  const option={nodes:[...'CFGKN'],paths:['CFGKN','CDFGKN','CFGIKN','CDFGIKN'].map(p=>[...p]),arrivalMode:'boss'};
  assert.equal(P.bossArrivalChance(route,option).probability,route.probability);
  assert(Math.abs(route.probability-.7607275)<1e-9);
  assert(P.optionPlanning(route,option).chance.probability<route.probability);
  assert.equal(W.routeArrival({route},option,true).value,'到达概率 76.1%');
  assert.equal(W.routeArrival({route:{...route,probability:null}},option,true).value,'到达率待确认');
});
