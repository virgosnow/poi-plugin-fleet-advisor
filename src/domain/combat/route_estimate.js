'use strict';
// Bounded reference scenarios for the current fleet and selected paths only.
// This is a relative battle comparison, NOT a measured victory/retreat rate.
const {performance}=require('perf_hooks');
const {routeEncounters}=require('./combat_encounters');
const {projectedHull}=require('./combat_projection');
const {rankThreats,nodeThreat,equipmentLookup,simulateNodeThreat,uniqueThreatCandidates}=require('./combat_threat');
const battle=require('./combat_battle');
const landBase=require('./land_base');
const air=require('./combat_air_asw');
const {buildGroundAttack}=require('./combat_ground');
const {flags:groundFlags}=require('./installation_attack');
const {fromRatio}=require('./combat_balance');
const {routeAirReference,withLandBases,estimateRouteAir}=require('../routes/route_air');
const {advanceSupply,createSupplyTracker}=require('./route_supply');
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
// Keep each node's reference scenarios paired across candidate fleets and
// routes. A different number of attacks at an earlier node must not silently
// replace every random draw at the Boss. This does not make a scenario count
// an observed probability, and combat within a node remains stochastic.
function nodeScenarioSeed(seed,sample,node){
  let hash=(0x4b414e43+sample*7919+(Number(seed)||0))>>>0;
  for(const char of String(node))hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;
  return hash;
}
function laterBattleExists(path,pathStep,nodes){return path.slice(pathStep+1).some(id=>nodes.has(id));}
function spottingAtNode(store,targets,losses,step,context){
  const power=step?.before&&Number.isFinite(step.before.min)&&Number.isFinite(step.before.max)?(step.before.min+step.before.max)/2:null;
  const state=power!==null&&step.required?(power>=step.required.supremacy?'supremacy':power>=step.required.superiority?'superiority':null):null;
  if(!state)return null;
  return targets.map((target,i)=>{
    if(![3,4,5,6,8,9,10,21].includes(Number(target.master.api_stype)))return null;
    const planes=target.after.slots.map((id,slot)=>({item:target.items.find(item=>item.id===id),slot})).filter(row=>[10,11].includes(row.item?.type));
    if(!planes.some(row=>{
      const count=losses[i]?.slots?.[row.slot];
      return Array.isArray(count)?(count[0]+count[1])/2>=1:Number.isFinite(count)?count>=1:Number(target.master.api_maxeq?.[row.slot])>0;
    }))return null;
    const reading=require('./day_spotting').read(target,store,i===0,context);
    const rates=reading.ci?.rates?.[state]?.rows||[];
    return reading.attacks.map((mode,k)=>({...mode,chance:rates[k]?.chance})).filter(mode=>Number.isFinite(mode.chance));
  });
}
function friendlyNightContact(contact,step,{openingNight=false}={}){
  if(!contact?.candidates?.length)return null;
  if(openingNight)return {states:['openingNight'],own:contact,enemy:{candidates:[]}};
  const min=step?.before?.min,max=step?.before?.max,required=step?.required;
  if(!Number.isFinite(min)||!Number.isFinite(max)||min<0||max<min||
    !Number.isFinite(required?.superiority)||!Number.isFinite(required?.supremacy)||required.superiority<=0)return null;
  let state;
  if(min>=required.supremacy)state='supremacy';
  else if(min>=required.superiority)state='superiority';
  else{
    // Required supremacy is exactly three times enemy air power (except the
    // zero-enemy sentinel). Both ends must remain in the disadvantage band:
    // a range crossing parity or loss cannot establish night-contact eligibility.
    const high=step.enemyAirPowerRange?.max??(required.supremacy===1?0:required.supremacy/3);
    const low=step.enemyAirPowerRange?.min??high;
    if(!Number.isFinite(low)||!Number.isFinite(high)||low<=0||high<low||
      min*3<=high||max*3>2*low)return null;
    state='disadvantage';
  }
  return {states:[state],own:contact,enemy:{candidates:[]}};
}
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
// A weighted assessment combines complete per-path scenario populations. The
// displayed node table and integer scenario counts remain an explicitly named
// conservative branch; weighted fractions are never presented as sample counts.
function combineBranches(readings){
  if(!readings.length||readings.some(row=>!Number.isFinite(row.probability)||row.probability<=0||
    row.result?.status!=='estimated'||!Number.isFinite(row.result.balance?.ratio)))return null;
  const total=readings.reduce((sum,row)=>sum+row.probability,0);
  if(total<=0||total>1+1e-8)return null;
  const weighted=readings.map(row=>({...row,weight:row.probability/total}));
  // Undo fromRatio's regularization before combining objective progress.
  const progress=weighted.reduce((sum,{weight,result})=>sum+weight*
    Math.max(0,Math.min(1,(1.05*result.balance.ratio-.05)/(1+result.balance.ratio))),0);
  const balance=fromRatio((progress+.05)/(1-progress+.05));
  const conservative=weighted.slice().sort((a,b)=>a.result.balance.ratio-b.result.balance.ratio)[0].result;
  const uncertain=weighted.some(row=>row.result.uncertain);
  const summary=weighted.map(({weight,probability,result})=>({path:result.path,weight,probability,
    balance:result.balance,journeys:result.diagnostics.journeys,target:result.diagnostics.target}));
  return {...conservative,balance,uncertain,reasons:[...new Set([...weighted.flatMap(row=>row.result.reasons||[]),
    '总评价在所选分支内按参考概率加权；逐点明细为综合较不利分支的参考场景'])],
    diagnostics:{...conservative.diagnostics,representativePath:conservative.path,branches:summary}};
}
function evaluateRoute(store,scheme,profile,{route,airPower,landBases,now=()=>performance.now(),seed=0,samples=LIMITS.samples,_singleBranch=false}={}){
  if(!scheme?.ships?.length||scheme.ships.length>6)return unknown('舰队资料不足');
  if(!profile||profile.referenceOnly||!profile.selectedPathsVerified)return unknown('所选路线尚未核对');
  if(!Number.isInteger(samples)||samples<LIMITS.samples||samples>64||samples%2)return unknown('参考场景数量无效');
  if(!_singleBranch&&route&&profile.routePaths?.length>1&&profile.routePaths.length<=LIMITS.paths){
    const plans=require('../routes/route_plans');
    const chances=profile.routePaths.map(path=>plans.planningPath(route,path.nodes,{allowTentative:false,includeLosRequirements:false}).chance?.probability);
    if(chances.every(value=>Number.isFinite(value)&&value>0)&&chances.reduce((a,b)=>a+b,0)<=1+1e-8){
      const rows=[];
      for(let i=0;i<profile.routePaths.length;i++){
        const result=evaluateRoute(store,scheme,{...profile,routePaths:[profile.routePaths[i]]},
          {route,airPower,landBases,now,seed,samples,_singleBranch:true});
        if(result.status!=='estimated')return result;
        rows.push({probability:chances[i],result});
      }
      const combined=combineBranches(rows);if(combined)return combined;
    }
  }
  const encounterStage=profile.encounterStage&&profile.encounterStage!=='unknown'?profile.encounterStage:
    require('./encounter_stage').encounterStage(store,profile.area,route?.phase);
  const start=now(),timeMs=(landBases?.some(base=>base.targets?.some(Boolean))?200:LIMITS.timeMs)*samples/LIMITS.samples,
    evidence=routeEncounters({...profile,encounterStage});
  if(evidence.status==='unknown')return unknown(evidence.reasons?.join('；')||'路线敌情待确认');
  const fleet=scheme.ships.map(entry=>projectedHull(store,entry));
  if(fleet.some(ship=>ship.status!=='known'))return unknown('舰娘战斗资料不足');
  const ranked=new Map();
  let threats=rankThreats(fleet,evidence,{equipmentMasters:store.const.$equips,rankedNodes:ranked});
  if(evidence.status!=='known')return unknown(evidence.reasons?.join('；')||'敌编成资料待确认',threats);
  if(evidence.paths.length>LIMITS.paths)return unknown('可达分支超过计算预算',threats);
  threats=refineThreats(fleet,evidence,store,scheme,threats,{now,start});
  const nodes=new Map(evidence.nodes.map(node=>[node.id,node]));
  if(ranked.size<evidence.nodes.length){
    const lookup=equipmentLookup(store.const.$equips),cache=new Map();
    for(const node of evidence.nodes)if(!ranked.has(node.id))ranked.set(node.id,nodeThreat(node,fleet,lookup,cache));
  }
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
  const chosen=candidates[0],reference=withLandBases(store,routeAirReference(route||{},profile.area,{...profile,encounterStage}),landBases,profile.area);
  const airEstimate=estimateRouteAir(airPower,reference);
  const map=require(`../../../data/sortie/encounters/${profile.area}.json`);
  const special=battle.deriveFleetSpecial(store,scheme.ships);
  const specialReady=special.status!=='unknown'&&special.available===true;
  const nightContact=require('./practice_night_contact').friendly(store,scheme);
  const projected=scheme.ships.map(entry=>require('../fleet/fleet_metrics').projectShip(store,entry.id,{slots:entry.slots,ex:entry.ex}));
  const observation=require('./carrier_cutin').createContext(store,projected,profile,{airReference:reference,airEstimate});
  // Rate terms are shared; actual air state is selected independently at each
  // node below. Avoid a second route-wide UI classification inside each read.
  observation.route=()=>null;
  const enemyAirCache=new Map(),nodeInputs=new Map(),preparations=new Map(),preflightAssumptions=new Set();
  let landEnemyIndex=null;
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
      const step=airEstimate?.paths?.[pathIndex]?.steps?.find(row=>row.node===node.id&&row.round===1);
      const ownSpotting=spottingAtNode(store,projected,losses,step,observation);
      inputs={losses,ownAir,ownAirSecond,includeNight,ownNight,ownSpotting,groundCache:new Map()};nodeInputs.set(key,inputs);
    }
    const {losses,ownAir,ownAirSecond,includeNight,ownNight,ownSpotting,groundCache}=inputs;
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
      escort:formation.escort,enemyFormation:enemyFormation(formation,fleet,node.kind),ownAir,ownAirSecond,enemyAir,ownNight,ownSpotting,hitModel:'route',includeNight,ground,
      ...(specialReady&&['battle','nightBattle'].includes(node.kind)?{special,ownFormation:special.formation}:{})});
    if(prep.status!=='unknown'&&node.kind!=='nightBattle'&&launchingEnemyAir.some(r=>r.attacks?.length)){
      const steps=[1,...(node.kind==='aerialCombat'?[2]:[])].map(round=>
        airEstimate?.paths?.[pathIndex]?.steps?.find(row=>row.node===node.id&&row.round===round));
      prep.fleetAirDefense=require('./fleet_air_defense').prepare(store,projected,prep.ownFormation,steps);
      for(const reason of prep.fleetAirDefense.reasons)preflightAssumptions.add(`${node.id} 点：${reason}`);
    }
    if(includeNight||node.kind==='nightBattle'){
      const step=airEstimate?.paths?.[pathIndex]?.steps?.find(row=>row.node===node.id&&row.round===1);
      const contact=friendlyNightContact(nightContact,step,{openingNight:node.kind==='nightBattle'});
      if(contact){prep.practiceNightContact=contact;preflightAssumptions.add(`${node.id} 点：我方夜间接触按固定条件参考，命中加成未计`);}
      else if(nightContact.candidates.length||nightContact.incomplete)
        preflightAssumptions.add(`${node.id} 点：夜间接触条件或制空状态待确认，未计入`);
    }
    if(prep.status==='unknown')return fail('战斗资料不足');
    const enemyReference=reference.nodes.find(row=>row.id===node.id);
    const base=landBase.prepare(store,landBases,{area:profile.area,nodeId:node.id,nodeKind:node.kind,
      enemyAirPower:enemyReference?.enemyAirPower??enemyReference?.upperBound});
    if(base.status==='unknown')return fail(base.reasons.join('；')||'基地航空队资料不足');
    if(base.waves.length){
      const enemy=require('./enemy_land_air');
      if(!landEnemyIndex)landEnemyIndex=enemy.equipmentIndex(store);
      const enemySlots=enemy.formationSlots({enemyShips:formation.ships,escortFleet:{enemyShips:formation.escort}},landEnemyIndex);
      if(!enemySlots)return fail('基地航空战敌机逐槽资料待确认');
      const antiAir=require('../routes/route_air').antiAirEnvelope([{enemyShips:formation.ships,
        escortFleet:{enemyShips:formation.escort},formation:formation.formation}]);
      prep.landBase={...base,enemySlots,antiAir};
      const modifiers=require('./land_base_target_modifiers');
      const special=allEnemies.map(enemy=>modifiers.forTarget(enemy.apiId,enemy.kind==='installation')).filter(Boolean);
      if(special.length&&base.waves.some(wave=>wave.slots.some(slot=>landBase.surfaceAttack.has(slot.type)))){
        preflightAssumptions.add(`${node.id} 点：基地航空敌舰特效按英文 Wiki 两档倍率抽样；未确认的概率按等概率参考`);
        if(special.some(rule=>rule.provisional))preflightAssumptions.add(`${node.id} 点：部分敌舰基地航空倍率仍待验证`);
        if(allEnemies.some(enemy=>enemy.apiId===1586))preflightAssumptions.add(`${node.id} 点：空母栖姬基地航空倍率与日文资料有差异`);
      }
      if(antiAir.status!=='known')preflightAssumptions.add(`${node.id} 点：${antiAir.reason||'敌方防空资料不足'}，陆航防空损耗待确认`);
    }
    for(const reason of base.reasons)preflightAssumptions.add(`${node.id} 点：${reason}`);
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
      ()=>now()-start>timeMs);
    if(checked.status!=='known')return unknown(checked.reason,threats);
  }
  const omittedBase=`未计支援、基地航空队${specialReady?'':'、特殊炮击'}；敌方命中资料不足时按参考值估算`;
  const supplyTracker=createSupplyTracker(store,scheme);
  let remainingAmmo=1,supply=supplyTracker.snapshot();const prepared=[],warnings=new Set(['按当前舰队及可达分支的较高威胁编成估计',
    '模型使用参考命中条件，不是实际通过率或大破率',
    '我方航空损耗和节点制空范围按中间值参考；敌机按制空与舰队防空逐槽估算，不代表实际事故率',
    '敌方航空、昼炮、雷击和夜战命中按我方回避、士气及燃料参考；雷击计入双方阵形、威力及已知敌舰命中修正',
    '敌舰等级、运和装备命中优先使用中文 Wiki 的参考资料（部分等级有争议）；未收录时基础命中项按100参考，未收录的固有雷击命中修正按0参考',
    '暴击按参考命中和可确认熟练度估算；空母低熟练度暴击率、航空触接及部分修正未完整计入',
    '索敌、交战形态及烟幕等仍未完整计入；敌舰固有雷击命中修正来自推测资料，实际命中可能不同',
    '昼战弹着按节点制空和飞机存活范围中间值参考；装备回避蓝字及部分命中补正未计',omittedBase]);
  if(!_singleBranch&&candidates.length>1)warnings.add('分支参考概率不完整，暂按较危险分支估计');
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
      prepared.push({id,prep,ammo:remainingAmmo,supplyBefore:{...supply},target:node.target,enemies:allEnemies,
        observed:{visits:0,severe:0,loss:0,enemyLoss:0,damage:allEnemies.map(()=>0)}});
    }
    const used=supplyTracker.advance(map.nodes[id],profile.area);
    supply=supplyTracker.snapshot();
    if(used.ammo===null){if(laterBattleExists(chosen.path.nodes,pathStep,nodes))warnings.add(`${id} 点弹药消耗待确认`);}
    else remainingAmmo=Number.isFinite(supply.ammo)?supply.ammo:Math.max(0,remainingAmmo-used.ammo);
    if(now()-start>timeMs)return unknown('战力计算超过时间预算',threats);
  }
  if(!prepared.length)return unknown('所选路线没有可比较的战斗',threats);
  if(prepared.some(step=>step.prep.landBase?.waves?.length)){
    warnings.delete(omittedBase);warnings.add(`未计支援${specialReady?'':'、特殊炮击'}；敌方命中资料不足时按参考值估算`);
  }
  // An air-raid node offers no opportunity to damage the enemy fleet. It
  // affects subsequent HP and retreat but is not a failed friendly attack.
  const attackableSteps=prepared.filter(step=>step.prep.kind!=='aerialRaid').length;
  if(!attackableSteps)return unknown('所选路线只有空袭，缺少可比较的交战节点',threats);
  const destination=chosen.path.nodes.at(-1);
  const targetBattle=prepared.find(step=>step.target&&step.id===destination);
  const targetResults=targetBattle?{id:destination,visits:0,sVictories:0,severe:0,flagshipDamage:0,fleetDamage:0,includeNight:targetBattle.prep.includeNight||targetBattle.prep.kind==='nightBattle'}:null;
  let objectiveProgress=0,ran=0,completed=0,stoppedBeforeTarget=0;
  const batches=[{progress:0,count:0},{progress:0,count:0}];
  for(let sample=0;sample<samples;sample++){
    const initial=fleet.map(s=>s.initialHp);
    let hp=initial.slice(),stopped=false,specialUsed=false,reachedTarget=false,targetProgress=0,landBaseState={counts:{}};
    for(const step of prepared){
      const before=hp;
      const rng=battle.random(nodeScenarioSeed(seed,sample,step.id));
      const result=battle.runScenario(step.prep,rng,{initialHp:hp,ammo:Math.min(1,step.ammo*2),fuel:step.supplyBefore.fuel,specialUsed,landBaseState});
      if(result.status==='unknown')return unknown(`${step.id} 点战斗状态待确认`,threats);
      if(result.status==='partial')return unknown(`${step.id} 点部分攻击能力待确认`,threats);
      hp=result.ownHp;specialUsed=result.specialUsed;
      // Damage sustained during the final target battle cannot prevent a
      // battle already fought. A pre-battle stop, or damage on the way to a
      // noncombat destination, does prevent reaching the selected target.
      if(step===targetBattle&&!result.stopped){
        if(!Array.isArray(result.enemyHp)||result.enemyHp.length!==step.prep.foes.length||
          result.enemyHp.some(value=>!Number.isFinite(value)||value<0))return unknown(`${step.id} 点最终战果资料不足`,threats);
        reachedTarget=true;
        // A final-node S victory is determined after the complete battle,
        // including night combat. Heavy damage afterwards is repair cost,
        // not an en-route retreat or an automatic failure of this victory.
        const targetCleared=result.enemyHp.every(value=>value===0)&&hp.every(value=>value>0);
        // Use both flagship damage and fleet-wide damage. Destroying escorts
        // cannot conceal an untouched boss; near-clears still differ from a
        // fleet that cannot hurt the target. Exact S results are kept apart
        // rather than converting finite samples into a guarantee of victory.
        const flagship=1-result.enemyHp[0]/step.prep.foes[0].hp;
        targetProgress=hp.every(value=>value>0)?Math.max(0,Math.min(1,.7*flagship+.3*result.enemyLost)):0;
        targetResults.visits++;targetResults.sVictories+=Number(targetCleared);targetResults.severe+=Number(result.severe);
        targetResults.flagshipDamage+=flagship;targetResults.fleetDamage+=result.enemyLost;
      }
      step.observed.visits++;
      step.observed.loss+=fleet.reduce((sum,ship,i)=>sum+Math.max(0,(before[i]-hp[i])/ship.hp),0)/fleet.length;
      step.observed.enemyLoss+=result.enemyLost;
      step.observed.severe+=Number(result.severe);
      result.damageByEnemy.forEach((damage,i)=>{if(Number.isFinite(damage))step.observed.damage[i]+=damage;});
      if(result.severe){stopped=true;break;}
    }
    // A route assessment must not credit a failed journey as a successful
    // one merely because it damaged the enemy before retreating. Keep the
    // actual exchange in node diagnostics; credit its combat impact only
    // when the journey reaches its target. Do not invent zero-damage rows
    // for later unvisited battles.
    const finished=reachedTarget||!stopped;
    completed+=Number(finished);stoppedBeforeTarget+=Number(!finished);
    const progress=finished?(targetBattle?targetProgress:1):0;
    objectiveProgress+=progress;
    const batch=batches[sample%2];batch.progress+=progress;batch.count++;
    ran++;
    if(now()-start>timeMs)return unknown('战力计算超过时间预算',threats);
  }
  // Compare getting through the route and the final target's actual result.
  // Easy en-route victories cannot conceal an ineffective boss battle, and
  // repair costs after a successful boss battle cannot masquerade as retreat.
  // These bounded sample frequencies remain model references, not real odds.
  // HP attrition already changes attacks, target selection and retreat in
  // these same scenarios. Do not penalize it a second time in the outcome
  // comparison. A combat target uses final flagship/fleet damage; a passive
  // target uses safe arrival. S victories and repair costs stay explicit in
  // diagnostics instead of being confused with en-route retreat.
  const ownImpact=objectiveProgress/ran,enemyImpact=1-ownImpact;
  if(targetResults){
    targetResults.flagshipDamage=targetResults.visits?targetResults.flagshipDamage/targetResults.visits:null;
    targetResults.fleetDamage=targetResults.visits?targetResults.fleetDamage/targetResults.visits:null;
  }
  const balance=fromRatio((ownImpact+.05)/(enemyImpact+.05));
  if(!balance)return unknown('战力资料不足',threats);
  const batchRanks=batches.map(batch=>fromRatio((batch.progress/batch.count+.05)/
    (1-batch.progress/batch.count+.05))?.rank);
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
  const diagnostics={journeys:{samples:ran,completed,stoppedBeforeTarget},target:targetResults,
    ...(!_singleBranch&&candidates.length>1?{branchUncertain:true,representativePath:chosen.path.nodes}:{}),
    supplyEstimates:supplyTracker.estimates,nodes:prepared.map(step=>({id:step.id,kind:step.prep.kind,supplyBefore:step.supplyBefore,
    visits:step.observed.visits,severe:step.observed.severe,
    ownHpLoss:step.observed.visits?step.observed.loss/step.observed.visits:null,
    enemyHpLoss:step.prep.kind==='aerialRaid'||!step.observed.visits?null:
      step.observed.enemyLoss/step.observed.visits}))};
  return {status:'estimated',balance,threats,reasons:[...warnings],samples:ran,uncertain,diagnostics,
    path:chosen.path.nodes,elapsedMs:now()-start};
}
module.exports={LIMITS,enemyFormation,groundReferenceSlots,laterBattleExists,preflightAlternatives,advanceSupply,spottingAtNode,friendlyNightContact,combineBranches,evaluateRoute};
