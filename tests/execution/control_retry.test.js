'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Session}=require('../../src/execution/session');
function fixture({validAfter=Infinity,control=true,driftAt=Infinity,deadline=10000}={}){
  let time=0,reads=0,inputs=0,captures=0,checks=0;const events=[];
  const host={check(){checks++;if(time>=driftAt)throw Error('state drift');},cancel(){},
    async input(){inputs++;},async capture(){captures++;return Buffer.from('frame');}};
  const observer=control?{async read(){reads++;return {valid:time>=validAfter};}}:
    {async observe(){reads++;return {valid:time>=validAfter};}};
  const session=new Session(host,observer,{now:()=>time,timeoutMs:deadline,allowControlFallback:true,onProgress:event=>events.push(event)});
  session.wait=async ms=>{session.check(false);time+=ms;session.metrics.waitMs+=ms;session.check(false);};
  return {session,events,get time(){return time;},get reads(){return reads;},get inputs(){return inputs;},get captures(){return captures;},get checks(){return checks;}};
}
test('a transient control timeout retries the same observation with fresh reads and no input',async()=>{
  const f=fixture({validAfter:120});f.session.pendingMutation=true;
  const result=await f.session.until('screen',{},r=>r.valid,100);
  assert.equal(result.valid,true);assert.equal(f.session.metrics.controlObservationRetries,1);
  assert.equal(f.events[0].phase,'recognition-retry');assert.equal(f.inputs,0);assert.equal(f.captures,0);
  assert.equal(f.session.pendingMutation,true,'the retry does not confirm or resubmit a pending mutation');
});
test('two control timeouts retain both diagnostics for the guarded fallback',async()=>{
  const f=fixture();let error;try{await f.session.until('screen',{},r=>r.valid,100);}catch(e){error=e;}
  assert.equal(error.code,'OBSERVATION_TIMEOUT');assert.equal(error.diagnostics.controlRetry.attempts,2);
  assert.equal(error.diagnostics.controlRetry.first.kind,'screen');assert.match(error.stack,/Control retry diagnostics/);
  assert.equal(f.session.metrics.controlObservationRetries,1);assert(f.time>=200);assert.equal(f.inputs,0);
});
test('image mode does not retry and state drift or the run deadline stops control retries',async()=>{
  const image=fixture({control:false});await assert.rejects(image.session.until('screen',{},r=>r.valid,100),{code:'OBSERVATION_TIMEOUT'});
  assert.equal(image.session.metrics.controlObservationRetries,undefined);assert(image.captures>0);
  for(const options of [{driftAt:100},{deadline:100}]){
    const f=fixture(options);await assert.rejects(f.session.until('screen',{},r=>r.valid,100),/state drift|deadline/);
    assert.equal(f.session.metrics.controlObservationRetries,undefined);assert.equal(f.inputs,0);
  }
});
