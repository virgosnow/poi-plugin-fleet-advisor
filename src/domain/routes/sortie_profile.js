'use strict';
// Join the reviewed route decision with the wiki enemy table. The enemy table
// describes nodes, not edges: never infer an edge from an enemy-table row.
const path=require('path');
const fs=require('fs');
const {groupNodeEnemies,routeThreat}=require('./route_threats');
const ROOT=path.join(__dirname,'../../../data');
const routeMaps=new Map(),encounters=new Map();
const enemyCatalog=new Map(require('../../../data/sortie/enemy_catalog.json').enemies.map(e=>[e.apiId,e]));
const pending=require('../../../data/sortie/adjudications.json').entries.filter(e=>e.status==='pending');
const previewCache=new Map();
const profileCache=new Map();
for(const name of fs.readdirSync(path.join(ROOT,'normal_routes')).filter(n=>/^\d-\d\.json$/.test(n))){
  const map=require(path.join(ROOT,'normal_routes',name));routeMaps.set(map.area,map);
}
for(const name of fs.readdirSync(path.join(ROOT,'sortie/encounters')).filter(n=>/^\d-\d\.json$/.test(n))){
  const map=require(path.join(ROOT,'sortie/encounters',name));encounters.set(map.area,map);
}
const hasAswNodes=area=>Object.values(encounters.get(area)?.nodes||{})
  .some(node=>node.kind==='asw');
const LIMIT=128;
const NON_COMBAT=new Set(['noBattle','item','resources','transport','activeBranch','airRecon']);
// Generic consumption from https://wikiwiki.jp/kancolle/資材 . Explicit
// per-node values from the encounter table always override these defaults.
const DEFAULT_CONSUMPTION={battle:[0.2,0.2],asw:[0.08,0],nightBattle:[0.1,0.1],
  aerialRaid:[0.08,0.04],aerialCombat:[0.2,0.2]};
const countOf=(path,nodes,kind)=>path.filter(id=>{
  const value=nodes[id]?.kind;
  return kind==='surface'?value==='battle'||value==='nightBattle':
    kind==='air'?value==='aerialRaid'||value==='aerialCombat':value===kind;
}).length;
const span=values=>({minimum:Math.min(...values),maximum:Math.max(...values)});
function consumption(node,area){
  if(!node)return {fuel:null,ammo:null,estimated:true};
  const effect=`${node.effect?.raw||''} ${node.kindRaw||''}`;
  if(node.kind==='whirlpool'){
    const fuel=/燃料/.test(effect),ammo=/弾薬/.test(effect);
    return {fuel:fuel||!ammo?null:0,ammo:ammo||!fuel?null:0,estimated:true};
  }
  if(node.kind==='resources'&&/弾薬/.test(effect))
    return {fuel:0,ammo:null,estimated:true};
  // The resource wiki explicitly calls 5-2 I's aerial-battle consumption
  // unverified. Do not turn the generic 20% into a definite percentage.
  if(area==='5-2'&&node.node==='I'&&node.kind==='aerialCombat'&&
    !Number.isFinite(node.ammoFraction))return {fuel:null,ammo:null,estimated:true};
  const defaults=node.kind==='asw'&&node.boss?[0.2,0.2]:
    DEFAULT_CONSUMPTION[node.kind];
  if(!defaults&&!NON_COMBAT.has(node.kind))return {fuel:null,ammo:null,estimated:true};
  const fuel=Number.isFinite(node.fuelFraction)?node.fuelFraction:defaults?.[0]??0;
  const ammo=Number.isFinite(node.ammoFraction)?node.ammoFraction:defaults?.[1]??0;
  return {fuel,ammo,estimated:!!defaults&&
    (!Number.isFinite(node.fuelFraction)||!Number.isFinite(node.ammoFraction))};
}
// Qualitative priority only: contested enemy stats and unfiltered phase/HQ
// patterns must not become a numeric damage prediction. Keep all variants.
function enemySummary(enemy){
  const catalog=enemyCatalog.get(enemy.apiId),type=catalog?.shipType||'',name=enemy.name||'';
  const identityVerified=/^verified/.test(enemy.apiIdStatus||'');
  const text=`${type} ${name}`;
  const priority=/陸上|棲姫|棲鬼/.test(text)?7:/戦艦/.test(text)?6:
    /空母|要塞/.test(text)?5:/潜水/.test(text)?4:/雷巡/.test(text)?3:/重巡/.test(text)?2:1;
  const reason=/陸上/.test(type)?'陆上目标，留意对地装备':/潜水/.test(text)?'潜艇威胁，留意先制对潜':
    /戦艦/.test(text)?'战舰炮击，留意大破撤退':/空母|要塞/.test(text)?'航空攻击，留意制空与防空':
    /棲姫|棲鬼/.test(text)?'高威胁敌舰，留意大破撤退':'水上炮雷攻击';
  const family=(catalog?.name||name).replace(/\s*(elite|flagship)$/i,'');
  let familyName=catalog?.kcwikiNameZh||name;
  const suffix=catalog?.kcwikiNameJa?.startsWith(catalog.name)?catalog.kcwikiNameJa.slice(catalog.name.length).trim():'';
  if(/^[A-Z0-9]+$/.test(suffix)&&familyName.endsWith(suffix))familyName=familyName.slice(0,-suffix.length);
  familyName=familyName.replace(/\s*(elite|flagship)$/i,'').trim();
  return {name:catalog?.kcwikiNameZh||name,originalName:name,
    familyKey:family,familyName,variantRank:/flagship/i.test(catalog?.name||name)?2:/elite/i.test(catalog?.name||name)?1:0,
    apiId:identityVerified?enemy.apiId:null,identityVerified,type,priority,reason};
}
function nodeSummary(id,node,area){
  if(!node)return {id,kind:id==='start'?'start':'unknown',enemies:[],threatStatus:id==='start'?'none':'unknown'};
  const patterns=Object.values(node.phases||{}).flatMap(phase=>phase.patterns||[]);
  const submarine=enemy=>/潜水/.test(enemySummary(enemy).type+' '+enemy.name);
  // Count each formation separately; alternative formations are not one fleet.
  // Keep flagship identity before threat sorting obscures its original position.
  const submarineCounts=patterns.map(pattern=>[...(pattern.enemyShips||[]),
    ...(pattern.escortFleet?.enemyShips||[])].filter(submarine).length);
  const conflicts=pending.filter(e=>e.area===area&&e.node===id);
  const enemies=new Map();
  for(const pattern of patterns)for(const enemy of [...(pattern.enemyShips||[]),
    ...(pattern.escortFleet?.enemyShips||[])]){
    const summary=enemySummary(enemy),key=summary.apiId||summary.originalName;
    if(!enemies.has(key))enemies.set(key,summary);
  }
  return {id,kind:node.kind,boss:!!node.boss,
    submarines:submarineCounts.length?span(submarineCounts):null,
    submarineFlagship:patterns.length>0&&patterns.every(pattern=>pattern.enemyShips?.[0]&&submarine(pattern.enemyShips[0])),
    enemies:[...enemies.values()].sort((a,b)=>b.priority-a.priority||a.name.localeCompare(b.name)),
    enemyFamilies:groupNodeEnemies(patterns,enemySummary),
    threatStatus:patterns.length?'qualitative':NON_COMBAT.has(node.kind)?'none':'unknown',
    compositionUncertain:conflicts.some(e=>e.kind==='compositionConflict'),
    dataWarnings:conflicts.length?['部分敌编成或数值在资料间存在差异，尚待裁定']:[],
    patterns:patterns.length};
}
function previewGraph(map,route,data){
  const key=`${map.area}:${route.phase||''}:${route.targetNodes.join(',')}`;
  if(previewCache.has(key))return previewCache.get(key);
  const edges=new Map(),ids=new Set(['start']);
  const add=(from,to)=>{ids.add(from);ids.add(to);edges.set(`${from}>${to}`,{from,to});};
  for(const [key,to] of Object.entries(map.fixedEdges||{})){
    const [from,phase]=key.split('#');if(phase&&phase!==route.phase)continue;
    const scoped=route.phase&&map.fixedEdges?.[`${from}#${route.phase}`];
    if(!phase&&scoped)continue;add(from,to);
  }
  for(const point of map.branchPoints){
    if(point.phase&&route.phase&&point.phase!==route.phase)continue;
    for(const to of point.destinations)add(point.from,to);
  }
  const result={nodes:[...ids].map(id=>({...nodeSummary(id,data.nodes[id],map.area),
    target:route.targetNodes.includes(id)})),edges:[...edges.values()]};
  previewCache.set(key,result);return result;
}
function profileForRoute(area,route,selectedPaths){
  const map=routeMaps.get(area),data=encounters.get(area);
  if(!map?.graphComplete||!data||!route.targetNodes?.length)
    return {status:'unavailable',reason:'路线或逐点敌编成资料不完整'};
  const points=new Map();
  for(const point of route.pointAssessments||[])
    if(!points.has(point.from)||point.phase===route.phase)
      points.set(point.from,point.assessment);
  let paths=[];let incomplete=false,truncated=false;
  const visit=(node,visited,travel,uncertain)=>{
    const sequence=['start',...travel].join('>');
    if((map.incompatiblePathSegments||[]).some(rule=>('>'+sequence+'>').includes('>'+rule.nodes.join('>')+'>')))return;
    if(paths.length>=LIMIT){truncated=true;return;}
    if(route.phase&&map.unavailableByPhase?.[route.phase]?.includes(node))return;
    if(route.targetNodes.includes(node)){
      paths.push({nodes:travel,uncertain:uncertain||!!map.uncertainAvailabilityByPhase?.[route.phase]?.includes(node)});
      return;
    }
    if(visited.has(node)){incomplete=true;return;}
    if(map.unresolvedNodes?.includes(node)){incomplete=true;return;}
    if(map.deadEnds?.includes(node)||map.deadEnds?.includes(`${node}#${route.phase}`)||
      map.terminalNodes.includes(node)||map.bossNodes.includes(node))return;
    const next=new Set(visited);next.add(node);
    const fixed=map.fixedEdges?.[`${node}#${route.phase}`]??map.fixedEdges?.[node];
    if(fixed){visit(fixed,next,fixed==='start'?travel:[...travel,fixed],uncertain);return;}
    const point=points.get(node);
    if(!point?.destinations?.length){incomplete=true;return;}
    const destinations=point.status==='tentative'?
      point.possibleDestinations||point.destinations:point.destinations;
    let options=destinations.map((to,index)=>({to,
      probability:point.probabilities?.[index]?.probability}));
    // The 7-4 J exit depends on the path already taken. The route evaluator
    // deliberately leaves this branch unverified; here, use the explicit wiki
    // condition only to avoid displaying an impossible example path.
    if(area==='7-4'&&node==='J'){
      if(visited.has('D'))options=options.filter(option=>option.to==='K');
      else if(visited.has('E')){
        const safeLos=Number(route.lineOfSight?.scoresByCoefficient?.[4])-
          Number(route.lineOfSight?.thresholdMargin||0);
        if(Number.isFinite(safeLos)&&safeLos<33)
          options=options.filter(option=>option.to==='K');
        else if(Number.isFinite(safeLos)&&safeLos>=37&&
          route.ships?.length===6&&route.ships.some(ship=>ship.stype!==1))
          options=options.filter(option=>option.to==='L');
        else if(Number.isFinite(safeLos)&&safeLos>=33&&safeLos<37)
          options=options.filter(option=>option.to!=='P');
      }
    }
    for(const option of options){
      if(option.probability===0)continue;
      visit(option.to,next,[...travel,option.to],uncertain||point.status!=='fixed');
    }
  };
  visit('start',new Set(),[],false);
  if(selectedPaths){
    const selected=new Set(selectedPaths.map(nodes=>nodes.join('>')));
    paths=paths.filter(path=>selected.has(path.nodes.join('>')));
  }
  if(!paths.length)return {status:'unavailable',reason:'无法从已核对的带路结果列出目标路线'};
  // Enemy summaries and consumption depend on the resolved paths, not the
  // candidate ships/equipment. Resolve branches first (including 7-4 history
  // and LoS), then share only identical path sets and uncertainty flags.
  const profileKey=JSON.stringify([area,route.phase||null,route.targetNodes,paths,incomplete,truncated]);
  if(profileCache.has(profileKey))return profileCache.get(profileKey);
  const preview=previewGraph(map,route,data),summaries=new Map(preview.nodes.map(node=>[node.id,node]));
  const detailed=paths.map(row=>{
    // Boss ammo is measured on entry, before the boss battle consumes ammo.
    const beforeBoss=row.nodes.slice(0,-1).map(id=>consumption(data.nodes[id],area));
    const consumed=row.nodes.map(id=>consumption(data.nodes[id],area));
    const fuel=consumed.some(c=>c.fuel===null)?null:Math.min(1,consumed.reduce((sum,c)=>sum+c.fuel,0));
    const ammo=consumed.some(c=>c.ammo===null)?null:Math.min(1,consumed.reduce((sum,c)=>sum+c.ammo,0));
    const entryAmmo=beforeBoss.some(c=>c.ammo===null)?null:
      beforeBoss.reduce((sum,c)=>sum+c.ammo,0);
    const entryFuel=beforeBoss.some(c=>c.fuel===null)?null:
      beforeBoss.reduce((sum,c)=>sum+c.fuel,0);
    return {...row,surfaceBattles:countOf(row.nodes,data.nodes,'surface'),
      airBattles:countOf(row.nodes,data.nodes,'air'),
      aerialCombat:countOf(row.nodes,data.nodes,'aerialCombat'),
      aerialRaid:countOf(row.nodes,data.nodes,'aerialRaid'),
      aswBattles:countOf(row.nodes,data.nodes,'asw'),
      mixedAswBattles:row.nodes.filter(id=>summaries.get(id)?.kind==='battle'&&summaries.get(id)?.submarines?.maximum>0).length,
      nightBattles:countOf(row.nodes,data.nodes,'nightBattle'),
      hops:row.nodes.length,
      fuelConsumed:fuel,ammoConsumed:ammo,
      fuelAtTarget:entryFuel===null?null:Math.max(0,Math.round((1-entryFuel)*100)),
      ammoAtTarget:entryAmmo===null?null:Math.max(0,Math.round((1-entryAmmo)*100)),
      estimated:consumed.some(c=>c.estimated)};
  });
  const range=key=>span(detailed.map(p=>p[key]));
  const allKnown=detailed.every(p=>p.ammoAtTarget!==null);
  const entryFuelKnown=detailed.every(p=>p.fuelAtTarget!==null);
  const knownAmmo=detailed.every(p=>p.ammoConsumed!==null);
  const knownFuel=detailed.every(p=>p.fuelConsumed!==null);
  const uncertain=incomplete||truncated||detailed.some(p=>p.uncertain);
  const ordered=detailed.slice().sort((a,b)=>a.hops-b.hops||a.nodes.join('').localeCompare(b.nodes.join('')));
  const result={status:uncertain?'possible':'known',area,targetNodes:route.targetNodes,
    source:data.source?.url||null,
    pathCount:detailed.length,truncated,incomplete,
    counts:{surface:range('surfaceBattles'),air:range('airBattles'),
      aerialCombat:range('aerialCombat'),aerialRaid:range('aerialRaid'),
      asw:range('aswBattles'),mixedAsw:range('mixedAswBattles'),night:range('nightBattles')},
    hops:range('hops'),
    ammoAtTargetPercent:allKnown?range('ammoAtTarget'):null,
    fuelAtTargetPercent:entryFuelKnown?range('fuelAtTarget'):null,
    mapPreview:preview,
    routePaths:ordered
      .map(p=>({nodes:p.nodes,uncertain:p.uncertain,fuelAtTargetPercent:p.fuelAtTarget,
        ammoAtTargetPercent:p.ammoAtTarget,
        counts:Object.fromEntries([['surface',p.surfaceBattles],['aerialCombat',p.aerialCombat],
          ['aerialRaid',p.aerialRaid],['asw',p.aswBattles],['night',p.nightBattles]]
          .map(([key,value])=>[key,{minimum:value,maximum:value}])),
        threat:routeThreat(preview.nodes,[p],{incomplete,truncated})})),
    threat:routeThreat(preview.nodes,detailed,{incomplete,truncated}),
    ammoConsumedFraction:knownAmmo?span(detailed.map(p=>p.ammoConsumed)):null,
    fuelConsumedFraction:knownFuel?span(detailed.map(p=>p.fuelConsumed)):null,
    consumptionEstimated:detailed.some(p=>p.estimated),
    examples:detailed.slice().sort((a,b)=>a.hops-b.hops||
      a.nodes.join('').localeCompare(b.nodes.join(''))).slice(0,3).map(p=>p.nodes)};
  if(profileCache.size>=256)profileCache.delete(profileCache.keys().next().value);
  profileCache.set(profileKey,result);return result;
}
const overviewCache=new Map();
// Reference display before a fleet exists. Edges still come only from the
// reviewed route graph; these paths are not a verdict that a fleet can sail them.
function previewForMap(area,{target='boss',phase,paths}={}){
  const key=JSON.stringify([area,target,phase||null,paths||null]);
  if(overviewCache.has(key))return overviewCache.get(key);
  const map=routeMaps.get(area),data=encounters.get(area);
  if(!map||!data)return {area,status:'unavailable',routePaths:[],examples:[]};
  const route={targetNodes:target==='boss'?(phase?map.bossPhases?.[phase]||map.bossNodes:map.bossNodes):[target],phase,
    pointAssessments:map.branchPoints.filter(p=>!phase||!p.phase||p.phase===phase).map(p=>({from:p.from,phase:p.phase,
      assessment:{status:'unknown',destinations:p.destinations}}))};
  const profile=profileForRoute(area,route,paths),graph=previewGraph(map,route,data);
  const known=new Set(graph.nodes.map(n=>n.id));
  const result={...profile,area,referenceOnly:true,targetNodes:route.targetNodes,
    routePaths:profile.routePaths||[],examples:profile.examples||[],
    mapPreview:{...graph,nodes:graph.nodes.concat(Object.entries(data.nodes).filter(([id])=>!known.has(id)).map(([id,node])=>nodeSummary(id,node,area)))}};
  overviewCache.set(key,result);return result;
}
module.exports={profileForRoute,previewForMap,consumption,hasAswNodes};
