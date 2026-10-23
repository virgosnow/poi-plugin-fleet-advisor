'use strict';
const {canEquip,acceptsOtherSlot}=require('../fleet/equipment_rules');
const {snapshotMemo}=require('../fleet/equipment_planner');
const {equipmentRewardRate,rewardBonus}=require('./expedition_income');
const rewards=require('../../../data/expedition_rewards.json').missions;
const isCargo=(store,id)=>equipmentRewardRate(store.info.equips[id]?.api_slotitem_id)>0;
const bonusDetails=(store,entries)=>rewardBonus(entries.map(s=>({masterId:store.info.ships[s.id].api_ship_id,
    equipment:s.slots.concat(s.ex).filter(id=>id>0).map(id=>({
      masterId:store.info.equips[id]?.api_slotitem_id,stars:store.info.equips[id]?.api_level||0}))})));
const bonus=(store,entries)=>bonusDetails(store,entries).totalRate;
const ordinaryCraft=new Set([68,193]);
// Reserve combat landing craft for sorties; manual outfits still count fully.
const isAutomaticCargo=(store,id)=>ordinaryCraft.has(store.info.equips[id]?.api_slotitem_id);
// Game equipment must be contiguous. A manually retained empty ordinary slot
// also prevents automatic equipment in subsequent ordinary slots.
function automaticSlotLimit(ship,held){
  const lock=held.get(ship.id),at=ship.slots.findIndex((_,k)=>lock?.keep?.[k]&&!(lock.slots?.[k]>0));
  return at<0?ship.slots.length:at;
}
function cargoUse(store,entries,inventory){
  const selected=new Set(entries.map(s=>s.id)),owners=inventory instanceof Map?inventory:new Map(inventory.map(i=>[i.id,i.sourceShipId]));
  let count=0,combat=0,borrowed=0,special=0;
  for(const id of entries.flatMap(s=>s.slots.concat(s.ex)).filter(id=>isCargo(store,id))){
    const master=store.info.equips[id].api_slotitem_id;count++;
    combat+=Number(!ordinaryCraft.has(master));special+=Number(master===193);
    borrowed+=Number(!!owners.get(id)&&!selected.has(owners.get(id)));
  }
  return {count,combat,borrowed,special};
}
// Actual rewards remain unchanged. Only recommendation ranking stops valuing
// extra synergy/improvement beyond the player's 20% target.
function planningNet(income,missionId,greatChance=0){
  if(!income)return undefined;
  if(income.bonus<=.2+1e-10)return income.rows.reduce((n,r)=>n+r.net+(r.greatNet-r.net)*greatChance,0);
  return rewards[missionId].resources.reduce((n,v)=>n+Math.floor(v*6/5)*(1-greatChance)+Math.floor(v*9/5)*greatChance,0)-
    income.cost.fuelCost-income.cost.ammoCost;
}
function fits(store,item,shipId,k){
  return snapshotMemo(store,'expedition-fit',`${shipId}:${item.id}:${k}:${item.sourceShipId||0}`,()=>{
    try{return canEquip(store,shipId,item.id,k)&&(!item.sourceShipId||item.sourceShipId===shipId||acceptsOtherSlot(store,shipId,item.id,k));}
    catch(_){return false;}
  });
}
const resourceTotal=missionId=>(rewards[missionId]?.resources||[]).reduce((n,v)=>n+(Number(v)||0),0);

// Success-only dispatches may improve probability with spare slots, after
// required stats and reward gear have been fitted. Commit only a complete tier.
function optionalDrumScheme(store,scheme,inventory,held,spec){
  const entries=scheme.ships.map(s=>({...s,slots:s.slots.slice()})),selected=new Set(entries.map(s=>s.id));
  const isDrum=id=>store.info.equips[id]?.api_slotitem_id===75;
  const used=new Set(entries.flatMap(s=>s.slots.concat(s.ex)).filter(id=>id>0));
  const drums=inventory.filter(item=>isDrum(item.id)&&!used.has(item.id)).sort((a,b)=>
    Number(!selected.has(a.sourceShipId))-Number(!selected.has(b.sourceShipId))||
    Number(!!a.sourceShipId)-Number(!!b.sourceShipId)||a.id-b.id);
  const target=Math.max(spec.drums||0,spec.gs.max||0),carriers=spec.gs.carriers??Math.max(1,spec.drumCarriers||0);
  const counts=()=>entries.map(s=>s.slots.concat(s.ex).filter(isDrum).length);
  let values=counts();
  while(values.reduce((n,v)=>n+v,0)<target||values.filter(v=>v>0).length<carriers){
    const needCarrier=values.filter(v=>v>0).length<carriers;let placed=false;
    for(const [i,s] of entries.entries()){
      if(needCarrier&&values[i])continue;
      for(let k=0;k<automaticSlotLimit(s,held);k++){
        const previous=s.slots[k];
        if(held.get(s.id)?.keep?.[k]||previous>0&&(spec.totals||isCargo(store,previous)||isDrum(previous)))continue;
        const item=drums.find(item=>!used.has(item.id)&&fits(store,item,s.id,k));
        if(!item)continue;
        used.delete(previous);s.slots[k]=item.id;used.add(item.id);placed=true;break;
      }
      if(placed)break;
    }
    if(!placed)return null;
    values=counts();
  }
  return {fleet:scheme.fleet,ships:entries};
}

// Work on the private draft. Drums, manually chosen slots and the existing
// stat loadout of monthly expeditions take precedence over reward equipment.
function fitIncomeEquipment(store,entries,inventory,held,spec,missionId){
  if(!resourceTotal(missionId))return;
  const used=new Set(entries.flatMap(s=>s.slots.concat(s.ex)).filter(id=>id>0));
  const selected=new Set(entries.map(s=>s.id));
  const groups=new Map();
  const cargo=inventory.filter(item=>isAutomaticCargo(store,item.id)).sort((a,b)=>
    Number(!selected.has(a.sourceShipId))-Number(!selected.has(b.sourceShipId))||
    Number(!!a.sourceShipId)-Number(!!b.sourceShipId)||a.id-b.id);
  for(const item of cargo){
    const instance=store.info.equips[item.id],key=`${instance.api_slotitem_id}:${instance.api_level||0}`;
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);
  }
  const positions=[];
  entries.forEach(s=>{
    for(const k of [...s.slots.keys(),...(store.info.ships[s.id].api_slot_ex!==0?['ex']:[])]){
      const get=()=>k==='ex'?s.ex:s.slots[k],set=id=>{if(k==='ex')s.ex=id;else s.slots[k]=id;};
      if(k!=='ex'&&k>=automaticSlotLimit(s,held)||held.get(s.id)?.keep?.[k]||store.info.equips[get()]?.api_slotitem_id===75||spec.totals&&get()>0)continue;
      const choices=[...groups.values()].map(items=>items.filter(item=>fits(store,item,s.id,k))).filter(items=>items.length);
      if(choices.length)positions.push({get,set,choices});
    }
  });
  // Scarce compatible positions first; duplicate instances share one effect
  // group, but physical inventory is allocated afresh after every move.
  positions.sort((a,b)=>a.choices.length-b.choices.length);
  const owners=new Map(inventory.map(i=>[i.id,i.sourceShipId]));
  const quality=()=>{const details=bonusDetails(store,entries);return {...details,targetRate:Math.min(.2,details.totalRate),...cargoUse(store,entries,owners)};};
  const compare=(a,b)=>Math.abs(a.targetRate-b.targetRate)>1e-10?a.targetRate-b.targetRate:
    b.count-a.count||b.combat-a.combat||b.borrowed-a.borrowed||b.special-a.special||
    (Math.abs(a.totalRate-b.totalRate)>1e-10?a.totalRate-b.totalRate:0);
  let current=quality();
  // Use normal Daihatsu first; special craft only fill a remaining shortfall.
  for(const normalOnly of [true,false])for(let pass=0;pass<positions.length*3;pass++){
    let best=null,bestValue=current;
    for(const position of positions){
      const old=position.get(),oldCargo=isCargo(store,old);
      const choices=position.choices.map(items=>items.find(item=>!used.has(item.id)&&
        (!normalOnly||store.info.equips[item.id].api_slotitem_id===68))).filter(Boolean);
      for(const item of [...choices,...(oldCargo?[{id:-1}]:[])]){
        position.set(item.id);const value=quality();position.set(old);
        if(compare(value,bestValue)>0){
          best={position,old,id:item.id};bestValue=value;
        }
      }
    }
    if(!best)break;
    used.delete(best.old);if(best.id>0)used.add(best.id);
    best.position.set(best.id);current=bestValue;
  }
}

// A cheap additional candidate stream admits reward-capable hulls before the
// exact shortlist fitting. It never replaces the ordinary low-cost stream.
function incomeSearch(store,pool,inventory,spec,missionId,heldSlots=[]){
  const cargo=inventory.filter(i=>isAutomaticCargo(store,i.id)),held=new Map(heldSlots.filter(Boolean).map(s=>[s.id,s]));
  const capacity=new Map(pool.map(row=>{
    const ship=row.ship,count=Number(row.master?.api_slot_num??store.const.$ships[ship.api_ship_id]?.api_slot_num??ship.api_slot.length);
    const lock=held.get(row.id);let slots=0;
    for(let k=0;k<count;k++)if(!lock?.keep?.[k]&&!(spec.totals&&ship.api_slot[k]>0)&&cargo.some(item=>fits(store,item,row.id,k)))slots++;
    if(ship.api_slot_ex!==0&&!lock?.keep?.ex&&!(spec.totals&&ship.api_slot_ex>0)&&cargo.some(item=>fits(store,item,row.id,'ex')))slots++;
    return [row.id,slots];
  }));
  const maxRate=Math.max(0,...cargo.map(i=>equipmentRewardRate(store.info.equips[i.id].api_slotitem_id)));
  const summary=rows=>({slots:rows.reduce((n,r)=>n+capacity.get(r.id),0),kinu:rows.filter(r=>Number(r.ship.api_ship_id)===487).length});
  const fromSummary=({slots,kinu})=>Math.min(.2,Math.min(cargo.length,slots)*maxRate+kinu*.05);
  const potential=rows=>fromSummary(summary(rows));
  const withRow=(value,row)=>fromSummary({slots:value.slots+capacity.get(row.id),kinu:value.kinu+Number(Number(row.ship.api_ship_id)===487)});
  return {active:resourceTotal(missionId)>0&&(cargo.length>0||pool.some(r=>Number(r.ship.api_ship_id)===487)),
    potential,summary,value:fromSummary,withRow,capacity,resources:resourceTotal(missionId)};
}
module.exports={isCargo,isAutomaticCargo,bonus,cargoUse,planningNet,fits,fitIncomeEquipment,incomeSearch,automaticSlotLimit,optionalDrumScheme};
