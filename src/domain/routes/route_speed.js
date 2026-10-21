'use strict';
const {canEquip,acceptsOtherSlot}=require('../fleet/equipment_rules');
const {speed}=require('../fleet/fleet_metrics');
const ranks={slow:5,fast:10,fastPlus:15,fastest:20};
// Bounded equipment-only search using the existing speed calculator. No game
// state changes, duplicated instances, or replacement of manually held slots.
function speedLoadout(store,scheme,inventory,wanted,heldSlots=[]){
  const holds=new Map(heldSlots.filter(Boolean).map(s=>[s.id,s]));
  const entries=scheme.ships.map(e=>{const ship=store.info.ships[e.id],master=store.const.$ships[ship.api_ship_id];
    return {...e,slots:(e.slots||ship.api_slot.slice(0,master.api_slot_num)).slice(),ex:(e.ex??ship.api_slot_ex)>0?(e.ex??ship.api_slot_ex):-1};});
  const used=new Set(entries.flatMap(e=>e.slots.concat(e.ex)).filter(id=>id>0));
  const propulsion=id=>[33,34,87].includes(store.info.equips[id]?.api_slotitem_id);
  let changed=false;
  for(const entry of entries){
    const ship=store.info.ships[entry.id],master=store.const.$ships[ship.api_ship_id];
    const reading=state=>speed(store,[{id:entry.id,ship,master,
      before:{slots:ship.api_slot,ex:ship.api_slot_ex},after:state}]).fleetSpeed;
    if(ranks[reading(entry)]>=ranks[wanted])continue;
    const positions=entry.slots.map((id,k)=>({id,k})).concat(ship.api_slot_ex!==0?[{id:entry.ex,k:'ex'}]:[])
      .filter(p=>!holds.get(entry.id)?.keep?.[p.k]);
    const options=inventory.filter(i=>propulsion(i.id)&&!used.has(i.id));
    // Equivalent engine instances need not multiply the combination search.
    const groups=new Map();for(const item of options){const raw=store.info.equips[item.id];
      const key=raw.api_slotitem_id+':'+(Number(raw.api_level)>=7);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);}
    let best=null,attempts=0;
    const visit=(state,index,chosen,cost)=>{
      if(++attempts>6000||best&&cost>=best.cost)return;
      if(ranks[reading(state)]>=ranks[wanted]){best={state,cost};return;}
      if(chosen.size>=4)return;
      for(let j=index;j<positions.length;j++){
        const p=positions[j];
        const old=store.const.$equips[store.info.equips[p.id]?.api_slotitem_id];
        const loss=p.k==='ex'?0:p.id<=0?1:[12,13,24,27,35,93].includes(Number(old?.api_type?.[2]))?3:10;
        for(const items of groups.values()){
          const item=items.find(i=>!chosen.has(i.id)&&canEquip(store,entry.id,i.id,p.k)&&
            (!i.sourceShipId||i.sourceShipId===entry.id||acceptsOtherSlot(store,entry.id,i.id,p.k)));
          if(!item)continue;
          const next={...state,slots:state.slots.slice()};if(p.k==='ex')next.ex=item.id;else next.slots[p.k]=item.id;
          visit(next,j+1,new Set([...chosen,item.id]),cost+100+loss);
        }
      }
    };
    visit(entry,0,new Set(),0);
    if(!best)return null;
    Object.assign(entry,best.state);entry.slots.concat(entry.ex).filter(id=>id>0).forEach(id=>used.add(id));changed=true;
  }
  return changed?{fleet:scheme.fleet,ships:entries}:null;
}
module.exports={speedLoadout};
