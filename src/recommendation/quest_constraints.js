'use strict';
// Bounded, requirement-aware seed generation. The final evaluator remains
// authoritative: approximate partial scores must never approve a fleet.
const {resolveQuestCodes}=require('../domain/quests/quest_requirements');
const {createFleetRequirementEvaluator,createFleetRequirementPrecheck}=require('../domain/quests/fleet_requirements');
const {shipFamilyKey}=require('./context');

function questRequirements(codes=[]){return codes.length?resolveQuestCodes(codes):[];}
function createQuestChecker(store,quests){
  if(!quests.length)return ()=>true;
  const evaluate=createFleetRequirementEvaluator(store);
  return scheme=>quests.every(quest=>evaluate(quest.fleet,scheme.ships,scheme.fleet).status==='met');
}
function createQuestPrecheck(store,quests){
  if(!quests.length)return ()=>true;
  const evaluate=createFleetRequirementPrecheck(store);
  // Unknown can become valid after fitting. Only definite failures may be
  // pruned; the full post-fitting checker remains authoritative.
  return scheme=>quests.every(quest=>evaluate(quest.fleet,scheme.ships,scheme.fleet)!=='unmet');
}
function satisfiesQuests(store,scheme,quests){return createQuestChecker(store,quests)(scheme);}
function questSeeds(store,ctx,args,quests,{limit=128,templates=[]}={}){
  if(!quests.length)return [];
  const selectors=new Map();
  function visit(node){
    if(!node||typeof node!=='object')return;
    if(node.kind==='count'||node.kind==='forbiddenCount')selectors.set(JSON.stringify(node.selector),node.selector);
    if(node.allOf)node.allOf.forEach(visit);if(node.anyOf)node.anyOf.forEach(visit);
  }
  quests.forEach(q=>visit(q.fleet));
  if(!selectors.size&&quests.every(q=>!q.fleet.anyOf&&!q.fleet.allOf?.length&&q.fleet.fleetIndex===undefined&&q.fleet.sizeMin===undefined&&q.fleet.sizeMax===undefined&&q.fleet.sizeExact===undefined))return [];
  const evaluate=createFleetRequirementEvaluator(store);
  const keys=[...selectors.keys()],readings=new Map();
  for(const row of ctx.roster){
    const values=keys.map(key=>evaluate({allOf:[{kind:'count',selector:selectors.get(key),min:1}]},[{id:row.id}],ctx.fleet).status);
    readings.set(row.id,values);
  }
  const keyIndex=new Map(keys.map((key,index)=>[key,index]));
  // Keep multiple distinct families for each role/type signature. This is a
  // bounded search, not a guarantee that every possible fleet is examined.
  const buckets=new Map();
  for(const row of ctx.roster.slice().sort((a,b)=>b.power-a.power||a.id-b.id)){
    const signature=JSON.stringify([row.stype,readings.get(row.id)]),bucket=buckets.get(signature)||[];
    if(bucket.length<6&&!bucket.some(item=>shipFamilyKey(item)===shipFamilyKey(row)))bucket.push(row);
    buckets.set(signature,bucket);
  }
  const pool=[...new Map([...ctx.fixed.map(id=>ctx.byId.get(id)),...[...buckets.values()].flat()].filter(Boolean).map(row=>[row.id,row])).values()];
  const locks=new Map();
  (args.heldSlots||[]).forEach((held,index)=>{if(held&&held.holdPosition!==false&&(held.pin||Object.keys(held.keep||{}).length))locks.set(index,held.id);});
  if(args.fixedFlagshipId!==undefined)locks.set(0,args.fixedFlagshipId);
  const fixed=new Set(ctx.fixed),result=[],seen=new Set();
  // Resolve the static selector keys and expression tree once per search,
  // not once per partially assembled fleet in the beam.
  function compileRule(rule){
    if(rule.anyOf){const options=rule.anyOf.map(compileRule);return rows=>{let best=-Infinity;for(const option of options){const value=option(rows);if(Number.isFinite(value)&&value>best)best=value;}return best;};}
    if(rule.allOf){const children=rule.allOf.map(compileRule);return rows=>{let sum=0;for(const child of children){const value=child(rows);if(!Number.isFinite(value))return -Infinity;sum+=value;}return sum;};}
    if(rule.kind==='fleetSize'){const max=rule.exact??rule.max??6;return rows=>rows.length>max?-Infinity:0;}
    if(rule.kind!=='count')return ()=>0;
    const index=keyIndex.get(JSON.stringify(rule.selector)),positions=rule.positions;
    const min=Number(rule.min||0),max=rule.max??6;
    return rows=>{
      let yes=0,unknown=0;
      for(let i=0;i<rows.length;i++){
        if(positions&&!positions.includes(i+1))continue;
        const value=readings.get(rows[i].id)?.[index];
        if(value==='met')yes++;else if(value==='unknown')unknown++;
      }
      if(yes>max||positions&&positions.every(position=>position<=rows.length)&&yes+unknown<min)return -Infinity;
      return Math.min(yes,min)*100+Math.min(unknown,Math.max(0,min-yes))*10;
    };
  }
  const compiled=quests.map(({fleet})=>({fleet,score:compileRule(fleet.anyOf?{anyOf:fleet.anyOf}:{allOf:fleet.allOf||[]})}));
  function score(rows){
    let value=rows.filter(row=>fixed.has(row.id)).length*200;
    for(const {fleet,score:scoreFleet} of compiled){
      if(fleet.fleetIndex!==undefined&&fleet.fleetIndex!==ctx.fleet)return -Infinity;
      if(rows.length>(fleet.sizeExact??fleet.sizeMax??6))return -Infinity;
      const part=scoreFleet(rows);
      if(!Number.isFinite(part))return -Infinity;value+=part;
    }
    return value;
  }
  // Route templates describe a multiset of hull types, not fixed positions.
  // Match partial fleets against distinct template slots so task-relevant
  // escorts survive even when higher-level ships of another type dominate.
  function templateMatcher(template){
    if(!template)return ()=>true;
    const cache=new Map();
    return rows=>{
      if(rows.length>template.length)return false;
      const types=rows.map(row=>row.stype).sort((a,b)=>a-b),key=types.join(',');
      if(cache.has(key))return cache.get(key);
      const choices=types.map(type=>template.flatMap((slots,index)=>slots.includes(type)?[index]:[])).sort((a,b)=>a.length-b.length);
      const assign=(index,used)=>index===choices.length||choices[index].some(slot=>!(used&(1<<slot))&&assign(index+1,used|(1<<slot)));
      const fits=assign(0,0);cache.set(key,fits);return fits;
    };
  }
  const patterns=[null,...new Map(templates.filter(t=>Array.isArray(t)&&t.length&&t.length<=6&&t.every(Array.isArray)).map(t=>[JSON.stringify(t),t])).values()];
  for(const template of patterns){
  const templateFits=templateMatcher(template);
  const counts=new Map();let beam=[[]];
  for(let position=0;position<(template?.length||6)&&beam.length;position++){
    const next=[];
    for(const rows of beam){
      const families=new Set(rows.map(shipFamilyKey)),locked=locks.get(position);
      for(const row of locked?[ctx.byId.get(locked)]:pool){
        if(!row||!row.available||families.has(shipFamilyKey(row))||rows.some(other=>other.id===row.id))continue;
        // A position-locked ship cannot be consumed in an earlier slot.
        if([...locks].some(([index,id])=>index!==position&&id===row.id))continue;
        const candidate=rows.concat(row),missing=[...fixed].filter(id=>!candidate.some(item=>item.id===id));
        if(!templateFits(candidate)||missing.length>(template?.length||6)-candidate.length)continue;
        const rank=score(candidate);if(!Number.isFinite(rank))continue;
        if((!template||candidate.length===template.length)&&(counts.get(candidate.length)||0)<24&&!missing.length&&![...locks.keys()].some(index=>index>=candidate.length)&&quests.every(quest=>evaluate(quest.fleet,candidate.map(item=>({id:item.id})),ctx.fleet).status==='met')){
          const id=candidate.map(item=>item.id).join(',');if(!seen.has(id)){seen.add(id);result.push(candidate);counts.set(candidate.length,(counts.get(candidate.length)||0)+1);}
        }
        next.push({rows:candidate,rank,power:candidate.reduce((sum,item)=>sum+item.power,0),key:candidate.map(item=>item.id).join(',')});
      }
    }
    next.sort((a,b)=>b.rank-a.rank||b.power-a.power||a.key.localeCompare(b.key));
    beam=next.slice(0,limit).map(item=>item.rows);
  }
  }
  return result;
}
module.exports={questRequirements,createQuestChecker,createQuestPrecheck,satisfiesQuests,questSeeds};
