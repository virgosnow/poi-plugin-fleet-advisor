'use strict';
// Route-local encounter thresholds. Enemy alternatives are compared, never added
// together. Air-state borders and sequential slot losses share the same data.
const catalog=new Map(require('../../../data/sortie/enemy_catalog.json').enemies.map(e=>[e.apiId,e]));
const pending=require('../../../data/sortie/adjudications.json').entries.filter(e=>e.status==='pending');
const cache=new Map();
const noAirBattle=new Set(['start','noBattle','item','resources','transport','whirlpool','activeBranch','airRecon','nightBattle']);
const valid=n=>Number.isFinite(n)&&n>=0;
function noCombatAircraft(ship){
  const enemy=catalog.get(ship.apiId);
  if(!enemy)return false;
  if(enemy.stats?.['搭載']===0)return true;
  // Reconnaissance aircraft alone do not initiate an air-state contest. Require
  // a complete known loadout; absence of an air-value column is not zero proof.
  return enemy.equipment?.length>0&&enemy.equipment.every(e=>e.notEquippable||
    typeof e.name==='string'&&/砲|魚雷|レーダ|電探|ソナー|爆雷|探照灯|FCS|機銃|偵察|水偵|観測/.test(e.name));
}
function antiAirEnvelope(patterns){
  let proportion=0,fixed=0;
  for(const p of patterns){
    const ships=[...(p.enemyShips||[]),...(p.escortFleet?.enemyShips||[])].map(s=>catalog.get(s.apiId));
    if(!ships.length||ships.some(s=>!s))return {status:'unknown',reason:'敌方防空资料缺失'};
    if(ships.every(s=>s.shipType==='潜水艦'||s.shipType==='潜水空母'))continue;
    // These enemies have suspected, not quantified, special interception.
    if(ships.some(s=>/砲台小鬼|防空棲姫|軽巡ト級flagship|輸送ワ級II|防空巡棲姫|防空埋護/.test(s.name)))
      return {status:'unknown',reason:'敌方特殊对空迎击尚未定量'};
    const combined=!!p.escortFleet?.enemyShips?.length;
    const formations=p.formation||[];
    const factors=formations.map(f=>combined?(/第三|輪形/.test(f)?1.5:/第一/.test(f)?1.1:1):
      /輪形/.test(f)?1.6:/複縦/.test(f)?1.2:/警戒/.test(f)?1.1:1);
    // Missing formation: use the strongest ordinary formation, explicitly as
    // a conservative envelope, rather than inventing a formation probability.
    const factor=factors.length?Math.max(...factors):combined?1.5:1.6;
    const defense=Math.floor(factor*ships.reduce((sum,s)=>sum+s.stats['艦隊対空ボーナス'],0))*2;
    for(let i=0;i<ships.length;i++){
      const weighted=ships[i].stats['加重対空値'];
      const combinedFactor=combined?(i<(p.enemyShips||[]).length?0.8:0.48):1;
      if(!valid(weighted)||!valid(defense))return {status:'unknown',reason:'敌方防空数值缺失'};
      proportion=Math.max(proportion,weighted*combinedFactor/400);
      fixed=Math.max(fixed,Math.floor((weighted+defense)*combinedFactor*0.09375));
    }
  }
  return {status:'known',proportion,fixed};
}
function nodeAir(area,id,node,cross){
  if(!node)return {id,enemyAirPower:null,issues:['节点敌情缺失']};
  if(noAirBattle.has(node.kind))return {id,enemyAirPower:0,issues:[],noAirBattle:true};
  const patterns=Object.values(node.phases||{}).flatMap(phase=>{
    const rows=phase.patterns||[];
    const resolve=(row,seen=new Set())=>{
      if(!row||seen.has(row.pattern))return {};
      seen.add(row.pattern);
      const parent=row.sameAsPattern?resolve(rows.find(p=>p.pattern===row.sameAsPattern),seen):{};
      return {...parent,...row,enemyShips:row.enemyShips||parent.enemyShips,
        escortFleet:row.escortFleet||parent.escortFleet,
        enemyAirPower:row.enemyAirPower??parent.enemyAirPower};
    };
    return rows.map(row=>resolve(row));
  }),values=[],issues=[],bounds=[];
  if(!patterns.length)issues.push('敌编成缺失');
  for(const pattern of patterns){
    const conflicts=pending.filter(e=>e.area===area&&e.node===id&&e.pattern===pattern.pattern);
    const airConflicts=conflicts.filter(e=>e.fields?.some(f=>/air/i.test(f)));
    let value=pattern.enemyAirPower;
    if(!valid(value)){
      const ships=[...(pattern.enemyShips||[]),...(pattern.escortFleet?.enemyShips||[])];
      value=ships.length&&ships.every(noCombatAircraft)?0:null;
    }
    if(!valid(value))issues.push(`编成 ${pattern.pattern} 制空资料不足`);
    else values.push(value);
    for(const conflict of airConflicts){
      const alternatives=Object.values(conflict.values?.enemyAirPower||{});
      if(conflict.fields.every(f=>f==='enemyAirPower')&&alternatives.length&&alternatives.every(valid)&&valid(value))
        bounds.push(...alternatives,value);
      else issues.push(`编成 ${pattern.pattern} 制空资料存在争议`);
    }
    if(valid(value)&&((valid(pattern.airSuperiority)&&pattern.airSuperiority!==Math.ceil(value*1.5))||
      (valid(pattern.airSupremacy)&&pattern.airSupremacy!==value*3)))issues.push(`编成 ${pattern.pattern} 制空线记载不一致`);
  }
  // If formations disagree, include the other source's complete alternatives.
  // A different gun-only composition does not create imaginary enemy aircraft.
  if(pending.some(e=>e.area===area&&e.node===id&&e.kind==='compositionConflict')){
    if(!cross?.kcwikiVariants?.length)issues.push('差异编成资料不足');
    for(const variant of cross?.kcwikiVariants||[]){
      const ships=[...(variant.apiIds||[]),...(variant.escortApiIds||[])].map(apiId=>({apiId}));
      const value=valid(variant.air)?variant.air:ships.length&&ships.every(noCombatAircraft)?0:null;
      // Numeric wiki patterns can cover the same aircraft composition even when
      // the secondary page omits its air column. Otherwise keep it unresolved.
      const airShips=list=>list.filter(s=>!noCombatAircraft(s)).map(s=>s.apiId).sort((a,b)=>a-b).join(',');
      const signature=airShips(ships);
      const matches=ships.length?patterns.filter(p=>valid(p.enemyAirPower)&&
        airShips([...(p.enemyShips||[]),...(p.escortFleet?.enemyShips||[])])===signature):[];
      if(valid(value))values.push(value);
      else if(matches.length)values.push(...matches.map(p=>p.enemyAirPower));
      else issues.push('差异编成制空资料不足');
    }
  }
  const maximum=values.length?Math.max(...values):null;
  const crossPatterns=pending.some(e=>e.area===area&&e.node===id&&e.kind==='compositionConflict')?
    (cross?.kcwikiVariants||[]).map(v=>({enemyShips:(v.apiIds||[]).map(apiId=>({apiId})),
      escortFleet:v.escortApiIds?.length?{enemyShips:v.escortApiIds.map(apiId=>({apiId}))}:null})):[];
  return {id,kind:node.kind,boss:!!node.boss,antiAir:antiAirEnvelope([...patterns,...crossPatterns]),
    enemyAirPower:issues.length||bounds.length?null:maximum,knownEnemyAirPower:maximum,
    upperBound:!issues.length&&bounds.length?Math.max(maximum,...bounds):null,
    issues:[...new Set([...issues,...(bounds.length?['敌制空数值存在来源差异']:[])])]};
}
function encounterAir(area){
  if(cache.has(area))return cache.get(area);
  if(!/^\d-\d$/.test(area||''))return null;
  let data;try{data=require(`../../../data/sortie/encounters/${area}.json`);}catch(_){return null;}
  const value={source:data.source?.url||null,nodes:new Map(Object.entries(data.nodes).map(([id,node])=>[id,nodeAir(area,id,node,data.crossCheck?.nodes?.[id])]))};
  cache.set(area,value);return value;
}
const referenceCache=new Map();
function boundedSet(cache,key,value,limit){
  if(cache.size>=limit)cache.delete(cache.keys().next().value);
  cache.set(key,value);return value;
}
function routeAirReference(result,area,profile){
  const paths=profile?.routePaths?.map(p=>p.nodes)||profile?.examples||[];
  const key=area+'|'+paths.map(p=>p.join('>')).join('|');
  if(referenceCache.has(key))return referenceCache.get(key);
  return boundedSet(referenceCache,key,buildReference(area,paths.map(p=>p.slice())),256);
}
function buildReference(area,paths){
  const ids=[...new Set(paths.flat())].filter(id=>!id.startsWith('start'));
  const empty={superiority:null,supremacy:null,enemyAirPower:null,scope:'selectedRoute',nodes:[],limitingNodes:[],
    routeSustainability:'notSimulated'};
  if(!ids.length)return {...empty,status:'unselected',reason:'选择路线后显示制空门槛'};
  const data=encounterAir(area);
  if(!data)return {...empty,status:'unknown',reason:'该海域缺少逐点敌情'};
  const nodes=ids.map(id=>data.nodes.get(id)||nodeAir(area,id,null));
  const maximum=Math.max(0,...nodes.filter(n=>valid(n.enemyAirPower)).map(n=>n.enemyAirPower));
  // A bounded disagreement below a verified higher encounter cannot change the
  // route maximum. Unbounded/missing data must still remain unknown.
  const unknown=nodes.filter(n=>!valid(n.enemyAirPower)&&!(valid(n.upperBound)&&n.upperBound<=maximum));
  const base={...empty,nodes,paths,source:data.source,scope:paths.length===1?'selectedRoute':'candidateRoutes',
    basis:'仅统计所列路线节点，按已收录各阶段、司令部等级的敌编成最大值；不计基地航空队削减或道中损耗'};
  if(unknown.length)return {...base,status:'unknown',reason:unknown.map(n=>`${n.id} 点：${n.issues.join('、')}`).join('；')};
  return {...base,status:'known',enemyAirPower:maximum,superiority:Math.ceil(maximum*1.5),supremacy:maximum*3,
    limitingNodes:maximum?nodes.filter(n=>n.enemyAirPower===maximum).map(n=>n.id):[]};
}
const lossConstant={supremacy:1,superiority:3,parity:5,disadvantage:7,loss:10};
function airState(own,enemy){
  return enemy===0?'supremacy':own>=enemy*3?'supremacy':own>=enemy*1.5?'superiority':
    own>enemy*2/3?'parity':own>enemy/3?'disadvantage':'loss';
}
function slotPower(slot,count,side){
  return count>0?Math.floor(slot.effectiveAntiAir[side]*Math.sqrt(count)+slot.proficiencyBonus[side]):0;
}
function stageOneLoss(count,state,maximum){
  return Math.floor(count*lossConstant[state]*(maximum?7:3)/120+1e-10);
}
function simulateAirPath(air,nodes,details=true){
  const issues=[];
  if(air?.status!=='range'||!Array.isArray(air.slots)||air.slots.some(s=>s.unknown||
    !s.planes||!s.effectiveAntiAir||!s.proficiencyBonus))return {status:'unknown',reason:'缺少航空槽位计算资料'};
  if(air.slots.some(s=>s.planes[1]>0&&![6,7,8,11,45].includes(s.aircraftType)))
    return {status:'unknown',reason:'喷气或特殊机种的额外航空阶段尚未支持'};
  // Explicit, stable object shape avoids allocating/copying unrelated metric
  // fields for every aircraft in every loadout trial.
  const slots=air.slots.map(s=>({remaining:s.planes.slice(),aircraftType:s.aircraftType,
    effectiveAntiAir:s.effectiveAntiAir,proficiencyBonus:s.proficiencyBonus}));
  const power=side=>slots.reduce((sum,s)=>sum+slotPower(s,s.remaining[side],side),0);
  const margins={superiority:{min:Infinity,max:Infinity},supremacy:{min:Infinity,max:Infinity}};
  const steps=[];let boss=null,stepCount=0,before={min:power(0),max:power(1)};
  for(const node of nodes){
    if(node.noAirBattle)continue;
    const enemy=valid(node.enemyAirPower)?node.enemyAirPower:node.upperBound;
    if(!valid(enemy)){issues.push(`${node.id} 点敌制空资料不足`);break;}
    const rounds=node.kind==='aerialCombat'?2:1;
    for(let round=1;round<=rounds;round++){
      // Zero enemy FP still needs a surviving friendly air-control plane.
      // Without one, a 0 >= 0 comparison must not claim supremacy.
      const required={superiority:Math.max(1,Math.ceil(enemy*1.5)),supremacy:Math.max(1,enemy*3)};
      for(const goal of ['superiority','supremacy'])for(const side of ['min','max'])
        margins[goal][side]=Math.min(margins[goal][side],before[side]-required[goal]);
      stepCount++;
      const step=details?{node:node.id,round,before,required,boss:node.boss||false}:null;
      if(details){steps.push(step);if(node.boss&&round===1)boss=step;}
      // Boss arrival is measured BEFORE its losses. No need to approximate
      // post-terminal interception just to assess the current air state.
      if(node===nodes.at(-1)&&round===rounds)continue;
      const states=[airState(before.min,enemy),airState(before.max,enemy)];
      for(const slot of slots){
        for(let side=0;side<2;side++)slot.remaining[side]=Math.max(0,slot.remaining[side]-
          stageOneLoss(slot.remaining[side],states[side],side===0));
        if(node.kind!=='aerialRaid'&&[7,8,11].includes(slot.aircraftType)&&slot.remaining[1]>0){
          if(node.antiAir?.status!=='known'){issues.push(`${node.id} 点：${node.antiAir?.reason||'敌方防空资料缺失'}`);continue;}
          // Full ordinary interception at the lower end, both AA rolls failing
          // at the upper end. No invented hit chance or fixed fleet-wide pad.
          const n=slot.remaining[0];
          slot.remaining[0]=Math.max(0,n-Math.floor(n*node.antiAir.proportion)-node.antiAir.fixed);
        }
      }
      before={min:power(0),max:power(1)};
      if(details)step.after=before;
      if(issues.length)break;
    }
    if(issues.length)break;
  }
  if(!stepCount)for(const goal of Object.keys(margins))margins[goal]={min:0,max:0};
  if(!details)return {status:issues.length?'unknown':'estimated',margins:issues.length?null:margins};
  return {status:issues.length?'unknown':'estimated',reason:[...new Set(issues)].join('；'),steps,
    boss:issues.length?null:boss,margins:issues.length?null:margins,
    terminal:issues.length?null:nodes.at(-1)?.noAirBattle?{node:nodes.at(-1).id,
      before:{min:power(0),max:power(1)},required:{superiority:0,supremacy:0}}:steps.at(-1)||null};
}
const simulationCache=new WeakMap();
const marginCache=new WeakMap();
const pathPlans=new WeakMap();
function simulationPaths(reference){
  if(pathPlans.has(reference))return pathPlans.get(reference);
  const byId=new Map(reference.nodes.map(n=>[n.id,n])),unique=[],indices=[],seen=new Map();
  for(const path of reference.paths){
    const nodes=path.filter(id=>byId.has(id)).map(id=>byId.get(id));
    // Quiet nodes have no effect between battles. Retain a quiet terminal:
    // arrival there is AFTER the last battle's losses, unlike boss arrival.
    const relevant=nodes.filter((n,i)=>!n.noAirBattle||i===nodes.length-1);
    const key=relevant.map(n=>n.id).join('>');
    if(!seen.has(key)){seen.set(key,unique.length);unique.push(relevant);}
    indices.push(seen.get(key));
  }
  const result={unique,indices};pathPlans.set(reference,result);return result;
}
const slotKeys=new WeakMap();
// Slot objects are often reused by loadout trials. Check their scalar inputs
// before reusing a signature: callers may also edit metrics in place.
function aircraftKey(slot){
  const {aircraftType:t,planes:p,effectiveAntiAir:a,proficiencyBonus:b}=slot;
  const old=slotKeys.get(slot);
  if(old&&old.t===t&&old.p0===p[0]&&old.p1===p[1]&&old.a0===a[0]&&old.a1===a[1]&&
    old.b0===b[0]&&old.b1===b[1])return old.key;
  const value={t,p0:p[0],p1:p[1],a0:a[0],a1:a[1],b0:b[0],b1:b[1]};
  value.key=[t,p[0],p[1],a[0],a[1],b[0],b[1]].join(',');
  slotKeys.set(slot,value);return value.key;
}
function estimateRouteAir(air,reference){
  if(!air||reference.status!=='known')return {status:'unknown',reason:reference.reason||'路线制空资料不足'};
  // Many distinct equipment instances produce identical aircraft inputs.
  // Key by all simulation inputs, not by a freshly-created metric object or
  // mutable store identity. Rank/equipment/plane changes invalidate naturally.
  if(air.status!=='range'||!Array.isArray(air.slots)||air.slots.some(s=>s.unknown||
    !s.planes||!s.effectiveAntiAir||!s.proficiencyBonus))return {status:'unknown',reason:'缺少航空槽位计算资料'};
  const key=air.slots.map(aircraftKey).sort().join(';');
  let cached=simulationCache.get(reference);if(!cached){cached=new Map();simulationCache.set(reference,cached);}
  if(cached.has(key))return cached.get(key);
  const plan=simulationPaths(reference),simulations=plan.unique.map(nodes=>simulateAirPath(air,nodes));
  const paths=plan.indices.map(i=>simulations[i]);
  const unknown=simulations.find(p=>p.status!=='estimated');
  const margins=unknown?null:Object.fromEntries(['superiority','supremacy'].map(goal=>[goal,{
    min:Math.min(...simulations.map(p=>p.margins[goal].min)),max:Math.min(...simulations.map(p=>p.margins[goal].max))}]));
  const result={status:unknown?'unknown':'estimated',reason:unknown?.reason,paths,margins,
    boss:paths.length===1?paths[0].boss:null,terminal:paths.length===1?paths[0].terminal:null,
    basis:'逐槽顺序计算空战击坠范围及普通对空炮火上限；敌编成取已收录最强条件，攻击机下限不计射击回避；航空战点计算两轮且不预扣敌机，不计基地航空队、支援及敌舰击沉；区间为保守估算，不是概率或实战保证'};
  return boundedSet(cached,key,result,256);
}
// Trial fits only compare margins. Use the same loss simulator without
// allocating per-node reports; final candidates still request full details.
function estimateRouteAirMargins(air,reference){
  if(!air||reference.status!=='known'||air.status!=='range'||!Array.isArray(air.slots)||
    air.slots.some(s=>s.unknown||!s.planes||!s.effectiveAntiAir||!s.proficiencyBonus))return null;
  // Slot order/ship identity cannot affect integer air power or per-slot loss.
  // Multiplicity is retained: identical aircraft in two slots count twice.
  const key=air.slots.map(aircraftKey).sort().join(';'),full=simulationCache.get(reference);
  if(full?.has(key))return full.get(key).margins;
  let cached=marginCache.get(reference);if(!cached){cached=new Map();marginCache.set(reference,cached);}
  if(cached.has(key))return cached.get(key);
  const margins={superiority:{min:Infinity,max:Infinity},supremacy:{min:Infinity,max:Infinity}};
  for(const nodes of simulationPaths(reference).unique){
    const value=simulateAirPath(air,nodes,false);
    if(value.status!=='estimated')return boundedSet(cached,key,null,256);
    for(const goal of ['superiority','supremacy'])for(const side of ['min','max'])
      margins[goal][side]=Math.min(margins[goal][side],value.margins[goal][side]);
  }
  return boundedSet(cached,key,margins,256);
}
module.exports={routeAirReference,estimateRouteAir,estimateRouteAirMargins,simulateAirPath,stageOneLoss};
