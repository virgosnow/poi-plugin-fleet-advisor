'use strict';
const perf=require('../../shared/performance_trace');
const {canEquip,acceptsOtherSlot}=require('../../domain/fleet/equipment_rules');
const {submarineEncounters,isAswWeapon,roles,assessAsw,reading}=require('../../domain/combat/asw_combat');
const {aircraftTypes,capacity}=require('../../domain/combat/asw_capability');
const kind=m=>Number(m?.api_type?.[2]);

// Pure-ASW aviation outfits need complete packages (e.g. two rotors on
// Hyuga), not independent sonar upgrades. A small beam keeps physical stock,
// slot legality and manually held gear while comparing actual attack power.
function fitAviationPackage(store,scheme,original,inventory,keep){
  const ship=store.info.ships[original.id],master=store.const.$ships[ship.api_ship_id],target={ship,master};
  const usedElsewhere=new Set(scheme.ships.filter(e=>e.id!==original.id).flatMap(e=>e.slots.concat(e.ex)).filter(id=>id>0));
  const groups=new Map();
  for(const item of inventory){
    const t=kind(item.master);if(!isAswWeapon(item.master)&&!aircraftTypes.has(t))continue;
    if(usedElsewhere.has(item.id))continue;
    const r=roles(item),key=isAswWeapon(item.master)?r.small||r.large?'sonar':r.depth?'depth':r.mortar?'mortar':'projector':
      [326,327].includes(Number(item.master.api_id))?'s51':t===8&&Number(item.master.api_tais)>=7?'aswTorpedo':String(t);
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);
  }
  const rank=entry=>{
    const r=reading(store,entry);
    return [Number(r.normal),Number(r.opening),r.status==='known'?r.power:0];
  };
  const compare=(a,b)=>{const x=rank(a),y=rank(b);return y[0]-x[0]||y[1]-x[1]||y[2]-x[2];};
  const itemValue=item=>Number(item.master.api_tais||0)*1.5+Math.sqrt(Number(store.info.equips[item.id]?.api_level||0));
  for(const pool of groups.values())pool.sort((a,b)=>itemValue(b)-itemValue(a)||a.id-b.id);
  const fixedTypes=new Set([6,17,18,19,22,24,30,33,34,37,42,45,46,54,56,57,58,87,93,94]);
  const positions=original.slots.map((id,k)=>k).filter(k=>!keep[k]&&!fixedTypes.has(kind(store.const.$equips[store.info.equips[original.slots[k]]?.api_slotitem_id])))
    .sort((a,b)=>capacity(target,b)-capacity(target,a)||a-b);
  const start={...original,slots:original.slots.map((id,k)=>positions.includes(k)?-1:id)};
  let beam=[start];
  for(const k of positions){
    const next=[];
    for(const entry of beam){
      const used=new Set(entry.slots.concat(entry.ex).filter(id=>id>0));
      const legal=item=>!used.has(item.id)&&(!aircraftTypes.has(kind(item.master))||capacity(target,k)>0)&&
        canEquip(store,entry.id,item.id,k)&&(!item.sourceShipId||item.sourceShipId===entry.id||acceptsOtherSlot(store,entry.id,item.id,k));
      next.push(entry);
      for(const pool of groups.values())for(const item of pool.filter(legal).slice(0,2)){
        const candidate={...entry,slots:entry.slots.slice()};candidate.slots[k]=item.id;next.push(candidate);
      }
    }
    next.sort(compare);beam=next.slice(0,8);
  }
  return [original,...beam].sort(compare)[0];
}

function fitAswLoadouts(store,scheme,inventory,options){
  const timing=perf.begin('loadout.asw');
  try{return fitAswLoadoutsCore(store,scheme,inventory,options);}finally{perf.end(timing);}
}
function fitAswLoadoutsCore(store,scheme,inventory,{profile,escorts,heldSlots=[]}={}){
  if(!submarineEncounters(profile).length||!escorts?.size)return [];
  const held=new Map(heldSlots.filter(Boolean).map(e=>[e.id,e.keep||{}]));
  const pure=profile.counts?.surface?.maximum===0&&profile.counts?.air?.maximum===0;
  const aviation=new Set(pure?scheme.ships.filter(e=>escorts.has(e.id)&&![1,2,3,4,21,22].includes(
    Number(store.const.$ships[store.info.ships[e.id].api_ship_id].api_stype))).map(e=>e.id):[]);
  const seed={fleet:scheme.fleet,ships:scheme.ships.map(e=>({...e,slots:e.slots.slice()}))};
  for(const entry of seed.ships.filter(e=>aviation.has(e.id)))
    seed.ships[seed.ships.indexOf(entry)]=fitAviationPackage(store,seed,entry,inventory,held.get(entry.id)||{});
  // Reconnaissance may yield its slot to an effective ASW kit; the caller
  // repairs and rechecks the real route LoS afterward. Keep fighters, attack
  // aircraft, speed, opening torpedoes and ground/routing equipment intact.
  const protectedTypes=new Set([6,7,8,9,11,17,18,19,22,24,25,26,30,33,34,37,41,42,45,46,54,57,58,87,93,94]);
  const pools=new Map();
  for(const item of inventory.filter(item=>isAswWeapon(item.master))){
    const r=roles(item),role=r.small||r.large?'sonar':r.depth?'depth':r.mortar?'mortar':'projector';
    if(!pools.has(role))pools.set(role,[]);pools.get(role).push(item);
  }
  for(const pool of pools.values())pool.sort((a,b)=>Number(b.master.api_tais||0)*1.5+Math.sqrt(Number(store.info.equips[b.id]?.api_level||0))-
    Number(a.master.api_tais||0)*1.5-Math.sqrt(Number(store.info.equips[a.id]?.api_level||0))||a.id-b.id);
  const patterns=[[],['sonar'],['projector'],['depth'],['projector','depth'],['sonar','projector'],['sonar','depth'],['sonar','mortar'],
    ['sonar','projector','depth'],['sonar','sonar','projector'],['sonar','projector','projector']];
  const results=[];
  for(const maxSlots of [1,2,3]){
    const current={fleet:scheme.fleet,ships:seed.ships.map(e=>({...e,slots:e.slots.slice()}))};
    for(const original of current.ships.filter(e=>escorts.has(e.id)&&!aviation.has(e.id))){
      const keep=held.get(original.id)||{},usedElsewhere=new Set(current.ships.filter(e=>e.id!==original.id).flatMap(e=>e.slots.concat(e.ex)).filter(id=>id>0));
      const master=id=>store.const.$equips[store.info.equips[id]?.api_slotitem_id];
      const positions=original.slots.map((_,k)=>k).filter(k=>!keep[k]&&!protectedTypes.has(kind(master(original.slots[k]))));
      if(!positions.length)continue;
      const legal=(item,k)=>{try{return !usedElsewhere.has(item.id)&&canEquip(store,original.id,item.id,k)&&
        (!item.sourceShipId||item.sourceShipId===original.id||acceptsOtherSlot(store,original.id,item.id,k));}catch(_){return false;}};
      const fixedAsw=original.slots.filter((id,k)=>keep[k]&&isAswWeapon(master(id))).length;
      let best=original,bestValue=-Infinity,bestCost=Infinity,bestChanges=Infinity;
      const consider=entry=>{
        const value=assessAsw(store,{fleet:scheme.fleet,ships:current.ships.map(e=>e.id===entry.id?entry:e)},profile,{limit:escorts.size});
        if(value.status!=='known')return;
        const score=value.readiness*10000+value.score;
        const cost=entry.slots.filter(id=>isAswWeapon(master(id))).length;
        const changes=entry.slots.filter((id,k)=>id!==original.slots[k]).length;
        if(score>bestValue+1e-8||Math.abs(score-bestValue)<1e-8&&(cost<bestCost||cost===bestCost&&changes<bestChanges)){
          best=entry;bestValue=score;bestCost=cost;bestChanges=changes;
        }
      };
      consider(original);
      for(const pattern of patterns.filter(p=>p.length+fixedAsw<=maxSlots&&p.length<=positions.length&&p.every(role=>pools.has(role)))){
        const visit=(step,entry,occupied,used)=>{
          if(step===pattern.length){consider(entry);return;}
          for(const k of positions){
            if(occupied.has(k))continue;
            // Retain stock counts and exact borrow/slot permissions. For
            // this role/position use the best available physical instance.
            const item=pools.get(pattern[step]).find(item=>!used.has(item.id)&&legal(item,k));if(!item)continue;
            const next={...entry,slots:entry.slots.slice()};next.slots[k]=item.id;
            visit(step+1,next,new Set([...occupied,k]),new Set([...used,item.id]));
          }
        };
        const start={...original,slots:original.slots.map((id,k)=>!keep[k]&&isAswWeapon(master(id))?-1:id)};
        visit(0,start,new Set(),new Set(start.slots.concat(start.ex).filter(id=>id>0)));
      }
      current.ships[current.ships.indexOf(original)]=best;
    }
    // A smaller ASW package releases slots for surface weapons, rather than
    // leaving holes that make the apparent equipment saving meaningless.
    const filled=require('./loadout_policy').completeCombatLoadout(store,current,inventory,{area:profile.area,asw:false,profile,heldSlots});
    filled.ships=filled.ships.map(entry=>escorts.has(entry.id)?entry:scheme.ships.find(e=>e.id===entry.id));
    if(JSON.stringify(filled)!==JSON.stringify(scheme)&&!results.some(r=>JSON.stringify(r)===JSON.stringify(filled)))results.push(filled);
  }
  return results;
}
module.exports={fitAswLoadouts};
