'use strict';
// Ranking only. Loss bounds are not wipe-out probabilities or expected damage.
// Use the route simulator already computed for air control; do not run a second
// simulation or silently invent enemy AACI activation rates/multipliers.
function aircraftSurvival(air,reference,estimate){
  if(!air?.slots?.length)return {penalty:0,slots:[],uncertainNodes:[]};
  const uncertainNodes=(reference?.nodes||[]).filter(n=>!n.noAirBattle&&n.kind!=='aerialRaid'&&
    n.antiAir?.status==='unknown'&&/特殊对空/.test(n.antiAir.reason||'')).map(n=>n.id);
  const remaining=new Map();
  for(const path of estimate?.paths||[])for(const step of path.steps||[]){
    // A known interception bound applies even if a later node is unknown.
    for(const row of step.aircraft||[]){
      const key=row.shipId+':'+row.slot;
      remaining.set(key,Math.min(remaining.get(key)??Infinity,row.planes[0]));
    }
  }
  const slots=air.slots.filter(s=>[7,8,11].includes(s.aircraftType)&&s.planes?.[1]>0).map(s=>{
    const count=s.planes[1],low=remaining.get(s.shipId+':'+s.slot);
    // Existing conservative bounds receive bounded weight. Unquantified AACI
    // adds a qualitative small-slot fragility cost, never a claimed loss rate.
    const lossRisk=Number.isFinite(low)?1-Math.sqrt(Math.max(0,low)/count):0;
    const specialRisk=uncertainNodes.length?Math.min(1,8/count):0;
    return {shipId:s.shipId,slot:s.slot,type:s.aircraftType,planes:count,
      remainingLowerBound:low??null,risk:Math.max(lossRisk*.5,specialRisk*.5)};
  });
  return {slots,uncertainNodes};
}
function survivalPenalty(store,scheme,air,reference,estimate){
  const result=aircraftSurvival(air,reference,estimate);let penalty=0;
  for(const slot of result.slots){
    const entry=scheme.ships.find(e=>e.id===slot.shipId),id=entry?.slots[slot.slot];
    const master=store.const.$equips[store.info.equips[id]?.api_slotitem_id];
    penalty+=(Number(master?.api_raig||0)+Number(master?.api_baku||0))*Math.sqrt(slot.planes)*slot.risk*.7;
  }
  // A bomber-only observation setup can lose both its opening strike and
  // spotting. A surviving recon aircraft avoids that second loss of utility.
  for(const entry of scheme.ships){
    const type=Number(store.const.$ships[store.info.ships[entry.id]?.api_ship_id]?.api_stype);
    if(![3,5,6,8,9,10].includes(type))continue;
    const ship=store.info.ships[entry.id],master=store.const.$ships[ship?.api_ship_id];
    if(entry.slots.some((id,slot)=>Number(store.const.$equips[store.info.equips[id]?.api_slotitem_id]?.api_type?.[2])===10&&
      Number(ship.api_onslot?.[slot]??master.api_maxeq?.[slot])>0))continue;
    const bombers=result.slots.filter(s=>s.shipId===entry.id&&s.type===11);
    if(bombers.length)penalty+=50*Math.min(...bombers.map(s=>s.risk));
  }
  return {...result,penalty,basis:'沿途保守残机边界折减输出评分；特殊迎击数值未知时仅加小槽风险权重，不代表击坠或发动概率'};
}
// One bounded fleet alternative: compare safe spotting with fragile bomber-
// only spotting. Full air/LoS/routing evaluation decides whether it is usable.
function reconSurvivalLoadout(store,scheme,inventory,risk,heldSlots=[]){
  if(!risk?.slots?.some(s=>s.type===11&&s.risk>=.35))return null;
  const {canEquip,acceptsOtherSlot}=require('../../domain/fleet/equipment_rules');
  const held=new Map(heldSlots.filter(Boolean).map(e=>[e.id,e.keep||{}]));
  const entries=scheme.ships.map(e=>({...e,slots:e.slots.slice()}));
  const used=new Set(entries.flatMap(e=>e.slots.concat(e.ex)).filter(id=>id>0));
  const items=inventory.filter(i=>Number(i.master.api_type?.[2])===10)
    .sort((a,b)=>Number(b.master.api_saku||0)-Number(a.master.api_saku||0)||a.id-b.id);
  let changed=false;
  for(const entry of entries){
    const ship=store.info.ships[entry.id],sm=store.const.$ships[ship.api_ship_id];
    if(![3,5,6,8,9,10].includes(Number(sm.api_stype)))continue;
    const capacity=k=>Number(ship.api_onslot?.[k]??sm.api_maxeq?.[k]??0);
    if(entry.slots.some((id,k)=>Number(store.const.$equips[store.info.equips[id]?.api_slotitem_id]?.api_type?.[2])===10&&capacity(k)>0))continue;
    const bombers=risk.slots.filter(s=>s.shipId===entry.id&&s.type===11);
    if(!bombers.length||bombers.some(s=>s.risk<.35))continue;
    for(const slot of bombers.slice().sort((a,b)=>a.planes-b.planes)){
      if(held.get(entry.id)?.[slot.slot]||capacity(slot.slot)<=0)continue;
      const item=items.find(i=>!used.has(i.id)&&canEquip(store,entry.id,i.id,slot.slot)&&
        (!i.sourceShipId||i.sourceShipId===entry.id||acceptsOtherSlot(store,entry.id,i.id,slot.slot)));
      if(!item)continue;
      used.delete(entry.slots[slot.slot]);entry.slots[slot.slot]=item.id;used.add(item.id);changed=true;break;
    }
  }
  return changed?{...scheme,ships:entries}:null;
}
module.exports={aircraftSurvival,survivalPenalty,reconSurvivalLoadout};
