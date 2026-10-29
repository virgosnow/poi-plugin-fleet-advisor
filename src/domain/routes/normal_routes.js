'use strict';
const perf=require('../../shared/performance_trace');
// Per-map branching tables are derived from wikiwiki source pages. Only
// reviewed machineRules may drive a route verdict; prose alone is evidence.
const fs=require('fs'),path=require('path');
const {error}=require('../../shared/errors');
const {projectFleet,evaluateProjectedCandidate}=require('../fleet/fleet_metrics');
const {createFleetPlanner}=require('../fleet/fleet_plan');
const {losPredicate}=require('../fleet/line_of_sight');
const {snapshotMemo}=require('../fleet/equipment_planner');
const {effectiveRule,referenceWeights}=require('./route_policy');
const ROOT=path.join(__dirname,'../../../data/normal_routes');
const maps=new Map(fs.readdirSync(ROOT).filter(name=>/^\d-\d\.json$/.test(name))
  .map(name=>{const map=require(path.join(ROOT,name));return [map.area,map];}));
const SPEED_RANK={slow:0,fast:1,fastPlus:2,fastest:3};
const confirmedSpeed=reading=>['observed','computed'].includes(reading?.status);
// These are friendly ship type IDs. In particular, supply ships are 22;
// 15 is an enemy transport ship and is not used by sortie fleets.
// Per the wiki 艦種表記まとめ, 戦艦級 includes 高速戦艦(8), (低速)戦艦(9)
// and 航空戦艦(10). 12 is the reserved 超弩級戦艦 id.
const SHIP_GROUPS=Object.freeze({
  carrier:[7,11,18],fleetCarrier:[11,18],battleship:[8,9,10,12],
  supply:[22],heavyCruiser:[5,6],slowBattleship:[9]
});
// 大発動艇系 is an explicit equipment list, not the shared 上陸用舟艇 category
// (api_type[2]=24): the wiki definitions (5-3/5-4 inline notes; 5-5 fold verified
// 2024-09) include 特二式/特四式内火艇 (category 46) and exclude M4A1 DD, 装甲艇
// and the 戦車-combo barges that share category 24.
const LANDING_CRAFT_IDS=new Set([68,166,193,409,436,449,167,525,526]);
// Category-24 equipment the wiki verifies does NOT count. Anything else in
// category 24/46 (e.g. 大発動艇(R35&フランス兵), still unverified on the wiki)
// reads as unknown instead of a silent no, keeping affected branches undecided.
const LANDING_CRAFT_EXCLUDED=new Set([230,355,408,482,494,495,514]);
function stypesOf(value){
  const groups=value.groups||[];
  return new Set([...(value.stypes||[]),...groups.flatMap(name=>{
    if(!SHIP_GROUPS[name])throw new Error(`未知舰种分类: ${name}`);
    return SHIP_GROUPS[name];
  })]);
}

function listNormalMaps(){
  return {maps:[...maps.values()].sort((a,b)=>a.area.localeCompare(b.area)).map(map=>({
    area:map.area,bossNodes:map.bossNodes,terminalNodes:map.terminalNodes,
    branchPoints:map.branchPoints.map(point=>({from:point.from,phase:point.phase||null,
      destinations:point.destinations})),
    evaluatedBranchPoints:Object.keys(map.machineRules||{}),source:map.source.url,
    airControl:map.airControl
  }))};
}
function airThreshold(airPower,required){
  if(required===0)return {required,status:'noEnemyAirPower'};
  if(!Number.isInteger(required)||required<0||airPower?.status!=='range')
    return {required:required??null,status:'unknown'};
  return {required,status:airPower.min>=required?'meetsAtStart':
    airPower.max<required?'belowAtStart':'uncertainAtStart',
  margin:[airPower.min-required,airPower.max-required]};
}
function airProfileMatchesPhase(profile,phase){
  return !phase||!profile.phase||profile.phase===phase||
    profile.phase==='gauge2Or3'&&['gauge2','gauge3'].includes(phase);
}
function assessAirControl(map,airPower,phase){
  const data=map.airControl;
  if(!data)return {status:'unknown',reason:'该海域没有制空资料'};
  const profiles=data.profiles.filter(profile=>airProfileMatchesPhase(profile,phase));
  if(!profiles.length)return {status:'unknown',fleetAirPower:airPower,source:data.source,
    profiles:[],reason:'所选阶段没有速查制空资料',routeSustainability:'notSimulated'};
  const evaluated=profiles.map(profile=>({...profile,
    assessment:{superiority:airThreshold(airPower,profile.superiority),
      supremacy:airThreshold(airPower,profile.supremacy)}}));
  const required={superiority:Math.max(...profiles.map(profile=>profile.superiority)),
    supremacy:Math.max(...profiles.map(profile=>profile.supremacy))};
  const landBaseOptions=data.landBaseOptions?.map(option=>({...option,
    fleetSuperiorityAssessment:{...airThreshold(airPower,option.fleetSuperiority),
      conditionalOnLandBase:true},
    // These options are conditional on a verified land-base setup; never fold
    // them into the unconditional map-wide verdict.
    status:'requiresLandBaseVerification'}));
  return {status:airPower?.status==='range'?'assessedAtStart':'unknown',
    fleetAirPower:airPower,source:data.source,coverage:data.coverage,profiles:evaluated,
    referenceMaximum:required,
    assessment:{superiority:airThreshold(airPower,required.superiority),
      supremacy:airThreshold(airPower,required.supremacy)},
    ...(landBaseOptions?{landBaseOptions,
      landBaseProbabilityBasis:data.landBaseProbabilityBasis}:{}),
    ...(data.notes?{notes:data.notes}:{}),
    routeSustainability:'notSimulated',
    limitation:'仅比较母港或候选编成的出击前制空范围与所列速查门槛；资料不保证覆盖所有路线或敌编成，且未模拟道中损耗及基地航空队，不能保证一路空优或空确'};
}
function resolveFleet(store,fleet,scheme,search=false){
  return snapshotMemo(store,search?'resolvedSearchRouteFleets':'resolvedRouteFleets',JSON.stringify([fleet,scheme]),()=>resolveFleetUncached(store,fleet,scheme,search));
}
function resolveFleetUncached(store,fleet,scheme,search){
  let plan;
  if(scheme){
    const planner=createFleetPlanner(()=>store);
    plan=perf.measure('route.plan',()=>search?planner.project(scheme):planner.preview('fleet',scheme));
  }else{
    const data=store.info.fleets[fleet-1];
    if(!data)throw error('INVALID_QUERY','舰队数据不可用');
    plan={organization:{targets:data.api_ship.filter(id=>id>0)},equipment:{expected:[]}};
  }
  const projected=perf.measure('route.projection',()=>projectFleet(store,plan));
  const metrics=perf.measure('route.metrics',()=>evaluateProjectedCandidate(store,projected));
  const carried=row=>row.after.slots.concat(row.after.ex>0?[row.after.ex]:[])
    .filter(id=>id>0)
    .map(id=>{
      const masterId=Number(store.info.equips[id]?.api_slotitem_id);
      const type=Number(store.const.$equips[masterId]?.api_type?.[2]);
      return {masterId,type,unknown:!Number.isFinite(masterId)||!Number.isFinite(type)};
    });
  const carriesType=(items,types)=>items.some(item=>types.includes(item.type))?true:
    items.some(item=>item.unknown)?null:false;
  const landingCraftOf=row=>{
    const items=carried(row),barges=items.filter(item=>item.type===24||item.type===46);
    if(barges.some(item=>LANDING_CRAFT_IDS.has(item.masterId)))return true;
    return items.some(item=>item.unknown)||
      barges.some(item=>!LANDING_CRAFT_EXCLUDED.has(item.masterId))?null:false;
  };
  return {ships:projected.map(row=>({instanceId:row.id,name:row.master.api_name,
    stype:Number(row.master.api_stype),
    openingTorpedo:[13,14].includes(Number(row.master.api_stype))&&Number(store.info.ships[row.id]?.api_lv)>=10||
      carriesType(carried(row),[22]),
    radarEquipped:carriesType(carried(row),[12,13,93]),
    drumEquipped:carriesType(carried(row),[30]),
    landingCraftEquipped:landingCraftOf(row)})),metrics};
}
// Prepare immutable rule structure once for a hull search. Only static type
// sets are retained; fleet counts and unknown equipment facts are read afresh.
function preparePredicate(value){
  if(value?.all||value?.any){
    const all=!!value.all,parts=(value.all||value.any).map(preparePredicate);
    return (ships,metrics)=>{
      let unknown=false;
      for(const part of parts){const result=part(ships,metrics);
        if(result===(all?false:true))return result;
        if(result===null)unknown=true;
      }
      return unknown?null:all;
    };
  }
  if(value?.not){const part=preparePredicate(value.not);return (ships,metrics)=>{const result=part(ships,metrics);return result===null?null:!result;};}
  if(value?.count){
    const {exact,min,max,prefixes=[]}=value.count,stypes=stypesOf(value.count);
    return ships=>{
      let n=0;
      for(const ship of ships)if(stypes.has(ship.stype)||prefixes.some(prefix=>ship.name?.startsWith(prefix)))n++;
      return (exact===undefined||n===exact)&&(min===undefined||n>=min)&&(max===undefined||n<=max);
    };
  }
  return (ships,metrics)=>predicate(value,ships,metrics);
}
function predicate(value,ships,metrics){
  if(value===true||value==='otherwise')return true;
  if(!value||typeof value!=='object')return null;
  if(value.all){
    const items=value.all.map(item=>predicate(item,ships,metrics));
    return items.includes(false)?false:items.includes(null)?null:true;
  }
  if(value.any){
    const items=value.any.map(item=>predicate(item,ships,metrics));
    return items.includes(true)?true:items.includes(null)?null:false;
  }
  if(value.not){const result=predicate(value.not,ships,metrics);return result===null?null:!result;}
  if(value.shipCount){
    const {exact,min,max}=value.shipCount,n=ships.length;
    return (exact===undefined||n===exact)&&(min===undefined||n>=min)&&(max===undefined||n<=max);
  }
  if(value.pathIncludes)return Array.isArray(metrics.visitedNodes)?metrics.visitedNodes.includes(value.pathIncludes):null;
  if(value.allStypes)return ships.length>0&&ships.every(ship=>value.allStypes.includes(ship.stype));
  if(value.allHulls)return ships.length>0&&ships.every(ship=>(value.allHulls.stypes||[]).includes(ship.stype)||(value.allHulls.prefixes||[]).some(prefix=>ship.name?.startsWith(prefix)));
  if(value.shipName){
    const prefixes=value.shipName.prefixes||[];
    return ships.some(ship=>prefixes.some(prefix=>ship.name?.startsWith(prefix)));
  }
  if(value.flagshipStype){
    // Fleet order is preserved, so index 0 is the sortie flagship.
    const flagship=ships[0];
    return flagship?value.flagshipStype.includes(flagship.stype):false;
  }
  if(value.flagshipName){
    const flagship=ships[0];
    if(!flagship)return false;
    return typeof flagship.name==='string'?value.flagshipName.prefixes.some(prefix=>flagship.name.startsWith(prefix)):null;
  }
  if(value.count){
    const {exact,min,max}=value.count,stypes=stypesOf(value.count);
    const prefixes=value.count.prefixes||[];
    const n=ships.filter(ship=>stypes.has(ship.stype)||
      prefixes.some(prefix=>ship.name?.startsWith(prefix))).length;
    return (exact===undefined||n===exact)&&(min===undefined||n>=min)&&(max===undefined||n<=max);
  }
  if(value.los){
    return losPredicate(metrics.lineOfSight,value.los);
  }
  if(value.speedAtLeast){
    const speed=metrics.speed;
    if(!confirmedSpeed(speed))return null;
    return SPEED_RANK[speed.fleetSpeed]>=SPEED_RANK[value.speedAtLeast];
  }
  if(value.speedIs){
    const speed=metrics.speed;
    return confirmedSpeed(speed)?speed.fleetSpeed===value.speedIs:null;
  }
  if(value.anyShipSpeed){
    const {stypes,groups,speedIs}=value.anyShipSpeed;
    // Without stypes the check covers the whole fleet (e.g. 低速含む rules).
    const selected=stypes||groups?ships.filter(ship=>stypesOf(value.anyShipSpeed).has(ship.stype)):ships;
    if(!selected.length)return false;
    const readings=selected.map(ship=>metrics.speed.ships?.find(row=>row.shipId===ship.instanceId));
    if(readings.some(row=>confirmedSpeed(row)&&row.speed===speedIs))return true;
    return readings.some(row=>!confirmedSpeed(row))?null:false;
  }
  if(value.radarCarriers){
    if(ships.some(ship=>ship.radarEquipped===null))return null;
    const {exact,min,max}=value.radarCarriers;
    const n=ships.filter(ship=>ship.radarEquipped).length;
    return (exact===undefined||n===exact)&&(min===undefined||n>=min)&&(max===undefined||n<=max);
  }
  if(value.openingTorpedoCarriers){
    if(ships.some(ship=>typeof ship.openingTorpedo!=='boolean'))return null;
    const {exact,min,max}=value.openingTorpedoCarriers,n=ships.filter(ship=>ship.openingTorpedo).length;
    return (exact===undefined||n===exact)&&(min===undefined||n>=min)&&(max===undefined||n<=max);
  }
  if(value.drumCarriers){
    if(ships.some(ship=>ship.drumEquipped===null))return null;
    const {exact,min,max}=value.drumCarriers;
    const n=ships.filter(ship=>ship.drumEquipped).length;
    return (exact===undefined||n===exact)&&(min===undefined||n>=min)&&(max===undefined||n<=max);
  }
  if(value.landingCraftCarriers){
    // A carried barge the wiki has not classified keeps the count undecided.
    if(ships.some(ship=>ship.landingCraftEquipped===null))return null;
    const {exact,min,max}=value.landingCraftCarriers;
    const n=ships.filter(ship=>ship.landingCraftEquipped).length;
    return (exact===undefined||n===exact)&&(min===undefined||n>=min)&&(max===undefined||n<=max);
  }
  if(value.transportEquipCount){
    // wiki's drum+landing-craft tally: a ship carrying both counts twice.
    if(ships.some(ship=>ship.drumEquipped===null||ship.landingCraftEquipped===null))return null;
    const {exact,min,max}=value.transportEquipCount;
    const n=ships.reduce((sum,ship)=>sum+(ship.drumEquipped?1:0)+(ship.landingCraftEquipped?1:0),0);
    return (exact===undefined||n===exact)&&(min===undefined||n>=min)&&(max===undefined||n<=max);
  }
  return null;
}
function preparePoint(rules){
  const prepared=rules.map(source=>{
    const rule=effectiveRule(source);return {rule,match:preparePredicate(rule.when)};
  });
  return (ships,metrics)=>evaluatePoint(rules,ships,metrics,prepared);
}
function evaluatePoint(rules,ships,metrics,prepared){
  for(const [index,sourceRule] of rules.entries()){
    const rule=prepared?prepared[index].rule:effectiveRule(sourceRule);
    const matches=prepared?prepared[index].match(ships,metrics):predicate(rule.when,ships,metrics);
    if(matches===false)continue;
    if(matches===null)return {status:'unknown',destinations:[...new Set(rules.flatMap(r=>
      r.to?[r.to]:(r.choices||[]).map(choice=>choice.to)))],reason:'前置条件无法确认',
      unconfirmedCondition:rule.when,rule:rule.note||null};
    if(rule.conditionUnknown)return {status:'unknown',destinations:rule.to?[rule.to]:(rule.choices||[]).map(choice=>choice.to),
      reason:rule.conditionUnknownReason||rule.note||'该点带路条件未收录',conditionUnknown:true};
    if(rule.tentative){
      const alternatives=(rule.choices||[]).map(choice=>choice.to);
      if(rule.assumedTo)return {status:'tentative',destinations:[rule.assumedTo],
        possibleDestinations:alternatives,rule:rule.note||null,tentative:true};
      const weights=(rule.choices||[]).map(choice=>({to:choice.to,
        probability:choice.weightByShipCount?.[ships.length]??choice.weight??null}));
      return {status:'tentativeRandom',destinations:alternatives,probabilities:weights,
        rule:rule.note||null,tentative:true};
    }
    if(rule.uncertain)return {status:'unknown',destinations:(rule.choices||[]).map(choice=>choice.to),
      reason:rule.note||'wikiwiki 未确认此分岐条件'};
    // A routing roll is conditional: on failure the next rule still applies.
    // Keep it distinct from a terminal choices rule (which ends this chain).
    if(Number.isFinite(rule.chance)&&rule.to){
      const rest=evaluatePoint(rules.slice(index+1),ships,metrics,prepared?.slice(index+1));
      if(rule.chance===0)return rest;
      if(rule.chance===1)return {status:'fixed',destinations:[rule.to],condition:rule.when};
      const destinations=[...new Set([rule.to,...rest.destinations])];
      const weights=rest.status==='fixed'?[{to:rest.destinations[0],probability:1}]:rest.probabilities;
      if(rest.status==='unknown'||rest.referencePathProbability||!weights?.length||
        !weights.every(w=>Number.isFinite(w.probability))){
        return {...rest,status:'unknown',destinations,reason:rest.reason||'后续条件无法确认'};
      }
      const totals=new Map([[rule.to,rule.chance]]);
      for(const w of weights)totals.set(w.to,(totals.get(w.to)||0)+(1-rule.chance)*w.probability);
      if(totals.size===1)return {status:'fixed',destinations,rule:rule.note||null};
      return {status:'random',destinations,probabilities:[...totals].map(([to,probability])=>({to,probability})),rule:rule.note||null};
    }
    if(rule.to)return {status:'fixed',destinations:[rule.to],rule:rule.note||null,condition:rule.when};
    const {weights,referencePathProbability}=referenceWeights(rule.choices,ships.length);
    return {status:'random',destinations:weights.map(item=>item.to),probabilities:weights,
      rule:rule.note||null,...(referencePathProbability?{referencePathProbability}:{})};
  }
  return {status:'unknown',destinations:[],reason:'没有匹配的已校订规则'};
}
// Multi-gauge maps may override a node's rules, fixed edge or dead-end per
// phase with a `node#phase` key (e.g. 7-2's D only opens after gauge 1).
function rulesFor(map,node,phase){
  return map.machineRules?.[`${node}#${phase}`]??map.machineRules?.[node];
}
const compiledRoutePoints=new WeakMap();
function createRouteAssessor(ships,metrics){
  const readings=new Map();
  return (rules,visited)=>{
    let prepared=compiledRoutePoints.get(rules);
    if(!prepared){
      const history=new Set();
      const scan=value=>{if(!value||typeof value!=='object')return;
        if(value.pathIncludes)history.add(value.pathIncludes);
        for(const child of Object.values(value))scan(child);};
      scan(rules);
      prepared={run:preparePoint(rules),history:[...history]};compiledRoutePoints.set(rules,prepared);
    }
    let rows=readings.get(rules);if(!rows){rows=new Map();readings.set(rules,rows);}
    // Only path-dependent rules distinguish visited histories. Missing history
    // remains unknown; it must not be confused with an empty visited set.
    const key=prepared.history.length?visited?prepared.history.map(id=>visited.includes(id)?1:0).join(''):'unknown':'';
    if(!rows.has(key))rows.set(key,prepared.run(ships,visited?{...metrics,visitedNodes:visited}:metrics));
    return rows.get(key);
  };
}
function graphChance(map,node,targets,ships,metrics,seen=new Set(),phase=null,assumeTentative=true,assess){
  if(phase&&map.unavailableByPhase?.[phase]?.includes(node))return [0,0,[]];
  const availabilityUnknown=phase&&map.uncertainAvailabilityByPhase?.[phase]?.includes(node);
  if(targets.includes(node))return availabilityUnknown?[0,1,[]]:[1,1,[]];
  if(map.unresolvedNodes?.includes(node))return [0,1,[]];
  if(seen.has(node))return [0,1,[]];
  if(map.deadEnds?.includes(node)||map.deadEnds?.includes(`${node}#${phase}`)||
    map.terminalNodes.includes(node)||map.bossNodes.includes(node))return [0,0,[]];
  const next=new Set(seen);next.add(node);
  const fixedEdge=map.fixedEdges?.[`${node}#${phase}`]??map.fixedEdges?.[node];
  if(fixedEdge)return graphChance(map,fixedEdge,targets,ships,metrics,next,phase,assumeTentative,assess);
  const point=map.branchPoints.find(item=>item.from===node&&(!phase||!item.phase||item.phase===phase));
  if(!point||!rulesFor(map,node,phase))return [0,1,[]];
  const assessment=assess(rulesFor(map,node,phase),[...seen]);
  const destinations=!assumeTentative&&assessment.status==='tentative'?
    assessment.possibleDestinations:assessment.destinations;
  if(!destinations.length)return [0,1,[]];
  const children=destinations.map(destination=>
    graphChance(map,destination,targets,ships,metrics,next,phase,assumeTentative,assess));
  const tentativePoints=[...new Set([
    ...(assessment.tentative?[node]:[]),
    ...children.filter(child=>child[1]>0).flatMap(child=>child[2]),
  ])];
  if(assessment.status==='fixed'||(assessment.status==='tentative'&&assumeTentative))
    return [children[0][0],children[0][1],tentativePoints];
  const weights=assessment.probabilities?.map(item=>item.probability);
  if((assumeTentative||!assessment.tentative)&&weights?.every(weight=>Number.isFinite(weight))&&
    Math.abs(weights.reduce((sum,weight)=>sum+weight,0)-1)<1e-9){
    return [...[0,1].map(index=>children.reduce((sum,child,i)=>sum+child[index]*weights[i],0)),tentativePoints];
  }
  return [Math.min(...children.map(child=>child[0])),Math.max(...children.map(child=>child[1])),tentativePoints];
}
// Count graph edges on paths that can reach the requested point. This is a
// route-length proxy (the source tables do not classify every node as battle).
function reachableHops(map,node,targets,ships,metrics,seen=new Set(),phase=null,assess){
  if(phase&&map.unavailableByPhase?.[phase]?.includes(node))return [];
  if(targets.includes(node))return [0];
  if(seen.has(node)||map.deadEnds?.includes(node)||map.terminalNodes.includes(node)||
    map.bossNodes.includes(node))return [];
  const next=new Set(seen);next.add(node);
  const fixed=map.fixedEdges?.[`${node}#${phase}`]??map.fixedEdges?.[node];
  if(fixed)return reachableHops(map,fixed,targets,ships,metrics,next,phase,assess).map(n=>n+1);
  const rules=rulesFor(map,node,phase);
  if(!rules)return [];
  const assessment=assess(rules,[...seen]);
  const destinations=assessment.status==='tentative'?assessment.possibleDestinations:assessment.destinations;
  return (destinations||[]).flatMap((to,i)=>assessment.probabilities?.[i]?.probability===0?[]:
    reachableHops(map,to,targets,ships,metrics,next,phase,assess).map(n=>n+1));
}
function evaluateNormalRoute(store,options){
  const timing=perf.begin('route.evaluate');
  try{return snapshotMemo(store,'evaluatedNormalRoutes',JSON.stringify(options),()=>evaluateNormalRouteCore(store,options));}
  finally{perf.end(timing);}
}
// Separate entry/cache prevents a search projection from satisfying a public
// preview query. Its planning shortcut is limited to immutable search scopes.
function evaluateSearchRoute(store,options){
  const timing=perf.begin('route.evaluate');
  try{return snapshotMemo(store,'evaluatedSearchRoutes',JSON.stringify(options),()=>evaluateNormalRouteCore(store,options,true));}
  finally{perf.end(timing);}
}
function evaluateNormalRouteCore(store,{area,target='boss',fleet=1,scheme,phase}={},search=false){
  const map=maps.get(area);
  if(!map)throw error('INVALID_QUERY','未知常规海域；请先查询海域列表');
  if(!Number.isInteger(fleet)||fleet<1||fleet>4)throw error('INVALID_QUERY','fleet 必须是 1-4');
  if(target!=='boss'&&!/^[A-Z][0-9]?$/.test(target))throw error('INVALID_QUERY','target 须为 boss 或点位字母');
  if(scheme&&scheme.fleet!==fleet)throw error('INVALID_QUERY','scheme.fleet 必须与 fleet 相同');
  if(phase!==undefined&&!['gauge1','gauge2','gauge3','gimmick'].includes(phase))
    throw error('INVALID_QUERY','phase 须为 gauge1、gauge2、gauge3 或 gimmick');
  const {ships,metrics}=resolveFleet(store,fleet,scheme,search);
  const assess=createRouteAssessor(ships,metrics);
  const airControl=assessAirControl(map,metrics.airPower,phase);
  const unmappedLandingCraft=ships.filter(ship=>ship.landingCraftEquipped===null)
    .map(ship=>ship.name);
  const bossNodes=phase?map.bossPhases?.[phase]||[]:map.bossNodes;
  if(target==='boss'&&!bossNodes.length)return {area,target,verdict:map.terminalNodes.length?'noBoss':'unknown',
    lineOfSight:metrics.lineOfSight,airControl,
    bossNodes:map.bossNodes,terminalNodes:map.terminalNodes,source:map.source,
    message:map.terminalNodes.length?'该海域没有 Boss，请指定终点点位':'尚未确认该海域的 Boss 点'};
  const targetNodes=target==='boss'?bossNodes:[target];
  const pointAssessments=map.branchPoints.filter(point=>!phase||!point.phase||point.phase===phase)
    .map(point=>{
      const fixed=map.fixedEdges?.[`${point.from}#${phase}`]??map.fixedEdges?.[point.from];
      return {from:point.from,phase:point.phase||null,
    destinations:point.destinations,clauses:point.clauses,
    assessment:fixed?{status:'fixed',destinations:[fixed],reason:'已校订固定连接'}:
    rulesFor(map,point.from,phase)?assess(rulesFor(map,point.from,phase)):
      {status:'unknown',destinations:point.destinations,reason:'该分岐点尚未完成机器规则校订'}};});
  let verdict='unknown',probability=null,assumedChanceRange=null,tentativePoints=[];
  // Only maps with a reviewed, complete start-to-target graph may emit a
  // reachability verdict. Other maps retain the per-point evidence only.
  let chanceRange=null;
  if(map.graphComplete){
    const assumed=graphChance(map,'start',targetNodes,ships,metrics,new Set(),phase||null,true,assess);
    const conservative=graphChance(map,'start',targetNodes,ships,metrics,new Set(),phase||null,false,assess);
    chanceRange=conservative.slice(0,2);
    tentativePoints=assumed[2];
    if(tentativePoints.length)assumedChanceRange=assumed.slice(0,2);
    const [minimum,maximum]=chanceRange;
    verdict=assumed[0]===1&&tentativePoints.length?'likelyGuaranteed':
      minimum===1?'guaranteed':maximum===0?'unreachable':
      minimum===maximum?'possibleRandom':'possibleUnverified';
    probability=minimum===maximum&&verdict!=='likelyGuaranteed'?minimum:null;
  }
  const hops=map.graphComplete?reachableHops(map,'start',targetNodes,ships,metrics,new Set(),phase||null,assess):[];
  return {area,target,targetNodes,phase:phase||null,fleet,ships,
    lineOfSight:metrics.lineOfSight,speed:metrics.speed,openingASW:metrics.openingASW,
    airControl,bossNodes:map.bossNodes,
    terminalNodes:map.terminalNodes,verdict,probability,chanceRange,
    assumedChanceRange,tentativePoints,
    reachableHops:hops.length?{minimum:Math.min(...hops),maximum:Math.max(...hops),unit:'graphEdge'}:null,
    ...(unmappedLandingCraft.length?{warnings:
      [`${unmappedLandingCraft.join('、')} 的装备资料不完整，或搭载了 wiki 尚未核实是否计入大発動艇系的装备；相关分岐按未知处理`]}:{}),
    routeTag:tentativePoints.length?'样本不足':verdict==='guaranteed'?'100%固定':null,
    pointAssessments,source:map.source,
    note:verdict==='unknown'?'分岐条件或固定连接尚未完成校订，不能据此判定目标可达性':
      verdict==='guaranteed'?'按已校订分岐规则固定进入目标点；不包含战斗途中撤退':
        verdict==='likelyGuaranteed'?'按暂定分岐疑似固定进入目标点；样本不足，需保留其他可能出口':
        '存在随机或未校订的后续分岐，不保证抵达'};
}
// Recommendation wording may describe a fixed arrival conditional on LoS.
// Prove a deterministic path with the same composition; retain the actual
// estimate/unknown verdict and never turn it into an observed 100% chance.
function fixedArrivalCondition(route){
  const map=maps.get(route.area),reading=route.lineOfSight;
  if(!map?.graphComplete||!route.targetNodes?.length||
    !['computed','estimate'].includes(reading?.status))return null;
  const points=new Map((route.pointAssessments||[]).map(p=>[p.from,p.assessment]));
  const candidates=Object.values(map.machineRules||{}).flatMap(rules=>rules)
    .map(rule=>rule.when?.los).filter(los=>Number.isFinite(los?.gte)&&los.lt===undefined)
    .sort((a,b)=>a.gte-b.gte);
  const margin=reading.thresholdMargin||0;
  for(const candidate of candidates){
    // LoS rules may follow higher-priority speed rules. Keep the actual
    // speed reading; older results without it cannot prove those rules false.
    const metrics={speed:route.speed||{status:'unknown',ships:[]},
      lineOfSight:{...reading,status:'computed',
      rawScoresByCoefficient:{...reading.rawScoresByCoefficient,
        [candidate.coefficient]:candidate.gte+margin}}};
    let node='start',failed=false;const seen=new Set(),requirements=[];
    while(!route.targetNodes.includes(node)){
      if(seen.has(node)||map.unresolvedNodes?.includes(node)||map.deadEnds?.includes(node)||
        map.deadEnds?.includes(`${node}#${route.phase}`)||map.terminalNodes.includes(node)||
        map.bossNodes.includes(node)||map.unavailableByPhase?.[route.phase]?.includes(node)||
        map.uncertainAvailabilityByPhase?.[route.phase]?.includes(node)){failed=true;break;}
      seen.add(node);
      const edge=map.fixedEdges?.[`${node}#${route.phase}`]??map.fixedEdges?.[node];
      if(edge){node=edge;continue;}
      let assessment=points.get(node);
      const los=assessment?.status==='unknown'?assessment.unconfirmedCondition?.los:assessment?.condition?.los;
      if(los){
        if(los.coefficient!==candidate.coefficient){failed=true;break;}
        assessment=evaluatePoint(rulesFor(map,node,route.phase)||[],route.ships||[],metrics);
        const fixedLos=assessment.condition?.los;
        if(!Number.isFinite(fixedLos?.gte)||fixedLos.lt!==undefined){failed=true;break;}
        requirements.push({from:node,coefficient:fixedLos.coefficient,minimum:fixedLos.gte,
          requiredScore:fixedLos.gte+margin});
      }
      if(assessment?.status!=='fixed'||assessment.destinations.length!==1){failed=true;break;}
      node=assessment.destinations[0];
    }
    if(failed||!requirements.length||map.unavailableByPhase?.[route.phase]?.includes(node)||
      map.uncertainAvailabilityByPhase?.[route.phase]?.includes(node))continue;
    return {status:'fixedWhenLosMet',requirements,
      confirmedMeets:requirements.every(r=>losPredicate(reading,{coefficient:r.coefficient,gte:r.minimum})===true),
      estimatedMeets:requirements.every(r=>Number.isFinite(reading.rawScoresByCoefficient?.[r.coefficient])&&
        reading.rawScoresByCoefficient[r.coefficient]>=r.requiredScore)};
  }
  return null;
}
module.exports={listNormalMaps,evaluateNormalRoute,evaluateSearchRoute,predicate,preparePredicate,preparePoint,evaluatePoint,fixedArrivalCondition,
  LANDING_CRAFT_IDS,LANDING_CRAFT_EXCLUDED};
