'use strict';
const V=require('../models/presentation_model');
const {withArrivalNotes}=require('../models/route_presentation');
const R=require('../../domain/fleet/equipment_rules');
const {normalizeName}=require('../../shared/name_matching');
const {profileForRoute}=require('../../domain/routes/sortie_profile');
const expeditions=require('../../domain/expeditions/expeditions');
const TYPES={1:'海防',2:'驱逐',3:'轻巡',4:'雷巡',5:'重巡',6:'航巡',7:'轻空母',8:'高速战舰',9:'战舰',10:'航战',11:'正规空母',13:'潜水舰',14:'潜水空母',16:'水母',17:'扬陆舰',18:'装甲空母',19:'工作舰',20:'潜水母舰',21:'练巡',22:'补给舰'};
const clone=x=>JSON.parse(JSON.stringify(x));
function entry(store,id){
  const ship=store.info?.ships?.[id],master=store.const?.$ships?.[ship?.api_ship_id];
  if(!ship||!master)throw Error('舰娘资料已变化，请重新选择');
  return {id:Number(id),slots:(ship.api_slot||[]).slice(0,master.api_slot_num),ex:ship.api_slot_ex>0?ship.api_slot_ex:-1,pin:false,keep:{}};
}
function scheme(slots,fleet){return {fleet,ships:slots.filter(Boolean).map(({id,slots,ex})=>({id,slots:[...slots],ex}))};}
function resolved(store,plan){
  const expected=new Map((plan.equipment.expected||[]).map(x=>[x.shipId,x.state]));
  return plan.organization.targets.map(id=>{const row={...entry(store,id),...(expected.get(id)||{})};
    row.slots=row.slots.slice(0,store.const.$ships[store.info.ships[id].api_ship_id].api_slot_num);
    row.ex=row.ex>0?row.ex:-1;return row;});
}
function family(store,id){
  const ship=store.info.ships[id],master=store.const.$ships[ship?.api_ship_id];
  return master?.api_yomi?.trim()?`reading:${master.api_yomi.normalize('NFKC').trim()}`:`master:${ship?.api_ship_id}`;
}
function roster(store,slots=[],index=-1,search=''){
  const term=normalizeName(search).toLowerCase(),used=new Set(slots.filter((x,i)=>x&&i!==index).map(x=>family(store,x.id)));
  return V.rosterRows(store).map(row=>{
    const ship=store.info.ships[row.id],master=store.const.$ships[ship.api_ship_id];
    const type=TYPES[master.api_stype]||store.const.$shipTypes?.[master.api_stype]?.api_name||'未知舰种';
    const fleetIndex=(store.info.fleets||[]).findIndex(f=>(f.api_ship||[]).includes(row.id));
    return {...row,type,typeId:master.api_stype,fleet:fleetIndex<0?null:fleetIndex+1,fleetLabel:fleetIndex<0?'未编入舰队':`第 ${fleetIndex+1} 舰队`,cond:ship.api_cond,portrait:V.portraitUrl(store,ship.api_ship_id),
      unavailable:row.unavailable||(used.has(family(store,row.id))?'同舰已编入':null)};
  }).filter(row=>!term||normalizeName(row.name+' '+row.type+' '+row.id).toLowerCase().includes(term));
}
function replacementCandidates(store,slots,index,search='',scope='similar',selection){
  const current=slots[index],typeId=store.const.$ships[store.info.ships[current?.id]?.api_ship_id]?.api_stype;
  const excluded=selection?require('../../config/recommendation_filters').evaluator(store,selection.kind,selection.filters):()=>[];
  // Explicit selections override automatic preferences. First-fleet members
  // lead each list, then both groups descend by level. Search spans ship types.
  return roster(store,slots,index,search).filter(r=>search.trim()||scope==='all'||!typeId||r.typeId===typeId)
    .map(r=>({...r,preferenceReasons:excluded(r.id)}))
    .sort((a,b)=>Number(b.fleet===1)-Number(a.fleet===1)||b.level-a.level||a.id-b.id);
}
function changeSummary(store,slots,fleet){
  const before=(store.info.fleets?.[fleet-1]?.api_ship||[]).filter(id=>id>0),after=slots.filter(Boolean).map(s=>s.id);
  const incoming=after.filter(id=>!before.includes(id)).length,outgoing=before.filter(id=>!after.includes(id)).length;
  const reordered=after.some((id,i)=>before.includes(id)&&before.indexOf(id)!==i);
  const owners=new Map(),borrowed=new Set();let equipmentSlots=0;
  for(const s of Object.values(store.info.ships))for(const id of [...(s.api_slot||[]),s.api_slot_ex])if(id>0)owners.set(id,s.api_id);
  for(const s of slots.filter(Boolean)){
    const old=store.info.ships[s.id];if(!old)continue;
    [...s.slots,s.ex].forEach((id,i)=>{
      const prev=i===s.slots.length?old.api_slot_ex:old.api_slot[i];
      if((id>0?id:-1)!==(prev>0?prev:-1))equipmentSlots++;
      if(id>0&&owners.has(id)&&owners.get(id)!==s.id)borrowed.add(id);
    });
  }
  return [incoming?`换入 ${incoming} 艘`:'',outgoing?`移出 ${outgoing} 艘`:'',reordered?'调整顺序':'',equipmentSlots?`调整 ${equipmentSlots} 槽装备`:'',borrowed.size?`借用 ${borrowed.size} 件`:''].filter(Boolean).join(' · ')||'与目标舰队一致';
}
function item(store,id,slot){
  return V.equipmentItem(store,id,slot);
}
function equipmentOptions(store,slots,index,slot,search=''){
  const ship=slots[index],term=normalizeName(search).toLowerCase();if(!ship)return [];
  const rules=R.tables(store),categories=new Map();
  const labels={1:'舰上战斗机',2:'舰爆／舰攻',3:'侦察机／水上机',4:'主炮',5:'特殊炮弹／强化装备',
    6:'副炮／对空',7:'鱼雷／潜航艇',8:'对潜装备',9:'电探',10:'登陆／运输',11:'人员／物资',
    12:'陆上机',13:'装甲／机关',14:'其他装备'};
  rules.equipFilterCategories.filter(c=>c.id!==0).forEach((category,order)=>category.details.forEach((detail,typeOrder)=>{
    for(const type of rules.filteringDetailCategories[detail]||[])categories.set(type,
      {categoryId:category.id,category:labels[category.id]||category.name,categoryOrder:order,typeOrder});
  }));
  const used=new Set(slots.filter(Boolean).flatMap(s=>s.slots.concat(s.ex)).filter(id=>id>0));
  const current=slot==='ex'?ship.ex:ship.slots[slot];used.delete(current);
  const owners=new Map();
  for(const [id,s] of Object.entries(store.info.ships))for(const eid of [...(s.api_slot||[]),s.api_slot_ex])if(eid>0)owners.set(eid,Number(id));
  const unavailable=new Set(V.rosterRows(store).filter(s=>s.unavailable).map(s=>s.id));
  const airbase=new Set((store.info.airbase||[]).flatMap(b=>(b.api_plane_info||[]).map(s=>s.api_slotid)));
  const candidates=Object.keys(store.info.equips).map(Number).filter(id=>{
    if(used.has(id)||airbase.has(id)||unavailable.has(owners.get(id)))return false;
    try{return R.canEquip(store,ship.id,id,slot)&&(!owners.has(id)||owners.get(id)===ship.id||R.acceptsOtherSlot(store,ship.id,id,slot));}catch(_){return false;}
  }).map(id=>{
    const raw=store.info.equips[id],master={...store.const.$equips[raw.api_slotitem_id],api_id:raw.api_slotitem_id};
    const category=categories.get(R.filterType(master,rules))||
      {categoryId:14,category:labels[14],categoryOrder:rules.equipFilterCategories.length,typeOrder:999};
    return {...item(store,id,slot),source:owners.get(id)||null,...category,masterId:raw.api_slotitem_id,
      sortNo:Number(master.api_sortno)||raw.api_slotitem_id,stars:Number(raw.api_level||0),proficiency:Number(raw.api_alv||0)};
  }).filter(e=>e.name&&(!term||normalizeName(e.tooltip+' '+e.category).toLowerCase().includes(term)||String(e.id).includes(term)));
  // Merge only usable instances. Keep the current item where possible, then
  // prefer storage/self-owned copies to borrowing another ship's equipment.
  const priority=e=>e.id===current?0:!e.source?1:e.source===ship.id?2:3;
  const groups=new Map();
  for(const candidate of candidates.sort((a,b)=>priority(a)-priority(b)||a.id-b.id)){
    const raw=store.info.equips[candidate.id];
    const key=[raw.api_slotitem_id,Number(raw.api_level||0),Number(raw.api_alv||0)].join(':');
    if(groups.has(key))groups.get(key).count++;
    else groups.set(key,{...candidate,count:1});
  }
  return [...groups.values()].map(e=>({...e,tooltip:e.tooltip+(e.count>1?` · 可用 ${e.count} 件`: '')}))
    .sort((a,b)=>a.categoryOrder-b.categoryOrder||a.typeOrder-b.typeOrder||a.sortNo-b.sortNo||
      a.masterId-b.masterId||b.stars-a.stars||b.proficiency-a.proficiency||a.id-b.id);
}
// Only user constraints belong to the full-search input. Automatic output is
// discarded by the planner anyway; sending it back would change the disk cache
// key after the first completion. Position holds are optional: choosing a hull
// in the normal-map workbench does not lock its eventual formation position.
function recommendationHolds(slots,{preservePositions=true}={}){
  return slots.map(s=>{
    if(!s||!s.pin&&!Object.keys(s.keep||{}).length)return null;
    const keep={...s.keep},held=k=>Object.prototype.hasOwnProperty.call(keep,k);
    return {id:s.id,pin:!!s.pin,keep,slots:s.slots.map((id,k)=>held(k)?id:null),ex:held('ex')?s.ex:null,
      ...(!preservePositions?{holdPosition:false}:{})};
  });
}
function merge(store,old,candidate,{preservePositions=true}={}){
  const proposed=candidate.ships.map(x=>({...entry(store,x.id),...clone(x),pin:false,keep:{}}));
  const held=old.filter(s=>s&&(s.pin||Object.keys(s.keep||{}).length));
  for(const s of held)if(!proposed.some(x=>x.id===s.id))throw Error('推荐没有保留手动指定的舰娘，当前编成未改变');
  const pending=proposed.filter(x=>!preservePositions||!held.some(s=>s.id===x.id)),out=Array(6).fill(null);
  old.forEach((s,i)=>{if(!held.includes(s))return;const next=proposed.find(x=>x.id===s.id);next.pin=s.pin;next.keep={...s.keep};if(s.preselected){next.preselected=true;next.preselectionComplete=true;}
    for(const k of Object.keys(s.keep)){if(k==='ex')next.ex=s.ex;else next.slots[k]=s.slots[k];}if(preservePositions)out[i]=next;});
  for(let i=0;i<6;i++)if(!out[i])out[i]=pending.shift()||null;
  // A held equipment instance has one owner; remove the planner's other use.
  const heldItems=new Map();held.forEach(s=>Object.keys(s.keep).forEach(k=>{const id=k==='ex'?s.ex:s.slots[k];if(id>0)heldItems.set(id,{id:s.id,k});}));
  out.filter(Boolean).forEach(s=>{s.slots=s.slots.map((id,k)=>heldItems.has(id)&&(heldItems.get(id).id!==s.id||String(heldItems.get(id).k)!==String(k))?-1:id);
    if(heldItems.has(s.ex)&&(heldItems.get(s.ex).id!==s.id||heldItems.get(s.ex).k!=='ex'))s.ex=-1;});
  return out.filter(Boolean).concat(Array(6-out.filter(Boolean).length).fill(null));
}
function projected(store,slots,fleet){
  const ships={...store.info.ships};slots.filter(Boolean).forEach(s=>ships[s.id]={...ships[s.id],api_slot:s.slots,api_slot_ex:s.ex});
  return {...store,info:{...store.info,ships,fleets:store.info.fleets.map((f,i)=>i===fleet-1?{...f,api_ship:slots.filter(Boolean).map(s=>s.id)}:f)}};
}
function withEquipment(slots,candidate){
  if(JSON.stringify(slots.filter(Boolean).map(s=>s.id))!==JSON.stringify(candidate.ships.map(s=>s.id)))
    throw Error('配装结果改变了舰娘或顺序，当前编成已保留');
  return slots.map(s=>s?{...s,slots:candidate.ships.find(row=>row.id===s.id).slots.slice(),ex:candidate.ships.find(row=>row.id===s.id).ex}:null);
}
function inspect(service,store,slots,settings){
  const {fleet,kind,area,target,phase,missionId}=settings,candidate=scheme(slots,fleet);
  const out={scheme:candidate,settingsKey:JSON.stringify(settings),valid:false,profile:null,route:null,metrics:null,expedition:null,error:''};
  try{
    if(!candidate.ships.length)throw Error('先选择要固定的舰娘，或一键补全');
    const plan=service.preview('fleet',candidate);out.plan=plan;out.valid=true;
    if(kind==='normal'){
      const routes=require('../../domain/routes/normal_routes');
      out.route=routes.evaluateNormalRoute(store,{area,target,phase:phase||undefined,fleet,scheme:candidate});
      out.route.fixedArrivalCondition=routes.fixedArrivalCondition(out.route);
      out.profile=profileForRoute(area,out.route);
    }
    out.metrics=require('../../domain/fleet/fleet_metrics').evaluateCandidate(store,plan);
    if(kind==='expedition')out.expedition=expeditions.evaluateExpedition(store,fleet,missionId,candidate);
  }catch(e){out.error=e.message;}
  return out;
}
function routeChoices(result){
  if(result?.routeResults)return result.routeResults.map(r=>({...r,row:r.recommendationIndex===null?null:result.recommendations[r.recommendationIndex]}));
  return (result?.recommendations||[]).filter(row=>row.routeKey).map(row=>({key:row.routeKey,label:row.routeKey,row}));
}
function badges(report){
  const air=report.route?.airControl,assessment=air?.assessment?.superiority;
  let airText='制空待确认';
  if(assessment?.status==='belowAtStart')airText='制空值不足';
  else if(assessment?.status==='meetsAtStart')airText='出击前空优';
  else if(assessment?.status==='noEnemyAirPower')airText='敌制空为零';
  const los=report.route?.fixedArrivalCondition;
  return {air:airText,airBad:assessment?.status==='belowAtStart',los:los?.confirmedMeets?'索敌达标':'索敌待确认'};
}
function mapOverview(area,target='boss',phase,settings,store){
  const activePhase=phase||(target==='boss'?require('../../domain/routes/route_plans').currentPhase(area,store):undefined);
  const encounterStage=require('../../domain/combat/encounter_stage').encounterStage(store,area,activePhase);
  const profile=require('../../domain/routes/sortie_profile').previewForMap(area,{target,phase:activePhase,encounterStage});
  const options=require('../../domain/routes/route_plans').recommendedOptions(area,target,phase,settings,store);
  return {profile,options};
}
// Labels describe the conditional roll at this branch, never the cumulative
// chance of a full journey. Re-evaluate each path so history-dependent rules
// use its own visited nodes; conflicting histories must not invent one number.
function routeEdgeProbabilities(route,option){
  if(!route?.area||!route.ships?.length||!option||option.phase&&option.phase!==route.phase)return [];
  const plans=require('../../domain/routes/route_plans'),edges=new Map();
  const branches=plans.optionPaths(option).map(nodes=>({nodes,...plans.planningPath(route,nodes,
    {allowTentative:false,includeLosRequirements:false})}));
  for(const branch of branches){
    const points=new Map(branch.pointAssessments.map(p=>[p.from,p.assessment]));let from='start';
    for(const to of branch.nodes){
      const assessment=points.get(from),destinations=assessment?.possibleDestinations||assessment?.destinations||[];
      if(destinations.length&&!destinations.includes(to))break;
      if(assessment){
        if(plans.isPlayerChoice(assessment)){from=to;continue;}
        const probability=assessment.status==='fixed'?1:assessment.status==='random'&&!assessment.tentative?
          assessment.probabilities?.find(p=>p.to===to)?.probability??assessment.referencePathProbability:null;
        if(!Number.isFinite(probability)||probability<=0||probability>1)break;
        const key=`${from}>${to}`,previous=edges.get(key);
        if(previous&&Math.abs(previous.probability-probability)>1e-9)previous.conflicting=true;
        else if(!previous)edges.set(key,{from,to,probability});
      }
      from=to;
    }
  }
  return [...edges.values()].filter(edge=>!edge.conflicting&&edge.probability<1-1e-9)
    .map(({from,to,probability})=>({from,to,probability}));
}
function selectedMapProfile(overview,selection,actual,route,hasFleet=!!route?.ships?.length,store){
  const option=overview.options.find(o=>o.key===selection);
  if(option?.phase){const encounterStage=require('../../domain/combat/encounter_stage').encounterStage(store,overview.profile.area,option.phase);
    overview={...overview,profile:require('../../domain/routes/sortie_profile').previewForMap(overview.profile.area,{phase:option.phase,encounterStage})};}
  const plans=require('../../domain/routes/route_plans');
  const requested=option?plans.optionPaths(option):[selection?selection.split('>'):[]];
  const current=route?.area===overview.profile.area&&route.ships?.length&&(!option?.phase||option.phase===route.phase);
  // The full style is a preview only for an empty draft. A blocked fleet or
  // stale inspection must not make impossible alternatives look reachable.
  // Unknown (but not disproved) branches remain visible alongside random ones.
  const paths=!hasFleet?requested:current?plans.fleetPaths(route,option||{nodes:requested[0]}):[];
  // Reference targets/encounters remain available even for a blocked draft;
  // highlightPaths alone describes the currently traversable alternatives.
  const selected=(paths.length?paths:requested).flatMap(nodes=>{
    const same=p=>p.nodes.join('>')===nodes.join('>');
    const actualPath=actual?.area===overview.profile.area?actual.routePaths?.find(same):null;
    const path=actualPath||overview.profile.routePaths?.find(same);return path?[path]:[];
  });
  return {...overview.profile,highlightPaths:paths,
    edgeProbabilities:hasFleet&&current?routeEdgeProbabilities(route,option):[],
    referenceOnly:!paths.length||!selected.some(p=>actual?.area===overview.profile.area&&actual.routePaths?.includes(p)),pathCount:selected.length,
    routePaths:selected,examples:selected.map(p=>p.nodes),threat:selected.length?
      require('../../domain/routes/route_threats').routeThreat(overview.profile.mapPreview.nodes,selected):overview.profile.threat};
}
function mapProgress(store,area){
  const map=require(`../../../data/normal_routes/${area}.json`);
  const catalog=require(`../../../data/sortie/encounters/${area}.json`).gauges||[];
  if(!catalog.length)return null;
  const phaseKeys=Object.keys(map.bossPhases||{}).sort((a,b)=>Number(a.replace('gauge',''))-Number(b.replace('gauge','')));
  const gauges=phaseKeys.length?phaseKeys.flatMap(key=>map.bossPhases[key].map(node=>
    ({...catalog.find(g=>g.bossNode===node),bossNode:node,phase:key}))):catalog;
  const id=Number(area.replace('-','')),maps=store.info?.maps,row=maps?.[id];
  // Poi replaces this list from the full mapinfo response. The always-open
  // 1-1 entry distinguishes a loaded list from initial/event-only state.
  const locked=!row&&maps?.[11]?.api_id===11&&store.const?.$maps?.[id]?.api_id===id;
  const number=Number(row?.api_gauge_num);
  const current=gauges.length===1?0:Number.isInteger(number)&&number>0&&number<=gauges.length?number-1:null;
  const observedTotal=row?.api_required_defeat_count,defeated=row?.api_defeat_count;
  const hasTotal=Number.isFinite(observedTotal)&&observedTotal>0;
  const hasDefeated=Number.isFinite(defeated)&&defeated>=0;
  // Cleared is historical across monthly resets. Active counters take precedence.
  const allCleared=row?.api_cleared===1&&!hasTotal&&!hasDefeated&&
    (current===null||current===gauges.length-1);
  return gauges.map((gauge,index)=>{
    const transport=gauge.mechanism==='transport',unit=transport?'TP':gauge.mechanism==='arrival'?'次抵达':'次击破';
    const reference=transport?gauge.transportPoints:gauge.killsToClear;
    let total=Number.isFinite(reference)&&reference>0?reference:null,remaining=null,state='unknown';
    const active=!!row&&current===index;
    if(active&&!transport&&hasTotal)total=observedTotal;
    if(locked){remaining=total;state='locked';}
    else if(allCleared||row&&current!==null&&index<current){remaining=0;state='complete';}
    else if(row&&current!==null&&index>current){remaining=total;state='pending';}
    else if(active&&!transport&&hasTotal&&hasDefeated){remaining=Math.max(0,total-defeated);state=remaining===0?'complete':'current';}
    // Do not interpret normal-map kill counters as transport points or guess
    // current progress from catalog maxima unless the map is confirmed locked.
    const label=`${gauge.bossNode} 点`;
    const detail=state==='locked'?'未解锁':state==='complete'?'已完成':state==='pending'?'未开始':
      remaining!==null?`剩余 ${remaining} / ${total}${transport?' TP':''}`:'进度未知';
    const explanation=state==='locked'?'海域尚未解锁，按本地资料显示完整进度条':state==='unknown'?'尚未取得该阶段的有效剩余量':
      state==='pending'?'后续阶段尚未开始；不代表解谜或起点已解锁':detail;
    return {node:gauge.bossNode,phase:gauge.phase||'',label,total,remaining,state,detail,isCurrent:active&&state!=='complete',
      title:`第 ${index+1} 阶段 · ${label} · ${explanation}${total!==null?` · 总计 ${total} ${unit}`:''}`};
  });
}
function displayThreat(profile,nodeId){
  if(!nodeId)return {...profile.threat,title:'道中最大威胁',warnings:[]};
  const node=profile.mapPreview?.nodes.find(n=>n.id===(nodeId.startsWith('start#')?'start':nodeId));
  return {title:`${nodeId.startsWith('start')?'出发点':nodeId+' 点'} · 主要威胁`,
    status:node?.threatStatus||'unknown',kind:node?.kind,warnings:node?.dataWarnings||[],
    enemies:(node?.enemyFamilies||node?.enemies||[]).map(e=>({...e,nodes:[nodeId]}))};
}
// Boss cards always show the first documented main fleet's flagship. This is
// presentation only: threat scoring and the reference battle remain unchanged.
function displayBossFlagship(profile,nodeId){
  const node=profile?.mapPreview?.nodes?.find(n=>n.id===nodeId);
  if(!node?.boss)return null;
  const enemy=node.bossFlagship;
  return {status:enemy?'qualitative':'unknown',enemies:enemy?[{...enemy,nodes:[nodeId]}]:[],warnings:[]};
}
// Describe the current fitted fleet, independently of a full recommendation search.
function draftRouteIssue(report,selected,ready){
  if(!ready||!report?.route?.ships?.length||!selected)return null;
  const plans=require('../../domain/routes/route_plans'),details=plans.routeDiagnostics(report.route,selected);
  const route=report.route,strategy=plans.strategyAssessment(route,selected);
  const knownSpeed=['observed','computed','estimated'].includes(route.speed?.status);
  const knownRadar=(route.ships||[]).every(s=>typeof s.radarEquipped==='boolean');
  const unmetSpeed=!!strategy&&knownSpeed&&!strategy.speedMet,unmetRadar=!!strategy&&knownRadar&&!strategy.radarMet;
  const fleetCondition=selected.fleetRequirement?require('../../domain/routes/normal_routes').predicate(selected.fleetRequirement,route.ships,{}):true;
  const unmetFleet=fleetCondition===false,impossible=details.chance?.max===0;
  if(!impossible&&!unmetSpeed&&!unmetRadar&&!unmetFleet)return null;
  const relevant=details.blocked.filter(p=>!p.summary?.startsWith('流派速力要求：')||knownSpeed)
    .filter(p=>!p.summary?.startsWith('流派电探要求：')||knownRadar)
    .filter(p=>!p.summary?.startsWith('攻略编成要求：')||fleetCondition===false);
  const warnings=[...new Set(relevant.map(p=>{
    if(p.from===null||!p.current)return p.summary;
    const requirements=[...new Set((p.requirements||[]).filter(r=>r.state!=='matched').map(r=>r.condition))];
    return `${p.from==='start'?'出发点':p.from} → ${p.to}：${p.current}${requirements.length?'；需要 '+requirements.join(' 或 '):''}`;
  }))];
  return {unreachable:impossible,value:impossible?'无法沿此路线抵达':'编成不满足路线要求',warnings};
}
function routeArrival(report,selected,ready,target='boss'){
  const result=routeArrivalResult(report,selected,ready,target);
  return selected?.phaseNote?withArrivalNotes(result,
    [{kind:'phase',text:selected.phaseNote},...(result.noteLines||(result.note?[{text:result.note}]:[]))]):result;
}
function routeArrivalResult(report,selected,ready,target='boss'){
  const label='按既定路线抵达目标';
  if(!selected)return {label,value:'请选择路线',note:'',tone:'pending',warnings:[]};
  if(!ready||!report.route)return {label,value:'待核对编成',note:'',tone:'pending',warnings:[]};
  const plans=require('../../domain/routes/route_plans'),route=report.route,nodes=selected.nodes;
  const fleet=plans.fleetRequirementAssessment(route,selected);
  if(!fleet.eligible)return {label,value:'编成条件未满足',note:fleet.description,tone:'warning',warnings:plans.routeDiagnostics(route,selected).warnings};
  const strategy=plans.strategyAssessment(route,selected);
  if(strategy&&(selected.strategy.requireFixedArrival!==false||!strategy.eligible)){
    const speedNames={slow:'低速',fast:'高速',fastPlus:'高速＋',fastest:'最速'};
    const branches=strategy.branches.filter(b=>b.probability>0).map(b=>`${b.nodes[1]} 路 ${Math.round(b.probability*100)}%`).join(' / ');
    const manual=strategy.eligible?plans.bossArrivalChance(route,selected).playerChoices:[];
    const notes=strategy.eligible?[
      ...(selected.strategy.arrivalNote?[{text:selected.strategy.arrivalNote.replace('{branches}',branches)}]:[]),
      ...strategy.branches.filter(b=>b.probability>0).sort((a,b)=>b.probability-a.probability).map(b=>({nodes:b.nodes,probability:b.probability,value:`${Math.round(b.probability*1000)/10}%`})),
      ...(manual.length?[{text:`能动分歧：${manual.map(p=>`${p.from} 点选 ${p.to}`).join('，')}`}]:[])]:
      [{text:`需全队${speedNames[selected.strategy.minimumSpeed]}统一${selected.strategy.radarCarriers?`、至少 ${selected.strategy.radarCarriers} 艘携带电探`:''}；当前速力：${speedNames[route.speed?.fleetSpeed]||'待确认'}。请补全或调整舰娘及提速装备。`}];
    return withArrivalNotes({label,value:strategy.eligible?'固定到达':route.speed?.status==='unknown'?'条件待确认':'流派条件未满足',
      tone:strategy.eligible?'good':'warning',warnings:strategy.eligible?[]:plans.routeDiagnostics(route,selected).warnings},notes);
  }
  if(selected.paths){
    const grouped=plans.optionPlanning(route,selected),probability=grouped.chance.probability;
    const arrival=selected.arrivalMode==='boss'?plans.bossArrivalChance(route,selected):null;
    const manual=(arrival||plans.bossArrivalChance(route,selected)).playerChoices;
    const total=arrival?arrival.probability:probability;
    const percent=n=>`${Math.round(n*1000)/10}%`;
    const branches=grouped.branches.filter(b=>b.chance.max>0);
    // Complete journey probabilities already include these random forks.
    // Keep actual blockers and unknown conditions in the warning area.
    const warnings=probability===1?[]:plans.routeDiagnostics(route,selected).points
      .filter(point=>!branches.length||point.status!=='random').map(point=>point.summary);
    return withArrivalNotes({label,hasOtherBranches:Number.isFinite(total)&&Number.isFinite(probability)&&total-probability>1e-9,
      value:total===1?'固定到达':total===0?'无法抵达 Boss':Number.isFinite(total)?`到达概率 ${percent(total)}`:'到达率待确认',
      tone:total===1?'good':'warning',unreachable:total===0,warnings},
      [{kind:'probabilitySummary',text:probability===0?'当前编成无法走所选路线':selected.arrivalMode==='boss'?`所选合流路线 ${probability===null?'概率待确认':percent(probability)}`:'分支在后续节点汇合'},
        ...(Number.isFinite(total)&&Number.isFinite(probability)&&total-probability>1e-9?[{text:'总到达概率包含其他可抵达目标的分支'}]:[]),
        ...branches.sort((a,b)=>(b.chance.probability??-1)-(a.chance.probability??-1))
          .map(b=>({nodes:b.nodes,probability:b.chance.probability,value:b.chance.probability===null?'待确认':percent(b.chance.probability)})),
        ...(manual.length?[{text:`能动分歧：${manual.map(p=>`${p.from} 点选 ${p.to}`).join('，')}`}]:[])]);
  }
  const observed=plans.pathChance(route,nodes);
  // Re-evaluate with candidate LoS and known propulsion rules. "Estimated"
  // distinguishes an unapplied loadout from API state, not an unknown rule.
  const calculated=observed.probability===null&&(route.ships?.length||route.lineOfSight?.status==='estimate'||route.speed?.status==='estimated')?
    plans.planningPath(route,nodes,{allowTentative:false}):null;
  const chance=calculated?.chance||observed;
  const displayRoute=calculated?{...route,pointAssessments:calculated.pointAssessments,fixedArrivalCondition:null}:route;
  const playerChoice=displayRoute.pointAssessments?.some(p=>['start',...nodes.slice(0,-1)].includes(p.from)&&plans.isPlayerChoice(p.assessment));
  const profile={...report.profile,routePaths:[{nodes}],examples:[nodes]};
  const warnings=chance.probability===1?[]:route.ships?.length?plans.routeDiagnostics(route,selected).warnings:
    [...new Set(require('../models/presentation_model').routeReasons({route:displayRoute,profile}))];
  const percent=n=>n>0&&n<0.001?'<0.1%':n<1&&n>0.999?'>99.9%':`${Math.round(n*1000)/10}%`;
  // On branching maps the selected line is one possible journey. The graph
  // verdict includes the other Boss-bound branches, including hidden/dead exits.
  // Never sum independently optimized recommendations (their fleets differ).
  if(selected.arrivalMode==='boss'){
    const arrival=plans.bossArrivalChance(route,selected),total=arrival.probability;
    const pathNote=chance.probability===null?'所选路线概率待确认':chance.probability===0?
      '当前编成无法走所选路线':chance.probability>=1-1e-9?'':`所选路线 ${percent(chance.probability)}`;
    return {label,hasOtherBranches:Number.isFinite(total)&&Number.isFinite(chance.probability)&&total-chance.probability>1e-9,value:total===1?'固定到达':Number.isFinite(total)?
      total===0?'无法抵达 Boss':`到达概率 ${percent(total)}`:'到达率待确认',
      note:[pathNote,...(Number.isFinite(total)&&Number.isFinite(chance.probability)&&total-chance.probability>1e-9?['总到达概率包含其他可抵达目标的分支']:[]),...(arrival.playerChoices.length?[`能动分歧：${arrival.playerChoices.map(p=>`${p.from} 点选 ${p.to}`).join('，')}`]:[])].filter(Boolean).join('\n'),
      tone:total===1?'good':'warning',unreachable:total===0,warnings};
  }
  if(chance.probability===1)return {label,value:'固定到达',note:playerChoice?'能动分岐请按所选路线选择出口':'',tone:'good',warnings};
  if(chance.probability!==null)return {label,unreachable:chance.probability===0,value:chance.probability===0?'无法沿此路线到达':`到达概率 ${percent(chance.probability)}`,
    note:chance.probability===0?'当前编成不满足所选路线，请调整舰娘或装备':playerChoice?'能动分岐按所选路线选择；随机出口概率见下方':'存在随机分岐；详细出口概率见下方',tone:'warning',warnings};
  return {label,value:'到达率待确认',note:'下列带路条件尚未明确，请按点位调整编成或补充资料',tone:'warning',warnings};
}
function applicationWarning(kind,report,selected,target='boss'){
  if(kind==='expedition'&&report.expedition?.eligible===false)return {label:'⚠ 未达标，仍应用',
    hint:'远征出航条件未满足，应用后仍需调整；点击仍可应用当前编成'};
  if(kind==='normal'&&target==='boss'&&(report.route?.verdict==='unreachable'||report.route?.area&&selected&&routeArrival(report,selected,true,target).unreachable))
    return {label:'⚠ 不可达，仍应用',hint:'当前编成无法按所选路线抵达 Boss；点击仍可应用当前编成并自行调整'};
  return null;
}
// Reuse the already-built rule trees. No fleet search or extra route evaluation.
function routeSpeedSummary(points,option){
  const names={slow:'低速',fast:'高速',fastPlus:'高速+',fastest:'最速'},ranks={slow:1,fast:2,fastPlus:3,fastest:4};
  const minimum=option?.strategy?.minimumSpeed,groups=new Map();
  const terms=node=>{
    if(!node||node.operator==='not')return [];
    if(node.speedCondition)return [node.speedCondition];
    if(node.operator==='any'&&!minimum){
      const matched=node.children.filter(n=>n.met===true);
      if(matched.some(n=>terms(n).length===0))return [];
      return matched.flatMap(terms);
    }
    return (node.children||[]).flatMap(terms);
  };
  for(const point of points||[]){
    if(point.playerChoice)continue;
    const exits=point.exits||String(point.to).split(/\s*\/\s*/);
    const onRoute=rule=>rule.destinations.split('/').some(to=>exits.includes(to));
    const rules=point.rules.filter(rule=>onRoute(rule)&&(minimum||rule.active));
    let values=rules.flatMap(rule=>terms(rule.conditionTree));
    if(minimum){
      values=values.filter(c=>c.kind==='minimum'?ranks[c.value]<=ranks[minimum]:c.value===minimum);
      if(values.length)values=[values.reduce((a,b)=>ranks[b.value]>ranks[a.value]?b:a)];
    }
    // A preceding slow-fleet diversion also creates a positive requirement,
    // even when the selected exit is the unconditional fallback.
    if(!minimum&&rules.some(r=>r.active))for(const rule of point.rules){
      if(rule.active)break;
      const c=rule.conditionTree?.speedCondition;
      if(!onRoute(rule)&&rule.state==='unmatched'&&c?.kind==='exact'&&c.value==='slow')
        values.push({kind:'minimum',value:'fast'});
    }
    for(const value of values){
      const label=names[value.value]+(value.kind==='minimum'&&value.value!=='fastest'?'以上':'');
      if(!groups.has(label))groups.set(label,new Set());groups.get(label).add(point.from==='start'?'出发':point.from);
    }
  }
  const lines=[...groups].map(([label,nodes])=>`${[...nodes].join('/')} 点 · ${label}`);
  if(!lines.length&&minimum)lines.push(`所选流派 · ${names[minimum]}统一`);
  return {hint:lines.join('；'),detail:lines.join('\n')};
}
function losSummary(report,profile,routeNodes){
  const los=report.metrics?.lineOfSight,route=report.route,plans=require('../../domain/routes/route_plans');
  const area=route?.area||profile?.area,selected=Array.isArray(routeNodes)&&routeNodes.length>0;
  const paths=selected?(Array.isArray(routeNodes[0])?routeNodes:[routeNodes]):[];
  const planned=selected&&route?.area?plans.optionPlanning(route,{nodes:paths[0],paths}):null;
  const requirements=Array.isArray(routeNodes)?planned?.losRequirements.map(r=>({...r,requiredScore:r.required}))||[]:
    route?.fixedArrivalCondition?.requirements||[];
  const gates=selected&&area?[...new Map(paths.flatMap(nodes=>plans.losGates(area,nodes,route?.phase||profile?.phase)).map(g=>[g.from+'>'+g.to,g])).values()]:[];
  const bypassed=planned&&gates.every(g=>planned.pointAssessments.some(p=>p.from===g.from&&
    p.assessment.status==='fixed'&&!p.assessment.tentative&&p.assessment.destinations[0]===g.to));
  const coefficients=[...new Set(gates.flatMap(g=>g.coefficients))];
  // With multiple checks, headline the tightest one; keep every connection,
  // coefficient, threshold and current value in the detail tooltip.
  const ordered=requirements.slice().sort((a,b)=>
    ((los?.rawScoresByCoefficient?.[a.coefficient]??-Infinity)-a.requiredScore)-
    ((los?.rawScoresByCoefficient?.[b.coefficient]??-Infinity)-b.requiredScore));
  const primary=ordered[0],coefficient=primary?.coefficient??(coefficients.length===1?coefficients[0]:null);
  const score=coefficient===null?undefined:los?.scoresByCoefficient?.[coefficient];
  const label='33 式索敌'+(coefficient===null?'':` · 系数 ${coefficient}`);
  const value=Number.isFinite(score)?score.toFixed(1):'—';
  const edge=r=>{
    const path=paths.find(nodes=>nodes.includes(r.from))||profile?.routePaths?.find(p=>p.nodes.includes(r.from))?.nodes||[];
    const index=path.indexOf(r.from),to=r.to||(index>=0?path[index+1]:null);
    return to?`${r.from}→${to}`:`${r.from} 点`;
  };
  if(primary){
    const measured=requirements.every(r=>Number.isFinite(los?.rawScoresByCoefficient?.[r.coefficient]));
    const meets=measured&&requirements.every(r=>los.rawScoresByCoefficient[r.coefficient]>=r.requiredScore);
    const conservative=measured&&requirements.every(r=>(los.status==='computed'?los.rawScoresByCoefficient[r.coefficient]:
      los?.lowerBoundScoresByCoefficient?.[r.coefficient]??-Infinity)>=r.requiredScore);
    const fails=measured&&requirements.some(r=>(los.status==='computed'?los.rawScoresByCoefficient[r.coefficient]:
      los?.upperBoundScoresByCoefficient?.[r.coefficient]??Infinity)<r.requiredScore);
    const hint=`门槛 ≥ ${primary.requiredScore} · ${edge(primary)}`+(requirements.length>1?` · 共 ${requirements.length} 处`:'');
    const detail=requirements.map(r=>`${edge(r)}：门槛 ≥ ${r.requiredScore} · 系数 ${r.coefficient} · 当前 ${Number.isFinite(los?.scoresByCoefficient?.[r.coefficient])?los.scoresByCoefficient[r.coefficient].toFixed(1):'待计算'}`).join('\n');
    const compactHint=`${edge(primary)} · 门槛 ≥ ${primary.requiredScore} · 系数 ${coefficient}`;
    return {label,value,coefficient,hint,compactHint,detail,checks:requirements.map(r=>({edge:edge(r),coefficient:r.coefficient,requiredScore:r.requiredScore,score:los?.scoresByCoefficient?.[r.coefficient]})),state:!measured?'待计算':conservative?'索敌达标':
      fails?'索敌不足':meets?'估算达标':'索敌待确认',bad:fails,uncertain:measured&&!conservative&&!fails};
  }
  if(selected&&area&&(!gates.length||bypassed))return {label:'33 式索敌',value:'—',coefficient:null,
    hint:bypassed&&gates.length?'当前编成无需索敌判定':'所选路线无索敌门槛',state:'无需索敌',bad:false};
  if(routeNodes===undefined&&!area)return {label,value:'—',coefficient:null,
    hint:'未指定海域与路线',state:'未设门槛',bad:false};
  const hint=!selected?'选择路线后显示索敌门槛':gates.length?gates.map(edge).join(' · ')+' · 门槛待确认':'所选路线索敌资料待确认';
  return {label,value,coefficient,hint,state:!selected?'请选择路线':'门槛待确认',bad:false};
}
function fleetSummary(report,profile,routeNodes){
  const air=report.metrics?.airPower;
  const paths=Array.isArray(routeNodes)?routeNodes.length?(Array.isArray(routeNodes[0])?routeNodes:[routeNodes]):[]:null;
  const airProfile=paths?{...profile,routePaths:paths.map(nodes=>({nodes})),examples:paths}:profile;
  const {routeAirReference,estimateRouteAir}=require('../../domain/routes/route_air');
  const reference=routeAirReference(report.route||{},profile?.area,airProfile);
  const estimate=estimateRouteAir(air,reference),arrival=estimate.boss||estimate.terminal;
  const airValue=air?.status==='range'?air.min===air.max?String(air.min):`${air.min}–${air.max}`:'—';
  const base=reference.superiority,secure=reference.supremacy;
  const range=value=>value.min===value.max?String(value.min):`${value.min}–${value.max}`;
  const airHint=base===null?reference.status==='unselected'?'请选择路线':'所选路线制空资料待确认':base===0?'敌方全程无制空':`空优 ${base} · 空确 ${secure}`+
    (reference.limitingNodes.length?` · ${reference.limitingNodes.join('/')} 点`:'');
  const noAirBattle=base===0&&reference.nodes.every(n=>n.noAirBattle||n.kind==='asw');
  const endpoint=arrival?.node?`${arrival.node} 点`:'Boss';
  const airState=air?.status!=='range'?'待计算':base===null?'待确认':noAirBattle?'无需制空':
    estimate.status!=='estimated'?'损耗待确认':base===0&&air.max===0?'未配制空':
    estimate.margins.supremacy.min>=0?'全程空确':
    estimate.margins.superiority.min>=0?'全程空优':arrival?.before.max<arrival?.required.superiority?`${endpoint}制空不足`:
    arrival?.before.min<arrival?.required.superiority?`${endpoint}空优临界`:estimate.margins.superiority.max<0?'道中制空不足':'道中空优临界';
  const lossDetail=estimate.status==='estimated'?(arrival?`${estimate.boss?'抵达 Boss':'抵达终点'}时我方预计制空：${range(arrival.before)}\n`:'')+`${estimate.basis}\n`+estimate.paths.flatMap(p=>p.steps.map(s=>
    `${s.node} 点${s.round>1?`第 ${s.round} 轮`:''}：战前 ${range(s.before)} / 空优 ${s.required.superiority}`+(s.after?` → 战后 ${range(s.after)}`:''))).join('\n'):
    estimate.reason;
  const compactHint=base===null||base===0?airHint:
    `${reference.limitingNodes.join('/')} 点 · 空优 ${base} · 空确 ${secure}`;
  return {air:{value:airValue,state:airState,hint:airHint,compactHint,
    detail:['按所选路线估算，已计道中飞机损耗；全程空优／空确不是实战保证。',lossDetail||reference.reason||reference.basis].filter(Boolean).join('\n'),reference,estimate,
    bad:/不足|临界|未配/.test(airState)},
    los:losSummary(report,profile,routeNodes)};
}
const income=require('../../domain/expeditions/expedition_income').missionIncome;

module.exports={TYPES,entry,scheme,resolved,roster,replacementCandidates,changeSummary,equipmentOptions,recommendationHolds,merge,withEquipment,projected,inspect,routeChoices,badges,income,mapOverview,selectedMapProfile,routeEdgeProbabilities,mapProgress,displayThreat,displayBossFlagship,fleetSummary,routeArrival,draftRouteIssue,routeSpeedSummary,applicationWarning};
