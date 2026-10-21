'use strict';

// Departure reference power, full supply and no critical/contact/damage bonuses.
// Wiki: 対地攻撃#AGCalc, 改修工廠#cf8a4ed6, 戦闘について/与ダメージの算定に関わる要素の考察.
// Kept separate from the bounded ranking proxy in installation_attack.js.
const night=require('./night_cutin');
const {combatBonuses,nightFit}=require('./equipment_bonuses');
const number=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
const first=v=>number(Array.isArray(v)?v[0]:v);
const compact=s=>String(s||'').normalize('NFKC').replace(/\s/g,'');
const ids=state=>(state?.slots||[]).concat(state?.ex).filter(id=>id>0).sort((a,b)=>a-b).join(',');
const cap=(n,limit)=>n===null?null:Math.floor(n>limit?limit+Math.sqrt(n-limit):n);
// Hayasui Kai switches her daytime shelling formula only while carrying a
// torpedo bomber. Other supply/landing ships must not inherit this behavior.
const groundAviation=(master,items)=>[7,11,18].includes(Number(master?.api_stype))||
  Number(master?.api_stype)===22&&(Number(master.api_id)===352||compact(master.api_name)==='速吸改')&&
  items.some(e=>[8,58].includes(Number(e.type??e.master?.api_type?.[2])));
function groundBombingValue(master,items,groundBomber){
  const hay=Number(master?.api_stype)===22&&groundAviation(master,items);
  return items.filter(e=>groundBomber(e.master)||[8,58].includes(Number(e.type??e.master?.api_type?.[2]))||
    hay&&[10,11].includes(Number(e.type??e.master?.api_type?.[2])))
    .reduce((sum,e)=>sum+Number(e.master.api_baku||0),0);
}
function firePanel(target,store){
  if(!target.ship)return {value:null,reasons:['舰娘属性缺失']};
  const observed=first(target.ship.api_karyoku);
  if(target.before&&target.after&&ids(target.before)===ids(target.after)&&observed!==null)
    return {value:observed,reasons:[]};
  const hull=night.hullStat(target,'api_houg',0),blue=combatBonuses(store,target);
  if(hull===null||!blue.known)return {value:null,reasons:[...(hull===null?['舰娘火力或近代化资料缺失']:[]),...blue.reasons]};
  const equipment=target.items.reduce((n,e)=>n+Number(e.master.api_houg||0),0);
  const permanent=(target.ship.api_sp_effect_items||[]).reduce((n,e)=>n+Number(e.api_houg||0),0);
  return {value:hull+equipment+blue.firePower+permanent,reasons:[]};
}
function torpedoPanel(target,store){
  if(!target.ship)return {value:null,reasons:['舰娘属性缺失']};
  const observed=first(target.ship.api_raisou);
  if(target.before&&target.after&&ids(target.before)===ids(target.after)&&observed!==null)
    return {value:observed,reasons:[]};
  const hull=night.hullStat(target,'api_raig',1),blue=combatBonuses(store,target);
  if(hull===null||!blue.known)return {value:null,reasons:[...(hull===null?['舰娘雷装或近代化资料缺失']:[]),...blue.reasons]};
  const equipment=target.items.reduce((n,e)=>n+Number(e.master.api_raig||0),0);
  const permanent=(target.ship.api_sp_effect_items||[]).reduce((n,e)=>n+Number(e.api_raig||0),0);
  return {value:hull+equipment+blue.torpedo+permanent,reasons:[]};
}
function dayImprovement(e){
  const star=number(e.instance?.api_level);if(star===null||star<0)return null;
  const type=e.type??Number(e.master.api_type?.[2]),name=compact(e.master.api_name);
  if([3,38].includes(type)||name==='20.3cm/50連装砲改Modèle1931(SHS改良弾)')return 1.5*Math.sqrt(star);
  if(type===4)return night.nightImprovement({...e,type});
  if([14,15,40].includes(type))return .75*Math.sqrt(star);
  if(type===7)return /^(零戦62型|零式艦戦6[234]型)/.test(name)?0:.2*star;
  if(type===8)return .2*star;
  if([1,2,18,19,21,23,24,29,32,34,35,36,37,38,39,42,46,54].includes(type))return Math.sqrt(star);
  return 0;
}
function fireBase(target,store,{night:atNight=false}={}){
  const panel=firePanel(target,store),improvements=target.items.map(e=>atNight?night.nightImprovement(e):dayImprovement(e));
  const reasons=[...panel.reasons,...(improvements.includes(null)?['装备改修资料缺失']:[])];
  return {value:panel.value===null||improvements.includes(null)?null:panel.value+improvements.reduce((a,b)=>a+b,0),
    fit:nightFit(target),reasons:[...new Set(reasons)]};
}
function groundNightMode(target){
  const main=target.items.filter(e=>[1,2,3,38].includes(e.type)).length,secondary=target.items.filter(e=>e.type===4).length;
  if(main>=3)return {multiplier:2,hits:1};
  if(main>=2&&secondary)return {multiplier:1.75,hits:1};
  return main+secondary>=2?{multiplier:1.2,hits:2}:{multiplier:1,hits:1};
}
function apMultiplier(target){
  if(!target.items.some(e=>[1,2,3,38].includes(e.type))||!target.items.some(e=>e.type===19))return 1;
  if(target.items.some(e=>e.type===4))return 1.15;
  return target.items.some(e=>[12,13,93].includes(e.type))?1.1:1.08;
}
// The caller supplies per-target ground effects; no torpedo is used on land.
function groundAttack(target,effect,base,{night:atNight=false,multiplier=1,formation=1,groundBomber=()=>false}={}){
  if(base.value===null||effect.status!=='known')return null;
  let raw=((base.value+5)*effect.hullMultiplier+effect.hullAddition)*effect.multiplier+effect.addition;
  if(!atNight&&groundAviation(target.master,target.items)){
    const bomb=groundBombingValue(target.master,target.items,groundBomber);
    raw=Math.floor((raw+Math.floor(bomb*1.3)+15)*1.5)+25;
  }
  const limited=cap(raw*formation*(atNight?multiplier:1)+base.fit,atNight?360:220);
  const post=atNight?limited:Math.floor(limited*multiplier*apMultiplier(target));
  return Math.floor(post*effect.postMultiplier);
}
module.exports={cap,firePanel,torpedoPanel,fireBase,dayImprovement,groundNightMode,groundAttack,groundAviation,groundBombingValue};
