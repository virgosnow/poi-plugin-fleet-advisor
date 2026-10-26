'use strict';
const perf=require('../shared/performance_trace');
const {airLoadout}=require('./loadout/air_fitting');
// Equipment variants for route constraints and combat roles; preserve held slots.
const {canEquip,acceptsOtherSlot}=require('../domain/fleet/equipment_rules');
const {orderCarrierUtility}=require('../domain/fleet/equipment_order');
const {speed}=require('../domain/fleet/fleet_metrics');
const routes=require('../domain/routes/normal_routes');
const routePlans=require('../domain/routes/route_plans');
const {previewForMap}=require('../domain/routes/sortie_profile');
const {speedLoadout}=require('../domain/routes/route_speed');
const {emptyLoadout,completeCombatLoadout,aswEscortLimit,aswEscortIds,submarineObjective}=require('./loadout/loadout_policy');
const aswCombat=require('../domain/combat/asw_combat');
const {shipFamilyKey,usableSlots}=require('./context');
const {openingTorpedo}=require('./scoring');

function requiredDestroyerGuns(area,phase,profile){
  if(area==='1-1'||profile?.counts?.surface?.maximum===0)return 0;
  if(['4-3','4-5','6-4'].includes(area)||area==='7-5'&&phase==='gauge2'||
    submarineObjective(profile))return 1;
  return 2;
}
function gearVariant(store,scheme,inventory,kind,profile,area,phase,options){
  const timing=perf.begin('loadout.variant.'+kind);
  try{return gearVariantCore(store,scheme,inventory,kind,profile,area,phase,options);}finally{perf.end(timing);}
}
function gearVariantCore(store,scheme,inventory,kind,profile,area,phase,{stopWhen,maxPlacements,allowCombatLoss=false,heldSlots=[]}={}){
  // LoS is a routing constraint, not an attribute to maximize. In particular,
  // a blocked hull/speed rule cannot justify replacing more attack aircraft.
  const paths=kind==='los'?(profile?.routePaths?.length?profile.routePaths.map(p=>p.nodes):
    profile?.examples?.length?profile.examples:previewForMap(area,{phase}).routePaths.map(p=>p.nodes)):[];
  const gatedPaths=paths.filter(nodes=>routePlans.losGates(area,nodes,phase).length);
  if(kind==='los'&&!gatedPaths.length)return null;
  const losMet=value=>{
    const target=profile?.targetNodes?.length===1?profile.targetNodes[0]:'boss';
    const route=routes.evaluateNormalRoute(store,{area,target,phase,fleet:scheme.fleet,scheme:value});
    return gatedPaths.every(nodes=>routePlans.planningPath(route,nodes).losShortfall===0);
  };
  const holds=new Map(heldSlots.filter(Boolean).map(s=>[s.id,s.keep||{}]));
    const categories=kind==='asw'?new Set([14,15,40]):
    kind==='los'?new Set([9,10,11,12,13,93]):
    new Set([12,13,24,30,46,93]);
  const relevant=inventory.filter(row=>categories.has(Number(row.master.api_type[2])));
  if(!relevant.length)return null;
  const used=new Set(scheme.ships.flatMap(entry=>(entry.slots||usableSlots(store,entry.id)).concat(entry.ex??store.info.ships[entry.id].api_slot_ex))
    .filter(id=>id>0)),entries=scheme.ships.map(entry=>({...entry}));
  const slotLists=new Map(entries.map(entry=>[entry.id,
    (scheme.ships.find(ship=>ship.id===entry.id)?.slots||usableSlots(store,entry.id)).slice()]));
  const typeOf=id=>id>0?Number(store.const.$equips[
    store.info.equips[id]?.api_slotitem_id]?.api_type?.[2]):null;
  const losValues=new Map();
  const losValue=id=>{
    if(id<=0)return 0;
    if(losValues.has(id))return losValues.get(id);
    const item=store.info.equips[id],master=store.const.$equips[item?.api_slotitem_id];
    const type=Number(master?.api_type?.[2]);
    const weight={8:0.8,9:1,10:1.2,11:1.1,94:1}[type]??0.6;
    const improve={9:1.2,10:1.2,11:1.15,12:1.25,13:1.4,26:1,
      41:1.2,93:1.4,94:1.2}[type]??0;
    const value=(Number(master?.api_saku||0)+improve*Math.sqrt(Number(item?.api_level||0)))*weight;
    losValues.set(id,value);return value;
  };
  const rankings=new Map();
  const rankedEquipment=(previous,hasSonar,hasDepth)=>{
    const key=kind==='los'?losValue(previous):kind==='asw'?`${hasSonar}:${hasDepth}`:'routing';
    if(rankings.has(key))return rankings.get(key);
    const scores=new Map(relevant.map(row=>{
      const type=Number(row.master.api_type[2]);
      const score=kind==='asw'?Number(row.master.api_tais||0)*2+
        (!hasSonar&&(type===14||type===40)?1000:0)+
        (hasSonar&&!hasDepth&&type===15?500:0):kind==='los'?losValue(row.id)-key:
        Number(row.master.api_saku||0)+(type===30?5:0);
      return [row.id,score];
    }));
    const order=relevant.slice().sort((a,b)=>scores.get(b.id)-scores.get(a.id)||a.id-b.id);
    rankings.set(key,order);return order;
  };
  const pureASW=profile?.counts?.asw?.maximum>0&&
    profile.counts.surface.maximum===0&&profile.counts.air.maximum===0;
  const escortLimit=aswEscortLimit(profile,store),openingReadings=new Map();
  const reading=entry=>{
    if(!openingReadings.has(entry.id)){
      const ship=store.info.ships[entry.id];
      openingReadings.set(entry.id,require('../domain/combat/opening_asw').openingASW(store,{id:entry.id,ship,
        master:store.const.$ships[ship.api_ship_id],before:{slots:ship.api_slot,ex:ship.api_slot_ex},
        after:{...entry,slots:slotLists.get(entry.id)}}));
    }
    return openingReadings.get(entry.id);
  };
  const basicASW=new Set([1,2,3,4,21,22]);
  const ordered=kind==='asw'?
    Array.from({length:Math.max(...[...slotLists.values()].map(slots=>slots.length))},(_,slot)=>
      entries.map(entry=>({entry,slot}))).flat():
    entries.flatMap(entry=>slotLists.get(entry.id).map((_,slot)=>({entry,slot})))
      .sort((a,b)=>{
        if(kind!=='los')return 0;
        const priority=p=>{
          const id=slotLists.get(p.entry.id)[p.slot],t=typeOf(id);
          return id<=0?0:categories.has(t)?1:[7,8,57,58].includes(t)?3:2;
        };
        const order=priority(a)-priority(b);
        if(order||priority(a)!==3)return order;
        const capacity=p=>{
          const ship=store.info.ships[p.entry.id],master=store.const.$ships[ship.api_ship_id];
          return Number(ship.api_onslot?.[p.slot]??master.api_maxeq?.[p.slot]??0);
        };
        return capacity(a)-capacity(b);
      });
  let placed=0;
  const current=()=>({fleet:scheme.fleet,ships:entries.map(e=>({...e,slots:slotLists.get(e.id)}))});
  for(const {entry,slot} of ordered){
    const slots=slotLists.get(entry.id);
    if(slot>=slots.length||placed>=(maxPlacements??(kind==='asw'?18:6)))continue;
    if(holds.get(entry.id)?.[slot])continue;
    if(stopWhen?.(current())||kind==='los'&&losMet(current()))break;
    if(kind==='asw'&&Number.isFinite(escortLimit)&&entries.filter(e=>reading(e).eligible===true).length>=escortLimit)break;
    const stype=Number(store.const.$ships[store.info.ships[entry.id].api_ship_id]?.api_stype);
    if(kind==='asw'&&!basicASW.has(stype))continue;
    const previous=slots[slot],previousType=typeOf(previous);
    // Preserve surface-combat equipment on mixed routes; on pure submarine
    // routes, keep existing ASW gear and replace ordinary gear if needed.
    if(previous>0&&kind==='los'){
      const carrier=[7,11,18].includes(stype),attack=[7,8,57,58].includes(previousType);
      const previousMaster=store.const.$equips[store.info.equips[previous]?.api_slotitem_id];
      if([6,45,56,33,39,30].includes(previousType)||[33,34,87].includes(Number(previousMaster?.api_id))||Number(previousMaster?.api_type?.[3])===50||antiGroundStrength(previousMaster)>0||
        profile?.counts?.asw?.maximum>0&&[14,15,40].includes(previousType))continue;
      if(!allowCombatLoss&&stype===2&&[1,5].includes(previousType)&&
        slots.filter(id=>[1,5].includes(typeOf(id))).length<=
          requiredDestroyerGuns(area,phase,profile))continue;
      if(attack&&carrier&&slots.filter(id=>[7,8,57,58].includes(typeOf(id))).length<=1)
        continue;
      if(!allowCombatLoss&&[1,2,3,4,5].includes(previousType)&&
        slots.filter(id=>[1,2,3,4,5].includes(typeOf(id))).length<=
          ([8,9,10].includes(stype)?2:1))continue;
    }else if(previous>0&&(kind!=='asw'||!pureASW&&![12,13,21,27,39].includes(previousType)||categories.has(previousType)))continue;
    const equippedTypes=slots.map(typeOf),hasSonar=equippedTypes.some(t=>t===14||t===40);
    const hasDepth=equippedTypes.includes(15);
    const chosen=rankedEquipment(previous,hasSonar,hasDepth).find(row=>{
      if(used.has(row.id))return false;
      if(kind==='los'&&/彩雲/.test(row.master.api_name||'')&&entries.some(e=>
        slotLists.get(e.id).concat(e.ex||-1).some(id=>id!==previous&&/彩雲/.test(
          store.const.$equips[store.info.equips[id]?.api_slotitem_id]?.api_name||''))))return false;
      if(kind==='los'&&losValue(row.id)<=losValue(previous)+0.25)return false;
      try{return canEquip(store,entry.id,row.id,slot);}catch(_){return false;}
    });
    if(!chosen)continue;
    slots[slot]=chosen.id;used.add(chosen.id);openingReadings.delete(entry.id);placed++;
    if(kind==='los'){
      const arranged=orderCarrierUtility(store,current(),heldSlots);
      for(const e of arranged.ships)slotLists.set(e.id,e.slots);
    }
  }
  for(const entry of entries){
    const slots=slotLists.get(entry.id);
    // Compare against the draft, not the worn outfit: fitting can legitimately
    // restore a ship's original gear after an earlier candidate removed it.
    if(slots.some((id,i)=>id!==(entry.slots||usableSlots(store,entry.id))[i]))entry.slots=slots;
  }
  return placed?{fleet:scheme.fleet,ships:entries}:null;
}
// Fit carrier-count routing gear even when utility slots are already occupied.
function routingLoadout(store,scheme,inventory,need,heldSlots=[]){
  const holds=new Map(heldSlots.filter(Boolean).map(s=>[s.id,s]));
  const entries=scheme.ships.map(s=>({...s,slots:(s.slots||usableSlots(store,s.id)).slice()}));
  const used=new Set(entries.flatMap(s=>s.slots.concat(s.ex??store.info.ships[s.id].api_slot_ex)).filter(id=>id>0));
  const master=id=>store.const.$equips[store.info.equips[id]?.api_slotitem_id],type=id=>Number(master(id)?.api_type?.[2]);
  const matches=id=>need.kind==='drumCarriers'||need.kind==='transportEquipCount'?type(id)===30:
    need.kind==='radarCarriers'?[12,13,93].includes(type(id)):routes.LANDING_CRAFT_IDS.has(Number(store.info.equips[id]?.api_slotitem_id));
  let count=entries.filter(s=>s.slots.concat(s.ex||-1).some(matches)).length,changed=false;
  for(const entry of entries){
    if(count>=need.count)break;if(entry.slots.concat(entry.ex||-1).some(matches))continue;
    const positions=entry.slots.map((id,k)=>({id,k,type:type(id)})).filter(p=>!holds.get(entry.id)?.keep?.[p.k]&&
      (p.id<=0||[9,10,12,13,14,15,24,27,30,35,40,93].includes(p.type)))
      .sort((a,b)=>Number(a.id>0)-Number(b.id>0));
    let placed=false;
    for(const p of positions){const item=inventory.filter(i=>matches(i.id)&&!used.has(i.id))
        .sort((a,b)=>a.id-b.id)
        .find(i=>canEquip(store,entry.id,i.id,p.k)&&(!i.sourceShipId||i.sourceShipId===entry.id||acceptsOtherSlot(store,entry.id,i.id,p.k)));
      if(!item)continue;entry.slots[p.k]=item.id;used.add(item.id);placed=true;changed=true;break;}
    if(placed)count++;
  }
  return changed?{fleet:scheme.fleet,ships:entries}:null;
}
function speedHolds(store,scheme,heldSlots=[]){
  const previous=new Map(heldSlots.filter(Boolean).map(s=>[s.id,s]));
  return scheme.ships.map(entry=>({...entry,keep:{...previous.get(entry.id)?.keep,
    ...Object.fromEntries(entry.slots.map((id,k)=>[k,id]).concat([['ex',entry.ex]])
      .filter(([,id])=>[33,34,87].includes(store.info.equips[id]?.api_slotitem_id)).map(([k])=>[k,true]))}}));
}
function fitGuideStrategy(store,scheme,inventory,option,heldSlots=[]){
  const strategy=option.strategy;if(!strategy)return scheme;
  let fitted=speedLoadout(store,scheme,inventory,strategy.minimumSpeed,heldSlots)||scheme;
  const reading=speed(store,fitted.ships.map(entry=>{const ship=store.info.ships[entry.id];return {id:entry.id,ship,master:store.const.$ships[ship.api_ship_id],before:{slots:ship.api_slot,ex:ship.api_slot_ex},after:entry};}));
  const ranks={slow:5,fast:10,fastPlus:15,fastest:20};
  if(!['observed','computed','estimated'].includes(reading.status)||!(ranks[reading.fleetSpeed]>=ranks[strategy.minimumSpeed]))return null;
  // Engines occupy non-utility slots and routingLoadout cannot replace them.
  if(strategy.radarCarriers)fitted=routingLoadout(store,fitted,inventory,{kind:'radarCarriers',count:strategy.radarCarriers},heldSlots)||fitted;
  return fitted;
}
function strategyFailure(store,ctx,option,inventory,heldSlots=[]){
  const speedName=option.strategy.minimumSpeed==='fastest'?'最速':'高速＋';
  const need=`需要全队${speedName}统一`+(option.strategy.radarCarriers?`、至少 ${option.strategy.radarCarriers} 艘携带电探`:'');
  const issues=[];
  const allowed=option.strategy.allowedStypes;
  const compatible=ctx.roster.filter(r=>!allowed||allowed.includes(r.stype));
  if(new Set(compatible.map(shipFamilyKey)).size<6)issues.push('可用舰娘不足六艘');
  const wrong=ctx.fixed.map(id=>ctx.byId.get(id)).filter(r=>allowed&&!allowed.includes(r.stype));
  if(wrong.length)issues.push('固定舰种不适用：'+wrong.map(r=>r.name).join('、'));
  const unfitted=ctx.fixed.filter(id=>{
    if(allowed&&!allowed.includes(ctx.byId.get(id).stype))return false;
    const base=emptyLoadout(store,{fleet:ctx.fleet,ships:[{id}]},heldSlots);
    return !fitGuideStrategy(store,base,inventory,option,heldSlots);
  });
  if(unfitted.length)issues.push(`当前装备及可调整槽位无法将这些固定舰提到${speedName}：`+unfitted.map(id=>ctx.byId.get(id).name).join('、'));
  const count=masterId=>inventory.filter(i=>store.info.equips[i.id].api_slotitem_id===masterId).length;
  const radars=inventory.filter(i=>[12,13,93].includes(Number(i.master.api_type?.[2]))).length;
  if(radars<(option.strategy.radarCarriers||0))issues.push('可用电探数量不足');
  issues.push(`可调用提速装备：涡轮 ${count(33)}、强化型缶 ${count(34)}、新型缶 ${count(87)}；电探 ${radars}`);
  return `${option.name}未配成：${need}。${issues.join('；')}。请检查提速装备数量、补强增设及手动保留槽位，或更换难以提速的舰娘；不会降级推荐。`;
}
function oneOneOpeningLoadout(store,scheme,inventory){
  const used=new Set(scheme.ships.flatMap(entry=>entry.slots||usableSlots(store,entry.id))
    .filter(id=>id>0));
  const gear=inventory.filter(item=>(Number(item.master.api_type[2])===22&&/甲標的/.test(item.master.api_name||'')||
      [7,8,11].includes(Number(item.master.api_type[2]))));
  const guns=inventory.filter(item=>Number(item.master.api_type[2])===3);
  if(!gear.length)return null;
  let changed=false;
  const entries=scheme.ships.map(entry=>{
    const ship=store.info.ships[entry.id],master=store.const.$ships[ship.api_ship_id];
    const stype=Number(master.api_stype),slots=(entry.slots||usableSlots(store,entry.id)).slice();
    const currentMaster=id=>id>0?store.const.$equips[store.info.equips[id]?.api_slotitem_id]:null;
    const carrier=[7,11,18].includes(stype);
    const equip=(wanted,replaceable,available=gear)=>{
      let best=null;
      for(let slot=0;slot<slots.length;slot++){
        if(slots.slice(0,slot).some(id=>id<=0))continue;
        const old=slots[slot],oldType=Number(currentMaster(old)?.api_type?.[2]);
        if(old>0&&!replaceable.includes(oldType))continue;
        for(const item of available){
          const type=Number(item.master.api_type[2]);
          if(used.has(item.id)||!wanted.includes(type))continue;
          try{if(!canEquip(store,entry.id,item.id,slot))continue;}catch(_){continue;}
          const planes=Number(ship.api_onslot?.[slot]??master.api_maxeq?.[slot]??0);
          if(type!==22&&planes<=0)continue;
          const value=type===22?Number(item.master.api_raig||0)+40:
            type===3?Number(item.master.api_houg||0):
            (Number(item.master.api_raig||0)+Number(item.master.api_baku||0))*
              Math.sqrt(planes);
          const score=value-(old>0?5:0);
          if(!best||score>best.score)best={slot,item,score};
        }
      }
      if(!best)return;
      slots[best.slot]=best.item.id;used.add(best.item.id);changed=true;
    };
    const rows=[{id:entry.id,ship,master,stype,level:Number(ship.api_lv||0)}];
    if(carrier){
      if(!slots.some(id=>[7,8].includes(Number(currentMaster(id)?.api_type?.[2]))))
        equip([7,8],[6,24,30,12,13,93]);
    }else if(stype===10){
      // Ise-class remodels can launch carrier dive bombers as well as seaplane
      // bombers. Actual ship-specific equipment permissions still gate the swap.
      if(!slots.some((id,slot)=>[7,11].includes(Number(currentMaster(id)?.api_type?.[2]))&&
        Number(ship.api_onslot?.[slot]??master.api_maxeq?.[slot]??0)>0)){
        if(slots.filter(id=>[2,3,4].includes(Number(currentMaster(id)?.api_type?.[2]))).length===1&&
          slots[1]<=0)equip([3],[],guns);
        equip([7,11],[6,9,10,12,13,17,18,24,30,45,54,93]);
      }
    }else if([3,4,5,6,13,14,16].includes(stype)){
      if(!openingTorpedo(store,rows,{ships:[{id:entry.id,slots}]}).count)
        equip([22],[9,10,12,13,24,30,93]);
      if(!slots.some((id,slot)=>Number(currentMaster(id)?.api_type?.[2])===11&&
        Number(ship.api_onslot?.[slot]??master.api_maxeq?.[slot]??0)>0))
        equip([11],[9,10,12,13,17,18,24,30,45,54,93]);
    }
    return slots.some((id,slot)=>id!==(entry.slots||usableSlots(store,entry.id))[slot])?
      {...entry,slots}:{...entry};
  });
  return changed?{fleet:scheme.fleet,ships:entries}:null;
}
function antiGroundStrength(master){
  const type=Number(master?.api_type?.[2]),name=master?.api_name||'';
  if(type===37||type===46)return 2;
  if(type===24&&/戦車|陸戦隊|M4A1|武装大発|装甲艇/.test(name))return 2;
  if(type===18&&/三式弾/.test(name))return 1;
  return 0;
}
function antiGroundShips(store,scheme){
  return scheme.ships.map(entry=>{
    const ship=store.info.ships[entry.id];
    const types=[...(entry.slots||usableSlots(store,entry.id)),entry.ex??ship.api_slot_ex].map(id=>
      id>0?store.const.$equips[store.info.equips[id]?.api_slotitem_id]:null);
    return Math.max(0,...types.map(antiGroundStrength));
  }).filter(Boolean);
}
function surfaceWeaponCount(store,entry){
  return (entry.slots||usableSlots(store,entry.id)).filter(id=>{
    const type=Number(store.const.$equips[store.info.equips[id]?.api_slotitem_id]
      ?.api_type?.[2]);
    return [1,5].includes(type);
  }).length;
}
function surfaceLoadout(store,scheme,inventory,area,phase,profile,heldSlots=[]){
  const original=scheme;
  // Retire excess automatic ASW kits before restoring surface weapons. Manual
  // slots remain authoritative, even when they exceed the automatic budget.
  const limit=aswEscortLimit(profile,store),escorts=aswEscortIds(store,scheme.ships,limit);
  const held=new Map(heldSlots.filter(Boolean).map(entry=>[entry.id,entry.keep||{}]));
  let trimmed=false;
  const cleared={...scheme,ships:scheme.ships.map(entry=>({...entry,slots:entry.slots.map((id,k)=>{
    const type=Number(store.const.$equips[store.info.equips[id]?.api_slotitem_id]?.api_type?.[2]);
    if(Number.isFinite(limit)&&!escorts.has(entry.id)&&[14,15,40].includes(type)&&!held.get(entry.id)?.[k]){trimmed=true;return -1;}
    return id;
  })}))};
  if(trimmed)scheme=completeCombatLoadout(store,cleared,inventory,{area,asw:limit>0,profile,heldSlots});
  const weapons=inventory.filter(item=>[1,5].includes(Number(item.master.api_type[2]))).sort((a,b)=>
    Number(b.master.api_type[2]===1)-Number(a.master.api_type[2]===1)||
    Number(b.master.api_houg||0)-Number(a.master.api_houg||0)||a.id-b.id);
  const entries=scheme.ships.map(entry=>({...entry}));
  const slots=new Map(scheme.ships.map(entry=>[entry.id,
    (entry.slots||usableSlots(store,entry.id)).slice()]));
  const used=new Set([...slots.values()].flat().concat(entries.map(e=>e.ex??store.info.ships[e.id].api_slot_ex)).filter(id=>id>0));let changed=false;
  const target=requiredDestroyerGuns(area,phase,profile);
  for(const entry of entries){
    const ship=store.info.ships[entry.id];
    if(![1,2].includes(Number(store.const.$ships[ship.api_ship_id]?.api_stype)))continue;
    const list=slots.get(entry.id);
    const typeOf=id=>Number(store.const.$equips[store.info.equips[id]?.api_slotitem_id]
      ?.api_type?.[2]);
    while(list.filter(id=>[1,5].includes(typeOf(id))).length<target){
      const positions=list.map((id,slot)=>({id,slot,type:typeOf(id)}))
        .filter(row=>row.id<=0||[24,30,14,15,40,12,13,93].includes(row.type))
        .filter(row=>!aswCombat.requiresAswPackages(profile)||!escorts.has(entry.id)||![14,15,40].includes(row.type))
        .filter(row=>!['7-2'].includes(area)||![14,40].includes(row.type)||
          list.filter(id=>[14,40].includes(typeOf(id))).length>1)
        .sort((a,b)=>(a.id<=0?0:[24,30].includes(a.type)?1:
          [14,15,40].includes(a.type)?2:3)-
          (b.id<=0?0:[24,30].includes(b.type)?1:
            [14,15,40].includes(b.type)?2:3));
      let placed=false;
      for(const position of positions){
        for(const item of weapons){
          if(used.has(item.id))continue;
          try{if(!canEquip(store,entry.id,item.id,position.slot))continue;}catch(_){continue;}
          list[position.slot]=item.id;used.add(item.id);changed=true;placed=true;break;
        }
        if(placed)break;
      }
      if(!placed)break;
    }
  }
  if(!changed)return trimmed&&aswCombat.maintainsAsw(store,original,scheme,profile,limit)?scheme:null;
  for(const entry of entries)if(slots.get(entry.id).some((id,index)=>
    id!==store.info.ships[entry.id].api_slot[index]))entry.slots=slots.get(entry.id);
  const fitted={fleet:scheme.fleet,ships:entries};
  return aswCombat.maintainsAsw(store,original,fitted,profile,limit)?fitted:null;
}

module.exports={airLoadout,antiGroundShips,fitGuideStrategy,gearVariant,oneOneOpeningLoadout,requiredDestroyerGuns,routingLoadout,speedHolds,strategyFailure,surfaceLoadout,surfaceWeaponCount};
