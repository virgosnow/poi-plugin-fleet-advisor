'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const plans=require('../../../src/domain/routes/route_plans');
test('1-4 recommends three distinct composition styles with name-only labels',()=>{
  const options=plans.recommendedOptions('1-4'),catalog=plans.routeOptions('1-4');
  assert.deepEqual(options.map(o=>o.name),['战舰推进流','空母洗地流','小船护航流']);
  for(const option of options){
    assert.equal(option.label,option.name);
    assert.equal(option.arrivalMode,'boss');assert(option.templates.length>0);assert.equal(option.paths.length,7);
    assert(option.paths.every(p=>p.at(-1)==='L'));
    assert(option.paths.some(p=>p.includes('H')));assert(option.paths.some(p=>p.includes('J')));
  }
  const heavy=options.find(o=>o.key.endsWith('@heavy')),carrier=options.find(o=>o.key.endsWith('@carriers')),light=options.find(o=>o.key.endsWith('@light'));
  const ships=types=>({ships:types.map(stype=>({stype,name:'测试舰'}))});
  assert(plans.fleetRequirementAssessment(ships([8,7,3,2,2,16]),heavy).eligible);
  assert(!plans.fleetRequirementAssessment(ships([8,7,3,2,2,16]),light).eligible);
  assert(!plans.fleetRequirementAssessment(ships([7,7,3,2,2,16]),light).eligible);
  assert(plans.fleetRequirementAssessment(ships([7,7,3,2,2,16]),carrier).eligible);
  assert(plans.fleetRequirementAssessment(ships([11,18,3,2,2,16]),carrier).eligible);
  assert(!plans.fleetRequirementAssessment(ships([8,7,3,2,2,16]),carrier).eligible);
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
  store.const.$ships[10]={...store.const.$ships[1],api_id:10,api_name:'测试空母',api_stype:11};
  store.info.ships[10]={...store.info.ships[1],api_id:10,api_ship_id:10,api_karyoku:[80,80]};
  const frozen=JSON.stringify(store),{recommendNormalFleet}=require('../../../src/recommendation/normal');
  const result=recommendNormalFleet(store,{area:'1-4',airGoal:'ignore',fixedShipIds:[2]});
  assert.equal(result.recommendations.length,3);
  for(const row of result.recommendations){
    assert(row.scheme.ships.some(s=>s.id===2));
    const types=row.scheme.ships.map(s=>store.const.$ships[store.info.ships[s.id].api_ship_id].api_stype);
    assert.equal(types.some(t=>[8,9,10].includes(t)),row.routeKey.endsWith('@heavy'));
    if(row.routeKey.endsWith('@carriers'))assert(types.some(t=>[7,11,18].includes(t)));
    if(row.routeKey.endsWith('@light'))assert(!types.some(t=>[7,11,18].includes(t)));
    assert(row.pathChance.probability>0);
    assert(!Object.hasOwn(row,'preferences'));assert(!Object.hasOwn(row,'preference'));
    new (require('../../../src/application/controller').Controller)({getStore:()=>store}).preview('fleet',row.scheme);
  }
  assert.equal(JSON.stringify(store),frozen);assert.notEqual(before,frozen);
});
