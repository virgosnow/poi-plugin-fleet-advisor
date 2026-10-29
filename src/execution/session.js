'use strict';
const {observationTimeout}=require('./observation_diagnostics');
const {TransitionTiming}=require('./transition_timing');
const {OPERATION_WAITS}=require('../config/experimental_settings');

class Session {
  constructor(host, observer, options = {}) {
    this.operationWaitMs=options.operationWaitMs??0;
    if(!OPERATION_WAITS.includes(this.operationWaitMs))throw new Error('Invalid extra operation wait');
    this.host = host; this.observer = observer;
    this.controlMode=typeof observer.read==='function';
    this.allowControlFallback=options.allowControlFallback===true;
    this.pendingMutation=false;
    this.now = options.now || (() => performance.now());
    this.deadline = this.now() + (options.timeoutMs || 180000);
    this.abort = new AbortController(); this.actionId = 0; this.frameId = 0;
    this.transitionTiming=new TransitionTiming();this.lastInput=null;
    this.metrics = {started: this.now(), inputs: 0, captures: 0, observations: 0, captureMs: 0, observeMs: 0,
      checks:0,hostCheckMs:0,validationMs:0,inputMs:0,waitMs:0,observationsByKind:{},controlReads:0,reusedFrames:0,delayedProbes:0,probeWaitMs:0,
      captureBreakdown:{checkMs:0,commandMs:0,base64Ms:0,maxCommandMs:0,maxEventLoopLagMs:0,slowCaptures:0},slowCaptures:[]};
    this.onProgress = options.onProgress || (() => {});
  }
  check(full = true) {
    if (this.abort.signal.aborted) throw new Error('Run stopped');
    if (this.now() >= this.deadline) throw new Error('Run deadline exceeded');
    const started=this.now();this.host.check(full);
    this.metrics.hostCheckMs+=this.now()-started;
    if (full) {
      this.metrics.checks++;
      if (this.validate) {const started=this.now();this.validate();this.metrics.validationMs+=this.now()-started;}
    }
  }
  stop() { this.lastFrame=null;this.lastInput=null;this.transitionTiming.clear();this.abort.abort();this.observer.releaseFrame?.();this.host.cancel(); }
  confirmMutation(){
    this.check();if(!this.pendingMutation)throw Error('No pending mutation to confirm');
    this.pendingMutation=false;this.metrics.confirmedMutations=(this.metrics.confirmedMutations||0)+1;
  }
  useImageObserver(observer){
    this.check();
    if(this.busy||this.pendingMutation||typeof observer?.observe!=='function'||typeof observer.read==='function')
      throw Error('Cannot switch recognition at this execution boundary');
    this.observer=observer;this.controlMode=false;this.allowControlFallback=false;
    this.resetImagePicker=true;
    this.lastFrame=null;this.lastInput=null;this.frameId++;this.transitionTiming.clear();
  }
  fail(error){
    // Only a rejected control read/preflight may leave the session available
    // for the controller's guarded image recovery. No input was submitted.
    if(this.allowControlFallback&&this.controlMode&&error.code==='CONTROL_RECOGNITION_UNAVAILABLE'&&!this.pendingMutation)this.check();
    else this.stop();
    return error;
  }
  async wait(ms) {
    this.check(false);
    const started=this.now();
    await new Promise(resolve => {
      const finish = () => { clearTimeout(timer); this.abort.signal.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, ms);
      this.abort.signal.addEventListener('abort', finish, {once: true});
    });
    this.metrics.waitMs+=this.now()-started;
    this.check(false);
  }
  async bounded(promise, timeoutMs = 15000) {
    this.check(false);
    let timer, onAbort;
    try {
      const result = await Promise.race([promise, new Promise((_, reject) => {
        onAbort = () => reject(new Error('Run stopped'));
        this.abort.signal.addEventListener('abort', onAbort, {once: true});
        timer = setTimeout(() => reject(new Error('Operation deadline exceeded')), Math.min(timeoutMs, this.deadline - this.now()));
      })]);
      this.check(false); return result;
    } finally { clearTimeout(timer); this.abort.signal.removeEventListener('abort', onAbort); }
  }
  async observe(kind, arg = {}, {reuseLastFrame=false} = {}) {
    this.check();
    if(this.busy)throw new Error('Session operation already running');
    this.busy=true;
    try {
    const action = this.actionId, frameId = ++this.frameId;
    let started = this.now();
    if(typeof this.observer.read==='function'){
      const result=await this.bounded(this.observer.read(kind,arg));
      const elapsed=this.now()-started;this.metrics.controlReads++;this.metrics.observations++;this.metrics.observeMs+=elapsed;
      const metrics=this.metrics.observationsByKind[kind]||(this.metrics.observationsByKind[kind]={calls:0,observeMs:0});
      metrics.calls++;metrics.observeMs+=elapsed;
      this.lastFrame={action,at:started};
      if(this.lastInput?.action===action)this.lastInput.probed=true;
      this.check();
      if(action!==this.actionId||frameId!==this.frameId)throw Error('Stale control observation');
      return result;
    }
    let frame,reused=false;
    if(reuseLastFrame&&this.lastFrame?.action===action&&this.now()-this.lastFrame.at<=500){
      frame=this.lastFrame.frame;this.metrics.reusedFrames++;reused=true;
    }else{
      if(this.lastInput?.action===action)this.lastInput.probed=true;
      frame = await this.bounded(this.host.capture());
      this.metrics.captures++; this.metrics.captureMs += this.now() - started;
      // Measure age from capture start, so a delayed reply cannot make an
      // already old image appear fresh enough for reuse.
      this.lastFrame={frame,action,at:started};
      const capture=this.host.lastCaptureMetrics;
      if(capture){
        const d=this.metrics.captureBreakdown;
        for(const key of ['checkMs','commandMs','base64Ms'])d[key]+=capture[key]||0;
        d.maxCommandMs=Math.max(d.maxCommandMs,capture.commandMs||0);
        d.maxEventLoopLagMs=Math.max(d.maxEventLoopLagMs,capture.eventLoopLagMs||0);
        if(capture.totalMs>=1000){d.slowCaptures++;this.metrics.slowCaptures.push({kind,...capture});if(this.metrics.slowCaptures.length>4)this.metrics.slowCaptures.shift();}
      }
    }
    started = this.now();
    const result = await this.bounded(this.observer.observe(kind, frame, arg,{reuseFrame:reused}), 30000);
    const elapsed=this.now()-started;
    this.metrics.observations++; this.metrics.observeMs += elapsed;
    const metrics=this.metrics.observationsByKind[kind]||(this.metrics.observationsByKind[kind]={calls:0,observeMs:0});
    metrics.calls++;metrics.observeMs+=elapsed;
    this.check();
    if (action !== this.actionId || frameId !== this.frameId) throw new Error('Stale observation');
    return result;
    } catch(error) {throw this.fail(error);} finally {this.busy=false;}
  }
  async until(kind, arg, predicate = r => r.valid, timeoutMs = 6000, {stableFrames=2,captureAllowanceMs=0,reuseLastFrame=false} = {}) {
    if(![1,2].includes(stableFrames))throw new Error('Invalid observation stability');
    if(!Number.isFinite(captureAllowanceMs)||captureAllowanceMs<0||captureAllowanceMs>12000)throw new Error('Invalid capture allowance');
    const started=this.now(),deadline = started + timeoutMs;
    const input=this.lastInput?.action===this.actionId&&!this.lastInput.probed?this.lastInput:null;
    const plan=input?this.transitionTiming.begin(input,kind,arg):null;
    let delayUsed=false,hadInvalid=false,stableAt=null;
    const finish=(result,readyAt)=>{
      if(plan&&input===this.lastInput&&result.valid===true)this.transitionTiming.record(plan,
        {delayUsed,hadInvalid,readyAfterMs:readyAt-input.at});
      return result;
    };
    const initialCaptureMs=this.metrics.captureMs,initialObserveMs=this.metrics.observeMs;
    const expired=()=>this.now()>=deadline+Math.min(captureAllowanceMs,this.metrics.captureMs-initialCaptureMs);
    let previous=null,last,prior,attempts=0,accepted=false,late=false,misses=0;
    const timeout=()=>observationTimeout(kind,arg,{elapsedMs:this.now()-started,attempts,stableFrames,
      last,previous:prior,accepted,late,captureMs:this.metrics.captureMs-initialCaptureMs,observeMs:this.metrics.observeMs-initialObserveMs,
      captureBreakdown:this.metrics.captureBreakdown,slowCaptures:this.metrics.slowCaptures});
    let delay=plan?plan.delay-(this.now()-input.at):0;
    if(delay>0&&this.now()+delay<deadline){
      this.check();if(this.busy)throw new Error('Session operation already running');
      delay=plan.delay-(this.now()-input.at);
      if(delay>0&&this.now()+delay<deadline){
        delayUsed=true;this.metrics.delayedProbes++;
        const waiting=this.now();
        try{await this.wait(delay);}finally{this.metrics.probeWaitMs+=this.now()-waiting;}
        if(input.action!==this.actionId)throw new Error('Input changed while waiting for transition');
      }
    }
    do {
      const observationStarted=this.now();
      const result = await this.observe(kind, arg,{reuseLastFrame:reuseLastFrame&&stableFrames===1&&attempts===0});
      prior=last;last=result;attempts++;late=expired();
      if(late)throw timeout();
      accepted=!!predicate(result);
      const captureAt=this.lastFrame?.action===this.actionId?this.lastFrame.at:observationStarted;
      if (accepted) {
        // Require matching structured content from two fresh frames for
        // navigation. Identity OCR has its own content/layout gates.
        if(stableFrames===1||kind==='rowidentity'||kind==='cardidentity')return finish(result,captureAt);
        const signature=JSON.stringify(result);
        if(signature===previous)return finish(result,stableAt);
        previous=signature;stableAt=captureAt;
      } else {
        previous=null;stableAt=null;hadInvalid=true;
        // A missed prediction is discarded immediately. Existing fresh-frame
        // polling and backoff handle the unexpected transition without retrying input.
        if(delayUsed&&attempts===1)this.transitionTiming.reject(plan);
      }
      // Both modes keep fresh, matching reads with a 40ms minimum gap.
      // Keep image retry backoff: a premature expensive capture can cost
      // more than the timer it replaces. The control cadence is unchanged.
      const gap=accepted?40:this.controlMode?Math.min(120,40+20*misses):Math.min(240,100+40*misses);
      const remaining=gap-(accepted?this.now()-observationStarted:0);
      misses=accepted?0:misses+1;
      if(remaining>0)await this.wait(remaining);
    } while (!expired());
    throw timeout();
  }
  async input(x, y, mutation, kind = 'click', {settleMs=100,controlId} = {}) {
    if(![0,100].includes(settleMs))throw new Error('Invalid input settling interval');
    this.check();
    if(this.busy)throw new Error('Session operation already running');
    this.busy=true;
    this.lastFrame=null;
    this.observer.releaseFrame?.();
    try {
    const started=this.now();
    if(typeof this.observer.prepareInput==='function'){
      this.metrics.controlReads++;
      const point=await this.bounded(this.observer.prepareInput({x,y,kind,mutation,controlId}));
      this.check();x=point.x;y=point.y;
    }
    if(mutation)this.pendingMutation=true;
    await this.bounded(this.host.input({x, y, kind, mutation, actionId: ++this.actionId}));
    this.lastInput={action:this.actionId,at:this.now(),kind,x,y,path:mutation?.path||'',probed:false};
    this.metrics.inputMs+=this.now()-started;
    this.metrics.inputs++;
    const waitMs=(settleMs===100?40:settleMs)+this.operationWaitMs;
    if(waitMs)await this.wait(waitMs);
    this.check();
    } catch(error) {throw this.fail(error);} finally {this.busy=false;}
  }
}
module.exports = {Session};
