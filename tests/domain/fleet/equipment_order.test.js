'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {orderEquipment,orderCarrierUtility,orderAircraftSlots}=require('../../../src/domain/fleet/equipment_order');
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

function waterFighterFixture(stype=9){
  const store=fixture(),ship=store.info.ships[1],mid=90001;
  store.const.$ships[mid]={...store.const.$ships[1],api_id:mid,api_name:'搭载槽测试舰',api_stype:stype,api_maxeq:[2,2,8,22,2]};
  Object.assign(ship,{api_ship_id:mid,api_slot:[301,302,303,304,305],api_onslot:[2,2,8,22,2]});
  store.const.$shipTypes[stype]={api_equip_type:{45:1,3:1,11:1,19:1}};
  for(const [id,t,stats]of [[301,45,{api_tyku:5}],[302,3,{api_houg:20}],[303,3,{api_houg:20}],
    [304,11,{api_baku:10,api_tyku:1}],[305,19,{api_houg:9}]]){
    store.const.$equips[id]={api_id:id,api_name:'测试装备'+id,api_type:[0,0,t,t],...stats};
    store.info.equips[id]={api_id:id,api_slotitem_id:id,api_alv:7};
  }
  return {store,scheme:{fleet:1,ships:[{id:1,slots:ship.api_slot.slice(),ex:107}]}};
}

test('same-instance slot optimization gives water fighters eight planes and keeps the bomber in 22 across hull types',()=>{
  const {airPower}=require('../../../src/domain/fleet/fleet_metrics');
  for(const stype of [3,5,6,9,10,16]){
    const {store,scheme}=waterFighterFixture(stype),before=JSON.stringify([store,scheme]);
    const fitted=orderEquipment(store,scheme),entry=fitted.ships[0];
    assert.equal(entry.slots[2],301,'water fighter moves from two to eight planes');
    assert.equal(entry.slots[3],304,'22-plane bomber stays at full capacity');
    assert.deepEqual(entry.slots.slice().sort(),scheme.ships[0].slots.slice().sort());
    assert.equal(entry.ex,107);
    for(const [k,id]of entry.slots.entries())assert(canEquip(store,1,id,k));
    const air=s=>airPower(store,[{id:1,ship:store.info.ships[1],master:store.const.$ships[90001],
      before:{slots:store.info.ships[1].api_slot,ex:0},after:s.ships[0]}]);
    assert(air(fitted).min>air(scheme).min,'actual air power is recomputed from the new slots');
    assert.equal(orderEquipment(store,fitted),fitted);
    assert.equal(JSON.stringify([store,scheme]),before);
  }
});

test('aircraft slot optimization respects held items, held empty slots, expansion and slot restrictions',()=>{
  const {store,scheme}=waterFighterFixture();
  for(const keep of [{0:true},{2:true}])assert.equal(orderAircraftSlots(store,scheme,[{id:1,keep}]),scheme);
  const empty={...scheme,ships:[{...scheme.ships[0],slots:[301,302,-1,304,305]}]};
  assert.equal(orderAircraftSlots(store,empty,[{id:1,keep:{2:true}}]),empty);
  const restricted=structuredClone(store);
  restricted.selectorTables=structuredClone(require('../../../data/equipment_rules.json'));
  restricted.selectorTables.slotExclusions.push({shipMstIds:[90001],slot:2,allowOnly:[3]});
  assert.equal(orderAircraftSlots(restricted,scheme),scheme,'a larger but incompatible slot is not used');
});

test('slot optimization never takes capacity from another aircraft or removes carrier first-slot strike proficiency',()=>{
  const {store}=waterFighterFixture(),allAircraft={fleet:1,ships:[{id:1,slots:[301,302,303,304,305],ex:107}]};
  store.const.$ships[90001].api_maxeq=[2,2,2,22,0];store.info.ships[1].api_onslot=[2,2,2,22,0];
  assert.equal(orderAircraftSlots(store,allAircraft),allAircraft,'fighter cannot steal the bomber slot');
  const cv=carrierFixture([14,26,8,4]),scheme={fleet:1,ships:[{id:1,slots:[200,204,201,203],ex:-1}]};
  assert.equal(orderAircraftSlots(cv,scheme).ships[0].slots[0],200,'first-slot strike remains first');
});

test('slot-order reuse is scoped to an immutable search and never leaks into later live validation',()=>{
  const {withEquipmentIndexCache}=require('../../../src/domain/fleet/equipment_planner');
  const {store,scheme}=waterFighterFixture();
  withEquipmentIndexCache(store,()=>{
    assert.equal(orderAircraftSlots(store,scheme).ships[0].slots[2],301);
    assert.equal(orderAircraftSlots(store,scheme).ships[0].slots[2],301);
  });
  store.const.$ships[90001].api_maxeq=[2,2,2,22,0];
  store.info.ships[1].api_onslot=[2,2,2,22,0];
  assert.equal(orderAircraftSlots(store,scheme),scheme);
});
