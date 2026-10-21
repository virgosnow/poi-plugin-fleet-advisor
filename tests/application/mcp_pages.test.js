'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const fixture=require('../helpers/workbench_fixture');
const {FleetAdvisorService}=require('../../src/application/fleet_advisor_service');
const {Controller}=require('../../src/application/controller');
const {fingerprint}=require('../../src/application/snapshots');
const F=require('../../src/ui/fleet/current_fleet_model');
const W=require('../../src/ui/workbench/workbench_model');
const {METHODS,invokeTool}=require('../../src/bridge/service_api');
const {TOOL_DEFS}=require('../../src/bridge/mcp_tools');
function store(){
  const s=fixture();
  for(const ship of Object.values(s.info.ships))Object.assign(ship,{api_nowhp:20,api_maxhp:20,api_locked:1,api_lucky:[20,50]});
  for(const type of [1,2,3])s.const.$shipTypes[type]={api_equip_type:{1:1}};
  s.const.$equips[1]={api_id:1,api_name:'12cm単装砲',api_type:[0,0,1,1],api_houg:1};
  for(let id=101;id<=114;id++)s.info.equips[id]={api_id:id,api_slotitem_id:1,api_level:id===114?4:0,api_alv:0};
  s.info.ships[1].api_slot=[101,102];s.info.fleets[0].api_ship=[1,2,3,4,5];
  s.info.fleets[1].api_ship=[6,7];s.info.fleets[2].api_mission=[1,1,Date.now()+60000];
  s.info.presets={api_max_num:2,api_deck:{1:{api_name:'水雷预设',api_ship:[1,2,3]}}};
  s.info.maps={11:{api_id:11,api_cleared:1},73:{api_id:73,api_gauge_num:2,api_required_defeat_count:4,api_defeat_count:1}};
  s.const.$maps={73:{api_id:73}};
  s.const.$missions[1]={...s.const.$missions[1],api_name:'练习航海',api_time:15,api_disp_no:'01'};
  s.expeditionProgress={records:{1:{state:2}},period:'test'};
  return s;
}
function service(t,data=store()){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-advisor-api-'));
  const s=new FleetAdvisorService({controller:new Controller({getStore:()=>data}),getStore:()=>data,storageDir:dir});
  t.after(async()=>{await s.dispose();assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
  return s;
}
test('current fleets/presets expose the same observed mechanisms and preserve immutable snapshot state',t=>{
  const data=store(),s=service(t,data),snapshotId=s.createSnapshot().snapshotId,args={snapshotId};
  const snap=s.snapshots.get(snapshotId).store,before=JSON.stringify(snap);
  assert.equal(s.queryFleets(args).items.length,4);
  assert.equal(s.queryFleets(args).items[2].state,'away');
  assert.deepEqual(s.queryFleetPresets(args).items,F.presetList(data).items);
  const actual=s.queryFleetStatus({...args,fleet:1}),page=F.inspect(snap,1);
  assert.deepEqual(actual.metrics,page.metrics);assert.deepEqual(actual.ships[0].badges,page.ships[0].badges);
  assert.deepEqual(actual.scheme,W.scheme(page.heading.ids.map(id=>W.entry(snap,id)),1));
  assert(actual.ships[0].badges.some(b=>b.key==='speed'));
  assert(actual.ships[0].badges.some(b=>b.key==='expedition-morale'));
  assert.equal(actual.ships[0].equipment[0].masterId,1);
  assert(!JSON.stringify(actual).includes('file:///'));
  assert.equal(s.queryFleetStatus({...args,presetId:1}).source,'preset');
  data.info.presets.api_deck[1].api_ship=[8];
  assert.deepEqual(s.queryFleetPresets(args).items[0].ids,[1,2,3]);
  assert.equal(JSON.stringify(snap),before);
  const candidate=s.queryFleetStatus({...args,scheme:{fleet:2,ships:[{id:2,slots:[103,-1]}]}});
  assert.deepEqual(candidate.ships.map(x=>x.id),[2]);assert.equal(candidate.ships[0].equipment[0].id,103);
  assert.equal(JSON.stringify(snap),before);
  assert.throws(()=>s.queryFleetStatus({...args,presetId:1,scheme:{fleet:2,ships:[2]}}),e=>e.code==='INVALID_QUERY');
  assert.equal(s.queryFleetStatus({...args,presetId:999}).heading.exists,false);
});
test('display-only preset/progress changes do not invalidate execution but equipment changes do',t=>{
  const data=store(),s=service(t,data),snap=s.createSnapshot(),before=fingerprint(data);
  data.info.presets.api_deck[1].api_name='新的预设';data.info.maps[73].api_gauge_num=1;data.const.$maps[73].api_name='地图';
  data.expeditionProgress.records[1].state=0;
  assert.equal(fingerprint(data),before);
  assert(s.previewFleet({snapshotId:snap.snapshotId,scheme:{fleet:1,ships:[1]}}).planId);
  data.info.equips[101].api_level=1;assert.notEqual(fingerprint(data),before);
  assert.throws(()=>s.previewFleet({snapshotId:snap.snapshotId,scheme:{fleet:1,ships:[1]}}),e=>e.code==='STATE_CHANGED');
});
test('map and expedition query details mirror the pages; selected route metrics include aircraft-loss estimates',t=>{
  const data=store(),s=service(t,data),snapshotId=s.createSnapshot().snapshotId,args={snapshotId};
  const detail=s.queryNormalMap({...args,area:'1-2'}),selected=detail.routes[0];
  assert(selected.key);assert(detail.profile.mapPreview.nodes.length);
  const node=detail.profile.mapPreview.nodes.find(n=>n.id!=='start').id;
  const threat=s.queryNormalMap({...args,area:'1-2',nodeId:node}).threat;
  assert.equal(threat.title,node+' 点 · 主要威胁');
  const report=s.evaluateNormalRoute({...args,area:'1-2',routeKey:selected.key,fleet:1});
  assert.equal(report.selectedRoute.key,selected.key);assert(report.planning.chance);
  assert(report.fleetSummary.air.estimate);assert(report.fleetSummary.los);
  assert.deepEqual(s.queryNormalMap({...args,area:'7-3'}).progress,W.mapProgress(data,'7-3'));
  assert.equal(s.queryNormalMap({...args,area:'7-3'}).phase,'gauge2');
  const catalog=s.listExpeditions({...args,missionId:1});assert.equal(catalog.missions.length,1);
  assert.equal(catalog.missions[0].minutes,15);assert.equal(catalog.missions[0].completion,'completed');
  assert(catalog.missions[0].rewards.length);
  const proposed={fleet:2,ships:[{id:6,slots:[103,-1]},{id:7,slots:[-1,-1]}]};
  const evaluation=s.evaluateExpedition({...args,missionId:1,scheme:proposed});
  assert.equal(evaluation.ships.length,2);assert(evaluation.greatSuccess);assert(evaluation.income);
  assert(evaluation.income.rows.some(r=>r.cost>0&&r.net===r.success-r.cost));
  assert.throws(()=>s.queryNormalMap({...args,area:'../bad'}),e=>e.code==='INVALID_QUERY');
  assert.throws(()=>s.queryNormalMap({...args,area:'1-2',routeKey:'missing'}),e=>e.code==='INVALID_QUERY');
  assert.throws(()=>s.queryNormalMap({...args,area:'1-2',nodeId:'INVALID'}),e=>e.code==='INVALID_QUERY');
});
test('equipment replacements group equivalent instances, reserve other candidate equipment and highlight current',t=>{
  const s=service(t),snapshotId=s.createSnapshot().snapshotId;
  const rows=s.queryEquipmentOptions({snapshotId,shipId:1,slot:0});
  assert.equal(rows.items.length,2);assert(rows.items.find(i=>i.current).id===101);
  assert.equal(rows.items.find(i=>i.improvement===4)?.count,1);
  const candidate={fleet:1,ships:[{id:1,slots:[101,102]},{id:2,slots:[103,104]}]};
  const filtered=s.queryEquipmentOptions({snapshotId,shipId:1,slot:0,scheme:candidate});
  assert.equal(filtered.items.reduce((n,r)=>n+r.count,0),11);
  assert.throws(()=>s.queryEquipmentOptions({snapshotId,shipId:1,slot:4}),e=>e.code==='INVALID_QUERY');
});
test('HTTP tool validation and catalog reject old names, unknown arguments and conflicting scheme sources',()=>{
  assert.deepEqual(new Set(TOOL_DEFS.map(t=>t.name)),new Set(Object.keys(METHODS)));
  const sid='11111111-1111-4111-8111-111111111111';let calls=0;
  const mock={evaluateFleet:()=>{calls++;},recommendNormalFleet:args=>args};
  assert.throws(()=>invokeTool(mock,'fleet_advisor_evaluate_fleet',{snapshotId:sid,scheme:{fleet:1,ships:[1]},schemeName:'x'}),e=>e.code==='INVALID_QUERY');
  assert.throws(()=>invokeTool(mock,'fleet_advisor_evaluate_fleet',{snapshotId:sid}),e=>e.code==='INVALID_QUERY');assert.equal(calls,0);
  assert.throws(()=>invokeTool(mock,'fleet_advisor_recommend_normal_fleet',{snapshotId:sid,area:'1-2',heldSlots:[{id:1,pin:true,keep:{x:true}}]}),e=>e.code==='INVALID_QUERY');
  const defaults=invokeTool(mock,'fleet_advisor_recommend_normal_fleet',{snapshotId:sid,area:'1-2'});
  assert.equal(defaults.byRoute,true);assert.equal(defaults.airGoal,'superiority');
});
test('manual ship/equipment locks are validated and equipment recommendations preserve hulls and slot locks',async t=>{
  const data=store(),s=service(t,data),snapshotId=s.createSnapshot().snapshotId,args={snapshotId};
  const route=s.queryNormalMap({...args,area:'1-2'}).routes[0];
  const scheme={fleet:1,ships:[1,2,3,4,5].map(id=>({id,slots:[-1,-1]}))};
  const heldSlots=[{id:1,pin:true,keep:{'0':true},slots:[101,null],ex:null}];
  const normal=await s.recommendNormalEquipment({...args,area:'1-2',routeKey:route.key,scheme,heldSlots});
  assert.deepEqual(normal.scheme.ships.map(s=>s.id),[1,2,3,4,5]);assert.equal(normal.scheme.ships[0].slots[0],101);
  const expedition=await s.recommendExpeditionEquipment({...args,missionId:1,goal:'success',scheme:{fleet:2,ships:[6,7]},heldSlots:[{id:6,pin:true,slots:[103],keep:{'0':true}}]});
  assert.deepEqual(expedition.scheme.ships.map(s=>s.id),[6,7]);assert.equal(expedition.scheme.ships[0].slots[0],103);
  for(const held of [[{id:999,pin:true}],[{id:1,pin:true},{id:1,pin:true}],[{id:1,slots:[101],keep:{'4':true}}],
    [{id:1,pin:true,slots:[101],keep:{'0':true}},{id:2,pin:true,slots:[101],keep:{'0':true}}]]){
    await assert.rejects(()=>s.recommendNormalEquipment({...args,area:'1-2',scheme,heldSlots:held}),e=>e.code==='INVALID_QUERY');
  }
  await assert.rejects(()=>s.recommendNormalFleet({...args,area:'1-2',heldSlots:[{id:1,pin:true}],excludedShipIds:[1]}),e=>e.code==='INVALID_QUERY');
});
test('MCP selected-route fleet search matches the page algorithm and honors held positions',async t=>{
  const data=store(),s=service(t,data),snapshotId=s.createSnapshot().snapshotId;
  s.setRecommendationFilters({normal:{excludeUnremodeled:false}});
  const route=s.queryNormalMap({snapshotId,area:'1-2'}).routes[0],heldSlots=[{id:1,pin:true,slots:[],keep:{}}];
  const input={snapshotId,area:'1-2',routeKey:route.key,heldSlots};
  const result=await invokeTool(s,'fleet_advisor_recommend_normal_fleet',input);
  const snapshot=s.snapshots.get(snapshotId).store,filters=s.getRecommendationFilters().normal;
  const expected=require('../../src/recommendation/index').recommendNormalFleet(snapshot,{...input,byRoute:true,airGoal:'superiority',fixedShipIds:[1],automaticFilters:filters});
  assert(result.recommendations.length);assert.equal(result.routeResults.length,1);
  assert.deepEqual(result.recommendations.map(r=>r.scheme),expected.recommendations.map(r=>r.scheme));
  assert(result.recommendations.every(r=>r.routeKey===route.key&&r.scheme.ships[0].id===1));
});
test('five normal equipment slots and page-style unpinned draft rows remain supported',async t=>{
  const data=store();data.const.$ships[1].api_slot_num=5;data.const.$ships[1].api_maxeq=[0,0,0,0,0];
  data.info.ships[1].api_slot=[102,103,104,105,101];data.info.ships[1].api_onslot=[0,0,0,0,0];
  const s=service(t,data),snapshotId=s.createSnapshot().snapshotId;
  assert((await invokeTool(s,'fleet_advisor_query_equipment_options',{snapshotId,shipId:1,slot:4})).items.some(i=>i.current));
  const slots=[1,2,3,4,5].map(id=>W.entry(data,id));slots[0].keep={'0':true,'1':true,'2':true,'3':true,'4':true};
  const result=await invokeTool(s,'fleet_advisor_recommend_normal_equipment',{snapshotId,area:'1-2',scheme:W.scheme(slots,1),heldSlots:slots});
  assert.equal(result.scheme.ships[0].slots[4],101);assert.equal(result.scheme.ships[0].slots.length,5);
  assert.deepEqual(result.scheme.ships.map(s=>s.id),[1,2,3,4,5]);
});
test('HTTP access needs only its URL and never generates or persists access credentials',async t=>{
  const data=store(),s=service(t,data);s.httpPort=0;s.setMcpEnabled(true);await s.startMcpServer();
  const connection=s.getStatus().mcpHttp;
  const ping=()=>fetch(connection.address,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'ping'})});
  assert.equal((await ping()).status,200);
  const absent=object=>assert(!/mcpAccessToken|accessToken|authorization|Bearer/i.test(JSON.stringify(object)));
  absent(s.getStatus());absent(s.createSnapshot());absent(JSON.parse(fs.readFileSync(s.stateFile,'utf8')));
  assert.equal(typeof s.setMcpAccessToken,'undefined');assert.equal(typeof s.regenerateMcpAccessToken,'undefined');
  await s.resetRecommendationSettings();assert.equal((await ping()).status,200);
  s.httpPort=47615;s.persist();await s.dispose();
  const restarted=new FleetAdvisorService({controller:new Controller({getStore:()=>data}),getStore:()=>data,storageDir:s.storageDir});
  t.after(()=>restarted.dispose());absent(JSON.parse(fs.readFileSync(s.stateFile,'utf8')));
});
test('closest reference fleets receive the same fixed-hull and equipment verification as valid recommendations',()=>{
  const {verifyConstraints}=require('../../src/application/page_queries'),row={scheme:{fleet:2,ships:[{id:2,slots:[-1],ex:-1}]}};
  assert.throws(()=>verifyConstraints({recommendations:[],closestRecommendation:row},{fixedShipIds:[1]}),/fixed hull/);
  assert.throws(()=>verifyConstraints({goals:{great:{closestRecommendation:row}}},{heldSlots:[{id:2,slots:[99],keep:{0:true}}]}),/equipment slot/);
  assert.doesNotThrow(()=>verifyConstraints({closestRecommendation:row},{fixedShipIds:[2]}));
});

test('all 26 MCP tools have a reproducible complete Markdown parameter reference',()=>{
  const generator=require('../../tools/dev/generate-mcp-reference');
  const doc=fs.readFileSync(path.join(__dirname,'../../docs/MCP_API.md'),'utf8');
  assert.equal(doc.slice(doc.indexOf(generator.marker)),generator.reference());
  assert.equal(TOOL_DEFS.length,26);
  for(const tool of TOOL_DEFS)assert(doc.includes('\n#### `'+tool.name+'`\n'));
});
test('two independent HTTP clients query/recommend/refit and share one mock execution lock',async t=>{
  const data=store(),s=service(t,data);s.httpPort=0;s.setMcpEnabled(true);await s.startMcpServer();
  s.setRecommendationFilters({normal:{excludeUnremodeled:false}});
  const {address}=s.getStatus().mcpHttp;
  const client=()=>{
    let id=0;
    const rpc=async(method,params={})=>{
      const response=await fetch(address,{method:'POST',headers:{
        'content-type':'application/json','mcp-protocol-version':'2026-07-28'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
      assert.equal(response.status,200);const body=await response.json();assert(!body.error,JSON.stringify(body.error));return body.result;
    };
    return {rpc,tool:async(suffix,args={})=>{
      const result=await rpc('tools/call',{name:'fleet_advisor_'+suffix,arguments:args});
      assert(!result.isError,JSON.stringify(result.structuredContent));return result.structuredContent;
    }};
  };
  const a=client(),b=client();
  for(const c of [a,b])await c.rpc('initialize',{protocolVersion:'2026-07-28',capabilities:{},clientInfo:{name:'offline-test',version:'1'}});
  assert.equal((await a.rpc('tools/list')).tools.length,26);
  const resource=(await b.rpc('resources/list')).resources[0];
  assert.equal(JSON.parse((await b.rpc('resources/read',{uri:resource.uri})).contents[0].text).version,'2');
  const {snapshotId}=await a.tool('create_snapshot'),args={snapshotId};
  assert.equal((await b.tool('query_fleets',args)).items.length,4);
  assert((await b.tool('query_fleet_presets',args)).synced);
  assert.equal((await b.tool('query_fleet_status',{...args,presetId:1})).ships.length,3);
  assert((await a.tool('query_equipment_options',{...args,shipId:1,slot:0})).items.length);
  const selected=(await b.tool('query_normal_map',{...args,area:'1-2'})).routes[0];
  const recommendation=await a.tool('recommend_normal_fleet',{...args,area:'1-2',routeKey:selected.key,heldSlots:[{id:1,pin:true}]});
  assert(recommendation.recommendations.length);
  const scheme=recommendation.recommendations[0].scheme;
  const fitted=await b.tool('recommend_normal_equipment',{...args,scheme,area:'1-2',routeKey:selected.key});
  assert(fitted.evaluation.fleetSummary.air.estimate);
  assert.deepEqual(fitted.scheme.ships.map(s=>s.id),scheme.ships.map(s=>s.id));
  assert((await b.tool('evaluate_normal_route',{...args,scheme:fitted.scheme,area:'1-2',routeKey:selected.key})).planning);
  const exped=await a.tool('recommend_expedition_fleet',{...args,missionId:1});
  assert(exped.goals.success);assert(exped.goals.great);
  const expeditionScheme=exped.recommendations[0].scheme;
  assert((await b.tool('recommend_expedition_equipment',{...args,missionId:1,scheme:expeditionScheme})).income);
  assert((await b.tool('evaluate_expedition',{...args,missionId:1,scheme:expeditionScheme})).greatSuccess);
  await s.setComputationSettings({schemeCache:false});
  assert.equal((await a.tool('get_status')).schemes.enabled,false);
  const disabled=await b.rpc('tools/call',{name:'fleet_advisor_save_scheme',arguments:{name:'协议回归',scheme:fitted.scheme}});
  assert.equal(disabled.isError,true);assert.equal(disabled.structuredContent.error.code,'SCHEME_CACHE_DISABLED');
  assert.equal(disabled.structuredContent.error.retryable,false);assert(disabled.structuredContent.error.nextAction.includes('inline'));
  await s.setComputationSettings({schemeCache:true});
  await a.tool('save_scheme',{name:'协议回归',scheme:fitted.scheme});
  assert.equal((await b.tool('query_schemes',{name:'协议回归'})).total,1);
  assert((await b.tool('evaluate_fleet',{...args,schemeName:'协议回归'})).valid);
  const plan=await b.tool('preview_fleet',{...args,schemeName:'协议回归'});
  // Offline execution substitute: no host, image observer, game RPC or mouse.
  let runs=0,finish;
  s.controller.run=()=>{runs++;return new Promise(resolve=>{finish=()=>resolve({ok:true,done:true,changed:0});});};
  s.controller.stop=()=>{};
  const accepted=await a.tool('execute_plan',{planId:plan.planId,idempotencyKey:'offline-http-operation'});
  assert.equal((await b.tool('execute_plan',{planId:plan.planId,idempotencyKey:'offline-http-operation'})).jobId,accepted.jobId);
  const conflict=await b.rpc('tools/call',{name:'fleet_advisor_execute_plan',arguments:{planId:plan.planId,idempotencyKey:'another-operation'}});
  assert.equal(conflict.structuredContent.error.code,'BUSY');assert.equal(runs,1);
  assert.equal((await b.tool('get_job',{idempotencyKey:'offline-http-operation'})).state,'running');
  assert.equal((await b.tool('cancel_job',{jobId:accepted.jobId})).state,'stopping');
  finish();await new Promise(resolve=>setImmediate(resolve));
  assert((await a.tool('get_job',{jobId:accepted.jobId})).verified);
  assert((await a.tool('delete_scheme',{name:'协议回归'})).deleted);
});
