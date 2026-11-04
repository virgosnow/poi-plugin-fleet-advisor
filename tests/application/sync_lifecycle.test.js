'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

// Exercise the real entry point, observers, coordinators and read scheduler.
// Only the game-frame transport and unrelated host services are doubles.
function fixture(initialAccount=null){
  const entry=path.resolve(__dirname,'../../index.js'),out={},timers=new Set(),listeners=new Map(),calls=[];
  const state={info:{basic:initialAccount?{api_member_id:initialAccount}:null,quests:{activeQuests:{}},fleets:[]}};
  let doc=1,reader=null,service=null,api=null,holdQuest=null,holdIdentity=null,version=1;
  const window={document:{},getStore:()=>state,
    addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const key=()=>state.info.basic?`${state.info.basic.api_member_id}:${doc}`:null;
  const taskId=()=>Number(state.info.basic.api_member_id)*100+version;
  class FakeReader{
    constructor(){reader=this;this.sessionKey=null;this.verifiedSessionKey=null;this.closed=false;}
    async context(){const sessionKey=key();this.sessionKey=sessionKey;
      return {ready:!!sessionKey,idle:!!sessionKey,compatible:!!sessionKey,sessionKey,identityVerified:!!sessionKey&&this.verifiedSessionKey===sessionKey};}
    async read({kind,sessionKey}){
      calls.push({kind,sessionKey});if(kind==='identity'&&holdIdentity)await holdIdentity.promise;
      this.verifiedSessionKey=sessionKey;
      if(kind==='identity')return {identityVerified:true};
      if(kind==='mapinfo')return {mapinfo:{maps:[{api_id:11,api_cleared:1}],airbase:[]}};
      if(kind==='presets')return {presets:{api_max_num:0,api_deck:{}}};
      if(kind==='missions')return {missions:{api_list_items:[{api_mission_id:1,api_state:2}]}};
      if(kind==='practice')return {list:{api_list:[{api_enemy_id:123}]}};
      if(kind==='practice-enemy')return {enemy:{api_member_id:123,api_deck:{api_ships:[]}}};
      throw Error('unexpected read '+kind);
    }
    async readAll({sessionKey}){
      calls.push({kind:'quest',sessionKey});this.verifiedSessionKey=sessionKey;
      const id=taskId();if(holdQuest)await holdQuest.promise;
      return {status:'ready',tasks:[{api_no:id,api_state:1,api_category:4,api_title:`quest ${id}`}],pages:1};
    }
    observeStart(){this.verifiedSessionKey=null;this.sessionKey=null;}
    observeRequest(){} observeResponse(){} observeFailure(){}
    async dispose(){this.closed=true;}
  }
  class PracticeObserver{
    constructor(){this.state={known:false,opponents:[],revision:0};}
    view(){return this.state;}
    acceptList(data){this.state={known:true,opponents:data.api_list.map(x=>({id:x.api_enemy_id,ships:null})),revision:this.state.revision+1};return true;}
    acceptEnemy(data){this.state.opponents.find(x=>x.id===data.api_member_id).ships=[];this.state.revision++;return true;}
    resetSession(){this.state={known:false,opponents:[],revision:this.state.revision+1};}
    observe(){} dispose(){}
  }
  class ExpeditionProgress{view(){return {}} observe(){} acceptMissions(){return true} dispose(){}}
  class Service{
    constructor(args){service=this;this.getStore=args.getStore;this.persistenceReady=false;this.activeJobId=null;
      this.questProgressObserver={snapshot(){return null},restore(){},remember(){calls.push({kind:'progress-remember',account:state.info.basic?.api_member_id})},resetSession(){calls.push({kind:'progress-reset'})}};}
    reconcileQuestProgress(){} observeQuestProgress(){calls.push({kind:'progress-observe',account:state.info.basic?.api_member_id})} dispose(){} subscribe(){return ()=>{}}
  }
  const originalAuto=require('../../src/infrastructure/quests/quest_auto_read').QuestAutoRead;
  const originalScheduler=require('../../src/infrastructure/sync/read_scheduler').ReadScheduler;
  const mockedRequire=name=>{
    if(name==='react')return {};
    if(name==='@fortawesome/fontawesome-svg-core')return {library:{add(){}}};
    if(name==='./src/ui/shell/plugin_brand')return {register(){},unregister(){}};
    if(name==='./src/ui/shell/panel')return (_react,options)=>{api=options;return ()=>null;};
    if(name==='./src/application/controller')return {Controller:class {constructor(){this.running=false} dispose(){}}};
    if(name==='./src/application/fleet_advisor_service')return {FleetAdvisorService:Service};
    if(name==='./src/infrastructure/persistence/expedition_progress')return {ExpeditionProgress};
    if(name==='./src/infrastructure/practice/practice_observer')return {PracticeObserver};
    if(name==='./src/host/quest_reader')return {QuestReader:FakeReader};
    if(name==='./src/infrastructure/quests/quest_auto_read')return {QuestAutoRead:class extends originalAuto{constructor(o){super({...o,stableMs:0});}}};
    if(name==='./src/infrastructure/sync/read_scheduler')return {ReadScheduler:class extends originalScheduler{constructor(o){super({...o,spacingMs:0});}}};
    if(name.startsWith('./'))return require(path.resolve(path.dirname(entry),name));
    return require(name);
  };
  const setInterval=fn=>{timers.add(fn);return fn},clearInterval=fn=>timers.delete(fn);
  vm.runInNewContext(fs.readFileSync(entry,'utf8'),{exports:out,require:mockedRequire,window,setInterval,clearInterval,__dirname:path.dirname(entry)});
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  return {out,state,calls,window,get api(){return api},get reader(){return reader},get service(){return service},
    start(){out.pluginDidLoad()},stop(){return out.pluginWillUnload()},setVersion(v){version=v},
    login(account){doc++;state.info.basic={api_member_id:account};listeners.get('game.start')?.({});},
    switchWithoutEvent(account){doc++;state.info.basic={api_member_id:account};},
    response(detail){listeners.get('game.response')?.({detail});},
    async tick(n=1){for(let i=0;i<n;i++){await flush();for(const fn of [...timers])await fn();await flush();}},
    hold(){let resolve;const promise=new Promise(ok=>{resolve=ok});holdQuest={promise,resolve};return ()=>{holdQuest=null;resolve();}},
    holdIdentity(){let resolve;const promise=new Promise(ok=>{resolve=ok});holdIdentity={promise,resolve};return ()=>{holdIdentity=null;resolve();}},
    async until(predicate){for(let i=0;i<40;i++){await this.tick();if(predicate())return;}throw Error('lifecycle did not settle');}};
}

test('plugin starts after an already logged-in game and hydrates all shared data',async t=>{
  const f=fixture(1);f.start();t.after(()=>f.stop());
  await f.until(()=>f.api.getStore().questState.complete&&f.api.getStore().practiceState.known&&f.calls.some(x=>x.kind==='missions'));
  assert.deepEqual(f.api.getStore().questState.tasks.map(x=>x.api_no),[101]);
  assert.deepEqual(new Set(f.calls.map(x=>x.kind).filter(kind=>!kind.startsWith('progress-'))),new Set(['identity','mapinfo','presets','missions','quest','practice','practice-enemy']));
});

test('plugin starts before login and reacts to game.start without opening a task panel',async t=>{
  const f=fixture();f.start();t.after(()=>f.stop());await f.tick(4);assert.equal(f.calls.length,0);
  f.login(2);await f.until(()=>f.api.getStore().questState.complete);
  assert.deepEqual(f.api.getStore().questState.tasks.map(x=>x.api_no),[201]);
});

test('same-session plugin restart refreshes retained tasks rather than treating them as current',async t=>{
  const f=fixture(1);f.start();t.after(()=>f.stop());await f.until(()=>f.api.getStore().questState.complete);
  await f.stop();f.setVersion(2);f.start();
  assert.equal(f.api.getStore().questState.complete,false);
  await f.until(()=>f.api.getStore().questState.complete&&f.api.getStore().questState.tasks.some(x=>x.api_no===102));
  assert.equal(f.calls.filter(x=>x.kind==='quest').length,2);
});

test('a late response from a previous account cannot overwrite the new account',async t=>{
  const f=fixture(1),release=f.hold();f.start();t.after(()=>f.stop());
  await f.until(()=>f.calls.some(x=>x.kind==='quest'));f.login(2);release();
  await f.until(()=>f.api.getStore().questState.complete);
  assert.deepEqual(f.api.getStore().questState.tasks.map(x=>x.api_no),[201]);
  assert(f.calls.some(x=>x.kind==='quest'&&x.sessionKey==='2:2'));
});

test('account and document change without game.start still discards an old response',async t=>{
  const f=fixture(1),release=f.hold();f.start();t.after(()=>f.stop());
  await f.until(()=>f.calls.some(x=>x.kind==='quest'));f.switchWithoutEvent(2);release();
  await f.until(()=>f.api.getStore().questState.complete);
  assert.deepEqual(f.api.getStore().questState.tasks.map(x=>x.api_no),[201]);
});

test('in-flight voyages and progress events are not recovered until the current account is verified',async t=>{
  const f=fixture(1),release=f.holdIdentity();f.start();t.after(()=>f.stop());
  await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
  assert(f.calls.some(x=>x.kind==='identity'&&x.sessionKey==='1:1'));
  f.response({path:'/kcsapi/api_req_mission/result',body:{api_clear_result:1}});
  assert(!f.calls.some(x=>x.kind==='progress-remember'||x.kind==='progress-observe'));
  f.login(2);release();await f.until(()=>f.api.getStore().questState.complete);
  assert(f.calls.some(x=>x.kind==='progress-reset'));
  assert(f.calls.some(x=>x.kind==='progress-remember'&&x.account===2));
  assert(!f.calls.some(x=>x.kind==='progress-remember'&&x.account===1));
  f.response({path:'/kcsapi/api_get_member/questlist',body:{api_list:[]}});
  assert(f.calls.some(x=>x.kind==='progress-observe'&&x.account===2));
});
