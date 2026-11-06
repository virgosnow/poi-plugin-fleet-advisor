'use strict';
// Night scout activation is a reference probability, not an observed event.
// https://wikiwiki.jp/kancolle/九八式水上偵察機(夜偵)#NightContact
// Enemy aircraft, level, and proficiency are private; their loadout is assumed.
const isNightScout=master=>Number(master?.api_type?.[2])===10&&Number(master?.api_type?.[3])===50;
function row(master,level,slot,shipIndex){
 const saku=Number(master?.api_saku),accuracy=Number(master?.api_houm);
 if(!Number.isFinite(level)||level<=0||!Number.isFinite(saku)||saku<=0||!Number.isInteger(accuracy)||accuracy<1||accuracy>3)return null;
 return {shipIndex,slot,rate:Math.min(1,Math.floor(Math.sqrt(saku*level))*0.04),bonus:3+accuracy*2};
}
function friendly(store,scheme){
 const candidates=[];let incomplete=false;
 for(const [shipIndex,entry] of (scheme?.ships||[]).entries()){
  const ship=store.info.ships[entry.id],master=store.const.$ships[ship?.api_ship_id];
  for(const [slot,id] of (entry.slots||[]).entries()){
   if(id<=0)continue;
   const equip=store.const.$equips[store.info.equips[id]?.api_slotitem_id];
   if(!isNightScout(equip))continue;
   const capacity=master?.api_maxeq?.[slot];if(!Number.isInteger(capacity)){incomplete=true;continue;}
   if(capacity<=0)continue;
   const candidate=row(equip,Number(ship?.api_lv),slot,shipIndex);
   if(candidate)candidates.push(candidate);else incomplete=true;
  }
 }
 return {candidates,incomplete};
}
function opposing(reference){
 const candidates=[];let incomplete=false;
 for(const [shipIndex,ship] of (reference?.ships||[]).entries())for(const equip of ship.slots||[]){
  if(!isNightScout(equip.master))continue;
  const capacity=ship.master?.api_maxeq?.[equip.slot];if(!Number.isInteger(capacity)){incomplete=true;continue;}
  if(capacity<=0)continue;
  const candidate=row(equip.master,Number(ship.level),equip.slot,shipIndex);
  if(candidate)candidates.push(candidate);else incomplete=true;
 }
 return {candidates,incomplete};
}
// Zero versus zero air power is parity only if neither side launches an
// ordinary aerial attack. When an attack phase occurs at 0 vs 0 the game
// awards the player air supremacy; the enemy then loses air control.
// https://wikiwiki.jp/kancolle/航空戦
function statesForContact(states,ownAir,enemyAir){
 const attacks=readings=>(readings||[]).some(r=>(r.attacks||[]).some(a=>Number(a.referencePlanes??a.planesMax)>0));
 const airborne=attacks(ownAir)||attacks(enemyAir);
 return [...new Set((states||[]).map(state=>state==='noAirBattle'&&airborne?'supremacy':state))];
}
// `state` is from our perspective; when no fighters conduct air combat it is
// treated as parity. Sources disagree on whether own parity can activate;
// the dedicated night-scout analysis and cited verification say enemy only.
function canContact(side,state){
 if(state==='openingNight')return true;
 if(side==='own')return ['supremacy','superiority','disadvantage'].includes(state);
 return ['superiority','parity','disadvantage','loss','noAirBattle'].includes(state);
}
function activate(reading,state,side,rng){
 if(!canContact(side,state))return 0;
 // Independent rolls across different ships remain an approximation.
 for(const candidate of reading?.candidates||[])if(rng()<candidate.rate)return candidate.bonus;
 return 0;
}
module.exports={friendly,opposing,statesForContact,canContact,activate};
