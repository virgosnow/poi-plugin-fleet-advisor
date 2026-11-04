'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),zlib=require('zlib');
const {PracticeObserver,cycle}=require('../../src/infrastructure/practice/practice_observer');
const {readLocalHistory}=require('../../src/infrastructure/practice/local_history');
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'paa-practice-'));
const clean=dir=>{if(!path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'paa-practice-'))throw Error('unsafe cleanup');fs.rmSync(dir,{recursive:true,force:true});};
test('a verified empty opponent list is ready and survives a same-session handoff',()=>{
  const dir=temp(),observer=new PracticeObserver(dir),store={info:{basic:{api_member_id:123}}};
  try{assert.equal(observer.view(store).known,false);assert.equal(observer.acceptList({api_list:[]},store),true);
    assert.equal(observer.view(store).known,true);const snapshot=observer.snapshot(store),restored=new PracticeObserver(dir);
    restored.restore(snapshot,store);assert.equal(restored.view(store).known,true);restored.dispose();
  }finally{observer.dispose();clean(dir);}
});
test('practice observes only real response data and isolates accounts, rotations and history',()=>{
 const dir=temp();let now=Date.UTC(2026,0,1,5,0),s={info:{basic:{api_member_id:123}}};
 const observer=new PracticeObserver(dir,{now:()=>now});
 const send=(p,b,postBody)=>observer.observe({path:'/kcsapi/'+p,body:b,postBody},s);
 try{
  assert.equal(observer.view(s).known,false);
  send('api_get_member/practice',{api_list:[{api_enemy_id:1,api_enemy_name:'对手',api_enemy_level:90,api_enemy_flag_ship:2}]});
  assert.equal(observer.view(s).opponents[0].ships,null);
  send('api_req_member/get_practice_enemyinfo',{api_member_id:99,api_deck:{api_ships:[{api_ship_id:3,api_level:20}]}});
  assert.equal(observer.view(s).opponents[0].ships,null);
  send('api_req_member/get_practice_enemyinfo',{api_member_id:1,api_deck:{api_ships:[{api_ship_id:3,api_level:20}]}});
  assert.deepEqual(observer.view(s).opponents[0].ships,[{masterId:3,level:20}]);
  send('api_req_practice/battle',{},'api_enemy_id=1&api_token=must-not-save');
  send('api_req_practice/battle_result',{api_win_rank:'A',api_get_base_exp:150});
  assert.equal(observer.view(s).opponents[0].rank,'A');assert.equal(observer.view(s).history.length,1);
  const contents=fs.readFileSync(path.join(dir,fs.readdirSync(dir)[0]),'utf8');assert(!contents.includes('must-not-save'));
  const snap=observer.snapshot(s),same=new PracticeObserver(dir,{now:()=>now});same.restore(snap,s);assert.equal(same.view(s).opponents[0].rank,'A');same.dispose();
  observer.resetSession();assert.equal(observer.view(s).known,true);assert.equal(observer.view(s).history.length,1);
  s={info:{basic:{api_member_id:456}}};assert.equal(observer.view(s).known,false);assert.equal(observer.view(s).history.length,0);
  s={info:{basic:{api_member_id:123}}};assert.equal(observer.view(s).history.length,1);
  now+=12*3600000;assert.equal(observer.view(s).known,false);assert.notEqual(cycle(now),snap.period);
 }finally{observer.dispose();clean(dir);}
});
test('cached opponents and fleets persist only for the same account and rotation',()=>{
 const dir=temp();let now=Date.UTC(2026,0,1,5,59),store={info:{basic:{api_member_id:123}}};
 const first=new PracticeObserver(dir,{now:()=>now});
 try{
  first.acceptList({api_list:[{api_enemy_id:7,api_enemy_name:'甲',api_state:0}]},store);
  first.acceptEnemy({api_member_id:7,api_deck:{api_ships:[{api_ship_id:3,api_level:20}]}},store);
  const next=new PracticeObserver(dir,{now:()=>now});
  try{
   assert.deepEqual(next.view(store).opponents[0].ships,[{masterId:3,level:20}]);
   assert.equal(next.view({info:{basic:{api_member_id:456}}}).known,false);
   assert.equal(next.view(store).known,true);
   now+=60000;assert.equal(next.view(store).known,false);
   const expired=new PracticeObserver(dir,{now:()=>now});assert.equal(expired.view(store).known,false);expired.dispose();
  }finally{next.dispose();}
 }finally{first.dispose();clean(dir);}
});
test('opponent profile is refreshed and saved while older caches remain usable',()=>{
 const dir=temp(),store={info:{basic:{api_member_id:123}}};let now=Date.UTC(2026,0,1,5,0);
 const first=new PracticeObserver(dir,{now:()=>now});
 try{
  first.acceptList({api_list:[{api_enemy_id:7,api_enemy_name:'甲',api_enemy_rank:'大将',api_enemy_comment:'签名'}]},store);
  first.acceptEnemy({api_member_id:7,api_cmt:'新签名',api_deck:{api_ships:[]}},store);
  const next=new PracticeObserver(dir,{now:()=>now});
  try{const view=next.view(store);assert.equal(view.needsProfileRefresh,false);assert.equal(view.opponents[0].admiralRank,'大将');assert.equal(view.opponents[0].comment,'新签名');}finally{next.dispose();}
  const file=path.join(dir,fs.readdirSync(dir)[0]),saved=JSON.parse(fs.readFileSync(file,'utf8'));
  delete saved.opponents.opponents[0].profileChecked;delete saved.opponents.opponents[0].admiralRank;delete saved.opponents.opponents[0].comment;
  fs.writeFileSync(file,JSON.stringify(saved));
  const legacy=new PracticeObserver(dir,{now:()=>now});
  try{assert.equal(legacy.view(store).needsProfileRefresh,true);assert.deepEqual(legacy.view(store).opponents[0].ships,[]);
   legacy.acceptList({api_list:[{api_enemy_id:7,api_enemy_name:'甲',api_enemy_rank:'中将',api_enemy_comment:''}]},store);
   assert.equal(legacy.view(store).needsProfileRefresh,false);assert.equal(legacy.view(store).opponents[0].admiralRank,'中将');assert.equal(legacy.view(store).opponents[0].comment,'');
  }finally{legacy.dispose();}
 }finally{first.dispose();clean(dir);}
});
test('a restarted sync uses this rotation cache and requests new data after the boundary',async()=>{
 const dir=temp();let now=Date.UTC(2026,0,1,5,59),store={info:{basic:{api_member_id:123}}};
 const first=new PracticeObserver(dir,{now:()=>now});
 first.acceptList({api_list:[{api_enemy_id:7,api_enemy_name:'甲'}]},store);
 first.acceptEnemy({api_member_id:7,api_deck:{api_ships:[{api_ship_id:3,api_level:20}]}},store);first.dispose();
 const observer=new PracticeObserver(dir,{now:()=>now}),requests=[];
 const reader={context:async()=>({ready:true,idle:true,compatible:true,sessionKey:'verified'}),read:async args=>{
  requests.push(args.kind);return args.kind==='practice'?{list:{api_list:[{api_enemy_id:8,api_enemy_name:'乙'}]}}:
   {enemy:{api_member_id:8,api_deck:{api_ships:[{api_ship_id:4,api_level:30}]}}};}};
 const sync=new (require('../../src/infrastructure/practice/practice_sync').PracticeSync)({reader,observer,getStore:()=>store,now:()=>now});
 try{
  assert.equal((await sync.tick()).status,'cached');assert.deepEqual(requests,[]);
  now+=60000;assert.equal((await sync.tick()).status,'ready');assert.equal((await sync.tick()).status,'ready');
  assert.deepEqual(requests,['practice','practice-enemy']);assert.equal(observer.view(store).opponents[0].name,'乙');
  assert.equal((await sync.tick()).status,'cached');
 }finally{sync.dispose();observer.dispose();clean(dir);}
});
test('practice list states reproduce the game result symbols without guessing invalid states',()=>{
 const dir=temp(),observer=new PracticeObserver(dir),store={info:{basic:{api_member_id:123}}};
 const list=values=>observer.acceptList({api_list:values.map((state,i)=>({api_enemy_id:i+1,api_state:state}))},store);
 try{
  list([0,1,2,3,4]);assert.deepEqual(observer.view(store).opponents.map(row=>[row.state,row.rank]),[[0,null],[1,'E'],[2,'D'],[3,'C'],[4,'B']]);
  list([5,6,null,undefined,7]);assert.deepEqual(observer.view(store).opponents.map(row=>[row.state,row.rank]),[[5,'A'],[6,'S'],[null,null],[null,null],[null,null]]);
  list(['6',-1,1.5,NaN,0]);assert.deepEqual(observer.view(store).opponents.map(row=>[row.state,row.rank]),[[null,null],[null,null],[null,null],[null,null],[0,null]]);
 }finally{observer.dispose();clean(dir);}
});
test('server list updates override old results and exact SS survives only an S list state',()=>{
 const dir=temp(),observer=new PracticeObserver(dir),store={info:{basic:{api_member_id:123}}};
 const list=state=>observer.acceptList({api_list:[{api_enemy_id:5,api_state:state}]},store);
 const observe=(path,body,postBody)=>observer.observe({path:'/kcsapi/'+path,body,postBody},store);
 try{
  list(0);observe('api_req_practice/battle',{},'api_enemy_id=5');observe('api_req_practice/battle_result',{api_win_rank:'SS'});
  assert.deepEqual([observer.view(store).opponents[0].state,observer.view(store).opponents[0].rank],[6,'SS']);
  list(6);assert.equal(observer.view(store).opponents[0].rank,'SS');
  list(4);assert.deepEqual([observer.view(store).opponents[0].state,observer.view(store).opponents[0].rank],[4,'B']);
  list(0);assert.deepEqual([observer.view(store).opponents[0].state,observer.view(store).opponents[0].rank],[0,null]);
  observe('api_req_practice/battle',{},'api_enemy_id=5');observe('api_req_practice/battle_result',{api_win_rank:'A'});
  assert.deepEqual([observer.view(store).opponents[0].state,observer.view(store).opponents[0].rank],[5,'A']);
  list(null);assert.deepEqual([observer.view(store).opponents[0].state,observer.view(store).opponents[0].rank],[null,null]);
 }finally{observer.dispose();clean(dir);}
});
test('practice list results survive same-session handoff but not account or rotation changes',()=>{
 const dir=temp();let now=Date.UTC(2026,0,1,5,0),store={info:{basic:{api_member_id:123}}};
 const observer=new PracticeObserver(dir,{now:()=>now}),next=new PracticeObserver(dir,{now:()=>now});
 try{
  observer.acceptList({api_list:[{api_enemy_id:1,api_state:6},{api_enemy_id:2,api_state:1}]},store);
  const snapshot=observer.snapshot(store);
  // Old releases persisted api_state but left rank null; hot handoff should
  // repair the list immediately without waiting for another API response.
  snapshot.opponents.forEach(row=>{row.rank=null;});next.restore(snapshot,store);
  assert.deepEqual(next.view(store).opponents.map(row=>row.rank),['S','E']);
  const other={info:{basic:{api_member_id:456}}};next.restore(snapshot,other);assert.equal(next.view(other).known,false);
  now+=12*3600000;next.restore(snapshot,store);assert.equal(next.view(store).known,false);
 }finally{observer.dispose();next.dispose();clean(dir);}
});
test('legacy same-session handoff restores observed ranks without overriding conflicting server states',()=>{
 const dir=temp();let now=Date.UTC(2026,0,1,5,0),store={info:{basic:{api_member_id:123}}};
 const observer=new PracticeObserver(dir,{now:()=>now}),next=new PracticeObserver(dir,{now:()=>now});
 try{
  observer.acceptList({api_list:[{api_enemy_id:1,api_state:0},{api_enemy_id:2,api_state:0},{api_enemy_id:3,api_state:1},{api_enemy_id:4,api_state:6},{api_enemy_id:5,api_state:0}]},store);
  const snapshot=observer.snapshot(store);
  Object.assign(snapshot.opponents[0],{state:0,rank:'S'});
  Object.assign(snapshot.opponents[1],{state:null,rank:'A'});
  Object.assign(snapshot.opponents[2],{state:1,rank:'S'});
  Object.assign(snapshot.opponents[3],{state:6,rank:'SS'});
  Object.assign(snapshot.opponents[4],{state:99,rank:'A'});
  next.restore(snapshot,store);
  assert.deepEqual(next.view(store).opponents.map(row=>[row.state,row.rank]),[[6,'S'],[5,'A'],[1,'E'],[6,'SS'],[null,null]]);
  // This exception applies to the validated handoff only. A fresh unknown or
  // unplayed list must still supersede any earlier observed result.
  next.acceptList({api_list:[{api_enemy_id:1,api_state:0},{api_enemy_id:2,api_state:null}]},store);
  assert.deepEqual(next.view(store).opponents.map(row=>[row.state,row.rank]),[[0,null],[null,null]]);
 }finally{observer.dispose();next.dispose();clean(dir);}
});
test('local battle history import is optional and explicitly unverified',async()=>{
 const dir=temp(),file=path.join(dir,'index.gz');try{
  fs.writeFileSync(file,zlib.gzipSync('id,time_,map,route_,desc,rank\n1,100,,,演习 对手,S\n2,200,,,普通战斗,A\n3,300,,,"演习, 对手",B\n'));
  const rows=await readLocalHistory(file);assert.deepEqual(rows.map(r=>r.rank),['B','S']);assert(rows.every(r=>r.source==='local-unverified'&&r.opponent===null));
  assert.deepEqual(await readLocalHistory(path.join(dir,'missing')),[]);
 }finally{clean(dir);}
});
