'use strict';
const {FIELDS,AIR,improvement}=require('../domain/expeditions/expedition_stats');
const {fits,automaticSlotLimit}=require('../domain/expeditions/expedition_loadout');
const {usableSlots}=require('./context');
function effectGroups(store,inventory){
  const groups=new Map();
  for(const item of inventory){
    const instance=store.info.equips[item.id],key=[instance.api_slotitem_id,instance.api_level||0].join(':');
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);
  }
  return [...groups.values()].map(rows=>({rows,values:Object.fromEntries(Object.keys(FIELDS).map(key=>{
    const item=rows[0],type=Number(item.master.api_type?.[2]);
    const value=AIR.has(type)&&['antiAir','los'].includes(key)?0:Number(item.master[FIELDS[key][1]]||0)+
      improvement({...item,type,instance:store.info.equips[item.id]},key).value;
    return [key,value];
  }))}));
}
// Rescue ranking only, never an eligibility proof. Bare stats avoid rewarding
// borrowed/current gear twice; per-slot potential admits compatible larger hulls.
// Inventory sharing, blue synergy and all actual totals are checked by fitting.
function monthlyProfiles(store,pool,inventory,heldSlots,readStats){
  const held=new Map((heldSlots||[]).filter(Boolean).map(s=>[s.id,s])),groups=effectGroups(store,inventory);
  const ranked=Object.fromEntries(Object.keys(FIELDS).map(key=>[key,groups.map(group=>({rows:group.rows,value:group.values[key]}))
    .filter(r=>r.value>0).sort((a,b)=>b.value-a.value||a.rows[0].id-b.rows[0].id)]));
  return new Map(pool.map(row=>{
    const lock=held.get(row.id),count=usableSlots(store,row.id).length;
    const loadout={id:row.id,slots:Array.from({length:count},(_,k)=>lock?.keep?.[k]?lock.slots[k]:-1),
      ex:lock?.keep?.ex?lock.ex:-1};
    const readings=readStats(row.id,loadout),bare=Object.fromEntries(Object.keys(FIELDS).map(key=>[key,readings[key].lower]));
    const refit={...bare},limit=automaticSlotLimit(loadout,held);
    for(const k of [...Array(limit).keys(),...(row.ship.api_slot_ex!==0?['ex']:[])]){
      if(lock?.keep?.[k])continue;
      for(const key of Object.keys(FIELDS)){
        const best=ranked[key].find(group=>group.rows.some(item=>fits(store,item,row.id,k)));
        refit[key]+=best?.value||0;
      }
    }
    return [row.id,{bare,refit}];
  }));
}
// Put drums where they displace the least useful stat equipment, rather than
// consuming all the sonar/radar-compatible slots in the first three carriers.
function drumOpportunity(store,inventory,spec){
  const ranked=effectGroups(store,inventory).map(group=>({...group,score:Object.entries(spec.totals).reduce((n,[key,need])=>
    n+Math.max(0,group.values[key])/Math.max(1,need),0)})).filter(g=>g.score>0).sort((a,b)=>b.score-a.score);
  const cache=new Map();
  return (id,k)=>{
    const key=id+':'+k;if(cache.has(key))return cache.get(key);
    const score=ranked.find(group=>group.rows.some(item=>fits(store,item,id,k)))?.score||0;
    cache.set(key,score);return score;
  };
}
module.exports={monthlyProfiles,drumOpportunity};
