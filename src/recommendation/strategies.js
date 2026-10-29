'use strict';
// Reviewed guide policies, fleet templates and special-attack seed positions.
const {specialAttackCores,arrangeSpecialAttack}=require('../domain/combat/special_attacks');
const {aswEscortLimit,aswEscortIds,availableEquipment}=require('./loadout/loadout_policy');
const {canEquip,acceptsOtherSlot}=require('../domain/fleet/equipment_rules');
const aswCombat=require('../domain/combat/asw_combat');
const {aswPotential,hasDuplicateShipFamily,idsKey,num,schemeOf,shipCost,usableSlots}=require('./context');
const {antiGroundShips,requiredDestroyerGuns,surfaceWeaponCount}=require('./fitting');
const {routeGroundTargets}=require('../domain/combat/installation_attack');
const {carrierStrike,openingAirStrike,openingTorpedo}=require('./scoring');

// Fleet shapes live in the reviewed catalog; routing remains in normal_routes.
const catalog=require('../../data/normal_route_guides.json').maps;
const guideSource=area=>catalog[area]?.source||Object.entries(catalog).find(([key])=>key.startsWith(area+':'))?.[1].source;
const guidePolicy=(area,target='boss',phase)=>{
  const entry=catalog[area+':'+(phase||target)]||catalog[area+':'+target]||catalog[area];
  if(!entry||entry.target!==target)return null;
  const templates=[...new Map(entry.routes.flatMap(r=>(r.templates||[]).map(t=>[JSON.stringify(t),t]))).values()];
  return {...entry,area,phase,templates,minShips:Math.min(...templates.map(t=>t.length))};
};
const guideShipAllowed=(policy,area,phase,row)=>row.level>=(row.stype===1&&policy.coastalMinLevel||policy.minLevel||1);
function remainingSlots(rows,slots){
  if(!rows.length)return slots;
  const row=rows[0];
  for(let i=0;i<slots.length;i++)if(slots[i].includes(row.stype)){
    const rest=remainingSlots(rows.slice(1),slots.filter((_,index)=>index!==i));
    if(rest)return rest;
  }
  return null;
}
function guideHull(policy,rows){
  if(!policy)return true;
  const minShips=policy.minShips||Math.min(...policy.templates.map(slots=>slots.length));
  if(rows.length<minShips||rows.some(row=>!guideShipAllowed(policy,policy.area,policy.phase,row)))return false;
  if(!policy.templates)return rows.every(row=>
    !(policy.area==='1-1'?[19,20,22]:[13,14,19,20,22]).includes(row.stype)||
    policy.allowedAuxiliaryStypes?.includes(row.stype)||
    policy.area==='1-4'&&[13,14].includes(row.stype)&&rows.filter(r=>[7,11,18].includes(r.stype)).length===3&&rows.some(r=>r.stype===20));
  return policy.templates.some(slots=>rows.length===slots.length&&
    remainingSlots(rows,slots)?.length===0);
}
function guideSeeds(ctx,policy,sorterLimit=6){
  if(!policy?.templates)return [];
  // Opening escorts are an equipment role, not a synonym for light cruisers.
  // Match the pair to distinct available midget submarines; level-10 SS/SSV
  // need none. Final fitted route facts still validate the actual equipment.
  const openingEscorts=policy.fleetRequirement?.all?.some(rule=>rule.openingTorpedoCarriers);
  const openingItems=openingEscorts?availableEquipment(ctx.store).filter(item=>
    Number(item.master.api_type?.[2])===22&&/甲標的/.test(item.master.api_name||'')):[];
  const openingChoices=new Map();
  const choices=row=>{
    if(!openingChoices.has(row.id))openingChoices.set(row.id,openingItems.filter(item=>
      usableSlots(ctx.store,row.id).some((_,slot)=>{
        try{return canEquip(ctx.store,row.id,item.id,slot)&&(!item.sourceShipId||item.sourceShipId===row.id||acceptsOtherSlot(ctx.store,row.id,item.id,slot));}catch(_){return false;}
      })).map(item=>item.id));
    return openingChoices.get(row.id);
  };
  const openingPairPossible=rows=>{
    const needs=rows.filter(row=>![7,11,18,20].includes(row.stype)&&!([13,14].includes(row.stype)&&row.level>=10));
    const match=(index,used)=>index===needs.length||choices(needs[index]).some(id=>
      !used.has(id)&&match(index+1,new Set([...used,id])));
    return match(0,new Set());
  };
  const battle=row=>num(row.ship.api_karyoku)+num(row.ship.api_raisou)*0.6+
    num(row.ship.api_soukou)*0.4+row.level*0.5;
  const aviation=row=>(row.master.api_maxeq||[]).reduce((n,v)=>n+Math.sqrt(v||0),0);
  const sorters=[
    (a,b)=>b.power-a.power||a.id-b.id,
    (a,b)=>battle(b)-battle(a)||a.id-b.id,
    (a,b)=>aviation(b)-aviation(a)||battle(b)-battle(a)||a.id-b.id,
    // Preserve aviation capacity while independently covering fighting escorts.
    (a,b)=>a.stype===2&&b.stype===2?battle(b)-battle(a)||a.id-b.id:
      aviation(b)-aviation(a)||battle(b)-battle(a)||a.id-b.id,
    (a,b)=>Number(b.master.api_slot_num||0)-Number(a.master.api_slot_num||0)||battle(b)-battle(a),
    (a,b)=>{
      const aAsw=aswPotential(ctx.store,a),bAsw=aswPotential(ctx.store,b);
      return (Number.isFinite(bAsw-aAsw)?bAsw-aAsw:0)||battle(b)-battle(a);
    }
  ];
  const results=[];
  for(const slots of policy.templates)for(const compare of sorters.slice(0,sorterLimit)){
    const rows=ctx.fixed.map(id=>ctx.byId.get(id));
    const remaining=remainingSlots(rows,slots);
    if(!remaining||openingEscorts&&!openingPairPossible(rows)||rows.some(row=>!guideShipAllowed(policy,policy.area,policy.phase,row)))continue;
    const used=new Set(rows.map(row=>row.id));let complete=true;
    for(const types of remaining){
      const next=ctx.roster.filter(row=>types.includes(row.stype)&&
        guideShipAllowed(policy,policy.area,policy.phase,row)&&!used.has(row.id)&&
        (!openingEscorts||openingPairPossible([...rows,row]))&&
        !hasDuplicateShipFamily([...rows,row])).sort(compare)[0];
      if(!next){complete=false;break;}
      rows.push(next);used.add(next.id);
    }
    if(complete)results.push(rows);
  }
  return results;
}
function oneOneSeeds(ctx){
  const fixed=ctx.fixed.map(id=>ctx.byId.get(id));
  if(fixed.length>=2)return [];
  const options=ctx.roster.filter(row=>!ctx.fixed.includes(row.id)&&
    ![1,19,20,22].includes(row.stype)&&
    !hasDuplicateShipFamily([...fixed,row])).map(row=>{
    const scheme=schemeOf(ctx.fleet,[row]);
    const early=openingTorpedo(ctx.store,[row],scheme).power+
      openingAirStrike(ctx.store,[row],scheme);
    return {row,early,cost:shipCost(row)};
  });
  const chosen=new Map();
  for(const item of options.slice().sort((a,b)=>b.early-a.early||a.cost-b.cost).slice(0,16))
    chosen.set(item.row.id,item.row);
  for(const item of options.filter(item=>item.early>0).sort((a,b)=>
    b.early/Math.max(1,b.cost)-a.early/Math.max(1,a.cost)).slice(0,12))
    chosen.set(item.row.id,item.row);
  for(const item of options.filter(item=>[4,7,13,14,16].includes(item.row.stype))
    .sort((a,b)=>a.cost-b.cost||b.row.level-a.row.level).slice(0,12))
    chosen.set(item.row.id,item.row);
  const dualCapable=row=>[3,6,16].includes(row.stype)&&
    (row.master.api_maxeq||[]).some(count=>Number(count)>0)&&
    openingTorpedo(ctx.store,[row],schemeOf(ctx.fleet,[row])).count>0;
  const dualRows=options.filter(item=>dualCapable(item.row))
    .sort((a,b)=>b.row.level-a.row.level||a.cost-b.cost).slice(0,8);
  for(const item of dualRows)
    chosen.set(item.row.id,item.row);
  const shortlist=[...dualRows.map(item=>item.row),...chosen.values()]
    .filter((row,index,array)=>array.findIndex(other=>other.id===row.id)===index)
    .slice(0,28),results=[];
  const pairOptions=[
    ...[4,7,3,6,16,13,14,11,18].flatMap(type=>shortlist.filter(row=>row.stype===type)
      .sort((a,b)=>Number(dualCapable(b))-Number(dualCapable(a)))
      .slice(0,type===16?3:2)),
    ...shortlist.slice(0,4)
  ].filter((row,index,array)=>array.findIndex(other=>other.id===row.id)===index)
    .slice(0,22);
  for(const row of shortlist){
    results.push([...fixed,row]);
    if(!fixed.length&&pairOptions.includes(row))for(const second of pairOptions){
      if(second.id===row.id||hasDuplicateShipFamily([row,second]))continue;
      results.push([row,second]);
    }
  }
  return results;
}
function guideReady(policy,area,phase,store,scheme,rows,route,profile){
  if(!policy)return true;
  // Preset identity is checked per selected option, not against the union of
  // every preset. Explicit physical-path queries must still compare strong
  // legal fleets outside those examples on the same combat-readiness basis.
  if(rows.some(row=>!guideShipAllowed(policy,area,phase,row))||!['known','possible'].includes(profile?.status))return false;
  const counts=type=>rows.filter(row=>type.includes(row.stype)).length;
  const destroyers=scheme.ships.filter(entry=>Number(store.const.$ships[
    store.info.ships[entry.id].api_ship_id]?.api_stype)===2);
  const guns=destroyers.map(entry=>surfaceWeaponCount(store,entry));
  const escorts=aswEscortIds(store,scheme.ships,aswEscortLimit(profile,store));
  const armed=minimum=>destroyers.every((entry,i)=>guns[i]>=minimum||escorts.has(entry.id)&&
    aswCombat.requiresAswPackages(profile)&&entry.slots.filter(id=>aswCombat.isAswWeapon(
      store.const.$equips[store.info.equips[id]?.api_slotitem_id])).length>=2);
  // A real ASW escort may trade guns for a useful package. Do not veto it
  // with a template preference before its damage and boss firepower are scored.
  if(!armed(requiredDestroyerGuns(area,phase,profile)))return false;
  const capitalGuns=scheme.ships.filter(entry=>[8,9,10].includes(Number(
    store.const.$ships[store.info.ships[entry.id].api_ship_id]?.api_stype)))
    .map(entry=>(entry.slots||usableSlots(store,entry.id)).filter(id=>
      [2,3,4].includes(Number(store.const.$equips[
        store.info.equips[id]?.api_slotitem_id]?.api_type?.[2]))).length);
  if(capitalGuns.some(count=>count<(area==='1-1'?1:2)))return false;
  const strike=()=>carrierStrike(store,rows,scheme)>0;
  const ground=()=>antiGroundShips(store,scheme);
  // Route predicates and the selected preset already validate hulls, speed,
  // LoS and target. Do not reapply older map-specific compositions here.
  if(counts([7,11,18])&&!strike())return false;
  if(routeGroundTargets(profile).length&&ground().length===0)return false;

  return true;
}
function specialPositionLocks(ctx,heldSlots){
  const locked=new Map();
  const held=(heldSlots||[]).filter(s=>s&&(s.pin||Object.keys(s.keep||{}).length));
  (heldSlots||[]).forEach((s,i)=>{if(held.includes(s)&&s.holdPosition!==false)locked.set(i,s.id);});
  // Explicit held positions take precedence; legacy fixedShipIds retain their
  // existing prefix positions when there is no draft-position information.
  if(!held.length)ctx.fixed.forEach((id,i)=>locked.set(i,id));
  return locked;
}
function specialFleetSeeds(ctx,policies,heldSlots,night){
  const locked=specialPositionLocks(ctx,heldSlots);
  const cores=specialAttackCores(ctx.roster),output=[],seen=new Set();
  const power=row=>num(row.ship.api_karyoku)+(night?num(row.ship.api_raisou):0);
  const templates=[...new Map(policies.filter(Boolean).filter(p=>p.templates)
    .flatMap(p=>p.templates.map(t=>[JSON.stringify(t),{...p,templates:[t]}]))).values()];
  // A physical-path request may use either cruiser variant beside a special
  // attack core. Keep exact preset seeds first; final route identity still
  // rejects variants outside a selected preset's explicit composition.
  templates.push(...templates.filter(p=>p.templates[0].some(slot=>slot.includes(5)&&!slot.includes(6)))
    .map(p=>({...p,templates:[p.templates[0].map(slot=>slot.includes(5)?[...new Set([...slot,6])]:slot)]})));
  const choices=[];
  for(const core of cores){
    if(core.some((r,i)=>locked.has(i)&&locked.get(i)!==r.id||[...locked].some(([p,id])=>id===r.id&&p!==i)))continue;
    const fixed=[...new Set([...ctx.fixed,...locked.values(),...core.map(r=>r.id)])];
    if(fixed.length>6)continue;
    const variants=[];
    for(const policy of templates){
      for(const rows of guideSeeds({...ctx,fixed},policy,2)){
        const ordered=arrangeSpecialAttack(rows,core,{locked,power});if(!ordered)continue;
        const key=idsKey(ordered);if(seen.has(key))continue;seen.add(key);variants.push(ordered);
        if(variants.length>=8)break;
      }
      if(variants.length>=8)break;
    }
    if(variants.length)choices.push(variants);
  }
  // Share the bounded budget across attack cores, rather than allowing the
  // first core's many guide variants to consume every place.
  for(let index=0;index<8;index++)for(const variants of choices)if(variants[index]){
    output.push(variants[index]);if(output.length>=64)return output;
  }
  return output;
}


module.exports={guideHull,guidePolicy,guideReady,guideSeeds,guideShipAllowed,guideSource,oneOneSeeds,remainingSlots,specialFleetSeeds,specialPositionLocks};
