'use strict';
const {canEquip,acceptsOtherSlot}=require('../../domain/fleet/equipment_rules');
const {dedicated,flags,itemsForEntry,routeGroundTargets,groundCombatContext,fleetGroundScore,groundBomber,carrierGroundState}=require('../../domain/combat/installation_attack');
const {aswEscortLimit,aswEscortIds}=require('./loadout_policy');
const {smallCarrierSlot}=require('./carrier_policy');
const type=m=>Number(m?.api_type?.[2]);
const main=m=>[1,2,3,38].includes(type(m));
const scout=m=>[10,11].includes(type(m));
// Preserve aviation, speed, routing cargo, opening torpedoes and ASW packages.
// Water reconnaissance may trade its slot for a specialist ground package;
// final route validation checks its LoS and spotting consequences again.
const protectedTypes=new Set([6,7,8,9,11,14,15,17,22,29,30,33,34,40,41,42,44,45,54,57,58,87,93,94]);
const signature=entry=>[entry.slots.join(','),entry.ex].join(':');
const clone=entry=>({...entry,slots:entry.slots.slice()});
const read=(entry,k)=>k==='ex'?entry.ex:entry.slots[k];
const write=(entry,k,id)=>{if(k==='ex')entry.ex=id;else entry.slots[k]=id;};

function carrierGroundLoadout(store,scheme,inventory,profile,locks,airReference){
  const bombers=inventory.filter(i=>groundBomber(i.master));if(!bombers.length)return [];
  const current={fleet:scheme.fleet,ships:scheme.ships.map(clone)};let changed=false;
  for(const entry of current.ships){
    const ship=store.info.ships[entry.id],sm=store.const.$ships[ship.api_ship_id];
    if(![7,11,18].includes(Number(sm.api_stype))||carrierGroundState(itemsForEntry(store,entry))==='ready')continue;
    const context=groundCombatContext(store,current,profile,{airReference}),base=context.score(entry).score;
    const used=new Set(current.ships.flatMap(s=>s.slots.concat(s.ex)).filter(id=>id>0));let best=null;
    for(let k=0;k<entry.slots.length;k++){
      const old=store.const.$equips[store.info.equips[entry.slots[k]]?.api_slotitem_id];
      if(locks.get(entry.id)?.[k]||smallCarrierSlot(ship,sm,k)||entry.slots[k]>0&&type(old)!==7)continue;
      for(const item of bombers){
        if(used.has(item.id))continue;
        try{if(!canEquip(store,entry.id,item.id,k)||item.sourceShipId&&item.sourceShipId!==entry.id&&
          !acceptsOtherSlot(store,entry.id,item.id,k))continue;}catch(_){continue;}
        const trial=clone(entry);trial.slots[k]=item.id;
        const gain=context.score(trial).score-base;
        if(gain>1&&(!best||gain>best.gain))best={k,item,gain};
      }
    }
    if(best){entry.slots[best.k]=best.item.id;changed=true;}
  }
  return changed?[current]:[];
}

function groundLoadouts(store,scheme,inventory,{profile,heldSlots=[],airReference,packages=true}={}){
  if(!routeGroundTargets(profile).length)return [];
  const master=id=>store.const.$equips[store.info.equips[id]?.api_slotitem_id];
  const locks=new Map(heldSlots.filter(Boolean).map(s=>[s.id,s.keep||{}]));
  let entries=scheme.ships.map(s=>({...s,slots:(s.slots||store.info.ships[s.id].api_slot).slice(),ex:s.ex??store.info.ships[s.id].api_slot_ex}));
  const carrierVariants=carrierGroundLoadout(store,{fleet:scheme.fleet,ships:entries},inventory,profile,locks,airReference);
  if(carrierVariants.length)entries=carrierVariants[0].ships;
  const escorts=aswEscortIds(store,entries,aswEscortLimit(profile));
  const protectedItem=(entry,id)=>protectedTypes.has(type(master(id)))&&
    (escorts.has(entry.id)||![14,15,40,44].includes(type(master(id))))&&!dedicated(master(id));
  // Effect groups retain instances and borrow/slot permissions. Select an
  // available representative again at every branch, never clone inventory.
  const groups=new Map();
  for(const item of inventory){
    if(!dedicated(item.master)&&!main(item.master)&&type(item.master)!==10&&
      ![12,13,19,21,27,39].includes(type(item.master)))continue;
    const key=dedicated(item.master)?'ground:'+flags(item.master).join(','):
      'ordinary:'+store.info.equips[item.id]?.api_slotitem_id;
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);
  }
  if(![...groups.keys()].some(k=>k.startsWith('ground:')))return carrierVariants;
  const raw=item=>Number(item.master.api_houg||0)*3+Number(item.master.api_houm||0)*2+
    Number(item.master.api_saku||0)+Math.sqrt(Number(store.info.equips[item.id]?.api_level||0))*3;
  for(const group of groups.values())group.sort((a,b)=>raw(b)-raw(a)||a.id-b.id);
  const inventoryById=new Map(inventory.map(i=>[i.id,i])),compatible=new Map();
  const scoreCache=new Map(),scoring={airReference,scoreCache};
  const legal=(entry,k,item)=>{
    const key=[entry.id,k,item.id].join(':');
    if(!compatible.has(key)){
      let ok=false;try{ok=canEquip(store,entry.id,item.id,k)&&
        (!item.sourceShipId||item.sourceShipId===entry.id||acceptsOtherSlot(store,entry.id,item.id,k));}catch(_){}
      compatible.set(key,ok);
    }
    return compatible.get(key);
  };
  if(!packages){
    const current={fleet:scheme.fleet,ships:entries},used=new Set(entries.flatMap(e=>e.slots.concat(e.ex)).filter(id=>id>0));
    let changed=false;
    for(let pass=0;pass<3;pass++){
      let placed=false;
      for(let index=0;index<entries.length;index++){
        const entry=entries[index],context=groundCombatContext(store,current,profile,scoring),base=context.score(entry).score;
        let best=null;
        for(const k of entry.slots.map((_,i)=>i).concat(store.info.ships[entry.id].api_slot_ex!==0?['ex']:[])){
          const old=read(entry,k);if(locks.get(entry.id)?.[k]||old>0&&protectedItem(entry,old))continue;
          for(const group of groups.values()){
            // Broad search keeps its inexpensive local passes. Whole gun/scout
            // packages are compared on the final route-specific shortlists.
            if(!dedicated(group[0].master))continue;
            const item=group.find(i=>!used.has(i.id)&&legal(entry,k,i));if(!item)continue;
            const trial=clone(entry);write(trial,k,item.id);const gain=context.score(trial).score-base;
            if(gain>1&&(!best||gain>best.gain))best={k,old,item,gain};
          }
        }
        if(best){write(entry,best.k,best.item.id);used.delete(best.old);used.add(best.item.id);changed=true;placed=true;}
      }
      if(!placed)break;
    }
    return [...(changed?[current]:[]),...carrierVariants];
  }
  const fit=(current,entry,mode)=>{
    const usedElsewhere=new Set(current.ships.filter(s=>s.id!==entry.id).flatMap(s=>s.slots.concat(s.ex)).filter(id=>id>0));
    const keep=locks.get(entry.id)||{},sm=store.const.$ships[store.info.ships[entry.id].api_ship_id];
    const positions=entry.slots.map((_,k)=>k).concat(store.info.ships[entry.id].api_slot_ex!==0?['ex']:[]);
    const mutable=positions.filter(k=>!keep[k]&&!(read(entry,k)>0&&protectedItem(entry,read(entry,k))));
    if(!mutable.length)return entry;
    if(!mutable.some(k=>[...groups.values()].some(g=>g.some(i=>dedicated(i.master)&&!usedElsewhere.has(i.id)&&legal(entry,k,i)))))return entry;
    const start=clone(entry);mutable.forEach(k=>write(start,k,-1));
    const fixedItems=itemsForEntry(store,start),roles=new Map();
    const available=mutable.filter(k=>k!=='ex');
    if(mode==='day'&&!fixedItems.some(e=>scout(e.master)&&e.planes>0)){
      const k=available.filter(k=>Number(sm.api_maxeq?.[k])>0&&[...groups.values()].some(g=>g.some(i=>type(i.master)===10&&!usedElsewhere.has(i.id)&&legal(entry,k,i))))
        .sort((a,b)=>Number(scout(master(read(entry,b))))-Number(scout(master(read(entry,a))))||Number(sm.api_maxeq[b])-Number(sm.api_maxeq[a])||a-b)[0];
      if(k===undefined)return entry;roles.set(k,'scout');
    }
    if(mode!=='specialist'){
      const needed=Math.max(0,2-fixedItems.filter(e=>main(e.master)).length);
      const gunSlots=available.filter(k=>!roles.has(k)&&[...groups.values()].some(g=>g.some(i=>main(i.master)&&!usedElsewhere.has(i.id)&&legal(entry,k,i))))
        .sort((a,b)=>Number(main(master(read(entry,b))))-Number(main(master(read(entry,a))))||a-b);
      if(gunSlots.length<needed)return entry;
      gunSlots.slice(0,needed).forEach(k=>roles.set(k,'gun'));
    }
    const context=groundCombatContext(store,current,profile,scoring),value=e=>context.score(e).score;
    // Mandatory gun/scout slots precede optional ground gear. A six-wide beam
    // crosses multi-item synergies without enumerating inventory permutations.
    const order=[...roles.keys(),...mutable.filter(k=>!roles.has(k))];
    let beam=[start];
    for(const k of order){
      const next=[];
      for(const candidate of beam){
        const used=new Set([...usedElsewhere,...candidate.slots,candidate.ex].filter(id=>id>0));
        const role=roles.get(k),options=[];
        for(const group of groups.values()){
          if(!(role==='gun'?main(group[0].master):role==='scout'?type(group[0].master)===10:dedicated(group[0].master)))continue;
          const representative=group.find(i=>!used.has(i.id)&&legal(entry,k,i));
          if(representative)options.push(representative);
        }
        if(role==='gun')options.sort((a,b)=>raw(b)-raw(a)||a.id-b.id).splice(8);
        if(role==='scout')options.sort((a,b)=>raw(b)-raw(a)||a.id-b.id).splice(3);
        if(!role){
          const old=inventoryById.get(read(entry,k));
          if(old&&!used.has(old.id)&&legal(entry,k,old))options.push(old);
          const utility=[...groups.values()].filter(g=>!dedicated(g[0].master)&&!main(g[0].master)&&type(g[0].master)!==10)
            .map(g=>g.find(i=>!used.has(i.id)&&legal(entry,k,i))).filter(Boolean).sort((a,b)=>raw(b)-raw(a)||a.id-b.id).slice(0,2);
          options.push(...utility);
        }
        const ids=[...new Set(options.map(i=>i.id))];if(!role&&!ids.length)ids.push(-1);
        for(const id of ids){const trial=clone(candidate);write(trial,k,id);next.push({entry:trial,score:value(trial)});}
      }
      next.sort((a,b)=>b.score-a.score);const seen=new Set();
      beam=next.filter(r=>{const key=signature(r.entry);if(seen.has(key))return false;seen.add(key);return true;}).slice(0,6).map(r=>r.entry);
      if(!beam.length)return entry;
    }
    const valid=beam.filter(e=>{let gap=false;return e.slots.every(id=>{if(id<=0){gap=true;return true;}return !gap;});});
    const best=valid.sort((a,b)=>value(b)-value(a))[0];
    return best&&value(best)>value(entry)+1?best:entry;
  };
  const options=[],baseline=fleetGroundScore(store,{...scheme,ships:entries},profile,undefined,scoring).bonus;
  for(const mode of ['day','night','specialist']){
    const current={fleet:scheme.fleet,ships:entries.map(clone)};
    for(let i=0;i<current.ships.length;i++)current.ships[i]=fit(current,current.ships[i],mode);
    const score=fleetGroundScore(store,current,profile,undefined,scoring).bonus;
    if(score>baseline+1)options.push({scheme:current,score});
  }
  options.sort((a,b)=>b.score-a.score);const seen=new Set();
  return [...options.map(r=>r.scheme),...carrierVariants].filter(s=>{const key=JSON.stringify(s);if(seen.has(key))return false;seen.add(key);return true;});
}
function groundLoadout(store,scheme,inventory,options){return groundLoadouts(store,scheme,inventory,options)[0]||null;}
module.exports={groundLoadout,groundLoadouts};
