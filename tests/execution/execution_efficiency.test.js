'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Session}=require('../../src/execution/session');
const {PoiHost}=require('../../src/host/poi_host');
const {Observer}=require('../../src/vision/observers');
const {Pixels}=require('../../src/vision/pixels');
const {WorkerObserver}=require('../../src/vision/worker_observer');
const {createEquipmentGuard}=require('../../src/execution/equipment_guard');
const {restoreEquipment}=require('../../src/execution/equipment');

function fleetFixture(){
  const ships={},equips={},targets=[];
  for(let id=1;id<=6;id++){
    ships[id]={api_ship_id:1,api_lv:50,api_slot:[-1,-1,-1,-1],api_slot_ex:0};
    const slots=Array.from({length:4},(_,j)=>500+(id-1)*4+j);
    slots.forEach(i=>{equips[i]={api_slotitem_id:1,api_level:0,api_alv:0};});targets.push({id,slots});
  }
  const data={info:{ships,equips,fleets:[{api_ship:[1,2,3,4,5,6],api_mission:[0]}]},
    const:{$ships:{1:{api_name:'test',api_stype:2,api_slot_num:4}},$shipTypes:{2:{api_equip_type:{1:1}}},$equips:{1:{api_name:'gun',api_type:[0,0,1,1]}}}};
  return {data,scheme:{fleet:1,ships:targets}};
}

// Deterministic game model. It never loads Electron, screenshots a game, or
// sends traffic. Production Session + executor run unchanged against it.
function executionFixture(options={},SessionType=Session,execute=restoreEquipment){
  const f=fleetFixture(),inputs=[];let time=0,selected=1,view='base',fleet=options.initialFleet||1,cancelled=false,filteredHeader=!!options.filteredHeader;
  const page={valid:true,activePage:1,labels:[1],centers:[739]};
  const host={getStore:()=>f.data,check(){if(cancelled)throw Error('Run stopped');},cancel(){cancelled=true;},
    async capture(){return {selected,view,fleet,filteredHeader};},
    async input(input){inputs.push(input);
      if(input.x===222&&input.y===175)fleet=1;
      else if(input.x===824&&input.y===168)view='menu';
      else if(input.x===811&&input.y===197&&view==='menu'){filteredHeader=false;view='list';}
      else if(input.x===310)selected=1+(input.y-255)/75;
      else if(input.mutation){const m=input.mutation;assert.equal(m.ship,selected);assert.equal(m.path,'api_req_kaisou/slotset');f.data.info.ships[selected].api_slot[m.j]=m.item;view='base';}
      else if(input.x===750)view=view==='base'?'list':'confirm';
    }};
  const observer={async observe(kind,frame,arg={}){
    if(kind==='batch'){
      const results=[];for(const c of arg.checks)results.push(await this.observe(c.kind,frame,c.arg));
      if(options.finalPageDrift&&arg.checks.some(c=>c.kind==='rowicon'))results[1].page.activePage=2;
      return {valid:results.every(r=>r.valid),results};
    }
    if(kind==='screen')return {valid:frame.view==='base',mode:'equipment',...(!options.screenWithoutFleet?{fleet:frame.fleet}:{})};
    if(kind==='equipTabs')return {valid:frame.view==='base'&&(!arg.fleet||arg.fleet===frame.fleet),selected:[frame.fleet]};
    if(kind==='equipship')return {valid:frame.view==='base',level:50};
    if(kind==='equipmode')return {valid:frame.view==='list'&&!frame.filteredHeader,mode:frame.filteredHeader?null:'stock'};
    if(kind==='cells')return {valid:frame.view==='menu'&&!options.badReset,categories:[options.badReset?null:0],centers:[{x:811,y:197}]};
    if(kind==='equippicker')return {valid:frame.view==='list',category:0,page:{...page}};
    if(kind==='rowicon')return {valid:frame.view==='list'&&!options.badRow};
    if(kind==='pix')return {valid:frame.view==='confirm'};
    throw Error('Unexpected observation: '+kind);
  }};
  const session=new SessionType(host,observer,{now:()=>time});
  session.wait=async ms=>{session.check(false);time+=ms;session.check(false);};
  return {...f,session,inputs,clock:()=>time,run:()=>execute(session,f.scheme)};
}

test('six-ship four-slot fitting preserves exact instances with at most 158 captures',async()=>{
  const f=executionFixture(),result=await f.run();
  assert.equal(result.changed,24);
  assert.equal(f.inputs.filter(i=>i.mutation).length,24);
  for(const ship of f.scheme.ships)assert.deepEqual(f.data.info.ships[ship.id].api_slot,ship.slots);
  assert.equal(f.session.metrics.captures,158);
  assert.equal(f.session.metrics.observationsByKind.batch.calls,72);
  assert(f.session.metrics.checks<600,'full state scans must not run inside every timer/promise check');
});
test('an unverified row never reaches any equipment mutation',async()=>{
  const f=executionFixture({badRow:true});await assert.rejects(f.run(),/timed out: batch/);
  assert(!f.inputs.some(i=>i.mutation));
});
test('navigation fleet metadata still switches an incorrect fleet before fitting',async()=>{
  const f=executionFixture({initialFleet:2});await f.run();
  assert.equal(f.inputs.filter(i=>i.x===222&&i.y===175).length,1);
  assert.equal(f.inputs.filter(i=>i.mutation).length,24);
});
test('missing navigation fleet metadata retains an independent tab check',async()=>{
  const f=executionFixture({screenWithoutFleet:true});await f.run();
  assert.equal(f.session.metrics.captures,160);
  assert(!f.inputs.some(i=>i.x===222&&i.y===175));
});
test('a recognized list resets its unreadable mode without spending six seconds timing out',async()=>{
  const ordinary=executionFixture();await ordinary.run();
  const reset=executionFixture({filteredHeader:true});await reset.run();
  assert.equal(reset.inputs.filter(i=>i.x===824&&i.y===168).length,1);
  assert(reset.clock()-ordinary.clock()<2000);
  for(const ship of reset.scheme.ships)assert.deepEqual(reset.data.info.ships[ship.id].api_slot,ship.slots);
});
test('an unreadable reset menu stops after one opening and before all mutations',async()=>{
  const f=executionFixture({filteredHeader:true,badReset:true});
  await assert.rejects(f.run(),/分类菜单不可操作/);
  assert.equal(f.inputs.filter(i=>i.x===824&&i.y===168).length,1);
  assert(!f.inputs.some(i=>i.mutation));
});
test('a page change at the final row gate stops without submitting equipment',async()=>{
  const f=executionFixture({finalPageDrift:true});await assert.rejects(f.run(),/timed out: batch/);
  assert(!f.inputs.some(i=>i.mutation));
});
test('waits use lightweight checks; a state change before input still prevents input',async()=>{
  let validations=0,inputs=0,changed=false;
  const s=new Session({check(){},cancel(){},input:async()=>{inputs++;}},{observe:async()=>({valid:true})});
  s.validate=()=>{validations++;if(changed)throw Error('external change');};
  await s.wait(1);assert.equal(validations,0);
  changed=true;await assert.rejects(s.input(1,1),/external change/);assert.equal(inputs,0);
});
test('changes during a screenshot are rejected before accepting its observation',async()=>{
  let changed=false;
  const s=new Session({check(){},cancel(){},capture:async()=>{changed=true;return Buffer.from('frame');}},
    {observe:async()=>({valid:true})});
  s.validate=()=>{if(changed)throw Error('external change');};
  await assert.rejects(s.until('x',{}),/external change/);
});
test('navigation retains two-frame stability; explicit final gates can accept one valid frame',async()=>{
  for(const stableFrames of [1,2]){
    const s=new Session({check(){},cancel(){},capture:async()=>Buffer.from('frame')},{observe:async()=>({valid:true})});
    s.wait=async()=>{};await s.until('pix',{},undefined,6000,{stableFrames});
    assert.equal(s.metrics.captures,stableFrames);
  }
});
test('lightweight host checks avoid remote discovery but never ignore lifecycle invalidation',()=>{
  let reads=0;
  const h=Object.assign(Object.create(PoiHost.prototype),{closed:false,error:null,owned:true,
    wc:{id:1,isDestroyed:()=>false,debugger:{isAttached:()=>true}},discover(){reads++;return {id:2};}});
  h.check(false);assert.equal(reads,0);assert.throws(()=>h.check(),/target changed/);
  h.error='Game target reloaded or closed';assert.throws(()=>h.check(false),/reloaded/);
});
test('equipment boundary guard reads once and detects in-place inventory, donor and fleet changes',()=>{
  const f=fleetFixture();let reads=0;
  const guard=createEquipmentGuard(()=>{reads++;return f.data;});
  reads=0;guard.validate(new Set());assert.equal(reads,1);
  f.data.info.equips[500].api_level=1;assert.throws(()=>guard.validate(new Set()),/improvement changed/);
  f.data.info.equips[500].api_level=0;f.data.info.ships[6].api_slot[0]=500;
  assert.throws(()=>guard.validate(new Set()),/outside this run/);
  guard.validate(new Set([6]));guard.expected.set(6,{slots:[500,-1,-1,-1],ex:0});guard.validate(new Set());
  f.data.info.fleets[0].api_ship.reverse();assert.throws(()=>guard.validate(new Set()),/Fleet changed/);
});
test('a multi-check observation decodes the PNG once and retains each result',async()=>{
  const frame=fs.readFileSync(path.join(__dirname,'../fixtures/equip/picker-transport.png'));
  const observer=new Observer(),decode=Pixels.decode;let decodes=0;
  Pixels.decode=function(buffer){if(buffer===frame)decodes++;return decode.call(this,buffer);};
  try{
    const result=await observer.observe('batch',frame,{checks:[{kind:'equippicker',arg:{total:161}},
      {kind:'rowicon',arg:{box:[546,196,599,240],t3:20}}]});
    assert(result.valid);assert.equal(result.results[0].page.activePage,1);assert.equal(decodes,1);
    const wrong=await observer.observe('batch',frame,{checks:[{kind:'equippicker',arg:{total:161}},
      {kind:'rowicon',arg:{box:[546,196,599,240],t3:7}}]});assert(!wrong.valid);
    await assert.rejects(observer.observe('batch',frame,{checks:[{kind:'batch'}]}),/Invalid observation batch/);
  }finally{Pixels.decode=decode;}
});
test('the isolated observer worker supports multi-check results without game access',async()=>{
  const observer=new WorkerObserver();try{
    await observer.start();const frame=fs.readFileSync(path.join(__dirname,'../fixtures/equip/picker-transport.png'));
    const result=await observer.observe('batch',frame,{checks:[{kind:'equippicker',arg:{total:161}},{kind:'rowicon',arg:{box:[546,196,599,240],t3:20}}]});
    assert(result.valid);assert.equal(result.results.length,2);
  }finally{await observer.dispose();}
});

module.exports={executionFixture};
