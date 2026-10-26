'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const perf=require('../../src/shared/performance_trace');

test('nested synchronous timings separate inclusive and exclusive elapsed time',()=>{
  let now=0;const trace=new perf.PerformanceTrace({now:()=>now});
  trace.run(()=>{
    const outer=perf.begin('outer');now=2;
    const inner=perf.begin('inner');now=5;perf.end(inner);
    now=9;perf.end(outer);
  });
  assert.deepEqual(trace.snapshot().spans,[
    {name:'inner',calls:1,totalMs:3,selfMs:3},{name:'outer',calls:1,totalMs:9,selfMs:6}]);
  assert.equal(perf.begin('outside'),null);
});

test('async scopes isolate concurrent jobs and still record failed stages',async()=>{
  let now=0;const a=new perf.PerformanceTrace({now:()=>now}),b=new perf.PerformanceTrace({now:()=>now});
  await Promise.all([a.run(async()=>{
    await perf.stageAsync('wait',async()=>{await Promise.resolve();now=5;perf.count('a');});
    assert.throws(()=>perf.stage('failed',()=>{throw Error('expected');}),/expected/);
  }),b.run(async()=>{await Promise.resolve();perf.count('b');})]);
  assert.deepEqual(a.snapshot().counters,{a:1});assert.deepEqual(b.snapshot().counters,{b:1});
  assert.equal(a.stages[0].name,'wait');assert.equal(a.stages[0].ms,5);assert.equal(a.stages[1].name,'failed');
  assert.equal(perf.current(),undefined);
});

test('stage-only mode avoids module clocks while retaining cache counters',()=>{
  let clocks=0;const trace=new perf.PerformanceTrace({level:'stages',now:()=>++clocks});
  trace.run(()=>{assert.equal(perf.begin('air.trial'),null);perf.end(null);perf.count('hit',4);});
  assert.equal(clocks,0);assert.equal(trace.spans.size,0);assert.equal(trace.counters.hit,4);
});

test('wall stages and accumulated worker module time are summarized separately',()=>{
  const report={elapsedMs:12,workerMs:10,startupAndTransferMs:2,queueMs:1,
    stages:[{name:'batch.gear',ms:4},{name:'batch.gear',ms:5}],
    spans:[{name:'route',calls:1,totalMs:1,selfMs:1}],counters:{hit:1},
    children:[{spans:[{name:'route',calls:2,totalMs:16,selfMs:12}],counters:{hit:2},
      calculationStats:{equipmentEligibility:{hits:3,misses:1}}}]};
  const summary=perf.summarize(report);
  assert.deepEqual(summary.stages,[{name:'batch.gear',calls:2,ms:9}]);assert.equal(summary.otherWorkerMs,1);
  assert.deepEqual(summary.modules,[{name:'route',calls:3,totalMs:17,selfMs:13}]);assert.equal(summary.counters.hit,3);
  assert.equal(summary.elapsedMs,12,'parallel module sums must never replace wall latency');
  assert.equal(summary.counters['calculation.equipmentEligibility.hits'],3);
  assert.equal(summary.counters['calculation.equipmentEligibility.misses'],1);assert.equal(perf.summarize(null),null);
});

test('debug switches are transient and keep only the latest explicitly published report',()=>{
  const previous=process.env.FLEET_ADVISOR_PROFILE;delete process.env.FLEET_ADVISOR_PROFILE;
  try{
    perf.setEnabled(false);assert.equal(perf.options(),null);
    perf.setEnabled(true);assert.deepEqual(perf.options(),{level:'stages'});
    perf.setEnabled(true,{level:'modules'});assert.deepEqual(perf.options(),{level:'modules'});
    perf.setEnabled(false);process.env.FLEET_ADVISOR_PROFILE='modules';assert.deepEqual(perf.options(),{level:'modules'});
    perf.publish({run:1});perf.publish({run:2});assert.deepEqual(perf.getLastReport(),{run:2});
    perf.clear();assert.equal(perf.getLastReport(),null);
  }finally{perf.setEnabled(false);if(previous===undefined)delete process.env.FLEET_ADVISOR_PROFILE;else process.env.FLEET_ADVISOR_PROFILE=previous;}
});

test('module measurements restore nested trace stacks on failure and skip clocks in stage-only mode',()=>{
  let now=0;const trace=new perf.PerformanceTrace({now:()=>++now});
  trace.run(()=>{
    assert.throws(()=>perf.measure('air.cover',()=>perf.measure('air.trial',()=>{throw Error('expected');})),/expected/);
    assert.equal(perf.measure('after',()=>42),42);
  });
  assert.equal(trace.stack.length,0);assert.equal(trace.spans.get('air.cover').calls,1);
  const stages=new perf.PerformanceTrace({level:'stages',now:()=>assert.fail('module clock used')});
  stages.run(()=>assert.equal(perf.measure('air.cover',()=>42),42));assert.equal(stages.spans.size,0);
});
