'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PracticeSync}=require('../../src/infrastructure/practice/practice_sync');
function fixture(){
  const store={info:{basic:{api_member_id:1}}},state={known:false,opponents:[],revision:0,listUpdatedAt:null};let now=0,ready=true,requests=[];
  const reader={context:async({cached}={})=>({ready:true,idle:!cached&&ready,compatible:!cached&&ready,sessionKey:'session'}),
    read:async args=>{requests.push(args);return args.kind==='practice'?{list:{api_list:[{api_enemy_id:5}]}}:
      {enemy:{api_member_id:args.enemyId,api_deck:{api_ships:[{api_ship_id:10}]}}};}};
  const observer={view:()=>({...state}),acceptList:data=>{const prior=new Map(state.opponents.map(row=>[row.id,row]));state.opponents=data.api_list.map(r=>prior.get(r.api_enemy_id)||({id:r.api_enemy_id,ships:null}));state.known=true;state.listUpdatedAt=now;state.revision++;return true;},
    acceptEnemy:data=>{const row=state.opponents.find(o=>o.id===data.api_member_id);row.ships=data.api_deck.api_ships;row.fleetUpdatedAt=now;state.revision++;return true;}};
  const sync=new PracticeSync({reader,observer,getStore:()=>store,now:()=>now});
  return {sync,state,reader,requests,setReady:v=>ready=v,advance:ms=>now+=ms};
}
test('a practice data request stops after ten retries until the session changes',async()=>{
  const f=fixture(),{retryDelay}=require('../../src/infrastructure/sync/retry_policy');let calls=0;
  const original=f.reader.read;f.reader.read=async()=>{calls++;throw Error('unavailable');};
  assert.equal((await f.sync.tick()).status,'failed');
  for(let i=1;i<=10;i++){f.advance(retryDelay(i));assert.equal((await f.sync.tick()).status,'failed');}
  assert.equal((await f.sync.tick()).status,'exhausted');assert.equal(calls,11);
  const context=f.reader.context;f.reader.context=async args=>({...await context(args),sessionKey:'new-session'});
  f.reader.read=original;assert.equal((await f.sync.tick()).status,'ready');
});
test('automatic practice synchronization reads list and each fleet once per cycle',async()=>{
  const f=fixture();f.setReady(false);assert.equal((await f.sync.tick()).status,'deferred');assert.equal(f.requests.length,0);
  f.setReady(true);assert.equal((await f.sync.tick()).status,'ready');assert.equal((await f.sync.tick()).status,'ready');
  assert.deepEqual(f.requests.map(r=>r.kind),['practice','practice-enemy']);assert.equal(f.requests[1].enemyId,5);
  assert.equal((await f.sync.tick()).status,'cached');assert.equal(f.requests.length,2);
  f.state.known=false;f.advance(12*3600000);assert.equal((await f.sync.tick()).status,'ready');assert.equal(f.requests.length,3);
});
test('battle result schedules a fresh list once safe, without waiting for the periodic refresh',async()=>{
  const f=fixture();await f.sync.tick();await f.sync.tick();assert.equal(f.requests.length,2);
  f.sync.observeResult({path:'/kcsapi/api_req_practice/battle_result',body:{api_result:0,api_data:{api_win_rank:'A'}}});
  assert.equal(f.sync.listDirty,false,'failed responses do not schedule a refresh');
  f.sync.observeResult({path:'/kcsapi/api_req_practice/battle_result',body:{api_win_rank:'A'}});
  f.setReady(false);assert.equal((await f.sync.tick()).status,'deferred');assert.equal(f.requests.length,2);
  f.setReady(true);assert.equal((await f.sync.tick()).status,'ready');assert.equal(f.requests[2].kind,'practice');
  assert.equal((await f.sync.tick()).status,'cached');assert.equal(f.requests.length,3);
});
test('a battle result during a background read discards the stale response and keeps the refresh pending',async()=>{
  const f=fixture();let release,started;const starting=new Promise(resolve=>{started=resolve;});
  f.reader.read=async()=>{started();await new Promise(resolve=>{release=resolve;});return {list:{api_list:[{api_enemy_id:5}]}};};
  const pending=f.sync.tick();await starting;
  f.sync.observeResult({path:'/kcsapi/api_req_practice/battle_result',body:{api_win_rank:'S'}});release();
  assert.equal((await pending).status,'deferred');assert.equal(f.state.known,false);assert.equal(f.sync.listDirty,true);
  f.reader.read=async()=>({list:{api_list:[{api_enemy_id:6}]}});
  assert.equal((await f.sync.tick()).status,'ready');assert.equal(f.state.opponents[0].id,6);assert.equal(f.sync.listDirty,false);
});
test('expired lists and fleets refresh without clearing the previous lineup',async()=>{
  const f=fixture();await f.sync.tick();await f.sync.tick();const previous=f.state.opponents[0].ships;
  f.advance(5*60*1000-1);assert.equal((await f.sync.tick()).status,'cached');
  f.advance(1);let seen;f.reader.read=async args=>{seen=f.state.opponents[0].ships;return args.kind==='practice'?{list:{api_list:[{api_enemy_id:5}]}}:{enemy:{api_member_id:args.enemyId,api_deck:{api_ships:[{api_ship_id:11}]}}};};
  assert.equal((await f.sync.tick()).status,'ready');assert.equal(seen,previous);
  assert.equal((await f.sync.tick()).status,'ready');assert.equal(seen,previous);assert.equal(f.state.opponents[0].ships[0].api_ship_id,11);
  assert.equal((await f.sync.tick()).status,'cached');
});
test('an older cached profile refreshes the list before an expired fleet',async()=>{
  const f=fixture();f.state.known=true;f.state.needsProfileRefresh=true;f.state.opponents=[{id:5,ships:[{api_ship_id:10}],fleetUpdatedAt:0}];f.advance(5*60*1000);
  const accept=f.sync.observer.acceptList;f.sync.observer.acceptList=data=>{f.state.needsProfileRefresh=false;return accept(data);};
  assert.equal((await f.sync.tick()).status,'ready');assert.deepEqual(f.requests.map(r=>r.kind),['practice']);
  assert.equal((await f.sync.tick()).status,'ready');assert.deepEqual(f.requests.map(r=>r.kind),['practice','practice-enemy']);
  assert.equal((await f.sync.tick()).status,'cached');
});
test('natural responses supersede in-flight background data; interruptions can retry',async()=>{
  const f=fixture();f.reader.read=async()=>{f.state.known=true;f.state.opponents=[{id:9,ships:null}];f.state.revision++;return {list:{api_list:[{api_enemy_id:5}]}};};
  assert.equal((await f.sync.tick()).status,'deferred');assert.equal(f.state.opponents[0].id,9);
  f.reader.read=async()=>({deferred:true});assert.equal((await f.sync.tick()).status,'deferred');
  assert(!f.sync.attempted.has('enemy:9'));
});
test('a restored attempt marker cannot hide missing opponent data and resets on session change',async()=>{
  const f=fixture();await f.sync.tick();await f.sync.tick();const saved=f.sync.snapshot();
  const again=fixture();again.state.known=true;again.state.opponents=[{id:5,ships:null}];again.sync.restore(saved);
  assert.equal((await again.sync.tick()).status,'ready');assert.equal(again.requests.length,1);
  again.reader.context=async({cached}={})=>({ready:true,idle:!cached,compatible:!cached,sessionKey:'different'});
  again.state.known=false;assert.equal((await again.sync.tick()).status,'ready');assert.equal(again.requests.length,2);
});

test('a failed opponent backs off while other opponents can complete, then recovers',async()=>{
  const f=fixture();f.state.known=true;f.state.listUpdatedAt=0;f.state.opponents=[{id:5,ships:null},{id:6,ships:null}];let failed=false;
  const original=f.reader.read;f.reader.read=async args=>{
    if(args.enemyId===5&&!failed){failed=true;throw Error('transient');}return original(args);
  };
  assert.equal((await f.sync.tick()).status,'failed');assert.equal((await f.sync.tick()).status,'ready');
  assert.equal(f.state.opponents[1].ships[0].api_ship_id,10);assert.equal((await f.sync.tick()).status,'backoff');
  f.advance(2000);assert.equal((await f.sync.tick()).status,'ready');
  assert.equal(f.state.opponents[0].ships[0].api_ship_id,10);assert.equal((await f.sync.tick()).status,'cached');
});

test('a saved list attempt cannot hide a missing actual opponent list',async()=>{
  const f=fixture();f.sync.restore({version:1,session:'session',period:require('../../src/infrastructure/practice/practice_observer').cycle(0),attempted:['list']});
  assert.equal((await f.sync.tick()).status,'ready');assert.equal(f.state.known,true);
});
test('leaving the practice page prevents and cancels periodic reads',async()=>{
  const f=fixture();let active=false;f.sync.isActive=()=>active;
  assert.equal((await f.sync.tick()).status,'deferred');assert.equal(f.requests.length,0);
  active=true;let release,started;const startedPromise=new Promise(resolve=>{started=resolve;});
  f.reader.read=async()=>{started();await new Promise(resolve=>{release=resolve;});return {list:{api_list:[{api_enemy_id:5}]}};};
  const pending=f.sync.tick();await startedPromise;active=false;f.sync.suspend();release();
  assert.equal((await pending).status,'deferred');assert.equal(f.state.known,false);
});
