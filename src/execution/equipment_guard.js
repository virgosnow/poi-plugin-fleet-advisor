'use strict';

// Each boundary reads poi once. Never retain live indexes or assume that poi
// replaces objects: equipment arrays and improvement values may mutate in place.
function createEquipmentGuard(getStore) {
  const initial=getStore(),fleet=JSON.stringify(initial.info.fleets);
  const inventory=new Map(Object.entries(initial.info.equips).map(([id,e])=>[id,[e.api_slotitem_id,e.api_level||0,e.api_alv||0]]));
  function state(store,id) {
    const ship=store.info.ships[id];
    if(!ship)throw new Error('Equipment changed outside this run');
    const master=store.const.$ships[ship.api_ship_id]||{};
    const count=Number(master.api_slot_num??ship.api_slotnum??ship.api_slot?.length);
    if(!Number.isInteger(count)||count<0||count>5||!Array.isArray(ship.api_slot)||ship.api_slot.length<count||
      !Number.isInteger(ship.api_slot_ex)||ship.api_slot_ex < -1||ship.api_slot.slice(0,count).some(id=>!Number.isInteger(id)||id===0||id < -1))
      throw new Error('Equipment changed outside this run');
    return {slots:ship.api_slot.slice(0,count),ex:ship.api_slot_ex};
  }
  const expected=new Map(Object.keys(initial.info.ships).map(id=>[Number(id),state(initial,id)]));
  return {expected,validate(changing){
    const store=getStore(),info=store.info,ids=Object.keys(info.equips);
    if(ids.length!==inventory.size||ids.some(id=>{
      const before=inventory.get(id),e=info.equips[id];
      return !before||!e||e.api_slotitem_id!==before[0]||(e.api_level||0)!==before[1]||(e.api_alv||0)!==before[2];
    }))throw new Error('Equipment inventory or improvement changed during run');
    if(JSON.stringify(info.fleets)!==fleet)throw new Error('Fleet changed during equipment run');
    if(Object.keys(info.ships).length!==expected.size)throw new Error('Roster changed during equipment run');
    for(const [id,before] of expected)if(!changing.has(id)){
      const after=state(store,id);
      if(after.ex!==before.ex||after.slots.length!==before.slots.length||after.slots.some((item,j)=>item!==before.slots[j]))throw new Error('Equipment changed outside this run');
    }
  }};
}
module.exports={createEquipmentGuard};
