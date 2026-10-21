'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const {ExpeditionProgress,expeditionPeriod}=require('../../src/infrastructure/persistence/expedition_progress');
const stamp=s=>Date.parse(s),LIST='/kcsapi/api_get_member/mission',RESULT='/kcsapi/api_req_mission/result';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('automatic refresh waits for login, coalesces polling and refreshes after monthly reset',async t=>{
  const f=fixture(t);let calls=0,resolve;
  const tracker=new ExpeditionProgress(f.dir,{now:()=>Date.parse(trackerTime),getStore:()=>f.store,load:()=>{calls++;return new Promise(r=>{resolve=r;});}});
  let trackerTime='2026-10-16T00:00:00Z';const member=f.store.info.basic.api_member_id;delete f.store.info.basic.api_member_id;
  tracker.view(f.store);await tick();assert.equal(calls,0);
  f.store.info.basic.api_member_id=member;for(let i=0;i<10;i++)tracker.view(f.store);await tick();assert.equal(calls,1);
  resolve({api_list_items:[{api_mission_id:103,api_state:2}]});await tick();
  assert.equal(tracker.view(f.store).records[103].state,2);await tick();assert.equal(calls,1);
  trackerTime='2026-11-15T03:00:00Z';tracker.view(f.store);await tick();assert.equal(calls,2);
  resolve({api_list_items:[{api_mission_id:103,api_state:1}]});await tick();assert.equal(tracker.view(f.store).records[103].period,'2026-11');await tracker.dispose();
});
test('automatic reads retry at most three times, preserve cached data and ignore previous-account replies',async t=>{
  const f=fixture(t);let now=Date.parse('2026-10-16T00:00:00Z'),calls=0;
  const tracker=new ExpeditionProgress(f.dir,{now:()=>now,getStore:()=>f.store,load:async()=>{calls++;throw Error('offline');}});
  tracker.observe({path:LIST,body:[{api_mission_id:1,api_state:2}]},f.store);
  for(let i=0;i<5;i++){tracker.view(f.store);await tick();tracker.view(f.store);await tick();now+=30000;}
  assert.equal(calls,3);assert.equal(tracker.view(f.store).records[1].state,2);await tracker.dispose();
  let resolve;const other=new ExpeditionProgress(f.dir,{getStore:()=>f.store,load:()=>new Promise(r=>{resolve=r;})});
  other.view(f.store);await tick();f.store.info.basic.api_member_id='other';
  resolve({api_list_items:[{api_mission_id:1,api_state:2}]});await tick();assert.deepEqual(other.view(f.store).records,{});
  await tick();resolve({api_list_items:[{api_mission_id:1,api_state:1}]});await tick();await other.dispose();
});
test('natural list updates and successful returns take precedence over an older startup read',async t=>{
  const f=fixture(t);let resolve;
  const tracker=new ExpeditionProgress(f.dir,{getStore:()=>f.store,load:()=>new Promise(r=>{resolve=r;})});
  f.store.info.fleets[1].api_mission=[1,1,Date.now()+60000];tracker.view(f.store);await tick();
  f.store.info.fleets[1].api_mission=[0];tracker.observe({path:RESULT,postBody:{api_deck_id:2},body:{api_clear_result:1}},f.store);
  resolve({api_list_items:[{api_mission_id:1,api_state:1},{api_mission_id:103,api_state:1}]});await tick();
  assert.equal(tracker.view(f.store).records[1].state,2);assert.equal(tracker.view(f.store).records[103].state,1);await tracker.dispose();
  const next=new ExpeditionProgress(f.dir,{getStore:()=>f.store,load:()=>new Promise(r=>{resolve=r;})});next.view(f.store);await tick();
  next.observe({path:LIST,body:[{api_mission_id:103,api_state:2}]},f.store);
  resolve({api_list_items:[{api_mission_id:103,api_state:1}]});await tick();assert.equal(next.view(f.store).records[103].state,2);await next.dispose();
});
test('unloading during a startup read prevents late status updates',async t=>{
  const f=fixture(t);let resolve;const tracker=new ExpeditionProgress(f.dir,{getStore:()=>f.store,load:()=>new Promise(r=>{resolve=r;})});
  tracker.view(f.store);await tick();const closing=tracker.dispose();resolve({api_list_items:[{api_mission_id:1,api_state:2}]});await closing;
  assert.deepEqual(tracker.records,{});
});
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paa-expedition-status-'));
  t.after(()=>{assert(dir.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
  const store={info:{basic:{api_member_id:'first'},fleets:[{api_mission:[0]},{api_mission:[0]}]},const:{$missions:{1:{api_reset_type:0,api_time:15},103:{api_reset_type:1,api_time:110}}}};
  let now=stamp('2026-10-15T12:00:00+09:00');
  const create=()=>new ExpeditionProgress(dir,{now:()=>now});
  return {dir,store,create,setTime:value=>{now=stamp(value);}};
}
test('monthly expedition period follows the JST 15th/noon boundary including the year transition',()=>{
  assert.equal(expeditionPeriod(stamp('2026-10-15T11:59:59+09:00')),'2026-09');
  assert.equal(expeditionPeriod(stamp('2026-10-15T12:00:00+09:00')),'2026-10');
  assert.equal(expeditionPeriod(stamp('2027-01-01T00:00:00+09:00')),'2026-12');
});

test('full mission snapshots persist unlock coverage separately from completion and expire across periods',async t=>{
  const f=fixture(t),tracker=f.create();
  tracker.observe({path:LIST,body:[{api_mission_id:1,api_state:0}]},f.store);
  assert.deepEqual(tracker.view(f.store).list,{period:'2026-10',ids:[1],catalogIds:[1,103]});
  assert.equal(tracker.view(f.store).records[1].state,0);assert.equal(tracker.view(f.store).records[103],undefined);
  const full=tracker.view(f.store);tracker.observe({path:LIST,body:[]},f.store);assert.equal(tracker.view(f.store),full);
  await tracker.dispose();const reload=f.create();assert.deepEqual(reload.view(f.store).list,tracker.list);
  f.store.const.$missions[104]={api_reset_type:1};assert(!reload.view(f.store).list.catalogIds.includes(104));
  f.setTime('2026-11-15T12:00:00+09:00');assert.equal(reload.view(f.store).period,'2026-11');assert.equal(reload.view(f.store).list.period,'2026-10');
  reload.observe({path:LIST,body:[{api_mission_id:1,api_state:2},{api_mission_id:103,api_state:0},{api_mission_id:104,api_state:8}]},f.store);
  assert.deepEqual(reload.view(f.store).list.ids,[1,103,104]);assert.equal(reload.view(f.store).records[104],undefined);
  f.store.info.basic.api_member_id='second';assert.equal(reload.view(f.store).list,null);await reload.dispose();
});
test('passive mission responses persist per account, reload across startup, ignore malformed data and never mutate the game',async t=>{
  const f=fixture(t),tracker=f.create(),before=JSON.stringify(f.store);
  assert.deepEqual(tracker.view(f.store).records,{});
  tracker.observe({path:LIST,body:{api_list_items:[{api_mission_id:1,api_state:2},{api_mission_id:103,api_state:1}]}},f.store);
  await tracker.dispose();assert.equal(tracker.view(f.store).records[1].state,2);
  const reload=f.create();assert.deepEqual(reload.view(f.store),tracker.view(f.store));
  reload.observe({path:LIST,body:{api_list_items:'invalid'}},f.store);assert.equal(reload.view(f.store).records[1].state,2);
  f.store.info.basic.api_member_id='second';assert.deepEqual(reload.view(f.store).records,{});
  f.store.info.basic.api_member_id='first';assert.equal(reload.view(f.store).records[1].state,2);
  assert.equal(JSON.stringify(f.store),before);
});
test('return results mark success only; a monthly departure from the previous period does not complete the new period',async t=>{
  const f=fixture(t),tracker=f.create();f.setTime('2026-10-15T11:59:00+09:00');
  const until=stamp('2026-10-15T13:00:00+09:00');f.store.info.fleets[1].api_mission=[1,103,until];tracker.view(f.store);
  f.setTime('2026-10-15T13:01:00+09:00');f.store.info.fleets[1].api_mission=[0];
  tracker.observe({path:RESULT,postBody:{api_deck_id:'2'},body:{api_clear_result:2}},f.store);
  assert.equal(tracker.view(f.store).records[103],undefined);
  f.store.info.fleets[1].api_mission=[1,1,stamp('2026-10-15T14:00:00+09:00')];
  tracker.observe({path:'/kcsapi/api_req_mission/start'},f.store);
  f.store.info.fleets[1].api_mission=[0];tracker.observe({path:RESULT,postBody:{api_deck_id:'2'},body:{api_clear_result:0}},f.store);
  assert.equal(tracker.view(f.store).records[1],undefined);
  f.store.info.fleets[1].api_mission=[1,1,stamp('2026-10-15T15:00:00+09:00')];tracker.observe({path:'/kcsapi/api_get_member/deck'},f.store);
  f.store.info.fleets[1].api_mission=[0];tracker.observe({path:RESULT,postBody:{api_deck_id:'2'},body:{api_clear_result:1}},f.store);
  assert.equal(tracker.view(f.store).records[1].state,2);await tracker.dispose();
});
test('future states remain unknown without erasing known records; period rollover refreshes the UI identity',async t=>{
  const f=fixture(t),tracker=f.create();tracker.observe({path:LIST,body:[{api_mission_id:1,api_state:2},{api_mission_id:103,api_state:8}]},f.store);
  const before=tracker.view(f.store);assert.equal(before.records[103],undefined);assert.equal(before.records[1].state,2);
  f.setTime('2026-11-15T12:00:00+09:00');assert.notEqual(tracker.view(f.store),before);
  assert.equal(tracker.view(f.store).period,'2026-11');await tracker.dispose();
});

test('server monthly deadline owns a delayed response and supports seconds or milliseconds',async t=>{
  const f=fixture(t),tracker=f.create(),limit=stamp('2026-10-15T12:00:00+09:00');
  for(const api_limit_time of [limit,limit/1000]){
    tracker.observe({path:LIST,body:{api_limit_time,api_list_items:[{api_mission_id:103,api_state:2}]}},f.store);
    assert.equal(tracker.view(f.store).records[103].period,'2026-09');
    assert.equal(tracker.view(f.store).period,'2026-10');
  }
  await tracker.dispose();
});
