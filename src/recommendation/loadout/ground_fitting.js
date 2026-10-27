'use strict';
const {snapshotMemo}=require('../../domain/fleet/equipment_planner');
const perf=require('../../shared/performance_trace');
const {memoLoadout,referenceKey}=require('./search_memo');
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

// Only immutable searches share these catalogues. Availability is deliberately
// absent: every branch still picks an unused, legal inventory instance.
function groundInventory(store,inventory){
  return snapshotMemo(store,'groundLoadoutInventory',inventory,()=>{
    perf.count('ground.inventory.build');
    const groups=new Map(),values=new Map();
    const raw=item=>{
      if(!values.has(item.id))values.set(item.id,Number(item.master.api_houg||0)*3+Number(item.master.api_houm||0)*2+
        Number(item.master.api_saku||0)+Math.sqrt(Number(store.info.equips[item.id]?.api_level||0))*3);
      return values.get(item.id);
    };
    for(const item of inventory){
      if(!dedicated(item.master)&&!main(item.master)&&type(item.master)!==10&&
        ![12,13,19,21,27,39].includes(type(item.master)))continue;
      const key=dedicated(item.master)?'ground:'+flags(item.master).join(','):
        'ordinary:'+store.info.equips[item.id]?.api_slotitem_id;
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);
    }
    for(const group of groups.values())group.sort((a,b)=>raw(b)-raw(a)||a.id-b.id);
    const lists=[...groups.values()],compatible=new Map(),allowed=new Map();
    const legal=(entry,k,item)=>{
      const key=[entry.id,k,item.id].join(':');
      if(!compatible.has(key)){
        let ok=false;try{ok=canEquip(store,entry.id,item.id,k)&&
          (!item.sourceShipId||item.sourceShipId===entry.id||acceptsOtherSlot(store,entry.id,item.id,k));}catch(_){}
        compatible.set(key,ok);
      }
      return compatible.get(key);
    };
    const eligible=(entry,k,group)=>{
      const key=[entry.id,k].join(':');
      if(!allowed.has(key))allowed.set(key,new Map());
      const slots=allowed.get(key);
      if(!slots.has(group)){
        perf.count('ground.eligibility.build');
        slots.set(group,group.filter(item=>legal(entry,k,item)));
      }
      return slots.get(group);
    };
    return {raw,legal,eligible,inventoryById:new Map(inventory.map(i=>[i.id,i])),
      bombers:inventory.filter(i=>groundBomber(i.master)),
      ground:lists.filter(g=>dedicated(g[0].master)),guns:lists.filter(g=>main(g[0].master)),
      scouts:lists.filter(g=>type(g[0].master)===10),
      utility:lists.filter(g=>!dedicated(g[0].master)&&!main(g[0].master)&&type(g[0].master)!==10)};
  });
}
function groundContexts(store,profile,airReference){
  const contexts=snapshotMemo(store,'groundLoadoutContexts','all',()=>new Map());
  const scoreCache=snapshotMemo(store,'groundCombatScores','all',()=>new Map());
  const prefix=JSON.stringify([referenceKey(store,profile),referenceKey(store,airReference)])+':';
  return scheme=>{
    const key=prefix+JSON.stringify(scheme);
    if(contexts.has(key)){perf.count('ground.context.hit');return contexts.get(key);}
    perf.count('ground.context.miss');
    // Trials mutate their working entries. Retained contexts must own an
    // immutable projection, and every accepted change gets a different key.
    const context=groundCombatContext(store,{...scheme,ships:scheme.ships.map(clone)},profile,{airReference,scoreCache});
    if(contexts.size>=256)contexts.delete(contexts.keys().next().value);
    contexts.set(key,context);return context;
  };
}
function carrierGroundLoadout(store,scheme,prepared,locks,contextFor){
  const {bombers,eligible}=prepared;if(!bombers.length)return [];
  const current={fleet:scheme.fleet,ships:scheme.ships.map(clone)};let changed=false;
  for(const entry of current.ships){
    const ship=store.info.ships[entry.id],sm=store.const.$ships[ship.api_ship_id];
    if(![7,11,18].includes(Number(sm.api_stype))||carrierGroundState(itemsForEntry(store,entry))==='ready')continue;
    let context,base;
    const used=new Set(current.ships.flatMap(s=>s.slots.concat(s.ex)).filter(id=>id>0));let best=null;
    for(let k=0;k<entry.slots.length;k++){
      const old=store.const.$equips[store.info.equips[entry.slots[k]]?.api_slotitem_id];
      if(locks.get(entry.id)?.[k]||smallCarrierSlot(ship,sm,k)||entry.slots[k]>0&&type(old)!==7)continue;
      for(const item of eligible(entry,k,bombers)){
        if(used.has(item.id))continue;
        if(!context){context=contextFor(current);base=context.score(entry).score;}
        const trial=clone(entry);trial.slots[k]=item.id;
        const gain=context.score(trial).score-base;
        if(gain>1&&(!best||gain>best.gain))best={k,item,gain};
      }
    }
    if(best){entry.slots[best.k]=best.item.id;changed=true;}
  }
  return changed?[current]:[];
}

function groundLoadouts(store,scheme,inventory,options={}){
  const timing=perf.begin('loadout.ground');
  try{return memoLoadout(store,inventory,'ground',[scheme,referenceKey(store,options.profile),options.heldSlots===undefined?[]:options.heldSlots,
    referenceKey(store,options.airReference),options.packages===undefined?true:options.packages],()=>groundLoadoutsCore(store,scheme,inventory,options));}finally{perf.end(timing);}
}
function groundLoadoutsCore(store,scheme,inventory,{profile,heldSlots=[],airReference,packages=true}={}){
  if(!routeGroundTargets(profile).length)return [];
  const master=id=>store.const.$equips[store.info.equips[id]?.api_slotitem_id];
  const locks=new Map(heldSlots.filter(Boolean).map(s=>[s.id,s.keep||{}]));
  let entries=scheme.ships.map(s=>({...s,slots:(s.slots||store.info.ships[s.id].api_slot).slice(),ex:s.ex??store.info.ships[s.id].api_slot_ex}));
  const prepared=groundInventory(store,inventory),contextFor=groundContexts(store,profile,airReference);
  const carrierVariants=carrierGroundLoadout(store,{fleet:scheme.fleet,ships:entries},prepared,locks,contextFor);
  if(carrierVariants.length)entries=carrierVariants[0].ships;
  const escorts=aswEscortIds(store,entries,aswEscortLimit(profile,store));
  const protectedItem=(entry,id)=>protectedTypes.has(type(master(id)))&&
    (escorts.has(entry.id)||![14,15,40,44].includes(type(master(id))))&&!dedicated(master(id));
  const {ground,guns,scouts,utility,raw,legal,eligible,inventoryById}=prepared;
  if(!ground.length)return carrierVariants;
  if(!packages){
    const current={fleet:scheme.fleet,ships:entries},used=new Set(entries.flatMap(e=>e.slots.concat(e.ex)).filter(id=>id>0));
    let changed=false;
    for(let pass=0;pass<3;pass++){
      let placed=false;
      for(let index=0;index<entries.length;index++){
        const entry=entries[index];let context,base,best=null;
        for(const k of entry.slots.map((_,i)=>i).concat(store.info.ships[entry.id].api_slot_ex!==0?['ex']:[])){
          const old=read(entry,k);if(locks.get(entry.id)?.[k]||old>0&&protectedItem(entry,old))continue;
          for(const group of ground){
            // Broad search keeps its inexpensive local passes. Whole gun/scout
            // packages are compared on the final route-specific shortlists.
            const item=eligible(entry,k,group).find(i=>!used.has(i.id));if(!item)continue;
            if(!context){context=contextFor(current);base=context.score(entry).score;}
            const trial=clone(entry);write(trial,k,item.id);const gain=context.score(trial).score-base;
            if(gain>1&&(!best||gain>best.gain))best={k,old,item,gain};
          }
        }
        if(!context)perf.count('ground.noCandidates');
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
    const availableGroup=(k,groups)=>groups.some(g=>eligible(entry,k,g).some(i=>!usedElsewhere.has(i.id)));
    if(!mutable.some(k=>availableGroup(k,ground)))return entry;
    const start=clone(entry);mutable.forEach(k=>write(start,k,-1));
    const fixedItems=itemsForEntry(store,start),roles=new Map();
    const available=mutable.filter(k=>k!=='ex');
    if(mode==='day'&&!fixedItems.some(e=>scout(e.master)&&e.planes>0)){
      const k=available.filter(k=>Number(sm.api_maxeq?.[k])>0&&availableGroup(k,scouts))
        .sort((a,b)=>Number(scout(master(read(entry,b))))-Number(scout(master(read(entry,a))))||Number(sm.api_maxeq[b])-Number(sm.api_maxeq[a])||a-b)[0];
      if(k===undefined)return entry;roles.set(k,'scout');
    }
    if(mode!=='specialist'){
      const needed=Math.max(0,2-fixedItems.filter(e=>main(e.master)).length);
      const gunSlots=available.filter(k=>!roles.has(k)&&availableGroup(k,guns))
        .sort((a,b)=>Number(main(master(read(entry,b))))-Number(main(master(read(entry,a))))||a-b);
      if(gunSlots.length<needed)return entry;
      gunSlots.slice(0,needed).forEach(k=>roles.set(k,'gun'));
    }
    const context=contextFor(current),value=e=>context.score(e).score;
    // Mandatory gun/scout slots precede optional ground gear. A six-wide beam
    // crosses multi-item synergies without enumerating inventory permutations.
    const order=[...roles.keys(),...mutable.filter(k=>!roles.has(k))];
    let beam=[start];
    for(const k of order){
      const next=[];
      for(const candidate of beam){
        const used=new Set([...usedElsewhere,...candidate.slots,candidate.ex].filter(id=>id>0));
        const role=roles.get(k),options=[];
        for(const group of role==='gun'?guns:role==='scout'?scouts:ground){
          const representative=eligible(entry,k,group).find(i=>!used.has(i.id));
          if(representative)options.push(representative);
        }
        if(role==='gun')options.sort((a,b)=>raw(b)-raw(a)||a.id-b.id).splice(8);
        if(role==='scout')options.sort((a,b)=>raw(b)-raw(a)||a.id-b.id).splice(3);
        if(!role){
          const old=inventoryById.get(read(entry,k));
          if(old&&!used.has(old.id)&&legal(entry,k,old))options.push(old);
          const extra=utility.map(g=>eligible(entry,k,g).find(i=>!used.has(i.id)))
            .filter(Boolean).sort((a,b)=>raw(b)-raw(a)||a.id-b.id).slice(0,2);
          options.push(...extra);
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
  const options=[],baseline=fleetGroundScore(store,{...scheme,ships:entries},profile,undefined,{airReference}).bonus;
  for(const mode of ['day','night','specialist']){
    const current={fleet:scheme.fleet,ships:entries.map(clone)};
    for(let i=0;i<current.ships.length;i++)current.ships[i]=fit(current,current.ships[i],mode);
    const score=fleetGroundScore(store,current,profile,undefined,{airReference}).bonus;
    if(score>baseline+1)options.push({scheme:current,score});
  }
  options.sort((a,b)=>b.score-a.score);const seen=new Set();
  return [...options.map(r=>r.scheme),...carrierVariants].filter(s=>{const key=JSON.stringify(s);if(seen.has(key))return false;seen.add(key);return true;});
}
function groundLoadout(store,scheme,inventory,options){return groundLoadouts(store,scheme,inventory,options)[0]||null;}
module.exports={groundLoadout,groundLoadouts};
