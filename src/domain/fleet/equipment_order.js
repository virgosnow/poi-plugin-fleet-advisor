'use strict';
const R=require('./equipment_rules');
const indexes=new WeakMap();
function categoryIndex(store){
  const rules=R.tables(store);if(indexes.has(rules))return indexes.get(rules);
  const index=new Map();let rank=0;
  for(const category of rules.equipFilterCategories.filter(c=>c.id!==0))for(const detail of category.details){
    for(const type of rules.filteringDetailCategories[detail]||[])index.set(type,rank);
    rank++;
  }
  indexes.set(rules,index);return index;
}
// Reorder automatic ordinary slots only. Aircraft retain their exact slots:
// capacity, first-slot attacks and aircraft-bonus allocation are meaningful.
// Expansion and manually held slots (including empty slots) never participate.
function orderEquipment(store,scheme,heldSlots=[]){
  const held=new Map(heldSlots.filter(Boolean).map(e=>[e.id,e.keep||{}]));
  const rules=R.tables(store),index=categoryIndex(store),owners=new Map();
  for(const [sid,ship] of Object.entries(store.info.ships))for(const id of (ship.api_slot||[]).concat(ship.api_slot_ex))if(id>0)owners.set(id,Number(sid));
  let changed=false;
  const ships=scheme.ships.map(entry=>{
    if(!entry.slots)return entry;
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
module.exports={orderEquipment};
