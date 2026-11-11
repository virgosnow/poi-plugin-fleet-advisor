'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {QuestProgress}=require('../../src/infrastructure/persistence/quest_progress');
const {QuestObserver}=require('../../src/infrastructure/quests/quest_observer');
const {syncQuests}=require('../../src/infrastructure/quests/quest_sync');
const row=(id,state=2)=>({api_no:id,api_state:state,api_title:`Quest ${id}`});
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paa-quest-snapshot-'));
  t.after(()=>{assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
  const store={info:{basic:{api_member_id:'private-account-123'},quests:{activeQuests:{}}}},now=()=>1700000000000;
  const make=()=>{const cache=new QuestProgress(dir,{now}),observer=new QuestObserver({getState:()=>store,now});observer.setCache(cache);return {cache,observer};};
  return {dir,store,make};
}
test('a complete server snapshot restores per account, refreshes and replaces the cache',async t=>{
  const f=fixture(t),first=f.make();assert(first.observer.acceptComplete([row(10),row(20,1)]));await first.cache.pending;
  const second=f.make();assert.deepEqual(second.observer.view().tasks.map(x=>x.api_no),[10,20]);
  assert.equal(second.observer.hasComplete(),true);assert.equal(second.observer.hasFreshComplete(),false);
  f.store.info.basic.api_member_id=456;assert.equal(second.observer.view().known,false);
  f.store.info.basic.api_member_id='private-account-123';assert.deepEqual(second.observer.view().tasks.map(x=>x.api_no),[10,20]);
  let result='incomplete';const reader={readAll:async()=>result==='ready'?{status:'ready',tasks:[row(30)]}:{status:'incomplete'},context:async()=>({sessionKey:'s'})};
  assert.equal((await syncQuests({observer:second.observer,reader,sessionKey:'s'})).status,'incomplete');
  assert.deepEqual(second.observer.view().tasks.map(x=>x.api_no),[10,20]);
  result='ready';assert.equal((await syncQuests({observer:second.observer,reader,sessionKey:'s'})).status,'ready');await second.cache.pending;
  assert.equal(second.observer.hasFreshComplete(),true);assert.deepEqual(second.observer.view().tasks.map(x=>x.api_no),[30]);
  const third=f.make();assert.deepEqual(third.observer.view().tasks.map(x=>x.api_no),[30]);assert.equal(third.observer.hasFreshComplete(),false);
  assert(!fs.readFileSync(second.cache.file,'utf8').includes('private-account-123'),'raw account identifiers are not persisted');
});
test('known empty snapshots restore, and explicit cache clearing removes them',async t=>{
  const f=fixture(t),first=f.make();assert(first.observer.acceptComplete([]));await first.cache.pending;
  const second=f.make();assert.deepEqual(second.observer.view().tasks,[]);assert.equal(second.observer.hasComplete(),true);
  await second.cache.clearCache();assert.equal(f.make().observer.view().known,false);
});
test('an invalid cached snapshot does not create tasks or block refresh',async t=>{
  const f=fixture(t),first=f.make();assert(first.observer.acceptComplete([row(10)]));await first.cache.pending;
  const data=JSON.parse(fs.readFileSync(first.cache.file,'utf8')),key=Object.keys(data.snapshots)[0];
  data.snapshots[key].tasks=[row(10),row(10)];fs.writeFileSync(first.cache.file,JSON.stringify(data));
  const restored=f.make();assert.equal(restored.observer.view().known,false);assert.equal(restored.observer.hasFreshComplete(),false);
});
test('a claimed task is removed from the saved baseline until the next full refresh',async t=>{
  const f=fixture(t),first=f.make();first.observer.acceptList({api_list:[row(99)]});await first.cache.pending;
  assert.equal(f.make().observer.view().known,false,'a partial read is not saved as a complete baseline');
  first.observer.acceptComplete([row(10),row(20)]);await first.cache.pending;
  first.observer.observe({path:'/kcsapi/api_req_quest/clearitemget',postBody:{api_quest_id:10},body:{}});await first.cache.pending;
  const restored=f.make();assert.deepEqual(restored.observer.view().tasks.map(x=>x.api_no),[20]);
  assert.deepEqual(restored.observer.view().claimedTaskIds,[10]);assert.equal(restored.observer.hasComplete(),false);
  assert.equal(restored.observer.hasFreshComplete(),false);
});
