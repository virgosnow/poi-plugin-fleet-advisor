'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/workbench_fixture');
const {availableEquipment,emptyLoadout,completeCombatLoadout,explainLoadout}=require('../../src/recommendation/loadout/loadout_policy');
const {recommendNormalEquipment}=require('../../src/recommendation/index');
const {openingTorpedo}=require('../../src/recommendation/scoring');

function submarineFixture({slots=2,stype=13,level=69,expansion=false,torpedoes=slots}={}){
  const store=fixture(),ship=store.info.ships[1];
  ship.api_ship_id=6001;
  store.const.$ships[6001]={...store.const.$ships[1],api_id:6001,api_name:'伊201改',api_stype:stype,
    api_slot_num:slots,api_maxeq:Array(slots).fill(0)};
  Object.assign(ship,{api_lv:level,api_slot:Array(slots).fill(-1),api_slot_ex:expansion?-1:0,api_onslot:Array(slots).fill(0)});
  store.const.$shipTypes[stype]={api_equip_type:{22:1,32:1,51:1}};
  for(const [id,type,name,stats] of [
    [9001,32,'潜水艦53cm艦首魚雷(8門)',{api_raig:16}],
    [9002,22,'甲標的 甲型',{api_raig:12}],
    [9003,51,'潜水艦搭載電探＆水防式望遠鏡',{api_houm:2,api_houk:8,api_saku:4}]
  ])store.const.$equips[id]={api_id:id,api_name:name,api_type:[0,0,type,type],...stats};
  for(let n=0;n<torpedoes;n++)store.info.equips[101+n]={api_id:101+n,api_slotitem_id:9001,api_level:0};
  store.info.equips[201]={api_id:201,api_slotitem_id:9002,api_level:0};
  store.info.equips[301]={api_id:301,api_slotitem_id:9003,api_level:0};
  store.const.$exslotEquipShips[9003]={api_stypes:{13:1,14:1}};
  return store;
}
const scheme=store=>({fleet:1,ships:[{id:1,slots:store.info.ships[1].api_slot.slice(),ex:store.info.ships[1].api_slot_ex}]});
const types=(store,entry)=>entry.slots.map(id=>store.const.$equips[store.info.equips[id]?.api_slotitem_id]?.api_type[2]);
function complete(store,heldSlots=[]){
  return completeCombatLoadout(store,emptyLoadout(store,scheme(store),heldSlots),availableEquipment(store),{area:'1-1',heldSlots}).ships[0];
}

test('level 10+ SS and SSV reserve both normal slots for torpedoes, not redundant midget submarines',()=>{
  for(const stype of [13,14])for(const level of [10,69]){
    const store=submarineFixture({stype,level}),entry=complete(store);
    assert.deepEqual(types(store,entry),[32,32]);
    const ship=store.info.ships[1],master=store.const.$ships[ship.api_ship_id];
    assert.equal(openingTorpedo(store,[{id:1,ship,master,stype,level}],{ships:[entry]}).count,1);
  }
});

test('a submarine below level 10 may still use a midget submarine to unlock opening torpedoes',()=>{
  const store=submarineFixture({level:9});
  assert.deepEqual(types(store,complete(store)),[22,32]);
});

test('a third normal slot considers submarine radar only after two torpedoes',()=>{
  const store=submarineFixture({slots:3});
  assert.deepEqual(types(store,complete(store)),[32,32,51]);
});

test('submarine radar prefers an eligible expansion slot and leaves normal slots for torpedoes',()=>{
  for(const slots of [2,3]){
    const store=submarineFixture({slots,expansion:true}),entry=complete(store);
    assert.deepEqual(types(store,entry),Array(slots).fill(32));
    assert.equal(entry.ex,301);
  }
});

test('submarine radar respects expansion permissions and uses the extra normal slot instead',()=>{
  const store=submarineFixture({slots:3,expansion:true});
  store.const.$exslotEquipShips={};
  const entry=complete(store);
  assert.deepEqual(types(store,entry),[32,32,51]);assert.equal(entry.ex,-1);
});

test('missing submarine radar falls back to another torpedo; missing torpedoes do not invite a midget submarine',()=>{
  const store=submarineFixture({slots:3});delete store.info.equips[301];
  assert.deepEqual(types(store,complete(store)),[32,32,32]);
  const scarce=submarineFixture({torpedoes:1});
  assert.deepEqual(types(scarce,complete(scarce)),[32,undefined]);
});

test('manual submarine equipment and explicit empty slots are preserved without duplicating radar',()=>{
  const store=submarineFixture({slots:3,expansion:true});
  const held=[{id:1,slots:[201,-1,-1],ex:301,keep:{0:true,ex:true}}];
  const entry=complete(store,held);
  assert.deepEqual(types(store,entry),[22,32,32]);assert.equal(entry.ex,301);
  const empty=complete(store,[{id:1,slots:[-1,-1,-1],ex:-1,keep:{1:true,ex:true}}]);
  assert.equal(empty.slots[1],-1);assert.equal(empty.ex,-1);
  const radar=complete(store,[{id:1,slots:[-1,-1,301],ex:-1,keep:{2:true}}]);
  assert.deepEqual(types(store,radar),[32,32,51]);assert.equal(radar.ex,-1);
});

test('submarine loadouts share scarce inventory without assigning any equipment instance twice',()=>{
  const store=submarineFixture({slots:3,torpedoes:4});
  store.const.$ships[6002]={...store.const.$ships[6001],api_id:6002,api_name:'伊203改',api_slot_num:2,api_maxeq:[0,0]};
  store.info.ships[2]={...store.info.ships[1],api_id:2,api_ship_id:6002,api_slot:[-1,-1],api_onslot:[0,0]};
  const initial={fleet:1,ships:[...scheme(store).ships,{id:2,slots:[-1,-1],ex:-1}]};
  const result=completeCombatLoadout(store,initial,availableEquipment(store),{area:'1-1'});
  assert.deepEqual(result.ships.map(entry=>types(store,entry)),[[32,32,51],[32,32]]);
  const ids=result.ships.flatMap(entry=>entry.slots.concat(entry.ex)).filter(id=>id>0);
  assert.equal(new Set(ids).size,ids.length);
});

test('equipment recommendation repairs the reported level 69 I-201 loadout without changing the observed fleet',()=>{
  const store=submarineFixture();store.info.ships[1].api_slot=[201,101];
  const before=JSON.stringify(store);
  const result=recommendNormalEquipment(store,{scheme:scheme(store),area:'1-1'});
  assert.deepEqual(types(store,result.scheme.ships[0]),[32,32]);
  assert.equal(JSON.stringify(store),before);
});

test('equipment search retains the submarine radar policy with both standard and submarine torpedoes',()=>{
  for(const expansion of [false,true]){
    const store=submarineFixture({slots:expansion?2:3,stype:14,expansion});
    store.const.$equips[9004]={api_id:9004,api_name:'61cm四連装(酸素)魚雷',api_type:[0,0,5,5],api_raig:10};
    store.info.equips[102].api_slotitem_id=9004;store.const.$shipTypes[14].api_equip_type[5]=1;
    const entry=recommendNormalEquipment(store,{scheme:scheme(store),area:'1-1'}).scheme.ships[0];
    const fitted=types(store,entry);
    assert.equal(fitted.filter(type=>[5,32].includes(type)).length,2);
    assert.equal(fitted.includes(22),false);
    assert.equal(expansion?entry.ex:entry.slots.find(id=>id===301),301);
  }
});

test('submarine explanations distinguish inherent opening torpedoes, torpedoes and submarine radar',()=>{
  const store=submarineFixture({slots:3});
  const explanation=explainLoadout(store,{id:1,slots:[101,102,301],ex:-1},{area:'1-1'});
  assert.match(explanation.role,/潜艇.*先制雷击/);
  assert.match(explanation.rows[0].reason,/鱼雷/);
  assert.match(explanation.rows[2].reason,/潜艇电探/);
  const manual=explainLoadout(store,{id:1,slots:[201,101,102],ex:-1,keep:{0:true}},{area:'1-1'});
  assert.match(manual.rows[0].reason,/不需要甲标/);
});
