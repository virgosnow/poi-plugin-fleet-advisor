'use strict';
// Reference: https://wikiwiki.jp/kancolle/対空砲火 and 航空戦.
const {weightedAntiAir,fleetDefense,fleetAntiAir}=require('./anti_air_cutin');
const constants={supremacy:1,superiority:3,parity:5,disadvantage:7,loss:10};
function stateFor(step){
  const before=step?.before,required=step?.required;
  if(!Number.isFinite(before?.min)||!Number.isFinite(before?.max)||!Number.isFinite(required?.supremacy))return null;
  const own=(before.min+before.max)/2;
  const enemy=step.enemyAirPowerRange?
    (step.enemyAirPowerRange.min+step.enemyAirPowerRange.max)/2:
    required.supremacy===1?0:required.supremacy/3;
  if(!Number.isFinite(enemy)||enemy<0)return null;
  return enemy===0?'supremacy':own>=enemy*3?'supremacy':own>=enemy*1.5?'superiority':
    own>enemy*2/3?'parity':own>enemy/3?'disadvantage':'loss';
}
function prepare(store,targets,formation,steps){
  const weights=targets.map(t=>weightedAntiAir(store,t)),defense=fleetDefense(store,targets,formation),cutins=fleetAntiAir(targets);
  const states=steps.map(stateFor),reasons=[];
  if(weights.some(v=>v===null)||defense===null)reasons.push('部分我方对空资料不足，缺失防空数值按零参考');
  if(!cutins.known||cutins.rows.some(c=>c.fixed===null||c.multiplier===null))reasons.push('部分对空 cut-in 效果或发动率待确认，未知效果未计入');
  if(states.some(s=>!s))reasons.push('节点制空资料不足，敌机未计制空击坠');
  return {weights,defense:defense??0,cutins:cutins.rows,states,reasons};
}
function selectCutin(rows,hp,rng){
  // Each eligible recipe rolls independently in priority order; the first
  // successful roll wins. A missing effect is deliberately not invented.
  for(const row of rows)if(hp[row.position]>0&&row.roll!==null&&rng()<row.roll)
    return row.fixed===null||row.multiplier===null?null:row;
  return null;
}
function intercept(count,state,weight,defense,cutin,rng,combinedFactor=1){
  if(count<=0)return 0;
  if(constants[state]){
    const max=11-constants[state],roll=()=>Math.floor(rng()*(max+1));
    count-=Math.floor(count*(.035*roll()+.065*roll())+1e-10);
  }
  const proportional=rng()<.5?Math.floor(count*(weight??0)*combinedFactor/400):0;
  const fixed=rng()<.5?Math.floor(((weight??0)+defense)*combinedFactor*(cutin?.multiplier??1)/10):0;
  return Math.max(0,count-proportional-fixed-1-(cutin?.fixed??0));
}
module.exports={prepare,stateFor,selectCutin,intercept};
