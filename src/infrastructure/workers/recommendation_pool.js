'use strict';
const workerStarted=performance.now();
const perf=require('../../shared/performance_trace');
const {parallelism}=require('../../config/computation_settings');
const {Worker,isMainThread,parentPort,workerData}=require('worker_threads');
const {withEquipmentIndexCache}=require('../../domain/fleet/equipment_planner');
const {BatchReceiver}=require('./batch_transport');
const v8=require('v8');

// Leave CPU capacity for poi/game rendering. The coordinator only dispatches
// while these workers run; dependent search stages still use one thread.

if(!isMainThread&&workerData?.kind==='recommendation-batch'){
  const trace=workerData.diagnostics?new perf.PerformanceTrace(workerData.diagnostics):null;
  const {cacheDirectory,version,cacheMaxBytes}=workerData,indexes=new Map(),planningIndexes=new Map();
  const store=v8.deserialize(Buffer.from(workerData.snapshot));
  const {CalculationCache,withCalculationCache}=require('../../shared/calculation_cache');
  const {RecommendationCache}=require('../cache/recommendation_cache');
  // Only the coordinator persists tables: token dictionaries must never be
  // overwritten by a sibling worker's independently allocated token numbers.
  const storage=cacheDirectory?new RecommendationCache(cacheDirectory,{version,maxBytes:cacheMaxBytes}):null;
  if(storage)storage.write=()=>{};
  const cache=storage?new CalculationCache(storage):null;
  const run=fn=>cache?withCalculationCache(cache,fn,{flush:false}):fn();
  const calculate=require('../../recommendation/index').recommendationBatch;
  const startupMs=trace?performance.now()-workerStarted:0;
  const receiver=new BatchReceiver();
  parentPort.on('message',message=>{
    const {id}=message;
    try{
      const batch=receiver.read(message);
      const started=trace?performance.now():0;
      const compute=()=>{
        const token=perf.begin('batch.'+batch.kind);
        try{return batch.kind==='cache'?{equipment:cache?.equipmentEntries()||[],hulls:cache?.hullEntries()||[]}:
          run(()=>require('../../domain/routes/route_plans').withPlanningCache(()=>
            withEquipmentIndexCache(store,()=>calculate(store,batch),indexes),planningIndexes));}
        finally{perf.end(token);}
      };
      const result=trace?trace.run(compute):compute();
      parentPort.postMessage({id,result,...trace?{computeMs:performance.now()-started,
        ...(batch.kind==='cache'?{profile:{...trace.snapshot(),startupMs,calculationStats:cache?.stats||{}}}:{})}:{}});
    }catch(e){parentPort.postMessage({id,error:{message:e.message,code:e.code,stack:e.stack}});}
  });
}

class RecommendationPool {
  constructor(store,{size=parallelism(),cacheDirectory,version,cacheMaxBytes,mergeEquipmentEntries,mergeHullEntries,createWorker=(file,options)=>new Worker(file,options)}={}){
    // Explicit resource settings may use eight; the automatic cap stays six.
    this.store=store;this.size=Math.max(1,Math.min(8,Math.floor(size)||1));
    this.cacheDirectory=cacheDirectory;this.version=version;this.createWorker=createWorker;
    this.cacheMaxBytes=cacheMaxBytes;
    this.mergeEquipmentEntries=mergeEquipmentEntries;this.mergeHullEntries=mergeHullEntries;
    this.workers=[];this.closed=false;this.nextId=0;this.nextBatchId=0;
    this.trace=perf.current();
  }
  spawn(){
    if(!this.snapshot)this.snapshot=perf.measure('workers.snapshot',()=>{
      const bytes=v8.serialize(this.store),shared=new SharedArrayBuffer(bytes.length);
      new Uint8Array(shared).set(bytes);perf.count('workers.snapshot.bytes',bytes.length);return shared;
    });
    // Only bytes are shared. Each worker reconstructs its own private objects
    // once, preserving the original isolation and immutable search scope.
    const worker=this.createWorker(__filename,{workerData:{kind:'recommendation-batch',snapshot:this.snapshot,
      cacheDirectory:this.cacheDirectory,version:this.version,cacheMaxBytes:this.cacheMaxBytes,
      diagnostics:this.trace?{level:this.trace.level}:null}});
    const slot={worker,pending:null,failure:null,index:this.workers.length};
    const fail=error=>{slot.failure=error;const pending=slot.pending;slot.pending=null;pending?.reject(error);};
    worker.on('error',fail);
    worker.on('exit',code=>fail(Error(`候选计算线程已退出（${code}）`)));
    worker.on('message',message=>{
      const pending=slot.pending;if(!pending||pending.id!==message.id)return;
      slot.pending=null;
      if(this.trace){
        const key=slot.index+':'+pending.kind;
        let row=this.trace.dispatch.find(row=>row.key===key);
        if(!row){row={key,worker:slot.index,kind:pending.kind,batches:0,items:0,roundTripMs:0,computeMs:0};this.trace.dispatch.push(row);}
        row.batches++;row.items+=pending.items;row.roundTripMs+=performance.now()-pending.started;row.computeMs+=message.computeMs||0;
        if(message.profile)this.trace.children.push({worker:slot.index,...message.profile});
      }
      if(message.error)pending.reject(Object.assign(Error(message.error.message),message.error));
      else pending.resolve(message.result);
    });
    this.workers.push(slot);return slot;
  }
  execute(slot,batch,items=batch.items){
    if(slot.failure)return Promise.reject(slot.failure);
    return new Promise((resolve,reject)=>{
      const id=++this.nextId;slot.pending={id,resolve,reject,...this.trace?
        {kind:batch.kind,items:items?.length||0,started:performance.now()}: {}};
      try{
        let header;
        if(slot.batch!==batch){
          slot.batch=batch;slot.batchId=++this.nextBatchId;
          const {items:unused,...common}=batch;header=common;
          if(this.trace)perf.count('workers.header.sent');
        }else if(this.trace)perf.count('workers.header.reused');
        slot.worker.postMessage({id,batchId:slot.batchId,...header?{header}:{},items});
      }catch(e){slot.pending=null;reject(e);}
    });
  }
  async run(batch,fallback,onProgress=()=>{}){
    if(this.closed)throw Error('候选计算线程池已关闭');
    // Tiny inputs cost less to calculate locally than to clone/start workers.
    const hulls=batch.kind==='hulls',fitting=['path-fit','los-fit','combat','refinement','speed-fit','speed-refit'].includes(batch.kind);
    // Finalists are few but expensive. Reuse already warm workers for small
    // fitting batches; a tiny map should not start a pool just for this stage.
    const minimum=fitting&&this.workers.length?4:24;
    if(this.size===1||(hulls?batch.estimatedWork<2000:batch.items.length<minimum))return fallback();
    // Registration is per invocation, even if a caller reuses a batch object
    // with a new phase/held-slot query after the previous invocation completed.
    batch={...batch};
    const count=hulls?this.size:Math.min(this.size,Math.max(
      Math.ceil(batch.items.length/(fitting?2:24)),
      batch.kind==='gear'?Math.min(this.workers.length,Math.ceil(batch.items.length/2)):0));
    // Fleet sizes are uneven workloads. Give every worker an interleaved part
    // of the SAME bounded enumeration, including its expensive six-ship leaves.
    if(hulls)batch={...batch,items:Array.from({length:count},(_,index)=>({index,count}))};
    // Larger combat batches get multiple waves, without rebuilding evaluation
    // context for every two fleets; each task takes at least two fleets.
    const chunkSize=hulls?1:batch.kind==='combat'?Math.max(2,Math.min(12,Math.ceil(batch.items.length/(count*2)))):
      fitting||batch.kind==='gear'?2:batch.kind==='seeds'?24:6,results=new Array(batch.items.length);
    let next=0,completed=0,lastReport=0;
    try{
      while(this.workers.length<count)this.spawn();
      await Promise.all(this.workers.slice(0,count).map(async slot=>{
        while(next<batch.items.length){
          const start=next;next+=chunkSize;
          const rows=await this.execute(slot,batch,batch.items.slice(start,start+chunkSize));
          for(let i=0;i<rows.length;i++)results[start+i]=rows[i];
          completed+=Math.min(chunkSize,batch.items.length-start);
          const now=Date.now();
          if(completed===batch.items.length||now-lastReport>=200){lastReport=now;onProgress({stage:batch.kind,completed,total:batch.items.length});}
        }
      }));
      return results;
    }catch(e){await this.dispose();throw e;}
  }
  async dispose(){
    this.closed=true;
    await Promise.all(this.workers.map(slot=>slot.worker.terminate()));
    this.workers=[];this.snapshot=null;
  }
  async flush(){
    if((!this.mergeEquipmentEntries&&!this.mergeHullEntries&&!this.trace)||this.closed)return;
    const results=await Promise.all(this.workers.map(slot=>this.execute(slot,{kind:'cache'})));
    for(const records of results){this.mergeEquipmentEntries?.(records.equipment);this.mergeHullEntries?.(records.hulls);}
  }
}
module.exports={RecommendationPool,parallelism};
