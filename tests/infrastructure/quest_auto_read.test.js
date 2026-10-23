'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {QuestAutoRead}=require('../../src/infrastructure/quests/quest_auto_read');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(overrides={}){
  let time=0,calls=0,context={sessionKey:'opaque-session-a',ready:true,idle:true,compatible:true},quest={known:false,tasks:[]};
  const signals=[];
  const model=new QuestAutoRead({now:()=>time,getContext:()=>({...context}),getQuestState:()=>quest,
    read:async ({signal})=>{calls++;signals.push(signal);return {ok:true};},...overrides});
  return {model,get calls(){return calls;},get signals(){return signals;},
    time:value=>{time=value;},context:value=>{context={...context,...value};},quest:value=>{quest=value;}};
}
async function due(f){f.model.setActive('normal',true);await f.model.tick();f.time(2000);}

test('requires an active workbench and two stable seconds before one shared read',async()=>{
  const f=fixture();assert.equal((await f.model.tick()).status,'inactive');
  f.model.setActive('normal',true);assert.equal((await f.model.tick()).status,'waiting');
  f.time(1999);assert.equal((await f.model.tick()).status,'waiting');
  f.time(2000);assert.equal((await f.model.tick()).status,'read');
  f.model.setActive('normal',false);f.model.setActive('expedition',true);
  assert.equal((await f.model.tick()).status,'spent');assert.equal(f.calls,1);
});

test('hiding one mounted page preserves the other active owner',async()=>{
  const f=fixture();f.model.setActive('normal',true);f.model.setActive('expedition',true);
  await f.model.tick();f.time(1500);f.model.setActive('normal',false);f.time(2000);
  assert.equal((await f.model.tick()).status,'read');assert.equal(f.calls,1);
});

test('hiding every workbench resets the stable interval',async()=>{
  const f=fixture();await due(f);f.model.setActive('normal',false);
  assert.equal((await f.model.tick()).status,'inactive');
  f.model.setActive('expedition',true);assert.equal((await f.model.tick()).status,'waiting');
  f.time(3999);assert.equal((await f.model.tick()).status,'waiting');
  f.time(4000);assert.equal((await f.model.tick()).status,'read');
});

test('not ready, busy, unsafe compatibility or missing session resets stability',async()=>{
  for(const unsafe of [{ready:false},{idle:false},{compatible:false},{sessionKey:''}]){
    const f=fixture();await due(f);f.context(unsafe);
    assert.equal((await f.model.tick()).status,'unsafe');assert.equal(f.calls,0);
    f.context({sessionKey:'opaque-session-a',ready:true,idle:true,compatible:true});f.time(3000);
    assert.equal((await f.model.tick()).status,'waiting');f.time(5000);
    assert.equal((await f.model.tick()).status,'read');
  }
});

test('readiness fields require explicit true rather than truthy missing permissions',async()=>{
  const f=fixture({getContext:()=>({sessionKey:'opaque-session-a',ready:1,idle:true,compatible:true})});
  await due(f);assert.equal((await f.model.tick()).status,'unsafe');assert.equal(f.calls,0);
});

test('a naturally observed cache cancels the opportunity, even if later cleared',async()=>{
  const f=fixture();await due(f);f.quest({known:true,tasks:[]});
  assert.equal((await f.model.tick()).status,'cached');assert.equal(f.calls,0);
  f.quest({known:false,tasks:[]});assert.equal((await f.model.tick()).status,'spent');
});

test('known task cache consumes a session even while idle or compatibility is unsafe',async()=>{
  const f=fixture();f.model.setActive('normal',true);
  f.context({idle:false,compatible:false});f.quest({known:true,tasks:[]});
  assert.equal((await f.model.tick()).status,'cached');
  assert.deepEqual(f.model.snapshot().consumed,['opaque-session-a']);
  f.context({idle:true,compatible:true});f.quest({known:false,tasks:[]});
  assert.equal((await f.model.tick()).status,'spent');assert.equal(f.calls,0);
});

test('known cache without a session returns cached without recording an empty identity',async()=>{
  const f=fixture();f.model.setActive('normal',true);
  f.context({sessionKey:'',ready:false,idle:false,compatible:false});f.quest({known:true,tasks:[]});
  assert.equal((await f.model.tick()).status,'cached');
  assert.deepEqual(f.model.snapshot().consumed,[]);assert.equal(f.calls,0);
});

test('failure consumes the session and never automatically retries',async()=>{
  let calls=0;const f=fixture({read:async()=>{calls++;throw new Error('timeout');}});
  await due(f);assert.equal((await f.model.tick()).status,'failed');
  f.time(10000);assert.equal((await f.model.tick()).status,'spent');assert.equal(calls,1);
});

test('explicit host cancellation before starting the request preserves the opportunity',async()=>{
  let calls=0;const f=fixture({read:async()=>++calls===1?{deferred:true}:{ok:true}});
  await due(f);assert.equal((await f.model.tick()).status,'deferred');
  assert.deepEqual(f.model.snapshot().consumed,[]);
  assert.equal((await f.model.tick()).status,'waiting');f.time(4000);
  assert.equal((await f.model.tick()).status,'read');assert.equal(calls,2);
});

test('new session starts its own stability period and chance',async()=>{
  const f=fixture();await due(f);assert.equal((await f.model.tick()).status,'read');
  f.context({sessionKey:'opaque-session-b'});f.time(2100);
  assert.equal((await f.model.tick()).status,'waiting');f.time(4100);
  assert.equal((await f.model.tick()).status,'read');assert.equal(f.calls,2);
});

test('snapshot restore preserves consumed opportunities only, not task/account data',async()=>{
  const f=fixture();await due(f);await f.model.tick();const snapshot=f.model.snapshot();
  assert.deepEqual(Object.keys(snapshot).sort(),['consumed','version']);
  const next=fixture({initialState:snapshot});next.model.setActive('normal',true);
  assert.equal((await next.model.tick()).status,'spent');assert.equal(next.calls,0);
  snapshot.consumed.length=0;
  assert.equal((await next.model.tick()).status,'spent');
});

test('explicit restore merges valid records and ignores malformed snapshots',async()=>{
  const f=fixture();f.model.restore({version:99,consumed:['opaque-session-a']});
  assert.deepEqual(f.model.snapshot().consumed,[]);
  f.model.restore({version:1,consumed:['opaque-session-b',null,'']});
  f.model.restore({version:1,consumed:['opaque-session-a']});
  assert.deepEqual(f.model.snapshot().consumed,['opaque-session-a','opaque-session-b']);
});

test('concurrent asynchronous probes cannot start duplicate reads',async()=>{
  const gate=deferred();let probes=0;
  const f=fixture({getContext:async()=>{probes++;return gate.promise;}});
  f.model.setActive('normal',true);const first=f.model.tick();
  assert.equal((await f.model.tick()).status,'inflight');assert.equal(probes,1);
  gate.resolve({sessionKey:'opaque-session-a',ready:true,idle:true,compatible:true});
  assert.equal((await first).status,'waiting');
});

test('visibility generation invalidates a pending async readiness probe',async()=>{
  const gate=deferred();const f=fixture({getContext:()=>gate.promise});
  f.model.setActive('normal',true);const first=f.model.tick();
  f.model.setActive('normal',false);f.model.setActive('normal',true);
  gate.resolve({sessionKey:'opaque-session-a',ready:true,idle:true,compatible:true});
  assert.equal((await first).status,'deferred');assert.equal(f.calls,0);
});

test('session race in the final guard does not consume either session',async()=>{
  let probes=0;const f=fixture({getContext:()=>({sessionKey:++probes===3?'opaque-session-b':'opaque-session-a',ready:true,idle:true,compatible:true})});
  await due(f);assert.equal((await f.model.tick()).status,'deferred');
  assert.deepEqual(f.model.snapshot().consumed,[]);assert.equal(f.calls,0);
});

test('busy race in final guard resets stability without attempting a read',async()=>{
  let probes=0;const f=fixture({getContext:()=>({sessionKey:'opaque-session-a',ready:true,idle:++probes!==3,compatible:true})});
  await due(f);assert.equal((await f.model.tick()).status,'unsafe');assert.equal(f.calls,0);
});

test('natural cache appearing during final async guard cancels before reading',async()=>{
  let reads=0;const f=fixture({getQuestState:()=>({known:++reads===3,tasks:[]})});
  await due(f);assert.equal((await f.model.tick()).status,'cached');assert.equal(f.calls,0);
});

test('inflight read receives abort when hidden and remains consumed after actual failure',async()=>{
  const gate=deferred();let signal;
  const f=fixture({read:async options=>{signal=options.signal;return gate.promise;}});
  await due(f);const running=f.model.tick();
  for(let i=0;i<10&&!signal;i++)await Promise.resolve();
  assert.ok(signal);assert.equal((await f.model.tick()).status,'inflight');
  f.model.setActive('normal',false);assert.equal(signal.aborted,true);
  gate.reject(new Error('cancelled in-flight'));assert.equal((await running).status,'failed');
  f.model.setActive('normal',true);assert.equal((await f.model.tick()).status,'spent');
});

test('inflight account changes abort old session but do not spend the new session',async()=>{
  const gate=deferred();let signal;
  const f=fixture({read:async options=>{signal=options.signal;return gate.promise;}});
  await due(f);const running=f.model.tick();
  for(let i=0;i<10&&!signal;i++)await Promise.resolve();
  f.context({sessionKey:'opaque-session-b'});
  assert.equal((await f.model.tick()).status,'inflight');assert.equal(signal.aborted,true);
  gate.resolve({ok:true});await running;
  assert.deepEqual(f.model.snapshot().consumed,['opaque-session-a']);
  assert.equal((await f.model.tick()).status,'waiting');
});

test('natural cache observed during inflight deferred read prevents retry',async()=>{
  const gate=deferred();let entered=false;
  const f=fixture({read:async()=>{entered=true;return gate.promise;}});
  await due(f);const running=f.model.tick();
  for(let i=0;i<10&&!entered;i++)await Promise.resolve();
  f.quest({known:true,tasks:[]});assert.equal((await f.model.tick()).status,'cached');
  gate.resolve({deferred:true});await running;f.quest({known:false,tasks:[]});
  assert.equal((await f.model.tick()).status,'spent');
});

test('dispose aborts reads and pending probes cannot revive the coordinator',async()=>{
  const gate=deferred();let signal;
  const f=fixture({read:async options=>{signal=options.signal;return gate.promise;}});
  await due(f);const running=f.model.tick();
  for(let i=0;i<10&&!signal;i++)await Promise.resolve();
  f.model.dispose();assert.equal(signal.aborted,true);gate.resolve({ok:true});
  assert.equal((await running).status,'disposed');
  f.model.setActive('normal',true);assert.equal((await f.model.tick()).status,'disposed');
});

test('failed async context probe waits through a fresh stable interval',async()=>{
  let probes=0;const f=fixture({getContext:async()=>{
    if(++probes===1)throw new Error('unavailable');
    return {sessionKey:'opaque-session-a',ready:true,idle:true,compatible:true};
  }});
  f.model.setActive('normal',true);assert.equal((await f.model.tick()).status,'deferred');
  f.time(10000);assert.equal((await f.model.tick()).status,'waiting');f.time(12000);
  assert.equal((await f.model.tick()).status,'read');
});

test('clock moving backwards restarts the stability interval',async()=>{
  const f=fixture();f.time(10000);f.model.setActive('normal',true);await f.model.tick();
  f.time(200);assert.equal((await f.model.tick()).status,'waiting');
  f.time(2200);assert.equal((await f.model.tick()).status,'read');
});
