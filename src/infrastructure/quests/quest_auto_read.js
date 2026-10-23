'use strict';

// Coordinates a single background quest-list read across both workbenches.
// The host supplies an opaque session key and performs its own final guard
// immediately before any request. This component knows no game credentials.
class QuestAutoRead {
  constructor({now=()=>Date.now(),getContext,getQuestState,read,stableMs=2000,initialState}={}){
    if(typeof getContext!=='function'||typeof getQuestState!=='function'||typeof read!=='function')
      throw new TypeError('QuestAutoRead requires getContext, getQuestState and read');
    this.now=now;this.getContext=getContext;this.getQuestState=getQuestState;this.read=read;
    this.stableMs=Number.isFinite(stableMs)&&stableMs>=0?stableMs:2000;
    this.owners=new Set();this.consumed=new Set();this.stable=null;
    this.generation=0;this.probing=false;this.operation=null;this.closed=false;
    if(initialState)this.restore(initialState);
  }
  setActive(owner,active){
    if(this.closed)return;
    const before=this.owners.size>0;
    if(active)this.owners.add(owner);else this.owners.delete(owner);
    const after=this.owners.size>0;
    // Both pages can be mounted simultaneously; hiding one must not cancel
    // the other owner's request or stable interval.
    if(before!==after){
      this.generation++;this.stable=null;
      if(!after)this.operation?.controller.abort();
    }
  }
  snapshot(){
    return {version:1,consumed:[...this.consumed].sort()};
  }
  restore(snapshot){
    if(this.closed||snapshot?.version!==1||!Array.isArray(snapshot.consumed))return;
    for(const key of snapshot.consumed)if(typeof key==='string'&&key.trim())this.consumed.add(key);
  }
  dispose(){
    if(this.closed)return;
    this.closed=true;this.generation++;this.owners.clear();this.stable=null;
    this.operation?.controller.abort();
  }
  safe(context){
    return typeof context?.sessionKey==='string'&&!!context.sessionKey.trim()&&
      context.ready===true&&context.idle===true&&context.compatible===true;
  }
  current(generation){return !this.closed&&this.owners.size>0&&generation===this.generation;}
  cancelled(){return {status:this.closed?'disposed':this.owners.size?'deferred':'inactive'};}
  cached(key){
    const identified=typeof key==='string'&&!!key.trim();
    if(identified)this.consumed.add(key);this.stable=null;
    if(this.operation){
      if(!identified||this.operation.sessionKey===key)this.operation.cacheCancelled=true;
      this.operation.controller.abort();
    }
    return {status:'cached'};
  }
  async prepare(){
    if(this.closed)return {status:'disposed'};
    if(!this.owners.size)return {status:'inactive'};
    if(this.probing)return {status:'inflight'};
    this.probing=true;
    const generation=this.generation;
    try{
      const context=await this.getContext();
      if(!this.current(generation))return this.cancelled();
      const safe=this.safe(context),key=context?.sessionKey;
      // Already observed tasks cancel the opportunity even while a fleet
      // operation or an incompatible page prevents background access.
      const state=await this.getQuestState();
      if(!this.current(generation))return this.cancelled();
      if(state?.known===true)return this.cached(key);
      if(!safe){
        this.stable=null;this.operation?.controller.abort();
        return {status:'unsafe'};
      }
      if(this.operation){
        if(this.operation.sessionKey!==key){this.stable=null;this.operation.controller.abort();}
        return {status:'inflight'};
      }
      if(this.consumed.has(key)){this.stable=null;return {status:'spent'};}
      const time=Number(this.now());
      if(!this.stable||this.stable.sessionKey!==key||time<this.stable.since){
        this.stable={sessionKey:key,since:time};
      }
      if(time-this.stable.since<this.stableMs)return {status:'waiting'};
      // A context probe may itself take time. Verify safety, session and
      // naturally observed tasks again after the entire stable interval.
      const latest=await this.getContext();
      if(!this.current(generation))return this.cancelled();
      if(!this.safe(latest)){this.stable=null;return {status:'unsafe'};}
      if(latest.sessionKey!==key){this.stable=null;return {status:'deferred'};}
      const natural=await this.getQuestState();
      if(!this.current(generation))return this.cancelled();
      if(natural?.known===true)return this.cached(key);
      if(this.consumed.has(key)){this.stable=null;return {status:'spent'};}
      const operation={sessionKey:key,generation,controller:new AbortController(),started:false,cacheCancelled:false};
      this.operation=operation;this.stable=null;
      return {operation};
    }catch(error){
      // A failed readiness probe has not attempted a read and can be retried
      // after another stable interval. Do not surface host details to the UI.
      this.stable=null;this.operation?.controller.abort();
      return this.closed?{status:'disposed'}:{status:'deferred'};
    }finally{this.probing=false;}
  }
  async tick(){
    const prepared=await this.prepare();
    if(!prepared.operation)return prepared;
    const operation=prepared.operation;
    try{
      if(!this.current(operation.generation)||operation.controller.signal.aborted)return this.cancelled();
      operation.started=true;this.consumed.add(operation.sessionKey);
      const outcome=await this.read({signal:operation.controller.signal,sessionKey:operation.sessionKey});
      if(outcome?.deferred===true||outcome?.status==='deferred'){
        if(!operation.cacheCancelled)this.consumed.delete(operation.sessionKey);
        return this.closed?{status:'disposed'}:{status:'deferred'};
      }
      return this.closed?{status:'disposed'}:{status:'read'};
    }catch(error){
      // Calling the reader is an attempt. A genuine read failure, timeout or
      // interruption is not retried automatically during this session.
      return this.closed?{status:'disposed'}:{status:'failed'};
    }finally{
      if(this.operation===operation)this.operation=null;
    }
  }
}

module.exports={QuestAutoRead};
