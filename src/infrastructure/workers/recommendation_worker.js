'use strict';
const workerStarted=performance.now();
const perf=require('../../shared/performance_trace');
const {Worker,isMainThread,parentPort,workerData}=require('worker_threads');
const METHODS=new Set(['recommendNormalFleet','recommendNormalEquipment','recommendExpeditionFleet','recommendExpeditionEquipment']);
const cancelled=()=>Object.assign(Error('推荐计算已取消'),{code:'RECOMMENDATION_CANCELLED'});

// The existing worker computes success while ONE child computes great success.
// No idle third coordinator, and only the owner persists shared cache tables.
async function parallelExpeditionGoals(store,args,{scope=fn=>fn(),cache={},createWorker=(file,options)=>new Worker(file,options)}={}){
  const worker=createWorker(__filename,{workerData:{kind:'expedition-goal',store,args:{...args,goal:'great'},
    cacheDirectory:cache.cacheDirectory,version:cache.version,cacheMaxBytes:cache.cacheMaxBytes}});
  const pending=new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(error,message)=>{if(settled)return;settled=true;error?reject(error):resolve(message);};
    worker.once('message',message=>finish(message.ok?null:Object.assign(Error(message.error.message),message.error),message));
    worker.once('error',error=>finish(error));
    worker.once('exit',code=>finish(Error(`远征计算线程提前退出（${code}）`)));
  });
  // A local failure must still stop/drain the child without an unhandled rejection.
  pending.catch(()=>{});
  try{
    const success=scope(()=>require('../../recommendation/index').recommendExpeditionFleet(store,{...args,goal:'success'}));
    const message=await pending;
    cache.mergeEquipmentEntries?.(message.equipment||[]);
    cache.mergeHullEntries?.(message.hulls||[]);
    return {success,great:message.result};
  }finally{await worker.terminate();}
}

if(!isMainThread&&workerData?.kind==='expedition-goal'){
  try{
    const {CalculationCache,withCalculationCache}=require('../../shared/calculation_cache');
    const {RecommendationCache}=require('../cache/recommendation_cache');
    const storage=workerData.cacheDirectory?new RecommendationCache(workerData.cacheDirectory,{version:workerData.version,maxBytes:workerData.cacheMaxBytes}):null;
    if(storage)storage.write=()=>{};
    const cache=storage?new CalculationCache(storage):null;
    const calculate=()=>require('../../recommendation/index').recommendExpeditionFleet(workerData.store,workerData.args);
    const result=cache?withCalculationCache(cache,calculate,{flush:false}):calculate();
    parentPort.postMessage({ok:true,result,equipment:cache?.equipmentEntries()||[],hulls:cache?.hullEntries()||[]});
  }catch(e){parentPort.postMessage({ok:false,error:{message:e.message,code:e.code,stack:e.stack}});}
}

// Pure calculations only: snapshots cross the thread boundary, never the live
// controller, game bridge or account-storage service.
async function runRecommendation(workerData){
  const trace=workerData.diagnostics?new perf.PerformanceTrace(workerData.diagnostics):null;
  if(trace)trace.stages.push({name:'worker.load',ms:performance.now()-workerStarted});
  const report=status=>trace?{version:1,status,level:trace.level,method:workerData.method,
    area:workerData.args?.area||null,phase:workerData.args?.phase||null,
    workerMs:performance.now()-workerStarted,stages:trace.stages,...trace.snapshot(),
    children:trace.children,dispatch:trace.dispatch,implementation:trace.implementation||null,
    runtime:{plugin:require('../../../package.json').version,node:process.versions.node,v8:process.versions.v8,
      execution:process.type==='utility'?'utility-process':'worker-thread',
      ...(process.type==='utility'?{peakRssMiB:process.resourceUsage().maxRSS/1024}:{})}}:undefined;
  const execute=async()=>{
  try{
    if(!METHODS.has(workerData.method))throw Error('Unsupported recommendation method');
    const result=workerData.method==='recommendNormalFleet'?await require('../cache/recommendation_cache').cachedRecommendationAsync(
      workerData.cacheDir,workerData.method,workerData.store,workerData.args,async(scope,cache)=>{
        const {pool,recommend}=perf.stage('search.setup',()=>{
          const {RecommendationPool}=require('./recommendation_pool');
          return {pool:new RecommendationPool(workerData.store,{...cache,
            size:require('../../config/computation_settings').resources(workerData.settings).effectiveThreads}),
          recommend:require('../../recommendation/index').recommendNormalFleetParallel};
        });
        try{
          const result=await recommend(workerData.store,workerData.args,
            (batch,fallback)=>pool.run(batch,fallback),scope);
          await perf.stageAsync('workers.flush',()=>pool.flush());return result;
        }
        finally{await perf.stageAsync('workers.dispose',()=>pool.dispose());}
      },workerData.settings):workerData.method==='recommendExpeditionFleet'?
      await require('../cache/recommendation_cache').cachedExpeditionRecommendationAsync(workerData.cacheDir,workerData.store,workerData.args,
        (args,scope,cache)=>perf.stageAsync('batch.expedition',()=>require('../../config/computation_settings').resources(workerData.settings).effectiveExpeditionThreads===1?
          scope(()=>require('../../recommendation/index').recommendExpeditionGoals(workerData.store,args)):
          parallelExpeditionGoals(workerData.store,args,{scope,cache})),workerData.settings):
      require('../cache/recommendation_cache').cachedRecommendation(workerData.cacheDir,
      workerData.method,workerData.store,workerData.args,
      ()=>perf.stage('search.sync',()=>require('../../recommendation/index')[workerData.method](workerData.store,workerData.args)),workerData.settings);
    return {ok:true,result,profile:report('success')};
  }catch(e){return {ok:false,error:{message:e.message,code:e.code,stack:e.stack},profile:report('error')};}
  };
  return trace?trace.run(execute):execute();
}
if(!isMainThread&&workerData?.kind==='fleet-recommendation')
  void runRecommendation(workerData).then(message=>parentPort.postMessage(message));

class RecommendationWorker {
  constructor({createWorker=(filename,options)=>new Worker(filename,options),cacheDir,getSettings=()=>undefined,
    getDiagnostics=()=>perf.options(),onProfile}={}){
    this.createWorker=createWorker;this.cacheDir=cacheDir;this.pending=Promise.resolve();this.active=null;this.closed=false;
    this.getSettings=getSettings;this.queued=0;this.generation=0;
    this.getDiagnostics=getDiagnostics;this.onProfile=onProfile;this.lastProfile=null;
  }
  // Cache maintenance uses this same queue, so an older search cannot refill
  // files immediately after the user has cleared them.
  maintain(operation){return this.enqueue(operation);}
  enqueue(operation){
    if(this.closed)return Promise.reject(cancelled());
    this.queued++;
    const task=this.pending.then(()=>{if(this.closed)throw cancelled();return operation();});
    const tracked=task.finally(()=>{this.queued--;});
    this.pending=tracked.catch(()=>{});return tracked;
  }
  run(method,store,args){
    if(this.closed)return Promise.reject(cancelled());
    if(!METHODS.has(method))return Promise.reject(Error('Unsupported recommendation method'));
    const requested=this.getDiagnostics(),diagnostics=requested?{level:requested.level==='modules'?'modules':'stages'}:null;
    const queuedAt=diagnostics?performance.now():0,generation=this.generation;
    // Serialize heavy work from different tabs/MCP callers to avoid CPU spikes.
    return this.enqueue(()=>{
      if(generation!==this.generation)throw cancelled();
      return new Promise((resolve,reject)=>{
        const settings=require('../../config/computation_settings').normalize(this.getSettings());
        const started=diagnostics?performance.now():0;
        const worker=this.createWorker(__filename,{workerData:{kind:'fleet-recommendation',method,store,args,cacheDir:this.cacheDir,settings,diagnostics}});
        let finishing=false,received=false,wasCancelled=false,completion;
        const active={worker,cancel:()=>{wasCancelled=true;return finish(cancelled());}};
        const finish=(reason,result,message)=>{
          if(finishing)return completion;finishing=true;
          completion=(async()=>{
            const receivedAt=performance.now();
            try{
              // Reap before the next request or maintenance: no orphan workers,
              // late writes after clear, or accumulating per-search heaps.
              await worker.terminate();
            }catch(error){
              this.closed=true;reason=Object.assign(Error(error?.message||'计算进程回收失败'),error);
              this.cleanupFailure={worker,error:reason};
            }
            if(diagnostics&&message?.profile){
              const elapsedMs=receivedAt-started;
              this.lastProfile={...message.profile,elapsedMs,queueMs:started-queuedAt,
                startupAndTransferMs:Math.max(0,elapsedMs-message.profile.workerMs),
                teardownMs:performance.now()-receivedAt};
              perf.publish(this.lastProfile);
              try{await this.onProfile?.(this.lastProfile);}catch(_){/* Diagnostics never fail a recommendation. */}
            }
            if(this.active===active)this.active=null;
            if(this.cleanupFailure)reject(this.cleanupFailure.error);
            else if(wasCancelled)reject(cancelled());else if(reason)reject(Object.assign(Error(reason.message||String(reason)),reason));
            else resolve(result);
          })();
          return completion;
        };
        this.active=active;
        worker.once('message',message=>{
          received=true;
          if(!message||typeof message.ok!=='boolean')return void finish(Error('推荐进程返回了无效结果'));
          void finish(message.ok?null:message.error||Error('推荐计算失败'),message.result,message);
        });
        worker.once('error',e=>{if(!received)void finish(e);});
        worker.once('exit',code=>{if(!received)void finish(Error('推荐计算提前退出（'+code+'）'));});
      });
    });
  }
  async cancel(){
    this.generation++;
    await this.active?.cancel();
    if(this.cleanupFailure){
      // A failed kill must also fail unload/hot reload. A later confirmed exit
      // permits cleanup, but this closed queue is never reused for searches.
      await this.cleanupFailure.worker.terminate();
      this.cleanupFailure=null;
    }
  }
  async dispose(){
    this.closed=true;
    await this.cancel();
    await this.pending;
  }
}
module.exports={RecommendationWorker,parallelExpeditionGoals,runRecommendation};
