'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {gearShortlist,reserveForRoutes}=require('../../src/recommendation/gear_shortlist');
const routes=[{key:'upper'},{key:'lower'}];
const seeds=()=>Array.from({length:100},(_,i)=>({id:i,profile:{},rank:100-i,hull:100-i,air:0,
  scores:{strengthProxy:100-i,groundAttack:{bonus:0},specialAttack:{bonus:0},aswCombat:{readiness:0},openingTorpedoProxy:0}}));
const options={routes,key:r=>r.id,rank:r=>r.rank,scores:r=>r.scores,hullPower:r=>r.hull,airPotential:r=>r.air};
test('route shortlist preserves complementary combat roles instead of retaining only current outfit ranks',()=>{
  const rows=seeds();
  rows[90].hull=1000;rows[91].air=1000;rows[92].scores.groundAttack.bonus=1000;
  rows[93].scores.specialAttack.bonus=1000;rows[94].scores.aswCombat.readiness=1;
  rows[95].scores.openingTorpedoProxy=1000;rows[96].scores.strengthProxy=1000;
  rows[97].profile.counts={night:{maximum:1}};rows[97].scores.nightStrengthProxy=1000;
  const before=JSON.stringify(rows),result=gearShortlist(rows,{...options,protectedKeys:new Set([99])});
  for(const id of [0,1,2,3,4,5,90,91,92,93,94,95,96,97,99])assert(result.primary.some(r=>r.id===id),String(id));
  assert(result.reserve.length>60);assert.equal(result.primary.length+result.reserve.length,rows.length);
  assert.deepEqual(result.primary.map(r=>r.id),result.primary.map(r=>r.id).sort((a,b)=>a-b));
  assert.equal(JSON.stringify(rows),before);
});
test('shortlist keeps each route covered, and restores only the reserve relevant to failing routes',()=>{
  const rows=seeds(),rank=(r,o)=>r.id%2===(o.key==='upper'?0:1)?r.rank:-Infinity;
  const result=gearShortlist(rows,{...options,rank});
  for(const route of routes)assert(result.primary.filter(r=>Number.isFinite(rank(r,route))).length>=6);
  const restored=reserveForRoutes(result,[routes[1]],options.key);
  assert(restored.length>0);assert(restored.every(r=>r.id%2===1));
  assert.deepEqual(reserveForRoutes(result,[],options.key),[]);
  assert.deepEqual(reserveForRoutes(result,routes,options.key),result.reserve);
});
test('small or legacy searches remain unchanged and incomplete scores do not invent a leading candidate',()=>{
  const rows=seeds();
  for(const opts of [{enabled:false},{routes:[]}]){
    const result=gearShortlist(rows,{...options,...opts});assert.equal(result.primary,rows);assert.deepEqual(result.reserve,[]);
  }
  assert.equal(gearShortlist(rows.slice(0,20),options).primary.length,20);
  rows[99].hull=NaN;rows[99].scores.strengthProxy=undefined;rows[99].air=Infinity;
  const result=gearShortlist(rows,options);assert(result.reserve.includes(rows[99]));
  assert.deepEqual(gearShortlist(rows,options),result);
});

test('a first wave without enough aircraft expands the original reserve and preserves manual ships and slots',()=>{
  const store=require('../helpers/workbench_fixture')(),{recommendNormalFleet}=require('../../src/recommendation/normal');
  store.const.$equips[500]={api_id:500,api_name:'测试保留主炮',api_type:[0,0,1,1],api_houg:5};
  store.info.equips[1001]={api_id:1001,api_slotitem_id:500,api_level:0};
  store.const.$shipTypes[2]={api_equip_type:{1:1}};store.info.ships[2].api_slot=[1001,-1];
  const held={id:2,slots:[1001,-1],ex:0,keep:{0:true},holdPosition:true},before=JSON.stringify(store);
  const result=recommendNormalFleet(store,{area:'1-4',byRoute:true,airGoal:'superiority',fixedShipIds:[2],heldSlots:[held]});
  const p=result.search.gearPruning;assert(p.deferred>0);assert.equal(p.expanded,p.deferred);
  assert(result.recommendations.length>0);
  for(const row of result.recommendations){
    assert.equal(row.scheme.ships[0].id,2);assert.equal(row.scheme.ships[0].slots[0],1001);
    const ids=row.scheme.ships.flatMap(s=>s.slots.concat(s.ex)).filter(id=>id>0);
    assert.equal(ids.length,new Set(ids).size);
    new (require('../../src/application/controller').Controller)({getStore:()=>store}).preview('fleet',row.scheme);
  }
  assert.equal(JSON.stringify(store),before);
});
