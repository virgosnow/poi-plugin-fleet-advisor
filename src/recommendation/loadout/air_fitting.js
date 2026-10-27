'use strict';
// Aircraft fitting is separate from route-item and surface loadouts. Search
// reuse is scoped to one immutable inventory; final route checks stay outside.
const perf=require('../../shared/performance_trace');
const {memoLoadout,referenceKey}=require('./search_memo');
const {canEquip,acceptsOtherSlot}=require('../../domain/fleet/equipment_rules');
const {orderCarrierUtility}=require('../../domain/fleet/equipment_order');
const {snapshotMemo}=require('../../domain/fleet/equipment_planner');
const jets=require('../../domain/combat/jet_aviation');
const {airPower}=require('../../domain/fleet/fleet_metrics');
const {estimateRouteAirMinimum,routeAirMeets}=require('../../domain/routes/route_air');
const {usableSlots}=require('../context');
const {smallCarrierSlot,carrierUtility,healthySupremacy,affordableSupremacy,supportedAirGoal,jetCutInAllowed}=require('./carrier_policy');
function airLoadout(store,scheme,inventory,required,reference,goal,heldSlots,options){
  return perf.withDetails({airGoal:goal||'superiority',airStep:'other'},()=>
    measuredAirLoadout(store,scheme,inventory,required,reference,goal,heldSlots,options));
}
function measuredAirLoadout(store,scheme,inventory,required,reference,goal,heldSlots,options){
  const timing=perf.begin('loadout.air');
  try{return memoLoadout(store,inventory,'air',[scheme,required,referenceKey(store,reference),
    goal,heldSlots,[...(options?.protectedAttackSlots||[])]],()=>
    airLoadoutCore(store,scheme,inventory,required,reference,goal,heldSlots,options));}finally{perf.end(timing);}
}
function airLoadoutCore(store,scheme,inventory,required,reference,goal='superiority',heldSlots=[],{protectedAttackSlots=new Set()}={}){
  const placementHolds=protectedAttackSlots.size?scheme.ships.map(entry=>({id:entry.id,keep:{
    ...heldSlots.find(h=>h?.id===entry.id)?.keep,
    ...Object.fromEntries((entry.slots||usableSlots(store,entry.id)).map((_,k)=>k)
      .filter(k=>protectedAttackSlots.has(entry.id+':'+k)).map(k=>[k,true]))}})):heldSlots;
  scheme=orderCarrierUtility(store,scheme,placementHolds);
  const uncontested=reference?.status==='known'&&reference.enemyAirPower===0&&reference.nodes.some(n=>!n.noAirBattle&&n.kind!=='asw');
  if(uncontested)required=Math.max(1,required||0);
  if(!Number.isFinite(required)||required<=0)return null;
  const chosen=new Set(scheme.ships.map(ship=>ship.id));
  const slots=new Map(scheme.ships.map(ship=>[ship.id,
    (ship.slots||usableSlots(store,ship.id)).slice()]));
  const positions=[];
  const held=new Map(heldSlots.filter(Boolean).map(s=>[s.id,s.keep||{}]));
  for(const entry of scheme.ships){
    const ship=store.info.ships[entry.id],master=store.const.$ships[ship.api_ship_id];
    for(let slot=0;slot<slots.get(entry.id).length;slot++){
      if(Math.max(Number(master.api_maxeq?.[slot]||0),Number(ship.api_onslot?.[slot]||0))<=0)
        continue;
      // Only immutable recommendation jobs share these facts. Live callers
      // receive fresh maps; held slots and instance availability remain local.
      const facts=snapshotMemo(store,'airFittingPositions',entry.id+':'+slot,()=>({air:new Map(),eligibility:new Map(),lists:new Map()}));
      positions.push({shipId:entry.id,slot,ship,master,stype:Number(master.api_stype),memo:facts.air,eligibility:facts.eligibility,lists:facts.lists});
    }
  }
  if(!positions.length)return null;
  const typeOf=id=>id>0?Number(store.const.$equips[
    store.info.equips[id]?.api_slotitem_id]?.api_type?.[2]):null;
  const pools=snapshotMemo(store,'airFittingInventory',inventory,()=>{const result={
    fighters:inventory.filter(row=>[6,45,56].includes(Number(row.master.api_type[2]))),
    attackers:inventory.filter(row=>[7,8,57].includes(Number(row.master.api_type[2]))),
    utility:carrierUtility(inventory),
    equivalentKeys:new Map(inventory.map(row=>{const item=store.info.equips[row.id];return [row.id,JSON.stringify([item.api_slotitem_id,item.api_level,item.api_alv])];}))
  };
    result.waterFighters=result.fighters.filter(i=>Number(i.master.api_type[2])===45);
    result.utilityNonFighters=result.utility.filter(i=>![6,56].includes(Number(i.master.api_type[2])));
    result.attackersByType=new Map([7,8,57].map(type=>[type,result.attackers.filter(i=>Number(i.master.api_type[2])===type)]));
    return result;
  });
  const {fighters,attackers,equivalentKeys,utility,waterFighters,utilityNonFighters,attackersByType}=pools;
  const occupiedEx=new Set(scheme.ships.map(entry=>entry.ex??store.info.ships[entry.id].api_slot_ex)
    .filter(id=>id>0));
  const used=new Set([...slots.values()].flat().filter(id=>id>0).concat([...occupiedEx]));
  const contribution=(position,id)=>{
    if(id<=0)return {min:0,max:0};
    const memo=position.memo;
    if(memo.has(id))return memo.get(id);
    const before=usableSlots(store,position.shipId),after=Array(before.length).fill(-1);
    after[position.slot]=id;
    const value=airPower(store,[{id:position.shipId,ship:position.ship,master:position.master,
      before:{slots:before,ex:position.ship.api_slot_ex},
      after:{slots:after,ex:position.ship.api_slot_ex}}]);
    const score=value.status==='range'?value:{min:0,max:0,slots:[]};
    memo.set(id,score);return score;
  };
  for(const position of positions)position.current=contribution(position,slots.get(position.shipId)[position.slot]);
  let currentAir=null,currentTotal=null;
  const totalAir=()=>currentAir||(currentAir=positions.reduce((sum,position)=>{
      const value=position.current;
      sum.min+=value.min;sum.max+=value.max;sum.slots.push(...(value.slots||[]));return sum;
    },{status:'range',min:0,max:0,slots:[]}));
  const total=()=>{
    if(currentTotal)return currentTotal;
    const air=totalAir();
    const margin=reference?estimateRouteAirMinimum(air,reference)?.[goal]:null;
    return currentTotal=margin?{min:required+margin.min}:air;
  };
  const trial=(changes,reading=()=>total().min)=>{
    const savedAir=currentAir,savedTotal=currentTotal;currentAir=currentTotal=null;
    const before=changes.map(([position,id])=>{
      const list=slots.get(position.shipId),old=list[position.slot],previous=position.current;
      list[position.slot]=id;position.current=contribution(position,id);return [position,old,previous];
    });
    try{return reading();}finally{for(const [position,id,value]of before){slots.get(position.shipId)[position.slot]=id;position.current=value;}currentAir=savedAir;currentTotal=savedTotal;}
  };
  const visited=new Set(reference?.paths?.flat()||[]);
  const battleThresholds=(reference?.nodes||[]).filter(n=>visited.has(n.id)&&!n.noAirBattle)
    .map(n=>Number.isFinite(n.enemyAirPower)?n.enemyAirPower:n.upperBound)
    .filter(n=>Number.isFinite(n)&&n>=0).map(n=>Math.max(1,goal==='supremacy'?n*3:Math.ceil(n*1.5)));
  const departureFloor=battleThresholds.length?Math.max(...battleThresholds):null;
  const trialPass=(changes,minimum=required)=>{
    perf.detailCount('air.attempt');
    // No phase can add aircraft. Reject a mathematically impossible trial
    // before allocating/mutating its full slot list. Unknown route simulation
    // uses departure air instead, so retain the weaker of both necessary bounds.
    const floor=reference?.status==='known'?departureFloor===null?null:
      Math.min(minimum,departureFloor+minimum-required):minimum;
    if(floor!==null){
      const departure=totalAir().min+changes.reduce((sum,[position,id])=>
        sum+contribution(position,id).min-position.current.min,0);
      if(departure<floor){perf.count('loadout.air.departureReject');perf.detailCount('air.departureReject');return false;}
    }
    return trial(changes,()=>reference?.status==='known'?
      (routeAirMeets(totalAir(),reference,goal,minimum-required)??total().min>=minimum):total().min>=minimum);
  };
  const attackCount=shipId=>slots.get(shipId).filter(id=>[7,8,11,57].includes(typeOf(id))).length;
  const ciChecks=new Map();
  const alternativesCache=new Map(),attackChoices=new Map();
  const legal=(position,item,borrow)=>{
    const key=item.id+':'+Number(borrow);
    if(position.eligibility.has(key))return position.eligibility.get(key);
    try{
      const result=(!borrow||acceptsOtherSlot(store,position.shipId,item.id,position.slot))&&canEquip(store,position.shipId,item.id,position.slot);
      position.eligibility.set(key,result);return result;
    }catch(_){return false;}
  };
  const allowed=(position,item)=>{
    if(held.get(position.shipId)?.[position.slot])return false;
    if(used.has(item.id)||occupiedEx.has(item.id))return false;
    const list=slots.get(position.shipId);
    const itemType=Number(item.master.api_type[2]);
    let shipChecks=ciChecks.get(position.shipId);
    if(!shipChecks){shipChecks={jet:list.some(id=>jets.isJet(typeOf(id))),positions:new Map()};ciChecks.set(position.shipId,shipChecks);}
    if(jets.isJet(itemType)||shipChecks.jet){
      // All replacement instances with the same aircraft role have the same
      // CI result at this unheld position; allocation/eligibility stay below.
      const key=position.slot+':'+itemType+':'+item.master.api_type[0];
      if(!shipChecks.positions.has(key)){
        const entry={id:position.shipId,slots:list.map((id,k)=>k===position.slot?item.id:id)};
        shipChecks.positions.set(key,jetCutInAllowed(store,{ships:[entry]},heldSlots));
      }
      if(!shipChecks.positions.get(key))return false;
    }
    return true;
  };
  // Select an AVAILABLE representative for this particular slot, never remove
  // copies from inventory. The currently installed instance can have different
  // observed plane counts, so keep it separate from otherwise identical copies.
  const alternatives=(position,items,lowestId=false)=>{
    if(held.get(position.shipId)?.[position.slot])return [];
    let byPosition=alternativesCache.get(position);
    if(!byPosition){byPosition=new Map();alternativesCache.set(position,byPosition);}
    let cached=byPosition.get(items);
    if(!cached){cached=new Map();byPosition.set(items,cached);}
    // Trial reads temporarily replace slots, but do not enumerate inventory.
    // Until a replacement is accepted, availability and CI roles are identical.
    // Return a copy because callers may sort the available alternatives.
    if(cached.has(lowestId))return cached.get(lowestId).slice();
    if(!position.lists.has(items)){
      const groups=new Map(),current=position.ship.api_slot[position.slot];
      for(const [index,item] of items.entries()){
        if(!legal(position,item,false))continue;
        const key=equivalentKeys.get(item.id)+(item.id===current?':current':':new');
        if(!groups.has(key))groups.set(key,[]);
        groups.get(key).push({item,index,needsSource:!!item.sourceShipId&&!legal(position,item,true)});
      }
      position.lists.set(items,[...groups.values()]);
    }
    const selected=[];
    for(const copies of position.lists.get(items)){
      let first=null,representative=null;
      for(const row of copies){
        if(row.needsSource&&!chosen.has(row.item.sourceShipId)||!allowed(position,row.item))continue;
        if(!first)first=row;
        if(!representative||row.item.id<representative.id)representative=row.item;
        if(!lowestId)break;
      }
      if(first)selected.push({index:first.index,item:representative});
    }
    // Availability can move a group's first usable instance past another
    // group. Preserve original inventory traversal, not static group order.
    const result=selected.sort((a,b)=>a.index-b.index).map(row=>row.item);
    cached.set(lowestId,result);return result.slice();
  };
  const replace=(position,id)=>{
    alternativesCache.clear();attackChoices.clear();
    currentAir=currentTotal=null;
    position.current=contribution(position,id);
    ciChecks.delete(position.shipId);
    const list=slots.get(position.shipId),old=list[position.slot];
    if(old>0)used.delete(old);
    list[position.slot]=id;
    if(id>0)used.add(id);
  };
  const small=position=>smallCarrierSlot(position.ship,position.master,position.slot);
  perf.measureDetail('loadout.air.utility',{airStep:'utility'},()=>{
    // Retire expendable tiny strike slots before air fitting. Keep the last
    // strike plane and manual holds, and never weaken an already met air goal.
    for(const position of positions.filter(p=>[7,11,18].includes(p.stype)&&small(p))){
      const old=slots.get(position.shipId)[position.slot];
      if(old>0&&![7,8,57].includes(typeOf(old))||[7,8,57].includes(typeOf(old))&&attackCount(position.shipId)<=1)continue;
      const minimum=Math.min(required,total().min);
      const item=alternatives(position,utility).find(item=>
        (Number(item.master.api_type[2])!==9||!slots.get(position.shipId).some(id=>typeOf(id)===9))&&
        trialPass([[position,item.id]],minimum));
      if(item)replace(position,item.id);
    }
  });
  const attackValue=(position,item)=>{
    const observed=Number(position.ship.api_onslot?.[position.slot]);
    const planes=Number.isFinite(observed)?observed:
      Number(position.master.api_maxeq?.[position.slot]||0);
    const type=Number(item.master.api_type[2]);
    const hasType=slots.get(position.shipId).some(id=>typeOf(id)===type);
    if(type===57){
      const ordinary=jets.jetPower(Number(item.master.api_baku||0),planes,{phase:'ordinary'})||0;
      const assault=jets.steelAvailable(store)>0&&reference?.nodes?.some(n=>jets.applicable(n)===true)?jets.jetPower(Number(item.master.api_baku||0),planes)||0:0;
      return ordinary+assault+(hasType?0:40);
    }
    return (Number(item.master.api_raig||0)+Number(item.master.api_baku||0))*
      Math.sqrt(Math.max(0,planes))+Number(item.master.api_houg||0)*1.5+(hasType?0:40);
  };
  // Conventional and jet strike outfits are enumerated by jetLoadouts. Do
  // not normalize a legal jet away merely to avoid its extra air phase.
  const bestFighter=(where,allowAttackLoss)=>{
    let best=null;
    for(const position of positions.filter(where)){
      const old=slots.get(position.shipId)[position.slot],oldType=typeOf(old);
      if([7,8,11,57].includes(oldType)&&(!allowAttackLoss||attackCount(position.shipId)<=1))continue;
      if(position.stype===10){
        if(old>0&&![6,7,9,10,11,12,13,21,24,27,35,39,45].includes(oldType))continue;
        if([10,11].includes(oldType)&&!slots.get(position.shipId).some((id,k)=>k!==position.slot&&[10,11].includes(typeOf(id))))continue;
      }
      if(protectedAttackSlots.has(position.shipId+':'+position.slot))continue;
      const prior=contribution(position,old);
      for(const item of alternatives(position,fighters)){
        const type=Number(item.master.api_type[2]);
        if(position.stype===3||position.stype===5||position.stype===6){
          if(type!==45)continue;
        }else if(position.stype===10){if(![6,45].includes(type))continue;}
        else if(![7,11,18].includes(position.stype)||![6,56].includes(type))continue;
        const next=contribution(position,item.id);
        const minGain=next.min-prior.min,maxGain=next.max-prior.max;
        if(minGain<=0&&maxGain<=0)continue;
        const candidate={position,item,minGain,maxGain,
          attackLoss:Number([7,8,11,57].includes(oldType)),
          attackCapacity:[7,8,11,57].includes(oldType)?Number(position.ship.api_onslot?.[position.slot]??position.master.api_maxeq?.[position.slot]??0):0};
        // After spare utility is exhausted, buy fighter cover with the
        // smaller strike slot first, preserving the largest offensive slots.
        if(!best||candidate.attackLoss<best.attackLoss||candidate.attackLoss===best.attackLoss&&
          (candidate.attackCapacity<best.attackCapacity||candidate.attackCapacity===best.attackCapacity&&
            (minGain>best.minGain||minGain===best.minGain&&maxGain>best.maxGain)))best=candidate;
      }
    }
    return best;
  };
  const improve=(where,attackLoss)=>{
    let steps=0;
    while(total().min<required&&steps++<positions.length){
      const best=bestFighter(where,attackLoss);
      if(!best)break;
      replace(best.position,best.item.id);
    }
  };
  perf.measureDetail('loadout.air.cover',{airStep:'cover'},()=>{
    // Keep normal carrier fighter cover when carriers are present. Small-ship
    // fleets can instead use one compatible water fighter in a spare slot.
    const hasFighter=()=>positions.some(p=>[6,45,56].includes(typeOf(slots.get(p.shipId)[p.slot]))&&
      contribution(p,slots.get(p.shipId)[p.slot]).min>0);
    if(uncontested&&!hasFighter()){
      const carrier=bestFighter(p=>[7,11,18].includes(p.stype),false)||
        bestFighter(p=>[7,11,18].includes(p.stype),true);
      if(carrier&&trialPass([[carrier.position,carrier.item.id]]))replace(carrier.position,carrier.item.id);
    }
    // Keep guns, propulsion and a sole observation plane. Utility replacements
    // still pass the ordinary final route/LoS checks before being recommended.
    if(uncontested&&!hasFighter()&&fighters.some(item=>Number(item.master.api_type[2])===45)){
      let best=null;
      for(const position of positions){
        const old=slots.get(position.shipId)[position.slot],oldType=typeOf(old);
        const reconCount=slots.get(position.shipId).filter(id=>[10,11].includes(typeOf(id))).length;
        const gunCount=slots.get(position.shipId).filter(id=>[1,2,3].includes(typeOf(id))).length;
        const cost=old<=0?0:[12,13,21,24,27,30,39,42,54].includes(oldType)?1:
          oldType===11&&(reconCount>1||gunCount<2)?2:oldType===10&&reconCount>1?3:Infinity;
        if(!Number.isFinite(cost))continue;
        for(const item of alternatives(position,waterFighters)){
          if(!trialPass([[position,item.id]]))continue;
          const planes=Number(position.master.api_maxeq?.[position.slot]||0);
          if(!best||cost<best.cost||cost===best.cost&&planes<best.planes)best={position,item,cost,planes};
        }
      }
      if(best)replace(best.position,best.item.id);
    }
    improve(position=>[7,10,11,18].includes(position.stype),false);
    // A high-AA bomber (e.g. F4U-1D) may close the gap while retaining B+A.
    // Compare the full air contribution, including aircraft-type proficiency,
    // before sacrificing a strike slot to another pure fighter. B never counts
    // as F in the cut-in combination, and remains subject to stage-two AA.
    for(let step=0;step<positions.length&&total().min<required;step++){
      let best=null;
      for(const position of positions.filter(p=>[7,11,18].includes(p.stype)&&!small(p))){
        const old=slots.get(position.shipId)[position.slot],oldType=typeOf(old);
        if(![7,8,57].includes(oldType))continue;
        const previous=inventory.find(item=>item.id===old);if(!previous)continue;
        const prior=contribution(position,old);
        for(const item of alternatives(position,attackersByType.get(oldType))){
          const next=contribution(position,item.id),gain=next.min-prior.min;
          if(gain<=0)continue;
          if(!trial([[position,item.id]],()=>supportedAirGoal(totalAir(),reference,goal)))continue;
          const loss=Math.max(0,attackValue(position,previous)-attackValue(position,item));
          const score=gain/(1+loss);
          if(!best||score>best.score)best={position,item,score};
        }
      }
      if(!best)break;replace(best.position,best.item.id);
    }
    improve(position=>[7,10,11,18].includes(position.stype),true);
    // Cruise-ship water fighters are a fallback once carrier non-attack slots
    // and expendable strike slots cannot close the gap. Eligibility is checked
    // on the actual ship and slot.
    improve(position=>[3,5,6].includes(position.stype),false);
  });
  perf.measureDetail('loadout.air.release',{airStep:'release'},()=>{
    // Once the target is secure, trade surplus fighters back for strike planes.
    // Retain only swaps that keep the conservative air-power bound above target.
    if(total().min>=required)for(const position of positions){
      if(![7,11,18].includes(position.stype)||![6,56].includes(typeOf(slots.get(position.shipId)[position.slot])))
        continue;
      if(small(position)&&attackCount(position.shipId)>0){
        // Use spare fighter cover for fixed firepower before considering any
        // extra fragile strike slot. Retain a fighter for the ship's FBA outfit.
        if(slots.get(position.shipId).filter(id=>[6,56].includes(typeOf(id))).length>1){
          const fixed=alternatives(position,utilityNonFighters)
            .sort((a,b)=>Number(b.master.api_houg||0)-Number(a.master.api_houg||0)||a.id-b.id)
            .find(item=>trialPass([[position,item.id]])&&
              (!reference||trial([[position,item.id]],()=>estimateRouteAirMinimum(totalAir(),reference)?.[goal]?.min>=0))&&
              trial([[position,item.id]],()=>supportedAirGoal(totalAir(),reference,goal)));
          if(fixed)replace(position,fixed.id);
        }
        continue;
      }
      if(uncontested&&positions.filter(p=>[6,45,56].includes(typeOf(slots.get(p.shipId)[p.slot]))).length<=1)continue;
      const old=slots.get(position.shipId)[position.slot],prior=contribution(position,old);
      const current=total().min;
      const choices=alternatives(position,attackers,true).map(item=>{
        const next=contribution(position,item.id);
        const attack=attackValue(position,item);
        return {item,next,attack};
      }).sort((a,b)=>b.attack-a.attack||b.next.min-a.next.min||a.item.id-b.item.id);
      // Same winner as testing every option then sorting; stop at the first
      // passing option in that exact order.
      const choice=choices.find(option=>(reference?trialPass([[position,option.item.id]]):
        current-prior.min+option.next.min>=required)&&
        trial([[position,option.item.id]],()=>supportedAirGoal(totalAir(),reference,goal)));
      if(choice)replace(position,choice.item.id);
    }
  });
  perf.measureDetail('loadout.air.pairs',{airStep:'pairs'},()=>{
    // A water fighter on an eligible cruiser may buy back a carrier strike slot.
    // Prefer expendable utility slots and only make pairs that keep the target.
    for(let step=0;step<3&&!uncontested&&total().min>=required;step++){
      perf.detailCount('air.pairs.round');
      let best=null;
      const current=total().min,pairs=[];
      const carriers=positions.filter(position=>[7,11,18].includes(position.stype)&&
        !small(position)&&typeOf(slots.get(position.shipId)[position.slot])===6);
      for(const [cruiserIndex,cruiser] of positions.filter(position=>[3,5,6].includes(position.stype)).entries()){
        const old=slots.get(cruiser.shipId)[cruiser.slot],oldType=typeOf(old);
        if([9,10,11,12,13,93,45].includes(oldType))continue;
        const utility=old<=0||[24,30,42,54].includes(oldType);
        const oldAir=contribution(cruiser,old);
        const waters=alternatives(cruiser,waterFighters).map((water,index)=>({water,index,
          gain:contribution(cruiser,water.id).min-oldAir.min})).filter(row=>!(row.gain<=0));
        if(!waters.length)continue;
        for(const [carrierIndex,carrier] of carriers.entries()){
          const before=contribution(carrier,slots.get(carrier.shipId)[carrier.slot]).min;
          if(!attackChoices.has(carrier))attackChoices.set(carrier,alternatives(carrier,attackers)
            .map((attack,index)=>({attack,index,value:attackValue(carrier,attack)}))
            .sort((a,b)=>b.value-a.value||a.index-b.index));
          for(const {attack,index,value} of attackChoices.get(carrier)){
            const score=value-(utility?0:55);
            if(score<=0)continue;
            pairs.push({cruiser,cruiserIndex,carrier,carrierIndex,attack,index,score,waters,before});
          }
        }
      }
      perf.detailCount('air.pairs.generated',pairs.length);
      best=selectAirPair(pairs,(pair,water,gain)=>{
        const {cruiser,carrier,attack}=pair;
        const after=contribution(carrier,attack.id).min;
        if(reference?!trialPass([[cruiser,water.id],[carrier,attack.id]]):current+gain+after-pair.before<required)return false;
        return trial([[cruiser,water.id],[carrier,attack.id]],()=>supportedAirGoal(totalAir(),reference,goal));
      });
      if(!best||best.score<=0)break;
      perf.detailCount('air.pairs.accepted');
      replace(best.cruiser,best.water.id);
      replace(best.carrier,best.attack.id);
    }
  });
  const entries=scheme.ships.map(entry=>{
    const current=entry.slots||usableSlots(store,entry.id),next=slots.get(entry.id);
    return next.some((id,i)=>id!==current[i])?{...entry,slots:next}:{...entry};
  });
  const fitted=entries.some(entry=>entry.slots)?orderCarrierUtility(store,{fleet:scheme.fleet,ships:entries},placementHolds):null;
  const carrierCount=entries.filter(entry=>[7,11,18].includes(Number(store.const.$ships[store.info.ships[entry.id].api_ship_id]?.api_stype))).length;
  if(fitted&&goal==='superiority'&&reference?.status==='known'&&reference.enemyAirPower>0&&
    carrierCount>=1&&
    total().min>=required){
    const target=Number(reference.supremacy??reference.enemyAirPower*3);
    const strikeCore=new Set();
    for(const entry of fitted.ships){
      // A lone carrier can improve cover or spend utility, but never buy the
      // optional air tier by giving up an existing attack-aircraft slot.
      if(carrierCount===1)for(const p of positions.filter(p=>p.shipId===entry.id&&
        [7,8,11,57].includes(typeOf(entry.slots[p.slot]))))strikeCore.add(entry.id+':'+p.slot);
      // Reserve the strongest large-slot bomber and torpedo plane before
      // buying AS+ with an expendable third strike slot.
      for(const type of [7,8]){
        const core=positions.filter(p=>p.shipId===entry.id&&!small(p)&&
          typeOf(entry.slots[p.slot])===type).sort((a,b)=>
          Number(b.ship.api_onslot?.[b.slot]??b.master.api_maxeq?.[b.slot]??0)-
          Number(a.ship.api_onslot?.[a.slot]??a.master.api_maxeq?.[a.slot]??0))[0];
        if(core)strikeCore.add(entry.id+':'+core.slot);
      }
    }
    perf.detailCount('air.supremacy.attempt');
    const upgraded=perf.measureDetail('loadout.air.supremacy',{airMode:'optional-supremacy'},()=>
      airLoadout(store,fitted,inventory,target,reference,'supremacy',heldSlots,{protectedAttackSlots:strikeCore}));
    const attacks=value=>value.ships.reduce((n,e)=>n+e.slots.filter(id=>[7,8,11,57].includes(typeOf(id))).length,0);
    if(upgraded&&affordableSupremacy(store,fitted,upgraded)&&
      (carrierCount>1||attacks(upgraded)>=attacks(fitted))){
      const air=airPower(store,upgraded.ships.map(entry=>{
        const ship=store.info.ships[entry.id];return {id:entry.id,ship,master:store.const.$ships[ship.api_ship_id],
          before:{slots:ship.api_slot,ex:ship.api_slot_ex},after:entry};
      }));
      const estimate=estimateRouteAirMinimum(air,reference);
      if(healthySupremacy(store,upgraded,air,{margins:estimate})&&supportedAirGoal(air,reference,'supremacy')){
        perf.detailCount('air.supremacy.accepted');return upgraded;
      }
    }
  }
  return fitted;
}

// The pair score is independent of its water fighter. Visit complete score
// tiers from strongest to weakest; ties retain the first feasible pair in the
// original cruiser/water/carrier/attacker traversal. No heuristic pruning.
function selectAirPair(pairs,accept){
  pairs.sort((a,b)=>b.score-a.score);
  const earlier=(a,b)=>a.cruiserIndex<b.cruiserIndex||a.cruiserIndex===b.cruiserIndex&&
    (a.waterIndex<b.waterIndex||a.waterIndex===b.waterIndex&&
      (a.carrierIndex<b.carrierIndex||a.carrierIndex===b.carrierIndex&&a.index<b.index));
  let best=null;
  for(const pair of pairs){
    if(best&&pair.score<best.score)break;
    for(const {water,index:waterIndex,gain} of pair.waters){
      const candidate={...pair,water,waterIndex};
      if(best&&!earlier(candidate,best))continue;
      perf.detailCount('air.pairs.tested');
      if(!accept(pair,water,gain))continue;
      best=candidate;break;
    }
  }
  return best;
}
module.exports={airLoadout,selectAirPair};
