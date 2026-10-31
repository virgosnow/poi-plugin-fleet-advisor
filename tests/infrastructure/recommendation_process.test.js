'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createRecommendationProcess,RecommendationProcessHost}=require('../../src/host/recommendation_process');
const {RecommendationWorker}=require('../../src/infrastructure/workers/recommendation_worker');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({autoExit=true,startupMs=1000,stopMs=1000}={}){
  const owner=new EventEmitter(),app=new EventEmitter(),children=[];owner.isDestroyed=()=>false;
  const electron={app,webContents:{fromId:()=>owner},utilityProcess:{fork(file,args,options){
    assert(file.endsWith('recommendation_process_entry.js'));assert.equal(options.serviceName,'Fleet Advisor recommendations');
    const child=new EventEmitter();child.pid=100+children.length;child.sent=[];child.kills=0;
    child.postMessage=value=>child.sent.push(value);
    child.kill=()=>{child.kills++;if(autoExit)setImmediate(()=>child.emit('exit',0));return true;};
    children.push(child);return child;
  }}};
  const createWorker=(_file,options)=>createRecommendationProcess(options,1,{electron,startupMs,stopMs});
  return {owner,app,children,createWorker,options:{electron,startupMs,stopMs}};
}
test('utility handshake sends exactly one snapshot, reaps before results/maintenance, and releases ownership',async()=>{
  const f=fixture({autoExit:false}),runner=new RecommendationWorker({createWorker:f.createWorker});
  let resultDelivered=false,maintained=false;
  const result=runner.run('recommendNormalFleet',{immutable:true},{area:'4-5'}).then(r=>{resultDelivered=true;return r;});
  const maintenance=runner.maintain(()=>{maintained=true;});await tick();
  const child=f.children[0];assert.equal(child.sent.length,0);
  child.emit('message',{ready:true});child.emit('message',{ready:true});assert.equal(child.sent.length,1);
  assert.equal(child.sent[0].store.immutable,true);
  child.emit('message',{ok:true,result:{ships:[1,2]}});await tick();
  assert.equal(child.kills,1);assert(!resultDelivered);assert(!maintained);
  child.emit('exit',0);assert.deepEqual(await result,{ships:[1,2]});await maintenance;
  assert.equal(f.owner.eventNames().length,0);assert.equal(f.app.eventNames().length,0);await runner.dispose();
});
test('progress messages reach the caller without finishing or reaping the running process',async()=>{
  const f=fixture(),runner=new RecommendationWorker({createWorker:f.createWorker}),progress=[];
  const result=runner.run('recommendNormalFleet',{},{},event=>progress.push(event));await tick();
  const child=f.children[0];child.emit('message',{ready:true});
  child.emit('message',{progress:{stage:'gear',completed:2,total:4}});
  assert.deepEqual(progress,[{stage:'gear',completed:2,total:4}]);assert.equal(child.kills,0);
  child.emit('message',{ok:true,result:42});assert.equal(await result,42);await runner.dispose();
});
test('cancel drains the process, rejects old queued searches and permits a fresh search',async()=>{
  const f=fixture(),runner=new RecommendationWorker({createWorker:f.createWorker});
  const first=runner.run('recommendNormalFleet',{},{}),second=runner.run('recommendNormalFleet',{},{});
  const outcomes=Promise.allSettled([first,second]);await tick();await runner.cancel();
  for(const row of await outcomes)assert.equal(row.reason.code,'RECOMMENDATION_CANCELLED');
  const third=runner.run('recommendNormalFleet',{},{});await tick();assert.equal(f.children.length,2);
  f.children[1].emit('message',{ok:true,result:42});assert.equal(await third,42);await runner.dispose();
});
test('abrupt exit, serialized error and startup timeout recover on the next request',async()=>{
  const f=fixture({startupMs:20}),runner=new RecommendationWorker({createWorker:f.createWorker});
  let pending=runner.run('recommendNormalFleet',{},{}),rejected=assert.rejects(pending,/提前退出/);
  await tick();f.children[0].emit('exit',9);await rejected;
  pending=runner.run('recommendNormalFleet',{},{});rejected=assert.rejects(pending,{code:'BAD_ROUTE',message:'bad route'});
  await tick();f.children[1].emit('message',{ok:false,error:{message:'bad route',code:'BAD_ROUTE'}});await rejected;
  await assert.rejects(runner.run('recommendNormalFleet',{},{}),{code:'RECOMMENDATION_PROCESS_START_TIMEOUT'});
  pending=runner.run('recommendNormalFleet',{},{});await tick();f.children[3].emit('message',{ok:true,result:5});
  assert.equal(await pending,5);await runner.dispose();
});
test('owner reload/crash/close and app quit kill their own utility process without renderer callbacks',async()=>{
  for(const event of ['destroyed','render-process-gone','did-start-navigation','before-quit']){
    const f=fixture(),handle=f.createWorker('',{workerData:{}});
    if(event==='before-quit')f.app.emit(event);else f.owner.emit(event,{},'about:blank',false,true);
    await handle.terminate();assert(f.children[0].kills>=1);assert.equal(f.owner.eventNames().length,0);
  }
});
test('failed process reclamation blocks later work instead of overlapping cache writers',async()=>{
  const f=fixture({autoExit:false,stopMs:20}),runner=new RecommendationWorker({createWorker:f.createWorker});
  const result=runner.run('recommendNormalFleet',{},{}),rejected=assert.rejects(result,{code:'RECOMMENDATION_PROCESS_STOP_TIMEOUT'});
  await tick();f.children[0].emit('message',{ok:true,result:1});await rejected;
  assert(f.children[0].kills>=2);await assert.rejects(runner.run('recommendNormalFleet',{},{}));
  f.children[0].emit('exit',0);await runner.dispose();
});
test('dispose during asynchronous logging still cancels the in-flight result and queued requests',async()=>{
  const f=fixture();let release,logging;
  const entered=new Promise(resolve=>{logging=resolve;});
  const runner=new RecommendationWorker({createWorker:f.createWorker,getDiagnostics:()=>({level:'stages'}),
    onProfile:()=>{logging();return new Promise(resolve=>{release=resolve;});}});
  const results=Promise.allSettled([runner.run('recommendNormalFleet',{},{}),runner.run('recommendNormalFleet',{}, {})]);
  await tick();f.children[0].emit('message',{ok:true,result:1,profile:{workerMs:0}});await entered;
  const disposing=runner.dispose();release();await disposing;
  for(const row of await results)assert.equal(row.reason.code,'RECOMMENDATION_CANCELLED');
  assert.equal(f.children.length,1);
});
test('cancellation cannot hide a failed kill or allow unload before confirmed exit',async()=>{
  const f=fixture({autoExit:false,stopMs:20}),runner=new RecommendationWorker({createWorker:f.createWorker});
  const result=runner.run('recommendNormalFleet',{},{}),rejected=assert.rejects(result,{code:'RECOMMENDATION_PROCESS_STOP_TIMEOUT'});
  await tick();await assert.rejects(runner.cancel(),{code:'RECOMMENDATION_PROCESS_STOP_TIMEOUT'});await rejected;
  await assert.rejects(runner.dispose(),{code:'RECOMMENDATION_PROCESS_STOP_TIMEOUT'});
  f.children[0].emit('exit',0);await runner.dispose();
});
test('prewarm is snapshot-free, shared by tabs and claimed only after result listeners attach',async()=>{
  const f=fixture(),host=new RecommendationProcessHost(1,f.options);
  const first=host.prewarm(),second=host.prewarm();assert.equal(f.children.length,1);
  const child=f.children[0];child.emit('message',{ready:true});await Promise.all([first,second]);
  assert.equal(child.sent.length,0,'preparing code must never receive a snapshot or task');
  const handle=host.create({workerData:{store:{immutable:true}}});assert.equal(f.children.length,1);
  assert.equal(child.sent.length,0,'claiming must not race remote listener registration');
  handle.start();handle.start();assert.equal(child.sent.length,1);assert(child.sent[0].prewarmed);
  assert.equal(child.sent[0].store.immutable,true);await handle.terminate();await host.dispose();
});
test('a click during preload waits for readiness, and a used process never becomes an idle spare',async()=>{
  const f=fixture(),host=new RecommendationProcessHost(1,f.options),warming=host.prewarm();
  const handle=host.create({workerData:{store:{}}});handle.start();assert.equal(f.children[0].sent.length,0);
  f.children[0].emit('message',{ready:true});await warming;assert.equal(f.children[0].sent.length,1);
  assert.equal(f.children[0].sent[0].prewarmed,false);await handle.terminate();
  const next=host.prewarm();assert.equal(f.children.length,2);f.children[1].emit('message',{ready:true});await next;
  assert.equal(f.children[1].sent.length,0);await host.dispose();
});
test('idle timeout releases one unused process without restarting or running search',async()=>{
  const f=fixture(),host=new RecommendationProcessHost(1,{...f.options,idleMs:10});
  const preparing=host.prewarm();f.children[0].emit('message',{ready:true});await preparing;
  await new Promise(resolve=>setTimeout(resolve,30));assert(f.children[0].kills);assert.equal(host.idle,null);
  assert.equal(f.children.length,1);assert.equal(f.children[0].sent.length,0);await host.dispose();
});
test('failed warmup and leaving before ready release the spare, then a later click can calculate cold',async()=>{
  const f=fixture(),host=new RecommendationProcessHost(1,f.options),preparing=host.prewarm();
  f.children[0].emit('exit',9);assert.equal(await preparing,false);
  const next=host.prewarm();await host.release();assert.equal(await next,false);
  const handle=host.create({workerData:{}});handle.start();f.children[2].emit('message',{ready:true});
  assert.equal(f.children[2].sent.length,1);await handle.terminate();await host.dispose();
});
test('deferred immediate results are not lost, and warmup resumes only after draining the work queue',async()=>{
  let prepared=0,released=0;
  const runner=new RecommendationWorker({prepareWorker:()=>prepared++,releaseWorker:()=>released++,createWorker:()=>{
    const worker=new EventEmitter();worker.start=()=>worker.emit('message',{ok:true,result:42});
    worker.terminate=async()=>{worker.emit('exit',0);};return worker;
  }});
  await runner.setWarmEnabled(true);await tick();assert.equal(prepared,1);
  const results=await Promise.all([runner.run('recommendNormalFleet',{},{}),runner.run('recommendNormalFleet',{}, {})]);
  await tick();assert.deepEqual(results,[42,42]);assert.equal(prepared,2,'only one new empty spare after both requests');
  await runner.setWarmEnabled(false);assert.equal(released,1);await runner.dispose();await tick();assert.equal(prepared,2);
});
test('deferred transport startup errors still reap before rejecting',async()=>{
  let stopped=false;
  const runner=new RecommendationWorker({createWorker:()=>Object.assign(new EventEmitter(),{
    start(){throw Error('cannot send snapshot');},terminate:async()=>{stopped=true;}})});
  await assert.rejects(runner.run('recommendNormalFleet',{},{}),/cannot send snapshot/);assert(stopped);await runner.dispose();
});

test('main reaping observations preserve kill failures, exceptions and exit while leaving strategy unchanged',async()=>{
  for(const failure of ['false','throw']){
    const f=fixture({autoExit:false}),handle=f.createWorker('',{workerData:{diagnostics:{level:'stages'}}}),child=f.children[0];
    child.kill=()=>{child.kills++;if(failure==='throw')throw Object.assign(Error('PRIVATE_TEST'),{code:'EPERM'});return false;};
    child.emit('message',{ok:true,result:1});const stopping=handle.terminate();
    assert.equal(child.kills,1);child.emit('exit',0);assert.equal(await stopping,0);
    const d=JSON.parse(handle.getReapingDiagnostics());assert(d.events.some(x=>x.event==='exitNotified'));
    assert(d.events.some(x=>x.event===(failure==='throw'?'killThrew':'killReturned')));
    assert(!JSON.stringify(d).includes('PRIVATE_TEST'));
  }
  const f=fixture(),handle=f.createWorker('',{workerData:{}});await handle.terminate();assert.equal(handle.getReapingDiagnostics(),undefined);
});

test('renderer reports detail only for abnormal reaping and captures failures without a worker profile',async()=>{
  for(const abnormal of [false,true]){
    const runner=new RecommendationWorker({getDiagnostics:()=>({level:'stages'}),createWorker:()=>Object.assign(new EventEmitter(),{
      start(){this.emit('message',{ok:true,result:42,profile:{workerMs:1,status:'success'}});},terminate:async()=>0,
      getReapingDiagnostics:()=>({events:[{event:'killReturned',at:Date.now(),ok:!abnormal}]})})});
    assert.equal(await runner.run('recommendNormalFleet',{},{}),42);assert.equal(!!runner.lastProfile.reaping,abnormal);await runner.dispose();
  }
  let failed=true;
  const runner=new RecommendationWorker({getDiagnostics:()=>({level:'stages'}),createWorker:()=>Object.assign(new EventEmitter(),{
    start(){this.emit('error',Error('failed'));},terminate:async()=>{if(failed)throw Object.assign(Error('PRIVATE_TEST'),{code:'RECOMMENDATION_PROCESS_STOP_TIMEOUT'});},
    getReapingDiagnostics:()=>undefined})});
  await assert.rejects(runner.run('recommendNormalFleet',{},{}),{code:'RECOMMENDATION_PROCESS_STOP_TIMEOUT'});
  assert(runner.lastProfile.reaping.reasons.includes('termination-error'));assert.equal(runner.lastProfile.status,'error');
  assert(!JSON.stringify(runner.lastProfile).includes('PRIVATE_TEST'));failed=false;await runner.dispose();
});
