'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ReadScheduler}=require('../../src/infrastructure/sync/read_scheduler');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const step=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
  const log=[],gates=[],reader={
    async context(options){log.push(`context:${!!options.cached}`);return {ready:true,idle:true,compatible:true,sessionKey:'session'};},
    async read(options){log.push(`read:${options.kind||'quest'}:${options.enemyId||''}`);const gate=deferred();gates.push({gate,signal:options.signal});return gate.promise;},
    async readAll(options){log.push('all:page1');const gate=deferred();gates.push({gate,signal:options.signal});await gate.promise;log.push('all:page2');return {status:'ready',tasks:[]};},
    observeStart(){log.push('start');},observeRequest(){log.push('request');},observeResponse(){log.push('response');},observeFailure(){log.push('failure');}
  };
  return {reader,log,gates,scheduler:new ReadScheduler({reader,spacingMs:0})};
}
test('all readers and context probes are FIFO; pagination is one transaction',async()=>{
  const f=fixture(),a=f.scheduler.readAll({sessionKey:'a'}),b=f.scheduler.read({sessionKey:'a',kind:'practice'}),c=f.scheduler.context();
  await step();assert.deepEqual(f.log,['all:page1']);f.gates[0].gate.resolve();await a;await step();
  assert.deepEqual(f.log,['all:page1','all:page2','read:practice:']);f.gates[1].gate.resolve({list:1});
  assert.deepEqual(await b,{list:1});assert.equal((await c).ready,true);assert.deepEqual(f.log,['all:page1','all:page2','read:practice:','context:false']);
  await f.scheduler.dispose();
});
test('identical requests share one read while cancelling one consumer leaves the other intact',async()=>{
  const f=fixture(),abort=new AbortController();
  const a=f.scheduler.read({sessionKey:'a',kind:'practice',signal:abort.signal});
  const b=f.scheduler.read({sessionKey:'a',kind:'practice'});
  await step();assert.equal(f.gates.length,1);abort.abort();assert.deepEqual(await a,{deferred:true});
  assert.equal(f.gates[0].signal.aborted,false);f.gates[0].gate.resolve({list:1});assert.deepEqual(await b,{list:1});
  await f.scheduler.dispose();
});
test('an unbound MCP full-list request joins an automatic read for the same observed session',async()=>{
  const f=fixture();await f.scheduler.context({cached:true});
  const a=f.scheduler.readAll({sessionKey:'session'}),b=f.scheduler.readAll();await step();
  assert.equal(f.gates.length,1);f.gates[0].gate.resolve();
  assert.deepEqual(await a,{status:'ready',tasks:[]});assert.deepEqual(await b,{status:'ready',tasks:[]});
  assert.equal(f.log.filter(x=>x==='all:page1').length,1);await f.scheduler.dispose();
});
test('an unbound request obtains a session without exporting account credentials',async()=>{
  const f=fixture(),a=f.scheduler.readAll();await step();
  assert.deepEqual(f.log,['context:true','all:page1']);f.gates[0].gate.resolve();
  assert.equal((await a).status,'ready');await f.scheduler.dispose();
});
test('different accounts or enemies never coalesce',async()=>{
  const f=fixture(),a=f.scheduler.read({sessionKey:'a',kind:'practice-enemy',enemyId:10}),
    b=f.scheduler.read({sessionKey:'b',kind:'practice-enemy',enemyId:10}),c=f.scheduler.read({sessionKey:'b',kind:'practice-enemy',enemyId:11});
  await step();f.gates[0].gate.resolve('a');assert.equal(await a,'a');await step();
  f.gates[1].gate.resolve('b');assert.equal(await b,'b');await step();f.gates[2].gate.resolve('c');assert.equal(await c,'c');
  assert.deepEqual(f.log,['read:practice-enemy:10','read:practice-enemy:10','read:practice-enemy:11']);await f.scheduler.dispose();
});
test('cancelled last consumer aborts the operation but cannot release its lock until it settles',async()=>{
  const f=fixture(),abort=new AbortController(),a=f.scheduler.read({sessionKey:'a',signal:abort.signal});
  await step();abort.abort();assert.deepEqual(await a,{deferred:true});assert.equal(f.gates[0].signal.aborted,true);
  const b=f.scheduler.read({sessionKey:'a'});await step();assert.equal(f.gates.length,1);
  f.gates[0].gate.resolve({deferred:true});await step();assert.equal(f.gates.length,2);
  f.gates[1].gate.resolve({list:2});assert.deepEqual(await b,{list:2});await f.scheduler.dispose();
});
test('login reset cancels pending work and the old operation cannot overlap the new session',async()=>{
  const f=fixture(),a=f.scheduler.readAll({sessionKey:'a'}),b=f.scheduler.read({sessionKey:'a',kind:'practice'});
  await step();f.scheduler.observeStart();assert.deepEqual(await a,{status:'deferred'});assert.deepEqual(await b,{deferred:true});
  assert.equal(f.gates[0].signal.aborted,true);const c=f.scheduler.read({sessionKey:'b'});await step();assert.equal(f.gates.length,1);
  f.gates[0].gate.resolve();await step();assert.equal(f.gates.length,2);f.gates[1].gate.resolve({list:3});assert.deepEqual(await c,{list:3});
  await f.scheduler.dispose();
});
test('a probe finishing after login reset cannot repopulate the old session identity',async()=>{
  const gate=deferred(),seen=[];let probes=0;
  const reader={
    async context(){if(++probes===1)return gate.promise;return {ready:true,idle:true,compatible:true,sessionKey:'new'};},
    async read(){return {deferred:true};},async readAll(args){seen.push(args.sessionKey);return {status:'ready',tasks:[]};},observeStart(){}
  };
  const scheduler=new ReadScheduler({reader,spacingMs:0}),old=scheduler.context({cached:true});await step();
  scheduler.observeStart();assert.equal((await old).ready,false);
  gate.resolve({ready:true,idle:true,compatible:true,sessionKey:'old'});await step();
  assert.equal(scheduler.lastSessionKey,null);const next=await scheduler.readAll();
  assert.equal(next.status,'ready');assert.deepEqual(seen,['new']);await scheduler.dispose();
});
test('an unannounced session change cannot leave MCP reads bound to an old session',async()=>{
  let session='old';const keys=[];
  const reader={async context(){return {ready:true,idle:true,compatible:true,sessionKey:session};},async read(){},
    async readAll(args){keys.push(args.sessionKey);return args.sessionKey===session?{status:'ready',tasks:[]}:{status:'deferred'};}};
  const scheduler=new ReadScheduler({reader,spacingMs:0});await scheduler.context({cached:true});session='new';
  assert.equal((await scheduler.readAll()).status,'deferred');assert.equal((await scheduler.readAll()).status,'ready');
  assert.deepEqual(keys,['old','new']);await scheduler.dispose();
});
test('an error reaches all consumers and the following job is not poisoned',async()=>{
  const f=fixture(),a=f.scheduler.read({sessionKey:'a'}),b=f.scheduler.read({sessionKey:'a'}),c=f.scheduler.context({cached:true});
  const outcomes=Promise.allSettled([a,b]);await step();f.gates[0].gate.reject(Error('unavailable'));
  assert.deepEqual((await outcomes).map(x=>x.status),['rejected','rejected']);assert.equal((await c).ready,true);
  await f.scheduler.dispose();
});
test('frequent identical probes coalesce while a read is holding the ticket',async()=>{
  const f=fixture(),a=f.scheduler.read({sessionKey:'a'});await step();
  const probes=Array.from({length:25},()=>f.scheduler.context({cached:true}));
  assert.equal(f.scheduler.queue.length,1);assert.deepEqual(f.log,['read:quest:']);
  f.gates[0].gate.resolve({list:1});await a;const results=await Promise.all(probes);
  assert.equal(results.length,25);assert.equal(f.log.filter(x=>x==='context:true').length,1);await f.scheduler.dispose();
});
test('a cancelled queued consumer is removed without affecting the active transaction',async()=>{
  const f=fixture(),a=f.scheduler.read({sessionKey:'a'}),abort=new AbortController();await step();
  const b=f.scheduler.read({sessionKey:'b',signal:abort.signal});assert.equal(f.scheduler.queue.length,1);
  abort.abort();assert.deepEqual(await b,{deferred:true});assert.equal(f.scheduler.queue.length,0);
  assert.equal(f.gates[0].signal.aborted,false);f.gates[0].gate.resolve({list:1});await a;await f.scheduler.dispose();
});
test('natural game traffic aborts the active background read and discards its late result',async()=>{
  const f=fixture(),read=f.scheduler.read({sessionKey:'a'});await step();
  f.scheduler.observeRequest({path:'/kcsapi/api_port/port'});assert.equal(f.gates[0].signal.aborted,true);
  f.gates[0].gate.resolve({list:['stale']});assert.deepEqual(await read,{deferred:true});
  assert.deepEqual(f.log,['read:quest:','request']);await f.scheduler.dispose();
});
test('successive reads are spaced and cancellation during the quiet interval sends nothing',async()=>{
  const seen=[],reader={
    async context(){return {ready:true,idle:true,compatible:true,sessionKey:'a'};},
    async read(options){seen.push(options.kind);return {list:[]};},async readAll(){return {status:'ready',tasks:[]};}
  };
  const scheduler=new ReadScheduler({reader,spacingMs:50}),abort=new AbortController();
  await scheduler.read({sessionKey:'a',kind:'first'});
  const pending=scheduler.read({sessionKey:'a',kind:'second',signal:abort.signal});
  await step();abort.abort();assert.deepEqual(await pending,{deferred:true});
  await scheduler.dispose();assert.deepEqual(seen,['first']);
});
test('subsequent reads respect the configured minimum interval',async()=>{
  const started=[],reader={async context(){return {ready:true,idle:true,compatible:true,sessionKey:'a'};},
    async read(){started.push(Date.now());return {list:[]};},async readAll(){return {status:'ready',tasks:[]};}};
  const scheduler=new ReadScheduler({reader,spacingMs:40});
  await scheduler.read({sessionKey:'a',kind:'first'});await scheduler.context({cached:true});
  await scheduler.read({sessionKey:'a',kind:'second'});
  assert(started[1]-started[0]>=35);await scheduler.dispose();
});
test('disposal resolves queued waiters, aborts in-flight work and never disposes the underlying reader',async()=>{
  const f=fixture(),a=f.scheduler.read({sessionKey:'a'}),b=f.scheduler.readAll({sessionKey:'a'});await step();
  const closing=f.scheduler.dispose();assert.deepEqual(await a,{deferred:true});assert.deepEqual(await b,{status:'deferred'});
  assert.equal(f.gates[0].signal.aborted,true);assert.deepEqual(await f.scheduler.read({}),{deferred:true});
  f.gates[0].gate.resolve({deferred:true});await closing;
});
