'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Session}=require('../../src/execution/session');
function setup(){
  let time=0,captures=0,changed=false,inputs=0;
  const host={check(){if(changed)throw Error('state drift');},cancel(){},capture:async()=>({id:++captures}),input:async()=>{inputs++;}};
  const observer={observe:async(_kind,frame)=>({valid:true,id:frame.id})};
  const s=new Session(host,observer,{now:()=>time});s.wait=async ms=>{time+=ms;};
  return {s,observer,host,advance:ms=>time+=ms,change:()=>changed=true,stats:()=>({captures,inputs})};
}
test('a final check reuses the last stable frame with a new observation and full validation',async()=>{
  const f=setup();let validations=0;f.s.validate=()=>validations++;
  // Two stable frames must contain the same structured state, but retain
  // their distinct capture identities for the subsequent row verification.
  const observe=f.observer.observe;f.observer.observe=async(kind,frame)=>kind==='list'?{valid:true,page:1}:observe(kind,frame);
  await f.s.until('list',{});
  const result=await f.s.until('row',{},undefined,6000,{stableFrames:1,reuseLastFrame:true});
  assert.equal(result.id,2);assert.equal(f.stats().captures,2);assert.equal(f.s.metrics.observations,3);
  assert.equal(f.s.metrics.reusedFrames,1);assert.equal(validations,6);
});
for(const action of ['input','expiry'])test(action+' invalidates reuse before checking the target',async()=>{
  const f=setup();await f.s.observe('list');
  if(action==='input')await f.s.input(1,1);else f.advance(501);
  const result=await f.s.until('row',{},undefined,6000,{stableFrames:1,reuseLastFrame:true});
  assert.equal(result.id,2);assert.equal(f.stats().captures,2);assert.equal(f.s.metrics.reusedFrames,0);
});
test('two-frame confirmation cannot count the same reused image twice',async()=>{
  const f=setup();f.observer.observe=async()=>({valid:true});await f.s.observe('list');
  await f.s.until('list',{},undefined,6000,{stableFrames:2,reuseLastFrame:true});
  assert.equal(f.stats().captures,3);assert.equal(f.s.metrics.reusedFrames,0);
});
test('a slow screenshot response cannot reset the frame freshness clock',async()=>{
  const f=setup(),capture=f.host.capture;
  f.host.capture=async()=>{f.advance(550);return capture();};
  await f.s.observe('list');
  const result=await f.s.until('row',{},undefined,6000,{stableFrames:1,reuseLastFrame:true});
  assert.equal(result.id,2);assert.equal(f.stats().captures,2);assert.equal(f.s.metrics.reusedFrames,0);
});
test('a failed reused frame falls back to new captures instead of retrying the same image',async()=>{
  const f=setup();await f.s.observe('list');f.observer.observe=async(_kind,frame)=>({valid:frame.id>1,id:frame.id});
  const result=await f.s.until('row',{},undefined,6000,{stableFrames:1,reuseLastFrame:true});
  assert.equal(result.id,2);assert.equal(f.stats().captures,2);assert.equal(f.s.metrics.reusedFrames,1);
});
test('state drift and cancellation prevent cached-frame verification and all input',async()=>{
  for(const stop of [false,true]){
    const f=setup();await f.s.observe('list');if(stop)f.s.stop();else f.change();
    await assert.rejects(f.s.until('row',{},undefined,6000,{stableFrames:1,reuseLastFrame:true}),/state drift|stopped/);
    assert.equal(f.stats().captures,1);assert.equal(f.stats().inputs,0);
  }
});
test('slow capture diagnostics retain bounded timings and no screenshot bytes',async()=>{
  const f=setup();f.observer.observe=async()=>({valid:false});
  f.host.capture=async()=>{f.advance(1100);f.host.lastCaptureMetrics={checkMs:20,commandMs:1070,base64Ms:10,eventLoopLagMs:300,totalMs:1100,bytes:1000,width:1200,height:720,fastPng:true};return Buffer.from('private pixels');};
  await assert.rejects(f.s.until('list',{},undefined,6000),e=>{
    assert(e.diagnostics.captureBreakdown.slowCaptures>=5);assert(e.diagnostics.slowCaptures.length<=4);
    assert.equal(e.diagnostics.captureBreakdown.maxCommandMs,1070);
    assert(!e.stack.includes('private pixels'));return true;
  });
});
