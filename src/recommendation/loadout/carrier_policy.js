'use strict';
const {estimateRouteAirMargins}=require('../../domain/routes/route_air');
const jets=require('../../domain/combat/jet_aviation');
// A conservative fitting preference, not a universal shoot-down threshold.
const SMALL_CARRIER_SLOT=10;
function carrierSlotSize(ship,master,slot){
  return Number(ship.api_onslot?.[slot]??master.api_maxeq?.[slot]??0);
}
const smallCarrierSlot=(ship,master,slot)=>carrierSlotSize(ship,master,slot)<=SMALL_CARRIER_SLOT;
function carrierUtility(inventory){
  const type=item=>Number(item.master.api_type?.[2]);
  const rank=item=>[6,56].includes(type(item))?0:1;
  const value=item=>[6,56].includes(type(item))?Number(item.master.api_tyku||0):
    Number(item.master.api_houg||0)*3+Number(item.master.api_houm||0);
  // Reconnaissance is fitted for an actual LoS gap, not as spare-slot cargo.
  return inventory.filter(item=>[6,56].includes(type(item))||
    [1,2,3,4,35].includes(type(item))&&Number(item.master.api_houg)>0)
    .sort((a,b)=>rank(a)-rank(b)||value(b)-value(a)||a.id-b.id);
}
// Recommendation policy, not a restriction on player equipment or game rules.
// Do not trade FBA away for BA/BBA just to gain an extra jet attack. All CI
// roles must belong to this carrier and have known positive full capacities.
function jetCutInAllowed(store,scheme,heldSlots=[]){
  for(const entry of scheme.ships){
    const master=id=>store.const.$equips[store.info.equips[id]?.api_slotitem_id];
    const automatic=entry.slots.flatMap((id,k)=>jets.isJet(master(id)?.api_type?.[2])&&
      !heldSlots.some(h=>h?.id===entry.id&&h.keep?.[k]&&(!h.slots||h.slots[k]===id))?[k]:[]);
    if(!automatic.length)continue;
    const ship=store.info.ships[entry.id],sm=store.const.$ships[ship.api_ship_id];
    if(![7,11,18].includes(Number(sm.api_stype)))return false;
    if(automatic.some(k=>!Number.isFinite(sm.api_maxeq?.[k])||sm.api_maxeq[k]<=0))return false;
    const types=entry.slots.flatMap((id,k)=>{
      const m=master(id),n=sm.api_maxeq?.[k];
      return Number.isFinite(n)&&n>0&&m&&Number(m.api_type?.[0])!==21?[Number(m.api_type?.[2])]:[];
    });
    if(!jets.carrierModes(types).some(mode=>mode==='FBA'||Object.hasOwn(jets.CI,mode)))return false;
  }
  return true;
}

function carrierSummary(store,scheme){
  return scheme.ships.flatMap(entry=>{
    const ship=store.info.ships[entry.id],master=store.const.$ships[ship.api_ship_id];
    if(![7,11,18].includes(Number(master.api_stype)))return [];
    const attacks=(entry.slots||ship.api_slot).flatMap((id,k)=>{
      const m=store.const.$equips[store.info.equips[id]?.api_slotitem_id],t=Number(m?.api_type?.[2]),n=carrierSlotSize(ship,master,k);
      return [7,8,57].includes(t)&&n>0?[{type:t,large:!smallCarrierSlot(ship,master,k),
        power:(Number(m.api_raig||0)+Number(m.api_baku||0))*Math.sqrt(n)/(t===57?Math.SQRT2:1)}]:[];
    });
    return [{id:entry.id,attacks,jetFighter:entry.slots.some(id=>Number(store.const.$equips[store.info.equips[id]?.api_slotitem_id]?.api_type?.[2])===56),power:attacks.reduce((n,a)=>n+a.power,0)}];
  });
}
// Opportunity thresholds below are fitting heuristics. Wiki describes the
// AS -> AS+ spotting/air-loss benefits, not a universal number of fighters:
// https://wikiwiki.jp/kancolle/航空戦#AirSupremacy
function healthySupremacy(store,scheme,air,estimate){
  const rows=carrierSummary(store,scheme);
  return rows.length>=1&&estimate?.margins?.supremacy?.min>=0&&
    (air?.slots||[]).filter(s=>[6,56].includes(s.aircraftType)&&s.planes?.[0]>0&&s.effectiveAntiAir?.[0]>=10).length>=Math.min(2,rows.length)&&
    rows.every(row=>[7,8].every(t=>row.attacks.some(a=>a.type===t&&a.large))||
      row.jetFighter&&row.attacks.some(a=>a.type===57&&a.large));
}
// Strike planes also suffer stage-two AA. When their air power is essential,
// require a durable fighter floor and extra margin after sequential losses.
// These 80% / 120% limits are policy buffers, not wipeout probabilities.
function supportedAirGoal(air,reference,goal){
  if(reference?.status!=='known'||air?.status!=='range')return false;
  // Jets have an explicit pre-air loss model; use its actual conservative
  // margin rather than a generic fighter-bomber percentage substitute.
  if(air.slots.some(s=>jets.isJet(s.aircraftType)))return estimateRouteAirMargins(air,reference)?.[goal]?.min>=0;
  const enemy=reference.enemyAirPower??Math.max(0,...reference.nodes.map(n=>n.enemyAirPower??n.upperBound??NaN));
  if(enemy===0)return true;
  if(!Number.isFinite(enemy))return false;
  const required=Math.max(1,Number(reference[goal]??enemy*(goal==='supremacy'?3:1.5)));
  const slots=air.slots.filter(s=>[6,45,56].includes(s.aircraftType));
  const pure={status:'range',slots,min:slots.reduce((n,s)=>n+s.min,0),max:slots.reduce((n,s)=>n+s.max,0)};
  const floor=estimateRouteAirMargins(pure,reference)?.[goal];
  if(!floor)return false;
  if(floor.min>=0)return true;
  const margin=estimateRouteAirMargins(air,reference)?.[goal];
  return required+floor.min>=required*0.8&&margin?.min>=required*0.2;
}
function affordableSupremacy(store,before,after){
  const original=carrierSummary(store,before),next=carrierSummary(store,after);
  const count=rows=>rows.reduce((n,r)=>n+r.attacks.length,0),power=rows=>rows.reduce((n,r)=>n+r.power,0);
  return original.length===next.length&&count(original)-count(next)<=1&&power(next)>=power(original)*0.85&&
    original.every(row=>{
      const fitted=next.find(r=>r.id===row.id);
      return fitted&&fitted.attacks.length>=Math.min(2,row.attacks.length)&&
        row.attacks.every(a=>fitted.attacks.some(b=>b.type===a.type));
    });
}
module.exports={SMALL_CARRIER_SLOT,carrierSlotSize,smallCarrierSlot,carrierUtility,healthySupremacy,affordableSupremacy,supportedAirGoal,jetCutInAllowed};
