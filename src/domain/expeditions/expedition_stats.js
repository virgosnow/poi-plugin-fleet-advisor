'use strict';
// Dispatch attributes, not combat power or 33-formula LoS.
// https://wikiwiki.jp/kancolle/遠征#about_stat
const {combatBonuses}=require('../combat/equipment_bonuses');
const {aswStats}=require('../combat/opening_asw');
const FIELDS={firepower:['api_karyoku','api_houg','firePower'],antiAir:['api_taiku','api_tyku','antiAir'],
  asw:['api_taisen','api_tais',null],los:['api_sakuteki','api_saku','scout']};
const AIR=new Set([6,7,8,9,10,11,25,26,41,45,56,57,58,59]);
const first=v=>Number(Array.isArray(v)?v[0]:v),tenth=v=>Math.floor((v+1e-9)*10)/10;
const state=s=>({slots:s.api_slot||[],ex:s.api_slot_ex});
const ids=s=>(s.slots||[]).concat(s.ex).filter(id=>id>0);
function items(store,loadout){return ids(loadout).map(id=>{
  const instance=store.info.equips[id],master=store.const.$equips[instance?.api_slotitem_id];
  return {id,instance,master,type:Number(master?.api_type?.[2]),slot:loadout.slots.indexOf(id)};
});}
function improvement(item,key){
  const star=Number(item.instance?.api_level||0),root=Math.sqrt(star),type=item.type,icon=Number(item.master?.api_type?.[3]);
  if(!star)return {value:0,known:true};
  let factor=0,known=true;
  if(key==='firepower'){
    factor=[2,3,13,38,93].includes(type)?1:[1,4,12,19,21].includes(type)?.5:0;
    if([34,35].includes(type))known=false;
  }
  if(key==='antiAir'){
    factor=icon===16||type===21?1:0;
    if(!factor&&Number(item.master?.api_tyku)>0&&type!==36)known=false;
  }
  if(key==='asw')factor=[14,15,40].includes(type)?1:0;
  if(key==='los'){
    factor=[10,12,13,93].includes(type)?1:0;
    if(!factor&&[9,11,39].includes(type))known=false;
  }
  return {value:tenth(factor*root),known};
}
function readShipStats(store,id,loadout){
  const ship=store.info.ships[id],master=store.const.$ships[ship.api_ship_id],before=state(ship),after=loadout||before;
  const worn=items(store,before),fitted=items(store,after),same=ids(before).slice().sort((a,b)=>a-b).join()===ids(after).slice().sort((a,b)=>a-b).join();
  const target={id,ship,master,before,after,items:fitted},out={};
  for(const [key,[api,raw,blue]]of Object.entries(FIELDS)){
    const observed=first(ship[api]),reasons=[];let panel=observed;
    if(!Number.isFinite(observed)||[...worn,...fitted].some(e=>!e.master))reasons.push('舰娘或装备属性资料不完整');
    else if(!same){
      if(key==='asw'){
        const stats=aswStats(store,target);panel=stats.total;
        if(panel===null)reasons.push(stats.reason);
      }else{
        const old=combatBonuses(store,{...target,items:worn},{stat:blue}),next=combatBonuses(store,target,{stat:blue});
        const hull=observed-worn.reduce((n,e)=>n+Number(e.master[raw]||0),0)-old[blue];
        if(!old.known||!next.known||hull<0)reasons.push('无法完整还原本体与装备蓝字');
        else panel=hull+fitted.reduce((n,e)=>n+Number(e.master[raw]||0),0)+next[blue];
      }
    }
    if(reasons.length){out[key]={lower:0,upper:null,status:'lowerBound',reasons};continue;}
    let lower=panel,known=true;
    for(const item of fitted){
      const value=Number(item.master[raw]||0),air=AIR.has(item.type),imp=improvement(item,key);
      if(air&&key==='asw'&&value>0){
        const count=Number(master.api_maxeq?.[item.slot]??ship.api_onslot?.[item.slot]);
        const star=Number(item.instance?.api_level||0),supported=[7,8,10,11,25].includes(item.type);
        const airImp=tenth((supported?(value>=7?1:value===5?.5:0):0)*Math.sqrt(star));
        lower-=value;
        if(Number.isFinite(count)&&count>=0){
          lower+=count===0?0:Math.floor((value+airImp)*(.65+.1*Math.sqrt(Math.max(0,count-2))));
          if(count>0&&![25,26].includes(item.type))known=false;
          if(count>0&&star&&(!supported||[4,6].includes(value)))known=false;
        }else known=false;
      }else if(air&&['antiAir','los'].includes(key)&&value>0){
        lower-=value;known=false;
        if(key==='los'&&item.type===10)lower+=imp.value;
      }else{lower+=imp.value;if(!imp.known)known=false;}
    }
    lower=Math.max(0,Math.round(lower*10)/10);
    out[key]={lower,upper:known?lower:null,status:known?'known':'lowerBound',
      reasons:known?[]:['部分飞机或改修贡献未完全确认，按保守下限核对']};
  }
  return out;
}
function createStatReader(store){
  const cache=new Map();
  return (id,loadout)=>{
    const key=JSON.stringify([id,loadout?.slots||store.info.ships[id].api_slot,loadout?.ex??store.info.ships[id].api_slot_ex]);
    if(cache.has(key))return cache.get(key);
    const reading=readShipStats(store,id,loadout);if(cache.size>=8192)cache.clear();cache.set(key,reading);return reading;
  };
}
module.exports={FIELDS,AIR,improvement,readShipStats,createStatReader};
