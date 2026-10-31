'use strict';
// Ranking policies, not damage/accuracy formulas. Numerical blue bonuses and
// mutually exclusive AA cut-ins come from the same rules as the UI badges.
const {projectShip}=require('../../domain/fleet/fleet_metrics');
const perf=require('../../shared/performance_trace');
const {combatBonuses}=require('../../domain/combat/equipment_bonuses');
const {fleetAntiAir,antiAirCutins}=require('../../domain/combat/anti_air_cutin');
const {snapshotMemo}=require('../../domain/fleet/equipment_planner');
const {canEquip,acceptsOtherSlot}=require('../../domain/fleet/equipment_rules');
const type=m=>Number(m?.api_type?.[2]);
const num=v=>Number((Array.isArray(v)?v[0]:v)||0);
const effectKeys=new WeakMap();
function targetFor(store,entry){
  const ship=store.info.ships[entry.id];
  const state={slots:entry.slots||ship.api_slot,ex:entry.ex??ship.api_slot_ex};
  return projectShip(store,entry.id,state);
}
function effectKey(target){
  if(effectKeys.has(target))return effectKeys.get(target);
  const key=JSON.stringify([target.ship.api_ship_id,target.items.map(e=>
    [e.instance?.api_slotitem_id,e.type,e.instance?.api_level??null]).sort((a,b)=>
    a[0]-b[0]||a[1]-b[1]||(a[2]??-1)-(b[2]??-1))]);
  effectKeys.set(target,key);return key;
}
function blueStats(store,target){
  // Only scalar facts are shared between equivalent inventory instances.
  // Ownership, slot legality and instance allocation remain with the caller.
  return snapshotMemo(store,'combatValue.blue',effectKey(target),()=>{
    const b=combatBonuses(store,target);
    return {firePower:b.firePower,torpedo:b.torpedo,antiAir:b.antiAir,known:b.known,reasons:b.reasons};
  });
}
function plannedStats(store,entry){
  perf.count('combat.panels.read');
  const timing=perf.begin('combat.panels');try{
  return snapshotMemo(store,'combatValue.panels',JSON.stringify(entry),()=>{
    perf.count('combat.panels.build');
    const target=targetFor(store,entry),before=targetFor(store,{id:entry.id});
    const oldBlue=blueStats(store,before),blue=blueStats(store,target),known=oldBlue.known&&blue.known;
    const raw=(t,key)=>t.items.reduce((n,e)=>n+Number(e.master?.[key]||0),0);
    const panel=(key,field,bonus)=>Math.max(0,num(target.ship[key])-raw(before,field)+raw(target,field)+
      (bonus&&known?blue[bonus]-oldBlue[bonus]:0));
    return {firePower:panel('api_karyoku','api_houg','firePower'),torpedo:panel('api_raisou','api_raig','torpedo'),
      antiAir:panel('api_taiku','api_tyku','antiAir'),armor:panel('api_soukou','api_souk'),
      known,reasons:[...new Set([...oldBlue.reasons,...blue.reasons])]};
  });
  }finally{perf.end(timing);}
}
function airExposure(store,profile,reference){
  if(!profile)return 0;
  return snapshotMemo(store,'combatValue.airExposure',reference||profile,()=>{
    const ref=reference||(profile.area?require('../../domain/routes/route_air').routeAirReference({},profile.area,profile):null);
    if(ref?.nodes?.length){
      const nodes=ref.nodes.filter(n=>!n.noAirBattle&&n.kind!=='asw');
      // Unknown enemy air is not zero proof, but is not a measured probability.
      return Math.min(2,nodes.reduce((n,p)=>n+(p.enemyAirPower>0?1:p.enemyAirPower==null ? .25:0),0));
    }
    return Math.min(2,Number(profile.counts?.air?.maximum||0));
  });
}
function losNeeded(store,profile,area){
  if(!profile)return false;
  return snapshotMemo(store,'combatValue.losNeeded',profile,()=>{
    const paths=profile.routePaths?.length?profile.routePaths.map(p=>p.nodes):profile.examples||[];
    return paths.some(nodes=>require('../../domain/routes/route_plans').losGates(area||profile.area,nodes,profile.phase).length>0);
  });
}
function cutinsFor(store,target){
  return snapshotMemo(store,'combatValue.cutins',effectKey(target),()=>antiAirCutins(target));
}
function antiAirScore(store,scheme,profile,reference){
  const timing=perf.begin('score.antiAir');try{
  const exposure=airExposure(store,profile,reference);
  if(!exposure)return {value:0,rate:null,exposure:0};
  const targets=scheme.ships.map(e=>targetFor(store,e));
  const aa=snapshotMemo(store,'combatValue.fleetCi',JSON.stringify(targets.map(t=>[t.id,effectKey(t)])),()=>
    fleetAntiAir(targets,t=>cutinsFor(store,t)));
  const value=aa.known?aa.rows.reduce((n,c)=>n+c.rate*((c.fixed||0)+4*((c.multiplier||1)-1)),0)*exposure:0;
  return {value,rate:aa.total,exposure,known:aa.known&&aa.rows.every(c=>c.fixed!==null&&c.multiplier!==null)};
  }finally{perf.end(timing);}
}
const rawAttack=m=>Number(m.api_houg||0)*3+Number(m.api_houm||0)*2+Number(m.api_raig||0);
function equipmentAffinity(store,entry,item,air){
  const ship=store.info.ships[entry.id];
  const key=JSON.stringify([ship.api_ship_id,item.master.api_id,store.info.equips[item.id]?.api_level??null,air]);
  return snapshotMemo(store,'combatValue.affinity',key,()=>{
    const target=targetFor(store,{id:entry.id,slots:[item.id],ex:-1}),blue=blueStats(store,target);
    return blue.known?3*blue.firePower+blue.torpedo+.2*air*blue.antiAir:0;
  });
}
function utilityRoles(store,entry){
  const ship=store.info.ships[entry.id],items=[...(entry.slots||ship.api_slot),entry.ex??ship.api_slot_ex]
    .filter(id=>id>0).map(id=>store.const.$equips[store.info.equips[id]?.api_slotitem_id]);
  return {radars:items.filter(m=>[12,13,93].includes(type(m))).length,
    aaCore:items.some(m=>Number(m?.api_type?.[3])===16||[21,36].includes(type(m)))};
}
function equipmentValue(store,entry,item,slot,{air=0,los=false,auxiliary=false}={},roles){
    const m=item.master,t=type(m),blueValue=equipmentAffinity(store,entry,item,air);
    if(!auxiliary)return rawAttack(m)+blueValue+.2*air*Number(m.api_tyku||0);
    const radar=[12,13,93].includes(t),{radars,aaCore}=roles||utilityRoles(store,entry);
    // Prefer a complementary role once a ship already has a radar. This is a
    // bounded loadout preference; radar accuracy still stacks in the game.
    const hitWeight=radar&&radars?(radars===1 ? .2:.05):1;
    // Initial fill only seeds a complementary radar role. Full combination
    // bonuses and mutually exclusive CI probabilities are scored on candidates.
    const ci=air&&radar&&!radars&&aaCore?8*air:0;
    const aa=Number(m.api_tyku||0)*.2*air;
    return Number(m.api_houg||0)*3+Number(m.api_houm||0)*2*hitWeight+Number(m.api_raig||0)+
      Number(m.api_souk||0)+Number(m.api_houk||0)+Number(m.api_saku||0)*(los?1:.1)*(radar&&radars ? .2:1)+
      aa+blueValue+ci;
}
function rankEquipment(store,entry,items,slot,options){
  const timing=perf.begin(options.auxiliary?'loadout.rank.auxiliary':'loadout.rank.guns');try{
  // Score a master/improvement group once, then use its real instances in the
  // original deterministic tie order. No extra whole-fleet search is added.
  const cache=snapshotMemo(store,'combatValue.equipmentOrders',items,()=>new Map());
  // The current outfit cannot change during this synchronous ranking. Read its
  // complementary radar/AA roles once, instead of once per equipment group.
  const roles=options.auxiliary?utilityRoles(store,entry):null;
  const key=JSON.stringify([entry.id,slot,options,roles]);
  if(cache.has(key)){perf.count('loadout.rank.hit');return cache.get(key);}
  perf.count('loadout.rank.build');
  const groups=new Map(),scores=new Map(),legal=[];
  for(const item of items){
    if(options.oneOne&&rawAttack(item.master)<=0)continue;
    const key=JSON.stringify([item.master.api_id,store.info.equips[item.id]?.api_level??null]);
    if(!groups.has(key)){
      let eligible=false,borrow=false;
      try{eligible=canEquip(store,entry.id,item.id,slot);borrow=eligible&&acceptsOtherSlot(store,entry.id,item.id,slot);}catch(_){/* Missing legality data is never accepted. */}
      groups.set(key,{eligible,borrow,value:eligible?equipmentValue(store,entry,item,slot,options,roles):0});
    }
    const group=groups.get(key);
    if(!group.eligible||item.sourceShipId&&item.sourceShipId!==entry.id&&!group.borrow)continue;
    legal.push(item);scores.set(item.id,group.value);
  }
  const result=legal.filter(i=>!options.auxiliary||scores.get(i.id)>0)
    .sort((a,b)=>scores.get(b.id)-scores.get(a.id)||a.id-b.id);
  if(cache.size>=2048)cache.delete(cache.keys().next().value);cache.set(key,result);return result;
  }finally{perf.end(timing);}
}
const rankGuns=(store,entry,items,slot,air)=>rankEquipment(store,entry,items,slot,{air});
module.exports={targetFor,blueStats,plannedStats,airExposure,losNeeded,antiAirScore,equipmentValue,rankGuns,rankEquipment};
