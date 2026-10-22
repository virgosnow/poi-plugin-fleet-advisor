'use strict';
// Expedition goal search, drum fitting and net-income ranking.
const {withEquipmentIndexCache}=require('../domain/fleet/equipment_planner');
const {error}=require('../shared/errors');
const {canEquip,acceptsOtherSlot}=require('../domain/fleet/equipment_rules');
const {orderEquipment}=require('../domain/fleet/equipment_order');
const {availableEquipment}=require('./loadout/loadout_policy');
const expeditions=require('../domain/expeditions/expeditions');
const expeditionIncome=require('../domain/expeditions/expedition_income');
const expeditionLoadout=require('../domain/expeditions/expedition_loadout');
const {context,holdDraftEquipment,idsKey,num,schemeOf,shipCost,shipFamilyKey,usableSlots}=require('./context');

function missionRates(store,missionId){
  const m=store.const.$missions?.[missionId];
  const fuel=Number(m?.api_use_fuel),ammo=Number(m?.api_use_bull);
  return {fuel:Number.isFinite(fuel)?fuel:1,ammo:Number.isFinite(ammo)?ammo:1,
    source:Number.isFinite(fuel)&&Number.isFinite(ammo)?'missionMaster':'fullSupplyFallback'};
}
function addDrums(store,scheme,spec,inventory){
  if(!spec.drums&&!spec.drumCarriers)return scheme;
  const ids=scheme.ships.map(s=>s.id),selected=new Set(ids),entries=scheme.ships.map(s=>({id:s.id}));
  const slots=ids.map(id=>usableSlots(store,id).map(item=>spec.totals||store.info.equips[item]?.api_slotitem_id===75?item:-1));
  entries.forEach((entry,i)=>{if(JSON.stringify(slots[i])!==JSON.stringify(usableSlots(store,entry.id)))entry.slots=slots[i];});
  const count=arr=>arr.filter(id=>store.info.equips[id]?.api_slotitem_id===75).length;
  const counts=ids.map((id,i)=>count(slots[i])+count([store.info.ships[id].api_slot_ex]));
  let total=counts.reduce((n,value)=>n+value,0),carriers=counts.filter(value=>value>0).length;
  const drums=inventory.filter(item=>store.info.equips[item.id]?.api_slotitem_id===75&&!selected.has(item.sourceShipId)).map(item=>item.id),used=new Set();
  while(total<(spec.drums||0)||carriers<(spec.drumCarriers||0)){
    const needCarrier=carriers<(spec.drumCarriers||0);
    const targets=ids.map((id,i)=>({id,i,has:counts[i]>0}))
      .filter(row=>!needCarrier||!row.has).sort((a,b)=>Number(a.has)-Number(b.has));
    let placed=false;
    for(const target of targets){
      const item=drums.find(id=>!used.has(id)&&slots[target.i].every(x=>x!==id));
      if(!item)break;
      for(let j=0;j<slots[target.i].length;j++){
        if(slots[target.i][j]>0)continue; // keep existing equipment
        try{if(!canEquip(store,target.id,item,j))continue;}catch(_){continue;}
        slots[target.i][j]=item;used.add(item);total++;counts[target.i]++;
        if(!target.has)carriers++;
        entries[target.i].slots=slots[target.i];placed=true;break;
      }
      if(placed)break;
    }
    if(!placed)return null;
  }
  return {fleet:scheme.fleet,ships:entries};
}
function expeditionRows(store,ctx,spec,rates){
  return ctx.roster.filter(row=>Number(row.ship.api_fuel)>=row.fuel&&
    Number(row.ship.api_bull)>=row.ammo&&
    (spec.minMorale===undefined||Number(row.ship.api_cond)>=spec.minMorale))
    .sort((a,b)=>shipCost(a,rates.fuel,rates.ammo)-shipCost(b,rates.fuel,rates.ammo)||a.id-b.id);
}
function recommendExpeditionFleet(store,args){
  return withEquipmentIndexCache(store,()=>searchExpeditionFleet(store,args));
}
function recommendExpeditionGoals(store,args){
  return withEquipmentIndexCache(store,()=>{
    const shared={};
    return {success:searchExpeditionFleet(store,{...args,goal:'success'},shared),
      great:searchExpeditionFleet(store,{...args,goal:'great'},shared)};
  });
}
function prepareExpeditionSearch(store,args,spec,missionId){
  const ctx=context(store,args,2),rates=missionRates(store,missionId),pool=expeditionRows(store,ctx,spec,rates);
  if(ctx.fixed.some(id=>!pool.some(row=>row.id===id)))
    throw error('INVALID_QUERY','固定舰娘未补给或士气不足，不能满足远征出航条件');
  const inventory=availableEquipment(store),incomeSearch=expeditionLoadout.incomeSearch(store,pool,inventory,spec,missionId,args.heldSlots);
  const statsOf=row=>({firepower:num(row.ship.api_karyoku),antiAir:num(row.ship.api_taiku),asw:num(row.ship.api_taisen),los:num(row.ship.api_sakuteki)});
  const statKeys=Object.keys(spec.totals||{});
  const metadata=new Map(pool.map(row=>{
    const stats=statsOf(row),incomeGroup=incomeSearch.capacity.get(row.id)*2+Number(Number(row.ship.api_ship_id)===487);
    return [row.id,{row,family:shipFamilyKey(row),cost:shipCost(row,rates.fuel,rates.ammo),stats,
      vector:statKeys.map(key=>stats[key]),level:row.level/3,incomeGroup,sparkled:Number(row.ship.api_cond)>=50}];
  }));
  const types=new Set((spec.fleetCompos||[{}]).flatMap(Object.keys));if(spec.flagshipType)types.add(spec.flagshipType);
  const members=new Map([...types].map(type=>[type,new Set(pool.filter(row=>
    expeditions.isESType(type,row.stype,row.ship.api_ship_id,store.const.$ships)).map(row=>row.id))]));
  const pools=new Map([...members].map(([type,ids])=>[type,pool.filter(row=>ids.has(row.id)).map(row=>metadata.get(row.id))]));
  const all=pool.map(row=>metadata.get(row.id)),incomeGroups=[...new Map(all.map(meta=>[meta.incomeGroup,meta])).values()];
  const needs=Object.values(spec.totals||{}),typeKeys=new Map([null,...types].map((type,i)=>[type,i]));
  for(const meta of all)meta.types=[...members].filter(([,ids])=>ids.has(meta.row.id)).map(([type])=>typeKeys.get(type));
  const slotRange=6*Math.max(0,...incomeSearch.capacity.values())+1;
  // Integer game stats fit in a mixed-radix key. Check the WHOLE range,
  // including income and sparkle dimensions, before using exact numbers.
  // Nonintegral/custom stats and larger ranges retain the full JSON key.
  const numericKeys=needs.every(n=>Number.isSafeInteger(n)&&n>=0)&&
    all.every(meta=>meta.vector.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=Number.MAX_SAFE_INTEGER/6))&&
    Number.isSafeInteger(slotRange)&&needs.reduce((n,need)=>n*(need+1),8*3*typeKeys.size*2*slotRange*7*2)<=Number.MAX_SAFE_INTEGER;
  const rankingKey=(variant,preference,type,totals,incomeState,boost)=>{
    if(!numericKeys)return JSON.stringify([variant,preference,type,variant?needs.map((need,j)=>Math.max(0,need-totals[j])):[],incomeState,boost]);
    let key=(variant*3+preference+1)*typeKeys.size+typeKeys.get(type);
    for(let j=0;j<needs.length;j++)key=key*(needs[j]+1)+(variant?Math.max(0,needs[j]-totals[j]):0);
    return (((key*2+Number(!!incomeState))*slotRange+(incomeState?.slots||0))*7+(incomeState?.kinu||0))*2+boost;
  };
  const finiteRanks=all.every(meta=>Number.isFinite(meta.cost)&&Number.isFinite(meta.level)&&meta.vector.every(Number.isFinite));
  const rankPool=rows=>!finiteRanks?rows:rows.filter(candidate=>{
    const better=new Set();
    for(const other of rows){
      if(other.family===candidate.family||other.row.id>=candidate.row.id||other.sparkled!==candidate.sparkled||other.incomeGroup!==candidate.incomeGroup||
        !(other.cost<=candidate.cost&&other.level>=candidate.level)||!other.vector.every((v,j)=>v>=candidate.vector[j]))continue;
      better.add(other.family);if(better.size>=6)return false;
    }
    return true;
  });
  // Six distinct families score no worse at every possible deficit,
  // sparkle preference and income state (lower IDs also preserve ties).
  // At most five can be excluded, so this hull can never be chosen.
  const rankAll=rankPool(all);for(const [type,rows] of pools)pools.set(type,rankPool(rows));
  const readStats=spec.totals?require('../domain/expeditions/expedition_stats').createStatReader(store):null;
  return {ctx,rates,pool,inventory,incomeSearch,metadata,members,pools,all,incomeGroups,
    rankingKey,rankAll,typeKeys,want:Object.entries(spec.totals||{}),readStats,evaluate:expeditions.createEvaluator(store,ctx.fleet,missionId,{readStats}),
    rankings:new Map(),rankingKeys:[],rankingCursor:0,fits:new Map()};
}
const EXPEDITION_WEIGHTS=[0,0.05,0.12,0.25,0.5,1,2,4];
const gapScore=evaluation=>{
  const gaps=expeditions.requirementGaps(evaluation);
  return {hard:gaps.filter(g=>!g.type.startsWith('total')&&g.type!=='levelSum').length,
    ratio:gaps.reduce((n,g)=>n+(g.missing!==undefined?g.missing/Math.max(1,g.required):g.type==='fleetCompo'?
      Math.min(...g.detail.map(option=>option.parts.reduce((sum,p)=>sum+Math.max(0,p.need-p.actual)/Math.max(1,p.need),0))):1),0),count:gaps.length};
};
const gapOrder=(a,b)=>a.gap.hard-b.gap.hard||a.gap.ratio-b.gap.ratio||a.gap.count-b.gap.count;
function expeditionCandidate(prepared,parts,selectedFlagship,count,goal,variant,sparkleTarget,incomeMode,allowMissing=false){
  const {ctx,metadata,incomeSearch,pools,incomeGroups,rankings,want}=prepared,weights=EXPEDITION_WEIGHTS;
  const family=row=>metadata.get(row.id).family;
  const rows=ctx.fixed.map(id=>ctx.byId.get(id)),used=new Set(ctx.fixed);
  if(!used.has(selectedFlagship.id)){
    if(rows.some(row=>family(row)===family(selectedFlagship)))return null;
    rows.push(selectedFlagship);used.add(selectedFlagship.id);
  }
  if(rows.length>count)return null;
  const weight=weights[variant%weights.length];
  const mode=variant<weights.length?null:variant<weights.length*2?'bare':'refit';
  const stats=id=>mode?prepared.monthlyProfiles.get(id)[mode]:metadata.get(id).stats;
  const totals=weight?want.map(([key])=>rows.reduce((n,row)=>n+stats(row.id)[key],0)):[];
  const families=new Set(rows.map(family)),incomeState=incomeMode?incomeSearch.summary(rows):null;
  const typeCounts=Array(prepared.typeKeys.size).fill(0);
  for(const row of rows)for(const type of metadata.get(row.id).types)typeCounts[type]++;
  const missing=part=>Math.max(0,part[1]-typeCounts[part[2]]);
  let sparkled=rows.filter(row=>metadata.get(row.id).sparkled).length;
  const choose=type=>{
    const wantSparkle=sparkled<sparkleTarget;
    const currentPotential=incomeMode?incomeSearch.value(incomeState):0;
    const incomeActive=incomeMode&&currentPotential<.2;
    const preference=goal==='great'?Number(wantSparkle):-1;
    // Scores depend on remaining requirements, not which hulls created
    // them. Rank once, then exclude the already selected ship families.
    const key=mode?JSON.stringify([mode,variant,preference,type,totals,incomeActive?incomeState:null,goal]):
      prepared.rankingKey(variant,preference,type,totals,incomeActive?incomeState:null,Number(incomeActive&&goal==='great'));
    let ranking=rankings.get(key);
    if(!ranking){
      const best=[],gains=[],gaps=weight?want.map(([,need],j)=>Math.max(0,need-totals[j])):[];
      if(incomeActive)for(const meta of incomeGroups)gains[meta.incomeGroup]=incomeSearch.resources*(goal==='great'?1.5:1)*
        (incomeSearch.withRow(incomeState,meta.row)-currentPotential);
      // Current-panel dominance cannot discard a bare/refit alternative.
      for(const meta of (mode?prepared.all:(type?pools.get(type):prepared.rankAll))){
        if(mode&&type&&!prepared.members.get(type).has(meta.row.id))continue;
        let useful=0;for(let j=0;j<gaps.length;j++)useful+=Math.min(gaps[j],mode?stats(meta.row.id)[want[j][0]]:meta.vector[j]);
        const preferred=preference>=0&&meta.sparkled===wantSparkle;
        const score=meta.cost-weight*(useful+meta.level)-(preferred?10000:0)-(incomeActive?gains[meta.incomeGroup]:0);
        if(best.length===6&&(score>best[5].score||score===best[5].score&&meta.row.id>best[5].meta.row.id))continue;
        let at=0;
        while(at<best.length&&(best[at].score<score||best[at].score===score&&best[at].meta.row.id<meta.row.id))at++;
        if(at>=6)continue;
        const previous=best.findIndex(item=>item.meta.family===meta.family);
        if(previous>=0){if(at>previous)continue;best.splice(previous,1);}
        best.splice(at,0,{meta,score});if(best.length>6)best.pop();
      }
      // At most five families have been selected while choosing a hull.
      // The best six DISTINCT families therefore contain the exact answer,
      // including accounts with many copies/remodels of the same ship.
      ranking=best.map(item=>item.meta);rankings.set(key,ranking);
      if(prepared.rankingKeys.length<32768)prepared.rankingKeys.push(key);
      else{
        rankings.delete(prepared.rankingKeys[prepared.rankingCursor]);
        prepared.rankingKeys[prepared.rankingCursor]=key;
        prepared.rankingCursor=(prepared.rankingCursor+1)%32768;
      }
    }
    const chosen=ranking.find(meta=>!families.has(meta.family));
    if(chosen){
      rows.push(chosen.row);families.add(chosen.family);sparkled+=Number(chosen.sparkled);
      for(const type of chosen.types)typeCounts[type]++;
      for(let j=0;j<totals.length;j++)totals[j]+=mode?stats(chosen.row.id)[want[j][0]]:chosen.vector[j];
      if(incomeState){incomeState.slots+=incomeSearch.capacity.get(chosen.row.id);incomeState.kinu+=Number(Number(chosen.row.ship.api_ship_id)===487);}
    }
    return !!chosen;
  };
  for(const part of parts){
    while(missing(part)>0&&rows.length<count)if(!choose(part[0]))break;
  }
  if(parts.some(part=>missing(part)>0)&&!allowMissing)return null;
  while(rows.length<count)if(!choose(null))break;
  if(!rows.length||rows.length<count&&!allowMissing||new Set(rows.map(family)).size!==rows.length)return null;
  return rows;
}
function searchExpeditionFleet(store,args,shared={}){
  const {missionId,limit=3,goal='success'}=args,spec=expeditions.DATA.missions[missionId];
  if(!['success','great'].includes(goal))throw error('INVALID_QUERY','goal 须为 success 或 great');
  if(!Number.isInteger(missionId)||!spec)throw error('INVALID_QUERY','未知远征编号');
  if(args.fleet===1)throw error('INVALID_QUERY','远征请使用第 2–4 舰队');
  if(!Number.isInteger(limit)||limit<1||limit>5)throw error('INVALID_QUERY','limit 须为 1–5');
  if(args.fixedFlagshipId!==undefined){
    if(!Number.isInteger(args.fixedFlagshipId)||args.fixedFlagshipId<1)throw error('INVALID_QUERY','固定旗舰须为舰娘实例 ID');
    args={...args,fixedShipIds:[...new Set([...(args.fixedShipIds||[]),args.fixedFlagshipId])]};
  }
  if(!shared.prepared)shared.prepared=prepareExpeditionSearch(store,args,spec,missionId);
  const prepared=shared.prepared,{ctx,rates,pool,inventory,incomeSearch,metadata,members,pools,all,incomeGroups,rankings,fits}=prepared;
  const options=spec.fleetCompos||[{}],compositions=options.map(compo=>Object.entries(compo).map(([type,count])=>[type,count,prepared.typeKeys.get(type)])),seen=new Set(),valid=[],rejected=[];
  const family=row=>metadata.get(row.id).family,cost=row=>metadata.get(row.id).cost;
  const weights=EXPEDITION_WEIGHTS;
  let evaluated=0,rescueAttempted=false;
  const hullKey=row=>row.scheme.ships.map(s=>s.id).sort((a,b)=>a-b).join(',');
  const retainRejected=row=>{
    row={...row,gap:gapScore(row.evaluation)};
    // Reordering the same hull set must not consume the entire fitting beam.
    const key=hullKey(row),at=rejected.findIndex(r=>hullKey(r)===key);
    if(at>=0){const order=gapOrder(row,rejected[at]);if(order>0||order===0&&row.evaluation.greatSuccess.estimatedPercent<=rejected[at].evaluation.greatSuccess.estimatedPercent)return;rejected.splice(at,1);}
    rejected.push(row);
    rejected.sort((a,b)=>gapOrder(a,b)||a.cost.fuel+a.cost.ammo-b.cost.fuel-b.cost.ammo);
    if(rejected.length>16)rejected.pop();
  };
  const candidateRow=(scheme,evaluation,ordered)=>({scheme,evaluation,incomePotential:incomeSearch.potential(ordered),
    cost:{fuel:ordered.reduce((n,r)=>n+r.fuel*rates.fuel,0),ammo:ordered.reduce((n,r)=>n+r.ammo*rates.ammo,0),unit:'fullSupplyEquivalent',source:rates.source}});
  // Several deterministic cost/attribute trade-offs cover alternative
  // compositions and aggregate stat requirements without factorial search.
  const flagshipEligible=row=>row.level>=spec.flagshipLevel&&
    (!spec.flagshipType||members.get(spec.flagshipType).has(row.id));
  const eligibleFlags=pool.filter(row=>flagshipEligible(row)&&(args.fixedFlagshipId===undefined||row.id===args.fixedFlagshipId));
  if(args.fixedFlagshipId!==undefined&&!eligibleFlags.length)throw error('INVALID_QUERY','固定旗舰不满足远征旗舰等级或舰种要求');
  const nearFullFlags=goal==='great'&&spec.gs.kind==='flagship'?[0,1,2,3,4,5,6].flatMap(flashes=>{
    // Solve sqrt(L) + L/10 >= 100 - 16 - 15 * flashes.
    const need=Math.max(0,100-16-15*flashes),root=(Math.sqrt(100+40*need)-10)/2;
    const threshold=Math.ceil(root*root);
    return eligibleFlags.filter(r=>r.level>=threshold).sort((a,b)=>a.level-b.level||cost(a)-cost(b)).slice(0,2);
  }):[];
  const flagships=[...new Map([...ctx.fixed.map(id=>ctx.byId.get(id)).filter(flagshipEligible),
    ...eligibleFlags.slice(0,10),...nearFullFlags,
    ...(incomeSearch.active?eligibleFlags.slice().sort((a,b)=>incomeSearch.potential([b])-incomeSearch.potential([a])||cost(a)-cost(b)).slice(0,10):[]),...(goal==='great'?[
      ...eligibleFlags.filter(r=>r.ship.api_cond>=50).slice(0,10),
      ...(spec.gs.kind==='flagship'?eligibleFlags.slice().sort((a,b)=>b.level-a.level||cost(a)-cost(b)).slice(0,10):[])
    ]:[])].filter(row=>args.fixedFlagshipId===undefined||row.id===args.fixedFlagshipId).map(row=>[row.id,row])).values()];
  const sparkleTargets=goal==='great'?[0,1,2,3,4,5,6]:[0];
  const variants=spec.totals||spec.levelSum?weights.map((_,i)=>i):[0];
  const collect=(candidateVariants,candidateFlags,onRow)=>{
    const passSeen=new Set();
    for(const incomeMode of incomeSearch.active?[false,true]:[false])
      for(const parts of compositions)for(let count=Math.max(spec.shipCount,ctx.fixed.length);count<=6;count++)
      for(const sparkleTarget of sparkleTargets)for(const variant of candidateVariants)for(const selectedFlagship of candidateFlags){
      const rows=expeditionCandidate(prepared,parts,selectedFlagship,count,goal,variant,sparkleTarget,incomeMode);
      if(!rows)continue;
      {
        const ordered=[selectedFlagship,...rows.filter(row=>row.id!==selectedFlagship.id)];
        const key=idsKey(ordered);if(passSeen.has(key))continue;passSeen.add(key);seen.add(key);
        const basicScheme=schemeOf(ctx.fleet,ordered);
        // Both tiers must survive: once probability is capped, extra drums
        // provide no benefit and should not consume slots or borrowed equipment.
        // Monthly outfits are refitted later, including making room for drums.
        // A full current outfit must not discard an otherwise usable hull set.
        const schemes=[spec.totals?basicScheme:addDrums(store,basicScheme,spec,inventory)];
        if(!spec.totals&&goal==='great'&&spec.gs.kind==='drum')schemes.push(addDrums(store,basicScheme,
          {...spec,drums:Math.max(spec.drums||0,spec.gs.max||0),drumCarriers:Math.max(1,spec.drumCarriers||0)},inventory));
        const equipmentSeen=new Set();
        for(const scheme of schemes){
        if(!scheme||equipmentSeen.has(JSON.stringify(scheme)))continue;equipmentSeen.add(JSON.stringify(scheme));
        try{
          const result=prepared.evaluate(scheme);
          evaluated++;
          const row=candidateRow(scheme,result,ordered);
          onRow(row,variant);
        }catch(_){/* candidate cannot be assembled safely */}
        }
      }
    }
  };
  collect(variants,flagships,row=>{if(!row.evaluation.eligible)retainRejected(row);else valid.push(row);});
  // Only when hard constraints prevented the normal generator from producing
  // any candidate, assemble a bounded reference fleet without relaxing
  // ownership, availability, user exclusions or manually retained hulls.
  if(!valid.length&&!rejected.length){
    const flags=(args.fixedFlagshipId===undefined?pool:pool.filter(r=>r.id===args.fixedFlagshipId))
      .slice().sort((a,b)=>(spec.flagshipType?Number(!members.get(spec.flagshipType).has(a.id))-Number(!members.get(spec.flagshipType).has(b.id)):0)||
        b.level-a.level||cost(a)-cost(b)).slice(0,8);
    for(const parts of compositions)for(const flagship of flags)for(const variant of variants){
      const rows=expeditionCandidate(prepared,parts,flagship,6,goal,variant,0,false,true);if(!rows)continue;
      const ordered=[flagship,...rows.filter(r=>r.id!==flagship.id)],key=idsKey(ordered);if(seen.has(key))continue;seen.add(key);
      const scheme=schemeOf(ctx.fleet,ordered);
      try{ctx.preview.preview('fleet',scheme);const evaluation=prepared.evaluate(scheme);evaluated++;
        const row=candidateRow(scheme,evaluation,ordered);if(evaluation.eligible)valid.push(row);else retainRejected(row);
      }catch(_){/* unavailable instances are never reference candidates */}
    }
  }
  const probabilityOrder=(a,b)=>goal==='great'?Math.min(100,b.evaluation.greatSuccess.estimatedPercent)-Math.min(100,a.evaluation.greatSuccess.estimatedPercent):0;
  const oldOrder=(a,b)=>probabilityOrder(a,b)||
    (goal==='great'?a.evaluation.greatSuccess.sparkledCount-b.evaluation.greatSuccess.sparkledCount:0)||
    (goal==='great'?a.scheme.ships.length-b.scheme.ships.length:0)||
    (goal==='great'?Math.max(0,a.evaluation.greatSuccess.rawPercent-100)-Math.max(0,b.evaluation.greatSuccess.rawPercent-100):0)||
    (a.cost.fuel+a.cost.ammo)-(b.cost.fuel+b.cost.ammo)||
    a.scheme.ships.length-b.scheme.ships.length||
    (goal==='great'?a.evaluation.greatSuccess.rawPercent-b.evaluation.greatSuccess.rawPercent||a.evaluation.greatSuccess.drums-b.evaluation.greatSuccess.drums:0);
  valid.sort(oldOrder);
  const estimatedNet=row=>incomeSearch.resources*(1+row.incomePotential)*(goal==='great'?1.5:1)-row.cost.fuel-row.cost.ammo;
  // Fit a bounded union of the old cost shortlist and reward-aware candidates.
  // Probability remains the first criterion for the great-success goal.
  const shortlist=[],candidateKeys=new Set(),take=rows=>{
    let count=0;
    for(const row of rows){
      const key=row.scheme.ships.map(s=>s.id).join(',');
      if(candidateKeys.has(key))continue;
      candidateKeys.add(key);shortlist.push(row);if(++count>=Math.max(12,limit*4))break;
    }
  };
  take(valid);if(incomeSearch.active)take(valid.slice().sort((a,b)=>probabilityOrder(a,b)||estimatedNet(b)-estimatedNet(a)||oldOrder(a,b)));
  if(spec.totals||!shortlist.length)take(rejected);
  const selected=new Set(),distinct=[];
  // Inventory and preview indexes belong to this immutable search only.
  // Reuse them while fitting the bounded shortlist, never for live actions.
  const fitRows=rows=>{for(let row of rows){
    const key=hullKey(row);
    if(selected.has(key))continue;
    try{
      {
        const scheme=args.heldSlots?.some(Boolean)?holdDraftEquipment(store,row.scheme,args.heldSlots):row.scheme;
        const tier=Math.max(spec.drums||0,spec.drumCarriers||0,goal==='great'&&spec.gs.kind==='drum'?spec.gs.max||0:0);
        const fitKey=JSON.stringify([scheme,tier]);
        let fitted=fits.get(fitKey);
        if(!fitted){fitted=fitExpeditionEquipment(store,{missionId,goal,scheme,heldSlots:args.heldSlots},{ctx,inventory,readStats:prepared.readStats});fits.set(fitKey,fitted);}
        row={...row,scheme:fitted.scheme,evaluation:fitted.evaluation,income:fitted.income,gap:gapScore(fitted.evaluation)};
      }
    }catch(_){continue;}
    selected.add(key);distinct.push(row);
  }};
  fitRows(shortlist);
  // Do not publish a closest reference just because the current-outfit beam
  // failed. Retry independent bare/refit rankings, including stronger flagships
  // and all eligible hulls hidden by current-panel dominance. Work stays bounded.
  if(spec.totals&&!distinct.some(row=>row.evaluation.eligible)){
    rescueAttempted=true;
    if(!prepared.monthlyProfiles)prepared.monthlyProfiles=require('./expedition_candidates').monthlyProfiles(store,pool,inventory,args.heldSlots,prepared.readStats);
    const profiles=prepared.monthlyProfiles,beams={bare:new Map(),refit:new Map()};
    const score=(row,mode)=>({hard:gapScore(row.evaluation).hard,ratio:prepared.want.reduce((n,[key,need])=>
      n+Math.max(0,need-row.scheme.ships.reduce((sum,s)=>sum+profiles.get(s.id)[mode][key],0))/Math.max(1,need),0),count:0});
    const flags=new Map(flagships.map(r=>[r.id,r]));
    for(const mode of ['bare','refit'])for(const [key,need]of prepared.want){
      for(const row of eligibleFlags.slice().sort((a,b)=>Math.min(need,profiles.get(b.id)[mode][key])-Math.min(need,profiles.get(a.id)[mode][key])||cost(a)-cost(b)).slice(0,4))flags.set(row.id,row);
    }
    collect(Array.from({length:weights.length*2},(_,i)=>i+weights.length),[...flags.values()],row=>{
      const key=hullKey(row);if(selected.has(key))return;
      for(const mode of ['bare','refit']){
        const beam=beams[mode],rank=score(row,mode),old=beam.get(key);
        if(!old||probabilityOrder(row,old)<0)beam.set(key,{...row,gap:rank});
        if(beam.size>64){const sorted=[...beam.values()].sort((a,b)=>gapOrder(a,b)||oldOrder(a,b));beam.delete(hullKey(sorted[sorted.length-1]));}
      }
    });
    const alternatives=Object.values(beams).map(beam=>[...beam.values()].sort((a,b)=>gapOrder(a,b)||oldOrder(a,b)));
    // First try a small diverse beam; widen only if it also fails.
    for(const [start,end]of [[0,12],[12,64]]){
      fitRows(alternatives.flatMap(rows=>rows.slice(start,end)));
      if(distinct.some(row=>row.evaluation.eligible))break;
    }
  }
  const net=row=>expeditionLoadout.planningNet(row.income,missionId,goal==='great'?row.evaluation.greatSuccess.estimatedPercent/100:0);
  const usage=new Map(distinct.map(row=>[row,expeditionLoadout.cargoUse(store,row.scheme.ships,inventory)]));
  distinct.sort((a,b)=>Number(b.evaluation.eligible)-Number(a.evaluation.eligible)||
    (!a.evaluation.eligible&&!b.evaluation.eligible?gapOrder(a,b):0)||probabilityOrder(a,b)||(net(a)!==undefined&&net(b)!==undefined?net(b)-net(a):0)||
    usage.get(a).count-usage.get(b).count||usage.get(a).combat-usage.get(b).combat||
    usage.get(a).borrowed-usage.get(b).borrowed||usage.get(a).special-usage.get(b).special||oldOrder(a,b));
  const available=distinct.filter(r=>r.evaluation.eligible),closest=!available.length&&distinct[0];
  const publicRow=({gap,...row})=>row;
  return {missionId,goal,fleet:ctx.fleet,recommendations:available.slice(0,limit).map((row,i)=>({rank:i+1,...publicRow(row)})),
    ...(closest?{closestRecommendation:{...publicRow(closest),rank:1,status:'closest',departureReady:false,shortfalls:expeditions.requirementGaps(closest.evaluation)}}:{}),
    search:{kind:'boundedHeuristic',evaluated,compositions:options.length,globalOptimal:false,
      ...(spec.totals?{fitted:distinct.length,rescue:rescueAttempted}:{}),
      reason:'满足出航与大成功目标后，比较至20%加成为止的净收益；优先大发并节省装备，不追逐额外收益'},
    ...(available.length?{}:{reason:closest?'未找到达标方案，已提供最接近的参考编成；请调整未满足的出航条件':'未找到可预览的参考编成；请检查可用舰娘、排除设置与固定舰娘'})};
}
// Fit only the chosen hulls. Mandatory drums and the selected probability
// tier take precedence; reward equipment uses the remaining automatic slots.
function recommendExpeditionEquipment(store,args){
  return withEquipmentIndexCache(store,()=>fitExpeditionEquipment(store,args));
}
function fitExpeditionEquipment(store,{scheme,missionId,goal='success',heldSlots=[]},shared={}){
  const spec=expeditions.DATA.missions[missionId];
  if(!spec||!['success','great'].includes(goal))throw error('INVALID_QUERY','远征编号或目标无效');
  if(!scheme?.ships?.length||scheme.fleet===1)throw error('INVALID_QUERY','请选择第2–4舰队及舰娘');
  const ids=scheme.ships.map(s=>s.id),ctx=shared.ctx||context(store,{fleet:scheme.fleet,fixedShipIds:ids},2);
  if(!shared.ctx)ctx.preview.preview('fleet',{fleet:scheme.fleet,ships:ids.map(id=>({id}))});
  const held=new Map(heldSlots.filter(Boolean).map(s=>[s.id,s])),inventory=shared.inventory||availableEquipment(store),available=new Set(inventory.map(i=>i.id));
  const statOpportunity=shared.statOpportunity||(spec.totals&&(spec.drums||spec.drumCarriers)?
    require('./expedition_candidates').drumOpportunity(store,inventory,spec):null);
  const minimumDrums=Math.max(spec.drums||0,spec.drumCarriers||0),greatDrums=Math.max(minimumDrums,spec.gs.max||0);
  if(spec.totals&&goal==='great'&&spec.gs.kind==='drum'&&greatDrums>minimumDrums&&shared.drumTier===undefined){
    const scope={...shared,ctx,inventory,statOpportunity};
    const great=fitExpeditionEquipment(store,{scheme,missionId,goal,heldSlots},{...scope,drumTier:greatDrums});
    if(great.evaluation.eligible)return great;
    const minimum=fitExpeditionEquipment(store,{scheme,missionId,goal,heldSlots},{...scope,drumTier:minimumDrums});
    return minimum.evaluation.eligible||gapOrder({gap:gapScore(minimum.evaluation)},{gap:gapScore(great.evaluation)})<0?minimum:great;
  }
  const reserved=new Map(),isDrum=id=>store.info.equips[id]?.api_slotitem_id===75;
  for(const entry of scheme.ships){
    const lock=held.get(entry.id);
    for(const k of Object.keys(lock?.keep||{})){
      const id=k==='ex'?lock.ex:lock.slots[k];
      if(id>0){if(reserved.has(id))throw error('INVALID_QUERY','手动指定的装备重复');reserved.set(id,`${entry.id}:${k}`);}
    }
  }
  const used=new Set(),entries=scheme.ships.map(s=>{
    const lock=held.get(s.id),count=usableSlots(store,s.id).length;
    const slotLimit=expeditionLoadout.automaticSlotLimit({id:s.id,slots:Array(count).fill(-1)},held);
    const normalize=(value,k)=>{
      const pinned=!!lock?.keep?.[k],id=pinned?(k==='ex'?lock.ex:lock.slots[k]):value;
      if(!pinned&&k!=='ex'&&k>=slotLimit)return -1;
      if(!(id>0))return -1;
      const owner=reserved.get(id);
      let valid=available.has(id)&&!used.has(id)&&(!owner||owner===`${s.id}:${k}`);
      try{valid=valid&&canEquip(store,s.id,id,k);}catch(_){valid=false;}
      if(!valid){if(pinned)throw error('INVALID_QUERY','手动装备当前不可用或不适配');return -1;}
      if(!pinned&&(isDrum(id)||!spec.totals&&expeditionLoadout.isCargo(store,id)))return -1;
      used.add(id);return id;
    };
    return {id:s.id,slots:Array.from({length:count},(_,k)=>normalize(s.slots?.[k]??store.info.ships[s.id].api_slot[k],k)),
      ex:normalize(s.ex??store.info.ships[s.id].api_slot_ex,'ex')};
  });
  const drums=inventory.filter(i=>i.master.api_id===75||store.info.equips[i.id]?.api_slotitem_id===75)
    .sort((a,b)=>Number(!ids.includes(a.sourceShipId))-Number(!ids.includes(b.sourceShipId))||Number(!!a.sourceShipId)-Number(!!b.sourceShipId)||a.id-b.id);
  const target=shared.drumTier??Math.max(spec.drums||0,spec.drumCarriers||0,goal==='great'&&spec.gs.kind==='drum'?spec.gs.max||0:0);
  const counts=()=>entries.map(s=>s.slots.concat(s.ex).filter(isDrum).length);
  let values=counts();
  while(values.reduce((n,v)=>n+v,0)<target||values.filter(v=>v>0).length<(spec.drumCarriers||0)){
    const needCarrier=values.filter(v=>v>0).length<(spec.drumCarriers||0),positions=[];
    entries.forEach((s,i)=>{if(needCarrier&&values[i])return;
      s.slots.forEach((previous,k)=>{if(k<expeditionLoadout.automaticSlotLimit(s,held)&&!held.get(s.id)?.keep?.[k]&&!isDrum(previous))positions.push({s,i,k,previous});});});
    const cargo=inventory.filter(item=>expeditionLoadout.isAutomaticCargo(store,item.id));
    const opportunity=position=>cargo.some(item=>expeditionLoadout.fits(store,item,position.s.id,position.k))?1:0;
    positions.sort((a,b)=>(statOpportunity?statOpportunity(a.s.id,a.k)-statOpportunity(b.s.id,b.k):0)||
      opportunity(a)-opportunity(b)||Number(a.previous>0)-Number(b.previous>0)||a.i-b.i||a.k-b.k);
    let placed=false;
    for(const position of positions){
      const item=drums.find(row=>{
        if(used.has(row.id))return false;
        try{return canEquip(store,position.s.id,row.id,position.k)&&(!row.sourceShipId||row.sourceShipId===position.s.id||acceptsOtherSlot(store,position.s.id,row.id,position.k));}catch(_){return false;}
      });
      if(!item)continue;
      used.delete(position.previous);position.s.slots[position.k]=item.id;used.add(item.id);placed=true;break;
    }
    if(!placed)break;
    values=counts();
  }
  // Optional drums only help when the complete tier is attainable. Do not
  // occupy reward slots with a partial tier that leaves probability unchanged.
  if(goal==='great'&&spec.gs.kind==='drum'&&values.reduce((n,v)=>n+v,0)<target){
    for(const s of entries.slice().reverse())for(let k=s.slots.length-1;k>=0;k--){
      values=counts();const i=entries.indexOf(s),minimum=Math.max(spec.drums||0,spec.drumCarriers||0);
      if(!isDrum(s.slots[k])||held.get(s.id)?.keep?.[k]||values.reduce((n,v)=>n+v,0)<=minimum||
        values[i]===1&&values.filter(v=>v>0).length<=(spec.drumCarriers||0))continue;
      used.delete(s.slots[k]);s.slots[k]=-1;
    }
  }
  if(spec.totals)require('./loadout/expedition_stats').fitStatEquipment(store,entries,inventory,held,spec,shared.readStats);
  expeditionLoadout.fitIncomeEquipment(store,entries,inventory,held,spec,missionId);
  const fitted=orderEquipment(store,{fleet:ctx.fleet,ships:entries},heldSlots);ctx.preview.preview('fleet',fitted);
  const evaluation=expeditions.evaluateExpedition(store,ctx.fleet,missionId,fitted);
  const warnings=evaluation.checks.filter(c=>!c.sat&&['drums','drumCarriers'].includes(c.type))
    .map(c=>`${c.type==='drums'?'运输桶':'载桶舰娘'}不足：${c.left} / ${c.right}，请调整舰娘、手动装备或可用运输桶`);
  return {scheme:fitted,evaluation,warnings,drumTarget:target,income:expeditionIncome.missionIncome(store,entries,missionId)};
}
// Workbench-local adjustment: evaluate equipment for exactly these hulls, in
// exactly this order. Never run the fleet search or fill an empty ship slot.

module.exports={recommendExpeditionEquipment,recommendExpeditionFleet,recommendExpeditionGoals};
