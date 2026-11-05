'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {planLandBases}=require('../../../src/domain/fleet/land_base_execution_plan');
function fixture(){
  const store={airbaseSync:{complete:true,relocationsComplete:true},info:{ships:{},equips:{1:{api_slotitem_id:1},2:{api_slotitem_id:1},3:{api_slotitem_id:1}},
    airbase:[{api_area_id:6,api_rid:1,api_action_kind:0,api_plane_info:[1,2,3,4].map((n,i)=>({api_squadron_id:n,api_slotid:i===0?1:i===1?2:0,api_state:i<2?1:0}))}]},
    const:{$equips:{1:{api_type:[0,0,47]}}}};
  const base={areaId:6,rid:1,mode:1,modePlanned:true,slots:[2,1,3,0].map((itemId,i)=>({slotId:i+1,itemId}))};
  return {store,options:{area:'6-5',bases:[base]}};
}
test('plan preserves unchanged slots and uses a same-base swap before a stock assignment',()=>{
 const {store,options}=fixture(),before=JSON.stringify(store),plan=planLandBases(store,options);
 assert.deepEqual(plan.bases[0].operations,[{kind:'swap',slotId:1,sourceSlotId:2,itemId:2},{kind:'set',slotId:3,itemId:3,previousId:0}]);
 assert.equal(plan.bases[0].modeChange,true);assert.equal(plan.changed,3);assert.equal(JSON.stringify(store),before);
});
test('relocation, duplicate claims, foreign owners and incomplete data stop the plan',()=>{
 for(const mutate of [
  x=>x.store.info.airbaseRelocations=[{itemId:3}],
  x=>x.options.bases[0].slots[2].itemId=2,
  x=>x.store.info.ships={1:{api_slot:[3]}},
  x=>x.store.airbaseSync.complete=false,
  x=>x.store.airbaseSync.relocationsComplete=false,
  x=>x.store.info.airbase[0].api_plane_info[0].api_state=2,
 ]){const x=fixture();mutate(x);assert.throws(()=>planLandBases(x.store,x.options));}
});
test('replacement is executable, but removal and immediate reuse of a displaced plane are not',()=>{
 const {assertExecutable}=require('../../../src/domain/fleet/land_base_execution_plan');
 const replacement=fixture();replacement.options.bases[0].slots=[3,2,0,0].map((itemId,i)=>({slotId:i+1,itemId}));
 assert.doesNotThrow(()=>assertExecutable(planLandBases(replacement.store,replacement.options)));
 const removal=fixture();removal.options.bases[0].slots=[0,2,0,0].map((itemId,i)=>({slotId:i+1,itemId}));
 assert.throws(()=>assertExecutable(planLandBases(removal.store,removal.options)),/卸装/);
 const reuse=fixture();reuse.options.bases[0].slots=[3,2,1,0].map((itemId,i)=>({slotId:i+1,itemId}));
 assert.throws(()=>assertExecutable(planLandBases(reuse.store,reuse.options)),/需要转场/);
});
