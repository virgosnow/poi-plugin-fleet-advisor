'use strict';

// Sort only unheld slots. Count, readiness and instance identity travel with
// the aircraft, while the slot number and lock belong to the destination.
const fighters=new Set([6,45,48,56]);
const attackers=new Set([7,8,11,25,26,47,53,57,58,91]);
const scouts=new Set([9,10,41,49,59,94]);
function createBaseSorter(store,lockedSlots=[]){
  const observed=store?.info?.airbase||[],items=store?.info?.equips||{},masters=store?.const?.$equips||{};
  const owners=new Map();
  for(const base of observed)for(const slot of base.api_plane_info||[])if(Number(slot.api_slotid)>0)
    owners.set(Number(slot.api_slotid),{areaId:Number(base.api_area_id),rid:Number(base.api_rid),slotId:Number(slot.api_squadron_id)});
  const keys=new Map();
  const key=slot=>{
    const id=Number(slot.itemId)||0,item=items[id],master=masters[item?.api_slotitem_id],type=Number(master?.api_type?.[2]);
    if(keys.has(id))return keys.get(id);
    const category=!id?4:attackers.has(type)?0:fighters.has(type)?1:scouts.has(type)?2:3;
    const value=[category,Number(master?.api_sortno)||Number(item?.api_slotitem_id)||0,
      -(Number(item?.api_level)||0),-(Number(item?.api_alv)||0),id];keys.set(id,value);return value;
  };
  const compare=(a,b)=>{const x=key(a),y=key(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]-y[i];return 0;};
  return bases=>{
  if(!Array.isArray(bases))return bases;
  let changed=false;
  const result=bases.map(base=>{
    if(!Array.isArray(base?.slots)||base.slots.length!==4||base.slots.some(slot=>!slot||typeof slot!=='object'||slot.itemId==null))return base;
    const held=new Set(lockedSlots.filter(s=>Number(s.rid)===Number(base.rid)).map(s=>Number(s.slotId)));
    const pinned=slot=>{
      const item=items[slot.itemId],master=masters[item?.api_slotitem_id];
      return !!slot.locked||held.has(Number(slot.slotId))||Number(slot.itemId)>0&&(!master||!Array.isArray(master.api_type));
    };
    const free=base.slots.filter(slot=>!pinned(slot));
    const sorted=free.slice().sort(compare);if(free.every((slot,i)=>slot===sorted[i]))return base;
    let next=0;
    const slots=base.slots.map(destination=>{
      if(pinned(destination))return destination;
      const plane=sorted[next++],id=Number(plane.itemId)||0,owner=owners.get(id);
      const slot={...plane,slotId:destination.slotId,locked:!!destination.locked};
      if(owner&&owner.areaId===Number(base.areaId)&&owner.rid===Number(base.rid)){
        if(owner.slotId===Number(destination.slotId)){slot.planned=false;delete slot.withinBase;}
        else {slot.planned=true;slot.withinBase=true;}
      }else if(owner&&owner.areaId===Number(base.areaId)&&owner.rid!==Number(base.rid)){
        slot.planned=true;slot.withinBase=true;
      }else if(!id){
        const live=observed.find(row=>Number(row.api_area_id)===Number(base.areaId)&&Number(row.api_rid)===Number(base.rid))
          ?.api_plane_info?.find(row=>Number(row.api_squadron_id)===Number(destination.slotId));
        slot.planned=Number(live?.api_slotid)>0;delete slot.withinBase;
      }
      return slot;
    });
    changed=true;return {...base,slots};
  });
  return changed?result:bases;
  };
}
function sortBases(store,bases,lockedSlots=[]){return createBaseSorter(store,lockedSlots)(bases);}
module.exports={sortBases,createBaseSorter};
