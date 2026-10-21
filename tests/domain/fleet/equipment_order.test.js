'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {orderEquipment}=require('../../../src/domain/fleet/equipment_order');
const {canEquip}=require('../../../src/domain/fleet/equipment_rules');
function fixture(){
  const store=require('../../helpers/workbench_fixture')();
  const types=[12,14,2,2,22,11,30,17];
  types.forEach((type,i)=>{
    const id=100+i;store.const.$equips[id]={api_id:id,api_name:'装备'+id,api_type:[0,0,type,type]};
    store.info.equips[id]={api_id:id,api_slotitem_id:id};
  });
  store.const.$shipTypes[3]={api_equip_type:Object.fromEntries(types.map(type=>[type,1]))};
  store.const.$ships[1].api_slot_num=5;store.info.ships[1].api_slot=[-1,-1,-1,-1,-1];
  return store;
}
test('automatic ordinary equipment uses stable category order and preserves instances/expansion without mutating inputs',()=>{
  const store=fixture(),scheme={fleet:1,ships:[{id:1,slots:[100,101,103,102,104],ex:107}]};
  const before=JSON.stringify([store,scheme]),sorted=orderEquipment(store,scheme);
  assert.deepEqual(sorted.ships[0].slots,[103,102,104,101,100]);
  assert.equal(sorted.ships[0].ex,107);
  assert.equal(JSON.stringify([store,scheme]),before);
  assert.equal(orderEquipment(store,sorted),sorted,'already ordered schemes are reused');
});
test('aircraft, held items and explicitly held empty slots remain at their exact positions',()=>{
  const store=fixture(),scheme={fleet:1,ships:[{id:1,slots:[100,-1,105,102,101],ex:107}]};
  const sorted=orderEquipment(store,scheme,[{id:1,keep:{1:true,4:true}}]);
  assert.deepEqual(sorted.ships[0].slots,[102,-1,105,100,101]);
  assert.equal(sorted.ships[0].ex,107);
});
test('Yubari five-slot restrictions take precedence over global category order',()=>{
  const store=fixture();store.const.$ships[623]={...store.const.$ships[1],api_id:623};store.info.ships[1].api_ship_id=623;
  const scheme={fleet:1,ships:[{id:1,slots:[101,104,102,107,100],ex:0}]};
  const sorted=orderEquipment(store,scheme);
  assert.deepEqual(sorted.ships[0].slots,[102,104,101,107,100]);
  sorted.ships[0].slots.forEach((id,k)=>assert(canEquip(store,1,id,k)));
});
