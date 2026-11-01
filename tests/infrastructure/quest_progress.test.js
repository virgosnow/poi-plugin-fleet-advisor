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
  assert.equal(f.progress.get(f.store,task,goal),0);
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

test('game-data cache accounts for and clears both local progress and existing MCP schemes',async t=>{
  const f=fixture(t,['B2']),{FleetAdvisorService}=require('../../src/application/fleet_advisor_service');
  let reads=0;const service=new FleetAdvisorService({controller:{dispose(){}},getStore:()=>{reads++;return f.store;},storageDir:f.dir,now:f.now});
  const task=f.task('B2'),goal=task.goals[0];
  await service.saveScheme({name:'existing',scheme:{fleet:1,ships:[1]}});
  await service.questProgress.increment(f.store,task,goal);
  let status=await service.getComputationStatus();
  assert.equal(status.cache.schemes.count,1);assert.equal(status.cache.gameData.files,2);
  assert.equal(status.cache.gameData.bytes,fs.statSync(service.schemes.file).size+fs.statSync(service.questProgress.file).size);
  assert.equal(service.getQuestGoalProgress(task,goal),1);
  const beforeReads=reads;assert.equal(service.getQuestGoalProgressForTasks([task]).get(`${task.id}:${goal.key}`),1);assert.equal(reads-beforeReads,1);
  status=await service.clearRecommendationCache('gameData');
  assert.equal(status.maintenance.failed,0);assert.equal(status.cache.gameData.files,0);
  assert.equal(service.querySchemes({}).total,0);assert.equal(service.getQuestGoalProgress(task,goal),0);
  await service.dispose();
});
