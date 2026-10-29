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
    rows:[{itemId:7,expectedId:7,sourceShip:null,unset:false,isSortie:false,isExpedition:false,control:row}],level:50,slots:[{visible:true},{visible:true}]}};
  s.equipment.commit=button(phase==='borrow'?'equipment.borrow':'equipment.confirm',{shipId:11,slot:0,itemId:7,sourceShip:null,mode:0});
  if(phase==='confirm'||phase==='borrow')s.controls=[s.equipment.commit];
  return s;
}
const store={info:{equips:{7:{api_slotitem_id:1}},ships:{11:{api_slot:[-1,-1]},22:{api_slot:[7,-1],api_slot_ex:0}}},const:{$equips:{1:{api_type:[0,0,1,10]}}}};
const context={shipId:11,slot:0,itemId:7,sourceShipId:null,page:1,row:0,t3:10};

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
  const option=node({visible:false}),circle=node({_hit_area:hit(0,0,120,120)});circle.children=[circle._hit_area];circle._hit_area.parent=circle;
  const port=node({_contentLayer:content,_sideMenu:side,_ringMenu:ring,_circle:{_content:circle},_option:option},[content,side,ring,circle,option]);
  const guard=node({visible:false,interactive:true}),over=node(),root=node({_portMain:port,_mapLayer:node(),_clickGuard:guard,_overLayer:over},[port,guard,over]),stage=node({},[root]);
  const canvas={isConnected:true,getBoundingClientRect:()=>({width:1200,height:720})};
  const sandbox={PIXI:{ticker:{shared:{_head:{context:{renderer:{view:canvas,_lastObjectRendered:stage}}}}}},document:{querySelector:()=>canvas},performance:{timeOrigin:123},getComputedStyle:()=>({display:'block',visibility:'visible'})};
  const read=()=>JSON.parse(JSON.stringify(vm.runInNewContext('('+readControlSnapshot.toString()+')()',sandbox)));
  return {node,hit,read,root,stage,port,content,ring,side,row,detail,guard,over,equipment,select};
}
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
