'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {readShipStats,improvement}=require('../../../src/domain/expeditions/expedition_stats');
const {createEvaluator,evaluateExpedition}=require('../../../src/domain/expeditions/expeditions');
function fixture(){
  const ship={api_id:1,api_ship_id:543,api_lv:99,api_cond:60,api_slot:[-1,-1,-1],api_slot_ex:0,
    api_karyoku:[40,100],api_taiku:[30,100],api_taisen:[50,100],api_sakuteki:[20,100],api_fuel:15,api_bull:15};
  const store={info:{ships:{1:ship},equips:{},fleets:[{api_ship:[1],api_mission:[0,0]}],repairs:[]},
    const:{$ships:{543:{api_id:543,api_ctype:38,api_stype:2,api_aftershipid:'0',api_maxeq:[1,2,0],api_fuel_max:15,api_bull_max:15}},$equips:{},$missions:{}}};
  const gear=(id,type,raw={},star=0)=>{const instance=id+1000;store.info.equips[instance]={api_slotitem_id:id,api_level:star};
    store.const.$equips[id]={api_id:id,api_type:[0,0,type,0],...raw};return instance;};
  return {store,ship,gear,read:slots=>readShipStats(store,1,{slots,ex:0})};
}
test('monthly projections remove original raw and blue stats before applying new equipment and improvement',()=>{
  const f=fixture(),gun=f.gear(267,1,{api_houg:5}),radar=f.gear(28,12,{api_saku:5},4);
  f.ship.api_slot=[gun,-1,-1];f.ship.api_karyoku=[48,100];
  assert.equal(f.read([-1,-1,-1]).firepower.lower,40,'remove D gun raw 5 and Naganami blue 3');
  assert.equal(f.read([gun,radar,-1]).firepower.lower,52,'D gun/radar synergy +3, radar improvement +1');
  assert.equal(f.read([gun,radar,-1]).los.lower,27,'raw radar LoS +5 and expedition improvement +2');
  assert.equal(f.read([gun,-1,-1]).firepower.status,'known');
});
test('monthly improvement truncates each item to a tenth and differs from combat improvement',()=>{
  const f=fixture(),medium=f.gear(4,2,{api_houg:2},6),small=f.gear(1,1,{api_houg:2},2),other=f.gear(2,1,{api_houg:2},3);
  assert.equal(f.read([medium,small,other]).firepower.lower,49.9);
  const item={instance:{api_level:9},master:{api_type:[0,0,1,16]},type:1};
  assert.equal(improvement(item,'antiAir').value,3);assert.equal(improvement(item,'firepower').value,1.5);
});
test('aircraft dispatch ASW uses full slot capacity, zero slots and conservative proficiency bounds',()=>{
  const f=fixture(),gyro=f.gear(69,25,{api_tais:10}),plane=f.gear(16,8,{api_tais:9,api_saku:4});
  f.ship.api_onslot=[0,0,0];
  assert.deepEqual([f.read([gyro,-1,-1]).asw.lower,f.read([-1,gyro,-1]).asw.lower,f.read([-1,-1,gyro]).asw.lower],[56,56,50]);
  const projected=f.read([plane,-1,-1]);
  assert.equal(projected.asw.lower,55);assert.equal(projected.asw.upper,null);
  assert.equal(projected.los.lower,20);assert.equal(projected.los.upper,null,'do not count unverified aircraft LoS as certain');
});
test('monthly evaluator caches full outfits, rather than only drum count, without modifying the snapshot',()=>{
  const f=fixture(),gun=f.gear(1,1,{api_houg:10}),sonar=f.gear(47,14,{api_tais:10});
  const before=JSON.stringify(f.store),evaluate=createEvaluator(f.store,1,101);
  const scheme=id=>({fleet:1,ships:[{id:1,slots:[id,-1,-1],ex:0}]});
  const a=evaluate(scheme(gun)),b=evaluate(scheme(sonar));
  assert.equal(a.checks.find(c=>c.type==='totalFirepower').left,50);
  assert.equal(b.checks.find(c=>c.type==='totalFirepower').left,40);
  assert.equal(b.checks.find(c=>c.type==='totalAsw').left,60);
  assert.deepEqual(b,evaluateExpedition(f.store,1,101,scheme(sonar)));
  assert.deepEqual(a,evaluate(scheme(gun)));assert.equal(JSON.stringify(f.store),before);
});
