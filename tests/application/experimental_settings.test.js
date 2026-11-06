'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const settings=require('../../src/config/experimental_settings');
const {FleetAdvisorService}=require('../../src/application/fleet_advisor_service');
const {Controller}=require('../../src/application/controller');
const {handleMcpPost}=require('../../src/bridge/mcp_http');
const fixture=require('../helpers/workbench_fixture');
function setup(t,saved){
  const storageDir=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-advisor-experimental-')),data=fixture();
  if(saved)fs.writeFileSync(path.join(storageDir,'mcp-state.json'),JSON.stringify(saved));
  const planner=new Controller({getStore:()=>data}),calls={run:0,stop:0};
  const controller={running:false,preview:(...args)=>planner.preview(...args),
    run:async()=>{calls.run++;return {ok:true,done:true,changed:0};},stop:()=>calls.stop++,dispose(){}};
  const service=new FleetAdvisorService({storageDir,getStore:()=>data,controller});
  t.after(async()=>{await service.dispose();
    if(!path.resolve(storageDir).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe test cleanup');
    fs.rmSync(storageDir,{recursive:true,force:true});});
  return {service,controller,calls,data,storageDir};
}
const disabled=e=>e.code==='AUTOMATIC_OPERATIONS_DISABLED';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('visible recommendation tabs share snapshot-free warmup and current-fleet/settings release it',async t=>{
  const {service:s,data}=setup(t),before=JSON.stringify(data);await s.cacheReady;
  let prepared=0,released=0;s.recommendations.prepareWorker=()=>prepared++;s.recommendations.releaseWorker=()=>released++;
  s.recommendations.createWorker=()=>assert.fail('prewarm must not calculate or copy a snapshot');
  s.setRecommendationPageActive('normal',true);await tick();assert.equal(prepared,1);
  s.setRecommendationPageActive('normal',false);s.setRecommendationPageActive('expedition',true);await tick();
  assert.equal(released,0,'peer-tab switch must not discard the prepared process');
  s.setRecommendationPageActive('expedition',false);await tick();assert.equal(released,1);
  s.setRecommendationPageActive('manual',true);await tick();assert.equal(prepared,2);
  assert.equal(JSON.stringify(data),before);
});
test('experimental normalization defaults off, including older settings and malformed boolean values',()=>{
  for(const value of [undefined,null,{},[],{automaticOperations:'true'},{automaticOperations:1}])assert.deepEqual(settings.normalize(value),{automaticOperations:false,performanceDebug:false,operationWaitMs:0,recognitionMode:'controls'});
  assert.deepEqual(settings.normalize({automaticOperations:true}),{automaticOperations:true,performanceDebug:false,operationWaitMs:0,recognitionMode:'controls'});
  assert.equal(settings.normalize({recognitionMode:'image'}).recognitionMode,'image','retain an explicit image-only choice');
  for(const value of [null,[],{automaticOperations:'true'},{unknown:true}])assert.throws(()=>settings.validate(value));
});
test('automatic operations default off while MCP remains read-only',async t=>{
  const {service:s,calls,data}=setup(t,{mcpEnabled:true,jobs:[]}),before=JSON.stringify(data);
  const {snapshotId}=s.createSnapshot();assert(s.queryFleets({snapshotId}).items.length);
  assert(s.evaluateFleet({snapshotId,scheme:{fleet:2,ships:[1,2]}}).valid);
  await assert.rejects(s.run('fleet',{fleet:2,ships:[1,2]}),disabled);
  const response=await handleMcpPost(s,JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'fleet_advisor_execute_plan',arguments:{}}}));
  assert.equal(JSON.parse(response.body).error.code,-32602);assert.equal(s.getStatus().capabilities.execute,false);
  assert.equal(calls.run,0);assert.equal(s.jobs.size,0);assert.equal(JSON.stringify(data),before);
});
test('explicit permission enables panel operations without enabling MCP execution',async t=>{
  const {service:s,calls,storageDir}=setup(t);s.setExperimentalSettings({automaticOperations:true});
  assert.equal(s.getStatus().capabilities.execute,false);await s.run('fleet',{fleet:2,ships:[1,2]});assert.equal(calls.run,1);
  s.setMcpEnabled(true);await s.resetRecommendationSettings();assert.equal(s.getExperimentalSettings().automaticOperations,true);
  const reopened=new FleetAdvisorService({storageDir,getStore:s.getStore,controller:{dispose(){}}});
  try{assert.equal(reopened.getExperimentalSettings().automaticOperations,true);}finally{await reopened.dispose();}
  s.setExperimentalSettings({automaticOperations:false});await assert.rejects(s.run('fleet',{fleet:2,ships:[1,2]}),disabled);
});
test('MCP execution and cancellation are unavailable even when panel operations are enabled',async t=>{
 const {service:s}=setup(t);s.setMcpEnabled(true);s.setExperimentalSettings({automaticOperations:true});
 for(const name of ['fleet_advisor_execute_plan','fleet_advisor_cancel_job']){
   const response=await handleMcpPost(s,JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{}}}));
   assert.equal(JSON.parse(response.body).error.code,-32602);
 }
});
test('revoking permission during an active run requests cancellation and preserves its stop/status controls',async t=>{
  const {service:s,controller,calls}=setup(t);let rejectRun;
  controller.run=()=>{calls.run++;controller.running=true;return new Promise((_,reject)=>{rejectRun=reject;});};
  controller.stop=()=>{calls.stop++;controller.running=false;rejectRun(Error('Run stopped'));};
  s.setExperimentalSettings({automaticOperations:true});
  const running=s.run('fleet',{fleet:2,ships:[1,2]}),rejected=assert.rejects(running,/Run stopped/),id=s.activeJobId;
  s.setExperimentalSettings({automaticOperations:false});await rejected;
  assert.equal(calls.stop,1);assert.equal(s.getJob({jobId:id}).state,'cancelled');assert.equal(s.activeJobId,null);
});
test('failed setting writes roll back permission, and malformed saved data never enables automation',async t=>{
  const {service:s}=setup(t);s.setExperimentalSettings({automaticOperations:true});
  s.persist=()=>{throw Error('disk read only');};
  assert.throws(()=>s.setExperimentalSettings({automaticOperations:false}),e=>e.code==='PERSISTENCE_UNAVAILABLE');
  assert.equal(s.getExperimentalSettings().automaticOperations,true);
  assert.throws(()=>s.setExperimentalSettings({automaticOperations:'false'}),e=>e.code==='INVALID_QUERY');
  const malformed=setup(t,{experimentalSettings:{automaticOperations:true},jobs:{invalid:true}}).service;
  assert.equal(malformed.getExperimentalSettings().automaticOperations,false);assert.equal(malformed.mcpEnabled,false);
});

test('performance debug persists independently, writes safe local logs and can be cleared without changing drafts or game state',async t=>{
  const {service:s,data}=setup(t),before=JSON.stringify(data),args={fleet:1,area:'1-1',};
  await s.recommendations.run('recommendNormalFleet',data,args);
  assert.equal((await s.getComputationStatus()).cache.logs.files,0);
  s.setExperimentalSettings({performanceDebug:true});assert.equal(s.getExperimentalSettings().automaticOperations,false);
  assert.equal(JSON.parse(fs.readFileSync(s.stateFile)).experimentalSettings.performanceDebug,true);
  await s.recommendations.run('recommendNormalFleet',data,{...args,airGoal:'superiority'});
  let status=await s.getComputationStatus();assert.equal(status.cache.logs.files,1);assert(status.cache.logs.bytes>0);
  const file=fs.readdirSync(s.performanceLogs.directory).find(n=>n.endsWith('.json'));
  const log=JSON.parse(fs.readFileSync(path.join(s.performanceLogs.directory,file)));assert.equal(log.profile.level,'modules');assert(log.profile.spans.length);
  s.setExperimentalSettings({performanceDebug:false});await s.recommendations.run('recommendNormalFleet',data,args);
  assert.equal((await s.getComputationStatus()).cache.logs.files,1,'disabling logging preserves old reports');
  s.setExperimentalSettings({performanceDebug:true});
  await s.clearRecommendationCache('logs');assert.equal((await s.getComputationStatus()).cache.logs.files,0);
  assert(s.getExperimentalSettings().performanceDebug,'clearing files does not change the switch');
  s.setExperimentalSettings({performanceDebug:false});await s.recommendations.run('recommendNormalFleet',data,args);
  assert.equal((await s.getComputationStatus()).cache.logs.files,0);assert.equal(JSON.stringify(data),before);
  const loaded=setup(t,{experimentalSettings:{performanceDebug:true}}).service;assert(loaded.getExperimentalSettings().performanceDebug);
});

test('workbench timing is disabled by default and logs only allowed phase names and milliseconds',async t=>{
  const {service:s}=setup(t);await s.cacheReady;
  const records=[{name:'route.base',ms:15,ship:'private'},{name:'private-name',ms:22},{name:'workbench.search',ms:4}];
  s.recordWorkbenchTiming(records);await s.performanceLogs.pending;
  assert.equal((await s.getComputationStatus()).cache.logs.files,0);
  s.setExperimentalSettings({performanceDebug:true});s.recordWorkbenchTiming(records);await s.performanceLogs.pending;
  const file=fs.readdirSync(s.performanceLogs.directory).find(n=>n.endsWith('.json'));
  const log=JSON.parse(fs.readFileSync(path.join(s.performanceLogs.directory,file)));
  assert.deepEqual(log.profile.stages,[{name:'route.base',ms:15},{name:'workbench.search',ms:4}]);
  assert(!JSON.stringify(log).includes('private'));
});

test('queued log clearing runs after a completed calculation has persisted its report',async t=>{
  const {service:s,data}=setup(t);s.setExperimentalSettings({performanceDebug:true});await s.cacheReady;
  const result=s.recommendations.run('recommendNormalFleet',data,{fleet:1,area:'1-1',});
  const clear=s.clearRecommendationCache('logs');await result;await clear;
  assert.equal((await s.getComputationStatus()).cache.logs.files,0,'no old report can reappear after clearing');
  s.performanceLogs.getLimitBytes=()=>1;
  await s.recommendations.run('recommendNormalFleet',data,{fleet:1,area:'1-1',});
  assert((await s.getComputationStatus()).cache.logs.writeError,'logging failure is visible without failing the recommendation');
});

test('three extra waits persist and reach panel execution without changing permissions',async t=>{
  const {service:s,controller,storageDir}=setup(t),options=[];
  controller.run=async(kind,scheme,settings)=>{options.push(settings);return {ok:true,done:true,changed:0};};
  assert.deepEqual(settings.OPERATION_WAITS,[0,300,800]);
  s.setExperimentalSettings({automaticOperations:true});
  for(const operationWaitMs of settings.OPERATION_WAITS){
    settings.validate({operationWaitMs});
    s.setExperimentalSettings({operationWaitMs});assert.equal(s.getExperimentalSettings().automaticOperations,true);
    assert.equal(JSON.parse(fs.readFileSync(s.stateFile)).experimentalSettings.operationWaitMs,operationWaitMs);
    await s.run('fleet',{fleet:2,ships:[1,2]});assert.deepEqual(options.at(-1),{operationWaitMs,recognitionMode:'controls'});
  }
  s.setExperimentalSettings({automaticOperations:false});
  const reopened=new FleetAdvisorService({storageDir,getStore:s.getStore,controller:{dispose(){}}});
  try{assert.equal(reopened.getExperimentalSettings().operationWaitMs,800);}finally{await reopened.dispose();}
  await s.resetRecommendationSettings();assert.equal(s.getExperimentalSettings().operationWaitMs,800);
  for(const value of [-1,1,299,500,801,Infinity,NaN,'300',null]){
    assert.throws(()=>settings.validate({operationWaitMs:value}));
    assert.equal(settings.normalize({operationWaitMs:value}).operationWaitMs,0);
  }
});

test('extra wait slider is a subordinate three-stop control with local feedback and disabled guards',()=>{
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()})};
  const Controls=require('../../src/ui/settings/experimental_settings')(React),patches=[];
  const find=(n,p)=>n&&typeof n==='object'&&(p(n)?n:n.children?.map(c=>find(c,p)).find(Boolean));
  for(const automaticOperations of [false,true])for(const disabled of [false,true]){
    const tree=Controls({value:settings.normalize({automaticOperations,operationWaitMs:300}),disabled,onChange:v=>patches.push(v),
      statuses:{operationWaitMs:{kind:'success',text:'已保存'}}});
    const row=find(tree,n=>n.props.className==='paa-settings-row paa-automatic-wait');
    assert(find(find(tree,n=>n.props.className==='paa-automatic-settings'),n=>n===row));
    const slider=find(row,n=>n.props.type==='range');assert.equal(slider.props.min,0);assert.equal(slider.props.max,2);assert.equal(slider.props.step,1);
    assert.equal(slider.props.value,1);assert.equal(slider.props.disabled,disabled||!automaticOperations);
    assert.equal(slider.props['aria-valuetext'],'每步额外等待 0.3 秒');assert(find(row,n=>n.props['data-state']==='success'));
    const before=patches.length;for(const value of ['0','1','2'])slider.props.onChange({target:{value}});
    assert.deepEqual(patches.slice(before),disabled||!automaticOperations?[]:[{operationWaitMs:0},{operationWaitMs:300},{operationWaitMs:800}]);
  }
});

test('recognition mode persists independently and panel execution uses the selected mode',async t=>{
  const {service:s,controller}=setup(t),seen=[];
  controller.run=async(kind,scheme,options)=>{seen.push(options.recognitionMode);return {ok:true,done:true,changed:0};};
  s.setExperimentalSettings({recognitionMode:'controls'});
  assert.equal(s.getExperimentalSettings().automaticOperations,false);
  assert.equal(JSON.parse(fs.readFileSync(s.stateFile)).experimentalSettings.recognitionMode,'controls');
  await assert.rejects(s.run('fleet',{fleet:2,ships:[1,2]}),disabled);
  s.setExperimentalSettings({automaticOperations:true});await s.run('fleet',{fleet:2,ships:[1,2]});
  assert.deepEqual(seen,['controls']);
  await s.resetRecommendationSettings();assert.equal(s.getExperimentalSettings().recognitionMode,'controls');
  for(const value of ['unknown',true,1,null])assert.throws(()=>settings.validate({recognitionMode:value}));
  assert.equal(settings.normalize({recognitionMode:'unknown'}).recognitionMode,'controls');
});

test('developer settings stay hidden while automatic operation and extra wait controls remain visible',()=>{
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()})};
  const Controls=require('../../src/ui/settings/experimental_settings')(React),find=(n,p)=>n&&typeof n==='object'&&(p(n)?n:n.children?.map(c=>find(c,p)).find(Boolean));
  for(const recognitionMode of ['controls','image'])for(const automaticOperations of [true,false])for(const disabled of [true,false]){
    const patches=[],tree=Controls({value:settings.normalize({automaticOperations,recognitionMode,performanceDebug:true}),disabled,onChange:p=>patches.push(p),statuses:{recognitionMode:{kind:'success',text:'已保存'},performanceDebug:{kind:'success',text:'已保存'}}});
    assert(!find(tree,n=>n.props.id==='paa-operation-recognition'||n.props.className==='paa-settings-row paa-automatic-mode'));
    assert(!JSON.stringify(tree).includes('识别方式'));assert(!find(tree,n=>n.type==='select'));
    assert(!find(tree,n=>n.props['aria-label']==='性能调试开关'||n.props['aria-label']==='性能调试说明'));
    assert(!JSON.stringify(tree).includes('性能调试'));
    assert(find(tree,n=>n.props['aria-label']==='自动操作开关'));assert(find(tree,n=>n.props.id==='paa-operation-wait'));
    assert.deepEqual(patches,[],'rendering must not reset the developer override');
  }
});
