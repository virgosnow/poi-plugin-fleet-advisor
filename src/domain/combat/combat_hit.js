'use strict';
// Reference only: https://wikiwiki.jp/kancolle/命中と回避について
// The enemy catalogue has no level/luck/equipment-accuracy fields. A daytime
// shelling hit term of 100 is a neutral assumption, not observed enemy data.
const finite=n=>Number.isFinite(n)&&n>=0;
function evadeTerm(evasion,luck,formation='lineAhead',fuel=1,phase='shelling'){
  if(!finite(evasion)||!finite(luck)||!finite(fuel))return null;
  const factors=phase==='night'?{lineAhead:1,doubleLine:1,diamond:1,echelon:1.3,lineAbreast:1.2}:
    {lineAhead:1,doubleLine:1,diamond:1.1,echelon:1.4,lineAbreast:1.3};
  const formationFactor=phase==='air'?1:(factors[formation]||1);
  const raw=Math.floor(formationFactor*(evasion+Math.sqrt(2*luck)));
  const capped=raw<40?raw:raw<65?Math.floor(40+3*Math.sqrt(raw-40)):Math.floor(55+2*Math.sqrt(raw-65));
  return capped-Math.max(0,75-Math.floor(fuel*100+1e-8));
}
function referenceHit(attacker,defender,{phase,defenderFormation='lineAhead',fuel=1,combined=false}={}){
  if(attacker?.side!=='enemy'||defender?.side!=='own'||!['air','shelling','night'].includes(phase))return null;
  let avoid=evadeTerm(defender.evasion,defender.luck,defenderFormation,fuel,phase);
  if(avoid===null)return null;
  if(phase==='night'&&[5,6].includes(defender.stype))avoid+=5;
  const term=phase==='air'?95:phase==='night'?80:100;
  const cond=defender.condition;
  const morale=finite(cond)?cond<=19?1.4:cond<=29?1.2:cond>=(combined?50:53)?0.7:1:1;
  return (Math.floor(Math.min(96,Math.max(10,term-avoid)*morale))+1)/100;
}
module.exports={evadeTerm,referenceHit};
