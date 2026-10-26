'use strict';
// Presentation only: reuse the exact readings behind the headline and route checks.
const number=(n,d=0)=>Number.isFinite(n)?n.toFixed(d):'—';
const range=(lo,hi=lo,d=0)=>Number.isFinite(lo)&&Number.isFinite(hi)?lo===hi?number(lo,d):`${number(lo,d)}–${number(hi,d)}`:'待确认';
function attributes(content,fallback){
  return {'data-tooltip':fallback||[content.title,...(content.sections||[]).flatMap(s=>[s.title,s.columns.join('｜'),...s.rows.map(r=>r.join('｜')),s.note]),...(content.notes||[])].filter(Boolean).join('\n'),
    'data-tooltip-content':JSON.stringify(content)};
}
const section=(title,columns,rows,numeric=[])=>({title,columns,rows,numeric});
function speed(reading,requirement={}){
  const ships=reading?.ships||[];
  return {title:`舰队速力：${reading?.valueLabel||'—'}`,sections:ships.length?[section('',
    ['位置','舰娘','速力','提速装备'],ships.map((s,i)=>[i===0?'旗舰':String(i+1),s.name,
      s.status==='unknown'?'待确认':s.boosted?`${s.baseLabel} → ${s.label}`:s.label,
      s.boostEquipment?.join('、')||'—']))]:[],
    notes:[requirement.detail,...ships.filter(s=>s.status==='unknown').map(s=>`${s.name}：${s.reason||'速力资料待确认'}`),!ships.length?'编成后显示各舰速力。':''].filter(Boolean)};
}
function air(store,reading,summary,{current=false}={}){
  const sections=[];
  // Display the union of shared-node estimates without changing route calculations.
  const nodes=new Map();
  for(const path of summary?.estimate?.paths||[])for(const step of path.steps||[]){
    const key=step.node+':'+step.round,old=nodes.get(key);
    if(!old)nodes.set(key,{...step,before:{...step.before},after:step.after?{...step.after}:null});
    else for(const part of ['before','after'])if(step[part]&&old[part]){
      old[part].min=Math.min(old[part].min,step[part].min);old[part].max=Math.max(old[part].max,step[part].max);
    }
  }
  const enemyAt=id=>{const node=summary?.reference?.nodes?.find(n=>n.id===id);
    return Number.isFinite(node?.enemyAirPower)?{value:node.enemyAirPower}:Number.isFinite(node?.upperBound)?{value:node.upperBound,upperBound:true}:null;};
  const state=(own,enemy,required)=>!Number.isFinite(own)||!Number.isFinite(enemy)?'待确认':
    enemy===0?(own>0?'空确':'无制空'):own>=required.supremacy?'空确':own>=required.superiority?'空优':
      own>enemy*2/3?'空均':own>enemy/3?'空劣':'空丧';
  if(nodes.size)sections.push(section('所选路线 · 损耗估算',['节点','战前制空','敌方制空','预计结果'],[...nodes.values()].map(s=>{
    const enemy=enemyAt(s.node),lo=state(s.before.min,enemy?.value,s.required),hi=state(s.before.max,enemy?.value,s.required);
    return [s.node+(s.round>1?`（第 ${s.round} 轮）`:''),range(s.before.min,s.before.max),enemy?number(enemy.value)+(enemy.upperBound?'（上限）':''):'待确认',lo===hi?lo:`${lo}～${hi}`];
  }),[1,2]));
  else if(summary?.reference?.nodes?.some(n=>!n.noAirBattle))sections.push(section('所选路线 · 损耗待估算',['节点','战前制空','敌方制空','预计结果'],summary.reference.nodes.filter(n=>!n.noAirBattle).map(n=>{
    const enemy=enemyAt(n.id);return [n.id,'待估算',enemy?number(enemy.value)+(enemy.upperBound?'（上限）':''):'待确认','待确认'];
  }),[1,2]));
  return {title:`综合制空：${reading?.status==='range'?range(reading.min,reading.max):'—'}`+(summary?.state?`（${summary.state}）`:''),sections,
    notes:[current?'按当前实际搭载计算。':'按出击前满载计算。',
      reading?.min!==reading?.max?'熟练度等未确定部分保留区间。':'',
      nodes.size?'沿途损耗为估算，多分支显示可能范围。':summary?.estimate?.reason,
      reading?.reason].filter(Boolean)};
}
function los(reading,summary,{current=false}={}){
  const checks=summary?.checks||[],sections=[];
  if(checks.length)sections.push(section('所选路线的索敌判定',['分岐','系数','门槛','当前'],checks.map(c=>[c.edge,String(c.coefficient),`≥ ${c.requiredScore}`,Number.isFinite(c.score)?number(c.score,1):'待计算']),[1,2,3]));
  // Current-fleet coefficient 4 is a display default, never a routing override.
  if(current||!checks.length)sections.push(section(current?'33 式索敌（主显示系数 4）':'33 式索敌',['系数','当前'],[1,2,3,4].map(c=>[String(c),number(reading?.scoresByCoefficient?.[c],1)]),[0,1]));
  return {title:current?'舰队索敌':summary?.state||'舰队索敌',sections,
    notes:[summary?.hint,reading?.reason,reading?.status==='estimate'?'部分索敌资料未确认，当前值为估算。':'',current?'实际带路按海域节点的系数和门槛判断。':''].filter(Boolean)};
}
module.exports={attributes,speed,air,los};
