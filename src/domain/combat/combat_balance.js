'use strict';
// Presentation-scale policy only: inputs must already be comparable measures
// for the same battle, not raw panel stats or recommendation ranking weights.
const LIMITS=Object.freeze([1/3,2/3,1.5,3]);
const LABELS=Object.freeze(['完败','劣势','均势','优势','完胜']);
function tier(ratio){
  if(!Number.isFinite(ratio)||ratio<0)return null;
  return ratio<=LIMITS[0]?0:ratio<=LIMITS[1]?1:ratio<LIMITS[2]?2:ratio<LIMITS[3]?3:4;
}
function fromRatio(ratio){
  const rank=tier(ratio);if(rank===null)return null;
  return {ratio,blueShare:ratio/(1+ratio),rank,label:LABELS[rank]};
}
function compare(own,enemy){
  if(!Number.isFinite(own)||!Number.isFinite(enemy)||own<0||enemy<=0)return null;
  return fromRatio(own/enemy);
}
// Ranges are conservative bounds, not a probability distribution. Neither
// end may be omitted, and they may not cross a label boundary silently.
function compareRange(own,enemy){
  if(!own||!enemy||![own.min,own.max,enemy.min,enemy.max].every(Number.isFinite)||
    own.min<0||own.max<own.min||enemy.min<=0||enemy.max<enemy.min)return {status:'unknown',balance:null};
  const low=compare(own.min,enemy.max),high=compare(own.max,enemy.min);
  if(!low||!high)return {status:'unknown',balance:null};
  if(low.rank!==high.rank)return {status:'partial',balance:null,range:{low,high}};
  return {status:'ready',balance:low,range:{low,high}};
}
module.exports={LIMITS,LABELS,tier,fromRatio,compare,compareRange};
