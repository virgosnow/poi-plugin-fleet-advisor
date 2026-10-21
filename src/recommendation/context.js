'use strict';
// Candidate roster, fixed choices and immutable-snapshot planning context.
const {createFleetPlanner}=require('../domain/fleet/fleet_plan');
const {error}=require('../shared/errors');
const selectionFilters=require('../config/recommendation_filters');

const integerIds=(value,name)=>{
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(value).size!==value.length)
    throw error('INVALID_QUERY',`${name} 须为不重复的舰娘实例 ID 数组`);
  return value;
};
const num=value=>Array.isArray(value)?Number(value[0]||0):Number(value||0);
// API callers can omit a route selection. They still need evidence for one
// complete, confirmed path, rather than a map-wide optimistic upper bound.
function shipFamilyKey(row){
  const reading=row.master.api_yomi;
  return typeof reading==='string'&&reading.trim()?`reading:${reading.normalize('NFKC').trim()}`:
    `master:${row.ship.api_ship_id}`;
}
function hasDuplicateShipFamily(rows){
  return new Set(rows.map(shipFamilyKey)).size!==rows.length;
}
// Remodel tier = steps from the base form along api_aftershipid (base 0,
// 改 1, 改二 2, 改二甲 3 ...). Ship grade follows the agreed ordering:
// level ≫ remodel tier ≫ rarity, raw stats only break exact ties.
function remodelTierLookup($ships){
  const prev=new Map();
  for(const id in $ships){
    const aft=Number($ships[id].api_aftershipid||0);
    if(aft>0&&$ships[aft])prev.set(Number(aft),Number(id));
  }
  const cache=new Map();
  return id=>{
    id=Number(id);
    if(cache.has(id))return cache.get(id);
    let depth=0,cur=id,guard=0;
    while(prev.has(cur)&&guard++<24){cur=prev.get(cur);depth++;}
    cache.set(id,depth);
    return depth;
  };
}
// Same eligibility rules as fleet_metrics.asw, evaluated on the CURRENT
// build (observed ASW + equipped sonar); used to seed the candidate pool
// on submarine maps. The evaluator's openingASW stays authoritative for
// scoring because it also models swapped equipment.
function oaswCapableNow(store,row){
  const state={slots:row.ship.api_slot||[],ex:row.ship.api_slot_ex};
  return require('../domain/combat/opening_asw').openingASW(store,{id:row.id,ship:row.ship,master:row.master,before:state,after:state}).eligible===true;
}

function aswPotential(store,row){
  if(![1,2,3,4,21,22].includes(row.stype))return -Infinity;
  const before={slots:row.ship.api_slot||[],ex:row.ship.api_slot_ex};
  const bare=require('../domain/combat/opening_asw').aswStats(store,{ship:row.ship,master:row.master,before,after:{slots:[],ex:-1}});
  // Do not retain the currently worn equipment's blue bonus in hull ranking.
  return (bare.total??0)+(oaswCapableNow(store,row)?100:0);
}
function context(store,{fleet,fixedShipIds,excludedShipIds,automaticFilters},defaultFleet){
  const selected=fleet??defaultFleet;
  if(!Number.isInteger(selected)||selected<1||selected>4||!store.info.fleets[selected-1])
    throw error('INVALID_QUERY','fleet 必须是已有的 1–4 舰队');
  if(Number(store.info.fleets[selected-1].api_mission?.[0])!==0)
    throw error('INVALID_QUERY','目标舰队正在远征');
  const fixed=integerIds(fixedShipIds,'fixedShipIds'),excluded=integerIds(excludedShipIds,'excludedShipIds');
  if(fixed.length>6)throw error('INVALID_QUERY','固定舰娘不能超过 6 艘');
  if(fixed.some(id=>excluded.includes(id)))throw error('INVALID_QUERY','固定与排除舰娘不能重叠');
  const docked=new Set((store.info.repairs||[]).map(row=>Number(typeof row==='object'?row.api_ship_id:row)));
  const expeditionShips=new Set(store.info.fleets.filter(f=>Number(f.api_mission?.[0])!==0)
    .flatMap(f=>f.api_ship||[]).filter(id=>id>0));
  const tiers=remodelTierLookup(store.const.$ships);
  const filtered=selectionFilters.evaluator(store,defaultFleet===2?'expedition':'normal',automaticFilters);
  const roster=Object.entries(store.info.ships).map(([key,ship])=>{
    const id=Number(key),master=store.const.$ships[ship.api_ship_id];
    if(!master)return null;
    const statSum=num(ship.api_karyoku)+num(ship.api_raisou)+num(ship.api_soukou)+
      num(ship.api_taiku)+num(ship.api_taisen)+num(ship.api_sakuteki);
    return {id,ship,master,stype:Number(master.api_stype),level:Number(ship.api_lv||0),
      name:master.api_name||'',fuel:Number(master.api_fuel_max||0),ammo:Number(master.api_bull_max||0),
      remodelTier:tiers(ship.api_ship_id),rarity:Number(master.api_backs||0),
      power:Number(ship.api_lv||0)*1000+tiers(ship.api_ship_id)*100+
        Number(master.api_backs||0)*10+statSum*0.02,
      available:!excluded.includes(id)&&!expeditionShips.has(id)&&!docked.has(id)&&ship.api_situation!==2&&
        (fixed.includes(id)||filtered(id).length===0)};
  }).filter(Boolean);
  const byId=new Map(roster.map(row=>[row.id,row]));
  for(const id of fixed)if(!byId.get(id)?.available)
    throw error('INVALID_QUERY',`固定舰娘 ${id} 不存在、被排除或目前不能编入`);
  if(hasDuplicateShipFamily(fixed.map(id=>byId.get(id))))
    throw error('INVALID_QUERY','固定舰娘中有同一舰娘的不同实例，不能编入同一舰队');
  return {fleet:selected,fixed,excluded,store,roster:roster.filter(row=>row.available),byId,
    preview:createFleetPlanner(()=>store)};
}
const shipCost=(row,fuel=1,ammo=1)=>row.fuel*fuel+row.ammo*ammo;
const schemeOf=(fleet,rows)=>({fleet,ships:rows.map(row=>({id:row.id}))});
function holdDraftEquipment(store,scheme,slots){
  if(!slots?.length)return scheme;
  const held=slots.filter(s=>s&&(s.pin||Object.keys(s.keep||{}).length));
  if(!held.length)return scheme;
  const entries=scheme.ships.map(s=>({...s,slots:(s.slots||usableSlots(store,s.id)).slice(),ex:(s.ex??store.info.ships[s.id].api_slot_ex)>0?s.ex??store.info.ships[s.id].api_slot_ex:-1}));
  if(held.some(h=>!entries.some(s=>s.id===h.id)))throw error('INVALID_QUERY','固定舰娘未保留');
  const owners=new Map(),output=Array(6).fill(null);
  slots.forEach((h,i)=>{if(!held.includes(h))return;const entry=entries.find(s=>s.id===h.id);output[i]=entry;
    for(const key of Object.keys(h.keep||{})){const id=(key==='ex'?h.ex:h.slots[key])>0?(key==='ex'?h.ex:h.slots[key]):-1;if(key==='ex')entry.ex=id;else entry.slots[key]=id;
      if(id>0)owners.set(id,{id:h.id,key:String(key)});}
  });
  const remaining=entries.filter(s=>!held.some(h=>h.id===s.id));
  for(let i=0;i<output.length;i++)if(!output[i])output[i]=remaining.shift()||null;
  for(const s of entries){const keep=(id,key)=>!owners.has(id)||owners.get(id).id===s.id&&owners.get(id).key===String(key)?id:-1;
    s.slots=s.slots.map(keep);s.ex=keep(s.ex,'ex');}
  return {fleet:scheme.fleet,ships:output.filter(Boolean)};
}
const idsKey=rows=>rows.map(row=>row.id).join(',');
const stableHash=(a,b)=>((a*1664525+b*1013904223)>>>0)/4294967296;
// api_slot is always the raw 5-element array; schemes must stay within the
// ship's real slot count or equipment_planner rejects the plan.
const usableSlots=(store,id)=>{
  const ship=store.info.ships[id],master=store.const.$ships[ship.api_ship_id];
  const count=Number(master?.api_slot_num??ship.api_slotnum??(ship.api_slot||[]).length);
  return (ship.api_slot||[]).slice(0,count);
};

module.exports={aswPotential,context,hasDuplicateShipFamily,holdDraftEquipment,idsKey,num,oaswCapableNow,schemeOf,shipCost,shipFamilyKey,stableHash,usableSlots};
