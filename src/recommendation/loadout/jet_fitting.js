'use strict';
const {canEquip,acceptsOtherSlot}=require('../../domain/fleet/equipment_rules');
const {smallCarrierSlot,carrierSlotSize}=require('./carrier_policy');
const jets=require('../../domain/combat/jet_aviation');

// A bounded set of INVENTORY-backed alternatives. Never invent an instance,
// force all armored carriers to accept jets, or change manual/held positions.
function jetLoadouts(store,scheme,inventory,{heldSlots=[],limit=12}={}){
  const master=id=>store.const.$equips[store.info.equips[id]?.api_slotitem_id];
  const type=id=>Number(master(id)?.api_type?.[2]);
  const holds=new Map(heldSlots.filter(Boolean).map(e=>[e.id,e.keep||{}]));
  const positions=scheme.ships.flatMap((entry,index)=>{
    const ship=store.info.ships[entry.id],sm=store.const.$ships[ship.api_ship_id];
    if(![7,11,18].includes(Number(sm.api_stype)))return [];
    return entry.slots.map((id,slot)=>({index,slot,id,entry,ship,sm})).filter(p=>!holds.get(entry.id)?.[p.slot]&&
      carrierSlotSize(ship,sm,p.slot)>0).sort((a,b)=>carrierSlotSize(ship,sm,b.slot)-carrierSlotSize(ship,sm,a.slot));
  });
  if(!positions.length)return [];
  const wanted=inventory.filter(i=>[56,57].includes(Number(i.master.api_type[2])));
  if(!wanted.length&&!positions.some(p=>[56,57].includes(type(p.id))))return [];
  const keys=new Map(inventory.map(i=>{const raw=store.info.equips[i.id];return [i.id,[raw.api_slotitem_id,raw.api_level||0,raw.api_alv||0].join(':')];}));
  const variants=[],seen=new Set([JSON.stringify(scheme)]);
  const add=value=>{const key=JSON.stringify(value);if(seen.has(key)||variants.length>=limit)return;seen.add(key);variants.push(value);};
  const swap=(base,p,item)=>{
    const used=new Set(base.ships.flatMap(e=>e.slots.concat(e.ex)).filter(id=>id>0));
    if(used.has(item.id))return null;
    try{if(!canEquip(store,p.entry.id,item.id,p.slot)||item.sourceShipId&&item.sourceShipId!==p.entry.id&&!acceptsOtherSlot(store,p.entry.id,item.id,p.slot))return null;}catch(_){return null;}
    return {...base,ships:base.ships.map((e,i)=>i!==p.index?e:{...e,slots:e.slots.map((id,k)=>k===p.slot?item.id:id)})};
  };
  for(const p of positions){
    if(variants.length>=limit-3)break;
    const old=type(p.id),large=!smallCarrierSlot(p.ship,p.sm,p.slot);
    const targets=old===57?[7,57]:old===56?[6,56]:old===6?[56]:large&&[7,8].includes(old)?[57]:[];
    const representatives=new Set();
    const value=i=>Number(i.master.api_raig||0)+Number(i.master.api_baku||0)+Number(i.master.api_tyku||0);
    const choices=inventory.filter(i=>targets.includes(Number(i.master.api_type[2]))).sort((a,b)=>
      Number(!jets.isJet(a.master.api_type[2]))-Number(!jets.isJet(b.master.api_type[2]))||value(b)-value(a)||a.id-b.id);
    let added=0;
    for(const item of choices){
      if(!targets.includes(Number(item.master.api_type[2]))||representatives.has(keys.get(item.id)))continue;
      const next=swap(scheme,p,item);if(!next)continue;
      representatives.add(keys.get(item.id));add(next);
      if(++added>=3)break;
    }
  }
  // Jet-fighter CIs need both roles. Compare a small number of combinations
  // as well as singles; copies are allocated again against each whole fleet.
  for(const base of variants.slice(0,6)){
    if(variants.length>=limit)break;
    for(const p of positions){
      const current=type(base.ships[p.index].slots[p.slot]);
      const target=current===6?56:!smallCarrierSlot(p.ship,p.sm,p.slot)&&[7,8].includes(current)?57:null;
      if(!target)continue;
      const item=wanted.find(item=>Number(item.master.api_type[2])===target&&swap(base,p,item));
      if(item)add(swap(base,p,item));
      if(variants.length>=limit)break;
    }
  }
  return variants;
}
module.exports={jetLoadouts};
