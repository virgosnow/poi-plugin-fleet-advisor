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
const questProgressHandoff=Symbol.for('poi-plugin-fleet-advisor.quest-progress-handoff');
const syncHandoff=Symbol.for('poi-plugin-fleet-advisor.sync-handoff-v3');
let controller=null,service=null,expeditionProgress=null,questObserver=null,practiceObserver=null,progressListener=null;
let recommendationHost=null;
function getRecommendationHost(){
  if(!recommendationHost){
    const remote=require('@electron/remote');
    recommendationHost=remote.require(path.join(__dirname,'src/host/recommendation_process.js'))
      .createRecommendationHost(remote.getCurrentWebContents().id);
  }
  return recommendationHost;
}
let questAutoRead=null,questReader=null,rawQuestReader=null,practiceSync=null,basicDataSync=null,questTimer=null,requestListener=null,networkListener=null,startListener=null;
let observedSession=null,sessionGeneration=0,pendingHandoff=null,pendingProgressHandoff=null;
let backgroundTicking=false;
let lastQuestView=null,lastQuestComplete=false,publicQuestView=null;
const unknownQuests=Object.freeze({known:false,complete:false,tasks:Object.freeze([])});
const unknownPractice=Object.freeze({known:false,opponents:Object.freeze([]),history:Object.freeze([]),localHistory:Object.freeze([]),revision:0});
function questView(state){
  const view=questObserver.view(state),complete=questObserver.hasComplete(state);
  if(view!==lastQuestView||complete!==lastQuestComplete||!publicQuestView){
    lastQuestView=view;lastQuestComplete=complete;publicQuestView=Object.freeze({...view,complete});
  }
  return publicQuestView;
}
const questPages=new Set();
function observeSession(context){
  if(!context?.ready||!context.sessionKey)return;
  const session=context.sessionKey;
  if(observedSession&&session!==observedSession){
    sessionGeneration++;pendingHandoff=null;pendingProgressHandoff=null;questObserver?.resetSession();questAutoRead?.resetSession();
    practiceObserver?.resetSession();practiceSync?.reset();basicDataSync?.reset();service?.questProgressObserver?.resetSession?.();
  }
  observedSession=session;
}
async function tickQuests(){
  if(backgroundTicking)return;backgroundTicking=true;
  try{
    const reader=questReader;if(!reader)return;
    const context=await reader.context({cached:true});
    if(reader!==questReader)return;
    const session=context.ready?context.sessionKey:null;
    if(session&&!context.identityVerified){
      const identity=await reader.read({sessionKey:session,kind:'identity'});
      if(reader!==questReader||!identity?.identityVerified)return;
    }
    if(session&&rawQuestReader?.verifiedSessionKey===session){
      if(pendingProgressHandoff){const handoff=pendingProgressHandoff;pendingProgressHandoff=null;
        try{if(handoff.sessionKey===session)service?.questProgressObserver?.restore?.(handoff,currentStore());}catch(error){/* Ignore unsafe handoffs. */}}
      service?.questProgressObserver?.remember?.(currentStore());
    }
    const basic=basicDataSync;if(basic)await basic.tick().catch(()=>{});
    if(pendingHandoff&&session){
      if(pendingHandoff.sessionKey!==session)pendingHandoff=null;
      else if(rawQuestReader?.verifiedSessionKey===session){
        const value=pendingHandoff,observer=questObserver,generation=sessionGeneration;pendingHandoff=null;
        await require('./src/infrastructure/sync/session_handoff').restoreHandoff({value,reader,quest:observer,
          getStore:()=>readStore(window),isCurrent:()=>questReader===reader&&questObserver===observer&&
            sessionGeneration===generation&&rawQuestReader?.verifiedSessionKey===session}).catch(()=>{});
      }
    }
    const quests=questAutoRead;if(quests)await quests.tick().catch(()=>{});
    const practice=practiceSync;if(practice&&questPages.has('practice'))await practice.tick().catch(()=>{});
  }finally{backgroundTicking=false;}
}
function setQuestPageActive(owner,active){
  if(!['login','manual','normal','practice','expedition'].includes(owner)||!questAutoRead)return;
  questAutoRead.setActive(owner,active);
  if(active)questPages.add(owner);else questPages.delete(owner);
  if(questPages.size&&!questTimer){questTimer=setInterval(tickQuests,1500);tickQuests();}
  if(!questPages.size&&questTimer){clearInterval(questTimer);questTimer=null;}
}
const currentStore=()=>{
  const raw=readStore(window),state=basicDataSync?basicDataSync.view(raw):raw;
  const verified=!!rawQuestReader?.sessionKey&&rawQuestReader.verifiedSessionKey===rawQuestReader.sessionKey;
  return {...state,...(expeditionProgress?{expeditionProgress:expeditionProgress.view(state)}:{}),
    ...(practiceObserver?{practiceState:verified?practiceObserver.view(state):unknownPractice}:{}),
    ...(questObserver?{questState:verified?questView(state):unknownQuests}:{})};
};
exports.pluginDidLoad=()=>{
  if(service)return;
  require('./src/ui/shell/plugin_brand').register(require('@fortawesome/fontawesome-svg-core').library,window.document);
  expeditionProgress=new (require('./src/infrastructure/persistence/expedition_progress').ExpeditionProgress)(path.join(os.homedir(),'.poi-plugin-fleet-advisor'),{
    getStore:()=>readStore(window)});
  questObserver=new (require('./src/infrastructure/quests/quest_observer').QuestObserver)({getState:()=>readStore(window)});
  practiceObserver=new (require('./src/infrastructure/practice/practice_observer').PracticeObserver)(path.join(os.homedir(),'.poi-plugin-fleet-advisor','practice-history'),{
    legacyHistoryPath:window.APPDATA_PATH?path.join(window.APPDATA_PATH,'battle-detail','index11.csv.gz'):null});
  pendingHandoff=window[syncHandoff]||null;delete window[syncHandoff];
  pendingProgressHandoff=window[questProgressHandoff]||null;delete window[questProgressHandoff];
  rawQuestReader=new (require('./src/host/quest_reader').QuestReader)({window,
    getRemote:()=>require('@electron/remote'),getStore:()=>readStore(window),
    isBusy:()=>!!(controller?.running||service?.activeJobId||window.__fleetAdvisorUpdateBusy)});
  questReader=new (require('./src/infrastructure/sync/read_scheduler').ReadScheduler)({reader:rawQuestReader});
  const scheduledReader=questReader,readContext=scheduledReader.context.bind(scheduledReader);
  scheduledReader.context=async options=>{
    const context=await readContext(options);
    if(questReader===scheduledReader)observeSession(context);
    return context;
  };
  questAutoRead=new (require('./src/infrastructure/quests/quest_auto_read').QuestAutoRead)({
    getContext:async({cached=false}={})=>{
      const quick=await questReader.context({cached:true});
      if(cached||!quick.ready||questObserver.hasComplete())return quick;
      return questReader.context();
    },
    getQuestState:()=>({known:questObserver.hasComplete()}),
    read:async options=>{
      const observer=questObserver,reader=questReader;
      return require('./src/infrastructure/quests/quest_sync').syncQuests({observer,reader,service,
        isCurrent:()=>questObserver===observer&&questReader===reader,...options});
    }});
  practiceSync=new (require('./src/infrastructure/practice/practice_sync').PracticeSync)({reader:questReader,observer:practiceObserver,getStore:()=>readStore(window)});
  basicDataSync=new (require('./src/infrastructure/persistence/basic_data_sync').BasicDataSync)({reader:questReader,getStore:()=>readStore(window),expedition:expeditionProgress});
  progressListener=event=>{
    try{questReader?.observeResponse(event.detail);}catch(error){}
    try{expeditionProgress?.observe(event.detail,readStore(window));}catch(error){}
    try{if(rawQuestReader?.sessionKey&&rawQuestReader.verifiedSessionKey===rawQuestReader.sessionKey)service?.observeQuestProgress(event.detail);}catch(error){}
    try{questObserver?.observe(event.detail,readStore(window));}catch(error){}
    try{practiceObserver?.observe(event.detail,readStore(window));}catch(error){}
    try{basicDataSync?.observe(event.detail,readStore(window));}catch(error){}
  };
  requestListener=event=>{try{questReader?.observeRequest(event.detail);}catch(error){}};
  networkListener=()=>{try{questReader?.observeFailure();}catch(error){}};
  startListener=()=>{
    try{sessionGeneration++;observedSession=null;pendingHandoff=null;pendingProgressHandoff=null;questReader?.observeStart();questObserver?.resetSession();questAutoRead?.resetSession();
      practiceObserver?.resetSession();practiceSync?.reset();basicDataSync?.reset();service?.questProgressObserver?.resetSession?.();}catch(error){}
  };
  window.addEventListener('game.response',progressListener);
  window.addEventListener('game.request',requestListener);
  window.addEventListener('network.error',networkListener);
  window.addEventListener('network.invalid.result',networkListener);
  window.addEventListener('game.start',startListener);
  expeditionProgress.view(readStore(window));
  controller=new Controller({getStore:currentStore,
    createHost:()=>new PoiHost({window,remote:require('@electron/remote')}),
    createObserver:(host,mode)=>mode==='controls'?new(require('./src/execution/control_observer').ControlObserver)(host):
      new WorkerObserver({createWorker:filename=>host.createObserverWorker(filename)}),
    onProgress:value=>service?.progress(value),onDiagnostic:value=>service?.recordDiagnostic(value)});
  service=new FleetAdvisorService({controller,getStore:currentStore,
    readQuests:()=>questReader?questReader.readAll():Promise.resolve({status:'unavailable'}),
    // The main process owns lifecycle only; the coordinator and its existing
    // thread pool run in an independent, disposable utility process.
    createRecommendationWorker:(filename,options)=>{
      return getRecommendationHost().create(options);
    },
    prepareRecommendationWorker:()=>getRecommendationHost().prewarm(),
    releaseRecommendationWorker:()=>recommendationHost?.release(),
    storageDir:path.join(os.homedir(),'.poi-plugin-fleet-advisor')});
  if(service.persistenceReady&&service.mcpEnabled){
    void service.startMcpServer().catch(error=>{if(service)service.bridgeError=error.message;});
  }
  setQuestPageActive('login',true);
};
exports.pluginWillUnload=()=>{const previous=service,progress=expeditionProgress,computeHost=recommendationHost;
  recommendationHost=null;
  require('./src/ui/shell/plugin_brand').unregister(window.document);
  if(progressListener)window.removeEventListener('game.response',progressListener);
  if(requestListener)window.removeEventListener('game.request',requestListener);
  if(networkListener){window.removeEventListener('network.error',networkListener);window.removeEventListener('network.invalid.result',networkListener);}
  if(startListener)window.removeEventListener('game.start',startListener);
  if(questTimer)clearInterval(questTimer);questTimer=null;questPages.clear();
  const reader=questReader,rawReader=rawQuestReader;
  sessionGeneration++;observedSession=null;pendingHandoff=null;pendingProgressHandoff=null;reader?.cancel();
  practiceSync?.dispose();basicDataSync?.dispose();questAutoRead?.dispose();
  try{
    const handoff=require('./src/infrastructure/sync/session_handoff').captureHandoff({reader:rawReader,quest:questObserver,
      practice:practiceObserver,basic:basicDataSync,store:readStore(window)});
    if(handoff)window[syncHandoff]=handoff;else delete window[syncHandoff];
  }catch(error){delete window[syncHandoff];}
  const readerCleanup=Promise.resolve(reader?.dispose()).then(()=>rawReader?.dispose());
  questAutoRead=null;questReader=null;rawQuestReader=null;practiceSync=null;basicDataSync=null;requestListener=null;networkListener=null;startListener=null;
  if(window.__fleetAdvisorUpdateBusy&&previous?.questProgressObserver&&rawReader?.sessionKey&&rawReader.verifiedSessionKey===rawReader.sessionKey)try{
    const handoff=previous.questProgressObserver.snapshot(readStore(window));
    if(handoff)window[questProgressHandoff]={...handoff,sessionKey:rawReader.sessionKey};
  }catch(error){/* Never prevent plugin shutdown when poi is closing. */}
  questObserver?.dispose();
  lastQuestView=null;publicQuestView=null;lastQuestComplete=false;
  practiceObserver?.dispose();
  service=null;controller=null;expeditionProgress=null;questObserver=null;practiceObserver=null;progressListener=null;
  return Promise.all([previous?.dispose(),progress?.dispose(),readerCleanup]).then(()=>computeHost?.dispose());};

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
