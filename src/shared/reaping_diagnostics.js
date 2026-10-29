'use strict';
// Observation only: no I/O, termination decisions, or game/account payloads.
const SLOW_MS=500,INTERVAL_MS=100;
const EVENTS=new Set(['resultReceived','terminateCalled','killCalled','killReturned','killThrew','exitNotified','terminationResolved','terminationRejected']);
const REASONS=new Set(['slow','kill-failed','kill-threw','termination-error','diagnostics-error']);
const CODES=new Set(['EACCES','EPERM','ESRCH','EINVAL','ETIMEDOUT','ERR_WORKER_NOT_RUNNING','RECOMMENDATION_PROCESS_STOP_TIMEOUT']);
const errorInfo=error=>({name:['Error','TypeError','RangeError','AbortError'].includes(error?.name)?error.name:'Error',
  code:CODES.has(error?.code)?error.code:'OTHER'});
const numbers=(value,keys)=>Object.fromEntries(keys.filter(k=>Number.isFinite(value?.[k])&&value[k]>=0).map(k=>[k,value[k]]));
function lagMonitor({now=()=>performance.now(),schedule=setInterval,cancel=clearInterval}={}){
  let last=now(),maxMs=0,stopped=false;
  const sample=()=>{const at=now();maxMs=Math.max(maxMs,at-last-INTERVAL_MS,0);last=at;};
  const timer=schedule(sample,INTERVAL_MS);timer?.unref?.();
  return {stop(){if(!stopped){sample();cancel(timer);stopped=true;}return maxMs;}};
}
class ReapingTrace {
  constructor({now=()=>Date.now(),monitor=lagMonitor}={}){this.now=now;this.monitor=monitor;this.events=[];this.pid=null;}
  mark(event,details={}){
    if(event==='resultReceived'||event==='terminateCalled')this.lag??=this.monitor();
    if(this.events.length<32)this.events.push({event,at:this.now(),...details});
    if(event==='exitNotified'||event==='terminationRejected')this.maxLagMs=this.lag?.stop()||0;
  }
  snapshot(){return {pid:this.pid,events:this.events.map(e=>({...e})),maxLagMs:this.maxLagMs||0};}
}
function combine(main,renderer){
  const events=main?.events||[],first=name=>events.find(e=>e.event===name)?.at;
  const segments={};
  const delta=(name,end,start)=>{if(Number.isFinite(end)&&Number.isFinite(start)&&end>=start)segments[name]=end-start;};
  delta('resultToRendererMs',renderer.resultReceivedAt,first('resultReceived'));
  delta('terminateDispatchMs',first('terminateCalled'),renderer.terminateRequestedAt);
  delta('killToExitNotificationMs',first('exitNotified'),first('killCalled'));
  delta('exitToMainResolutionMs',first('terminationResolved'),first('exitNotified'));
  delta('mainToRendererResolutionMs',renderer.terminateFinishedAt,first('terminationResolved'));
  const reasons=[];
  if(renderer.waitMs>=SLOW_MS||Object.values(segments).some(ms=>ms>=SLOW_MS))reasons.push('slow');
  if(events.some(e=>e.event==='killReturned'&&e.ok===false))reasons.push('kill-failed');
  if(events.some(e=>e.event==='killThrew'))reasons.push('kill-threw');
  if(renderer.error||events.some(e=>e.event==='terminationRejected'))reasons.push('termination-error');
  if(renderer.diagnosticsError)reasons.push('diagnostics-error');
  if(!reasons.length)return undefined;
  return sanitize({abnormal:true,thresholdMs:SLOW_MS,reasons,segments,main,
    renderer:{...renderer,error:renderer.error?errorInfo(renderer.error):undefined}});
}
function sanitize(value){
  if(value?.abnormal!==true)return undefined;
  const main=value.main||{},renderer=value.renderer||{};
  return {version:1,abnormal:true,thresholdMs:SLOW_MS,reasons:(value.reasons||[]).filter(x=>REASONS.has(x)).slice(0,5),
    segments:numbers(value.segments,['resultToRendererMs','terminateDispatchMs','killToExitNotificationMs','exitToMainResolutionMs','mainToRendererResolutionMs']),
    main:{...(Number.isInteger(main.pid)&&main.pid>0&&main.pid<=0x7fffffff?{pid:main.pid}:{}),...numbers(main,['maxLagMs']),
      events:(main.events||[]).slice(0,32).filter(e=>EVENTS.has(e.event)).map(e=>({event:e.event,...numbers(e,['at','durationMs']),
        ...(typeof e.ok==='boolean'?{ok:e.ok}:{}),...(Number.isInteger(e.exitCode)?{exitCode:e.exitCode}:{}),
        ...(e.error?{error:errorInfo(e.error)}:{})}))},
    renderer:{...numbers(renderer,['resultReceivedAt','terminateRequestedAt','terminateFinishedAt','waitMs','maxLagMs']),
      ...(renderer.error?{error:errorInfo(renderer.error)}:{}),...(renderer.diagnosticsError?{diagnosticsError:true}:{})}};
}
module.exports={SLOW_MS,ReapingTrace,lagMonitor,combine,sanitize,errorInfo};
