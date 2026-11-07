'use strict';
// Reference critical rates, conditional on the existing reference hit rate.
// https://en.kancollewiki.net/Accuracy and /Plane_Proficiency
const ranks=[0,1,2,3,4,5,7,10];
const ranges=[[0,9],[10,24],[25,39],[40,54],[55,69],[70,84],[85,99],[100,120]];
function plane(rank,slotFactor=1){
  if(!Number.isInteger(rank)||rank<0||rank>7)return {rateBonus:0,damageBonus:0};
  const exp=(ranges[rank][0]+ranges[rank][1])/2;
  return {rateBonus:Math.floor(ranks[rank]*slotFactor),
    damageBonus:Math.floor(Math.sqrt(exp)+ranks[rank])*slotFactor/100};
}
function chance(phase,hitRate,bonus=0){
  const factor=phase==='air'?0:phase==='night'||phase==='torpedo'||phase==='openingTorpedo'?1.5:1.3;
  return Math.min(hitRate,(Math.floor(factor*Math.sqrt(Math.max(0,hitRate*100-1)))+1+bonus)/100);
}
module.exports={plane,chance};
