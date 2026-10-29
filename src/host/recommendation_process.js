'use strict';
const {EventEmitter}=require('events');
const path=require('path');
const {ReapingTrace,errorInfo}=require('../shared/reaping_diagnostics');
const processes=new Set();

// Created in Electron MAIN, not the renderer: ownership survives renderer
// crashes and a killed utility process takes all its worker threads with it.
// Electron contract: https://www.electronjs.org/docs/latest/api/utility-process
function createRecommendationProcess(options,ownerId,{electron=require('electron'),startupMs=30000,stopMs=10000,deferred=false}={}){
  const {utilityProcess,webContents,app}=electron;
  if(!utilityProcess?.fork)throw Error('当前 poi 不支持独立计算进程，请更新 poi');
  const owner=webContents.fromId(ownerId);
  if(!owner||owner.isDestroyed())throw Error('推荐页面已关闭');
  const handle=new EventEmitter();
  handle.on('error',()=>{}); // Owner loss can remove remote listeners first.
  const child=utilityProcess.fork(path.join(__dirname,'../infrastructure/workers/recommendation_process_entry.js'),[],
    {serviceName:'Fleet Advisor recommendations',stdio:'ignore'});
  Object.defineProperty(handle,'pid',{enumerable:true,get:()=>child.pid});
  processes.add(handle);
  let exited=false,stopping=false,sent=false,ready=false,requested=!deferred,job=options.workerData,exitCode,startTimer,stopTimer,retryTimer;
  let reaping=job?.diagnostics?new ReapingTrace():null;
  // One value crosses @electron/remote, avoiding per-property synchronous RPC.
  handle.getReapingDiagnostics=()=>reaping?JSON.stringify(reaping.snapshot()):undefined;
  let resolveExit,rejectExit,termination,resolveReady,rejectReady;
  handle.ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  handle.ready.catch(()=>{});
  handle.available=()=>!stopping&&!exited;
  handle.setJob=data=>{
    if(sent||job)throw Error('计算进程只能接收一次任务');
    job={...data,prewarmed:ready};
    if(data.diagnostics&&!reaping)reaping=new ReapingTrace();
    if(reaping)reaping.pid=child.pid;
  };
  const send=()=>{
    if(!ready||!requested||sent||stopping||exited)return;
    sent=true;
    try{child.postMessage(job);}catch(error){fail(error.message);}
  };
  // Deferred jobs start only after the caller has registered result/error/exit
  // listeners. A warm cache hit can finish before remote listeners attach.
  handle.start=()=>{requested=true;send();};
  const exit=new Promise((resolve,reject)=>{resolveExit=resolve;rejectExit=reject;});
  exit.catch(()=>{});
  const clearTimers=()=>{clearTimeout(startTimer);clearTimeout(stopTimer);clearTimeout(retryTimer);};
  const unbind=()=>{
    owner.removeListener('destroyed',ownerGone);owner.removeListener('render-process-gone',ownerGone);
    owner.removeListener('did-start-navigation',navigate);app.removeListener('before-quit',ownerGone);
  };
  // Plain objects retain useful error fields across @electron/remote.
  const fail=(message,code='RECOMMENDATION_PROCESS_FAILED')=>handle.emit('error',{message,code});
  function observedKill(){const at=reaping?performance.now():0;reaping?.mark('killCalled');
    try{const ok=child.kill();reaping?.mark('killReturned',{ok,durationMs:performance.now()-at});return ok;}
    catch(error){reaping?.mark('killThrew',{error:errorInfo(error),durationMs:performance.now()-at});throw error;}}
  handle.terminate=()=>{
    if(exited)return Promise.resolve(exitCode);
    if(termination)return termination;
    reaping?.mark('terminateCalled');
    stopping=true;clearTimeout(startTimer);
    termination=exit;
    const kill=()=>{try{observedKill();}catch(_){};};
    kill();
    if(!exited){
      retryTimer=setTimeout(kill,Math.min(1000,stopMs/2));
      stopTimer=setTimeout(()=>{
        // Do not allow another job/cache maintenance after an unconfirmed kill.
        rejectExit({message:'计算进程未能退出，请重新启动 poi',code:'RECOMMENDATION_PROCESS_STOP_TIMEOUT'});
      },stopMs);
    }
    if(reaping)termination.then(()=>reaping.mark('terminationResolved'),error=>reaping.mark('terminationRejected',{error:errorInfo(error)}));
    return termination;
  };
  function ownerGone(){handle.removeAllListeners();handle.on('error',()=>{});void handle.terminate().catch(()=>{});}
  function navigate(_event,_url,isInPlace,isMainFrame){if(isMainFrame&&!isInPlace)ownerGone();}
  owner.once('destroyed',ownerGone);owner.once('render-process-gone',ownerGone);
  owner.on('did-start-navigation',navigate);app.once('before-quit',ownerGone);
  child.once('spawn',()=>{if(reaping)reaping.pid=child.pid;if(stopping)observedKill();});
  child.on('message',message=>{
    if(stopping||exited)return;
    if(message?.ready){
      if(ready)return;ready=true;clearTimeout(startTimer);resolveReady(message);send();
    }else {reaping?.mark('resultReceived');handle.emit('message',message);}
  });
  child.once('error',type=>fail(`推荐计算进程异常（${typeof type==='string'?type:'启动失败'}）`));
  child.once('exit',code=>{
    reaping?.mark('exitNotified',{exitCode:code});
    exited=true;exitCode=code;clearTimers();unbind();processes.delete(handle);resolveExit(code);
    if(!ready)rejectReady({message:`预热计算进程已退出（${code}）`,code:'RECOMMENDATION_PREWARM_EXIT'});
    handle.emit('exit',code);
  });
  startTimer=setTimeout(()=>{fail('推荐计算进程启动超时','RECOMMENDATION_PROCESS_START_TIMEOUT');ownerGone();},startupMs);
  return handle;
}
class RecommendationProcessHost {
  constructor(ownerId,options={}){this.ownerId=ownerId;this.options=options;this.idle=null;this.closed=false;this.failure=null;this.stops=new Set();}
  create(options){
    if(this.closed)throw Error('计算进程宿主已关闭');
    if(this.failure)throw this.failure;
    const spare=this.idle;this.idle=null;clearTimeout(this.idleTimer);
    const handle=spare?.available()?spare:createRecommendationProcess({},this.ownerId,{...this.options,deferred:true});
    handle.setJob(options.workerData);return handle;
  }
  prewarm(){
    if(this.closed||this.failure)return Promise.resolve(false);
    if(this.idle)return this.idle.ready;
    const handle=createRecommendationProcess({},this.ownerId,{...this.options,deferred:true});
    this.idle=handle;
    handle.once('exit',()=>{if(this.idle===handle){this.idle=null;clearTimeout(this.idleTimer);}});
    return handle.ready.then(result=>{
      if(this.idle===handle){
        this.idleTimer=setTimeout(()=>{void this.release().catch(()=>{});},this.options.idleMs??60000);
        this.idleTimer.unref?.();
      }
      return result;
    },async()=>{if(this.idle===handle)await this.release();return false;});
  }
  async release(){
    const handle=this.idle;this.idle=null;clearTimeout(this.idleTimer);
    if(handle){
      const stop=handle.terminate();this.stops.add(stop);
      try{await stop;}catch(error){this.failure=error;throw error;}finally{this.stops.delete(stop);}
    }
    await Promise.all(this.stops);
    if(this.failure)throw this.failure;
  }
  async dispose(){this.closed=true;await this.release();unload();}
}
const createRecommendationHost=ownerId=>new RecommendationProcessHost(ownerId);
function unload(){
  // The service drains its own queue first. Another poi window may still own
  // work in this module; never terminate that window's search on our unload.
  if(processes.size)return false;
  // The main process has a separate require cache from the poi renderer.
  delete require.cache[__filename];
  return true;
}
module.exports={createRecommendationProcess,createRecommendationHost,RecommendationProcessHost,unload};
