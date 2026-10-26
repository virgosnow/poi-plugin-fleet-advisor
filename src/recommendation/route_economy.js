'use strict';
const profiles=new WeakMap();
const NONE=Object.freeze({tier:'unconfirmed',enabled:false});
// Recommendation policy, not a victory probability or a damage formula.
// Uncertain/complex encounters retain the original combat-first scoring.
function routeDifficulty(profile){
  if(!profile||typeof profile!=='object')return NONE;
  if(profiles.has(profile))return profiles.get(profile);
  const paths=profile.routePaths?.map(p=>p.nodes)||profile.examples||[],selected=new Set(paths.flat());
  const nodes=(profile.mapPreview?.nodes||[]).filter(n=>selected.has(n.id));
  let result=NONE;
  if(nodes.length&&selected.size&&profile.status!=='unavailable'&&!profile.incomplete&&!profile.truncated){
    const fights=nodes.filter(n=>['battle','nightBattle','asw','aerialCombat','aerialRaid'].includes(n.kind));
    const enemies=fights.flatMap(n=>n.enemies||[]);
    const uncertain=fights.some(n=>n.threatStatus==='unknown'||n.compositionUncertain||!n.enemies?.length)||
      enemies.some(e=>!e.identityVerified||!Number.isInteger(e.variantRank));
    const complex=fights.some(n=>n.kind!=='battle')||enemies.some(e=>Number(e.variantRank)>=2||
      /姫|鬼|陸上|潜水|改flagship|ツ級|ネ級/.test(`${e.originalName||''} ${e.type||''}`));
    if(!uncertain&&enemies.length){
      if(complex)result={tier:'demanding',enabled:false};
      else{
        const standard=enemies.some(e=>Number(e.variantRank)>0||Number(e.priority)>=6)||fights.length>4;
        result=standard?{tier:'standard',enabled:true,shipCeiling:320,excessWeight:0.2,costWeight:8,specialCeiling:900}:
          {tier:'routine',enabled:true,shipCeiling:260,excessWeight:0.1,costWeight:10,specialCeiling:400};
      }
    }
  }
  profiles.set(profile,result);return result;
}
function usefulPower(value,difficulty){
  return difficulty.enabled?Math.min(value,difficulty.shipCeiling)+
    Math.max(0,value-difficulty.shipCeiling)*difficulty.excessWeight:value;
}
function economicalReplacements(rows,roster,{lockedIds,score,difficulty}){
  if(!difficulty.enabled)return [];
  const {hasDuplicateShipFamily}=require('./context'),best=new Map();
  for(const row of roster)best.set(row.stype,Math.max(best.get(row.stype)||0,score(row)));
  const types=old=>[7,11,18].includes(old.stype)?[7,11,18]:[8,9,10].includes(old.stype)?[8,9,10,5,6,3,4,7,11,18]:[];
  const cost=r=>r.fuel+r.ammo,choices=[];
  for(let index=0;index<rows.length;index++){
    const old=rows[index];if(lockedIds.has(old.id)||cost(old)<85)continue;
    const available=roster.filter(row=>types(old).includes(row.stype)&&!rows.some(r=>r.id===row.id)&&
      cost(row)<=cost(old)*0.8&&score(row)>=(best.get(row.stype)||0)*0.85&&
      usefulPower(score(row),difficulty)>=usefulPower(score(old),difficulty)*0.85&&
      !hasDuplicateShipFamily(rows.map((r,i)=>i===index?row:r)))
      .sort((a,b)=>Number(b.stype===old.stype)-Number(a.stype===old.stype)||
        (usefulPower(score(b),difficulty)*20-cost(b)*difficulty.costWeight)-
        (usefulPower(score(a),difficulty)*20-cost(a)*difficulty.costWeight)||a.id-b.id);
    if(available.length)choices.push({index,beforeId:old.id,row:available[0],gain:cost(old)-cost(available[0])});
  }
  return choices.sort((a,b)=>b.gain-a.gain||a.index-b.index);
}
module.exports={routeDifficulty,usefulPower,economicalReplacements};
