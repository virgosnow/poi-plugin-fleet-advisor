'use strict';
// Compare like-for-like bounded reference scenarios, not real success rates.
function valid(value){
  const journeys=value?.diagnostics?.journeys,target=value?.diagnostics?.target;
  return ['ready','estimated'].includes(value?.status)&&Number.isInteger(journeys?.samples)&&journeys.samples>=16&&
    Number.isInteger(journeys.completed)&&journeys.completed>=0&&journeys.completed<=journeys.samples&&
    typeof target?.id==='string'&&Number.isInteger(target.visits)&&target.visits>=0&&target.visits<=journeys.samples&&
    Number.isInteger(target.sVictories)&&target.sVictories>=0&&target.sVictories<=target.visits;
}
function preservesRouting(before,after,option,bases,plans=require('../domain/routes/route_plans')){
  if(!before?.route||!after?.route||!option)return true;
  const a=plans.optionPlanning(before.route,option),b=plans.optionPlanning(after.route,option);
  const worse=(oldValue,newValue)=>Number.isFinite(oldValue)&&(!Number.isFinite(newValue)||newValue+1e-9<oldValue);
  if(worse(a.chance?.min,b.chance?.min)||worse(a.chance?.max,b.chance?.max)||
    worse(a.chance?.probability,b.chance?.probability))return false;
  if(Number.isFinite(a.losShortfall)&&(!Number.isFinite(b.losShortfall)||b.losShortfall>a.losShortfall))return false;
  if(worse(before.route.probability,after.route.probability))return false;
  const targets=new Set((bases||[]).flatMap(base=>base.targets||[]).filter(Boolean));
  if(targets.size){
    const oldPaths=plans.fleetPaths(before.route,option),newPaths=new Set(plans.fleetPaths(after.route,option).map(path=>path.join('>')));
    // A chance can stay unchanged even though an equipment-driven branch
    // changes. Do not lose a branch on which the selected base was dispatched.
    if(oldPaths.some(path=>path.some(node=>targets.has(node))&&!newPaths.has(path.join('>'))))return false;
  }
  return true;
}
// Compare the same paths with the same reference weights. Node-table counts
// belong to the conservative branch and must not stand in for the average.
function outcomes(reading){
  if(!valid(reading))return null;
  const branches=reading.diagnostics.branches;
  const rows=Array.isArray(branches)&&branches.length?branches:[{path:reading.path,weight:1,
    journeys:reading.diagnostics.journeys,target:reading.diagnostics.target}];
  if(rows.some(row=>!Number.isFinite(row.weight)||row.weight<=0||!Number.isInteger(row.journeys?.samples)||
    !row.journeys.samples||!Number.isInteger(row.journeys.completed)||!Number.isInteger(row.target?.sVictories)))return null;
  const key=rows.map(row=>[Array.isArray(row.path)?row.path.join('>'):'',row.weight]).sort((a,b)=>a[0].localeCompare(b[0]));
  return {key:JSON.stringify(key),arrivals:rows.reduce((s,row)=>s+row.weight*row.journeys.completed/row.journeys.samples,0),
    sVictory:rows.reduce((s,row)=>s+row.weight*row.target.sVictories/row.journeys.samples,0)};
}
function improvesOrMatches(before,after){
  if(!valid(before)||!valid(after))return false;
  const a=before.diagnostics,b=after.diagnostics;
  if(a.journeys.samples!==b.journeys.samples||a.target.id!==b.target.id)return false;
  const old=outcomes(before),next=outcomes(after);
  if(!old||!next||old.key!==next.key||next.arrivals+1e-9<old.arrivals||next.sVictory+1e-9<old.sVictory)return false;
  // More arrivals alone do not justify a weaker Boss outlook. A higher S
  // scenario count can outweigh a lower aggregate balance.
  if(Math.abs(next.sVictory-old.sVictory)<1e-9){
    const oldRatio=before.balance?.ratio,nextRatio=after.balance?.ratio;
    if(Number.isFinite(oldRatio)&&(!Number.isFinite(nextRatio)||nextRatio+1e-9<oldRatio))return false;
  }
  return true;
}
module.exports={valid,preservesRouting,improvesOrMatches,outcomes};
