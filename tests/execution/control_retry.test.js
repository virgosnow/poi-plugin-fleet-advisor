'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Session}=require('../../src/execution/session');
function fixture({validAfter=Infinity,control=true,driftAt=Infinity,deadline=10000}={}){
  let time=0,reads=0,inputs=0,captures=0,checks=0;const events=[],diagnostics=[];
  const host={check(){checks++;if(time>=driftAt)throw Error('state drift');},cancel(){},
    async input(){inputs++;},async capture(){captures++;return Buffer.from('frame');}};
  const observer=control?{async read(){reads++;return {valid:time>=validAfter};}}:
    {async observe(){reads++;return {valid:time>=validAfter};}};
  const session=new Session(host,observer,{now:()=>time,timeoutMs:deadline,allowControlFallback:true,onProgress:event=>events.push(event),onDiagnostic:event=>diagnostics.push(event)});
  session.wait=async ms=>{session.check(false);time+=ms;session.metrics.waitMs+=ms;session.check(false);};
  return {session,events,diagnostics,get time(){return time;},get reads(){return reads;},get inputs(){return inputs;},get captures(){return captures;},get checks(){return checks;}};
}
test('a transient control timeout retries the same observation with fresh reads and no input',async()=>{
  const f=fixture({validAfter:120});f.session.pendingMutation=true;
  const result=await f.session.until('screen',{},r=>r.valid,100);
  assert.equal(result.valid,true);assert.equal(f.session.metrics.controlObservationRetries,1);
  assert.equal(f.events[0].phase,'recognition-retry');assert.equal(f.inputs,0);assert.equal(f.captures,0);
  assert.deepEqual(f.diagnostics.map(d=>d.stage),['retry','retry-resolved']);
  assert.equal(f.diagnostics[0].diagnostics.checks[0].kind,'screen');
  assert.equal(f.session.pendingMutation,true,'the retry does not confirm or resubmit a pending mutation');
});
test('two control timeouts retain both diagnostics for the guarded fallback',async()=>{
  const f=fixture();let error;try{await f.session.until('screen',{},r=>r.valid,100);}catch(e){error=e;}
  assert.equal(error.code,'OBSERVATION_TIMEOUT');assert.equal(error.diagnostics.controlRetry.attempts,2);
  assert.equal(error.diagnostics.controlRetry.first.kind,'screen');assert.match(error.stack,/Control retry diagnostics/);
  assert.equal(f.session.metrics.controlObservationRetries,1);assert(f.time>=200);assert.equal(f.inputs,0);
  assert.deepEqual(f.diagnostics.map(d=>d.stage),['retry','retry-timeout']);
  assert.equal(f.diagnostics[1].diagnostics.controlRetry.first.kind,'screen');
});
test('control retry logs bounded batch observations and current equipment context without changing behavior',async()=>{
  const f=fixture();f.session.diagnosticContext={phase:'equipment',fleet:1,ship:42,slot:4,step:2,total:3};
  f.session.observer.read=async()=>({valid:false,results:[{valid:true,mode:'stock',secret:'private'},
    {valid:false,reason:'unreadable',page:{valid:false},inventory:{secret:'private'}}]});
  await assert.rejects(f.session.until('batch',{checks:[{kind:'equipmode'},{kind:'equippicker'}]},undefined,100),{code:'OBSERVATION_TIMEOUT'});
  const [first,last]=f.diagnostics;
  assert.equal(first.context.ship,42);assert.equal(first.context.slot,4);
  assert.equal(first.diagnostics.checks[1].observed.reason,'unreadable');
  assert.equal(last.diagnostics.controlRetry.first.checks[0].observed.mode,'stock');
  assert(!JSON.stringify(f.diagnostics).includes('private'));assert.equal(f.inputs,0);
});
test('equipment picker timeout includes bounded structural reasons without inventory or frame content',async()=>{
  const f=fixture();f.session.observer.read=async()=>({valid:false,reason:'Equipment picker state not verified',
    picker:{scene:'equipment',phase:'picker',contextMatched:true,fleetMatched:true,sourceCount:0,visibleRows:0,
      pageValid:false,activePage:1,filterDetail:0,sourceIdsValid:true,modeReady:false,sourceIds:[999],frame:'private'}});
  await assert.rejects(f.session.until('equipview',{},undefined,100),{code:'OBSERVATION_TIMEOUT'});
  const picker=f.diagnostics[0].diagnostics.checks[0].observed.picker;
  assert.equal(picker.sourceCount,0);assert.equal(picker.modeReady,false);assert.equal(picker.pageValid,false);
  assert(!JSON.stringify(picker).includes('999'));assert(!JSON.stringify(picker).includes('private'));
});
test('failure to write retry diagnostics does not interrupt recognition',async()=>{
  const f=fixture({validAfter:120});f.session.onDiagnostic=()=>{throw Error('log unavailable');};
  assert.equal((await f.session.until('screen',{},r=>r.valid,100)).valid,true);
});
test('image mode does not retry and state drift or the run deadline stops control retries',async()=>{
  const image=fixture({control:false});await assert.rejects(image.session.until('screen',{},r=>r.valid,100),{code:'OBSERVATION_TIMEOUT'});
  assert.equal(image.session.metrics.controlObservationRetries,undefined);assert(image.captures>0);
  for(const options of [{driftAt:100},{deadline:100}]){
    const f=fixture(options);await assert.rejects(f.session.until('screen',{},r=>r.valid,100),/state drift|deadline/);
    assert.equal(f.session.metrics.controlObservationRetries,undefined);assert.equal(f.inputs,0);
  }
});
