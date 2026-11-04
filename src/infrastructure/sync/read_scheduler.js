'use strict';

// The reader's context probes and its ticket are shared mutable state. Keep
// every probe and every complete read transaction, including pagination, in
// one FIFO across background synchronization and MCP clients.
class ReadScheduler {
  constructor({reader,spacingMs=250,now=()=>Date.now()}={}){
    if(!reader||typeof reader.context!=='function'||typeof reader.read!=='function'||typeof reader.readAll!=='function')
      throw new TypeError('ReadScheduler requires a complete reader');
    this.reader=reader;this.spacingMs=Number.isFinite(spacingMs)&&spacingMs>=0?spacingMs:250;this.now=now;
    this.queue=[];this.jobs=new Map();this.active=null;this.closed=false;this.lastReadAt=null;
    this.running=false;this.idleWaiters=[];this.lastSessionKey=null;
  }
  context(options={}){
    return this.enqueue('context',options,{cached:options.cached===true});
  }
  read(options={}){
    return this.enqueue('read',options,{sessionKey:options.sessionKey??null,kind:options.kind??'quest',
      page:options.page??null,enemyId:options.enemyId??null});
  }
  async readAll(options={}){
    if(this.closed||options.signal?.aborted)return this.deferred('readAll');
    let sessionKey=options.sessionKey||this.lastSessionKey;
    // MCP callers need not pass a session. Bind them to the currently
    // observed opaque session so they can share a pending automatic read.
    if(!sessionKey){
      const context=await this.context({cached:true,signal:options.signal});
      if(!context?.ready||!context.sessionKey||options.signal?.aborted)return this.deferred('readAll');
      sessionKey=context.sessionKey;
    }
    return this.enqueue('readAll',{...options,sessionKey},{sessionKey});
  }
  deferred(kind){return kind==='readAll'?{status:'deferred'}:kind==='context'?
    {ready:false,idle:false,compatible:false,sessionKey:null}:{deferred:true};}
  enqueue(kind,options,keyParts){
    const signal=options?.signal;
    if(this.closed||signal?.aborted)return Promise.resolve(this.deferred(kind));
    const key=JSON.stringify([kind,keyParts]);let job=this.jobs.get(key);
    if(!job){
      const args={...options};delete args.signal;
      job={kind,key,args,controller:new AbortController(),waiters:new Set(),active:false};
      this.jobs.set(key,job);this.queue.push(job);
    }
    return new Promise((resolve,reject)=>{
      const waiter={resolve,reject,signal,onAbort:null,done:false};
      waiter.onAbort=()=>{
        this.finishWaiter(job,waiter,null,this.deferred(kind));
        if(job.waiters.size===0){
          if(this.jobs.get(job.key)===job)this.jobs.delete(job.key);
          job.controller.abort();
          if(!job.active){const index=this.queue.indexOf(job);if(index>=0)this.queue.splice(index,1);}
        }
      };
      job.waiters.add(waiter);
      signal?.addEventListener('abort',waiter.onAbort,{once:true});
      // Recheck after installing the listener to cover cancellation races.
      if(signal?.aborted)waiter.onAbort();
      this.pump();
    });
  }
  finishWaiter(job,waiter,error,value){
    if(waiter.done)return;
    waiter.done=true;job.waiters.delete(waiter);waiter.signal?.removeEventListener('abort',waiter.onAbort);
    if(error)waiter.reject(error);else waiter.resolve(value);
  }
  async delay(job){
    if(job.kind==='context'||this.lastReadAt===null)return;
    const elapsed=Number(this.now())-this.lastReadAt;
    const remaining=Number.isFinite(elapsed)&&elapsed>=0?Math.max(0,this.spacingMs-elapsed):this.spacingMs;
    if(!remaining||job.controller.signal.aborted)return;
    await new Promise(resolve=>{
      const signal=job.controller.signal;
      const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();};
      const timer=setTimeout(finish,remaining);
      signal.addEventListener('abort',finish,{once:true});
      if(signal.aborted)finish();
    });
  }
  async pump(){
    if(this.running)return;
    this.running=true;
    try{
      while(!this.closed&&this.queue.length){
        const job=this.queue.shift();
        if(!job.waiters.size||job.controller.signal.aborted)continue;
        this.active=job;job.active=true;
        try{
          await this.delay(job);
          if(this.closed||job.controller.signal.aborted||!job.waiters.size)continue;
          if(job.kind!=='context')this.lastReadAt=Number(this.now());
          let result=await this.reader[job.kind]({...job.args,...(job.kind==='context'?{}:{signal:job.controller.signal})});
          if(job.controller.signal.aborted)result=this.deferred(job.kind);
          if(job.kind==='context'&&!job.controller.signal.aborted&&job.waiters.size)
            this.lastSessionKey=result?.ready&&typeof result.sessionKey==='string'?result.sessionKey:null;
          // A session can change without an observed game.start notification.
          // Do not keep binding later unqualified MCP reads to a stale key.
          if(job.kind==='readAll'&&result?.status==='deferred'&&this.lastSessionKey===job.args.sessionKey)
            this.lastSessionKey=null;
          for(const waiter of [...job.waiters])this.finishWaiter(job,waiter,null,result);
        }catch(error){
          for(const waiter of [...job.waiters])
            this.finishWaiter(job,waiter,job.controller.signal.aborted?null:error,
              job.controller.signal.aborted?this.deferred(job.kind):undefined);
        }finally{
          if(this.jobs.get(job.key)===job)this.jobs.delete(job.key);
          if(this.active===job)this.active=null;
        }
      }
    }finally{
      this.running=false;
      for(const resolve of this.idleWaiters.splice(0))resolve();
      if(!this.closed&&this.queue.length)void this.pump();
    }
  }
  observeRequest(...args){const result=this.reader.observeRequest?.(...args);this.active?.controller.abort();return result;}
  observeResponse(...args){const result=this.reader.observeResponse?.(...args);this.active?.controller.abort();return result;}
  observeFailure(...args){const result=this.reader.observeFailure?.(...args);this.active?.controller.abort();return result;}
  observeError(...args){const result=this.reader.observeError?.(...args);this.active?.controller.abort();return result;}
  observeStart(...args){
    // New login/document invalidates every queued operation and aborts any
    // active request; the old operation retains the lock until it settles.
    this.lastSessionKey=null;this.cancel();return this.reader.observeStart?.(...args);
  }
  cancel(){
    this.lastSessionKey=null;
    const jobs=[...this.queue];if(this.active)jobs.push(this.active);
    this.queue=[];
    for(const job of jobs){
      if(this.jobs.get(job.key)===job)this.jobs.delete(job.key);
      job.controller.abort();
      for(const waiter of [...job.waiters])this.finishWaiter(job,waiter,null,this.deferred(job.kind));
    }
  }
  async dispose(){
    if(!this.closed){this.closed=true;this.cancel();}
    if(this.running)await new Promise(resolve=>this.idleWaiters.push(resolve));
  }
}
module.exports={ReadScheduler};
