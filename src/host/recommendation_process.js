'use strict';
const {EventEmitter}=require('events');
const path=require('path');
const processes=new Set();

// Created in Electron MAIN, not the renderer: ownership survives renderer
// crashes and a killed utility process takes all its worker threads with it.
// Electron contract: https://www.electronjs.org/docs/latest/api/utility-process
function createRecommendationProcess(options,ownerId,{electron=require('electron'),startupMs=30000,stopMs=10000}={}){
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
  let exited=false,stopping=false,sent=false,exitCode,startTimer,stopTimer,retryTimer;
  let resolveExit,rejectExit,termination;
  const exit=new Promise((resolve,reject)=>{resolveExit=resolve;rejectExit=reject;});
  exit.catch(()=>{});
  const clearTimers=()=>{clearTimeout(startTimer);clearTimeout(stopTimer);clearTimeout(retryTimer);};
  const unbind=()=>{
    owner.removeListener('destroyed',ownerGone);owner.removeListener('render-process-gone',ownerGone);
    owner.removeListener('did-start-navigation',navigate);app.removeListener('before-quit',ownerGone);
  };
  // Plain objects retain useful error fields across @electron/remote.
  const fail=(message,code='RECOMMENDATION_PROCESS_FAILED')=>handle.emit('error',{message,code});
  handle.terminate=()=>{
    if(exited)return Promise.resolve(exitCode);
    if(termination)return termination;
    stopping=true;clearTimeout(startTimer);
    termination=exit;
    const kill=()=>{try{child.kill();}catch(_){};};
    kill();
    if(!exited){
      retryTimer=setTimeout(kill,Math.min(1000,stopMs/2));
      stopTimer=setTimeout(()=>{
        // Do not allow another job/cache maintenance after an unconfirmed kill.
        rejectExit({message:'计算进程未能退出，请重新启动 poi',code:'RECOMMENDATION_PROCESS_STOP_TIMEOUT'});
      },stopMs);
    }
    return termination;
  };
  function ownerGone(){handle.removeAllListeners();handle.on('error',()=>{});void handle.terminate().catch(()=>{});}
  function navigate(_event,_url,isInPlace,isMainFrame){if(isMainFrame&&!isInPlace)ownerGone();}
  owner.once('destroyed',ownerGone);owner.once('render-process-gone',ownerGone);
  owner.on('did-start-navigation',navigate);app.once('before-quit',ownerGone);
  child.once('spawn',()=>{if(stopping)child.kill();});
  child.on('message',message=>{
    if(stopping||exited)return;
    if(message?.ready){
      if(sent)return;sent=true;clearTimeout(startTimer);
      try{child.postMessage(options.workerData);}catch(error){fail(error.message);}
    }else handle.emit('message',message);
  });
  child.once('error',type=>fail(`推荐计算进程异常（${typeof type==='string'?type:'启动失败'}）`));
  child.once('exit',code=>{
    exited=true;exitCode=code;clearTimers();unbind();processes.delete(handle);resolveExit(code);
    handle.emit('exit',code);
  });
  startTimer=setTimeout(()=>{fail('推荐计算进程启动超时','RECOMMENDATION_PROCESS_START_TIMEOUT');ownerGone();},startupMs);
  return handle;
}
function unload(){
  // The service drains its own queue first. Another poi window may still own
  // work in this module; never terminate that window's search on our unload.
  if(processes.size)return false;
  // The main process has a separate require cache from the poi renderer.
  delete require.cache[__filename];
  return true;
}
module.exports={createRecommendationProcess,unload};
