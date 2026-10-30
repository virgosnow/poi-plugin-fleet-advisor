'use strict';
// Candidate loadout vs one actual installation. This adapter reuses the same
// target effects and reference attack formulas as the existing ground badge;
// it does not calculate hit rates or pretend unknown plane losses are exact.
const {projectShip}=require('../fleet/fleet_metrics');
const {equipmentEffects,carrierGroundState,groundBomber,routeGroundTargets,flags}=require('./installation_attack');
const attack=require('./attack_power');
const catalog=new Map(require('../../../data/sortie/enemy_catalog.json').enemies.map(e=>[e.apiId,e]));
const CARRIERS=new Set([7,11,18]),SUBMARINES=new Set([13,14]);
// Only aircraft that can change ground-attack eligibility or its multipliers
// need a surviving-plane check here. Fighters and ordinary reconnaissance
// still matter elsewhere (air control/observation), neither of which this
// ground shelling reference claims to simulate.
// https://wikiwiki.jp/kancolle/対地攻撃
// https://wikiwiki.jp/kancolle/航空戦
const AIR=new Set([6,7,8,9,10,11,25,26,41,45,56,57,58,59]);
const GROUND_SENSITIVE_AIR=new Set([7,8,11,45,57,58]);
const valid=n=>Number.isFinite(n)&&n>=0;
function targetClass(enemy){
  if(enemy?.status!=='known'||enemy.kind!=='installation'||!Number.isInteger(enemy.apiId))return null;
  const master=catalog.get(enemy.apiId);
  if(!master)return null;
  // Reuse the badge's target classifier, including its deliberate exclusions.
  const id='ground',profile={examples:[[id]],mapPreview:{nodes:[{id,kind:'battle',
    enemies:[{originalName:master.name||master.kcwikiNameJa||''}]}]}};
  const targets=routeGroundTargets(profile);
  return targets.length===1?targets[0]:null;
}
function buildGroundAttack(store,entry,enemy,{slotRemaining,nightCarrier}={}){
  const category=targetClass(enemy),ship=store?.info?.ships?.[entry?.id];
  const master=store?.const?.$ships?.[ship?.api_ship_id];
  if(!category)return {status:'unknown',day:{eligible:null},night:{eligible:null},reasons:['陆上目标类型待确认']};
  if(!ship||!master||!Array.isArray(entry?.slots)||entry.slots.length>6)
    return {status:'unknown',category,day:{eligible:null},night:{eligible:null},reasons:['舰娘或装备槽资料不足']};
  const ids=entry.slots.concat(entry.ex).filter(id=>id>0);
  if(ids.some(id=>!store.info.equips?.[id]||!store.const.$equips?.[store.info.equips[id].api_slotitem_id]))
    return {status:'unknown',category,day:{eligible:null},night:{eligible:null},reasons:['装备资料缺失']};
  const target=projectShip(store,entry.id,{slots:entry.slots,ex:entry.ex});
  const stype=Number(master.api_stype),carrier=attack.groundAviation(master,target.items),hybrid=carrier&&stype===22;
  const reasons=[],airItems=target.items.map(item=>{
    if(!AIR.has(Number(item.type))||!GROUND_SENSITIVE_AIR.has(Number(item.type))&&!flags(item.master).length)return item;
    const slot=entry.slots.indexOf(item.id),capacity=master.api_maxeq?.[slot];
    if(slot<0||!Number.isInteger(capacity)||capacity<0){reasons.push('飞机槽容量待确认');return {...item,planes:null};}
    const remaining=slotRemaining?.[slot];
    if(remaining===undefined){if(capacity>0)reasons.push('沿途飞机损耗待确认，暂按满载参考');return {...item,planes:capacity};}
    const range=Number.isInteger(remaining)?[remaining,remaining]:remaining;
    if(!Array.isArray(range)||range.length!==2||!range.every(Number.isInteger)||range[0]<0||range[1]<range[0]||range[1]>capacity){
      reasons.push('飞机剩余数量待确认');return {...item,planes:null};
    }
    if(range[0]===0&&range[1]>0){reasons.push('飞机是否耗尽待确认');return {...item,planes:null};}
    // Even a depleted aircraft still supplies its equipment anti-installation
    // multiplier; carrier attack eligibility is decided separately from the
    // actual surviving count. See https://wikiwiki.jp/kancolle/対地攻撃.
    return {...item,planes:range[0]};
  });
  const dayEffect=equipmentEffects(target.items,category,{stype}),nightEffect=equipmentEffects(target.items,category,{stype,night:true});
  if(!dayEffect||!nightEffect)return {status:'unknown',category,day:{eligible:null},night:{eligible:null},reasons:['陆上目标倍率待确认']};
  reasons.push(...dayEffect.unknown,...nightEffect.unknown);
  const baseDay=attack.fireBase(target,store),baseNight=attack.fireBase(target,store,{night:true});
  reasons.push(...baseDay.reasons,...baseNight.reasons);
  const bare=target.items.length===0,torpedo=bare?attack.torpedoPanel(target,store):null;
  if(bare)reasons.push(...torpedo.reasons);
  const carrierState=carrier?carrierGroundState(airItems):'ready';
  // Whether a depleted anti-installation dive bomber still contributes its
  // bombing stat to the carrier shelling formula is unverified. Retain the
  // equipped-stat calculation as a clearly disclosed reference, not a fact.
  const depletedGroundBomb=carrier&&carrierState==='ready'&&airItems.some(e=>groundBomber(e.master)&&e.planes===0);
  // Submarines normally skip daytime shelling; special-type amphibious tanks
  // let them shell only installation targets. Source: Wiki 対地攻撃#AGBehavior.
  const subLandCraft=SUBMARINES.has(stype)&&target.items.some(item=>flags(item.master).some(tag=>tag==='kami'||tag==='katsu'));
  const dayEligible=SUBMARINES.has(stype)?subLandCraft:carrierState==='unknown'?null:carrierState==='ready';
  // The current badge does not model carrier night attacks on installations;
  // keep that question unknown rather than claiming they never attack.
  const unableAtNight=nightCarrier?.status==='known'&&nightCarrier.available===false;
  const nightEligible=carrier&&!hybrid?(unableAtNight?false:null):true;
  if(nightEligible===null)reasons.push('空母夜间对地攻击条件待确认');
  if(carrierState==='unknown')reasons.push('对地航空装备或载机数量待确认');
  const mode=attack.groundNightMode(target);
  // DD-specific night CI combinations may still use a main gun plus torpedo
  // against land (with torpedo stat zero). The shared generic ground mode does
  // not encode all those special modes or their activation precedence.
  const specialKnown=!(stype===2&&target.items.some(e=>[1,2,3,38].includes(Number(e.type)))&&
    target.items.some(e=>[5,32].includes(Number(e.type))));
  return {status:reasons.length?'partial':'known',category,enemyId:enemy.apiId,shipId:entry.id,
    day:{eligible:dayEligible,effect:dayEffect,base:baseDay},
    night:{eligible:nightEligible,effect:nightEffect,base:baseNight,mode,bare,torpedo,specialKnown},
    target,reasons:[...new Set(reasons)],
    assumptions:['普通命中参考，不包含敌装甲、命中率或战损','夜战特殊攻击的发动率需要另外判断',
      ...(depletedGroundBomb?['假设已全灭的对地舰爆爆装仍计入，实际效果尚未确认']:[])]};
}
// Formation and ship damage-state multipliers are applied before the cap.
// `special` selects the existing equipment-dependent night mode, but callers
// must decide its actual activation; it is not assumed to always trigger.
function groundAttackPower(reading,{night=false,formation=1,damage=1,special=false,nightContact=0}={}){
  const part=night?reading?.night:reading?.day;
  if(!part||part.eligible===null)return {status:'unknown',power:null,hits:null};
  if(part.eligible===false)return {status:'blocked',power:0,hits:0};
  if(!valid(formation)||!valid(damage)||damage>1||![0,5,7,9].includes(nightContact))return {status:'unknown',power:null,hits:null};
  // Aircraft losses can change carrier attack eligibility and multipliers.
  // Do not let a stale full-capacity reference become a confirmed attack.
  if(reading.reasons?.some(r=>/飞机|载机/.test(r)))return {status:'unknown',power:null,hits:null};
  if(night&&special&&part.specialKnown===false)return {status:'unknown',power:null,hits:null};
  if(night&&part.bare){
    // Unarmed night attacks are the Wiki's specific exception: fire AND
    // torpedo contribute against land, with no ordinary +5 shelling constant.
    if(!Number.isFinite(part.base?.value)||!Number.isFinite(part.torpedo?.value))return {status:'unknown',power:null,hits:null};
    if([2,3,13,14].includes(Number(reading.target.master.api_stype)))return {status:'unknown',power:null,hits:null};
    return {status:'known',power:attack.cap((part.base.value+part.torpedo.value+nightContact)*formation*damage,360),hits:1};
  }
  const mode=night&&special?part.mode:{multiplier:1,hits:1};
  // Wiki's current 対地攻撃 formula includes the +5 minimum for equipped
  // night attacks; night contact is added only when explicitly supplied.
  const base=night&&Number.isFinite(part.base?.value)?{...part.base,value:part.base.value+nightContact}:part.base;
  const power=attack.groundAttack(reading.target,part.effect,base,
    {night,multiplier:mode.multiplier,formation:formation*damage,groundBomber});
  return !valid(power)?{status:'unknown',power:null,hits:null}:{status:'known',power,hits:mode.hits};
}
module.exports={targetClass,buildGroundAttack,groundAttackPower};
