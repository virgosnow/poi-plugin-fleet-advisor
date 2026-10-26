'use strict';
const perf=require('../shared/performance_trace');
// Combat capability and route ranking, independent of candidate enumeration.
const {fleetGroundScore}=require('../domain/combat/installation_attack');
const {nightReadiness}=require('./loadout/night_equipment');
const {fleetSpecialAttacks}=require('../domain/combat/special_attacks');
const routes=require('../domain/routes/normal_routes');
const {aswEscortLimit,submarineObjective,aswEncounterWeight}=require('./loadout/loadout_policy');
const aswCombat=require('../domain/combat/asw_combat');
const {routeAirReference,estimateRouteAir}=require('../domain/routes/route_air');
const {aswPotential,num,shipCost,usableSlots}=require('./context');
const {healthySupremacy,supportedAirGoal,smallCarrierSlot}=require('./loadout/carrier_policy');
const jets=require('../domain/combat/jet_aviation');
const carrierCI=require('../domain/combat/carrier_cutin'),metrics=require('../domain/fleet/fleet_metrics');
const {snapshotMemo}=require('../domain/fleet/equipment_planner');
const {routeDifficulty,usefulPower}=require('./route_economy');

function airGoalScore(result,airGoal,area,profile){
  const reference=routeAirReference(result,area,profile);
  if(airGoal==='ignore')return {airGoalStatus:'notRequested',airGoalRequired:null,
    airGoalBaseRequired:null,
    airGoalTier:0,airGoalShortfall:0,routeAirReference:reference};
  const base=reference[airGoal];
  const needsPlane=base===0&&reference.nodes.some(n=>!n.noAirBattle&&n.kind!=='asw');
  const required=Number.isInteger(base)&&base>=0?Math.max(needsPlane?1:0,base):null;
  const air=result.airControl?.fleetAirPower;
  const estimate=estimateRouteAir(air,reference),margin=estimate.margins?.[airGoal];
  const status=base===0&&!needsPlane?'noEnemyAirPower':
    !margin?'unknown':margin.min>=0?'meetsAlongRoute':margin.max<0?'belowAlongRoute':'uncertainAlongRoute';
  const tier=status==='meetsAlongRoute'||status==='noEnemyAirPower'?3:
    status==='uncertainAlongRoute'?2:status==='unknown'?1:0;
  const shortfall=margin?Math.max(0,-margin.min):0;
  return {airGoalStatus:status,airGoalRequired:required,airGoalBaseRequired:base??null,
    airGoalTier:tier,airGoalShortfall:shortfall,routeAirReference:reference,routeAirEstimate:estimate};
}
function plannedCombatStat(store,row,scheme,shipKey,equipKey){
  const entry=scheme.ships.find(ship=>ship.id===row.id);
  const current=[...usableSlots(store,row.id),row.ship.api_slot_ex],
    planned=[...(entry?.slots||usableSlots(store,row.id)),entry?.ex??row.ship.api_slot_ex];
  const torpedo=id=>id>0?Number(store.const.$equips[
    store.info.equips[id]?.api_slotitem_id]?.[equipKey]||0):0;
  return Math.max(0,num(row.ship[shipKey])-current.reduce((sum,id)=>sum+torpedo(id),0)+
    planned.reduce((sum,id)=>sum+torpedo(id),0));
}
const plannedTorpedoStat=(store,row,scheme)=>plannedCombatStat(store,row,scheme,'api_raisou','api_raig');
// Sampling only: compare naked hulls in the map's combat roles, separately
// from level/remodel ranking. Final planned equipment and routing decide winners.
function combatHullRanker(store,profile){
  const cache=new Map(),night=profile?.counts?.night?.maximum||0,
    surface=Math.max(0,(profile?.counts?.surface?.maximum||0)-night),asw=profile?.counts?.asw?.maximum||0;
  return row=>{
    if(cache.has(row.id))return cache.get(row.id);
    const empty={ships:[{id:row.id,slots:[],ex:-1}]};
    const fire=plannedCombatStat(store,row,empty,'api_karyoku','api_houg'),torpedo=plannedTorpedoStat(store,row,empty);
    const planes=[7,11,18].includes(row.stype)?(row.master.api_maxeq||[]).reduce((n,c)=>n+Math.sqrt(c||0)*12,0):0;
    const day=fire*1.5+torpedo*.8+num(row.ship.api_soukou)*.45+planes;
    const sub=aswPotential(store,row),subValue=Number.isFinite(sub)?sub:0;
    const value=((day*(surface||(!night&&!asw?1:0)))+(fire+torpedo)*night+subValue*asw)/Math.max(1,surface+night+asw)+row.level*.25;
    cache.set(row.id,value);return value;
  };
}
function openingTorpedo(store,rows,scheme){
  let power=0,count=0;
  for(const row of rows){
    const entry=scheme.ships.find(ship=>ship.id===row.id);
    const planned=entry?.slots||usableSlots(store,row.id);
    const master=id=>id>0?store.const.$equips[store.info.equips[id]?.api_slotitem_id]:null;
    const kohyoteki=planned.some(id=>Number(master(id)?.api_type?.[2])===22&&
      /甲標的/.test(master(id)?.api_name||''));
    if(!([13,14].includes(row.stype)&&row.level>=10||kohyoteki))continue;
    const effective=plannedTorpedoStat(store,row,scheme);
    // A pre-shelling attack can prevent return fire; this is a bounded
    // strength proxy, not a guaranteed hit or a damage simulation.
    power+=Math.min(125,effective)*1.1+35;
    count++;
  }
  return {count,power};
}
function combatCapability(rows,result,profile,store,scheme){
  const timing=perf.begin('score.combat');
  try{return combatCapabilityCore(rows,result,profile,store,scheme);}finally{perf.end(timing);}
}
function combatCapabilityCore(rows,result,profile,store,scheme){
  // Candidate sampling considers experience and remodel tier, while combat
  // strength still needs hull firepower, torpedoes and armor. A high-level
  // destroyer alone must not outscore a battleship on surface-only maps.
  const surfaceValues=rows.map(row=>
    plannedCombatStat(store,row,scheme,'api_karyoku','api_houg')*1.5+plannedTorpedoStat(store,row,scheme)*0.8+
    num(row.ship.api_soukou)*0.45+num(row.ship.api_taiku)*0.15+
      row.level*0.25+([7,11,18].includes(row.stype)?60:0));
  const surface=surfaceValues.reduce((n,value)=>n+value,0);
  const openingTorp=openingTorpedo(store,rows,scheme);
  const aswTypes=new Set([1,2,3,4,21,22]);
  const opening=new Map((result.openingASW?.ships||[]).map(ship=>[ship.shipId,ship]));
  const aswShips=rows.filter(row=>aswTypes.has(row.stype)||opening.get(row.id)?.eligible===true);
  const surfaceShips=rows.filter(row=>![13,14].includes(row.stype));
  const aswValues=aswShips.map(row=>{
    const reading=opening.get(row.id),value=reading?.totalAswEstimate;
    return (Number.isFinite(value)?value:num(row.ship.api_taisen))*1.5+
      // opening-ASW feasibility carries real weight on submarine routes
      (reading?.predictedEligible?150:0)+(reading?.sonarDepthPair?25:0);
  });
  const escortLimit=aswEscortLimit(profile,store);
  const physicalAsw=escortLimit>0&&aswCombat.requiresAswPackages(profile)?aswCombat.assessAsw(store,scheme,profile,{limit:escortLimit}):null;
  const asw=physicalAsw&&physicalAsw.status!=='none'?physicalAsw.score:
    aswValues.sort((a,b)=>b-a).slice(0,escortLimit).reduce((sum,value)=>sum+value,0);
  const openingAswCount=aswShips.filter(row=>opening.get(row.id)?.eligible===true).length;
  const openingAswUnknownCount=aswShips.filter(row=>opening.get(row.id)?.eligible===null).length;
  const surfaceNodes=Math.max(0,(profile?.counts?.surface?.maximum||0)-
    (profile?.counts?.night?.maximum||0));
  const airNodes=profile?.counts?.air?.maximum||0;
  const aswNodes=aswEncounterWeight(profile);
  const nightNodes=profile?.counts?.night?.maximum||0;
  const night=rows.filter(row=>![7,11,18].includes(row.stype)).reduce((sum,row)=>
    sum+plannedCombatStat(store,row,scheme,'api_karyoku','api_houg')+plannedTorpedoStat(store,row,scheme)+
      row.level*0.15,0);
  const combatNodes=surfaceNodes+airNodes+aswNodes+nightNodes;
  const strength=combatNodes?
    ((surface+openingTorp.power)*(surfaceNodes+airNodes*0.5)+
      asw*aswNodes+night*nightNodes)/combatNodes:
    surface+openingTorp.power;
  const neededAsw=Number.isFinite(escortLimit)?escortLimit:aswNodes?Math.min(4,Math.max(2,aswNodes)):0;
  const neededSurface=surfaceNodes+nightNodes?
    Math.min(6,Math.max(3,surfaceNodes+nightNodes)):0;
  const structuralReadiness=Math.min(
    neededAsw?Math.min(1,aswShips.length/neededAsw):1,
    neededSurface?Math.min(1,surfaceShips.length/neededSurface):1);
  const readiness=Math.min(physicalAsw&&physicalAsw.status!=='none'?physicalAsw.readiness:1,structuralReadiness);
  return {strength,surface:surface+openingTorp.power,surfaceValues,night,asw,
    aswShipCount:aswShips.length,
    openingAswCount,openingAswUnknownCount,openingTorpedoCount:openingTorp.count,
    openingTorpedoProxy:openingTorp.power,
    readiness,structuralReadiness,neededAsw,neededSurface,physicalAsw};
}
function aircraftStrike(store,rows,scheme,shipTypes,equipmentTypes){
  return rows.filter(row=>shipTypes.includes(row.stype)).reduce((sum,row)=>{
    const assigned=scheme.ships.find(ship=>ship.id===row.id);
    const slots=assigned?.slots||usableSlots(store,row.id);
    return sum+slots.reduce((power,id,slot)=>{
      if(id<=0)return power;
      const master=store.const.$equips[store.info.equips[id]?.api_slotitem_id];
      if(!equipmentTypes.includes(Number(master?.api_type?.[2])))return power;
      const planes=Number(row.ship.api_onslot?.[slot]);
      const count=Number.isFinite(planes)?planes:Number(row.master.api_maxeq?.[slot]||0);
      const raw=(Number(master.api_raig||0)+Number(master.api_baku||0))*Math.sqrt(Math.max(0,count));
      return power+(Number(master.api_type?.[2])===57?Math.max(0,(jets.jetPower(Number(master.api_baku),count,{phase:'ordinary'})||0)-25/Math.SQRT2):raw);
    },0);
  },0);
}
function seaplaneStrike(store,rows,scheme){
  return rows.reduce((sum,row)=>{
    const assigned=scheme.ships.find(ship=>ship.id===row.id);
    const slots=assigned?.slots||usableSlots(store,row.id);
    return sum+slots.reduce((power,id,slot)=>{
      if(id<=0)return power;
      const master=store.const.$equips[store.info.equips[id]?.api_slotitem_id];
      if(Number(master?.api_type?.[2])!==11)return power;
      const observed=Number(row.ship.api_onslot?.[slot]);
      const planes=Number.isFinite(observed)?observed:
        Number(row.master.api_maxeq?.[slot]||0);
      return power+Number(master.api_baku||0)*Math.sqrt(Math.max(0,planes));
    },0);
  },0);
}
const carrierStrike=(store,rows,scheme)=>
  aircraftStrike(store,rows,scheme,[7,11,18],[7,8,57]);
const aviationBattleshipStrike=(store,rows,scheme)=>
  aircraftStrike(store,rows,scheme,[10],[7]);
const openingAirStrike=(store,rows,scheme)=>
  carrierStrike(store,rows,scheme)+aviationBattleshipStrike(store,rows,scheme)+
    seaplaneStrike(store,rows,scheme);
function specialAttackScore(store,rows,scheme,profile){
  const badge=fleetSpecialAttacks(rows,scheme.ships).get(scheme.ships[0]?.id);
  if(badge?.state!=='conditional')return {bonus:0};
  // Read the selected path's encounters, not the whole map. Night-only attacks
  // also have an opportunity in the optional night follow-up of a surface fight.
  const kinds=new Map((profile?.mapPreview?.nodes||[]).map(n=>[n.id,n.kind]));
  const counts=(profile?.routePaths||[]).map(p=>({
    night:p.nodes.filter(id=>kinds.get(id)==='nightBattle').length,
    day:p.nodes.filter(id=>kinds.get(id)==='battle').length
  }));
  const night=counts.length?Math.min(...counts.map(p=>p.night)):profile?.counts?.night?.minimum||0;
  const day=counts.length?Math.min(...counts.map(p=>p.day)):
    Math.max(0,(profile?.counts?.surface?.minimum||0)-night);
  if(!night&&!day)return {bonus:0};
  const members=badge.participants.map(p=>rows.find(r=>r.id===p.id));
  const power=members.reduce((sum,row)=>sum+
    Math.max(0,plannedCombatStat(store,row,scheme,'api_karyoku','api_houg'))+
    (night||badge.key==='special-night'?Math.max(0,plannedTorpedoStat(store,row,scheme)):0),0)/members.length;
  // Qualitative opportunity bonus, not damage or an activation probability.
  // Once-per-sortie attacks are not counted again at every battle. Repeated
  // night attacks get credit for up to three opening night encounters.
  const opportunity=badge.key==='special-night'?(night?Math.min(3,night):0.35):1;
  const bonus=Math.min(60000,power*80*opportunity*(night?1.5:1));
  return {bonus,label:badge.label,participants:badge.participants,detail:badge.detail};
}

function jetScore(store,scheme,air,airScore,profile){
  const timing=perf.begin('score.jets');
  try{return jetScoreCore(store,scheme,air,airScore,profile);}finally{perf.end(timing);}
}
function jetScoreCore(store,scheme,air,airScore,profile){
  const equipped=scheme.ships.flatMap(entry=>entry.slots.flatMap((id,slot)=>{
    const instance=store.info.equips[id],master=store.const.$equips[instance?.api_slotitem_id],type=Number(master?.api_type?.[2]);
    if(!jets.isJet(type))return [];
    const ship=store.info.ships[entry.id],sm=store.const.$ships[ship.api_ship_id];
    return [{shipId:entry.id,slot,type,master,planes:Number(ship.api_onslot?.[slot]??sm.api_maxeq?.[slot])}];
  }));
  if(!equipped.length)return null; // No jet trace, CI projection or new cost on the ordinary fast path.
  const reference=airScore.routeAirReference,estimate=airScore.routeAirEstimate||estimateRouteAir(air,reference);
  const reasons=[],departure=equipped.filter(e=>e.type===57).reduce((n,e)=>n+Math.max(0,(jets.jetPower(Number(e.master.api_baku),e.planes,{phase:'ordinary'})||0)-25/Math.SQRT2),0);
  let assaultMin=0,assaultMax=0,ordinary=departure,steel=0;
  if(estimate.status==='estimated'){
    const paths=(estimate.paths||[]).map(path=>{
      const ordinarySteps=(path.steps||[]).filter(s=>['battle','aerialCombat'].includes(reference.nodes.find(n=>n.id===s.node)?.kind));
      const divisor=Math.max(1,ordinarySteps.length);
      const strikes=(path.jetStages||[]).flatMap(s=>s.attacks);
      const low=strikes.reduce((n,s)=>n+Math.max(0,s.power[0]-(s.power[0]>0?25:0)),0)/divisor;
      const high=strikes.reduce((n,s)=>n+Math.max(0,s.power[1]-(s.power[1]>0?25:0)),0)/divisor;
      const normal=ordinarySteps.reduce((sum,s)=>sum+(s.aircraft||[]).filter(a=>a.type===57)
        .reduce((n,a)=>n+a.power.reduce((v,p)=>v+Math.max(0,p-(p>0?25/Math.SQRT2:0)),0)/2,0),0)/divisor;
      return {low,high,normal,steel:(path.steelConsumed?.min+path.steelConsumed?.max)/2/divisor||0};
    });
    if(paths.length)assaultMin=Math.min(...paths.map(p=>p.low));
    assaultMax=Math.max(...paths.map(p=>p.high),0);
    ordinary=paths.length?paths.reduce((n,p)=>n+p.normal,0)/paths.length:departure;
    steel=paths.length?paths.reduce((n,p)=>n+p.steel,0)/paths.length:0;
  }else{
    reasons.push(estimate.reason||'喷气沿途损耗待确认');
    if(jets.steelAvailable(store)!==0&&reference.nodes.some(n=>jets.applicable(n)!==false))
      assaultMax=equipped.filter(e=>e.type===57).reduce((n,e)=>n+Math.max(0,(jets.jetPower(Number(e.master.api_baku),e.planes)||0)-25),0);
  }
  // Conditional shelling opportunities matter when a jet replaces the only B
  // of an ordinary FBA. Reuse the real CI constants/rates; multipliers are NOT
  // probabilities. This is a bounded ranking correction, not expected damage.
  const targets=scheme.ships.map(entry=>snapshotMemo(store,'jetProjectedShips',JSON.stringify(entry),()=>{
    const state={...entry,slots:entry.slots.slice()};
    return metrics.projectFleet(store,{organization:{targets:[entry.id]},equipment:{expected:[{shipId:entry.id,state}]}})[0];
  }));
  const context=carrierCI.createContext(store,targets,profile,{airReference:reference,airEstimate:estimate});
  const shellingSteps=(estimate.paths||[]).flatMap(p=>(p.steps||[])
    .filter(s=>reference.nodes.find(n=>n.id===s.node)?.kind==='battle'));
  const ciStates=shellingSteps.flatMap(s=>[s.before.min,s.before.max].map(power=>
    power>=s.required.supremacy?'supremacy':power>=s.required.superiority?'superiority':'none'));
  let ciAdjustment=0;
  for(const target of targets.filter(t=>equipped.some(e=>e.shipId===t.id)&&reference.nodes.some(n=>n.kind==='battle'))){
    const types=target.after.slots.flatMap((id,k)=>{const e=target.items.find(e=>e.id===id);return e&&Number(target.master.api_maxeq?.[k])>0?[e.type]:[];});
    const actual=jets.carrierModes(types),jetBombers=types.filter(t=>t===57).length;
    // A freed jet slot could carry a B OR an A. Otherwise two jets would
    // unfairly avoid the lost-FBA cost merely because both were treated as B.
    const ordinaryChoices=Array.from({length:jetBombers+1},(_,torpedoCount)=>{
      let seen=0;return jets.carrierModes(types.map(t=>t===57?(seen++<torpedoCount?8:7):t===56?6:t));
    });
    const modes=[...new Set([...actual,...ordinaryChoices.flat()])];
    const powers=snapshotMemo(store,'jetCarrierPowers',JSON.stringify([target.id,target.after,modes]),()=>carrierCI.attackPowers(target,store,modes));
    const multipliers={...Object.fromEntries(Object.entries(jets.CI).map(([k,v])=>[k,v.multiplier])),FBA:1.25,BBA:1.2,BA:1.15};
    const expected=modes=>{
      if(!modes.length)return 1;
      const read=carrierCI.read(context,target,scheme.ships[0].id===target.id,modes);
      if(read.rates.superiority.total===null){reasons.push(read.reason);return null;}
      // Respect each selected node's ordinary air state AFTER jet losses.
      // Bound endpoints are ranking inputs, not equally likely outcomes.
      const values=(ciStates.length?ciStates:['superiority']).map(state=>state==='none'?1:
        1+read.rates[state].rows.reduce((n,r)=>n+r.rate*(multipliers[r.label]-1),0));
      return values.reduce((n,v)=>n+v,0)/values.length;
    };
    const own=expected(actual),baselines=ordinaryChoices.map(expected),baseline=baselines.some(v=>v===null)?null:Math.max(...baselines);
    if(powers.basePower!==null&&own!==null&&baseline!==null)ciAdjustment+=(own-baseline)*powers.basePower*0.5;
    else reasons.push('喷气炮击／CI参考攻击力待确认');
  }
  // Interval midpoints are ranking policy, never a claimed shoot-down or hit
  // probability. Steel's small cost weight is policy, not a game formula.
  const assault=(assaultMin+assaultMax)/2,steelPenalty=steel*0.02;
  const unsupported=equipped.some(e=>e.type===58);
  return {status:reasons.length?'unknown':'bounded',assault:{min:assaultMin,max:unsupported?null:assaultMax},ordinary:unsupported?null:ordinary,
    steelPerBattle:estimate.status==='estimated'?steel:null,steelPenalty,ciAdjustment,reasons:[...new Set(reasons.filter(Boolean))],
    adjustment:assault+ordinary-departure+ciAdjustment-steelPenalty};
}

function routeRank(result,profile,rows,preference,airGoal,area,store,scheme,byRoute=false){
  return routeRanker(result,profile,rows,airGoal,area,store,scheme,byRoute)(preference);
}
// Preferences only change the final weighting. Compute the same candidate's
// combat, aviation and support facts once, then retain each original formula.
function routeRanker(result,profile,rows,airGoal,area,store,scheme,byRoute){
  const timing=perf.begin('score.candidate');
  try{return routeRankerCore(result,profile,rows,airGoal,area,store,scheme,byRoute);}finally{perf.end(timing);}
}
function routeRankerCore(result,profile,rows,airGoal,area,store,scheme,byRoute=false){
  const chance=result.chanceRange||[0,1],assumed=result.assumedChanceRange||chance;
  const reach=assumed[1],lower=chance[0],probability=assumed[0];
  const hops=profile?.hops?.maximum??result.reachableHops?.maximum??99;
  const air=result.airControl?.fleetAirPower;
  const airMin=air?.status==='range'?air.min:0;
  const combat=combatCapability(rows,result,profile,store,scheme);
  const nightSupport=profile?.counts?.night?.maximum?nightReadiness(store,scheme):null;
  const specialAttack=specialAttackScore(store,rows,scheme,profile);
  const airScore=airGoalScore(result,airGoal,area,profile);
  const jet=jetScore(store,scheme,air,airScore,profile);
  const groundAttack=fleetGroundScore(store,scheme,profile,entry=>plannedCombatStat(store,rows.find(r=>r.id===entry.id),scheme,'api_karyoku','api_houg'),
    {airReference:airScore.routeAirReference,airEstimate:airScore.routeAirEstimate});
  const carrier=carrierStrike(store,rows,scheme);
  const aviationBattleship=aviationBattleshipStrike(store,rows,scheme);
  const seaplane=seaplaneStrike(store,rows,scheme);
  const strike=carrier+aviationBattleship+seaplane;
  // Modest combat credit for affordable AS+ fits, not another mandatory air
  // tier. Never reward an unarmed fighter mule or sacrifice the carrier's BA.
  const supremacyPreference=airGoal==='superiority'&&healthySupremacy(store,scheme,air,airScore.routeAirEstimate)&&
    supportedAirGoal(air,airScore.routeAirReference,'supremacy')?carrier*0.3:0;
  const strength=combat.strength+strike*0.7+(jet?.adjustment||0)*0.7+
    supremacyPreference+(airGoal==='ignore'?0:Math.min(airMin,airScore.airGoalRequired??airMin)*0.5);
  const difficulty=byRoute&&area!=='1-1'?routeDifficulty(profile):{tier:'combat',enabled:false};
  const largeAirAttacks=difficulty.enabled?rows.reduce((sum,row)=>{
    if(![7,11,18].includes(row.stype))return sum;
    const entry=scheme.ships.find(e=>e.id===row.id);
    return sum+Math.min(3,(entry?.slots||usableSlots(store,row.id)).filter((id,k)=>
      !smallCarrierSlot(row.ship,row.master,k)&&
      [7,8,57].includes(Number(store.const.$equips[store.info.equips[id]?.api_slotitem_id]?.api_type?.[2]))).length);
  },0):0;
  const effectiveStrength=difficulty.enabled?rows.reduce((sum,row,i)=>sum+usefulPower(
    combat.surfaceValues[i]+openingTorpedo(store,[row],scheme).power+
    openingAirStrike(store,[row],scheme)*0.7+
    (supremacyPreference?carrierStrike(store,[row],scheme)*0.3:0),difficulty),0)+
    usefulPower((jet?.adjustment||0)*0.7,difficulty)+
    // Extra damage can saturate; separate pre-shelling attack opportunities
    // still prevent return fire. Keep their quality value outside that cap.
    largeAirAttacks*25+combat.openingTorpedoCount*25+
    (airGoal==='ignore'?0:Math.min(airMin,airScore.airGoalRequired??airMin)*0.5):strength;
  const specialBonus=difficulty.enabled?Math.min(specialAttack.bonus,difficulty.specialCeiling)+
    Math.max(0,specialAttack.bonus-difficulty.specialCeiling)*difficulty.excessWeight*0.1:specialAttack.bonus;
  const cost=rows.reduce((sum,row)=>sum+shipCost(row),0);
  const battleCount=profile?.counts?
    profile.counts.surface.maximum+profile.counts.air.maximum+profile.counts.asw.maximum:hops;
  const fuelUse=profile?.fuelConsumedFraction?.maximum;
  const ammoUse=profile?.ammoConsumedFraction?.maximum;
  const sortieCost=Number.isFinite(fuelUse)&&Number.isFinite(ammoUse)?
    rows.reduce((sum,row)=>sum+row.fuel*fuelUse+row.ammo*ammoUse,0):cost;
  const routePriority=reach===0?-1:lower===1?3:result.verdict==='likelyGuaranteed'?2:
    result.verdict==='possibleRandom'?1:0;
  const mixedBoss=aswCombat.submarineEncounters(profile).some(node=>node.boss);
  const primaryAsw=submarineObjective(profile,store)||aswCombat.submarineEncounters(profile).some(node=>node.boss&&node.formations.some(e=>e.length>=2));
  // A road escort shortfall matters, but cannot be priced like failing the
  // whole fleet's objective. Otherwise a small ASW improvement buys a huge
  // loss of boss firepower. Pure ASW / repeated heavy mixed bosses retain
  // their stronger readiness priority.
  const readinessPenalty=(1-combat.structuralReadiness)*1e7+
    (1-(combat.physicalAsw?.readiness??1))*(primaryAsw?1e7:mixedBoss?30000:12000);
  const oneOneEarly=Math.min(230,combat.openingTorpedoProxy)+
    Math.min(100,strike*1.5);
  const dayShellingRounds=rows.some(row=>[8,9,10].includes(row.stype))?2:1;
  // The second volley matters against 1-1's three- or four-ship boss fleet,
  // but it is an opportunity rather than a guaranteed extra hit.
  const oneOneSecondRound=area==='1-1'&&dayShellingRounds===2?
    Math.min(110,rows.reduce((sum,row)=>sum+Math.max(0,num(row.ship.api_karyoku))*0.5,0)):0;
  const oneOneEffective=Math.min(460,strength)+oneOneEarly+oneOneSecondRound;
  const oneOneHeavy=rows.filter(row=>[8,9,10,11,18].includes(row.stype)).length;
  // Every 1-1 enemy can attack submarines; a pair of subs is cheap but takes
  // concentrated ASW fire if the opening torpedoes leave survivors.
  const oneOneSubRisk=rows.filter(row=>[13,14].includes(row.stype)).length;
  return preference=>{
  const preferenceScore=area==='1-1'?
    preference==='shortest'?probability*10000-rows.length*1500+
      oneOneEffective*3-sortieCost*5-oneOneHeavy*700-oneOneSubRisk*900:
      preference==='strongest'?oneOneEffective*100-sortieCost*15-
        oneOneHeavy*2000-oneOneSubRisk*5000:
        -sortieCost*30+Math.min(160,oneOneEarly)*12-rows.length*300-
          oneOneHeavy*1000-oneOneSubRisk*1500:
    preference==='shortest'?-battleCount*10000-hops*1000+
    strength*2-sortieCost-readinessPenalty:
    // Route combat priority retains the relative value of opening/special
    // attack opportunities; the legacy pure-strength API has its own scale.
    preference==='strongest'?effectiveStrength*(byRoute?20:100)-sortieCost*(difficulty.enabled?difficulty.costWeight:0.01)-readinessPenalty:
      -sortieCost*20+strength*2-readinessPenalty;
  return {rank:airScore.airGoalTier*1e10+routePriority*1e8+
      (nightSupport?.supportTier||0)*1e7+specialBonus+groundAttack.bonus*100+
      (profile?.counts?.night?.maximum>=2&&!nightSupport?.zuiunEquipped?Math.max(0,Math.min(2,nightSupport?.flareCarriers||0)-1)*1000:0)+preferenceScore+probability-
      airScore.airGoalShortfall*10000,
    ...airScore,...jet?{jetAviation:jet}:{},opportunisticSupremacy:supremacyPreference>0,nightSupport,specialAttack,groundAttack,
    routePriority,routeChance:chance,assumedChance:assumed,
    graphHops:result.reachableHops||null,strengthProxy:strength,
    routeEconomy:{...difficulty,effectiveStrength,specialBonus,largeAirAttacks},
    carrierStrikeProxy:carrier,aviationBattleshipStrikeProxy:aviationBattleship,
    seaplaneStrikeProxy:seaplane,
    openingAirStrikeProxy:strike,
    surfaceStrengthProxy:combat.surface,nightStrengthProxy:combat.night,
    aswStrengthProxy:combat.asw,aswCombat:combat.physicalAsw,
    openingTorpedoCount:combat.openingTorpedoCount,
    openingTorpedoProxy:combat.openingTorpedoProxy,
    dayShellingRounds,oneOneSecondRoundProxy:oneOneSecondRound,
    aswShipCount:combat.aswShipCount,openingAswCount:combat.openingAswCount,openingAswUnknownCount:combat.openingAswUnknownCount,
    neededAswShips:combat.neededAsw,
    neededSurfaceShips:combat.neededSurface,
    fullSupplyCostProxy:cost,sortieCostProxy:sortieCost};
  };
}

module.exports={carrierStrike,combatHullRanker,openingAirStrike,openingTorpedo,plannedCombatStat,plannedTorpedoStat,routeRank,routeRanker};
