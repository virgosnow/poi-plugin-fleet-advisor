'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../../../src/domain/fleet/equipment_rules'),{createEquipmentPlanner}=require('../../../src/domain/fleet/equipment_planner');
const rules=require('../../../data/equipment_rules.json');
function state(){return {info:{fleets:[{api_ship:[1],api_mission:[0]}],ships:{1:{api_ship_id:100,api_slot:[-1,-1,-1,-1,-1],api_slot_ex:-1}},equips:{}},const:{$ships:{100:{api_stype:2,api_ctype:47,api_slot_num:5}},$shipTypes:{2:{api_equip_type:Object.fromEntries(Array.from({length:100},(_,i)=>[i,1]))}},$equipShip:{},$equips:{},$exslotEquips:[21,23,27,28,36,39,43,44],$exslotEquipShips:{},$exslotEquipLimits:{}}};}
function item(s,id,type,icon=type,star=0){s.info.equips[id]={api_id:id,api_slotitem_id:id,api_level:star};s.const.$equips[id]={api_id:id,api_name:'item'+id,api_type:[0,0,type,icon]};}
test('all 14 specific picker categories and uncategorized types have an installation route',()=>{
  const s=state(),p=createEquipmentPlanner(()=>s),samples=[[6,6],[7,7],[10,10],[3,3],[18,12],[4,4],[5,5],[14,18],[12,11],[24,20],[23,14],[47,37],[17,19],[29,24]];
  samples.forEach(([type,icon],i)=>{const id=1000+i;item(s,id,type,icon);assert.equal(p.categoryFor(id).id,i+1);assert.equal(p.freePickerList(i+1,1,0).find(x=>x.id===id)?.id,id);assert(!p.resolvePlan({fleet:1,ships:[{id:1,slots:[id]}]}).done);});
  item(s,2000,99,99);assert.equal(p.categoryFor(2000).id,0);assert(p.freePickerList(0,1,0).some(x=>x.id===2000));
});
test('night aircraft and high-angle guns use derived filter types, radar never joins the waterplane category',()=>{
  const s=state(),p=createEquipmentPlanner(()=>s);
  for(const [id,type,icon,category] of [[201,6,45,1],[202,7,58,2],[203,8,46,2],[204,10,50,3],[205,1,16,6],[206,12,11,9]]){
    item(s,id,type,icon);assert.equal(p.categoryFor(id).id,category);
  }
  assert(!p.freePickerList(3,1,0).some(x=>x.id===206));
});
test('special 51cm guns and rangefinder radar use the game sorting and permission types',()=>{
  const s=state();item(s,128,3,3);item(s,142,13,11);item(s,467,4,16);item(s,900,3,3);
  const p=createEquipmentPlanner(()=>s);assert.deepEqual(p.freeListAll().map(x=>x.id),[900,467,128,142]);
  delete s.const.$shipTypes[2].api_equip_type[38];assert(!p.canEquip(1,128,0));assert(p.canEquip(1,900,0));
  delete s.const.$shipTypes[2].api_equip_type[95];assert(!p.canEquip(1,467,0));
});
test('slot-specific exclusions participate in assignment and picker positions before clearing',()=>{
  const s=state();s.info.ships[1].api_ship_id=553;s.const.$ships[553]={api_stype:2,api_slot_num:5};item(s,1001,3,3);item(s,1002,10,10);
  const p=createEquipmentPlanner(()=>s);assert(p.canEquip(1,1001,1));assert(!p.canEquip(1,1001,2));assert.deepEqual(p.freePickerList(0,1,2).map(x=>x.id),[1002]);
  assert.throws(()=>p.resolvePlan({fleet:1,ships:[{id:1,slots:[1002,'empty',1001]}]}),/无可用装备/);
});
test('expansion eligibility covers by-type rules, ship exclusions, class overrides and improvement requirements',()=>{
  const s=state();item(s,1,21,15);item(s,124,17,19,6);item(s,3,3,3);
  s.const.$exslotEquipShips[124]={api_ctypes:{47:1},api_req_level:7};const p=createEquipmentPlanner(()=>s);
  assert(p.canEquip(1,1,'ex'));assert(!p.canEquip(1,3,'ex'));assert(!p.canEquip(1,124,'ex'));
  s.info.equips[124].api_level=7;assert(p.canEquip(1,124,'ex'));
  s.const.$exslotEquipLimits[100]=[21];assert(!p.canEquip(1,1,'ex'));
  s.const.$exslotEquipShips[1]={api_stypes:{99:1}};assert(p.canEquip(1,1,'ex'));
  delete s.const.$shipTypes[2].api_equip_type[21];assert(!p.canEquip(1,1,'ex'));
  assert.throws(()=>p.resolvePlan({fleet:1,ships:[{id:1,ex:3}]}),/无可用装备/);
});
test('expansion lists filter eligibility before pagination and reject missing master rules',()=>{
  const s=state();for(let i=1;i<=30;i++)item(s,i,3,3);item(s,31,21,15);
  const p=createEquipmentPlanner(()=>s);assert.deepEqual(p.freePickerList(0,1,'ex').map(x=>x.id),[31]);
  delete s.const.$exslotEquipShips;assert.throws(()=>p.resolvePlan({fleet:1,ships:[{id:1,ex:31}]}),/eligibility data missing/);
});
test('the supplied live selector tables override the bundled fallback',()=>{
  const s=state();item(s,800,3,3);s.selectorTables={...rules,equipTypeSpOverrides:{800:93}};
  const p=createEquipmentPlanner(()=>s);assert.equal(p.categoryFor(800).id,9);assert.equal(p.freeListAll()[0].t2,93);
});
