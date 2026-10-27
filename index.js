'use strict';
// Build marker for diagnostics; verify file hashes AND the mounted component
// alongside this value when updating without restarting poi.
exports.HOT_PROBE='unified-borrow-2026-09-22-name-variants';
const fs=require('fs'),path=require('path'),os=require('os');
const React=require('react');
const {Controller}=require('./src/application/controller');
const {FleetAdvisorService}=require('./src/application/fleet_advisor_service');
const LOG_DIR=path.join(__dirname,'logs');
// One JSON per run, newest 30 kept. Logging must never break the panel.
function appendLog(entry){
  try{
    fs.mkdirSync(LOG_DIR,{recursive:true});
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    fs.writeFileSync(path.join(LOG_DIR,`run-${stamp}.json`),JSON.stringify(entry,null,2));
    const files=fs.readdirSync(LOG_DIR).filter(f=>f.startsWith('run-')).sort();
    while(files.length>30)fs.unlinkSync(path.join(LOG_DIR,files.shift()));
  }catch(e){}
}
const {PoiHost}=require('./src/host/poi_host');
const {readStore}=require('./src/host/store');
const {WorkerObserver}=require('./src/vision/worker_observer');
const questHandoff=Symbol.for('poi-plugin-fleet-advisor.quest-handoff');
const questReadLedger=Symbol.for('poi-plugin-fleet-advisor.quest-read-ledger');
let controller=null,service=null,expeditionProgress=null,questObserver=null,progressListener=null;
let recommendationHost=null;
let questAutoRead=null,questReader=null,questTimer=null,requestListener=null,networkListener=null,startListener=null;
const questPages=new Set();
function tickQuests(){
  const reader=questAutoRead;
  if(reader)void reader.tick().catch(()=>{}).finally(()=>{
    if(questAutoRead===reader)window[questReadLedger]=reader.snapshot();
  });
}
function setQuestPageActive(owner,active){
  if(!['normal','expedition'].includes(owner)||!questAutoRead)return;
  questAutoRead.setActive(owner,active);
  if(active)questPages.add(owner);else questPages.delete(owner);
  if(questPages.size&&!questTimer){questTimer=setInterval(tickQuests,500);tickQuests();}
  if(!questPages.size&&questTimer){clearInterval(questTimer);questTimer=null;}
}
const currentStore=()=>{
  const state=readStore(window);
  return {...state,...(expeditionProgress?{expeditionProgress:expeditionProgress.view(state)}:{}),
    ...(questObserver?{questState:questObserver.view(state)}:{})};
};
exports.pluginDidLoad=()=>{
  if(service)return;
  require('./src/ui/shell/plugin_brand').register(require('@fortawesome/fontawesome-svg-core').library,window.document);
  expeditionProgress=new (require('./src/infrastructure/persistence/expedition_progress').ExpeditionProgress)(path.join(os.homedir(),'.poi-plugin-fleet-advisor'),{
    getStore:()=>readStore(window),load:()=>require('./src/host/expedition_reader').readExpeditionProgress(window,require('@electron/remote'))});
  questObserver=new (require('./src/infrastructure/quests/quest_observer').QuestObserver)({getState:()=>readStore(window)});
  const observedQuests=window[questHandoff];delete window[questHandoff];
  if(observedQuests)questObserver.restore(observedQuests,readStore(window));
  questReader=new (require('./src/host/quest_reader').QuestReader)({window,
    getRemote:()=>require('@electron/remote'),getStore:()=>readStore(window),
    isBusy:()=>!!(controller?.running||service?.activeJobId||window.__fleetAdvisorUpdateBusy)});
  questAutoRead=new (require('./src/infrastructure/quests/quest_auto_read').QuestAutoRead)({
    getContext:()=>questReader.context({cached:questObserver.view().known}),getQuestState:()=>questObserver.view(),
    read:async options=>{
      const observer=questObserver,reader=questReader;
      const result=await reader.read(options);
      // Natural task responses take priority; never replace a newer task
      // selection with a direct-read snapshot that started earlier.
      if(result?.list&&questObserver===observer&&!observer.view().known&&
        (await reader.context({cached:true})).sessionKey===options.sessionKey)observer.acceptList(result.list);
      return result;
    }});
  questAutoRead.restore(window[questReadLedger]);
  progressListener=event=>{
    try{questReader?.observeResponse(event.detail);}catch(error){}
    try{expeditionProgress?.observe(event.detail,readStore(window));}catch(error){}
    try{questObserver?.observe(event.detail,readStore(window));}catch(error){}
  };
  requestListener=event=>{try{questReader?.observeRequest(event.detail);}catch(error){}};
  networkListener=()=>{try{questReader?.observeFailure();}catch(error){}};
  startListener=()=>{try{questReader?.observeStart();}catch(error){}};
  window.addEventListener('game.response',progressListener);
  window.addEventListener('game.request',requestListener);
  window.addEventListener('network.error',networkListener);
  window.addEventListener('network.invalid.result',networkListener);
  window.addEventListener('game.start',startListener);
  expeditionProgress.view(readStore(window));
  controller=new Controller({getStore:currentStore,
    createHost:()=>new PoiHost({window,remote:require('@electron/remote')}),
    createObserver:host=>new WorkerObserver({createWorker:filename=>host.createObserverWorker(filename)}),
    onProgress:value=>service?.progress(value)});
  service=new FleetAdvisorService({controller,getStore:currentStore,
    // The main process owns lifecycle only; the coordinator and its existing
    // thread pool run in an independent, disposable utility process.
    createRecommendationWorker:(filename,options)=>{
      const remote=require('@electron/remote');
      recommendationHost??=remote.require(path.join(__dirname,'src/host/recommendation_process.js'));
      return recommendationHost.createRecommendationProcess(options,remote.getCurrentWebContents().id);
    },
    storageDir:path.join(os.homedir(),'.poi-plugin-fleet-advisor')});
  if(service.persistenceReady&&service.mcpEnabled){
    void service.startMcpServer().catch(error=>{if(service)service.bridgeError=error.message;});
  }
};
exports.pluginWillUnload=()=>{const previous=service,progress=expeditionProgress,computeHost=recommendationHost;
  recommendationHost=null;
  require('./src/ui/shell/plugin_brand').unregister(window.document);
  if(progressListener)window.removeEventListener('game.response',progressListener);
  if(requestListener)window.removeEventListener('game.request',requestListener);
  if(networkListener){window.removeEventListener('network.error',networkListener);window.removeEventListener('network.invalid.result',networkListener);}
  if(startListener)window.removeEventListener('game.start',startListener);
  if(questTimer)clearInterval(questTimer);questTimer=null;questPages.clear();
  if(questAutoRead)window[questReadLedger]=questAutoRead.snapshot();
  questAutoRead?.dispose();const readerCleanup=questReader?.dispose();
  questAutoRead=null;questReader=null;requestListener=null;networkListener=null;startListener=null;
  // Development hot reloads transfer only recent, actually observed task rows
  // in memory. A normal unload never retains this cache.
  if(window.__fleetAdvisorUpdateBusy&&questObserver)window[questHandoff]=questObserver.snapshot();
  questObserver?.dispose();
  service=null;controller=null;expeditionProgress=null;questObserver=null;progressListener=null;
  return Promise.all([previous?.dispose(),progress?.dispose(),readerCleanup]).then(()=>computeHost?.unload());};

exports.reactClass=require('./src/ui/shell/panel')(React,{
  getController:()=>service,
  getStore:currentStore,
  subscribe:listener=>service?service.subscribe(listener):()=>{},
  getMcpStatus:()=>service?.getStatus(),
  // Master switch: flip the persisted flag, then align the bridge lifecycle
  // so disabled means nothing is exposed on loopback.
  setMcpEnabled:async value=>{
    if(!service)return false;
    const enabled=service.setMcpEnabled(value);
    if(enabled){
      try{await service.startMcpServer();}catch(e){/* surfaced via bridgeError/status */}
    } else {
      const bridge=service.bridge;service.bridge=null;service.bridgeError=null;
      if(bridge)await bridge.close().catch(()=>{});
    }
    return enabled;
  },
  setMcpHttpPort:port=>service?.setHttpPort(port),
  setQuestPageActive,
  appendLog
});
