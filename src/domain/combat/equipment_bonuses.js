'use strict';

// Numerical facts only; the matching logic is local. Keep the origin of each
// bonus: carrier night aviation does not use every visible panel increase.
const data=require('../../../data/combat_bonuses.json');
const byId=new Map(),byType=new Map();
for(const rule of data.rules)for(const [index,values]of [[byId,rule.ids],[byType,rule.types]])for(const id of values||[]){
  if(!index.has(id))index.set(id,[]);index.get(id).push(rule);
}
const number=v=>v==null||!Number.isFinite(Number(v))?null:Number(v);
const parentIndexes=new WeakMap();
function parentIndex(ships={}){
  if(parentIndexes.has(ships))return parentIndexes.get(ships);
  const parents=new Map();
  for(const [key,master]of Object.entries(ships)){
    const next=Number(master.api_aftershipid);if(next>0){if(!parents.has(next))parents.set(next,[]);parents.get(next).push(Number(key));}
  }
  parentIndexes.set(ships,parents);return parents;
}
function combatBonuses(store,target,{stat}={}){
  const m=target.master,id=Number(target.ship.api_ship_id),ctype=number(m.api_ctype),type=Number(m.api_stype);
  const items=target.items.map(e=>({...e,masterId:number(e.instance?.api_slotitem_id),star:number(e.instance?.api_level)}));
  const reasons=new Set(),matches=[],total={firePower:0,torpedo:0,bomber:0,scout:0,antiAir:0,nightAviation:0};
  if(items.some(e=>!e.master||e.masterId===null||e.star===null))reasons.add('装备属性或改修资料缺失');
  if(items.some(e=>e.masterId>data.maxEquipmentId))reasons.add('包含尚未收录蓝字的新装备');
  if(id>data.maxShipId)reasons.add('舰娘改造形态超出蓝字资料范围');
  const ancestors=new Set([id]),todo=[id],parents=parentIndex(store?.const?.$ships);
  while(todo.length)for(const previous of parents.get(todo.pop())||[])if(!ancestors.has(previous)){ancestors.add(previous);todo.push(previous);}
  const candidates=new Set(items.flatMap(e=>[...(byId.get(e.masterId)||[]),...(byType.get(e.type)||[])])
    .filter(rule=>!stat||rule[stat]));
  const radar=(key,min)=>items.some(e=>[12,13,93].includes(e.type)&&Number(e.master?.[key]||0)>=min);
  for(const rule of candidates){
    if(rule.shipId&&!rule.shipId.includes(id)||rule.shipType&&!rule.shipType.includes(type))continue;
    if(rule.shipClass||rule.shipCountry){
      if(ctype===null){reasons.add('缺少舰型，无法核对蓝字');continue;}
      if(rule.shipClass&&!rule.shipClass.includes(ctype)||rule.shipCountry&&!rule.shipCountry.includes(ctype))continue;
    }
    if(rule.shipBase&&!rule.shipBase.some(base=>ancestors.has(base))){
      if(m.api_aftershipid===undefined)reasons.add('缺少改造链，无法核对蓝字');
      continue;
    }
    if(rule.requiresSR&&!radar('api_saku',5)||rule.requiresAR&&!radar('api_tyku',2)||rule.requiresAccR&&!radar('api_houm',8))continue;
    if(rule.requiresType&&!items.some(e=>rule.requiresType.includes(e.type)))continue;
    let permitted=true;
    for(const [ids,count,level]of [[rule.requiresId,rule.requiresIdNum,rule.requiresIdLevel],[rule.requiresId2,1,rule.requiresIdLevel2]])if(ids){
      const required=items.filter(e=>ids.includes(e.masterId));
      if(required.length<(count||1)||!required.some(e=>e.star>=(level||0))){permitted=false;break;}
    }
    if(!permitted)continue;
    const fitted=items.filter(e=>(rule.ids?rule.ids.includes(e.masterId):rule.types.includes(e.type))&&e.star>=(rule.remodel||0));
    if(!fitted.length||rule.num&&fitted.length<rule.num)continue;
    for(const e of rule.num?fitted.slice(0,1):fitted){
      const row={firePower:rule.firePower||0,torpedo:rule.torpedo||0,bomber:rule.bomber||0,scout:rule.scout||0,antiAir:rule.antiAir||0,fromType:e.type,fromId:e.masterId,fromInstance:e.id};
      if(stat==='scout')row.scoutFromCarrierReconImprovement=!rule.ids&&rule.types?.includes(9)===true;
      matches.push(row);for(const key of ['firePower','torpedo','bomber','scout','antiAir'])total[key]+=row[key];
      // Night carrier attacks use torpedo blue bonuses from torpedo bombers,
      // plus the fire/torpedo/bomb improvement bonuses of deck/air crew.
      if(e.type===8)total.nightAviation+=row.torpedo;
      if(e.type===35)total.nightAviation+=row.firePower+row.torpedo+row.bomber;
    }
  }
  return {...total,known:!reasons.size,reasons:[...reasons],matches};
}

const normalize=s=>String(s||'').normalize('NFKC').replace(/\s/g,'');
const singles=new Set(['14cm単装砲','15.2cm単装砲']);
const twins=new Set(['14cm連装砲','14cm連装砲改','14cm連装砲改二','15.2cm連装砲','15.2cm連装砲改','15.2cm連装砲改二',
  '6inch連装速射砲Mk.XXI','Bofors15.2cm連装砲Model1930','Bofors15cm連装速射砲Mk.9Model1938',
  'Bofors15cm連装速射砲Mk.9改+単装速射砲Mk.10改Model1938','13.8cm連装砲','13.8cm連装砲改']);
function nightFit(target){
  const type=Number(target.master.api_stype),names=target.items.map(e=>normalize(e.master?.api_name));
  if([3,4,21].includes(type))return Math.sqrt(names.filter(n=>singles.has(n)).length)+2*Math.sqrt(names.filter(n=>twins.has(n)).length);
  if([5,6].includes(type)&&/^(Zara|Pola)/.test(target.master.api_name||''))return Math.sqrt(names.filter(n=>n==='203mm/53連装砲').length);
  return 0;
}
module.exports={combatBonuses,nightFit};
