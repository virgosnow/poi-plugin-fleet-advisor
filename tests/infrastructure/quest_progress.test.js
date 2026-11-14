'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const {QuestProgress,cycle}=require('../../src/infrastructure/persistence/quest_progress');
const {QuestProgressObserver}=require('../../src/infrastructure/quests/quest_progress_observer');
const {listOverviewQuests}=require('../../src/domain/quests/quest_overview');
const catalog=[...require('../../data/quests/requirements.json').quests,...require('../../data/quests/limited/2026-halloween.json').quests];
function fixture(t,codes=['B2','Bd7','Dw2','D1']){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paa-quest-progress-'));
  t.after(()=>{assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
  const tasks=codes.map(code=>{const q=catalog.find(item=>item.code===code);return {api_no:q.ids[0],api_title:q.title,api_state:2};});
  const store={info:{basic:{api_member_id:1},fleets:[{api_ship:[1,-1,-1,-1,-1,-1]},{api_ship:[1,-1,-1,-1,-1,-1]}],ships:{1:{api_ship_id:1,api_lv:80,api_slot:[]}}},const:{$ships:{1:{api_id:1,api_name:'测试舰',api_stype:2}}},questState:{known:true,tasks}};
  const now=()=>Date.parse('2026-11-01T00:00:00Z'),progress=new QuestProgress(dir,{now});
  const task=code=>listOverviewQuests({state:store,now:now()}).tasks.find(row=>row.code===code);
  return {dir,store,now,progress,task};
}
test('observed progress persists by account and goal and clears on claim',async t=>{
  const f=fixture(t),task=f.task('Bd7'),goal=task.goals[0];
  await Promise.all([1,2,3].map(()=>f.progress.increment(f.store,task,goal)));assert.equal(f.progress.get(f.store,task,goal),3);
  const reopened=new QuestProgress(f.dir,{now:f.now});assert.equal(reopened.get(f.store,task,goal),3);
  const other={...f.store,info:{...f.store.info,basic:{api_member_id:2}}};assert.equal(reopened.get(other,task,goal),0);
  await reopened.clearTask(f.store,task.id);assert.equal(reopened.get(f.store,task,goal),0);
  assert(!fs.readFileSync(reopened.file,'utf8').includes('测试舰'));
});
test('practice results credit only the active matching fleet and rank, once per observed battle and day',async t=>{
  const f=fixture(t,['P348']),live=f.store.questState.tasks[0];live.api_category=3;
  f.store.info.fleets[0].api_ship=[1,2,3,4,5,-1];
  for(const [id,type] of [[1,3],[2,3],[3,4],[4,2],[5,2]]){
    f.store.info.ships[id]={api_id:id,api_ship_id:id,api_lv:80,api_slot:[]};
    f.store.const.$ships[id]={api_id:id,api_name:'ship'+id,api_stype:type};
  }
  let now=f.now(),notices=0;const clock=()=>now,progress=new QuestProgress(f.dir,{now:clock});
  const observer=new QuestProgressObserver({progress,now:clock,onChange:()=>notices++});
  const task=()=>listOverviewQuests({state:f.store,now}).tasks.find(row=>row.code==='P348');
  const initial=task(),count=()=>progress.get(f.store,task()||initial,(task()||initial).goals[0]);
  const battle=(rank,deck=1)=>{
    observer.observe({path:'/kcsapi/api_req_practice/battle',postBody:{api_deck_id:deck},body:{}},f.store);
    observer.observe({path:'/kcsapi/api_req_practice/battle_result',body:{api_win_rank:rank}},f.store);
  };
  battle('B');await progress.pending;assert.equal(count(),0);
  battle('A');await progress.pending;await Promise.resolve();assert.equal(count(),1);assert.equal(notices,1);
  const practice=require('../../src/domain/quests/practice_quests').listPracticeQuests({state:f.store,questState:f.store.questState,now}).tasks[0];
  assert.equal(practice.goals[0].key,task().goals[0].key,'practice and overview panels share the same objective');
  assert.equal(progress.getMany(f.store,[practice]).get(`${practice.id}:${practice.goals[0].key}`),1);
  observer.observe({path:'/kcsapi/api_req_practice/battle_result',body:{api_win_rank:'S'}},f.store);
  await progress.pending;assert.equal(count(),1,'duplicate result has no matching start');
  live.api_state=1;battle('S');await progress.pending;assert.equal(count(),1,'inactive task receives no credit');
  live.api_state=2;f.store.info.fleets[0].api_ship=[1,2,3,4,-1,-1];battle('S');await progress.pending;assert.equal(count(),1,'unsuitable fleet receives no credit');
  f.store.info.fleets[0].api_ship=[1,2,3,4,5,-1];battle('SS');await progress.pending;assert.equal(count(),2);
  const reopened=new QuestProgress(f.dir,{now:clock});assert.equal(reopened.get(f.store,task(),task().goals[0]),2);
  now+=86400000;assert.equal(count(),0,'same-day requirement resets independently of yearly task');
  battle('A');await progress.pending;assert.equal(count(),1);
  observer.observe({path:'/kcsapi/api_req_practice/battle',postBody:{api_deck_id:1},body:{}},f.store);
  now+=86400000;
  observer.observe({path:'/kcsapi/api_req_practice/battle_result',body:{api_win_rank:'S'}},f.store);
  await progress.pending;assert.equal(count(),0,'a battle from the preceding task day is not credited');
  observer.observe({path:'/kcsapi/api_req_practice/battle',postBody:{},body:{}},f.store);
  observer.observe({path:'/kcsapi/api_req_practice/battle_result',body:{api_win_rank:'S'}},f.store);
  await progress.pending;assert.equal(count(),0,'missing deck identity is not guessed');
});
test('D39 game 50 percent gives a single exact lower bound without fabricating observed events',async t=>{
  const f=fixture(t,['D39','Dw2']);
  const live=f.store.questState.tasks.find(row=>row.api_no===443);live.api_progress_flag=1;
  let task=f.task('D39'),goal=task.goals[0],other=f.task('Dw2');
  const read=()=>f.progress.getMany(f.store,[task,other]).get(`${task.id}:${goal.key}`);
  assert.equal(f.progress.get(f.store,task,goal),1);assert.equal(read(),1);
  assert.deepEqual(f.progress.records,{},'game progress is never fabricated as an observed return');
  assert.equal(f.progress.get(f.store,other,other.goals[0]),0);
  const noAccount={...f.store,info:{...f.store.info,basic:{}}};
  assert.equal(f.progress.get(noAccount,task,goal),0);
  assert.equal(f.progress.getMany(noAccount,[task]).get(`${task.id}:${goal.key}`),0);
  const otherAccount={...f.store,info:{...f.store.info,basic:{api_member_id:2}},questState:{known:true,tasks:[]}};
  assert.equal(f.progress.get(otherAccount,task,goal),0);
  assert.equal(f.progress.getMany(otherAccount,[task]).get(`${task.id}:${goal.key}`),0);
  assert.equal(f.progress.get(f.store,task,{...goal,key:'different'}),0);
  assert.equal(f.progress.get(f.store,{...task,goals:[]},goal),0);
  assert.equal(f.progress.get(f.store,{...task,id:444},goal),0);
  assert.equal(f.progress.get(f.store,{...task,state:3},goal),0);
  for(const flag of [0,2,null])assert.equal(f.progress.get(f.store,{...task,progressFlag:flag},goal),0);
  await f.progress.increment(f.store,task,goal);
  assert.equal(f.progress.get(f.store,task,goal),1,'the same observed return and server flag cannot double count');
  await f.progress.increment(f.store,task,goal);
  assert.equal(f.progress.get(f.store,task,goal),2);assert.equal(read(),2);
  await f.progress.clearTask(f.store,task.id);
  assert.equal(f.progress.get(f.store,task,goal),1,'a current 50% game flag still proves one after local clearing');
  live.api_progress_flag=0;task=f.task('D39');goal=task.goals[0];
  assert.equal(f.progress.get(f.store,task,goal),0);
  live.api_state=3;assert.equal(f.task('D39').state,3,'completed tasks stay visible before claiming');
});

test('expedition return counts tasks active on return even if the plugin starts or the task is accepted mid-voyage',async t=>{
  const f=fixture(t,['D39']),observer=new QuestProgressObserver({progress:f.progress,now:f.now});
  const live=f.store.questState.tasks[0],task=f.task('D39');
  f.store.info.fleets[1].api_mission=[1,30,f.now()+10000];
  observer.remember(f.store);
  live.api_state=1;
  observer.observe({path:'/kcsapi/api_get_member/questlist',body:{api_list:[live]}},f.store);
  live.api_state=2;
  observer.observe({path:'/kcsapi/api_req_mission/result',postBody:{api_deck_id:2},body:{api_clear_result:1}},f.store);
  observer.observe({path:'/kcsapi/api_req_mission/result',postBody:{api_deck_id:2},body:{api_clear_result:1}},f.store);
  await f.progress.pending;
  assert.equal(f.progress.get(f.store,task,task.goals[0]),1,'a duplicated result must not be recorded twice');
});

test('a task accepted after departure is counted on return, while one cancelled before return is not',async t=>{
  const f=fixture(t,['D39']),observer=new QuestProgressObserver({progress:f.progress,now:f.now});
  const live=f.store.questState.tasks[0],task=f.task('D39');live.api_state=1;
  observer.observe({path:'/kcsapi/api_req_mission/start',postBody:{api_deck_id:2,api_mission_id:30},body:{}},f.store);
  live.api_state=2;
  observer.observe({path:'/kcsapi/api_req_mission/result',postBody:{api_deck_id:2},body:{api_clear_result:1}},f.store);
  await f.progress.pending;assert.equal(f.progress.get(f.store,task,task.goals[0]),1);
  observer.observe({path:'/kcsapi/api_req_mission/start',postBody:{api_deck_id:2,api_mission_id:30},body:{}},f.store);
  live.api_state=1;
  observer.observe({path:'/kcsapi/api_req_mission/result',postBody:{api_deck_id:2},body:{api_clear_result:1}},f.store);
  await f.progress.pending;assert.equal(f.progress.get(f.store,task,task.goals[0]),1);
});

test('same-account new session discards old voyage while a newly observed voyage can be recovered',async t=>{
  const f=fixture(t,['D39']),observer=new QuestProgressObserver({progress:f.progress,now:f.now});
  const task=f.task('D39');f.store.info.fleets[1].api_mission=[1,30,f.now()+10000];observer.remember(f.store);
  observer.resetSession();f.store.info.fleets[1].api_mission=[0,0,0];
  observer.observe({path:'/kcsapi/api_req_mission/result',postBody:{api_deck_id:2},body:{api_clear_result:1}},f.store);
  await f.progress.pending;assert.equal(f.progress.get(f.store,task,task.goals[0]),0);
  f.store.info.fleets[1].api_mission=[1,30,f.now()+20000];
  observer.observe({path:'/kcsapi/api_port/port',body:{}},f.store);
  observer.observe({path:'/kcsapi/api_req_mission/result',postBody:{api_deck_id:2},body:{api_clear_result:2}},f.store);
  await f.progress.pending;assert.equal(f.progress.get(f.store,task,task.goals[0]),1);
});

test('a recently cleared fleet can still be paired to its result, but expired voyages cannot',async t=>{
  const f=fixture(t,['D39']);let now=f.now();const clock=()=>now;
  const progress=new QuestProgress(f.dir,{now:clock}),observer=new QuestProgressObserver({progress,now:clock});
  const task=f.task('D39');f.store.info.fleets[1].api_mission=[1,30,now+10000];observer.remember(f.store);
  f.store.info.fleets[1].api_mission=[0,0,0];observer.remember(f.store);now+=2000;
  observer.observe({path:'/kcsapi/api_req_mission/result',postBody:{api_deck_id:2},body:{api_clear_result:1}},f.store);
  await progress.pending;assert.equal(progress.get(f.store,task,task.goals[0]),1);
  await progress.clearTask(f.store,task.id);
  f.store.info.fleets[1].api_mission=[1,30,now+20000];observer.remember(f.store);
  f.store.info.fleets[1].api_mission=[0,0,0];observer.remember(f.store);now+=5001;
  observer.observe({path:'/kcsapi/api_req_mission/result',postBody:{api_deck_id:2},body:{api_clear_result:1}},f.store);
  await progress.pending;assert.equal(progress.get(f.store,task,task.goals[0]),0);
});

test('hot reload preserves consumed voyage identity and rejects a different voyage of the same mission',async t=>{
  const f=fixture(t,['D39']),task=f.task('D39');f.store.info.fleets[1].api_mission=[1,30,f.now()+10000];
  const original=new QuestProgressObserver({progress:f.progress,now:f.now});original.remember(f.store);
  original.observe({path:'/kcsapi/api_req_mission/result',postBody:{api_deck_id:2},body:{api_clear_result:1}},f.store);
  await f.progress.pending;assert.equal(f.progress.get(f.store,task,task.goals[0]),1);
  const snapshot=original.snapshot(f.store),reloaded=new QuestProgressObserver({progress:f.progress,now:f.now});
  assert(reloaded.restore(snapshot,f.store));reloaded.remember(f.store);
  reloaded.observe({path:'/kcsapi/api_req_mission/result',postBody:{api_deck_id:2},body:{api_clear_result:1}},f.store);
  await f.progress.pending;assert.equal(f.progress.get(f.store,task,task.goals[0]),1);
  const previous=new QuestProgressObserver({progress:f.progress,now:f.now});previous.remember(f.store);
  const pending=previous.snapshot(f.store);f.store.info.fleets[1].api_mission=[1,30,f.now()+20000];
  const next=new QuestProgressObserver({progress:f.progress,now:f.now});next.restore(pending,f.store);
  assert.equal(next.departures.size,0,'different completion time is a different voyage');
});

test('a newly observed voyage of the same mission does not inherit earlier departure task context',async t=>{
  const f=fixture(t,['Dw2']);let now=Date.parse('2026-11-01T19:59:00Z');
  const clock=()=>now,progress=new QuestProgress(f.dir,{now:clock}),observer=new QuestProgressObserver({progress,now:clock});
  f.store.info.fleets[1].api_mission=[1,38,now+60000];
  observer.observe({path:'/kcsapi/api_req_mission/start',postBody:{api_deck_id:2,api_mission_id:38},body:{}},f.store);
  assert(observer.departures.get(2).prepared.length);
  // No second start is observed. A different return timestamp is a different
  // voyage, even though it uses the same fleet and mission number.
  now=Date.parse('2026-11-01T20:01:00Z');f.store.info.fleets[1].api_mission=[1,38,now+60000];
  observer.observe({path:'/kcsapi/api_get_member/questlist',body:{api_list:f.store.questState.tasks}},f.store);
  assert.equal(observer.departures.get(2).prepared,undefined);
  observer.observe({path:'/kcsapi/api_req_mission/result',postBody:{api_deck_id:2},body:{api_clear_result:1}},f.store);
  await progress.pending;const task=listOverviewQuests({state:f.store,now}).tasks[0];
  assert.equal(progress.get(f.store,task,task.goals[0]),1);
});
test('bulk progress reads match individual reads across accounts and cycle changes',async t=>{
  const f=fixture(t,['Bd7','B2']),first=f.task('Bd7'),second=f.task('B2');
  await f.progress.increment(f.store,first,first.goals[0]);await f.progress.increment(f.store,second,second.goals[0]);
  const rows=[first,second],bulk=f.progress.getMany(f.store,rows);
  for(const task of rows)for(const goal of task.goals)assert.equal(bulk.get(`${task.id}:${goal.key}`),f.progress.get(f.store,task,goal));
  const other={...f.store,info:{...f.store.info,basic:{api_member_id:2}}};
  assert([...f.progress.getMany(other,rows).values()].every(value=>value===0));
  f.progress.now=()=>f.now()+86400000;
  assert.equal(f.progress.getMany(f.store,rows).get(`${first.id}:${first.goals[0].key}`),0);
  assert.equal(f.progress.getMany(f.store,rows).get(`${second.id}:${second.goals[0].key}`),1);
});
test('concurrent observations are serialized and a failed save retains committed progress',async t=>{
  const f=fixture(t,['Bd7']),task=f.task('Bd7'),goal=task.goals[0];
  await Promise.all([f.progress.increment(f.store,task,goal),f.progress.increment(f.store,task,goal),f.progress.increment(f.store,task,goal)]);
  assert.equal(f.progress.get(f.store,task,goal),3);const before=fs.readFileSync(f.progress.file,'utf8');
  f.progress.getCacheLimit=()=>0;
  await assert.rejects(f.progress.increment(f.store,task,goal),/空间不足/);
  assert.equal(f.progress.get(f.store,task,goal),3);assert.equal(fs.readFileSync(f.progress.file,'utf8'),before);
  assert.match((await f.progress.inspectCache()).writeError,/空间不足/);
});
test('one battle that matches several quests saves and notifies once',async t=>{
  const f=fixture(t,['Bd7','B82']);let writes=0,notices=0;
  const persist=f.progress.persist.bind(f.progress);f.progress.persist=async records=>{writes++;return persist(records);};
  const observer=new QuestProgressObserver({progress:f.progress,now:f.now,onChange:()=>{notices++;}});
  observer.observe({path:'/kcsapi/api_req_map/start',postBody:{api_deck_id:1,api_maparea_id:2,api_mapinfo_no:1},body:{api_no:2,api_bosscell_no:2}},f.store);
  observer.observe({path:'/kcsapi/api_req_sortie/battleresult',body:{api_win_rank:'S'}},f.store);
  await f.progress.pending;await Promise.resolve();
  const daily=f.task('Bd7'),single=f.task('B82');
  assert.equal(f.progress.get(f.store,daily,daily.goals[0]),1);assert.equal(f.progress.get(f.store,single,single.goals[0]),1);
  assert.equal(writes,1);assert.equal(notices,1);
  const changes=await f.progress.incrementMany(f.store,[{task:single,goal:single.goals[0]}]);
  assert.equal(changes,false);assert.equal(writes,1,'already-complete progress does not cause another write');
});
test('game progress regression and completion invalidate observations without guessing missing objectives',async t=>{
  const f=fixture(t,['Bd7']),task={...f.task('Bd7'),progressFlag:1},goal=task.goals[0];
  await f.progress.increment(f.store,task,goal);assert.equal(f.progress.get(f.store,task,goal),1);
  await f.progress.reconcile(f.store,[{api_no:task.id,api_state:2,api_progress_flag:2}]);
  assert.equal(f.progress.get(f.store,task,goal),1,'overall progress cannot determine individual goal counts');
  await f.progress.reconcile(f.store,[{api_no:task.id,api_state:2,api_progress_flag:0}]);
  assert.equal(f.progress.get(f.store,task,goal),0);
  await f.progress.increment(f.store,task,goal);
  await f.progress.reconcile(f.store,[{api_no:task.id,api_state:3,api_progress_flag:0}]);
  assert.equal(f.progress.get(f.store,task,goal),1);
});
test('an older departure cannot overwrite a newer game progress flag',async t=>{
  const f=fixture(t,['Bd7']),task={...f.task('Bd7'),progressFlag:0},goal=task.goals[0];
  await f.progress.increment(f.store,task,goal);
  await f.progress.reconcile(f.store,[{api_no:task.id,api_state:2,api_progress_flag:2}]);
  await f.progress.increment(f.store,task,goal);
  await f.progress.reconcile(f.store,[{api_no:task.id,api_state:2,api_progress_flag:0}]);
  assert.equal(f.progress.get(f.store,task,goal),0);
});
test('a return after a recurring reset does not credit the preceding task cycle',async t=>{
  const f=fixture(t,['Dw2']);let clock=Date.parse('2026-11-01T19:59:00Z');
  const progress=new QuestProgress(f.dir,{now:()=>clock}),observer=new QuestProgressObserver({progress,now:()=>clock});
  observer.observe({path:'/kcsapi/api_req_mission/start',postBody:{api_deck_id:2,api_mission_id:38},body:{}},f.store);
  clock=Date.parse('2026-11-01T20:01:00Z');
  observer.observe({path:'/kcsapi/api_req_mission/result',postBody:{api_deck_id:2},body:{api_clear_result:1}},f.store);
  await progress.pending;const task=listOverviewQuests({state:f.store,now:clock}).tasks[0];
  assert.equal(progress.get(f.store,task,task.goals[0]),0);
});
test('a naturally observed quest list reconciles stored progress',async t=>{
  const f=fixture(t,['Bd7']),task={...f.task('Bd7'),progressFlag:2},goal=task.goals[0];
  await f.progress.increment(f.store,task,goal);
  const observer=new QuestProgressObserver({progress:f.progress,now:f.now});
  observer.observe({path:'/kcsapi/api_get_member/questlist',body:{api_list:[{api_no:task.id,api_state:2,api_progress_flag:0}]}},f.store);
  await f.progress.pending;assert.equal(f.progress.get(f.store,task,goal),0);
});
test('old manual records are preserved but not trusted as observations',async t=>{
  const f=fixture(t,['B2']),old=path.join(f.dir,'quest-progress.json');
  fs.writeFileSync(old,JSON.stringify({version:1,records:{}}));
  const reopened=new QuestProgress(f.dir,{now:f.now});assert.equal(reopened.get(f.store,f.task('B2'),f.task('B2').goals[0]),0);
  assert(fs.existsSync(old));assert.equal((await reopened.inspectCache()).files,1);
  await reopened.clearCache();assert(!fs.existsSync(old));
});
test('recurring records use Japanese task-day and reset periods',()=>{
  const time=Date.parse;
  assert.notEqual(cycle('日常',time('2026-10-31T19:59:59Z')),cycle('日常',time('2026-10-31T20:00:00Z')));
  assert.notEqual(cycle('周常',time('2026-11-01T19:59:59Z')),cycle('周常',time('2026-11-01T20:00:00Z')));
  assert.notEqual(cycle('月常',time('2026-10-31T19:59:59Z')),cycle('月常',time('2026-10-31T20:00:00Z')));
  assert.notEqual(cycle('季常',time('2026-11-30T19:59:59Z')),cycle('季常',time('2026-11-30T20:00:00Z')));
  assert.equal(cycle('年常',time('2026-12-31T20:00:00Z')),cycle('年常',time('2026-12-31T19:59:59Z')));
});
test('only observed matching boss victories and expedition results increment, once per event',async t=>{
  const f=fixture(t),observer=new QuestProgressObserver({progress:f.progress,now:f.now});
  const event=(path,postBody,body)=>observer.observe({path:'/kcsapi/'+path,postBody,body},f.store);
  const b=f.task('B2'),daily=f.task('Bd7'),mission=f.task('Dw2'),depart=f.task('D1');
  event('api_req_map/start',{api_deck_id:1,api_maparea_id:1,api_mapinfo_no:1},{api_no:2,api_bosscell_no:2});
  event('api_req_sortie/battleresult',{}, {api_win_rank:'A'});
  event('api_req_sortie/battleresult',{}, {api_win_rank:'A'});
  await f.progress.pending;assert.equal(f.progress.get(f.store,b,b.goals[0]),1);
  event('api_req_map/start',{api_deck_id:1,api_maparea_id:2,api_mapinfo_no:1},{api_no:1,api_bosscell_no:2});
  event('api_req_sortie/battleresult',{}, {api_win_rank:'S'});
  event('api_req_map/next',{}, {api_no:2});event('api_req_sortie/battleresult',{}, {api_win_rank:'S'});
  await f.progress.pending;assert.equal(f.progress.get(f.store,daily,daily.goals[0]),1);
  event('api_req_mission/start',{api_deck_id:2,api_mission_id:38},{});
  event('api_req_mission/result',{api_deck_id:2},{api_clear_result:1});
  event('api_req_mission/result',{api_deck_id:2},{api_clear_result:1});
  await f.progress.pending;assert.equal(f.progress.get(f.store,mission,mission.goals[0]),1);assert.equal(f.progress.get(f.store,depart,depart.goals[0]),1);
  event('api_req_quest/clearitemget',{api_quest_id:b.id},{});await f.progress.pending;assert.equal(f.progress.get(f.store,b,b.goals[0]),0);
});
test('battle objectives count observed victories and defeats once, respecting map and boss requirements',async t=>{
  const f=fixture(t,['B1','B4','Bd1','Bd2','Bd3']),observer=new QuestProgressObserver({progress:f.progress,now:f.now});
  const event=(path,postBody,body)=>observer.observe({path:'/kcsapi/'+path,postBody,body},f.store);
  const tasks=Object.fromEntries(['B1','B4','Bd1','Bd2','Bd3'].map(code=>[code,f.task(code)]));
  const count=code=>{const task=tasks[code];return f.progress.get(f.store,task,task.goals[0]);};
  const start=(map,node,boss)=>event('api_req_map/start',{api_deck_id:1,api_maparea_id:1,api_mapinfo_no:map},{api_no:node,api_bosscell_no:boss});
  const result=rank=>event('api_req_sortie/battleresult',{}, {api_win_rank:rank});
  start(1,1,3);result('C');result('C');await f.progress.pending;
  assert.equal(count('B1'),1);assert.equal(count('Bd2'),1);assert.equal(count('Bd3'),1);
  assert.equal(count('Bd1'),0,'defeat does not satisfy the victory objective');assert.equal(count('B4'),0,'wrong map and non-boss cannot satisfy B4');
  event('api_req_map/next',{}, {api_no:2});result('D');await f.progress.pending;
  assert.equal(count('Bd3'),2,'a new battle node counts once');assert.equal(count('Bd2'),1,'completed goals stay capped');
  start(2,1,3);result('S');await f.progress.pending;
  assert.equal(count('Bd3'),3);assert.equal(count('Bd1'),1);assert.equal(count('B4'),0,'correct map still requires its boss');
  event('api_req_map/next',{}, {api_no:3,api_event_id:5});result('E');result('E');await f.progress.pending;
  assert.equal(count('Bd3'),4);assert.equal(count('B4'),1,'boss battle counts even on defeat');
  const bd3=f.store.questState.tasks.find(row=>row.api_no===210);bd3.api_state=1;
  start(1,1,3);result('S');await f.progress.pending;assert.equal(count('Bd3'),4,'unaccepted tasks never gain progress');
  bd3.api_state=2;start(1,1,3);bd3.api_state=1;result('S');await f.progress.pending;
  assert.equal(count('Bd3'),4,'tasks cancelled during the sortie are rechecked');
});
test('battle objectives require a recognised result and a known battle node',async t=>{
  const f=fixture(t,['Bd3']),observer=new QuestProgressObserver({progress:f.progress,now:f.now}),task=f.task('Bd3');
  const start=body=>observer.observe({path:'/kcsapi/api_req_map/start',postBody:{api_deck_id:1,api_maparea_id:1,api_mapinfo_no:1},body},f.store);
  const result=rank=>observer.observe({path:'/kcsapi/api_req_sortie/battleresult',body:{api_win_rank:rank}},f.store);
  start({api_no:1});result('unknown');start({});result('S');await f.progress.pending;
  assert.equal(f.progress.get(f.store,task,task.goals[0]),0);
});
test('daily battle counts stop at their goal and reset at the Japanese daily boundary',async t=>{
  const f=fixture(t,['Bd3']);let now=Date.parse('2026-11-01T19:59:00Z');
  const clock=()=>now,progress=new QuestProgress(f.dir,{now:clock}),observer=new QuestProgressObserver({progress,now:clock});
  const task=f.task('Bd3'),goal=task.goals[0];
  const battle=()=>{
    observer.observe({path:'/kcsapi/api_req_map/start',postBody:{api_deck_id:1,api_maparea_id:1,api_mapinfo_no:1},body:{api_no:1}},f.store);
    observer.observe({path:'/kcsapi/api_req_sortie/battleresult',body:{api_win_rank:'S'}},f.store);
  };
  for(let i=0;i<11;i++)battle();await progress.pending;assert.equal(progress.get(f.store,task,goal),10);
  now=Date.parse('2026-11-01T20:00:00Z');assert.equal(progress.get(f.store,task,goal),0);
  battle();await progress.pending;assert.equal(progress.get(f.store,task,goal),1);
});
test('recovered battle during hot reload credits battle objectives only once',async t=>{
  const f=fixture(t,['Bd3']);let now=f.now();f.store.sortie={sortieMapId:'11',sortieStatus:[true,false],currentNode:1,bossSpot:2,combinedFlag:0};
  const previous=new QuestProgressObserver({progress:f.progress,now:()=>now});
  previous.observe({path:'/kcsapi/api_req_map/start',postBody:{api_deck_id:1,api_maparea_id:1,api_mapinfo_no:1},body:{api_no:1,api_bosscell_no:2}},f.store);
  const snapshot=previous.snapshot(f.store);now+=1000;
  const resumed={...f.store,battle:{result:{valid:true,combined:false,map:11,mapCell:1,time:now-100,rank:'D',boss:false}}};
  const observer=new QuestProgressObserver({progress:f.progress,now:()=>now});assert(observer.restore(snapshot,resumed));await f.progress.pending;
  const task=f.task('Bd3');assert.equal(f.progress.get(f.store,task,task.goals[0]),1);
  observer.observe({path:'/kcsapi/api_req_sortie/battleresult',body:{api_win_rank:'D'}},resumed);await f.progress.pending;
  assert.equal(f.progress.get(f.store,task,task.goals[0]),1);
});
test('weekly sortie goals count departures, S victories, boss arrival and boss victories independently',async t=>{
  const f=fixture(t,['Bw1']),observer=new QuestProgressObserver({progress:f.progress,now:f.now}),task=f.task('Bw1');
  const count=kind=>f.progress.get(f.store,task,task.goals.find(goal=>goal.kind===kind));
  const send=(path,body,postBody={})=>observer.observe({path:'/kcsapi/'+path,body,postBody},f.store);
  send('api_req_map/start',{api_no:1,api_bosscell_no:3},{api_deck_id:1,api_maparea_id:1,api_mapinfo_no:1});
  send('api_req_sortie/battleresult',{api_win_rank:'S'});
  send('api_req_map/next',{api_no:3,api_bosscell_no:3,api_event_id:5});
  send('api_req_map/next',{api_no:3,api_bosscell_no:3,api_event_id:5});
  await f.progress.pending;assert.equal(count('bossReach'),1,'arrival counts before combat and duplicate navigation does not count twice');
  send('api_req_sortie/battleresult',{api_win_rank:'A'});send('api_req_sortie/battleresult',{api_win_rank:'A'});
  await f.progress.pending;
  assert.equal(count('departSortie'),1);assert.equal(count('battleWin'),1);assert.equal(count('bossReach'),1);assert.equal(count('bossWin'),1);
});
test('1-6 port arrival credits the matching goal only once without assuming numeric cell letters',async t=>{
  const f=fixture(t,['B98']);f.store.info.fleets[0].api_ship=[1,2,3];
  for(const id of [2,3]){f.store.info.ships[id]={api_ship_id:id,api_lv:80,api_slot:[]};f.store.const.$ships[id]={api_id:id,api_name:'fixture'+id,api_stype:2};}
  const observer=new QuestProgressObserver({progress:f.progress,now:f.now}),task=f.task('B98'),goal=task.goals.find(g=>g.kind==='reachGoal');
  const send=(path,body,postBody={})=>observer.observe({path:'/kcsapi/'+path,body,postBody},f.store);
  send('api_req_map/start',{api_no:1},{api_deck_id:1,api_maparea_id:1,api_mapinfo_no:6});
  send('api_req_map/next',{api_no:14,api_color_no:2});await f.progress.pending;assert.equal(f.progress.get(f.store,task,goal),0);
  send('api_req_map/next',{api_no:15,api_color_no:8});send('api_req_map/next',{api_no:15,api_color_no:8});await f.progress.pending;
  assert.equal(f.progress.get(f.store,task,goal),1);
});
test('multi-stage boss results use the observed sortie phase and never assume an unknown phase',async t=>{
  const f=fixture(t,['Bq8']);const task=f.task('Bq8'),first=task.goals.find(g=>g.map==='7-2'&&g.phase===1),second=task.goals.find(g=>g.map==='7-2'&&g.phase===2);
  const observer=new QuestProgressObserver({progress:f.progress,now:f.now});
  const run=phase=>{f.store.info.maps=phase?{72:{api_gauge_num:phase}}:{};
    observer.observe({path:'/kcsapi/api_req_map/start',postBody:{api_deck_id:1,api_maparea_id:7,api_mapinfo_no:2},body:{api_no:8,api_bosscell_no:8,api_event_id:5}},f.store);
    observer.observe({path:'/kcsapi/api_req_sortie/battleresult',body:{api_win_rank:'S'}},f.store);};
  run(1);await f.progress.pending;assert.equal(f.progress.get(f.store,task,first),1);assert.equal(f.progress.get(f.store,task,second),0);
  run(2);await f.progress.pending;assert.equal(f.progress.get(f.store,task,first),1);assert.equal(f.progress.get(f.store,task,second),1);
  run(null);run(3);await f.progress.pending;assert.equal(f.progress.get(f.store,task,first),1);assert.equal(f.progress.get(f.store,task,second),1);
  f.store.info.maps={72:{api_gauge_num:2}};
  observer.observe({path:'/kcsapi/api_req_map/start',postBody:{api_deck_id:1,api_maparea_id:7,api_mapinfo_no:2},body:{api_no:8,api_bosscell_no:9,api_event_id:5}},f.store);
  observer.observe({path:'/kcsapi/api_req_sortie/battleresult',body:{api_win_rank:'S'}},f.store);await f.progress.pending;
  assert.equal(f.progress.get(f.store,task,second),1,'a different boss cannot be credited to the selected phase');
});
test('7-4 port arrival credits the O-node goal independently of the numeric API segment',async t=>{
  const f=fixture(t,['B175']),observer=new QuestProgressObserver({progress:f.progress,now:f.now}),task=f.task('B175'),goal=task.goals.find(g=>g.kind==='reachNode');
  const send=(path,body,postBody={})=>observer.observe({path:'/kcsapi/'+path,body,postBody},f.store);
  send('api_req_map/start',{api_no:1},{api_deck_id:1,api_maparea_id:7,api_mapinfo_no:4});
  send('api_req_map/next',{api_no:14,api_color_no:2});await f.progress.pending;assert.equal(f.progress.get(f.store,task,goal),0);
  send('api_req_map/next',{api_no:27,api_color_no:8});send('api_req_map/next',{api_no:27,api_color_no:8});await f.progress.pending;
  assert.equal(f.progress.get(f.store,task,goal),1);
});
test('7-4 gauge completion requires the observed final kill and a sunk boss flagship',async t=>{
  const f=fixture(t,['B176']),observer=new QuestProgressObserver({progress:f.progress,now:f.now}),task=f.task('B176'),goal=task.goals[0];
  const run=(gauge,body)=>{f.store.info.maps=gauge?{74:gauge}:{};
    observer.observe({path:'/kcsapi/api_req_map/start',postBody:{api_deck_id:1,api_maparea_id:7,api_mapinfo_no:4},body:{api_no:7,api_bosscell_no:7,api_event_id:5}},f.store);
    observer.observe({path:'/kcsapi/api_req_sortie/battleresult',body:{api_win_rank:'A',...body}},f.store);};
  run({api_gauge_type:1,api_required_defeat_count:5,api_defeat_count:3},{api_destsf:1});
  run({api_gauge_type:1,api_required_defeat_count:5,api_defeat_count:4},{api_destsf:0});
  run(null,{api_destsf:1});await f.progress.pending;assert.equal(f.progress.get(f.store,task,goal),0);
  run({api_gauge_type:1,api_required_defeat_count:5,api_defeat_count:4},{api_destsf:1});await f.progress.pending;
  assert.equal(f.progress.get(f.store,task,goal),1);
});
test('S victories count only verifiable enemy groups and exclude nonqualifying named enemies',async t=>{
  const f=fixture(t,['Bd4','Bd5','Bd8','Bw2','Bw3','Bw5']),observer=new QuestProgressObserver({progress:f.progress,now:f.now});
  const task=code=>f.task(code),count=code=>f.progress.get(f.store,task(code),task(code).goals[0]);
  const send=(path,body,postBody={})=>observer.observe({path:'/kcsapi/'+path,body,postBody},f.store);
  send('api_req_map/start',{api_no:1},{api_deck_id:1,api_maparea_id:2,api_mapinfo_no:2});
  send('api_req_sortie/battle',{api_ship_ke:[1512,1513,1513,1530,1545,999999]});
  send('api_req_sortie/battleresult',{api_win_rank:'S'});send('api_req_sortie/battleresult',{api_win_rank:'S'});await f.progress.pending;
  for(const code of ['Bd4','Bw2','Bd8','Bw5'])assert.equal(count(code),1,code);
  for(const code of ['Bd5','Bw3'])assert.equal(count(code),2,code);
  send('api_req_map/next',{api_no:2});send('api_req_sortie/battle',{api_ship_ke:[1512,1513,1530]});
  send('api_req_sortie/battleresult',{api_win_rank:'A'});await f.progress.pending;
  assert.equal(count('Bd4'),1);assert.equal(count('Bd5'),2);assert.equal(count('Bd8'),1);
  send('api_req_map/next',{api_no:3});send('api_req_sortie/battleresult',{api_win_rank:'S'});await f.progress.pending;
  assert.equal(count('Bd5'),2,'missing enemy identity cannot invent sink counts');
});
test('partial victories record only the provable minimum of matching sunk enemies',async t=>{
  const f=fixture(t,['Bd5']),observer=new QuestProgressObserver({progress:f.progress,now:f.now}),task=f.task('Bd5'),goal=task.goals[0];
  const send=(path,body,postBody={})=>observer.observe({path:'/kcsapi/'+path,body,postBody},f.store);
  const start=node=>send('api_req_map/start',{api_no:node},{api_deck_id:1,api_maparea_id:2,api_mapinfo_no:2});
  // Four sunk out of five, of which two are non-transports, proves at least
  // two transports sunk. The battle packet confirms no enemy escort.
  start(1);send('api_req_sortie/battle',{api_ship_ke:[1513,1513,1513,1512,1530]});
  send('api_req_sortie/battleresult',{api_win_rank:'A',api_ship_id:[1513,1513,1513,1512,1530],api_dests:4});await f.progress.pending;
  assert.equal(f.progress.get(f.store,task,goal),2);
  // A sunk target flagship is known even if the other kill identities are not.
  start(1);send('api_req_sortie/battle',{api_ship_ke:[1513,1512,1530]});
  send('api_req_sortie/battleresult',{api_win_rank:'B',api_ship_id:[1513,1512,1530],api_dests:1,api_destsf:1});await f.progress.pending;
  assert.equal(f.progress.get(f.store,task,goal),3);
});
test('inconsistent or combined enemy observations never infer sink progress',async t=>{
  const f=fixture(t,['Bd5']),observer=new QuestProgressObserver({progress:f.progress,now:f.now}),task=f.task('Bd5'),goal=task.goals[0];
  const send=(path,body,postBody={})=>observer.observe({path:'/kcsapi/'+path,body,postBody},f.store);
  const start=()=>send('api_req_map/start',{api_no:1},{api_deck_id:1,api_maparea_id:2,api_mapinfo_no:2});
  start();send('api_req_sortie/battle',{api_ship_ke:[1513],api_ship_ke_combined:[1513]});send('api_req_sortie/battleresult',{api_win_rank:'S',api_ship_id:[1513]});
  start();send('api_req_sortie/battle',{api_ship_ke:[1513]});send('api_req_sortie/battleresult',{api_win_rank:'S',api_ship_id:[1512]});
  start();send('api_req_sortie/battleresult',{api_win_rank:'S',api_ship_id:[1513],api_dests:0});
  start();send('api_req_sortie/battleresult',{api_win_rank:'unknown',api_ship_id:[1513],api_dests:1});
  await f.progress.pending;assert.equal(f.progress.get(f.store,task,goal),0);
});
test('a staged practice task credits later sorties only after the observed practice stage',async t=>{
  const f=fixture(t,['P317']);f.store.questState.tasks[0].api_category=3;
  f.store.info.fleets[0].api_ship=[1,2,-1,-1,-1,-1];
  for(const id of [1,2]){f.store.info.ships[id]={api_ship_id:id,api_lv:80,api_slot:[]};f.store.const.$ships[id]={api_id:id,api_name:'test'+id,api_stype:2,api_ctype:38};}
  const observer=new QuestProgressObserver({progress:f.progress,now:f.now}),task=f.task('P317'),practice=task.goals.find(g=>g.kind==='practice'),boss=task.goals.find(g=>g.map==='2-2');
  const send=(path,body,postBody={})=>observer.observe({path:'/kcsapi/'+path,body,postBody},f.store);
  const sortie=()=>{send('api_req_map/start',{api_no:3,api_bosscell_no:3},{api_deck_id:1,api_maparea_id:2,api_mapinfo_no:2});send('api_req_sortie/battleresult',{api_win_rank:'A'});};
  const exercise=()=>{send('api_req_practice/battle',{}, {api_deck_id:1});send('api_req_practice/battle_result',{api_win_rank:'S'});};
  sortie();await f.progress.pending;assert.equal(f.progress.get(f.store,task,boss),0,'sorties before the practice stage are not credited');
  for(let i=0;i<3;i++)exercise();await f.progress.pending;assert.equal(f.progress.get(f.store,task,practice),3);
  sortie();await f.progress.pending;assert.equal(f.progress.get(f.store,task,boss),1);
});
test('monthly latched practice objectives survive a day change only when fully achieved',async t=>{
  const f=fixture(t,['P318']);f.store.questState.tasks[0].api_category=3;
  let now=Date.parse('2026-11-02T10:00:00Z');const clock=()=>now,progress=new QuestProgress(f.dir,{now:clock});
  const task=f.task('P318'),goal=task.goals.find(g=>g.kind==='practice');
  await progress.increment(f.store,task,goal);await progress.increment(f.store,task,goal);
  now+=86400000;assert.equal(progress.get(f.store,task,goal),0,'unfinished daily attempts expire');
  for(let i=0;i<3;i++)await progress.increment(f.store,task,goal);
  now+=86400000;assert.equal(progress.get(f.store,task,goal),3);
  assert.equal(progress.getMany(f.store,[task]).get(`${task.id}:${goal.key}`),3);
  await progress.increment(f.store,task,goal);assert.equal(progress.get(f.store,task,goal),3,'later events do not reset a completed latch');
  now=Date.parse('2026-12-01T00:00:00Z');assert.equal(progress.get(f.store,task,goal),0,'the monthly task cycle still resets');
});
test('P318 equipment objective follows currently equipped unlocked instances',t=>{
  const f=fixture(t,['P318']);f.store.questState.tasks[0].api_category=3;
  const task=f.task('P318'),goal=task.goals.find(g=>g.kind==='equippedItems');
  f.store.info.equips={10:{api_slotitem_id:145,api_locked:0},11:{api_slotitem_id:145,api_locked:0},12:{api_slotitem_id:145,api_locked:1},13:{api_slotitem_id:145}};
  f.store.info.ships[1].api_slot=[10,12,13];f.store.info.ships[2]={api_slot:[11]};
  const count=()=>f.progress.get(f.store,task,goal);
  assert.equal(count(),2);assert.equal(f.progress.getMany(f.store,[task]).get(`${task.id}:${goal.key}`),2);
  f.store.info.equips[11].api_locked=1;assert.equal(count(),1,'locking an item immediately removes it');
  f.store.info.ships[1].api_slot=[];assert.equal(count(),0,'inventory alone is not an equipped instance');
  f.store.info.ships[2].api_slot_ex=10;assert.equal(count(),1,'expansion slots are included');
  delete f.store.info.equips;assert.equal(count(),0,'missing inventory is never treated as a match');
  assert.deepEqual(f.progress.records,{},'claim-time conditions are not persisted as historical progress');
});
test('missing evidence, unmet fleet requirements and unavailable tasks never mark progress',async t=>{
  const f=fixture(t,['B131','B2']),observer=new QuestProgressObserver({progress:f.progress,now:f.now});
  const b=f.task('B2'),restricted=f.task('B131');
  observer.observe({path:'/kcsapi/api_req_map/start',postBody:{api_deck_id:1,api_maparea_id:1,api_mapinfo_no:4},body:{api_no:2,api_bosscell_no:2}},f.store);
  observer.observe({path:'/kcsapi/api_req_sortie/battleresult',body:{api_win_rank:'S'}},f.store);
  observer.observe({path:'/kcsapi/api_req_map/start',postBody:{api_deck_id:1,api_maparea_id:1,api_mapinfo_no:1},body:{api_no:2}},f.store);
  observer.observe({path:'/kcsapi/api_req_sortie/battleresult',body:{api_win_rank:'S'}},f.store);
  await f.progress.pending;assert.equal(f.progress.get(f.store,restricted,restricted.goals[0]),0);assert.equal(f.progress.get(f.store,b,b.goals[0]),0);
});
test('unrelated game events skip quest-list derivation and active tasks are rechecked',async t=>{
  const f=fixture(t,['B2']),task=f.task('B2'),definition=catalog.find(row=>row.code==='B2'),observer=new QuestProgressObserver({progress:f.progress,now:f.now});
  const prepared=[{task,definition,period:cycle(task.period,f.now())}],unreadable={...f.store};
  Object.defineProperty(unreadable,'questState',{get(){throw Error('unrelated event should not read task list');}});
  assert.doesNotThrow(()=>observer.record(unreadable,prepared,'expeditionReturn',()=>true));
  const stopped={...f.store,questState:{known:true,tasks:[{...f.store.questState.tasks[0],api_state:1}]}};
  observer.record(stopped,prepared,'bossWin',()=>true);await f.progress.pending;
  assert.equal(f.progress.get(f.store,task,task.goals[0]),0);
});
test('hot reload preserves an in-progress 2-5 sortie and both eligible task goals',async t=>{
  const f=fixture(t,['B168','2610B3']);
  const ships=[[1,663,'矢矧改二',3],[2,701,'Johnston',2],[3,702,'Richard P.Leary',2],[4,703,'Indiana',9]];
  f.store.info.ships={};f.store.const.$ships={};
  for(const [id,masterId,name,type] of ships){f.store.info.ships[id]={api_ship_id:masterId,api_lv:80,api_slot:[]};f.store.const.$ships[masterId]={api_id:masterId,api_name:name,api_stype:type};}
  f.store.info.fleets[0].api_ship=[1,2,3,4,-1,-1];f.store.sortie={sortieMapId:'25',sortieStatus:[true,false,false,false],currentNode:1,bossSpot:15,combinedFlag:0};
  const original=new QuestProgressObserver({progress:f.progress,now:f.now});
  original.observe({path:'/kcsapi/api_req_map/start',postBody:{api_deck_id:1,api_maparea_id:2,api_mapinfo_no:5},body:{api_no:1,api_bosscell_no:15}},f.store);
  assert.deepEqual(original.sortie.prepared.map(row=>row.task.code).sort(),['2610B3','B168']);
  const handoff=original.snapshot(f.store),reloaded=new QuestProgressObserver({progress:f.progress,now:f.now});
  assert(reloaded.restore(handoff,f.store));assert.equal(reloaded.sortie.map,'2-5');
  reloaded.observe({path:'/kcsapi/api_req_map/next',body:{api_no:15,api_bosscell_no:15,api_event_id:5}},f.store);
  reloaded.observe({path:'/kcsapi/api_req_sortie/battleresult',body:{api_win_rank:'S'}},f.store);
  await f.progress.pending;
  for(const code of ['B168','2610B3']){const task=f.task(code),goal=task.goals.find(goal=>goal.label.includes('2-5'));assert.equal(f.progress.get(f.store,task,goal),1,code);}
});
test('hot reload handoff is restricted to the same account, active voyage and recent context',async t=>{
  const f=fixture(t,['B2']);f.store.sortie={sortieMapId:'11',sortieStatus:[true,false,false,false],currentNode:1,bossSpot:2,combinedFlag:0};
  const original=new QuestProgressObserver({progress:f.progress,now:f.now});
  original.observe({path:'/kcsapi/api_req_map/start',postBody:{api_deck_id:1,api_maparea_id:1,api_mapinfo_no:1},body:{api_no:1,api_bosscell_no:2}},f.store);
  const handoff=original.snapshot(f.store),make=now=>new QuestProgressObserver({progress:f.progress,now});
  const other={...f.store,info:{...f.store.info,basic:{api_member_id:2}}};assert.equal(make(f.now).restore(handoff,other),false);
  assert.equal(make(()=>f.now()+30001).restore(handoff,f.store),false);
  const wrongMap={...f.store,sortie:{...f.store.sortie,sortieMapId:'12'}},wrongFleet={...f.store,sortie:{...f.store.sortie,sortieStatus:[false,true,false,false]}};
  const a=make(f.now),b=make(f.now);a.restore(handoff,wrongMap);b.restore(handoff,wrongFleet);assert.equal(a.sortie,null);assert.equal(b.sortie,null);
  const advanced={...f.store,sortie:{...f.store.sortie,currentNode:2}};const c=make(f.now);assert(c.restore(handoff,advanced));assert.equal(c.sortie.node,2);
  c.observe({path:'/kcsapi/api_req_sortie/battleresult',body:{api_win_rank:'S'}},advanced);await f.progress.pending;
  const task=f.task('B2');assert.equal(f.progress.get(f.store,task,task.goals[0]),1);
  const consumed=c.snapshot(advanced),again=make(f.now);again.restore(consumed,advanced);
  again.observe({path:'/kcsapi/api_req_sortie/battleresult',body:{api_win_rank:'S'}},advanced);await f.progress.pending;
  assert.equal(f.progress.get(f.store,task,task.goals[0]),1,'a result already consumed before reload is not recorded twice');
});
test('a matching poi battle result received during reload is recovered once',async t=>{
  const f=fixture(t,['B2']);let now=f.now();f.store.sortie={sortieMapId:'11',sortieStatus:[true,false,false,false],currentNode:2,bossSpot:2,combinedFlag:0};
  const original=new QuestProgressObserver({progress:f.progress,now:()=>now});
  original.observe({path:'/kcsapi/api_req_map/start',postBody:{api_deck_id:1,api_maparea_id:1,api_mapinfo_no:1},body:{api_no:2,api_bosscell_no:2}},f.store);
  const handoff=original.snapshot(f.store);now+=1000;
  const result={valid:true,combined:false,map:11,mapCell:2,time:now-100,rank:'S',boss:true};
  for(const change of [{map:12},{mapCell:1},{time:f.now()-1},{combined:true},{boss:undefined}]){
    const testStore={...f.store,battle:{result:{...result,...change}}},observer=new QuestProgressObserver({progress:f.progress,now:()=>now});
    observer.restore(handoff,testStore);await f.progress.pending;assert.equal(f.progress.get(f.store,f.task('B2'),f.task('B2').goals[0]),0);
  }
  const store={...f.store,battle:{result}},reloaded=new QuestProgressObserver({progress:f.progress,now:()=>now});
  assert(reloaded.restore(handoff,store));await f.progress.pending;const task=f.task('B2');
  assert.equal(f.progress.get(f.store,task,task.goals[0]),1);assert.equal(reloaded.sortie.consumed,true);
  reloaded.observe({path:'/kcsapi/api_req_sortie/battleresult',body:{api_win_rank:'S'}},store);await f.progress.pending;
  assert.equal(f.progress.get(f.store,task,task.goals[0]),1);
});
test('hot reload preserves a matching active expedition departure',async t=>{
  const f=fixture(t,['Dw2']);f.store.info.fleets[1].api_mission=[1,38,f.now()+60000];
  const original=new QuestProgressObserver({progress:f.progress,now:f.now});
  original.observe({path:'/kcsapi/api_req_mission/start',postBody:{api_deck_id:2,api_mission_id:38},body:{}},f.store);
  const reloaded=new QuestProgressObserver({progress:f.progress,now:f.now});assert(reloaded.restore(original.snapshot(f.store),f.store));
  reloaded.observe({path:'/kcsapi/api_req_mission/result',postBody:{api_deck_id:2},body:{api_clear_result:1}},f.store);await f.progress.pending;
  const task=f.task('Dw2');assert.equal(f.progress.get(f.store,task,task.goals[0]),1);
});
test('a directly observed boss event can identify the boss when the boss cell is absent',async t=>{
  const f=fixture(t,['B2']),observer=new QuestProgressObserver({progress:f.progress,now:f.now});
  observer.observe({path:'/kcsapi/api_req_map/start',postBody:{api_deck_id:1,api_maparea_id:1,api_mapinfo_no:1},body:{api_no:1}},f.store);
  observer.observe({path:'/kcsapi/api_req_map/next',body:{api_no:2,api_event_id:5}},f.store);
  observer.observe({path:'/kcsapi/api_req_sortie/battleresult',body:{api_win_rank:'S'}},f.store);await f.progress.pending;
  const task=f.task('B2');assert.equal(f.progress.get(f.store,task,task.goals[0]),1);
});

test('game-data cache accounts for and clears local quest progress',async t=>{
  const f=fixture(t,['B2']),{FleetAdvisorService}=require('../../src/application/fleet_advisor_service');
  let reads=0;const service=new FleetAdvisorService({controller:{dispose(){}},getStore:()=>{reads++;return f.store;},storageDir:f.dir,now:f.now});
  const task=f.task('B2'),goal=task.goals[0];
  await service.questProgress.increment(f.store,task,goal);
  let status=await service.getComputationStatus();
  assert.equal(status.cache.gameData.files,1);
  assert.equal(status.cache.gameData.bytes,fs.statSync(service.questProgress.file).size);
  assert.equal(service.getQuestGoalProgress(task,goal),1);
  const beforeReads=reads;assert.equal(service.getQuestGoalProgressForTasks([task]).get(`${task.id}:${goal.key}`),1);assert.equal(reads-beforeReads,1);
  status=await service.clearRecommendationCache('gameData');
  assert.equal(status.maintenance.failed,0);assert.equal(status.cache.gameData.files,0);
  assert.equal(service.getQuestGoalProgress(task,goal),0);
  await service.dispose();
});
