'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/workbench_fixture');
const {context}=require('../../src/recommendation/context');
const {questRequirements,satisfiesQuests,questSeeds,createQuestPrecheck}=require('../../src/recommendation/quest_constraints');
const {recommendNormalFleet,recommendNormalFleetParallel,recommendExpeditionFleet}=require('../../src/recommendation');

function storeWithShips(){
  const store=fixture();
  for(const [id,name,type] of [[1,'鈴谷',7],[2,'村雨',2],[3,'夕立',2],[4,'朧',2],[5,'曙',2],[6,'樫',2],[7,'自由二',1],[8,'自由三',2]]){
    store.const.$ships[id].api_name=name;store.const.$ships[id].api_stype=type;
  }
  return store;
}

test('static quest precheck prunes only definite failures, preserving equipment-dependent and unknown alternatives',()=>{
  const store=storeWithShips(),scheme=(...ids)=>({fleet:1,ships:ids.map(id=>({id}))});
  const count=(selector,min=1,extra={})=>({kind:'count',selector,min,...extra});
  const types=stypeIds=>({kind:'shipType',stypeIds});
  const possible=fleet=>createQuestPrecheck(store,[{fleet}]);
  assert.equal(possible({allOf:[count(types([3]))]})(scheme(2,3)),false);
  assert.equal(possible({fleetIndex:2,allOf:[]})(scheme(2,3)),false);
  assert.equal(possible({allOf:[count(types([7]),1,{positions:[1]})]})(scheme(2,1)),false);
  assert.equal(possible({allOf:[count(types([7]),1,{positions:[1]})]})(scheme(1,2)),true);
  const speed={kind:'speed',min:20};
  assert.equal(possible({allOf:[count(speed)]})(scheme(2)),true,'fitting can improve speed');
  assert.equal(possible({allOf:[count({not:speed})]})(scheme(2)),true,'negating an unknown speed must remain unknown');
  assert.equal(possible({anyOf:[{allOf:[count(types([3]))]},{allOf:[count(speed)]}]})(scheme(2)),true);
  assert.equal(possible({anyOf:[{allOf:[count(types([3]))]},{allOf:[count(types([7]))]}]})(scheme(2)),false);
  const unknown=scheme(999);assert.equal(possible({allOf:[count(types([3]))]})(unknown),true,'missing master data cannot be declared impossible');
});

test('precheck never rules out a fully satisfied fleet across the quest catalog',()=>{
  const store=storeWithShips(),all=[...require('../../data/quests/requirements.json').quests,
    ...require('../../data/quests/limited/2026-halloween.json').quests].filter(q=>q.fleet);
  const candidates=[[1],[2,3],[1,2,3,4,5],[1,2,3,4,5,6],[7,2,3,4,5,6]];
  for(const quest of all){
    const possible=createQuestPrecheck(store,[quest]);
    for(const ids of candidates){const scheme={fleet:1,ships:ids.map(id=>({id}))};
      if(satisfiesQuests(store,scheme,[quest]))assert(possible(scheme),`${quest.code} must not be rejected`);
    }
  }
});

test('normal search skips fitting candidates that cannot meet the selected quest',()=>{
  const store=fixture(),trace=new (require('../../src/shared/performance_trace').PerformanceTrace)({level:'stages'});
  const codes=['By6'],quests=questRequirements(codes);
  const result=trace.run(()=>recommendNormalFleet(store,{area:'1-2',fleet:1,questCodes:codes,
    automaticFilters:{minLevel:0,excludeUnremodeled:false,excludeFatigued:false}}));
  assert(result.recommendations.length,result.reason);
  assert(trace.counters['candidate.questStaticRejected']>0,'unsuitable fleets are rejected before fitting');
  assert(result.recommendations.every(row=>satisfiesQuests(store,row.scheme,quests)));
});

test('seed search combines multiple quests, flagship rules and fixed positions',()=>{
  const store=storeWithShips(),quests=questRequirements(['2610B1','2610B5']);
  const args={fleet:1,fixedShipIds:[2],heldSlots:[null,{id:2,pin:true,keep:{}}]},ctx=context(store,args,1);
  const seeds=questSeeds(store,ctx,args,quests);
  assert(seeds.length,'a qualifying fleet exists');
  for(const rows of seeds){
    assert.equal(rows[1].id,2);
    assert(satisfiesQuests(store,{fleet:1,ships:rows.map(row=>({id:row.id}))},quests));
  }
});

test('seed search assigns separate named roles plus a free fast ship',()=>{
  const store=storeWithShips();
  for(const [id,name] of [[1,'古鷹'],[2,'加古'],[3,'青葉'],[4,'鳥海'],[5,'天龍'],[6,'自由舰']])store.const.$ships[id].api_name=name;
  const quests=questRequirements(['B11']),ctx=context(store,{fleet:1},1),seeds=questSeeds(store,ctx,{},quests);
  assert(seeds.length,'six separate roles can be filled');
  assert(seeds.every(rows=>rows.length===6&&satisfiesQuests(store,{fleet:1,ships:rows.map(row=>({id:row.id}))},quests)));
});

test('route type templates allow reordered ships while alternative task roles and held positions remain exact',()=>{
  const store=fixture(),args={fleet:1,fixedShipIds:[7],heldSlots:[null,{id:7,pin:true,keep:{}}]};
  const quests=[{fleet:{sizeExact:2,anyOf:[
    {allOf:[{kind:'count',positions:[1],selector:{kind:'shipType',stypeIds:[3]},min:1},
      {kind:'count',positions:[2],selector:{kind:'shipType',stypeIds:[1]},min:1}]},
    {allOf:[{kind:'count',positions:[1],selector:{kind:'shipType',stypeIds:[1]},min:1},
      {kind:'count',positions:[2],selector:{kind:'shipType',stypeIds:[3]},min:1}]}]}}];
  const ctx=context(store,args,1),seeds=questSeeds(store,ctx,args,quests,{templates:[[[1],[3]]]});
  assert(seeds.some(rows=>rows.map(row=>row.id).join(',')==='1,7'));
  assert(seeds.every(rows=>rows.length===2&&rows[1].id===7&&satisfiesQuests(store,{fleet:1,ships:rows.map(row=>({id:row.id}))},quests)));
});

test('normal recommendations meet every selected quest after fitting and fleet reordering',()=>{
  const store=storeWithShips(),quests=questRequirements(['2610B1','2610B5']);
  const result=recommendNormalFleet(store,{area:'1-3',fleet:1,questCodes:['2610B1','2610B5']});
  assert(result.recommendations.length,result.reason);
  assert(result.recommendations.every(row=>satisfiesQuests(store,row.scheme,quests)));
});

test('parallel batches enforce the same task constraints as serial search',async()=>{
  const store=storeWithShips(),quests=questRequirements(['2610B1','2610B5']);
  const result=await recommendNormalFleetParallel(store,{area:'1-3',fleet:1,questCodes:['2610B1','2610B5']},async(batch,fallback)=>fallback());
  assert(result.recommendations.length,result.reason);
  assert(result.recommendations.every(row=>satisfiesQuests(store,row.scheme,quests)));
});

test('task seeds retain route-specific hull types when higher-level escorts dominate',()=>{
  const store=fixture();
  for(const [id,name,type,level] of [[1,'高练度轻巡',3,110],[2,'村雨改二',2,76],[3,'早波',2,21],[4,'浜波',2,17],
    [5,'高练度驱逐',2,100],[6,'稲木改二',1,125],[7,'対馬改',1,120],[8,'高练度海防',1,115]]){
    Object.assign(store.const.$ships[id],{api_name:name,api_stype:type});store.info.ships[id].api_lv=level;
  }
  const codes=['2610B2'],args={area:'1-2',fleet:1,questCodes:codes,automaticFilters:{minLevel:0,excludeUnremodeled:false,excludeFatigued:false}};
  const quests=questRequirements(codes),ctx=context(store,args,1),routes=require('../../src/domain/routes/route_plans').recommendedOptions('1-2','boss');
  const seeds=questSeeds(store,ctx,args,quests,{templates:routes.flatMap(route=>route.templates||[])});
  const routeCompatible=rows=>rows.length===5&&rows.filter(row=>row.stype===3).length===1&&rows.filter(row=>row.stype===2).length===4;
  assert(seeds.some(routeCompatible),'task seeds include a 1 CL + 4 DD fleet');
  const result=recommendNormalFleet(store,args);
  const row=result.recommendations.find(item=>item.routeKey==='guide:1-2-02');
  assert(row,result.reason);assert(satisfiesQuests(store,row.scheme,quests));
  assert.deepEqual(row.scheme.ships.map(ship=>store.const.$ships[store.info.ships[ship.id].api_ship_id].api_stype).sort(),[2,2,2,2,3]);
});

function routeCoverageStore(){
  const store=fixture();
  for(let id=9;id<=38;id++){
    store.info.ships[id]={...structuredClone(store.info.ships[1]),api_id:id,api_ship_id:id};
    store.const.$ships[id]={...structuredClone(store.const.$ships[1]),api_id:id};
  }
  for(const [id,name,type,level] of [[1,'村雨改二',2,77],[2,'稲木改二',1,76],[3,'対馬改',1,48],[4,'三隈改二特',16,31]]){
    Object.assign(store.const.$ships[id],{api_name:name,api_stype:type,api_yomi:`ship${id}`});
    store.info.ships[id].api_lv=level;
  }
  for(let id=5;id<=38;id++){
    Object.assign(store.const.$ships[id],{api_name:`强力舰${id}`,api_yomi:`ship${id}`,api_stype:[18,4,9,11,3,5][id%6]});
    store.info.ships[id].api_lv=120-id;
  }
  return store;
}

test('task route coverage retains a lower-level 2-2 tender and reaches the Boss without changing the task',async()=>{
  const store=routeCoverageStore(),before=JSON.stringify(store),args={area:'2-2',fleet:1,questCodes:['2610B2'],airGoal:'ignore',
    automaticFilters:{minLevel:0,excludeUnremodeled:false,excludeFatigued:false}};
  const quests=questRequirements(args.questCodes),ctx=context(store,args,1),plans=require('../../src/domain/routes/route_plans');
  const fallback=plans.recommendedOptions('2-2','boss').filter(option=>option.fallback);
  assert(!questSeeds(store,ctx,args,quests).some(rows=>rows.some(row=>row.id===4)),
    'the original task-only beam is crowded out by stronger hulls');
  const covered=questSeeds(store,ctx,args,quests,{routes:fallback});
  assert(covered.some(rows=>rows.length===6&&rows.some(row=>row.id===4)),
    'a task-compatible water tender survives route-aware candidate generation');
  assert(covered.every(rows=>satisfiesQuests(store,{fleet:1,ships:rows.map(row=>({id:row.id}))},quests)));
  const check=result=>{
    const route=result.routeResults.find(row=>row.fallback),row=result.recommendations.find(item=>item.routeKey===route.key);
    assert(row,result.reason);assert.equal(row.route.probability,1);
    assert.deepEqual(row.selectedPath,['C','E','F','H','K']);
    assert(row.scheme.ships.some(ship=>ship.id===4));
    assert(satisfiesQuests(store,row.scheme,quests));
  };
  check(recommendNormalFleet(store,args));
  check(await recommendNormalFleetParallel(store,args,(_batch,run)=>run()));
  assert.equal(JSON.stringify(store),before,'search does not modify the account snapshot');
});

test('route-aware task candidates improve 2-3 arrival and preserve held ship positions',()=>{
  const store=routeCoverageStore(),quests=questRequirements(['2610B2']);
  const args={area:'2-3',fleet:1,questCodes:['2610B2'],airGoal:'ignore',
    automaticFilters:{minLevel:0,excludeUnremodeled:false,excludeFatigued:false}};
  const result=recommendNormalFleet(store,args),row=result.recommendations[0];
  assert(row,result.reason);assert(row.route.probability>0.98);
  assert(satisfiesQuests(store,row.scheme,quests));
  const heldArgs={...args,fixedShipIds:[1],heldSlots:[null,{id:1,pin:true,keep:{}}]};
  const ctx=context(store,heldArgs,1),routes=require('../../src/domain/routes/route_plans').recommendedOptions('2-3','boss');
  const seeds=questSeeds(store,ctx,heldArgs,quests,{routes});
  assert(seeds.length);assert(seeds.every(rows=>rows[1]?.id===1));
  assert(seeds.every(rows=>satisfiesQuests(store,{fleet:1,ships:rows.map(item=>({id:item.id}))},quests)));
});

test('task adaptive search compares overall arrival without mixing manual branch choices',()=>{
  const store=routeCoverageStore(),args={area:'1-4',fleet:1,questCodes:['2610B2'],airGoal:'ignore',
    automaticFilters:{minLevel:0,excludeUnremodeled:false,excludeFatigued:false}};
  const result=recommendNormalFleet(store,args),option=result.routeResults.find(row=>row.fallback);
  const row=result.recommendations.find(item=>item.routeKey===option?.key);assert(row,result.reason);
  const arrival=require('../../src/domain/routes/route_plans').adaptiveArrival(row.route,option);
  assert(arrival?.arrival.probability>=0.9125,'a more likely single path must not lower overall arrival');
  assert(satisfiesQuests(store,row.scheme,questRequirements(args.questCodes)));
});

test('task coverage keeps a phase-specific named routing ship even when stronger destroyers exist',()=>{
  const store=routeCoverageStore();
  Object.assign(store.const.$ships[4],{api_name:'神風改',api_stype:2});
  const args={area:'7-3',phase:'gauge2',fleet:1,questCodes:['2610B2'],
    automaticFilters:{minLevel:0,excludeUnremodeled:false,excludeFatigued:false}};
  const quests=questRequirements(args.questCodes),ctx=context(store,args,1);
  const routes=require('../../src/domain/routes/route_plans').recommendedOptions(args.area,'boss',args.phase);
  assert(!questSeeds(store,ctx,args,quests).some(rows=>rows.some(row=>row.id===4)),
    'the task-only beam does not retain this lower-level ship');
  const seeds=questSeeds(store,ctx,args,quests,{routes});
  assert(seeds.some(rows=>rows.length===6&&rows.some(row=>row.id===4)),
    'the named phase-specific routing ship survives the task beam');
  assert(seeds.every(rows=>satisfiesQuests(store,{fleet:1,ships:rows.map(row=>({id:row.id}))},quests)));
});

test('pumpkin escort task finds a compatible real path with unremodeled ships excluded',async()=>{
  const store=fixture();
  for(const [id,name,type] of [[1,'対馬改',1],[2,'稲木改二',1],[3,'村雨改二',2],[4,'早波',2],
    [5,'戦艦A',8],[6,'戦艦B',8],[7,'戦艦C',8],[8,'戦艦D',8]]){
    Object.assign(store.const.$ships[id],{api_name:name,api_stype:type,api_aftershipid:id===4?999:0});store.info.ships[id].api_lv=75;
  }
  const args={area:'1-2',fleet:1,questCodes:['2610B2'],automaticFilters:{minLevel:0,excludeUnremodeled:true,excludeFatigued:false}};
  const result=recommendNormalFleet(store,args),fallback=result.routeResults.find(row=>row.fallback);
  assert(result.routeResults.filter(row=>!row.fallback).every(row=>row.status!=='available'),'curated hull templates are incompatible');
  assert.equal(fallback.status,'available');assert(fallback.chance.probability>0);
  const recommendation=result.recommendations[fallback.recommendationIndex];
  assert(recommendation);assert(satisfiesQuests(store,recommendation.scheme,questRequirements(args.questCodes)));
  assert(!recommendation.scheme.ships.some(ship=>ship.id===4),'the unremodeled ship remains excluded');
  const plans=require('../../src/domain/routes/route_plans'),path=recommendation.selectedPath;
  const chance=plans.planningPath(recommendation.route,path,{allowTentative:false}).chance;
  assert.deepEqual(fallback.chance,chance,'the result reports one real path, not a sum of unrelated alternatives');
  assert.deepEqual(fallback.displayPaths,[path]);
  assert.equal(plans.optionPlanning(recommendation.route,fallback).branches.length,1,'independent paths are not combined');
  const W=require('../../src/ui/workbench/workbench_model');
  const display=W.routeArrival({route:recommendation.route},fallback,true);
  assert.equal(display.value,'到达概率 70%');assert(!display.note.includes('分支在后续节点汇合'));
  const overview=W.mapOverview('1-2','boss',undefined,undefined,store);
  assert.deepEqual(W.selectedMapProfile(overview,fallback.key,null,recommendation.route).highlightPaths,[path]);
  assert.throws(()=>recommendNormalFleet(store,{...args,routeKey:fallback.key}),/仅在预设路线均无方案时自动搜索/);
  const parallel=await recommendNormalFleetParallel(store,args,(_batch,run)=>run());
  const parallelFallback=parallel.routeResults.find(row=>row.fallback);
  assert.equal(parallelFallback.status,'available');assert.deepEqual(parallelFallback.chance,fallback.chance);
  assert(satisfiesQuests(store,parallel.recommendations[parallelFallback.recommendationIndex].scheme,questRequirements(args.questCodes)));
  const {RecommendationWorker}=require('../../src/infrastructure/workers/recommendation_worker');
  const worker=new RecommendationWorker({getDiagnostics:()=>null});
  try{
    const result=await worker.run('recommendNormalFleet',store,args),found=result.routeResults.find(row=>row.fallback);
    assert.equal(found.status,'available');assert.deepEqual(found.chance,fallback.chance);
    assert(satisfiesQuests(store,result.recommendations[found.recommendationIndex].scheme,questRequirements(args.questCodes)));
  }finally{await worker.dispose();}
  store.const.$ships[2].api_aftershipid=998;
  const impossible=recommendNormalFleet(store,args);
  assert.deepEqual(impossible.recommendations,[],'the fallback cannot bypass the unremodeled filter or task requirements');
  assert.match(impossible.reason,/任务/);
});

function adaptiveYamatoStore(){
  const store=fixture();
  const ships=[[1,'大和改二重',10],[2,'朧改',2],[3,'秋雲改',2],
    [4,'瑞鶴改二甲',11],[5,'翔鶴改二甲',11],[6,'武蔵改二',9]];
  for(const id of [7,8]){delete store.const.$ships[id];delete store.info.ships[id];}
  for(const [id,name,type] of ships){
    const planes=type===11?[34,24,12,9]:type===2?[0,0,0]:[0,0,5,22,5];
    const speed=type===11||type===2?10:5;
    Object.assign(store.const.$ships[id],{api_name:name,api_stype:type,api_slot_num:planes.length,api_maxeq:planes,
      api_soku:speed,api_fuel_max:100,api_bull_max:100});
    Object.assign(store.info.ships[id],{api_lv:99,api_cond:60,api_fuel:100,api_bull:100,
      api_slot:planes.map(()=>-1),api_slot_ex:-1,api_onslot:planes.slice(),api_soku:speed,
      api_karyoku:[120,120],api_raisou:[80,80],api_soukou:[90,90],api_sakuteki:[100,100],
      api_taiku:[80,80],api_taisen:[60,60]});
    store.const.$shipTypes[type]={api_equip_type:Object.fromEntries(
      [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,25,29,33,39,45].map(t=>[t,1]))};
  }
  // Synthetic inventory with enough air power to isolate position from air fit.
  for(let id=101;id<141;id++){
    const type=id<111?3:id<121?6:id<131?45:10;
    const name=type===3?'46cm三連装砲':type===6?'烈風':type===45?'二式水戦改':'零式水上偵察機';
    store.info.equips[id]={api_slotitem_id:id,api_level:0};
    store.const.$equips[id]={api_id:id,api_type:[0,0,type,type],api_name:name,
      api_houg:type===3?20:0,api_tyku:[6,45].includes(type)?12:0,api_saku:type===10?8:0};
  }
  store.info.equips[141]={api_slotitem_id:141,api_level:0};
  store.const.$equips[141]={api_id:141,api_type:[0,0,1,1],api_name:'小口径主砲',api_houg:5};
  return store;
}

test('adaptive 6-5 positions a movable Yamato pair for two quests without breaking the chosen path or held positions',async()=>{
  const store=adaptiveYamatoStore(),before=JSON.stringify(store);
  const args={area:'6-5',fleet:1,questCodes:['B143','B182'],airGoal:'superiority',
    automaticFilters:{minLevel:0,excludeUnremodeled:false,excludeFatigued:false},
    fixedShipIds:[1,2,3,4,5,6],heldSlots:[{id:1,pin:true,holdPosition:false,keep:{}}]};
  const pick=result=>{
    const route=result.routeResults.find(r=>r.fallback);assert(route);assert.equal(route.status,'available');
    const row=result.recommendations[route.recommendationIndex];assert(row);
    assert.equal(route.chance.probability,1);assert.deepEqual(row.pathChance,route.chance);
    assert.deepEqual(route.displayPaths,[row.selectedPath]);
    assert.equal(row.scores.airGoalTier,3);
    assert(satisfiesQuests(store,row.scheme,questRequirements(args.questCodes)));
    const plans=require('../../src/domain/routes/route_plans');
    assert.deepEqual(plans.optionPlanning(row.route,route).nodes,row.selectedPath);
    assert.deepEqual(plans.planningPath(row.route,row.selectedPath,{allowTentative:false}).chance,route.chance);
    const actual=require('../../src/domain/routes/normal_routes').evaluateSearchRoute(store,
      {area:'6-5',target:'boss',fleet:1,scheme:row.scheme});
    assert.deepEqual(plans.optionPlanning(actual,route).nodes,row.selectedPath);
    assert.deepEqual(plans.planningPath(actual,row.selectedPath,{allowTentative:false}).chance,route.chance);
    assert.doesNotThrow(()=>new (require('../../src/application/controller').Controller)({getStore:()=>store}).preview('fleet',row.scheme));
    return row;
  };
  const result=recommendNormalFleet(store,args),row=pick(result);
  assert.deepEqual(row.scheme.ships.slice(0,2).map(ship=>ship.id),[1,6]);
  assert.equal(row.scores.specialAttack.label,'大和型齐射');assert(row.scores.specialAttack.bonus>0);
  const parallel=await recommendNormalFleetParallel(store,args,(_batch,run)=>run());
  const parallelRow=pick(parallel);
  assert.deepEqual(parallelRow.scheme,row.scheme);
  // The player explicitly locks the second position; a higher touch score must
  // never move that hull. Merely fixing hull membership above is different.
  const held=pick(recommendNormalFleet(store,{...args,heldSlots:[null,
    {id:2,pin:true,slots:[141,-1,-1],keep:{0:true}}]}));
  assert.equal(held.scheme.ships[1].id,2);assert.equal(held.scheme.ships[1].slots[0],141);
  assert.equal(held.scores.specialAttack.bonus,0);
  assert.equal(JSON.stringify(store),before,'recommendation never mutates the snapshot');
});

test('adaptive special positioning also gives Nelson a strong participant without changing the physical path',()=>{
  const store=adaptiveYamatoStore();
  Object.assign(store.const.$ships[1],{api_name:'Nelson改',api_stype:9});
  store.info.ships[6].api_karyoku=[180,180];
  for(const id of [2,3])store.info.ships[id].api_karyoku=[40,40];
  const args={area:'6-5',fleet:1,questCodes:['B143'],airGoal:'superiority',
    automaticFilters:{minLevel:0,excludeUnremodeled:false,excludeFatigued:false},
    fixedShipIds:[1,2,3,4,5,6],heldSlots:[{id:1,pin:true,holdPosition:false,keep:{}}]};
  const result=recommendNormalFleet(store,args),option=result.routeResults.find(r=>r.fallback);
  assert.equal(option.status,'available');
  const row=result.recommendations[option.recommendationIndex];assert(row);
  assert.equal(row.scores.specialAttack.label,'Nelson Touch');
  assert(row.scores.specialAttack.participants.some(ship=>ship.id===6&&[3,5].includes(ship.position)));
  assert(satisfiesQuests(store,row.scheme,questRequirements(args.questCodes)));
  assert.deepEqual(row.pathChance,option.chance);assert.deepEqual(option.displayPaths,[row.selectedPath]);
  const plans=require('../../src/domain/routes/route_plans');
  assert.deepEqual(plans.optionPlanning(row.route,option).nodes,row.selectedPath);
  assert.deepEqual(plans.planningPath(row.route,row.selectedPath,{allowTentative:false}).chance,option.chance);
});

test('adaptive route reporting follows the final order when a flagship swap changes the physical path',()=>{
  const store=adaptiveYamatoStore();
  for(const [id,name,type] of [[1,'轻巡改',3],[2,'Nelson改',9],[3,'驱逐甲改',2],
    [4,'驱逐乙改',2],[5,'驱逐丙改',2],[6,'秋津洲改',16]]){
    const planes=type===9?[0,0,3,6]:type===2?[0,0,0]:[0,2,2];
    Object.assign(store.const.$ships[id],{api_name:name,api_stype:type,api_soku:10,
      api_slot_num:planes.length,api_maxeq:planes});
    Object.assign(store.info.ships[id],{api_soku:10,api_onslot:planes,api_slot:planes.map(()=>-1)});
    store.const.$shipTypes[type]={api_equip_type:Object.fromEntries(
      [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,25,29,33,39,45].map(t=>[t,1]))};
  }
  const result=recommendNormalFleet(store,{area:'6-4',fleet:1,airGoal:'ignore',
    automaticFilters:{minLevel:0,excludeUnremodeled:false,excludeFatigued:false},
    fixedShipIds:[1,2,3,4,5,6],heldSlots:[{id:1,pin:true,holdPosition:false,keep:{}}]});
  const option=result.routeResults.find(r=>r.fallback);assert.equal(option.status,'available');
  const row=result.recommendations[option.recommendationIndex];assert(row);
  const plans=require('../../src/domain/routes/route_plans');
  assert.deepEqual(option.displayPaths,[row.selectedPath]);
  assert.deepEqual(plans.optionPlanning(row.route,option).nodes,row.selectedPath);
  assert.deepEqual(plans.planningPath(row.route,row.selectedPath,{allowTentative:false}).chance,option.chance);
  const actual=require('../../src/domain/routes/normal_routes').evaluateSearchRoute(store,
    {area:'6-4',target:'boss',fleet:1,scheme:row.scheme});
  assert.deepEqual(plans.optionPlanning(actual,option).nodes,row.selectedPath);
  assert.deepEqual(plans.planningPath(actual,row.selectedPath,{allowTentative:false}).chance,option.chance);
  const otherId=row.scheme.ships[0].id===1?2:1;
  const otherIndex=row.scheme.ships.findIndex(ship=>ship.id===otherId);assert(otherIndex>0);
  const ships=row.scheme.ships.slice();[ships[0],ships[otherIndex]]=[ships[otherIndex],ships[0]];
  const alternative=require('../../src/domain/routes/normal_routes').evaluateSearchRoute(store,
    {area:'6-4',target:'boss',fleet:1,scheme:{...row.scheme,ships}});
  assert.notDeepEqual(plans.optionPlanning(alternative,option).nodes,row.selectedPath,
    'this is a real flagship-dependent route, not merely a change in the displayed labels');
});

test('the recommendation worker retains selected quests across worker boundaries',async()=>{
  const store=storeWithShips(),quests=questRequirements(['2610B1','2610B5']);
  const {RecommendationWorker}=require('../../src/infrastructure/workers/recommendation_worker');
  const worker=new RecommendationWorker({getDiagnostics:()=>null});
  try{
    const progress=[];
    const result=await worker.run('recommendNormalFleet',store,{area:'1-3',fleet:1,questCodes:['2610B1','2610B5']},event=>progress.push(event));
    assert(result.recommendations.length,result.reason);
    assert(result.recommendations.every(row=>satisfiesQuests(store,row.scheme,quests)));
    assert(progress.some(event=>event.stage==='prepare'));assert(progress.some(event=>event.stage==='finalize'));
  }finally{await worker.dispose();}
});

test('impossible task choices return no unrelated fallback fleet',()=>{
  const store=storeWithShips();
  const result=recommendNormalFleet(store,{area:'1-3',fleet:1,questCodes:['2610B1','2610B5'],excludedShipIds:[4,5]});
  assert.deepEqual(result.recommendations,[]);assert.match(result.reason,/任务/);
});

test('application verification rejects a fleet that fails a selected quest',()=>{
  const store=storeWithShips(),{verifyConstraints}=require('../../src/application/page_queries');
  const result={recommendations:[{scheme:{fleet:1,ships:[{id:2}]}}]};
  assert.throws(()=>verifyConstraints(result,{questCodes:['2610B1']},false,store),/未能确认满足/);
});

test('expedition recommendations preserve selected task constraints',()=>{
  const store=storeWithShips(),quests=questRequirements(['D1','Dd1']);
  const result=recommendExpeditionFleet(store,{missionId:1,fleet:2,goal:'success',questCodes:['D1','Dd1']});
  assert(result.recommendations.length,result.reason);
  assert(result.recommendations.every(row=>satisfiesQuests(store,row.scheme,quests)));
});
