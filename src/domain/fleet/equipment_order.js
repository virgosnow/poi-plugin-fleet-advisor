'use strict';
const R=require('./equipment_rules');
const {snapshotMemo}=require('./equipment_planner');
const indexes=new WeakMap();
const strikeTypes=new Set([7,8,11,57,58]);
const capacityTypes=new Set([6,7,8,11,45,56,57,58]);
function equipmentOwners(store){
  return snapshotMemo(store,'equipmentOrderingOwners',0,()=>{
    const owners=new Map();
    for(const [sid,ship]of Object.entries(store.info.ships))for(const id of (ship.api_slot||[]).concat(ship.api_slot_ex))
      if(id>0)owners.set(id,Number(sid));
    return owners;
  });
}
// Compare positions using the SAME instances. Only accept capacity gains;
// no other aircraft may lose capacity. Reconnaissance/unknown aircraft and
// carrier first-slot strike proficiency retain their original positions.
function orderAircraftSlots(store,scheme,heldSlots=[]){
  const held=new Map(heldSlots.filter(Boolean).map(e=>[e.id,e.keep||{}]));
  const rules=R.tables(store);
  let aircraftTypes;
  let changed=false;
  const ships=scheme.ships.map(entry=>{
    if(!entry.slots)return entry;
    const ship=store.info.ships[entry.id],sm=store.const.$ships[ship.api_ship_id],locks=held.get(entry.id)||{};
    const master=id=>store.const.$equips[store.info.equips[id]?.api_slotitem_id];
    const type=id=>Number(master(id)?.api_type?.[2]);
    if(!entry.slots.some(id=>capacityTypes.has(type(id))))return entry;
    const capacity=k=>Number(sm.api_maxeq?.[k]??ship.api_onslot?.[k]);
    const carrier=[7,11,18].includes(Number(sm.api_stype));
    const aircraft=id=>{
      if(!master(id))return false;
      aircraftTypes||=snapshotMemo(store,'aircraftOrderingTypes',rules,()=>new Set([1,2,3,12].flatMap(c=>R.categoryTypes(c,rules))));
      return aircraftTypes.has(R.filterType(master(id),rules));
    };
    const movable=entry.slots.map((id,k)=>({id,k})).filter(p=>!locks[p.k]&&
      !(carrier&&p.k===0&&strikeTypes.has(type(p.id)))&&
      !(aircraft(p.id)&&!capacityTypes.has(type(p.id))));
    const planes=movable.filter(p=>capacityTypes.has(type(p.id))&&Number.isFinite(capacity(p.k)))
      .sort((a,b)=>Number(!strikeTypes.has(type(a.id)))-Number(!strikeTypes.has(type(b.id)))||
        capacity(b.k)-capacity(a.k)||a.k-b.k);
    if(!planes.length||!planes.some(p=>movable.some(q=>!capacityTypes.has(type(q.id))&&capacity(q.k)>capacity(p.k))))return entry;
    const key=JSON.stringify([entry.id,entry.slots,entry.ex,locks]);
    const ordered=snapshotMemo(store,'aircraftSlotOrder',key,()=>{
      const owners=equipmentOwners(store),positions=movable.map(p=>p.k),slots=entry.slots.slice();
      const legal=(p,k)=>{
        if(p.id<=0)return true;
        if(capacityTypes.has(type(p.id))&&(!Number.isFinite(capacity(k))||capacity(k)<=0||capacity(k)<capacity(p.k)))return false;
        if(k===p.k)return true;
        try{return R.canEquip(store,entry.id,p.id,k)&&
          (!owners.has(p.id)||owners.get(p.id)===entry.id||R.acceptsOtherSlot(store,entry.id,p.id,k));}catch(_){return false;}
      };
      let best=entry.slots,bestCaps=planes.map(p=>capacity(p.k)),bestMoves=0;
      const assign=(i,used)=>{
        if(i===positions.length){
          if(slots.some((id,k)=>id<=0&&!locks[k]&&slots.slice(k+1).some(id=>id>0)))return;
          const caps=planes.map(p=>capacity(slots.indexOf(p.id))),moves=slots.filter((id,k)=>id!==entry.slots[k]).length;
          const first=caps.findIndex((n,k)=>n!==bestCaps[k]);
          if(first>=0?caps[first]>bestCaps[first]:moves<bestMoves){best=slots.slice();bestCaps=caps;bestMoves=moves;}
          return;
        }
        const k=positions[i];
        for(let j=0;j<movable.length;j++)if(!(used&(1<<j))&&legal(movable[j],k)){
          slots[k]=movable[j].id;assign(i+1,used|(1<<j));
        }
      };
      assign(0,0);return best.slice();
    });
    if(ordered.every((id,k)=>id===entry.slots[k]))return entry;
    changed=true;return {...entry,slots:ordered.slice()};
  });
  return changed?{...scheme,ships}:scheme;
}
function categoryIndex(store){
  const rules=R.tables(store);if(indexes.has(rules))return indexes.get(rules);
  const index=new Map();let rank=0;
  for(const category of rules.equipFilterCategories.filter(c=>c.id!==0))for(const detail of category.details){
    for(const type of rules.filteringDetailCategories[detail]||[])index.set(type,rank);
    rank++;
  }
  indexes.set(rules,index);return index;
}
// Reconnaissance needs a positive slot, but does not benefit from its size.
// Fixed firepower equipment can use zero-plane slots. Only move utility down
// into smaller slots (later slots on a capacity tie): the displaced aircraft
// gains or retains capacity, never weakening fighter cover or strike capacity.
function orderCarrierUtility(store,scheme,heldSlots=[]){
  const held=new Map(heldSlots.filter(Boolean).map(e=>[e.id,e.keep||{}]));
  let changed=false;
  const ships=scheme.ships.map(entry=>{
    const ship=store.info.ships[entry.id],master=store.const.$ships[ship.api_ship_id],stype=Number(master.api_stype);
    if(![7,10,11,18].includes(stype)||!entry.slots)return entry;
    const type=id=>Number(store.const.$equips[store.info.equips[id]?.api_slotitem_id]?.api_type?.[2]);
    // A carrier gun is a firepower stat stick; a battleship's main battery
    // remains primary armament and follows ordinary category ordering.
    const rank=id=>type(id)===35||stype!==10&&[1,2,3,4].includes(type(id))?0:type(id)===9?1:2;
    if(!entry.slots.some(id=>rank(id)<2))return entry;
    const slots=entry.slots.slice(),locks={...(held.get(entry.id)||{})};
    // The utility pass runs before aircraft ordering. Protect the same
    // carrier leader here so a scout/crew swap cannot bypass that safeguard.
    if(stype!==10&&strikeTypes.has(type(slots[0])))locks[0]=true;
    const capacity=k=>Number(ship.api_onslot?.[k]??master.api_maxeq?.[k]??0);
    const legal=(id,k)=>{
      if(id<=0)return true;
      if([6,7,8,9,11,45,56,57,58].includes(type(id))&&capacity(k)<=0)return false;
      try{return R.canEquip(store,entry.id,id,k)&&R.acceptsOtherSlot(store,entry.id,id,k);}catch(_){return false;}
    };
    let moved=false;
    for(const to of slots.map((_,k)=>k).sort((a,b)=>capacity(a)-capacity(b)||b-a)){
      if(locks[to]||rank(slots[to])===0||stype===10&&[1,2,3,4].includes(type(slots[to])))continue;
      const from=slots.map((id,k)=>({id,k})).filter(p=>!locks[p.k]&&
        (capacity(p.k)>capacity(to)||capacity(p.k)===capacity(to)&&p.k<to)&&
        rank(p.id)<rank(slots[to])&&legal(p.id,to)&&legal(slots[to],p.k)&&
        // Swapping with an empty slot must not introduce a compacted gap.
        !(slots[to]<=0&&slots.some((id,k)=>k>p.k&&k!==to&&id>0)))
        .sort((a,b)=>rank(a.id)-rank(b.id)||capacity(b.k)-capacity(a.k)||a.k-b.k)[0]?.k;
      if(from===undefined)continue;
      [slots[from],slots[to]]=[slots[to],slots[from]];moved=true;
    }
    if(!moved)return entry;
    changed=true;return {...entry,slots};
  });
  return changed?{...scheme,ships}:scheme;
}
// First improve aircraft capacity, then category-sort the remaining equipment.
// Carrier utility retains its own ordering, never category sorting.
// Expansion and manually held slots (including empty slots) never participate.
function orderEquipment(store,scheme,heldSlots=[]){
  scheme=orderAircraftSlots(store,orderCarrierUtility(store,scheme,heldSlots),heldSlots);
  const held=new Map(heldSlots.filter(Boolean).map(e=>[e.id,e.keep||{}]));
  const rules=R.tables(store),index=categoryIndex(store),owners=equipmentOwners(store);
  let changed=false;
  const ships=scheme.ships.map(entry=>{
    if(!entry.slots)return entry;
    if([7,11,18].includes(Number(store.const.$ships[store.info.ships[entry.id].api_ship_id]?.api_stype)))return entry;
    const master=id=>store.const.$equips[store.info.equips[id]?.api_slotitem_id];
    const aircraft=m=>[1,2,3,12].some(category=>R.acceptsCategory(m,category,rules));
    const positions=entry.slots.map((id,k)=>({id,k})).filter(({id,k})=>!held.get(entry.id)?.[k]&&
      (id<=0||master(id)&&!aircraft(master(id))));
    const sorted=positions.map(({id,k})=>({id,k,rank:id<=0?Infinity:index.get(R.filterType(master(id),rules))??1e6}))
      .sort((a,b)=>a.rank-b.rank||a.k-b.k);
    if(sorted.every((e,i)=>e.id===positions[i].id))return entry;
    const legal=(item,k)=>{
      if(item.id<=0)return true;
      try{return R.canEquip(store,entry.id,item.id,k)&&(!owners.has(item.id)||owners.get(item.id)===entry.id||R.acceptsOtherSlot(store,entry.id,item.id,k));}catch(_){return false;}
    };
    // At most five ordinary slots today. Find the lexicographically first
    // legal category order, rather than moving a restricted item then undoing
    // arbitrary pairs. Memoization bounds this to n * 2^n assignment states.
    const failed=new Set();
    const assign=(i,mask)=>{
      if(i===positions.length)return [];
      if(failed.has(mask))return null;
      for(let j=0;j<sorted.length;j++)if(!(mask&(1<<j))&&legal(sorted[j],positions[i].k)){
        const rest=assign(i+1,mask|(1<<j));if(rest)return [sorted[j].id,...rest];
      }
      failed.add(mask);return null;
    };
    const ids=assign(0,0);if(!ids)return entry;
    const slots=entry.slots.slice();positions.forEach((p,i)=>{slots[p.k]=ids[i];});
    if(slots.every((id,k)=>id===entry.slots[k]))return entry;
    changed=true;return {...entry,slots};
  });
  return changed?{...scheme,ships}:scheme;
}
module.exports={orderEquipment,orderCarrierUtility,orderAircraftSlots};
