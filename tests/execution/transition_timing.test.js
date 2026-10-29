'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {TransitionTiming}=require('../../src/execution/transition_timing');
const {Session}=require('../../src/execution/session');
const input={kind:'click',x:750,y:271,path:''};
const sample=(timing,after,hadInvalid=true)=>{
  const p=timing.begin(input,'picker');timing.record(p,{readyAfterMs:after,hadInvalid,delayUsed:false});return p;
};

test('only two naturally observed delayed transitions enable a bounded hint and every third check explores immediately',()=>{
  const t=new TransitionTiming();assert.equal(sample(t,250).delay,0);assert.equal(sample(t,250).delay,0);
  assert.deepEqual(Array.from({length:6},()=>t.begin(input,'picker').delay),[250,250,0,250,250,0]);
  sample(t,0,false);assert.equal(t.profiles.size,0);
  sample(t,401);assert.equal(t.profiles.size,0);
});

test('delayed probes do not teach themselves and a failed prediction is discarded immediately',()=>{
  const t=new TransitionTiming();sample(t,200);sample(t,250);
  const p=t.begin(input,'picker');t.record(p,{delayUsed:true,hadInvalid:false,readyAfterMs:250});
  assert.deepEqual(t.profiles.get(p.key).samples,[200,250]);
  t.reject(p);assert.equal(t.profiles.size,0);assert.equal(t.begin(input,'picker').delay,0);
});

test('input point, mutation endpoint and batch check shapes do not share transition hints',()=>{
  const t=new TransitionTiming();sample(t,250);sample(t,250);
  for(const other of [{...input,x:1135},{...input,y:321},{...input,kind:'hover'},{...input,path:'api_req_kaisou/slotset'}])
    assert.equal(t.begin(other,'picker').delay,0);
  const checks=[{kind:'equipmode'},{kind:'equippicker'}];
  for(let i=0;i<2;i++)t.record(t.begin(input,'batch',{checks}),{delayUsed:false,hadInvalid:true,readyAfterMs:200});
  assert.equal(t.begin(input,'batch',{checks:[{kind:'equipmode'},{kind:'pageread'}]}).delay,0);
});

test('exploration is shared across learned controls so faster UI does not pay a stale delay for every button',()=>{
  const t=new TransitionTiming();
  for(const x of [750,824,1075])for(let i=0;i<2;i++){
    const p=t.begin({...input,x},'picker');t.record(p,{delayUsed:false,hadInvalid:true,readyAfterMs:250});
  }
  assert.equal(t.begin(input,'picker').delay,250);
  assert.equal(t.begin({...input,x:824},'picker').delay,250);
  const fresh=t.begin({...input,x:1075},'picker');assert.equal(fresh.delay,0);
  t.record(fresh,{delayUsed:false,hadInvalid:false,readyAfterMs:0});
  assert.equal(t.profiles.size,0);
});

test('history holds at most 64 small run-local profiles and two timing samples per profile',()=>{
  const t=new TransitionTiming();
  for(let i=0;i<1000;i++)for(let n=0;n<4;n++)t.record(t.begin({...input,x:i},'picker'),{delayUsed:false,hadInvalid:true,readyAfterMs:150+n});
  assert.equal(t.profiles.size,64);assert([...t.profiles.values()].every(p=>p.samples.length===2));
  assert(JSON.stringify([...t.profiles]).length<16384);t.clear();assert.equal(t.profiles.size,0);
});

function fixture({captureMs=150,transitionMs=240,enabled=true}={}){
  let time=0,readyAt=0,captures=0,inputs=0,blocked=false;
  const starts=[],waits=[];
  const s=new Session({check(){if(blocked)throw Error('state drift');},cancel(){},
    capture:async()=>{starts.push(time);const ready=time>=readyAt;captures++;time+=captureMs;return {ready};},
    input:async()=>{assert(time>=readyAt,'must not click before the preceding UI transition is ready');inputs++;readyAt=time+transitionMs;}},
    {observe:async(_kind,frame)=>({valid:frame.ready,page:1})},{now:()=>time});
  if(!enabled)s.transitionTiming.begin=()=>null;
  s.wait=async ms=>{s.check(false);waits.push(ms);time+=ms;s.check(false);};
  return {s,starts,waits,advance:ms=>{time+=ms;},setTransition:ms=>{transitionMs=ms;},drift:()=>{blocked=true;},
    step:async()=>{await s.input(750,271,undefined,'click',{settleMs:0});return s.until('picker',{});},
    stats:()=>({time,captures,inputs})};
}

for(const captureMs of [0,80,150,300])test('steady transitions at '+captureMs+'ms capture cost retain readiness and reduce wasted captures',async()=>{
  const before=fixture({captureMs,enabled:false}),after=fixture({captureMs});
  for(let i=0;i<8;i++){await before.step();await after.step();}
  assert.equal(after.stats().inputs,before.stats().inputs);
  assert.equal(after.stats().time,before.stats().time);
  assert(after.stats().captures<before.stats().captures);
  assert(after.s.metrics.delayedProbes>0);
});

test('instant UI, unrelated read-only queries and transitions outside the 400ms limit retain immediate checks',async()=>{
  for(const transitionMs of [0,600]){
    const before=fixture({transitionMs,enabled:false}),after=fixture({transitionMs});
    for(let i=0;i<6;i++){await before.step();await after.step();}
    assert.deepEqual(after.stats(),before.stats());assert.equal(after.s.metrics.delayedProbes,0);
  }
  const f=fixture();await f.s.until('screen',{});assert.equal(f.s.metrics.delayedProbes,0);
});

test('a suddenly faster UI is rediscovered without accepting a scheduled hint as visual proof',async()=>{
  const f=fixture();await f.step();await f.step();f.setTransition(0);
  await f.step();await f.step();assert.equal(f.s.metrics.delayedProbes,2);
  await f.step();assert.equal(f.s.transitionTiming.profiles.size,0);
  const delayed=f.s.metrics.delayedProbes;await f.step();assert.equal(f.s.metrics.delayedProbes,delayed);
  assert.equal(f.stats().inputs,6);
});

test('a slower-than-predicted UI falls back to fresh-frame polling and cannot trigger another input early',async()=>{
  const f=fixture();await f.step();await f.step();f.setTransition(600);
  await f.step();assert.equal(f.s.transitionTiming.profiles.size,0);
  const delayed=f.s.metrics.delayedProbes;await f.step();assert.equal(f.s.metrics.delayedProbes,delayed);
  assert.equal(f.stats().inputs,4);
});

test('time already spent on request/store confirmation is deducted and a short phase deadline is never extended',async()=>{
  const f=fixture();await f.step();await f.step();
  await f.s.input(750,271,undefined,'click',{settleMs:0});f.advance(300);
  const waits=f.waits.length;await f.s.until('picker',{});assert.equal(f.s.metrics.delayedProbes,0);
  assert(f.waits.slice(waits).every(ms=>ms<=80));
  const g=fixture();await g.step();await g.step();await g.s.input(750,271,undefined,'click',{settleMs:0});
  await assert.rejects(g.s.until('picker',{},undefined,100),/timed out/);
  assert.equal(g.s.metrics.delayedProbes,0);
});

test('cancellation, state drift and a different input during scheduling stop before any stale probe',async()=>{
  for(const reason of ['stop','drift','input']){
    const f=fixture();await f.step();await f.step();await f.s.input(750,271,undefined,'click',{settleMs:0});
    const captures=f.stats().captures,wait=f.s.wait;
    f.s.wait=async ms=>{if(reason==='stop')f.s.stop();else if(reason==='drift')f.drift();else f.s.actionId++;return wait(ms);};
    await assert.rejects(f.s.until('picker',{}),/stopped|state drift|Input changed/);
    assert.equal(f.stats().captures,captures);assert.equal(f.stats().inputs,3);
    f.s.stop();assert.equal(f.s.transitionTiming.profiles.size,0);
  }
});

test('full validation time is deducted again before scheduling and cannot add a wait beyond the phase budget',async()=>{
  for(const spent of [100,300]){
    const f=fixture();await f.step();await f.step();
    const learned=Math.max(...f.s.transitionTiming.profiles.values().next().value.samples);
    await f.s.input(750,271,undefined,'click',{settleMs:0});
    const before=f.waits.length;let checks=0;
    f.s.validate=()=>{if(checks++===0)f.advance(spent);};
    await f.s.until('picker',{});
    const first=f.waits.slice(before)[0];
    if(spent===100)assert.equal(first,learned-spent);
    else assert.equal(f.s.metrics.delayedProbes,0);
  }
  const g=fixture();await g.step();await g.step();await g.s.input(750,271,undefined,'click',{settleMs:0});
  g.s.validate=()=>g.advance(400);
  await assert.rejects(g.s.until('picker',{},undefined,300),/timed out/);
  assert.equal(g.s.metrics.delayedProbes,0);
});

test('a successful two-frame check still needs matching fresh images after a scheduled probe',async()=>{
  const f=fixture();await f.step();await f.step();await f.s.input(750,271,undefined,'click',{settleMs:0});
  let calls=0;f.s.observer.observe=async()=>({valid:true,page:++calls%2});
  await assert.rejects(f.s.until('picker',{},undefined,1000),/timed out/);
  assert(calls>=2);assert.equal(f.stats().inputs,3);
});

module.exports={fixture};

function imageCadence({captureMs=5,observeMs=5,values=[true,true],extra=0}={}){
  let time=0,captures=0,inputs=0;const waits=[],frames=[];
  const s=new Session({check(){},cancel(){},capture:async()=>{time+=captureMs;return {serial:++captures};},input:async()=>{inputs++;}},
    {observe:async(kind,frame)=>{frames.push(frame);time+=observeMs;return {valid:values.shift()??true,page:1};}},{now:()=>time,operationWaitMs:extra});
  s.wait=async ms=>{s.check(false);waits.push(ms);time+=ms;s.check(false);};
  return {s,waits,frames,stats:()=>({time,captures,inputs})};
}
test('slow screenshot retries keep their backoff while successful expensive images need no extra stable delay',async()=>{
  const f=imageCadence({captureMs:180,observeMs:20,values:[false,false,true,true]});
  await f.s.until('picker',{});assert.deepEqual(f.waits,[100,140]);assert.equal(f.stats().captures,4);assert.equal(f.stats().time,1040);
});
test('fast image polling remains bounded and matching confirmation still captures independent images',async()=>{
  const f=imageCadence({values:[false,false,true,true]});
  await f.s.until('picker',{},undefined,6000,{stableFrames:2,reuseLastFrame:true});
  assert.deepEqual(f.waits,[100,140,30]);assert.equal(f.stats().captures,4);assert.equal(new Set(f.frames).size,4);assert.equal(f.s.metrics.reusedFrames,0);
});
test('image input uses the shared short buffer while player extra wait and stop guards remain active',async()=>{
  const f=imageCadence({extra:800});await f.s.input(10,20);await f.s.input(10,20,undefined,'click',{settleMs:0});
  assert.deepEqual(f.waits,[840,800]);assert.equal(f.stats().inputs,2);
  const g=imageCadence({values:[false,true,true]});g.s.wait=async()=>{g.s.stop();g.s.check(false);};
  await assert.rejects(g.s.until('picker',{}),/stopped/);assert.equal(g.stats().captures,1);assert.equal(g.stats().inputs,0);
});
