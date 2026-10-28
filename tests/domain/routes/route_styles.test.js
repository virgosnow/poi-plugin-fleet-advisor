'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const plans=require('../../../src/domain/routes/route_plans');
test('1-4 recommends three distinct composition styles with compact merged-path labels',()=>{
  const options=plans.recommendedOptions('1-4'),catalog=plans.routeOptions('1-4');
  assert.deepEqual(options.map(o=>o.name),['战舰推进流','空母洗地流','小船护航流']);
  for(const option of options){
    assert.equal(option.label,option.name+'（A/B→…→H/J→L）');
    assert.equal(option.arrivalMode,'boss');assert(option.templates.length>0);assert.equal(option.paths.length,6);assert(option.paths.every(p=>!p.includes('I')));
    assert(option.paths.every(p=>p.at(-1)==='L'));
    assert(option.paths.some(p=>p.includes('H')));assert(option.paths.some(p=>p.includes('J')));
  }
  const heavy=options.find(o=>o.key.endsWith('@heavy')),carrier=options.find(o=>o.key.endsWith('@carriers')),light=options.find(o=>o.key.endsWith('@light'));
  const ships=types=>({ships:types.map(stype=>({stype,name:'测试舰'}))});
  assert(plans.fleetRequirementAssessment(ships([8,7,3,2,2,16]),heavy).eligible);
  assert(!plans.fleetRequirementAssessment(ships([8,7,3,2,2,16]),light).eligible);
  assert(!plans.fleetRequirementAssessment(ships([7,7,3,2,2,16]),light).eligible);
  assert(plans.fleetRequirementAssessment(ships([7,7,7,2,2,16]),carrier).eligible);
  assert(plans.fleetRequirementAssessment(ships([11,18,7,2,2,16]),carrier).eligible);
  assert(!plans.fleetRequirementAssessment(ships([8,7,3,2,2,16]),carrier).eligible);
  assert(!plans.fleetRequirementAssessment(ships([7,7,3,2,2,16]),carrier).eligible,'two carriers are not mass aviation');
  assert(!plans.fleetRequirementAssessment(ships([3,2,2,2,2,16]),carrier).eligible);
  assert(plans.fleetRequirementAssessment(ships([3,2,2,2,2,16]),light).eligible);
  assert(!plans.fleetRequirementAssessment(ships([7,7,3,2,2,16]),heavy).eligible);
  assert(catalog.some(o=>o.key==='B>C>F>E>H>L'),'explicit physical routes remain queryable');
  assert(plans.recommendedOptions('2-1').every(o=>o.label.startsWith(o.name+'（')),'ordinary route labels retain their paths');
});
test('route-style generation keeps battleship, carrier and light solutions distinct without changing manual ships',()=>{
  const store=require('../../helpers/workbench_fixture')(),before=JSON.stringify(store);
  store.const.$ships[9]={...store.const.$ships[1],api_id:9,api_name:'测试战舰',api_stype:8};
  store.info.ships[9]={...store.info.ships[1],api_id:9,api_ship_id:9,api_karyoku:[100,100]};
  for(let id=10;id<=12;id++){
    store.const.$ships[id]={...store.const.$ships[1],api_id:id,api_name:'测试空母'+id,api_stype:11};
    store.info.ships[id]={...store.info.ships[1],api_id:id,api_ship_id:id,api_karyoku:[80,80]};
  }
  const frozen=JSON.stringify(store),{recommendNormalFleet}=require('../../../src/recommendation/normal');
  const result=recommendNormalFleet(store,{area:'1-4',airGoal:'ignore',fixedShipIds:[2]});
  assert.equal(result.recommendations.length,3);
  for(const row of result.recommendations){
    assert(row.scheme.ships.some(s=>s.id===2));
    const types=row.scheme.ships.map(s=>store.const.$ships[store.info.ships[s.id].api_ship_id].api_stype);
    assert.equal(types.some(t=>[8,9,10].includes(t)),row.routeKey.endsWith('@heavy'));
    if(row.routeKey.endsWith('@carriers'))assert(types.filter(t=>[7,11,18].includes(t)).length>=3);
    if(row.routeKey.endsWith('@light'))assert(!types.some(t=>[7,11,18].includes(t)));
    assert(row.pathChance.probability>0);assert.equal(plans.pathChance(row.route,['B','C','F','I','L']).max,0,'recommended fleet avoids I');
    assert(!Object.hasOwn(row,'preferences'));assert(!Object.hasOwn(row,'preference'));
    new (require('../../../src/application/controller').Controller)({getStore:()=>store}).preview('fleet',row.scheme);
  }
  assert.equal(JSON.stringify(store),frozen);assert.notEqual(before,frozen);
});
test('mass aviation templates retain five carriers and an explicit routing auxiliary without inventing fixed arrival for the fallback',()=>{
  const store=require('../../helpers/workbench_fixture')(),types=[11,11,18,18,7,20];
  for(let i=0;i<types.length;i++){
    const id=10+i;
    store.const.$ships[id]={...store.const.$ships[1],api_id:id,api_name:'测试航空编成'+id,api_stype:types[i]};
    store.info.ships[id]={...store.info.ships[1],api_id:id,api_ship_id:id,api_karyoku:[80,80]};
  }
  const strategies=require('../../../src/recommendation/strategies'),policy=strategies.guidePolicy('1-4','boss');
  const rows=types.map((stype,i)=>({id:10+i,stype,level:50}));
  assert(strategies.guideHull(policy,rows),'a declared routing auxiliary is useful in this guide');
  assert(!strategies.guideHull({...policy,allowedAuxiliaryStypes:undefined},rows),'ordinary combat policies still reject auxiliary hulls');
  const option=plans.recommendedOptions('1-4').find(o=>o.key.endsWith('@carriers'));
  assert(option.templates.some(template=>template.filter(types=>types.every(t=>[7,11,18].includes(t))).length===5&&template.some(types=>types.includes(20))));
  const {evaluateNormalRoute}=require('../../../src/domain/routes/normal_routes');
  const scheme=ids=>({fleet:1,ships:ids.map(id=>({id,slots:[-1,-1],ex:-1}))});
  const fixed=evaluateNormalRoute(store,{area:'1-4',scheme:scheme([10,11,12,13,14,15])});
  assert.equal(plans.optionPlanning(fixed,option).chance.probability,1);
  assert.equal(plans.pathChance(fixed,['B','C','F','I','L']).max,0);
  const fallback=evaluateNormalRoute(store,{area:'1-4',scheme:scheme([10,11,12,1,2,3])});
  assert(plans.fleetRequirementAssessment(fallback,option).eligible);
  assert.equal(plans.optionPlanning(fallback,option).chance.probability,.875);
  assert.equal(plans.pathChance(fallback,['B','C','F','I','L']).max,0);
  delete store.info.ships[12];delete store.info.ships[13];delete store.info.ships[14];
  const result=require('../../../src/recommendation/normal').recommendNormalFleet(store,{area:'1-4',routeKey:option.key,airGoal:'ignore'});
  assert.equal(result.recommendations.length,0,'missing carriers must not silently become a light escort fleet');
});
