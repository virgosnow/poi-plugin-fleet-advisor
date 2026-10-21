'use strict';
const {canEquip,acceptsOtherSlot}=require('../fleet/equipment_rules');
const {lineOfSight}=require('../fleet/fleet_metrics');
const {losWindows,planningPath,createLoSWindowReader}=require('./route_plans');
const {evaluateNormalRoute}=require('./normal_routes');
// Give repairable strong fleets a chance before comparing their final routing.
// Half the existing budget follows combat quality, half follows the ordinary
// ranking. Already-in-window outfits need no fitting and consume no place.
function selectLoSFinalists(candidates,{nodes,rank,quality,key,limit=8}){
  const eligible=[],readWindows=createLoSWindowReader(nodes);
  for(const row of candidates){
    const bounds=readWindows(row.route).filter(g=>g.windows.some(w=>Number.isFinite(w.upper)));
    if(!bounds.length)continue;
    const scores=bounds.map(g=>row.route.lineOfSight?.rawScoresByCoefficient?.[g.coefficient]);
    if(scores.some(score=>!Number.isFinite(score))||bounds.every((g,i)=>
      g.windows.some(w=>scores[i]>=w.lower&&scores[i]<w.upper)))continue;
    eligible.push({row,rank:rank(row),quality:quality(row),key:key(row)});
  }
  const compareQuality=(a,b)=>{
    for(let i=0;i<a.quality.length;i++){
      const difference=b.quality[i]-a.quality[i];if(difference)return difference;
    }
    return b.rank-a.rank;
  };
  const strongest=eligible.slice().sort(compareQuality),ordinary=eligible.slice().sort((a,b)=>b.rank-a.rank);
  const selected=[],seen=new Set();
  const take=(list,until)=>{for(const entry of list){
    if(selected.length>=until)break;
    if(seen.has(entry.key))continue;
    seen.add(entry.key);selected.push(entry.row);
  }};
  take(strongest,Math.ceil(limit/2));take(ordinary,limit);
  return selected;
}
// Fit bounded LoS intervals without changing hulls, held gear or combat slots.
// Score each swap through the shared formula; no separate approximate formula.
function fitRouteLoS(store,scheme,inventory,{route,nodes,heldSlots=[]}){
  const bounds=losWindows(route,nodes).filter(g=>g.windows.some(w=>Number.isFinite(w.upper)));
  if(!bounds.length)return null;
  const holds=new Map(heldSlots.filter(Boolean).map(s=>[s.id,s]));
  const entries=scheme.ships.map(s=>({...s,slots:s.slots.slice()}));
  const types=new Set([6,7,8,9,10,11,12,13,26,41,45,57,58,93,94]);
  const type=id=>Number(store.const.$equips[store.info.equips[id]?.api_slotitem_id]?.api_type?.[2]);
  const positions=entries.flatMap((entry,index)=>entry.slots.map((id,k)=>({index,k,id})))
    .filter(p=>!holds.get(entries[p.index].id)?.keep?.[p.k]&&(p.id<=0||types.has(type(p.id))));
  const projected=value=>value.map(entry=>{const ship=store.info.ships[entry.id];return {id:entry.id,ship,
    master:store.const.$ships[ship.api_ship_id],before:{slots:ship.api_slot,ex:ship.api_slot_ex},after:entry,changed:true};});
  const measure=value=>lineOfSight(store,projected(value));
  const contributions=new Map();
  const contribution=entry=>{
    const key=JSON.stringify([entry.id,entry.slots,entry.ex]);
    if(!contributions.has(key))contributions.set(key,measure([entry]).rawScoresByCoefficient||{});
    return contributions.get(key);
  };
  const distance=reading=>bounds.reduce((sum,g)=>{
    const score=reading.rawScoresByCoefficient?.[g.coefficient];
    if(!Number.isFinite(score))return Infinity;
    return sum+Math.min(...g.windows.map(w=>score<w.lower?w.lower-score:score>=w.upper?score-w.upper+0.001:0));
  },0);
  let reading=measure(entries),gap=distance(reading),changed=false;
  if(!Number.isFinite(gap)||gap===0)return null;
  const unique=new Map();
  for(const item of inventory.filter(i=>types.has(type(i.id))||[1,2,3,4,5].includes(type(i.id)))){
    const raw=store.info.equips[item.id],key=raw.api_slotitem_id+':'+(raw.api_level||0);
    if(!unique.has(key))unique.set(key,[]);unique.get(key).push(item);
  }
  for(let step=0;step<12&&gap>0;step++){
    const used=new Set(entries.flatMap(s=>s.slots.concat(s.ex)).filter(id=>id>0));
    let best=null;
    for(const p of positions){
      const entry=entries[p.index],old=entry.slots[p.k];
      const options=[null,...[...unique.values()].map(items=>items.find(i=>{
        if(used.has(i.id))return false;
        try{return canEquip(store,entry.id,i.id,p.k)&&(!i.sourceShipId||i.sourceShipId===entry.id||acceptsOtherSlot(store,entry.id,i.id,p.k));}catch(_){return false;}
      }))].filter(i=>i!==undefined);
      for(const item of options){
        const id=item?.id||-1;if(id===old)continue;
        if(id<=0&&entry.slots.slice(p.k+1).some(slot=>slot>0))continue;
        // A carrier keeps its final attacking aircraft; LoS tuning may use
        // lower-LoS bombers/torpedo bombers without disabling its attacks.
        if([7,11,18].includes(Number(store.const.$ships[store.info.ships[entry.id].api_ship_id].api_stype))&&
          [7,8,57,58].includes(type(old))&&![7,8,57,58].includes(type(id))&&
          entry.slots.filter((slot,k)=>k!==p.k&&[7,8,57,58].includes(type(slot))).length===0)continue;
        // A swap can change hull-specific blue bonuses and companion synergies,
        // not just the item's weighted LoS. Recompute only this ship, reusing
        // every unchanged ship and outfit already measured in the search.
        const slots=entry.slots.slice();slots[p.k]=id;
        const before=contribution(entry),after=contribution({...entry,slots});
        const next={...reading,rawScoresByCoefficient:
          Object.fromEntries(Object.entries(reading.rawScoresByCoefficient).map(([coefficient,score])=>
            [coefficient,score+after[coefficient]-before[coefficient]]))};
        const nextGap=distance(next);
        if(nextGap>=gap-1e-7)continue;
        // With equal progress, preserve the equipped utility and fewer changes.
        if(!best||nextGap<best.gap-1e-7||Math.abs(nextGap-best.gap)<1e-7&&id>0&&best.id<0)
          best={p,id,gap:nextGap,reading:next};
      }
    }
    if(!best)return null;
    entries[best.p.index].slots[best.p.k]=best.id;gap=best.gap;reading=best.reading;changed=true;
  }
  if(!changed||gap>0)return null;
  const fitted={fleet:scheme.fleet,ships:entries};
  const verified=evaluateNormalRoute(store,{area:route.area,target:route.target,phase:route.phase||undefined,scheme:fitted});
  return planningPath(verified,nodes,{allowTentative:false}).chance.probability===1?fitted:null;
}
module.exports={fitRouteLoS,selectLoSFinalists};
