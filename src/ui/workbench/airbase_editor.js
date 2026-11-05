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
  for(const entry of available){
    if(used.has(entry.itemId))continue;
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
module.exports={observedDraft,routeTargets,constrainAutoTargets,equipmentOptions,replaceSlot,changeTarget};
