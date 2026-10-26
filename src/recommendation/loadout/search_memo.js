'use strict';
const {snapshotMemo,hasEquipmentIndexCache}=require('../../domain/fleet/equipment_planner');
const perf=require('../../shared/performance_trace');

// Only the immutable search scope owns these entries. Live previews never
// retain them. Keep instance IDs, order, empty/held slots and inventory order:
// a numerically equivalent outfit is not an equivalent allocation.
function memoLoadout(store,inventory,kind,inputs,calculate){
  if(!hasEquipmentIndexCache(store))return calculate();
  const cache=snapshotMemo(store,'loadout.results.'+kind,inventory,()=>new Map());
  const key=JSON.stringify(inputs);
  if(cache.has(key)){
    perf.count('loadout.'+kind+'.hit');
    return structuredClone(cache.get(key));
  }
  perf.count('loadout.'+kind+'.miss');
  const result=calculate();
  if(cache.size>=2048)cache.delete(cache.keys().next().value);
  cache.set(key,structuredClone(result));
  return result;
}
function referenceKey(store,reference){
  return snapshotMemo(store,'loadout.referenceKeys',reference,()=>{
    const keys=snapshotMemo(store,'loadout.referenceDictionary','all',()=>new Map());
    const key=JSON.stringify(reference);
    if(!keys.has(key))keys.set(key,keys.size);
    return keys.get(key);
  });
}
module.exports={memoLoadout,referenceKey};

