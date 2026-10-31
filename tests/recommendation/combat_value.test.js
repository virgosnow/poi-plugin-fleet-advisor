'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/workbench_fixture');
const value=require('../../src/recommendation/loadout/combat_value');
const {availableEquipment,emptyLoadout,completeCombatLoadout}=require('../../src/recommendation/loadout/loadout_policy');
const {withEquipmentIndexCache}=require('../../src/domain/fleet/equipment_planner');
const {canEquip}=require('../../src/domain/fleet/equipment_rules');
const {fleetAntiAir}=require('../../src/domain/combat/anti_air_cutin');
const {plannedCombatStat}=require('../../src/recommendation/scoring');
const {auxiliaryVariants}=require('../../src/recommendation/loadout/auxiliary_refinement');
function combatFixture(name='初月改二',masterId=968){
  const store=fixture(),ship=store.info.ships[1];
  Object.assign(store.const.$ships[masterId]={...store.const.$ships[1]},
    {api_id:masterId,api_name:name,api_ctype:54,api_stype:2,api_aftershipid:'0',api_slot_num:4,api_maxeq:[0,0,0,0]});
  Object.assign(ship,{api_ship_id:masterId,api_slot:[101,102,103,104],api_slot_ex:105,api_onslot:[0,0,0,0],
    api_karyoku:[80,80],api_raisou:[82,82],api_taiku:[133,133],api_soukou:[57,57]});
  const gear=(id,type,icon,name,stats,instances)=>{
    store.const.$equips[id]={api_id:id,api_name:name,api_type:[0,0,type,icon],api_houg:0,api_houm:0,api_raig:0,api_tyku:0,api_saku:0,...stats};
    for(const iid of instances)store.info.equips[iid]={api_id:iid,api_slotitem_id:id,api_level:0};
  };
  gear(147,1,1,'120mm/50 連装砲',{api_houg:3,api_houm:1,api_tyku:2},[101,102,111,112]);
  gear(122,1,16,'10cm連装高角砲+高射装置',{api_houg:3,api_houm:1,api_tyku:10,api_houk:1},[201,202,203,204]);
  gear(124,13,11,'FuMO25 レーダー',{api_houg:3,api_houm:10,api_tyku:7,api_saku:9},[103,113,114]);
  gear(240,12,11,'22号対水上電探改四(後期調整型)',{api_houg:1,api_houm:9,api_saku:7},[104,115,116]);
  gear(106,12,11,'13号対空電探改',{api_houm:2,api_tyku:4,api_saku:4,api_houk:1},[105,117,118]);
  gear(173,21,15,'Bofors 40mm四連装機関砲',{api_houg:1,api_houm:1,api_tyku:10,api_houk:2},[301,302,303,304]);
  gear(129,39,32,'熟練見張員',{api_houm:2,api_tyku:1,api_saku:2,api_houk:3},[401,402,403]);
  store.const.$shipTypes[2]={api_equip_type:{1:1,12:1,13:1,21:1,39:1}};
  store.const.$exslotEquips=[21,39];store.const.$exslotEquipShips[106]={api_ctypes:{54:1}};
  return store;
}
const outfit=store=>({id:1,slots:store.info.ships[1].api_slot.slice(),ex:store.info.ships[1].api_slot_ex});
const highOutfit=store=>({...outfit(store),slots:[201,202,103,104]});
const airProfile={counts:{surface:{maximum:1},air:{maximum:1},asw:{maximum:0}}};
const reference={nodes:[{id:'B',kind:'battle',enemyAirPower:20}]};

test('planned combat stats include the complete blue combination and subtract worn blue when removing it',()=>{
  const store=combatFixture(),before=JSON.stringify(store),high=highOutfit(store);
  const read=value.plannedStats(store,high);assert.equal(read.firePower,84);assert.equal(read.antiAir,153);assert(read.known);
  const row={id:1,ship:store.info.ships[1]};
  assert.equal(plannedCombatStat(store,row,{ships:[high]},'api_karyoku','api_houg'),84);
  // The live panel now includes those same old blue bonuses. Replacing them
  // must restore the old raw outfit, not leave the +4 on the naked hull.
  store.info.ships[1].api_slot=high.slots.slice();store.info.ships[1].api_karyoku=[84,84];store.info.ships[1].api_taiku=[153,153];
  const restored=value.plannedStats(store,{id:1,slots:[101,102,103,104],ex:105});
  assert.equal(restored.firePower,80);assert.equal(restored.antiAir,133);
  assert.notEqual(JSON.stringify(store),before);
});

test('bare hull sampling removes worn radar-dependent torpedo and fire blue bonuses',()=>{
  const store=combatFixture('長波改二',543);store.const.$ships[543].api_ctype=38;
  store.const.$equips[267]={api_id:267,api_name:'12.7cm連装砲D型改二',api_type:[0,0,1,1],api_houg:3};
  for(const id of [101,102])store.info.equips[id].api_slotitem_id=267;
  store.info.ships[1].api_karyoku=[89,89];store.info.ships[1].api_raisou=[88,88];
  const stats=value.plannedStats(store,{id:1,slots:[],ex:-1});
  assert.equal(stats.firePower,70);assert.equal(stats.torpedo,82);
});

test('full fleet AA score uses the same mutually exclusive CI rates as badges, with diminishing duplicate coverage',()=>{
  const store=combatFixture(),entry=highOutfit(store),s={ships:[entry]};
  const aa=value.antiAirScore(store,s,airProfile,reference),expected=fleetAntiAir([value.targetFor(store,entry)]);
  assert(aa.value>0);assert.equal(aa.rate,expected.total);assert(aa.known);
  assert.equal(value.antiAirScore(store,{ships:[outfit(store)]},airProfile,reference).value,0);
  store.info.ships[2]={...store.info.ships[1],api_id:2};
  const double=value.antiAirScore(store,{ships:[entry,{...entry,id:2,slots:[203,204,113,115],ex:117}]},airProfile,reference);
  assert(double.value>aa.value);assert(double.value<aa.value*2);
  assert.equal(value.antiAirScore(store,s,airProfile,{nodes:[{id:'B',kind:'battle',enemyAirPower:0}]}).value,0);
});

test('generic initial fill prefers blue/high-angle utility to an old-instance tie and does not blindly fill three radars',()=>{
  // Two different hull identities, no special-case loadout code for Hatsuzuki.
  for(const [name,id]of [['初月改二',968],['秋月改二',963]]){
    const store=combatFixture(name,id),before=JSON.stringify(store);
    const result=withEquipmentIndexCache(store,()=>completeCombatLoadout(store,
      emptyLoadout(store,{fleet:1,ships:[outfit(store)]}),availableEquipment(store),{area:'1-4',profile:airProfile}));
    const entry=result.ships[0],gear=[...entry.slots,entry.ex].filter(id=>id>0).map(id=>store.const.$equips[store.info.equips[id].api_slotitem_id]);
    assert.equal(entry.slots.filter(id=>store.info.equips[id]?.api_slotitem_id===122).length,2);
    assert(gear.filter(m=>[12,13,93].includes(m.api_type[2])).length<3);
    assert(value.antiAirScore(store,result,airProfile,reference).value>0);
    for(const [slot,id]of entry.slots.map((id,k)=>[k,id]).concat([['ex',entry.ex]]))if(id>0)assert(canEquip(store,1,id,slot));
    assert.equal(JSON.stringify(store),before);
  }
});

test('manual guns, radar and explicitly empty slots survive the new ranking; assigned inventory remains unique',()=>{
  const store=combatFixture(),lock={...outfit(store),keep:{0:true,3:true,ex:true}},before=JSON.stringify(store);
  lock.slots[3]=-1;lock.ex=105;
  const result=withEquipmentIndexCache(store,()=>completeCombatLoadout(store,
    emptyLoadout(store,{fleet:1,ships:[outfit(store)]},[lock]),availableEquipment(store),{area:'1-4',profile:airProfile,heldSlots:[lock]}));
  const e=result.ships[0];assert.equal(e.slots[0],101);assert.equal(e.slots[3],-1);assert.equal(e.ex,105);
  const ids=[...e.slots,e.ex].filter(id=>id>0);assert.equal(new Set(ids).size,ids.length);assert.equal(JSON.stringify(store),before);
});

test('blue/CI caches share numerical effects, not instance allocations or results between snapshots',()=>{
  const store=combatFixture();
  withEquipmentIndexCache(store,()=>{
    const a=highOutfit(store),b={...a,slots:[203,204,103,104]};
    assert.deepEqual(value.plannedStats(store,a),value.plannedStats(store,b));
    assert.equal(value.antiAirScore(store,{ships:[a]},airProfile,reference).rate,value.antiAirScore(store,{ships:[b]},airProfile,reference).rate);
    const inventory=availableEquipment(store),result=completeCombatLoadout(store,emptyLoadout(store,{fleet:1,ships:[a]}),inventory,{area:'1-4',profile:airProfile});
    assert.equal(new Set(result.ships.flatMap(s=>[...s.slots,s.ex]).filter(id=>id>0)).size,5);
  });
  store.info.ships[1].api_karyoku=[90,90];assert.equal(value.plannedStats(store,highOutfit(store)).firePower,94);
});

test('missing blue coverage is labelled and does not discard a usable manual outfit',()=>{
  const store=combatFixture();store.const.$equips[9999]={api_id:9999,api_name:'未收录电探',api_type:[0,0,12,11],api_houg:2};
  store.info.equips[777]={api_slotitem_id:9999,api_level:0};
  const reading=value.plannedStats(store,{id:1,slots:[101,102,777,104],ex:105});
  assert.equal(reading.known,false);assert(reading.reasons.some(r=>/蓝字/.test(r)));assert(Number.isFinite(reading.firePower));
});

test('numerical grouping never bypasses instance ownership or the stricter other-ship slot filter',()=>{
  const store=combatFixture(),base=require('../../data/equipment_rules.json');
  store.selectorTables={...base,pickerTypeOverrides:{...base.pickerTypeOverrides,122:2},
    slotExclusions:[{shipMstIds:[968],slot:0,exclude:[1]}]};
  store.const.$shipTypes[2].api_equip_type[2]=1;
  const items=[{id:201,sourceShipId:1,master:store.const.$equips[122]},
    {id:202,sourceShipId:2,master:store.const.$equips[122]}];
  assert(canEquip(store,1,201,0));assert(canEquip(store,1,202,0));
  const ranked=withEquipmentIndexCache(store,()=>value.rankGuns(store,{id:1,slots:[-1,-1,-1,-1],ex:-1},items,0,1));
  assert.deepEqual(ranked.map(i=>i.id),[201]);
});

test('auxiliary ranking preserves per-item scores when outfit radar and anti-air roles change',()=>{
  const store=combatFixture(),options={air:1,los:true,auxiliary:true};
  const items=[103,104,105,301,401].map(id=>({id,sourceShipId:null,
    master:store.const.$equips[store.info.equips[id].api_slotitem_id]}));
  const entry={id:1,slots:[-1,-1,-1,-1],ex:-1};
  const expected=()=>items.filter(item=>canEquip(store,entry.id,item.id,1))
    .map(item=>({item,score:value.equipmentValue(store,entry,item,1,options)})).filter(row=>row.score>0)
    .sort((a,b)=>b.score-a.score||a.item.id-b.item.id).map(row=>row.item);
  withEquipmentIndexCache(store,()=>{
    assert.deepEqual(value.rankEquipment(store,entry,items,1,options),expected());
    entry.slots[0]=201;
    assert.deepEqual(value.rankEquipment(store,entry,items,1,options),expected());
    entry.slots[2]=103;
    assert.deepEqual(value.rankEquipment(store,entry,items,1,options),expected());
  });
});

function auxiliaryFixture(name='初月改二',id=968){
  const store=combatFixture(name,id);
  store.const.$equips[410]={api_id:410,api_name:'21号対空電探改二',api_type:[0,0,13,11],api_tyku:7,api_saku:7,api_houm:4,api_houk:4};
  store.info.equips[601]={api_slotitem_id:410,api_level:0};
  store.const.$equips[121]={api_id:121,api_name:'94式高射装置',api_type:[0,0,36,30],api_tyku:3,api_houk:1};
  store.info.equips[501]={api_slotitem_id:121,api_level:0};
  store.const.$shipTypes[2].api_equip_type[36]=1;store.const.$exslotEquips.push(36);
  return {store,scheme:{fleet:1,ships:[{id:1,slots:[201,202,601,401],ex:105}]}};
}
test('bounded auxiliary proposals remove redundant radar roles on different hulls without dropping the CI or main guns',()=>{
  for(const [name,id]of [['初月改二',968],['秋月改二',963]]){
    const {store,scheme}=auxiliaryFixture(name,id),before=JSON.stringify([store,scheme]);
    const choices=withEquipmentIndexCache(store,()=>auxiliaryVariants(store,scheme,availableEquipment(store),{profile:airProfile}));
    assert(choices.length>0&&choices.length<=6);
    assert(choices.some(c=>[...c.scheme.ships[0].slots,c.scheme.ships[0].ex].filter(id=>
      [12,13,93].includes(store.const.$equips[store.info.equips[id]?.api_slotitem_id]?.api_type[2])).length===1));
    for(const c of choices){
      assert.deepEqual(c.scheme.ships[0].slots.slice(0,2),[201,202]);
      const a=fleetAntiAir([value.targetFor(store,scheme.ships[0])]),b=fleetAntiAir([value.targetFor(store,c.scheme.ships[0])]);
      assert(b.total>=a.total);assert.equal(new Set(c.scheme.ships.flatMap(e=>[...e.slots,e.ex]).filter(id=>id>0)).size,5);
    }
    assert.equal(JSON.stringify([store,scheme]),before);
  }
});
test('auxiliary slot reassignment respects fixed gear, explicit empty slots, inventory owners and trial limit',()=>{
  const {store,scheme}=auxiliaryFixture(),entry=scheme.ships[0],inventory=availableEquipment(store);
  const fixed={...entry,keep:{2:true,3:true}};
  const choices=withEquipmentIndexCache(store,()=>auxiliaryVariants(store,scheme,inventory,{profile:airProfile,heldSlots:[fixed],limit:100}));
  assert(choices.length>0&&choices.length<=6);
  for(const c of choices){assert.equal(c.scheme.ships[0].slots[2],601);assert.equal(c.scheme.ships[0].slots[3],401);}
  assert.deepEqual(auxiliaryVariants(store,scheme,inventory,{profile:airProfile,heldSlots:[{...entry,keep:{0:true,1:true,2:true,3:true,ex:true}}]}),[]);
  const other={id:2,slots:[501,-1],ex:0},occupied={...scheme,ships:[entry,other]};
  for(const c of auxiliaryVariants(store,occupied,inventory,{profile:airProfile,limit:2})){
    assert(!c.scheme.ships[0].slots.includes(501));assert.notEqual(c.scheme.ships[0].ex,501);
  }
});
test('route and combat scoring share immutable projections without retaining mutable fitting arrays',()=>{
  const store=combatFixture(),metrics=require('../../src/domain/fleet/fleet_metrics');
  withEquipmentIndexCache(store,()=>{
    const state={slots:[201,202,103,104],ex:105};
    const projected=metrics.projectFleet(store,{organization:{targets:[1]},equipment:{expected:[{shipId:1,state}]}})[0];
    assert.equal(projected,value.targetFor(store,{id:1,...state}));
    state.slots[0]=101;
    assert.equal(projected.after.slots[0],201);assert.equal(projected.items[0].id,201);
    assert.equal(value.targetFor(store,{id:1,slots:[201,202,103,104],ex:105}),projected);
    assert.notEqual(value.targetFor(store,{id:1,...state}),projected);
  });
});

test('auxiliary refinement leaves protected combat roles and manual empty slots untouched',()=>{
  const {store,scheme}=auxiliaryFixture(),entry=scheme.ships[0];
  store.const.$equips[999]={api_id:999,api_name:'测试保留装备',api_type:[0,0,33,0]};
  store.info.equips[901]={api_slotitem_id:999,api_level:0};
  const held={...entry,slots:[201,202,601,-1],keep:{3:true}};
  for(const c of auxiliaryVariants(store,{...scheme,ships:[held]},availableEquipment(store),{profile:airProfile,heldSlots:[held]})){
    assert.equal(c.scheme.ships[0].slots[3],-1);
  }
  // Propulsion in the expansion is outside the auxiliary role search; it
  // cannot be displaced even if a machine gun would improve the proxy score.
  assert.deepEqual(auxiliaryVariants(store,{...scheme,ships:[{...entry,ex:901}]},availableEquipment(store),{profile:airProfile}),[]);
  for(const t of [7,14,22,24,30,42,54]){
    store.const.$equips[999].api_type[2]=t;
    const source={...entry,slots:[201,202,901,401]};
    for(const c of auxiliaryVariants(store,{...scheme,ships:[source]},availableEquipment(store),{profile:airProfile})){
      assert.equal(c.scheme.ships[0].slots[2],901);
    }
  }
});
