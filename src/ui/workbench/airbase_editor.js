'use strict';
// Editable planning data never mutates the observed game snapshot.
const {maps}=require('../../../data/sortie/land_base/maps.json');
const V=require('../models/presentation_model');
const {normalizeName}=require('../../shared/name_matching');

function observedDraft(store,area){
  const map=maps.find(row=>row.id===area&&row.available);if(!map)return null;
  return (store.info?.airbase||[]).filter(base=>Number(base.api_area_id)===map.baseAreaId)
    .slice().sort((a,b)=>Number(a.api_rid)-Number(b.api_rid)).map(base=>({
      areaId:Number(base.api_area_id),rid:Number(base.api_rid),mode:base.api_action_kind,
      range:base.api_distance,targets:['',''],
      slots:Array.from({length:4},(_,index)=>{
        const row=(base.api_plane_info||[]).find(plane=>Number(plane.api_squadron_id)===index+1);
        return {slotId:index+1,itemId:row?Number(row.api_slotid)||0:null,
          count:Number.isFinite(row?.api_count)?row.api_count:null,maxCount:Number.isFinite(row?.api_max_count)?row.api_max_count:null,
          state:row?.api_state??null,locked:false};
      })
    }));
}
// A new completion starts from the current game slots, not an earlier
// automatically generated proposal. Explicitly held slots and targets stay
// untouched so stale manual choices are reported rather than overwritten.
function rebaseDraft(store,area,bases){
  if(!Array.isArray(bases))return bases;
  const observed=observedDraft(store,area);if(!observed)return bases;
  return bases.map(base=>{
    const live=observed.find(row=>row.rid===base.rid&&row.areaId===base.areaId);
    if(!live||!Array.isArray(base.slots))return base;
    const slots=base.slots.map(slot=>slot.locked?slot:live.slots.find(row=>row.slotId===slot.slotId)||slot);
    return {...base,mode:base.modePlanned?base.mode:live.mode,
      range:slots.some(slot=>slot.locked&&slot.planned)?null:live.range,slots};
  });
}
function routeTargets(option,profile,route){
  if(!option)return [];
  const plans=require('../../domain/routes/route_plans'),ids=plans.orderedPathNodes(route?plans.fleetPaths(route,option):plans.optionPaths(option));
  const nodes=new Map((profile?.mapPreview?.nodes||[]).map(node=>[node.id,node]));
  return ids.map(id=>nodes.get(id)).filter(node=>node&&['battle','asw','aerialCombat','aerialRaid'].includes(node.kind))
    .map(node=>({id:node.id,label:`${node.id} 点${node.boss?' · Boss':''}`}));
}
// Keep player-locked targets visible for correction, but never present stale
// automatically assigned waves as part of a different fleet's route.
function constrainAutoTargets(bases,paths){
  if(!Array.isArray(bases)||!Array.isArray(paths))return bases;
  const allowed=new Set(paths.flat());let changed=false;
  const next=bases.map(base=>{
    if(base.targetsLocked||!Array.isArray(base.targets))return base;
    const targets=base.targets.map(node=>node&&!allowed.has(node)?'':node);
    if(targets.every((node,i)=>node===base.targets[i]))return base;
    changed=true;return {...base,targets};
  });
  return changed?next:bases;
}
const category=type=>[47,48,49,53,57,58,59,91,94].includes(type)?[12,'陆上机']:
  [6,45].includes(type)?[1,'舰上战斗机']:[7,8,56].includes(type)?[2,'舰爆／舰攻']:[3,'侦察机／水上机'];
function equipmentOptions(store,area,bases,scheme,rid,slotId,search=''){
  const planner=require('../../recommendation/land_base'),base=(bases||[]).find(row=>row.rid===rid);
  const current=base?.slots?.find(slot=>slot.slotId===slotId)?.itemId;
  const used=new Set((bases||[]).flatMap(row=>(row.slots||[]).filter(slot=>row.rid!==rid||slot.slotId!==slotId).map(slot=>slot.itemId)).filter(id=>id>0));
  const term=normalizeName(search).toLowerCase(),groups=new Map();
  const available=planner.inventory(store,{area,bases,scheme,baseRid:rid});
  const target=base?.slots?.find(slot=>slot.slotId===slotId),actualTarget=store.info?.airbase
    ?.find(row=>Number(row.api_area_id)===Number(base?.areaId)&&Number(row.api_rid)===rid)
    ?.api_plane_info?.find(row=>Number(row.api_squadron_id)===slotId);
  if(target?.itemId>0&&actualTarget?.api_slotid===target.itemId&&Number(actualTarget.api_state)===1){
    for(const other of bases||[]){
      if(other.rid===rid||other.areaId!==base.areaId)continue;
      const rows=planner.inventory(store,{area,bases,scheme,baseRid:other.rid});
      for(const row of rows){
        if(row.source!=='base')continue;
        const source=other.slots?.find(slot=>slot.slotId===row.slotId&&slot.itemId===row.itemId);
        if(source&&!source.locked)available.push({...row,source:'base-swap'});
      }
    }
  }
  for(const entry of available){
    if(used.has(entry.itemId)&&entry.source!=='base-swap')continue;
    const item=V.equipmentItem(store,entry.itemId,slotId-1);if(!item)continue;
    const type=Number(entry.master.api_type?.[2]),[categoryId,label]=category(type);
    const row={...item,categoryId,category:label,masterId:entry.masterId,stars:Number(entry.item.api_level||0),
      proficiency:Number(entry.item.api_alv||0),sortNo:Number(entry.master.api_sortno)||entry.masterId,source:entry.source};
    const key=[entry.masterId,row.stars,row.proficiency].join(':');
    if(!groups.has(key))groups.set(key,{...row,count:0});
    const group=groups.get(key);group.count++;
    if(entry.itemId===current)Object.assign(group,row);
  }
  return [...groups.values()].filter(row=>!term||normalizeName(`${row.name} ${row.category} ${row.id}`).toLowerCase().includes(term))
    .sort((a,b)=>a.categoryId-b.categoryId||a.sortNo-b.sortNo||b.stars-a.stars||b.proficiency-a.proficiency||a.id-b.id);
}
function replaceSlot(store,bases,rid,slotId,itemId){
  const planner=require('../../recommendation/land_base');
  const destination=(bases||[]).find(base=>base.rid===rid),target=destination?.slots?.find(slot=>slot.slotId===slotId);
  const source=(bases||[]).flatMap(base=>(base.slots||[]).map(slot=>({base,slot})))
    .find(row=>row.base.rid!==rid&&row.slot.itemId===itemId&&itemId>0);
  if(source){
    if(!target?.itemId||source.slot.locked||source.base.areaId!==destination.areaId)throw Error('跨队交换需要两个未占用锁定的飞机槽');
    const actual=(base,slot)=>store.info?.airbase?.find(row=>Number(row.api_area_id)===Number(base.areaId)&&Number(row.api_rid)===Number(base.rid))
      ?.api_plane_info?.find(row=>Number(row.api_squadron_id)===Number(slot.slotId));
    const before=actual(destination,target),donor=actual(source.base,source.slot);
    if(before?.api_slotid!==target.itemId||donor?.api_slotid!==source.slot.itemId||Number(before.api_state)!==1||Number(donor.api_state)!==1)
      throw Error('跨队飞机状态已变化，请重新选择');
    const exchanged=(slot,plane)=>({...slot,itemId:plane.itemId,count:plane.count,maxCount:plane.maxCount,state:plane.state,
      planned:true,withinBase:true,locked:true});
    return bases.map(base=>base===destination?{...base,range:null,slots:base.slots.map(slot=>slot===target?exchanged(slot,source.slot):slot)}:
      base===source.base?{...base,range:null,slots:base.slots.map(slot=>slot===source.slot?exchanged(slot,target):slot)}:base);
  }
  return (bases||[]).map(base=>base.rid!==rid?base:{...base,slots:base.slots.map(slot=>{
    if(slot.slotId!==slotId)return slot;
    if(itemId===slot.itemId)return slot;
    if(!(itemId>0))return {...slot,itemId:0,count:0,maxCount:0,state:0,planned:true,locked:true};
    const item=store.info?.equips?.[itemId],master=store.const?.$equips?.[item?.api_slotitem_id];
    if(!item||!master||!planner.eligiblePlane(master))throw Error('飞机资料不可用');
    const actual=store.info?.airbase?.find(row=>Number(row.api_area_id)===Number(base.areaId)&&Number(row.api_rid)===rid)
      ?.api_plane_info?.find(row=>Number(row.api_squadron_id)===slotId);
    if(Number(actual?.api_slotid)===itemId)return {...slot,itemId,count:actual.api_count,maxCount:actual.api_max_count,
      state:actual.api_state,planned:false,locked:true};
    const maxCount=planner.planeCapacity(master);
    return {...slot,itemId,count:maxCount,maxCount,state:1,planned:true,locked:true};
  })});
}
function changeTarget(bases,rid,wave,value){
  return (bases||[]).map(base=>base.rid!==rid?base:{...base,targets:Array.from({length:2},(_,i)=>i===wave?value:(base.targets?.[i]||''))});
}
module.exports={observedDraft,rebaseDraft,routeTargets,constrainAutoTargets,equipmentOptions,replaceSlot,changeTarget};
