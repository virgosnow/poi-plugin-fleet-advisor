'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createEquipmentPlanner,withEquipmentIndexCache}=require('../../src/domain/fleet/equipment_planner');
const {createFleetPlanner}=require('../../src/domain/fleet/fleet_plan');
function fixture(){
 const ships={1:{api_ship_id:1,api_lv:20,api_slot:[101,102,-1],api_slot_ex:103},2:{api_ship_id:2,api_lv:10,api_slot:[201,-1,-1],api_slot_ex:0}};
 const equips={};for(const id of [101,102,103,104,105,106,107,201,301])equips[id]={api_slotitem_id:id===103?2:1,api_level:id===106?10:0,api_alv:0};
 const data={info:{ships,equips,fleets:[{api_ship:[1,2],api_mission:[0]}],airbase:[{api_plane_info:[{api_slotid:301}]}]},const:{$exslotEquips:[1,12],$exslotEquipShips:{},$exslotEquipLimits:{},$ships:{1:{api_name:'ship1',api_slot_num:3,api_stype:2},2:{api_name:'ship2',api_slot_num:3,api_stype:2}},$shipTypes:{2:{api_equip_type:{1:1,12:1,24:1,30:1}}},$equips:{1:{api_name:'gun',api_type:[0,0,1,1]},2:{api_name:'radar',api_type:[0,0,12,11]}}}};
 const S={run:null},api=createEquipmentPlanner(()=>data);
 const plan=ships=>{const result=api.resolvePlan({fleet:1,ships});S.run={plan:result};return result;};
 return {api,S,data,plan};
}
test('search projection matches full preview for concrete swaps, borrowing and expansion slots',()=>{
 const f=fixture(),planner=createFleetPlanner(()=>f.data);
 f.data.info.ships[2].api_slot_ex=-1;
 const schemes=[
  {fleet:1,ships:[{id:1,slots:[201,104,-1],ex:-1},{id:2,slots:[101,102,-1],ex:103}]},
  {fleet:1,ships:[{id:2,slots:[101,102,104],ex:103},{id:1,slots:[201,106,107],ex:-1}]},
  {fleet:1,ships:[{id:1,slots:[201,104,-1],ex:103}]},
 ];
 const before=JSON.stringify(f.data);
 for(const scheme of schemes){
  const full=planner.preview('fleet',scheme);
  withEquipmentIndexCache(f.data,()=>{
   const projected=planner.project(scheme);
   assert.equal(projected.equipment.steps,undefined);
   assert.deepEqual(projected.organization,full.organization);
   assert.deepEqual(projected.equipment.expected,full.equipment.expected.filter(e=>full.organization.targets.includes(e.shipId)));
   projected.equipment.expected[0].state.slots.fill(-1);
   assert.deepEqual(planner.project(scheme).equipment.expected,full.equipment.expected.filter(e=>full.organization.targets.includes(e.shipId)));
   assert.deepEqual(planner.preview('fleet',scheme),full,'final preview still constructs every operation');
  });
  assert.deepEqual(planner.project(scheme),full,'outside immutable search always use full planning');
 }
 assert.equal(JSON.stringify(f.data),before);
});
test('projection retains all allocation guards and falls back for partial or named schemes',()=>{
 for(const change of [
  (f,s)=>s.ships[0].slots=[101,101,-1],
  (f,s)=>s.ships[0].slots=[301,-1,-1], // land base
  (f,s)=>s.ships[0].slots=[-1,104,-1],
  (f,s)=>s.ships[0].slots=[999,-1,-1],
  (f,s)=>{s.ships[0].slots=[201,-1,-1];f.data.info.repairs=[{api_ship_id:2}];},
  f=>f.data.info.repairs=[{api_ship_id:1}],
  f=>f.data.info.fleets[0].api_mission=[1],
  (f,s)=>{f.data.info.ships[1].api_slot_ex=0;s.ships[0].ex=103;},
  f=>f.data.const.$shipTypes[2].api_equip_type={12:1},
  (f,s)=>s.ships.push({...s.ships[0]}),
 ]){
  const f=fixture(),s={fleet:1,ships:[{id:1,slots:[104,105,-1],ex:-1}]};change(f,s);
  const p=createFleetPlanner(()=>f.data);
  assert.throws(()=>p.preview('fleet',s));
  assert.throws(()=>withEquipmentIndexCache(f.data,()=>p.project(s)));
 }
 const f=fixture(),p=createFleetPlanner(()=>f.data);
 for(const scheme of [
  {fleet:1,ships:[{id:1,slots:[201]},{id:2}]},
  {fleet:1,ships:[{name:'ship1',slots:['gun','gun'],ex:'any'}]},
 ])withEquipmentIndexCache(f.data,()=>assert.deepEqual(p.project(scheme),p.preview('fleet',scheme)));
});
test('concrete projection preserves full planner acceptance across inventory allocations',()=>{
 const f=fixture(),p=createFleetPlanner(()=>f.data);f.data.info.ships[2].api_slot_ex=-1;
 let seed=27,valid=0,rejected=0;
 const next=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
 const evaluate=fn=>{try{return {value:fn()};}catch(error){return {error:error.message};}};
 withEquipmentIndexCache(f.data,()=>{
  for(let i=0;i<300;i++){
   const ids=[101,102,104,105,106,107,201];
   for(let k=ids.length-1;k>0;k--){const j=next(k+1);[ids[j],ids[k]]=[ids[k],ids[j]];}
   const ships=[1,2].map(id=>({id,slots:ids.splice(0,3),ex:id===1?103:-1}));
   if(i%3===0)ships[0].slots[next(3)]=[301,-1,999,ships[1].slots[0]][next(4)];
   const scheme={fleet:1,ships:i%2?ships:ships.slice().reverse()};
   const full=evaluate(()=>p.preview('fleet',scheme)),projection=evaluate(()=>p.project(scheme));
   assert.equal(!!projection.error,!!full.error,JSON.stringify(scheme));
   if(full.error){rejected++;continue;}
   valid++;assert.deepEqual(projection.value.equipment.expected,full.value.equipment.expected);
  }
 });
 assert(valid>100&&rejected>30);
 // Corrupt duplicate source ownership is handled by the existing full planner.
 f.data.info.ships[2].api_slot=[101,-1,-1];
 const scheme={fleet:1,ships:[{id:1,slots:[104,105,106],ex:-1},{id:2,slots:[107,201,-1],ex:103}]};
 const full=p.preview('fleet',scheme),projected=withEquipmentIndexCache(f.data,()=>p.project(scheme));
 assert.deepEqual(projected.organization,full.organization);
 assert.deepEqual(projected.equipment,full.equipment);
});
(async()=>{
 await test('two same names use different instances and prefer current slots',()=>{const f=fixture();assert(f.plan([{id:1,slots:['gun','gun']}]).done);});
 await test('adding same-name equipment keeps equipped slots and installs incrementally',()=>{const f=fixture();f.plan([{id:1,slots:['gun','gun','gun']}]);const d=f.S.run.plan.ships[0];assert.deepEqual(d.want.slots,[101,102,104]);assert.deepEqual(d.ops.map(op=>op.kind),['slot']);assert.deepEqual(d.ops.map(op=>op.id),[104]);assert.equal(d.ops[0].j,2);});
 await test('adding broad name prefers free item over unconstrained source',()=>{const f=fixture();f.plan([{id:1,slots:['any','any','gun']}]);assert.deepEqual(Array.from(f.S.run.plan.expected[0].state.slots),[101,102,104]);});
 await test('allocation reassigns when constrained overlap requires it',()=>{const f=fixture();for(const id of [101,102,103,107,201,301])delete f.data.info.equips[id];f.data.info.ships[1].api_slot=[-1,-1,-1];f.data.info.ships[1].api_slot_ex=0;f.data.info.equips[104].api_alv=7;f.data.info.equips[106].api_alv=7;f.plan([{id:1,slots:[{name:'gun',star:0},{name:'gun',alv:7},{name:'gun',alv:7}]}]);const wanted=Array.from(f.S.run.plan.expected[0].state.slots);assert.equal(wanted[0],105);assert.deepEqual(wanted.slice(1).sort(),[104,106]);});
 await test('same-name allocation across ships is exclusive',()=>{const f=fixture();f.plan([{id:1,slots:['any','any','gun']},{id:2,slots:['any','gun']}]);const goals=f.S.run.plan.expected;assert.notEqual(goals[0].state.slots[2],goals[1].state.slots[1]);});
 await test('explicit ID reserved ahead of broad name',()=>{const f=fixture();f.plan([{id:1,slots:['gun',101]}]);const st=f.S.run.plan.expected[0].state;assert.equal(st.slots[1],101);assert.notEqual(st.slots[0],101);});
 await test('constrained star request is not consumed by broad request',()=>{const f=fixture();f.plan([{id:1,slots:[{name:'gun',star:10},'gun']}]);assert.equal(f.S.run.plan.expected[0].state.slots[0],106);});
 await test('duplicate explicit ID rejected',()=>assert.throws(()=>fixture().plan([{id:1,slots:[104,104]}])));
 await test('duplicate explicit ID across ships rejected',()=>assert.throws(()=>fixture().plan([{id:1,slots:[104]},{id:2,slots:[104]}])));
 await test('base aircraft rejected by ID',()=>assert.throws(()=>fixture().plan([{id:1,slots:[301]}])));
 await test('other ship equipment records its exact source',()=>{const f=fixture(),p=f.plan([{id:1,slots:[201]}]);assert.equal(p.ships[0].ops.at(-1).source.shipId,2);assert.deepEqual(p.donors[0].state.slots,[-1,-1,-1]);});
 await test('closed extra slot rejects installation',()=>assert.throws(()=>fixture().plan([{id:2,ex:104}])));
 await test('closed extra slot empty is no-op',()=>assert(fixture().plan([{id:2,ex:'empty'}]).done));
 await test('more than actual slots rejected',()=>assert.throws(()=>fixture().plan([{id:1,slots:['any','any','any',104]}])));
 await test('incomplete store slots rejected before planning',()=>{const f=fixture();f.data.info.ships[1].api_slot=[101];assert.throws(()=>f.plan([{id:1,slots:['empty']}]));});
 await test('invalid star rejected',()=>assert.throws(()=>fixture().plan([{id:1,slots:[{name:'gun',star:11}]}])));
 await test('expedition rejected before changes',()=>{const f=fixture();f.data.info.fleets[0].api_mission=[1];assert.throws(()=>f.plan([{id:1,slots:[104]}]));});
 await test('duplicate ship entries rejected',()=>assert.throws(()=>fixture().plan([1,1])));
 for(const [name,scheme] of [['two-slot swap',{id:1,slots:[102,101]}],['extra-normal cycle',{id:1,slots:[103],ex:101}],['three-slot rotation',{id:1,slots:[102,103,101],ex:'empty'}]]){
  await test(name+' frees every source before install',()=>{const f=fixture();f.plan([scheme]);let state={slots:[101,102,-1],ex:103};for(const op of f.S.run.plan.ships[0].ops){assert.deepEqual(op.before,state);if(op.id>0)assert(!state.slots.concat([state.ex]).includes(op.id));state=op.after;}assert.deepEqual(state,f.S.run.plan.expected[0].state);});
 }
 await test('unachievable normal slot gaps are rejected before execution',()=>{const f=fixture();assert.throws(()=>f.plan([{id:1,slots:['any','any',101]}]),/空槽/);assert.throws(()=>f.plan([{id:1,slots:['empty',102]}]),/空槽/);});
})();

const {restoreEquipment}=require('../../src/execution/equipment');
function runtime(options={}) {
  const f=fixture(),inputs=[],snapshots=[],observations=[],progress=[];let now=0,primary=options.initialCategory??null,activePage=options.initialPage||1,pickerCount=0,menu=false,mode=options.initialMode||'stock',screen='home',filterCleared=!options.filterStuck;
  const session={host:{getStore:()=>f.data},now:()=>++now,onProgress(event){progress.push(event);},check(){if(this.validate)this.validate();},
    async observe(kind,arg={}){return this.until(kind,arg);},
    async until(kind,arg={},predicate=r=>r.valid){
      this.check();observations.push(kind);
      if(kind==='screen'){const result={valid:true,mode:screen};if(!predicate(result))throw Error('Observation timed out: screen');return result;}
      if(kind==='equipmode'&&!filterCleared)throw new Error('Observation timed out');
      const page={valid:true,activePage,labels:[1,2],centers:[739,793]};
      const result=kind==='equipmode'?{valid:true,mode}:kind==='borrowconfirm'?{valid:!options.badConfirm,commit:{x:470,y:480}}:kind==='screen'?{valid:true,mode:'home'}:kind==='cells'?{valid:!options.menuCategories,primaries:[0,1,11],categories:options.menuCategories||[0,4,9],centers:[{x:811,y:197},{x:811,y:226},{x:811,y:255}]}:kind==='pageread'?page:kind==='equippicker'?{valid:true,primary,category:({0:0,1:4,11:9,20:10})[primary]??null,page}:kind==='equipclear'?{valid:!options.missingClear,tab:{valid:!options.wrongTab},commit:options.missingCommit?null:{x:485,y:245+50*arg.slots}}:{valid:true};
      if(!predicate(result))throw new Error('Observation timed out');return result;
    },
    async wait(){now+=10000;this.check();},
    async input(x,y,mutation,kind='click'){
      this.check();inputs.push({x,y,mutation,kind});
      if(x===477&&y===339)screen='equipment';
      if(x===750&&[271,321,366,412,457].includes(y)&&!mutation) {
        if(options.pickerCategories&&pickerCount<options.pickerCategories.length)primary=options.pickerCategories[pickerCount];
        pickerCount++;
      }
      if(x===1135&&y===168&&!options.ignoreMode)mode=mode==='stock'?'others':'stock';
      if(x===824&&y===168)menu=true;
      if(menu&&x===811) {
        if(!options.ignoreCategory){primary=[0,1,11][[197,226,255].indexOf(y)];activePage=1;if(y===197)filterCleared=true;}
        menu=false;
      }
      if(y===677&&[739,793].includes(x))activePage=x===739?1:2;
      if(mutation&&!options.noStore) {
        const sh=f.data.info.ships[mutation.ship];
        if(mutation.path==='api_req_kaisou/slot_deprive') {
          const source=f.data.info.ships[mutation.sourceShip];
          const item=mutation.sourceKind?source.api_slot_ex:source.api_slot[mutation.sourceJ];
          if(!options.noDonorUpdate){if(mutation.sourceKind)source.api_slot_ex=-1;else{source.api_slot.splice(mutation.sourceJ,1);source.api_slot.push(-1);}}
          if(mutation.slotKind)sh.api_slot_ex=item;else sh.api_slot[mutation.j]=item;
        }
        else if(mutation.path==='api_req_kaisou/unsetslot_all')sh.api_slot.fill(-1);
        else if(mutation.path.endsWith('_ex'))sh.api_slot_ex=mutation.item;
        else if(mutation.item<0){sh.api_slot.splice(mutation.j,1);sh.api_slot.push(-1);}
        else sh.api_slot[sh.api_slot.indexOf(-1)]=mutation.item;
        if(options.collateral)f.data.info.ships[2].api_slot[0]=-1;
        if(options.afterMutation)options.afterMutation(f.data,mutation);
        snapshots.push(JSON.parse(JSON.stringify(f.data.info.ships)));
      }
      if(options.fleetDrift)f.data.info.fleets[0].api_ship=[2,1];
    }};
  return {...f,session,inputs,snapshots,observations,progress};
}

test('consecutive normal slots select a category once and reuse the retained selection',async()=>{
  const f=runtime();await restoreEquipment(f.session,{fleet:1,ships:[{id:1,slots:[104,105,106]}]});
  assert.deepEqual(f.data.info.ships[1].api_slot,[104,105,106]);
  assert.equal(f.inputs.filter(i=>i.x===824&&i.y===168).length,1);
  assert.equal(f.observations.filter(k=>k==='cells').length,2);
  assert.equal(f.observations.filter(k=>k==='equippicker').length,4);
});

test('equipment refuses an unknown initial screen before fleet or slot input',async()=>{
  const f=runtime(),before=JSON.stringify(f.data);
  f.session.until=async kind=>{assert.equal(kind,'screen');throw Error('Observation timed out: screen');};
  await assert.rejects(restoreEquipment(f.session,{fleet:1,ships:[{id:1,slots:[104]}]}),/无法识别当前画面/);
  assert.equal(f.inputs.length,0);assert.equal(JSON.stringify(f.data),before);
});

test('an already selected category skips the menu even for the first slot',async()=>{
  const f=runtime({initialCategory:1});await restoreEquipment(f.session,{fleet:1,ships:[{id:1,slots:[104,105]}]});
  assert(!f.inputs.some(i=>i.x===824&&i.y===168));assert(!f.observations.includes('cells'));
  assert.equal(f.observations.filter(k=>k==='equippicker').length,2);
});

test('different equipment types within the retained transport group need no category switch',async()=>{
  const f=runtime({initialCategory:20});
  f.data.const.$equips[3]={api_name:'craft',api_type:[0,0,24,20]};f.data.const.$equips[4]={api_name:'drum',api_type:[0,0,30,25]};
  f.data.info.equips[104].api_slotitem_id=3;f.data.info.equips[105].api_slotitem_id=4;
  await restoreEquipment(f.session,{fleet:1,ships:[{id:1,slots:[104,105]}]});
  assert.deepEqual(f.data.info.ships[1].api_slot,[104,105,-1]);
  assert(!f.inputs.some(i=>i.x===824&&i.y===168));
});

test('a different target category switches once then reuses the new selection',async()=>{
  const f=runtime({initialCategory:1});f.data.info.equips[105].api_slotitem_id=2;f.data.info.equips[106].api_slotitem_id=2;
  await restoreEquipment(f.session,{fleet:1,ships:[{id:1,slots:[104,105,106]}]});
  assert.deepEqual(f.data.info.ships[1].api_slot,[104,105,106]);
  assert.equal(f.inputs.filter(i=>i.x===824&&i.y===168).length,1);
  assert(f.inputs.some(i=>i.x===811&&i.y===255));
});
test('dark category rows do not block a readable target category',async()=>{
  const f=runtime({menuCategories:[0,4,null]});
  await restoreEquipment(f.session,{fleet:1,ships:[{id:1,slots:[104]}]});
  assert(f.inputs.some(i=>i.x===811&&i.y===226));
  assert.deepEqual(f.data.info.ships[1].api_slot,[104,-1,-1]);
});
test('dark target category falls back to the readable all-equipment row',async()=>{
  const f=runtime({menuCategories:[0,null,null]});
  await restoreEquipment(f.session,{fleet:1,ships:[{id:1,slots:[104]}]});
  assert(f.inputs.some(i=>i.x===811&&i.y===197));
  assert.deepEqual(f.data.info.ships[1].api_slot,[104,-1,-1]);
});
test('category menu with no readable candidate stops before installing a new item',async()=>{
  const f=runtime({menuCategories:[null,null,null]});
  await assert.rejects(restoreEquipment(f.session,{fleet:1,ships:[{id:1,slots:[104]}]}),/分类菜单未能打开/);
  assert(!f.inputs.some(i=>i.mutation?.path==='api_req_kaisou/slotset'));
});
test('a leftover category filter is auto-reset through menu row zero when the mode read times out',async()=>{
  const f=runtime({filterStuck:true});
  await restoreEquipment(f.session,{fleet:1,ships:[{id:1,slots:[104]}]});
  assert.deepEqual(f.data.info.ships[1].api_slot,[104,-1,-1]);
  assert(f.inputs.some(i=>i.x===824&&i.y===168),'menu opened for the reset');
  assert(f.inputs.some(i=>i.x===811&&i.y===197),'row zero (全装備) picked');
});

test('reset or unrecognized categories are read afresh between slots and ships',async()=>{
  for(const reset of [null,11]) {
    const f=runtime({pickerCategories:[1,reset,1,reset]});
    await restoreEquipment(f.session,{fleet:1,ships:[{id:1,slots:[104,105]},{id:2,slots:[106,107]}]});
    assert.equal(f.inputs.filter(i=>i.x===824&&i.y===168).length,2);
    assert.deepEqual(f.data.info.ships[1].api_slot,[104,105,-1]);assert.deepEqual(f.data.info.ships[2].api_slot,[106,107,-1]);
  }
});

test('a category switch that does not take effect stops before installing',async()=>{
  const f=runtime({initialCategory:11,ignoreCategory:true});f.data.info.ships[1].api_slot=[-1,-1,-1];
  await assert.rejects(restoreEquipment(f.session,{fleet:1,ships:[{id:1,slots:[104]}]}),/Observation timed out/);
  assert(!f.inputs.some(i=>i.mutation));
});

test('reusing a category recalculates the remaining list and navigates from the retained page',async()=>{
  const f=runtime({initialCategory:1,initialPage:2});f.data.info.ships[1].api_slot=[-1,-1,-1];
  delete f.data.info.equips[101];delete f.data.info.equips[102];
  for(let id=108;id<=114;id++)f.data.info.equips[id]={api_slotitem_id:1};
  await restoreEquipment(f.session,{fleet:1,ships:[{id:1,slots:[114,113]}]});
  assert(!f.inputs.some(i=>i.x===824&&i.y===168));
  assert.deepEqual(f.inputs.filter(i=>i.x===750&&[218,621].includes(i.y)).map(i=>i.y),[218,621]);
  assert(f.inputs.some(i=>i.x===739&&i.y===677));
  assert.deepEqual(f.data.info.ships[1].api_slot,[114,113,-1]);
});
test('equipment bulk-clear then install enforces the complete slot target',async()=>{
  const f=runtime();const r=await restoreEquipment(f.session,{fleet:1,ships:[{id:1,slots:[104]}]});
  assert.equal(r.changed,2);assert.deepEqual(f.data.info.ships[1].api_slot,[104,-1,-1]);
  const mutations=f.inputs.filter(i=>i.mutation).map(i=>i.mutation);
  assert.deepEqual(mutations,[{path:'api_req_kaisou/unsetslot_all',ship:1},{path:'api_req_kaisou/slotset',ship:1,j:0,item:104}]);
  assert.deepEqual(f.snapshots[0][1].api_slot,[-1,-1,-1]);assert.equal(f.snapshots[0][1].api_slot_ex,103);
});

test('explicit any and null are restored to the original instances after bulk clearing',async()=>{
  for(const preserve of ['any',null]) {
    const f=runtime();await restoreEquipment(f.session,{fleet:1,ships:[{id:1,slots:[104,preserve]}]});
    assert.deepEqual(f.data.info.ships[1].api_slot,[104,102,-1]);
    assert.equal(f.data.info.ships[1].api_slot_ex,103);
    assert.equal(f.inputs.filter(i=>i.mutation).length,3);
  }
});

test('empty slot array removes all normal equipment with one request, preserving expansion',async()=>{
  const f=runtime(),r=await restoreEquipment(f.session,{fleet:1,ships:[{id:1,slots:[]}]});
  assert.equal(r.changed,1);assert.deepEqual(f.data.info.ships[1].api_slot,[-1,-1,-1]);assert.equal(f.data.info.ships[1].api_slot_ex,103);
  assert.deepEqual(f.data.info.ships[2].api_slot,[201,-1,-1]);
});

test('omitted or exactly matching slots perform no observation or input',async()=>{
  for(const ship of [{id:1},{id:1,slots:[101,102]},{id:1,slots:['any','any','any']}]) {
    const f=runtime();f.session.until=()=>{throw Error('Unexpected observation');};
    assert.equal((await restoreEquipment(f.session,{fleet:1,ships:[ship]})).changed,0);
    assert.equal(f.inputs.length,0);
  }
});

test('only an expansion change leaves normal equipment in place',async()=>{
  const f=runtime();await restoreEquipment(f.session,{fleet:1,ships:[{id:1,ex:'empty'}]});
  assert.deepEqual(f.data.info.ships[1].api_slot,[101,102,-1]);
  assert.deepEqual(f.inputs.filter(i=>i.mutation).map(i=>i.mutation),[{path:'api_req_kaisou/slotset_ex',ship:1,item:-1}]);
});

test('already empty normal slots skip bulk clearing and append from the first slot',async()=>{
  const f=runtime();f.data.info.ships[1].api_slot=[-1,-1,-1];
  await restoreEquipment(f.session,{fleet:1,ships:[{id:1,slots:[104,105]}]});
  assert.deepEqual(f.inputs.filter(i=>i.mutation).map(i=>i.mutation.j),[0,1]);
  assert(!f.inputs.some(i=>i.mutation?.path.endsWith('unsetslot_all')));
});

test('five normal slots clear with one mutation and use their own button height',async()=>{
  const f=runtime();f.data.const.$ships[1].api_slot_num=5;f.data.info.ships[1].api_slot=[101,102,104,105,106];
  await restoreEquipment(f.session,{fleet:1,ships:[{id:1,slots:[]}]});
  const mutation=f.inputs.find(i=>i.mutation);assert.equal(mutation.y,495);
  assert.equal(f.inputs.filter(i=>i.mutation).length,1);assert.deepEqual(f.data.info.ships[1].api_slot,[-1,-1,-1,-1,-1]);
});

test('missing bulk-clear tooltip, fleet tab or button prevents all equipment mutations',async()=>{
  for(const key of ['missingClear','wrongTab','missingCommit']) {
    const f=runtime({[key]:true});await assert.rejects(restoreEquipment(f.session,{fleet:1,ships:[{id:1,slots:[]}]}));
    assert(!f.inputs.some(i=>i.mutation));
  }
});

test('partial clearing or unintended expansion removal never starts reinstallation',async()=>{
  for(const afterMutation of [s=>s.info.ships[1].api_slot[0]=101,s=>s.info.ships[1].api_slot_ex=-1]) {
    const f=runtime({afterMutation});await assert.rejects(restoreEquipment(f.session,{fleet:1,ships:[{id:1,slots:[104]}]}),/no repeat/);
    assert.equal(f.inputs.filter(i=>i.mutation).length,1);
  }
});

test('retained items must be equipable before a bulk rebuild is planned',()=>{
  const f=fixture();f.data.const.$shipTypes[2].api_equip_type[1]=0;
  assert.throws(()=>f.plan([{id:1,slots:['any']}]),/无法重新安装/);
});
test('equipment store timeout never repeats a removal',async()=>{
  const f=runtime({noStore:true});await assert.rejects(restoreEquipment(f.session,{fleet:1,ships:[{id:1,slots:['any','empty']}]}),/no repeat/);
  assert.equal(f.inputs.filter(i=>i.mutation).length,1);
});
test('equipment catches collateral changes to another ship',async()=>{
  const f=runtime({collateral:true});await assert.rejects(restoreEquipment(f.session,{fleet:1,ships:[{id:1,slots:['any','empty']}]}),/outside this run/);
});
test('fleet drift stops equipment before mutation',async()=>{
  const f=runtime({fleetDrift:true});await assert.rejects(restoreEquipment(f.session,{fleet:1,ships:[{id:1,slots:['any','empty']}]}),/Fleet changed/);
  assert(!f.inputs.some(i=>i.mutation));
});
test('missing unrelated ship slots cannot masquerade as free equipment',()=>{
  const f=fixture();delete f.data.info.ships[2].api_slot_ex;assert.throws(()=>f.plan([{id:1,slots:[104]}]));
});
test('unknown equipment master stops candidate prediction',()=>{
  const f=fixture();f.data.info.equips[999]={api_slotitem_id:999};assert.throws(()=>f.plan([{id:1,slots:[104]}]));
});
test('equipment and organization bind portable names to the same highest-level ship',()=>{
  const f=fixture(),{resolvePlan}=require('../../src/execution/organize');
  f.data.const.$ships[2].api_name='ship1';
  f.data.info.ships[1].api_lv='99';f.data.info.ships[2].api_lv='100';
  for(const entry of ['ship1',{name:'ship1'}]) {
    assert.equal(f.plan([entry]).expected[0].shipId,2);
    assert.deepEqual(resolvePlan(f.data,{fleet:1,ships:[entry]}).targets,[2]);
  }
  assert.equal(f.plan([{id:1,name:'ship1'}]).expected[0].shipId,1);
  f.data.info.ships[1].api_lv=100;
  assert.equal(f.plan([{name:'ship1'}]).expected[0].shipId,1);
  assert.deepEqual(resolvePlan(f.data,{fleet:1,ships:['ship1']}).targets,[1]);
  assert.throws(()=>f.plan([{name:'ship1'},{name:'ship1'}]),/重复舰/);
  assert.throws(()=>f.plan([{name:'ship1改'}]),/未持有/);
});
test('equipment cannot silently choose the lower-level copy already in the requested fleet',()=>{
  const f=fixture();f.data.const.$ships[2].api_name='ship1';f.data.info.ships[2].api_lv=100;
  f.data.info.fleets[0].api_ship=[1];f.data.info.fleets.push({api_ship:[2],api_mission:[0]});
  assert.throws(()=>f.plan([{name:'ship1',slots:['empty']}]),/目标舰不在方案舰队: 2/);
  delete f.data.info.ships[2].api_lv;
  assert.throws(()=>f.plan(['ship1']),/等级数据不完整/);
});
test('transport filtering keeps landing craft before lower-master-ID drums',()=>{
  const f=fixture();
  Object.assign(f.data.const.$equips,{75:{api_name:'drum',api_type:[0,0,30,25]},166:{api_name:'landing craft',api_type:[0,0,24,20]}});
  Object.assign(f.data.info.equips,{7677:{api_slotitem_id:75},14288:{api_slotitem_id:75},13063:{api_slotitem_id:166},13598:{api_slotitem_id:166}});
  assert.deepEqual(f.api.freePickerList(10,1).map(e=>e.id),[13063,13598,7677,14288]);
  f.data.const.$shipTypes[2].api_equip_type[24]=0;
  assert.deepEqual(f.api.freePickerList(10,1).map(e=>e.id),[7677,14288]);
  f.data.const.$equipShip={1:{api_equip_type:{24:[166],30:null}}};
  assert.deepEqual(f.api.freePickerList(10,1).map(e=>e.id),[13063,13598,7677,14288]);
  f.data.const.$equipShip[1].api_equip_type[24]=[999];
  assert.deepEqual(f.api.freePickerList(10,1).map(e=>e.id),[7677,14288]);
});

test('borrow star/alv constraints and free/current preference remain exact',()=>{
 const f=fixture();f.data.info.equips[201].api_level=8;f.data.info.equips[201].api_alv=7;
 const p=f.plan([{id:1,slots:['any','any',{name:'gun',star:8,alv:7}]}]);assert.equal(p.ships[0].ops.length,1);assert.equal(p.ships[0].ops[0].source.shipId,2);
 assert.throws(()=>f.plan([{id:1,slots:[{name:'gun',star:8,alv:6}]}]),/无可用/);
 assert.equal(f.plan([{id:1,slots:['any','any','gun']}]).ships[0].ops[0].id,104);
});
test('borrowing source eligibility does not remove disabled rows from picker ranks',()=>{
 const f=fixture();f.data.info.fleets.push({api_ship:[2],api_mission:[1]});
 assert(f.api.otherPickerList(0,1,0).some(e=>e.id===201));assert.throws(()=>f.plan([{id:1,slots:[201]}]),/无可用/);
 f.data.info.fleets[1].api_mission=[0];f.data.info.repairs=[{api_ship_id:2}];assert.throws(()=>f.plan([{id:1,ex:201}]),/无可用/);
});
test('other picker order retains instance order despite improvement levels',()=>{
 const f=fixture();f.data.info.ships[2].api_slot=[201,104,106];f.data.info.equips[104].api_level=10;
 assert.deepEqual(f.api.otherPickerList(0,1,0).map(x=>x.id),[104,106,201]);
});
test('per-ship installation leaves later ships equipped until their turn and reports confirmed completion',async()=>{
 const f=runtime();await restoreEquipment(f.session,{fleet:1,ships:[{id:1,slots:[104]},{id:2,slots:[105]}]});
 assert.deepEqual(f.inputs.filter(i=>i.mutation).map(i=>i.mutation.ship),[1,1,2,2]);
 assert.deepEqual(f.snapshots[1][1].api_slot,[104,-1,-1]);
 assert.deepEqual(f.snapshots[1][2].api_slot,[201,-1,-1]);
 assert.deepEqual(f.progress.filter(p=>p.phase==='equipment-done').map(p=>p.ship),[1,2]);
 assert.deepEqual(f.progress.filter(p=>p.phase==='equipment-step').map(p=>[p.ship,p.completed,p.total]),[[1,1,2],[1,2,2],[2,1,2],[2,2,2]]);
 const failed=runtime({noStore:true});await assert.rejects(restoreEquipment(failed.session,{fleet:1,ships:[{id:1,slots:[104]}]}));
 assert(!failed.progress.some(p=>p.phase==='equipment-done'||p.phase==='equipment-step'));
});
test('per-ship plans preserve exclusive instances across normal/expansion cycles and donor compaction',()=>{
 for(let seed=1;seed<=120;seed++){
  const f=fixture();f.data.info.equips[501]={api_slotitem_id:1};
  f.data.info.ships[2].api_slot=[201,104,-1];f.data.info.ships[2].api_slot_ex=105;
  f.data.info.ships[3]={...f.data.info.ships[2],api_slot:[106,107,-1],api_slot_ex:501};
  f.data.info.fleets[0].api_ship=[1,2,3];
  const items=[101,102,103,201,104,105,106,107,501];let random=seed;
  for(let i=items.length-1;i>0;i--){random=(Math.imul(random,1664525)+1013904223)>>>0;const j=random%(i+1);[items[i],items[j]]=[items[j],items[i]];}
  const before=JSON.stringify(f.data),scheme=[1,2,3].map((id,i)=>({id,slots:items.slice(i*3,i*3+2),ex:items[i*3+2]})),plan=f.plan(scheme);
  assert.equal(JSON.stringify(f.data),before);
  const states=new Map([1,2,3].map(id=>[id,f.api.currentState(id)])),finished=new Set();let active;
  for(const {shipId,op} of plan.steps){
   if(active!==shipId){if(active)finished.add(active);assert(!finished.has(shipId));active=shipId;}
   assert.deepEqual(states.get(shipId),op.before);
   if(op.source){assert(!finished.has(op.source.shipId),'completed ships are never borrowed from');assert.deepEqual(states.get(op.source.shipId),op.source.before);states.set(op.source.shipId,op.source.after);}
   states.set(shipId,op.after);
   const installed=[...states.values()].flatMap(s=>s.slots.concat(s.ex)).filter(id=>id>0);assert.equal(installed.length,new Set(installed).size);
  }
  for(const target of plan.expected)assert.deepEqual(states.get(target.shipId),target.state);
 }
});
test('cross-ship swap completes one ship before rebuilding the next, borrowing exact instances',async()=>{
 const f=runtime();await restoreEquipment(f.session,{fleet:1,ships:[{id:1,slots:[201]},{id:2,slots:[101]}]});
 assert.deepEqual(f.data.info.ships[1].api_slot,[201,-1,-1]);assert.deepEqual(f.data.info.ships[2].api_slot,[101,-1,-1]);
 const mutations=f.inputs.filter(i=>i.mutation).map(i=>i.mutation);
 assert.deepEqual(mutations.map(m=>m.ship),[1,1,2]);
 assert.equal(mutations[0].path,'api_req_kaisou/unsetslot_all');
 assert.equal(mutations[1].path,'api_req_kaisou/slot_deprive');assert.equal(mutations[1].sourceShip,2);
});
for(const fromEx of [false,true])for(const toEx of [false,true])test(`borrow ${fromEx?'ex':'normal'} to ${toEx?'ex':'normal'} checks both ships and exact request`,async()=>{
 const f=runtime();f.data.info.ships[1].api_slot=[-1,-1,-1];f.data.info.ships[1].api_slot_ex=-1;
 if(fromEx){f.data.info.ships[2].api_slot=[-1,-1,-1];f.data.info.ships[2].api_slot_ex=201;}
 const r=await restoreEquipment(f.session,{fleet:1,ships:[{id:1,...(toEx?{ex:201}:{slots:[201]})}]});assert.equal(r.changed,1);
 assert.equal(toEx?f.data.info.ships[1].api_slot_ex:f.data.info.ships[1].api_slot[0],201);
 assert.equal(fromEx?f.data.info.ships[2].api_slot_ex:f.data.info.ships[2].api_slot[0],-1);
 assert.deepEqual(f.inputs.filter(i=>i.mutation).map(i=>i.mutation),[{path:'api_req_kaisou/slot_deprive',ship:1,j:toEx?-1:0,slotKind:Number(toEx),sourceShip:2,sourceJ:0,sourceKind:Number(fromEx)}]);
 assert(f.observations.includes('borrowconfirm'));
});
for(const failure of ['badConfirm','ignoreMode','noDonorUpdate'])test('borrow '+failure+' stops without repeated transfer',async()=>{
 const f=runtime({[failure]:true});f.data.info.ships[1].api_slot=[-1,-1,-1];
 await assert.rejects(restoreEquipment(f.session,{fleet:1,ships:[{id:1,slots:[201]}]}));assert.equal(f.inputs.filter(i=>i.mutation).length,failure==='noDonorUpdate'?1:0);
});
test('borrowing compacts the external donor and records its full final state',async()=>{
 const f=runtime();f.data.info.ships[2].api_slot=[201,104,105];f.data.info.ships[1].api_slot=[-1,-1,-1];
 const p=f.plan([{id:1,slots:[104]}]);assert.equal(p.donors[0].shipId,2);assert.deepEqual(p.donors[0].state.slots,[201,105,-1]);
 await restoreEquipment(f.session,{fleet:1,ships:[{id:1,slots:[104]}]});assert.deepEqual(f.data.info.ships[2].api_slot,[201,105,-1]);
});
test('snapshot indexes are shared across previews and released before live state changes',()=>{
 const f=fixture(),scheme={fleet:1,ships:[{id:1,slots:[201,104]}]};
 const expected=f.api.resolvePlan(scheme),before=JSON.stringify(f.data);
 let scans=0;f.data.info.equips=new Proxy(f.data.info.equips,{ownKeys(target){scans++;return Reflect.ownKeys(target);}});
 withEquipmentIndexCache(f.data,()=>{
  for(let i=0;i<3;i++)assert.deepEqual(createEquipmentPlanner(()=>f.data).resolvePlan(scheme),expected);
  assert.equal(scans,1,'the same snapshot inventory is scanned once across planner instances');
 });
 assert.equal(JSON.stringify(f.data),before,'planning cannot alter equipment or donor slots');
 f.data.info.ships[2].api_slot=[201,104,-1];
 assert(!f.api.freeListAll().some(row=>row.id===104));
 assert.deepEqual(f.api.sourceMap()[104],{shipId:2,j:1});
 withEquipmentIndexCache(f.data,()=>assert(!f.api.freeListAll().some(row=>row.id===104)));
 assert.equal(f.api.resolvePlan(scheme).steps.find(s=>s.op.id===104).op.source.shipId,2);
});

test('shared planning states isolate donors, swaps and returned result mutations',()=>{
 const f=fixture();f.data.info.ships[2].api_slot=[201,104,105];
 const schemes=[
  {fleet:1,ships:[{id:1,slots:[104,201]}]},
  {fleet:1,ships:[{id:1,slots:[201]},{id:2,slots:[101,102]}]},
  {fleet:1,ships:[{id:1,slots:[106,107]}]},
 ];
 const expected=schemes.map(s=>f.api.resolvePlan(s)),before=JSON.stringify(f.data);
 withEquipmentIndexCache(f.data,()=>{
  for(let round=0;round<3;round++)for(let i=0;i<schemes.length;i++){
   const result=f.api.resolvePlan(schemes[i]);assert.deepEqual(result,expected[i]);
   const corrupt=value=>{if(Array.isArray(value))value.fill(null);else if(value&&typeof value==='object')Object.values(value).forEach(corrupt);};
   corrupt(result);
  }
 });
 assert.equal(JSON.stringify(f.data),before);
 f.data.info.ships[2].api_slot=[201,105,104];
 assert.equal(f.api.resolvePlan(schemes[0]).steps.find(s=>s.op.id===104).op.source.j,2);
});

test('failed and nested snapshot scopes do not leak indexes into later previews',()=>{
 const f=fixture();
 assert.throws(()=>withEquipmentIndexCache(f.data,()=>{f.api.freeListAll();throw Error('abort');}),/abort/);
 f.data.info.ships[2].api_slot=[201,104,-1];
 assert(!f.api.freeListAll().some(row=>row.id===104));
 withEquipmentIndexCache(f.data,()=>{
  const other=fixture();
  withEquipmentIndexCache(other.data,()=>assert(other.api.freeListAll().some(row=>row.id===104)));
  assert(!f.api.freeListAll().some(row=>row.id===104));
 });
});

test('a retained other-ship view is switched back for free inventory',async()=>{
 const f=runtime({initialMode:'others'});await restoreEquipment(f.session,{fleet:1,ships:[{id:1,slots:[104]}]});assert(f.inputs.some(i=>i.x===1135&&i.y===168));
});

test('organization reuse retains flagship, target fleet and name validation and ends with the search scope',()=>{
 const {Controller}=require('../../src/application/controller'),f=fixture(),controller=new Controller({getStore:()=>f.data});
 f.data.info.fleets.push({api_ship:[],api_mission:[0]});
 const a={fleet:1,ships:[{id:1,slots:[101,102]},{id:2,slots:[201]}]};
 const b={fleet:1,ships:[{id:1,slots:[104,105]},{id:2,slots:[201]}]};
 withEquipmentIndexCache(f.data,()=>{
  const first=controller.preview('fleet',a),second=controller.preview('fleet',b);
  assert.strictEqual(first.organization,second.organization);
  assert.notDeepEqual(first.equipment.expected,second.equipment.expected);
  assert.deepEqual(controller.preview('fleet',{...a,ships:a.ships.slice().reverse()}).organization.targets,[2,1]);
  assert.equal(controller.preview('fleet',{...a,fleet:2}).organization.fleet,2);
  assert.throws(()=>controller.preview('organization',{fleet:1,ships:[{id:1,name:'wrong'}]}),/mismatch/);
 });
 assert.throws(()=>withEquipmentIndexCache(f.data,()=>{controller.preview('fleet',a);throw Error('abort');}),/abort/);
 f.data.info.fleets[0].api_mission=[1];
 assert.throws(()=>controller.preview('fleet',a),/expedition/);
 assert.throws(()=>withEquipmentIndexCache(f.data,()=>controller.preview('fleet',a)),/expedition/);
});

test('indexed planning preserves three-way borrows, cleared ownership and expansion moves',()=>{
 const f=fixture();f.data.info.ships[3]={api_ship_id:1,api_lv:20,api_slot:[104,105,106],api_slot_ex:-1};
 f.data.info.ships[2].api_slot_ex=-1;f.data.info.fleets[0].api_ship=[1,2,3];
 const schemes=[
  {fleet:1,ships:[{id:1,slots:[201,104,105],ex:-1},{id:2,slots:[101,102,106],ex:103},{id:3,slots:[107],ex:-1}]},
  {fleet:1,ships:[{id:3,slots:[101,201,102],ex:103},{id:1,slots:[106,105,104],ex:-1},{id:2,slots:[107],ex:-1}]},
 ];
 const expected=schemes.map(s=>f.api.resolvePlan(s)),before=JSON.stringify(f.data);
 withEquipmentIndexCache(f.data,()=>{
  for(let i=0;i<3;i++)schemes.forEach((s,j)=>assert.deepEqual(f.api.resolvePlan(s),expected[j]));
 });
 assert.equal(JSON.stringify(f.data),before);
 f.data.info.ships[3].api_slot=[105,104,106];
 for(const scheme of schemes){const live=f.api.resolvePlan(scheme);assert.deepEqual(withEquipmentIndexCache(f.data,()=>f.api.resolvePlan(scheme)),live);}
});
