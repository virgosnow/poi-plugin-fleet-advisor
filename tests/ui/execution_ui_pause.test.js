'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/workbench_fixture'),W=require('../../src/ui/workbench/workbench_model'),V=require('../../src/ui/models/presentation_model'),F=require('../../src/ui/fleet/current_fleet_model');
const {Controller}=require('../../src/application/controller');
const find=(node,predicate)=>node&&typeof node==='object'&&(predicate(node)?node:(node.children||[]).map(child=>find(child,predicate)).find(Boolean));
const text=node=>typeof node==='string'||typeof node==='number'?String(node):(node?.children||[]).map(text).join('');

function harness(t,create,options){
  const hooks=[],timeouts=[],intervals=[];let index=0,changed=false,pending=[],props={},tree;
  t.mock.method(global,'setTimeout',(fn,ms)=>{const timer={fn,ms,active:true};timeouts.push(timer);return timer;});
  t.mock.method(global,'clearTimeout',timer=>{if(timer)timer.active=false;});
  t.mock.method(global,'setInterval',(fn,ms)=>{const timer={fn,ms,active:true};intervals.push(timer);return timer;});
  t.mock.method(global,'clearInterval',timer=>{if(timer)timer.active=false;});
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),
    useState(initial){const i=index++;if(!(i in hooks))hooks[i]={value:typeof initial==='function'?initial():initial};return [hooks[i].value,value=>{const next=typeof value==='function'?value(hooks[i].value):value;if(!Object.is(next,hooks[i].value)){hooks[i].value=next;changed=true;}}];},
    useRef(initial){const i=index++;return hooks[i]||(hooks[i]={current:initial});},
    useEffect(fn,deps){const i=index++,previous=hooks[i];if(!previous||deps.some((value,j)=>!Object.is(value,previous.deps[j]))){pending.push(()=>{previous?.cleanup?.();hooks[i]={deps,cleanup:fn()};});}}
  };
  const Component=create(React,options),names=[...String(Component).split('React.useRef')[0].matchAll(/\[\s*(\w+)\s*,\s*\w+\s*\]\s*=\s*React\.useState\(/g)].map(m=>m[1]);
  const render=next=>{props={...props,...next};for(let turn=0;turn<15;turn++){changed=false;index=0;pending=[];tree=Component(props);for(const effect of pending)effect();if(!changed)return tree;}throw Error('Render did not settle');};
  t.after(()=>{for(const hook of hooks)hook?.cleanup?.();});
  return {render,get tree(){return tree;},set(name,value){const i=names.indexOf(name);assert(i>=0,name);hooks[i].value=value;},
    get(name){const i=names.indexOf(name);assert(i>=0,name);return hooks[i].value;},
    flushChecks(){const active=timeouts.filter(timer=>timer.active&&timer.ms===80);for(const timer of active){timer.active=false;timer.fn();}render();return active.length;},intervals,timeouts};
}

for(const kind of ['normal','expedition'])test(`${kind} application freezes calculations and refreshes once after success, failure or stop`,t=>{
  // Asset loading is unrelated to the execution lifecycle and needs no host.
  const mapLoading=require.cache[require.resolve('../../src/ui/maps/map_loading')]||require('../../src/ui/maps/map_loading')&&require.cache[require.resolve('../../src/ui/maps/map_loading')];
  t.mock.method(mapLoading,'exports',()=>()=>({status:'ready'}));
  let store=fixture();const controller=new Controller({getStore:()=>store});
  const service={getRecommendationFilters:()=>({}),createSnapshot:()=>({snapshotId:'readonly'}),listNormalMaps:()=>({maps:[]}),listExpeditions:()=>({missions:[]}),preview:(...args)=>controller.preview(...args),
    recommendNormalFleet:()=>assert.fail('Execution must not search'),recommendExpeditionFleet:()=>assert.fail('Execution must not search'),
    recommendNormalEquipment:()=>assert.fail('Execution must not fit'),recommendExpeditionEquipment:()=>assert.fail('Execution must not fit')};
  const inspect=t.mock.method(W,'inspect'),summary=t.mock.method(W,'fleetSummary'),rows=t.mock.method(V,'fleetRows'),preview=t.mock.method(service,'preview'),changes=t.mock.method(W,'changeSummary'),options=t.mock.method(W,'equipmentOptions');
  const spies=[inspect,summary,rows,preview,changes];
  const h=harness(t,require('../../src/ui/workbench/workbench'),{getStore:()=>store,getController:()=>service});
  h.render({kind,busy:false,hidden:false});h.set('slots',[W.entry(store,1),W.entry(store,2),null,null,null,null]);
  h.set('choices',[{key:'completed'}]); // Applying starts from a completed, inspected draft.
  h.render();h.flushChecks();
  for(const outcome of ['success','error','stopped']){
    const oldText=text(find(h.tree,n=>n.props.className==='paa-wb-ships'));
    h.set('popup',{index:0,slot:0});h.render({busy:true});const before=spies.map(spy=>spy.mock.callCount());
    assert.equal(options.mock.callCount(),0,'No candidate inventory scan when execution closes an open picker');
    assert.equal(h.intervals.filter(timer=>timer.active).length,0,'No page polling while applying');
    for(let i=0;i<6;i++){
      store={...store,info:{...store.info,ships:{...store.info.ships},equips:{...store.info.equips},fleets:store.info.fleets.slice()}};
      h.render({busy:true,stopping:i===5,operationFeedback:outcome+i});
      assert.equal(text(find(h.tree,n=>n.props.className==='paa-wb-ships')),oldText);
      assert(!find(h.tree,n=>n.props.role==='status'&&text(n).includes('计算中')));
    }
    assert.deepEqual(spies.map(spy=>spy.mock.callCount()),before);
    h.render({busy:false,stopping:false});assert.deepEqual(spies.map(spy=>spy.mock.callCount()),before,'Keep old view until the final validation is ready');
    assert.equal(h.flushChecks(),1,'One final validation for '+outcome);
    assert.deepEqual(spies.map(spy=>spy.mock.callCount()),before.map(n=>n+1));
    assert.equal(h.flushChecks(),0);
  }
  h.render({hidden:true});const before=[inspect,summary,rows].map(spy=>spy.mock.callCount());
  store={...store,info:{...store.info,ships:{...store.info.ships}}};h.render({hidden:true});
  assert.equal(h.intervals.filter(timer=>timer.active).length,0);assert.equal(h.flushChecks(),0);
  assert.deepEqual([inspect,summary,rows].map(spy=>spy.mock.callCount()),before);
  h.render({hidden:false});assert.equal(h.flushChecks(),1);
  assert.deepEqual([inspect,summary,rows].map(spy=>spy.mock.callCount()),before.map(n=>n+1));
});

test('workbench coalesces battle data updates until return while quest state stays live',t=>{
  const mapLoading=require.cache[require.resolve('../../src/ui/maps/map_loading')]||require('../../src/ui/maps/map_loading')&&require.cache[require.resolve('../../src/ui/maps/map_loading')];
  t.mock.method(mapLoading,'exports',()=>()=>({status:'ready'}));
  let store=fixture();store.info.basic.api_member_id=1;store.sortie={sortieStatus:[false,false,false,false]};
  const controller=new Controller({getStore:()=>store}),service={getRecommendationFilters:()=>({}),createSnapshot:()=>({snapshotId:'readonly'}),listNormalMaps:()=>({maps:[]}),preview:(...args)=>controller.preview(...args)};
  const inspect=t.mock.method(W,'inspect'),h=harness(t,require('../../src/ui/workbench/workbench'),{getStore:()=>store,getController:()=>service});
  h.render({kind:'normal',busy:false,hidden:false});h.set('slots',[W.entry(store,1),W.entry(store,2),null,null,null,null]);h.set('choices',[{key:'completed'}]);h.render();h.flushChecks();
  const oldRevision=h.get('revision'),oldInspections=inspect.mock.callCount(),slots=h.get('slots');
  const poll=()=>{const timer=h.intervals.find(timer=>timer.active&&String(timer.fn).includes('const next=getStore()'));assert(timer);timer.fn();h.render();};
  const questState={known:true,tasks:[{api_no:203,api_state:2}]};
  for(let i=0;i<3;i++){
    store={...store,questState,sortie:{sortieStatus:[true,false,false,false]},info:{...store.info,ships:{...store.info.ships},maps:{...store.info.maps}}};poll();
    assert.equal(h.get('revision'),oldRevision);assert.equal(h.get('questState'),questState);assert.equal(h.get('slots'),slots);
    assert.equal(h.flushChecks(),0);assert.equal(inspect.mock.callCount(),oldInspections);
    assert(!find(h.tree,n=>n.props.className==='paa-wb-calculating'));
  }
  store={...store,sortie:{sortieStatus:[false,false,false,false]}};poll();assert.equal(h.get('revision'),oldRevision+1);
  assert.equal(h.flushChecks(),1);assert.equal(inspect.mock.callCount(),oldInspections+1);
  poll();assert.equal(h.get('revision'),oldRevision+1);assert.equal(h.flushChecks(),0);
});

test('airbase changes refresh the selected map while keeping the draft',t=>{
  const mapLoading=require.cache[require.resolve('../../src/ui/maps/map_loading')]||require('../../src/ui/maps/map_loading')&&require.cache[require.resolve('../../src/ui/maps/map_loading')];
  t.mock.method(mapLoading,'exports',()=>()=>({status:'ready'}));
  const store=fixture();store.info.basic.api_member_id=1;
  store.info.airbase=[{api_area_id:6,api_rid:1,api_action_kind:1,api_distance:{api_base:5,api_bonus:0},
    api_plane_info:[{api_squadron_id:1,api_slotid:0,api_state:0}]}];
  const service={getRecommendationFilters:()=>({}),createSnapshot:()=>({snapshotId:'readonly'}),listNormalMaps:()=>({maps:[]})};
  const h=harness(t,require('../../src/ui/workbench/workbench'),{getStore:()=>store,getController:()=>service});
  h.render({kind:'normal',busy:false,hidden:false});h.set('area','6-4');h.render();h.flushChecks();
  const draft=h.get('slots'),oldRevision=h.get('revision');
  store.info.airbase[0].api_distance.api_base=7;
  const timer=h.intervals.find(timer=>timer.active&&String(timer.fn).includes('const next=getStore()'));
  assert(timer);timer.fn();h.render();h.flushChecks();
  assert.equal(h.get('revision'),oldRevision+1);assert.equal(h.get('slots'),draft);
  assert(find(h.tree,n=>n.props['aria-label']==='航程 7'));
  h.render({busy:true});store.info.airbase[0].api_distance.api_base=9;h.render({busy:true});
  assert(find(h.tree,n=>n.props['aria-label']==='航程 7'),'execution keeps the displayed state fixed');
  h.render({busy:false});h.flushChecks();
  assert(find(h.tree,n=>n.props['aria-label']==='航程 9'));
});

test('workbench does not defer an account change during a sortie',t=>{
  const mapLoading=require.cache[require.resolve('../../src/ui/maps/map_loading')]||require('../../src/ui/maps/map_loading')&&require.cache[require.resolve('../../src/ui/maps/map_loading')];
  t.mock.method(mapLoading,'exports',()=>()=>({status:'ready'}));
  let store=fixture();store.info.basic.api_member_id=1;store.sortie={sortieStatus:[true,false,false,false]};
  const h=harness(t,require('../../src/ui/workbench/workbench'),{getStore:()=>store,getController:()=>({getRecommendationFilters:()=>({}),createSnapshot:()=>({snapshotId:'readonly'}),listNormalMaps:()=>({maps:[]})})});
  h.render({kind:'normal',busy:false,hidden:false});const previous=h.get('revision');
  store={...store,info:{...store.info,basic:{...store.info.basic,api_member_id:2}}};
  const timer=h.intervals.find(timer=>timer.active&&String(timer.fn).includes('const next=getStore()'));assert(timer);timer.fn();h.render();
  assert.equal(h.get('revision'),previous+1);
});

test('a never-opened workbench does not build catalogs, validate or calculate until shown',t=>{
  const mapLoading=require.cache[require.resolve('../../src/ui/maps/map_loading')]||require('../../src/ui/maps/map_loading')&&require.cache[require.resolve('../../src/ui/maps/map_loading')];
  t.mock.method(mapLoading,'exports',()=>()=>({status:'ready'}));
  const store=fixture(),inspect=t.mock.method(W,'inspect'),rows=t.mock.method(V,'fleetRows');let snapshots=0;
  const h=harness(t,require('../../src/ui/workbench/workbench'),{getStore:()=>store,getController:()=>({getRecommendationFilters:()=>({}),createSnapshot:()=>{snapshots++;return {snapshotId:'test'};},listNormalMaps:()=>({maps:[]})})});
  h.render({kind:'normal',hidden:true,busy:false});h.render({busy:true});h.render({busy:false});
  assert.equal(snapshots,0);assert.equal(inspect.mock.callCount(),0);assert.equal(rows.mock.callCount(),0);assert.equal(h.flushChecks(),0);
});

test('quest bootstrap follows the visible editable page without changing drafts or invoking recommendations',t=>{
  const mapLoading=require.cache[require.resolve('../../src/ui/maps/map_loading')]||require('../../src/ui/maps/map_loading')&&require.cache[require.resolve('../../src/ui/maps/map_loading')];
  t.mock.method(mapLoading,'exports',()=>()=>({status:'ready'}));
  const store=fixture(),calls=[],service={getRecommendationFilters:()=>({}),createSnapshot:()=>({snapshotId:'read-only'}),listNormalMaps:()=>({maps:[]})};
  const h=harness(t,require('../../src/ui/workbench/workbench'),{getStore:()=>store,getController:()=>service,
    setQuestPageActive:(owner,active)=>calls.push([owner,active])});
  h.render({kind:'normal',hidden:true,busy:false});assert.equal(calls.at(-1)[1],false);
  h.render({hidden:false});assert.deepEqual(calls.at(-1),['normal',true]);
  const slots=[W.entry(store,2),null,null,null,null,null];h.set('slots',slots);h.render();
  h.set('working',true);h.render();assert.equal(calls.at(-1)[1],false);
  h.set('working',false);h.render();assert.equal(calls.at(-1)[1],true);
  h.render({busy:true});assert.equal(calls.at(-1)[1],false);
  h.render({busy:false,hidden:true});assert.equal(calls.at(-1)[1],false);
  h.render({hidden:false});assert.equal(calls.at(-1)[1],true);
  assert.equal(h.get('slots'),slots,'page activation preserves the selected draft');
});

test('current fleets retain visible members and mechanisms while busy and read fresh data once on resume',t=>{
  t.mock.method(Date,'now',()=>1000);let store=fixture();store.info.fleets[0].api_ship=[1,2];
  const inspect=t.mock.method(F,'inspect'),summary=t.mock.method(F,'summarize');
  const h=harness(t,require('../../src/ui/fleet/current_fleet'),{getStore:()=>store});
  h.render({hidden:false,busy:false});const oldText=text(find(h.tree,n=>n.props.className==='paa-wb-ships')),before=[inspect.mock.callCount(),summary.mock.callCount()];
  h.render({busy:true});assert.equal(h.intervals.filter(timer=>timer.active).length,0);
  for(let i=0;i<6;i++){store={...store,info:{...store.info,ships:{...store.info.ships}}};h.render({stopping:i===5});assert.equal(text(find(h.tree,n=>n.props.className==='paa-wb-ships')),oldText);}
  h.render({busy:false,hidden:true});assert.deepEqual([inspect.mock.callCount(),summary.mock.callCount()],before);
  h.render({hidden:false});assert.deepEqual([inspect.mock.callCount(),summary.mock.callCount()],[before[0]+1,before[1]]);
});

test('progress and elapsed time update only the feedback component and unsubscribe when finished',t=>{
  let listener,off=0,now=1000;t.mock.method(Date,'now',()=>now);
  const progressRef={current:''},h=harness(t,require('../../src/ui/components/execution_feedback'),{getStore:()=>fixture(),subscribe:fn=>{listener=fn;return()=>off++;}});
  h.render({running:true,busy:true,stopping:false,status:{state:'running'},progressRef});
  listener({phase:'equipment',ship:1,slot:2});now=2250;h.intervals.find(timer=>timer.active).fn();
  assert(text(h.render()).includes('调整普通槽 2'));assert(text(h.tree).includes('1.3 秒'));assert(progressRef.current.includes('调整普通槽 2'));
  assert(text(h.render({stopping:true})).includes('正在停止后续操作'));
  h.render({running:false,busy:false,status:{state:'success',text:'配置已完成'}});assert.equal(off,1);assert.equal(h.intervals.filter(timer=>timer.active).length,0);assert(text(h.tree).includes('配置已完成'));
});

test('execution errors use stable codes for Japanese and Traditional Chinese while preserving diagnostics',t=>{
  const i18n=require('../../src/shared/i18n'),h=harness(t,require('../../src/ui/components/execution_feedback'),{getStore:()=>fixture(),subscribe:()=>()=>{}});
  const raw='检测到远征归港，已停止编成。请先在游戏中处理归港，并核对可能已生效的部分编成后再重试。';
  const status={state:'error',text:raw,errorCode:'EXPEDITION_RETURN_REQUIRED'},props={running:false,busy:false,status,detail:'original stack: '+raw};
  try{
    i18n.setLocale('ja-JP');h.render(props);assert.match(text(find(h.tree,n=>n.props.role==='alert')),/遠征の帰投/);
    assert.match(text(find(h.tree,n=>n.type==='pre')),/检测到远征归港/);
    i18n.setLocale('zh-TW');h.render();assert.match(text(find(h.tree,n=>n.props.role==='alert')),/偵測到遠征歸港/);
    i18n.setLocale('zh-CN');h.render();assert.equal(text(find(h.tree,n=>n.props.role==='alert')),raw);
    i18n.setLocale('ja-JP');h.render({status:{state:'error',text:'unmapped detail',errorCode:'UNKNOWN'}});
    assert.equal(text(find(h.tree,n=>n.props.role==='alert')),'unmapped detail');
    for(const code of ['OBSERVATION_TIMEOUT','EQUIPMENT_CONFIRMATION_TIMEOUT','NAV_SCREEN_NOT_RECOGNIZED','NAV_RETURN_NOT_CONFIRMED','NAV_UNEXPECTED_SCREEN','NAV_SWITCH_FAILED']){
      h.render({status:{state:'error',text:'untranslated diagnostic',errorCode:code}});
      assert.notEqual(text(find(h.tree,n=>n.props.role==='alert')),'untranslated diagnostic',code);
    }
  }finally{i18n.setLocale('zh-CN');}
});

test('execution cards follow confirmed per-ship events and do not recalculate the fleet',t=>{
 const listeners=new Set(),store=fixture(),inspect=t.mock.method(W,'inspect'),summary=t.mock.method(W,'fleetSummary');
 store.info.fleets[0].api_ship=[1,2];
 const h=harness(t,require('../../src/ui/components/execution_card'),{getStore:()=>store,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}});
 const send=event=>{listeners.forEach(fn=>fn(event));return h.render();};
 const progress=()=>find(h.tree,n=>n.props.role==='progressbar');
 h.render({running:true,fleet:1,index:1,ship:8});assert(text(h.tree).includes('等待编入'));
 send({phase:'picker',fleet:1,target:8});assert(text(h.tree).includes('正在编入'));
 send({phase:'organized',fleet:1,ship:8});assert(text(h.tree).includes('已编入'));
 send({phase:'equipment-start',fleet:1,completed:[]});assert(text(h.tree).includes('等待换装'));
 send({phase:'equipment',fleet:1,ship:8,operation:'clear',completed:0,total:4});assert(text(h.tree).includes('正在卸下装备'));
 send({phase:'equipment-step',fleet:1,ship:2,completed:1,total:2});assert(text(h.tree).includes('正在卸下装备'));
 send({phase:'equipment-step',fleet:2,ship:8,completed:1,total:2});assert(text(h.tree).includes('正在卸下装备'));
 send({phase:'equipment-step',fleet:1,ship:8,completed:2,total:4});assert.equal(progress().props['aria-valuenow'],65);
 h.render({stopping:true});assert(text(h.tree).includes('正在停止'));
 send({phase:'equipment-done',fleet:1,ship:8});assert(text(h.tree).includes('已换装完毕'));assert.equal(progress().props['aria-valuenow'],100);
 h.render({running:false});assert.equal(h.tree,null);assert.equal(listeners.size,0);
 h.render({running:true,stopping:false,ship:1,index:0});assert(text(h.tree).includes('已编入'));
 send({phase:'equipment-start',fleet:1,completed:[1]});assert(text(h.tree).includes('已换装完毕'));
 assert.equal(inspect.mock.callCount(),0);assert.equal(summary.mock.callCount(),0);
});

test('practice application attaches shared progress to matching ships and keeps stop available',t=>{
 const store=fixture();store.practiceState={known:true,opponents:[],revision:1};store.questState={known:true,tasks:[]};
 store.info.fleets=[{api_ship:[1,2],api_mission:[0]},{api_ship:[],api_mission:[1]},{api_ship:[],api_mission:[0]}];
 const service={preview:()=>({})},h=harness(t,require('../../src/ui/practice/practice_page'),{getStore:()=>store,getController:()=>service,subscribe:()=>()=>{}});
 let stopped=0;h.render({kind:'practice',automaticOperations:true,onStop:()=>stopped++});
 h.set('slots',[W.entry(store,1),W.entry(store,2),null,null,null,null]);
 h.render({busy:true,executionPlan:{fleet:1,targets:[1,99]}});
 const card=id=>find(h.tree,n=>n.props['data-ship-id']===id);
 const progress=id=>find(card(id),n=>n.type?.name==='ExecutionCard');
 assert.equal(progress(1).props.running,true);assert.equal(progress(1).props.ship,1);assert.equal(progress(1).props.index,0);
 assert.equal(progress(2).props.running,false);
 const stop=find(h.tree,n=>n.props.className==='paa-primary paa-wb-apply');stop.props.onClick({});assert.equal(stopped,1);
 h.render({stopping:true});assert.equal(progress(1).props.stopping,true);
 find(h.tree,n=>n.props.className==='paa-primary paa-wb-apply').props.onClick({});assert.equal(stopped,1);
 h.render({busy:false,stopping:false});assert.equal(progress(1).props.running,false);
 const options=find(h.tree,n=>n.type?.name==='FleetTargetPicker').props.options;
 assert.equal(options[0].disabled,false);assert.equal(options[1].disabled,true);assert.match(options[1].label,/远征中/);
 assert.equal(options[3].disabled,true);assert.match(options[3].label,/未同步/);
 h.render({busy:true,executionPlan:{fleet:2,targets:[1,2]}});assert.equal(progress(1).props.running,false);
});

test('practice application keeps the visible snapshot and refreshes preview after stopping',t=>{
 let store=fixture();store.practiceState={known:true,opponents:[],revision:1};store.questState={known:true,tasks:[]};
 const service={preview:()=>({})},preview=t.mock.method(service,'preview');
 const h=harness(t,require('../../src/ui/practice/practice_page'),{getStore:()=>store,getController:()=>service,subscribe:()=>()=>{}});
 h.render({kind:'practice',busy:false});h.set('slots',[W.entry(store,1),null,null,null,null,null]);h.render();
 const before=preview.mock.callCount(),oldName=store.const.$ships[store.info.ships[1].api_ship_id].api_name;
 h.render({busy:true,executionPlan:{fleet:1,targets:[1]}});
 store={...store,const:{...store.const,$ships:{...store.const.$ships,[store.info.ships[1].api_ship_id]:{...store.const.$ships[store.info.ships[1].api_ship_id],api_name:'更新舰名'}}}};
 h.render({busy:true,stopping:true});assert.equal(preview.mock.callCount(),before);assert(text(h.tree).includes(oldName));assert(!text(h.tree).includes('更新舰名'));
 h.render({busy:false,stopping:false});assert.equal(preview.mock.callCount(),before+1);assert(text(h.tree).includes('更新舰名'));
});

test('job polling never keeps a finished local run busy; MCP jobs still expose stopping',async t=>{
  let finish,job=null,cancelled=0;
  const status=()=>({mcpEnabled:false,activeJobId:job?.jobId||null,mcpHttp:{active:false}});
  const service={getExperimentalSettings:()=>({automaticOperations:true}),preview:()=>({done:false}),run:()=>{job={jobId:'local',source:'panel',state:'running'};return new Promise(resolve=>finish=resolve);},
    getJob:()=>({...job}),cancelJob:()=>{cancelled++;job={...job,state:'stopping'};}};
  const h=harness(t,require('../../src/ui/shell/panel'),{getController:()=>service,getStore:()=>fixture(),subscribe:()=>()=>{},getMcpStatus:status});
  h.render();find(h.tree,n=>n.type==='button'&&n.children.includes('常规海域')).props.onClick();h.render();
  const normal=()=>find(h.tree,n=>n.type?.name==='Workbench'&&n.props.kind==='normal');
  const pending=normal().props.onApply({fleet:1,ships:[1]});h.render();
  const poll=()=>{h.intervals.find(timer=>timer.active&&timer.ms===1000).fn();h.render();};
  poll();assert(normal().props.busy);job=null;finish({ok:true,done:true,changed:1});await pending;h.render();
  assert.equal(normal().props.busy,false,'Local completion does not wait for the next agent poll');
  job={jobId:'external',source:'mcp',state:'running'};poll();assert(normal().props.busy);
  normal().props.onStop();h.render();assert.equal(cancelled,1);assert(normal().props.stopping);
  job=null;poll();assert.equal(normal().props.busy,false);
});
