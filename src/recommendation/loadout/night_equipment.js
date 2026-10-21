'use strict';
const {canEquip,acceptsOtherSlot}=require('../../domain/fleet/equipment_rules');
const slotsOf=(store,entry)=>entry.slots||(store.info.ships[entry.id].api_slot||[])
  .slice(0,store.const.$ships[store.info.ships[entry.id].api_ship_id].api_slot_num);
const masterOf=(store,id)=>store.const.$equips[store.info.equips[id]?.api_slotitem_id];
const typeOf=(store,id)=>Number(masterOf(store,id)?.api_type?.[2]);
const nightRecon=master=>Number(master?.api_type?.[2])===10&&Number(master.api_type[3])===50;
const nightZuiun=master=>Number(master?.api_type?.[2])===11&&/夜間瑞雲/.test(master.api_name||'');
function doubleAttack(store,entry){
  const ids=[...slotsOf(store,entry),entry.ex??store.info.ships[entry.id].api_slot_ex];
  const types=ids.map(id=>typeOf(store,id));
  return types.filter(t=>[1,2,3].includes(t)).length===2&&
    !types.some(t=>t===4||t===5);
}
function nightReadiness(store,scheme){
  let recon=0,unfilledRecon=0,flares=0,flareCarriers=0,lookouts=0,zuiun=0,zuiunEquipped=0,searchlights=0;
  for(const entry of scheme.ships){
    const ship=store.info.ships[entry.id],sm=store.const.$ships[ship.api_ship_id];
    for(const [slot,id] of slotsOf(store,entry).entries()){
      const master=masterOf(store,id),count=Number(ship.api_onslot?.[slot]||0);
      if(nightRecon(master)){
        if(count>0)recon++;
        else if(Number(sm.api_maxeq?.[slot]||0)>0)unfilledRecon++;
      }
      if(nightZuiun(master)){
        zuiunEquipped++;
        const mainGuns=[...slotsOf(store,entry),entry.ex??ship.api_slot_ex]
          .filter(id=>[1,2,3,38].includes(typeOf(store,id))).length;
        if(count>0&&[3,4,6,10,16].includes(Number(sm.api_stype))&&mainGuns>=2)zuiun++;
      }
    }
    const equipment=[...slotsOf(store,entry),entry.ex??ship.api_slot_ex];
    if(equipment.some(id=>typeOf(store,id)===33))flareCarriers++;
    for(const id of equipment){
      const type=typeOf(store,id);
      if(type===33)flares++;
      if(type===39)lookouts++;
      if([29,42].includes(type))searchlights++;
    }
  }
  const warnings=[];
  if(!recon)warnings.push(unfilledRecon?'夜侦槽内尚无飞机，补给并回读后才能确认可发动。':
    '未配到有飞机的夜侦；请检查可用夜侦及可搭载槽位。');
  if(!flares&&!zuiun)warnings.push('未配到照明弹或可发动的夜间瑞云，夜战辅助装备不足。');
  if(flares&&zuiunEquipped)warnings.push('照明弹与夜间瑞云并用可能降低夜间瑞云特殊攻击发动率。');
  if(searchlights)warnings.push('探照灯会增加携带舰在道中夜战中的被攻击风险，请人工确认。');
  return {recon,unfilledRecon,flares,flareCarriers,lookouts,zuiun,zuiunEquipped,searchlights,
    doubleAttackShips:scheme.ships.filter(entry=>doubleAttack(store,entry)).length,
    supportTier:Number(recon>0)+Number(flares>0||zuiun>0),warnings};
}
// Plan only owned, available equipment. Preserve fighters, ASW/installation
// gear and two main guns; final routing/air checks decide whether utility-slot
// replacements remain viable. Searchlights are deliberately never auto-fitted.
function nightLoadout(store,scheme,inventory,{normalizeGuns=false,nightBattles=1,heldSlots=[]}={}){
  const held=new Map(heldSlots.filter(Boolean).map(s=>[s.id,s.keep||{}]));
  const entries=scheme.ships.map(entry=>({...entry,slots:slotsOf(store,entry).slice()}));
  const selected=new Set(entries.map(e=>e.id));
  const used=new Set(entries.flatMap(e=>[...e.slots,e.ex??store.info.ships[e.id].api_slot_ex])
    .filter(id=>id>0));
  let changed=false;
  const replace=(entry,slot,id)=>{
    if(held.get(entry.id)?.[slot])return;
    if(entry.slots[slot]===id)return;
    if(entry.slots[slot]>0)used.delete(entry.slots[slot]);
    entry.slots[slot]=id;if(id>0)used.add(id);changed=true;
  };
  const allowed=(entry,item,slot)=>{
    if(used.has(item.id))return false;
    try{return canEquip(store,entry.id,item.id,slot)&&
      (!item.sourceShipId||selected.has(item.sourceShipId)||
        acceptsOtherSlot(store,entry.id,item.id,slot));}catch(_){return false;}
  };
  const expendable=(entry,slot)=>{
    if(held.get(entry.id)?.[slot])return false;
    const id=entry.slots[slot],master=masterOf(store,id),type=typeOf(store,id);
    return id<=0||[12,13,21,24,25,30,34,35,36,37,54,93].includes(type)||
      type===10&&!nightRecon(master);
  };
  if(normalizeGuns)for(const entry of entries){
    const ship=store.info.ships[entry.id],stype=Number(store.const.$ships[ship.api_ship_id].api_stype);
    if(![2,3,4,5,6,8,9,10].includes(stype))continue;
    let kept=0;
    for(let slot=0;slot<entry.slots.length;slot++){
      const type=typeOf(store,entry.slots[slot]);
      if([1,2,3].includes(type)){if(++kept>2)replace(entry,slot,-1);}
      else if([4,5,29,42].includes(type))replace(entry,slot,-1);
    }
    // A third gun in expansion also changes a double attack to a cut-in.
    // Fixed selections pin the hull, not its loadout; use a lookout instead.
    const extra=entry.ex??ship.api_slot_ex;
    if(!held.get(entry.id)?.ex&&[4,5,29,42].includes(typeOf(store,extra))){
      entry.ex=-1;used.delete(extra);changed=true;
    }
    const weapons=inventory.filter(item=>[1,2,3].includes(Number(item.master.api_type[2])))
      .sort((a,b)=>Number(b.master.api_houg||0)-Number(a.master.api_houg||0)||a.id-b.id);
    while(entry.slots.filter(id=>[1,2,3].includes(typeOf(store,id))).length<2){
      let fitted=false;
      const positions=entry.slots.map((id,slot)=>({id,slot}))
        .filter(p=>expendable(entry,p.slot)).sort((a,b)=>Number(a.id>0)-Number(b.id>0));
      for(const p of positions){
        const item=weapons.find(item=>allowed(entry,item,p.slot));if(!item)continue;
        replace(entry,p.slot,item.id);fitted=true;break;
      }
      if(!fitted)break;
    }
  }
  const fittedScheme=()=>({fleet:scheme.fleet,ships:entries});
  const fitOne=(predicate,aircraft=false,eligible=()=>true)=>{
    const choices=inventory.filter(item=>predicate(item.master)).sort((a,b)=>
      Number(b.master.api_houm||0)-Number(a.master.api_houm||0)||
      Number(b.master.api_saku||0)-Number(a.master.api_saku||0)||a.id-b.id);
    const positions=entries.flatMap(entry=>entry.slots.map((id,slot)=>({entry,id,slot})))
      .filter(p=>expendable(p.entry,p.slot))
      .filter(p=>eligible(p.entry,p.slot))
      .filter(p=>!aircraft||Number(store.info.ships[p.entry.id].api_onslot?.[p.slot]||0)>0)
      .sort((a,b)=>Number(a.id>0)-Number(b.id>0)||
        Number(nightRecon(masterOf(store,b.id)))-Number(nightRecon(masterOf(store,a.id))));
    for(const p of positions){
      const item=choices.find(item=>allowed(p.entry,item,p.slot));if(!item)continue;
      replace(p.entry,p.slot,item.id);return true;
    }
  };
  if(!nightReadiness(store,fittedScheme()).recon)fitOne(nightRecon,true);
  const readiness=nightReadiness(store,fittedScheme());
  if(!readiness.zuiunEquipped){
    // One activation check per carrier, not per item. The second flare is
    // optional insurance for repeated night fights and only uses an empty slot.
    const wanted=nightBattles>=2?2:1;
    while(nightReadiness(store,fittedScheme()).flareCarriers<wanted){
      const extra=nightReadiness(store,fittedScheme()).flareCarriers>0;
      const fitted=fitOne(master=>Number(master.api_type[2])===33,false,(entry,slot)=>
        ![...entry.slots,entry.ex??store.info.ships[entry.id].api_slot_ex].some(id=>typeOf(store,id)===33)&&
        (!extra||entry.slots[slot]<=0));
      if(!fitted)break;
    }
  }
  // A lookout belongs in an unlocked expansion slot; keep already equipped
  // expansion gear and never sacrifice a main slot needed for air/LoS.
  for(const entry of entries){
    const ex=entry.ex??store.info.ships[entry.id].api_slot_ex;
    if(ex!==-1||held.get(entry.id)?.ex)continue;
    const choices=inventory.filter(item=>Number(item.master.api_type[2])===39)
      .sort((a,b)=>Number(b.master.api_houm||0)-Number(a.master.api_houm||0)||a.id-b.id);
    const item=choices.find(item=>allowed(entry,item,'ex'));
    if(item){entry.ex=item.id;used.add(item.id);changed=true;}
  }
  return changed?fittedScheme():null;
}
module.exports={nightLoadout,nightReadiness,doubleAttack};
