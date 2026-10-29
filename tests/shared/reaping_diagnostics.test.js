'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ReapingTrace,lagMonitor,combine,sanitize}=require('../../src/shared/reaping_diagnostics');
test('reaping diagnostics separate main, process notification, and renderer delays without normal detail',()=>{
  const main={pid:123,events:[{event:'resultReceived',at:1000},{event:'terminateCalled',at:1004},
    {event:'killCalled',at:1005},{event:'killReturned',at:1006,ok:true},{event:'exitNotified',at:1010},{event:'terminationResolved',at:1011}]};
  assert.equal(combine(main,{resultReceivedAt:1002,terminateRequestedAt:1003,terminateFinishedAt:1012,waitMs:10}),undefined);
  const slow=combine(main,{resultReceivedAt:1002,terminateRequestedAt:1003,terminateFinishedAt:9012,waitMs:8010});
  assert.deepEqual(slow.reasons,['slow']);assert.equal(slow.segments.killToExitNotificationMs,5);
  assert.equal(slow.segments.mainToRendererResolutionMs,8001);
  const delayedDispatch=combine(main,{resultReceivedAt:2002,terminateRequestedAt:2003,terminateFinishedAt:2012,waitMs:10});
  assert(delayedDispatch.reasons.includes('slow'),'late result delivery is visible even when terminate itself is fast');
});
test('reaping failure records are bounded and strip raw exception messages, stacks and payloads',()=>{
  const r=combine({pid:123,events:[{event:'killReturned',at:1000,ok:false},{event:'killThrew',at:1001,
    error:{name:'Error',code:'EPERM',message:'PRIVATE_TEST',stack:'PRIVATE_TEST'},store:'PRIVATE_TEST'}]},
    {waitMs:1,error:Object.assign(Error('PRIVATE_TEST'),{code:'RECOMMENDATION_PROCESS_STOP_TIMEOUT'}),args:'PRIVATE_TEST'});
  assert.deepEqual(r.reasons,['kill-failed','kill-threw','termination-error']);assert(!JSON.stringify(r).includes('PRIVATE_TEST'));
  assert.equal(r.main.events[1].error.code,'EPERM');assert.equal(r.renderer.error.code,'RECOMMENDATION_PROCESS_STOP_TIMEOUT');
  assert.equal(sanitize({abnormal:false,events:['PRIVATE_TEST']}),undefined);
  assert.equal(sanitize({...r,main:{events:Array(99).fill({event:'killCalled',at:1})}}).main.events.length,32);
});
test('lag observation stops and includes a stalled final interval without waiting for a timer callback',()=>{
  let now=0,callback,cancelled=0;
  const lag=lagMonitor({now:()=>now,schedule:fn=>{callback=fn;return 1;},cancel:id=>{assert.equal(id,1);cancelled++;}});
  now=110;callback();now=1210;assert.equal(lag.stop(),1000);assert.equal(lag.stop(),1000);assert.equal(cancelled,1);
  let stopped=0;
  const trace=new ReapingTrace({now:()=>now,monitor:()=>({stop:()=>{stopped++;return 900;}})});
  trace.mark('resultReceived');trace.mark('terminateCalled');trace.mark('exitNotified',{exitCode:0});
  assert.equal(stopped,1);assert.equal(trace.snapshot().maxLagMs,900);
});
