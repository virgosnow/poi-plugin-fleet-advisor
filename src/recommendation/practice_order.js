'use strict';
// Generate a bounded set of position-only alternatives. The final choice must
// still pass practice quest constraints and a full battle/XP comparison.
const {projectedHull}=require('../domain/combat/combat_projection');
const {deriveOwnNight}=require('../domain/combat/combat_battle');
const CARRIERS=new Set([7,11,18]),BATTLESHIPS=new Set([8,9,10,12]);
const number=value=>Number.isFinite(value)?Math.max(0,value):0;
function practiceOrderCandidates(store,scheme,args,enemy){
  const ships=scheme.ships,held=new Set(),targets=new Set(args.trainingShipIds||[]);
  (args.slots||[]).forEach((slot,index)=>{
    if(slot&&(args.trainingShipIds===undefined||slot.pin||Object.keys(slot.keep||{}).length))held.add(index);
  });
  // Explicit training goals stay where the chosen candidate placed them.
  ships.forEach((ship,index)=>{if(targets.has(ship.id))held.add(index);});
  const free=ships.map((_,index)=>index).filter(index=>!held.has(index));
  if(free.length<2)return [];
  let readings;try{readings=ships.map(ship=>projectedHull(store,ship));}catch(_){return [];}
  if(readings.some(row=>row.status!=='known'))return [];
  const pureAsw=enemy.submarines===enemy.ships.length,hasSubs=enemy.submarines>0;
  const secondRound=readings.some(row=>BATTLESHIPS.has(row.stype))||enemy.ships.some(row=>BATTLESHIPS.has(Number(row.master.api_stype)));
  const scores=ships.map((entry,i)=>{
    const ship=readings[i],carrier=CARRIERS.has(ship.stype);
    let day=ship.submarine?0:carrier?number(ship.carrierPower):number(ship.fire)+5;
    if(hasSubs&&ship.asw?.normal)day=number(ship.asw.power);
    else if(pureAsw)day=0;
    let night=number(ship.nightBase);
    if(carrier){let reading;try{reading=deriveOwnNight(store,entry);}catch(_){}night=reading?.available?number(reading.power):0;}
    return {day,night};
  });
  const seen=new Set([JSON.stringify(ships.map(ship=>ship.id))]),out=[];
  const scoreTypes=secondRound?['day','night']:['night'];
  for(const field of scoreTypes){
    const sorted=free.slice().sort((a,b)=>scores[b][field]-scores[a][field]||a-b);
    const ordered=ships.slice();free.forEach((index,i)=>{ordered[index]=ships[sorted[i]];});
    const key=JSON.stringify(ordered.map(ship=>ship.id));if(seen.has(key))continue;seen.add(key);
    out.push({...scheme,ships:ordered});
  }
  return out;
}
module.exports={practiceOrderCandidates};
