'use strict';
// A bounded recommendation policy, not a proof that a deferred fleet cannot
// win after fitting. Keep the original reserve for routes the first wave cannot
// prepare. Reuse existing candidate scores; never fit equipment to rank this list.
function gearShortlist(seeds,{routes,key,rank,scores,hullPower,airPotential,protectedKeys=new Set(),reserveKeys,enabled=true}){
  if(!enabled||!routes.length||seeds.length<=32)return {primary:seeds,reserve:[]};
  const selected=new Set(),eligible=new Map();
  // Hull and aircraft potential depend on the candidate, not on the route.
  // One search may compare the same candidate against several route presets.
  const hullValues=new Map(),airValues=new Map();
  const once=(cache,read,row)=>{if(!cache.has(row))cache.set(row,read(row));return cache.get(row);};
  const take=(rows,read,count,positive=false)=>{
    const values=rows.map((row,index)=>({row,index,value:read(row)}))
      .filter(r=>Number.isFinite(r.value)&&(!positive||r.value>0))
      .sort((a,b)=>b.value-a.value||a.index-b.index);
    for(const {row}of values.slice(0,count))selected.add(key(row));
  };
  for(const option of routes){
    const rows=seeds.filter(row=>Number.isFinite(rank(row,option)));
    eligible.set(option.key,new Set(rows.map(key)));
    take(rows,row=>rank(row,option),6);
    // Raw hull power preserves strong ships with an initially poor air/LoS
    // outfit. Ground, ASW and special roles must not compete on firepower alone.
    take(rows,row=>once(hullValues,hullPower,row),3);
    take(rows,row=>scores(row,option).strengthProxy,3);
    take(rows,row=>once(airValues,airPotential,row),3,true);
    take(rows,row=>scores(row,option).groundAttack?.bonus||0,3,true);
    take(rows,row=>scores(row,option).specialAttack?.bonus||0,3,true);
    take(rows,row=>scores(row,option).aswCombat?.readiness||0,3,true);
    take(rows,row=>scores(row,option).openingTorpedoProxy||0,2,true);
    if(rows.some(row=>row.profile?.counts?.night?.maximum))
      take(rows,row=>scores(row,option).nightStrengthProxy,3,true);
  }
  const possible=new Set([...eligible.values()].flatMap(keys=>[...keys]));
  for(const row of seeds)if(protectedKeys.has(key(row))&&possible.has(key(row)))selected.add(key(row));
  // Keep original order for deterministic ties and downstream bounded passes.
  return {primary:seeds.filter(row=>selected.has(key(row))),
    reserve:seeds.filter(row=>!selected.has(key(row))&&(!reserveKeys||reserveKeys.has(key(row)))),eligible};
}
function reserveForRoutes(shortlist,routes,key){
  const keys=new Set(routes.flatMap(route=>[...shortlist.eligible?.get(route.key)||[]]));
  return shortlist.reserve.filter(row=>keys.has(key(row)));
}
// Cheap role coverage before reserving engines. A grade-only prefix otherwise
// crowds out ASW or aviation hulls before their actual speed fit can be tested.
function hullShortlist(rows,{key,roles,limit=48}){
  if(rows.length<=limit)return rows;
  const selected=new Set(rows.slice(0,Math.floor(limit/2)).map(key));
  for(const read of roles){
    const ranked=rows.map((row,index)=>({row,index,value:read(row)})).filter(r=>Number.isFinite(r.value)&&r.value>0)
      .sort((a,b)=>b.value-a.value||a.index-b.index);
    for(const {row}of ranked.slice(0,Math.floor(limit/6)))selected.add(key(row));
  }
  for(const row of rows){if(selected.size>=limit)break;selected.add(key(row));}
  return rows.filter(row=>selected.has(key(row)));
}
module.exports={gearShortlist,reserveForRoutes,hullShortlist};
