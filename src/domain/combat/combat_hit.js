'use strict';
// Reference only: https://wikiwiki.jp/kancolle/命中と回避について
// The enemy catalogue has no level/luck/equipment-accuracy fields. A daytime
// shelling hit term of 100 is a neutral assumption, not observed enemy data.
const finite=n=>Number.isFinite(n)&&n>=0;
// Estimated innate enemy torpedo accuracy from the Wiki's Vita-derived table;
// browser verification is incomplete. Unknown ships remain explicitly assumed.
const TORPEDO_BONUS=Object.freeze({
  '駆逐イ級':0,'駆逐イ級後期型':45,'駆逐イ級後期型elite':50,
  '駆逐ロ級':0,'駆逐ロ級後期型':55,'駆逐ロ級後期型elite':60,
  '駆逐ハ級':0,'駆逐ハ級elite':0,'駆逐ハ級後期型':65,'駆逐ハ級後期型elite':70,
  '駆逐ニ級':0,'駆逐ニ級elite':0,'駆逐ニ級後期型':75,'駆逐ニ級後期型elite':80,
  '軽巡ホ級':0,'軽巡ホ級elite':0,'軽巡ホ級flagship':25,
  '軽巡ヘ級':0,'軽巡ヘ級elite':0,'軽巡ヘ級flagship':25,
  '軽巡ト級':0,'軽巡ト級elite':0,'軽巡ツ級':50,'軽巡ツ級elite':60,
  '雷巡チ級':20,'雷巡チ級elite':30,'雷巡チ級flagship':60,
  '重巡リ級':0,'重巡リ級elite':0,'重巡リ級flagship':0,'重巡リ級改flagship':65,
  '重巡ネ級':60,'重巡ネ級elite':70,'潜水カ級':20,'潜水カ級elite':30,'潜水カ級flagship':35,
  '潜水ヨ級':25,'潜水ヨ級elite':30,'潜水ヨ級flagship':40,
  '潜水ソ級':50,'潜水ソ級elite':60,'潜水ソ級flagship':70,
  '戦艦レ級':50,'戦艦レ級elite':65
});
const TORPEDO_ACCURACY_FORMATION={lineAhead:1,doubleLine:.8,diamond:.4,echelon:.72,lineAbreast:.3,
  combinedFirst:.75,combinedSecond:1,combinedThird:.4,combinedFourth:1.2};
function enemyTorpedoBonus(name){return Object.hasOwn(TORPEDO_BONUS,name)?TORPEDO_BONUS[name]:null;}
function evadeTerm(evasion,luck,formation='lineAhead',fuel=1,phase='shelling'){
  if(!finite(evasion)||!finite(luck)||!finite(fuel))return null;
  const torpedo=phase==='torpedo'||phase==='openingTorpedo';
  const factors=torpedo?{lineAhead:1,doubleLine:1,diamond:1.1,echelon:1.3,lineAbreast:1.4}:
    phase==='night'?{lineAhead:1,doubleLine:1,diamond:1,echelon:1.3,lineAbreast:1.2}:
    {lineAhead:1,doubleLine:1,diamond:1.1,echelon:1.4,lineAbreast:1.3};
  const formationFactor=phase==='air'?1:(factors[formation]||1);
  const raw=Math.floor(formationFactor*(evasion+Math.sqrt(2*luck)));
  const capped=raw<40?raw:raw<65?Math.floor(40+3*Math.sqrt(raw-40)):Math.floor(55+2*Math.sqrt(raw-65));
  return capped-Math.max(0,75-Math.floor(fuel*100+1e-8));
}
function referenceHit(attacker,defender,{phase,defenderFormation='lineAhead',attackerFormation='lineAhead',fuel=1,combined=false,attackPower}={}){
  if(attacker?.side!=='enemy'||defender?.side!=='own'||!['air','shelling','night','torpedo','openingTorpedo'].includes(phase))return null;
  let avoid=evadeTerm(defender.evasion,defender.luck,defenderFormation,fuel,phase);
  if(avoid===null)return null;
  if(phase==='night'&&[5,6].includes(defender.stype))avoid+=5;
  const torpedo=phase==='torpedo'||phase==='openingTorpedo';
  if(torpedo&&!finite(attackPower))return null;
  if(torpedo&&defender.torpedoEvasionBonus===null)return null;
  // Use identity-checked enemy catalogue references when available. Other
  // enemies retain the explicitly documented neutral base of 100 (85+15).
  // An unlisted innate torpedo bonus is unknown, not a verified zero.
  const formation=TORPEDO_ACCURACY_FORMATION[attackerFormation];
  if(torpedo&&!finite(formation))return null;
  const stats=attacker.torpedoReferenceStats;
  const base=stats&&finite(stats.level)&&finite(stats.luck)&&Number.isFinite(stats.equipmentAccuracy)?
    85+2*Math.sqrt(stats.level)+1.5*Math.sqrt(stats.luck)+stats.equipmentAccuracy:100;
  const term=torpedo?Math.floor((base+Math.floor(attackPower/5)+(attacker.torpedoAccuracyBonus??0))*formation):
    phase==='air'?95:phase==='night'?80:100;
  if(torpedo)avoid=Math.floor(avoid+(defender.torpedoEvasionBonus||0));
  const cond=defender.condition;
  const morale=finite(cond)?cond<=19?1.4:cond<=29?1.2:cond>=(combined?50:53)?0.7:1:1;
  return (Math.floor(Math.min(96,Math.max(10,term-avoid)*morale))+1)/100;
}
module.exports={evadeTerm,referenceHit,enemyTorpedoBonus};
