'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('poi entry exports explicit lifecycle hooks and uses an independent Fleet Advisor data directory',async()=>{
  const entry=path.join(__dirname,'../../index.js'),exports={},listeners=new Map(),icons=[],styles=new Map(),storageLocations=[];let remoteRequests=0;
  const document={head:{appendChild:node=>styles.set(node.id,node)},getElementById:id=>styles.get(id),createElement:()=>({remove(){styles.delete(this.id);}})};
  const mockedRequire=name=>{
    if(name==='react')return {};
    if(name==='@fortawesome/fontawesome-svg-core')return {library:{add:icon=>icons.push(icon)}};
    if(name==='fs'||name==='path'||name==='os')return require(name);
    if(name==='./src/infrastructure/persistence/expedition_progress')return {ExpeditionProgress:class extends require('../../src/infrastructure/persistence/expedition_progress').ExpeditionProgress {
      constructor(directory,options){super(directory,options);storageLocations.push(directory);}
    }};
    if(name==='./src/application/fleet_advisor_service')return {FleetAdvisorService:class {
      constructor({storageDir}){this.storageDir=storageDir;storageLocations.push(storageDir);this.persistenceReady=true;}subscribe(){return()=>{};}getStatus(){return {mcpEnabled:false,mcpHttp:{active:false,wanted:47615}};}async startMcpServer(){return {instanceId:'x',httpAddress:null,httpError:null};}dispose(){}
    }};
    if(name==='./src/bridge/http_server')return {McpHttpServer:class {async start(){}async close(){}}};
    if(name==='@electron/remote'){remoteRequests++;throw Error('Remote loaded during idle');}
    return require(path.resolve(path.dirname(entry),name));
  };
  vm.runInNewContext(fs.readFileSync(entry,'utf8'),{exports,require:mockedRequire,window:{document,getStore:()=>({info:{fleets:[]}}),
    addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:(type,fn)=>{assert.equal(listeners.get(type),fn);listeners.delete(type);}},__dirname:path.dirname(entry)});
  assert.equal(typeof exports.reactClass,'function');exports.pluginDidLoad();assert(listeners.has('game.response'));
  const brand=require('../../src/ui/shell/plugin_brand'),pkg=require('../../package.json'),metadata=pkg.poiPlugin,lock=require('../../package-lock.json');
  assert.equal(pkg.name,'poi-plugin-fleet-advisor');assert.equal(metadata.id,pkg.name);assert.notEqual(pkg.private,true);
  assert.equal(lock.name,pkg.name);assert.equal(lock.packages[''].name,pkg.name);
  const directory=path.join(require('os').homedir(),'.'+pkg.name);
  assert.deepEqual(storageLocations,[directory,directory]);
  const {createPoiMapResources}=require('../../src/host/map_resources');
  const resources=createPoiMapResources({remote:{require:name=>{if(name==='electron')return {session:{defaultSession:{}}};throw Error('No host resource cache');}}});
  assert.equal(resources.directory,path.join(directory,'map-cache'));
  assert.equal(brand.title,'舰队参谋');assert.equal(brand.englishTitle,'Fleet Advisor');assert.equal(metadata.title,brand.title);
  assert.equal(icons.length,1);assert.deepEqual(metadata.icon,[icons[0].prefix,icons[0].iconName]);
  assert.equal(styles.size,1);assert.match(styles.get('paa-plugin-icon-style').textContent,/data-icon="paa-fleet-advisor"/);
  exports.pluginDidLoad();assert.equal(styles.size,1);assert.equal(icons.length,1,'repeated enable does not duplicate branding');
  await exports.pluginWillUnload();assert.equal(styles.size,0);assert.equal(listeners.size,0);assert.equal(remoteRequests,0);
});
test('all referenced equipment templates exist in packaged asset set',()=>{
  const icons=require('../../data/equip_icon_index.json').icons;
  for(const icon of icons)assert(fs.existsSync(path.join(__dirname,'../../data/icons',icon.file)),icon.file);
});
test('all legal normal categories are planned before the host starts',()=>{
  const {Controller}=require('../../src/application/controller');
  const state={info:{ships:{1:{api_ship_id:1,api_slot:[101],api_slot_ex:0}},fleets:[{api_ship:[1],api_mission:[0]}],equips:{101:{api_slotitem_id:1},102:{api_slotitem_id:1}}},const:{$ships:{1:{api_stype:2,api_slot_num:1}},$shipTypes:{2:{api_equip_type:{1:1}}},$equips:{1:{api_type:[0,0,1,1]}}}};
  let hosts=0;const controller=new Controller({getStore:()=>state,createHost(){hosts++;},createObserver(){throw Error('Must not start OCR');}});
  const plan=controller.preview('equipment',{fleet:1,ships:[{id:1,slots:[102]}]});
  assert.deepEqual(plan.ships[0].ops.map(op=>op.kind),['clear','slot']);
  assert.equal(hosts,0);assert.deepEqual(state.info.ships[1].api_slot,[101]);
});

test('poi host creates Node workers through main-process remote API',async()=>{
  const {PoiHost}=require('../../src/host/poi_host'),{WorkerObserver}=require('../../src/vision/worker_observer'),{Worker}=require('node:worker_threads');
  const modules=[];const host=new PoiHost({window:{},remote:{require(name){modules.push(name);return {Worker};}}});
  const observer=new WorkerObserver({createWorker:file=>host.createObserverWorker(file)});
  try{await observer.start();assert.deepEqual(modules,['worker_threads']);}finally{await observer.dispose();}
});
