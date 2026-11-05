'use strict';
const {consumption}=require('../routes/sortie_profile');
// https://wikiwiki.jp/kancolle/資材#Whirlpool
// Reduction counts radar-equipped ships, including expansion slots, not items.
const RADAR_REDUCTION=[0,.25,.4,.5,.55,.58,.6];
const STRONG_CHANCE=.1; // Wiki's approximate occurrence rate; a reference only.
function advanceSupply(remaining,used){
  const next=key=>Number.isFinite(remaining[key])&&Number.isFinite(used[key])?
    Math.max(0,Math.min(1,remaining[key]-used[key])):null;
  return {fuel:next('fuel'),ammo:next('ammo')};
}
function radarShipCount(store,ships){
  return ships.filter(entry=>[...(entry.slots||[]),entry.ex].some(id=>{
    const item=store.info.equips?.[id],master=store.const.$equips?.[item?.api_slotitem_id];
    return [12,13,93].includes(Number(master?.api_type?.[2]));
  })).length;
}
function whirlpoolParameters(node){
  if(node?.kind!=='whirlpool')return null;
  const raw=String(node.effect?.raw||'').replace(/[０-９]/g,c=>String(c.charCodeAt(0)-0xff10)).replace(/％/g,'%');
  const resource=/弾薬/.test(raw)?'ammo':/燃料/.test(raw)?'fuel':null;
  if(!resource)return null;
  const basic=raw.match(/基本喪失割合\s*[:：]?\s*([^\n]*)/)?.[1]||'';
  const rates=[...basic.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map(m=>Number(m[1])/100);
  const caps=[...raw.matchAll(/喪失上限値\s*[:：]\s*(\d+|確認不可能|[?？])/g)]
    .map(m=>/^\d+$/.test(m[1])?Number(m[1]):null);
  const assumed=!rates.length||/^[?？]/.test(basic);
  const strong=/強うずしお/.test(raw);
  return {resource,assumed,strong,branches:[{rate:assumed ? .3 : rates[0],cap:caps[0]??null,weight:strong?1-STRONG_CHANCE:1},
    ...(strong?[{rate:rates[1]??1.5,cap:(caps.length>1?caps[1]:caps[0])??null,weight:STRONG_CHANCE}]:[])]};
}
function createSupplyTracker(store,scheme){
  const radarShips=radarShipCount(store,scheme.ships),factor=1-RADAR_REDUCTION[Math.min(6,radarShips)],estimates=[];
  const ships=scheme.ships.map(entry=>{
    const master=store.const.$ships?.[store.info.ships[entry.id]?.api_ship_id];
    return {fuel:1,ammo:1,capacity:{fuel:master?.api_fuel_max,ammo:master?.api_bull_max}};
  });
  const snapshot=()=>Object.fromEntries(['fuel','ammo'].map(key=>{
    if(!ships.length||ships.some(s=>!Number.isFinite(s[key])))return [key,null];
    const first=ships[0][key];
    return [key,ships.every(s=>s[key]===first)?first:ships.reduce((sum,s)=>sum+s[key],0)/ships.length];
  }));
  return {snapshot,estimates,advance(node,area){
    const rule=whirlpoolParameters(node),before=snapshot();
    if(!rule){const used=consumption(node,area);for(const ship of ships)Object.assign(ship,advanceSupply(ship,used));return used;}
    for(const ship of ships){
      const key=rule.resource,remaining=ship[key],capacity=ship.capacity[key];
      if(!Number.isFinite(remaining))continue;
      const loss=rule.branches.reduce((sum,branch)=>{
        const fraction=remaining*branch.rate*factor;
        const amount=Number.isFinite(capacity)&&capacity>0?
          Math.min(Math.floor(capacity*fraction+1e-9),branch.cap??Infinity)/capacity:fraction;
        return sum+branch.weight*Math.min(remaining,amount);
      },0);
      ship[key]=Math.max(0,remaining-loss);
    }
    const after=snapshot();
    estimates.push({node:node.node,resource:rule.resource,radarShips,strongChance:rule.strong?STRONG_CHANCE:0,
      assumedBaseRate:rule.assumed ? .3 : null,loss:before[rule.resource]===null||after[rule.resource]===null?null:before[rule.resource]-after[rule.resource]});
    return {fuel:before.fuel===null||after.fuel===null?null:before.fuel-after.fuel,
      ammo:before.ammo===null||after.ammo===null?null:before.ammo-after.ammo,estimated:true};
  }};
}
module.exports={advanceSupply,radarShipCount,whirlpoolParameters,createSupplyTracker};
