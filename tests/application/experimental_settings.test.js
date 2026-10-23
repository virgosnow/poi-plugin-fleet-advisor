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
  const preview=()=>service.previewFleet({snapshotId:service.createSnapshot().snapshotId,scheme:{fleet:2,ships:[1,2]}});
  return {service,controller,calls,data,storageDir,preview};
}
const disabled=e=>e.code==='AUTOMATIC_OPERATIONS_DISABLED';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('experimental normalization defaults off, including older settings and malformed boolean values',()=>{
  for(const value of [undefined,null,{},[],{automaticOperations:'true'},{automaticOperations:1}])assert.deepEqual(settings.normalize(value),{automaticOperations:false});
  assert.deepEqual(settings.normalize({automaticOperations:true}),{automaticOperations:true});
  for(const value of [null,[],{automaticOperations:'true'},{unknown:true}])assert.throws(()=>settings.validate(value));
});
test('new and migrated services prohibit panel/MCP execution while retaining read-only tools and preview',async t=>{
  const {service:s,calls,data,preview}=setup(t,{mcpEnabled:true,jobs:[]}),before=JSON.stringify(data);
  assert.deepEqual(s.getExperimentalSettings(),{automaticOperations:false});assert.equal(s.getStatus().capabilities.execute,false);
  const plan=preview();assert(plan.planId);assert(s.queryFleets({snapshotId:plan.snapshotId}).items.length);
  assert(s.evaluateFleet({snapshotId:plan.snapshotId,scheme:{fleet:2,ships:[1,2]}}).valid);
  await assert.rejects(s.run('fleet',{fleet:2,ships:[1,2]}),disabled);
  assert.throws(()=>s.executePlan({planId:plan.planId,idempotencyKey:'disabled'}),disabled);
  const response=await handleMcpPost(s,JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{
    name:'fleet_advisor_execute_plan',arguments:{planId:plan.planId,idempotencyKey:'http-disabled'}}}));
  const result=JSON.parse(response.body).result;
  assert.equal(result.isError,true);assert.equal(result.structuredContent.error.code,'AUTOMATIC_OPERATIONS_DISABLED');
  assert.equal(result.structuredContent.error.retryable,false);assert.match(result.structuredContent.error.nextAction,/Experimental/);
  assert.equal(calls.run,0);assert.equal(s.jobs.size,0);assert.equal(JSON.stringify(data),before);
});
test('explicit permission enables execution and persists independently from MCP and recommendation resets',async t=>{
  const {service:s,calls,preview,storageDir}=setup(t);
  s.setExperimentalSettings({automaticOperations:true});assert.equal(s.getStatus().capabilities.execute,true);
  assert.equal(JSON.parse(fs.readFileSync(s.stateFile)).experimentalSettings.automaticOperations,true);
  await s.run('fleet',{fleet:2,ships:[1,2]});assert.equal(calls.run,1);
  const plan=preview();assert.throws(()=>s.executePlan({planId:plan.planId,idempotencyKey:'mcp-off'}),e=>e.code==='PERMISSION_DENIED');
  s.setMcpEnabled(true);const job=s.executePlan({planId:plan.planId,idempotencyKey:'permitted'});await tick();
  assert.equal(calls.run,2);assert.equal(s.getJob({jobId:job.jobId}).state,'succeeded');
  assert.equal(s.executePlan({planId:plan.planId,idempotencyKey:'permitted'}).duplicate,true);assert.equal(calls.run,2);
  await s.resetRecommendationSettings();assert.equal(s.getExperimentalSettings().automaticOperations,true);
  const reopened=new FleetAdvisorService({storageDir,getStore:s.getStore,controller:{dispose(){}}});
  try{assert.equal(reopened.getExperimentalSettings().automaticOperations,true);}finally{await reopened.dispose();}
  s.setExperimentalSettings({automaticOperations:false});
  assert.throws(()=>s.executePlan({planId:plan.planId,idempotencyKey:'old-preview'}),disabled);
  assert.equal(s.mcpEnabled,true);assert.equal(s.getJob({jobId:job.jobId}).state,'succeeded');
});
test('turning off cancels an accepted MCP job before its queued callback can create game input',async t=>{
  const {service:s,calls,preview}=setup(t);s.setMcpEnabled(true);s.setExperimentalSettings({automaticOperations:true});
  const job=s.executePlan({planId:preview().planId,idempotencyKey:'queued'});
  s.setExperimentalSettings({automaticOperations:false});await tick();
  assert.equal(s.getJob({jobId:job.jobId}).state,'cancelled');assert.equal(calls.run,0);assert.equal(calls.stop,1);
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
