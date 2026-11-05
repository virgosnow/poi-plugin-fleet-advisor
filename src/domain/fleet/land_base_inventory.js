'use strict';

// Canonicalize every known base, not only the selected area. A missing or
// duplicate slot makes it impossible to prove that a stock plane is free.
function baseInventory(info){
  if(!Array.isArray(info?.airbase))return null;
  const seen=new Set(),rows=[];
  for(const base of info.airbase){
    const area=base?.api_area_id,rid=base?.api_rid,key=area+':'+rid,slots=base?.api_plane_info;
    if(!Number.isSafeInteger(area)||area<1||!Number.isSafeInteger(rid)||rid<1||seen.has(key)||!Array.isArray(slots)||slots.length!==4)return null;
    seen.add(key);const ids=new Set(),planes=[];
    for(const slot of slots){
      const n=slot?.api_squadron_id,id=slot?.api_slotid,state=slot?.api_state;
      if(!Number.isInteger(n)||n<1||n>4||ids.has(n)||!Number.isSafeInteger(id)||id<0||!Number.isInteger(state))return null;
      ids.add(n);planes.push({slot:n,item:id,state});
    }
    rows.push({area,base:rid,slots:planes.sort((a,b)=>a.slot-b.slot)});
  }
  return rows.sort((a,b)=>a.area-b.area||a.base-b.base);
}
module.exports={baseInventory};
