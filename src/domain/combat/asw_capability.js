'use strict';
// Full-resupply attack prerequisites, shared by fitting, scoring and tooltips.
// Equipment ASW on the panel alone does not enable an aviation ASW attack.
// https://wikiwiki.jp/kancolle/対潜攻撃
const compact=s=>String(s||'').normalize('NFKC').replace(/\s/g,'');
const aircraftTypes=new Set([7,8,11,25,26,41]);
function capacity(target,slot){
  return slot==='ex'?0:Number(target.master.api_maxeq?.[slot]??target.ship.api_onslot?.[slot]??0);
}
function activeAircraft(target,item){return aircraftTypes.has(item.type)&&capacity(target,item.slot)>0;}
function aswMode(target,items,hull){
  const type=Number(target.master.api_stype),name=compact(target.master.api_name);
  const planes=items.filter(e=>activeAircraft(target,e));
  const combat=planes.filter(e=>[7,8].includes(e.type));
  const patrol=planes.some(e=>[25,26].includes(e.type));
  const air=planes.some(e=>[11,25,41].includes(e.type)||[7,8].includes(e.type)&&e.raw>0||
    e.type===26&&/^熊野丸(?:改)?$/.test(name));
  if(type===7||name==='加賀改二護')return combat.some(e=>e.raw>0)||combat.length&&patrol?'air':null;
  if(type===22){
    if(air)return 'air';
    return hull>0&&!combat.some(e=>e.raw===0)?'depth':null;
  }
  if([1,2,3,4,21].includes(type)||/^日枝丸(?:改)?$/.test(name))return hull>0?'depth':null;
  if(![6,10,16,17,19,20].includes(type)&&name!=='大和改二重')return null;
  if(air)return 'air';
  if(/^(扶桑|山城)改二(?:補)?$|^第百一号輸送艦(?:改)?$/.test(name)&&items.some(e=>e.type===15))return 'depth';
  if(/^(迅鯨改|長鯨改|平安丸改|朝日改|明石改)$/.test(name)&&
    items.some(e=>e.type===15&&(e.id===347||compact(e.master?.api_name)==='二式12cm迫撃砲改(集中配備)')))return 'depth';
  return null;
}
function aswImprovement(item){
  const stars=Math.max(0,Number(item.level||0));
  if([14,15,40].includes(item.type))return Math.sqrt(stars);
  if(item.type===25)return .3*stars;
  if(item.type===26)return (compact(item.master?.api_name)==='三式指揮連絡機改'?.3:.2)*stars;
  const bombFighter=item.type===7&&(Number(item.master?.api_type?.[3])===7||
    /^(零戦6[234]型|零式艦戦6[234]型|F4U-1D|FM-2)/.test(compact(item.master?.api_name)));
  return [7,8].includes(item.type)&&!bombFighter?.2*stars:0;
}
module.exports={aircraftTypes,capacity,activeAircraft,aswMode,aswImprovement};
