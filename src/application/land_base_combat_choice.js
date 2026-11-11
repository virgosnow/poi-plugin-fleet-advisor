'use strict';
const {outcomes}=require('./joint_fitting_comparison');
const {sortBases}=require('../recommendation/land_base_order');
// Keep the forecast used for route ordering and the aircraft/targets ultimately
// shown to the player together. Comparisons are bounded reference scenarios,
// never an assertion about a real win or retreat probability.
function valid(reading){
  const journey=reading?.diagnostics?.journeys,target=reading?.diagnostics?.target;
  return ['ready','estimated'].includes(reading?.status)&&Number.isInteger(journey?.samples)&&journey.samples>=16&&
    Number.isInteger(journey.completed)&&journey.completed>=0&&journey.completed<=journey.samples&&
    target&&typeof target.id==='string'&&Number.isInteger(target.visits)&&Number.isInteger(target.sVictories)&&
    target.visits>=0&&target.visits<=journey.samples&&target.sVictories>=0&&target.sVictories<=target.visits;
}
function worstEnroute(reading){
  const target=reading.diagnostics.target.id;
  const values=(reading.diagnostics.nodes||[]).filter(row=>row.id!==target&&Number.isInteger(row.visits)&&row.visits>=8&&
    Number.isInteger(row.severe)&&row.severe>=0&&row.severe<=row.visits).map(row=>row.severe/row.visits);
  return values.length?Math.max(...values):null;
}
function hasForwardSupport(bases,target){
  const active=bases.filter(base=>Array.isArray(base.targets)&&base.targets.some(Boolean));
  return active.some(base=>active.length===1?
    base.targets.slice(0,2).some(node=>typeof node==='string'&&node&&node!==target):
    base.targets.slice(0,2).length===2&&base.targets.slice(0,2).every(node=>typeof node==='string'&&node&&node!==target));
}
function createLandBaseCombatSelector({assess=require('./combat_assessment').assessCombat,
  prioritize=(...args)=>require('../recommendation/land_base').prioritizeTargets(...args),
  aircraft=(...args)=>require('../recommendation/land_base').aircraftAlternatives(...args),
  paths=require('../domain/routes/route_plans'),now=()=>performance.now(),budgetMs=5000}={}){
  const cache=new Map();
  return function select({store,report,option,proposal}){
    const bases=sortBases(store,Array.isArray(proposal)?proposal:proposal?.bases);
    const warnings=Array.isArray(proposal?.warnings)?proposal.warnings:[];
    if(!Array.isArray(bases)||!bases.some(base=>base.targets?.some(Boolean))){
      return {assessment:assess({store,report,option,dirty:false,landBases:bases}),proposal:{bases,warnings}};
    }
    // poi may update nested snapshot objects in place. Use the same
    // account/master fingerprint used for executable previews, plus the
    // selected map and base sync state. Missing inputs disable reuse.
    let key=null,cacheVersion=null;
    try{const area=report.route?.area,id=Number(String(area).replace('-',''));
      cacheVersion=JSON.stringify([require('./snapshots').fingerprint(store),store.info.maps?.[id],store.const.$maps?.[id],store.airbaseSync]);
      key=JSON.stringify([cacheVersion,option.key,report.scheme,report.route,bases,warnings]);}catch(_){/* incomplete snapshot: do not cache */}
    if(key&&cache.has(key))return cache.get(key);
    const started=now(),original=assess({store,report,option,dirty:false,landBases:bases,cacheVersion,bypassCache:!key});
    let best={assessment:original,proposal:{bases,warnings}},incomplete=false;
    if(valid(original)&&now()-started<budgetMs){
      const nodes=paths.orderedPathNodes(paths.fleetPaths(report.route,option));
      const emergency=original.balance?.rank===0&&!hasForwardSupport(bases,original.diagnostics.target.id);
      const tuned=prioritize(store,{area:report.route?.area,routeNodes:nodes,bases,scheme:report.scheme,diagnostics:original.diagnostics});
      const targetPlans=tuned?.changed?[tuned.bases,...(tuned.alternatives||[])].map(candidate=>sortBases(store,candidate)):[];
      const options={area:report.route?.area,routeNodes:nodes,scheme:report.scheme};
      const tunedAircraft=tuned?.changed?aircraft(store,{...options,bases:tuned.bases}):[];
      const originalAircraft=aircraft(store,{...options,bases});
      const alternatives=[...targetPlans.slice(0,3).map(candidate=>({candidate,warnings:tuned.warnings||[]})),
        ...tunedAircraft.slice(0,14).map(candidate=>({candidate,warnings:[...tuned.warnings||[],
          '基地飞机组合按有限战况场景比较']})),
        ...originalAircraft.slice(0,14).map(candidate=>({candidate,warnings:['基地飞机组合按有限战况场景比较']}))];
      const seen=new Set([JSON.stringify(bases)]),all=[];let fallback=null;
      let exhausted=now()-started>=budgetMs;
      for(const {candidate,warnings:candidateWarnings} of alternatives){
        if(exhausted&&(!emergency||fallback))break;
        if(emergency&&!hasForwardSupport(candidate,original.diagnostics.target.id))continue;
        const candidateKey=JSON.stringify(candidate);if(seen.has(candidateKey))continue;seen.add(candidateKey);
        const reading=assess({store,report,option,dirty:false,landBases:candidate,cacheVersion,bypassCache:!key});
        if(now()-started>=budgetMs)exhausted=true;
        if(emergency&&!fallback)fallback={assessment:reading,proposal:{bases:candidate,warnings:[...new Set([...warnings,...candidateWarnings,
          '战况压倒性劣势，优先尝试基地航空队支援道中；战况仅为有限场景参考'])]}};
        if(exhausted&&!emergency)break;
        if(!valid(reading))continue;
        const a=original.diagnostics,b=reading.diagnostics;
        if(a.journeys.samples!==b.journeys.samples||a.target.id!==b.target.id)continue;
        const before=outcomes(original),after=outcomes(reading);
        if(!before||!after||before.key!==after.key)continue;
        // First compare safe arrival, then S after the target battle (including
        // night battle when available). These are sampled scenarios, not real
        // probabilities; an improved route may trade some Boss S outcomes.
        const worstBefore=worstEnroute(original),worstAfter=worstEnroute(reading);
        const sameOutcome=Math.abs(after.arrivals-before.arrivals)<1e-9&&Math.abs(after.sVictory-before.sVictory)<1e-9;
        const improvesWorst=sameOutcome&&worstBefore!==null&&worstAfter!==null&&worstAfter<worstBefore;
        const improves=after.arrivals>before.arrivals+1e-9||
          Math.abs(after.arrivals-before.arrivals)<1e-9&&after.sVictory>before.sVictory+1e-9||improvesWorst;
        if(!emergency&&!improves)continue;
        all.push({assessment:reading,proposal:{bases:candidate,warnings:[...new Set([...warnings,...candidateWarnings,
          ...(emergency?['战况压倒性劣势，优先尝试基地航空队支援道中；战况仅为有限场景参考']:
            improvesWorst?['两种方案的通关参考接近，按道中风险场景择优；样本有限，不保证实战改善']:[])])]}});
      }
      // An incomplete comparison cannot identify the best candidate fairly.
      if((!exhausted||emergency)&&all.length){all.sort((a,b)=>outcomes(b.assessment).arrivals-outcomes(a.assessment).arrivals||
        outcomes(b.assessment).sVictory-outcomes(a.assessment).sVictory||
        (worstEnroute(a.assessment)??Infinity)-(worstEnroute(b.assessment)??Infinity));best=all[0];}
      else if(emergency&&fallback)best=fallback;
      else if(emergency)best.proposal.warnings=[...new Set([...warnings,'战况压倒性劣势，但未找到可确认的道中支援方案，请检查飞机航程和手动锁定'])];
      // Refit once more against the chosen plan so both the forward and Boss
      // teams can improve. Rebuild inventory each time; the second fit must
      // not borrow a plane already selected by the first one.
      if(!exhausted&&best.proposal.bases!==bases&&valid(best.assessment)){
        const baseline=best,reference=outcomes(baseline.assessment),improved=[];
        const second=aircraft(store,{...options,bases:baseline.proposal.bases});
        for(const candidate of second.slice(0,14)){
          if(now()-started>=budgetMs){exhausted=true;break;}
          if(emergency&&!hasForwardSupport(candidate,original.diagnostics.target.id))continue;
          const candidateKey=JSON.stringify(candidate);if(seen.has(candidateKey))continue;seen.add(candidateKey);
          const reading=assess({store,report,option,dirty:false,landBases:candidate,cacheVersion,bypassCache:!key});
          if(now()-started>=budgetMs){exhausted=true;break;}
          if(!valid(reading)||reading.diagnostics.journeys.samples!==baseline.assessment.diagnostics.journeys.samples||
            reading.diagnostics.target.id!==baseline.assessment.diagnostics.target.id)continue;
          const after=outcomes(reading);if(!reference||!after||reference.key!==after.key)continue;
          const beforeWorst=worstEnroute(baseline.assessment),afterWorst=worstEnroute(reading);
          const equal=after.arrivals===reference.arrivals&&after.sVictory===reference.sVictory;
          if(after.arrivals>reference.arrivals||after.arrivals===reference.arrivals&&after.sVictory>reference.sVictory||
            equal&&beforeWorst!==null&&afterWorst!==null&&afterWorst<beforeWorst)
            improved.push({assessment:reading,proposal:{bases:candidate,warnings:[...new Set([...baseline.proposal.warnings,
              '基地飞机组合按有限战况场景比较'])]}});
        }
        if(!exhausted&&improved.length){improved.sort((a,b)=>outcomes(b.assessment).arrivals-outcomes(a.assessment).arrivals||
          outcomes(b.assessment).sVictory-outcomes(a.assessment).sVictory||
          (worstEnroute(a.assessment)??Infinity)-(worstEnroute(b.assessment)??Infinity));best=improved[0];}
      }
      if(exhausted){incomplete=true;best.proposal.warnings=[...new Set([...best.proposal.warnings,'基地飞机组合比较超时，已保留此前方案，请重试'])];}
    }else if(valid(original)){
      incomplete=true;best.proposal.warnings=[...new Set([...best.proposal.warnings,'基地飞机组合比较超时，已保留此前方案，请重试'])];
    }
    const timedOut=best.assessment?.status==='unknown'&&best.assessment.reasonCode==='timeBudgetExceeded';
    if(key&&!timedOut&&!incomplete){if(cache.size>=8)cache.delete(cache.keys().next().value);cache.set(key,best);}
    return best;
  };
}
module.exports={createLandBaseCombatSelector};
