'use strict';
// Combat-balance research primitives. The comparable inputs are bounded
// attack opportunities on the same formation, not player panel totals or
// search-ranking weights. They are reference values, not hit probabilities.
const attack=require('./attack_power');
const {projectShip}=require('../fleet/fleet_metrics');
const {aswAttack,aswDamage}=require('./asw_combat');
const {attackPowers}=require('./carrier_cutin');
const {hullStat}=require('./night_cutin');
const night=require('./night_cutin');
const {torpedoPower}=require('./opening_attack_power');
const {combatBonuses}=require('./equipment_bonuses');
const SURFACE_CARRIERS=new Set([7,11,18]);
const SUBMARINES=new Set([13,14]);
const finite=value=>Number.isFinite(value)&&value>=0;
const stat=value=>{const v=Array.isArray(value)?value[0]:value;return v===null||v===undefined||v===''?NaN:Number(v);};
const type=master=>Number(master?.api_type?.[2]);
// This is a deterministic normal-hit reference after a representative armor
// roll, not an expected hit/critical chance or an actual fight simulation.
function referenceDamage(power,armor,ammo=1){
  if(![power,armor,ammo].every(finite))return null;
  return Math.max(0,Math.floor((power-armor)*Math.min(1,ammo)));
}
function projectedHull(store,entry){
  const ship=store.info.ships[entry.id],master=store.const.$ships[ship?.api_ship_id];
  if(!ship||!master||!finite(stat(ship.api_maxhp))||stat(ship.api_maxhp)===0||!finite(stat(ship.api_soukou)))return {status:'unknown',reason:'舰娘耐久或装甲资料不足'};
  const target=projectShip(store,entry.id,{slots:entry.slots,ex:entry.ex});
  const armorItems=state=>(state.slots||[]).concat(state.ex).filter(id=>id>0).map(id=>{
    const item=store.info.equips[id],gear=store.const.$equips[item?.api_slotitem_id];
    return gear?Number(gear.api_souk||0):NaN;
  });
  const beforeArmor=armorItems(target.before),afterArmor=armorItems(target.after);
  if([...beforeArmor,...afterArmor].some(n=>!Number.isFinite(n)))return {status:'unknown',reason:'计划配装的装甲资料不足'};
  const armor=Math.max(0,stat(ship.api_soukou)-beforeArmor.reduce((a,b)=>a+b,0)+afterArmor.reduce((a,b)=>a+b,0));
  const fire=attack.fireBase(target,store),torpedo=attack.torpedoPanel(target,store),stype=Number(master.api_stype);
  const asw=aswAttack(store,target),items=target.items||[];
  // All aircraft are reported separately even when they cannot attack. A
  // surface-only comparison must not silently drop their air-phase effects.
  const hasAircraft=items.some(e=>[6,7,8,9,10,11,25,26,41,45,56,57,58,59].includes(type(e.master))&&
    (target.after.slots||[]).indexOf(e.id)>=0&&Number(master.api_maxeq?.[(target.after.slots||[]).indexOf(e.id)])>0);
  const armedCarrier=items.some(e=>[7,8,57,58].includes(type(e.master))&&
    (target.after.slots||[]).indexOf(e.id)>=0&&Number(master.api_maxeq?.[(target.after.slots||[]).indexOf(e.id)])>0);
  const carrier=SURFACE_CARRIERS.has(stype),submarine=SUBMARINES.has(stype);
  const carrierPower=carrier&&armedCarrier?attackPowers(target,store,[]).basePower:null;
  // Preserve pre-cap values so formation and damage penalties are applied
  // before the cap, rather than multiplying an already-capped attack.
  const bonuses=carrier&&armedCarrier?combatBonuses(store,target):null;
  const bomberItems=items.filter(e=>[7,8,57,58].includes(type(e.master))&&(target.after.slots||[]).includes(e.id));
  const carrierRaw=carrier&&armedCarrier&&finite(fire.value)&&bonuses?.known?
    Math.floor((fire.value+bomberItems.reduce((n,e)=>n+Number(e.master.api_raig||0),0)+bonuses.torpedo+
      Math.floor((bomberItems.reduce((n,e)=>n+Number(e.master.api_baku||0),0)+bonuses.bomber)*1.3))*1.5)+55:null;
  const nightBase=night.surfacePower(target,store),nightModes=night.surfaceModes(target);
  const torpedoReading=torpedoPower(target,store);
  const torpedoGear=items.filter(e=>[5,21,32].includes(type(e.master)));
  const torpedoStars=torpedoGear.map(e=>stat(e.instance?.api_level));
  const torpedoRaw=finite(torpedo.value)&&torpedoStars.every(finite)?torpedo.value+5+
    torpedoGear.reduce((n,e,i)=>n+(type(e.master)===32?.2*torpedoStars[i]:1.2*Math.sqrt(torpedoStars[i])),0):null;
  const rangeValues=[master.api_leng,...items.map(e=>e.master?.api_leng)].map(stat).filter(finite);
  const intrinsicTorpedo=hullStat(target,'api_raig',1);
  const midget=items.some(e=>type(e.master)===22&&/甲標的/.test(e.master?.api_name||''));
  const level=stat(ship.api_lv),openingTorpedo=midget?true:submarine?(finite(level)?level>=10:null):false;
  const actualHp=stat(ship.api_nowhp),hpEstimated=!finite(actualHp)||actualHp>stat(ship.api_maxhp);
  return {status:'known',id:entry.id,stype,hp:stat(ship.api_maxhp),armor,hpEstimated,
    fire:fire.value,torpedo:torpedo.value,torpedoPower:torpedoReading.power,torpedoRaw,
    nightBase:nightBase.basePower,nightModes,nightFixed:night.fixedTerm(target,false),
    range:rangeValues.length?Math.max(...rangeValues):null,
    initialHp:hpEstimated?stat(ship.api_maxhp):actualHp,
    condition:finite(stat(ship.api_cond))?stat(ship.api_cond):null,
    carrierPower,carrierRaw,armedCarrier,hasAircraft,submarine,asw,
    intrinsicTorpedo,openingTorpedo,
    unknownReasons:[...(fire.reasons||[]),...(torpedo.reasons||[])]};
}
function attackFor(ship,enemy,phase,context={}){
  if(enemy.kind==='submarine'){
    if(!ship.asw||ship.asw.status!=='known')return null;
    if(phase==='openingAsw'&&!ship.asw.opening||phase==='shelling'&&!ship.asw.normal)return 0;
    if(!['openingAsw','shelling'].includes(phase))return 0;
    const damage=aswDamage(ship.asw,enemy,{formation:'lineAbreast'});
    return damage.status==='unknown'?null:damage.mean;
  }
  // Land target effects and carrier eligibility require target-specific
  // multiplers; do not substitute a surface shelling number.
  if(enemy.kind==='installation')return null;
  if(phase==='night')return ship.submarine||SURFACE_CARRIERS.has(ship.stype)?null:finite(ship.fire)&&finite(ship.torpedo)?referenceDamage(attack.cap(ship.fire+ship.torpedo,360),enemy.armor):null;
  if(phase==='shelling'){
    if(ship.submarine)return 0;
    if(context.hasLiveSubmarines){
      if(!ship.asw||ship.asw.status!=='known')return null;
      if(ship.asw.normal)return 0; // Ships able to ASW prioritize submarines.
    }
    if(SURFACE_CARRIERS.has(ship.stype))return ship.armedCarrier&&finite(ship.carrierPower)?referenceDamage(ship.carrierPower,enemy.armor):ship.armedCarrier?null:0;
    return finite(ship.fire)?referenceDamage(attack.cap(ship.fire+5,220),enemy.armor):null;
  }
  if(phase==='openingTorpedo'&&ship.openingTorpedo===null)return null;
  if(phase==='openingTorpedo'&&!ship.openingTorpedo)return 0;
  if(phase==='torpedo'||phase==='openingTorpedo'){
    if(phase==='torpedo'&&SURFACE_CARRIERS.has(ship.stype))return 0;
    if(phase==='torpedo'&&!finite(ship.intrinsicTorpedo))return null;
    if(phase==='torpedo'&&ship.intrinsicTorpedo===0)return 0;
    return finite(ship.torpedo)?referenceDamage(attack.cap(ship.torpedo+5,180),enemy.armor):null;
  }
  return 0;
}
// A fixed-target-set reference only: divide each opportunity equally among
// eligible targets, cap each *individual hit* and then cap total target damage.
// This eliminates greedy best-target selection and preserves monotonicity for
// a fixed target set. It does not model sink-dependent targeting, hit chance,
// mutual suppression, damage-state transitions or a probability distribution.
// Mixed target eligibility is not yet modelled here and must remain unknown.
function coverage(attackers,targets,phases,attackValue){
  if(!attackers.length||!targets.length||targets.some(t=>!finite(t.hp)||t.hp===0||!finite(t.armor)))return {status:'unknown'};
  const kinds=new Set(targets.map(t=>t.kind).filter(Boolean));
  if(kinds.size>1)return {status:'unknown'};
  const hp=targets.map(t=>t.hp),damage=targets.map(()=>0);let unknown=false;
  for(const phase of phases)for(const actor of attackers){
    for(let i=0;i<targets.length;i++){
      const hasLiveSubmarines=kinds.has('submarine');
      const value=attackValue(actor,targets[i],phase,{hasLiveSubmarines});
      if(value===null||!finite(value)){unknown=true;continue;}
      damage[i]+=Math.min(hp[i],value)/targets.length;
    }
  }
  if(unknown)return {status:'unknown'};
  return {status:'known',coverage:damage.reduce((n,v,i)=>n+Math.min(1,v/hp[i]),0),targets:targets.length,
    hardestRemaining:Math.max(...damage.map((v,i)=>1-Math.min(1,v/hp[i])))};
}
function enemyAttackFor(enemy,ship,phase){
  if(ship.submarine||enemy.kind!=='surface'||enemy.carrier)return null;
  if(phase==='shelling')return finite(enemy.fire)?referenceDamage(attack.cap(enemy.fire+5,220),ship.armor):null;
  if(phase==='torpedo')return !finite(enemy.torpedo)?null:enemy.torpedo===0?0:referenceDamage(attack.cap(enemy.torpedo+5,180),ship.armor);
  if(phase==='night')return finite(enemy.fire)&&finite(enemy.torpedo)?referenceDamage(attack.cap(enemy.fire+enemy.torpedo,360),ship.armor):null;
  return 0;
}
// Narrow first integration: a daytime surface-only encounter without aircraft
// or submarines. More complicated encounters must be evaluated separately,
// rather than silently presented as a complete fleet comparison.
function surfaceBattle(friendly,enemies){
  if(!friendly.length||!enemies.length)return {status:'unknown',reasons:['舰队或敌编成缺失']};
  if(friendly.some(s=>s.status!=='known'||s.submarine||SURFACE_CARRIERS.has(s.stype))||
     enemies.some(e=>e.kind!=='surface'||e.carrier))return {status:'unknown',reasons:['航空、潜艇或特殊目标的战斗比较尚待完成']};
  const outgoing=coverage(friendly,enemies,['openingTorpedo','shelling','torpedo'],attackFor);
  const incoming=coverage(enemies,friendly,['shelling','torpedo'],enemyAttackFor);
  if(outgoing.status!=='known'||incoming.status!=='known')return {status:'unknown',reasons:['攻击能力或敌舰数据不足']};
  // Coverage measures incapacitation-equivalent opportunities, capped by the
  // number of opposing ships. It is neither hit probability nor win rate.
  // No random target selection, accuracy, defensive damage state or CI is
  // assumed. A zero incoming reference needs further evidence, not division.
  if(incoming.coverage<=0)return {status:'unknown',reasons:['敌方有效攻击无法比较']};
  const balance=require('./combat_balance').compare(outgoing.coverage,incoming.coverage);
  return balance?{status:'experimental',balance,outgoing,incoming,
    reasons:['按固定目标集合的普通命中参考','未模拟命中、目标变化、损伤变化及特殊攻击']}:{status:'unknown',reasons:['战力输入不足']};
}
module.exports={referenceDamage,projectedHull,attackFor,coverage,enemyAttackFor,surfaceBattle};
