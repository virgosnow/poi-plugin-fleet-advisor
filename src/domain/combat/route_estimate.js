'use strict';
// Bounded reference scenarios for the current fleet and selected paths only.
// This is a relative battle comparison, NOT a measured victory/retreat rate.
const {performance}=require('perf_hooks');
const {routeEncounters}=require('./combat_encounters');
const {projectedHull}=require('./combat_projection');
const {rankThreats,nodeThreat,equipmentLookup,simulateNodeThreat,uniqueThreatCandidates}=require('./combat_threat');
const battle=require('./combat_battle');
const air=require('./combat_air_asw');
const {buildGroundAttack}=require('./combat_ground');
const {flags:groundFlags}=require('./installation_attack');
const {fromRatio}=require('./combat_balance');
const {routeAirReference,estimateRouteAir}=require('../routes/route_air');
const {consumption}=require('../routes/sortie_profile');
const LIMITS=Object.freeze({paths:8,battlesPerPath:16,samples:32,timeMs:50});
const SURFACE_FORMATION={単縦:1,複縦:.8,輪形:.7,梯形:.75,単横:.6,
  第一警戒航行序列:.8,第二警戒航行序列:1,第三警戒航行序列:.7,第四警戒航行序列:1.1};
const ASW_FORMATION={単縦:.6,複縦:.8,輪形:1.2,梯形:1.1,単横:1.3,
  第一警戒航行序列:1.3,第二警戒航行序列:1.1,第三警戒航行序列:1,第四警戒航行序列:.7};
function enemyFormation(formation,fleet,kind){
  const options=formation?.formation||[];if(!options.length)return undefined;
  if(kind==='nightBattle')return options[0];
  const hasSubs=fleet.some(ship=>ship.submarine);
  const strength=value=>Math.max(SURFACE_FORMATION[value]??0,hasSubs?(ASW_FORMATION[value]??0):0);
  return options.slice().sort((a,b)=>strength(b)-strength(a))[0];
}
function unknown(reason,threats){return {status:'unknown',reasons:[reason],threats};}
function laterBattleExists(path,pathStep,nodes){return path.slice(pathStep+1).some(id=>nodes.has(id));}
// A reference scenario can use midpoint aircraft counts when attrition is
// unresolved, just as the opening-air model does. Keep known empty slots at
// zero and never invent a capacity. This does not assert a loss probability.
function groundReferenceSlots(store,entry,loss){
  const slots={...(loss?.status==='estimated'?loss.slots:{})};
  const ship=store.info.ships[entry.id],master=store.const.$ships[ship?.api_ship_id];
  let assumed=false;
  for(let slot=0;slot<(entry.slots||[]).length;slot++){
    const item=store.info.equips?.[entry.slots[slot]],equip=store.const.$equips?.[item?.api_slotitem_id];
    const type=Number(equip?.api_type?.[2]);
    if(![6,7,8,9,10,11,25,26,41,45,56,57,58,59].includes(type)||
      ![7,8,11,45,57,58].includes(type)&&!groundFlags(equip).length)continue;
    const capacity=master?.api_maxeq?.[slot],value=slots[slot];
    if(!Number.isInteger(capacity)||capacity<0)continue;
    if(value===undefined&&capacity>0){slots[slot]=Math.round(capacity/2);assumed=true;}
    else if(Array.isArray(value)&&value.length===2&&value.every(Number.isInteger)&&value[0]===0&&value[1]>0&&value[1]<=capacity){
      slots[slot]=Math.round(value[1]/2);assumed=true;
    }
  }
  return {slots,assumed};
}
// Check every documented alternative without simulating a cross-product. A
// weak static score cannot prove an alternative harmless when an attack is
// unknown. The caller supplies one preparation per actual formation and path.
function preflightAlternatives(nodes,prepare,checkTime=()=>false){
  for(const node of nodes)for(const formation of node.formations){
    if(checkTime())return {status:'unknown',reason:'战力计算超过时间预算'};
    const result=prepare(node,formation);
    if(result.reason)return {status:'unknown',reason:`${node.id} 点：${result.reason}`};
  }
  return {status:'known'};
}
function refineThreats(fleet,evidence,store,scheme,base,{now,start}){
  // Short per-node scenarios are restricted to a single selected journey;
  // otherwise retain the cross-branch reference rather than hide a branch.
  if(evidence.status!=='known'||evidence.paths.length!==1||evidence.nodes.length>8)return base;
  const readings=[];
  for(const node of evidence.nodes){
    if(now()-start>LIMITS.timeMs)return base;
    readings.push({target:node.target,...simulateNodeThreat(fleet,node,{store,scheme,samples:8,maxFormations:3})});
  }
  const select=(target,fallback)=>{
    const rows=readings.filter(row=>!!row.target===target);
    if(!rows.length)return fallback;
    if(rows.some(row=>row.unresolvedCritical))return {...fallback,status:'partial',
      warnings:[...new Set([...(fallback?.warnings||[]),'部分关键攻击资料待确认'])]};
    const ranked=rows.filter(row=>row.enemy&&Number.isFinite(row.score)).sort((a,b)=>b.score-a.score);
    if(!ranked.length)return fallback;
    const close=ranked.length>1&&ranked[0].score-ranked[1].score<.05;
    const candidates=uniqueThreatCandidates(ranked.flatMap(row=>row.candidates||[]),2);
    return {status:'partial',enemies:candidates.length?candidates:[ranked[0].enemy],warnings:[...new Set([
      ...ranked[0].warnings,...(close?['参考场景中多个节点威胁接近']:[])])]};
  };
  return {...base,target:select(true,base.target),enroute:select(false,base.enroute)};
}
function evaluateRoute(store,scheme,profile,{route,airPower,now=()=>performance.now(),seed=0}={}){
  if(!scheme?.ships?.length||scheme.ships.length>6)return unknown('舰队资料不足');
  if(!profile||profile.referenceOnly||!profile.selectedPathsVerified)return unknown('所选路线尚未核对');
  const encounterStage=profile.encounterStage&&profile.encounterStage!=='unknown'?profile.encounterStage:
    require('./encounter_stage').encounterStage(store,profile.area,route?.phase);
  const start=now(),evidence=routeEncounters({...profile,encounterStage});
  if(evidence.status==='unknown')return unknown(evidence.reasons?.join('；')||'路线敌情待确认');
  const fleet=scheme.ships.map(entry=>projectedHull(store,entry));
  if(fleet.some(ship=>ship.status!=='known'))return unknown('舰娘战斗资料不足');
  let threats=rankThreats(fleet,evidence,{equipmentMasters:store.const.$equips});
  if(evidence.status!=='known')return unknown(evidence.reasons?.join('；')||'敌编成资料待确认',threats);
  if(evidence.paths.length>LIMITS.paths)return unknown('可达分支超过计算预算',threats);
  threats=refineThreats(fleet,evidence,store,scheme,threats,{now,start});
  const nodes=new Map(evidence.nodes.map(node=>[node.id,node]));
  const lookup=equipmentLookup(store.const.$equips),cache=new Map();
  const ranked=new Map(evidence.nodes.map(node=>[node.id,nodeThreat(node,fleet,lookup,cache)]));
  const candidates=evidence.paths.map((path,index)=>({index,path,
    nodes:path.nodes.map(id=>nodes.get(id)).filter(Boolean)}));
  if(candidates.some(path=>path.nodes.length>LIMITS.battlesPerPath))return unknown('战斗节点超过计算预算',threats);
  if(!candidates.some(path=>path.nodes.length))return unknown('所选路线没有可比较的战斗',threats);
  // Pick one conservative branch using per-formation threat. This avoids a
  // cross-product of paths and enemy variants, without inventing frequencies.
  const pathScore=path=>path.nodes.reduce((sum,node)=>{
    const value=ranked.get(node.id)?.score;
    // An unranked branch is not evidence of a safer branch; inspect it first.
    return sum+(Number.isFinite(value)?value:1000000);
  },0);
  candidates.sort((a,b)=>pathScore(b)-pathScore(a)||a.index-b.index);
  const chosen=candidates[0],reference=routeAirReference(route||{},profile.area,{...profile,encounterStage});
  const airEstimate=estimateRouteAir(airPower,reference);
  const map=require(`../../../data/sortie/encounters/${profile.area}.json`);
  const special=battle.deriveFleetSpecial(store,scheme.ships);
  const specialReady=special.status!=='unknown'&&special.available===true;
  const enemyAirCache=new Map(),nodeInputs=new Map(),preparations=new Map(),preflightAssumptions=new Set();
  // The same enemy aircraft data occurs in many formations and branches.
  // Reuse its pure reading while retaining per-path friendly plane losses.
  const enemyAirFor=(node,enemy)=>{
    const key=`${node.kind}:${enemy.apiId}`;
    if(!enemyAirCache.has(key))enemyAirCache.set(key,air.deriveEnemyAir(store,enemy,{nodeKind:node.kind}));
    return enemyAirCache.get(key);
  };
  const prepareFor=(node,formation,pathIndex)=>{
    let byFormation=preparations.get(`${pathIndex}:${node.id}`);
    if(!byFormation){byFormation=new Map();preparations.set(`${pathIndex}:${node.id}`,byFormation);}
    if(byFormation.has(formation))return byFormation.get(formation);
    const fail=reason=>{const result={reason};byFormation.set(formation,result);return result;};
    const key=`${pathIndex}:${node.id}`;let inputs=nodeInputs.get(key);
    if(!inputs){
      const losses=scheme.ships.map(entry=>air.aircraftAfterNode(reference,airEstimate,
        {pathIndex,nodeId:node.id,shipId:entry.id}));
      const ownAir=scheme.ships.map((entry,i)=>air.deriveFriendlyAir(store,entry,
        {slotRemaining:losses[i].status==='estimated'?losses[i].slots:undefined,nodeKind:node.kind}));
      const secondLosses=node.kind==='aerialCombat'?scheme.ships.map(entry=>air.aircraftAfterNode(reference,airEstimate,
        {pathIndex,nodeId:node.id,round:2,shipId:entry.id})):null;
      // With missing second-round attrition, reuse the first round explicitly;
      // do not treat a guessed zero-to-full range as a second observation.
      const ownAirSecond=secondLosses?.every(loss=>loss.status==='estimated')?scheme.ships.map((entry,i)=>
        air.deriveFriendlyAir(store,entry,{slotRemaining:secondLosses[i].slots,nodeKind:node.kind})):undefined;
      const includeNight=node.kind==='battle'&&Array.isArray(map.bossNodes)&&map.bossNodes.includes(node.id);
      const ownNight=includeNight||node.kind==='nightBattle'?scheme.ships.map((entry,i)=>battle.deriveOwnNight(store,entry,
        {flagship:i===0,slotRemaining:losses[i].status==='estimated'?losses[i].slots:undefined})):undefined;
      inputs={losses,ownAir,ownAirSecond,includeNight,ownNight,groundCache:new Map()};nodeInputs.set(key,inputs);
    }
    const {losses,ownAir,ownAirSecond,includeNight,ownNight,groundCache}=inputs;
    if(ownAir.some(reading=>reading.status==='unknown')||ownAirSecond?.some(reading=>reading.status==='unknown'))return fail('己方航空装备资料不足');
    if(ownNight?.some(reading=>reading.status==='unknown'))return fail('夜战攻击资料不足');
    const allEnemies=formation.ships.concat(formation.escort),enemyAir=allEnemies.map(enemy=>enemyAirFor(node,enemy));
    const launchingEnemyAir=formation.escort.length?enemyAir.slice(0,formation.ships.length):enemyAir;
    if(launchingEnemyAir.some(reading=>reading.unresolvedAttack))return fail('敌方攻击机资料不足');
    if(launchingEnemyAir.some((reading,i)=>reading.status==='unknown'&&(allEnemies[i].aircraft?.max||0)>0))
      return fail('敌方航空装备资料不足');
    const ground=node.kind!=='aerialRaid'&&allEnemies.some(enemy=>enemy.kind==='installation')?scheme.ships.map((entry,i)=>{
      // Use a labelled midpoint reference if a relevant aircraft might have
      // been depleted; otherwise preserve the actual known range or zero.
      const {slots,assumed}=groundReferenceSlots(store,entry,losses[i]);
      if(assumed)preflightAssumptions.add(`${node.id} 点：假设对地飞机按损耗范围中间架数参考，实际可能被打空`);
      return allEnemies.map(enemy=>{
        if(enemy.kind!=='installation')return null;
        const cacheKey=`${i}:${enemy.apiId}`;
        if(!groundCache.has(cacheKey))groundCache.set(cacheKey,buildGroundAttack(store,entry,enemy,
          {slotRemaining:slots,nightCarrier:ownNight?.[i]}));
        return groundCache.get(cacheKey);
      });
    }):undefined;
    const prep=battle.prepareBattle(fleet,formation.ships,{kind:node.kind,
      escort:formation.escort,enemyFormation:enemyFormation(formation,fleet,node.kind),ownAir,ownAirSecond,enemyAir,ownNight,includeNight,ground,
      ...(specialReady&&['battle','nightBattle'].includes(node.kind)?{special,ownFormation:special.formation}:{})});
    if(prep.status==='unknown')return fail('战斗资料不足');
    if(prep.reasons.some(reason=>/敌方对潜攻击力|舰娘对潜能力待确认|陆上目标的装备特效或攻击资格待确认|夜战混编的对潜|空母夜战/.test(reason)))
      return fail(prep.reasons.join('；'));
    // Unknown opening torpedoes on unusual enemies must not be hidden by an
    // alternative with a higher static score. Ordinary ship assumptions remain
    // unchanged; these three families have recorded special opening attacks.
    if(!['nightBattle','aerialRaid','aerialCombat'].includes(node.kind)&&prep.foes.some(enemy=>
      enemy.openingUncertain&&/潜水|棲姫|棲鬼|レ級/.test(enemy.master?.name||'')))
      return fail('敌舰先制雷击条件待确认');
    for(const reason of prep.reasons)if(reason.startsWith('假设'))preflightAssumptions.add(`${node.id} 点：${reason}`);
    const result={prep,allEnemies,includeNight};byFormation.set(formation,result);return result;
  };
  for(const candidate of candidates){
    const checked=preflightAlternatives(candidate.nodes,(node,formation)=>prepareFor(node,formation,candidate.index),
      ()=>now()-start>LIMITS.timeMs);
    if(checked.status!=='known')return unknown(checked.reason,threats);
  }
  let remainingAmmo=1;const prepared=[],warnings=new Set(['按当前舰队及可达分支的较高威胁编成估计',
    '模型使用参考命中条件，不是实际通过率或大破率',
    '航空损耗范围按中间架数参考，不代表实际损耗概率',
    `未计支援、基地航空队${specialReady?'':'、特殊炮击'}、弹着观测及燃料回避修正`]);
  for(const reason of preflightAssumptions)warnings.add(reason);
  for(const node of evidence.nodes)for(const warning of node.sourceWarnings||[])warnings.add(`${node.id} 点：${warning}`);
  if(specialReady)warnings.add('按特殊炮击发动阵形参考，实际须选择该阵形');
  else if(special.status==='unknown')warnings.add('特殊攻击资格或发动率待确认');
  if(candidates.length>1&&candidates.some(path=>path.nodes.some(node=>ranked.get(node.id)?.scoreRange?.max>ranked.get(node.id)?.scoreRange?.min)))
    warnings.add('航空损耗可能改变较高威胁分支');
  for(const [pathStep,id] of chosen.path.nodes.entries()){
    const node=nodes.get(id);
    if(node){
      const rank=ranked.get(id),formation=node.formations.find(row=>rank?.enemy?.formationKey!=null&&row.key===rank.enemy.formationKey)||
        node.formations.find(row=>rank?.enemy?.formationKey==null&&row.pattern===rank?.enemy?.pattern&&row.phase===rank?.enemy?.phase)||
        node.formations.slice().sort((a,b)=>b.ships.reduce((n,s)=>n+(s.fire?.max||0)+(s.torpedo?.max||0),0)-
          a.ships.reduce((n,s)=>n+(s.fire?.max||0)+(s.torpedo?.max||0),0))[0];
      if(!formation)return unknown(`${id} 点敌编成资料不足`,threats);
      if(!rank?.enemy)warnings.add(`${id} 点按敌舰面板选取参考编成，刮伤威胁待确认`);
      if(rank?.warnings?.some(reason=>reason.includes('主要敌舰可能改变')))warnings.add(`${id} 点敌机损耗可能改变主要威胁`);
      const {prep,allEnemies,includeNight}=prepareFor(node,formation,chosen.index);
      for(const reason of prep.reasons)warnings.add(`${id} 点：${reason}`);
      if((formation.formation?.length||0)>1)warnings.add(`${id} 点有多种敌方阵形，按较高攻击修正参考`);
      if(includeNight)warnings.add('目标点敌舰仍在时按进入夜战参考');
      prepared.push({id,prep,ammo:remainingAmmo,target:node.target,enemies:allEnemies,
        observed:{visits:0,severe:0,loss:0,enemyLoss:0,damage:allEnemies.map(()=>0)}});
    }
    const used=consumption(map.nodes[id],profile.area);
    if(used.ammo===null){if(laterBattleExists(chosen.path.nodes,pathStep,nodes))warnings.add(`${id} 点弹药消耗待确认`);}
    else remainingAmmo=Math.max(0,remainingAmmo-used.ammo);
    if(now()-start>LIMITS.timeMs)return unknown('战力计算超过时间预算',threats);
  }
  if(!prepared.length)return unknown('所选路线没有可比较的战斗',threats);
  // An air-raid node offers no opportunity to damage the enemy fleet. It
  // contributes incoming damage but must not count as a failed attack when
  // averaging own combat impact across the other nodes.
  const attackableSteps=prepared.filter(step=>step.prep.kind!=='aerialRaid').length;
  if(!attackableSteps)return unknown('所选路线只有空袭，缺少可比较的交战节点',threats);
  let enemyLoss=0,ownLoss=0,severe=0,ran=0;
  const batches=[{enemyLoss:0,ownLoss:0,severe:0,count:0},{enemyLoss:0,ownLoss:0,severe:0,count:0}];
  for(let sample=0;sample<LIMITS.samples;sample++){
    const rng=battle.random(0x4b414e43+sample*7919+seed),initial=fleet.map(s=>s.initialHp);
    let hp=initial.slice(),hit=0,visitedAttackable=0,stopped=false,specialUsed=false;
    for(const step of prepared){
      const before=hp;
      const result=battle.runScenario(step.prep,rng,{initialHp:hp,ammo:Math.min(1,step.ammo*2),specialUsed});
      if(result.status==='unknown')return unknown(`${step.id} 点战斗状态待确认`,threats);
      if(result.status==='partial')return unknown(`${step.id} 点部分攻击能力待确认`,threats);
      hp=result.ownHp;hit+=result.enemyLost;specialUsed=result.specialUsed;
      if(step.prep.kind!=='aerialRaid'&&!result.stopped)visitedAttackable++;
      step.observed.visits++;
      step.observed.loss+=fleet.reduce((sum,ship,i)=>sum+Math.max(0,(before[i]-hp[i])/ship.hp),0)/fleet.length;
      step.observed.enemyLoss+=result.enemyLost;
      step.observed.severe+=Number(result.severe);
      result.damageByEnemy.forEach((damage,i)=>{if(Number.isFinite(damage))step.observed.damage[i]+=damage;});
      if(result.severe){severe++;stopped=true;break;}
    }
    // Once a severe-damage scenario retreats, later unvisited battles are not
    // zero-output fights. Its retreat risk is already in enemyImpact below;
    // dividing by the full route would count that same event twice.
    const dealt=visitedAttackable?hit/visitedAttackable:0,
      received=fleet.reduce((sum,ship,i)=>sum+Math.max(0,(ship.hp-hp[i])/ship.hp),0)/fleet.length;
    enemyLoss+=dealt;ownLoss+=received;
    const batch=batches[sample%2];batch.enemyLoss+=dealt;batch.ownLoss+=received;batch.severe+=Number(stopped);batch.count++;
    ran++;
    if(now()-start>LIMITS.timeMs)return unknown('战力计算超过时间预算',threats);
  }
  // The model's severe fraction is a weighted scenario indicator only, never
  // exposed as a real probability. Stop early on a severe-damage scenario.
  const ownImpact=enemyLoss/ran,enemyImpact=.45*ownLoss/ran+.55*severe/ran;
  const balance=fromRatio((ownImpact+.05)/(enemyImpact+.05));
  if(!balance)return unknown('战力资料不足',threats);
  const batchRanks=batches.map(batch=>fromRatio((batch.enemyLoss/batch.count+.05)/
    (.45*batch.ownLoss/batch.count+.55*batch.severe/batch.count+.05))?.rank);
  const uncertain=batchRanks.some(rank=>rank!==balance.rank);
  if(uncertain)warnings.add('不同参考场景的档位接近边界，结果可能变化');
  if(evidence.paths.length===1){
    const select=(target,fallback)=>{
      const rows=prepared.filter(step=>!!step.target===target),ranked=rows.filter(step=>step.observed.visits>=8)
        .map(step=>({...step,score:(.45*step.observed.loss+.55*step.observed.severe)/step.observed.visits}))
        .sort((a,b)=>b.score-a.score);
      // Too few arrivals at any possible battle cannot establish which is
      // most dangerous; retain the conditional reference with a visible caveat.
      if(!rows.length)return fallback;
      if(ranked.length!==rows.length)return {...fallback,status:'partial',
        warnings:[...new Set([...(fallback?.warnings||[]),'部分节点的参考场景不足'])]};
      const candidates=uniqueThreatCandidates(ranked.flatMap(step=>step.enemies.map((foe,i)=>({
        score:step.observed.damage[i]/step.observed.visits,
        enemy:{apiId:foe.apiId,name:foe.name,node:step.id,nodes:[step.id]}})).filter(row=>row.score>0)),2);
      if(!candidates.length)return fallback;
      return {status:'partial',enemies:candidates,
        warnings:['按当前编成的逐点参考场景排序，不是实测大破率',
          ...(ranked.length>1&&ranked[0].score-ranked[1].score<.05?['多个节点的参考威胁接近']:[])]};
    };
    threats={...threats,target:select(true,threats.target),enroute:select(false,threats.enroute)};
  }
  // These are the existing bounded scenario observations, not actual damage
  // forecasts or event probabilities. Unvisited nodes have no average.
  const diagnostics={nodes:prepared.map(step=>({id:step.id,kind:step.prep.kind,
    visits:step.observed.visits,severe:step.observed.severe,
    ownHpLoss:step.observed.visits?step.observed.loss/step.observed.visits:null,
    enemyHpLoss:step.prep.kind==='aerialRaid'||!step.observed.visits?null:
      step.observed.enemyLoss/step.observed.visits}))};
  return {status:'estimated',balance,threats,reasons:[...warnings],samples:ran,uncertain,diagnostics,
    path:chosen.path.nodes,elapsedMs:now()-start};
}
module.exports={LIMITS,enemyFormation,groundReferenceSlots,laterBattleExists,preflightAlternatives,evaluateRoute};
