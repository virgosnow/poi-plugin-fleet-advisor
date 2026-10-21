const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {Controller}=require('../../src/application/controller');
function state(){return {info:{ships:{1:{api_ship_id:1,api_lv:10,api_slot:[-1],api_slot_ex:-1},2:{api_ship_id:2,api_lv:20,api_slot:[-1],api_slot_ex:-1}},equips:{101:{api_slotitem_id:1}},fleets:[{api_ship:[1],api_mission:[0]},{api_ship:[2],api_mission:[0]}],repairs:[]},const:{$ships:{1:{api_name:'first',api_stype:2,api_slot_num:1},2:{api_name:'second',api_stype:2,api_slot_num:1}},$shipTypes:{2:{api_equip_type:{1:1}}},$equips:{1:{api_name:'gun',api_type:[0,0,1,1]}},$exslotEquips:[1],$exslotEquipShips:{},$exslotEquipLimits:{}}};}
function harness(options={}){
 const data=state(),log=[],entry=path.join(__dirname,'../../src/application/controller.js'),module={exports:{}};
 let mode='home',disposed=0,observerDisposals=0,observers=0;
 class FakeSession {constructor(host){this.host=host;this.metrics={started:performance.now()};}check(){if(this.stopped)throw Error('Run stopped');}stop(){this.stopped=true;log.push('stop');}async observe(kind){this.check();return kind==='screen'?{valid:mode!=='unknown',mode}:{valid:mode==='equipment'};}async input(x){this.check();if(x===107){mode=options.homeFailure?'unknown':'home';log.push('home');}}async until(kind,arg,predicate=r=>r.valid){const result=await this.observe(kind);if(!predicate(result))throw Error('Observation timed out: '+kind);return result;}}
 vm.runInNewContext(fs.readFileSync(entry,'utf8'),{module,performance,require(name){
   if(name==='../execution/session')return {Session:FakeSession};
   if(name==='../execution/organize')return {...require('../../src/execution/organize'),restoreOrganization:async(s,scheme)=>{
     log.push('organization');data.info.fleets[0].api_ship=scheme.ships.map(s=>s.id);data.info.fleets[1].api_ship=[];mode='organization';
     if(options.drift)data.info.ships[1].api_slot_ex=101;
     if(options.stop)s.stop();return {ok:true,changed:1};
   }};
   if(name==='../execution/equipment')return {restoreEquipment:async(s,scheme)=>{s.check();assert.equal(mode,'home');log.push('equipment');assert.equal(scheme.ships[0].id,2);assert.equal(scheme.ships[0].slots[0],101);mode='equipment';return {ok:true,changed:1};}};
   return require(path.resolve(path.dirname(entry),name));
 }});
 const c=new module.exports.Controller({getStore:()=>data,createHost(){log.push('host');return {async start(){},async dispose(){disposed++;}};},createObserver(){observers++;return {async start(){},async dispose(){observerDisposals++;}};}});
 return {c,data,log,stats:()=>({disposed,observerDisposals,observers})};
}
test('pure organization preview and no-op unified run need no equipment inventory or host',async()=>{
 const data=state();delete data.info.equips;const c=new Controller({getStore:()=>data,createHost(){throw Error('unexpected host');}});
 const p=c.preview('fleet',{fleet:1,ships:[1]});assert(p.done);assert.equal(p.changed,0);assert.equal((await c.run('fleet',{fleet:1,ships:[1]})).changed,0);
});
test('unified preview resolves new fleet members and exact equipment IDs without mutating state',()=>{
 const data=state(),before=JSON.stringify(data),c=new Controller({getStore:()=>data});
 const p=c.preview('fleet',{fleet:1,ships:[{name:'sec',slots:['gun']}]});
 assert.equal(p.changed,2);assert.equal(p.pinned.org.ships[0].id,2);assert.equal(p.pinned.eq.ships[0].slots[0],101);assert.equal(JSON.stringify(data),before);
 assert.throws(()=>c.preview('equipment',{fleet:1,ships:[{id:2,slots:[101]}]}),/不在/);
});
test('invalid unified equipment is rejected before organization or host startup',async()=>{
 const f=harness();await assert.rejects(f.c.run('fleet',{fleet:1,ships:[{id:2,slots:[999]}]}));assert.deepEqual(f.log,[]);
});
test('unified stages verify home in between and clean up only once, retaining successful observer',async()=>{
 const f=harness(),r=await f.c.run('fleet',{fleet:1,ships:[{id:2,slots:[101]}]});
 assert.equal(r.changed,2);assert.deepEqual(f.log,['host','organization','home','equipment','home','stop']);assert.deepEqual(f.stats(),{disposed:1,observerDisposals:0,observers:1});
 assert(Number.isFinite(r.metrics.totalMs)&&r.metrics.totalMs>=0);assert(Number.isFinite(r.metrics.startupMs)&&r.metrics.startupMs>=0);assert(r.metrics.totalMs>=r.metrics.startupMs);
 await f.c.run('fleet',{fleet:1,ships:[{id:2,slots:[101]}]});assert.equal(f.stats().observers,1);assert.equal(f.stats().disposed,2);
});
test('pure organization still completes and returns home without an equipment stage',async()=>{
 const f=harness();const r=await f.c.run('fleet',{fleet:1,ships:[2]});assert.equal(r.changed,1);assert(!f.log.includes('equipment'));assert.equal(f.stats().disposed,1);
});
for(const option of ['homeFailure','drift','stop'])test('unified '+option+' stops before equipment, with one cleanup',async()=>{
 const f=harness({[option]:true});await assert.rejects(f.c.run('fleet',{fleet:1,ships:[{id:2,slots:[101]}]}));assert(!f.log.includes('equipment'));assert.deepEqual(f.stats(),{disposed:1,observerDisposals:1,observers:1});
});
test('unknown screen never receives a blind home click',async()=>{
 const c=new Controller({});let inputs=0;c.session={check(){},until:async()=>{throw Error('Observation timed out: screen');},input:async()=>inputs++};await assert.rejects(c.returnHomeAndPark(),/无法识别当前画面/);assert.equal(inputs,0);
});
