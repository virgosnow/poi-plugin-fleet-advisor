'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {Controller}=require('./controller');
const {Snapshots,fingerprint,businessState,error}=require('./snapshots');
const {Schemes,validateSchemeShape}=require('../infrastructure/persistence/scheme_store');
const {contract}=require('./contract');
const {evaluateCandidate,RULE_VERSION}=require('../domain/fleet/fleet_metrics');
const expeditions=require('../domain/expeditions/expeditions');
const normalRoutes=require('../domain/routes/normal_routes');
const pageQueries=require('./page_queries');
const {RecommendationWorker}=require('../infrastructure/workers/recommendation_worker');
const {McpHttpServer,DEFAULT_HTTP_PORT}=require('../bridge/http_server');
const selectionFilters=require('../config/recommendation_filters');
const computationSettings=require('../config/computation_settings');
const experimentalSettings=require('../config/experimental_settings');
const performanceTrace=require('../shared/performance_trace');
const {PerformanceLogs}=require('../infrastructure/cache/performance_logs');
const {inspectCache,maintainCache}=require('../infrastructure/cache/recommendation_cache');

const PLAN_TTL_MS=5*60*1000;
const JOB_RETENTION_MS=24*60*60*1000;
const TERMINAL=new Set(['succeeded','failed','cancelled','interrupted']);
const nowIso=()=>new Date().toISOString();

function observedState(state,shipIds=[]) {
  try{
    const s=businessState(state);
    return {fleets:s.info.fleets.map((f,index)=>({fleet:index+1,shipIds:(f.api_ship||[]).filter(id=>id>0)})),
      ships:shipIds.map(id=>({instanceId:id,slots:s.info.ships[id]?.api_slot||null,
        expansionItemId:s.info.ships[id]?.api_slot_ex??null})),
      shipCount:Object.keys(s.info.ships).length,equipmentCount:Object.keys(s.info.equips).length};
  }catch(e){return {available:false,reason:e.message};}
}

class FleetAdvisorService {
  constructor({controller,getStore,storageDir,now=()=>Date.now(),createRecommendationWorker,prepareRecommendationWorker,releaseRecommendationWorker}) {
    this.controller=controller;this.getStore=getStore;this.now=now;this.storageDir=storageDir;
    this.snapshots=new Snapshots(getStore,now);this.schemes=new Schemes(storageDir,now,
      {getCacheLimit:()=>this.computationSettings.cacheLimitMiB*1024**2});
    this.computationSettings=computationSettings.normalizePreferences();
    this.performanceLogs=new PerformanceLogs(path.join(storageDir,'recommendation-cache'),
      {getLimitBytes:()=>this.computationSettings.cacheLimitMiB*1024**2});
    this.recommendations=new RecommendationWorker({createWorker:createRecommendationWorker,cacheDir:path.join(storageDir,'recommendation-cache'),
      prepareWorker:prepareRecommendationWorker,releaseWorker:releaseRecommendationWorker,
      getSettings:()=>this.computationSettings,
      getDiagnostics:()=>this.experimentalSettings?.performanceDebug?{level:'modules'}:performanceTrace.options(),
      onProfile:report=>this.experimentalSettings?.performanceDebug?this.performanceLogs.write(report):undefined});
    this.plans=new Map();this.jobs=new Map();this.keys=new Map();
    this.recommendationPages=new Set();
    this.listeners=new Set();this.epoch=crypto.randomUUID();this.activeJobId=null;this.bridge=null;this.disposed=false;
    this.stateFile=path.join(storageDir,'mcp-state.json');
    this.mcpEnabled=false;this.persistenceReady=false;this.httpPort=DEFAULT_HTTP_PORT;
    this.experimentalSettings=experimentalSettings.normalize();
    this.recommendationFilters=selectionFilters.normalize();
    try{fs.mkdirSync(storageDir,{recursive:true,mode:0o700});this.persistenceReady=true;this.load();}
    catch(e){this.mcpEnabled=false;this.storageError=e.message;}
    // Reconcile older cache files with the shared budget after loading settings.
    this.cacheReady=this.recommendations.maintain(()=>this.maintainDiskCache()).catch(e=>({error:e.message}));
  }
  load() {
    if(!fs.existsSync(this.stateFile))return;
    try{
      const saved=JSON.parse(fs.readFileSync(this.stateFile,'utf8'));
      this.recommendationFilters=selectionFilters.normalize(saved.recommendationFilters);
      this.computationSettings=computationSettings.normalizePreferences(saved.computationSettings);
      this.experimentalSettings=experimentalSettings.normalize(saved.experimentalSettings);
      this.mcpEnabled=saved.mcpEnabled===true;
      if(Number.isInteger(saved.httpPort)&&saved.httpPort>=1&&saved.httpPort<=65535)this.httpPort=saved.httpPort;
      for(const job of saved.jobs||[]){
        if(TERMINAL.has(job.state)&&this.now()-Date.parse(job.createdAt)>JOB_RETENTION_MS)continue;
        if(!TERMINAL.has(job.state)){
          job.state='interrupted';job.verified=false;job.partialApplied='unknown';
          job.error={code:'INTERRUPTED',message:'插件重载或进程退出，先核对当前账号状态'};
          job.updatedAt=nowIso();
        }
        this.jobs.set(job.jobId,job);
        if(job.idempotencyKey)this.keys.set(job.idempotencyKey,{jobId:job.jobId,planId:job.planId});
      }
      this.persist();
    }catch(_){
      // Corrupt persistence must never silently grant execution permission.
      this.mcpEnabled=false;this.experimentalSettings=experimentalSettings.normalize();this.jobs.clear();this.keys.clear();
    }
  }
  persist() {
    if(!this.persistenceReady)return;
    for(const [id,job] of this.jobs){
      if(TERMINAL.has(job.state)&&this.now()-Date.parse(job.createdAt)>JOB_RETENTION_MS){
        this.jobs.delete(id);if(job.idempotencyKey)this.keys.delete(job.idempotencyKey);
      }
    }
    const record={mcpEnabled:this.mcpEnabled,httpPort:this.httpPort,recommendationFilters:this.recommendationFilters,
      computationSettings:this.computationSettings,experimentalSettings:this.experimentalSettings,jobs:[...this.jobs.values()]};
    const temp=this.stateFile+'.tmp';fs.writeFileSync(temp,JSON.stringify(record,null,2),{mode:0o600});fs.renameSync(temp,this.stateFile);
  }
  saveJobState(job){
    try{this.persist();return this.persistenceReady;}
    catch(e){
      this.persistenceReady=false;this.mcpEnabled=false;this.storageError=e.message;
      job.persistenceError=e.message;
      return false;
    }
  }
  subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  setRecommendationPageActive(kind,active){
    if(this.disposed||!['normal','expedition'].includes(kind))return;
    if(active)this.recommendationPages.add(kind);else this.recommendationPages.delete(kind);
    // React cleans up the old tab before activating its peer. Coalesce that
    // transition so normal <-> expedition can share the same empty process.
    if(this.recommendationWarmScheduled)return;
    this.recommendationWarmScheduled=true;
    queueMicrotask(()=>{
      this.recommendationWarmScheduled=false;
      if(!this.disposed)void this.recommendations.setWarmEnabled(this.recommendationPages.size>0).catch(()=>{});
    });
  }
  getRecommendationFilters(){return selectionFilters.normalize(this.recommendationFilters);}
  getComputationSettings(){return computationSettings.normalizePreferences(this.computationSettings);}
  getExperimentalSettings(){return experimentalSettings.normalize(this.experimentalSettings);}
  setExperimentalSettings(value){
    if(!this.persistenceReady)throw error('PERSISTENCE_UNAVAILABLE','设置不可写');
    try{experimentalSettings.validate(value);}catch(e){throw error('INVALID_QUERY',e.message);}
    const previous=this.experimentalSettings;
    this.experimentalSettings=experimentalSettings.normalize({...previous,...value});
    try{this.persist();}catch(e){this.experimentalSettings=previous;throw error('PERSISTENCE_UNAVAILABLE','实验功能设置保存失败：'+e.message);}
    this.emit({type:'experimentalSettings'});
    // Disabling revokes queued work too. A request already sent to the game
    // cannot be undone; cancellation stops the subsequent steps.
    if(!this.experimentalSettings.automaticOperations&&this.activeJobId)this.cancelJob({jobId:this.activeJobId});
    return this.getExperimentalSettings();
  }
  assertAutomaticOperations(){
    if(!this.experimentalSettings.automaticOperations)
      throw error('AUTOMATIC_OPERATIONS_DISABLED','自动操作已关闭；请在设置的“实验功能”中开启“自动操作”');
  }
  async getComputationStatus(){
    await this.cacheReady;
    const cache=await inspectCache(this.recommendations.cacheDir);
    if(this.performanceLogs.lastError)cache.logs={...cache.logs,writeError:this.performanceLogs.lastError};
    return {settings:this.getComputationSettings(),...computationSettings.resources(this.computationSettings),
      busy:this.recommendations.queued>0,cache:{...cache,schemes:await this.schemes.inspectCache()}};
  }
  async maintainDiskCache(){
    const options={limitMiB:this.computationSettings.cacheLimitMiB};
    const first=await maintainCache(this.recommendations.cacheDir,options);
    if(!first.overLimit)return first;
    // Only this owner can evict the scheme file and clear its in-memory map.
    const schemes=await this.schemes.clearCache(),last=await maintainCache(this.recommendations.cacheDir,options);
    return {removed:first.removed+schemes.removed+last.removed,failed:first.failed+schemes.failed+last.failed,
      ...(last.overLimit?{error:'部分文件被占用，缓存总占用仍超过上限'}:{})};
  }
  async setComputationSettings(value){
    if(!this.persistenceReady)throw error('PERSISTENCE_UNAVAILABLE','设置不可写');
    try{computationSettings.validatePreferences(value);}catch(e){throw error('INVALID_QUERY',e.message);}
    const previous=this.computationSettings;
    this.computationSettings=computationSettings.normalizePreferences({...previous,...value});
    try{this.persist();}catch(e){this.computationSettings=previous;throw error('PERSISTENCE_UNAVAILABLE','计算资源设置保存失败：'+e.message);}
    this.emit({type:'computationSettings'});
    // Changing concurrency never changes candidate limits or invalidates drafts.
    let maintenance={removed:0,failed:0};
    if(previous.cacheLimitMiB!==this.computationSettings.cacheLimitMiB)try{
      maintenance=await this.recommendations.maintain(()=>this.maintainDiskCache());
    }catch(e){maintenance={error:e.message};}
    return {...await this.getComputationStatus(),maintenance};
  }
  async resetRecommendationSettings(){
    if(!this.persistenceReady)throw error('PERSISTENCE_UNAVAILABLE','设置不可写');
    const filters=this.recommendationFilters,computation=this.computationSettings;
    this.recommendationFilters=selectionFilters.normalize();
    this.computationSettings=computationSettings.normalizePreferences();
    try{this.persist();}catch(e){
      this.recommendationFilters=filters;this.computationSettings=computation;
      throw error('PERSISTENCE_UNAVAILABLE','默认设置保存失败：'+e.message);
    }
    this.emit({type:'recommendationSettings'});this.emit({type:'computationSettings'});
    let maintenance={removed:0,failed:0};
    if(computation.cacheLimitMiB!==this.computationSettings.cacheLimitMiB)try{
      maintenance=await this.recommendations.maintain(()=>this.maintainDiskCache());
    }catch(e){maintenance={error:e.message};}
    return {filters:this.getRecommendationFilters(),computation:{...await this.getComputationStatus(),maintenance}};
  }
  async clearRecommendationCache(kind){
    if(!['results','calculations','schemes','logs','all'].includes(kind))throw error('INVALID_QUERY','无效的缓存类别');
    const maintenance=await this.recommendations.maintain(async()=>{
      const operations=[];
      if(kind!=='schemes')operations.push(()=>maintainCache(this.recommendations.cacheDir,{clear:kind}));
      if(kind==='schemes'||kind==='all')operations.push(()=>this.schemes.clearCache());
      const result={removed:0,failed:0};
      // Failure in one category must not prevent the other from being cleared.
      for(const operation of operations)try{
        const next=await operation();result.removed+=next.removed;result.failed+=next.failed;
      }catch(e){result.failed++;result.error=e.message;}
      if((kind==='logs'||kind==='all')&&!result.failed)this.performanceLogs.lastError=null;
      return result;
    });
    return {...await this.getComputationStatus(),maintenance};
  }
  setRecommendationFilters(value){
    if(!this.persistenceReady)throw error('PERSISTENCE_UNAVAILABLE','设置不可写');
    for(const [kind,group]of Object.entries(value||{})){
      if(!selectionFilters.DEFAULTS[kind]||!group||typeof group!=='object')throw error('INVALID_QUERY','无效的推荐设置');
      for(const [key,v]of Object.entries(group)){
        if(!(key in selectionFilters.DEFAULTS[kind])||(key==='defaultGoal'?!['great','success'].includes(v):key==='maxRoutes'?(!Number.isInteger(v)||v<1||v>20):key==='minLevel'?(!Number.isInteger(v)||v<0||v>999):typeof v!=='boolean'))
          throw error('INVALID_QUERY','无效的排除选项：'+key);
      }
    }
    const previous=this.recommendationFilters;
    this.recommendationFilters=selectionFilters.normalize(Object.fromEntries(Object.keys(selectionFilters.DEFAULTS).map(k=>[k,{...previous[k],...value?.[k]}])));
    try{this.persist();}catch(e){this.recommendationFilters=previous;throw error('PERSISTENCE_UNAVAILABLE','推荐设置保存失败：'+e.message);}
    this.emit({type:'recommendationSettings'});return this.getRecommendationFilters();
  }
  emit(event){for(const listener of this.listeners)try{listener(event);}catch(_){}}
  progress(event){
    this.emit(event);
    const job=this.jobs.get(this.activeJobId);if(!job)return;
    job.progress=event;job.updatedAt=nowIso();
    job.events.push({time:job.updatedAt,...event});if(job.events.length>100)job.events.shift();
  }
  // Single master switch: enabled exposes the whole MCP surface (queries,
  // previews AND execution) with the bridge running; disabled stops the
  // bridge entirely so nothing is exposed locally.
  setMcpEnabled(value){
    if(value===true&&!this.persistenceReady)throw error('PERSISTENCE_UNAVAILABLE','任务记录不可写，不能开启 MCP 接入');
    const previous=this.mcpEnabled;
    this.mcpEnabled=value===true;
    try{this.persist();}catch(e){this.mcpEnabled=previous;this.persistenceReady=false;this.storageError=e.message;
      throw error('PERSISTENCE_UNAVAILABLE','任务记录不可写，不能更改 MCP 接入');}
    return this.mcpEnabled; // async bridge flip is driven by the panel wrapper
  }
  getStatus(){
    let dataReady=true,reason=null;try{businessState(this.getStore());}catch(e){dataReady=false;reason=e.message;}
    return {contractVersion:'2',sessionEpoch:this.epoch,dataReady,dataReason:reason,
      mcpEnabled:this.mcpEnabled,activeJobId:this.activeJobId,
      recommendationFilters:this.getRecommendationFilters(),
      experimentalSettings:this.getExperimentalSettings(),
      bridgeReady:!!this.bridge,instanceId:this.bridge?.instanceId||null,
      mcpHttp:{port:this.bridge?.httpPort||null,wanted:this.httpPort,
        address:this.bridge?.httpAddress||null,
        active:!!this.bridge,error:this.bridgeError||null},
      capabilities:{snapshot:true,preview:true,execute:this.experimentalSettings.automaticOperations,structuralEvaluation:true,numericEvaluation:true,
        numericMetrics:['airPower','lineOfSight','speed','openingASW'],route:true,eventRoutes:false,
        normalRouteBranches:true,normalRouteAirControl:true,
        normalFleetRecommendation:true,expeditionFleetRecommendation:true,
        currentFleets:true,gamePresets:true,shipMechanisms:true,normalMapDetails:true,
        normalEquipmentRecommendation:true,expeditionEquipmentRecommendation:true,manualConstraints:true},
      schemes:{enabled:this.computationSettings.schemeCache,count:this.schemes.items.size,error:this.schemes.storeError||null},
      recognition:'current-plugin-runtime',bridgeError:this.bridgeError||this.storageError||null};
  }
  // (Re)creates the loopback bridge with the current httpPort. Owned here so
  // a panel port change takes effect without reloading the plugin.
  async startMcpServer(){
    if(this.disposed)throw error('PLUGIN_OFFLINE','插件已卸载');
    const previous=this.bridge;this.bridge=null;
    if(previous)await previous.close().catch(()=>{});
    const bridge=new McpHttpServer(this,{httpPort:this.httpPort});
    try{await bridge.start();}
    catch(e){this.bridgeError=e.message;throw e;}
    this.bridge=bridge;this.bridgeError=null;this.emit({type:'bridge',port:bridge.httpPort});
    return {instanceId:bridge.instanceId,httpAddress:bridge.httpAddress,httpError:bridge.httpError};
  }
  setHttpPort(port){
    if(!Number.isInteger(port)||port<1||port>65535)throw error('INVALID_QUERY','端口必须是 1-65535 的整数');
    if(port===this.httpPort)return Promise.resolve(this.getStatus().mcpHttp);
    const previous=this.httpPort;this.httpPort=port;
    try{this.persist();}catch(e){this.httpPort=previous;this.persistenceReady=false;this.storageError=e.message;
      throw error('PERSISTENCE_UNAVAILABLE','端口设置不可写');}
    // Editable while disabled too: when the bridge is down (MCP off) the port
    // only persists; it takes effect on the next enable.
    if(!this.bridge)return Promise.resolve(this.getStatus().mcpHttp);
    return this.startMcpServer().then(()=>this.getStatus().mcpHttp);
  }
  getContract(){return contract();}
  queryFleets({snapshotId}){return {snapshotId,...pageQueries.fleets(this.snapshots.get(snapshotId).store,this.now())};}
  queryFleetPresets({snapshotId}){return {snapshotId,...pageQueries.presets(this.snapshots.get(snapshotId).store)};}
  queryFleetStatus(args){
    const {snapshotId}=args,store=this.snapshots.get(snapshotId).store;
    const scheme=args.scheme!==undefined||args.schemeName!==undefined?this.resolveSchemeSource(args):undefined;
    if(scheme&&args.fleet!==undefined&&args.fleet!==scheme.fleet)throw error('INVALID_QUERY','fleet must match scheme.fleet');
    return {snapshotId,...pageQueries.fleetStatus(store,{...args,scheme},this.now())};
  }
  queryEquipmentOptions(args){return {snapshotId:args.snapshotId,...pageQueries.equipmentOptions(this.snapshots.get(args.snapshotId).store,args)};}
  queryNormalMap(args){return {snapshotId:args.snapshotId,...pageQueries.mapDetail(this.snapshots.get(args.snapshotId).store,args,this.getRecommendationFilters().normal)};}
  listExpeditions({snapshotId,...query}){
    const snapshot=this.snapshots.get(snapshotId);
    return {snapshotId,...pageQueries.missions(snapshot.store,query)};
  }
  evaluateExpedition({snapshotId,fleet,missionId,scheme,schemeName}){
    if(scheme!==undefined||schemeName!==undefined)scheme=this.resolveSchemeSource({scheme,schemeName});
    if(scheme&&fleet!==undefined&&fleet!==scheme.fleet)throw error('INVALID_QUERY','fleet must match scheme.fleet');
    fleet=pageQueries.fleetNumber(scheme?.fleet??fleet??2);
    if(!Number.isInteger(missionId))throw error('INVALID_QUERY','missionId 必须是远征编号');
    if(!expeditions.DATA.missions[missionId])throw error('INVALID_QUERY','Unknown missionId');
    const snapshot=this.snapshots.get(snapshotId);
    const candidate=scheme?pageQueries.resolveCandidate(snapshot.store,scheme):null;
    const resolved=candidate?.scheme||pageQueries.fleetStatus(snapshot.store,{fleet},this.now()).scheme;
    return {snapshotId,...expeditions.evaluateExpedition(snapshot.store,fleet,missionId,resolved),
      income:require('../domain/expeditions/expedition_income').missionIncome(snapshot.store,resolved.ships,missionId)};
  }
  async recommendExpeditionFleet(args){
    return this.recommendWithFilters('recommendExpeditionFleet','expedition',args);
  }
  listNormalMaps({snapshotId}){
    this.snapshots.get(snapshotId);
    return normalRoutes.listNormalMaps();
  }
  evaluateNormalRoute({snapshotId,...args}){
    const snapshot=this.snapshots.get(snapshotId);
    if(args.scheme!==undefined||args.schemeName!==undefined)args={...args,scheme:this.resolveSchemeSource(args)};
    return {snapshotId,...pageQueries.evaluateRoute(snapshot.store,{...args,fleet:args.fleet??args.scheme?.fleet??1},this.getRecommendationFilters().normal)};
  }
  async recommendNormalFleet(args){
    return this.recommendWithFilters('recommendNormalFleet','normal',args);
  }
  async recommendWithFilters(method,kind,args){
    const snapshot=this.snapshots.get(args.snapshotId),filters=this.getRecommendationFilters()[kind];
    args=pageQueries.recommendationArgs(snapshot.store,args);
    const input=selectionFilters.planningStore(snapshot.store,filters);
    const result=await this.recommendations.run(method,input,{...args,automaticFilters:filters});
    pageQueries.verifyConstraints(result,args);
    const reason=selectionFilters.evaluator(snapshot.store,kind,filters),counts={};
    let excluded=0;
    for(const id of Object.keys(snapshot.store.info.ships)){
      if(args.fixedShipIds?.includes(Number(id)))continue;
      const reasons=reason(Number(id));if(reasons.length)excluded++;
      for(const r of reasons)counts[r]=(counts[r]||0)+1;
    }
    const summary=Object.entries(counts).map(([r,n])=>`${r} ${n} 艘`).join('、');
    if(!result.recommendations?.length&&summary)result.reason=(result.reason||'没有找到合适的编成')+'；全局排除：'+summary+'。可到设置调整';
    if(summary)for(const row of result.routeResults||[])if(row.status!=='available')row.message=(row.message||'没有找到合适的编成')+'；全局排除：'+summary+'。可到设置调整';
    const output={snapshotId:args.snapshotId,...result,
      recommendations:(result.recommendations||[]).map(row=>({...row,planningOnly:input!==snapshot.store})),
      ...(result.closestRecommendation?{closestRecommendation:{...result.closestRecommendation,planningOnly:input!==snapshot.store}}:{}),
      selectionFilters:{settings:filters,excluded,counts}};
    if(result.goals)output.goals=Object.fromEntries(Object.entries(result.goals).map(([goal,value])=>[goal,{
      ...value,snapshotId:args.snapshotId,
      ...(!value.recommendations?.length&&summary?{reason:(value.reason||'没有找到合适的编成')+'；全局排除：'+summary+'。可到设置调整'}:{}),
      recommendations:(value.recommendations||[]).map(row=>({...row,planningOnly:input!==snapshot.store})),
      ...(value.closestRecommendation?{closestRecommendation:{...value.closestRecommendation,planningOnly:input!==snapshot.store}}:{}),
      selectionFilters:output.selectionFilters}]));
    return output;
  }
  async recommendNormalEquipment(args){
    const snapshot=this.snapshots.get(args.snapshotId);
    args=this.equipmentRecommendationArgs(snapshot.store,args);
    const result=pageQueries.verifyConstraints(await this.recommendations.run('recommendNormalEquipment',snapshot.store,args),args,true);
    return {snapshotId:args.snapshotId,...result,evaluation:pageQueries.evaluateRoute(snapshot.store,
      {...args,scheme:result.scheme,fleet:result.scheme.fleet},this.getRecommendationFilters().normal)};
  }
  async recommendExpeditionEquipment(args){
    const snapshot=this.snapshots.get(args.snapshotId);
    args=this.equipmentRecommendationArgs(snapshot.store,args);
    return {snapshotId:args.snapshotId,...pageQueries.verifyConstraints(await this.recommendations.run('recommendExpeditionEquipment',snapshot.store,args),args,true)};
  }
  equipmentRecommendationArgs(store,args){
    const scheme=this.resolveSchemeSource(args);validateSchemeShape(scheme);
    // Equipment-only fitting starts unlocked slots empty. Resolve hull names
    // and order without first requiring the discarded draft loadout to be
    // executable (it may contain gaps or stale transport equipment).
    const hulls={fleet:scheme.fleet,ships:scheme.ships.map(s=>s&&typeof s==='object'?{...(s.id!==undefined?{id:s.id}:{name:s.name})}:s)};
    const candidate=pageQueries.resolveCandidate(store,hulls);
    return pageQueries.recommendationArgs(store,{...args,scheme:candidate.scheme});
  }
  createSnapshot(){return this.snapshots.create();}
  queryShips(query){return this.snapshots.queryShips(query);}
  queryEquipment(query){return this.snapshots.queryEquipment(query);}
  // Scheme tools use disposable local cache data, so none of these
  // check the execute permission or the busy lock.
  async saveScheme({name,scheme,overwrite,validateWithSnapshotId}) {
    validateSchemeShape(scheme);
    scheme=JSON.parse(JSON.stringify(scheme));
    const warnings=[];
    if(validateWithSnapshotId!==undefined){
      const snapshot=this.snapshots.get(validateWithSnapshotId);
      try{new Controller({getStore:()=>snapshot.store}).preview('fleet',scheme);}
      catch(e){warnings.push(e.message);}
    }
    return this.recommendations.maintain(async()=>{
      return {...await this.schemes.set({name,scheme,overwrite:overwrite===true}),warnings};
    });
  }
  querySchemes(query){return this.schemes.list(query);}
  async deleteScheme({name}) {
    if(typeof name!=='string')throw error('INVALID_QUERY','name 须为字符串');
    const removed=await this.recommendations.maintain(()=>this.schemes.remove(name.trim()));
    return {deleted:true,...removed};
  }
  // preview/evaluate accept an inline scheme or a reference into the scheme
  // store — exactly one of the two.
  resolveSchemeSource({scheme,schemeName}) {
    if((scheme===undefined)===(schemeName===undefined))
      throw error('INVALID_QUERY','scheme 与 schemeName 必须恰好提供一个');
    if(schemeName===undefined)return scheme;
    if(typeof schemeName!=='string'||!schemeName.trim())throw error('INVALID_QUERY','schemeName 须为非空字符串');
    return this.schemes.get(schemeName.trim()).scheme;
  }
  evaluateFleet(args){
    const {snapshotId,conditions={}}=args,scheme=this.resolveSchemeSource(args);
    const snapshot=this.snapshots.get(snapshotId);
    if(!conditions||typeof conditions!=='object'||Array.isArray(conditions)||
      conditions.enemyAirPower!==undefined&&(!Number.isInteger(conditions.enemyAirPower)||conditions.enemyAirPower<0)||
      conditions.los!==undefined&&(!conditions.los||!Number.isInteger(conditions.los.coefficient)||
        conditions.los.coefficient<1||conditions.los.coefficient>4||
        ['minimum','maximum'].some(key=>conditions.los[key]!==undefined&&
          (!Number.isFinite(conditions.los[key])||conditions.los[key]<0))||
        conditions.los.minimum!==undefined&&conditions.los.maximum!==undefined&&
          conditions.los.minimum>conditions.los.maximum))
      throw error('INVALID_QUERY','评价条件需提供非负敌制空值与合法的 33 式分岐点系数/门槛');
    const checks=['structure','instanceAvailability','equipmentExclusivity','slotEligibility',
      'airPower','lineOfSight','speed','openingASW'];
    let plan;
    try{plan=new Controller({getStore:()=>snapshot.store}).preview('fleet',scheme);}
    catch(e){return {snapshotId,valid:false,supportedChecks:checks,unsupportedChecks:['route'],
      metrics:{structural:'fail'},reason:e.message,ruleVersion:RULE_VERSION};}
    return {snapshotId,valid:true,supportedChecks:checks,unsupportedChecks:['route'],
      changed:plan.changed,donors:plan.equipment.donors?.map(d=>d.shipId)||[],
      metrics:{structural:'pass',...evaluateCandidate(snapshot.store,plan,conditions)},ruleVersion:RULE_VERSION};
  }
  preview(kind,scheme){return this.controller.preview(kind,scheme);}
  previewFleet(args){
    const {snapshotId}=args,scheme=this.resolveSchemeSource(args);
    const snapshot=this.snapshots.get(snapshotId),live=fingerprint(this.getStore());
    if(fingerprint(snapshot.store)!==live)throw error('STATE_CHANGED','快照后账号状态已变化，请重新读取并预览');
    let plan;try{plan=this.controller.preview('fleet',scheme);}catch(e){throw error('INVALID_SCHEME',e.message);}
    const targets=plan.pinned.org.ships.map(x=>x.id),eqByShip=new Map(plan.pinned.eq.ships.map(x=>[x.id,x]));
    const pinnedScheme={fleet:plan.fleet,ships:targets.map(id=>({id,...(eqByShip.get(id)||{})}))};
    const planId=crypto.randomUUID(),expiresAt=this.now()+PLAN_TTL_MS;
    this.plans.set(planId,{planId,snapshotId,pinnedScheme,fingerprint:live,expiresAt,
      expected:JSON.stringify({targets,eq:plan.equipment.expected}),affectedIds:[...new Set([...targets,...(plan.equipment.donors||[]).map(d=>d.shipId)])]});
    for(const [id,p] of this.plans)if(p.expiresAt<=this.now()||this.plans.size>20)this.plans.delete(id);
    return {planId,snapshotId,expiresAt:new Date(expiresAt).toISOString(),pinnedScheme,
      changed:plan.changed,done:plan.done,targets,affectedShipIds:this.plans.get(planId).affectedIds,
      equipmentSteps:(plan.equipment.steps||[]).map(({shipId,op})=>({shipId,kind:op.kind,slot:op.j??null,itemId:op.id??null,
        sourceShipId:op.source?.shipId??null,sourceSlot:op.source?.j??null})),
      warning:'执行前会重新核对账号状态；成功前不要重复提交其他计划'};
  }
  assertIdle(){if(this.disposed||this.activeJobId||this.controller.running)throw error('BUSY','已有编成或换装任务正在执行');}
  newJob(source,planId,scheme,affectedIds,idempotencyKey=null){
    const job={jobId:crypto.randomUUID(),source,planId,idempotencyKey,state:'accepted',createdAt:nowIso(),updatedAt:nowIso(),
      events:[],progress:null,result:null,error:null,partialApplied:false,verified:false,affectedShipIds:affectedIds};
    this.jobs.set(job.jobId,job);this.activeJobId=job.jobId;
    if(idempotencyKey)this.keys.set(idempotencyKey,{jobId:job.jobId,planId});
    if(source==='panel'){this.saveJobState(job);return job;}
    try{this.persist();return job;}
    catch(e){this.jobs.delete(job.jobId);this.activeJobId=null;if(idempotencyKey)this.keys.delete(idempotencyKey);
      this.persistenceReady=false;this.mcpEnabled=false;this.storageError=e.message;
      throw error('PERSISTENCE_UNAVAILABLE','任务记录不可写，Agent 执行未启动');}
  }
  async finishJob(job,scheme,beforeFingerprint){
    try{
      if(job.state==='stopping')throw error('CANCELLED','任务在启动前已停止');
      this.assertAutomaticOperations();
      job.state='running';job.updatedAt=nowIso();
      if(!this.saveJobState(job)&&job.source==='mcp')
        throw error('PERSISTENCE_UNAVAILABLE','任务记录不可写，Agent 执行未启动');
      const result=await this.controller.run('fleet',scheme);
      job.state='succeeded';job.result=result;job.verified=result.ok===true&&result.done===true;
      job.partialApplied=result.changed>0;
      return result;
    }catch(e){
      job.state=job.state==='stopping'?'cancelled':'failed';
      job.error={code:job.state==='cancelled'?'CANCELLED':e.code||'EXECUTION_FAILED',message:e.message};
      if(e.code==='OBSERVATION_TIMEOUT'&&e.diagnostics)job.error.diagnostics=e.diagnostics;
      job.verified=false;
      try{job.partialApplied=fingerprint(this.getStore())!==beforeFingerprint?true:'unknown';}
      catch(_){job.partialApplied='unknown';}
      throw e;
    }finally{
      job.observedState=observedState(this.getStore(),job.affectedShipIds);
      job.updatedAt=nowIso();this.activeJobId=null;this.saveJobState(job);
    }
  }
  executePlan({planId,idempotencyKey}){
    if(typeof idempotencyKey!=='string'||!idempotencyKey||idempotencyKey.length>128)
      throw error('INVALID_QUERY','idempotencyKey 必须是 1–128 字符');
    const prior=this.keys.get(idempotencyKey);
    if(prior){
      if(prior.planId!==planId)throw error('IDEMPOTENCY_CONFLICT','同一幂等键已用于另一计划');
      return {jobId:prior.jobId,state:this.jobs.get(prior.jobId)?.state||'interrupted',duplicate:true};
    }
    if(!this.mcpEnabled)throw error('PERMISSION_DENIED','请先在插件面板开启 MCP 接入');
    this.assertAutomaticOperations();
    if(!this.persistenceReady)throw error('PERSISTENCE_UNAVAILABLE','任务记录不可写，无法保证幂等执行');
    this.assertIdle();
    const plan=this.plans.get(planId);
    if(!plan||plan.expiresAt<=this.now())throw error('PLAN_EXPIRED','计划不存在或已过期，请重新预览');
    if(fingerprint(this.getStore())!==plan.fingerprint)throw error('STATE_CHANGED','预览后账号状态已变化，请重新读取并预览');
    const fresh=this.controller.preview('fleet',plan.pinnedScheme);
    if(JSON.stringify({targets:fresh.pinned.org.ships.map(x=>x.id),eq:fresh.equipment.expected})!==plan.expected)
      throw error('STATE_CHANGED','固定实例计划已变化，请重新预览');
    const job=this.newJob('mcp',planId,plan.pinnedScheme,plan.affectedIds,idempotencyKey);
    queueMicrotask(()=>{void this.finishJob(job,plan.pinnedScheme,plan.fingerprint).catch(()=>{});});
    return {jobId:job.jobId,state:'accepted',duplicate:false};
  }
  async run(kind,scheme){
    if(kind!=='fleet')throw error('INVALID_SCHEME','面板仅接受统一舰队方案');
    this.assertAutomaticOperations();
    this.assertIdle();
    const plan=this.controller.preview('fleet',scheme),targets=plan.pinned.org.ships.map(x=>x.id);
    const beforeFingerprint=fingerprint(this.getStore());
    const job=this.newJob('panel',null,scheme,targets);
    return this.finishJob(job,scheme,beforeFingerprint);
  }
  getJob({jobId,idempotencyKey}){
    const id=jobId||this.keys.get(idempotencyKey)?.jobId,job=this.jobs.get(id);
    if(!job)throw error('JOB_NOT_FOUND','任务不存在或记录已过期');
    return {...job};
  }
  cancelJob({jobId}){
    const job=this.jobs.get(jobId);if(!job)throw error('JOB_NOT_FOUND','任务不存在');
    if(TERMINAL.has(job.state))return {jobId,state:job.state};
    if(this.activeJobId!==jobId)throw error('BUSY','任务不在当前执行会话');
    job.state='stopping';job.updatedAt=nowIso();this.saveJobState(job);this.controller.stop();
    return {jobId,state:'stopping'};
  }
  stop(){if(this.activeJobId)return this.cancelJob({jobId:this.activeJobId});return this.controller.stop();}
  async dispose(){this.disposed=true;if(this.activeJobId)this.controller.stop();await this.recommendations.dispose();if(this.bridge)await this.bridge.close();await this.schemes.pending;this.controller.dispose();}
}
module.exports={FleetAdvisorService,observedState};
