'use strict';
const {combatBonuses}=require('../combat/equipment_bonuses');
const bonusData=require('../../../data/combat_bonuses.json');
// Verified 33-formula bonuses, not just visible panel increases. SG initial
// was fixed in 2022; SG late and other unverified bonuses retain an interval.
// https://wikiwiki.jp/kancolle/ルート分岐#equipment_bonus (2026-10-21)
const VERIFIED=new Set([30,54,61,115,118,129,138,151,171,194,273,278,279,315,
  367,368,369,370,371,408,410,412,414,522,523]);
// Carrier-recon improvement bonuses are shared category rules. Keep them
// separate from each aircraft's potentially unverified exclusive bonus.
const verifiedMatch=m=>VERIFIED.has(m.fromId)||m.scoutFromCarrierReconImprovement===true;
const scoutRules=bonusData.rules.filter(r=>r.scout);
const SCOUT_IDS=new Set(scoutRules.flatMap(r=>r.ids||[])),SCOUT_TYPES=new Set(scoutRules.flatMap(r=>r.types||[]));
const ids=s=>(s.slots||[]).concat(s.ex).filter(id=>id>0);
const caches=new WeakMap();
const number=v=>v==null?NaN:Number(Array.isArray(v)?v[0]:v);
const valid=v=>Number.isFinite(v)&&v>=0;
function itemsFor(store,state){return ids(state).map(id=>{
  const instance=store.info.equips[id],master=store.const.$equips[instance?.api_slotitem_id];
  return {id,instance,master,type:Number(master?.api_type?.[2])};
});}
function signature(items){return items.map(e=>JSON.stringify([e.instance?.api_slotitem_id,
  e.instance?.api_level,e.type,e.master?.api_saku,e.master?.api_tyku,e.master?.api_houm])).sort().join(',');}
function bonuses(store,target,items){
  let cache=caches.get(store);if(!cache){cache=new Map();caches.set(store,cache);}
  const key=JSON.stringify([target.ship.api_ship_id,target.master.api_stype,target.master.api_ctype,
    target.master.api_aftershipid,signature(items)]);
  if(cache.has(key))return cache.get(key);
  const panel=items.length?combatBonuses(store,{...target,items},{stat:'scout'}):{scout:0,known:true,reasons:[],matches:[]};
  const confirmed=panel.matches.filter(verifiedMatch).reduce((s,m)=>s+m.scout,0);
  const uncertain=panel.matches.some(m=>m.scout&&!verifiedMatch(m));
  const result={panel:panel.scout,known:panel.known,min:confirmed,
    max:panel.known?panel.scout:Infinity,
    reasons:[...panel.reasons,...(uncertain?['部分蓝字索敌是否计入带路尚未确认']:[])]};
  if(cache.size>=4096)cache.clear();cache.set(key,result);return result;
}
function equipmentScore(e){
  const raw=Number(e.master.api_saku||0),star=Number(e.instance.api_level??0);
  const weight={8:0.8,9:1,10:1.2,11:1.1,94:1}[e.type]??0.6;
  const improve={9:1.2,10:1.2,11:1.15,12:1.25,13:1.4,26:1,41:1.2,93:1.4,94:1.2}[e.type]??0;
  return (raw+improve*Math.sqrt(star))*weight;
}
function shipLoS(store,target){
  const before=itemsFor(store,target.before),after=itemsFor(store,target.after),current=number(target.ship.api_sakuteki);
  if(!valid(current))return {reason:`舰 ${target.id} 缺少当前索敌值`};
  if([...before,...after].some(e=>!e.master||!valid(Number(e.master.api_saku??0))))
    return {reason:`舰 ${target.id} 的装备资料不完整`};
  if(after.some(e=>!valid(Number(e.instance.api_level??0))))return {reason:`舰 ${target.id} 缺少装备改修资料`};
  const observed=current-before.reduce((s,e)=>s+Number(e.master.api_saku||0),0);
  if(!valid(observed))return {reason:`舰 ${target.id} 无法还原素索敌`};
  const old=bonuses(store,target,before),next=bonuses(store,target,after);
  const intrinsic=old.known?observed-old.panel:null;
  if(intrinsic!==null&&!valid(intrinsic))return {reason:`舰 ${target.id} 当前索敌与装备蓝字资料不一致`};
  // An observed panel includes blue bonuses. Remove the old panel bonus once,
  // then add only the new outfit's confirmed routing bonus under the sqrt.
  let lower=(intrinsic??0)+next.min,upper=(intrinsic??observed)+next.max;
  let base=(intrinsic??Math.max(0,observed-old.panel))+next.panel;
  const same=signature(before)===signature(after);
  const allVerified=after.every(e=>Number(e.instance.api_slotitem_id)<=bonusData.maxEquipmentId&&
    (VERIFIED.has(Number(e.instance.api_slotitem_id))||
      !SCOUT_IDS.has(Number(e.instance.api_slotitem_id))&&(!SCOUT_TYPES.has(e.type)||e.type===9)));
  // Same effective outfit: the server's panel already contains even a bonus
  // whose hull/class matcher cannot be evaluated from incomplete metadata.
  if(same&&allVerified){lower=upper=base=observed;}
  const equipment=after.reduce((s,e)=>s+equipmentScore(e),0);
  return {shipId:target.id,intrinsicSearch:intrinsic,bonusBefore:old.known?old.panel:null,
    bonusAfter:next.panel,routingBonus:[next.min,Number.isFinite(next.max)?next.max:null],
    baseSearchEstimate:base,shipContribution:Math.sqrt(base),
    shipContributionLower:Math.sqrt(lower),shipContributionUpper:Math.sqrt(upper),
    equipmentContribution:equipment,equipmentChanged:!same,
    status:lower===upper?'computed':'estimate',
    reasons:lower===upper?[]:[...new Set([...old.reasons,...next.reasons])]};
}
function scoreBounds(reading,coefficient){
  if(!['computed','estimate'].includes(reading?.status))return null;
  const score=reading.rawScoresByCoefficient?.[coefficient];if(!Number.isFinite(score))return null;
  const lower=reading.status==='computed'?score:reading.lowerBoundScoresByCoefficient?.[coefficient];
  const upper=reading.status==='computed'?score:reading.upperBoundScoresByCoefficient?.[coefficient];
  return {min:(Number.isFinite(lower)?lower:-Infinity)-(reading.thresholdMargin||0),
    max:Number.isFinite(upper)?upper:Infinity};
}
function losPredicate(reading,{coefficient,lt,gte}){
  const bounds=scoreBounds(reading,coefficient);if(!bounds)return null;
  if(lt!==undefined&&bounds.min>=lt||gte!==undefined&&bounds.max<gte)return false;
  if((lt===undefined||bounds.max<lt)&&(gte===undefined||bounds.min>=gte))return true;
  return null;
}
function lineOfSight(store,projected,conditions={}){
  const hq=Number(store.info.basic?.api_level);
  if(!Number.isInteger(hq)||hq<1)return {status:'unknown',reason:'缺少司令部等级'};
  const ships=projected.map(target=>shipLoS(store,target)),missing=ships.find(s=>s.reason);
  if(missing)return {status:'unknown',reason:missing.reason};
  const hqPenalty=Math.ceil(hq*0.4),thresholdMargin=hq<120?Math.ceil((121-hq)/20):0,countBonus=2*(6-projected.length);
  const equipmentPart=ships.reduce((s,r)=>s+r.equipmentContribution,0);
  const scores=key=>Object.fromEntries([1,2,3,4].map(c=>[c,
    ships.reduce((s,r)=>s+r[key],0)+equipmentPart*c-hqPenalty+countBonus]));
  const rawScoresByCoefficient=scores('shipContribution');
  const upper=scores('shipContributionUpper');
  const result={status:ships.some(s=>s.status==='estimate')?'estimate':'computed',rawScoresByCoefficient,
    scoresByCoefficient:Object.fromEntries(Object.entries(rawScoresByCoefficient).map(([c,s])=>[c,Math.round(s*100)/100])),
    lowerBoundScoresByCoefficient:scores('shipContributionLower'),
    upperBoundScoresByCoefficient:Object.fromEntries(Object.entries(upper).map(([c,s])=>[c,Number.isFinite(s)?s:null])),
    hqLevel:hq,hqPenalty,thresholdMargin,countBonus,ships,
    assumptions:['从当前索敌面板扣除原装备素值和蓝字，保留舰娘本体索敌；换装后加入已核对的蓝字索敌',
      '未确认的蓝字适用范围保留上下界；按具体带路节点系数与门槛判断']};
  if(conditions.los){const {coefficient,minimum,maximum}=conditions.los;
    result.selected={coefficient,score:result.scoresByCoefficient[coefficient],minimum:minimum??null,maximum:maximum??null,
      verdict:maximum!==undefined&&losPredicate(result,{coefficient,gte:maximum})===true?'pass':
        minimum!==undefined&&losPredicate(result,{coefficient,lt:minimum})===true?'fail':'unknown'};
  }
  return result;
}
module.exports={lineOfSight,shipLoS,scoreBounds,losPredicate};
