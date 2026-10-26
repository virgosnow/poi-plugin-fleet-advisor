'use strict';
const {economicalReplacements}=require('./route_economy');
const {hasDuplicateShipFamily}=require('./context');
const roles=[[1,2],[3,4,21],[5,6],[7,11,18],[8,9,10],[13,14]];
const sameRole=(a,b)=>a.stype===b.stype||roles.some(group=>group.includes(a.stype)&&group.includes(b.stype));

// Give every editable position a first choice. A high-scoring related type
// must not evict the same-type alternatives before equipment/route fitting.
function positionUpgrades(rows,roster,{lockedIds,score,allowed=()=>true}){
  return rows.flatMap((old,index)=>{
    if(lockedIds.has(old.id))return [];
    const eligible=roster.filter(row=>sameRole(row,old)&&!rows.some(r=>r.id===row.id)&&
      allowed(row)&&score(row)>score(old)&&!hasDuplicateShipFamily(rows.map((r,i)=>i===index?row:r)))
      .sort((a,b)=>score(b)-score(a)||a.id-b.id);
    const choices=[...eligible.filter(row=>row.stype===old.stype).slice(0,2),
      ...eligible.filter(row=>row.stype!==old.stype).slice(0,2)];
    return choices.length?[{index,choices}]:[];
  });
}

// First-round trials all start from one common fleet. Keep their independent
// gains even if another position has already become the current best fleet.
// The combined hulls still require ordinary fitting and full validation.
function combineUpgrades(rows,gains,lockedIds){
  const combined=rows.slice();
  for(const upgrade of gains.slice().sort((a,b)=>b.gain-a.gain||a.index-b.index)){
    const {row}=upgrade,index=upgrade.beforeId===undefined?upgrade.index:
      combined.findIndex(r=>r.id===upgrade.beforeId);
    if(index<0)continue;
    if(lockedIds.has(combined[index].id)||combined[index].id===row.id)continue;
    const next=combined.map((r,i)=>i===index?row:r);
    if(!hasDuplicateShipFamily(next))combined[index]=row;
  }
  return combined;
}
// Specialist fitting can promote a weak escort after early refinement. Hard
// surface/installation routes still deserve a strong-DD comparison, without
// enabling the easy-map economy policy. These are proposals only: the caller
// retains the old winner and rechecks route, air, LoS, score and execution.
function finalHullUpgrades(rows,roster,{lockedIds,score,difficulty,surface}){
  if(!difficulty.enabled&&!surface)return [];
  const changes=difficulty.enabled?economicalReplacements(rows,roster,{lockedIds,score,difficulty}):[];
  const escortRows=rows.slice(),escorts=rows.flatMap((old,index)=>{
    if(![1,2].includes(old.stype)||lockedIds.has(old.id))return [];
    const row=roster.filter(r=>r.stype===2&&!escortRows.some(s=>s.id===r.id)&&score(r)>score(old)&&
      !hasDuplicateShipFamily(escortRows.map((s,i)=>i===index?r:s)))
      .sort((a,b)=>score(b)-score(a)||a.id-b.id)[0];
    if(row)escortRows[index]=row;
    return row?[{index,beforeId:old.id,row,gain:score(row)-score(old)}]:[];
  });
  return [combineUpgrades(rows,[...changes,...escorts],lockedIds),combineUpgrades(rows,changes,lockedIds),
    ...changes.slice(0,2).map(c=>rows.map((r,i)=>i===c.index?c.row:r)),
    ...escorts.slice(0,difficulty.enabled?1:2).map(c=>rows.map((r,i)=>i===c.index?c.row:r))];
}
module.exports={positionUpgrades,combineUpgrades,finalHullUpgrades};
