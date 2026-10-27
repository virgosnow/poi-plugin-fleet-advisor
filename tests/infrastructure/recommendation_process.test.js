'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createRecommendationProcess}=require('../../src/host/recommendation_process');
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
  return {owner,app,children,createWorker};
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
