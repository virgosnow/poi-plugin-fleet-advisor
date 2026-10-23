'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {QuestObserver,questDay}=require('../../src/infrastructure/quests/quest_observer');
const LIST='/kcsapi/api_get_member/questlist',QUEST='/kcsapi/api_req_quest/';
function fixture(){
  let now=Date.parse('2026-10-23T12:00:00+09:00');
  const store={info:{basic:{api_member_id:'account-a'},quests:{activeQuests:{}}}};
  const observer=new QuestObserver({getState:()=>store,now:()=>now});
  return {observer,store,setTime:value=>{now=Date.parse(value);},get now(){return now;}};
}
const row=(id,state=1)=>({api_no:id,api_state:state,api_title:'Task '+id,api_get_material:[1,2,3,4]});
test('quest days reset at JST 05:00 rather than local midnight',()=>{
  const before=questDay(Date.parse('2026-10-23T04:59:59+09:00'));
  assert.equal(questDay(Date.parse('2026-10-23T05:00:00+09:00')),before+1);
});
test('only logged-in, actually observed available and ongoing tasks are shown; partial filtered pages merge',()=>{
  const {observer,store}=fixture();assert.deepEqual(observer.view(),{known:false,tasks:[]});
  const original=row(101);observer.observe({path:LIST,postBody:{api_tab_id:3,api_page_no:2},body:{api_list:[original,-1,row(102,2),row(103,3)]}});
  assert.equal(observer.view().known,true);assert.deepEqual(observer.view().tasks.map(t=>t.api_no),[102,101]);
  observer.observe({path:LIST,postBody:{api_tab_id:1,api_page_no:1},body:{api_list:[row(104),-1]}});
  assert.deepEqual(observer.view().tasks.map(t=>t.api_no),[102,101,104]);
  assert.equal(original.api_state,1);original.api_get_material[0]=999;
  assert.equal(observer.view().tasks.find(t=>t.api_no===101).api_get_material[0],1);
  assert.deepEqual(store.info.quests.activeQuests,{});
  delete store.info.basic.api_member_id;assert.deepEqual(observer.query(),{known:false,tasks:[]});
  observer.observe({path:LIST,body:{api_list:[row(999)]}});assert.equal(observer.getState().known,false);
});
test('empty observed pages are known but absence never deletes another page or implies a completed quest',()=>{
  const {observer}=fixture();observer.observe({path:LIST,body:{api_list:[]}});
  assert.deepEqual(observer.view(),{known:true,tasks:[]});
  observer.observe({path:LIST,body:{api_list:[row(1)]}});
  const stable=observer.view();observer.observe({path:LIST,body:{api_list:[]}});assert.equal(observer.view(),stable);
  observer.observe({path:LIST,body:{api_list:[row(1,3)]}});assert.deepEqual(observer.view().tasks,[]);
});

test('a direct successful list merges actual rows without dispatching or modifying host state',()=>{
  const {observer,store}=fixture(),before=JSON.stringify(store);
  assert.equal(observer.acceptList({api_list:[row(1),row(2,2)]}),true);
  assert.deepEqual(observer.view().tasks.map(t=>t.api_no),[2,1]);
  const stable=observer.view();
  assert.equal(observer.acceptList({api_result:0,api_data:{api_list:[row(3)]}}),false);
  assert.equal(observer.acceptList({api_list:null}),false);assert.equal(observer.view(),stable);
  assert.equal(observer.acceptList({api_list:[row(1,3)]}),true);
  assert.deepEqual(observer.view().tasks.map(t=>t.api_no),[2]);assert.equal(JSON.stringify(store),before);
  observer.dispose();assert.equal(observer.acceptList({api_list:[row(4)]}),false);
});
test('successful starts, stops and claims update the exact task, including a task not previously paged',()=>{
  const {observer}=fixture();observer.observe({path:LIST,body:{api_list:[row(1),row(2)]}});
  observer.observe({path:QUEST+'start',postBody:{api_quest_id:'1'},body:{}});
  assert.equal(observer.view().tasks.find(t=>t.api_no===1).api_state,2);
  observer.observe({path:QUEST+'stop',postBody:'api_quest_id=1',body:{api_result:1,api_data:{}}});
  assert.equal(observer.view().tasks.find(t=>t.api_no===1).api_state,1);
  observer.observe({path:QUEST+'start',postBody:{api_quest_id:3},body:{}});
  assert.deepEqual(observer.view().tasks.find(t=>t.api_no===3),{api_no:3,api_state:2});
  observer.observe({path:QUEST+'clearitemget',postBody:{api_quest_id:2},body:{}});
  assert(!observer.view().tasks.some(t=>t.api_no===2));
});
test('malformed or failed responses do not change status and view identity stays stable',()=>{
  const {observer}=fixture();observer.observe({path:LIST,body:{api_list:[row(1)]}});const stable=observer.view();
  for(const detail of [null,{}, {path:LIST,body:{api_list:42}},
    {path:LIST,body:{api_result:0,api_data:{api_list:[row(2)]}}},
    {path:LIST,body:{api_list:[-1,null,{},row(-2),row(3,8)]}},
    {path:QUEST+'start',postBody:{api_quest_id:1},body:{api_result:0}},
    {path:QUEST+'stop',postBody:{api_quest_id:0},body:{}},
    {path:QUEST+'clearitemget',postBody:{api_quest_id:1}}])observer.observe(detail);
  assert.equal(observer.view(),stable);
  observer.observe({path:LIST,body:{api_result:1,api_data:{api_list:[row(1)]}}});assert.equal(observer.view(),stable);
});
test('startup seeds only same-day timestamped active rows; accepting data is never inferred from progress records',()=>{
  const {observer,store,now}=fixture();store.info.quests={
    records:{111:{count:5}},activeQuests:{
      1:{detail:row(1,2),time:now-1000},
      2:{detail:row(2,2),time:now-24*60*60*1000},
      3:{detail:row(3,3),time:now},4:{detail:row(4,1),time:now},
      5:{detail:row(5,2)},6:{detail:row(6,2),time:now+1}
    }};
  assert.deepEqual(observer.view().tasks.map(t=>t.api_no),[1]);
  observer.observe({path:QUEST+'clearitemget',postBody:{api_quest_id:1},body:{}});
  assert.deepEqual(observer.view().tasks,[]);assert.deepEqual(observer.view().tasks,[]);
});
test('account changes clear observations, never revive same-reference prior account active rows, and do not persist raw account data',()=>{
  const {observer,store,now}=fixture();store.info.quests.activeQuests={1:{detail:row(1,2),time:now}};
  assert.equal(observer.view().tasks.length,1);
  observer.observe({path:LIST,body:{api_list:[row(2)]}});
  store.info.basic.api_member_id='account-b';assert.deepEqual(observer.view(),{known:false,tasks:[]});
  observer.observe({path:LIST,body:{api_list:[row(3)]}});assert.deepEqual(observer.view().tasks.map(t=>t.api_no),[3]);
  store.info.basic.api_member_id='account-a';assert.deepEqual(observer.view(),{known:false,tasks:[]});
  assert(!JSON.stringify(observer).includes('account-a'));assert(!JSON.stringify(observer).includes('account-b'));
});
test('daily expiry removes stale statuses and stale host rows cannot repopulate; natural new responses restore known state',()=>{
  const {observer,store,setTime}=fixture();setTime('2026-10-23T04:59:59+09:00');
  store.info.quests.activeQuests={1:{detail:row(1,2),time:Date.parse('2026-10-23T04:59:00+09:00')}};
  observer.observe({path:LIST,body:{api_list:[row(2)]}});assert.equal(observer.view().tasks.length,2);
  setTime('2026-10-23T05:00:00+09:00');assert.deepEqual(observer.view(),{known:false,tasks:[]});
  const expired=observer.view();assert.equal(observer.view(),expired);
  observer.observe({path:LIST,body:{api_list:[row(2,2)]}});assert.equal(observer.view().known,true);
  assert.deepEqual(observer.view().tasks.map(t=>t.api_no),[2]);
});
test('closing the observer erases memory and ignores subsequent host events',()=>{
  const {observer}=fixture();observer.observe({path:LIST,body:{api_list:[row(1)]}});
  observer.dispose();const closed=observer.view();assert.deepEqual(closed,{known:false,tasks:[]});
  observer.observe({path:LIST,body:{api_list:[row(2)]}});assert.equal(observer.view(),closed);
});
test('hot-reload handoff restores cloned observed tasks within thirty seconds for the same account',()=>{
  const f=fixture();f.observer.observe({path:LIST,body:{api_list:[row(1),row(2,2)]}});
  const snapshot=f.observer.snapshot();assert.equal(snapshot.capturedAt,f.now);
  assert.match(snapshot.accountKey,/^[0-9a-f]{64}$/);assert.equal(snapshot.day,questDay(f.now));
  assert(!JSON.stringify(snapshot).includes('account-a'));
  snapshot.tasks[0].api_get_material[0]=100;
  assert.equal(f.observer.view().tasks[0].api_get_material[0],1);
  f.setTime(new Date(f.now+30000).toISOString());
  const next=new QuestObserver({getState:()=>f.store,now:()=>f.now});
  assert.equal(next.restore(snapshot),true);assert.equal(next.view().tasks[0].api_get_material[0],100);
  const stable=next.view();assert.equal(next.restore(snapshot),true);assert.equal(next.view(),stable);
  snapshot.tasks[0].api_get_material[0]=200;
  assert.equal(next.view().tasks[0].api_get_material[0],100);
  f.observer.dispose();assert.equal(f.observer.snapshot(),null);assert.equal(f.observer.restore(snapshot),false);
  assert.deepEqual(next.view().tasks.map(task=>task.api_no),[2,1]);
});
test('hot-reload handoff preserves known empty lists and rejects invalid rows atomically',()=>{
  const f=fixture();f.observer.observe({path:LIST,body:{api_list:[]}});
  const snapshot=f.observer.snapshot(),next=new QuestObserver({getState:()=>f.store,now:()=>f.now});
  assert.equal(next.restore(snapshot,f.store),true);assert.deepEqual(next.view(),{known:true,tasks:[]});
  for(const tasks of [[row(1),row(2,3)],[-1],[row(1,8)],[row(1),row(1)]]){
    const stable=next.view();assert.equal(next.restore({...snapshot,tasks}),false);assert.equal(next.view(),stable);
  }
  assert.equal(next.restore({...snapshot,known:false,tasks:[row(1)]}),false);
});
test('hot-reload handoff cannot cross accounts, task days, logout or its expiry, and rejects future timestamps',()=>{
  const f=fixture();f.observer.observe({path:LIST,body:{api_list:[row(1)]}});
  const snapshot=f.observer.snapshot(),next=new QuestObserver({getState:()=>f.store,now:()=>f.now});
  for(const invalid of [null,{}, {...snapshot,accountKey:'another-account'},
    {...snapshot,day:snapshot.day-1},{...snapshot,capturedAt:f.now-30001},
    {...snapshot,capturedAt:f.now+1},{...snapshot,capturedAt:'invalid'}]){
    assert.equal(next.restore(invalid),false);assert.deepEqual(next.view(),{known:false,tasks:[]});
  }
  f.store.info.basic.api_member_id='account-b';assert.equal(next.restore(snapshot),false);
  delete f.store.info.basic.api_member_id;assert.equal(next.restore(snapshot),false);assert.equal(next.snapshot(),null);
  f.store.info.basic.api_member_id='account-a';
  f.setTime('2026-10-24T04:59:59+09:00');
  const beforeReset={...snapshot,day:questDay(f.now),capturedAt:f.now};
  f.setTime('2026-10-24T05:00:00+09:00');assert.equal(next.restore(beforeReset),false);
});
