'use strict';
const fallback=require('../../../data/equipment_rules.json');
const {calculationTable,calculationContext}=require('../../shared/calculation_cache');
const tables=state=>state.selectorTables||fallback;
const specialType=(master,rules)=>rules.equipTypeSpOverrides[master.api_id]??Number(master.api_type[2]);
const pickerType=(master,rules)=>rules.pickerTypeOverrides[master.api_id]??specialType(master,rules);
function filterType(master,rules) {
  const [type,icon]=master.api_type.slice(2,4);
  return rules.filterTypeSplits.find(s=>s.types.includes(type)&&s.icon===icon)?.result??specialType(master,rules);
}
function categoryTypes(category,rules) {
  const def=rules.equipFilterCategories.find(c=>c.id===category);
  if(!def)throw new Error('Unknown equipment category: '+category);
  return def.details.flatMap(d=>rules.filteringDetailCategories[d]||[]);
}
function acceptsCategory(master,category,rules) {return category===0||categoryTypes(category,rules).includes(filterType(master,rules));}
function canEquip(state,sid,iid,slot) {
  const scope=calculationContext('equipmentEligibility',state,()=>({
    table:calculationTable('equipmentEligibility',[state.const,tables(state)],65536),ships:new Map(),items:new Map(),instances:new Map()}));
  const ship=state.info.ships[sid],item=state.info.equips[iid];
  if(!scope||!ship||!item)return canEquipUncached(state,sid,iid,slot);
  let slots=scope.instances.get(sid);if(!slots){slots=new Map();scope.instances.set(sid,slots);}
  let items=slots.get(slot);if(!items){items=new Map();slots.set(slot,items);}
  if(items.has(iid))return items.get(iid);
  // Eligibility depends on masters, improvement, slot position and whether
  // expansion is open, not instance IDs, ownership, map, fatigue or repairs.
  if(!scope.ships.has(sid))scope.ships.set(sid,JSON.stringify([ship.api_ship_id,ship.api_slot_ex===0]));
  if(!scope.items.has(iid))scope.items.set(iid,JSON.stringify([item.api_slotitem_id,item.api_level||0]));
  const key=scope.ships.get(sid)+':'+scope.items.get(iid)+':'+typeof slot+':'+slot;
  const result=scope.table.memo(key,()=>canEquipUncached(state,sid,iid,slot));
  items.set(iid,result);return result;
}
function canEquipUncached(state,sid,iid,slot) {
  const ship=state.info.ships[sid],sm=ship&&state.const.$ships[ship.api_ship_id],item=state.info.equips[iid];
  const raw=item&&state.const.$equips[item.api_slotitem_id];
  if(!sm||!raw||!Array.isArray(raw.api_type))throw new Error('Equipment eligibility data missing');
  const master={...raw,api_id:item.api_slotitem_id},rules=tables(state),type=pickerType(master,rules);
  const override=state.const.$equipShip?.[ship.api_ship_id];
  const permissions=override?override.api_equip_type:state.const.$shipTypes?.[sm.api_stype]?.api_equip_type;
  if(!permissions||typeof permissions!=='object')throw new Error('Ship equipment permissions missing');
  const permitted=Object.hasOwn(permissions,type)&&(override?permissions[type]===null||Array.isArray(permissions[type]):Number(permissions[type])===1);
  if(!permitted)return false;
  if(slot==='ex') {
    if(ship.api_slot_ex===0)return false;
    if(!Array.isArray(state.const.$exslotEquips)||!state.const.$exslotEquipShips||!state.const.$exslotEquipLimits)
      throw new Error('Expansion slot eligibility data missing');
    const limits=state.const.$exslotEquipLimits[ship.api_ship_id]||[];
    if(state.const.$exslotEquips.includes(type)&&!limits.includes(type))return true;
    const rule=state.const.$exslotEquipShips[item.api_slotitem_id];
    if(!rule||Number(item.api_level||0)<Number(rule.api_req_level||0))return false;
    const listed=(map,key)=>map!=null&&Object.hasOwn(map,key);
    return listed(rule.api_ship_ids,ship.api_ship_id)||listed(rule.api_ctypes,sm.api_ctype)||listed(rule.api_stypes,sm.api_stype)||listed(rule.api_stypes,99);
  }
  if(override&&Array.isArray(permissions[type])&&!permissions[type].includes(item.api_slotitem_id))return false;
  return !rules.slotExclusions.some(r=>r.shipMstIds.includes(ship.api_ship_id)&&
    (r.fromSlot?slot>=r.slot:slot===r.slot)&&(r.allowOnly?!r.allowOnly.includes(type):r.exclude.includes(type)));
}
// The other-ship list additionally applies exclusions to raw api_type[2].
function acceptsOtherSlot(state,sid,iid,slot) {
  if(slot==='ex')return true;
  const ship=state.info.ships[sid],item=state.info.equips[iid],type=Number(state.const.$equips[item.api_slotitem_id].api_type[2]);
  return !tables(state).slotExclusions.some(r=>r.shipMstIds.includes(ship.api_ship_id)&&
    (r.fromSlot?slot>=r.slot:slot===r.slot)&&(r.allowOnly?!r.allowOnly.includes(type):r.exclude.includes(type)));
}
module.exports={tables,specialType,pickerType,filterType,categoryTypes,acceptsCategory,canEquip,acceptsOtherSlot};
