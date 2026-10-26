'use strict';
const perf=require('../../shared/performance_trace');
// Route-local encounter thresholds. Enemy alternatives are compared, never added
// together. Air-state borders and sequential slot losses share the same data.
const catalog=new Map(require('../../../data/sortie/enemy_catalog.json').enemies.map(e=>[e.apiId,e]));
const pending=require('../../../data/sortie/adjudications.json').entries.filter(e=>e.status==='pending');
const cache=new Map();
const jets=require('../combat/jet_aviation');
const {createMarginPlan}=require('./air_margin_plan');
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
  let proportion=0,fixed=0;const profiles=[];
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
      profiles.push({weighted,defense,combinedFactor});
      proportion=Math.max(proportion,weighted*combinedFactor/400);
      fixed=Math.max(fixed,Math.floor((weighted+defense)*combinedFactor*0.09375));
    }
  }
  return {status:'known',proportion,fixed,...profiles.length?{profiles}:{}};
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
  const knownShips=patterns.flatMap(p=>[...(p.enemyShips||[]),...(p.escortFleet?.enemyShips||[])]).map(s=>catalog.get(s.apiId));
  const pureSubmarines=knownShips.length>0&&knownShips.every(s=>s&&['潜水艦','潜水空母'].includes(s.shipType));
  const enemyJets=knownShips.some(s=>s?.equipment?.some(e=>/噴式.*(?:戦闘|爆撃)|jet.*(?:fighter|bomber)/i.test(e.name||'')));
  return {id,kind:node.kind,boss:!!node.boss,pureSubmarines,enemyJets,antiAir:antiAirEnvelope([...patterns,...crossPatterns]),
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
function stageOneLoss(count,state,maximum,scale=1){
  return Math.floor(count*lossConstant[state]*(maximum?7:3)/120*scale+1e-10);
}
function simulateAirPath(air,nodes,details){
  const timing=perf.begin('air.simulate');
  try{return simulateAirPathCore(air,nodes,details);}finally{perf.end(timing);}
}
function simulateAirPathCore(air,nodes,details=true){
  const issues=[];
  if(air?.status!=='range'||!Array.isArray(air.slots)||air.slots.some(s=>s.unknown||
    !s.planes||!s.effectiveAntiAir||!s.proficiencyBonus))return {status:'unknown',reason:'缺少航空槽位计算资料'};
  if(air.slots.some(s=>jets.isJet(s.aircraftType)&&s.planes[1]>0))return simulateJetAirPath(air,nodes,details);
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

// The ordinary path above remains untouched for fleets without jets. Jet
// attrition precedes the SAME node's ordinary air check, including the Boss.
function simulateJetAirPath(air,nodes,details){
  const timing=perf.begin('air.simulate.jet');
  try{return simulateJetAirPathCore(air,nodes,details);}finally{perf.end(timing);}
}
function simulateJetAirPathCore(air,nodes,details){
  const slots=air.slots.map(s=>({remaining:s.planes.slice(),aircraftType:s.aircraftType,
    effectiveAntiAir:s.effectiveAntiAir,proficiencyBonus:s.proficiencyBonus,
    masterId:s.masterId,shipId:s.shipId,slot:s.slot,bomb:s.bomb,jetSteel:s.jetSteel,
    jet:jets.spec(s.masterId,s.aircraftType)}));
  const jetSlots=slots.filter(s=>jets.isJet(s.aircraftType)&&s.remaining[1]>0);
  const bad=jetSlots.find(s=>!s.jet);
  if(bad)return {status:'unknown',reason:bad.aircraftType===58?'喷式舰攻的强袭与损耗规则未确认':'喷气机钢材或射击回避资料缺失'};
  if(slots.some(s=>![6,7,8,11,45,56,57].includes(s.aircraftType)))return {status:'unknown',reason:'特殊机种的航空阶段未确认'};
  const steel=jetSlots[0]?.jetSteel;
  const eligible=nodes.some(n=>!n.noAirBattle&&jets.applicable(n)!==false);
  if(eligible&&(steel===null||steel===undefined))return {status:'unknown',reason:'当前钢材资料缺失，喷式强袭时机待确认'};
  if(nodes.some(n=>!n.noAirBattle&&n.enemyJets))return {status:'unknown',reason:'敌方喷气机的喷气阶段比例击坠规则未确认'};
  const budget=[steel??0,steel??0],debit=[0,0],issues=[],steps=[],jetStages=[];
  const margins={superiority:{min:Infinity,max:Infinity},supremacy:{min:Infinity,max:Infinity}};
  const power=side=>slots.reduce((sum,s)=>sum+slotPower(s,s.remaining[side],side),0);
  const snapshot=()=>({min:power(0),max:power(1)});
  const intercept=(slot,node,side)=>{
    if(side===1)return;
    const n=slot.remaining[0];
    const loss=slot.jet?jets.antiAirLoss(n,node,slot.jet):node.antiAir?.status==='known'?
      Math.floor(n*node.antiAir.proportion)+node.antiAir.fixed:null;
    if(loss===null){issues.push(`${node.id} 点：${node.antiAir?.reason||'敌方防空资料缺失'}`);return;}
    slot.remaining[0]=Math.max(0,n-loss);
  };
  let boss=null,count=0;
  for(const node of nodes){
    if(node.noAirBattle)continue;
    const enemy=valid(node.enemyAirPower)?node.enemyAirPower:node.upperBound;
    if(!valid(enemy)){issues.push(`${node.id} 点敌制空资料不足`);break;}
    const applies=jets.applicable(node);
    if(applies===null){issues.push(`${node.id} 点喷气阶段适用性未确认`);break;}
    let jetStage;
    if(applies){
      const active=[0,1].map(side=>budget[side]>0&&jetSlots.some(s=>s.remaining[side]>0));
      const requiredSteel=[0,0],attacks=[];
      for(let side=0;side<2;side++)if(active[side]){
        requiredSteel[side]=jetSlots.reduce((sum,s)=>sum+jets.steelCost(s.masterId,s.aircraftType,s.remaining[side]),0);
        const spent=Math.min(budget[side],requiredSteel[side]);budget[side]-=spent;debit[side]+=spent;
      }
      for(const slot of jetSlots){
        const before=details?slot.remaining.slice():null;
        for(let side=0;side<2;side++)if(active[side]){
          // No enemy jets in covered normal maps: the jet-only air contest
          // uses supremacy's reduced self-loss envelope before interception.
          slot.remaining[side]=Math.max(0,slot.remaining[side]-stageOneLoss(slot.remaining[side],'supremacy',side===0,jets.PHASES.proportionalLoss));
          if(slot.aircraftType===57)intercept(slot,node,side);
        }
        if(details&&slot.aircraftType===57){
          const power=slot.remaining.map((n,side)=>active[side]?(jets.jetPower(slot.bomb,n)||0):0);
          // The higher-plane endpoint can exhaust steel one battle earlier.
          // Then attack opportunity is discontinuous: bound the unknown
          // intermediate outcomes instead of emitting a reversed interval.
          if(active[0]!==active[1]){
            power[0]=0;power[1]=jets.jetPower(slot.bomb,Math.max(...slot.remaining))||0;
          }
          attacks.push({shipId:slot.shipId,slot:slot.slot,masterId:slot.masterId,before,planes:slot.remaining.slice(),power});
        }
      }
      if(details){jetStage={node:node.id,active,requiredSteel,steelRemaining:budget.slice(),attacks};jetStages.push(jetStage);}
    }
    const rounds=node.kind==='aerialCombat'?2:1;
    for(let round=1;round<=rounds;round++){
      const before=snapshot(),required={superiority:Math.max(1,Math.ceil(enemy*1.5)),supremacy:Math.max(1,enemy*3)};
      for(const goal of ['superiority','supremacy'])for(const side of ['min','max'])margins[goal][side]=Math.min(margins[goal][side],before[side]-required[goal]);
      count++;
      const step=details?{node:node.id,round,before,required,boss:!!node.boss,...round===1&&jetStage?{jetAssault:jetStage}:{}}:null;
      if(details){steps.push(step);if(node.boss&&round===1)boss=step;}
      const states=[airState(before.min,enemy),airState(before.max,enemy)];
      for(const slot of slots){
        for(let side=0;side<2;side++)slot.remaining[side]=Math.max(0,slot.remaining[side]-
          stageOneLoss(slot.remaining[side],states[side],side===0,slot.jet?jets.PHASES.proportionalLoss:1));
        if(node.kind!=='aerialRaid'&&[7,8,11,57].includes(slot.aircraftType)&&slot.remaining[1]>0)intercept(slot,node,0);
      }
      if(details){
        step.after=snapshot();
        step.aircraft=slots.map(s=>({shipId:s.shipId,slot:s.slot,masterId:s.masterId,type:s.aircraftType,
          planes:s.remaining.slice(),...(s.jet?.role==='bomber'?{power:s.remaining.map(n=>jets.jetPower(s.bomb,n,{phase:'ordinary'})||0)}:{})}));
      }
      if(issues.length)break;
    }
    if(issues.length)break;
  }
  if(!count)for(const g of Object.keys(margins))margins[g]={min:0,max:0};
  const status=issues.length?'unknown':'estimated';
  if(!details)return {status,margins:issues.length?null:margins};
  return {status,reason:[...new Set(issues)].join('；'),steps,boss:issues.length?null:boss,
    margins:issues.length?null:margins,jetStages,steelConsumed:{min:Math.min(...debit),max:Math.max(...debit)},
    terminal:issues.length?null:nodes.at(-1)?.noAirBattle?{node:nodes.at(-1).id,before:snapshot(),required:{superiority:0,supremacy:0}}:steps.at(-1)||null};
}
const simulationCache=new WeakMap();
const marginCache=new WeakMap();
// Trial fits revisit more than 256 aircraft combinations on complex routes.
// One shared clock budget bounds all references in this worker, rather than
// multiplying a larger per-route allowance by every reachable route.
const marginEntries=[],MARGIN_LIMIT=16384;let marginHand=0;
function saveMargins(cache,key,value){
  const entry={cache,key,value,hot:true};cache.set(key,entry);
  if(marginEntries.length<MARGIN_LIMIT)marginEntries.push(entry);
  else {
    // Reads set a bit instead of deleting/reinserting Map entries hundreds of
    // thousands of times. Recently used entries get one additional turn.
    while(marginEntries[marginHand].hot){marginEntries[marginHand].hot=false;marginHand=(marginHand+1)%MARGIN_LIMIT;}
    const expired=marginEntries[marginHand];
    if(expired.cache.get(expired.key)===expired)expired.cache.delete(expired.key);
    marginEntries[marginHand]=entry;marginHand=(marginHand+1)%MARGIN_LIMIT;
  }
  return value;
}
const pathPlans=new WeakMap(),sharedTrials=new Map(),nodeTokens=new WeakMap();let nextNodeToken=0;
function nodeToken(node){
  if(!nodeTokens.has(node))nodeTokens.set(node,++nextNodeToken);
  return nodeTokens.get(node);
}
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
  // Routes that differ only at quiet starting branches have identical air
  // calculations. Share only their numerical trial, never the labelled report.
  // Node object identities retain every enemy/AA field and unknown condition.
  const trialKey=unique.map(nodes=>nodes.map(nodeToken).join(',')).sort().join(';');
  let trial=sharedTrials.get(trialKey);
  if(!trial){trial=createMarginPlan(unique,{airState,stageOneLoss,slotPower});boundedSet(sharedTrials,trialKey,trial,256);}
  const result={unique,indices,trial};pathPlans.set(reference,result);return result;
}
const slotKeys=new WeakMap();
const aircraftTokens=new Map();let nextAircraftToken=0;
function aircraftToken(key){
  if(aircraftTokens.has(key))return aircraftTokens.get(key);
  // Tokens are never recycled: an evicted signature can lose reuse, but can
  // never alias a different physical aircraft state retained in a trial cache.
  if(aircraftTokens.size>=32768)aircraftTokens.delete(aircraftTokens.keys().next().value);
  const token=++nextAircraftToken;aircraftTokens.set(key,token);return token;
}
// Slot objects are often reused by loadout trials. Check their scalar inputs
// before reusing a signature: callers may also edit metrics in place.
function aircraftKey(slot,identity=true){
  const {aircraftType:t,planes:p,effectiveAntiAir:a,proficiencyBonus:b}=slot;
  const old=slotKeys.get(slot);
  if(old&&old.t===t&&old.p0===p[0]&&old.p1===p[1]&&old.a0===a[0]&&old.a1===a[1]&&
    old.b0===b[0]&&old.b1===b[1]&&(!jets.isJet(t)||old.mid===slot.masterId&&old.steel===slot.jetSteel&&old.bomb===slot.bomb&&old.sid===slot.shipId&&old.slot===slot.slot))return identity?old.key:old.marginKey;
  const value={t,p0:p[0],p1:p[1],a0:a[0],a1:a[1],b0:b[0],b1:b[1]};
  value.key=[t,p[0],p[1],a[0],a[1],b[0],b[1]].join(',');
  if(jets.isJet(t)){
    Object.assign(value,{mid:slot.masterId,steel:slot.jetSteel,bomb:slot.bomb,sid:slot.shipId,slot:slot.slot});
    value.key+=','+[slot.masterId,slot.jetSteel].join(',');value.marginKey=value.key;
    value.key+=','+[slot.bomb,slot.shipId,slot.slot].join(',');
  }else value.marginKey=value.key;
  value.marginKey=aircraftToken(value.marginKey);
  slotKeys.set(slot,value);return identity?value.key:value.marginKey;
}
function estimateRouteAir(air,reference){
  const timing=perf.begin('air.report');
  try{return estimateRouteAirCore(air,reference);}finally{perf.end(timing);}
}
function estimateRouteAirCore(air,reference){
  if(!air||reference.status!=='known')return {status:'unknown',reason:reference.reason||'路线制空资料不足'};
  // Many distinct equipment instances produce identical aircraft inputs.
  // Key by all simulation inputs, not by a freshly-created metric object or
  // mutable store identity. Rank/equipment/plane changes invalidate naturally.
  if(air.status!=='range'||!Array.isArray(air.slots)||air.slots.some(s=>s.unknown||
    !s.planes||!s.effectiveAntiAir||!s.proficiencyBonus))return {status:'unknown',reason:'缺少航空槽位计算资料'};
  const key=air.slots.map(slot=>aircraftKey(slot)).sort().join(';');
  let cached=simulationCache.get(reference);if(!cached){cached=new Map();simulationCache.set(reference,cached);}
  if(cached.has(key))return cached.get(key);
  const plan=simulationPaths(reference),simulations=plan.unique.map(nodes=>simulateAirPath(air,nodes));
  const paths=plan.indices.map(i=>simulations[i]);
  const unknown=simulations.find(p=>p.status!=='estimated');
  const margins=unknown?null:Object.fromEntries(['superiority','supremacy'].map(goal=>[goal,{
    min:Math.min(...simulations.map(p=>p.margins[goal].min)),max:Math.min(...simulations.map(p=>p.margins[goal].max))}]));
  const result={status:unknown?'unknown':'estimated',reason:unknown?.reason,paths,margins,
    boss:paths.length===1?paths[0].boss:null,terminal:paths.length===1?paths[0].terminal:null,
    basis:air.slots.some(s=>jets.isJet(s.aircraftType))?
      '逐点先算喷式强袭及其迎击，再核对该点普通制空并计算第二次迎击；喷气机普通比例损耗按60%，已收录射击回避分别取整；钢材按每战开始残机数扣除，不预扣敌机，不模拟击沉。区间为保守边界，不是概率或实战保证':
      '逐槽顺序计算空战击坠范围及普通对空炮火上限；敌编成取已收录最强条件，攻击机下限不计射击回避；航空战点计算两轮且不预扣敌机，不计基地航空队、支援及敌舰击沉；区间为保守估算，不是概率或实战保证'};
  return boundedSet(cached,key,result,256);
}
// Trial fits only compare margins. Use the same loss simulator without
// allocating per-node reports; final candidates still request full details.
function estimateRouteAirMargins(air,reference){
  const timing=perf.begin('air.trial');
  try{return estimateRouteAirMarginsCore(air,reference);}finally{perf.end(timing);}
}
function estimateRouteAirMinimum(air,reference){
  const timing=perf.begin('air.trial.minimum');
  try{return estimateRouteAirMarginsCore(air,reference,true);}finally{perf.end(timing);}
}
// A failed inequality needs only one failing battle, not a full report. This
// never substitutes a partial value for a margin or changes ranking numbers.
// null means unknown, so callers retain their existing unknown-data policy.
function routeAirMeets(air,reference,goal,minimum=0){
  if(!air||reference?.status!=='known'||air.status!=='range'||!Array.isArray(air.slots)||
    air.slots.some(s=>s.unknown||!s.planes||!s.effectiveAntiAir||!s.proficiencyBonus))return null;
  const keys=air.slots.map(s=>aircraftKey(s,false)),signature=keys.slice().sort().join(';'),plan=simulationPaths(reference);
  let cache=marginCache.get(plan.trial);if(!cache){cache=new Map();marginCache.set(plan.trial,cache);}
  const minimumEntry=cache.get('min:'+signature)||cache.get(signature);
  if(minimumEntry){minimumEntry.hot=true;return minimumEntry.value?minimumEntry.value[goal].min>=minimum:null;}
  const key='test:'+goal+':'+minimum+':'+signature,entry=cache.get(key);
  if(entry){entry.hot=true;perf.count('air.test.hit');return entry.value;}
  const result=plan.trial(air,keys,true,{goal:goal==='supremacy'?1:0,minimum});
  perf.count('air.test.miss');
  if(result!==undefined)return saveMargins(cache,key,result);
  const margins=estimateRouteAirMinimum(air,reference);
  return saveMargins(cache,key,margins?margins[goal].min>=minimum:null);
}
function estimateRouteAirMarginsCore(air,reference,minimumOnly=false){
  if(!air||reference.status!=='known'||air.status!=='range'||!Array.isArray(air.slots)||
    air.slots.some(s=>s.unknown||!s.planes||!s.effectiveAntiAir||!s.proficiencyBonus))return null;
  // Slot order/ship identity cannot affect integer air power or per-slot loss.
  // Multiplicity is retained: identical aircraft in two slots count twice.
  const slotSignatures=air.slots.map(slot=>aircraftKey(slot,false));
  const signature=slotSignatures.slice().sort().join(';'),key=(minimumOnly?'min:':'')+signature,full=simulationCache.get(reference);
  const plan=simulationPaths(reference);
  let cached=marginCache.get(plan.trial);if(!cached){cached=new Map();marginCache.set(plan.trial,cached);}
  if(cached.has(key)){
    perf.count('air.trial.hit');
    const entry=cached.get(key);entry.hot=true;return entry.value;
  }
  const fullKey=full?air.slots.map(slot=>aircraftKey(slot)).sort().join(';'):null;
  if(full?.has(fullKey)){perf.count('air.trial.fullHit');return saveMargins(cached,key,full.get(fullKey).margins);}
  perf.count('air.trial.miss');
  const fast=plan.trial(air,slotSignatures,minimumOnly);
  if(fast!==undefined)return saveMargins(cached,key,fast);
  const margins={superiority:{min:Infinity,max:Infinity},supremacy:{min:Infinity,max:Infinity}};
  for(const nodes of plan.unique){
    const value=simulateAirPath(air,nodes,false);
    if(value.status!=='estimated')return saveMargins(cached,key,null);
    for(const goal of ['superiority','supremacy'])for(const side of ['min','max'])
      margins[goal][side]=Math.min(margins[goal][side],value.margins[goal][side]);
  }
  return saveMargins(cached,key,margins);
}
module.exports={routeAirReference,estimateRouteAir,estimateRouteAirMargins,estimateRouteAirMinimum,routeAirMeets,simulateAirPath,stageOneLoss};
