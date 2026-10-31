'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/workbench_fixture');
const {context}=require('../../src/recommendation/context');
const {questRequirements,satisfiesQuests,questSeeds}=require('../../src/recommendation/quest_constraints');
const {recommendNormalFleet,recommendNormalFleetParallel,recommendExpeditionFleet}=require('../../src/recommendation');

function storeWithShips(){
  const store=fixture();
  for(const [id,name,type] of [[1,'鈴谷',7],[2,'村雨',2],[3,'夕立',2],[4,'朧',2],[5,'曙',2],[6,'樫',2],[7,'自由二',1],[8,'自由三',2]]){
    store.const.$ships[id].api_name=name;store.const.$ships[id].api_stype=type;
  }
  return store;
}

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
    const result=await worker.run('recommendNormalFleet',store,{area:'1-3',fleet:1,questCodes:['2610B1','2610B5']});
    assert(result.recommendations.length,result.reason);
    assert(result.recommendations.every(row=>satisfiesQuests(store,row.scheme,quests)));
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
