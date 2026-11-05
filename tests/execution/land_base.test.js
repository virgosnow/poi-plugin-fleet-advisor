'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {moveAircraftToEmptySlot,swapAircraftPositions,changeBaseAction,placeStockAircraft,configureOpenBase}=require('../../src/execution/land_base');
const context={area:6,base:3,from:3,to:4,itemId:7,mode:2,beforeSlots:[
  {slotId:1,itemId:5,state:2},{slotId:2,itemId:0,state:0},{slotId:3,itemId:7,state:1},{slotId:4,itemId:0,state:0}]};
test('base move submits once and confirms only after the observed result',async()=>{
  const calls=[],session={until:async kind=>{calls.push(kind);return {valid:true};},drag:async mutation=>calls.push(mutation),confirmMutation:()=>calls.push('confirm')};
  assert.deepEqual(await moveAircraftToEmptySlot(session,context),{ok:true,changed:1});
  assert.deepEqual(calls,['airbase-swap',{path:'api_req_air_corps/set_plane',area:6,base:3,slot:4,item:7},'airbase-swap-done','confirm']);
});
test('an unconfirmed base move is not retried or marked complete',async()=>{
  let inputs=0,confirmed=false;const session={until:async kind=>{if(kind==='airbase-swap-done')throw Error('timeout');return {valid:true};},
    drag:async()=>{inputs++;},confirmMutation:()=>{confirmed=true;}};
  await assert.rejects(moveAircraftToEmptySlot(session,context),/timeout/);assert.equal(inputs,1);assert.equal(confirmed,false);
});
test('an occupied same-base swap uses the target instance and the same exact game request',async()=>{
  const calls=[],session={until:async kind=>{calls.push(kind);return {valid:true};},drag:async mutation=>calls.push(mutation),confirmMutation:()=>calls.push('confirm')};
  const swap={...context,targetItemId:8};assert.deepEqual(await swapAircraftPositions(session,swap),{ok:true,changed:1});
  assert.deepEqual(calls,['airbase-swap',{path:'api_req_air_corps/set_plane',area:6,base:3,slot:4,item:7},'airbase-swap-done','confirm']);
  assert.throws(()=>moveAircraftToEmptySlot(session,swap),/不是空槽/);
});
test('base action cycles locally and submits exactly once when the panel closes',async()=>{
  const calls=[],point={x:10,y:20};let mode=0;
  const session={until:async(kind,arg,predicate)=>{calls.push(kind);const result={valid:kind!=='airbase-action'||arg.mode===mode,point};assert(predicate(result));return result;},
    input:async(x,y,mutation,kind,options)=>{calls.push(options.controlId);if(options.controlId==='airbase.action')mode=(mode+1)%5;
      if(options.controlId==='airbase.close')assert.deepEqual(mutation,{path:'api_req_air_corps/set_action',area:6,base:1,mode:2});},
    confirmMutation:()=>calls.push('confirm')};
  assert.deepEqual(await changeBaseAction(session,{area:6,base:1,currentMode:0,mode:2}),{ok:true,changed:1});
  assert.deepEqual(calls,['airbase-action-start','airbase-action','airbase.action','airbase-action','airbase-action','airbase.action',
    'airbase-action','airbase.close','airbase-action-done','confirm']);
});
test('stock plane placement searches categories, confirms the exact row and submits once',async()=>{
  const calls=[],point={x:10,y:20},ctx={...context,slot:4};let category=0,page=1;
  const session={until:async(kind,arg,predicate)=>{calls.push(kind);let result={valid:true,point};
    if(kind==='airbase-catalog')result={valid:true,category,page,targetPage:category===1?3:null,targetRow:8,
      categories:category===0?[{category:1,point}]:[],pages:[{page:3,point}]};
    assert(predicate(result));return result;},input:async(x,y,mutation,kind,options)=>{
      calls.push(options.controlId);if(options.controlId==='airbase.category.1')category=1;if(options.controlId==='airbase.page.3')page=3;
      if(options.controlId==='airbase.confirm')assert.deepEqual(mutation,{path:'api_req_air_corps/set_plane',area:6,base:3,slot:4,item:7});
    },confirmMutation:()=>calls.push('confirm')};
  assert.equal((await placeStockAircraft(session,ctx)).changed,1);
  assert.deepEqual(calls,['airbase-slot','airbase.slot.4','airbase-catalog','airbase.category.1','airbase-catalog',
    'airbase.page.3','airbase-catalog','airbase-row','airbase.row.8','airbase-selection','airbase.confirm','airbase-stock-done','confirm']);
});
test('a verified existing picker can resume without opening its slot again',async()=>{
  const calls=[],point={x:10,y:20},ctx={...context,slot:4,resumePicker:true};
  const session={until:async(kind,arg,predicate)=>{calls.push(kind);const result=kind==='airbase-catalog'?
    {valid:true,category:1,page:1,targetPage:1,targetRow:0,categories:[],pages:[]}:{valid:true,point};assert(predicate(result));return result;},
    input:async(x,y,mutation,kind,options)=>calls.push(options.controlId),confirmMutation:()=>calls.push('confirmed')};
  await placeStockAircraft(session,ctx);assert(!calls.includes('airbase-slot'));assert(!calls.includes('airbase.slot.4'));assert.equal(calls.at(-1),'confirmed');
});
test('stock plane placement advances page groups before choosing the exact page',async()=>{
  const calls=[],point={x:10,y:20},ctx={...context,slot:4};let page=1,group=0;
  const session={until:async(kind,arg,predicate)=>{let result={valid:true,point};if(kind==='airbase-catalog')result={valid:true,category:1,page,
    targetPage:8,targetRow:0,categories:[],pages:(group?[6,7,8,9]:[2,3,4,5]).map(page=>({page,point})),nextPages:point};
    assert(predicate(result));return result;},input:async(x,y,mutation,kind,options)=>{calls.push(options.controlId);
      if(options.controlId==='airbase.next-pages'){group=1;page=6;}if(options.controlId==='airbase.page.8')page=8;},confirmMutation:()=>calls.push('confirmed')};
  assert.equal((await placeStockAircraft(session,ctx)).changed,1);
  assert(calls.includes('airbase.next-pages'));assert(calls.includes('airbase.page.8'));assert.equal(calls.at(-1),'confirmed');
});
test('open-base configuration keeps pinned full inventory through sequential stock placements',async()=>{
  const planes=[1,2,3,4].map(n=>({api_squadron_id:n,api_slotid:0,api_state:0}));
  const store={airbaseSync:{complete:true,relocationsComplete:true},info:{ships:{},airbaseRelocations:[],
    equips:{7:{api_slotitem_id:1},8:{api_slotitem_id:1}},airbase:[{api_area_id:6,api_rid:1,api_action_kind:0,api_plane_info:planes}]},
    const:{$equips:{1:{api_type:[0,0,47]}}}};
  const target={areaId:6,rid:1,mode:0,modePlanned:true,slots:[7,8,0,0].map((itemId,i)=>({slotId:i+1,itemId}))};
  let submits=0;const point={x:10,y:20};
  const session={host:{getStore:()=>store},until:async(kind,arg,predicate)=>{let result={valid:true,point};
    if(kind==='airbase-catalog')result={valid:true,category:0,page:1,targetPage:1,targetRow:0,categories:[],pages:[]};
    if(kind==='airbase-stock-done')result.state=1;
    if(kind==='airbase-slot'&&submits)assert.deepEqual(arg.verifiedInventory,require('../../src/domain/fleet/land_base_inventory').baseInventory(store.info));
    assert(predicate(result));return result;},input:async(x,y,mutation,kind,options)=>{
      if(options.controlId==='airbase.confirm'){const slot=planes.find(row=>row.api_squadron_id===mutation.slot);slot.api_slotid=mutation.item;slot.api_state=1;
        store.airbaseSync.complete=false;submits++;}},confirmMutation:()=>{}};
  assert.deepEqual(await configureOpenBase(session,{area:'6-4',base:target}),{ok:true,changed:2});assert.equal(submits,2);
});
test('unsupported removal is rejected before any base input',async()=>{
  const store={airbaseSync:{complete:true,relocationsComplete:true},info:{ships:{},airbaseRelocations:[],
    equips:{7:{api_slotitem_id:1},8:{api_slotitem_id:1}},airbase:[{api_area_id:6,api_rid:1,api_action_kind:0,
      api_plane_info:[1,2,3,4].map(n=>({api_squadron_id:n,api_slotid:n===1?7:0,api_state:n===1?1:0}))}]},
    const:{$equips:{1:{api_type:[0,0,47]}}}};
  const base={areaId:6,rid:1,mode:0,slots:[0,0,0,0].map((itemId,i)=>({slotId:i+1,itemId}))};let inputs=0;
  const session={host:{getStore:()=>store},until:async()=>{inputs++;},input:async()=>{inputs++;}};
  await assert.rejects(configureOpenBase(session,{area:'6-4',base}),/尚未支持/);assert.equal(inputs,0);
});
test('replacement configures the pinned warehouse plane and retains the observed relocation state',async()=>{
  const planes=[1,2,3,4].map(n=>({api_squadron_id:n,api_slotid:n===1?7:0,api_state:n===1?1:0}));
  const store={airbaseSync:{complete:true,relocationsComplete:true},info:{ships:{},airbaseRelocations:[],
    equips:{7:{api_slotitem_id:1},8:{api_slotitem_id:1}},airbase:[{api_area_id:6,api_rid:1,api_action_kind:0,api_plane_info:planes}]},
    const:{$equips:{1:{api_type:[0,0,47]}}}};
  const target={areaId:6,rid:1,mode:0,slots:[8,0,0,0].map((itemId,i)=>({slotId:i+1,itemId}))},point={x:10,y:20};
  let submits=0;const session={host:{getStore:()=>store},until:async(kind,arg,predicate)=>{
    const result=kind==='airbase-catalog'?{valid:true,category:0,page:1,targetPage:1,targetRow:0,categories:[],pages:[]}:
      {valid:true,point,state:kind==='airbase-stock-done'?2:undefined};assert(predicate(result));return result;
  },input:async(x,y,mutation,kind,options)=>{if(options.controlId==='airbase.confirm'){
    assert.equal(mutation.item,8);planes[0].api_slotid=8;planes[0].api_state=2;store.info.airbaseRelocations=[{itemId:7}];submits++;
  }},confirmMutation:()=>{}};
  assert.deepEqual(await configureOpenBase(session,{area:'6-4',base:target}),{ok:true,changed:1});
  assert.equal(submits,1);assert.equal(planes[0].api_state,2);
});
test('an unconfirmed replacement is never submitted twice or confirmed',async()=>{
  const point={x:10,y:20},ctx={...context,slot:3,itemId:8};let submissions=0,confirmed=false;
  const session={until:async(kind,arg,predicate)=>{
    if(kind==='airbase-stock-done')throw Error('replacement outcome unknown');
    const result=kind==='airbase-catalog'?{valid:true,category:0,page:1,targetPage:1,targetRow:0,categories:[],pages:[]}:{valid:true,point};
    assert(predicate(result));return result;
  },input:async(x,y,mutation)=>{if(mutation)submissions++;},confirmMutation:()=>{confirmed=true;}};
  await assert.rejects(placeStockAircraft(session,ctx),/outcome unknown/);
  assert.equal(submissions,1);assert.equal(confirmed,false);
});
test('pending refresh is accepted only with the exact verified full base inventory',async()=>{
  const planes=[1,2,3,4].map(n=>({api_squadron_id:n,api_slotid:0,api_state:0}));
  const store={airbaseSync:{complete:false,relocationsComplete:true},info:{ships:{},airbaseRelocations:[],
    equips:{7:{api_slotitem_id:1}},airbase:[{api_area_id:6,api_rid:1,api_action_kind:0,api_plane_info:planes}]},
    const:{$equips:{1:{api_type:[0,0,47]}}}};
  const base={areaId:6,rid:1,mode:0,slots:[7,0,0,0].map((itemId,i)=>({slotId:i+1,itemId}))};
  const inventory=require('../../src/domain/fleet/land_base_inventory').baseInventory(store.info),point={x:10,y:20};
  const session={host:{getStore:()=>store},until:async(kind,arg,predicate)=>{
    const value=kind==='airbase-catalog'?{valid:true,category:0,page:1,targetPage:1,targetRow:0,categories:[],pages:[]}:{valid:true,point,state:1};
    assert(predicate(value));return value;
  },input:async(x,y,mutation,kind,options)=>{if(options.controlId==='airbase.confirm'){planes[0].api_slotid=7;planes[0].api_state=1;}},confirmMutation:()=>{}};
  await assert.rejects(configureOpenBase(session,{area:'6-4',base}),/尚未完整同步/);
  assert.equal((await configureOpenBase(session,{area:'6-4',base,verifiedInventory:inventory})).changed,1);
  await assert.rejects(configureOpenBase(session,{area:'6-4',base,verifiedInventory:inventory}),/尚未完整同步/);
});
