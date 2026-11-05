'use strict';

// Planning is read-only. The returned instance-pinned operations do not grant
// permission to send inputs: the executor must recheck the complete observed
// base and inventory before every mutation.
const {maps}=require('../../../data/sortie/land_base/maps.json');
const {eligiblePlane}=require('./airbase_relocation');
const id=value=>Number.isSafeInteger(value)&&value>0;
function planLandBases(store,{area,bases}={}){
  const map=maps.find(row=>row.id===area&&row.available);
  if(!map||!Array.isArray(bases))throw Error('基地航空队方案或海域不可用');
  if(store?.airbaseSync?.complete!==true||!Array.isArray(store?.info?.airbase))throw Error('基地航空队数据尚未完整同步');
  if(store.airbaseSync.relocationsComplete!==true)throw Error('飞机转场状态尚未同步，请先回到母港');
  const observed=store.info.airbase,items=store.info.equips||{},masters=store.const?.$equips||{};
  const busy=new Set((store.info.airbaseRelocations||[]).map(row=>row.itemId));
  const fleetItems=new Set(Object.values(store.info.ships||{}).flatMap(ship=>[...(ship.api_slot||[]),ship.api_slot_ex]).filter(id));
  const owner=new Map(),seenBases=new Set(),claimed=new Set(),result=[];
  for(const base of observed)for(const slot of base.api_plane_info||[]){
    const item=slot.api_slotid;if(!id(item))continue;
    if(owner.has(item))throw Error('基地飞机实例归属重复');
    owner.set(item,{areaId:base.api_area_id,rid:base.api_rid,slot:slot.api_squadron_id,state:slot.api_state});
  }
  for(const target of bases){
    if(Number(target?.areaId)!==map.baseAreaId||!Number.isSafeInteger(target.rid)||target.rid<1||seenBases.has(target.rid))
      throw Error('基地航空队区域或编号不正确');
    seenBases.add(target.rid);
    const matches=observed.filter(row=>Number(row.api_area_id)===map.baseAreaId&&Number(row.api_rid)===target.rid);
    if(matches.length!==1||!Array.isArray(matches[0].api_plane_info)||!Array.isArray(target.slots)||target.slots.length!==4)
      throw Error('基地航空队槽位数据不完整');
    const current=Array.from({length:4},(_,i)=>{
      const rows=matches[0].api_plane_info.filter(row=>row.api_squadron_id===i+1);
      if(rows.length!==1||!Number.isSafeInteger(rows[0].api_slotid)||rows[0].api_slotid<0)throw Error('基地航空队槽位数据不完整');
      return {slotId:i+1,itemId:rows[0].api_slotid,state:rows[0].api_state};
    });
    const desired=Array.from({length:4},(_,i)=>{
      const rows=target.slots.filter(row=>row?.slotId===i+1);
      if(rows.length!==1||!Number.isSafeInteger(rows[0].itemId)||rows[0].itemId<0)throw Error('基地航空队目标槽位无效');
      const wanted=rows[0].itemId,existing=current[i];
      if(existing.state!==0&&existing.state!==1&&existing.itemId!==wanted)throw Error('基地槽位转场或状态不明');
      if(wanted){
        if(claimed.has(wanted))throw Error('基地方案重复使用同一架飞机');claimed.add(wanted);
        const plane=items[wanted],master=masters[plane?.api_slotitem_id],source=owner.get(wanted);
        if(!plane||!eligiblePlane(master))throw Error('飞机实例资料不足或不可配备');
        if(busy.has(wanted)||fleetItems.has(wanted))throw Error('飞机正在转场或由舰娘占用');
        if(source&&(source.areaId!==map.baseAreaId||source.rid!==target.rid||source.state!==1))throw Error('飞机由其他基地占用或尚未就绪');
      }
      return wanted;
    });
    const next=current.map(slot=>slot.itemId),operations=[];
    for(let i=0;i<4;i++){
      if(next[i]===desired[i])continue;
      const from=desired[i]?next.indexOf(desired[i]):-1;
      if(from>=0){operations.push({kind:'swap',slotId:i+1,sourceSlotId:from+1,itemId:desired[i]});
        [next[i],next[from]]=[next[from],next[i]];}
      else {operations.push({kind:desired[i]?'set':'remove',slotId:i+1,itemId:desired[i],previousId:next[i]});next[i]=desired[i];}
    }
    const mode=target.modePlanned?Number(target.mode):Number(matches[0].api_action_kind);
    if(!Number.isInteger(mode)||mode<0||mode>4)throw Error('基地行动状态不明');
    result.push({areaId:map.baseAreaId,rid:target.rid,current,desired,mode,currentMode:Number(matches[0].api_action_kind),
      modeChange:mode!==Number(matches[0].api_action_kind),operations});
  }
  return {area,bases:result,changed:result.reduce((sum,base)=>sum+base.operations.length+(base.modeChange?1:0),0)};
}
function assertExecutable(plan){
  for(const base of plan.bases){
    const displaced=new Set();
    for(const op of base.operations){
      if(op.kind==='remove')throw Error('基地方案包含尚未支持的卸装，请先在游戏中调整');
      if(op.kind==='set'&&displaced.has(op.itemId))throw Error('被替换的飞机需要转场，不能立即重新配置');
      if(op.kind==='set'&&op.previousId>0)displaced.add(op.previousId);
    }
  }
}
module.exports={planLandBases,assertExecutable};
