'use strict';
const {error}=require('../../shared/errors');

// Inventory is snapshot-local. The same fleet can be fitted many times, so
// retain array identity for downstream equipment pools without growing forever.
const scopes=new WeakMap(),ids=new WeakMap();
function equipmentForFleet(inventory,ships,settings){
  if(settings?.allowEquipmentBorrowing!==false)return inventory;
  const owners=new Set(ships.map(ship=>Number(ship.id??ship)));
  const key=[...owners].sort((a,b)=>a-b).join(',');
  let cache=scopes.get(inventory);
  if(!cache){cache=new Map();scopes.set(inventory,cache);}
  if(cache.has(key))return cache.get(key);
  const allowed=inventory.filter(item=>!item.sourceShipId||owners.has(item.sourceShipId));
  if(cache.size>=128)cache.delete(cache.keys().next().value);
  cache.set(key,allowed);return allowed;
}
function allowedIds(inventory){
  if(!ids.has(inventory))ids.set(inventory,new Set(inventory.map(item=>item.id)));
  return ids.get(inventory);
}
const conflict=()=>error('INVALID_QUERY','已选择“不借用”，手动保留的装备来自本次编成之外的舰娘；请取消保留该装备，或允许借用。当前草稿已保留');
function prepareFleetEquipment(scheme,inventory,settings,heldSlots=[]){
  if(settings?.allowEquipmentBorrowing!==false)return scheme;
  const allowed=allowedIds(inventory),held=new Map(heldSlots.filter(Boolean).map(ship=>[ship.id,ship]));
  return {...scheme,ships:scheme.ships.map(ship=>{
    const keep=(id,slot)=>{
      if(!(id>0)||allowed.has(id))return id;
      if(held.get(ship.id)?.keep?.[slot])throw conflict();
      // Hull upgrades can inherit the removed ship's weapons. Refit those
      // slots from the new fleet's stock rather than rejecting the better hull.
      return -1;
    };
    return {...ship,slots:ship.slots.map(keep),ex:keep(ship.ex,'ex')};
  })};
}
function assertFleetEquipment(scheme,inventory,settings){
  if(settings?.allowEquipmentBorrowing!==false)return;
  const allowed=allowedIds(inventory);
  if(scheme.ships.some(ship=>[...(ship.slots||[]),ship.ex].some(id=>id>0&&!allowed.has(id))))throw conflict();
}
module.exports={equipmentForFleet,prepareFleetEquipment,assertFleetEquipment};
