'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {Worker}=require('node:worker_threads');
const {RecommendationPool,parallelism}=require('../../src/infrastructure/workers/recommendation_pool');
const {recommendNormalFleet,recommendNormalFleetParallel}=require('../../src/recommendation/index');
const fixture=require('../helpers/workbench_fixture');

test('parallel expedition goals retain complete results and stop their only child',async()=>{
  const {parallelExpeditionGoals}=require('../../src/infrastructure/workers/recommendation_worker'),r=require('../../src/recommendation/index');
  const store=fixture();for(const ship of Object.values(store.info.ships)){
    ship.api_cond=60;for(const key of ['api_karyoku','api_taiku','api_taisen','api_sakuteki'])ship[key]=[100,100];
  }
  const before=JSON.stringify(store);
  for(const missionId of [1,103,104]){
    const args={missionId,fleet:2,fixedFlagshipId:1,heldSlots:[{id:1,slots:[-1,-1],keep:{0:true}}]},created=[];
    const result=await parallelExpeditionGoals(store,args,{createWorker:(file,options)=>{
      assert.equal(options.workerData.kind,'expedition-goal');assert.equal(options.workerData.args.goal,'great');
      const worker=new Worker(file,options);created.push(worker);return worker;
    }});
    assert.deepEqual(result,r.recommendExpeditionGoals(store,args));assert.equal(created.length,1);assert.equal(created[0].threadId,-1);
  }
  assert.equal(JSON.stringify(store),before);
});

test('expedition child errors, early exits and local failures terminate the child without partial results',async()=>{
  const {parallelExpeditionGoals}=require('../../src/infrastructure/workers/recommendation_worker');
  for(const kind of ['error','exit','remote','local']){
    let worker,stopped=0,merged=0;
    const task=parallelExpeditionGoals(fixture(),{missionId:1,fleet:2},{
      ...(kind==='local'?{scope:()=>{throw Error('local failure');}}:{}),
      cache:{mergeEquipmentEntries:()=>merged++,mergeHullEntries:()=>merged++},
      createWorker:()=>{
        worker=new EventEmitter();worker.terminate=async()=>{stopped++;worker.emit('exit',1);};
        if(kind!=='local')setImmediate(()=>kind==='remote'?worker.emit('message',{ok:false,error:{message:'remote failure',code:'CHILD_FAILURE'}}):worker.emit(kind,kind==='error'?Error('child failure'):0));
        return worker;
      }});
    await assert.rejects(task,kind==='local'?/local failure/:kind==='remote'?/remote failure/:kind==='exit'?/提前退出/:/child failure/);
    assert.equal(stopped,1);assert.equal(merged,0);
  }
});

test('CPU budget reserves host capacity and caps the compute pool',()=>{
  assert.deepEqual([1,2,3,4,6,8,16,32].map(parallelism),[1,1,1,2,4,6,6,6]);
  assert.equal(new RecommendationPool({}, {size:6}).size,6);
  assert.equal(new RecommendationPool({}, {size:8}).size,8);
  assert.equal(new RecommendationPool({}, {size:100}).size,8);
});

test('out-of-order batches preserve order, share each snapshot once and reuse bounded workers',async()=>{
  const store={privateSnapshot:true},created=[];
  const pool=new RecommendationPool(store,{size:8,createWorker:(_file,options)=>{
    assert.equal(options.workerData.store,store);
    const worker=new EventEmitter();worker.stopped=false;created.push(worker);
    worker.postMessage=({id,batch})=>setTimeout(()=>worker.emit('message',{id,result:batch.items.map(n=>n*2)}),batch.items[0]===0?30:1);
    worker.terminate=async()=>{worker.stopped=true;worker.emit('exit',0);};return worker;
  }});
  try{
    const items=Array.from({length:240},(_,i)=>i);
    for(let i=0;i<2;i++)assert.deepEqual(await pool.run({kind:'seeds',items},()=>assert.fail('unexpected fallback')),items.map(n=>n*2));
    assert.equal(created.length,8);
    assert.equal(await pool.run({items:[1]},()=>42),42);
  }finally{await pool.dispose();}
  assert(created.every(w=>w.stopped));
});

test('a crashed child fails the batch and terminates siblings without leaving pending work',async()=>{
  const workers=[];
  const pool=new RecommendationPool({}, {size:2,createWorker:()=>{
    const worker=new EventEmitter();workers.push(worker);
    worker.postMessage=()=>setImmediate(()=>worker.emit('error',Error('test crash')));
    worker.terminate=async()=>{worker.stopped=true;worker.emit('exit',1);};return worker;
  }});
  await assert.rejects(pool.run({kind:'seeds',items:new Array(60).fill(0)},()=>{}),/test crash/);
  assert(workers.every(w=>w.stopped));assert.equal(pool.workers.length,0);
});

test('real threads preserve complete results, fixed ships, held slots and the input snapshot',async()=>{
  const store=fixture(),before=structuredClone(store);
  const args={area:'2-3',byRoute:true,airGoal:'superiority',fixedShipIds:[1],excludedShipIds:[8],
    heldSlots:[{id:1,slots:[-1,-1],keep:{0:true},pin:true}],automaticFilters:{excludeUnremodeled:false}};
  const expected=recommendNormalFleet(store,args);
  for(const size of [6,8]){
    const pool=new RecommendationPool(store,{size}),stages=[];
    try{
      const result=await recommendNormalFleetParallel(store,args,(b,f)=>{stages.push(b.kind);return pool.run(b,f);});
      assert.equal(pool.workers.length,size,'exercise every requested calculation thread');
      assert.deepEqual(result,expected);assert.deepEqual(store,before);
      for(const kind of ['path-fit','los-fit','combat','refinement'])assert(stages.includes(kind),kind);
      assert.equal(stages.filter(kind=>kind==='refinement').length,2,'each round waits for its accepted bases');
    }finally{await pool.dispose();}
  }
});

test('late fitting preserves a manually positioned ship and legacy non-route recommendations',async()=>{
  const store=fixture(),before=structuredClone(store);
  for(const byRoute of [true,false]){
    const args={area:byRoute?'2-3':'1-1',byRoute,airGoal:'superiority',fixedShipIds:[1],
      heldSlots:[null,null,null,{id:1,slots:[-1,-1],keep:{0:true},pin:true}],
      automaticFilters:{excludeUnremodeled:false}};
    const expected=recommendNormalFleet(store,args),pool=new RecommendationPool(store,{size:2});
    try{
      assert.deepEqual(await recommendNormalFleetParallel(store,args,(b,f)=>pool.run(b,f)),expected);
      assert.deepEqual(store,before);
      assert(expected.recommendations.length>0);
      for(const row of expected.recommendations){
        assert.equal(row.scheme.ships[Math.min(3,row.scheme.ships.length-1)].id,1);
        assert.equal(row.scheme.ships.find(s=>s.id===1).slots[0],-1);
      }
    }finally{await pool.dispose();}
  }
});

test('small fitting jobs reuse warm workers, preserve trial order and keep tiny maps local',async()=>{
  const received=[],created=[],pool=new RecommendationPool({}, {size:6,createWorker:()=>{
    const worker=new EventEmitter();created.push(worker);
    worker.postMessage=({id,batch})=>{
      received.push({worker:created.indexOf(worker),kind:batch.kind,items:batch.items});
      setTimeout(()=>worker.emit('message',{id,result:batch.items}),batch.items[0]===0?15:1);
    };
    worker.terminate=async()=>{};return worker;
  }});
  try{
    const items=Array.from({length:12},(_,i)=>i);
    for(const kind of ['path-fit','los-fit','combat','refinement','speed-fit','speed-refit']){
      assert.equal(await pool.run({kind,items},()=>42),42);
      assert.equal(created.length,0,'a short final stage must not start a cold pool');
    }
    await pool.run({kind:'hulls',estimatedWork:3000,items:[]},()=>assert.fail());
    for(const kind of ['path-fit','los-fit','combat','refinement','speed-fit','speed-refit']){
      received.length=0;
      assert.deepEqual(await pool.run({kind,items},()=>assert.fail('warm workers should fit')),items);
      assert.equal(new Set(received.map(r=>r.worker)).size,6);
      assert.equal(await pool.run({kind,items:[1,2,3]},()=>42),42,'tiny batches still stay local');
    }
    assert.equal(created.length,6,'fitting reuses the existing pool');
    received.length=0;
    const combat=Array.from({length:123},(_,i)=>i);
    assert.deepEqual(await pool.run({kind:'combat',items:combat},()=>assert.fail()),combat);
    assert.equal(received.length,12,'many combat alternatives use two waves instead of dozens of tiny batches');
    assert(received.every(r=>r.items.length<=12));
    assert.equal(new Set(received.map(r=>r.worker)).size,6);
    received.length=0;
    const gear=Array.from({length:25},(_,i)=>i);
    assert.deepEqual(await pool.run({kind:'gear',items:gear},()=>assert.fail()),gear);
    assert.equal(new Set(received.map(r=>r.worker)).size,6,'gear trials reuse all warm workers');
    assert(received.every(r=>r.items.length<=2),'small trial batches limit expensive stragglers');
  }finally{await pool.dispose();}
});

test('outer jobs remain serialized and disposing cancels both running and queued requests',async()=>{
  const {RecommendationWorker}=require('../../src/infrastructure/workers/recommendation_worker');
  const workers=[],runner=new RecommendationWorker({createWorker:()=>{
    const worker=new EventEmitter();workers.push(worker);
    worker.terminate=async()=>{worker.stopped=true;worker.emit('exit',1);};return worker;
  }});
  const first=runner.run('recommendNormalFleet',{},{}),second=runner.run('recommendNormalFleet',{},{});
  const outcomes=Promise.allSettled([first,second]);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(workers.length,1);
  await runner.dispose();
  for(const row of await outcomes){assert.equal(row.status,'rejected');assert.equal(row.reason.code,'RECOMMENDATION_CANCELLED');}
  assert(workers[0].stopped);assert.equal(workers.length,1);
});

test('terminating a coordinator also terminates nested workers',async()=>{
  const buffer=new SharedArrayBuffer(4),counter=new Int32Array(buffer);
  const worker=new Worker(`
    const {Worker,workerData,parentPort}=require('worker_threads');
    const child=new Worker('const {workerData,parentPort}=require("worker_threads"); const a=new Int32Array(workerData); Atomics.add(a,0,1);parentPort.postMessage("ready");setInterval(()=>Atomics.add(a,0,1),5)',{eval:true,workerData});
    child.once('message',()=>parentPort.postMessage('ready'));
  `,{eval:true,workerData:buffer});
  try{
    await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});
    await worker.terminate();const count=Atomics.load(counter,0);assert(count>0);
    await new Promise(resolve=>setTimeout(resolve,60));assert.equal(Atomics.load(counter,0),count);
  }finally{await worker.terminate();}
});

test('small hull enumerations stay local without starting threads',async()=>{
  const pool=new RecommendationPool({}, {createWorker:()=>assert.fail('tiny hulls must not start threads')});
  try{assert.equal(await pool.run({kind:'hulls',items:[1,2,3,4,5,6],estimatedWork:1999},()=>42),42);}
  finally{await pool.dispose();}
});

test('large hull jobs spread across the entire pool regardless of how few fleet sizes remain',async()=>{
  const received=[],pool=new RecommendationPool({}, {size:6,createWorker:()=>{
    const worker=new EventEmitter();
    worker.postMessage=({id,batch})=>{received.push(batch.items[0]);
      setTimeout(()=>worker.emit('message',{id,result:batch.items}),batch.items[0].index===0?20:1);};
    worker.terminate=async()=>{};return worker;
  }});
  try{
    const expected=Array.from({length:6},(_,index)=>({index,count:6}));
    assert.deepEqual(await pool.run({kind:'hulls',items:[{index:0,count:1}],estimatedWork:3000},()=>assert.fail('large hull job')),expected);
    assert.deepEqual(received,expected);assert.equal(pool.workers.length,6);
  }finally{await pool.dispose();}
});
