'use strict';
const perf=require('../shared/performance_trace');
// Bounded normal-map search, batch evaluation and final loadout validation.
const {withEquipmentIndexCache,snapshotMemo}=require('../domain/fleet/equipment_planner');
const {error}=require('../shared/errors');
const {canEquip,acceptsOtherSlot}=require('../domain/fleet/equipment_rules');
const {orderEquipment,orderAircraftSlots}=require('../domain/fleet/equipment_order');
const {groundLoadout,groundLoadouts}=require('./loadout/ground_fitting');
const {aviationBattleshipLoadouts}=require('./loadout/aviation_fitting');
const {routeGroundTargets}=require('../domain/combat/installation_attack');
const {nightLoadout}=require('./loadout/night_equipment');
const {jetLoadouts}=require('./loadout/jet_fitting');
const {jetCutInAllowed}=require('./loadout/carrier_policy');
const {specialAttackCores,arrangeSpecialAttack}=require('../domain/combat/special_attacks');
const {speed}=require('../domain/fleet/fleet_metrics');
const routes=require('../domain/routes/normal_routes');
const routePlans=require('../domain/routes/route_plans');
const {speedLoadout}=require('../domain/routes/route_speed');
const {fitRouteLoS,selectLoSFinalists}=require('../domain/routes/route_los');
const {emptyLoadout,completeCombatLoadout,availableEquipment,aswEscortLimit,aswEscortIds}=require('./loadout/loadout_policy');
const {profileForRoute,previewForMap}=require('../domain/routes/sortie_profile');
const aswCombat=require('../domain/combat/asw_combat');
const {fitAswLoadouts}=require('./loadout/asw_fitting');
const NORMAL_PREFERENCES=['shortest','strongest','lowestConsumption'];
const selectionFilters=require('../config/recommendation_filters');
const {routeAirReference}=require('../domain/routes/route_air');
const {aswPotential,context,hasDuplicateShipFamily,holdDraftEquipment,idsKey,oaswCapableNow,schemeOf,shipCost,shipFamilyKey,stableHash,usableSlots}=require('./context');
const {airLoadout,fitGuideStrategy,gearVariant,oneOneOpeningLoadout,routingLoadout,speedHolds,strategyFailure,surfaceLoadout}=require('./fitting');
const {combatHullRanker,plannedCombatStat,plannedTorpedoStat,routeRank,routeRanker}=require('./scoring');
const {positionUpgrades,combineUpgrades,finalHullUpgrades}=require('./refinement');
const {routeDifficulty}=require('./route_economy');
const {fleetOrderChoices}=require('./fleet_order');
const {THREE_FIVE_MIN_LEVEL,THREE_FIVE_UPPER_MIN_AIR,guideHull,guidePolicy,guideReady,guideSeeds,guideShipAllowed,guideSource,oneOneSeeds,remainingSlots,specialFleetSeeds,specialPositionLocks,threeFiveSeeds,threeFiveStyle}=require('./strategies');

function confirmedRouteEvidence(route,profile){
  const paths=(profile?.routePaths||[]).map(path=>({selectedPath:path.nodes,
    pathChance:routePlans.planningPath(route,path.nodes,{allowTentative:false}).chance}));
  return paths.filter(path=>path.pathChance.probability>0).sort((a,b)=>
    b.pathChance.probability-a.pathChance.probability||a.selectedPath.length-b.selectedPath.length||
    a.selectedPath.join('>').localeCompare(b.selectedPath.join('>')))[0]||null;
}
function defaultRouteDiagnostics(route,profile,target){
  const paths=profile?.routePaths?.length?profile.routePaths:previewForMap(route.area,{target,phase:route.phase}).routePaths;
  const choices=paths.map(path=>({nodes:path.nodes,
    chance:routePlans.planningPath(route,path.nodes,{allowTentative:false}).chance})).sort((a,b)=>
    b.chance.min-a.chance.min||b.chance.max-a.chance.max||a.nodes.length-b.nodes.length);
  return choices.length?routePlans.routeDiagnostics(route,choices[0]):null;
}
function candidatePool(ctx,mode,wantsASW){
  const groups=new Map();
  for(const row of ctx.roster){if(!groups.has(row.stype))groups.set(row.stype,[]);groups.get(row.stype).push(row);}
  const chosen=new Map(ctx.fixed.map(id=>[id,ctx.byId.get(id)]));
  for(const group of groups.values()){
    const cheap=group.slice().sort((a,b)=>shipCost(a)-shipCost(b)||b.level-a.level||a.id-b.id);
    const strong=group.slice().sort((a,b)=>b.power-a.power||a.id-b.id);
    const equipped=group.slice().sort((a,b)=>{
      const gear=row=>(row.ship.api_slot||[]).filter(id=>id>0).length;
      return gear(b)-gear(a)||b.level-a.level||a.id-b.id;
    });
    // submarine maps: ships whose current build can already open with ASW
    // enter the pool directly so the search can actually assemble them
    const oasw=wantsASW?group.filter(row=>oaswCapableNow(ctx.store,row)):[];
    const asw=wantsASW?group.slice().sort((a,b)=>
      aswPotential(ctx.store,b)-aswPotential(ctx.store,a)||a.id-b.id)
      .filter(row=>Number.isFinite(aswPotential(ctx.store,row))).slice(0,12):[];
    for(const row of [...cheap.slice(0,mode==='lowestConsumption'||mode==='all'?8:5),
      ...strong.slice(0,mode==='strongest'||mode==='all'?8:5),...equipped.slice(0,4),
      ...oasw.slice(0,8),...asw])chosen.set(row.id,row);
  }
  return [...chosen.values()].sort((a,b)=>a.id-b.id);
}
// 3-5 has two materially different wiki攻略 routes. The level floor is a
// recommender safety heuristic, not a route requirement or a wiki threshold.
function candidateEvaluator(store,args,ctx,inventory){
  const factories=snapshotMemo(store,'search.evaluatorFactories',inventory,()=>new Map()),key=JSON.stringify(args);
  if(factories.has(key)){perf.count('candidate.setup.hit');return factories.get(key);}
  perf.count('candidate.setup.miss');
  const evaluator=prepareCandidateEvaluator(store,structuredClone(args),ctx,inventory);
  factories.set(key,evaluator);return evaluator;
}
function prepareCandidateEvaluator(store,args,ctx,inventory){
  const {area,target='boss',phase,airGoal='ignore',preference='all'}=args;
  const byRoute=args.byRoute===true,policy=guidePolicy(area,target,phase);
  const modes=byRoute||preference==='all'?NORMAL_PREFERENCES:[preference];
  const available=new Map(inventory.map(i=>[i.id,i]));
  const fittingProfile=previewForMap(area,{target,phase});
  const initialWantsAsw=aswEscortLimit(fittingProfile,store)>0;
  const cache=snapshotMemo(store,'search.candidates',JSON.stringify(args),()=>new Map());
  const inputs=snapshotMemo(store,'search.candidateInputs',JSON.stringify(args),()=>new Map());
  const rememberInput=(key,candidate)=>{
    if(inputs.size>=4096&&!inputs.has(key))inputs.delete(inputs.keys().next().value);
    inputs.set(key,candidate);return candidate;
  };
  return (rows,schemeOverride,preserveLoadout=false)=>{
    try{
      const heldScheme=holdDraftEquipment(store,schemeOverride||emptyLoadout(store,schemeOf(ctx.fleet,rows),args.heldSlots),args.heldSlots);
      const inputKey=JSON.stringify([heldScheme,preserveLoadout]);
      if(inputs.has(inputKey)){perf.count('candidate.inputHit');return {...inputs.get(inputKey),donorShipIds:[]};}
      const scheme=orderAircraftSlots(store,preserveLoadout?heldScheme:completeCombatLoadout(store,heldScheme,inventory,{area,asw:initialWantsAsw,profile:fittingProfile,heldSlots:args.heldSlots}),args.heldSlots);
      const signature=JSON.stringify(scheme);
      if(cache.has(signature)){perf.count('candidate.hit');rememberInput(inputKey,cache.get(signature));return {...cache.get(signature),donorShipIds:[]};}
      perf.count('candidate.miss');
      if(!jetCutInAllowed(store,scheme,args.heldSlots))return null;
      rows=scheme.ships.map(s=>ctx.byId.get(s.id));
      // Validate slot feasibility during search; build the costly click plan
      // only for ranked finalists, and never return one without full preview.
      const allocated=new Set();
      for(const entry of scheme.ships){
        let gap=false;
        for(const [k,id] of entry.slots.map((id,k)=>[k,id]).concat([['ex',entry.ex]])){
          if(id<=0){if(k!=='ex')gap=true;continue;}
          const item=available.get(id);
          if(k!=='ex'&&gap||!item||allocated.has(id)||!canEquip(store,entry.id,id,k)||
            item.sourceShipId&&item.sourceShipId!==entry.id&&!acceptsOtherSlot(store,entry.id,id,k))throw Error('invalid candidate equipment');
          allocated.add(id);
        }
      }
      const route=routes.evaluateSearchRoute(store,{area,target,phase,fleet:ctx.fleet,scheme});
      const profile=profileForRoute(area,route);
      const rank=routeRanker(route,profile,rows,airGoal,area,store,scheme,byRoute);
      const scoresByPreference=Object.fromEntries(modes.map(mode=>[mode,rank(mode)]));
      const scores=scoresByPreference[modes[0]];
      const candidate={scheme,route,profile,scores,scoresByPreference,
        guideSuitable:!!policy&&guideReady(policy,area,phase,store,scheme,rows,route,profile),
        guideStyle:area==='3-5'&&target==='boss'?
          threeFiveStyle(store,scheme,rows,route,profile):null,
        routeAfterEquipPending:route.lineOfSight?.status==='estimate'&&
          route.chanceRange?.[0]!==1,
        donorShipIds:[]};
      if(cache.size>=4096)cache.delete(cache.keys().next().value);
      cache.set(signature,candidate);
      rememberInput(inputKey,candidate);
      return candidate;
    }catch(_){/* invalid candidate, continue bounded search */}
  };
}
// Independent route facts can be prepared beside each initial candidate in its
// worker. Selection, stable ties and later dependent fitting stay coordinated.
function candidatePathScores(store,seed,option,airGoal,area,rows){
  const profile=profileForRoute(area,seed.route,routePlans.optionPaths(option));
  return routeRank(seed.route,profile,rows,'strongest',airGoal,area,store,seed.scheme,true);
}
function candidatePathFacts(store,candidate,options,args,ctx){
  if(!candidate)return [];
  return options.map(option=>{
    const eligible=routePlans.fleetRequirementAssessment(candidate.route,option).eligible;
    if(!eligible)return [option.key,{eligible}];
    const paths=routePlans.optionPaths(option);
    const hullPossible=paths.some(nodes=>routePlans.hullPath(candidate.route,nodes).max>0);
    const planning=routePlans.optionPlanning(candidate.route,option);
    const chance=routePlans.strategyAssessment(candidate.route,option)?.chance||planning.chance;
    const scores=hullPossible?candidatePathScores(store,candidate,option,args.airGoal||'ignore',args.area,
      candidate.scheme.ships.map(s=>ctx.byId.get(s.id))):null;
    return [option.key,{eligible,hullPossible,planning,chance,scores}];
  });
}
function recommendationBatch(store,batch){
  return perf.withDetails({batch:batch.finalGround?'gear-final-ground':batch.finalAsw?'gear-final-asw':batch.kind},()=>
    routePlans.withPlanningCache(()=>calculateBatch(store,batch)));
}
function calculateBatch(store,batch){
  const {args,items,kind}=batch,{area,phase,airGoal='ignore'}=args;
  const ctx=context(store,args,1),inventory=availableEquipment(store);
  if(kind==='hulls'){
    ctx.combatScore=combatHullRanker(store,previewForMap(area,{target:args.target||'boss',phase}));
    return (batch.serial?[undefined]:items).map(shard=>routePlans.hullSeeds(ctx,
      {...batch.options,shard,partial:true},shipFamilyKey));
  }
  const evaluator=candidateEvaluator(store,args,ctx,inventory);
  const evaluate=(...values)=>{
    const candidate=evaluator(...values);
    if(candidate&&batch.routes&&!['seeds','combat','refinement'].includes(kind)&&candidate.scores.assumedChance[1]>0)
      candidate.preparedPaths=candidatePathFacts(store,candidate,batch.routes,args,ctx);
    return candidate;
  };
  if(kind==='seeds')return items.map(ids=>{
    const candidate=evaluate(ids.map(id=>ctx.byId.get(id)));
    return batch.routes?{candidate,paths:candidatePathFacts(store,candidate,batch.routes,args,ctx)}:candidate;
  });
  if(kind==='refinement')return items.map(({ids,base,option})=>{
    const rows=ids.map(id=>ctx.byId.get(id));let attempts=0;
    const result=candidate=>({candidate,attempts,paths:candidatePathFacts(store,candidate,[option],args,ctx)});
    if(!rows.length||rows.length>6||new Set(ids).size!==ids.length||hasDuplicateShipFamily(rows)||
      args.byRoute!==true&&!guideHull(guidePolicy(area,args.target||'boss',phase),rows))return result(null);
    const scheme={fleet:ctx.fleet,ships:base.scheme.ships.map((entry,i)=>{
      const row=rows[i];if(row.id===entry.id)return entry;
      const keep=(id,slot)=>{try{return id>0&&canEquip(store,row.id,id,slot)&&acceptsOtherSlot(store,row.id,id,slot)?id:-1;}catch(_){return -1;}};
      return {id:row.id,slots:usableSlots(store,row.id).map((_,slot)=>keep(entry.slots[slot],slot)),
        ex:row.ship.api_slot_ex===0?-1:keep(entry.ex,'ex')};
    })};
    let trial=evaluate(rows,scheme);if(!trial)return result(null);
    let fitted=trial.scheme;
    if(option.strategy){const v=fitGuideStrategy(store,fitted,inventory,option,args.heldSlots);if(v)fitted=v;}
    const held=option.strategy?speedHolds(store,fitted,args.heldSlots):args.heldSlots;
    for(const need of routePlans.routingNeeds(trial.route,routePlans.optionPlanning(trial.route,option).nodes||option.nodes)){
      const v=routingLoadout(store,fitted,inventory,need,held);if(v)fitted=v;
    }
    if(fitted!==trial.scheme){trial=evaluate(rows,fitted);if(!trial)return result(null);}
    const air=candidatePathScores(store,trial,option,airGoal,area,trial.scheme.ships.map(s=>ctx.byId.get(s.id)));
    if(airGoal!=='ignore'){const v=airLoadout(store,fitted,inventory,air.airGoalRequired,air.routeAirReference,airGoal,held);if(v)fitted=v;}
    if(base.profile?.counts?.night?.maximum){const v=nightLoadout(store,fitted,inventory,{normalizeGuns:true,nightBattles:base.profile.counts.night.maximum,heldSlots:held});if(v)fitted=v;}
    trial=evaluate(rows,fitted);attempts++;
    if(!trial)return result(null);
    const plan=routePlans.optionPlanning(trial.route,option),nodes=plan.nodes||option.nodes;
    if(plan.losShortfall>0){
      const v=gearVariant(store,trial.scheme,inventory,'los',base.profile,area,phase,{heldSlots:args.heldSlots,maxPlacements:12,allowCombatLoss:true,
        stopWhen:value=>{const route=routes.evaluateSearchRoute(store,{area,target:args.target||'boss',phase,fleet:ctx.fleet,scheme:holdDraftEquipment(store,value,args.heldSlots)});
          const plan=routePlans.optionPlanning(route,option);return plan.chance.max>0&&plan.losShortfall===0;}});
      if(v){trial=evaluate(rows,v)||trial;attempts++;}
    }
    const los=fitRouteLoS(store,trial.scheme,inventory,{route:trial.route,nodes,heldSlots:held});
    if(los){trial=evaluate(rows,los)||trial;attempts++;}
    return result(trial);
  });
  if(['path-fit','los-fit','combat','speed-fit','speed-refit'].includes(kind))return items.map(item=>{
    const rows=(['combat','speed-fit'].includes(kind)?item:item.scheme.ships.map(s=>s.id)).map(id=>ctx.byId.get(id));
    const candidates=[];let attempts=0;
    const evaluateFit=scheme=>{
      attempts++;
      // Keep the coordinator's candidate admission rules for the serial and
      // threaded paths alike. Trial fitting never changes candidate order.
      if(!rows.length||rows.length>6||new Set(rows.map(r=>r.id)).size!==rows.length||
        hasDuplicateShipFamily(rows)||args.byRoute!==true&&!guideHull(guidePolicy(area,args.target||'boss',phase),rows))return;
      candidates.push(evaluate(rows,scheme));
    };
    if(kind==='combat')evaluateFit(emptyLoadout(store,schemeOf(ctx.fleet,rows),args.heldSlots));
    else if(kind==='speed-fit'){
      const fitted=fitGuideStrategy(store,emptyLoadout(store,schemeOf(ctx.fleet,rows),args.heldSlots),inventory,batch.option,args.heldSlots);
      if(fitted)evaluateFit(fitted);
    }else if(kind==='speed-refit'){
      const held=speedHolds(store,item.scheme,args.heldSlots),score=item.score;
      let fitted=airGoal==='ignore'?item.scheme:
        airLoadout(store,item.scheme,inventory,score.airGoalRequired,score.routeAirReference,airGoal,held)||item.scheme;
      const route=routes.evaluateSearchRoute(store,{area,target:args.target||'boss',phase,fleet:ctx.fleet,scheme:fitted});
      fitted=fitRouteLoS(store,fitted,inventory,{route,nodes:batch.option.nodes,heldSlots:held})||fitted;
      if(fitted!==item.scheme)evaluateFit(fitted);
    }else if(kind==='los-fit'){
      const held=batch.option.strategy?speedHolds(store,item.scheme,args.heldSlots):args.heldSlots;
      const fitted=fitRouteLoS(store,item.scheme,inventory,{route:item.route,nodes:batch.option.nodes,heldSlots:held});
      if(fitted)evaluateFit(fitted);
    }else{
      const {option}=batch;let fitted=item.scheme;
      if(airGoal!=='ignore'){
        const next=airLoadout(store,fitted,inventory,item.score.airGoalRequired,item.score.routeAirReference,airGoal,args.heldSlots);
        if(next)fitted=holdDraftEquipment(store,next,args.heldSlots);
      }
      for(const need of routePlans.routingNeeds(item.route,item.nodes)){
        const next=routingLoadout(store,fitted,inventory,need,args.heldSlots);
        if(next)fitted=holdDraftEquipment(store,next,args.heldSlots);
      }
      // An untouched scheme already has an exact route assessment. This is
      // request-local reuse, never a hull estimate or a cross-snapshot result.
      const preparedRoute=fitted===item.scheme?item.route:
        routes.evaluateSearchRoute(store,{area,target:args.target||'boss',phase,fleet:ctx.fleet,scheme:fitted});
      if(fitted!==item.scheme)evaluateFit(fitted);
      if(airGoal!=='ignore'){
        const profile=profileForRoute(area,preparedRoute,routePlans.optionPaths(option));
        const reference=routeAirReference(preparedRoute,area,profile);
        const air=airLoadout(store,fitted,inventory,reference[airGoal],reference,airGoal,args.heldSlots);
        if(air)evaluateFit(air);
      }
      if(routePlans.optionPlanning(preparedRoute,option).losShortfall){
        const fit=gearVariant(store,fitted,inventory,'los',item.profile,area,phase,{heldSlots:args.heldSlots,maxPlacements:24,allowCombatLoss:true,
          stopWhen:scheme=>{const held=holdDraftEquipment(store,scheme,args.heldSlots);
            const route=routes.evaluateSearchRoute(store,{area,target:args.target||'boss',phase,fleet:ctx.fleet,scheme:held});
            const check=routePlans.optionPlanning(route,option);return check.chance.max>0&&check.losShortfall===0;}});
        if(fit)evaluateFit(fit);
      }
    }
    return {candidates,attempts,...(kind==='combat'?{
      paths:candidatePathFacts(store,candidates[0],batch.routes||[],args,ctx)}:{})};
  });
  if(kind!=='gear')throw Error('Unknown recommendation batch');
  const {gearKinds}=batch,byRoute=args.byRoute===true,policy=guidePolicy(area,args.target||'boss',phase);
  return items.map(seed=>{
    const rows=seed.scheme.ships.map(s=>ctx.byId.get(s.id)),singles=[],combinedRows=[];
    // Worker messages clone references. Reuse this worker's static reference
    // for the exact same paths so aviation trial caches survive batch changes.
    const reference=batch.finalGround?routeAirReference({},area,{examples:seed.profile.examples}):seed.scores.routeAirReference?.paths?
      routeAirReference({},area,{examples:seed.scores.routeAirReference.paths}):seed.scores.routeAirReference;
    let attempts=0;
    for(const kind of gearKinds){
      if(kind==='jets'||kind==='aviation'){
        const variants=kind==='jets'?jetLoadouts(store,seed.scheme,inventory,{heldSlots:args.heldSlots}):
          aviationBattleshipLoadouts(store,seed.scheme,inventory,{area,profile:seed.profile,heldSlots:args.heldSlots});
        for(const variant of variants){
          attempts++;singles.push(evaluate(rows,variant));
          if(airGoal!=='ignore'){
            const fitted=airLoadout(store,variant,inventory,seed.scores.airGoalRequired,reference,airGoal,args.heldSlots);
            if(fitted){attempts++;singles.push(evaluate(rows,fitted));}
          }
        }
        continue;
      }
      if(kind==='asw'&&batch.finalAsw){
        const limit=aswEscortLimit(seed.profile,store),escorts=aswEscortIds(store,seed.scheme.ships,limit);
        for(const variant of fitAswLoadouts(store,seed.scheme,inventory,{profile:seed.profile,escorts,heldSlots:args.heldSlots})){
          const surface=surfaceLoadout(store,variant,inventory,area,phase,seed.profile,args.heldSlots)||variant;
          attempts++;const candidate=evaluate(rows,surface);singles.push(candidate);
          if(!candidate||!seed.option)continue;
          const plan=routePlans.optionPlanning(candidate.route,seed.option);
          if(plan.losShortfall>0){
            const fitted=gearVariant(store,candidate.scheme,inventory,'los',seed.profile,area,phase,{heldSlots:args.heldSlots,maxPlacements:24,allowCombatLoss:true,
              stopWhen:value=>{const route=routes.evaluateSearchRoute(store,{area,target:args.target||'boss',phase,fleet:ctx.fleet,scheme:holdDraftEquipment(store,value,args.heldSlots)});
                const check=routePlans.optionPlanning(route,seed.option);return check.chance.max>0&&check.losShortfall===0;}});
            if(fitted){attempts++;singles.push(evaluate(rows,fitted));}
          }
        }
        continue;
      }
      if(kind==='ground'){
        for(const variant of groundLoadouts(store,seed.scheme,inventory,{profile:seed.profile,heldSlots:args.heldSlots,airReference:reference,packages:batch.finalGround===true})){
          attempts++;singles.push(evaluate(rows,variant));
        }
        continue;
      }
      const variant=kind==='air'?
        airLoadout(store,seed.scheme,inventory,seed.scores.airGoalRequired,reference,airGoal,args.heldSlots):
        kind==='opening'?oneOneOpeningLoadout(store,seed.scheme,inventory):
        kind==='surface'?surfaceLoadout(store,seed.scheme,inventory,area,phase,seed.profile,args.heldSlots):
        kind==='night'?seed.profile?.counts?.night?.maximum?
          nightLoadout(store,seed.scheme,inventory,{normalizeGuns:area==='5-3',nightBattles:seed.profile.counts.night.maximum,heldSlots:args.heldSlots}):null:
        gearVariant(store,seed.scheme,inventory,kind,seed.profile,area,phase,{heldSlots:args.heldSlots});
      if(variant){attempts++;singles.push(evaluate(rows,variant));}
    }
    // A candidate may need more than one kind of equipment change: for example
    // 2-5 needs air power and LoS, while 6-4 needs anti-installation gear and
    // water fighters. Evaluate the final combined scheme, not isolated swaps.
    if(gearKinds.length>1&&(policy||byRoute||airGoal!=='ignore')){
      let combined=seed.scheme,changes=0;
      for(const kind of ['surface','asw','ground','opening','air','los','routing','night'].filter(k=>gearKinds.includes(k))){
        const variant=kind==='air'?
          airLoadout(store,combined,inventory,seed.scores.airGoalRequired,reference,airGoal,args.heldSlots):
          kind==='opening'?oneOneOpeningLoadout(store,combined,inventory):
          kind==='ground'?groundLoadout(store,combined,inventory,{profile:seed.profile,heldSlots:args.heldSlots,airReference:reference,packages:batch.finalGround===true}):
          kind==='surface'?surfaceLoadout(store,combined,inventory,area,phase,seed.profile,args.heldSlots):
          kind==='night'?seed.profile?.counts?.night?.maximum?
            nightLoadout(store,combined,inventory,{normalizeGuns:area==='5-3',nightBattles:seed.profile.counts.night.maximum,heldSlots:args.heldSlots}):null:
            gearVariant(store,combined,inventory,kind,seed.profile,area,phase,{heldSlots:args.heldSlots});
        if(variant){
          combined=variant;changes++;
          if(changes>1){attempts++;combinedRows.push(evaluate(rows,combined));}
        }
      }
    }

    return {singles,combined:combinedRows,attempts};
  });
}
function* normalFleetSteps(store,args){
  if(args.routeKey!==undefined){
    if(args.byRoute!==true)throw error('INVALID_QUERY','routeKey requires byRoute=true');
    const selected=routePlans.routeOptions(args.area,args.target||'boss',args.phase).find(o=>o.key===args.routeKey);
    if(!selected)throw error('INVALID_QUERY','Unknown routeKey for this area, target and phase');
    return yield* searchNormalFleet(store,{...args,phase:selected.phase||args.phase},[selected]);
  }
  const options=args.byRoute&&!args.phase?routePlans.recommendedOptions(args.area,args.target||'boss',undefined,args.automaticFilters,store):[];
  const phases=[...new Set(options.map(o=>o.phase).filter(Boolean))];
  if(!phases.length)return yield* searchNormalFleet(store,args);
  const results=[],recommendations=[],routeResults=[];
  for(const phase of phases)results.push(yield* searchNormalFleet(store,{...args,phase},options.filter(o=>o.phase===phase)));
  for(const option of options){
    const result=results.find(r=>r.phase===option.phase),found=result.routeResults.find(r=>r.key===option.key);
    const row=found.recommendationIndex===null?null:result.recommendations[found.recommendationIndex];
    routeResults.push({...found,...option,recommendationIndex:row?recommendations.length:null});
    if(row)recommendations.push({...row,rank:recommendations.length+1});
  }
  return {...results[0],phase:null,routeResults,recommendations,
    airGoalSummary:{...results[0].airGoalSummary,confirmedCount:recommendations.filter(r=>r.scores.airGoalTier===3).length,returnedCount:recommendations.length},
    search:{kind:'boundedHeuristic',phases:results.map(r=>({phase:r.phase,...r.search}))}};
}
// Both drivers consume the same ordered search steps. Only independent batches
// cross threads; shortlist selection and dependent refinements stay together.
function recommendNormalFleet(store,args){
  return routePlans.withPlanningCache(()=>withEquipmentIndexCache(store,()=>{
    const steps=normalFleetSteps(store,args);let step=steps.next();
    while(!step.done)step=steps.next(recommendationBatch(store,{...step.value,serial:true}));
    return step.value;
  }));
}
async function recommendNormalFleetParallel(store,args,runBatch,scope=run=>run()){
  const indexes=new Map(),rules=new Map(),steps=normalFleetSteps(store,args);
  const advance=value=>scope(()=>routePlans.withPlanningCache(()=>withEquipmentIndexCache(store,()=>steps.next(value),indexes),rules));
  let step=perf.stage('selection.initial',()=>advance());
  while(!step.done){
    const kind=step.value.kind;
    const result=await perf.stageAsync('batch.'+kind,()=>runBatch(step.value,
      ()=>scope(()=>withEquipmentIndexCache(store,()=>recommendationBatch(store,{...step.value,serial:true}),indexes))));
    step=perf.stage('selection.after.'+kind,()=>advance(result));
  }
  return step.value;
}
function* searchNormalFleet(store,args,selectedOptions){
  const {area,target='boss',phase,preference='all',airGoal='ignore',limit=3}=args;
  const byRoute=args.byRoute===true;
  if(args.byRoute!==undefined&&typeof args.byRoute!=='boolean')throw error('INVALID_QUERY','byRoute 须为布尔值');
  if(![...NORMAL_PREFERENCES,'all'].includes(preference))
    throw error('INVALID_QUERY','preference 须为 shortest、strongest、lowestConsumption 或 all');
  if(!['ignore','superiority','supremacy'].includes(airGoal))
    throw error('INVALID_QUERY','airGoal 须为 ignore、superiority 或 supremacy');
  if(!Number.isInteger(limit)||limit<1||limit>5)throw error('INVALID_QUERY','limit 须为 1–5');
  // Let the route engine validate area, target and phase before searching.
  const initial=routes.evaluateSearchRoute(store,{area,target,fleet:args.fleet??1,phase});
  const requestedRoutes=byRoute?(selectedOptions||routePlans.recommendedOptions(area,target,phase,args.automaticFilters)):[];
  if(initial.verdict==='noBoss')throw error('INVALID_QUERY','该图没有 Boss，请指定目标点位');
  const modes=byRoute||preference==='all'?NORMAL_PREFERENCES:[preference];
  const policy=guidePolicy(area,target,phase);
  // Include the selected stage's reachable submarine encounters, including
  // submarine escorts in otherwise surface formations, before sampling hulls.
  const initialWantsAsw=aswEscortLimit(previewForMap(area,{target,phase}),store)>0;
  const ctx=context(store,args,1);
  if(byRoute)ctx.combatScore=combatHullRanker(store,previewForMap(area,{target,phase}));
  const pool=candidatePool(ctx,preference,initialWantsAsw),fixed=ctx.fixed.map(id=>ctx.byId.get(id));
  const inventory=availableEquipment(store);
  const previewed=new Map();
  const executable=row=>{
    const key=JSON.stringify(row.scheme);if(previewed.has(key)){
      const donors=previewed.get(key);if(donors===false)return false;row.donorShipIds=donors;return true;
    }
    try{const plan=ctx.preview.preview('fleet',row.scheme);
      row.donorShipIds=[...new Set((plan.equipment.donors||[]).map(d=>d.shipId))];previewed.set(key,row.donorShipIds);return true;
    }catch(_){previewed.set(key,false);return false;}
  };
  const candidates=[],seeds=[],seen=new Set(),budget=900,guideSeedKeys=new Set(),preparedPaths=new WeakMap();
  const evaluateCandidate=candidateEvaluator(store,args,ctx,inventory);
  const collectCandidate=(candidate,asSeed=false,paths)=>{
    if(!candidate)return;
    paths=paths||candidate.preparedPaths;
    if(paths)preparedPaths.set(candidate,new Map(paths));
    if(asSeed){const {scheme,route,profile,scores,scoresByPreference}=candidate;
      const seed={rows:scheme.ships.map(s=>ctx.byId.get(s.id)),scheme,route,profile,scores,scoresByPreference};
      seeds.push(seed);if(paths)preparedPaths.set(seed,preparedPaths.get(candidate));}
    if(candidate.scores.assumedChance[1]>0&&(byRoute||!policy||candidate.guideSuitable))candidates.push(candidate);
    return candidate;
  };
  let deferSeeds=true;
  const pendingSeeds=[];
  const evaluate=(rows,schemeOverride,asSeed=false,collect=true)=>{
    if(!rows.length||rows.length>6||new Set(rows.map(r=>r.id)).size!==rows.length||
      hasDuplicateShipFamily(rows)||!byRoute&&!guideHull(policy,rows))return;
    const key=idsKey(rows);if(!schemeOverride&&seen.has(key))return;
    if(!schemeOverride)seen.add(key);
    if(deferSeeds&&!schemeOverride){pendingSeeds.push(rows.map(r=>r.id));return;}
    const candidate=evaluateCandidate(rows,schemeOverride);
    return collect?collectCandidate(candidate,!schemeOverride||asSeed):candidate;
  };
  if(area==='3-5'&&target==='boss')for(const rows of threeFiveSeeds(ctx)){
    evaluate(rows);guideSeedKeys.add(idsKey(rows));
  }
  if(area==='1-1'&&target==='boss')for(const rows of oneOneSeeds(ctx)){
    evaluate(rows);guideSeedKeys.add(idsKey(rows));
  }
  for(const option of requestedRoutes)if(option.templates)for(const rows of guideSeeds(ctx,{...policy,minLevel:policy?.minLevel||1,templates:option.templates})){
    evaluate(rows);guideSeedKeys.add(idsKey(rows));
  }
  for(const rows of guideSeeds(ctx,policy)){
    evaluate(rows);guideSeedKeys.add(idsKey(rows));
  }
  const specialSeeds=specialFleetSeeds(ctx,[policy,...requestedRoutes.filter(o=>o.templates).map(o=>
    ({...policy,minLevel:policy?.minLevel||1,templates:o.templates}))],args.heldSlots,
    previewForMap(area,{target,phase}).counts?.night?.maximum>0);
  for(const rows of specialSeeds)evaluate(rows);
  let pathSeeds=null;
  if(byRoute){
    const options={area,phase,routes:requestedRoutes};
    routePlans.hullCache(options); // Own the dependency-keyed table before children return facts.
    const estimatedWork=routePlans.hullSeeds(ctx,{...options,estimate:true},shipFamilyKey);
    const parts=yield {kind:'hulls',args,options,items:[{index:0,count:1}],estimatedWork};
    pathSeeds=routePlans.mergeHullParts(parts,ctx.byId);
  }
  for(const rows of pathSeeds?.baselineRows||[])evaluate(rows);
  const combatSeedRows=(pathSeeds?.rows||[]).filter(rows=>!seen.has(idsKey(rows)));
  // Deterministic coverage across fleet size and ship-type mix. Preserve the
  // user's fixed order, which determines the flagship when provided.
  const loose=pool.filter(row=>!ctx.fixed.includes(row.id));
  // The literal highest-graded fleet must always be among the candidates,
  // otherwise the bounded random search below can miss it entirely.
  const graded=loose.slice().sort((a,b)=>b.power-a.power);
  const combatGraded=ctx.combatScore?ctx.roster.filter(r=>!ctx.fixed.includes(r.id))
    .sort((a,b)=>ctx.combatScore(b)-ctx.combatScore(a)||a.id-b.id):[];
  const aswGraded=initialWantsAsw?loose.slice().sort((a,b)=>
    aswPotential(store,b)-aswPotential(store,a)||a.id-b.id):[];
  // Some maps reward a homogeneous fleet (1-5's all-coastal-guard shortcut).
  // Random mixed sampling seldom discovers those combinations on a large roster.
  const aswTypeRankings=initialWantsAsw?[...new Set(loose.map(row=>row.stype))]
    .filter(type=>[1,2,3,4,21,22].includes(type)).map(type=>[
      ...aswGraded.filter(row=>row.stype===type),
      ...aswGraded.filter(row=>row.stype!==type)]):[];
  for(let count=Math.max(1,fixed.length);count<=6;count++){
    if(fixed.length===count){evaluate(fixed);continue;}
    for(const ranking of [graded,...(initialWantsAsw?[aswGraded]:[]),...aswTypeRankings,...(combatGraded.length?[combatGraded]:[])]){
      const rows=fixed.slice(),used=new Set(ctx.fixed);
      for(const row of ranking){
        if(rows.length>=count)break;
        if(used.has(row.id)||hasDuplicateShipFamily([...rows,row]))continue;
        rows.push(row);used.add(row.id);
      }
      if(rows.length===count){if(ranking===combatGraded)combatSeedRows.push(rows);else evaluate(rows);}
    }
    for(let iteration=0;iteration<Math.ceil(budget/6);iteration++){
      const rows=fixed.slice(),used=new Set(ctx.fixed);
      while(rows.length<count&&used.size<pool.length){
        const salt=iteration*17+rows.length*103+count*791;
        const index=Math.floor(stableHash(salt+1,iteration+count)*loose.length);
        const row=loose[index];if(!row||used.has(row.id)){
          const alternate=loose[(index+rows.length+iteration+1)%loose.length];
          if(!alternate||used.has(alternate.id))break;
          rows.push(alternate);used.add(alternate.id);
        }else{rows.push(row);used.add(row.id);}
      }
      if(rows.length===count)evaluate(rows);
    }
  }
  deferSeeds=false;
  const seedResults=yield {kind:'seeds',args,routes:requestedRoutes,items:pendingSeeds};
  for(const {candidate,paths} of seedResults)collectCandidate(candidate,true,paths);
  // Try owned aircraft, reconnaissance planes and route items on promising
  // hulls, then run preview and the full route evaluator on each result.
  // Search speed-constrained hull compositions as well as their current speed.
  // Re-evaluate the real engine allocation; virtual speed never reaches the UI.
  if(byRoute&&JSON.stringify(require(`../../data/normal_routes/${area}.json`).machineRules).includes('speed')){
    for(const wanted of ['fast','fastPlus','fastest']){
      const missing=requestedRoutes.filter(o=>!o.strategy&&!seeds.some(s=>routePlans.planningPath(s.route,o.nodes,{allowTentative:false}).chance.probability>0));
      if(!missing.length)break;
      const upgraded=routePlans.hullSeeds({...ctx,combatScore:null},{area,phase,routes:missing,speed:wanted},shipFamilyKey);
      for(const rows of upgraded.rows){
        const fit=speedLoadout(store,holdDraftEquipment(store,emptyLoadout(store,schemeOf(ctx.fleet,rows),args.heldSlots),args.heldSlots),inventory,wanted,args.heldSlots);
        if(fit)evaluate(rows,fit,true);
      }
    }
  }
  seeds.sort((a,b)=>b.scores.rank-a.scores.rank);
  const airPotential=seed=>seed.rows.reduce((total,row)=>
    total+([3,5,6,7,11,18].includes(row.stype)?
      (row.master.api_maxeq||[]).reduce((sum,count)=>sum+Math.sqrt(Number(count||0)),0):0),0);
  const airSeeds=airGoal==='ignore'?[]:seeds.filter(seed=>seed.scores.assumedChance[1]>0&&
    airPotential(seed)>0).sort((a,b)=>airPotential(b)-airPotential(a)||b.scores.rank-a.scores.rank)
    .slice(0,48);
  const aswSeeds=initialWantsAsw?seeds.filter(seed=>aswEscortLimit(seed.profile,store)>0&&
    seed.scores.assumedChance[1]>0).sort((a,b)=>
    b.rows.reduce((sum,row)=>sum+Math.max(0,aswPotential(store,row)),0)-
    a.rows.reduce((sum,row)=>sum+Math.max(0,aswPotential(store,row)),0))
    .slice(0,24):[];
  const aswCheapSeeds=initialWantsAsw?seeds.filter(seed=>aswEscortLimit(seed.profile,store)>0&&
    seed.scores.assumedChance[1]>0).sort((a,b)=>
    a.rows.reduce((sum,row)=>sum+shipCost(row),0)-
    b.rows.reduce((sum,row)=>sum+shipCost(row),0)).slice(0,24):[];
  const aswShortSeeds=initialWantsAsw?seeds.filter(seed=>aswEscortLimit(seed.profile,store)>0&&
    seed.scores.assumedChance[1]>0).sort((a,b)=>
    (a.profile.hops?.maximum??99)-(b.profile.hops?.maximum??99)).slice(0,24):[];
  const planningCache=new WeakMap();
  const strictCache=new WeakMap();
  const strictChance=(seed,option)=>{
    const prepared=preparedPaths.get(seed)?.get(option.key);if(prepared?.chance)return prepared.chance;
    let cached=strictCache.get(seed);if(!cached){cached=new Map();strictCache.set(seed,cached);}
    if(!cached.has(option.key))cached.set(option.key,routePlans.strategyAssessment(seed.route,option)?.chance||planning(seed,option).chance);
    return cached.get(option.key);
  };
  const planning=(seed,option)=>{
    const prepared=preparedPaths.get(seed)?.get(option.key);if(prepared?.planning)return prepared.planning;
    let cached=planningCache.get(seed);if(!cached){cached=new Map();planningCache.set(seed,cached);}
    if(!cached.has(option.key))cached.set(option.key,routePlans.optionPlanning(seed.route,option));return cached.get(option.key);
  };
  const pathScoreCache=new WeakMap();
  const pathScores=(seed,option)=>{
    const prepared=preparedPaths.get(seed)?.get(option.key);if(prepared?.scores)return prepared.scores;
    let cached=pathScoreCache.get(seed);if(!cached){cached=new Map();pathScoreCache.set(seed,cached);}
    if(!cached.has(option.key)){
      // Route selection is a combat recommendation, not the legacy cheap-fleet
      // preference. Compare final planned strength; current gear improvement
      // deltas unfairly reward ships that happened to start with weak equipment.
      cached.set(option.key,candidatePathScores(store,seed,option,airGoal,area,
        seed.rows||seed.scheme.ships.map(s=>ctx.byId.get(s.id))));
    }
    return cached.get(option.key);
  };
  const pathRankCache=new WeakMap();
  const pathRank=(seed,option,repairable=false)=>{
    let cached=pathRankCache.get(seed);if(!cached){cached=new Map();pathRankCache.set(seed,cached);}
    const key=option.key+':'+repairable;if(cached.has(key))return cached.get(key);
    const prepared=preparedPaths.get(seed)?.get(option.key);
    if(!(prepared?.eligible??routePlans.fleetRequirementAssessment(seed.route,option).eligible)){cached.set(key,-Infinity);return -Infinity;}
    const possible=repairable&&prepared?prepared.hullPossible:routePlans.optionPaths(option).some(nodes=>(repairable?routePlans.hullPath(seed.route,nodes):routePlans.pathChance(seed.route,nodes)).max>0);
    // An impossible path always ranks last; do not compute equipment scores
    // and LoS requirements that cannot change this decision.
    if(!possible){cached.set(key,-Infinity);return -Infinity;}
    const planned=planning(seed,option);
    const rankedChance=strictChance(seed,option);
    const arrival=option.arrivalMode==='boss'?(seed.route.probability??seed.route.chanceRange?.[0]??0):rankedChance.min;
    const rank=!possible?-Infinity:(rankedChance.max>0?1e15:0)+(planned.losShortfall===0?1e14:0)+arrival*1e13+
      // Merged branches share a Boss objective. Once overall arrival is equal,
      // favor combat strength; one particular branch is only a small tie-break.
      (option.arrivalMode==='boss'?rankedChance.min*100:0)-planned.losShortfall*1e9+
      (option.templates?.some(t=>seed.scheme.ships.length===t.length&&remainingSlots(seed.scheme.ships.map(s=>ctx.byId.get(s.id)),t)?.length===0)?3e8:0)+
      (seed.guideStyle===option.key||seed.guideSuitable?3e9:0)+pathScores(seed,option).rank-seed.scoresByPreference.lowestConsumption.routePriority*1e8;
    cached.set(key,rank);return rank;
  };
  const perPathSeeds=requestedRoutes.flatMap(option=>seeds.filter(s=>pathRank(s,option,true)>-Infinity)
    .sort((a,b)=>pathRank(b,option,true)-pathRank(a,option,true)).slice(0,24));
  const gearSeeds=[...new Map([...perPathSeeds,...modes.flatMap(mode=>seeds.slice().sort((a,b)=>
    b.scoresByPreference[mode].rank-a.scoresByPreference[mode].rank).slice(0,24)),
    ...seeds.slice().sort((a,b)=>b.scores.strengthProxy-a.scores.strengthProxy).slice(0,12),
    ...airSeeds,...aswSeeds,...aswCheapSeeds,...aswShortSeeds,
    ...seeds.filter(seed=>area==='1-1'&&seed.rows.length<=2).slice(0,64),
    ...seeds.filter(seed=>guideSeedKeys.has(idsKey(seed.rows)))]
    .map(row=>[idsKey(row.rows),row])).values()];
  const gearKinds=airGoal==='ignore'?['los','routing']:['air','los','routing'];
  if(inventory.some(i=>[56,57].includes(Number(i.master.api_type[2]))))gearKinds.push('jets');
  if(gearSeeds.some(seed=>seed.scheme.ships.some(e=>Number(store.const.$ships[store.info.ships[e.id].api_ship_id]?.api_stype)===10)))gearKinds.push('aviation');
  if(area==='1-1')gearKinds.push('opening');
  if(initialWantsAsw)gearKinds.push('asw');
  if(gearSeeds.some(seed=>routeGroundTargets(seed.profile).length))gearKinds.push('ground');
  if(policy||byRoute)gearKinds.push('surface');
  if(gearSeeds.some(seed=>seed.profile?.counts?.night?.maximum))gearKinds.push('night');
  let variantAttempts=0;
  const gearResults=yield {kind:'gear',args,routes:requestedRoutes,gearKinds,items:gearSeeds.map(({scheme,profile,scores})=>
    ({scheme,profile,scores:{airGoalRequired:scores.airGoalRequired,routeAirReference:scores.routeAirReference}}))};
  for(const result of gearResults){variantAttempts+=result.attempts;for(const row of result.singles)collectCandidate(row);}
  for(const result of gearResults)for(const row of result.combined)collectCandidate(row);
  // Fit LoS for the selected path; keep the first passing checkpoint instead of
  // letting a stronger but deficient pre-fitting scheme win the final ranking.
  for(const option of requestedRoutes){
    const bases=candidates.filter(s=>routePlans.optionPaths(option).some(nodes=>routePlans.pathChance(s.route,nodes).max>0))
      .sort((a,b)=>pathRank(b,option)-pathRank(a,option));
    const hulls=new Set();
    const finalists=bases.filter(s=>{const key=idsKey(s.scheme.ships);if(hulls.has(key))return false;hulls.add(key);return true;}).slice(0,12);
    // An exact low LoS score blocks the *current outfit*, not these hulls.
    // Keep the existing bounded repair shortlist for LoS-only repairs too;
    // otherwise changing estimate -> computed silently prunes strong fleets.
    const repairable=seeds.filter(s=>routePlans.optionPaths(option).some(nodes=>routePlans.hullPath(s.route,nodes).max>0&&
      (routePlans.routingNeeds(s.route,nodes).length>0||planning(s,option).losShortfall>0)))
      .sort((a,b)=>Number(guideSeedKeys.has(idsKey(b.rows)))-Number(guideSeedKeys.has(idsKey(a.rows)))||pathRank(b,option,true)-pathRank(a,option,true)).slice(0,16);
    // Freeze this route's shortlist, fit independently, then append in the
    // original order BEFORE choosing the next route's shortlist.
    const fitted=yield {kind:'path-fit',args,routes:requestedRoutes,option,items:[...finalists,...repairable].map(seed=>({
      scheme:seed.scheme,route:seed.route,profile:seed.profile,
      score:airGoal==='ignore'?null:pathScores(seed,option),nodes:planning(seed,option).nodes||option.nodes}))};
    for(const result of fitted){variantAttempts+=result.attempts;for(const row of result.candidates)collectCandidate(row);}
  }
  // Guide requirements are mandatory, not merely a small rank bonus. In 3-2
  // speed fitting must run even when ordinary speed can randomly visit E.
  const speedFitting=new Map();
  for(const option of requestedRoutes.filter(o=>o.strategy)){
    const allowed=option.strategy.allowedStypes;
    const canFit=row=>{
      if(allowed&&!allowed.includes(row.stype))return false;
      const key=option.strategy.minimumSpeed+':'+row.id;
      if(!speedFitting.has(key)){
        const base=emptyLoadout(store,schemeOf(ctx.fleet,[row]),args.heldSlots);
        speedFitting.set(key,!!fitGuideStrategy(store,base,inventory,{strategy:{minimumSpeed:option.strategy.minimumSpeed}},args.heldSlots));
      }
      return speedFitting.get(key);
    };
    const roster=ctx.roster.filter(canFit);
    const upgraded=fixed.every(canFit)?routePlans.hullSeeds({...ctx,roster,combatScore:null},{area,phase,routes:[option],speed:option.strategy.minimumSpeed},shipFamilyKey).rows:[];
    const hulls=[...new Map([...upgraded,...seeds.map(s=>s.rows)].filter(rows=>rows.length===6&&rows.every(canFit)&&
      routePlans.fleetRequirementAssessment({ships:rows.map(r=>({stype:r.stype,name:r.name}))},option).eligible)
      .map(rows=>[idsKey(rows),rows])).values()].slice(0,48);
    const fittedRows=[],speedResults=yield {kind:'speed-fit',args,routes:requestedRoutes,option,items:hulls.map(rows=>rows.map(r=>r.id))};
    for(const result of speedResults){
      variantAttempts+=result.attempts;
      for(const candidate of result.candidates){const row=collectCandidate(candidate);if(row)fittedRows.push(row);}
    }
    // Refit air and LoS after reserving propulsion. Otherwise a new heavy
    // speed fleet could satisfy the route but retain an unfitted air loadout.
    const refitted=yield {kind:'speed-refit',args,routes:requestedRoutes,option,items:fittedRows
      .sort((a,b)=>pathRank(b,option,true)-pathRank(a,option,true)).slice(0,8)
      .map(row=>({scheme:row.scheme,score:pathScores(row,option)}))};
    for(const result of refitted){variantAttempts+=result.attempts;for(const row of result.candidates)collectCandidate(row);}
  }
  // Some routes require a narrow LoS interval, not merely a minimum. Their
  // final fit can reduce surplus reconnaissance after the normal gear passes.
  const intervalRoutes=byRoute?requestedRoutes.flatMap(option=>routePlans.optionPaths(option).map(nodes=>({...option,nodes}))):previewForMap(area,{target,phase}).routePaths.map(p=>
    ({nodes:p.nodes,key:p.nodes.join('>')}));
  for(const option of intervalRoutes){
    const finalists=selectLoSFinalists(candidates.filter(row=>
      routePlans.fleetRequirementAssessment(row.route,option).eligible),{
      nodes:option.nodes,key:row=>idsKey(row.scheme.ships),
      rank:row=>byRoute?pathRank(row,option,true):row.scores.rank,
      quality:row=>[Number(guideHull(policy,row.scheme.ships.map(s=>ctx.byId.get(s.id)))),
        (byRoute?pathScores(row,option):row.scores).airGoalTier,row.scores.strengthProxy]});
    const fitted=yield {kind:'los-fit',args,routes:requestedRoutes,option,items:finalists.map(seed=>({scheme:seed.scheme,route:seed.route}))};
    for(const result of fitted){variantAttempts+=result.attempts;for(const row of result.candidates)collectCandidate(row);}
  }
  // Improve a passing fleet locally instead of rebuilding every role at once.
  // No rejected trial enters the final candidate list. Full route/equipment
  // checks remain authoritative; the naked-hull estimate only orders attempts.
  const refinement={tried:0,improved:0};
  // Add combat alternatives only after the original fitting passes. Otherwise
  // their unfinished air/LoS scores can crowd valid baseline hulls out of a
  // bounded shortlist. They share the local-refinement budget below.
  const combatResults=yield {kind:'combat',args,routes:requestedRoutes,items:[...new Map(combatSeedRows.map(rows=>[idsKey(rows),rows])).values()]
    .map(rows=>rows.map(r=>r.id))};
  for(const result of combatResults)if(result.candidates[0])preparedPaths.set(result.candidates[0],new Map(result.paths));
  const combatSeeds=combatResults.flatMap(result=>result.candidates).filter(Boolean);
  const lockedIds=new Set([...ctx.fixed,...(args.heldSlots||[]).filter(s=>s&&(s.pin||Object.keys(s.keep||{}).length)).map(s=>s.id)]);
  const validFor=(row,option)=>row&&strictChance(row,option).probability>0&&
    routePlans.fleetRequirementAssessment(row.route,option).eligible&&
    (!option.strategy||routePlans.strategyAssessment(row.route,option).eligible);
  const refinementBases=requestedRoutes.map(option=>({option,used:new Set(),tried:0,gains:[],base:candidates.filter(row=>validFor(row,option))
    .sort((a,b)=>pathRank(b,option)-pathRank(a,option)).find(executable)}));
  // Eight trials per route, as before for the default five-route search.
  // Explicitly requesting more routes scales this same bounded allowance.
  const refinementBudget=Math.max(40,refinementBases.length*8);
  for(let round=0;round<2;round++){
    // Every trial in a round uses its route's round-start base. Only accepting
    // a result is dependent: compare in original order with the latest base.
    const tasks=[],owners=[];
    for(const state of refinementBases){
      if(!state.base||refinement.tried>=refinementBudget)continue;
      const previous=state.base;
      if(round===1)state.base=candidates.filter(row=>validFor(row,state.option))
        .sort((a,b)=>pathRank(b,state.option)-pathRank(a,state.option)).find(executable)||previous;
      const changed=idsKey(previous.scheme.ships)!==idsKey(state.base.scheme.ships);
      const {option}=state,base=state.base,rows=base.scheme.ships.map(e=>ctx.byId.get(e.id));
      const profile=profileForRoute(area,base.route,routePlans.optionPaths(option));
      const hullScore=combatHullRanker(store,profile);
      const upgrades=positionUpgrades(rows,ctx.roster,{lockedIds,score:hullScore,
        allowed:row=>!base.guideSuitable||guideShipAllowed(policy,area,phase,row)});
      const single=(index,row)=>({rows:rows.map((r,i)=>i===index?row:r),index});
      const fresh=upgrades.filter(u=>u.choices[0].stype===rows[u.index].stype)
        .map(u=>({index:u.index,beforeId:rows[u.index].id,row:u.choices[0],gain:hullScore(u.choices[0])-hullScore(rows[u.index])}))
        .sort((a,b)=>b.gain-a.gain||a.index-b.index);
      const alternatives=round===1?combatSeeds.filter(seed=>pathRank(seed,option,true)>-Infinity&&seed.scheme.ships.length===rows.length&&
        [...lockedIds].every(id=>seed.scheme.ships.some(s=>s.id===id)))
        .sort((a,b)=>pathRank(b,option,true)-pathRank(a,option,true)).slice(0,2)
        .map(seed=>({rows:seed.scheme.ships.map(s=>ctx.byId.get(s.id))})):[];
      const choices=round===0?upgrades.map(({index,choices})=>single(index,choices[0])):[
        // A different route can improve this route's winner during round one.
        // Refit that winner too, rather than returning an unrefined hull set.
        ...changed&&fresh.length?[{rows:combineUpgrades(rows,fresh,lockedIds)},single(fresh[0].index,fresh[0].row)]:[],
        {rows:combineUpgrades(rows,state.gains,lockedIds)},
        ...state.gains.slice().sort((a,b)=>b.gain-a.gain||a.index-b.index)
          .flatMap(({beforeId,row})=>{const index=rows.findIndex(r=>r.id===beforeId);return index<0?[]:[single(index,row)];}),
        ...alternatives,
        ...upgrades.map(({index,choices})=>single(index,choices[0])),
        ...[1,2,3].flatMap(n=>upgrades.filter(u=>u.choices[n]).map(u=>single(u.index,u.choices[n])))];
      for(const {rows:nextRows,index} of choices){
        if(state.tried>=8||refinement.tried>=refinementBudget)break;
        if(hasDuplicateShipFamily(nextRows))continue;
        const key=idsKey(nextRows);if(key===idsKey(rows)||state.used.has(key))continue;state.used.add(key);
        state.tried++;refinement.tried++;
        tasks.push({ids:nextRows.map(r=>r.id),base:{scheme:base.scheme,profile},option});
        owners.push({state,base,index});
      }
    }
    const results=yield {kind:'refinement',args,items:tasks};
    for(let i=0;i<results.length;i++){
      const {candidate:trial,attempts,paths}=results[i],{state,base,index}=owners[i],{option}=state;
      variantAttempts+=attempts;if(!trial)continue;
      preparedPaths.set(trial,new Map(paths));
      const current=base;
      if(!validFor(trial,option)||strictChance(trial,option).probability<strictChance(current,option).probability||
        planning(trial,option).losShortfall>planning(current,option).losShortfall||
        pathScores(trial,option).airGoalTier<pathScores(current,option).airGoalTier||
        current.guideSuitable&&!trial.guideSuitable||
        pathScores(trial,option).openingAswCount<Math.min(pathScores(current,option).openingAswCount,
          aswEscortLimit(profileForRoute(area,current.route,routePlans.optionPaths(option)),store))||
        pathRank(trial,option)<=pathRank(current,option)||!executable(trial))continue;
      candidates.push(trial);
      if(round===0&&index!==undefined)state.gains.push({index,beforeId:base.scheme.ships[index].id,row:ctx.byId.get(trial.scheme.ships[index].id),
        gain:pathRank(trial,option)-pathRank(current,option)});
      if(pathRank(trial,option)>pathRank(state.base,option)){state.base=trial;refinement.improved++;}
    }
  }
  // Later hull / air / LoS refinement can replace an early ground kit. Fit the
  // final short list as well, with the selected route's actual target types.
  // Keep the originals: a trial cannot win by breaking routing or air goals.
  const groundFinalists=byRoute?requestedRoutes.flatMap(option=>candidates.filter(row=>validFor(row,option))
    .sort((a,b)=>pathRank(b,option)-pathRank(a,option)).slice(0,2).map(row=>({row,
      profile:profileForRoute(area,row.route,routePlans.optionPaths(option))}))):
    candidates.slice().sort((a,b)=>b.scores.rank-a.scores.rank).slice(0,4).map(row=>({row,profile:row.profile}));
  const groundItems=[...new Map(groundFinalists.filter(v=>routeGroundTargets(v.profile).length).map(({row,profile})=>
    [JSON.stringify([row.scheme,profile.examples]),{scheme:row.scheme,profile,scores:row.scores}])).values()];
  if(groundItems.length){
    const fitted=yield {kind:'gear',args,routes:requestedRoutes,gearKinds:['ground'],items:groundItems,finalGround:true};
    for(const result of fitted){variantAttempts+=result.attempts;for(const row of result.singles)collectCandidate(row);}
  }
  // Later hull replacements can acquire a touch pair after the early special
  // seeds were generated. Try only permutations of the equipped finalists;
  // retain hulls, gear ownership and held positions, then recheck actual routes.
  const positioning={tried:0,improved:0},positionLocks=specialPositionLocks(ctx,args.heldSlots);
  const orderTargets=byRoute?requestedRoutes.flatMap(option=>candidates.filter(row=>validFor(row,option))
    .sort((a,b)=>pathRank(b,option)-pathRank(a,option)).slice(0,2).map(row=>({row,option}))):
    modes.flatMap(mode=>candidates.slice().sort((a,b)=>b.scoresByPreference[mode].rank-a.scoresByPreference[mode].rank)
      .slice(0,2).map(row=>({row,mode})));
  const orderedCandidates=new Map();
  for(const {row:base,option,mode} of orderTargets){
    const rows=base.scheme.ships.map(e=>ctx.byId.get(e.id));
    const byId=new Map(base.scheme.ships.map(e=>[e.id,e]));
    const score=row=>option?pathScores(row,option):row.scoresByPreference[mode];
    const rank=row=>option?pathRank(row,option):score(row).rank;
    for(const core of specialAttackCores(rows).slice(0,16)){
      const ordered=arrangeSpecialAttack(rows,core,{locked:positionLocks,power:r=>plannedCombatStat(store,r,base.scheme,'api_karyoku','api_houg')});
      if(!ordered||idsKey(ordered)===idsKey(rows))continue;
      const scheme={...base.scheme,ships:ordered.map(r=>byId.get(r.id))},key=JSON.stringify(scheme);
      if(!orderedCandidates.has(key)){
        positioning.tried++;orderedCandidates.set(key,evaluateCandidate(ordered,scheme,true));
      }
      const trial=orderedCandidates.get(key);if(!trial)continue;
      if(option&&(!validFor(trial,option)||strictChance(trial,option).probability<strictChance(base,option).probability||
        planning(trial,option).losShortfall>planning(base,option).losShortfall)||
        !option&&(trial.route.probability??trial.route.chanceRange?.[0]??0)<(base.route.probability??base.route.chanceRange?.[0]??0)||
        base.guideSuitable&&!trial.guideSuitable||score(trial).airGoalTier<score(base).airGoalTier||
        score(trial).specialAttack.bonus<=score(base).specialAttack.bonus||rank(trial)<=rank(base)||!executable(trial))continue;
      if(!candidates.includes(trial)){candidates.push(trial);positioning.improved++;}
    }
  }
  const guided35=area==='3-5'&&target==='boss';
  const evidenceCache=new WeakMap();
  const evidenceFor=row=>{
    if(!evidenceCache.has(row))evidenceCache.set(row,confirmedRouteEvidence(row.route,row.profile));
    return evidenceCache.get(row);
  };
  const orderFor=mode=>candidates.filter(row=>(byRoute||evidenceFor(row))&&(!guided35||
    row.guideStyle===(mode==='strongest'?'upper':'lower'))).sort((a,b)=>
    (byRoute?0:Number(evidenceFor(b).pathChance.probability===1)-Number(evidenceFor(a).pathChance.probability===1))||
    b.scoresByPreference[mode].rank-a.scoresByPreference[mode].rank||
    a.scheme.ships.map(s=>s.id).join(',').localeCompare(b.scheme.ships.map(s=>s.id).join(',')));
  // Refit only excess automatic ASW gear on the winning hulls of each route.
  // A different reachable branch must not dictate this route's surface kit.
  const escortItems=byRoute?requestedRoutes.flatMap(option=>{
    const row=candidates.filter(candidate=>validFor(candidate,option)).sort((a,b)=>pathRank(b,option)-pathRank(a,option))[0];
    if(!row)return [];
    const profile=profileForRoute(area,row.route,routePlans.optionPaths(option)),limit=aswEscortLimit(profile,store);
    if(!Number.isFinite(limit))return [];
    const escorts=aswEscortIds(store,row.scheme.ships,limit);
    const excess=row.scheme.ships.some(entry=>!escorts.has(entry.id)&&entry.slots.some(id=>
      [14,15,40].includes(Number(store.const.$equips[store.info.equips[id]?.api_slotitem_id]?.api_type?.[2]))));
    return excess?[{scheme:row.scheme,profile,scores:pathScores(row,option)}]:[];
  }):[];
  if(escortItems.length){
    const fitted=yield {kind:'gear',args,routes:requestedRoutes,gearKinds:['surface'],items:escortItems};
    for(const result of fitted){variantAttempts+=result.attempts;for(const row of result.singles)collectCandidate(row);}
  }
  // Restore effective ASW packages after late hull/LoS/surface refinements.
  // A native opening attack with no useful damage is not an equipped escort.
  const aswFinalists=byRoute?requestedRoutes.flatMap(option=>candidates.filter(row=>validFor(row,option))
    .sort((a,b)=>pathRank(b,option)-pathRank(a,option)).slice(0,2).map(row=>({scheme:row.scheme,
      profile:profileForRoute(area,row.route,routePlans.optionPaths(option)),scores:pathScores(row,option),option}))):
    candidates.slice().sort((a,b)=>b.scores.rank-a.scores.rank).slice(0,3);
  const aswItems=aswFinalists.filter(row=>aswEscortLimit(row.profile,store)>0&&aswCombat.requiresAswPackages(row.profile));
  if(aswItems.length){
    const fitted=yield {kind:'gear',args,routes:requestedRoutes,gearKinds:['asw'],items:aswItems,finalAsw:true};
    for(const result of fitted){variantAttempts+=result.attempts;for(const row of result.singles)collectCandidate(row);}
  }
  // Spend a bounded final pass on escort upgrades after specialist fitting.
  // Lower-cost heavy hulls remain restricted to well-understood easy routes;
  // stronger escorts also matter on difficult surface/installation routes.
  const lightening={tried:0,improved:0},lightTasks=[],lightOwners=[];
  for(const option of requestedRoutes){
    const base=candidates.filter(row=>validFor(row,option)).sort((a,b)=>pathRank(b,option)-pathRank(a,option)).find(executable);
    if(!base||area==='1-1')continue;
    const profile=profileForRoute(area,base.route,routePlans.optionPaths(option)),difficulty=routeDifficulty(profile);
    const rows=base.scheme.ships.map(e=>ctx.byId.get(e.id));
    const choices=finalHullUpgrades(rows,ctx.roster,{lockedIds,score:combatHullRanker(store,profile),
      difficulty,surface:profile.counts?.surface?.maximum>0});
    const seen=new Set([idsKey(rows)]);let count=0;
    for(const next of choices){
      const key=idsKey(next);if(count>=4)break;if(seen.has(key)||hasDuplicateShipFamily(next))continue;seen.add(key);
      count++;lightening.tried++;lightTasks.push({ids:next.map(r=>r.id),base:{scheme:base.scheme,profile},option});
      lightOwners.push({base,option});
    }
  }
  if(lightTasks.length){
    const fitted=yield {kind:'refinement',args,items:lightTasks};
    for(let i=0;i<fitted.length;i++){
      const {candidate:trial,attempts,paths}=fitted[i],{base,option}=lightOwners[i];variantAttempts+=attempts;
      if(!trial)continue;preparedPaths.set(trial,new Map(paths));
      const old=pathScores(base,option),next=pathScores(trial,option);
      const arrival=row=>option.arrivalMode==='boss'?(row.route.probability??row.route.chanceRange?.[0]??0):strictChance(row,option).min;
      if(!validFor(trial,option)||arrival(trial)<arrival(base)||next.airGoalTier<old.airGoalTier||
        planning(trial,option).losShortfall>planning(base,option).losShortfall||
        old.routeAirEstimate?.margins?.supremacy?.min>=0&&!(next.routeAirEstimate?.margins?.supremacy?.min>=0)||
        base.guideSuitable&&!trial.guideSuitable||pathRank(trial,option)<=pathRank(base,option)||!executable(trial))continue;
      candidates.push(trial);lightening.improved++;
    }
  }
  const uniqueFor=mode=>{const selected=new Set();return orderFor(mode).filter(row=>{
    const key=idsKey(row.scheme.ships);if(selected.has(key))return false;selected.add(key);return true;
  });};
  const routeResults=requestedRoutes.map(option=>{
    const possible=candidates.filter(row=>row.profile?.routePaths?.some(p=>routePlans.optionPaths(option).some(nodes=>p.nodes.join('>')===nodes.join('>')))&&pathRank(row,option)>-Infinity);
    const viable=possible.filter(row=>strictChance(row,option).probability>0&&(!option.strategy||routePlans.strategyAssessment(row.route,option).eligible))
      .sort((a,b)=>(option.arrivalMode==='boss'?
        (b.route.probability??b.route.chanceRange?.[0]??0)-(a.route.probability??a.route.chanceRange?.[0]??0):0)||pathRank(b,option)-pathRank(a,option));
    const item=viable.find(executable),chance=item?strictChance(item,option):null;
    const closest=item||possible.slice().sort((a,b)=>pathRank(b,option)-pathRank(a,option))[0]||seeds[0];
    const diagnostics=routePlans.routeDiagnostics(closest?.route||initial,option);
    const namedWarnings=item?[]:routePlans.optionPaths(option).map(nodes=>
      selectionFilters.shipRequirementWarnings(store,routePlans.namedShipRequirements(area,nodes,phase),ctx,args.automaticFilters));
    const missingShips=namedWarnings.length&&namedWarnings.every(w=>w.length)?[...new Set(namedWarnings.flat())]:[];
    if(missingShips.length)diagnostics.warnings.unshift(...missingShips);
    const briefShips=missingShips.length?routePlans.optionPaths(option).flatMap(nodes=>
      selectionFilters.shipRequirementWarnings(store,routePlans.namedShipRequirements(area,nodes,phase),ctx,args.automaticFilters,{compact:true})):[];
    diagnostics.briefWarnings=[...new Set([...briefShips,...diagnostics.points.filter(p=>p.status!=='random').flatMap(p=>{
      const label=p.from===null?null:`${p.from==='start'?'出发点':p.from} → ${p.to}`;
      if(label&&briefShips.some(s=>s.startsWith(label+'：')))return [];
      return [label?`${label}：${p.status==='blocked'?'带路条件未满足':'带路条件待确认'}`:p.summary];
    })])];
    const unconfirmed=!item&&diagnostics.chance.probability===null;
    const unmet=closest?planning(closest,option).losRequirements.filter(r=>r.shortfall>0||r.shortfall===null):[];
    return {...option,status:item?'available':unconfirmed?'unconfirmed':'notFound',chance,diagnostics,
      requirements:[...new Map(routePlans.optionPaths(option).flatMap(nodes=>routePlans.requirements(area,nodes,phase)).map(r=>[r.from+'>'+r.to,r])).values()],
      message:item?'':(missingShips.length?'所选路线缺少可用的带路船，持有情况与排除原因如下。':option.strategy?strategyFailure(store,ctx,option,inventory,args.heldSlots):
        unconfirmed?'尚无到达率可确认的方案，以下分岐资料或条件需核实。':
        '本轮未找到可沿此路线抵达的配置；以下按候选编成列出全部受阻条件，不代表所有编成都无法通过。')+
        (diagnostics.warnings.length?'\n'+diagnostics.warnings.join('\n'):'')+
        (unmet.length?'\n索敌缺口：'+unmet.map(r=>`${r.from} → ${r.to}，系数 ${r.coefficient}，当前 ${r.score===null?'未知':r.score.toFixed(1)}，需 ≥ ${r.required}`).join('；'):''),
      unmetRequirements:unmet,
      item:item?{...item,profile:profileForRoute(area,item.route,routePlans.optionPaths(option)),routeKey:option.key,selectedPath:option.paths?planning(item,option).nodes:option.nodes,pathChance:chance,preference:'strongest',scores:pathScores(item,option)}:null};
  });
  const picked=byRoute?routeResults.flatMap(r=>r.item?[r.item]:[]):preference==='all'?modes.flatMap(mode=>{
    const row=uniqueFor(mode).find(executable);return row?[{...row,preference:mode,scores:row.scoresByPreference[mode]}]:[];
  }):(()=>{const found=[];for(const row of uniqueFor(preference)){if(executable(row))found.push(row);if(found.length>=limit)break;}return found;})();
  const guideWarnings=guided35?modes.filter(mode=>!picked.some(item=>
    (item.preference||preference)===mode)).map(mode=>
    `${mode==='strongest'?'上路大船流':'下路小船流'}未找到同时满足带路、装备和练度参考线的编成`):
    policy?modes.filter(mode=>!picked.some(item=>(item.preference||preference)===mode))
      .map(mode=>`${mode==='shortest'?'最短路线':mode==='strongest'?'最强舰队':'更低消耗'}未找到同时满足攻略舰种、练度、关键装备与可达路线的编成`):[];
  // Several goals can have the same winning fleet. Keep the winner and its
  // goal labels together instead of inventing a weaker alternative.
  const distinct=new Map();
  for(const item of picked){
    const key=(byRoute?item.routeKey+':':'')+JSON.stringify(item.scheme.ships.map(entry=>({id:entry.id,
      slots:entry.slots||usableSlots(store,entry.id),
      ex:(entry.ex??store.info.ships[entry.id].api_slot_ex)>0?
        entry.ex??store.info.ships[entry.id].api_slot_ex:-1})));
    const existing=distinct.get(key),mode=item.preference||preference;
    if(existing)existing.preferences.push(mode);
    else distinct.set(key,{...item,preferences:[mode]});
  }
  const options=[...distinct.values()];
  const defaultDiagnostics=!byRoute&&!options.length&&seeds.length?
    defaultRouteDiagnostics(seeds[0].route,seeds[0].profile,target):null;
  const confirmedCount=options.filter(item=>item.scores.airGoalTier===3).length;
  const fleetOrdering={tried:0,improved:0,protected:0};
  return {area,target,phase:phase||null,preference,airGoal,fleet:ctx.fleet,
    ...(byRoute?{routeResults:routeResults.map(({item,...result})=>({...result,recommendationIndex:item?options.findIndex(o=>o.routeKey===result.key):null}))}:{}),
    airGoalSummary:{confirmedCount,returnedCount:options.length,
      status:airGoal==='ignore'?'notRequested':confirmedCount?'confirmedOptions':'noConfirmedOption',
      basis:'逐槽估算所选路线的道中飞机损耗，按各战制空判定前的保守制空下限配装；不采用固定百分比余量'},
    recommendations:options.map((item,i)=>{
      let scheme=orderEquipment(store,item.scheme,args.heldSlots);
      if(scheme!==item.scheme)ctx.preview.preview('fleet',scheme);
      let route=scheme===item.scheme?item.route:routes.evaluateSearchRoute(store,{area,target,phase,fleet:ctx.fleet,scheme});
      let profile=scheme===item.scheme?item.profile:profileForRoute(area,route,item.profile.routePaths?.map(p=>p.nodes));
      let scores=scheme===item.scheme?item.scores:routeRank(route,profile,scheme.ships.map(s=>ctx.byId.get(s.id)),
        item.preference||preference,airGoal,area,store,scheme,byRoute);
      // Only the final equipped winner is reordered. No inventory search is
      // restarted, and all route/air/LoS/preview constraints are checked again.
      const option=byRoute?requestedRoutes.find(o=>o.key===item.routeKey):null;
      const base={...item,scheme,route,profile,scores},oldPlan=option?planning(base,option):null;
      const oldChance=option?strictChance(base,option):routePlans.planningPath(route,item.selectedPath||profile.examples?.[0]||[]).chance;
      let orderReason=null;
      perf.stage('selection.fleet-order',()=>{for(const choice of fleetOrderChoices(store,scheme,profile,scheme.ships.map(e=>ctx.byId.get(e.id)),
        {locked:positionLocks,air:scores})){
        fleetOrdering.tried++;
        const trial=evaluateCandidate(choice.scheme.ships.map(e=>ctx.byId.get(e.id)),choice.scheme,true);
        if(!trial)continue;
        const next=option?pathScores(trial,option):trial.scoresByPreference[item.preference||preference];
        const chance=option?strictChance(trial,option):routePlans.planningPath(trial.route,item.selectedPath||profile.examples?.[0]||[]).chance;
        if(option&&(!validFor(trial,option)||planning(trial,option).losShortfall>oldPlan.losShortfall)||
          chance.min<oldChance.min||chance.max<oldChance.max||
          (trial.route.probability??trial.route.chanceRange?.[0]??0)<(route.probability??route.chanceRange?.[0]??0)||
          next.airGoalTier<scores.airGoalTier||scores.routeAirEstimate?.margins?.supremacy?.min>=0&&!(next.routeAirEstimate?.margins?.supremacy?.min>=0)||
          next.specialAttack.bonus<scores.specialAttack.bonus||base.guideSuitable&&!trial.guideSuitable||!executable(trial))continue;
        scheme=trial.scheme;route=trial.route;profile=profileForRoute(area,route,option?routePlans.optionPaths(option):profile.routePaths?.map(p=>p.nodes));scores=next;
        orderReason=choice.reason;fleetOrdering.improved++;if(choice.protection)fleetOrdering.protected++;break;
      }});
      return {rank:i+1,preference:item.preference||preference,
      preferences:item.preferences,
      ...(byRoute?{routeKey:item.routeKey,selectedPath:item.selectedPath,pathChance:item.pathChance}:evidenceFor(item)),
      scheme,route:{...route,fixedArrivalCondition:routes.fixedArrivalCondition(route)},profile,
      ...(orderReason?{fleetOrder:{reason:orderReason}}:{}),scores,donorShipIds:item.donorShipIds,guideStyle:item.guideStyle,
      routeAfterEquipPending:item.routeAfterEquipPending,
      note:'舰娘与装备来自快照；可组合建议水上战、对潜、对地、制空与索敌换装，借装来源见 donorShipIds；Boss 前弹药按满补给估算，随机路线显示范围'};}),
    search:{kind:'boundedHeuristic',attempted:seen.size,evaluated:seeds.length,
      equipmentVariantsTried:variantAttempts,poolSize:pool.length,combatRefinement:refinement,specialPositioning:positioning,lightening,fleetOrdering,
      ...(pathSeeds?{routeCompositionsTried:pathSeeds.attempted,routeCompositionSearchTruncated:pathSeeds.truncated}:{}),
      globalOptimal:false,reason:'按练度、作战角色、低耗与对潜能力保留不同候选，配装后复核路线并有界尝试局部战力升级；保留攻略、制空、索敌和手动条件，不保证全局最优'},
    ...(guided35?{guide:{source:'https://wikiwiki.jp/kancolle/北方海域/3-5',
      minLevel:THREE_FIVE_MIN_LEVEL,minUpperAirPower:THREE_FIVE_UPPER_MIN_AIR,
      note:'3-5 推荐参考：每舰至少 Lv70、下路驱逐至少两件攻击装备、上路空母至少一架攻击机及出击前制空 170；这是筛选线，并非 wiki 带路条件或胜利保证。制空目标按本路线含斩杀阶段的较高线比较。'},
      guideWarnings}:policy?{guide:{source:guideSource(area),minLevel:policy.minLevel,
        note:area==='1-1'? '1-1 敌舰最多四艘，优先小编成的先制雷击或开幕航空攻击；伊势型改二可搭载水爆／舰爆并带来第二轮炮击，但燃弹消耗较高，Boss 方向仍是随机。':
          '按攻略舰种、最低练度、路线和关键作战装备筛选；练度线是推荐安全启发值，不是 wiki 带路条件或胜利保证。'},
      guideWarnings}:area==='1-5'&&target==='boss'?{guide:{source:guideSource(area),
        note:'1-5 沿用四舰以内的对潜专用推荐，优先能先制对潜的舰娘与声呐／爆雷；此处没有额外设置练度线，战斗结果仍需实战确认。'},
      guideWarnings:[]}:{}),
    ...(defaultDiagnostics?{diagnostics:defaultDiagnostics}:{}),
    ...(picked.length?{}:{reason:(guided35?
      '本轮未找到同时满足 3-5 攻略路线与练度参考线的可用编成；可调整固定舰娘或装备':policy?
      '本轮未找到同时满足攻略舰种、练度、关键装备和可达路线的编成；可调整固定舰娘、装备或制空目标':
      '在本轮有界搜索中未找到到达率可确认的可用编成；不等于不存在解')+
      (defaultDiagnostics?.warnings.length?'\n'+defaultDiagnostics.warnings.join('\n'):'')})};
}

function recommendNormalEquipment(store,{scheme,area,target='boss',phase,heldSlots=[],routeKey}){
  if(!phase&&routeKey)phase=routePlans.routeOptions(area,target).find(r=>r.key===routeKey)?.phase;
  return withEquipmentIndexCache(store,()=>searchNormalEquipment(store,{scheme,area,target,phase,heldSlots,routeKey}));
}
function searchNormalEquipment(store,{scheme,area,target='boss',phase,heldSlots=[],routeKey}){
  const ctx=context(store,{fleet:scheme.fleet,fixedShipIds:scheme.ships.map(s=>s.id)},1);
  const rows=scheme.ships.map(s=>ctx.byId.get(s.id));
  if(!rows.length)return {scheme};
  heldSlots=heldSlots.filter(Boolean);
  const held=new Map(heldSlots.map(s=>[s.id,s]));
  const reserved=new Set(heldSlots.flatMap(s=>Object.keys(s.keep||{}).map(k=>k==='ex'?s.ex:s.slots[k])).filter(id=>id>0));
  const normalize=value=>{
    const used=new Set(reserved);
    return {fleet:scheme.fleet,ships:scheme.ships.map(base=>{
      const candidate=value.ships.find(s=>s.id===base.id)||base,lock=held.get(base.id);
      const assign=(id,k)=>{
        if(lock?.keep?.[k])return k==='ex'?lock.ex:lock.slots[k];
        if(id>0&&used.has(id))return -1;
        if(id>0)used.add(id);return id>0?id:-1;
      };
      return {id:base.id,slots:(candidate.slots||usableSlots(store,base.id)).map((id,k)=>assign(id,k)),ex:assign(candidate.ex??base.ex,'ex')};
    })};
  };
  const inventory=availableEquipment(store).filter(item=>!reserved.has(item.id));
  const selectedRoute=routeKey?routePlans.routeOptions(area,target,phase).find(r=>r.key===routeKey):null;
  if(routeKey&&!selectedRoute)throw error('INVALID_QUERY','所选路线不存在，请重新选择路线；当前编成已保留');
  const fittingProfile=previewForMap(area,{target,phase,paths:selectedRoute?routePlans.optionPaths(selectedRoute):undefined});
  const fittingOptions={area,asw:aswEscortLimit(fittingProfile,store)>0,profile:fittingProfile,heldSlots};
  const base=completeCombatLoadout(store,normalize(emptyLoadout(store,scheme,heldSlots)),inventory,fittingOptions);
  const candidates=[];
  const evaluate=value=>{
    const candidate=normalize(completeCombatLoadout(store,normalize(value),inventory,fittingOptions));
    try{
      if(!jetCutInAllowed(store,candidate,heldSlots))return null;
      ctx.preview.preview('fleet',candidate);
      const route=routes.evaluateSearchRoute(store,{area,target,phase,fleet:scheme.fleet,scheme:candidate});
      const fullProfile=profileForRoute(area,route);
      const selectedPaths=selectedRoute?routePlans.optionPaths(selectedRoute):null;
      const profile=selectedRoute?profileForRoute(area,route,selectedPaths):fullProfile;
      const scores=routeRank(route,profile,
        rows,'strongest','superiority',area,store,candidate);
      const pathChance=selectedRoute?routePlans.optionPlanning(route,selectedRoute).chance:null;
      // Fleet ranking mostly uses observed hull stats. For a fixed set of
      // hulls, also compare the actual weapon changes in surface encounters.
      if(profile?.counts?.surface?.maximum) scores.rank+=rows.reduce((sum,row)=>sum+
        plannedCombatStat(store,row,candidate,'api_karyoku','api_houg')*150+
        plannedTorpedoStat(store,row,candidate)*80,0);
      const planning=selectedRoute?routePlans.optionPlanning(route,selectedRoute):null;
      const evidence=selectedRoute?null:confirmedRouteEvidence(route,profile);
      const result={scheme:candidate,route,profile,scores,pathChance,planning,evidence};candidates.push(result);return result;
    }catch(_){return null;}
  };
  const initial=evaluate(base);
  if(!initial)throw error('INVALID_QUERY','当前舰娘或手动装备无法生成有效配装，当前编成已保留');
  for(const fitted of aviationBattleshipLoadouts(store,base,inventory,{area,profile:initial.profile,heldSlots})){
    evaluate(fitted);
    const air=airLoadout(store,fitted,inventory,initial.scores.airGoalRequired,initial.scores.routeAirReference,'superiority',heldSlots);
    if(air)evaluate(air);
  }
  if(fittingOptions.asw&&aswCombat.requiresAswPackages(initial.profile))for(const fitted of fitAswLoadouts(store,base,inventory,{profile:initial.profile,
    escorts:aswEscortIds(store,base.ships,aswEscortLimit(initial.profile,store)),heldSlots})){
    evaluate(fitted);
    const surface=surfaceLoadout(store,fitted,inventory,area,phase,initial.profile,heldSlots);if(surface)evaluate(surface);
  }
  if(selectedRoute?.strategy){
    const fit=fitGuideStrategy(store,normalize(emptyLoadout(store,scheme,heldSlots)),inventory,selectedRoute,heldSlots);
    if(fit)evaluate(fit);
  }
  if(selectedRoute&&initial.planning.chance.max===0)for(const wanted of ['fast','fastPlus','fastest']){
    const fit=speedLoadout(store,base,inventory,wanted,heldSlots);if(fit)evaluate(fit);
  }
  const kinds=['surface',...(fittingOptions.asw?['asw']:[]),
    ...(routeGroundTargets(initial.profile).length?['ground']:[]),
    ...(area==='1-1'?['opening']:[]),'air','los','routing',...(initial.profile?.counts?.night?.maximum?['night']:[])];
  const variant=(current,kind)=>kind==='surface'?surfaceLoadout(store,current,inventory,area,phase,initial.profile,heldSlots):
    kind==='air'?airLoadout(store,current,inventory,initial.scores.airGoalRequired,initial.scores.routeAirReference,'superiority',heldSlots):
    kind==='ground'?groundLoadout(store,current,inventory,{profile:initial.profile,heldSlots,airReference:initial.scores.routeAirReference}):
    kind==='opening'?oneOneOpeningLoadout(store,current,inventory):
    kind==='night'?nightLoadout(store,current,inventory,{normalizeGuns:area==='5-3',nightBattles:initial.profile.counts.night.maximum,heldSlots}):
    gearVariant(store,current,inventory,kind,initial.profile,area,phase,{heldSlots});
  let combined=base;
  for(const kind of kinds){
    if(kind==='ground')for(const fitted of groundLoadouts(store,base,inventory,{profile:initial.profile,heldSlots,airReference:initial.scores.routeAirReference}))evaluate(fitted);
    const single=variant(base,kind);if(single)evaluate(single);
    const next=variant(combined,kind);if(next){const result=evaluate(next);if(result)combined=result.scheme;}
  }
  if(inventory.some(i=>[56,57].includes(Number(i.master.api_type[2]))))for(const seed of [base,combined]){
    for(const fitted of jetLoadouts(store,seed,inventory,{heldSlots})){
      evaluate(fitted);
      const air=airLoadout(store,fitted,inventory,initial.scores.airGoalRequired,initial.scores.routeAirReference,'superiority',heldSlots);
      if(air)evaluate(air);
    }
  }
  if(selectedRoute?.strategy)for(const row of candidates.filter(r=>routePlans.strategyAssessment(r.route,selectedRoute).speedMet)
    .sort((a,b)=>b.scores.rank-a.scores.rank).slice(0,4)){
    const held=speedHolds(store,row.scheme,heldSlots);
    const fitted=airLoadout(store,row.scheme,inventory,row.scores.airGoalRequired,row.scores.routeAirReference,'superiority',held);
    if(fitted)evaluate(fitted);
  }
  if(selectedRoute)for(const seed of candidates.slice()){
    let fitted=seed.scheme;
    for(const need of routePlans.routingNeeds(seed.route,seed.planning.nodes||selectedRoute.nodes)){
      const next=routingLoadout(store,fitted,inventory,need,heldSlots);if(next)fitted=normalize(next);
    }
    if(fitted!==seed.scheme)evaluate(fitted);
    const preparedRoute=routes.evaluateSearchRoute(store,{area,target,phase,fleet:scheme.fleet,scheme:fitted});
    const preparedProfile=profileForRoute(area,preparedRoute,routePlans.optionPaths(selectedRoute));
    const reference=routeAirReference(preparedRoute,area,preparedProfile);
    const air=airLoadout(store,fitted,inventory,reference.superiority,reference,'superiority',heldSlots);
    if(air)evaluate(air);
    const fit=gearVariant(store,fitted,inventory,'los',seed.profile,area,phase,{heldSlots,maxPlacements:24,allowCombatLoss:true,
      stopWhen:value=>{const route=routes.evaluateSearchRoute(store,{area,target,phase,fleet:scheme.fleet,scheme:normalize(value)});
        const check=routePlans.optionPlanning(route,selectedRoute);return check.chance.max>0&&check.losShortfall===0;}});
    if(fit)evaluate(fit);
  }
  const intervalPaths=selectedRoute?routePlans.optionPaths(selectedRoute):previewForMap(area,{target,phase}).routePaths.map(p=>p.nodes);
  for(const nodes of intervalPaths){
    const finalists=selectLoSFinalists(candidates,{
      nodes,key:row=>JSON.stringify(row.scheme),rank:row=>row.scores.rank,
      quality:row=>[row.scores.airGoalTier,row.scores.strengthProxy]});
    for(const seed of finalists){
      const held=selectedRoute?.strategy?speedHolds(store,seed.scheme,heldSlots):heldSlots;
      const fitted=fitRouteLoS(store,seed.scheme,inventory,{route:seed.route,nodes,heldSlots:held});
      if(fitted)evaluate(fitted);
    }
  }
  const rank=row=>{
    if(!selectedRoute)return (row.evidence?.pathChance.probability||0)*1e13+row.scores.rank;
    const chance=routePlans.strategyAssessment(row.route,selectedRoute)?.chance||routePlans.optionPlanning(row.route,selectedRoute).chance;
    const arrival=selectedRoute.arrivalMode==='boss'?(row.route.probability??row.route.chanceRange?.[0]??0):chance.min;
    return (chance.max>0?1e15:0)+(row.planning.losShortfall===0?1e14:0)+arrival*1e13+
      (selectedRoute.arrivalMode==='boss'?chance.min*1e11:0)+
      -row.planning.losShortfall*1e9+row.scores.rank-row.scores.routePriority*1e8;
  };
  candidates.sort((a,b)=>(selectedRoute?.arrivalMode==='boss'?
    (b.route.probability??b.route.chanceRange?.[0]??0)-(a.route.probability??a.route.chanceRange?.[0]??0):0)||rank(b)-rank(a));
  const chosen=selectedRoute?candidates.find(row=>{
    if(!routePlans.fleetRequirementAssessment(row.route,selectedRoute).eligible)return false;
    const strategy=routePlans.strategyAssessment(row.route,selectedRoute);
    return strategy?strategy.eligible:routePlans.optionPlanning(row.route,selectedRoute).chance.probability>0;
  }):candidates.find(row=>row.evidence);
  if(!chosen){
    const diagnostics=selectedRoute?routePlans.routeDiagnostics(candidates[0].route,selectedRoute):
      defaultRouteDiagnostics(candidates[0].route,candidates[0].profile,target);
    throw error('INVALID_QUERY',(selectedRoute?.strategy?strategyFailure(store,ctx,selectedRoute,inventory,heldSlots):'当前舰娘及保留装备未配出到达率可确认的方案。')+
      (diagnostics?.warnings.length?'\n'+diagnostics.warnings.join('\n'):''));
  }
  const ordered=orderEquipment(store,chosen.scheme,heldSlots);
  const checked=ordered===chosen.scheme?chosen:evaluate(ordered)||chosen;
  return {scheme:checked.scheme,variants:candidates.length,selectedPath:selectedRoute?(selectedRoute.paths?checked.planning.nodes:selectedRoute.nodes):checked.evidence.selectedPath,
    pathChance:selectedRoute?(routePlans.strategyAssessment(checked.route,selectedRoute)?.chance||routePlans.optionPlanning(checked.route,selectedRoute).chance):checked.evidence.pathChance};
}


module.exports={recommendNormalEquipment,recommendNormalFleet,recommendNormalFleetParallel,recommendationBatch};
