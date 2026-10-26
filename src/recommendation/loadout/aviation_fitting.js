'use strict';
const {canEquip,acceptsOtherSlot}=require('../../domain/fleet/equipment_rules');
const {completeCombatLoadout}=require('./loadout_policy');

// Three fleet-wide alternatives, not a Cartesian product per ship. The normal
// evaluator still owns route, LoS, air losses, inventory and final ranking.
function aviationBattleshipLoadouts(store,scheme,inventory,{profile,area,heldSlots=[]}={}){
  if(!scheme.ships.some(e=>Number(store.const.$ships[store.info.ships[e.id].api_ship_id]?.api_stype)===10))return [];
  const holds=new Map(heldSlots.filter(Boolean).map(e=>[e.id,e.keep||{}]));
  const master=id=>store.const.$equips[store.info.equips[id]?.api_slotitem_id];
  const type=id=>Number(master(id)?.api_type?.[2]);
  const result=[],seen=new Set();
  for(const mode of ['water','recon','dive']){
    const entries=scheme.ships.map(e=>({...e,slots:e.slots.slice()}));
    let used=new Set(entries.flatMap(e=>e.slots.concat(e.ex)).filter(id=>id>0));
    for(const entry of entries){
      const ship=store.info.ships[entry.id],sm=store.const.$ships[ship.api_ship_id];
      if(Number(sm.api_stype)!==10)continue;
      const original=entry.slots.slice(),lock=holds.get(entry.id)||{};
      const capacity=k=>Number(ship.api_onslot?.[k]??sm.api_maxeq?.[k]??0);
      for(let k=0;k<entry.slots.length;k++)if(!lock[k]&&[7,9,10,11].includes(type(entry.slots[k]))){
        used.delete(entry.slots[k]);entry.slots[k]=-1;
      }
      const place=(wanted,small=false)=>{
        if(entry.slots.some((id,k)=>wanted.includes(type(id))&&capacity(k)>0))return true;
        const positions=entry.slots.map((id,k)=>({id,k})).filter(p=>!lock[p.k]&&capacity(p.k)>0&&
          (p.id<=0||[9,10,11,12,13,21,24,27,35,39].includes(type(p.id)))&&
          !(wanted.includes(7)&&[10,11].includes(type(p.id))))
          .sort((a,b)=>small?capacity(a.k)-capacity(b.k):capacity(b.k)-capacity(a.k));
        const items=inventory.filter(i=>wanted.includes(Number(i.master.api_type[2]))).slice().sort((a,b)=>
          (small?Number(b.master.api_saku||0)-Number(a.master.api_saku||0):
            Number(b.master.api_baku||0)-Number(a.master.api_baku||0))||a.id-b.id);
        for(const p of positions){
          const item=items.find(i=>{
            if(used.has(i.id))return false;
            try{return canEquip(store,entry.id,i.id,p.k)&&(!i.sourceShipId||i.sourceShipId===entry.id||
              acceptsOtherSlot(store,entry.id,i.id,p.k));}catch(_){return false;}
          });
          if(!item)continue;
          used.delete(entry.slots[p.k]);entry.slots[p.k]=item.id;used.add(item.id);return true;
        }
        return false;
      };
      const fitted=mode==='dive'?place([7])&&(place([10],true)||place([11])):
        mode==='recon'?place([10],true):place([11]);
      if(!fitted){
        entry.slots=original;
        used=new Set(entries.flatMap(e=>e.slots.concat(e.ex)).filter(id=>id>0));
      }
    }
    const fitted=completeCombatLoadout(store,{...scheme,ships:entries},inventory,{area,profile,heldSlots});
    const key=JSON.stringify(fitted);
    if(!seen.has(key)){seen.add(key);result.push(fitted);}
  }
  return result;
}

module.exports={aviationBattleshipLoadouts};
