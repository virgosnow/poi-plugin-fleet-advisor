'use strict';
const {observationTimeout}=require('./observation_diagnostics');
const {TransitionTiming}=require('./transition_timing');

class Session {
  constructor(host, observer, options = {}) {
    this.host = host; this.observer = observer;
    this.now = options.now || (() => performance.now());
    this.deadline = this.now() + (options.timeoutMs || 180000);
    this.abort = new AbortController(); this.actionId = 0; this.frameId = 0;
    this.transitionTiming=new TransitionTiming();this.lastInput=null;
    this.metrics = {started: this.now(), inputs: 0, captures: 0, observations: 0, captureMs: 0, observeMs: 0,
      checks:0,hostCheckMs:0,validationMs:0,inputMs:0,waitMs:0,observationsByKind:{},reusedFrames:0,delayedProbes:0,probeWaitMs:0,
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
    } catch(error) {this.stop();throw error;} finally {this.busy=false;}
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
      // Keep fresh observations at least 80ms apart. Screenshot/recognition
      // work already supplies this spacing on slower machines; do not add
      // another unconditional delay after that work has completed.
      // Unready UI gets a short, bounded backoff instead of being captured
      // continuously. A successful frame resets the backoff immediately.
      const remaining=accepted?80-(this.now()-observationStarted):Math.min(240,100+40*misses);
      misses=accepted?0:misses+1;
      if(remaining>0)await this.wait(remaining);
    } while (!expired());
    throw timeout();
  }
  async input(x, y, mutation, kind = 'click', {settleMs=100} = {}) {
    if(![0,100].includes(settleMs))throw new Error('Invalid input settling interval');
    this.check();
    if(this.busy)throw new Error('Session operation already running');
    this.busy=true;
    this.lastFrame=null;
    this.observer.releaseFrame?.();
    try {
    const started=this.now();
    await this.bounded(this.host.input({x, y, kind, mutation, actionId: ++this.actionId}));
    this.lastInput={action:this.actionId,at:this.now(),kind,x,y,path:mutation?.path||'',probed:false};
    this.metrics.inputMs+=this.now()-started;
    this.metrics.inputs++;
    if(settleMs)await this.wait(settleMs);
    this.check();
    } catch(error) {this.stop();throw error;} finally {this.busy=false;}
  }
}
module.exports = {Session};
