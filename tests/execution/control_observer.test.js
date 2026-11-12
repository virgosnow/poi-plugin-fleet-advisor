'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {ControlObserver,observeControls,matchesMutation}=require('../../src/execution/control_observer');
const {Session}=require('../../src/execution/session');
const {readControlSnapshot}=require('../../src/host/control_reader');
const {Controller}=require('../../src/application/controller');
const {PoiHost}=require('../../src/host/poi_host');
const clone=v=>structuredClone(v);
const button=(id,meta={})=>({id,attached:true,visible:true,enabled:true,rendered:true,point:{x:100,y:200},bounds:{left:80,right:120,top:180,bottom:220},...meta});
function equipment(phase='picker'){
  const row=button('equipment.row.0',{row:0});
  const s={version:1,documentId:1,valid:true,blocked:false,scene:'equipment',fleet:1,shipId:11,controls:[row],equipment:{phase,shipId:11,slot:0,itemId:7,sourceShip:null,
    mode:0,filter:0,filterDetail:0,sourceCount:1,sourceIds:[7],page:{valid:true,activePage:1,labels:[1],centers:[100],y:677,totalPages:1},
    rows:[{visible:true,itemId:7,expectedId:7,sourceShip:null,unset:false,isSortie:false,isExpedition:false,control:row}],level:50,slots:[{visible:true},{visible:true}]}};
  s.equipment.commit=button(phase==='borrow'?'equipment.borrow':'equipment.confirm',{shipId:11,slot:0,itemId:7,sourceShip:null,mode:0});
  if(phase==='confirm'||phase==='borrow')s.controls=[s.equipment.commit];
  return s;
}
const store={info:{equips:{7:{api_slotitem_id:1}},ships:{11:{api_slot:[-1,-1]},22:{api_slot:[7,-1],api_slot_ex:0}}},const:{$equips:{1:{api_type:[0,0,1,10]}}}};
const context={shipId:11,slot:0,itemId:7,sourceShipId:null,page:1,row:0,t3:10};

test('base confirmation requires a pinned aircraft and exact destination',()=>{
 const snapshot={airbase:{itemId:7}},control=button('airbase.confirm',{area:6,base:3,slot:1,itemId:7});
 const mutation={path:'api_req_air_corps/set_plane',area:6,base:3,slot:1,item:7};
 assert(matchesMutation(control,mutation,snapshot));assert(!matchesMutation(control,null,snapshot));
 for(const change of [{area:7},{base:2},{slot:2},{item:8}])assert(!matchesMutation(control,{...mutation,...change},snapshot));
 assert(!matchesMutation(control,mutation,{airbase:{itemId:8}}));
});

test('base action commits only the selected change and never silently closes a pending edit',()=>{
  const control=button('airbase.close',{area:6,base:3,mode:2}),mutation={path:'api_req_air_corps/set_action',area:6,base:3,mode:2};
  const snapshot={scene:'airbase',airbase:{phase:'base',area:6,base:3,mode:2,models:[
    {base:1,mode:0,pendingMode:0,nameChanged:false},{base:2,mode:0,pendingMode:-1,nameChanged:false},
    {base:3,mode:0,pendingMode:0,nameChanged:false}]}};
  assert(matchesMutation(control,mutation,snapshot));assert(!matchesMutation(control,null,snapshot));
  assert(!matchesMutation(button('navigate.home'),null,snapshot));
  for(const change of [{area:7},{base:2},{mode:1}])assert(!matchesMutation(control,{...mutation,...change},snapshot));
  const other=clone(snapshot);other.airbase.models[0].pendingMode=1;assert(!matchesMutation(control,mutation,other));
  const renamed=clone(snapshot);renamed.airbase.models[0].nameChanged=true;assert(!matchesMutation(control,mutation,renamed));
  const missing=clone(snapshot);missing.airbase.models=undefined;assert(!matchesMutation(control,mutation,missing));
  const duplicate=clone(snapshot);duplicate.airbase.models[0].base=3;assert(!matchesMutation(control,mutation,duplicate));
});

test('base action clicks require a fresh exact action observation',async()=>{
  const action=button('airbase.action',{area:6,base:3,mode:2});
  const s={version:1,valid:true,blocked:false,scene:'airbase',controls:[action],airbase:{phase:'base',area:6,base:3,mode:2,action,
    models:[{base:3,mode:0,pendingMode:0,nameChanged:false}]}};
  const observer=new ControlObserver({readControls:async()=>s,getStore:()=>store});await observer.start();
  await assert.rejects(observer.prepareInput({x:100,y:200,kind:'click',controlId:'airbase.action'}),/Unique enabled control/);
  assert((await observer.read('airbase-action',{area:6,base:3,mode:2})).valid);
  assert.deepEqual(await observer.prepareInput({x:100,y:200,kind:'click',controlId:'airbase.action'}),{x:100,y:200});
  s.airbase.mode=3;
  await assert.rejects(observer.prepareInput({x:100,y:200,kind:'click',controlId:'airbase.action'}),/Unique enabled control/);
});

test('closing an unchanged base requires a fresh observation and rejects pending changes',async()=>{
  const close=button('airbase.close',{area:6,base:3,mode:2});
  const s={version:1,valid:true,blocked:false,scene:'airbase',controls:[close],airbase:{phase:'base',area:6,base:3,mode:2,close,
    models:[{base:3,mode:2,pendingMode:-1,nameChanged:false},{base:1,mode:0,pendingMode:0,nameChanged:false}]}};
  const observer=new ControlObserver({readControls:async()=>s,getStore:()=>store});await observer.start();
  const input={x:100,y:200,kind:'click',controlId:'airbase.close'};
  await assert.rejects(observer.prepareInput(input),/Unique enabled control/);
  assert((await observer.read('airbase-close-clean',{area:6,base:3})).valid);
  assert.deepEqual(await observer.prepareInput(input),{x:100,y:200});
  s.airbase.models[1].pendingMode=1;
  await assert.rejects(observer.prepareInput(input),/Unique enabled control/);
});

test('base tab switches require the exact area, unique target and no pending edits',()=>{
  const tab=button('airbase.tab.2',{base:2}),s={version:1,valid:true,blocked:false,scene:'airbase',
    airbase:{phase:'base',area:6,base:1,mode:0,tabs:[tab],models:[
      {base:1,mode:0,pendingMode:-1,nameChanged:false},{base:2,mode:0,pendingMode:0,nameChanged:false}]}};
  assert(observeControls(s,'airbase-tab',{area:6,base:2},store).valid);
  const pending=clone(s);pending.airbase.models[0].pendingMode=1;
  assert.equal(observeControls(pending,'airbase-tab',{area:6,base:2},store).valid,false);
  const renamed=clone(s);renamed.airbase.models[1].nameChanged=true;
  assert.equal(observeControls(renamed,'airbase-tab',{area:6,base:2},store).valid,false);
  const duplicate=clone(s);duplicate.airbase.tabs.push(tab);
  assert.equal(observeControls(duplicate,'airbase-tab',{area:6,base:2},store).valid,false);
  assert.equal(observeControls(s,'airbase-tab',{area:7,base:2},store).valid,false);
});

test('base action completion requires the panel to close and poi to observe the exact mode',()=>{
  const s={version:1,valid:true,blocked:false,scene:'airbase-area',area:6,controls:[]},live={info:{airbase:[{api_area_id:6,api_rid:1,api_action_kind:1}]}};
  assert(observeControls(s,'airbase-action-done',{area:6,base:1,mode:1},live).valid);
  assert.equal(observeControls(s,'airbase-action-done',{area:6,base:1,mode:2},live).valid,false);
  assert.equal(observeControls({...s,scene:'airbase'},'airbase-action-done',{area:6,base:1,mode:1},live).valid,false);
  live.info.airbase.push({...live.info.airbase[0]});assert.equal(observeControls(s,'airbase-action-done',{area:6,base:1,mode:1},live).valid,false);
});

test('base drag pins both slots, aircraft instance and live store before input',async()=>{
  const src=button('airbase.slot.3',{slot:3}),dst=button('airbase.slot.4',{slot:4,point:{x:100,y:260}});
  const s={version:1,valid:true,blocked:false,scene:'airbase',airbase:{phase:'base',area:6,base:3,mode:2,slots:[
    {slotId:1,itemId:5,state:2},{slotId:2,itemId:0,state:0},{slotId:3,itemId:7,state:1,control:src},{slotId:4,itemId:0,state:0,control:dst}]}};
  const live={info:{airbase:[{api_area_id:6,api_rid:3,api_plane_info:[
    {api_squadron_id:1,api_slotid:5,api_state:2},{api_squadron_id:2,api_slotid:0,api_state:0},
    {api_squadron_id:3,api_slotid:7,api_state:1},{api_squadron_id:4,api_slotid:0,api_state:0}]}]}};
  const host={readControls:async()=>s,getStore:()=>live},observer=new ControlObserver(host);await observer.start();
  const arg={area:6,base:3,mode:2,from:3,to:4,itemId:7,beforeSlots:s.airbase.slots.map(({slotId,itemId,state})=>({slotId,itemId,state}))},mutation={path:'api_req_air_corps/set_plane',area:6,base:3,slot:4,item:7};
  await assert.rejects(observer.prepareDrag({mutation}),/intent/);
  assert((await observer.read('airbase-swap',arg)).valid);
  assert.deepEqual(await observer.prepareDrag({mutation}),{source:src.point,destination:dst.point});
  await assert.rejects(observer.prepareDrag({mutation:{...mutation,item:8}}),/intent/);
  live.info.airbase[0].api_plane_info[3].api_slotid=9;
  await assert.rejects(observer.prepareDrag({mutation}),/precondition changed/);
  live.info.airbase[0].api_plane_info[3].api_slotid=0;s.airbase.slots[2].state=2;
  assert.equal((await observer.read('airbase-swap',arg)).valid,false);
  Object.assign(s.airbase.slots[2],{itemId:0,state:0});Object.assign(s.airbase.slots[3],{itemId:7,state:1});
  Object.assign(live.info.airbase[0].api_plane_info[2],{api_slotid:0,api_state:0});
  Object.assign(live.info.airbase[0].api_plane_info[3],{api_slotid:7,api_state:1});
  assert((await observer.read('airbase-swap-done',arg)).valid);
  live.info.airbase[0].api_plane_info[0].api_state=1;
  assert.equal((await observer.read('airbase-swap-done',arg)).valid,false);
});

test('occupied base swap pins both aircraft and requires both to remain ready',async()=>{
  const src=button('airbase.slot.3',{slot:3}),dst=button('airbase.slot.4',{slot:4,point:{x:100,y:260}}),before=[
    {slotId:1,itemId:0,state:0},{slotId:2,itemId:0,state:0},{slotId:3,itemId:7,state:1},{slotId:4,itemId:8,state:1}];
  const s={version:1,valid:true,blocked:false,scene:'airbase',airbase:{phase:'base',area:6,base:3,mode:2,
    slots:before.map(row=>({...row,...(row.slotId===3?{control:src}:row.slotId===4?{control:dst}:{})}))}};
  const live={info:{airbase:[{api_area_id:6,api_rid:3,api_plane_info:before.map(x=>({api_squadron_id:x.slotId,api_slotid:x.itemId,api_state:x.state}))}]}};
  const ctx={area:6,base:3,mode:2,from:3,to:4,itemId:7,targetItemId:8,beforeSlots:clone(before)};
  assert(observeControls(s,'airbase-swap',ctx,live).valid);
  const wrong=clone(ctx);wrong.targetItemId=9;assert.equal(observeControls(s,'airbase-swap',wrong,live).valid,false);
  s.airbase.slots[3].state=2;assert.equal(observeControls(s,'airbase-swap',ctx,live).valid,false);s.airbase.slots[3].state=1;
  s.airbase.slots[2].itemId=8;s.airbase.slots[3].itemId=7;
  live.info.airbase[0].api_plane_info[2].api_slotid=8;live.info.airbase[0].api_plane_info[3].api_slotid=7;
  assert(observeControls(s,'airbase-swap-done',ctx,live).valid);
  live.info.airbase[0].api_plane_info[2].api_state=2;assert.equal(observeControls(s,'airbase-swap-done',ctx,live).valid,false);
});

test('base warehouse selection pins the instance, current page, full base and relocation data',async()=>{
  const action=button('airbase.slot.4',{area:6,base:3,slot:4}),row=button('airbase.row.1',{area:6,base:3,slot:4,row:1}),
    commit=button('airbase.confirm',{area:6,base:3,slot:4,itemId:7});
  const slots=[{slotId:1,itemId:0,state:0},{slotId:2,itemId:0,state:0},{slotId:3,itemId:5,state:1},{slotId:4,itemId:0,state:0,control:action}];
  const s={version:1,valid:true,blocked:false,scene:'airbase',controls:[action],airbase:{phase:'base',area:6,base:3,mode:2,slot:4,slots}};
  const live={airbaseSync:{complete:true,relocationsComplete:true},info:{ships:{},equips:{7:{api_slotitem_id:3}},airbaseRelocations:[],
    airbase:[{api_area_id:6,api_rid:3,api_plane_info:slots.map(z=>({api_squadron_id:z.slotId,api_slotid:z.itemId,api_state:z.state}))}]},
    const:{$equips:{3:{api_type:[0,0,48]}}}};
  const context={area:6,base:3,mode:2,slot:4,itemId:7,beforeSlots:slots.map(({slotId,itemId,state})=>({slotId,itemId,state}))};
  const observer=new ControlObserver({readControls:async()=>s,getStore:()=>live});await observer.start();
  assert((await observer.read('airbase-slot',context)).valid);
  assert.deepEqual(await observer.prepareInput({x:100,y:200,kind:'click',controlId:'airbase.slot.4'}),action.point);
  Object.assign(s.airbase,{phase:'picker',page:1,category:1,sourceIds:[6,7],rows:[{}, {itemId:7,expectedId:7,control:row}],pages:[],categories:[]});s.controls=[row];
  const transitioning=clone(s);transitioning.airbase.sourceIds=[7,10,11,12,13,14,15,16,17,18];
  assert.equal(observeControls(transitioning,'airbase-catalog',context,live).valid,false);
  transitioning.airbase.pages=[button('airbase.page.2',{page:2})];
  assert(observeControls(transitioning,'airbase-catalog',context,live).valid);
  const rowContext={...context,category:1,page:1,row:1};assert((await observer.read('airbase-row',rowContext)).valid);
  assert.deepEqual(await observer.prepareInput({x:100,y:200,kind:'click',controlId:'airbase.row.1'}),row.point);
  Object.assign(s.airbase,{phase:'confirm',itemId:7,commit});s.controls=[commit];
  const mutation={path:'api_req_air_corps/set_plane',area:6,base:3,slot:4,item:7};
  await assert.rejects(observer.prepareInput({x:100,y:200,kind:'click',controlId:'airbase.confirm',mutation}),/precondition/);
  assert((await observer.read('airbase-selection',context)).valid);
  assert.deepEqual(await observer.prepareInput({x:100,y:200,kind:'click',controlId:'airbase.confirm',mutation}),commit.point);
  live.info.airbaseRelocations=[{itemId:7}];await assert.rejects(observer.prepareInput({x:100,y:200,kind:'click',controlId:'airbase.confirm',mutation}),/precondition/);
  live.info.airbaseRelocations=[];live.airbaseSync.relocationsComplete=false;
  assert.equal((await observer.read('airbase-selection',context)).valid,false);
  live.airbaseSync.relocationsComplete=true;live.airbaseSync.complete=false;
  const verified={...context,verifiedInventory:require('../../src/domain/fleet/land_base_inventory').baseInventory(live.info)};
  assert((await observer.read('airbase-selection',verified)).valid);
  live.info.airbase[0].api_plane_info[0].api_state=2;
  assert.equal((await observer.read('airbase-selection',verified)).valid,false);
});

test('base replacement pins the old aircraft and confirms relocation and the new state',()=>{
  const control=button('airbase.slot.1',{slot:1}),slots=[{slotId:1,itemId:5,state:1,control},
    ...[2,3,4].map(slotId=>({slotId,itemId:0,state:0}))];
  const s={version:1,valid:true,blocked:false,scene:'airbase',controls:[control],airbase:{phase:'base',area:6,base:1,mode:1,slots}};
  const live={airbaseSync:{complete:true,relocationsComplete:true},info:{ships:{},equips:{7:{api_slotitem_id:3}},airbaseRelocations:[],
    airbase:[{api_area_id:6,api_rid:1,api_plane_info:slots.map(row=>({api_squadron_id:row.slotId,api_slotid:row.itemId,api_state:row.state}))}]},
    const:{$equips:{3:{api_type:[0,0,47]}}}};
  const ctx={area:6,base:1,mode:1,slot:1,itemId:7,beforeSlots:slots.map(({slotId,itemId,state})=>({slotId,itemId,state}))};
  assert(observeControls(s,'airbase-slot',ctx,live).valid);
  slots[0].state=2;assert.equal(observeControls(s,'airbase-slot',ctx,live).valid,false);slots[0].state=1;
  Object.assign(slots[0],{itemId:7,state:2});Object.assign(live.info.airbase[0].api_plane_info[0],{api_slotid:7,api_state:2});
  assert.equal(observeControls(s,'airbase-stock-done',ctx,live).valid,false);
  live.info.airbaseRelocations=[{itemId:5}];assert.deepEqual(observeControls(s,'airbase-stock-done',ctx,live),{valid:true,state:2});
  slots[0].state=1;assert.equal(observeControls(s,'airbase-stock-done',ctx,live).valid,false);
});

test('navigation readiness requires a unique enabled destination and exposes moving coordinates for stability checks',()=>{
  const s=equipment('base');s.controls=[button('navigate.organization',{enabled:false})];
  assert.equal(observeControls(s,'navigation',{destination:'organization'},store).valid,false);
  s.controls[0].enabled=true;assert.deepEqual(observeControls(s,'navigation',{destination:'organization'},store),{valid:true,point:{x:100,y:200}});
  s.controls[0].point.x=101;assert.equal(observeControls(s,'navigation',{destination:'organization'},store).point.x,101);
  s.controls.push(clone(s.controls[0]));assert.equal(observeControls(s,'navigation',{destination:'organization'},store).valid,false);
  assert.equal(observeControls(s,'navigation',{destination:'unknown'},store).valid,false);
});

test('control navigation waits for each destination before input while image navigation keeps its existing protocol',async()=>{
  const {enterScreen}=require('../../src/execution/navigation');
  for(const controlMode of [true,false]){
    let mode='equipment',ready=null;const events=[];
    const session={controlMode,check(){},onProgress(){},until:async(kind,arg)=>{
      events.push(kind);if(kind==='navigation'){ready=arg.destination;return {valid:true,point:{x:10,y:20}};}
      return {valid:true,mode};
    },input:async(x,y,m,k,options)=>{const next=options.controlId.split('.').at(-1);if(controlMode)assert.equal(ready,next);mode=next;ready=null;}};
    await enterScreen(session,'organization');assert.equal(mode,'organization');
    assert.equal(events.filter(e=>e==='navigation').length,controlMode?2:0);
  }
});
test('control observations verify exact equipment instance, page, owner and category, including expansion slots',()=>{
  const s=equipment();
  assert(observeControls(s,'equippicker',{shipId:11,slot:0},store).valid);
  assert(observeControls(s,'rowicon',context,store).valid);
  for(const change of [s=>s.equipment.rows[0].itemId=8,s=>s.equipment.rows[0].expectedId=8,s=>s.equipment.rows[0].sourceShip=22,
    s=>s.equipment.rows[0].isExpedition=true,s=>s.equipment.rows[0].isSortie=true,s=>s.equipment.rows[0].unset=true,
    s=>s.equipment.rows[0].control.enabled=false,s=>s.equipment.page.activePage=2,s=>s.equipment.filterDetail=-1,s=>s.equipment.shipId=12,
    s=>s.blocked=true,s=>s.version=2]){
    const bad=clone(s);change(bad);assert.equal(observeControls(bad,'rowicon',context,store).valid,false);
  }
  s.equipment.slot=-1;assert(observeControls(s,'rowicon',{...context,slot:-1},store).valid);
  assert.equal(observeControls(s,'rowicon',context,store).valid,false);
});
test('empty equipment list allows only a verified source switch and requires the exact fleet, ship and slot',async()=>{
  let s=equipment(),toggle=button('equipment.mode');
  Object.assign(s.equipment,{sourceCount:0,sourceIds:[],rows:[],page:{valid:false,labels:[],activePage:1},modeControl:toggle});s.controls=[toggle];
  const arg={fleet:1,shipId:11,slot:0},view=observeControls(s,'equipview',arg,store);
  assert.equal(view.valid,true);assert.equal(view.empty,true);assert.equal(view.mode,'stock');
  assert.equal(observeControls(s,'equippicker',arg,store).valid,false,'empty list never authorizes a selection');
  assert.equal(observeControls(s,'rowicon',context,store).valid,false);
  for(const change of [s=>s.fleet=2,s=>s.shipId=12,s=>s.equipment.slot=1,s=>s.equipment.phase='confirm',
    s=>s.equipment.sourceCount=1,s=>s.equipment.sourceIds=[7],s=>s.equipment.rows=[{visible:true,itemId:7}],
    s=>s.equipment.modeControl.enabled=false,s=>s.equipment.modeControl.rendered=false,s=>s.equipment.modeControl.id='wrong',
    s=>s.controls[0].rendered=false,s=>s.controls.push({...s.controls[0]}),
    s=>s.equipment.filterDetail=-1,s=>s.equipment.page.activePage=2,s=>s.blocked=true]){
    const bad=clone(s);change(bad);assert.equal(observeControls(bad,'equipview',arg,store).valid,false);
  }
  const observer=new ControlObserver({getStore:()=>store,readControls:async()=>clone(s)});
  assert((await observer.read('equipview',arg)).valid);
  s.equipment.slot=1;
  await assert.rejects(observer.prepareInput({x:100,y:200,kind:'click',controlId:'equipment.mode'}),/not confirmed/);
  s.equipment.slot=0;assert((await observer.read('equipview',arg)).valid);s.equipment.mode=1;
  await assert.rejects(observer.prepareInput({x:100,y:200,kind:'click',controlId:'equipment.mode'}),/not confirmed/);
  s.equipment.mode=0;
  s.equipment.slot=0;assert((await observer.read('equipview',arg)).valid);
  assert.deepEqual(await observer.prepareInput({x:100,y:200,kind:'click',controlId:'equipment.mode'}),{x:100,y:200});
});
test('equipment details and borrowed confirmation require the selected instance and enabled native button',()=>{
  for(const phase of ['confirm','borrow']){
    const s=equipment(phase);if(phase==='borrow'){s.equipment.mode=1;s.equipment.sourceShip=22;s.equipment.commit.sourceShip=22;}
    const arg={...context,purpose:'equipment-confirm',sourceShipId:phase==='borrow'?22:null},kind=phase==='borrow'?'borrowconfirm':'pix';
    assert(observeControls(s,kind,arg,store).valid);
    for(const change of [s=>s.equipment.itemId=8,s=>s.equipment.commit.enabled=false,s=>s.equipment.sourceShip=99,s=>s.equipment.slot=1]){
      const bad=clone(s);change(bad);assert.equal(observeControls(bad,kind,arg,store).valid,false);
    }
  }
  assert.equal(observeControls(equipment('confirm'),'pix',{},store).valid,false,'generic pixels cannot authorize control-mode commits');
});
test('organization confirms destination fleet, slot, selected instance and disabled grey controls',()=>{
  const s={version:1,valid:true,blocked:false,scene:'organization',fleet:1,organization:{phase:'confirm',selectedShip:55,confirmFleet:1,confirmSlot:2,commit:button('organization.confirm')}};
  const arg={fleet:1,slot:2,shipId:55};assert(observeControls(s,'cardidentity',arg,store).valid);
  for(const field of ['selectedShip','confirmFleet','confirmSlot']){const bad=clone(s);bad.organization[field]=99;assert.equal(observeControls(bad,'cardidentity',arg,store).valid,false);}
  s.organization.commit.enabled=false;assert.equal(observeControls(s,'cardidentity',arg,store).valid,false);
});
test('native input mutation roles cannot be used without the exact expected operation',()=>{
  const s=equipment('confirm'),c=s.equipment.commit;
  assert.equal(matchesMutation(c,undefined,s),false);
  assert(matchesMutation(c,{path:'api_req_kaisou/slotset',ship:11,j:0,item:7},s));
  for(const m of [{path:'wrong',ship:11,j:0,item:7},{path:'api_req_kaisou/slotset',ship:12,j:0,item:7},{path:'api_req_kaisou/slotset',ship:11,j:1,item:7},{path:'api_req_kaisou/slotset',ship:11,j:0,item:8}])assert.equal(matchesMutation(c,m,s),false);
  assert.equal(matchesMutation(button('equipment.borrow'),undefined,s),false);
  assert.equal(matchesMutation(button('organization.clear'),undefined,s),false);
});
test('each control input re-reads the current tree and refuses stale rows, hidden controls and ambiguous targets',async()=>{
  let snapshot=equipment(),reads=0;
  const host={getStore:()=>store,readControls:async()=>{reads++;return clone(snapshot);}};
  const o=new ControlObserver(host);await o.start();assert((await o.read('rowicon',context)).valid);
  const input={x:100,y:200,kind:'click',controlId:'equipment.row.0'};
  assert.deepEqual(await o.prepareInput(input),{x:100,y:200});assert.equal(reads,2);
  snapshot.equipment.rows[0].itemId=8;await assert.rejects(o.prepareInput(input),/Unique enabled control/);
  snapshot=equipment();snapshot.controls[0].enabled=false;await assert.rejects(o.prepareInput(input),/Unique enabled control/);
  snapshot=equipment();snapshot.controls.push(clone(snapshot.controls[0]));await assert.rejects(o.prepareInput(input),/Unique enabled control/);
  snapshot=equipment();snapshot.blocked=true;await assert.rejects(o.prepareInput(input),/not ready/);
});
test('borrow submission rechecks the live source slot and cannot take a different instance',async()=>{
  const snapshot=equipment('borrow');snapshot.equipment.mode=1;snapshot.equipment.sourceShip=22;snapshot.equipment.commit.sourceShip=22;
  const host={getStore:()=>clone(store),readControls:async()=>clone(snapshot)},o=new ControlObserver(host);
  const mutation={path:'api_req_kaisou/slot_deprive',ship:11,j:0,slotKind:0,sourceShip:22,sourceJ:0,sourceKind:0};
  assert.deepEqual(await o.prepareInput({x:100,y:200,kind:'click',mutation}),{x:100,y:200});
  await assert.rejects(o.prepareInput({x:100,y:200,kind:'click',mutation:{...mutation,sourceJ:1}}),/source instance changed/);
});
test('Session control mode uses fresh readings and stable observations without calling capture or the image worker',async()=>{
  let reads=0,inputs=0,time=0;
  const snapshot={version:1,valid:true,blocked:false,scene:'home',controls:[button('navigate.organization')]};
  const host={getStore:()=>store,check(){},cancel(){},readControls:async()=>{reads++;time+=5;return clone(snapshot);},
    capture(){assert.fail('Control mode must not capture screenshots');},input:async p=>{inputs++;assert.equal(p.x,100);assert.equal(p.y,200);}};
  const o=new ControlObserver(host),s=new Session(host,o,{now:()=>time});s.wait=async ms=>{time+=ms;};
  await s.until('screen',{});assert.equal(reads,2);assert.equal(s.metrics.captures,0);assert.equal(s.metrics.controlReads,2);
  await s.input(292,202,undefined,'click',{settleMs:0,controlId:'navigate.organization'});assert.equal(reads,3);assert.equal(inputs,1);
  s.stop();await assert.rejects(s.input(1,1),/stopped/);assert.equal(inputs,1);
});

test('control cadence preserves fresh stability checks, resets after invalid reads and adds the player wait',async()=>{
  let time=0,reads=0,inputs=0;const waits=[],values=[false,false,true,true];
  const host={check(){},cancel(){},input:async()=>{inputs++;}};
  const observer={read:async()=>{time+=5;reads++;return {valid:values.shift()??true};},prepareInput:async()=>({x:10,y:20})};
  const session=new Session(host,observer,{now:()=>time,operationWaitMs:300});
  session.wait=async ms=>{waits.push(ms);time+=ms;};
  await session.until('screen',{});assert.equal(reads,4);assert.deepEqual(waits,[40,60,35]);
  waits.length=0;await session.input(10,20);await session.input(10,20,undefined,'click',{settleMs:0});
  assert.deepEqual(waits,[340,300]);assert.equal(inputs,2);
  values.push(true,false,true,true);reads=0;waits.length=0;
  await session.until('screen',{});assert.equal(reads,4,'an invalid read breaks the previous stable pair');
  assert.deepEqual(waits,[35,40,35]);
});

function treeFixture(){
  const matrix={a:1,b:0,c:0,d:1,tx:0,ty:0};
  const node=(props={},kids=[])=>{const n={visible:true,alpha:1,renderable:true,transform:{worldTransform:{...matrix}},children:kids,...props};for(const c of kids)c.parent=n;return n;};
  const hit=(x,y,w=20,h=20)=>node({interactive:true,_events:{pointerup:{}},hitArea:{x,y,width:w,height:h}});
  const slot=()=>{const click=hit(525,248,318,47),sprite=node({_texture:{orig:{width:15,height:15}},_anchor:{_x:0,_y:0},transform:{worldTransform:{...matrix,tx:817,ty:263}}});
    const detach=node({interactive:true,_events:{pointerup:{}},slotIconDelete:sprite},[sprite]);return node({_index:0,_clickAreaSlot:click,_detachButton:detach},[click,detach]);};
  const row=slot(),box=node({_slotItemSlots:[row]},[row]),detail=node({_slotItemSlotBox:box,_textLevel:{_text:'50'}},[box]);
  const select=node({_deck_id:1,_mem_ship_id:11}),equipment=node({_shipDetail:detail,_selectShipView:select},[detail,select]);
  const content=node({},[equipment]),ring=node({visible:false}),side=node({_btn_organize:hit(0,194,63,70),_btn_remodel:hit(0,356,63,70)});side.children=[side._btn_organize,side._btn_remodel];for(const c of side.children)c.parent=side;
  const option=node({visible:false}),circleContent=node({_hit_area:hit(0,0,120,120)});circleContent.children=[circleContent._hit_area];circleContent._hit_area.parent=circleContent;
  const circle=node({_content:circleContent},[circleContent]);
  const port=node({_contentLayer:content,_sideMenu:side,_ringMenu:ring,_circle:circle,_option:option},[content,side,ring,circle,option]);
  const guard=node({visible:false,interactive:true}),over=node(),map=node({visible:false}),root=node({_portMain:port,_mapLayer:map,_clickGuard:guard,_overLayer:over},[port,map,guard,over]),stage=node({},[root]);
  const canvas={isConnected:true,getBoundingClientRect:()=>({width:1200,height:720})};
  const sandbox={PIXI:{ticker:{shared:{_head:{context:{renderer:{view:canvas,_lastObjectRendered:stage}}}}}},document:{querySelector:()=>canvas},performance:{timeOrigin:123},getComputedStyle:()=>({display:'block',visibility:'visible'})};
  const read=()=>JSON.parse(JSON.stringify(vm.runInNewContext('('+readControlSnapshot.toString()+')()',sandbox)));
  return {node,hit,read,root,stage,port,content,ring,side,row,detail,guard,over,equipment,select};
}
test('reader and observer recognize an empty native equipment list without accepting a row',()=>{
  const f=treeFixture(),mode=f.hit(1100,150,70,35),pager=f.node({focusIndex:0,pageCount:0,textChanges:[],buttonChanges:[]});
  const filter=f.node({_slotItemFilterButton:f.hit(800,150)},[]);filter.children=[filter._slotItemFilterButton];filter._slotItemFilterButton.parent=filter;
  const list=f.node({_slotItemFilterView:filter,_pagerView:pager,_listItems:[],_changeListSwitch:mode},[filter,pager,mode]);
  const task=f.node({_slotitemlist:list,_memory:{mode:0,filter:0,filter_detail:0,slotItemPage:0},
    _sourceSlotItems:[],_mem_ship_id:11,_slot_index:0},[list]);
  f.equipment._taskChoiceSlotItem=task;f.equipment.children.push(task);task.parent=f.equipment;
  const snapshot=f.read(),arg={fleet:1,shipId:11,slot:0};
  assert.equal(snapshot.equipment.phase,'picker');assert.equal(snapshot.equipment.sourceCount,0);
  assert.equal(snapshot.equipment.page.valid,false);assert.equal(snapshot.equipment.page.activePage,1);
  assert.equal(observeControls(snapshot,'equipview',arg,store).empty,true);
  assert.equal(observeControls(snapshot,'equippicker',arg,store).valid,false);
  assert.equal(observeControls(snapshot,'rowicon',context,store).valid,false);
});
test('frame reader follows reciprocal parents, actual transforms and original detach sprites without executing getters',()=>{
  const f=treeFixture();let getters=0;Object.defineProperty(f.equipment,'unsafe',{get(){getters++;throw Error('No game getters');}});
  const s=f.read();assert(s.valid);assert.equal(s.scene,'equipment');assert.equal(s.equipment.level,50);assert.equal(getters,0);
  const c=s.equipment.slots[0].detach;assert.equal(c.enabled,true);assert.deepEqual(c.point,{x:824.5,y:270.5});
  f.row.visible=false;assert.equal(f.read().equipment.slots[0].detach.enabled,false);
  f.row.visible=true;f.row.parent.children=[];assert.equal(f.read().equipment.slots[0].detach.enabled,false);
});

test('animated, transformed and unknown clipping masks cannot authorize a covered input point',()=>{
  const f=treeFixture(),hit=f.hit(776,555.5,72,28),row=f.node({_filter:13},[hit]);
  const mask=f.node({graphicsData:[{shape:{x:0,y:0,width:1200,height:200}}]});mask.renderable=false;
  const menu=f.node({_slotItemFilterListItems:[row],_list_mask:mask,_mask:mask},[row,mask]);
  const guard=f.node(),filter=f.node({_list_area_guard:guard,_slotItemFilterList:menu},[guard,menu]);
  const list=f.node({_slotItemFilterView:filter},[filter]);
  f.equipment._taskChoiceSlotItem={_slotitemlist:list,_memory:{mode:0}};f.equipment.children.push(list);list.parent=f.equipment;
  const target=()=>f.read().equipment.categories[0].control;
  let c=target();assert.equal(c.unclipped,false);assert.equal(c.enabled,false);
  mask.graphicsData[0].shape.height=700;c=target();
  assert.equal(c.unclipped,true);assert(c.enabled,'a revealed point remains usable through a non-renderable mask');
  mask.transform.worldTransform={a:2,b:0,c:0,d:2,tx:0,ty:0};mask.graphicsData[0].shape.width=500;
  assert(target().enabled,'mask coordinates use the inverse world transform');
  mask.graphicsData=[];assert.equal(target().enabled,false);
});

test('a covered preferred category waits instead of falling back to the exposed all-equipment row',()=>{
  const s=equipment('category');s.equipment.categories=[{id:0,control:button('equipment.category.0',{unclipped:true})},
    {id:13,control:button('equipment.category.13',{unclipped:false,enabled:false})}];
  assert.equal(observeControls(s,'cells',{categoryId:13},store).valid,false);
  s.equipment.categories[1].control.unclipped=true;s.equipment.categories[1].control.enabled=true;
  assert(observeControls(s,'cells',{categoryId:13},store).valid);
  s.equipment.categories.pop();assert(observeControls(s,'cells',{categoryId:13},store).valid,'a genuinely missing category may use the existing fallback');
});
test('transparent input guards, unknown overlays, hidden home UI and detached prebuilt panels fail closed',()=>{
  const f=treeFixture();f.guard.visible=true;f.guard.alpha=0;assert.equal(f.read().valid,false);
  f.guard.visible=false;const popup=f.node({},[f.hit(1,1)]);popup.parent=f.over;f.over.children=[popup];assert.equal(f.read().valid,false);
  f.over.children=[];f.content.children=[];assert.equal(f.read().valid,false);
  f.ring.visible=true;assert.equal(f.read().scene,'home');assert(!f.read().controls.some(c=>c.id==='navigate.home'),'home hide-UI circle is never a return button');
  f.port._only_furniture=true;assert.equal(f.read().valid,false);
  f.port._only_furniture=false;f.content.children=[f.equipment];f.equipment.parent=f.content;
  f.equipment._taskChoiceSlotItem={_change_confirm:f.node({visible:true}),_slotitemlist:f.node({visible:true})};
  assert.equal(f.read().equipment.phase,'base','detached prebuilt dialogs are not open');
  f.port._option.visible=true;f.port._option._opened=false;assert(f.read().valid,'the permanent settings launcher is not an open modal');
  f.port._option._opened=true;assert.equal(f.read().valid,false);
});

for(const kind of ['organization-picker','equipment-picker'])test(kind+' exposes home only while the native circle is above its content and unobstructed',()=>{
  const f=treeFixture(),circle=f.port._circle,button=circle._content._hit_area;
  if(kind==='organization-picker'){
    const view=f.node(),organization=f.node({_onClickShipChange:()=>{},deckLayer:{},taskChangeShip:{taskChoiceShip:{shipChoiceView:view}}},[view]);
    f.content.children=[organization];organization.parent=f.content;
  }else{
    const list=f.node();f.equipment._taskChoiceSlotItem={_slotitemlist:list,_memory:{mode:0}};
    f.equipment.children.push(list);list.parent=f.equipment;
  }
  const home=s=>s.controls.some(c=>c.id==='navigate.home'&&c.enabled);
  let s=f.read();assert(s.valid);assert(home(s),'an unobstructed native button is available');
  circle.renderable=false;s=f.read();assert(!s.valid||!home(s),'an unrendered native circle cannot authorize input');circle.renderable=true;
  button.interactive=false;s=f.read();assert(!s.valid||!home(s),'a disabled native button cannot authorize input');button.interactive=true;
  const mask=f.node({graphicsData:[]});circle._mask=mask;mask.parent=f.port;f.port.children.push(mask);
  s=f.read();assert(!s.valid||!home(s),'an unknown mask cannot authorize input');delete circle._mask;f.port.children.pop();
  f.root._mapLayer.visible=true;s=f.read();assert(!s.valid||!home(s),'a rendered map layer above port can cover the circle');f.root._mapLayer.visible=false;
  f.port.children=f.port.children.filter(c=>c!==f.content);f.port.children.push(f.content);
  s=f.read();assert(!s.valid||!home(s),'content above the circle may intercept its click');
  f.port.children=f.port.children.filter(c=>c!==circle);f.port.children.push(circle);
  const popup=f.node();popup.parent=f.over;f.over.children=[popup];s=f.read();
  assert(!s.valid||!home(s),'unknown global overlays must block the home button');
});

test('a known global equipment borrow confirmation cannot authorize the covered home button',()=>{
  const f=treeFixture(),list=f.node(),borrow=f.node({buttonYes:f.hit(400,400),buttonNo:f.hit(700,400)});
  borrow.children=[borrow.buttonYes,borrow.buttonNo];for(const c of borrow.children)c.parent=borrow;
  f.equipment._taskChoiceSlotItem={_slotitemlist:list,_changeConfirmFromOtherShip:borrow,_memory:{mode:1}};
  f.equipment.children.push(list);list.parent=f.equipment;f.over.children=[borrow];borrow.parent=f.over;
  const s=f.read();assert.equal(s.equipment.phase,'borrow');
  assert(!s.controls.some(c=>c.id==='navigate.home'&&c.enabled),'borrow modal is above the circle');
});

test('only the native quest poster can expose its dismiss control and other overlays remain blocking',()=>{
  const f=treeFixture(),view=f.node({_list:{},_tab:{},_back_btn:{},_pager:{}}),quest=f.node({_view:view},[view]);
  quest.parent=f.content;f.content.children=[quest];
  const sprite=f.node({_texture:{textureCacheIds:['duty_poster_1']}}),poster=f.hit(0,0,1200,720);
  poster.children=[sprite];sprite.parent=poster;poster.parent=f.over;f.over.children=[poster];
  const snapshot=f.read();assert(snapshot.valid);assert.equal(snapshot.scene,'quest-welcome');
  assert.deepEqual(snapshot.controls.map(c=>c.id),['quest.welcome.dismiss']);
  assert.deepEqual(snapshot.controls[0].point,{x:600,y:360});
  const other=f.node();other.parent=f.over;f.over.children.push(other);assert.equal(f.read().valid,false);
  f.over.children.pop();sprite._texture.textureCacheIds=['unrelated'];assert.equal(f.read().valid,false);
  sprite._texture.textureCacheIds=['duty_poster_1'];delete view._pager;assert.equal(f.read().valid,false);
  view._pager={};poster.hitArea.width=1190;assert.equal(f.read().valid,false);
  poster.hitArea.width=1200;poster.interactive=false;assert.equal(f.read().valid,false);
  poster.interactive=true;f.over.children=[];const plain=f.read();assert(plain.valid);assert.equal(plain.scene,'other');
  assert(plain.controls.some(c=>c.id==='navigate.home'&&c.enabled));
});

test('only the attached and rendered native expedition alert interrupts, including above unknown overlays',()=>{
  const f=treeFixture(),alert=f.node({visible:false,_activated:true});f.port._expedition_alert=alert;alert.parent=f.port;f.port.children.push(alert);
  assert.equal(f.read().interruption,undefined,'a prebuilt hidden alert is normal');
  alert.visible=true;const popup=f.node();popup.parent=f.over;f.over.children=[popup];
  const s=f.read();assert.equal(s.interruption,'expedition-return');assert.equal(s.valid,false);assert.equal(s.blocked,true);
  alert._activated=false;assert.equal(f.read().interruption,undefined);alert._activated=true;
  alert.renderable=false;assert.equal(f.read().interruption,undefined);
  alert.renderable=true;alert.alpha=0;assert.equal(f.read().interruption,undefined);
  alert.alpha=1;alert.parent=f.node();assert.equal(f.read().interruption,undefined,'detached objects cannot interrupt');
});

test('late control readings and inputs are rejected after stop',async()=>{
  let finish;const host={getStore:()=>store,readControls:()=>new Promise(r=>{finish=r;})},observer=new ControlObserver(host);
  const read=observer.read('rowicon',context);await observer.dispose();finish(equipment());await assert.rejects(read,/stopped/);
  await observer.start();const input=observer.prepareInput({x:100,y:200,kind:'click'});await observer.dispose();finish(equipment());await assert.rejects(input,/stopped/);
});

test('empty and filled expansion slots use the dedicated click area, not a hidden detach child',()=>{
  const f=treeFixture(),click=f.hit(1104,452,57,57),detach=f.hit(1160,472,15,15),extra=f.node({clickArea:click,detachButton:detach},[click,detach]);
  f.detail._extraSlotItemSlot=extra;f.detail.children.push(extra);extra.parent=f.detail;
  assert.equal(f.read().equipment.extra.enabled,true);assert.equal(f.read().equipment.extraDetach.enabled,true);
  detach.visible=false;assert.equal(f.read().equipment.extra.enabled,true);assert.equal(f.read().equipment.extraDetach.enabled,false);
});

test('native subcategory lists retain their actual instance order and expose the primary category button',()=>{
  const f=treeFixture(),text=f.node({_text:'1'}),number=f.hit(725,666,30,30),pager=f.node({focusIndex:0,pageCount:1,textChanges:[text],buttonChanges:[number]},[text,number]);
  const primary=f.hit(790,150,50,30),secondary=f.hit(850,150,30,30);secondary.interactive=false;
  const filter=f.node({_slotItemFilterButton:primary,_slotItemFilterDetailButton:secondary},[primary,secondary]);
  const click=f.hit(555,195,667,45),row=f.node({memSlotItemId:7,itemType:0,clickArea:click},[click]);
  const list=f.node({_pagerView:pager,_slotItemFilterView:filter,_listItems:[row]},[pager,filter,row]);
  const task={_slotitemlist:list,_mem_ship_id:11,_slot_index:0,_memory:{mode:0,filter:3,filter_detail:1,slotItemPage:0},
    _sourceSlotItems:[{item:{_o:{api_id:7}},attached:null,isSortie:false,isExpedition:false,isUnset:false}],_setList:{equipped_ship:{}}};
  f.equipment._taskChoiceSlotItem=task;f.equipment.children.push(list);list.parent=f.equipment;
  const s=f.read();assert(s.valid);assert.equal(s.equipment.categoryControl.enabled,true);assert.deepEqual(s.equipment.page.itemIds,[7]);
  assert(observeControls(s,'equippicker',{shipId:11,slot:0},store).valid);
  task._slot_index=-1;delete task._memory.filter;delete task._memory.filter_detail;
  assert(observeControls(f.read(),'pageread',{layout:'equip',shipId:11,slot:-1},store).valid,'expansion lists have no category fields');
});

test('a visible unavailable expedition row cannot hide a different valid equipment row',async()=>{
  const f=treeFixture(),text=f.node({_text:'1'}),number=f.hit(725,666,30,30);
  const pager=f.node({focusIndex:0,pageCount:1,textChanges:[text],buttonChanges:[number]},[text,number]);
  const primary=f.hit(790,150,50,30),filter=f.node({_slotItemFilterButton:primary},[primary]);
  const ids=[8,9,10,11,12,13,14,7,15,16];
  const rows=ids.map((id,index)=>{
    const hit=f.hit(555,195+45*index,667,45);if(index<6)hit.interactive=false;
    return f.node({memSlotItemId:id,itemType:0,clickArea:hit},[hit]);
  });
  const list=f.node({_pagerView:pager,_slotItemFilterView:filter,_listItems:rows},[pager,filter,...rows]);
  const task={_slotitemlist:list,_mem_ship_id:11,_slot_index:0,_memory:{mode:1,filter:3,filter_detail:1,slotItemPage:0},
    _sourceSlotItems:ids.map((id,index)=>({item:{_o:{api_id:id}},attached:{_o:{api_id:index<6?33:22}},
      isSortie:false,isExpedition:index<6,isUnset:false})),
    _setList:{equipped_ship:{}}};
  f.equipment._taskChoiceSlotItem=task;f.equipment.children.push(list);list.parent=f.equipment;
  const data=clone(store);for(const id of ids)data.info.equips[id]={api_slotitem_id:1};
  const arg={...context,row:7,sourceShipId:22};
  const snapshot=f.read();
  assert.equal(snapshot.equipment.rows.filter(row=>!row.control.enabled).length,6,'the six remote expedition items have no clickable control');
  assert(observeControls(snapshot,'equippicker',{shipId:11,slot:0},data).valid,'the visible locked row still occupies its native list position');
  assert.deepEqual(snapshot.equipment.page.itemIds,ids,'unavailable rows remain in the native order');
  assert(observeControls(snapshot,'rowicon',arg,data).valid,'the unrelated available instance remains selectable');

  const unavailable=clone(snapshot);unavailable.equipment.rows[7].isExpedition=true;
  assert.equal(observeControls(unavailable,'rowicon',arg,data).valid,false,'never select equipment on an expedition');
  const disabled=clone(snapshot);disabled.equipment.rows[7].control.enabled=false;
  assert.equal(observeControls(disabled,'rowicon',arg,data).valid,false,'never select a disabled target');
  const mismatch=clone(snapshot);mismatch.equipment.rows[7].expectedId=8;
  assert.equal(observeControls(mismatch,'equippicker',{shipId:11,slot:0},data).valid,false,'visible rows must match the native list');
  assert.equal(observeControls(mismatch,'rowicon',arg,data).valid,false);
  const wrongLocked=clone(snapshot);wrongLocked.equipment.rows[0].expectedId=9;
  assert.equal(observeControls(wrongLocked,'equippicker',{shipId:11,slot:0},data).valid,false,'even an unavailable row must match the native list');
  const o=new ControlObserver({getStore:()=>data,readControls:async()=>f.read()});
  await o.start();assert((await o.read('rowicon',arg)).valid);
  const input={x:750,y:540,kind:'click',controlId:'equipment.row.7'};
  assert.deepEqual(await o.prepareInput(input),snapshot.equipment.rows[7].control.point);
  rows[7].clickArea.interactive=false;
  await assert.rejects(o.prepareInput(input),/Unique enabled control/,'a target disabled after observation must not be clicked');
  rows[7].clickArea.interactive=true;
  rows[0].visible=false;assert.equal(observeControls(f.read(),'equippicker',{shipId:11,slot:0},data).valid,false,'a hidden row cannot stand in for a visible list item');
  rows[0].visible=true;list.children=list.children.filter(child=>child!==rows[0]);
  assert.equal(observeControls(f.read(),'equippicker',{shipId:11,slot:0},data).valid,false,'a detached row cannot stand in for a visible list item');
});

test('switching recognition disposes the previous observer and warm runs bind the current host',async()=>{
  const created=[],starts=[],disposed=[];
  const c=new Controller({createObserver:(host,mode)=>{created.push(mode);return {start:h=>starts.push(h),dispose:()=>disposed.push(mode)};}});
  c.host={id:1};await c.startObserver('image');c.host={id:2};await c.startObserver('image');
  assert.deepEqual(created,['image']);assert.deepEqual(starts,[{id:1},{id:2}]);
  c.host={id:3};await c.startObserver('controls');assert.deepEqual(created,['image','controls']);assert.deepEqual(disposed,['image']);
  assert.deepEqual(starts.at(-1),{id:3});
  await assert.rejects(c.run('fleet',{}, {recognitionMode:'unknown'}),/Unsupported recognition mode/);
});

test('host control access pins both the unique game frame and document identity without capturing',async()=>{
  let checks=0,calls=0,documentId=1;
  const host=new PoiHost({window:{},remote:{}});host.check=()=>checks++;
  const frame={url:'https://example.invalid/kcs2/index.php',processId:1,routingId:2,executeJavaScript:async code=>{
    calls++;assert(code.includes('readControlSnapshot'));assert(!code.includes('fetch('));return {documentId,version:1,valid:true};}};
  host.wc={mainFrame:{framesInSubtree:[frame]}};
  await host.readControls();assert.equal(calls,1);assert.equal(checks,2);
  documentId=2;await assert.rejects(host.readControls(),/document changed/);
  documentId=1;frame.routingId=3;const before=calls;await assert.rejects(host.readControls(),/frame changed/);assert.equal(calls,before);
  host.wc.mainFrame.framesInSubtree=[frame,{...frame}];await assert.rejects(host.readControls(),/Unique game frame/);
});
