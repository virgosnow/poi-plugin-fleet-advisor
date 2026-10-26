'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {orderEquipment,orderCarrierUtility}=require('../../../src/domain/fleet/equipment_order');
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

function carrierFixture(capacities=[40,24,18,3,0]){
  const store=fixture();store.const.$ships[1].api_stype=11;
  store.const.$ships[1].api_maxeq=capacities;
  store.info.ships[1].api_onslot=capacities;
  const types=[8,7,9,6,35,4];
  store.const.$shipTypes[11]={api_equip_type:Object.fromEntries(types.map(t=>[t,1]))};
  types.forEach((type,i)=>{
    const id=200+i;store.const.$equips[id]={api_id:id,api_name:'航母装备'+id,api_type:[0,0,type,type]};
    store.info.equips[id]={api_id:id,api_slotitem_id:id};
  });
  return store;
}

test('carrier reconnaissance uses the smallest positive slot, moving its fighter into the freed larger slot',()=>{
  const store=carrierFixture(),scheme={fleet:1,ships:[{id:1,slots:[200,202,201,203,204],ex:-1}]};
  const before=JSON.stringify([store,scheme]),sorted=orderEquipment(store,scheme);
  assert.deepEqual(sorted.ships[0].slots,[200,203,201,202,204]);
  assert.equal(orderEquipment(store,sorted),sorted);
  assert.equal(JSON.stringify([store,scheme]),before);
  const held=orderEquipment(store,scheme,[{id:1,keep:{3:true}}]);
  assert.equal(held.ships[0].slots[3],203);
  assert.equal(held.ships[0].slots[2],202,'the next-smallest free positive slot takes reconnaissance');
});

test('carrier fixed firepower equipment uses small or zero slots while planes retain positive capacity',()=>{
  const store=carrierFixture(),scheme={fleet:1,ships:[{id:1,slots:[200,201,204,203,205],ex:-1}]};
  const sorted=orderEquipment(store,scheme);
  assert.deepEqual(sorted.ships[0].slots,[200,201,203,204,205]);
  const zero=carrierFixture([40,24,18,0]);
  const fitted=orderCarrierUtility(zero,{fleet:1,ships:[{id:1,slots:[200,201,202,204],ex:-1}]});
  assert.equal(fitted.ships[0].slots[2],202);assert.equal(fitted.ships[0].slots[3],204);
});

test('carrier utility ordering does not create an automatic gap when a later empty slot would compact',()=>{
  const store=carrierFixture(),scheme={fleet:1,ships:[{id:1,slots:[204,200,201,-1,-1],ex:-1}]};
  const sorted=orderCarrierUtility(store,scheme);
  assert(sorted.ships[0].slots.slice(0,3).every(id=>id>0));
  assert.deepEqual(sorted.ships[0].slots.slice(3),[-1,-1]);
});

test('light-carrier firepower utility uses the smaller slot, or the later slot on a capacity tie',()=>{
  for(const capacities of [[14,19,4,2],[14,19,2,2]]){
    const store=carrierFixture(capacities),scheme={fleet:1,ships:[{id:1,slots:[201,200,204,203],ex:-1}]};
    const before=JSON.stringify([store,scheme]),fitted=orderCarrierUtility(store,scheme);
    assert.deepEqual(fitted.ships[0].slots,[201,200,203,204]);
    assert.equal(orderCarrierUtility(store,fitted),fitted);
    assert.equal(JSON.stringify([store,scheme]),before);
    for(const k of [2,3]){
      assert.equal(orderCarrierUtility(store,scheme,[{id:1,keep:{[k]:true}}]),scheme);
    }
  }
});
