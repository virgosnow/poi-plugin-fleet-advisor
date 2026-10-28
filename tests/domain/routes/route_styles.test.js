'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const plans=require('../../../src/domain/routes/route_plans');
test('1-4 recommends heavy and light compositions over merged physical branches',()=>{
  const options=plans.recommendedOptions('1-4'),catalog=plans.routeOptions('1-4');
  assert.equal(options.length,2);
  for(const option of options){
    assert.equal(option.arrivalMode,'boss');assert(option.templates.length>0);assert(option.paths.length>1);
    assert(option.paths.every(p=>p.at(-1)==='L'));
    assert(option.paths.some(p=>p.includes('H')));assert(option.paths.some(p=>p.includes('J')));
  }
  const heavy=options.find(o=>o.key.endsWith('@heavy')),light=options.find(o=>o.key.endsWith('@light'));
  const ships=types=>({ships:types.map(stype=>({stype,name:'测试舰'}))});
  assert(plans.fleetRequirementAssessment(ships([8,7,3,2,2,16]),heavy).eligible);
  assert(!plans.fleetRequirementAssessment(ships([8,7,3,2,2,16]),light).eligible);
  assert(plans.fleetRequirementAssessment(ships([7,7,3,2,2,16]),light).eligible);
  assert(!plans.fleetRequirementAssessment(ships([7,7,3,2,2,16]),heavy).eligible);
  assert(catalog.some(o=>o.key==='B>C>F>E>H>L'),'explicit physical routes remain queryable');
});
test('route-style generation keeps heavy and light solutions separate without changing manual ships',()=>{
  const store=require('../../helpers/workbench_fixture')(),before=JSON.stringify(store);
  store.const.$ships[9]={...store.const.$ships[1],api_id:9,api_name:'测试战舰',api_stype:8};
  store.info.ships[9]={...store.info.ships[1],api_id:9,api_ship_id:9,api_karyoku:[100,100]};
  const frozen=JSON.stringify(store),{recommendNormalFleet}=require('../../../src/recommendation/normal');
  const result=recommendNormalFleet(store,{area:'1-4',airGoal:'ignore',fixedShipIds:[2]});
  assert.equal(result.recommendations.length,2);
  for(const row of result.recommendations){
    assert(row.scheme.ships.some(s=>s.id===2));
    const capital=row.scheme.ships.some(s=>[8,9,10,11,18].includes(store.const.$ships[store.info.ships[s.id].api_ship_id].api_stype));
    assert.equal(capital,row.routeKey.endsWith('@heavy'));assert(row.pathChance.probability>0);
    assert(!Object.hasOwn(row,'preferences'));assert(!Object.hasOwn(row,'preference'));
    new (require('../../../src/application/controller').Controller)({getStore:()=>store}).preview('fleet',row.scheme);
  }
  assert.equal(JSON.stringify(store),frozen);assert.notEqual(before,frozen);
});
