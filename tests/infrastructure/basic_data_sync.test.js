'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {BasicDataSync}=require('../../src/infrastructure/persistence/basic_data_sync');
function setup(){
  const store={info:{basic:{api_member_id:1},maps:{11:{api_id:11,api_cleared:0}},airbase:[],presets:null}},calls=[];let session='a',ready=true,time=10000;
  const reader={context:async({cached}={})=>({ready:true,sessionKey:session,idle:!cached&&ready,compatible:!cached&&ready}),
    read:async args=>{calls.push(args.kind);return args.kind==='mapinfo'?{mapinfo:{maps:[{api_id:11,api_cleared:1}],airbase:[{api_area_id:6,api_rid:1,api_plane_info:[{api_slotid:777}]}]}}:
      args.kind==='presets'?{presets:{api_max_num:1,api_deck:{1:{api_name:'队伍',api_ship:[4]}}}}:{missions:{api_list_items:[{api_mission_id:1,api_state:2}]}};}};
  let missions=0;const expedition={acceptMissions:()=>{missions++;return true;}};
  const sync=new BasicDataSync({reader,getStore:()=>store,expedition,now:()=>time});
  return {store,calls,reader,sync,missions:()=>missions,setSession:v=>session=v,setReady:v=>ready=v,advance:ms=>time+=ms};
}
test('login startup sync requests each missing dataset once and overlays only the plugin store',async()=>{
  const f=setup();f.setReady(false);assert.equal((await f.sync.tick()).status,'deferred');assert.deepEqual(f.calls,[]);
  f.setReady(true);for(let i=0;i<3;i++)assert.equal((await f.sync.tick()).status,'ready');
  assert.deepEqual(f.calls,['mapinfo','presets','missions']);assert.equal((await f.sync.tick()).status,'cached');
  const result=f.sync.view(f.store);assert.equal(result.info.maps[11].api_cleared,1);assert.equal(result.info.airbase[0].api_plane_info[0].api_slotid,777);
  assert.equal(result.info.presets.api_deck[1].api_name,'队伍');assert.equal(f.missions(),1);
  assert.equal(f.store.info.maps[11].api_cleared,0);assert.deepEqual(f.store.info.airbase,[]);
});
test('synchronized views retain info identity until underlying data or overlays change',async()=>{
  const f=setup();f.store.info.ships={1:{api_cond:49}};await f.sync.tick();
  const first=f.sync.view(f.store),again=f.sync.view({...f.store});
  assert.equal(first.info,again.info);
  f.store.info.ships[1].api_cond=20;assert.equal(f.sync.view(f.store).info.ships[1].api_cond,20);
  f.store.info.ships={2:{api_cond:50}};const changed=f.sync.view(f.store);
  assert.notEqual(changed.info,first.info);assert.equal(changed.info.ships[2].api_cond,50);
  await f.sync.tick();assert.notEqual(f.sync.view(f.store).info,changed.info);
});
test('natural responses win and subsequent events refresh only the affected dataset',async()=>{
  const f=setup();f.sync.observe({path:'/kcsapi/api_get_member/mapinfo',body:{api_map_info:[{api_id:11}],api_air_base:[]}},f.store);
  assert.equal((await f.sync.tick()).kind,'presets');assert.equal((await f.sync.tick()).kind,'missions');
  f.sync.observe({path:'/kcsapi/api_req_mission/result',body:{}},f.store);assert.equal((await f.sync.tick()).kind,'missions');
  f.sync.observe({path:'/kcsapi/api_req_air_corps/set_plane',body:{}},f.store);assert.equal((await f.sync.tick()).kind,'mapinfo');
  assert.deepEqual(f.calls,['presets','missions','missions','mapinfo']);
});
test('airbase availability is only known after a complete mapinfo response and resets on account change',async()=>{
  const f=setup();
  assert.equal(f.sync.view(f.store).airbaseSync.complete,false);
  f.sync.observe({path:'/kcsapi/api_get_member/mapinfo',body:{api_map_info:[{api_id:11}]}},f.store);
  assert.equal(f.sync.view(f.store).airbaseSync.complete,false,'partial data cannot establish locked status');
  f.sync.observe({path:'/kcsapi/api_get_member/mapinfo',body:{api_map_info:[{api_id:11}],api_air_base:[]}},f.store);
  assert.equal(f.sync.view(f.store).airbaseSync.complete,true);
  f.store.info.basic.api_member_id=2;
  assert.equal(f.sync.view(f.store).airbaseSync.complete,false,'account changes invalidate the result');
  await f.sync.tick();assert.equal(f.sync.view(f.store).airbaseSync.complete,true,'guarded background reads also establish completeness');
});
test('stale background results do not replace newer natural responses or cross accounts',async()=>{
  const f=setup();f.reader.read=async()=>{f.sync.observe({path:'/kcsapi/api_get_member/mapinfo',body:{api_map_info:[{api_id:11}],api_air_base:[]}},f.store);return {mapinfo:{maps:[{api_id:11,api_cleared:1}],airbase:[]}};};
  assert.equal((await f.sync.tick()).status,'deferred');assert.equal(f.sync.view(f.store).info.maps[11].api_cleared,0);
  f.store.info.basic.api_member_id=2;assert.equal(f.sync.view(f.store).info.presets,null);
});
test('hot reload preserves only same-account recent data and session state',async()=>{
  const f=setup();await f.sync.tick();const snapshot=f.sync.snapshot(),g=setup();g.sync.restore(snapshot,g.store);
  assert.equal(g.sync.view(g.store).info.maps[11].api_cleared,1);assert.equal((await g.sync.tick()).kind,'presets');
  const other=setup();other.store.info.basic.api_member_id=3;other.sync.restore(snapshot,other.store);assert.equal(other.sync.view(other.store).info.maps[11].api_cleared,0);
});
test('monthly expedition rollover requests missions again but leaves maps and presets alone',async()=>{
  const store={info:{basic:{api_member_id:1}}},calls=[];let time=Date.UTC(2026,0,14,2,0);
  const reader={context:async()=>({ready:true,idle:true,compatible:true,sessionKey:'same'}),read:async({kind})=>{
    calls.push(kind);return kind==='mapinfo'?{mapinfo:{maps:[],airbase:[]}}:kind==='presets'?{presets:{api_max_num:0,api_deck:{}}}:{missions:{api_list_items:[{api_mission_id:1,api_state:2}]}};}};
  const sync=new BasicDataSync({reader,getStore:()=>store,expedition:{acceptMissions:()=>true},now:()=>time});
  for(let i=0;i<3;i++)await sync.tick();time=Date.UTC(2026,0,15,3,0);
  assert.equal((await sync.tick()).kind,'missions');assert.deepEqual(calls,['mapinfo','presets','missions','missions']);
});
test('fresh base-aircraft data is respected by recommendation and snapshot ownership',async()=>{
  const f=setup(),s=require('../helpers/workbench_fixture')();
  s.info.basic.api_member_id=1;s.info.equips[777]={api_slotitem_id:8};s.const.$equips[8]={api_type:[0,0,6,6]};
  f.sync.getStore=()=>s;await f.sync.tick();const updated=f.sync.view(s);
  assert(!require('../../src/recommendation/loadout/loadout_policy').availableEquipment(updated).some(row=>row.id===777));
  assert.equal(require('../../src/application/snapshots').ownership(updated).get(777).location,'airbase');
});

test('failed datasets back off without starving other datasets and eventually recover',async()=>{
  const f=setup(),original=f.reader.read;let failures=0;
  f.reader.read=async args=>{if(args.kind==='mapinfo'&&failures++===0)throw Error('temporary');return original(args);};
  assert.equal((await f.sync.tick()).status,'failed');
  assert.equal((await f.sync.tick()).kind,'presets');assert.equal((await f.sync.tick()).kind,'missions');
  assert.equal((await f.sync.tick()).status,'backoff');f.advance(2000);
  assert.equal((await f.sync.tick()).kind,'mapinfo');assert.equal((await f.sync.tick()).status,'cached');
  assert.equal(f.sync.view(f.store).info.maps[11].api_cleared,1);
});

test('restored success markers without datasets schedule the missing reads',async()=>{
  const f=setup();f.sync.restore({version:1,key:require('crypto').createHash('sha256').update('1').digest('hex'),
    session:'a',time:10000,pending:[],attempted:['mapinfo','presets','missions']},f.store);
  for(let i=0;i<3;i++)assert.equal((await f.sync.tick()).status,'ready');
  assert.deepEqual(f.calls,['mapinfo','presets','missions']);
});
