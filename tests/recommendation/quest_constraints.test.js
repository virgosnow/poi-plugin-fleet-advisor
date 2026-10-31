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
