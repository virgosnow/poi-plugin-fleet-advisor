'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fixture=require('../../helpers/workbench_fixture');
const {estimate}=require('../../../src/domain/combat/practice_resources');
test('day and night resupply uses per-ship rounding and marriage discount',()=>{
 const s=fixture();Object.assign(s.const.$ships[1],{api_fuel_max:17,api_bull_max:17});
 Object.assign(s.const.$ships[2],{api_fuel_max:17,api_bull_max:17});s.info.ships[2].api_lv=100;
 const r=estimate(s,{ships:[{id:1,slots:[-1,-1]},{id:2,slots:[-1,-1]}]});
 assert.equal(r.fuel,5);assert.equal(r.ammoDay,5);assert.equal(r.ammoNight,9);assert.deepEqual(r.bauxite,{min:0,max:0});
});
test('aircraft maximum is explicitly a bound and fixed equipment does not count',()=>{
 const s=fixture();s.const.$ships[1].api_maxeq=[18,4];
 s.info.equips[11]={api_slotitem_id:11};s.const.$equips[11]={api_type:[0,0,7]};
 s.info.equips[12]={api_slotitem_id:12};s.const.$equips[12]={api_type:[0,0,9]};
 const scheme={ships:[{id:1,slots:[11,12]}]},r=estimate(s,scheme);
 assert.deepEqual(r.bauxite,{min:0,max:90});assert.match(r.detail,/不代表平均值/);
 delete s.const.$ships[1].api_maxeq;assert.equal(estimate(s,scheme).bauxite,null);
});
test('jet steel cost is conditional and bounded by available stock',()=>{
 const s=fixture();s.const.$ships[1].api_maxeq=[18,0];s.info.resources=[0,0,20,0];
 s.info.equips[11]={api_slotitem_id:199};s.const.$equips[199]={api_type:[0,0,57]};
 const scheme={ships:[{id:1,slots:[11,-1]}]},r=estimate(s,scheme);
 assert.deepEqual(r.steel,{min:0,max:20});assert.equal(r.hasJets,true);
 delete s.const.$ships[1].api_maxeq;assert.equal(estimate(s,scheme).steel,null);
});
test('fighter and ASW-aircraft cannot be entirely lost to ship anti-air, and rotorcraft are counted',()=>{
 const s=fixture();s.const.$ships[1].api_maxeq=[18,18];
 s.info.equips[11]={api_slotitem_id:11};s.const.$equips[11]={api_type:[0,0,6]};
 s.info.equips[12]={api_slotitem_id:12};s.const.$equips[12]={api_type:[0,0,25]};
 const r=estimate(s,{ships:[{id:1,slots:[11,12]}]});
 assert.deepEqual(r.bauxite,{min:0,max:100});
 assert.deepEqual(r.airScenarios.find(x=>x.state==='supremacy').stageOneBauxite,{min:0,max:10});
 assert.deepEqual(r.airScenarios.find(x=>x.state==='loss').stageOneBauxite,{min:20,max:100});
});
test('special 20th Squadron ASW aircraft may also be completely lost to AA',()=>{
 for(const masterId of [489,491]){
  const s=fixture();s.const.$ships[1].api_maxeq=[18,0];
  s.info.equips[11]={api_slotitem_id:masterId};s.const.$equips[masterId]={api_type:[0,0,26]};
  const r=estimate(s,{ships:[{id:1,slots:[11,-1]}]});
  assert.deepEqual(r.bauxite,{min:0,max:90});
 }
});
test('ordinary ASW and rotary aircraft do not imply a known minimum loss',()=>{
 const s=fixture();s.const.$ships[1].api_maxeq=[60,60];
 for(const type of [25,26]){s.info.equips[type]={api_slotitem_id:type};s.const.$equips[type]={api_type:[0,0,type]};}
 const r=estimate(s,{ships:[{id:1,slots:[25,26]}]});
 assert.deepEqual(r.airScenarios.find(x=>x.state==='loss').stageOneBauxite,{min:0,max:350});
});
test('unrecognized attack-capable ASW aircraft cannot be given a narrow ceiling',()=>{
 const s=fixture();s.const.$ships[1].api_maxeq=[18,0];s.info.equips[11]={api_slotitem_id:9999};
 s.const.$equips[9999]={api_type:[0,0,26],api_baku:3};
 const r=estimate(s,{ships:[{id:1,slots:[11,-1]}]});
 assert.deepEqual(r.bauxite,{min:0,max:90});assert.equal(r.airScenarios,null);
});
test('attack aircraft stage-one estimate excludes unknown surface AA from the total ceiling',()=>{
 const s=fixture();s.const.$ships[1].api_maxeq=[18,18];
 s.info.equips[11]={api_slotitem_id:11};s.const.$equips[11]={api_type:[0,0,7]};
 s.info.equips[12]={api_slotitem_id:12};s.const.$equips[12]={api_type:[0,0,6]};
 const r=estimate(s,{ships:[{id:1,slots:[11,12]}]});
 assert.deepEqual(r.bauxite,{min:0,max:140});
 assert.deepEqual(r.airScenarios.find(x=>x.state==='supremacy').stageOneBauxite,{min:0,max:10});
 assert.match(r.detail,/不含对空迎击/);
});
test('jet losses do not use one-phase estimates and a known all-submarine opponent prevents jet steel use',()=>{
 const s=fixture();s.const.$ships[1].api_maxeq=[18,0];s.info.resources=[0,0,100,0];
 s.info.equips[11]={api_slotitem_id:199};s.const.$equips[199]={api_type:[0,0,57]};
 const scheme={ships:[{id:1,slots:[11,-1]}]},enemy={known:true,ships:[{master:{api_stype:13}},{master:{api_stype:14}}]};
 const r=estimate(s,scheme,{enemy});assert.equal(r.airScenarios,null);assert.deepEqual(r.steel,{min:0,max:0});
 assert.deepEqual(estimate(s,scheme).steel,{min:0,max:50});
});
