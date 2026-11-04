'use strict';
// Exercise opponents do not disclose equipment. All results here are
// conditional on the separate, hypothetical, developable-equipment outfit.
const {projectShip,airPower}=require('../fleet/fleet_metrics');
const {deriveFriendlyAir}=require('./combat_air_asw');
const AIR=new Set([6,7,8,11,25,26,45,56,57,58]);
const FIGHTER=new Set([6,45]);
const ASW=new Set([25,26]);
const COEFFICIENT={supremacy:1,superiority:3,parity:5,disadvantage:7,loss:10};
const ORDER=['loss','disadvantage','parity','superiority','supremacy'];
const unknown=reason=>({status:'unknown',reason,enemyAir:null,ownRemaining:null,bauxite:null});
const special=(type,master)=>type===26&&([489,491].includes(Number(master?.api_id))||/20戦隊/.test(master?.api_name||''));
function state(own,enemy){return enemy===0?(own>0?'supremacy':'noAirBattle'):own>=3*enemy?'supremacy':own>=1.5*enemy?'superiority':own>enemy*2/3?'parity':own>enemy/3?'disadvantage':'loss';}
function classify(own,enemy,attackLaunches){
 const actual=(ownPower,enemyPower)=>{
  const result=state(ownPower,enemyPower);
  // At 0 vs 0, a launched strike still starts an aviation battle; the
  // player obtains supremacy. Determine launches before AA interception.
  return result==='noAirBattle'&&attackLaunches?'supremacy':result;
 };
 const rawLo=state(own.min,enemy.max),rawHi=state(own.max,enemy.min);
 const lo=actual(own.min,enemy.max),hi=actual(own.max,enemy.min);
 if(lo===hi)return [lo];
 // The 0-vs-0 override is discontinuous, not a range of intermediate air
 // states: with own air fixed at zero, any positive enemy air is a loss.
 if(attackLaunches&&(rawLo==='noAirBattle'||rawHi==='noAirBattle'))return [...new Set([lo,hi])];
 if(lo==='noAirBattle'||hi==='noAirBattle')return [...new Set([lo,hi])];
 return ORDER.slice(ORDER.indexOf(lo),ORDER.indexOf(hi)+1);
}
function hasStrikeAircraft(store,projected){
 return projected.some(target=>target.after.slots.some((id,slot)=>{
  const item=store.info.equips[id],gear=store.const.$equips[item?.api_slotitem_id],type=Number(gear?.api_type?.[2]);
  return [7,8,11,57,58].includes(type)&&Number(gear?.api_type?.[0])!==21&&Number(target.ship.api_onslot?.[slot])>0;
 }));
}
function projectFull(store,entry,jetAircraft){
 const target=projectShip(store,entry.id,{slots:entry.slots,ex:entry.ex??-1});
 // Ordinary patrol aircraft have no air-superiority contribution. Do not
 // apply the generic proficiency formula used by fleet_metrics for type 26.
 const slots=target.after.slots.map(id=>{
  const item=store.info.equips[id],master=store.const.$equips[item?.api_slotitem_id],type=Number(master?.api_type?.[2]);
  return ASW.has(type)&&!special(type,{...master,api_id:item?.api_slotitem_id})?-1:id;
 });
 const counts=(target.master.api_maxeq||[]).slice();
 for(const [slot,reading] of Object.entries(jetAircraft||{}))counts[Number(slot)]=reading.reference;
 return {...target,ship:{...target.ship,api_onslot:counts},before:{...target.before,slots},after:{...target.after,slots}};
}
function virtualStore(store,reference,rank){
 const copy={...store,info:{ships:{},equips:{}}};let equipId=0;
 for(let i=0;i<reference.ships.length;i++){
  const ref=reference.ships[i],master=store.const.$ships?.[ref.masterId];
  if(!master||!Array.isArray(ref.slots)||!Number.isSafeInteger(master.api_slot_num)||master.api_slot_num<0||master.api_slot_num>6||
    master.api_slot_num>0&&(!Array.isArray(master.api_maxeq)||master.api_maxeq.length<master.api_slot_num||
      master.api_maxeq.slice(0,master.api_slot_num).some(n=>!Number.isSafeInteger(n)||n<0)))return null;
  const slots=Array(master.api_slot_num).fill(-1);
  for(const item of ref.slots){
   if(!Number.isSafeInteger(item.slot)||item.slot<0||item.slot>=slots.length||slots[item.slot]>0||!store.const.$equips[item.masterId])return null;
   slots[item.slot]=++equipId;copy.info.equips[equipId]={api_slotitem_id:item.masterId,api_level:0,api_alv:rank};
  }
  copy.info.ships[i+1]={api_id:i+1,api_ship_id:ref.masterId,api_lv:ref.level??1,api_slot:slots,api_slot_ex:-1,api_onslot:(master.api_maxeq||[]).slice(),api_kyouka:[0,0,0,0,0]};
 }
 return copy;
}
function estimate(store,scheme,reference,{jetAircraft}={}){
 if(reference?.status!=='estimated'||!Array.isArray(reference.ships)||!reference.ships.length)return unknown('对手参考配装不可用');
 if(!scheme?.ships?.length||!store?.info?.ships||!store.info.equips||!store.const?.$ships||!store.const.$equips)return unknown('己方舰队或主数据不足');
 const low=virtualStore(store,reference,0),high=virtualStore(store,reference,7);
 if(!low||!high)return unknown('对手参考配装或槽位资料不足');
 try{
  const own=scheme.ships.map((e,i)=>projectFull(store,e,jetAircraft?.[i]));
  const entries=reference.ships.map((_,i)=>({id:i+1,slots:high.info.ships[i+1].api_slot,ex:-1}));
  const lowProjected=entries.map(e=>projectFull(low,e)),highProjected=entries.map(e=>projectFull(high,e));
  const enemyLow=airPower(low,lowProjected);
  const enemyHigh=airPower(high,highProjected);
  const ownPower=airPower(store,own);
  if([ownPower,enemyLow,enemyHigh].some(p=>p.status!=='range'))return unknown('飞机制空值或搭载资料不足');
  const opponentPower={min:enemyLow.min,max:enemyHigh.max},ownAirPower={min:ownPower.min,max:ownPower.max};
  const enemyAir=entries.map(e=>{
   const ship=high.info.ships[e.id],counts={};
   e.slots.forEach((_,slot)=>{const n=Number(ship.api_onslot[slot]);if(Number.isSafeInteger(n)&&n>=0)counts[slot]=[n,n];});
   return deriveFriendlyAir(high,e,{slotRemaining:counts,nodeKind:'battle'});
  });
  const states=classify(ownAirPower,opponentPower,hasStrikeAircraft(store,own)||hasStrikeAircraft(high,highProjected));
  let planesMin=0,planesMax=0,uncertain=false;
  const ownRemaining=scheme.ships.map(entry=>{
   const ship=store.info.ships[entry.id],master=store.const.$ships[ship.api_ship_id],result={};
   for(let slot=0;slot<entry.slots.length;slot++){
    const id=entry.slots[slot];if(id<=0)continue;
    const instance=store.info.equips[id],gear=store.const.$equips[instance?.api_slotitem_id],type=Number(gear?.api_type?.[2]);
    if(!gear||!Number.isFinite(type)){uncertain=true;continue;}
    if(!AIR.has(type))continue;
    const n=master.api_maxeq?.[slot];if(!Number.isSafeInteger(n)||n<0){uncertain=true;continue;}
    if([57,58].includes(type)||special(type,{...gear,api_id:instance.api_slotitem_id})||
      type===26&&(Number(gear.api_baku||0)>0||Number(gear.api_raig||0)>0)){uncertain=true;continue;}
    const k=states.map(x=>COEFFICIENT[x]??0),reduced=ASW.has(type);
    const minLoss=reduced?0:Math.min(...k.map(v=>Math.floor(n*v*3/120)));
    const maxLoss=Math.max(...k.map(v=>Math.floor(n*v*7/120)));
    planesMin+=minLoss;
    if(FIGHTER.has(type)||reduced)planesMax+=maxLoss;
    else{planesMax+=n;result[slot]=[0,n-minLoss];}
   }
   return result;
  });
  // Without evidence that there is no aerial engagement, a zero-power
  // patrol-only formation may still incur a loss with unknown coefficient.
  if(states.includes('noAirBattle')&&scheme.ships.some(e=>e.slots.some(id=>ASW.has(Number(store.const.$equips[store.info.equips[id]?.api_slotitem_id]?.api_type?.[2])))))uncertain=true;
  return {status:'estimated',enemyAirPower:opponentPower,ownAirPower,states,enemyAir,
   ownRemaining:uncertain?null:ownRemaining,bauxite:uncertain?null:{min:planesMin*5,max:planesMax*5},
   assumptions:['对手按可开发装备的参考配装，并非实际装备','对手飞机满载；制空按熟练度 0 至 7 估算','对手开幕航空攻击暂按满载，未计己方拦截','攻击机计入对手防空可能导致全灭；回转翼及普通对潜机损耗下限按零估算',...(jetAircraft?['己方喷式机强袭后按残机区间中值计算普通航空制空']:[])],
   ...(uncertain?{reason:'特殊航空装备或比例损耗机制未确认'}:{})};
 }catch(_){return unknown('航空参考资料不足');}
}
module.exports={estimate};
