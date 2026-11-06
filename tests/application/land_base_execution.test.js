'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Controller}=require('../../src/application/controller');
const landBase=require('../../src/execution/land_base');

function fixture(){
  const store={airbaseSync:{complete:true,relocationsComplete:true},info:{ships:{},airbaseRelocations:[],
    equips:{7:{api_slotitem_id:1},8:{api_slotitem_id:1}},airbase:[{api_area_id:6,api_rid:1,api_action_kind:0,
      api_plane_info:[1,2,3,4].map(n=>({api_squadron_id:n,api_slotid:0,api_state:0}))}]},
    const:{$equips:{1:{api_type:[0,0,47]}}}};
  const base={areaId:6,rid:1,mode:0,slots:[7,0,0,0].map((itemId,i)=>({slotId:i+1,itemId}))};
  const options={landBase:{area:'6-4',bases:[base]}};
  let hosts=0;
  const c=new Controller({getStore:()=>store,createHost:()=>{hosts++;return {start:async()=>{},dispose:async()=>{}};},createObserver:()=>({start:async()=>{},dispose:async()=>{}})});
  c.planner.preview=()=>({fleet:1,done:true,changed:0,organization:{done:true,targets:[1]},equipment:{ships:[]},pinned:{org:{ships:[{id:1}]},eq:{ships:[]}}});
  c.createSession=()=>{c.session={metrics:{started:performance.now()},check(){},stop(){}};};
  c.returnHomeAndPark=async()=>{};
  return {store,base,options,c,hosts:()=>hosts};
}
test('base changes join preview and are applied even when the fleet is already configured',async t=>{
  const {store,options,c}=fixture(),calls=[];
  t.mock.method(landBase,'enterBase',async(_session,area,base)=>calls.push(['enter',area,base]));
  t.mock.method(landBase,'configureOpenBase',async(_session,{base})=>{
    calls.push(['configure',base.rid]);const row=store.info.airbase[0].api_plane_info[0];row.api_slotid=7;row.api_state=1;
    return {ok:true,changed:1};
  });
  t.mock.method(landBase,'closeBase',async()=>calls.push(['close']));
  const plan=c.preview('fleet',{},options);assert.equal(plan.done,false);assert.equal(plan.changed,1);
  const result=await c.run('fleet',{},options);
  assert.equal(result.changed,1);assert.equal(result.stages.landBase.changed,1);
  assert.deepEqual(calls,[['enter',6,1],['configure',1],['close']]);
});
test('unsupported removals and image mode are rejected before starting the host',async()=>{
  const {store,base,options,c,hosts}=fixture();
  store.info.airbase[0].api_plane_info[0].api_slotid=8;store.info.airbase[0].api_plane_info[0].api_state=1;
  base.slots[0].itemId=0;
  await assert.rejects(c.run('fleet',{},options),/卸装/);assert.equal(hosts(),0);
  store.info.airbase[0].api_plane_info[0].api_slotid=0;store.info.airbase[0].api_plane_info[0].api_state=0;
  base.slots[0].itemId=7;
  await assert.rejects(c.run('fleet',{}, {...options,recognitionMode:'image'}),/需要控件识别/);assert.equal(hosts(),0);
  base.slots[0].itemId=7;
});
test('base final verification detects an unobserved result',async t=>{
  const {options,c}=fixture();
  t.mock.method(landBase,'enterBase',async()=>{});
  t.mock.method(landBase,'configureOpenBase',async()=>({ok:true,changed:1}));
  t.mock.method(landBase,'closeBase',async()=>{});
  await assert.rejects(c.run('fleet',{},options),/飞机状态未确认/);
});
test('base replacement is applied and verifies an aircraft that is still relocating',async t=>{
  const {store,options,c}=fixture(),slot=store.info.airbase[0].api_plane_info[0];
  slot.api_slotid=8;slot.api_state=1;
  assert.equal(c.preview('fleet',{},options).landBase.bases[0].operations[0].previousId,8);
  t.mock.method(landBase,'enterBase',async()=>{});t.mock.method(landBase,'closeBase',async()=>{});
  t.mock.method(landBase,'configureOpenBase',async()=>{
    slot.api_slotid=7;slot.api_state=2;store.info.airbaseRelocations=[{itemId:8}];return {ok:true,changed:1};
  });
  assert.equal((await c.run('fleet',{},options)).changed,1);
});
test('a second base can continue against the verified inventory while background synchronization is pending',async t=>{
  const {store,options,c}=fixture();
  store.info.airbase.push({api_area_id:6,api_rid:2,api_action_kind:0,
    api_plane_info:[1,2,3,4].map(n=>({api_squadron_id:n,api_slotid:0,api_state:0}))});
  options.landBase.bases.push({areaId:6,rid:2,mode:0,slots:[8,0,0,0].map((itemId,i)=>({slotId:i+1,itemId}))});
  const seen=[],navigation=[];t.mock.method(landBase,'enterBase',async(_session,area,base)=>navigation.push(['enter',area,base]));
  t.mock.method(landBase,'selectBase',async(_session,area,base,previous)=>navigation.push(['tab',area,previous,base]));
  t.mock.method(landBase,'closeBase',async(_session,area,base)=>navigation.push(['close',area,base]));
  t.mock.method(landBase,'configureOpenBase',async(_session,{base,verifiedInventory})=>{
    seen.push(structuredClone(verifiedInventory));const row=store.info.airbase.find(x=>x.api_rid===base.rid).api_plane_info[0];
    row.api_slotid=base.slots[0].itemId;row.api_state=1;store.airbaseSync.complete=false;return {ok:true,changed:1};
  });
  const result=await c.run('fleet',{},options);assert.equal(result.changed,2);
  assert.equal(seen[1].find(x=>x.base===1).slots[0].item,7);
  assert.deepEqual(navigation,[['enter',6,1],['tab',6,1,2],['close',6,2]]);
});

test('after committing an action mode, the next base reopens directly from the same area',async t=>{
  const {store,options,c}=fixture();options.landBase.bases[0].mode=1;options.landBase.bases[0].modePlanned=true;
  store.info.airbase.push({api_area_id:6,api_rid:2,api_action_kind:0,
    api_plane_info:[1,2,3,4].map(n=>({api_squadron_id:n,api_slotid:0,api_state:0}))});
  options.landBase.bases.push({areaId:6,rid:2,mode:0,slots:[8,0,0,0].map((itemId,i)=>({slotId:i+1,itemId}))});
  const calls=[];t.mock.method(landBase,'enterBase',async(_session,area,base)=>calls.push(['enter',area,base]));
  t.mock.method(landBase,'openBaseFromArea',async(_session,area,base)=>calls.push(['reopen',area,base]));
  t.mock.method(landBase,'selectBase',async()=>{throw Error('closed panel cannot switch tabs');});
  t.mock.method(landBase,'closeBase',async(_session,area,base)=>calls.push(['close',area,base]));
  t.mock.method(landBase,'configureOpenBase',async(_session,{base})=>{
    const live=store.info.airbase.find(row=>row.api_rid===base.rid),slot=live.api_plane_info[0];
    slot.api_slotid=base.slots[0].itemId;slot.api_state=1;live.api_action_kind=base.mode;
    return {ok:true,changed:base.rid===1?2:1};
  });
  const result=await c.run('fleet',{},options);assert.equal(result.changed,3);
  assert.deepEqual(calls,[['enter',6,1],['reopen',6,2],['close',6,2]]);
});
