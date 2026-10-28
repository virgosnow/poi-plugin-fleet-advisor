'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {RecommendationWorker}=require('../../src/infrastructure/workers/recommendation_worker');
const {PerformanceTrace}=require('../../src/shared/performance_trace');
const fixture=require('../helpers/workbench_fixture');

test('profiling remains outside result caches and cache hits skip search without stale timing',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-advisor-profile-'));
  t.after(()=>{if(path.dirname(dir)===os.tmpdir()&&path.basename(dir).startsWith('fleet-advisor-profile-'))fs.rmSync(dir,{recursive:true,force:true});});
  const store=fixture(),args={area:'1-1',fleet:1,};store.info.basic.api_nickname='PRIVATE_PROFILE_TEST';
  const plain=new RecommendationWorker({getDiagnostics:()=>null}),traced=new RecommendationWorker({cacheDir:dir,
    getDiagnostics:()=>({level:'modules'}),onProfile:async()=>{await new Promise(resolve=>setImmediate(resolve));throw Error('logger failure');}});
  try{
    const expected=await plain.run('recommendNormalFleet',store,args);
    assert.equal(plain.lastProfile,null);
    assert.deepEqual(await traced.run('recommendNormalFleet',store,args),expected);
    const first=traced.lastProfile;assert.equal(first.counters['cache.result.miss'],1);
    assert.match(first.implementation,/^[a-f0-9]{64}$/);assert.equal(first.runtime.plugin,require('../../package.json').version);
    assert(first.stages.some(s=>s.name==='batch.seeds'));assert(first.spans.length);
    assert(first.elapsedMs>=first.workerMs);assert(first.queueMs>=0);
    assert(!JSON.stringify(first).includes('PRIVATE_PROFILE_TEST'));
    assert.deepEqual(await traced.run('recommendNormalFleet',store,args),expected);
    const hit=traced.lastProfile;assert.notEqual(hit,first);assert.equal(hit.counters['cache.result.hit'],1);
    assert.equal(hit.children.length,0);assert(!hit.stages.some(s=>s.name.startsWith('batch.')));
    assert.equal(hit.spans.length,0);assert(!('profile'in expected));
    await assert.rejects(traced.run('recommendNormalFleet',store,{...args,area:'bad'}));
    assert.equal(traced.lastProfile.status,'error');
  }finally{await plain.dispose();await traced.dispose();}
});

test('parallel batch tracing retains the same candidates and collects each child once',async()=>{
  const {RecommendationPool}=require('../../src/infrastructure/workers/recommendation_pool');
  const {recommendationBatch}=require('../../src/recommendation/index');
  const store=fixture(),trace=new PerformanceTrace(),batch={kind:'combat',args:{fleet:1,area:'1-1',},
    items:Array.from({length:24},()=>[1,2])};
  const expected=recommendationBatch(store,batch);
  await trace.run(async()=>{
    const pool=new RecommendationPool(store,{size:2});
    try{
      const actual=await pool.run(batch,()=>assert.fail('expected parallel dispatch'));
      assert.deepEqual(actual,expected);await pool.flush();
      assert.equal(trace.children.length,2);assert.equal(new Set(trace.children.map(c=>c.worker)).size,2);
      assert(trace.children.every(c=>c.startupMs>=0&&c.spans.some(s=>s.name==='batch.combat')));
      const work=trace.dispatch.filter(d=>d.kind==='combat');assert.equal(work.reduce((n,r)=>n+r.items,0),24);
      assert(work.every(d=>d.roundTripMs>=d.computeMs&&d.computeMs>0));
    }finally{await pool.dispose();}
  });
});
