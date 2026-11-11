'use strict';
require('../i18n/readability');
// Presentation only: reuse the exact readings behind the headline and route checks.
const number=(n,d=0)=>Number.isFinite(n)?n.toFixed(d):'—';
const range=(lo,hi=lo,d=0)=>Number.isFinite(lo)&&Number.isFinite(hi)?lo===hi?number(lo,d):`${number(lo,d)}–${number(hi,d)}`:'待确认';
function attributes(content,fallback){
  return {'data-tooltip':fallback||[content.title,...(content.sections||[]).flatMap(s=>[s.title,s.columns.join('｜'),...s.rows.map(r=>r.join('｜')),s.note]),...(content.notes||[])].filter(Boolean).join('\n'),
    'data-tooltip-content':JSON.stringify(content)};
}
const section=(title,columns,rows,numeric=[],columnKeys=[])=>({title,columns,rows,numeric,columnKeys});
function speed(reading,requirement={}){
  const ships=reading?.ships||[];
  return {displayKind:'fleet-speed',titleData:{value:reading?.valueLabel||'—'},title:`舰队速力：${reading?.valueLabel||'—'}`,sections:ships.length?[section('',
    ['位置','舰娘','速力','提速装备'],ships.map((s,i)=>[i===0?'旗舰':String(i+1),s.name,
      s.status==='unknown'?'待确认':s.boosted?`${s.baseLabel} → ${s.label}`:s.label,
      s.boostEquipment?.join('、')||'—']),[],['position','ship','speed','speedEquipment'])]:[],
    notes:[requirement.detail,...ships.filter(s=>s.status==='unknown').map(s=>`${s.name}：${s.reason||'速力资料待确认'}`),!ships.length?'编成后显示各舰速力。':''].filter(Boolean),
    noteData:[...(requirement.detail?[{kind:'source',value:requirement.detail}]:[]),...ships.filter(s=>s.status==='unknown').map(s=>({kind:'ship-reason',name:s.name,reason:s.reason||'速力资料待确认',fallback:!s.reason})),...(!ships.length?[{kind:'message',value:'编成后显示各舰速力。'}]:[])]};
}
function air(store,reading,summary,{current=false}={}){
  const sections=[];
  // Display the union of shared-node estimates without changing route calculations.
  const nodes=new Map();
  for(const path of summary?.estimate?.paths||[])for(const step of path.steps||[]){
    const key=step.node+':'+step.round,old=nodes.get(key);
    if(!old)nodes.set(key,{...step,before:{...step.before},after:step.after?{...step.after}:null});
    else for(const part of ['before','after','enemyAirPowerRange'])if(step[part]&&old[part]){
      old[part].min=Math.min(old[part].min,step[part].min);old[part].max=Math.max(old[part].max,step[part].max);
    }
  }
  const enemyAt=id=>{const node=summary?.reference?.nodes?.find(n=>n.id===id);
    return Number.isFinite(node?.enemyAirPower)?{value:node.enemyAirPower}:Number.isFinite(node?.upperBound)?{value:node.upperBound,upperBound:true}:null;};
  const state=(own,enemy,required)=>!Number.isFinite(own)||!Number.isFinite(enemy)?'待确认':
    enemy===0?(own>0?'空确':'无制空'):own>=required.supremacy?'空确':own>=required.superiority?'空优':
      own>enemy*2/3?'空均':own>enemy/3?'空劣':'空丧';
  if(nodes.size)sections.push(section('所选路线 · 损耗估算',['节点','战前制空','敌方制空','预计结果'],[...nodes.values()].map(s=>{
    const enemy=enemyAt(s.node),enemyLow=s.enemyAirPowerRange?.min??enemy?.value,enemyHigh=s.enemyAirPowerRange?.max??enemy?.value,
      threshold=value=>({superiority:Math.max(1,Math.ceil(value*1.5)),supremacy:Math.max(1,value*3)}),
      lo=state(s.before.min,enemyHigh,s.enemyAirPowerRange?threshold(enemyHigh):s.required),
      hi=state(s.before.max,enemyLow,s.enemyAirPowerRange?threshold(enemyLow):s.required);
    const enemyText=s.enemyAirPowerRange?range(s.enemyAirPowerRange.min,s.enemyAirPowerRange.max):
      enemy?number(enemy.value)+(enemy.upperBound?'（上限）':''):'待确认';
    return [s.node+(s.round>1?`（第 ${s.round} 轮）`:''),range(s.before.min,s.before.max),enemyText,lo===hi?lo:`${lo}～${hi}`];
  }),[1,2],['node','friendlyAir','enemyAir','outcome']));
  else if(summary?.reference?.nodes?.some(n=>!n.noAirBattle))sections.push(section('所选路线 · 损耗待估算',['节点','战前制空','敌方制空','预计结果'],summary.reference.nodes.filter(n=>!n.noAirBattle).map(n=>{
    const enemy=enemyAt(n.id);return [n.id,'待估算',enemy?number(enemy.value)+(enemy.upperBound?'（上限）':''):'待确认','待确认'];
  }),[1,2],['node','friendlyAir','enemyAir','outcome']));
  return {displayKind:'fleet-air',titleData:{value:reading?.status==='range'?range(reading.min,reading.max):'—',state:summary?.state||null},title:`综合制空：${reading?.status==='range'?range(reading.min,reading.max):'—'}`+(summary?.state?`（${summary.state}）`:''),sections,
    notes:[current?'按当前实际搭载计算。':'按出击前满载计算。',
      reading?.min!==reading?.max?'熟练度等未确定部分保留区间。':'',
      nodes.size?'沿途损耗为估算，多分支显示可能范围。':summary?.estimate?.reason,
      summary?.reference?.landBase?'基地削敌为 5%–95% 样本参考区间，非极限或保证。':'',
      reading?.reason].filter(Boolean),
    noteData:[{kind:'message',value:current?'readability.airLoad':'readability.airFull'},
      ...(reading?.min!==reading?.max?[{kind:'message',value:'readability.airRange'}]:[]),
      ...(nodes.size?[{kind:'message',value:'readability.airLoss'}]:summary?.estimate?.reason?[{kind:'source',value:summary.estimate.reason}]:[]),
      ...(summary?.reference?.landBase?[{kind:'message',value:'基地削敌为 5%–95% 样本参考区间，非极限或保证。'}]:[]),
      ...(reading?.reason?[{kind:'source',value:reading.reason}]:[])]};
}
function los(reading,summary,{current=false}={}){
  const checks=summary?.checks||[],sections=[];
  if(checks.length)sections.push(section('所选路线的索敌判定',['分岐','系数','门槛','当前'],checks.map(c=>[c.edge,String(c.coefficient),`≥ ${c.requiredScore}`,Number.isFinite(c.score)?number(c.score,1):'待计算']),[1,2,3],['branch','coefficient','threshold','current']));
  // Current-fleet coefficient 4 is a display default, never a routing override.
  if(current||!checks.length)sections.push(section(current?'33 式索敌（主显示系数 4）':'33 式索敌',['系数','当前'],[1,2,3,4].map(c=>[String(c),number(reading?.scoresByCoefficient?.[c],1)]),[0,1],['coefficient','current']));
  return {displayKind:'fleet-los',titleData:{value:current?'舰队索敌':summary?.state||'舰队索敌'},title:current?'舰队索敌':summary?.state||'舰队索敌',sections,
    notes:[summary?.hint,reading?.reason,reading?.status==='estimate'?'部分索敌资料未确认，当前值为估算。':'',current?'实际带路按海域节点的系数和门槛判断。':''].filter(Boolean),
    noteData:[...(summary?.hint?[{kind:'source',value:summary.hint}]:[]),...(reading?.reason?[{kind:'source',value:reading.reason}]:[]),
      ...(reading?.status==='estimate'?[{kind:'message',value:'部分索敌资料未确认，当前值为估算。'}]:[]),
      ...(current?[{kind:'message',value:'readability.losCurrent'}]:[])]};
}
module.exports={attributes,speed,air,los};
