'use strict';
// Per-completion cache: reuse only when every planning input still agrees.
// poi may update nested objects in place, so object identity alone is unsafe.
function snapshotKey(store){
  const info=store?.info||{};
  return JSON.stringify([store?.airbaseSync?.complete,info.airbase,info.maps,info.equips,
    Object.values(info.ships||{}).map(ship=>[ship?.api_slot,ship?.api_slot_ex]),store?.const?.$equips]);
}
function argumentsKey(options){
  const {scheme,...rest}=options||{};
  const equipment=[...new Set((scheme?.ships||[]).flatMap(ship=>[...(ship?.slots||[]),ship?.ex])
    .filter(id=>Number.isSafeInteger(id)&&id>0))].sort((a,b)=>a-b);
  // The planner uses the proposed fleet only to reserve equipment instances.
  return JSON.stringify([rest,equipment]);
}
function createLandBaseProposalCache(recommend=require('../recommendation/land_base').recommendLandBases){
  let snapshot=null;const entries=new Map();
  return (store,options)=>{
    const current=snapshotKey(store);
    if(snapshot!==current){snapshot=current;entries.clear();}
    const key=argumentsKey(options);
    if(entries.has(key))return structuredClone(entries.get(key));
    const result=recommend(store,options);
    if(entries.size>=8)entries.delete(entries.keys().next().value);
    entries.set(key,structuredClone(result));
    return result;
  };
}
module.exports={createLandBaseProposalCache};
