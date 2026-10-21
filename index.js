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
let controller=null,service=null,expeditionProgress=null,progressListener=null;
const currentStore=()=>{
  const state=readStore(window);
  return expeditionProgress?{...state,expeditionProgress:expeditionProgress.view(state)}:state;
};
exports.pluginDidLoad=()=>{
  if(service)return;
  require('./src/ui/shell/plugin_brand').register(require('@fortawesome/fontawesome-svg-core').library,window.document);
  expeditionProgress=new (require('./src/infrastructure/persistence/expedition_progress').ExpeditionProgress)(path.join(os.homedir(),'.poi-plugin-fleet-advisor'),{
    getStore:()=>readStore(window),load:()=>require('./src/host/expedition_reader').readExpeditionProgress(window,require('@electron/remote'))});
  progressListener=event=>{try{expeditionProgress?.observe(event.detail,readStore(window));}catch(error){}};
  window.addEventListener('game.response',progressListener);
  expeditionProgress.view(readStore(window));
  controller=new Controller({getStore:currentStore,
    createHost:()=>new PoiHost({window,remote:require('@electron/remote')}),
    createObserver:host=>new WorkerObserver({createWorker:filename=>host.createObserverWorker(filename)}),
    onProgress:value=>service?.progress(value)});
  service=new FleetAdvisorService({controller,getStore:currentStore,
    // Like vision workers, Node workers must be created by Electron's main
    // process; rendering and game input stay in their existing contexts.
    createRecommendationWorker:(filename,options)=>{
      const {Worker}=require('@electron/remote').require('worker_threads');
      return new Worker(filename,options);
    },
    storageDir:path.join(os.homedir(),'.poi-plugin-fleet-advisor')});
  if(service.persistenceReady&&service.mcpEnabled){
    void service.startMcpServer().catch(error=>{if(service)service.bridgeError=error.message;});
  }
};
exports.pluginWillUnload=()=>{const previous=service,progress=expeditionProgress;
  require('./src/ui/shell/plugin_brand').unregister(window.document);
  if(progressListener)window.removeEventListener('game.response',progressListener);
  service=null;controller=null;expeditionProgress=null;progressListener=null;
  return Promise.all([previous?.dispose(),progress?.dispose()]);};

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
  appendLog
});
