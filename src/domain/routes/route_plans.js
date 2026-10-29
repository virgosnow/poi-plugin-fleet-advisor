'use strict';
const {previewForMap}=require('./sortie_profile');
const {evaluatePoint,predicate,preparePredicate,preparePoint}=require('./normal_routes');
const {effectiveRule}=require('./route_policy');
const {calculationTable}=require('../../shared/calculation_cache');
const maps=new Map();
const mapFor=area=>{if(!maps.has(area))maps.set(area,require(`../../../data/normal_routes/${area}.json`));return maps.get(area);};
// Static rule parsing is shared only within a synchronous search step/batch.
// Fleet facts are never cached here; edits and later jobs start a new scope.
let planningCache=null;
function withPlanningCache(run,cache=planningCache||new Map()){
  const previous=planningCache;planningCache=cache;
  try{return run();}finally{planningCache=previous;}
}
function planningRules(rules){
  if(planningCache?.has(rules))return planningCache.get(rules);
  const prepared={assess:preparePoint(rules),borders:rules.flatMap(r=>thresholds(r.when))};
  planningCache?.set(rules,prepared);return prepared;
}
const TYPES={1:'海防',2:'驱逐',3:'轻巡',4:'雷巡',5:'重巡',6:'航巡',7:'轻空母',8:'高速战舰',9:'战舰',10:'航战',11:'正规空母',12:'战舰',13:'潜水舰',14:'潜水空母',16:'水母',17:'扬陆舰',18:'装甲空母',19:'工作舰',20:'潜水母舰',21:'练巡',22:'补给舰'};
const GROUPS={carrier:'空母系',fleetCarrier:'正规/装甲空母',battleship:'战舰级',supply:'补给舰',heavyCruiser:'重巡/航巡',slowBattleship:'低速战舰'};
function optionPaths(option){
  return [...new Map((option?.strategy?.paths||option?.paths||(option?[option.nodes]:[])).map(nodes=>[nodes.join('>'),nodes])).values()];
}
// Merge only paths differing at one position. Combining unrelated branch
// letters would imply journeys the fleet cannot take (a false cross product).
function pathLabel(paths){
  const unique=[...new Map(paths.map(nodes=>[nodes.join('>'),nodes])).values()];
  // Preserve the compact optional-detour notation only for the exact pair
  // that proves it: the direct path and that same path with one insertion.
  if(unique.length===2){
    const [a,b]=unique;let prefix=0,suffix=0;
    while(prefix<Math.min(a.length,b.length)&&a[prefix]===b[prefix])prefix++;
    while(suffix<Math.min(a.length,b.length)-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;
    const left=a.slice(prefix,a.length-suffix),right=b.slice(prefix,b.length-suffix);
    if(prefix&&suffix&&(!left.length||!right.length))return [...a.slice(0,prefix),
      `(${(left.length?left:right).join('→')})`,...a.slice(a.length-suffix)].join('→');
  }
  const groups=unique.map(nodes=>nodes.map(node=>[node]));
  for(let changed=true;changed;){
    changed=false;
    outer:for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){
      if(groups[i].length!==groups[j].length)continue;
      const differences=groups[i].flatMap((nodes,k)=>nodes.join('/')===groups[j][k].join('/')?[]:[k]);
      if(differences.length!==1)continue;
      const k=differences[0];groups[i][k]=[...new Set([...groups[i][k],...groups[j][k]])].sort();
      groups.splice(j,1);changed=true;break outer;
    }
  }
  return groups.map(nodes=>nodes.map(group=>group.join('/')).join('→')).join('；');
}
function fleetPaths(route,option){
  if(!route?.area||!route.ships?.length||option?.phase&&option.phase!==route.phase)return [];
  return optionPaths(option).filter(nodes=>planningPath(route,nodes,
    {allowTentative:false,includeLosRequirements:false}).chance.max!==0);
}
function fleetPathOption(route,option){
  if(optionPaths(option).length<=1||!route?.area||!route.ships?.length||option.phase&&option.phase!==route.phase)return option;
  const displayPaths=fleetPaths(route,option);
  const display=displayPaths.length?pathLabel(displayPaths):'无可达分支';
  // Keep the complete option paths for re-evaluation after manual edits.
  return {...option,pathLabel:display,displayPathLabel:display,label:`${option.name}（${display}）`,displayPaths};
}
function orderedPathNodes(paths){
  const edges=new Map(),incoming=new Map();
  const add=node=>{if(!edges.has(node)){edges.set(node,new Set());incoming.set(node,0);}};
  add('start');
  for(const path of paths){let from='start';for(const to of path){
    add(to);if(!edges.get(from).has(to)){edges.get(from).add(to);incoming.set(to,incoming.get(to)+1);}from=to;
  }}
  const ready=[...incoming].filter(([,count])=>count===0).map(([node])=>node),ordered=[];
  while(ready.length){
    const from=ready.shift();ordered.push(from);
    for(const to of edges.get(from)){incoming.set(to,incoming.get(to)-1);if(incoming.get(to)===0)ready.push(to);}
  }
  // Preserve a deterministic catalog order if a future route revisits a node.
  return ordered.concat([...edges.keys()].filter(node=>!ordered.includes(node)));
}
// Branches are explicit, mutually exclusive journeys of ONE fleet. Do not
// combine separate recommendations or alternative player-controlled exits.
function optionPlanning(route,option){
  const branches=optionPaths(option).map(nodes=>({nodes,...planningPath(route,nodes,{allowTentative:false})}));
  if(branches.length===1)return {...branches[0],branches};
  const min=Math.min(1,branches.reduce((sum,b)=>sum+b.chance.min,0)),max=Math.min(1,branches.reduce((sum,b)=>sum+b.chance.max,0));
  const viable=branches.filter(b=>b.chance.max>0),considered=viable.length?viable:branches;
  const losRequirements=[...new Map(considered.flatMap(b=>b.losRequirements).map(r=>[`${r.from}>${r.to}:${r.coefficient}:${r.required}`,r])).values()];
  const best=considered.slice().sort((a,b)=>b.chance.min-a.chance.min||a.losShortfall-b.losShortfall)[0];
  return {...best,branches,chance:{min,max,probability:Math.abs(min-max)<1e-9?min:null},losRequirements,
    losShortfall:losRequirements.reduce((sum,r)=>sum+(r.shortfall??1000),0)};
}
function routeOptions(area,target='boss',phase){
  const phases=target==='boss'&&!phase?Object.keys(mapFor(area).bossPhases||{}):[];
  if(phases.length)return phases.flatMap((p,i)=>routeOptions(area,target,p).map(r=>({...r,phase:p,phaseLabel:`第 ${i+1} 阶段`,label:`第 ${i+1} 阶段·${r.label}`})));
  const paths=previewForMap(area,{target,phase}).routePaths;
  const catalog=require('../../../data/normal_route_guides.json').maps;
  const phaseGuides=!phase?Object.entries(catalog).filter(([key])=>key.startsWith(area+':gauge')).map(([,value])=>value):[];
  const combined=phaseGuides.length?{source:phaseGuides[0].source,routes:phaseGuides.flatMap((g,i)=>g.routes.map(r=>({...r,name:`第 ${i+1} 阶段·${r.name}`})))}:null;
  const guide=catalog[area+':'+(phase||target)]||catalog[area+':'+target]||
    ((target==='boss'||area==='1-6'&&target==='N')?(catalog[area]||combined):null);
  const guidePaths=(guide?.routes||[]).filter(g=>optionPaths(g).every(nodes=>paths.some(p=>p.nodes.join('>')===nodes.join('>'))));
  // Physical paths remain explicit query targets, not another preset list.
  const used=new Set(guidePaths.map(p=>p.key));
  const choices=[...guidePaths,...paths.filter(p=>!used.has(p.nodes.join('>'))).map(p=>({nodes:p.nodes,name:'自选路线',recommend:false}))];
  return choices.map(p=>({key:p.key||p.nodes.join('>'),id:p.id,
    name:p.name,label:`${p.name}（${p.strategy?.pathLabel||p.pathLabel||p.nodes.join('→')}）`,nodes:p.nodes,
    ...(p.paths?{paths:p.paths,pathLabel:p.pathLabel}:{}),
    ...(guide?.arrivalMode==='boss'?{arrivalMode:'boss'}:{}),
    ...(p.strategy?{strategy:p.strategy}:{}),
    ...(p.fleetRequirement?{fleetRequirement:p.fleetRequirement}:{}),
    ...(p.summary?{summary:p.summary,priority:p.priority}:{}),
    ...(phase?{phase}:{}),basis:guidePaths.includes(p)?'guide':'inferred',source:guidePaths.includes(p)?guide.source:null,
    ...(mapFor(area).phaseNotes?.[phase]?{phaseNote:mapFor(area).phaseNotes[phase]}:{}),
    ...(p.recommend===false?{recommend:false}:{}),templates:p.templates||null}));
}
// Limit the candidate catalog before expensive fleet/equipment searches.
// Full routeOptions and the graph remain available for route diagnostics and Boss odds.
function currentPhase(area,store){
  const phases=Object.keys(mapFor(area).bossPhases||{});
  const number=Number(store?.info?.maps?.[Number(area.replace('-',''))]?.api_gauge_num);
  return phases[Number.isInteger(number)&&number>0&&number<=phases.length?number-1:0];
}
function recommendedOptions(area,target='boss',phase,settings,store){
  // Show every curated option in stage order, including inactive stages.
  // Legacy route-budget settings no longer hide or skip recommendations.
  return routeOptions(area,target,phase).filter(option=>option.recommend!==false);
}
// Probability of this exact path, not the sum of all paths to the same boss.
// Missing conditions remain intervals; missing random odds use the selected-exit reference policy.
const isPlayerChoice=a=>a?.status==='unknown'&&!a.tentative&&
  /能動分岐|能动分岐/.test(a.reason||a.rule||'');
function pathChance(route,nodes,assessmentAt){
  const map=mapFor(route.area),phase=route.phase;
  const sequence='>start>'+nodes.join('>')+'>';
  if((map.incompatiblePathSegments||[]).some(r=>sequence.includes('>'+r.nodes.join('>')+'>')))return {min:0,max:0,probability:0};
  let min=1,max=1,from='start';
  for(const to of nodes){
    if(map.unavailableByPhase?.[phase]?.includes(to))return {min:0,max:0,probability:0};
    if(map.uncertainAvailabilityByPhase?.[phase]?.includes(to))min=0;
    const fixed=map.fixedEdges?.[`${from}#${phase}`]??map.fixedEdges?.[from];
    if(fixed){if(fixed!==to)return {min:0,max:0,probability:0};}
    else{
      // Hull search resolves points on demand; previews use their observed assessments.
      const a=assessmentAt?assessmentAt(from):route.pointAssessments?.find(p=>p.from===from&&(!p.phase||p.phase===phase))?.assessment;
      const destinations=a?.possibleDestinations||a?.destinations||[];
      if(destinations.length&&!destinations.includes(to))return {min:0,max:0,probability:0};
      // A chosen route already specifies the exit at a player-controlled branch.
      // Validate the exit above; this choice adds no random failure probability.
      const chosen=isPlayerChoice(a)&&destinations.includes(to);
      if(a?.status!=='fixed'&&!chosen){
        const weights=a?.probabilities,weight=weights?.find(p=>p.to===to)?.probability;
        const known=a?.status==='random'&&!a.tentative&&weights?.every(p=>Number.isFinite(p.probability)&&p.probability>=0)&&Math.abs(weights.reduce((s,p)=>s+p.probability,0)-1)<1e-9;
        if(a?.status==='random'&&(a.referencePathProbability||!known&&(!weights?.length||weights.some(w=>!Number.isFinite(w.probability))))){
          const selected=Number.isFinite(weight)?weight:a.referencePathProbability??.5;
          min*=selected;max*=selected;
        }else if(known&&Number.isFinite(weight)){min*=weight;max*=weight;}else min=0;
      }
    }
    if(max===0)return {min:0,max:0,probability:0};
    from=to;
  }
  if(!map.graphComplete||!route.targetNodes?.includes(from))min=0;
  return {min,max,probability:Math.abs(min-max)<1e-9?min:null};
}
function describe(v){
  const count=(name,c)=>name+(c.exact!==undefined?` ${c.exact} 艘`:c.min!==undefined?`至少 ${c.min} 艘`:`最多 ${c.max} 艘`);
  if(v===true||v==='otherwise')return '其余编成';
  if(v.all)return v.all.map(describe).join('，且 ');
  if(v.any)return '('+v.any.map(describe).join(' 或 ')+')';
  if(v.not)return '不满足 '+describe(v.not);
  if(v.count)return count([...(v.count.stypes||[]).map(t=>TYPES[t]||t),...(v.count.groups||[]).map(g=>GROUPS[g]||g),...(v.count.prefixes||[])].join('/'),v.count);
  if(v.shipCount)return count('舰队',v.shipCount);
  if(v.openingTorpedoCarriers)return count('可先制雷击舰',v.openingTorpedoCarriers);
  if(v.pathIncludes)return `已经过 ${v.pathIncludes} 点`;
  if(v.allStypes)return '全队仅含 '+v.allStypes.map(t=>TYPES[t]||t).join('/');
  if(v.allHulls)return '全队仅含 '+[...(v.allHulls.stypes||[]).map(t=>TYPES[t]||t),...(v.allHulls.prefixes||[])].join('/');
  if(v.flagshipStype)return '旗舰为 '+v.flagshipStype.map(t=>TYPES[t]||t).join('/');
  if(v.flagshipName)return '旗舰为 '+v.flagshipName.prefixes.join('/');
  if(v.shipName)return '包含 '+v.shipName.prefixes.join('/');
  if(v.los)return `33 式索敌（系数 ${v.los.coefficient}） `+
    [v.los.gte!==undefined?`≥ ${v.los.gte}`:null,v.los.lt!==undefined?`< ${v.los.lt}`:null].filter(Boolean).join(' 且 ');
  const speeds={slow:'低速',fast:'高速',fastPlus:'高速+',fastest:'最速'};
  if(v.speedAtLeast)return `全队${speeds[v.speedAtLeast]}以上`;
  if(v.speedIs)return `全队速力为${speeds[v.speedIs]}`;
  if(v.anyShipSpeed)return `含${speeds[v.anyShipSpeed.speedIs]}舰`;
  for(const [key,label] of Object.entries({radarCarriers:'载电探舰',drumCarriers:'载运输桶舰',landingCraftCarriers:'载登陆艇舰',transportEquipCount:'运输装备计数'}))if(v[key])return count(label,v[key]);
  return '尚未确认的条件';
}
function fleetRequirementAssessment(route,option){
  const required=option?.fleetRequirement;
  return {eligible:!required||predicate(required,route.ships||[],{})===true,
    description:required?describe(required):''};
}
function requirements(area,nodes,phase){
  const map=mapFor(area);let from='start';const result=[];
  for(const to of nodes){
    const rules=map.machineRules?.[`${from}#${phase}`]??map.machineRules?.[from];
    if(rules)result.push({from,to,rules:rules.map(source=>{const r=effectiveRule(source);return {condition:describe(r.when)+(Number.isFinite(r.chance)?`；${Math.round(r.chance*10000)/100}% 进入 ${r.to}，否则继续判断`:''),destinations:r.to||r.assumedTo||(r.choices||[]).map(c=>c.to).join('/'),chance:r.chance,tentative:false};})});
    from=to;
  }
  return result;
}
// UI explanation only. Never highlight a later true condition after an earlier
// true OR unresolved condition: route rules are evaluated in priority order.
function requirementDetails(area,nodes,phase,route){
  const map=mapFor(area),ready=route?.area===area&&route.ships?.length>0;
  const metrics={lineOfSight:route?.lineOfSight||{status:'unknown'},speed:route?.speed||{status:'unknown'}};
  const calculated={...metrics,lineOfSight:{...metrics.lineOfSight,
    status:metrics.lineOfSight.status==='estimate'?'computed':metrics.lineOfSight.status},
    speed:{...metrics.speed,status:metrics.speed.status==='estimated'?'observed':metrics.speed.status,
      ships:metrics.speed.ships?.map(s=>({...s,status:s.status==='estimated'?'observed':s.status}))}};
  const tree=value=>{
    const operator=value?.all?'all':value?.any?'any':value?.not?'not':null;
    const speedCondition=value?.speedAtLeast?{kind:'minimum',value:value.speedAtLeast}:
      value?.speedIs?{kind:'exact',value:value.speedIs}:null;
    return {operator,text:describe(value),met:ready?predicate(value,route.ships,calculated):null,
      ...(speedCondition?{speedCondition}:{}),
      children:operator?(operator==='not'?[value.not]:value[operator]).map(tree):[]};
  };
  return requirements(area,nodes,phase).map(point=>{
    calculated.visitedNodes=nodes.slice(0,Math.max(0,nodes.indexOf(point.from)+1));
    metrics.visitedNodes=calculated.visitedNodes;
    const rules=map.machineRules?.[`${point.from}#${phase}`]??map.machineRules?.[point.from];
    // Unconditional player choices need instructions even before a fleet exists.
    // Reuse the same explicit-choice test as pathChance, not generic uncertainty.
    const choice=evaluatePoint(rules,[],metrics);
    const playerChoice=isPlayerChoice(choice)&&choice.destinations.includes(point.to);
    let stopped=false,dependsOnEstimate=false;
    return {...point,playerChoice,rules:playerChoice?[]:point.rules.map((row,i)=>{
      const rule=effectiveRule(rules[i]),conditionTree=tree(rule.when),match=conditionTree.met;
      const observed=ready?predicate(rule.when,route.ships,metrics):null;
      let state='idle';
      if(ready){
        if(stopped)state='inactive';
        else{
          if(match!==observed)dependsOnEstimate=true;
          if(match===false)state='unmatched';
          else{
            stopped=match===null||!Number.isFinite(rule.chance)||rule.chance>=1;
            state=match===null||rule.conditionUnknown?'pending':rule.tentative||rule.uncertain?'tentative':
              dependsOnEstimate?'estimated':'matched';
          }
        }
      }
      const active=['matched','estimated','tentative'].includes(state);
      return {...row,conditionTree,state,active,offRoute:active&&!(rule.chance<1)&&!row.destinations.split('/').includes(point.to)};
    })};
  });
}
// Unlike evaluatePoint's deliberately conservative public result, this hull
// prefilter keeps evaluating lower-priority rules after an unknown gear test.
// A known true rule ends the chain, so unrelated exits cannot crowd out hulls.
function possiblePoint(rules,ships,metrics,prepared){
  const destinations=new Set();
  for(const sourceRule of rules){
    // Hull feasibility only reads destinations and predicates; no display-note normalization.
    const rule=sourceRule;
    const match=prepared?prepared.get(rule)(ships,metrics):predicate(rule.when,ships,metrics);if(match===false)continue;
    const fixed=rule.assumedTo&&!rule.conditionUnknown&&!/能動分岐|能动分岐/.test(rule.note||'')?rule.assumedTo:rule.to;
    for(const to of fixed?[fixed]:(rule.choices||[]).map(c=>c.to))destinations.add(to);
    if(rule.assumedTo)destinations.add(rule.assumedTo);
    if(match===true&&(!Number.isFinite(rule.chance)||rule.chance>=1))break;
  }
  return {status:'unknown',destinations:[...destinations]};
}
// Necessary fleet-size conditions only. Everything requiring a hull, gear,
// speed, LoS or route history stays unknown, so a repairable fleet survives.
// Reuse the rule interpreter and ordered point/path evaluator, not templates.
function routeFleetSizes(area,options,phase){
  if(!options.length)return [1,2,3,4,5,6];
  const sizeOnly=value=>{
    if(value===true||value==='otherwise')return value;
    if(!value||typeof value!=='object')return null;
    if(value.all)return {all:value.all.map(sizeOnly)};
    if(value.any)return {any:value.any.map(sizeOnly)};
    if(value.not)return {not:sizeOnly(value.not)};
    if(value.shipCount)return {shipCount:value.shipCount};
    // A subtype count cannot exceed the whole fleet. Meeting this necessary
    // lower bound says nothing about the actual composition, so keep null.
    const minimum=value.count?.exact??value.count?.min;
    return minimum>0?{all:[{shipCount:{min:minimum}},null]}:null;
  };
  const map=mapFor(area),prepared=new Map(Object.values(map.machineRules||{}).flat()
    .map(rule=>[rule,preparePredicate(sizeOnly(rule.when))]));
  const requirements=options.map(option=>preparePredicate(sizeOnly(option.fleetRequirement)));
  return [1,2,3,4,5,6].filter(size=>{
    const ships=Array(size).fill(null),assessments=new Map();
    const assess=from=>{
      if(!assessments.has(from)){
        const rules=map.machineRules?.[`${from}#${phase}`]??map.machineRules?.[from];
        assessments.set(from,rules?possiblePoint(rules,ships,{},prepared):null);
      }
      return assessments.get(from);
    };
    return options.some((option,i)=>requirements[i](ships,{})!==false&&optionPaths(option).some(nodes=>
      pathChance({area,phase},nodes,assess).max>0));
  });
}
const thresholds=value=>{
  const result=[];
  const visit=v=>{
    if(!v||typeof v!=='object')return;
    if(v.los)result.push(v.los);
    // These are the condition-tree branches. Counts, names and speed values
    // contain no nested predicates; traversing them for every fitted candidate
    // allocated thousands of empty arrays.
    if(v.all)for(const part of v.all)visit(part);
    if(v.any)for(const part of v.any)visit(part);
    if(v.not)visit(v.not);
  };
  visit(value);return result;
};
// Display metadata only: absence of a fitted requirement is not proof that
// a route has no LoS gate (the composition or the rule may be unresolved).
function losGates(area,nodes,phase){
  const map=mapFor(area),result=[];let from='start';
  for(const to of nodes){
    const rules=map.machineRules?.[`${from}#${phase}`]??map.machineRules?.[from];
    const borders=(rules||[]).flatMap(r=>thresholds(r.when));
    const point=map.branchPoints.find(p=>p.from===from&&(!phase||!p.phase||p.phase===phase));
    if(borders.length||(point?.clauses||[]).some(c=>/索[敵敌]/.test(c)))
      result.push({from,to,coefficients:[...new Set(borders.map(b=>b.coefficient))]});
    from=to;
  }
  return result;
}
// Candidate calculations stay separate from the observed public route verdict.
// UI can keep tentative rules and unobserved speed unresolved while using LoS.
function planningPath(route,nodes,{allowTentative=true,allowEstimatedSpeed=true,includeLosRequirements=true}={}){
  const map=mapFor(route.area),reading=route.lineOfSight||{},margin=reading.thresholdMargin||0;
  const metrics={lineOfSight:reading,
    speed:{...route.speed,status:allowEstimatedSpeed&&route.speed?.status==='estimated'?'observed':route.speed?.status,
      ships:route.speed?.ships?.map(s=>({...s,status:allowEstimatedSpeed&&s.status==='estimated'?'observed':s.status}))}};
  const assess=(prepared,m)=>{const a=prepared.assess(route.ships||[],m);
    return allowTentative&&a.status==='tentative'&&a.destinations.length===1?{...a,status:'fixed',possibleDestinations:a.destinations}:a;};
  const points=[],losRequirements=[];let from='start';
  for(const to of nodes){
    metrics.visitedNodes=nodes.slice(0,Math.max(0,nodes.indexOf(from)+1));
    const rules=map.machineRules?.[`${from}#${route.phase}`]??map.machineRules?.[from];
    if(rules){
      const prepared=planningRules(rules),assessment=assess(prepared,metrics);points.push({from,assessment});
      const borders=includeLosRequirements?prepared.borders:[];
      for(const coefficient of new Set(borders.map(b=>b.coefficient))){
        // A failed random LoS roll also has an upper edge: reaching that edge
        // skips the roll and unlocks a later hull rule. Include both bounds.
        const alternatives=[...new Set(borders.filter(b=>b.coefficient===coefficient)
          .flatMap(b=>[b.gte,b.lt]).filter(Number.isFinite).map(score=>score+margin))].sort((a,b)=>a-b);
        const fits=score=>{
          const m={...metrics,lineOfSight:{...metrics.lineOfSight,status:'computed',rawScoresByCoefficient:{...reading.rawScoresByCoefficient,[coefficient]:score}}};
          const a=assess(prepared,m);return a.status==='fixed'&&a.destinations[0]===to;
        };
        // A hull-count rule may already fix this exit before any LoS test.
        const required=fits(-100000)?undefined:alternatives.find(fits);
        if(required!==undefined){const score=reading.rawScoresByCoefficient?.[coefficient];
          losRequirements.push({from,to,coefficient,required,score:Number.isFinite(score)?score:null,shortfall:Number.isFinite(score)?Math.max(0,required-score):null});}
      }
    }
    from=to;
  }
  const planned={...route,pointAssessments:points};
  return {chance:pathChance(planned,nodes),pointAssessments:points,losRequirements,
    losShortfall:losRequirements.reduce((n,r)=>n+(r.shortfall??1000),0),
    estimated:reading.status==='estimate'||route.speed?.status==='estimated'};
}
// A guide strategy may accept several mutually exclusive complete paths.
// Only explicit guide paths count; never sum arbitrary ways to the same Boss.
function strategyAssessment(route,option){
  if(!option?.strategy)return null;
  const strategy=option.strategy,ranks={slow:5,fast:10,fastPlus:15,fastest:20};
  const branches=optionPaths(option).map(nodes=>({nodes,...planningPath(route,nodes,{allowTentative:false}).chance}));
  const min=Math.min(1,branches.reduce((sum,b)=>sum+b.min,0)),max=Math.min(1,branches.reduce((sum,b)=>sum+b.max,0));
  const speedMet=['observed','computed','estimated'].includes(route.speed?.status)&&ranks[route.speed?.fleetSpeed]>=ranks[strategy.minimumSpeed];
  const radarMet=(route.ships||[]).filter(s=>s.radarEquipped===true).length>=(strategy.radarCarriers||0);
  return {eligible:speedMet&&radarMet&&(strategy.requireFixedArrival===false?min>0:min>=1-1e-9),speedMet,radarMet,branches,
    chance:{min,max,probability:Math.abs(min-max)<1e-9?min:null}};
}
// Confirmed LoS windows for this hull composition and complete path. The
// upper border matters: raising LoS can route a fleet away from its Boss path.
// A shortlist contains many outfits with identical routing facts. Scope reuse
// to that one pass, keyed by the exact non-LoS predicate outcomes, not ship IDs
// or mutable route object identity. The swept coefficient's current score is
// irrelevant; mixed-coefficient paths retain the full calculation.
function createLoSWindowReader(nodes){
  const contexts=new Map(),cache=new Map();
  return route=>{
    const contextKey=JSON.stringify([route.area,route.phase]);
    let context=contexts.get(contextKey);
    if(!context){
      const map=mapFor(route.area),checks=[],coefficients=new Set();let from='start';
      const collect=value=>{
        if(!thresholds(value).length)return [preparePredicate(value)];
        if(value.all||value.any)return (value.all||value.any).flatMap(collect);
        if(value.not)return collect(value.not);
        return [];
      };
      for(const to of nodes){
        const rules=map.machineRules?.[`${from}#${route.phase}`]??map.machineRules?.[from]??[];
        for(const rule of rules)for(const gate of thresholds(rule.when))coefficients.add(gate.coefficient);
        checks.push({visitedNodes:nodes.slice(0,Math.max(0,nodes.indexOf(from)+1)),
          predicates:rules.flatMap(rule=>collect(effectiveRule(rule).when))});
        from=to;
      }
      context={checks,coefficients};contexts.set(contextKey,context);
    }
    if(!context.coefficients.size)return [];
    if(context.coefficients.size!==1)return losWindows(route,nodes);
    const speed={...route.speed,status:route.speed?.status==='estimated'?'observed':route.speed?.status,
      ships:route.speed?.ships?.map(s=>({...s,status:s.status==='estimated'?'observed':s.status}))};
    const ships=route.ships||[],facts=context.checks.flatMap(({visitedNodes,predicates})=>
      predicates.map(check=>check(ships,{speed,visitedNodes})));
    const key=JSON.stringify([contextKey,route.lineOfSight?.thresholdMargin||0,
      route.targetNodes?.includes(nodes.at(-1))===true,ships.length,facts]);
    if(!cache.has(key)){
      if(cache.size>=512)cache.clear();
      cache.set(key,losWindows(route,nodes));
    }
    return cache.get(key);
  };
}
function losWindows(route,nodes){
  const map=mapFor(route.area),margin=route.lineOfSight?.thresholdMargin||0,borders=new Map();
  let from='start';
  for(const to of nodes){
    const rules=map.machineRules?.[`${from}#${route.phase}`]??map.machineRules?.[from];
    for(const gate of (rules||[]).flatMap(r=>thresholds(r.when))){
      if(!borders.has(gate.coefficient))borders.set(gate.coefficient,new Set());
      for(const key of ['gte','lt'])if(Number.isFinite(gate[key])){
        borders.get(gate.coefficient).add(gate[key]);borders.get(gate.coefficient).add(gate[key]+margin);
      }
    }
    from=to;
  }
  const result=[];
  for(const [coefficient,values] of borders){
    const cuts=[-Infinity,...[...values].sort((a,b)=>a-b),Infinity],windows=[];
    for(let i=0;i<cuts.length-1;i++){
      const lower=cuts[i],upper=cuts[i+1],score=lower===-Infinity?upper-1000:upper===Infinity?lower+1000:(lower+upper)/2;
      const candidate={...route,lineOfSight:{...route.lineOfSight,status:'computed',rawScoresByCoefficient:{...route.lineOfSight?.rawScoresByCoefficient,[coefficient]:score}}};
      if(planningPath(candidate,nodes,{allowTentative:false,includeLosRequirements:false}).chance.probability!==1)continue;
      const previous=windows.at(-1);
      if(previous?.upper===lower)previous.upper=upper;else windows.push({lower,upper});
    }
    if(windows.length)result.push({coefficient,windows});
  }
  return result;
}
// Diagnose every edge, including those after the first failure. The player
// needs all constraints to repair a fleet, not just the first blocked node.
function routeDiagnostics(route,option){
  let paths=optionPaths(option);
  if(paths.length>1){
    const viable=paths.filter(nodes=>planningPath(route,nodes,{allowTentative:false}).chance.max>0);
    if(viable.length)paths=viable;
  }
  const map=mapFor(route.area),points=new Map();
  for(const nodes of paths){
    const planned=planningPath(route,nodes,{allowTentative:false});
    const details=requirementDetails(route.area,nodes,route.phase,route);let from='start';
    for(const to of nodes){
      const key=from+'>'+to,a=planned.pointAssessments.find(p=>p.from===from)?.assessment;
      const fixed=map.fixedEdges?.[`${from}#${route.phase}`]??map.fixedEdges?.[from];
      const destinations=fixed?[fixed]:a?.possibleDestinations||a?.destinations||[];
      const detail=details.find(p=>p.from===from),hit=detail?.rules.find(r=>r.active||r.state==='pending');
      const desired=detail?.rules.filter(r=>r.destinations.split('/').includes(to))||[];
      const weight=a?.probabilities?.find(p=>p.to===to)?.probability;
      const weightsKnown=a?.status==='random'&&!a.tentative&&a.probabilities?.every(p=>Number.isFinite(p.probability))&&Math.abs(a.probabilities.reduce((s,p)=>s+p.probability,0)-1)<1e-9;
      const referenceProbability=a?.referencePathProbability??(a?.status==='random'&&(!a.probabilities?.length||a.probabilities.some(p=>!Number.isFinite(p.probability)))?0.5:null);
      const unavailable=map.unavailableByPhase?.[route.phase]?.includes(to),availabilityUnknown=map.uncertainAvailabilityByPhase?.[route.phase]?.includes(to);
      const status=unavailable||destinations.length&&!destinations.includes(to)||weightsKnown&&weight===0?'blocked':
        availabilityUnknown?'unknown':fixed===to||a?.status==='fixed'&&destinations.includes(to)||isPlayerChoice(a)&&destinations.includes(to)?'fixed':
        weightsKnown&&Number.isFinite(weight)||referenceProbability?'random':'unknown';
      if(status!=='fixed'){
        const label=`${from==='start'?'出发点':from} → ${to}`;
        const current=unavailable?'当前阶段尚未开放该节点':availabilityUnknown?'当前阶段是否开放该节点待确认':a?.tentative?`规则样本不足：${a.rule||hit?.condition||'出口待核实'}`:hit?`当前命中：${hit.condition} → ${hit.destinations}${a?.status==='unknown'&&a.reason?'；'+a.reason:''}`:
          a?.reason||a?.rule||(fixed?`当前固定前往 ${fixed}`:'该点带路规则尚未确认');
        const requirements=desired.map(r=>({condition:r.condition,state:r.state,tentative:r.tentative}));
        for(const gate of planned.losRequirements.filter(r=>r.from===from))requirements.unshift({
          condition:`33 式索敌（系数 ${gate.coefficient}） ≥ ${gate.required}`,
          state:gate.shortfall===0?'matched':'unmatched',tentative:false});
        const readings=planned.losRequirements.filter(r=>r.from===from).map(r=>`索敌系数 ${r.coefficient}：当前 ${r.score===null?'未知':r.score.toFixed(1)}，固定门槛 ≥ ${r.required}`);
        const needed=(readings.length?'；'+readings.join('；'):'')+(requirements.length?'；通过条件（按规则优先级判定）：'+requirements.map(r=>r.condition).join('；或 '):'');
        const summary=status==='random'?`${label}：随机分岐，${referenceProbability?
          `${to} ${Math.round((Number.isFinite(weight)?weight:referenceProbability)*1000)/10}%；其余偏航`:
          a.probabilities.map(p=>`${p.to} ${Math.round(p.probability*1000)/10}%`).join(' / ')}`:
          `${label}：${status==='blocked'?'受阻':'待确认'}，${current}${needed}`;
        points.set(key,{from,to,status,current,requirements,summary});
      }
      from=to;
    }
    const sequence='>start>'+nodes.join('>')+'>';
    for(const segment of map.incompatiblePathSegments||[])if(sequence.includes('>'+segment.nodes.join('>')+'>')){
      const key=segment.nodes.join('→');points.set(key,{from:segment.nodes[0],to:segment.nodes.at(-1),status:'blocked',requirements:[],summary:`${key}：路线组合不兼容，${segment.reason||segment.note||'无法用同一编成连续通过'}`});
    }
  }
  const strategy=strategyAssessment(route,option),chance=strategy?.chance||optionPlanning(route,option).chance;
  // An unused alternative is not an obstruction when another branch covers
  // the whole journey. Keep all diagnostics when the group cannot be reached.
  const issues=paths.length>1&&chance.probability===1?[]:[...points.values()],fleet=fleetRequirementAssessment(route,option);
  if(strategy&&!strategy.speedMet)issues.unshift({from:null,to:null,status:'blocked',requirements:[],summary:
    `流派速力要求：全队${({fast:'高速',fastPlus:'高速＋',fastest:'最速'})[option.strategy.minimumSpeed]}统一；当前配装未达到。`});
  if(strategy&&!strategy.radarMet)issues.unshift({from:null,to:null,status:'blocked',requirements:[],summary:
    `流派电探要求：至少 ${option.strategy.radarCarriers} 艘携带电探；当前配装未达到。`});
  if(!fleet.eligible)issues.unshift({from:null,to:null,status:'blocked',requirements:[],summary:`攻略编成要求：${fleet.description}；当前编成未满足。`});
  if(!map.graphComplete||!paths.every(nodes=>route.targetNodes?.includes(nodes.at(-1))))issues.push({from:null,to:null,status:'unknown',requirements:[],summary:'路线图或目标节点资料不完整，无法确认整条路线'});
  return {chance,points:issues,blocked:issues.filter(p=>p.status==='blocked'),unknown:issues.filter(p=>p.status==='unknown'),
    warnings:issues.map(p=>p.summary),strategyEligible:strategy?.eligible??true};
}
// Project conditions onto positive named-ship requirements. Dropping all
// other predicates over-approximates eligibility: a nameless fallback or a
// negated name must never be reported as a missing mandatory routing ship.
function namedShipRequirements(area,nodes,phase){
  const project=value=>{
    if(!value||typeof value!=='object'||value.not)return [[]];
    if(value.all){
      let result=[[]];
      for(const condition of value.all){
        const next=project(condition);
        if(result.length*next.length>64)return [[]];
        result=result.flatMap(a=>next.map(b=>a.concat(b)));
      }
      return result;
    }
    if(value.any){const result=value.any.flatMap(project);return result.length>64?[[]]:result;}
    const name=value.shipName||value.flagshipName;
    if(name?.prefixes?.length)return [[{prefixes:name.prefixes,min:1}]];
    const count=value.count,min=count?.exact??count?.min??0;
    if(min>0&&count.prefixes?.length&&!count.stypes?.length&&!count.groups?.length)
      return [[{prefixes:count.prefixes,min}]];
    return [[]];
  };
  const map=mapFor(area),result=[];let from='start';
  for(const to of nodes){
    const rules=map.machineRules?.[`${from}#${phase}`]??map.machineRules?.[from]??[];
    const fixed=map.fixedEdges?.[`${from}#${phase}`]??map.fixedEdges?.[from];
    const alternatives=rules.filter(r=>(r.to?[r.to]:(r.choices||[]).map(c=>c.to)).includes(to))
      .flatMap(r=>project(r.when));
    if(!fixed&&alternatives.length&&alternatives.every(a=>a.length))
      result.push({from,to,alternatives});
    from=to;
  }
  return result;
}
function hullPath(route,nodes){
  const map=mapFor(route.area),ships=(route.ships||[]).map(s=>({...s,drumEquipped:null,radarEquipped:null,landingCraftEquipped:null}));
  const metrics={speed:route.speed||{status:'unknown'},lineOfSight:{status:'unknown'}};
  const points=[];let from='start';
  for(const to of nodes){const rules=map.machineRules?.[`${from}#${route.phase}`]??map.machineRules?.[from];
    if(rules)points.push({from,assessment:possiblePoint(rules,ships,metrics)});from=to;}
  return pathChance({...route,pointAssessments:points},nodes);
}
function routingNeeds(route,nodes){
  const map=mapFor(route.area),ships=(route.ships||[]).map(s=>({...s,drumEquipped:null,radarEquipped:null,landingCraftEquipped:null})),found=[];
  const collect=v=>{if(!v||typeof v!=='object')return;for(const key of ['drumCarriers','radarCarriers','landingCraftCarriers','transportEquipCount']){
    const n=v[key]?.min??v[key]?.exact;if(n>0)found.push({kind:key,count:n});}
    if(v.all)v.all.forEach(collect);if(v.any)v.any.forEach(collect);};
  let from='start';for(const to of nodes){const rules=map.machineRules?.[`${from}#${route.phase}`]??map.machineRules?.[from];
    for(const r of rules||[]){if((r.to?[r.to]:(r.choices||[]).map(c=>c.to)).includes(to)&&predicate(r.when,ships,{speed:route.speed||{status:'unknown'},lineOfSight:{status:'unknown'}})!==false)collect(r.when);}
    from=to;}
  return [...new Map(found.map(r=>[r.kind+':'+r.count,r])).values()];
}
// Cover ship-type compositions explicitly, independently of grade-sampled
// seeds. Gear-dependent predicates stay unknown until real fitting.
// Retain several hull choices per path/size for the full evaluator below.
function hullCache(options){
  return options.reuseFacts===false?null:calculationTable('hullFeasibility',
    {map:mapFor(options.area),phase:options.phase??null,speed:options.speed??null,routes:options.routes},200000);
}
function mergeHullParts(parts,byId){
  const grouped=new Map();
  for(const part of parts)for(const beam of part.beams){
    let combined=grouped.get(beam.key);
    if(!combined){combined={...beam,entries:[]};grouped.set(beam.key,combined);}
    if(beam.order<combined.order||beam.order===combined.order&&beam.routeIndex<combined.routeIndex){
      combined.order=beam.order;combined.routeIndex=beam.routeIndex;
    }
    combined.entries.push(...beam.entries);
  }
  const beams=[...grouped.values()].sort((a,b)=>Number(a.key.endsWith(':combat'))-Number(b.key.endsWith(':combat'))||
    a.order-b.order||a.routeIndex-b.routeIndex);
  // Each shard keeps its best 12 distinct fleets. Their union contains the
  // global best 12; duplicate combat fleets must not consume extra places.
  for(const beam of beams){
    const seen=new Set();
    beam.rows=beam.entries.sort((a,b)=>b.score-a.score||a.order-b.order).filter(entry=>{
      const key=entry.ids.join(',');if(seen.has(key))return false;seen.add(key);return true;
    }).slice(0,12).map(entry=>entry.ids);
  }
  const unique=lists=>[...new Map(lists.flatMap(b=>b.rows).map(ids=>[ids.join(','),ids.map(id=>byId.get(id))])).values()];
  return {rows:unique(beams),baselineRows:unique(beams.filter(b=>!b.key.endsWith(':combat'))),
    attempted:parts[0]?.attempted||0,truncated:parts[0]?.truncated||false};
}
function hullSeeds(ctx,options,family){
  const map=mapFor(options.area),phase=options.phase,fixed=ctx.fixed.map(id=>ctx.byId.get(id));
  const sizes=new Set(options.sizes||[1,2,3,4,5,6]),maxSize=Math.max(fixed.length,...sizes);
  // Hulls are immutable during this search. Normalize each family once instead
  // of repeating string normalization at every node of the enumeration tree.
  const families=new Map();
  for(const row of ctx.roster.concat(fixed))if(!families.has(row.id))families.set(row.id,family(row));
  const familyKey=row=>families.get(row.id);
  const names=JSON.stringify([map.machineRules,options.routes.map(o=>o.fleetRequirement)]).match(/"prefixes":\[[^\]]+\]/g)?.flatMap(s=>JSON.parse('{'+s+'}').prefixes)||[];
  const typeGroups={carrier:[7,11,18],fleetCarrier:[11,18],battleship:[8,9,10,12],supply:[22],heavyCruiser:[5,6],slowBattleship:[9]},tests=[];
  const scan=v=>{if(!v||typeof v!=='object')return;
    if(v.stypes||v.groups)tests.push(new Set([...(v.stypes||[]),...(v.groups||[]).flatMap(g=>typeGroups[g]||[])]));
    for(const key of ['allStypes','flagshipStype'])if(v[key])tests.push(new Set(v[key]));
    Object.values(v).forEach(x=>{if(Array.isArray(x))x.forEach(scan);else scan(x);});
  };scan(map.machineRules);options.routes.forEach(o=>scan(o.fleetRequirement));
  const relevantNodes=new Set(['start',...options.routes.flatMap(o=>optionPaths(o).flatMap(nodes=>nodes.slice(0,-1)))]);
  const pointRules=Object.entries(map.machineRules||{}).filter(([key])=>relevantNodes.has(key.split('#')[0])&&(!key.includes('#')||key.endsWith('#'+phase)));
  // Preserve the first matching assessment, including the existing phase ordering.
  const ruleIndex=new Map();
  for(const [key,rules] of pointRules){const from=key.split('#')[0];if(!ruleIndex.has(from))ruleIndex.set(from,rules);}
  const prepared=new Map(pointRules.flatMap(([,rules])=>rules.map(rule=>[rule,preparePredicate(rule.when)])));
  const routeRequirements=options.routes.map(option=>option.fleetRequirement?preparePredicate(option.fleetRequirement):null);
  const groups=new Map();
  for(const row of ctx.roster.filter(r=>!ctx.fixed.includes(r.id)).sort((a,b)=>b.power-a.power)){
    const key=JSON.stringify([tests.map(types=>types.has(row.stype)),Number(row.ship.api_soku),names.filter(n=>row.name.startsWith(n))]);
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
  }
  // Named routing ships must be visited before the bounded enumeration fills
  // with ordinary hulls. Keep each bucket's original strength ordering.
  const named=rows=>names.some(name=>rows[0].name.startsWith(name));
  const buckets=[...groups.values()].sort((a,b)=>Number(named(b))-Number(named(a))),best=new Map(),firstSeen=new Map();let attempted=0,truncated=false;
  // A combinations-with-repetition upper bound avoids starting workers for
  // tiny maps. Family/ownership restrictions can only make this bound smaller.
  if(options.estimate){
    let level=1,total=fixed.length?1:0;
    for(let size=1;size<=maxSize-fixed.length;size++){
      level=level*(buckets.length+size-1)/size;total+=level;
      if(total>180000)return 180001;
    }
    return total;
  }
  const combatBuckets=new Map(),combatSeen=new Set();
  if(ctx.combatScore)for(const bucket of buckets){
    const ranked=bucket.slice().sort((a,b)=>ctx.combatScore(b)-ctx.combatScore(a)||b.power-a.power);
    for(const row of bucket)combatBuckets.set(row.id,ranked);
  }
  // Different instances can have identical routing facts. Cache only which
  // paths are possible; still rank every real hull set with its own power and
  // family constraints. Prefix membership and type-specific speed stay paired.
  const usesSpeed=JSON.stringify(pointRules).includes('speed');
  const rowFeatures=new Map(),viability=new Map();
  const facts=row=>JSON.stringify([row.stype,usesSpeed?(options.speed||Number(row.ship.api_soku)):null,names.map(n=>row.name.startsWith(n))]);
  // Persist the feature dictionary WITH its outcome table. Added or removed
  // ships cannot reinterpret numeric keys or invalidate other hull structures.
  // Always retain the flagship separately from the escorts.
  const persistent=hullCache(options);
  const descriptors=new Map(ctx.roster.concat(fixed).map(row=>[row.id,facts(row)]));
  const dictionary=[...new Set(descriptors.values())].sort(),featureIds=new Map(dictionary.map((value,i)=>[value,i]));
  for(const [id,value] of descriptors)rowFeatures.set(id,persistent?persistent.token(value):featureIds.get(value));
  const feature=row=>rowFeatures.get(row.id);
  const hullScore=(rows,combat)=>rows.reduce((sum,r)=>sum+(combat?ctx.combatScore(r):r.power),0);
  // Beam identities are static. Avoid rebuilding strings and looking them up
  // for every hull, while retaining first-insertion order and stable score ties.
  const slotsByKey=new Map();
  const routeOrder=options.routes.map(option=>options.routes.indexOf(option));
  const beamSlots=[false,true].map(combat=>Array.from({length:7},(_,size)=>options.routes.map(option=>{
    const key=option.key+':'+size+(combat?':combat':'');
    if(!slotsByKey.has(key))slotsByKey.set(key,{key,list:null});
    return slotsByKey.get(key);
  })));
  const competitive=(rows,score,combat)=>beamSlots[Number(combat)][rows.length].some(slot=>{
    const list=slot.list;
    return !list||list.length<12||score>list[11].score;
  });
  const consider=(rows,combat=false,stronger=null)=>{
    if(combat){const ids=rows.map(r=>r.id).join(',');if(combatSeen.has(ids))return;combatSeen.add(ids);}
    const score=hullScore(rows,combat);
    // Even if every route were feasible, neither beam could retain these
    // hulls. Skip their feasibility work, not their enumeration descendants.
    if(!competitive(rows,score,combat)){
      if(combat||!ctx.combatScore)return;
      if(!stronger||!competitive(stronger,hullScore(stronger,true),true))return;
    }
    const key=feature(rows[0])+':'+rows.slice(1).map(feature).sort((a,b)=>a-b).join(',');
    let possible=options.reuseFacts===false?null:viability.get(key);
    if(!possible){
      const calculate=()=>{
        const ships=rows.map(r=>({instanceId:r.id,name:r.name,stype:r.stype,radarEquipped:null,drumEquipped:null,landingCraftEquipped:null}));
        const speed=r=>options.speed||({5:'slow',10:'fast',15:'fastPlus',20:'fastest'}[r.ship.api_soku]);
        const metrics={lineOfSight:{status:'unknown'},speed:{status:'observed',fleetSpeed:speed(rows.reduce((a,b)=>Number(a.ship.api_soku)<=Number(b.ship.api_soku)?a:b)),ships:rows.map(r=>({shipId:r.id,status:speed(r)?'observed':'unknown',speed:speed(r)}))}};
        // Only definite hard-condition failures can exclude a hull. Equipment
        // conditions remain unknown until fitting; guide templates are not limits.
        const eligible=routeRequirements.map(requirement=>!requirement||requirement(ships,metrics)!==false);
        if(!eligible.some(Boolean))return [];
        const route={area:options.area,phase,targetNodes:options.routes.map(o=>o.nodes.at(-1))},assessments=new Map();
        const assessmentAt=from=>{
          if(!assessments.has(from)){
            const rules=ruleIndex.get(from);
            assessments.set(from,rules?possiblePoint(rules,ships,metrics,prepared):null);
          }
          return assessments.get(from);
        };
        // The shared path evaluator stops at a blocked exit and reuses common
        // points across routes. Do not prune DFS descendants or shift its cutoff.
        return options.routes.map((option,i)=>eligible[i]&&optionPaths(option).some(nodes=>pathChance(route,nodes,assessmentAt).max>0)?i:-1).filter(i=>i>=0);
      };
      possible=persistent?persistent.memo(key,calculate):calculate();
      if(viability.size>=8192)viability.delete(viability.keys().next().value);
      viability.set(key,possible);
    }
    const slots=beamSlots[Number(combat)][rows.length];
    for(const routeIndex of possible){
      const slot=slots[routeIndex],{key}=slot,list=slot.list||[];
      if(options.partial&&!slot.list)firstSeen.set(key,{order:attempted,routeIndex:routeOrder[routeIndex]});
      // Stable ties retain earlier candidates, exactly as push + stable sort
      // did. A candidate below the full beam cannot affect any later fitting.
      if(list.length===12&&score<=list[11].score)continue;
      const index=list.findIndex(entry=>score>entry.score);
      list.splice(index<0?list.length:index,0,{rows:rows.slice(),score,order:attempted});
      if(list.length>12)list.pop();slot.list=list;best.set(key,list);
    }
    if(stronger&&possible.length)consider(stronger,true);
  };
  const visit=(index,rows,stronger)=>{
    if(truncated)return;
    // All shards traverse the same bounded DFS. Interleaving its ordinals
    // spreads the expensive six-ship leaves without changing the global cutoff.
    if(rows.length){
      if(++attempted>180000){truncated=true;return;}
      if(!options.shard||(attempted-1)%options.shard.count===options.shard.index)
        if(sizes.has(rows.length))consider(rows,false,stronger?.some((r,i)=>r.id!==rows[i].id)?stronger:null);
    }
    if(rows.length===maxSize)return;
    const used=new Set(rows.map(familyKey));
    const combatUsed=stronger?new Set(stronger.map(familyKey)):null;
    for(let i=index;i<buckets.length;i++){
      const next=buckets[i].find(r=>!used.has(familyKey(r)));
      if(next){
        // Extend the already selected combat prefix. Rebuilding the same
        // leading five hulls at every six-ship leaf wastes most of this pass.
        const combatNext=stronger?combatBuckets.get(next.id).find(r=>!combatUsed.has(familyKey(r))):null;
        visit(i,[...rows,next],combatNext?[...stronger,combatNext]:null);
      }
    }
  };
  visit(0,fixed,ctx.combatScore?fixed:null);
  if(options.partial)return {attempted,truncated,beams:[...best].map(([key,list])=>
    ({key,...firstSeen.get(key),entries:list.map(entry=>({ids:entry.rows.map(r=>r.id),score:entry.score,order:entry.order}))}))};
  // Downstream fitting has a bounded budget. Preserve the original beam's
  // order before adding combat alternatives, so new hulls cannot evict an
  // existing speed-fit candidate merely by being inserted earlier.
  const beams=[...best.entries()].sort((a,b)=>Number(a[0].endsWith(':combat'))-Number(b[0].endsWith(':combat')));
  const unique=lists=>[...new Map(lists.flatMap(([,rows])=>rows).map(s=>[s.rows.map(r=>r.id).join(','),s.rows])).values()];
  return {rows:unique(beams),baselineRows:unique(beams.filter(([key])=>!key.endsWith(':combat'))),attempted,truncated};
}
module.exports={optionPaths,pathLabel,fleetPaths,fleetPathOption,orderedPathNodes,optionPlanning,fleetRequirementAssessment,routeOptions,recommendedOptions,currentPhase,pathChance,isPlayerChoice,requirements,requirementDetails,hullSeeds,hullCache,mergeHullParts,possiblePoint,routeFleetSizes,planningPath,hullPath,strategyAssessment,routeDiagnostics,routingNeeds,losGates,losWindows,createLoSWindowReader,withPlanningCache,namedShipRequirements};
