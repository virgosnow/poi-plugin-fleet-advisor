'use strict';
// Shared by candidate scoring, current-roster seeding and workbench badges.
const data=require('../../../data/asw_bonuses.json');
const compact=s=>String(s||'').replace(/[\s　]/g,'');
const numeric=v=>{const n=Array.isArray(v)?v[0]:v;return n===undefined||n===null?null:Number(n);};
const valid=v=>Number.isFinite(v)&&v>=0;
const ids=s=>(s.slots||[]).concat(s.ex).filter(id=>id>0);
const automatic=/^(五十鈴改二|龍田改二|夕張改二丁|吹雪改三護(?:\(六式\))?|Jervis改|Janus改|Javelin改|SamuelB\.Roberts(?:改|Mk\.II)|Fletcher(?:改|改Mod\.2|Mk\.II)?|Johnston(?:改)?|HeywoodL\.E\.改|RichardP\.Leary改|Visby(?:改)?)$/;
const byId=new Map(),byType=new Map();
for(const r of data.rules)for(const [index,values]of [[byId,r.ids],[byType,r.types]])for(const id of values||[]){
  if(!index.has(id))index.set(id,[]);index.get(id).push(r);
}
// Per immutable snapshot. Pure results depend on hull ID/class and gear IDs/stars.
const caches=new WeakMap();
function context(store){
  const key=store.const.$ships;
  if(caches.has(key))return caches.get(key);
  const parents=new Map();
  for(const [id,m]of Object.entries(key)){const next=Number(m.api_aftershipid);if(next>0){
    if(!parents.has(next))parents.set(next,[]);parents.get(next).push(Number(id));
  }}
  const c={parents,bonuses:new Map()};caches.set(key,c);return c;
}
function itemsFor(store,state){return ids(state).map(instanceId=>{
  const instance=store.info.equips[instanceId],id=Number(instance?.api_slotitem_id),master=store.const.$equips[id];
  return {id,level:instance?.api_level??0,type:Number(master?.api_type?.[2]),master,
    raw:master?Number(master.api_tais||0):null};
});}
function signature(items){return items.map(e=>`${e.id}:${e.level}`).sort().join(',');}
function bonus(store,target,items){
  const c=context(store),m=target.master,id=Number(target.ship.api_ship_id),ctype=Number(m.api_ctype),type=Number(m.api_stype);
  const key=JSON.stringify([id,ctype,type,signature(items)]);
  if(c.bonuses.has(key))return c.bonuses.get(key);
  const unknown=new Set();let value=0;
  if(items.some(e=>!e.master||!valid(e.raw)||!Number.isFinite(e.type)||!valid(Number(e.level))))unknown.add('装备属性或改修数据缺失');
  if(items.some(e=>e.id>data.maxEquipmentId))unknown.add('包含尚未收录蓝字加成的新装备');
  if(items.length&&id>data.maxShipId)unknown.add('该舰改造形态超出已收录蓝字资料');
  const ancestors=new Set([id]),visit=[id];
  while(visit.length)for(const p of c.parents.get(visit.pop())||[])if(!ancestors.has(p)){ancestors.add(p);visit.push(p);}
  const candidates=new Set(items.flatMap(e=>[...(byId.get(e.id)||[]),...(byType.get(e.type)||[])]));
  for(const r of candidates){
    let missing=false;
    if(r.shipId&&!r.shipId.includes(id)||r.shipType&&!r.shipType.includes(type))continue;
    if(r.shipClass||r.shipCountry){
      if(!Number.isFinite(ctype))missing=true;
      else if(r.shipClass&&!r.shipClass.includes(ctype)||r.shipCountry&&!r.shipCountry.includes(ctype))continue;
    }
    if(r.shipBase&&!r.shipBase.some(base=>ancestors.has(base))){
      // A complete master remodel chain supplies the base forms. Missing chain
      // metadata must not silently turn a possible fit bonus into zero.
      if(m.api_aftershipid===undefined)missing=true;else continue;
    }
    const fitted=items.filter(e=>(r.ids?r.ids.includes(e.id):r.types.includes(e.type))&&e.level>=(r.remodel||0));
    if(!fitted.length||r.num&&fitted.length<r.num)continue;
    if(r.requiresId&&!items.some(e=>r.requiresId.includes(e.id)))continue;
    if(r.requiresType&&!items.some(e=>r.requiresType.includes(e.type)))continue;
    if(r.requiresSR&&!items.some(e=>e.master?.api_type?.[3]===11&&Number(e.master.api_saku)>=5))continue;
    if(missing){unknown.add('舰型或改造链数据不足，无法核对蓝字加成');continue;}
    value+=r.asw*(r.num?1:fitted.length);
  }
  const result={value,known:!unknown.size,reasons:[...unknown]};
  if(c.bonuses.size>=4096)c.bonuses.clear();c.bonuses.set(key,result);return result;
}
function aswStats(store,target){
  const before=itemsFor(store,target.before),after=itemsFor(store,target.after),current=numeric(target.ship.api_taisen);
  const same=signature(before)===signature(after)&&before.every(e=>e.master);
  const base={items:after,total:null,beforeBonus:null,afterBonus:null,reason:''};
  if(!valid(current))return {...base,reason:'缺少当前对潜面板值'};
  if(same)return {...base,total:current,source:'observed'};
  const old=bonus(store,target,before),next=bonus(store,target,after);
  if(!old.known||!next.known)return {...base,reason:[...new Set([...old.reasons,...next.reasons])].join('；')};
  const intrinsic=current-before.reduce((s,e)=>s+e.raw,0)-old.value;
  if(!valid(intrinsic))return {...base,reason:'当前对潜面板与已收录装备加成不一致'};
  return {...base,total:intrinsic+after.reduce((s,e)=>s+e.raw,0)+next.value,
    beforeBonus:old.value,afterBonus:next.value,source:'calculated'};
}
function openingASW(store,target){
  const stats=aswStats(store,target),items=stats.items,type=Number(target.master.api_stype),name=compact(target.master.api_name);
  const has=fn=>items.some(fn),sonar=has(e=>[14,40].includes(e.type)),raw=items.reduce((s,e)=>s+(e.raw||0),0);
  const combatPlane=has(e=>[7,8].includes(e.type)&&e.raw>0),patrol=has(e=>[25,26].includes(e.type));
  const goodPlane=patrol||has(e=>e.type===8&&e.raw>=7);
  let eligible=false,reason='该舰不具备先制对潜条件',threshold=null;
  if(automatic.test(name)){eligible=true;reason='该改造形态无需对潜装备或对潜值门槛';}
  else if(name==='加賀改二護'||/^(大鷹|雲鷹|神鷹)改(?:二)?$/.test(name)){
    eligible=combatPlane||patrol;reason=eligible?'满足对潜航空装备条件':'需要对潜航空装备';
  }else if(name==='日向改二'){
    eligible=has(e=>[326,327].includes(e.id)||/^S-51J/.test(e.master?.api_name))||items.filter(e=>e.type===25).length>=2;
    reason='需要 S-51J 系列一槽或旋翼机两槽';
  }else if(type===7){
    if(/^(鈴谷|熊野)航改二$/.test(name)){
      eligible=sonar||goodPlane?null:false;reason='最上型轻空母的特殊先制条件尚未确认';
    }else if(goodPlane)threshold=sonar?50:65;
    else if(sonar&&combatPlane)threshold=100;
    else reason='缺少先制对潜所需航空装备';
  }else if(/^(神州丸改|大和改二重|扶桑改二(?:補)?|山城改二(?:補)?|熊野丸(?:改)?)$/.test(name)){
    const attack=/^熊野丸/.test(name)?patrol||has(e=>e.type===7&&e.raw>0):
      has(e=>[11,25].includes(e.type))||/^(扶桑|山城)/.test(name)&&has(e=>e.type===15);
    if(sonar&&attack)threshold=100;else reason='需要声呐及该舰对应的对潜攻击装备';
  }else if(type===1){if(sonar)threshold=60;else if(raw>=4)threshold=75;else reason='需要声呐，或装备基础对潜合计至少 4';}
  else if([2,3,4,21,22].includes(type)||/^宗谷|^しまね丸改$/.test(name)){
    const blocked=/^(山汐丸改|しまね丸改)$/.test(name)&&has(e=>[7,8].includes(e.type)&&e.raw===0)&&!combatPlane;
    if(sonar&&!blocked)threshold=100;else reason=blocked?'零对潜航空攻击机组合阻止先制对潜':'需要声呐';
  }
  if(threshold!==null){eligible=stats.total===null?null:stats.total>=threshold;
    reason=stats.total===null?stats.reason:`对潜 ${stats.total} / 门槛 ${threshold}，装备条件已满足`;}
  if(items.some(e=>!e.master)&&!automatic.test(name)){eligible=null;reason='缺少装备资料，无法核对先制条件';}
  return {shipId:target.id,eligible,predictedEligible:eligible,totalAswEstimate:stats.total,
    totalAsw:stats.total,bonusBefore:stats.beforeBonus,bonusAfter:stats.afterBonus,
    statSource:stats.source||'unknown',threshold,sonarDepthPair:sonar&&has(e=>e.type===15),
    status:eligible===null?'unknown':'computed',reason};
}
module.exports={openingASW,aswStats,bonus};
