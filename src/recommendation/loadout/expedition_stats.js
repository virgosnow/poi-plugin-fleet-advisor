'use strict';
const {FIELDS,improvement,AIR,createStatReader}=require('../../domain/expeditions/expedition_stats');
const {fits,automaticSlotLimit}=require('../../domain/expeditions/expedition_loadout');
const EPS=1e-9;
function blueCandidates(needs){
  const ids=new Set(),types=new Set();
  for(const rule of [...require('../../../data/combat_bonuses.json').rules,...require('../../../data/asw_bonuses.json').rules]){
    if(!needs.some(([key])=>Number(rule[FIELDS[key][2]||key])>0))continue;
    for(const field of ['ids','requiresId','requiresId2'])for(const id of rule[field]||[])ids.add(id);
    for(const field of ['types','requiresType'])for(const type of rule[field]||[])types.add(type);
    if(rule.requiresSR||rule.requiresAR||rule.requiresAccR)for(const type of [12,13,93])types.add(type);
  }
  return item=>ids.has(item.master.api_id??item.instance.api_slotitem_id)||types.has(item.type);
}
// A bounded, inventory-aware coordinate search. Attribute trials use the same
// conservative dispatch model as evaluation; they never edit the API snapshot.
function fitStatEquipment(store,entries,inventory,held,spec,readStats=createStatReader(store)){
  const needs=Object.entries(spec.totals||{});if(!needs.length)return;
  const maySupplyBlue=blueCandidates(needs);
  const used=new Set(entries.flatMap(s=>s.slots.concat(s.ex)).filter(id=>id>0));
  const selected=new Set(entries.map(s=>s.id)),groups=new Map(),positions=[];
  const owners=new Map(inventory.map(item=>[item.id,item.sourceShipId]));
  const borrowed=id=>Number(!!owners.get(id)&&!selected.has(owners.get(id)));
  for(const item of inventory){
    const instance=store.info.equips[item.id],type=Number(item.master.api_type?.[2]);
    const useful=needs.some(([key])=>Number(item.master[FIELDS[key][1]]||0)>0&&
      (!AIR.has(type)||['firepower','asw'].includes(key))||improvement({...item,type,instance},key).value>0);
    if(!useful&&!maySupplyBlue({...item,type,instance}))continue;
    const key=[instance.api_slotitem_id,instance.api_level||0,instance.api_alv||0].join(':');
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);
  }
  const priority=item=>selected.has(item.sourceShipId)?0:!item.sourceShipId?1:2;
  for(const rows of groups.values())rows.sort((a,b)=>priority(a)-priority(b)||a.id-b.id);
  for(const ship of entries)for(const k of [...ship.slots.keys(),...(store.info.ships[ship.id].api_slot_ex!==0?['ex']:[])]){
    const get=()=>k==='ex'?ship.ex:ship.slots[k],set=id=>{if(k==='ex')ship.ex=id;else ship.slots[k]=id;};
    if(k!=='ex'&&k>=automaticSlotLimit(ship,held)||held.get(ship.id)?.keep?.[k]||store.info.equips[get()]?.api_slotitem_id===75)continue;
    const choices=[...groups.values()].map(rows=>rows.filter(item=>fits(store,item,ship.id,k))).filter(rows=>rows.length);
    if(choices.length||get()>0)positions.push({ship,k,get,set,choices,allChoices:choices});
  }
  const readings=new Map(entries.map(s=>[s.id,readStats(s.id,s)]));
  let totals=Object.fromEntries(needs.map(([key])=>[key,entries.reduce((n,s)=>n+readings.get(s.id)[key].lower,0)]));
  const cost=()=>entries.reduce((out,s)=>{
    for(const id of s.slots.concat(s.ex).filter(id=>id>0)){
      out.count++;out.borrowed+=borrowed(id);
    }return out;
  },{count:0,borrowed:0});
  const score=(values,usage)=>({gap:needs.reduce((n,[key,need])=>n+Math.max(0,need-values[key])/Math.max(1,need),0),...usage});
  const better=(a,b)=>a.gap<b.gap-EPS||Math.abs(a.gap-b.gap)<EPS&&(a.count<b.count||a.count===b.count&&a.borrowed<b.borrowed);
  let current=score(totals,cost());
  const layoutPossible=s=>{
    const empty=s.slots.findIndex(id=>!(id>0));
    return empty<0||s.slots.slice(empty+1).every((id,i)=>!(id>0)||
      !AIR.has(Number(store.const.$equips[store.info.equips[id]?.api_slotitem_id]?.api_type?.[2]))&&!held.get(s.id)?.keep?.[empty+1+i]);
  };
  // Cheap raw-effect shortlists keep duplicates/stock counts, all four stat
  // directions, and an existing item. Exact blue bonuses are evaluated below.
  for(const position of positions){
    const keep=new Set();
    for(const [key]of needs){
      const ranked=position.choices.map(rows=>({rows,value:Number(rows[0].master[FIELDS[key][1]]||0)+
        improvement({...rows[0],type:Number(rows[0].master.api_type?.[2]),instance:store.info.equips[rows[0].id]},key).value}))
        .sort((a,b)=>b.value-a.value||a.rows[0].id-b.rows[0].id);
      let stock=0,count=0;
      for(const row of ranked){if(row.value<=0)break;keep.add(row.rows);stock+=row.rows.length;count++;
        if(count>=8&&stock>=positions.length)break;
      }
    }
    for(const rows of position.choices)if(rows.some(i=>i.id===position.get()))keep.add(rows);
    position.choices=[...keep];
  }
  let exchanges=0,widened=false;
  for(let pass=0;pass<positions.length*2;pass++){
    let best=null;
    for(const position of positions){
      const old=position.get(),previous=readings.get(position.ship.id);
      const choices=[-1,...position.choices.map(rows=>rows.find(item=>!used.has(item.id)||item.id===old)?.id).filter(id=>id>0)];
      for(const id of choices){
        if(id===old)continue;position.set(id);
        if(!layoutPossible(position.ship)){position.set(old);continue;}
        const reading=readStats(position.ship.id,position.ship),values=Object.fromEntries(needs.map(([key])=>
          [key,totals[key]-previous[key].lower+reading[key].lower]));
        const grade=score(values,{count:current.count+Number(id>0)-Number(old>0),borrowed:current.borrowed+borrowed(id)-borrowed(old)});position.set(old);
        if(better(grade,best?.grade||current))best={position,id,old,reading,values,grade};
      }
    }
    if(!best&&current.gap>EPS&&!widened){
      widened=true;
      // Low-raw equipment can be essential through blue/synergy bonuses.
      // Expand only after the cheap effect shortlist actually stalls.
      if(positions.some(p=>p.choices.length<p.allChoices.length)){
        for(const p of positions)p.choices=p.allChoices;
        continue;
      }
    }
    if(!best&&current.gap>EPS&&exchanges<2){
      // A scarce item can be on a hull that also accepts alternatives. Move it
      // to the restricted hull while replacing its old position in one trial;
      // neither individual move need improve the deficit on its own.
      const byId=new Map(inventory.map(item=>[item.id,item]));
      const accepts=(p,id)=>id<=0||byId.has(id)&&fits(store,byId.get(id),p.ship.id,p.k);
      let pair=null;
      for(let i=0;i<positions.length;i++)for(let j=i+1;j<positions.length;j++){
        const a=positions[i],b=positions[j],oldA=a.get(),oldB=b.get();
        const trials=[];
        if(accepts(a,oldB)&&accepts(b,oldA))trials.push([oldB,oldA]);
        for(const [p,q,old,reverse]of [[a,b,oldA,false],[b,a,oldB,true]])if(old>0&&accepts(q,old)){
          for(const id of [-1,...p.choices.map(rows=>rows.find(item=>!used.has(item.id))?.id).filter(id=>id>0)])
            trials.push(reverse?[old,id]:[id,old]);
        }
        for(const [idA,idB]of trials){
          if(idA===oldA&&idB===oldB)continue;
          a.set(idA);b.set(idB);
          if(!layoutPossible(a.ship)||!layoutPossible(b.ship)){a.set(oldA);b.set(oldB);continue;}
          const changed=[...new Set([a.ship,b.ship])].map(s=>[s.id,readStats(s.id,s)]);
          const values=Object.fromEntries(needs.map(([key])=>[key,totals[key]+changed.reduce((n,[id,r])=>n+r[key].lower-readings.get(id)[key].lower,0)]));
          const grade=score(values,{count:current.count+Number(idA>0)+Number(idB>0)-Number(oldA>0)-Number(oldB>0),
            borrowed:current.borrowed+borrowed(idA)+borrowed(idB)-borrowed(oldA)-borrowed(oldB)});
          a.set(oldA);b.set(oldB);
          if(better(grade,pair?.grade||current))pair={a,b,idA,idB,oldA,oldB,changed,values,grade};
        }
      }
      if(pair){
        for(const id of [pair.oldA,pair.oldB])used.delete(id);
        for(const id of [pair.idA,pair.idB])if(id>0)used.add(id);
        pair.a.set(pair.idA);pair.b.set(pair.idB);
        for(const [id,r]of pair.changed)readings.set(id,r);
        totals=pair.values;current=pair.grade;exchanges++;continue;
      }
    }
    if(!best)break;
    used.delete(best.old);if(best.id>0)used.add(best.id);best.position.set(best.id);
    readings.set(best.position.ship.id,best.reading);totals=best.values;current=best.grade;
  }
  return {totals,gap:current.gap};
}
module.exports={fitStatEquipment};
