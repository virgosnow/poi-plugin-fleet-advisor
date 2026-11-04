'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {QuestObserver}=require('../../src/infrastructure/quests/quest_observer');
const {QuestAutoRead}=require('../../src/infrastructure/quests/quest_auto_read');
const {syncQuests}=require('../../src/infrastructure/quests/quest_sync');
const LIST='/kcsapi/api_get_member/questlist';
const row=(id,state=1)=>({api_no:id,api_state:state,api_title:`task ${id}`});
function fixture(){
  const store={info:{basic:{api_member_id:123},quests:{activeQuests:{}}}},observer=new QuestObserver({getState:()=>store});
  let time=0,calls=0,reconciled=null;
  const reader={context:async()=>({ready:true,idle:true,compatible:true,sessionKey:'session'}),
    readAll:async()=>{calls++;return {status:'ready',tasks:[row(1,2),row(2),row(3,3)]};}};
  const service={reconcileQuestProgress:rows=>{reconciled=rows;}};
  const auto=new QuestAutoRead({now:()=>time,getContext:()=>reader.context(),getQuestState:()=>({known:observer.hasComplete()}),
    read:args=>syncQuests({observer,reader,service,...args})});
  return {store,observer,reader,auto,get calls(){return calls;},get reconciled(){return reconciled;},setTime:value=>{time=value;}};
}
test('login sync upgrades a partial active cache and all pages share one full observation',async()=>{
  const f=fixture();f.observer.acceptList({api_list:[row(1,2)]});assert.equal(f.observer.hasComplete(),false);
  f.auto.setActive('login',true);assert.equal((await f.auto.tick()).status,'waiting');f.setTime(2000);
  assert.equal((await f.auto.tick()).status,'read');assert.equal(f.observer.hasComplete(),true);
  assert.deepEqual(f.observer.view().tasks.map(x=>x.api_no),[1,2]);assert.equal(f.reconciled.length,3);
  f.auto.setActive('normal',true);f.auto.setActive('practice',true);f.auto.setActive('expedition',true);
  assert.equal((await f.auto.tick()).status,'cached');assert.equal(f.calls,1);
});
test('complete natural all-tab data can satisfy the one-time sync; filtered data cannot',()=>{
  const f=fixture();
  f.observer.observe({path:LIST,postBody:{api_tab_id:'9'},body:{api_count:1,api_list:[row(1,2)]}});
  assert.equal(f.observer.hasComplete(),false);
  f.observer.observe({path:LIST,postBody:{api_tab_id:'0'},body:{api_count:2,api_list:[row(1,2),row(2)]}});
  assert.equal(f.observer.hasComplete(),true);assert.deepEqual(f.observer.view().tasks.map(x=>x.api_no),[1,2]);
});
test('newer natural changes, interrupted reads and session changes cannot be overwritten',async()=>{
  for(const change of ['revision','session','aborted']){
    const f=fixture(),abort=new AbortController();
    f.reader.readAll=async()=>{
      if(change==='revision')f.observer.observe({path:LIST,body:{api_list:[row(5,2)]}});
      if(change==='session')f.reader.context=async()=>({sessionKey:'other'});
      if(change==='aborted')abort.abort();
      return {status:'ready',tasks:[row(1)]};
    };
    const result=await syncQuests({observer:f.observer,reader:f.reader,service:{reconcileQuestProgress(){throw Error('stale');}},
      signal:abort.signal,sessionKey:'session'});
    assert.equal(result.status,'deferred');assert.equal(f.observer.hasComplete(),false);
    assert(!f.observer.view().tasks.some(x=>x.api_no===1));
  }
});
test('an incomplete read preserves prior tasks and is not called successful',async()=>{
  const f=fixture();f.observer.acceptList({api_list:[row(8,2)]});
  f.reader.readAll=async()=>({status:'incomplete'});f.auto.setActive('login',true);
  await f.auto.tick();f.setTime(2000);assert.equal((await f.auto.tick()).status,'failed');
  assert.deepEqual(f.observer.view().tasks.map(x=>x.api_no),[8]);assert.equal(f.observer.hasComplete(),false);
});
test('a new login clears stale observations and permits another read with the same session key',async()=>{
  const f=fixture();f.auto.setActive('login',true);await f.auto.tick();f.setTime(2000);
  await f.auto.tick();assert.equal(f.calls,1);assert.equal(f.observer.hasComplete(),true);
  f.observer.resetSession();f.auto.resetSession();assert.equal(f.observer.view().known,false);
  f.setTime(3000);assert.equal((await f.auto.tick()).status,'waiting');f.setTime(5000);
  assert.equal((await f.auto.tick()).status,'read');assert.equal(f.calls,2);
});
test('claiming a task invalidates completeness so newly unlocked tasks are fetched',async()=>{
  const f=fixture();f.auto.setActive('login',true);await f.auto.tick();f.setTime(2000);await f.auto.tick();
  assert.equal(f.observer.hasComplete(),true);
  f.observer.observe({path:'/kcsapi/api_req_quest/clearitemget',postBody:'api_quest_id=1',body:{}});
  assert.equal(f.observer.hasComplete(),false);f.setTime(3000);await f.auto.tick();f.setTime(5000);
  assert.equal((await f.auto.tick()).status,'read');assert.equal(f.calls,2);
});
