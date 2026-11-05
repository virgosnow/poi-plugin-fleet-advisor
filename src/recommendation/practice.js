'use strict';
// Practice has no map routing. This is a bounded, transparent training/combat
// heuristic, not a victory-rate calculation or a claim about hidden gear.
const {context,schemeOf,shipFamilyKey}=require('./context');
const {availableEquipment,emptyLoadout,completeCombatLoadout}=require('./loadout/loadout_policy');
const {equipmentForFleet,assertFleetEquipment}=require('./loadout/equipment_borrowing');
const {createFleetPlanner}=require('../domain/fleet/fleet_plan');
const filters=require('../config/recommendation_filters');
const first=v=>Number(Array.isArray(v)?v[0]:v)||0;
function opponentProfile(store,opponent){
  if(!Array.isArray(opponent?.ships)||!opponent.ships.length)return {known:false,submarines:0,carriers:0,ships:[]};
  const ships=opponent.ships.map(ship=>({...ship,master:store.const.$ships?.[ship.masterId]}));
  if(ships.some(ship=>!ship.master))return {known:false,submarines:0,carriers:0,ships};
  return {known:true,ships,submarines:ships.filter(s=>[13,14].includes(Number(s.master.api_stype))).length,
    carriers:ships.filter(s=>[7,11,18].includes(Number(s.master.api_stype))).length};
}
// An incomplete master record must not be mistaken for a lightly armoured ship.
function opponentMaxArmor(enemy){
  if(!enemy.known||!enemy.ships.length)return null;
  const values=enemy.ships.map(({master})=>{
    const raw=Array.isArray(master.api_souk)?master.api_souk[1]:master.api_souk;
    if(raw===null||raw===undefined||typeof raw==='boolean'||(typeof raw==='string'&&!raw.trim()))return null;
    const value=Number(raw);
    return Number.isFinite(value)&&value>=0?value:null;
  });
  return values.some(value=>value===null)?null:Math.max(...values);
}
function recommendPracticeCandidate(store,{fleet=1,slots=[],settings,opponent,capacity=6,trainingShipIds}={},variant='standard'){
  if(!Number.isInteger(capacity)||capacity<1||capacity>6)throw Error('演习舰队规模应为 1 至 6 艘');
  if(!Array.isArray(slots))throw Error('舰队草稿格式无效');
  if(trainingShipIds!==undefined&&(!Array.isArray(trainingShipIds)||trainingShipIds.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(trainingShipIds).size!==trainingShipIds.length))
    throw Error('目标练级舰娘须为不重复的舰娘实例 ID');
  const explicitTargets=trainingShipIds!==undefined, targets=trainingShipIds||[];
  const options=filters.normalizeGroup('practice',settings),fixed=slots.filter(s=>s&&(!explicitTargets||s.pin||Object.keys(s.keep||{}).length)),ids=fixed.map(s=>s.id);
  if(fixed.length>capacity)throw Error(`当前已选 ${fixed.length} 艘舰娘，超过设定的 ${capacity} 艘；请调整舰队规模或移除舰娘`);
  if(slots.slice(capacity).some(s=>s&&fixed.includes(s)))throw Error(`已选舰娘的舰位超过 ${capacity} 艘，请调整舰队`);
  const required=[...ids,...targets.filter(id=>!ids.includes(id))];
  if(required.length>capacity)throw Error(`手动选择和目标练级舰娘共 ${required.length} 艘，超过 ${capacity} 艘；请移除部分舰娘`);
  const actual=store;store=filters.planningStore(store,options);
  const ctx=context(store,{fleet,fixedShipIds:required,automaticFilters:options},1),enemy=opponentProfile(store,opponent);
  const positions=Array(capacity).fill(null),targetSet=new Set(targets);
  slots.slice(0,capacity).forEach((slot,index)=>{if(slot&&(fixed.includes(slot)||targetSet.has(slot.id)))positions[index]=slot;});
  // If the first training target has no fixed slot yet, promote it to flagship
  // position (slot 0) when that position is free — flagship earns 3x base XP
  // vs escort's 2x, making it the single highest-value position to place a
  // target. Skip this if position 0 is pinned by a manual choice, or if the
  // target is already placed at a pinned position the user chose explicitly.
  if(explicitTargets&&targets.length>0&&positions[0]===null){
    const firstTarget=targets[0];
    const alreadyPinned=slots.slice(0,capacity).some(s=>s?.id===firstTarget&&(s.pin||Object.keys(s.keep||{}).length));
    if(!alreadyPinned){
      const index=positions.findIndex(s=>s?.id===firstTarget);
      positions[0]=index<0?{id:firstTarget}:positions[index];
      if(index>0)positions[index]=null;
    }
  }
  for(const id of targets)if(!positions.some(s=>s?.id===id))positions[positions.indexOf(null)]={id};
  // Previous automatic choices are optional: retain their positions when
  // possible, but never let them displace a manually selected training ship.
  if(explicitTargets&&variant!=='refresh')for(const [index,slot] of slots.slice(0,capacity).entries()){
    if(!slot||positions.some(s=>s?.id===slot.id)||!ctx.byId.get(slot.id)?.available)continue;
    if(variant===`replace:${index}`)continue;
    if(variant==='light-refresh'&&[8,9,10,12].includes(ctx.byId.get(slot.id).stype))continue;
    const family=shipFamilyKey(ctx.byId.get(slot.id));
    if(positions.some(s=>s&&shipFamilyKey(ctx.byId.get(s.id))===family))continue;
    const place=positions[index]===null?index:positions.indexOf(null);
    if(place>=0)positions[place]=slot;
  }
  const chosen=positions.filter(Boolean),initialChosenCount=chosen.length,families=new Set(chosen.map(s=>shipFamilyKey(ctx.byId.get(s.id))));
  const replacedIndex=/^replace:(\d+)$/.exec(variant);
  const replacedId=replacedIndex?slots[Number(replacedIndex[1])]?.id:undefined;
  const rows=ctx.roster.filter(row=>!families.has(shipFamilyKey(row))&&
    (required.includes(replacedId)||row.id!==replacedId));
  const pureAsw=enemy.known&&enemy.submarines===enemy.ships.length;
  const mixedAsw=enemy.known&&enemy.submarines>0&&!pureAsw;
  const inventoryAll=availableEquipment(store);
  const planeTypes=new Set(inventoryAll.map(item=>Number(item.master?.api_type?.[2])));
  const standardStyle=['standard','katori','low-power','balanced','light-refresh'].includes(variant)||!!replacedIndex;
  const canFieldCarrier=!standardStyle&&enemy.known&&!pureAsw&&enemy.carriers>0&&planeTypes.has(6)&&[7,8,57,58].some(t=>planeTypes.has(t));
  const isCarrier=row=>!!row&&[7,11,18].includes(row.stype)&&row.master.api_maxeq?.some(n=>Number(n)>0);
  const isAsw=row=>!!row&&[1,2,3,21,22].includes(row.stype)&&first(row.ship.api_taisen)>=35;
  const isKatori=row=>!!row&&row.stype===21;
  // Low-consumption ship types: DD, DE, CL, CT. Excludes BB, CV and other heavy
  // hulls that burn fuel and ammo (or bauxite) disproportionately in practice.
  const isLowPower=row=>!!row&&[1,2,3,21].includes(row.stype);
  const mixedAswWeight=mixedAsw?(standardStyle?1.2:Math.min(.6,enemy.submarines/enemy.ships.length*1.2)):0;
  // A bounded, linear heuristic gradually favours torpedoes and lighter hulls
  // against less armour. The endpoints are tuning choices, not game rules.
  // The balanced variant provides a firepower-oriented alternative to the
  // battle forecast; unknown armour falls back to the balanced weights.
  const maxEnemyArmor=opponentMaxArmor(enemy);
  const lightPreference=variant==='balanced'||maxEnemyArmor===null?0:Math.max(0,Math.min(1,(150-maxEnemyArmor)/100));
  const torpedoWeight=0.65+0.35*lightPreference;
  const bbPenalty=60*lightPreference;
  const strength=row=>pureAsw?([1,2,3,4,21,22].includes(row.stype)?100+first(row.ship.api_taisen)*2:Math.max(0,first(row.ship.api_taisen))):
    first(row.ship.api_karyoku)+first(row.ship.api_raisou)*torpedoWeight+first(row.ship.api_taiku)*.3+
    first(row.ship.api_taisen)*mixedAswWeight+([7,11,18].includes(Number(row.master.api_stype))?50:0)-
    ([8,9,10,12].includes(Number(row.master.api_stype))?bbPenalty:0);
  for(let n=chosen.length;n<capacity;n++){
    let candidates=rows.filter(row=>!families.has(shipFamilyKey(row)));if(!candidates.length)break;
    // katori variant: seed available training cruisers first, before any other
    // strength-based selection. They unlock the 1.2x-1.6x XP bonus fleet-wide.
    if(variant==='katori'){
      const katoriFree=candidates.filter(isKatori);
      if(katoriFree.length&&!chosen.some(slot=>isKatori(ctx.byId.get(slot.id)))){
        const slotsLeft=capacity-chosen.length;
        for(const k of katoriFree.slice(0,Math.min(2,slotsLeft))){
          if(!families.has(shipFamilyKey(k))){candidates=[k];break;}
        }
      }
    }
    if(variant==='low-power'){
      const low=candidates.filter(isLowPower);
      if(low.length)candidates=low;
    }
    if(variant==='light-refresh'){
      const light=candidates.filter(row=>[1,2,3,4,21,22].includes(row.stype));
      if(light.length)candidates=light;
    }
    if(canFieldCarrier&&!chosen.some(slot=>isCarrier(ctx.byId.get(slot.id)))){
      const carriers=candidates.filter(isCarrier);if(carriers.length)candidates=carriers;
    }else if(!standardStyle&&mixedAsw&&n>=2){
      const needed=Math.min(3,enemy.submarines),existing=chosen.filter(slot=>isAsw(ctx.byId.get(slot.id))).length;
      if(existing<needed){const escorts=candidates.filter(isAsw);if(escorts.length)candidates=escorts;}
    }
    const max=Math.max(...candidates.map(strength));
    // Scale the number of anchor slots (picked by raw strength) with the
    // observed opponent fleet size. More enemy ships means more incoming
    // fire and a higher firepower floor to keep S+A ≥ 90%.
    // 1–2 enemies → 1 anchor; 3–4 → 2; 5–6 → 3.
    const opponentSize=enemy.known?enemy.ships.length:1;
    const requiredAnchors=opponentSize>=5?3:opponentSize>=3?2:1;
    // Count chosen ships that pass the anchor strength threshold (~top 40%).
    const maxRosterStrength=Math.max(...ctx.roster.map(strength))||1;
    const strongCount=chosen.filter(s=>{const r=ctx.byId.get(s.id);return r&&strength(r)>=maxRosterStrength*.4;}).length;
    const needsAnchor=strongCount<requiredAnchors||(variant==='light-refresh'&&n===initialChosenCount);
    candidates.sort((a,b)=>{
      const score=row=>{
        if(needsAnchor)return strength(row);
        // After anchors are filled: reward low level (= growth potential) and
        // low cost. Exclude hulls below 35% of the max strength floor.
        if(strength(row)<max*.35)return -Infinity;
        const lv=Number(row.ship.api_lv)||0;
        // Level 1 ships are nearly unusable and often just built/received; avoid
        // them unless the player explicitly added them as a training target.
        const isTarget=targets.includes(row.id);
        if(lv<=1&&!isTarget)return -Infinity;
        // Carriers bring attack aircraft that suffer heavy bauxite loss under
        // anti-air fire. Penalise them strongly outside the anchor slot.
        const isCarrierHull=[7,11,18].includes(row.stype);
        const levelBonus=Math.max(0,100-Math.min(100,lv))*1.2;
        const costPenalty=Math.max(0,row.fuel+row.ammo-100)*.3;
        const carrierPenalty=isCarrierHull?80:0;
        return levelBonus-costPenalty-carrierPenalty+(isKatori(row)?30:0);
      };
      return score(b)-score(a)||Number(a.ship.api_lv)-Number(b.ship.api_lv)||a.id-b.id;
    });
    const row=candidates[0];families.add(shipFamilyKey(row));const next={id:row.id};chosen.push(next);positions[positions.indexOf(null)]=next;
  }
  if(!chosen.length)throw Error('没有符合演习设置的可用舰娘');
  if(positions.some((slot,index)=>slot===null&&positions.slice(index+1).some(Boolean)))throw Error('可用舰娘不足，无法保留已选舰娘的位置');
  const ordered=positions.filter(Boolean),raw=schemeOf(fleet,ordered),held=fixed.map(s=>({...s,keep:s.keep||{}}));
  const inventory=equipmentForFleet(inventoryAll,chosen,options);
  // Practice is a single encounter, not a normal-map route. Inventing a
  // route here makes shared loadout code look for nonexistent route data.
  const profile=enemy.known?{area:'practice',targetNodes:['P'],
    mapPreview:{nodes:[{id:'P',kind:enemy.submarines===enemy.ships.length?'asw':'battle',submarines:{maximum:enemy.submarines}}]},
    counts:{asw:{maximum:enemy.submarines===enemy.ships.length?1:0},surface:{maximum:enemy.submarines===enemy.ships.length?0:1}}}:null;
  const blank=emptyLoadout(store,raw,held),scheme=completeCombatLoadout(store,blank,inventory,{area:'practice',asw:enemy.submarines>0,pureAsw,profile,heldSlots:held});
  assertFleetEquipment(scheme,inventory,options);createFleetPlanner(()=>store).preview('fleet',scheme);
  let planningOnly=false;
  if(actual!==store)try{createFleetPlanner(()=>actual).preview('fleet',scheme);}catch(_){planningOnly=true;}
  return {scheme,enemyKnown:enemy.known,planningOnly};
}
// Compare a small set of legal, independently refitted fleets. The battle
// model assumes opponent equipment; use it only for relative ranking, never
// as a guaranteed victory rate. Unknown projections keep the original plan.
function recommendPractice(store,args={}){
  const {resolvePracticeCodes}=require('../domain/quests/practice_quests');
  const quests=resolvePracticeCodes(args.questCodes||[]),{createQuestChecker,questSeeds}=require('./quest_constraints');
  const questMatches=createQuestChecker(store,quests);
  let base=recommendPracticeCandidate(store,args,'standard');
  if(quests.length&&!questMatches(base.scheme)){
    const settings=filters.normalizeGroup('practice',args.settings),planning=filters.planningStore(store,settings),slots=args.slots||[],targets=args.trainingShipIds||[];
    const fixed=slots.filter(slot=>slot&&(args.trainingShipIds===undefined||slot.pin||Object.keys(slot.keep||{}).length));
    const required=[...new Set([...fixed.map(slot=>slot.id),...targets])],capacity=args.capacity??6;
    const ctx=context(planning,{fleet:args.fleet??1,fixedShipIds:required,automaticFilters:settings},1),holds=Array(capacity).fill(null);
    slots.slice(0,capacity).forEach((slot,index)=>{if(slot&&(fixed.includes(slot)||targets.includes(slot.id)))holds[index]={...slot,pin:true};});
    for(const id of targets)if(!holds.some(slot=>slot?.id===id)){const index=holds.indexOf(null);if(index<0)throw Error('预选舰娘与任务条件冲突');holds[index]={id,pin:true,keep:{}};}
    // Training targets are mandatory hulls, but unlike manual pins they may
    // move when a selected task requires a different flagship or position.
    const relaxed=holds.map(slot=>slot&&fixed.some(item=>item.id===slot.id)?slot:null);
    let candidate=null;const forecast=require('../domain/combat/practice_forecast'),practiceExp=require('../domain/combat/practice_experience'),enemy=opponentProfile(store,args.opponent);let best=-Infinity;
    for(const locked of [holds,...(holds.some((slot,i)=>slot&&!relaxed[i])?[relaxed]:[])]){
      const seeds=questSeeds(planning,ctx,{heldSlots:locked},quests).filter(rows=>rows.length===capacity).slice(0,12);
      for(const rows of seeds){try{
        const draft=rows.map((row,index)=>locked[index]?.id===row.id?locked[index]:{id:row.id,pin:true,keep:{}});
        const result=recommendPracticeCandidate(store,{...args,slots:draft},'standard');if(!questMatches(result.scheme))continue;
        let score=0;if(enemy.known){
          const prediction=forecast.estimate(store,result.scheme,enemy,{samples:128});
          if(prediction.status==='estimated'){const xp=practiceExp.estimateFromScenarios(store,result.scheme,args.opponent,prediction.xpScenarios);
            if(xp.status==='estimated')score=xp.expectedTotal;}}
        if(!candidate||score>best){candidate=result;best=score;}
      }catch(_){/* A seed may conflict with equipment availability; try the next. */}}
      if(candidate)break;
    }
    if(!candidate)throw Error('未找到同时满足所选演习任务和固定舰娘的编成，请检查舰娘、装备与筛选设置');
    base=candidate;
  }
  const enemy=opponentProfile(store,args.opponent);
  if(!enemy.known||!enemy.ships.length)return base;
  const pureAsw=enemy.submarines===enemy.ships.length;
  // katori: prioritise available training cruisers for the XP bonus.
  // low-power: prefer low-consumption ship types (DD/CL) over BB/CV.
  const variants=['katori','low-power'];
  if(!pureAsw)variants.push('balanced');
  if(!pureAsw&&(enemy.submarines>0||enemy.carriers>0))variants.push('roles');
  if(args.trainingShipIds!==undefined&&Array.isArray(args.slots)&&args.slots.some(slot=>slot&&!slot.pin&&!Object.keys(slot.keep||{}).length&&
    !args.trainingShipIds.includes(slot.id)))variants.push('refresh');
  let optionalBattleship=false;
  if(Array.isArray(args.trainingShipIds)&&Array.isArray(args.slots))args.slots.forEach((slot,index)=>{
    if(!slot||slot.pin||Object.keys(slot.keep||{}).length||args.trainingShipIds.includes(slot.id))return;
    const ship=store.info.ships[slot.id],master=store.const.$ships?.[ship?.api_ship_id];
    const battleship=[8,9,10,12].includes(Number(master?.api_stype));
    if(ship&&(Number(ship.api_lv)>=90||battleship))variants.push(`replace:${index}`);
    if(battleship)optionalBattleship=true;
  });
  if(optionalBattleship&&!pureAsw)variants.push('light-refresh');
  if(!pureAsw)variants.push('economy');
  const forecast=require('../domain/combat/practice_forecast'),resources=require('../domain/combat/practice_resources');
  const practiceExp=require('../domain/combat/practice_experience');
  // Evaluate by growth-weighted net XP: higher-level escorts get less weight,
  // bauxite is weighted 5x (hard to restore), and low win rates
  // soften the score so a cheap fragile fleet cannot win on cost alone.
  const evaluate=result=>{
    const prediction=forecast.estimate(store,result.scheme,enemy,{samples:256});
    if(prediction.status!=='estimated')return null;
    const xp=practiceExp.estimateFromScenarios(store,result.scheme,args.opponent,prediction.xpScenarios);
    if(xp.status!=='estimated')return null;
    const cost=resources.estimate(store,result.scheme,{enemy});
    // Explicit training targets always get their full 3x weight. For automatic
    // escorts, taper the value gradually after level 75 instead of treating a
    // nearly level-99 ship like a low-level trainee or assuming 99 is a cap.
    const trainingSet=new Set(args.trainingShipIds||[]);
    const entries=result.scheme.ships;
    const growthWeighted=xp.expectedPerShip.reduce((sum,shipXp,i)=>{
      const ship=store.info.ships[entries[i].id];
      const lv=Number(ship?.api_lv)||0;
      const w=trainingSet.has(entries[i].id)?3:Math.max(.2,Math.min(1,(100-lv)/25));
      return sum+shipXp*w;
    },0);
    // MVP bonus: reward configurations where a training target is the MVP.
    // Count how often trainingShipIds[0] lands at mvpIndex across scenarios.
    const primaryTarget=args.trainingShipIds?.[0];
    let mvpRate=0;
    if(primaryTarget&&prediction.xpScenarios?.length){
      const primaryPos=entries.findIndex(e=>e.id===primaryTarget);
      if(primaryPos>=0){
        const mvpCount=prediction.xpScenarios.filter(s=>s.ownHp[primaryPos]>0&&s.mvpIndex===primaryPos).length;
        mvpRate=mvpCount/prediction.xpScenarios.length;
      }
    }
    // Supply cost: fuel + ammo + bauxite*5 (aluminium is hard to restore).
    const fuel=cost.status==='known'?cost.fuel:0;
    const ammo=cost.status==='known'?(cost.ammoDay+cost.ammoNight)/2:0;
    const bauxite=cost.status==='known'&&cost.bauxite?cost.bauxite.max:0;
    const supply=fuel+ammo+bauxite*5;
    // Win-rate gate: target S+A ≥ 90%. Below the target the growth XP is
    // penalised quadratically so fleets that miss the threshold cannot win
    // on raw XP alone. B-rank counts for the win but not for the SA target.
    const p=Object.fromEntries(prediction.rows.map(row=>[row.label,row.count/prediction.samples]));
    const saRate=(p.S||0)+(p.A||0);
    const winRate=saRate+(p.B||0);
    const WIN_TARGET=0.9;
    const softCapped=saRate>=WIN_TARGET?growthWeighted:growthWeighted*Math.pow(saRate/WIN_TARGET,2);
    // mvpRate bonus: a configuration where the primary training target reliably
    // takes MVP is worth a meaningful bump — each extra MVP doubles that ship's
    // XP, which at 3x training weight is a 6x vs 3x difference per scenario.
    const mvpBonus=softCapped*mvpRate*0.5;
    return {growthWeighted,expectedTotal:xp.expectedTotal,supply,winRate,saRate,mvpRate,
      netScore:softCapped+mvpBonus-supply*0.01,expectedPerShip:xp.expectedPerShip};
  };
  let best=base,bestMetrics;try{bestMetrics=evaluate(base);}catch(_){return base;}
  if(!bestMetrics)return base;
  const seen=new Set([JSON.stringify(base.scheme)]);
  for(const variant of variants){
    let result,metrics;try{result=recommendPracticeCandidate(store,args,variant);const key=JSON.stringify(result.scheme);
      if(seen.has(key)||!questMatches(result.scheme))continue;seen.add(key);metrics=evaluate(result);}catch(_){continue;}
    if(!metrics)continue;
    // Primary: net score (growth-weighted XP minus supply penalty). A variant
    // wins if it improves net score by more than 1%, or if it stays within 5%
    // of the growth XP while cutting supply by at least 20%.
    const better=metrics.netScore>bestMetrics.netScore*1.01;
    const comparableSuccess=(metrics.saRate>=.9||metrics.saRate>=bestMetrics.saRate)&&
      metrics.saRate>=bestMetrics.saRate-.03;
    const cheaper=comparableSuccess&&metrics.growthWeighted>=bestMetrics.growthWeighted*.95&&
      bestMetrics.supply>0&&metrics.supply<=bestMetrics.supply*.8;
    if(better||cheaper){best=result;bestMetrics=metrics;}
  }
  return best;
}
module.exports={opponentProfile,recommendPractice};
