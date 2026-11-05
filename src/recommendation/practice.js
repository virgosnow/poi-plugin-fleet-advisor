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
  for(const id of targets)if(!positions.some(s=>s?.id===id))positions[positions.indexOf(null)]={id};
  // Previous automatic choices are optional: retain their positions when
  // possible, but never let them displace a manually selected training ship.
  if(explicitTargets&&variant!=='refresh')for(const [index,slot] of slots.slice(0,capacity).entries()){
    if(!slot||positions.some(s=>s?.id===slot.id)||!ctx.byId.get(slot.id)?.available)continue;
    const family=shipFamilyKey(ctx.byId.get(slot.id));
    if(positions.some(s=>s&&shipFamilyKey(ctx.byId.get(s.id))===family))continue;
    const place=positions[index]===null?index:positions.indexOf(null);
    if(place>=0)positions[place]=slot;
  }
  const chosen=positions.filter(Boolean),families=new Set(chosen.map(s=>shipFamilyKey(ctx.byId.get(s.id))));
  const rows=ctx.roster.filter(row=>!families.has(shipFamilyKey(row)));
  const pureAsw=enemy.known&&enemy.submarines===enemy.ships.length;
  const mixedAsw=enemy.known&&enemy.submarines>0&&!pureAsw;
  const inventoryAll=availableEquipment(store);
  const planeTypes=new Set(inventoryAll.map(item=>Number(item.master?.api_type?.[2])));
  const canFieldCarrier=variant!=='standard'&&variant!=='katori'&&variant!=='low-power'&&enemy.known&&!pureAsw&&enemy.carriers>0&&planeTypes.has(6)&&[7,8,57,58].some(t=>planeTypes.has(t));
  const isCarrier=row=>!!row&&[7,11,18].includes(row.stype)&&row.master.api_maxeq?.some(n=>Number(n)>0);
  const isAsw=row=>!!row&&[1,2,3,21,22].includes(row.stype)&&first(row.ship.api_taisen)>=35;
  const isKatori=row=>!!row&&row.stype===21;
  // Low-consumption ship types: DD, DE, CL, CT. Excludes BB, CV and other heavy
  // hulls that burn fuel and ammo (or bauxite) disproportionately in practice.
  const isLowPower=row=>!!row&&[1,2,3,21].includes(row.stype);
  const mixedAswWeight=mixedAsw?(variant==='standard'||variant==='katori'||variant==='low-power'?1.2:Math.min(.6,enemy.submarines/enemy.ships.length*1.2)):0;
  const strength=row=>pureAsw?([1,2,3,4,21,22].includes(row.stype)?100+first(row.ship.api_taisen)*2:Math.max(0,first(row.ship.api_taisen))):
    first(row.ship.api_karyoku)+first(row.ship.api_raisou)*.65+first(row.ship.api_taiku)*.3+
    first(row.ship.api_taisen)*mixedAswWeight+([7,11,18].includes(Number(row.master.api_stype))?50:0);
  for(let n=chosen.length;n<capacity;n++){
    let candidates=rows.filter(row=>!families.has(shipFamilyKey(row)));if(!candidates.length)break;
    // katori variant: seed available training cruisers first, before any other
    // strength-based selection. They unlock the 1.2x-1.6x XP bonus fleet-wide.
    if(variant==='katori'){
      const katoriFree=candidates.filter(isKatori);
      if(katoriFree.length&&!chosen.some(slot=>isKatori(ctx.byId.get(slot.id)))){
        // Take up to two training cruisers; the rest fill by strength.
        const slotsLeft=capacity-chosen.length;
        for(const k of katoriFree.slice(0,Math.min(2,slotsLeft))){
          if(!families.has(shipFamilyKey(k))){candidates=[k];break;}
        }
      }
    }
    // low-power variant: restrict candidates to low-consumption types so the
    // fleet avoids BB/CV fuel, ammo and bauxite costs entirely.
    if(variant==='low-power'){
      const low=candidates.filter(isLowPower);
      if(low.length)candidates=low;
    }
    // An observed carrier force warrants at least one usable carrier when the
    // player has both fighters and strike aircraft. Manual choices stay put.
    if(canFieldCarrier&&!chosen.some(slot=>isCarrier(ctx.byId.get(slot.id)))){
      const carriers=candidates.filter(isCarrier);if(carriers.length)candidates=carriers;
    }else if(variant!=='standard'&&variant!=='katori'&&variant!=='low-power'&&mixedAsw&&n>=2){
      // Preserve surface firepower; fill only the number of ASW escorts needed
      // for the known submarines instead of rewarding ASW on every ship.
      const needed=Math.min(3,enemy.submarines),existing=chosen.filter(slot=>isAsw(ctx.byId.get(slot.id))).length;
      if(existing<needed){const escorts=candidates.filter(isAsw);if(escorts.length)candidates=escorts;}
    }
    const max=Math.max(...candidates.map(strength));
    // First two slots by pure strength; remainder balance strength with a small
    // level-based bonus so lower-level training ships surface naturally.
    candidates.sort((a,b)=>{
      const score=row=>{
        const base=n<2?strength(row):
          strength(row)*.55+Math.max(0,100-Math.min(100,Number(row.ship.api_lv)||0))*.15+(strength(row)>=max*.55?18:0);
        return base-(variant==='economy'?Math.max(0,row.fuel+row.ammo-100)*.22:0);
      };
      return score(b)-score(a)||Number(b.ship.api_lv)-Number(a.ship.api_lv)||a.id-b.id;
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
  if(!pureAsw&&(enemy.submarines>0||enemy.carriers>0))variants.push('roles');
  if(args.trainingShipIds!==undefined&&Array.isArray(args.slots)&&args.slots.some(slot=>slot&&!slot.pin&&!Object.keys(slot.keep||{}).length&&
    !args.trainingShipIds.includes(slot.id)))variants.push('refresh');
  if(!pureAsw)variants.push('economy');
  const forecast=require('../domain/combat/practice_forecast'),resources=require('../domain/combat/practice_resources');
  const practiceExp=require('../domain/combat/practice_experience');
  // Evaluate by growth-weighted net XP: 99+ ships contribute nothing (no room
  // to grow), bauxite is weighted 5x (hard to restore), and low win rates
  // soften the score so a cheap fragile fleet cannot win on cost alone.
  const evaluate=result=>{
    const prediction=forecast.estimate(store,result.scheme,enemy,{samples:256});
    if(prediction.status!=='estimated')return null;
    const xp=practiceExp.estimateFromScenarios(store,result.scheme,args.opponent,prediction.xpScenarios);
    if(xp.status!=='estimated')return null;
    const cost=resources.estimate(store,result.scheme,{enemy});
    // Growth weight: 99+ ships have no growth room, so their XP does not count.
    const entries=result.scheme.ships;
    const growthWeighted=xp.expectedPerShip.reduce((sum,shipXp,i)=>{
      const ship=store.info.ships[entries[i].id];
      const lv=Number(ship?.api_lv)||0;
      return sum+shipXp*(lv>=99?0:1);
    },0);
    // Supply cost: fuel + ammo + bauxite*5 (aluminium is hard to restore).
    const fuel=cost.status==='known'?cost.fuel:0;
    const ammo=cost.status==='known'?(cost.ammoDay+cost.ammoNight)/2:0;
    const bauxite=cost.status==='known'&&cost.bauxite?cost.bauxite.max:0;
    const supply=fuel+ammo+bauxite*5;
    // Win rate soft cap: below 0.5 the growth XP is penalised proportionally.
    const p=Object.fromEntries(prediction.rows.map(row=>[row.label,row.count/prediction.samples]));
    const winRate=(p.S||0)+(p.A||0)+(p.B||0);
    const softCapped=winRate>=0.5?growthWeighted:growthWeighted*winRate*2;
    return {growthWeighted,expectedTotal:xp.expectedTotal,supply,winRate,netScore:softCapped-supply*0.01,
      expectedPerShip:xp.expectedPerShip};
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
    const cheaper=metrics.growthWeighted>=bestMetrics.growthWeighted*.95&&
      bestMetrics.supply>0&&metrics.supply<=bestMetrics.supply*.8;
    if(better||cheaper){best=result;bestMetrics=metrics;}
  }
  return best;
}
module.exports={opponentProfile,recommendPractice};
