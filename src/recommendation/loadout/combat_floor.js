'use strict';
// Compare a joint land-base refit with its already route-valid fleet. These
// are recommendation safeguards, not restrictions on manual equipment.
const {projectShip}=require('../../domain/fleet/fleet_metrics');
const {openingASW}=require('../../domain/combat/opening_asw');
const guns=new Set([1,2,3]),fighters=new Set([6,45,56]),spotters=new Set([10,11]);
const carriers=new Set([7,11,18]);

function createCombatFloor(store,baseline,profile){
  const surface=profile?.counts?.surface?.maximum;
  const day=!Number.isFinite(surface)||surface>Number(profile?.counts?.night?.maximum||0);
  const asw=Number(profile?.counts?.asw?.maximum||0)>0||Number(profile?.counts?.mixedAsw?.maximum||0)>0;
  const type=id=>Number(store.const.$equips[store.info.equips[id]?.api_slotitem_id]?.api_type?.[2]);
  const facts=new Map();
  for(const entry of baseline.ships){
    const ship=store.info.ships[entry.id],master=store.const.$ships[ship.api_ship_id],types=entry.slots.map((id,k)=>{
      const value=type(id),capacity=Number(master.api_maxeq?.[k]??ship.api_onslot?.[k]??0);
      return (fighters.has(value)||spotters.has(value)||[7,8,57].includes(value))&&!(capacity>0)?null:value;
    });
    const count=set=>types.filter(value=>set.has(value)).length;
    let opening=false;
    if(asw)try{opening=openingASW(store,projectShip(store,entry.id,entry)).eligible===true;}catch(_){/* no asserted capability */}
    facts.set(entry.id,{ship,master,carrier:carriers.has(Number(master.api_stype)),guns:count(guns),fighters:count(fighters),
      spotters:count(spotters),torpedo:types.includes(8),bomber:types.includes(7),strike:types.some(t=>[7,8,57].includes(t)),opening});
  }
  return candidate=>candidate.ships.every(entry=>{
    const old=facts.get(entry.id);if(!old)return false;
    const types=entry.slots.map((id,k)=>{const value=type(id),capacity=Number(old.master.api_maxeq?.[k]??old.ship.api_onslot?.[k]??0);
      return (fighters.has(value)||spotters.has(value)||[7,8,57].includes(value))&&!(capacity>0)?null:value;});
    const count=set=>types.filter(value=>set.has(value)).length;
    const moreFighters=count(fighters)>old.fighters;
    if(day&&moreFighters&&!old.carrier){
      if(count(guns)<Math.min(2,old.guns))return false;
      if(old.guns>=2&&old.spotters>0&&count(spotters)===0)return false;
    }
    if(day&&moreFighters&&old.carrier){
      if(old.strike&&!types.some(t=>[7,8,57].includes(t)))return false;
      if(old.torpedo&&old.bomber&&(!types.includes(8)||!types.includes(7)))return false;
    }
    if(old.opening){
      try{if(openingASW(store,projectShip(store,entry.id,entry)).eligible!==true)return false;}
      catch(_){return false;}
    }
    return true;
  });
}
module.exports={createCombatFloor};
