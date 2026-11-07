'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {sortBases}=require('../../src/recommendation/land_base_order');

function setup(){
  const masters={11:{api_type:[0,0,47],api_sortno:20},12:{api_type:[0,0,49],api_sortno:80},
    13:{api_type:[0,0,48],api_sortno:40},14:{api_type:[0,0,47],api_sortno:10}};
  const equips=Object.fromEntries([1,2,3,4].map(id=>[id,{api_slotitem_id:id+10,api_level:0,api_alv:7}]));
  const planes=[1,2,3,4].map((id,i)=>({api_squadron_id:i+1,api_slotid:id,api_count:18-i,api_max_count:18,api_state:1}));
  const store={info:{equips,airbase:[{api_area_id:6,api_rid:1,api_plane_info:planes}]},const:{$equips:masters}};
  const bases=[{areaId:6,rid:1,slots:planes.map(row=>({slotId:row.api_squadron_id,itemId:row.api_slotid,
    count:row.api_count,maxCount:row.api_max_count,state:row.api_state,locked:false}))}];
  return {store,bases};
}
test('sort places bombers before fighters and scouts without altering the observed inventory',()=>{
  const {store,bases}=setup(),before=JSON.stringify({store,bases}),sorted=sortBases(store,bases);
  assert.deepEqual(sorted[0].slots.map(slot=>slot.itemId),[4,1,3,2]);
  assert.deepEqual(sorted[0].slots.map(slot=>slot.slotId),[1,2,3,4]);
  assert.deepEqual(sorted[0].slots.map(slot=>slot.count),[15,18,16,17]);
  assert.equal(sorted[0].slots[2].planned,false);
  assert(sorted[0].slots[0].planned&&sorted[0].slots[0].withinBase);
  assert.equal(JSON.stringify({store,bases}),before);
  assert.strictEqual(sortBases(store,sorted),sorted,'sorting is stable and idempotent');
});
test('sort keeps held slots and orders aircraft from another squadron',()=>{
  const {store,bases}=setup();bases[0].slots[1].locked=true;
  const held=sortBases(store,bases);assert.equal(held[0].slots[1].itemId,2);
  assert.deepEqual(held[0].slots.map(slot=>slot.itemId),[4,2,1,3]);
  const external=setup();external.store.info.equips[5]={api_slotitem_id:15};
  external.store.const.$equips[15]={api_type:[0,0,47],api_sortno:1};
  external.store.info.airbase.push({api_area_id:6,api_rid:2,api_plane_info:[{api_squadron_id:1,api_slotid:5,api_state:1}]});
  external.bases[0].slots[1]={...external.bases[0].slots[1],itemId:5,planned:true,withinBase:true};
  assert.equal(sortBases(external.store,external.bases)[0].slots[0].itemId,5);
});
test('an unknown plane stays in its slot and does not fabricate ownership',()=>{
  const {store,bases}=setup();delete store.const.$equips[12];
  assert.equal(sortBases(store,bases)[0].slots[1].itemId,2);
  assert.equal(sortBases(store,[{areaId:6,rid:1,slots:[{itemId:null}]}])[0].slots[0].itemId,null);
});
