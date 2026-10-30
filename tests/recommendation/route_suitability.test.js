'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assess,index,threats}=require('../../src/recommendation/route_suitability');
const profile={fuelConsumedFraction:{minimum:.2,maximum:.4},ammoConsumedFraction:{minimum:.2,maximum:.4}};
const scores={surfaceStrengthProxy:800,nightStrengthProxy:400,openingAirStrikeProxy:0,airGoalStatus:'meetsAlongRoute'};
const node={id:'B',kind:'battle',boss:true,demand:800};
const read=(overrides={})=>assess({nodes:[node],scores,profile,ships:[{fuel:50,ammo:100}],...overrides});
test('uses fixed absolute anchors, independently of other route options',()=>{
  assert.equal(index(1),75);assert.equal(read().score,75);assert.equal(read().grade,'合适');
  assert.deepEqual(read().cost,{fuel:{min:10,max:20},ammo:{min:20,max:40},estimated:true});
  assert.equal(read({ships:[{fuel:100,ammo:200}]}).score,read().score,'cost is separate from combat suitability');
  assert.deepEqual(read({ships:[]}).cost,{fuel:null,ammo:null,estimated:true},'missing supply is not zero consumption');
  assert(read({scores:{...scores,surfaceStrengthProxy:1200}}).score>read().score);
});
test('unreachable and unknown remain distinct and never produce a numeric score',()=>{
  assert.equal(read({reachable:false}).status,'unreachable');assert.equal(read({reachable:false}).score,null);
  assert.equal(read({nodes:null}).status,'unconfirmed');assert.equal(read({nodes:null}).score,null);
  assert.equal(read({scores:{...scores,airGoalStatus:'unknown'}}).status,'unconfirmed');
});
test('anti-submarine shortfall cannot be offset by powerful surface fleet',()=>{
  const nodes=[node,{id:'C',kind:'asw',demand:0}];
  const insufficient=read({nodes,scores:{...scores,surfaceStrengthProxy:2000,aswCombat:{status:'known',readiness:0,nodes:[{id:'C',readiness:0}]}}});
  assert(insufficient.score<=15);assert(insufficient.reasons.some(reason=>reason.includes('对潜')));
  const unknown=read({nodes,scores:{...scores,aswCombat:{status:'partial',readiness:1}}});
  assert.equal(unknown.status,'unconfirmed');
  assert.equal(read({nodes:[{...node,hasSubmarines:true}]}).status,'unconfirmed','mixed enemy submarine formations require ASW evidence');
});
test('critical air shortfall constrains score and aircraft risk is not a probability',()=>{
  const fit=read({scores:{...scores,surfaceStrengthProxy:1800}});
  const weak=read({scores:{...scores,surfaceStrengthProxy:1800,airGoalStatus:'belowAlongRoute'}});
  assert(weak.score<fit.score);assert(weak.score<=60);
  const loss=read({scores:{...scores,aircraftRisk:{slots:[{risk:.7}]}}});
  assert(loss.score<=read().score);assert(loss.reasons.some(reason=>reason.includes('损耗')));
});
test('route evidence includes only selected nodes and does not join alternative fleets',()=>{
  const {previewForMap}=require('../../src/domain/routes/sortie_profile');
  const {enemyDemand}=require('../../src/recommendation/route_suitability');
  const map=previewForMap('1-4',{target:'boss'});
  assert(map.mapPreview.nodes.length>0);
  const selected={...map,routePaths:[{nodes:['H']}]},result=threats(selected);
  assert.deepEqual(result.map(n=>n.id),['H']);
  const data=require('../../data/sortie/encounters/1-4.json').nodes.H;
  const expected=Math.max(...Object.values(data.phases).flatMap(phase=>phase.patterns.filter(p=>p.enemyShips?.length)).map(pattern=>
    [...pattern.enemyShips,...(pattern.escortFleet?.enemyShips||[])].reduce((sum,e)=>sum+enemyDemand(e),0)));
  assert.equal(result[0].demand,expected);
  assert.equal(threats({...selected,routePaths:[{nodes:['missing']}]}),null);
});
