'use strict';
// Read-only projections shared with the pages. These model modules do not
// instantiate React, a game host, a worker or a controller execution session.
const F=require('../ui/fleet/current_fleet_model');
const W=require('../ui/workbench/workbench_model');
const E=require('../ui/expedition/expedition_model');
const picker=require('../ui/components/area_picker');
const routes=require('../domain/routes/normal_routes');
const plans=require('../domain/routes/route_plans');
const {createFleetPlanner}=require('../domain/fleet/fleet_plan');
const {evaluateCandidate}=require('../domain/fleet/fleet_metrics');
const {error}=require('../shared/errors');
const fleetNumber=fleet=>{
  if(!Number.isInteger(fleet)||fleet<1||fleet>4)throw error('INVALID_QUERY','fleet must be an integer from 1 to 4');
  return fleet;
};
function resolveCandidate(store,scheme){
  try{
    const plan=createFleetPlanner(()=>store).preview('fleet',scheme),slots=W.resolved(store,plan);
    return {plan,slots,scheme:W.scheme(slots,scheme.fleet),store:W.projected(store,slots,scheme.fleet)};
  }catch(e){throw error(e.code||'INVALID_SCHEME',e.message);}
}
function fleetStatus(store,{fleet=1,presetId,scheme},now){
  fleetNumber(fleet);
  if(presetId!==undefined&&(!Number.isSafeInteger(presetId)||presetId<1))throw error('INVALID_QUERY','presetId must be a positive integer');
  if(presetId!==undefined&&scheme)throw error('INVALID_QUERY','presetId and scheme are mutually exclusive');
  const candidate=scheme?resolveCandidate(store,scheme):null;
  const model=F.inspect(candidate?.store||store,candidate?scheme.fleet:fleet,presetId??null);
  if(candidate){
    // Candidate values must compare before/after equipment against the
    // original snapshot, rather than treating a projected loadout as observed.
    model.metrics=evaluateCandidate(store,candidate.plan);
    const mechanisms=require('../domain/combat/ship_mechanisms');
    model.speed=mechanisms.fleetSpeed(store,candidate.slots);
    const combat=mechanisms.fleetMechanisms(store,candidate.slots,model.speed,undefined,{conditionalGroundDouble:true});
    const expedition=E.shipBadges(E.fleetStatus(store,candidate.slots));
    model.ships=model.ships.map(s=>({...s,badges:[...(combat.get(s.id)||[]),...(expedition.get(s.id)||[])]}));
  }
  if(presetId===undefined)model.heading=F.fleetHeading(candidate?.store||store,candidate?scheme.fleet:fleet,now);
  // Preserve machine-readable mechanism data while omitting local file URLs.
  model.ships=model.ships.map(({portrait,...ship})=>({...ship,equipment:ship.equipment?.map(e=>{
    const raw=store.info.equips[e.id],master=store.const.$equips[raw?.api_slotitem_id];
    const {icon,...item}=e.item||{};
    return {...e,item:e.item?item:null,masterId:raw?.api_slotitem_id??null,
      improvement:raw?.api_level??0,proficiency:raw?.api_alv??0,baseStats:master||null};
  })}));
  return {...model,source:scheme?'candidate':presetId!==undefined?'preset':'fleet',
    statsSource:scheme?'observedBeforeCandidateEquipment':'observed',
    scheme:candidate?.scheme||W.scheme(model.heading.ids.slice(0,6).flatMap(id=>{
      try{return [W.entry(store,id)];}catch(_){return [];}
    }),fleet),
    ...(candidate?{donorShipIds:[...new Set(candidate.plan.equipment.donors.map(d=>d.shipId))]}:{})};
}
function fleets(store,now){
  return {items:[1,2,3,4].map(fleet=>({...F.fleetHeading(store,fleet,now),...F.summarize(store,fleet)}))};
}
function presets(store){return F.presetList(store);}
function mapDetail(store,{area,target='boss',phase,routeKey,nodeId},settings){
  // Validate map/target/phase using the domain entry point, before any dynamic
  // resource lookup. A route key may select a phase not currently active.
  routes.evaluateNormalRoute(store,{area,target,phase});
  let selected;
  if(routeKey!==undefined){
    selected=plans.routeOptions(area,target,phase).find(o=>o.key===routeKey);
    if(!selected)throw error('INVALID_QUERY','Unknown routeKey for this area, target and phase');
    phase=selected.phase||phase;
  }
  const overview=W.mapOverview(area,target,phase,settings,store);
  if(selected&&!overview.options.some(o=>o.key===selected.key))overview.options.push(selected);
  const displayPhase=phase||plans.currentPhase(area,store);
  const profile=routeKey?W.selectedMapProfile(overview,routeKey,null,null,false,store):
    phase?overview.profile:W.mapOverview(area,target,displayPhase,settings,store).profile;
  if(nodeId!==undefined&&!profile.mapPreview.nodes.some(n=>n.id===nodeId))throw error('INVALID_QUERY','Unknown nodeId for this map');
  return {area,target,phase:displayPhase||null,routes:overview.options,selectedRoute:selected||null,
    progress:W.mapProgress(store,area),profile,
    threat:W.displayThreat(profile,nodeId||null)};
}
function evaluateRoute(store,args,settings){
  const detail=mapDetail(store,args,settings),phase=detail.phase||undefined;
  const route=routes.evaluateNormalRoute(store,{...args,phase});
  route.fixedArrivalCondition=routes.fixedArrivalCondition(route);
  const fleet=fleetNumber(args.scheme?.fleet??args.fleet??1);
  const candidate=args.scheme?resolveCandidate(store,args.scheme):null;
  const metrics=candidate?evaluateCandidate(store,candidate.plan):F.inspect(store,fleet).metrics;
  const selected=plans.fleetPathOption(route,detail.selectedRoute);
  const profile=selected?W.selectedMapProfile({profile:detail.profile,options:[selected]},selected.key,null,route,undefined,store):detail.profile;
  const report={route,metrics,profile};
  return {...route,profile,metrics,progress:detail.progress,
    ...(selected?{selectedRoute:selected,planning:plans.optionPlanning(route,selected),
      arrival:W.routeArrival(report,selected,true,args.target||'boss')} : {}),
    fleetSummary:W.fleetSummary(report,profile,selected?plans.optionPaths(selected):undefined)};
}
function missions(store,{search='',sort='number',missionId}={}){
  if(typeof search!=='string'||!['number','short','long','fuel','ammo','steel','bauxite'].includes(sort))throw error('INVALID_QUERY','Invalid expedition search or sort');
  const all=require('../domain/expeditions/expeditions').listExpeditions(store);
  if(missionId!==undefined&&!all.some(m=>m.missionId===missionId))throw error('INVALID_QUERY','Unknown missionId');
  const summaries=new Map(all.map(m=>[m.missionId,{...E.missionSummary(m,store.const.$missions[m.missionId],store.const.$useitems,
    store.expeditionProgress||{},store.info.fleets),income:E.referenceIncome(m.missionId)}]));
  const summary=m=>summaries.get(m.missionId);
  const filtered=picker.filterMissions(all,summary,{query:search}).filter(m=>missionId===undefined||m.missionId===missionId);
  return {missions:picker.sortMissions(filtered,summary,sort).map(m=>({...m,...summary(m),
    unlocks:E.unlockItems(m.missionId,store.const.$missions,store.expeditionProgress||{})}))};
}
function equipmentOptions(store,{shipId,slot,scheme,search=''}){
  if(!Number.isSafeInteger(shipId)||shipId<1||!(slot==='ex'||Number.isInteger(slot)&&slot>=0&&slot<5)||typeof search!=='string')
    throw error('INVALID_QUERY','shipId must be an instance ID; slot must be 0..4 or ex; search must be a string');
  const slots=scheme?resolveCandidate(store,scheme).slots:[W.entry(store,shipId)];
  const index=slots.findIndex(s=>s.id===shipId);
  if(index<0||slot!=='ex'&&slot>=slots[index].slots.length||slot==='ex'&&store.info.ships[shipId]?.api_slot_ex===0)
    throw error('INVALID_QUERY','Target ship or equipment slot is not present/open');
  const current=slot==='ex'?slots[index].ex:slots[index].slots[slot];
  return {shipId,slot,currentItemId:current,items:W.equipmentOptions(store,slots,index,slot,search).map(({icon,...e})=>
    ({...e,instanceId:e.id,improvement:e.stars,current:e.id===current}))};
}
// Only user-selected positions/equipment become search constraints. Never let
// malformed or conflicting locks silently disappear inside a heuristic search.
function recommendationArgs(store,args){
  if(args.heldSlots===undefined)return args;
  if(!Array.isArray(args.heldSlots)||args.heldSlots.length>6)throw error('INVALID_QUERY','heldSlots must contain at most six positions');
  const fixed=new Set(args.fixedShipIds||[]),heldItems=new Set(),ids=new Set();
  for(const h of args.heldSlots){
    if(h===null)continue;
    const ship=store.info.ships[h?.id],count=store.const.$ships[ship?.api_ship_id]?.api_slot_num;
    if(!ship||ids.has(h.id))throw error('INVALID_QUERY','Each held slot must identify a unique owned ship');
    if(h.holdPosition!==undefined&&typeof h.holdPosition!=='boolean')throw error('INVALID_QUERY','holdPosition must be boolean');
    if(!h.pin&&!Object.keys(h.keep||{}).length)continue;
    ids.add(h.id);fixed.add(h.id);
    if(args.excludedShipIds?.includes(h.id))throw error('INVALID_QUERY','Held and excluded ship IDs overlap');
    for(const key of Object.keys(h.keep||{})){
      if(h.keep[key]!==true||!(key==='ex'||/^[0-4]$/.test(key)&&Number(key)<count))throw error('INVALID_QUERY','Invalid held equipment slot');
      const id=key==='ex'?h.ex:h.slots?.[Number(key)];
      if(!Number.isInteger(id)||id!==-1&&id<=0||id>0&&(!store.info.equips[id]||heldItems.has(id)))throw error('INVALID_QUERY','Held equipment must be an owned unique instance or -1 for empty');
      if(id>0)heldItems.add(id);
      if(id>0){
        const rules=require('../domain/fleet/equipment_rules');
        if(key==='ex'&&ship.api_slot_ex===0||!rules.canEquip(store,h.id,id,key==='ex'?'ex':Number(key)))
          throw error('INVALID_QUERY','Held equipment is not legal in this ship slot');
      }
    }
  }
  if(args.scheme&&[...ids].some(id=>!args.scheme.ships.some(s=>s.id===id)))throw error('INVALID_QUERY','Held ships must exist in scheme');
  return {...args,fixedShipIds:[...fixed],heldSlots:args.heldSlots.map(h=>h&&(h.pin||Object.keys(h.keep||{}).length)?h:null)};
}
function verifyConstraints(result,args,equipmentOnly=false,store){
  const variants=[...(result.scheme?[result]:[]),...(result.recommendations||[]),
    ...(result.closestRecommendation?[result.closestRecommendation]:[]),
    ...Object.values(result.goals||{}).flatMap(g=>[...(g.recommendations||[]),...(g.closestRecommendation?[g.closestRecommendation]:[])])];
  const quests=args.questCodes?.length?require('../domain/quests/quest_requirements').resolveQuestCodes(args.questCodes):[];
  for(const row of variants){
    const ships=row.scheme.ships;
    if(quests.length&&(!store||quests.some(quest=>require('../domain/quests/fleet_requirements').evaluateFleetRequirements(quest.fleet,store,ships,row.scheme.fleet).status!=='met')))
      throw error('INVALID_QUERY','推荐结果未能确认满足所有已选任务，未应用编成');
    if(equipmentOnly&&JSON.stringify(ships.map(s=>s.id))!==JSON.stringify(args.scheme.ships.map(s=>s.id)))
      throw error('INVALID_QUERY','Equipment recommendation changed hulls/order; no result applied');
    if(args.fixedShipIds?.some(id=>!ships.some(s=>s.id===id)))throw error('INVALID_QUERY','Recommendation did not preserve every fixed hull');
    (args.heldSlots||[]).forEach((held,position)=>{
      if(!held)return;
      const ship=held.holdPosition===false?ships.find(s=>s.id===held.id):ships[position];
      if(ship?.id!==held.id)throw error('INVALID_QUERY','No recommendation can preserve the requested hull positions');
      for(const key of Object.keys(held.keep||{}))if((key==='ex'?ship.ex:ship.slots?.[key])!==(key==='ex'?held.ex:held.slots[key]))
        throw error('INVALID_QUERY','Recommendation did not preserve a manually held equipment slot');
    });
  }
  return result;
}
module.exports={fleetStatus,fleets,presets,mapDetail,evaluateRoute,missions,equipmentOptions,resolveCandidate,recommendationArgs,verifyConstraints,fleetNumber};
