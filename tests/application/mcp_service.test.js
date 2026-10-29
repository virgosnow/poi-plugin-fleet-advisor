'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const {Snapshots}=require('../../src/application/snapshots');
const {FleetAdvisorService}=require('../../src/application/fleet_advisor_service');
const {McpHttpServer}=require('../../src/bridge/http_server');
const {Controller}=require('../../src/application/controller');

function state(){
  const equips={101:{api_slotitem_id:1,api_level:0,api_alv:0}};
  for(let id=102;id<=1302;id++)equips[id]={api_slotitem_id:id===102?2:1,api_level:0,api_alv:0};
  return {info:{basic:{api_member_id:'test'},ships:{1:{api_id:1,api_ship_id:1,api_lv:30,api_slot:[101,-1],api_slot_ex:0,
    api_onslot:[0,0],api_cond:49}},equips,fleets:[{api_ship:[1,-1],api_mission:[0]}],repairs:[],airbase:[]},
    const:{$ships:{1:{api_name:'翔鶴',api_stype:7,api_slot_num:2}},
      $equips:{1:{api_name:'主砲',api_type:[0,0,1,1]},2:{api_name:'発煙装置(煙幕)',api_type:[0,0,1,1]}},
      $shipTypes:{7:{api_equip_type:{1:1}}},$exslotEquips:[],$exslotEquipShips:{},$exslotEquipLimits:{}}};
}
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'paa-mcp-test-'));
const clean=dir=>{if(!path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('unsafe test cleanup');fs.rmSync(dir,{recursive:true,force:true});};

test('equipment queries allow borrowing from repair docks without making repairing hulls available',()=>{
  const store=state();
  store.info.ships[2]={...store.info.ships[1],api_id:2,api_slot:[102,-1],api_slot_ex:103,api_situation:2};
  store.info.repairs=[{api_ship_id:2}];
  const snapshots=new Snapshots(()=>store);
  let snapshotId=snapshots.create().snapshotId;
  const query=()=>snapshots.queryEquipment({snapshotId,targetShipId:1,slot:0,location:'ship',availableOnly:true,limit:100});
  for(const id of [102,103]){
    const item=query().items.find(item=>item.instanceId===id);
    assert(item?.sourceAvailable);assert(item.equipable);assert.equal(item.sourceShipId,2);
  }
  store.info.fleets.push({api_ship:[2],api_mission:[1]});snapshotId=snapshots.create().snapshotId;
  assert(!query().items.some(item=>[102,103].includes(item.instanceId)),'expedition overrides repair lending');
});

test('execution timeout diagnostics survive the service job record without changing the thrown error',async()=>{
  const dir=temp(),{observationTimeout}=require('../../src/execution/observation_diagnostics');
  const failure=observationTimeout('batch',{checks:[{kind:'equipmode'}]},
    {elapsedMs:6000,attempts:4,stableFrames:1,captureMs:50,observeMs:100,last:{valid:false,results:[{valid:false,mode:null}]}});
  const controller={preview(){return {pinned:{org:{ships:[{id:1}]}}};},run:async()=>{throw failure;},dispose(){},stop(){}};
  const service=new FleetAdvisorService({controller,getStore:state,storageDir:dir});
  try{
    service.setExperimentalSettings({automaticOperations:true});
    await assert.rejects(service.run('fleet',{fleet:1,ships:[1]}),e=>e===failure);
    const job=[...service.jobs.values()].at(-1),saved=service.getJob({jobId:job.jobId});
    assert.equal(saved.state,'failed');assert.equal(saved.verified,false);
    assert.deepEqual(saved.error.diagnostics,failure.diagnostics);
    assert.equal(service.activeJobId,null);
  }finally{await service.dispose();clean(dir);}
});

test('immutable snapshots page all equipment without duplication and match simplified characters',()=>{
  const data=state(),snapshots=new Snapshots(()=>data),created=snapshots.create();
  assert.equal(created.equipmentCount,1202);
  data.info.equips[1303]={api_slotitem_id:1};
  let cursor,items=[];
  do{
    const result=snapshots.queryEquipment({snapshotId:created.snapshotId,limit:100,cursor});
    items.push(...result.items);cursor=result.nextCursor;
  }while(cursor);
  assert.equal(items.length,1202);assert.equal(new Set(items.map(x=>x.instanceId)).size,1202);
  assert.equal(snapshots.queryEquipment({snapshotId:created.snapshotId,name:'发烟装置'}).items[0].instanceId,102);
  assert.equal(snapshots.queryShips({snapshotId:created.snapshotId,name:'翔鹤'}).items[0].instanceId,1);
  assert.equal(items.find(x=>x.instanceId===101).sourceShipId,1);
  const page=snapshots.queryEquipment({snapshotId:created.snapshotId,limit:10});
  assert.throws(()=>snapshots.queryEquipment({snapshotId:created.snapshotId,name:'发烟装置',cursor:page.nextCursor}),/游标/);
});

test('MCP evaluation exposes candidate metrics and rejects invalid numeric conditions',async()=>{
  const dir=temp();
  try{
    const service=new FleetAdvisorService({controller:new Controller({getStore:state}),getStore:state,storageDir:dir});
    const snapshot=service.createSnapshot(),args={snapshotId:snapshot.snapshotId,scheme:{fleet:1,ships:[{id:1}]}};
    const result=service.evaluateFleet(args);
    assert.equal(result.valid,true);
    assert.equal(result.metrics.airPower.min,0);
    assert.equal(result.metrics.lineOfSight.status,'unknown');
    assert(result.supportedChecks.includes('openingASW'));
    assert.deepEqual(result.unsupportedChecks,['route']);
    assert.throws(()=>service.evaluateFleet({...args,conditions:{enemyAirPower:-1}}),e=>e.code==='INVALID_QUERY');
    await service.dispose();
  }finally{clean(dir);}
});

test('fixed preview rejects drift, execution is idempotent and concurrent jobs are excluded',async()=>{
  const dir=temp();
  try{
    const data=state();let runs=0,finish;
    const controller={running:false,preview(_kind,scheme){return {fleet:scheme.fleet,pinned:{org:{ships:[{id:1}]},eq:{ships:[]}},
      equipment:{expected:[],donors:[],steps:[]},changed:0,done:true};},
      run(){runs++;this.running=true;return new Promise(resolve=>{finish=()=>{this.running=false;resolve({ok:true,done:true,changed:0});};});},
      stop(){},dispose(){}};
    const service=new FleetAdvisorService({controller,getStore:()=>data,storageDir:dir});
    const snapshot=service.createSnapshot(),preview=service.previewFleet({snapshotId:snapshot.snapshotId,scheme:{fleet:1,ships:[{id:1}]}});
    assert.deepEqual(preview.pinnedScheme,{fleet:1,ships:[{id:1}]});
    assert.throws(()=>service.executePlan({planId:preview.planId,idempotencyKey:'first'}),e=>e.code==='PERMISSION_DENIED');
    service.setMcpEnabled(true);
    service.setExperimentalSettings({automaticOperations:true});
    const accepted=service.executePlan({planId:preview.planId,idempotencyKey:'first'});
    assert.equal(accepted.state,'accepted');
    assert.equal(service.executePlan({planId:preview.planId,idempotencyKey:'first'}).jobId,accepted.jobId);
    assert.throws(()=>service.executePlan({planId:preview.planId,idempotencyKey:'other'}),e=>e.code==='BUSY');
    await new Promise(resolve=>setImmediate(resolve));assert.equal(runs,1);
    finish();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(service.getJob({jobId:accepted.jobId}).state,'succeeded');
    assert.equal(service.getJob({jobId:accepted.jobId}).verified,true);
    assert.equal(service.executePlan({planId:preview.planId,idempotencyKey:'first'}).duplicate,true);
    data.info.ships[1].api_lv++;
    assert.throws(()=>service.previewFleet({snapshotId:snapshot.snapshotId,scheme:{fleet:1,ships:[{id:1}]}}),e=>e.code==='STATE_CHANGED');
    await service.dispose();
  }finally{clean(dir);}
});

test('real unified planner keeps exact equipment IDs when MCP executes a preview',async()=>{
  const dir=temp();
  try{
    const data=state(),controller=new Controller({getStore:()=>data});let received;
    controller.run=async(_kind,scheme)=>{received=scheme;return {ok:true,done:true,changed:1};};
    const service=new FleetAdvisorService({controller,getStore:()=>data,storageDir:dir});
    const snapshot=service.createSnapshot();
    const plan=service.previewFleet({snapshotId:snapshot.snapshotId,scheme:{fleet:1,ships:[{name:'翔鹤',slots:[101,102]}]}});
    assert.deepEqual(plan.pinnedScheme.ships[0].slots,[101,102]);
    assert.equal(plan.pinnedScheme.ships[0].id,1);
    service.setMcpEnabled(true);
    service.setExperimentalSettings({automaticOperations:true});
    const accepted=service.executePlan({planId:plan.planId,idempotencyKey:'fixed-equipment'});
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(received,plan.pinnedScheme);
    assert.equal(service.getJob({jobId:accepted.jobId}).state,'succeeded');
    await service.dispose();
  }finally{clean(dir);}
});

test('cancel stops only the active job and restart marks unfinished work interrupted',async()=>{
  const dir=temp();
  try{
    const data=state();let rejectRun,stops=0;
    const controller={running:false,preview(_kind,scheme){return {fleet:scheme.fleet,
      pinned:{org:{ships:[{id:1}]},eq:{ships:[]}},equipment:{expected:[],donors:[],steps:[]},changed:1,done:false};},
      run(){this.running=true;return new Promise((_,reject)=>{rejectRun=reject;});},
      stop(){stops++;this.running=false;rejectRun?.(Error('Run stopped'));},dispose(){}};
    const service=new FleetAdvisorService({controller,getStore:()=>data,storageDir:dir});
    const snapshot=service.createSnapshot(),plan=service.previewFleet({snapshotId:snapshot.snapshotId,scheme:{fleet:1,ships:[{id:1}]}});
    service.setMcpEnabled(true);
    service.setExperimentalSettings({automaticOperations:true});
    const accepted=service.executePlan({planId:plan.planId,idempotencyKey:'cancel-me'});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(service.cancelJob({jobId:accepted.jobId}).state,'stopping');
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(stops,1);assert.equal(service.getJob({jobId:accepted.jobId}).state,'cancelled');
    await service.dispose();
    const file=path.join(dir,'mcp-state.json'),saved=JSON.parse(fs.readFileSync(file,'utf8'));
    saved.jobs[0].state='running';fs.writeFileSync(file,JSON.stringify(saved));
    const resumed=new FleetAdvisorService({controller,getStore:()=>data,storageDir:dir});
    assert.equal(resumed.getJob({jobId:accepted.jobId}).state,'interrupted');
    assert.equal(resumed.getJob({jobId:accepted.jobId}).verified,false);
    assert.equal(resumed.mcpEnabled,true);
    await resumed.dispose();
  }finally{clean(dir);}
});

test('persistence failure disables MCP enablement without breaking panel execution',async()=>{
  const dir=temp();
  try{
    const data=state();let runs=0;
    const controller={running:false,preview:()=>({pinned:{org:{ships:[{id:1}]}}}),
      run:async()=>{runs++;return {ok:true,done:true,changed:0};},stop(){},dispose(){}};
    const service=new FleetAdvisorService({controller,getStore:()=>data,storageDir:dir});
    service.setExperimentalSettings({automaticOperations:true});
    service.persist=()=>{throw Error('disk unavailable');};
    assert.throws(()=>service.setMcpEnabled(true),e=>e.code==='PERSISTENCE_UNAVAILABLE');
    assert.equal(service.getStatus().mcpEnabled,false);
    const result=await service.run('fleet',{fleet:1,ships:[{id:1}]});
    assert.equal(result.ok,true);
    assert.equal(runs,1);
    assert.equal(service.getStatus().bridgeError,'disk unavailable');
    await service.dispose();
  }finally{clean(dir);}
});

const {TOOL_DEFS,PROTOCOL_VERSION}=require('../../src/bridge/mcp_tools');
const {DEFAULT_HTTP_PORT}=require('../../src/bridge/http_server');
test('HTTP-only MCP accepts URL-only clients, rejects origins and serves the shared catalog',async t=>{
  const dir=temp(),sid='11111111-1111-4111-8111-111111111111';
  const service={getStatus:()=>({dataReady:true}),getContract:()=>({version:'1'}),
    queryShips:()=>({snapshotId:sid,total:50,items:Array.from({length:50},(_,i)=>({instanceId:i+1,name:'测试'.repeat(150)})),nextCursor:null})};
  const bridge=new McpHttpServer(service,{httpPort:0});
  t.after(async()=>{await bridge.close();clean(dir);});await bridge.start();
  const post=async(payload,headers={},path='/mcp')=>{
    const response=await fetch(`http://127.0.0.1:${bridge.httpPort}${path}`,{method:'POST',headers:{
      'content-type':'application/json',...headers},
      body:typeof payload==='string'?payload:JSON.stringify(payload)});
    const text=await response.text();return {status:response.status,headers:response.headers,body:text?JSON.parse(text):null};
  };
  const ping={jsonrpc:'2.0',id:1,method:'ping'};
  assert.equal((await post(ping)).status,200);
  assert.equal(bridge.server.address().address,'127.0.0.1');
  // fetch/undici normalizes Host; use the native request API to send an
  // actual mismatched header and verify the server, rather than the client.
  const wrongHost=await new Promise((resolve,reject)=>{
    const request=require('node:http').request(bridge.httpAddress,{method:'POST',headers:{host:'evil.example','content-type':'application/json'}},response=>{
      response.resume();response.on('end',()=>resolve(response.statusCode));
    });request.on('error',reject);request.end(JSON.stringify(ping));
  });
  assert.equal(wrongHost,403);
  assert.equal((await post(ping,{origin:'http://evil.example'})).status,403);
  assert.equal((await post(ping,{origin:''})).status,403);
  assert.equal((await post(ping,{},'/v1/tool')).status,404);
  assert.equal((await post(ping,{'content-type':'text/plain'})).status,415);
  assert.equal((await post(ping,{'mcp-protocol-version':'2099-01-01'})).status,400);
  const init=await post({jsonrpc:'2.0',id:2,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'test',version:'1'}}});
  assert.equal(init.body.result.protocolVersion,'2025-03-26');
  const latest=await post({jsonrpc:'2.0',id:3,method:'initialize',params:{protocolVersion:'unknown'}});
  assert.equal(latest.body.result.protocolVersion,PROTOCOL_VERSION);
  assert.equal((await post({jsonrpc:'2.0',method:'notifications/initialized'})).status,202);
  const catalog=(await post({jsonrpc:'2.0',id:4,method:'tools/list'})).body.result.tools;
  assert.deepEqual(catalog.map(t=>t.name),TOOL_DEFS.map(t=>t.name));
  assert(catalog.every(t=>t.name.startsWith('fleet_advisor_')));
  const call=async(name,args={})=>(await post({jsonrpc:'2.0',id:5,method:'tools/call',params:{name,arguments:args}})).body;
  assert.deepEqual((await call('fleet_advisor_get_status')).result.structuredContent,{dataReady:true});
  const large=(await call('fleet_advisor_query_ships',{snapshotId:sid})).result;
  assert.equal(large.structuredContent.items.length,50);assert.match(large.content[0].text,/structuredContent/);
  assert.equal((await call('fleet_advisor_query_ships',{snapshotId:sid,typo:true})).result.structuredContent.error.code,'INVALID_QUERY');
  assert.equal((await call('assistant_get_status')).error.code,-32602);
  assert.equal((await post('{bad json')).body.error.code,-32700);
  assert.equal((await post([ping])).status,400);
  assert.equal((await post({id:2,method:'ping'})).status,400);
  const get=await fetch(bridge.httpAddress);assert.equal(get.status,405);
  assert(!require('fs').existsSync(require('path').join(__dirname,'../../mcp/package.json')),'no stdio adapter shipped');
});

test('HTTP port collision fails explicitly; rebinding uses only the configured address',async t=>{
  const dir=temp(),net=require('node:net'),squatter=net.createServer();
  const data=state(),service=new FleetAdvisorService({controller:new Controller({getStore:()=>data}),getStore:()=>data,storageDir:dir});
  t.after(async()=>{await service.dispose();await new Promise(r=>squatter.close(()=>r()));clean(dir);});
  await new Promise(r=>squatter.listen(0,'127.0.0.1',r));service.httpPort=squatter.address().port;
  await assert.rejects(()=>service.startMcpServer(),e=>e.code==='EADDRINUSE');
  assert.equal(service.bridge,null);assert.match(service.getStatus().mcpHttp.error,/已被占用/);
  await new Promise(r=>squatter.close(()=>r()));
  await service.startMcpServer();
  const rebound=await service.setHttpPort(DEFAULT_HTTP_PORT+125);
  assert(rebound.active);
  const response=await fetch(rebound.address,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method:'ping'})});
  assert.deepEqual((await response.json()).result,{});
  assert.throws(()=>service.setHttpPort(99999),/端口必须是/);
});

test('http port is editable while MCP is off: persists without raising the bridge',async()=>{
  const dir=temp();
  try{
    const data=state();
    const svc=new FleetAdvisorService({controller:new Controller({getStore:()=>data}),getStore:()=>data,storageDir:dir});
    assert.equal(svc.getStatus().mcpEnabled,false);
    const applied=await svc.setHttpPort(47714);
    assert.deepEqual(applied,{port:null,wanted:47714,address:null,active:false,error:null});
    assert.equal(svc.bridge,null,'no bridge raised while disabled');
    const persisted=JSON.parse(fs.readFileSync(path.join(dir,'mcp-state.json'),'utf8'));
    assert.equal(persisted.httpPort,47714);
    assert.equal(persisted.mcpEnabled,false);
    await svc.dispose();
  }finally{clean(dir);}
});

test('query_ships sorts with stable ties, projects fields and binds cursors to sort+fields',()=>{
  const data=state();
  // instance 1 (lv30) comes from the fixture; add ties, a low level and a
  // missing api_lv (null sorts last under either direction).
  data.info.ships[2]={api_id:2,api_ship_id:1,api_lv:99,api_slot:[-1,-1],api_slot_ex:0,api_onslot:[0,0],api_cond:40};
  data.info.ships[3]={api_id:3,api_ship_id:1,api_slot:[-1,-1],api_slot_ex:0,api_onslot:[0,0]};
  data.info.ships[4]={api_id:4,api_ship_id:1,api_lv:99,api_slot:[-1,-1],api_slot_ex:0,api_onslot:[0,0],api_cond:80};
  const snapshots=new Snapshots(()=>data),created=snapshots.create();
  const top=snapshots.queryShips({snapshotId:created.snapshotId,sort:'level',order:'desc',limit:2,fields:['level','condition']});
  assert.deepEqual(top.items.map(x=>x.instanceId),[2,4]); // 99-tie broken by instanceId asc
  assert.deepEqual(Object.keys(top.items[0]),['instanceId','name','level','condition']);
  const ascending=snapshots.queryShips({snapshotId:created.snapshotId,sort:'level',order:'asc',fields:['level']});
  assert.deepEqual(ascending.items.map(x=>x.instanceId),[1,2,4,3]); // 30, then the 99 pair, null level last
  assert.equal(ascending.items.find(x=>x.instanceId===3).level,null);
  // absent field projects to null instead of disappearing
  assert.equal(snapshots.queryEquipment({snapshotId:created.snapshotId,limit:1,fields:['equipable']}).items[0].equipable,null);
  assert.throws(()=>snapshots.queryShips({snapshotId:created.snapshotId,sort:'speedX'}),e=>e.code==='INVALID_QUERY');
  assert.throws(()=>snapshots.queryShips({snapshotId:created.snapshotId,order:'up'}),/order/);
  assert.throws(()=>snapshots.queryShips({snapshotId:created.snapshotId,fields:['nope']}),/未知字段/);
  const plain=snapshots.queryShips({snapshotId:created.snapshotId,limit:1});
  assert.throws(()=>snapshots.queryShips({snapshotId:created.snapshotId,sort:'level',cursor:plain.nextCursor}),/游标/);
  assert.throws(()=>snapshots.queryShips({snapshotId:created.snapshotId,fields:['level'],cursor:plain.nextCursor}),/游标/);
});

test('query_equipment sorts by improvement and projects only requested fields',()=>{
  const data=state();
  data.info.equips[101].api_level=10;data.info.equips[102].api_level=5;
  const snapshots=new Snapshots(()=>data),created=snapshots.create();
  const top=snapshots.queryEquipment({snapshotId:created.snapshotId,sort:'improvement',order:'desc',limit:2,fields:['improvement','sourceShipId']});
  assert.deepEqual(top.items.map(x=>x.instanceId),[101,102]);
  assert.deepEqual(top.items.map(x=>x.improvement),[10,5]);
  assert.deepEqual(Object.keys(top.items[0]),['instanceId','name','improvement','sourceShipId']);
  assert.equal(top.items.find(x=>x.instanceId===101).sourceShipId,1);
  assert.throws(()=>snapshots.queryEquipment({snapshotId:created.snapshotId,sort:'power'}),e=>e.code==='INVALID_QUERY');
});

test('snapshots live 15 minutes and sliding renewal keeps slow paging alive',()=>{
  let clock=0;
  const snapshots=new Snapshots(state,()=>clock),created=snapshots.create();
  clock=10*60*1000; // 10 min: past nothing yet, but a fixed 5-min TTL would be gone
  snapshots.queryShips({snapshotId:created.snapshotId,limit:1});
  clock=20*60*1000; // original 15-min window would have expired; renewal keeps it
  assert.doesNotThrow(()=>snapshots.get(created.snapshotId));
  clock=36*60*1000; // 16 min without access: genuinely expired
  assert.throws(()=>snapshots.get(created.snapshotId),e=>e.code==='SNAPSHOT_EXPIRED');
});

test('scheme store round-trips save/query/delete with persistence and corruption fail-safety',async()=>{
  const dir=temp();
  const make=()=>new FleetAdvisorService({controller:new Controller({getStore:()=>data}),getStore:()=>data,storageDir:dir});
  let data,service;
  try{
    data=state();service=make();
    const saved=await service.saveScheme({name:'daily',scheme:{fleet:1,ships:[{name:'翔鹤',slots:[101,102]}]}});
    assert.equal(saved.overwritten,false);assert.deepEqual(saved.warnings,[]);
    await assert.rejects(()=>service.saveScheme({name:'daily',scheme:{fleet:2,ships:[1]}}),e=>e.code==='SCHEME_NAME_EXISTS');
    assert.equal((await service.saveScheme({name:'daily',scheme:{fleet:2,ships:[1]},overwrite:true})).overwritten,true);
    for(const [name,bad] of [['fleet',{fleet:5,ships:[1]}],['empty',{fleet:1,ships:[]}],
      ['slot',{fleet:1,ships:[{id:1,slots:[0]}]}],['unknown',{fleet:1,ships:[1],extra:1}],
      ['ex',{fleet:1,ships:[{id:1,ex:{name:'x',star:11}}]}]])
      await assert.rejects(()=>service.saveScheme({name,scheme:bad}),e=>e.code==='INVALID_SCHEME',name);
    const one=service.querySchemes({name:'daily'});
    assert.equal(one.total,1);assert.equal(one.items[0].scheme.fleet,2);
    assert.equal(service.querySchemes({name:'nope'}).total,0);
    // semantic validation warns but still saves (schemes may target a future roster)
    const warned=await service.saveScheme({name:'future',scheme:{fleet:1,ships:[{name:'不存在的舰娘'}]},
      validateWithSnapshotId:service.createSnapshot().snapshotId});
    assert.equal(warned.warnings.length,1);
    const removed=await service.deleteScheme({name:'daily'});
    assert.equal(removed.deleted,true);assert.equal(removed.scheme.fleet,2);
    await assert.rejects(()=>service.deleteScheme({name:'daily'}),e=>e.code==='SCHEME_NOT_FOUND');
    await service.dispose();
    // restart: the store survives (and stays separate from mcp-state.json)
    const revived=make();
    assert.equal(revived.querySchemes({name:'future'}).total,1);
    assert.equal(revived.querySchemes().total,1);
    await revived.dispose();
    // corrupt file: original preserved as .corrupt-*, empty store keeps serving
    fs.writeFileSync(path.join(dir,'schemes.json'),'{broken');
    const third=make();
    assert.equal(third.querySchemes().total,0);
    assert.match(third.getStatus().schemes.error,/损坏/);
    assert.equal(fs.readdirSync(dir).filter(f=>f.startsWith('schemes.json.corrupt-')).length,1);
    await third.saveScheme({name:'after-corrupt',scheme:{fleet:1,ships:[1]}});
    assert.equal(third.querySchemes().total,1);
    await third.dispose();
  }finally{clean(dir);}
});

test('preview and evaluate accept schemeName as an exclusive scheme source',async()=>{
  const dir=temp();
  try{
    const data=state();
    const service=new FleetAdvisorService({controller:new Controller({getStore:()=>data}),getStore:()=>data,storageDir:dir});
    const snapshot=service.createSnapshot();
    await service.saveScheme({name:'ref',scheme:{fleet:1,ships:[{id:1}]}});
    assert.equal(service.evaluateFleet({snapshotId:snapshot.snapshotId,schemeName:'ref'}).valid,true);
    assert.throws(()=>service.evaluateFleet({snapshotId:snapshot.snapshotId}),e=>e.code==='INVALID_QUERY');
    assert.throws(()=>service.evaluateFleet({snapshotId:snapshot.snapshotId,scheme:{fleet:1,ships:[1]},schemeName:'ref'}),e=>e.code==='INVALID_QUERY');
    assert.throws(()=>service.evaluateFleet({snapshotId:snapshot.snapshotId,schemeName:'missing'}),e=>e.code==='SCHEME_NOT_FOUND');
    assert.deepEqual(service.previewFleet({snapshotId:snapshot.snapshotId,schemeName:'ref'}).pinnedScheme,{fleet:1,ships:[{id:1}]});
    assert.throws(()=>service.previewFleet({snapshotId:snapshot.snapshotId,schemeName:'missing'}),e=>e.code==='SCHEME_NOT_FOUND');
    await service.dispose();
  }finally{clean(dir);}
});
