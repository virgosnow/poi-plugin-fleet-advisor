'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/workbench_fixture'),W=require('../../src/ui/workbench/workbench_model');
const {Controller}=require('../../src/application/controller');
const {recommendNormalEquipment}=require('../../src/recommendation/index');

test('equipment-only recommendation keeps exact hulls, gaps, pins and manually reserved equipment',()=>{
  const store=fixture();
  store.const.$equips[500]={api_id:500,api_name:'测试主炮',api_type:[0,0,1,1],api_houg:5};
  store.const.$shipTypes[2]={api_equip_type:{1:1}};
  for(let i=101;i<110;i++)store.info.equips[i]={api_id:i,api_slotitem_id:500,api_level:0};
  const slots=[{...W.entry(store,2),slots:[101,-1],keep:{0:true},pin:true},null,W.entry(store,3),null,null,null];
  const before=JSON.stringify({store,slots});
  const result=recommendNormalEquipment(store,{area:'1-1',scheme:W.scheme(slots,1),heldSlots:slots.filter(Boolean)});
  const next=W.withEquipment(slots,result.scheme);
  assert.deepEqual(next.map(s=>s?.id||null),[2,null,3,null,null,null]);
  assert(next[0].pin);assert(next[0].keep[0]);assert.equal(next[0].slots[0],101);
  assert(next[2].slots.some(id=>id>0),'replacement gets an actual equipment suggestion');
  const items=next.filter(Boolean).flatMap(s=>s.slots.concat(s.ex)).filter(id=>id>0);
  assert.equal(new Set(items).size,items.length);
  assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',W.scheme(next,1)));
  assert.equal(JSON.stringify({store,slots}),before);
  assert.throws(()=>W.withEquipment(slots,{ships:result.scheme.ships.slice().reverse()}),/顺序/);
});

test('expedition workbench preserves fixed flagship and separates conditions from probability bonuses',async()=>{
  const h=harness('expedition'),expeditions=require('../../src/domain/expeditions/expeditions');
  for(let id=2;id<=8;id++)h.store.info.ships[id].api_taisen=[60,60];
  h.store.info.ships[2].api_lv=127;
  for(const id of [2,3,4,5])h.store.info.ships[id].api_cond=60;
  h.set('missionId',101);h.set('catalog',expeditions.listExpeditions(h.store));
  h.set('slots',[{...W.entry(h.store,2),pin:true},null,null,null,null,null]);
  let query;h.service.recommendExpeditionFleet=args=>{query=args;return require('../../src/recommendation/index').recommendExpeditionFleet(h.store,args);};
  let tree=h.render();await h.find(tree,n=>n.props.className==='paa-wb-complete').props.onClick();
  assert.equal(query.fixedFlagshipId,2);assert.equal(h.get('slots')[0].id,2);
  const final=expeditions.evaluateExpedition(W.projected(h.store,h.get('slots'),2),2,101);
  h.set('report',{valid:true,expedition:final,scheme:W.scheme(h.get('slots'),2),
    settingsKey:JSON.stringify({kind:'expedition',fleet:2,area:'3-5',target:'boss',phase:'',missionId:101,revision:0})});tree=h.render();
  const text=node=>typeof node==='string'?node:(node?.children||[]).map(text).join(' ');
  const content=text(tree).replace(/\s+/g,' ');
  assert(content.includes('大成功 100%'));assert(content.includes('成功 0%'));assert(content.includes('全部满足'));
  assert(text(tree).includes('总对潜'));
  assert(!h.find(tree,n=>n.props.className==='paa-exp-probability'));
  const outcome=h.find(tree,n=>n.props.className==='paa-exp-outcome');
  assert(!h.find(outcome,n=>n.props.className==='paa-exp-duration'));
  assert(h.find(tree,n=>n.props['aria-label']==='远征时间'));
  assert(h.find(tree,n=>n.props['aria-label']==='舰队远征状态'));
  assert(h.find(tree,n=>n.props['data-mechanism']==='expedition-morale'));
  assert(!h.find(tree,n=>n.props['data-mechanism']==='speed'),'expedition cards focus on morale and drums');
  assert(!text(tree).includes('gsFlagshipHighestLevel'));
});

test('hourly income selection preserves the draft, while changing expedition clears it and keeps the income unit',()=>{
  const h=harness('expedition');let searches=0;
  h.service.recommendExpeditionFleet=()=>{searches++;throw Error('Income unit must not search');};
  h.set('slots',[W.entry(h.store,2),null,null,null,null,null]);
  const settle=()=>h.set('report',{valid:true,scheme:W.scheme(h.get('slots'),2),settingsKey:JSON.stringify({kind:'expedition',fleet:2,area:'3-5',target:'boss',phase:'',missionId:h.get('missionId'),revision:0})});
  settle();
  const hourly=h.find(h.render(),n=>n.type==='button'&&n.children.includes('每小时'));
  hourly.props.onClick();
  assert.equal(h.get('incomeUnit'),'hour');
  assert.equal(h.find(h.render(),n=>n.props['aria-label']==='扣补给后的远征收益').props['data-unit'],'hour');
  h.find(h.render(),n=>n.type?.name==='AreaPicker').props.onChange(21);
  settle();
  assert.equal(h.find(h.render(),n=>n.type==='button'&&n.children.includes('每小时')).props['aria-pressed'],true);
  assert(h.get('slots').every(s=>s===null));assert.equal(searches,0);
});

test('expedition selection clears drafts and late recommendations cannot refill the previous expedition',async()=>{
  const h=harness('expedition');let finish;
  h.service.recommendExpeditionFleet=()=>new Promise(resolve=>{finish=resolve;});
  const pending=h.find(h.render(),n=>n.props.className==='paa-wb-complete').props.onClick();
  await new Promise(r=>setTimeout(r,30));assert(finish);
  h.set('slots',[W.entry(h.store,2),null,null,null,null,null]);h.set('excluded',[8]);
  h.set('search','旧搜索');h.set('popup',{index:0});h.set('error','旧错误');h.set('choices',[{key:'old'}]);
  const before=JSON.stringify(h.store);
  h.find(h.render(),n=>n.type?.name==='AreaPicker').props.onChange(37);h.render();
  finish({recommendations:[{scheme:{fleet:2,ships:[{id:2}]}}]});await pending;
  assert.equal(h.get('missionId'),37);assert(h.get('slots').every(s=>s===null));assert.deepEqual(h.get('choices'),[]);
  assert.deepEqual(h.get('excluded'),[]);assert.equal(h.get('popup'),null);assert.equal(h.get('draftContext'),null);
  for(const name of ['search','error','activity'])assert.equal(h.get(name),'');
  assert.equal(h.get('working'),false);assert.equal(JSON.stringify(h.store),before);
});

test('expedition goal changes request the new target immediately and replace automatic hulls',async()=>{
  const h=harness('expedition'),queries=[];
  h.service.recommendExpeditionFleet=args=>{queries.push(args);return {recommendations:[{scheme:{fleet:2,ships:[{id:args.goal==='success'?7:1},{id:2}]}}]};};
  for(const goal of ['success','great']){
    const pending=h.chooseGoal(h.render(),goal);h.render();await pending;
    assert.equal(queries.at(-1).goal,goal);assert.equal(h.get('goal'),goal);
    assert.equal(h.get('slots')[0].id,goal==='success'?7:1);
    assert.equal(JSON.parse(h.get('draftContext'))[7],goal);
  }
  assert.equal(queries.length,2);
});

test('expedition single-ship replacement fits drums without searching or replacing the other hulls',async()=>{
  const h=harness('expedition');h.set('missionId',37);
  h.store.const.$equips[75]={api_id:75,api_name:'ドラム缶',api_type:[0,0,25,30]};
  for(const type of [2,3])h.store.const.$shipTypes[type]={api_equip_type:{25:1}};
  for(let id=101;id<=106;id++)h.store.info.equips[id]={api_id:id,api_slotitem_id:75};
  const slots=[1,2,3,4,5,6].map(id=>W.entry(h.store,id));slots[5].slots[0]=101;slots[5].keep={0:true};h.set('slots',slots);
  let fits=0;h.service.recommendExpeditionFleet=()=>{throw Error('Must not search hulls');};
  h.service.recommendExpeditionEquipment=args=>{fits++;return require('../../src/recommendation/index').recommendExpeditionEquipment(h.store,args);};
  h.set('popup',{index:1});
  const button=h.find(h.render(),n=>n.type==='button'&&n.children.some(c=>c?.children?.some(v=>v?.children?.includes('测试舰8'))));
  assert(button);await button.props.onClick();
  assert.equal(fits,1);assert.deepEqual(h.get('slots').map(s=>s?.id),[1,8,3,4,5,6]);
  assert.equal(h.get('slots')[5].slots[0],101);
  const result=require('../../src/domain/expeditions/expeditions').evaluateExpedition(W.projected(h.store,h.get('slots'),2),2,37);
  assert(result.eligible);assert.equal(result.greatSuccess.drums,5);assert(result.greatSuccess.drumCarriers>=3);
});

test('unlock prerequisite links navigate expeditions, clear drafts and do not start recommendations',()=>{
  const h=harness('expedition'),missions=require('../../src/domain/expeditions/expeditions').listExpeditions(h.store);
  h.set('catalog',missions);h.set('missionId',43);
  h.store.expeditionProgress={period:'2026-10',records:{},list:{period:'2026-10',ids:[],catalogIds:missions.map(m=>m.missionId)}};
  let searches=0;h.service.recommendExpeditionFleet=()=>{searches++;throw Error('Navigation must not search');};
  const before=JSON.stringify(h.store);
  const link=()=>h.find(h.render(),n=>n.props['data-mission-id']===42);
  assert(link());assert.equal(link().type,'button');assert.equal(link().props.disabled,false);
  assert.equal(h.find(h.render({busy:true}),n=>n.props['data-mission-id']===42).props.disabled,true);
  h.find(h.render({busy:true}),n=>n.props['data-mission-id']===42).props.onClick();assert.equal(h.get('missionId'),43);
  const navigate=link().props.onClick;
  h.set('slots',[W.entry(h.store,2),null,null,null,null,null]);h.set('excluded',[8]);h.set('choices',[{key:'old'}]);
  h.set('search','旧搜索');h.set('popup',{index:0});
  navigate();
  assert.equal(h.get('missionId'),42);assert(h.get('slots').every(s=>s===null));assert.deepEqual(h.get('choices'),[]);
  assert.deepEqual(h.get('excluded'),[]);assert.equal(h.get('popup'),null);assert.equal(h.get('draftContext'),null);
  for(const name of ['search',])assert.equal(h.get(name),'');
  assert.equal(h.find(h.render(),n=>n.type?.name==='AreaPicker').props.value,42);
  assert(h.find(h.render(),n=>n.props['data-mission-id']===41),'locked prerequisite can continue to its own prerequisite');
  h.set('missionId',23);
  const map=h.find(h.render(),n=>n.type==='span'&&n.children.includes('通关海域 1-5'));
  assert(map);assert.equal(map.props.onClick,undefined);
  assert.equal(searches,0);assert.equal(JSON.stringify(h.store),before);
});

function harness(kind='normal',automaticFilters){
  const state=[],refs=[],effects=[];let index=0,refIndex=0;
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),
    useState(initial){const i=index++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;
      return [state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];},
    useRef(initial){const i=refIndex++;return refs[i]||(refs[i]={current:initial});},useEffect:(fn,deps)=>effects.push({fn,deps})};
  const store=fixture(),controller=new Controller({getStore:()=>store}),calls={fleet:0,equipment:0};
  const plan=(id,routeKey)=>({routeKey,scheme:W.scheme([W.entry(store,id)],1)});
  const service={createSnapshot:()=>({snapshotId:'test'}),preview:(...args)=>controller.preview(...args),
    recommendNormalFleet:()=>{calls.fleet++;return {recommendations:[plan(2,'guide:3-5-01'),plan(1,'guide:3-5-05')]};},
    recommendNormalEquipment:args=>{calls.equipment++;return {scheme:args.scheme};}};
  const Workbench=require('../../src/ui/workbench/workbench')(React,{getController:()=>service,getStore:()=>store});
  const names=[...String(Workbench).split('React.useRef')[0].matchAll(/\[\s*(\w+)\s*,\s*\w+\s*\]\s*=\s*React\.useState\(/g)].map(m=>m[1]);
  const stateIndex=name=>{const index=names.indexOf(name);assert(index>=0,'Unknown workbench state: '+name);return index;};
  const get=name=>state[stateIndex(name)],set=(name,value)=>{state[stateIndex(name)]=value;};
  const render=(props={})=>{index=0;refIndex=0;return Workbench({kind,busy:false,automaticFilters,automaticOperations:true,...props});};
  const find=(node,predicate)=>{if(!node||typeof node!=='object')return;return predicate(node)?node:node.children?.map(n=>find(n,predicate)).find(Boolean);};
  const control=(tree,label)=>{
    if(['参考路线','攻略流派'].includes(label)){
      const picker=find(tree,n=>n.type?.name==='RoutePicker');
      return picker?{...picker,props:{...picker.props,onChange:e=>picker.props.onChange(e.target.value)},
        children:[['','选择路线'],...picker.props.options.map(o=>[o.key,o.label])].map(([value,label])=>({type:'option',props:{value},children:[label]}))}:null;
    }
    return find(tree,n=>n.props['aria-label']===label);
  };
  const chooseGoal=(tree,goal)=>find(tree,n=>n.type==='button'&&n.children.includes(goal==='great'?'优先大成功':'成功即可')).props.onClick();
  render();set('area','3-5');set('catalog',[{area:'3-5',bossNodes:['K']},{area:'1-1',bossNodes:['B']}]);
  return {render,find,control,chooseGoal,get,set,service,calls,store,effects,refs};
}

test('map node selection never replaces route-level combat assessment or its two threat cards',()=>{
  const h=harness(),slots=[W.entry(h.store,2)],settings={kind:'normal',fleet:1,area:'1-1',target:'boss',phase:'',missionId:1,revision:0};
  h.set('area','1-1');h.set('slots',slots);h.set('mapRoute',W.mapOverview('1-1').options[0].key);
  h.set('report',W.inspect(h.service,h.store,slots,settings));
  const section=()=>h.find(h.render(),n=>n.props.className==='paa-wb-threat');
  const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join(' ');
  const before=text(section());assert.match(before,/战况预测/);assert.match(before,/最大威胁/);
  assert.doesNotMatch(before,/目标点最大威胁|道中最大威胁|资料待确认/);
  h.set('nodeId','A');assert.equal(text(section()),before);
  h.set('nodeId','C');assert.equal(text(section()),before);
  h.set('nodeId',null);assert.equal(text(section()),before);
  assert.equal(h.calls.fleet+h.calls.equipment,0);
});

test('battle comparison result appears beside its heading without hover details',()=>{
  const h=harness(),ship=h.store.info.ships[1],master=h.store.const.$ships[1];
  Object.assign(ship,{api_nowhp:30,api_maxhp:30,api_soukou:[12,12],api_karyoku:[35,35],api_raisou:[30,30],api_kyouka:[0,0,0,0],api_lucky:[20,20]});
  Object.assign(master,{api_houg:[35,35],api_raig:[30,30],api_leng:2});
  const slots=[W.entry(h.store,1)],settings={kind:'normal',fleet:1,area:'1-1',target:'boss',phase:'',missionId:1,revision:0};
  h.set('area','1-1');h.set('slots',slots);h.set('mapRoute',W.mapOverview('1-1').options[0].key);
  h.set('report',W.inspect(h.service,h.store,slots,settings));
  const section=()=>h.find(h.render(),n=>n.props.className==='paa-wb-threat');
  const head=h.find(section(),n=>n.props.className==='paa-wb-section-head');
  const tier=h.find(head,n=>n.props.className==='paa-balance-tier');
  assert(tier);assert.equal(tier.props['data-tooltip'],undefined);
  const comparison=h.find(section(),n=>n.props.className==='paa-combat-balance');
  assert(comparison);assert.equal(comparison.props['data-tooltip'],undefined);
  assert.equal(h.find(comparison,n=>n.props.className==='paa-balance-tier'),undefined);
  assert(!head.children.some(child=>child?.props?.className==='paa-muted'));
  const toggle=h.find(head,n=>n.props.className==='paa-balance-toggle');
  assert(toggle);assert.equal(toggle.props['aria-expanded'],false);
  const detail=()=>h.find(section(),n=>n.props.id==='normal-combat-details');
  assert.equal(detail().props['aria-hidden'],true);assert.equal(detail().props.inert,'');
  toggle.props.onClick();assert.equal(h.find(section(),n=>n.props.className==='paa-balance-toggle').props['aria-expanded'],true);
  assert.equal(detail().props['aria-hidden'],false);assert.equal(detail().props.inert,undefined);
  h.find(section(),n=>n.props.className==='paa-balance-toggle').props.onClick();
  assert.equal(detail().props['aria-hidden'],true);
  assert.equal(h.find(head,n=>n.props.className==='paa-balance-title').children[0],'战况预测');
  const click=(target={},selection=null,extra={})=>({button:0,target,currentTarget:{ownerDocument:{getSelection:()=>selection},contains:()=>true},...extra});
  assert.equal(section().props['data-expandable'],true);
  section().props.onClick(click({closest:()=>null}));assert.equal(detail().props['aria-hidden'],false);
  section().props.onClick(click({closest:selector=>selector.includes('.paa-threat-cards')?{}:null}));assert.equal(detail().props['aria-hidden'],false,'threat cards do not toggle the prediction details');
  section().props.onClick(click({closest:()=>({})}));assert.equal(detail().props['aria-hidden'],false,'nested controls and details remain independently usable');
  section().props.onClick(click({closest:()=>null},{isCollapsed:false,anchorNode:{}}));assert.equal(detail().props['aria-hidden'],false,'selecting text does not toggle');
  section().props.onClick(click({closest:()=>null},null,{button:2}));assert.equal(detail().props['aria-hidden'],false,'secondary click does not toggle');
  section().props.onClick(click({closest:()=>null}));assert.equal(detail().props['aria-hidden'],true);
  h.set('report',{valid:false});
  const calculating=h.render(),region=h.find(calculating,n=>n.props['data-result-region']==='route');
  assert.equal(region.props['aria-busy'],true);
  assert.equal(h.find(region,n=>n.props.className==='paa-wb-calculation-content').props['aria-hidden'],true);
  assert(h.find(region,n=>n.props.className==='paa-wb-calculating'));
  h.set('report',{valid:false,scheme:W.scheme(slots,1),settingsKey:JSON.stringify(settings)});
  const pending=section();assert.equal(h.find(pending,n=>n.props.className==='paa-balance-tier'),undefined);
  assert(h.find(pending,n=>n.props.className==='paa-balance-pending'));
});

test('1-6 noncombat destination shows two distinct enroute enemies under one title',()=>{
  const h=harness();h.set('area','1-6');h.set('target','N');h.set('mapRoute',W.mapOverview('1-6','N').options[0].key);
  const tree=h.render(),findAll=(node,pred)=>!node||typeof node!=='object'?[]:
    [...(pred(node)?[node]:[]),...(node.children||[]).flatMap(child=>findAll(child,pred))];
  const section=h.find(tree,n=>n.props.className==='paa-wb-threat');
  const cards=findAll(section,n=>n.props.className==='paa-threat-card');
  const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join(' ');
  assert.equal(cards.length,2);assert.match(text(section),/最大威胁/);
  assert.notEqual(text(cards[0]),text(cards[1]));assert.doesNotMatch(text(section),/资料待确认/);
});
test('battle target keeps target then enroute threat as independent cards',()=>{
  const h=harness(),slots=[W.entry(h.store,2)],settings={kind:'normal',fleet:1,area:'1-1',target:'boss',phase:'',missionId:1,revision:0};
  h.set('area','1-1');h.set('slots',slots);h.set('mapRoute',W.mapOverview('1-1').options[0].key);
  h.set('report',W.inspect(h.service,h.store,slots,settings));
  const section=h.find(h.render(),n=>n.props.className==='paa-wb-threat');
  const findAll=(node,pred)=>!node||typeof node!=='object'?[]:
    [...(pred(node)?[node]:[]),...(node.children||[]).flatMap(child=>findAll(child,pred))];
  const cards=findAll(section,n=>n.props.className==='paa-threat-card');
  const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join(' ');
  assert.equal(cards.length,2);assert.match(text(cards[0]),/C 点/);assert.match(text(cards[1]),/A 点/);
  assert.match(text(cards[0]),/轻巡|軽巡/,'Boss card shows the first main-fleet flagship');
});

test('route selection uses a grouped anchored component and keeps names separate from path letters',()=>{
  const h=harness(),options=W.mapOverview('1-4').options;
  h.set('area','1-4');
  for(const option of options){
    h.set('mapRoute',option.key);
    const picker=h.find(h.render(),n=>n.type?.name==='RoutePicker');
    assert.equal(picker.props.value,option.key);
    assert(picker.props.options.some(o=>o.key===option.key&&o.name===option.name));
  }
  h.set('mapRoute','');assert.equal(h.find(h.render(),n=>n.type?.name==='RoutePicker').props.value,'');
  assert.equal(h.calls.fleet,0);assert.equal(h.calls.equipment,0);
});

test('route choices retain each recommended fleet name and clear it with the fleet',()=>{
  const h=harness(),P=require('../../src/domain/routes/route_plans'),types=[16,3,6,2,2,2];
  for(let i=0;i<types.length;i++)h.store.const.$ships[i+1].api_stype=types[i];
  const slots=types.map((_,i)=>W.entry(h.store,i+1)),settings={kind:'normal',fleet:1,area:'2-2',target:'boss',phase:'',revision:0};
  const report=W.inspect(h.service,h.store,slots,settings),base=P.recommendedOptions('2-2').find(o=>o.id==='2-2-04');
  const saved=P.fleetPathOption(report.route,base);assert.equal(saved.name,'下路水母流');
  h.set('area','2-2');h.set('slots',slots);h.set('report',report);h.set('choices',[saved]);h.set('mapRoute','');
  const choice=()=>h.find(h.render(),n=>n.type?.name==='RoutePicker').props.options.find(o=>o.key===base.key);
  assert.equal(choice().name,'下路水母流','an unselected saved recommendation must keep its fixed-path name');
  h.set('mapRoute',base.key);assert.equal(choice().name,'下路水母流');
  h.set('slots',[]);h.set('mapRoute','');assert.equal(choice().name,base.name,'empty drafts do not retain a previous fleet verdict');
});

test('multi-stage completion only evaluates the chosen gauge until the player explicitly completes another',async()=>{
  const h=harness(),plans=require('../../src/domain/routes/route_plans'),queries=[];
  h.set('area','5-6');h.store.info.maps={56:{api_gauge_num:3}};
  h.set('slots',[{...W.entry(h.store,2),pin:true},null,null,null,null,null]);
  h.service.recommendNormalFleet=args=>{
    queries.push(args);const options=plans.recommendedOptions(args.area,'boss',args.phase);
    return {phase:args.phase,routeResults:options.map((o,i)=>({...o,status:'available',chance:{probability:1},recommendationIndex:i})),
      recommendations:options.map(o=>({routeKey:o.key,scheme:W.scheme([W.entry(h.store,1),W.entry(h.store,2)],1)}))};
  };
  const first=plans.recommendedOptions('5-6','boss','gauge1'),third=plans.recommendedOptions('5-6','boss','gauge3');
  const picker=()=>h.find(h.render(),n=>n.type?.name==='RoutePicker');
  await h.find(h.render(),n=>n.props.className==='paa-wb-complete').props.onClick();h.render();
  for(let i=0;i<80&&Object.keys(h.get('batchRouteChoices')||{}).length<third.length;i++){
    await new Promise(resolve=>setTimeout(resolve,10));h.render();
  }
  assert.deepEqual(queries.map(q=>q.phase),['gauge3']);
  assert(third.every(o=>h.get('routeCombatResults')[o.key]?.status!=='pending'));
  assert(first.every(o=>!h.get('routeCombatResults')[o.key]),'other stages are not marked as calculating');
  assert.equal(h.get('slots')[1].id,2);assert.equal(h.get('slots')[1].pin,true,'automatic placement may move a held ship');
  await h.control(h.render(),'参考路线').props.onChange({target:{value:first[0].key}});h.render();
  await new Promise(resolve=>setTimeout(resolve,40));h.render();
  assert.deepEqual(queries.map(q=>q.phase),['gauge3'],'selecting another gauge alone never starts recommendation');
  assert.equal(h.get('mapRoute'),first[0].key);assert.equal(h.get('combatDeferredPhase'),'gauge1');
  assert(h.get('slots').every(s=>s===null),'changing stages clears even manually fixed ships');
  assert(first.every(o=>!h.get('routeCombatResults')[o.key]),'selected gauge remains unassessed until completion');
  await h.control(h.render(),'参考路线').props.onChange({target:{value:first[1].key}});h.render();
  await new Promise(resolve=>setTimeout(resolve,40));h.render();
  assert.deepEqual(queries.map(q=>q.phase),['gauge3'],'another route in the unassessed gauge also waits for explicit completion');
  assert.equal(h.get('combatDeferredPhase'),'gauge1');
  await h.find(h.render(),n=>n.props.className==='paa-wb-complete').props.onClick();h.render();
  for(let i=0;i<80&&first.some(o=>!h.get('routeCombatResults')[o.key]||h.get('routeCombatResults')[o.key].status==='pending');i++){
    await new Promise(resolve=>setTimeout(resolve,10));h.render();
  }
  assert.deepEqual(queries.map(q=>q.phase),['gauge3','gauge1']);
  assert(first.every(o=>h.get('routeCombatResults')[o.key]?.status!=='pending'));
  assert(third.every(o=>!h.get('routeCombatResults')[o.key]),'clearing the old constraints invalidates their results');
  assert(queries.every(q=>q.routeKey===undefined));assert(queries[0].fixedShipIds.includes(2));assert.deepEqual(queries[1].fixedShipIds,[]);
  assert.equal(h.get('combatDeferredPhase'),'');assert(picker().props.options.some(o=>o.phase==='gauge2'));
});

test('changing stages does not run a new stage battle simulation until explicit completion',async()=>{
  const assessment=require('../../src/application/combat_assessment');
  const workbenchPath=require.resolve('../../src/ui/workbench/workbench'),cached=require.cache[workbenchPath];
  const original=assessment.assessCombat,phases=[];
  assessment.assessCombat=args=>{phases.push(args.option?.phase);return original(args);};delete require.cache[workbenchPath];
  try{
    const h=harness(),plans=require('../../src/domain/routes/route_plans');
    h.set('area','7-3');const first=plans.recommendedOptions('7-3','boss','gauge1')[0],second=plans.recommendedOptions('7-3','boss','gauge2')[0];
    const slots=[W.entry(h.store,2)],settings={kind:'normal',fleet:1,area:'7-3',target:'boss',phase:'gauge1',missionId:1,revision:0};
    h.set('slots',slots);h.set('mapRoute',first.key);h.set('report',W.inspect(h.service,h.store,slots,settings));
    h.render();phases.length=0;
    await h.control(h.render(),'参考路线').props.onChange({target:{value:second.key}});const tree=h.render();
    assert(!phases.includes('gauge2'),'stage selection never invokes combat assessment for the new stage');
    assert.equal(h.calls.fleet,0);
    const pending=h.find(tree,n=>n.props.className==='paa-balance-pending');
    assert(pending);assert.equal(pending.children[0],'一键补全后计算');
  }finally{
    assessment.assessCombat=original;delete require.cache[workbenchPath];if(cached)require.cache[workbenchPath]=cached;
  }
});

test('same-stage route changes keep a preselected fleet but a different stage clears it',async()=>{
  const h=harness(),plans=require('../../src/domain/routes/route_plans');
  h.set('area','5-6');h.store.info.maps={56:{api_gauge_num:3}};
  const third=plans.recommendedOptions('5-6','boss','gauge3'),first=plans.recommendedOptions('5-6','boss','gauge1');
  const ship={...W.entry(h.store,2),pin:true,preselected:true,preselectionComplete:false,keep:{0:true}};
  h.set('slots',[ship,null,null,null,null,null]);h.set('mapRoute',third[0].key);
  await h.control(h.render(),'参考路线').props.onChange({target:{value:third[1].key}});h.render();
  assert.equal(h.get('slots')[0],ship);assert.equal(h.calls.fleet,0);
  await h.control(h.render(),'参考路线').props.onChange({target:{value:first[0].key}});h.render();
  assert(h.get('slots').every(s=>s===null));assert.equal(h.get('phase'),'');
  assert.equal(h.get('mapRoute'),first[0].key);assert.equal(h.get('combatDeferredPhase'),'gauge1');
  assert.equal(h.calls.fleet,0);assert.equal(h.calls.equipment,0);
});

test('clearing route selection keeps its phase anchored for the current fleet',async()=>{
  const h=harness(),plans=require('../../src/domain/routes/route_plans');
  h.set('area','5-6');h.store.info.maps={56:{api_gauge_num:3}};
  const first=plans.recommendedOptions('5-6','boss','gauge1'),third=plans.recommendedOptions('5-6','boss','gauge3');
  await h.control(h.render(),'参考路线').props.onChange({target:{value:first[0].key}});h.render();
  const ship={...W.entry(h.store,2),pin:true,preselected:true,preselectionComplete:false,keep:{0:true}};
  h.set('slots',[ship,null,null,null,null,null]);h.render();
  await h.control(h.render(),'参考路线').props.onChange({target:{value:''}});h.render();
  assert.equal(h.get('routePhaseAnchor'),'gauge1');assert.equal(h.get('slots')[0],ship);
  await h.control(h.render(),'参考路线').props.onChange({target:{value:first[1].key}});h.render();
  assert.equal(h.get('slots')[0],ship,'another route in the anchored stage keeps the fleet');
  await h.control(h.render(),'参考路线').props.onChange({target:{value:''}});h.render();
  await h.control(h.render(),'参考路线').props.onChange({target:{value:third[0].key}});h.render();
  assert(h.get('slots').every(s=>s===null),'a genuinely different stage clears the fleet');
  assert.equal(h.get('routePhaseAnchor'),'gauge3');assert.equal(h.get('mapRoute'),third[0].key);
  assert.equal(h.calls.fleet,0);assert.equal(h.calls.equipment,0);
});

test('one-click completion without a selected route uses the anchored stage',async()=>{
  const h=harness(),plans=require('../../src/domain/routes/route_plans');
  h.set('area','5-6');h.store.info.maps={56:{api_gauge_num:3}};
  const first=plans.recommendedOptions('5-6','boss','gauge1');let query;
  await h.control(h.render(),'参考路线').props.onChange({target:{value:first[0].key}});h.render();
  const ship={...W.entry(h.store,2),pin:true,preselected:true,preselectionComplete:false};
  h.set('slots',[ship,null,null,null,null,null]);h.render();
  await h.control(h.render(),'参考路线').props.onChange({target:{value:''}});h.render();
  h.service.recommendNormalFleet=args=>{query=args;return {routeResults:[{...first[0],status:'available',chance:{probability:1},recommendationIndex:0}],
    recommendations:[{routeKey:first[0].key,scheme:W.scheme([W.entry(h.store,2)],1)}]};};
  await h.find(h.render(),n=>n.props.className==='paa-wb-complete').props.onClick();h.render();
  assert.equal(query.phase,'gauge1');assert.deepEqual(query.fixedShipIds,[2]);assert.equal(h.get('slots')[0].id,2);
});

test('a delayed battle assessment cannot refill state after a phase change',async()=>{
  const modulePath=require.resolve('../../src/application/route_combat_assessments');
  const workbenchPath=require.resolve('../../src/ui/workbench/workbench'),cached=require.cache[workbenchPath];
  const module=require(modulePath),original=module.assessRouteChoices;
  try{
    for(const shouldFail of [false,true]){
      let finish;module.assessRouteChoices=()=>new Promise((resolve,reject)=>{finish=()=>shouldFail?reject(Error('late')):resolve({stale:{status:'estimated'}});});
      delete require.cache[workbenchPath];const h=harness(),plans=require('../../src/domain/routes/route_plans');
      h.set('area','5-6');h.store.info.maps={56:{api_gauge_num:3}};
      const first=plans.recommendedOptions('5-6','boss','gauge1')[0],third=plans.recommendedOptions('5-6','boss','gauge3')[0];
      h.service.recommendNormalFleet=()=>({routeResults:[{...third,status:'available',chance:{probability:1},recommendationIndex:0}],
        recommendations:[{routeKey:third.key,scheme:W.scheme([W.entry(h.store,2)],1)}]});
      await h.find(h.render(),n=>n.props.className==='paa-wb-complete').props.onClick();h.render();
      for(let i=0;!finish&&i<30;i++)await new Promise(resolve=>setTimeout(resolve,5));
      assert(finish,'the original assessment must already be in flight');
      await h.control(h.render(),'参考路线').props.onChange({target:{value:first.key}});h.render();
      finish();await new Promise(resolve=>setTimeout(resolve,20));h.render();
      assert.equal(h.get('mapRoute'),first.key);assert(h.get('slots').every(s=>s===null));
      assert.deepEqual(h.get('routeCombatResults'),{});assert.deepEqual(h.get('batchRouteChoices'),{});assert.equal(h.get('error'),'');
    }
  }finally{module.assessRouteChoices=original;delete require.cache[workbenchPath];if(cached)require.cache[workbenchPath]=cached;}
});

test('changing stages clears saved fleets and battle results without operating the game',async()=>{
  const assessment=require('../../src/application/combat_assessment');
  const workbenchPath=require.resolve('../../src/ui/workbench/workbench'),cached=require.cache[workbenchPath];
  const original=assessment.assessCombat,phases=[],oldArrival=W.routeArrival,oldIssue=W.draftRouteIssue;
  W.routeArrival=()=>({value:'固定到达',label:'最终抵达 Boss',tone:'good',warnings:[],noteLines:[]});W.draftRouteIssue=()=>null;
  assessment.assessCombat=args=>{phases.push(args.option?.phase);return original(args);};delete require.cache[workbenchPath];
  try{
    const h=harness(),plans=require('../../src/domain/routes/route_plans');
    h.set('area','7-3');const first=plans.recommendedOptions('7-3','boss','gauge1')[0],second=plans.recommendedOptions('7-3','boss','gauge2')[0];
    const slots=[{...W.entry(h.store,2),pin:true,keep:{0:true}},null,null,null,null,null],settings={kind:'normal',fleet:1,area:'7-3',target:'boss',phase:'gauge2',missionId:1,revision:0};
    h.set('slots',slots);h.set('mapRoute',second.key);h.set('report',W.inspect(h.service,h.store,slots,settings));
    const cachedCombat={status:'estimated',balance:{label:'优势',rank:3,ratio:2,blueShare:2/3}};
    const draft={slots,excluded:[],prepared:true,usable:true,revision:0,fleet:1,combat:cachedCombat,choices:[]};
    const snapshots=h.refs.find(ref=>ref.current instanceof WeakMap)?.current;assert(snapshots);
    snapshots.set(draft,{info:h.store.info,master:h.store.const});h.set('routeDrafts',{[first.key]:draft});
    h.set('excluded',[3]);h.set('choices',[{key:second.key,status:'available'}]);h.set('routeCombatResults',{[second.key]:cachedCombat});
    h.set('batchRouteChoices',{[second.key]:{key:second.key,status:'available'}});h.set('pathIndex',1);h.set('routeRulesOpen',true);
    const before=JSON.stringify(h.store);h.render();phases.length=0;
    await h.control(h.render(),'参考路线').props.onChange({target:{value:first.key}});h.render();
    assert(!phases.includes('gauge1'),'the prior stage is not re-simulated on selection');
    assert.equal(h.calls.fleet,0);assert.equal(h.calls.equipment,0);assert.equal(JSON.stringify(h.store),before);
    assert.equal(h.get('area'),'7-3');assert.equal(h.get('mapRoute'),first.key);assert.equal(h.get('combatDeferredPhase'),'gauge1');
    assert(h.get('slots').every(s=>s===null));assert.deepEqual(h.get('excluded'),[]);assert.deepEqual(h.get('routeDrafts'),{});
    assert.deepEqual(h.get('routeCombatResults'),{});assert.deepEqual(h.get('batchRouteChoices'),{});assert.deepEqual(h.get('choices'),[]);
    assert.equal(h.get('report').valid,false);assert.equal(h.get('pathIndex'),0);assert.equal(h.get('routeRulesOpen'),false);
    await h.control(h.render(),'参考路线').props.onChange({target:{value:second.key}});h.render();
    assert(h.get('slots').every(s=>s===null),'returning to a former stage does not restore its old fleet');
  }finally{
    W.routeArrival=oldArrival;W.draftRouteIssue=oldIssue;
    assessment.assessCombat=original;delete require.cache[workbenchPath];if(cached)require.cache[workbenchPath]=cached;
  }
});

test('hot reload includes the deferred phase gate and route phase anchor',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const source=fs.readFileSync(path.join(__dirname,'../../tools/dev/hot-reload.js'),'utf8');
  const fields=source.match(/const draftFields=\[([^\]]+)\]/)?.[1]||'';
  assert.match(fields,/'combatDeferredPhase'/);
  assert.match(fields,/'routePhaseAnchor'/);
});

test('a changed snapshot during foreground completion cannot apply a stale recommendation',async()=>{
  const h=harness();let finish;h.set('area','1-1');
  h.set('slots',[{...W.entry(h.store,2),pin:true},null,null,null,null,null]);
  h.service.recommendNormalFleet=()=>new Promise(resolve=>{finish=resolve;});
  const before=JSON.stringify(h.get('slots'));
  const pending=h.find(h.render(),n=>n.props.className==='paa-wb-complete').props.onClick();
  for(let i=0;i<40&&!finish;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert(finish);h.store.info={...h.store.info};
  finish({recommendations:[{routeKey:'guide:1-1-01',scheme:W.scheme([W.entry(h.store,3)],1)}]});
  await pending;h.render();assert.equal(h.get('error'),'舰队资料已变化，请重新补全');
  assert.equal(JSON.stringify(h.get('slots')),before);assert.deepEqual(h.get('routeCombatResults'),{});
});

test('resuming a hidden page clears completed battle results from an older snapshot',async()=>{
  const h=harness(),plans=require('../../src/domain/routes/route_plans');
  h.set('area','1-1');h.set('slots',[{...W.entry(h.store,2),pin:true},null,null,null,null,null]);
  h.service.recommendNormalFleet=args=>{const options=plans.recommendedOptions(args.area,'boss',args.phase);return {
    routeResults:options.map((o,i)=>({...o,status:'available',chance:{probability:1},recommendationIndex:i})),
    recommendations:options.map(o=>({routeKey:o.key,scheme:W.scheme([W.entry(h.store,2)],1)}))};};
  await h.find(h.render(),n=>n.props.className==='paa-wb-complete').props.onClick();h.render();
  for(let i=0;i<80&&!Object.keys(h.get('batchRouteChoices')||{}).length;i++){await new Promise(resolve=>setTimeout(resolve,10));h.render();}
  assert(Object.keys(h.get('routeCombatResults')).length);
  h.render({hidden:true});h.store.info={...h.store.info};h.render({hidden:false});
  const effect=h.effects.filter(e=>String(e.fn).includes('snapshot=routeCombatSnapshot.current')).at(-1);
  assert(effect);effect.fn();assert.deepEqual(h.get('routeCombatResults'),{});assert.deepEqual(h.get('batchRouteChoices'),{});
});

test('a route missing from a completed recommendation is marked unknown instead of pending',async()=>{
  const h=harness(),plans=require('../../src/domain/routes/route_plans');h.set('area','1-4');
  h.set('slots',[{...W.entry(h.store,2),pin:true},null,null,null,null,null]);
  const options=plans.recommendedOptions('1-4');
  h.service.recommendNormalFleet=()=>({routeResults:[{...options[0],status:'available',chance:{probability:1},recommendationIndex:0}],
    recommendations:[{routeKey:options[0].key,scheme:W.scheme([W.entry(h.store,2)],1)}]});
  await h.find(h.render(),n=>n.props.className==='paa-wb-complete').props.onClick();h.render();
  for(let i=0;i<80&&h.get('routeCombatResults')?.[options[1].key]?.status!=='unknown';i++){
    await new Promise(resolve=>setTimeout(resolve,10));h.render();
  }
  assert.equal(h.get('routeCombatResults')[options[1].key].status,'unknown');
});

test('route picker prefers a matching saved draft battle result over a recommendation',()=>{
  const h=harness(),options=W.mapOverview('1-4').options;h.set('area','1-4');
  const saved={status:'estimated',balance:{label:'完胜',rank:4,ratio:3,blueShare:.75}};
  const recommended={status:'estimated',balance:{label:'劣势',rank:1,ratio:.5,blueShare:1/3}};
  h.set('routeCombatResults',{[options[0].key]:recommended});
  const draft={usable:true,revision:0,fleet:1,combat:saved};
  const snapshots=h.refs.find(ref=>ref.current instanceof WeakMap)?.current;assert(snapshots);
  snapshots.set(draft,{info:h.store.info,master:h.store.const});h.set('routeDrafts',{[options[0].key]:draft});
  const choice=()=>h.find(h.render(),n=>n.type?.name==='RoutePicker').props.options.find(o=>o.key===options[0].key);
  assert.equal(choice().combat,saved);
  h.store.info={...h.store.info};h.set('revision',1);assert.equal(choice().combat,recommended,'a stale draft result is not displayed');
});

test('saved route drafts do not serialize the account store or master data',async()=>{
  const h=harness(),options=W.mapOverview('1-4').options;h.set('area','1-4');
  h.store.info.ships[2].privateTestMarker='private-account-store-marker';
  h.store.const.$ships[2].privateTestMarker='private-master-store-marker';
  h.set('slots',[W.entry(h.store,2),null,null,null,null,null]);h.set('mapRoute',options[0].key);
  await h.control(h.render(),'参考路线').props.onChange({target:{value:options[1].key}});h.render();
  const draft=h.get('routeDrafts')[options[0].key];assert(draft);
  const serialized=JSON.stringify(draft);
  assert(!serialized.includes('private-account-store-marker'));assert(!serialized.includes('private-master-store-marker'));
  assert.equal(draft.snapshotInfo,undefined);assert.equal(draft.snapshotMaster,undefined);
});

test('next-route shortcut requires another selectable route in the selected stage',()=>{
  const h=harness(),plans=require('../../src/domain/routes/route_plans');h.set('area','5-6');h.store.info.maps={56:{api_gauge_num:3}};
  const options=plans.recommendedOptions('5-6'),third=options.filter(o=>o.phase==='gauge3');assert(third.length>1);
  h.set('mapRoute',third[0].key);h.set('choices',third.map((o,i)=>({...o,status:i===0?'available':'notFound',row:i===0?{}:null})));
  const picker=()=>h.find(h.render(),n=>n.type?.name==='RoutePicker');assert.equal(picker().props.showNext,false);
  h.set('choices',third.map((o,i)=>({...o,status:i<2?'available':'notFound',row:i<2?{}:null})));assert.equal(picker().props.showNext,true);
  h.set('choices',third.map((o,i)=>({...o,status:i===0?'available':'unconfirmed',row:i===0?{}:null})));assert.equal(picker().props.showNext,false);
});

test('changing phases clears prior unavailable route results',async()=>{
  const h=harness(),plans=require('../../src/domain/routes/route_plans');h.set('area','5-6');h.store.info.maps={56:{api_gauge_num:3}};
  const first=plans.recommendedOptions('5-6','boss','gauge1'),third=plans.recommendedOptions('5-6','boss','gauge3');
  h.set('slots',[{...W.entry(h.store,2),pin:true},null,null,null,null,null]);h.set('mapRoute',first[0].key);
  h.set('choices',[{key:first[1].key,phase:'gauge1',status:'notFound'}]);
  h.service.recommendNormalFleet=args=>({routeResults:third.map((o,i)=>({...o,status:'available',chance:{probability:1},recommendationIndex:i})),
    recommendations:third.map(o=>({routeKey:o.key,scheme:W.scheme([W.entry(h.store,2)],1)}))});
  await h.control(h.render(),'参考路线').props.onChange({target:{value:third[0].key}});
  assert.deepEqual(h.get('choices'),[]);
  await h.control(h.render(),'参考路线').props.onChange({target:{value:first[1].key}});assert.equal(h.get('mapRoute'),first[1].key);
  h.find(h.render(),n=>n.type==='button'&&n.children.includes('一键清空')).props.onClick();
  assert.equal(h.get('mapRoute'),'');assert.deepEqual(h.get('choices'),[]);
});

test('blocked ship replacement shows red routing reasons without searching or switching routes',async()=>{
  for(const fittingFails of [true,false]){
    const h=harness(),routes=require('../../src/domain/routes/route_plans').recommendedOptions('3-2');
    h.set('area','3-2');h.set('mapRoute',routes[0].key);h.store.const.$ships[1].api_soku=5;
    h.set('slots',[1,2,3,4,5,6].map(id=>W.entry(h.store,id)));h.render();
    h.service.recommendNormalEquipment=args=>{h.calls.equipment++;if(fittingFails)throw Error('当前舰娘及保留装备无法配出路线方案');return {scheme:args.scheme};};
    h.service.recommendNormalFleet=()=>{h.calls.fleet++;throw Error('换船时不应搜索其他路线');};
    h.set('popup',{index:5});const list=h.find(h.render(),n=>n.props.className==='paa-wb-popup-list');
    await list.children.find(n=>n?.type==='button'&&n.props.key===7).props.onClick();
    assert.equal(h.get('slots')[5].id,7);assert.equal(h.calls.fleet,0);assert.equal(h.get('mapRoute'),routes[0].key);
    const tree=h.render(),arrival=h.find(tree,n=>n.props.className==='paa-wb-arrival');
    assert.equal(arrival.props['data-tone'],'bad');assert(h.find(arrival,n=>n.type==='strong').children.includes('无法沿此路线抵达'));
    const warnings=h.find(tree,n=>n.props['aria-label']==='路线条件');assert(warnings);assert.equal(warnings.props['data-tone'],'bad');
    assert(warnings.children.some(n=>n.children.join('').includes('速力要求')));assert.equal(h.get('error'),'');
  }
});

test('next-route shortcut survives ship replacement and reflects the current gauge catalogue',async()=>{
  const h=harness(),plans=require('../../src/domain/routes/route_plans'),routes=plans.recommendedOptions('3-5');
  h.set('slots',[{...W.entry(h.store,2),pin:true},W.entry(h.store,1),null,null,null,null]);
  h.set('mapRoute',routes[0].key);h.set('choices',routes.map((o,i)=>({...o,status:i===1?'notFound':'available',row:{}})));
  const picker=()=>h.find(h.render(),n=>n.type?.name==='RoutePicker');
  assert(picker().props.showNext);h.set('popup',{index:1});
  const list=h.find(h.render(),n=>n.props.className==='paa-wb-popup-list');
  await list.children.find(n=>n?.type==='button'&&n.props.key===3).props.onClick();
  assert.equal(h.calls.equipment,1);assert.equal(h.get('choices').length,1);assert.equal(h.get('choices')[0].status,'notFound');
  assert(picker().props.showNext,'route shortcuts survive replacing the ship and clearing stale recommendations');
  assert(picker().props.options.some(o=>o.key!==routes[0].key));
});

test('selecting another gauge before completion only selects the route; late completion cannot refill a changed map',async()=>{
  const h=harness(),plans=require('../../src/domain/routes/route_plans');
  h.set('area','5-6');h.store.info.maps={56:{api_gauge_num:3}};
  const first=plans.recommendedOptions('5-6','boss','gauge1')[0];let finish,query;
  h.service.recommendNormalFleet=args=>{query=args;return new Promise(resolve=>{finish=resolve;});};
  await h.control(h.render(),'参考路线').props.onChange({target:{value:first.key}});
  assert.equal(query,undefined);assert.equal(h.get('mapRoute'),first.key);
  const pending=h.find(h.render(),n=>n.props.className==='paa-wb-complete').props.onClick();
  h.render();await new Promise(resolve=>setTimeout(resolve,30));assert.equal(query.phase,'gauge1');
  h.find(h.render(),n=>n.type?.name==='AreaPicker').props.onChange('1-1');h.render();
  finish({recommendations:[{routeKey:first.key,scheme:W.scheme([W.entry(h.store,2)],1)}]});await pending;
  assert.equal(h.get('area'),'1-1');assert(h.get('slots').every(s=>!s));assert.equal(h.get('mapRoute'),'');
});

test('adding ships before normal-map completion retains worn gear and skips fitting and route inspection',async()=>{
  const h=harness();let previews=0;
  const preview=h.service.preview;h.service.preview=(...args)=>{previews++;return preview(...args);};
  h.store.const.$equips[500]={api_id:500,api_name:'现有主炮',api_type:[0,0,1,1],api_houg:5};
  h.store.const.$shipTypes[2]={api_equip_type:{1:1}};
  for(const id of [2,3]){
    h.store.info.equips[id+100]={api_id:id+100,api_slotitem_id:500};
    h.store.info.ships[id].api_slot=[id+100,-1];
  }
  const pick=async(index,id)=>{
    h.set('popup',{index});
    const list=h.find(h.render(),n=>n.props.className==='paa-wb-popup-list');
    await list.children.find(n=>n?.type==='button'&&n.props.key===id).props.onClick();
    assert.deepEqual(h.get('slots')[index].slots,h.store.info.ships[id].api_slot);
    assert.equal(h.get('working'),false);
  };
  await pick(0,2);await pick(1,3);
  assert.equal(h.calls.equipment+h.calls.fleet,0);assert.equal(previews,0);
  let tree=h.render();
  for(const id of [2,3]){
    const card=h.find(tree,n=>n.props['data-ship-id']===id);
    assert.equal(card.props['data-preselected'],true);
    assert(h.find(card,n=>n.props.className==='paa-wb-preselected'&&n.children.includes('预选')));
    const gear=h.find(card,n=>n.props.className==='paa-wb-gear');
    assert.equal(gear.props.disabled,true);assert(gear.children.some(n=>n?.children?.includes('现有主炮')));
    assert.equal(h.get('slots').find(s=>s?.id===id).preselected,true);
  }
  assert.equal(h.find(tree,n=>n.props['data-result-region']==='metrics').props['aria-busy'],false,'preselection does not start a calculation veil');
  await h.control(h.render(),'攻略流派').props.onChange({target:{value:'guide:3-5-05'}});
  assert.equal(previews,0,'selecting a route before completion does not inspect the partial fleet');
  h.render();
  const inspectEffect=h.effects.filter(e=>String(e.fn).includes('resumePending.current=false;setReport(next)')).at(-1);
  const cleanup=inspectEffect.fn();await new Promise(r=>setTimeout(r,110));cleanup?.();
  assert.equal(previews,0);assert.equal(h.get('report').valid,false);
  assert.equal(h.calls.equipment+h.calls.fleet,0);
  h.service.recommendNormalFleet=args=>{
    h.calls.fleet++;
    assert.deepEqual(args.fixedShipIds,[2,3]);
    assert(args.heldSlots.filter(Boolean).every(s=>s.holdPosition===false));
    return {recommendations:[{routeKey:'guide:3-5-05',scheme:W.scheme([3,1,2,4,5,6].map(id=>W.entry(h.store,id)),1)}]};
  };
  await h.find(h.render(),n=>n.props.className==='paa-wb-complete').props.onClick();
  assert.equal(h.get('error'),'');assert.deepEqual(h.get('slots').map(s=>s.id),[3,1,2,4,5,6]);
  assert(h.get('slots')[0].pin&&h.get('slots')[2].pin);
  assert(h.get('slots')[0].preselected&&h.get('slots')[0].preselectionComplete);
  assert(h.get('slots')[2].preselected&&h.get('slots')[2].preselectionComplete);
  assert(!h.get('slots')[1].preselected);
  assert.equal(h.find(h.render(),n=>n.props['data-ship-id']===3).props['data-preselected'],true);
  assert.equal(h.calls.fleet,1);assert(previews>0,'completion inspects the final formation');
  h.find(h.render(),n=>n.type?.name==='AreaPicker').props.onChange('1-1');
  await pick(0,2);assert.equal(h.calls.equipment,0,'changing maps resets the deferred fitting state');
});

test('replacing a preselected ship stays idle but does not mark the replacement as preselected',async()=>{
  const h=harness();const pick=async(index,id)=>{h.set('popup',{index});const list=h.find(h.render(),n=>n.props.className==='paa-wb-popup-list');
    await list.children.find(n=>n?.type==='button'&&n.props.key===id).props.onClick();};
  await pick(0,2);assert(h.get('slots')[0].preselected);
  await pick(0,3);assert(!h.get('slots')[0].preselected);assert.equal(h.get('slots')[0].preselectionComplete,false);
  assert(!h.find(h.render(),n=>n.props.className==='paa-wb-preselected'));assert.equal(h.calls.equipment+h.calls.fleet,0);
  await pick(1,4);assert(h.get('slots')[1].preselected);assert.equal(h.calls.equipment+h.calls.fleet,0);
});

test('replacing or removing a preselected ship recalculates when a route is selected',async()=>{
  for(const action of ['replace','remove']){
    const h=harness();h.set('mapRoute','guide:3-5-05');h.set('slots',[
      {...W.entry(h.store,2),pin:true,preselected:true,preselectionComplete:false},
      {...W.entry(h.store,3),pin:true,preselected:true,preselectionComplete:false},null,null,null,null]);
    let query;h.service.recommendNormalEquipment=args=>{h.calls.equipment++;query=args;return {scheme:args.scheme};};
    if(action==='replace'){
      h.set('popup',{index:0});const list=h.find(h.render(),n=>n.props.className==='paa-wb-popup-list');
      await list.children.find(n=>n?.type==='button'&&n.props.key===4).props.onClick();assert(!h.get('slots')[0].preselected);
    }else{
      const card=h.find(h.render(),n=>n.props['data-ship-id']===2);await h.find(card,n=>n.props.className==='paa-wb-remove').props.onClick();
    }
    assert.equal(h.calls.equipment,1);assert.equal(h.calls.fleet,0);assert.equal(query.routeKey,'guide:3-5-05');
    assert(h.get('slots').filter(s=>s?.preselected).every(s=>s.preselectionComplete));
  }
});

test('a restored unfinished replacement without a marker does not activate fitting',async()=>{
  const h=harness();h.set('slots',[{...W.entry(h.store,2),pin:true,preselectionComplete:false},null,null,null,null,null]);
  h.render();h.set('popup',{index:1});const list=h.find(h.render(),n=>n.props.className==='paa-wb-popup-list');
  await list.children.find(n=>n?.type==='button'&&n.props.key===3).props.onClick();
  assert.equal(h.calls.equipment+h.calls.fleet,0);assert(h.get('slots')[1].preselected);
});

test('normal preselection resumes fitting only after successful completion and resets on clear',async()=>{
  const h=harness(),queries=[];
  h.service.recommendNormalFleet=args=>{queries.push(args);return {recommendations:[{routeKey:'guide:3-5-05',
    scheme:W.scheme(args.fixedShipIds.map(id=>W.entry(h.store,id)).concat(W.entry(h.store,1)),1)}]};};
  const pick=async(index,id)=>{h.set('popup',{index});const list=h.find(h.render(),n=>n.props.className==='paa-wb-popup-list');
    await list.children.find(n=>n?.type==='button'&&n.props.key===id).props.onClick();};
  await pick(0,2);assert.equal(h.calls.equipment,0);
  await h.find(h.render(),n=>n.props.className==='paa-wb-complete').props.onClick();
  assert.deepEqual(queries[0].fixedShipIds,[2]);assert(h.get('slots')[0].preselected);
  assert(h.get('slots')[0].preselectionComplete);
  assert(h.find(h.render(),n=>n.props.className==='paa-wb-preselected'));
  await pick(1,3);assert.equal(h.calls.equipment,1,'ship replacement refits after completion');
  assert(!h.get('slots')[1].preselected,'replacement after completion is not preselected');
  h.find(h.render(),n=>n.type==='button'&&n.children.includes('一键清空')).props.onClick();
  await pick(0,4);assert.equal(h.calls.equipment,1,'clearing returns to preselection');
  assert.equal(h.get('slots')[0].preselected,true);
  assert(h.find(h.render(),n=>n.props.className==='paa-wb-preselected'));
});

test('restored completed preselection keeps its marker and enables replacement fitting',async()=>{
  const h=harness();h.set('slots',[{...W.entry(h.store,2),pin:true,preselected:true,preselectionComplete:true},W.entry(h.store,1),null,null,null,null]);
  assert(h.find(h.render(),n=>n.props['data-ship-id']===2).props['data-preselected']);
  h.set('popup',{index:1});const list=h.find(h.render(),n=>n.props.className==='paa-wb-popup-list');
  await list.children.find(n=>n?.type==='button'&&n.props.key===3).props.onClick();
  assert.equal(h.calls.equipment,1);assert(!h.get('slots')[1].preselected);
});

test('manual removal refits the remaining fleet for the current route without replacing the removed ship',async()=>{
  const h=harness();h.set('slots',[W.entry(h.store,1),W.entry(h.store,2),W.entry(h.store,3),null,null,null]);
  h.set('mapRoute','guide:3-5-05');let request;
  h.service.recommendNormalEquipment=args=>{h.calls.equipment++;request=args;return {scheme:args.scheme};};
  const card=h.find(h.render(),n=>n.props['data-ship-id']===2);
  await h.find(card,n=>n.props.className==='paa-wb-remove').props.onClick();
  assert.deepEqual(h.get('slots').filter(Boolean).map(s=>s.id),[1,3]);assert.equal(request.routeKey,'guide:3-5-05');
  assert.deepEqual(request.scheme.ships.map(s=>s.id),[1,3]);assert.equal(h.calls.fleet,0);assert.equal(h.calls.equipment,1);
});

test('removing the last ship returns manual additions to idle preselection',async()=>{
  const h=harness();h.set('mapRoute','guide:3-5-05');h.set('slots',[W.entry(h.store,2),null,null,null,null,null]);
  const card=h.find(h.render(),n=>n.props['data-ship-id']===2);await h.find(card,n=>n.props.className==='paa-wb-remove').props.onClick();
  assert(h.get('slots').every(s=>!s));h.set('popup',{index:0});const list=h.find(h.render(),n=>n.props.className==='paa-wb-popup-list');
  await list.children.find(n=>n?.type==='button'&&n.props.key===3).props.onClick();
  assert(h.get('slots')[0].preselected);assert.equal(h.calls.equipment,0);assert.equal(h.calls.fleet,0);
});

test('uncompleted preselection drafts are preserved independently for each route',async()=>{
  const h=harness(),options=W.mapOverview('3-5').options,first=options[0],second=options[1];h.set('mapRoute',first.key);
  const pick=async(index,id)=>{h.set('popup',{index});const list=h.find(h.render(),n=>n.props.className==='paa-wb-popup-list');
    await list.children.find(n=>n?.type==='button'&&n.props.key===id).props.onClick();};
  await pick(0,2);await h.control(h.render(),'参考路线').props.onChange({target:{value:second.key}});await pick(1,3);
  await h.control(h.render(),'参考路线').props.onChange({target:{value:first.key}});
  assert.deepEqual(h.get('slots').filter(Boolean).map(s=>s.id),[2]);assert(h.get('slots')[0].preselected);
  await h.control(h.render(),'参考路线').props.onChange({target:{value:second.key}});
  assert.deepEqual(h.get('slots').filter(Boolean).map(s=>s.id),[2,3]);assert(h.get('slots')[1].preselected);
  assert.equal(h.calls.fleet+h.calls.equipment,0);assert.equal(h.get('error'),'');
});

test('each route restores its own edited fleet and state without another recommendation search',async()=>{
  const h=harness(),options=W.mapOverview('3-5').options,first=options[0],second=options[1];
  const original=[{...W.entry(h.store,2),pin:true,preselected:true,preselectionComplete:true},W.entry(h.store,1),null,null,null,null];
  original[1].keep={0:true};h.set('slots',original);h.set('mapRoute',first.key);h.set('pathIndex',1);h.set('nodeId','A');h.set('routeRulesOpen',true);h.set('notice','保留的状态');
  h.set('draftContext',JSON.stringify(['normal','3-5','boss','','clear','lower',1,'great',null]));
  h.service.recommendNormalFleet=()=>{h.calls.fleet++;return {routeResults:[{...second,status:'available',chance:{probability:1},recommendationIndex:0}],
    recommendations:[{routeKey:second.key,scheme:W.scheme([W.entry(h.store,2),W.entry(h.store,1),W.entry(h.store,3)],1)}]};};
  await h.control(h.render(),'参考路线').props.onChange({target:{value:second.key}});
  assert.deepEqual(h.get('slots').filter(Boolean).map(s=>s.id),[2,1,3]);assert.equal(h.calls.fleet,1);
  h.set('popup',{index:2});let list=h.find(h.render(),n=>n.props.className==='paa-wb-popup-list');
  await list.children.find(n=>n?.type==='button'&&n.props.key===4).props.onClick();
  assert.deepEqual(h.get('slots').filter(Boolean).map(s=>s.id),[2,1,4]);assert(!h.get('slots')[2].preselected);
  h.set('routeRulesOpen',false);h.set('nodeId','C');
  await h.control(h.render(),'参考路线').props.onChange({target:{value:first.key}});
  assert.deepEqual(h.get('slots').filter(Boolean).map(s=>s.id),[2,1]);assert(h.get('slots')[0].preselected);assert.deepEqual(h.get('slots'),original);assert.equal(h.get('notice'),'保留的状态');
  assert.equal(h.get('nodeId'),'A');assert.equal(h.get('pathIndex'),1);assert.equal(h.get('routeRulesOpen'),true);assert.equal(h.calls.fleet,1);
  await h.control(h.render(),'参考路线').props.onChange({target:{value:second.key}});
  assert.deepEqual(h.get('slots').filter(Boolean).map(s=>s.id),[2,1,4]);assert.equal(h.get('nodeId'),'C');assert.equal(h.get('routeRulesOpen'),false);
  assert.equal(h.calls.fleet,1);assert(h.get('report').valid);
  h.find(h.render(),n=>n.type==='button'&&n.children.includes('一键清空')).props.onClick();
  assert.equal(h.get('mapRoute'),'');assert.deepEqual(h.get('routeDrafts'),{});assert(h.get('slots').every(s=>!s));
});

test('a valid saved route stays selectable when another fleet cannot satisfy it',async()=>{
  const h=harness(),options=W.mapOverview('3-2').options,first=options.find(o=>o.id==='3-2-03'),second=options.find(o=>o.id==='3-2-01');
  h.set('area','3-2');h.set('mapRoute',first.key);h.set('slots',[1,2,3,4,5,6].map(id=>W.entry(h.store,id)));
  const settings={kind:'normal',fleet:1,area:'3-2',target:'boss',phase:'',missionId:1,revision:0};
  const report=W.inspect(h.service,h.store,h.get('slots'),settings);assert(report.valid);assert.equal(W.draftRouteIssue(report,first,true),null);
  h.set('report',report);h.set('draftContext',JSON.stringify(['normal','3-2','boss','','clear','lower',1,'great',null]));
  h.service.recommendNormalFleet=()=>({routeResults:[{...first,status:'notFound',recommendationIndex:null},{...second,status:'available',chance:{probability:1},recommendationIndex:0}],
    recommendations:[{routeKey:second.key,scheme:W.scheme([1,2,3,4,5,6].map(id=>W.entry(h.store,id)),1)}]});
  await h.control(h.render(),'参考路线').props.onChange({target:{value:second.key}});
  const picker=h.find(h.render(),n=>n.type?.name==='RoutePicker');assert.equal(picker.props.options.find(o=>o.key===first.key).status,'available');
  await h.control(h.render(),'参考路线').props.onChange({target:{value:first.key}});assert.equal(h.get('mapRoute'),first.key);
});

test('restored preselection and failed completion do not activate fitting',async()=>{
  const h=harness();h.set('slots',[{...W.entry(h.store,2),pin:true,preselected:true},null,null,null,null,null]);
  h.set('choices',[]);h.service.recommendNormalFleet=()=>{throw Error('没有可用编成');};
  assert(h.find(h.render(),n=>n.props.className==='paa-wb-preselected'));
  await h.find(h.render(),n=>n.props.className==='paa-wb-complete').props.onClick();
  assert.match(h.get('error'),/没有可用编成/);assert(h.get('slots')[0].preselected);
  h.set('popup',{index:1});const list=h.find(h.render(),n=>n.props.className==='paa-wb-popup-list');
  await list.children.find(n=>n?.type==='button'&&n.props.key===3).props.onClick();
  assert.equal(h.calls.equipment,0);assert(h.get('slots')[1].preselected);
});

test('ship picker filters by fleet and broad ship groups and sorts without changing the game',async()=>{
  const h=harness('normal',{minLevel:90});
  h.store.const.$ships[2].api_name='朝潮改二丁';h.store.info.ships[2].api_cond=20;
  h.store.info.fleets[0].api_ship=[2,4];h.store.info.ships[4].api_lv=70;
  h.store.info.ships[1].api_lv=99;h.store.info.ships[2].api_lv=50;
  const before=JSON.stringify(h.store);h.set('popup',{index:0});
  const list=()=>h.find(h.render(),n=>n.props.className==='paa-wb-popup-list');
  const ids=()=>list().children.filter(n=>n?.type==='button').map(n=>n.props.key);
  const group=label=>h.control(h.render(),label);
  const button=(label,text)=>h.find(group(label),n=>n.type==='button'&&n.children.includes(text));
  assert.equal(h.get('shipFleet'),'all');assert.equal(h.get('shipType'),'all');
  assert.equal(h.control(h.render(),'排序方式').props.value,'level-desc');assert.equal(ids()[0],1);
  button('舰队筛选','第一舰队').props.onClick();assert.deepEqual(ids(),[4,2]);
  button('舰队筛选','全部').props.onClick();button('舰种筛选','驱逐／海防').props.onClick();
  assert(ids().every(id=>[1,2].includes(h.store.const.$ships[h.store.info.ships[id].api_ship_id].api_stype)));
  h.control(h.render(),'排序方式').props.onChange({target:{value:'level-asc'}});
  const levels=ids().map(id=>h.store.info.ships[id].api_lv);assert.deepEqual(levels,levels.slice().sort((a,b)=>a-b));
  h.control(h.render(),'搜索候选').props.onChange({target:{value:'朝潮'}});assert.deepEqual(ids(),[2]);
  const choice=list().children.find(n=>n?.props?.key===2);assert.equal(choice.props.disabled,false);
  assert(h.find(choice,n=>n.type==='small'&&n.children.some(s=>typeof s==='string'&&s.includes('士气低于 40'))));
  await choice.props.onClick();assert.equal(h.get('slots')[0].id,2);assert.equal(h.calls.equipment,0);
  h.find(h.render(),n=>n.props.className==='paa-wb-replace').props.onClick();
  assert.equal(h.get('shipType'),'type:2');assert.equal(h.get('shipFleet'),'all');assert.equal(h.get('shipSort'),'level-desc');
  assert(!ids().includes(7),'same ship type does not include other ships in the broad group');
  button('舰种筛选','巡洋舰').props.onClick();assert.deepEqual(ids(),[1]);
  h.control(h.render(),'搜索候选').props.onChange({target:{value:'朝潮'}});assert.deepEqual(ids(),[]);
  assert.equal(h.calls.equipment+h.calls.fleet,0);assert.equal(JSON.stringify(h.store),before);
});

test('ship picker defaults to first fleet for empty slots and the exact type across all fleets for replacements',()=>{
  for(const kind of ['normal','expedition']){
    const h=harness(kind);h.store.info.fleets.forEach((fleet,i)=>{fleet.api_ship=[[2,4],[3],[7],[8]][i];});
    h.set('slots',[W.entry(h.store,2),null,null,null,null,null]);
    const ids=()=>h.find(h.render(),n=>n.props.className==='paa-wb-popup-list').children.filter(n=>n?.type==='button').map(n=>n.props.key);
    const button=(group,label)=>h.find(h.control(h.render(),group),n=>n.type==='button'&&n.children.includes(label));
    h.find(h.render(),n=>n.props.className==='paa-wb-replace').props.onClick();
    const dialog=h.find(h.render(),n=>n.props.className==='paa-wb-popup');
    assert.equal(dialog.props['data-picker'],'ship');assert.equal(h.get('shipType'),'type:2');assert.equal(h.get('shipFleet'),'all');
    assert.equal(button('舰种筛选','同舰种：驱逐').props['aria-pressed'],true);
    assert(ids().includes(3));assert(ids().includes(8));assert(!ids().includes(7));
    button('舰种筛选','驱逐／海防').props.onClick();assert(ids().includes(7));
    h.find(h.render(),n=>n.props.className==='paa-wb-empty').props.onClick();
    assert.equal(h.get('shipType'),'all');assert.equal(h.get('shipFleet'),'1');assert.deepEqual(ids(),[2,4]);
    for(const [label,expected] of [['第一舰队',[2,4]],['第二舰队',[3]],['第三舰队',[7]],['第四舰队',[8]]]){
      button('舰队筛选',label).props.onClick();assert.deepEqual(ids(),expected,label);
    }
    button('舰队筛选','全部').props.onClick();assert.equal(ids().length,8);
    h.find(h.render(),n=>n.props.className==='paa-wb-replace').props.onClick();
    assert.equal(h.get('shipType'),'type:2');assert.equal(h.get('shipFleet'),'all');assert.equal(h.calls.equipment+h.calls.fleet,0);
  }
});

test('broad ship filters include related types and retain unknown types under auxiliary ships',()=>{
  const h=harness();for(const [id,type] of [[1,1],[2,2],[3,6],[4,10],[5,18],[6,14],[7,22],[8,99]])h.store.const.$ships[id].api_stype=type;
  h.set('popup',{index:0});const ids=()=>h.find(h.render(),n=>n.props.className==='paa-wb-popup-list').children.filter(n=>n?.type==='button').map(n=>n.props.key).sort((a,b)=>a-b);
  const filter=label=>h.find(h.control(h.render(),'舰种筛选'),n=>n.type==='button'&&n.children.includes(label)).props.onClick();
  for(const [label,expected] of [['驱逐／海防',[1,2]],['巡洋舰',[3]],['战舰',[4]],['空母',[5]],['潜艇',[6]],['辅助舰',[7,8]],['全部',[1,2,3,4,5,6,7,8]]]){
    filter(label);assert.deepEqual(ids(),expected,label);
  }
});

test('related tasks occupy the bottom of the correct left workbench and follow the draft context',()=>{
  for(const kind of ['normal','expedition']){
    const h=harness(kind),slots=[W.entry(h.store,2),null,W.entry(h.store,1),null,null,null];
    h.set('slots',slots);h.set('fleet',3);h.set('area','2-5');h.set('missionId',23);
    const left=h.find(h.render(),n=>n.props.className==='paa-wb-left'),tasks=left.children.at(-1);
    assert.equal(typeof tasks.type,'function');
    assert.equal(tasks.props.kind,kind);assert.equal(tasks.props.deckId,3);
    assert.equal(tasks.props.slots,slots);
    assert.equal(tasks.props.mapId,kind==='normal'?'2-5':undefined);
    assert.equal(tasks.props.missionId,kind==='expedition'?23:undefined);
    assert.equal(h.calls.fleet+h.calls.equipment,0);
  }
});

test('selected task codes reach both workbench searches and reset on destination changes',async()=>{
  const catalog=require('../../data/quests/limited/2026-halloween.json').quests;
  for(const kind of ['normal','expedition']){
    const h=harness(kind),quest=kind==='normal'?catalog.find(q=>q.code==='2610B1'):require('../../data/quests/requirements.json').quests.find(q=>q.code==='D1');
    h.store.questState={known:true,tasks:[{api_no:quest.ids[0],api_title:quest.title,api_state:2}]};h.set('questState',h.store.questState);
    if(kind==='normal')h.set('area','1-3');
    const section=()=>h.find(h.render(),n=>n.type?.name==='QuestSection');
    section().props.onToggleQuest(quest.code);assert.deepEqual(h.get('selectedQuests'),[quest.code]);
    let args;
    h.service[kind==='normal'?'recommendNormalFleet':'recommendExpeditionFleet']=query=>{args=query;throw Error('测试结束');};
    await h.find(h.render(),n=>n.props.className==='paa-wb-complete').props.onClick();
    assert.deepEqual(args.questCodes,[quest.code]);
    h.find(h.render(),n=>n.type?.name==='AreaPicker').props.onChange(kind==='normal'?'1-1':2);
    assert.deepEqual(h.get('selectedQuests'),[]);
  }
});

test('a selected task that disappears blocks search and can still be cleared',async()=>{
  const h=harness(),quest=require('../../data/quests/limited/2026-halloween.json').quests.find(q=>q.code==='2610B1');
  h.set('area','1-3');h.store.questState={known:true,tasks:[{api_no:quest.ids[0],api_title:quest.title,api_state:2}]};
  h.set('questState',h.store.questState);
  const section=()=>h.find(h.render(),n=>n.type?.name==='QuestSection');
  section().props.onToggleQuest(quest.code);h.store.questState={known:true,tasks:[]};
  await h.find(h.render(),n=>n.props.className==='paa-wb-complete').props.onClick();
  assert.equal(h.calls.fleet,0);assert.match(h.get('error'),/任务已变化或未同步/);
  section().props.onClearQuests();assert.deepEqual(h.get('selectedQuests'),[]);assert.equal(h.get('error'),'');
});

test('task observations refresh on resume without running route inspection or changing draft revision',()=>{
  const h=harness(),revision=h.get('revision'),oldInterval=global.setInterval,oldClear=global.clearInterval;
  const callbacks=[];global.setInterval=fn=>{callbacks.push(fn);return 1;};global.clearInterval=()=>{};
  try{
    const poll=h.effects.find(e=>String(e.fn).includes('setQuestState(previous=>'));
    h.store.questState={known:true,tasks:[{api_no:201,api_state:1}]};
    const cleanup=poll.fn();
    assert.equal(h.get('questState'),h.store.questState,'resuming the page must not wait for the first poll');
    h.store.questState={known:true,tasks:[{api_no:201,api_state:2}]};callbacks[0]();
    assert.equal(h.get('questState'),h.store.questState);
    assert.equal(h.get('revision'),revision);assert.equal(h.calls.fleet+h.calls.equipment,0);
    cleanup();
  }finally{global.setInterval=oldInterval;global.clearInterval=oldClear;}
});

test('in-place gauge progress changes refresh the route and boss even when the fleet is unchanged',async()=>{
  const h=harness(),oldInterval=global.setInterval,oldClear=global.clearInterval,callbacks=[];
  global.setInterval=fn=>{callbacks.push(fn);return 1;};global.clearInterval=()=>{};
  try{
    h.store.info.maps={45:{api_gauge_type:1,api_required_defeat_count:5,api_defeat_count:0}};
    h.set('area','4-5');const slots=[W.entry(h.store,2)];h.set('slots',slots);
    h.set('mapRoute',W.mapOverview('4-5').options[0].key);
    const settings={kind:'normal',fleet:1,area:'4-5',target:'boss',phase:'',missionId:1,revision:0};
    h.set('report',W.inspect(h.service,h.store,slots,settings));h.render();
    assert.equal(h.get('report').route.encounterStage,'before');
    const poll=h.effects.filter(e=>String(e.fn).includes('let previousStage=')).at(-1),cleanup=poll.fn();
    h.store.info.maps[45].api_defeat_count=4;callbacks.at(-1)();
    assert.equal(h.get('revision'),1,'a mutable progress update must not leave the old report active');
    h.render();let inspect=h.effects.filter(e=>String(e.fn).includes('resumePending.current=false;setReport(next)')).at(-1);
    let stop=inspect.fn();await new Promise(resolve=>setTimeout(resolve,110));stop?.();
    assert.equal(h.get('report').route.encounterStage,'final');
    assert.equal(W.displayBossFlagship(h.get('report').profile,'T').enemies[0].apiId,1613);
    h.store.info.maps[45].api_defeat_count=5;callbacks.at(-1)();
    assert.equal(h.get('revision'),2);
    h.render();inspect=h.effects.filter(e=>String(e.fn).includes('resumePending.current=false;setReport(next)')).at(-1);
    stop=inspect.fn();await new Promise(resolve=>setTimeout(resolve,110));stop?.();
    assert.equal(h.get('report').route.encounterStage,'after');
    assert.deepEqual(h.get('slots').map(ship=>ship.id),[2]);cleanup();
  }finally{global.setInterval=oldInterval;global.clearInterval=oldClear;}
});

test('task page synchronization does not invalidate fleet previews or recommendation snapshots',()=>{
  const {businessState,fingerprint}=require('../../src/application/snapshots');
  const state=fixture(),before=fingerprint(state),snapshot=JSON.stringify(businessState(state));
  state.questState={known:true,tasks:[{api_no:201,api_state:1}]};
  assert.equal(fingerprint(state),before);assert.equal(JSON.stringify(businessState(state)),snapshot);
  state.questState={known:true,tasks:[{api_no:201,api_state:2}]};
  assert.equal(fingerprint(state),before);assert.equal(JSON.stringify(businessState(state)),snapshot);
});

test('expedition starts from its persisted goal and default changes preserve existing drafts',()=>{
  const h=harness('expedition',{defaultGoal:'success'});
  assert.equal(h.get('goal'),'success');
  assert.equal(h.find(h.render(),n=>n.type==='button'&&n.children.includes('成功即可')).props['aria-pressed'],true);
  const syncDefault=()=>h.effects.filter(e=>String(e.fn).includes('previousDefaultGoal.current')).at(-1).fn();
  h.render({automaticFilters:{defaultGoal:'great'}});syncDefault();
  assert.equal(h.get('goal'),'great','an untouched empty page follows the new default without searching');
  const slots=[W.entry(h.store,2),null,null,null,null,null];h.set('slots',slots);
  h.render({automaticFilters:{defaultGoal:'success'}});syncDefault();
  assert.equal(h.get('goal'),'great');assert.deepEqual(h.get('slots'),slots);
  assert.equal(h.calls.fleet+h.calls.equipment,0);
  assert.equal(harness('expedition',{defaultGoal:'success'}).get('goal'),'success','remounting uses the saved default');
  assert.equal(harness('expedition',{}).get('goal'),'great','older preferences retain the previous default');
});

test('expedition completion loads the closest reference draft instead of throwing an empty-result error',async()=>{
  const h=harness('expedition');h.set('missionId',113);
  h.service.recommendExpeditionFleet=()=>({recommendations:[],reason:'未找到达标方案',
    closestRecommendation:{status:'closest',departureReady:false,scheme:W.scheme([W.entry(h.store,2)],2),evaluation:{eligible:false}}});
  const before=JSON.stringify(h.store);
  await h.find(h.render(),n=>n.props.className==='paa-wb-complete').props.onClick();
  assert.equal(h.get('slots').filter(Boolean)[0].id,2);assert.equal(h.get('error'),'');
  assert.equal(JSON.stringify(h.store),before);
  const checks=[{type:'totalFirepower',left:456,right:500,sat:false},{type:'totalAsw',left:251,right:280,sat:false}];
  const E=require('../../src/ui/expedition/expedition_model'),conditions=E.requirements({checks});
  assert.deepEqual(conditions.map(c=>c.deficit),[44,29]);
  const React={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()})};
  const view=require('../../src/ui/expedition/expedition_view')(React).overview({mission:{missionId:113},master:{},hasShips:true,
    expedition:{eligible:false,checks},rate:null});
  const shortfalls=h.find(view,n=>n.props['aria-label']==='未满足的出航条件');
  const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join('');
  assert(text(shortfalls).includes('差 44'));assert(text(shortfalls).includes('差 29'));
  assert(text(shortfalls).includes('尚未满足出航条件'));assert(text(view).includes('达标后净收益'));
});

test('switching expeditions selects the latest default goal without starting a search',()=>{
  for(const defaultGoal of ['success','great']){
    const h=harness('expedition',{defaultGoal}),manual=defaultGoal==='success'?'great':'success';
    h.set('goal',manual);h.set('slots',[W.entry(h.store,2),null,null,null,null,null]);
    const before=JSON.stringify(h.store),picker=()=>h.find(h.render(),n=>n.type?.name==='AreaPicker');
    picker().props.onChange('1');assert.equal(h.get('goal'),manual,'reselecting the same expedition preserves the manual goal');
    picker().props.onChange('2');assert.equal(h.get('missionId'),2);assert.equal(h.get('goal'),defaultGoal);
    assert(h.get('slots').every(s=>s===null));
    h.find(h.render({automaticFilters:{defaultGoal:manual}}),n=>n.type?.name==='AreaPicker').props.onChange(3);
    assert.equal(h.get('goal'),manual,'the next expedition uses the newly saved default');
    assert.equal(h.calls.fleet+h.calls.equipment,0);assert.equal(JSON.stringify(h.store),before);
  }
});

test('workbench unmount discards pending recommendations and places errors beside fleet actions',async()=>{
  const h=harness();let finish;
  h.service.listNormalMaps=()=>({maps:[]});
  const cleanup=h.effects.find(e=>String(e.fn).includes('alive.current=true')).fn();
  h.service.recommendNormalFleet=()=>new Promise(resolve=>{finish=resolve;});
  const tree=h.render(),pending=h.find(tree,n=>n.props.className==='paa-wb-complete').props.onClick();
  await new Promise(resolve=>setTimeout(resolve,30));assert(finish);
  cleanup();finish({recommendations:[{routeKey:'guide:3-5-01',scheme:W.scheme([W.entry(h.store,2)],1)}]});
  await pending;assert(h.get('slots').every(s=>s===null));assert.deepEqual(h.get('choices'),[]);
  h.set('error','装备资料已变化');
  const failed=h.render(),right=h.find(failed,n=>n.props.className==='paa-wb-right');
  assert(h.find(right,n=>n.props.role==='alert'&&n.children.includes('装备资料已变化')));
  assert(!h.find(failed,n=>n.props.className==='paa-wb-error'));
});

test('second explicit completion reuses the disk result after automatic ships populate the draft',async t=>{
  const fs=require('fs'),os=require('os'),path=require('path');
  const {RecommendationCache}=require('../../src/infrastructure/cache/recommendation_cache');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'paa-ui-cache-'));
  t.after(()=>{assert(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
  const cache=new RecommendationCache(directory,{version:'test'}),h=harness(),calculate=h.service.recommendNormalFleet;
  const keys=[];let misses=0;
  h.service.recommendNormalFleet=args=>{
    const key=cache.key('recommendNormalFleet',h.store,args);keys.push(key);
    const hit=cache.read(key);if(hit)return hit.result;
    misses++;const result=calculate(args);cache.write(key,result);return result;
  };
  const before=JSON.stringify(h.store);
  let tree=h.render();await h.find(tree,n=>n.props.className==='paa-wb-complete').props.onClick();
  const draft=JSON.stringify(h.get('slots'));assert(h.get('slots').some(Boolean));
  tree=h.render();await h.find(tree,n=>n.props.className==='paa-wb-complete').props.onClick();
  assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);assert.equal(misses,1);
  assert.equal(JSON.stringify(h.get('slots')),draft);assert.equal(JSON.stringify(h.store),before);
});

test('ground power and AA bonus values appear in anchored tooltips',()=>{
  const h=harness();h.set('area','3-5');h.set('mapRoute','guide:3-5-05');h.store.const.$ships[2].api_name='秋月改';
  h.store.const.$ships[2].api_slot_num=4;h.store.info.ships[2].api_slot=[-1,-1,-1,-1];
  const gear=[['三式弾',18,0,0],['高角炮',1,10,16],['高角炮',1,10,16],['电探',12,4,11]];
  gear.forEach(([name,type,aa,icon],i)=>{h.store.const.$equips[600+i]={api_id:600+i,api_name:name,api_type:[0,0,type,icon],api_tyku:aa};
    h.store.info.equips[600+i]={api_id:600+i,api_slotitem_id:600+i,api_level:0};});
  h.set('slots',[{...W.entry(h.store,2),slots:[600,601,602,603]}]);
  const tree=h.render(),ground=h.find(tree,n=>n.props['data-mechanism']==='ground'),aa=h.find(tree,n=>n.props['data-mechanism']==='aaci');
  assert.equal(ground.props['data-category'],'ground');assert.match(ground.props['data-tooltip'],/北方.*（H 点）\n昼战攻击力：/);
  for(const badge of [ground,aa])assert(h.find(badge,n=>n.props.className==='paa-wb-mechanism-icon'));
  assert(ground.children.includes('对地攻击'));assert.match(ground.props['data-tooltip'],/^攻击陆上目标时固定生效\n\n北方/);
  assert.match(aa.props['data-tooltip'],/固定击坠×1.7/);assert.match(aa.props['data-tooltip'],/保底\+7机/);
  h.store.const.$equips[604]={api_id:604,api_name:'WG42 (Wurfgerät 42)',api_type:[0,0,37,37]};
  h.store.info.equips[604]={api_id:604,api_slotitem_id:604,api_level:0};
  h.set('slots',[{...W.entry(h.store,2),slots:[600,601,602,604]}]);
  const edited=h.render();
  const rocket=h.find(edited,n=>n.props['data-mechanism']==='ground'&&n.children.includes('对地·火箭弹'));
  assert(rocket);assert(!h.find(edited,n=>n.props['data-mechanism']==='ground'&&n.children.includes('对地攻击')));
  assert.match(rocket.props['data-tooltip'],/\n\n北方/);
  h.store.const.$equips[600].api_name='大発動艇(八九式中戦車&陸戦隊)';h.store.const.$equips[600].api_type=[0,0,24,24];
  const mixed=h.render(),landing=h.find(mixed,n=>n.props['data-mechanism']==='ground'&&n.children.includes('对地·登陆／火箭'));
  assert(landing);assert(!h.find(mixed,n=>n.props['data-mechanism']==='ground'&&n!==landing));
  assert(h.find(landing,n=>n.props['data-equipment-icon']===20));assert(h.find(landing,n=>n.props['data-equipment-icon']===31));
  assert.equal(landing.props['data-tooltip'].split('昼战攻击力：').length-1,1,'the entire loadout has one power result per target');
  h.store.info.equips[605]={api_id:605,api_slotitem_id:604,api_level:0};
  h.set('slots',[{...W.entry(h.store,2),slots:[604,601,602,605]}]);
  const doubled=h.render(),groundTags=[];
  const visit=n=>{if(n&&typeof n==='object'){if(n.props?.['data-mechanism']==='ground')groundTags.push(n);n.children?.forEach(visit);}};visit(doubled);
  assert.equal(groundTags.length,1);assert(groundTags[0].children.includes('对地·火箭弹'));
  assert(!/集积地|炮台|离岛/.test(groundTags[0].props['data-tooltip']));assert(!groundTags[0].props['data-tooltip'].includes('配装：'));
  h.set('mapRoute','');assert.match(h.find(h.render(),n=>n.props['data-mechanism']==='ground').props['data-tooltip'],/选择路线/);
  h.set('mapRoute','guide:3-5-01');assert(!h.find(h.render(),n=>n.props['data-mechanism']==='ground'),'switching away from the installation removes irrelevant ground tags');
});

test('ship mechanism tags follow the edited draft immediately without a fresh report',()=>{
  const h=harness();h.store.const.$ships[2].api_name='夕張改二丁';
  h.store.const.$equips[500]={api_id:500,api_name:'甲標的 甲型',api_type:[0,0,22,22]};
  h.store.info.equips[101]={api_id:101,api_slotitem_id:500};
  h.set('slots',[{...W.entry(h.store,2),slots:[101,-1]}]);
  let tree=h.render();assert(h.find(tree,n=>n.props['data-mechanism']==='torpedo'));
  assert.equal(h.find(tree,n=>n.props['data-mechanism']==='torpedo').props['data-category'],'torpedo');
  assert(h.find(h.find(tree,n=>n.props['data-mechanism']==='torpedo'),n=>n.props.className==='paa-wb-mechanism-icon'&&n.props['aria-hidden']===true));
  assert.equal(h.find(tree,n=>n.props['data-mechanism']==='asw').props['data-state'],'ready');
  h.set('slots',[{...W.entry(h.store,2),slots:[-1,-1]}]);tree=h.render();
  assert(!h.find(tree,n=>n.props['data-mechanism']==='torpedo'));
  assert(h.find(tree,n=>n.props['data-mechanism']==='asw'));
});

test('normal top metrics show the current fleet speed and update when the draft changes',()=>{
  const h=harness();h.store.info.ships[2].api_soku=5;h.store.const.$ships[2].api_soku=5;
  const settle=ids=>{h.set('slots',ids.map(id=>W.entry(h.store,id)));h.set('report',W.inspect(h.service,h.store,h.get('slots'),{kind:'normal',fleet:1,area:'3-5',target:'boss',phase:'',missionId:1,revision:0}));};
  const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join(' ');
  settle([2,3]);let metric=h.find(h.render(),n=>n.props.className==='paa-wb-metric speed');
  assert.equal(metric.children[1].children[0],'含低速舰');assert.equal(metric.props['data-tier'],1);assert.match(metric.props['data-tooltip'],/低速/);
  assert.equal(metric.children[0].type,'svg');assert(!h.find(metric,n=>n.type==='span'),'only a single conclusion, no repeated speed heading');
  settle([3]);metric=h.find(h.render(),n=>n.props.className==='paa-wb-metric speed');assert.equal(metric.children[1].children[0],'高速统一');
  h.store.info.ships[3].api_soku=15;settle([3]);metric=h.find(h.render(),n=>n.props.className==='paa-wb-metric speed');assert.equal(metric.children[1].children[0],'高速+统一');assert.equal(metric.props['data-tier'],3);
  h.store.info.ships[3].api_soku=20;settle([3]);metric=h.find(h.render(),n=>n.props.className==='paa-wb-metric speed');assert.equal(metric.children[1].children[0],'最速统一');
  settle([]);metric=h.find(h.render(),n=>n.props.className==='paa-wb-metric speed');assert.equal(metric.children[1].children[0],'—');
});

test('speed shows selected route gate hints, clears them on deselection, and no LoS requirement is positive',()=>{
  const h=harness();h.set('area','3-2');
  h.set('mapRoute',W.mapOverview('3-2').options.find(o=>o.strategy?.minimumSpeed==='fastPlus').key);
  let metric=h.find(h.render(),n=>n.props.className==='paa-wb-metric speed');
  assert.equal(metric.props['data-has-requirement'],'true');
  assert.equal(h.find(metric,n=>n.type==='small').children[0],'C/E/G 点 · 高速+以上');
  assert.match(metric.props['data-tooltip'],/C\/E\/G 点/);
  h.set('mapRoute','');metric=h.find(h.render(),n=>n.props.className==='paa-wb-metric speed');
  assert.equal(metric.props['data-has-requirement'],undefined);assert(!h.find(metric,n=>n.type==='small'));
  h.set('area','1-1');h.set('mapRoute',W.mapOverview('1-1').options[0].key);
  const los=h.find(h.render(),n=>n.props.className==='paa-wb-metric los');
  assert.equal(los.props['data-tone'],'green');
  assert(h.find(los,n=>n.props.className==='paa-wb-metric-state').children.includes('无需索敌'));
  assert.deepEqual(h.calls,{fleet:0,equipment:0});
});

test('speed badges expose four color tiers and distinct filled bars, with no empty fallback',()=>{
  const h=harness();
  for(const [code,label,tier] of [[5,'低速',1],[10,'高速',2],[15,'高速+',3],[20,'最速',4]]){
    h.store.info.ships[2].api_soku=code;h.set('slots',[W.entry(h.store,2)]);
    const tree=h.render(),badge=h.find(tree,n=>n.props['data-mechanism']==='speed');
    assert(badge.children.includes(label));assert.equal(badge.props['data-category'],'speed');
    assert.equal(badge.props['data-tier'],tier);
    const icon=h.find(badge,n=>n.type==='svg');assert.equal(icon.props['data-tier'],tier);
    assert.equal(icon.children.filter(n=>n.props.fill==='currentColor').length,tier);
    assert(!h.find(tree,n=>n.props.className==='paa-wb-mechanism-empty'));
    assert(!h.find(tree,n=>n.props.className==='paa-wb-ship-speed'),'speed only belongs in the mechanism row');
  }
  delete h.store.info.ships[2].api_soku;delete h.store.const.$ships[2].api_soku;
  const unknown=h.find(h.render(),n=>n.props['data-mechanism']==='speed');
  assert(unknown.children.includes('速力待确认'));assert.equal(h.find(unknown,n=>n.type==='svg').props['data-tier'],0);
  assert.equal(h.calls.fleet+h.calls.equipment,0,'display updates never launch a recommendation');
});

test('carrier badge asks for air superiority and night attacks update when expansion guns are removed',()=>{
  const h=harness(),store=h.store;
  const equip=(id,type)=>{store.const.$equips[id]={api_id:id,api_name:'装备'+id,api_type:[0,0,type,0]};store.info.equips[id]={api_id:id,api_slotitem_id:id};};
  equip(600,6);equip(601,7);equip(602,8);equip(603,2);equip(604,2);equip(605,4);
  Object.assign(store.const.$ships[1],{api_stype:11,api_slot_num:3,api_maxeq:[12,12,12]});
  store.info.ships[1].api_slot=[600,601,602];store.info.ships[1].api_onslot=[12,12,12];
  store.const.$ships[2].api_stype=6;store.info.ships[2].api_slot_ex=-1;
  h.set('slots',[W.entry(store,1),{...W.entry(store,2),slots:[603,604],ex:605}]);
  let tree=h.render();const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join(' ');
  const carrier=h.find(tree,n=>n.props['data-mechanism']==='carrier-ci');
  assert.equal(text(carrier).trim(),'战爆联合·FBA');assert.match(carrier.props['data-tooltip'],/需空优／空确/);
  assert.equal(carrier.props['data-category'],'day');
  const dayAir=h.find(tree,n=>n.props['data-mechanism']==='opening-air');
  assert(dayAir.children.includes('开幕航空攻击'));assert.equal(dayAir.props['data-category'],'aviation');
  for(const badge of [carrier,dayAir])assert(h.find(badge,n=>n.props.className==='paa-wb-mechanism-icon'&&n.props['aria-hidden']===true));
  assert.match(dayAir.props['data-tooltip'],/开幕航空战中攻击敌舰/);
  equip(605,11);Object.assign(store.const.$ships[1],{api_slot_num:3,api_maxeq:[18,18,18]});
  store.info.ships[1].api_slot=[-1,-1,-1];
  h.set('slots',[{...W.entry(store,1),slots:[601,602,605]}]);
  const mixedTree=h.render(),plane=h.find(mixedTree,n=>n.props['data-mechanism']==='opening-air'&&n.props.key==='opening-air:aircraft'),seaplane=h.find(mixedTree,n=>n.props['data-mechanism']==='opening-air'&&n.props.key==='opening-air:seaplane');
  assert(plane&&seaplane);assert(h.find(plane,n=>n.props['data-mechanism-art']==='aircraft'));
  assert.equal(plane.props['data-category'],'aviation');assert.equal(seaplane.props['data-category'],'aviation');
  assert(h.find(seaplane,n=>n.props['data-mechanism-art']==='seaplane'));assert.notEqual(plane.props.key,seaplane.props.key);
  assert.match(text(h.find(tree,n=>n.props['data-mechanism']==='night')),/夜战炮击 CI/);
  assert.equal(h.find(tree,n=>n.props['data-mechanism']==='night').props['data-category'],'night');
  h.set('slots',[W.entry(store,1),{...W.entry(store,2),slots:[603,604],ex:-1}]);tree=h.render();
  assert.match(text(h.find(tree,n=>n.props['data-mechanism']==='night')),/夜战连击/);
});

test('compact tooltips use the actual loadout detail for every mechanism without category prefixes or hidden conditions',()=>{
  const cases=[
    ['asw-synergy',2,[['四式水中聴音機',14],['三式爆雷投射機',15]],/小型声呐＋投射机/],
    ['torpedo',3,[['甲標的 甲型',22]],/甲标的/],
    ['barrage',6,[['12cm30連装噴進砲改二',21]],/不保护其他舰/],
    ['smoke',2,[['発煙装置(煙幕)',54]],/本舰数量：1 件/],
    ['spotting',6,[['主炮',2],['主炮',2],['水上侦察机',10]],/攻击力：.* × 2击/],
    ['carrier-ci',11,[['舰战',6],['舰爆',7],['舰攻',8]],/FBA\n攻击力：/]
  ];
  for(const [key,type,gear,expected]of cases){
    const h=harness(),store=h.store;
    Object.assign(store.const.$ships[1],{api_stype:type,api_slot_num:gear.length,api_maxeq:gear.map(()=>12)});
    Object.assign(store.info.ships[1],{api_nowhp:30,api_maxhp:30,api_slot_ex:-1});
    const slots=gear.map(([name,type],i)=>{
      const id=600+i;store.const.$equips[id]={api_id:id,api_name:name,api_type:[0,0,type,0]};
      store.info.equips[id]={api_id:id,api_slotitem_id:id};return id;
    });
    const entries=[{...W.entry(store,1),slots}];h.set('slots',entries);
    const badge=h.find(h.render(),n=>n.props['data-mechanism']===key),detail=badge.props['data-tooltip'];
    const actual=require('../../src/domain/combat/ship_mechanisms').fleetMechanisms(store,entries).get(1).find(b=>b.key===key);
    assert.equal(detail,actual.detail);assert.match(detail,expected);
    assert(!/^(?:对空|对潜|雷击|昼战|夜战|辅助)：/.test(detail));
    assert(!/按出击前补满判断|各组合优先级不在此预测|未套用CI公式/.test(detail));
    assert(detail.length<=160,key+' tooltip too verbose');assert.equal(h.calls.fleet+h.calls.equipment,0);
  }
});

test('illumination and smoke keep their text and show distinct decorative auxiliary icons',()=>{
  const h=harness(),store=h.store;
  store.const.$equips[600]={api_id:600,api_name:'探照灯',api_type:[0,0,29,24]};
  store.info.equips[600]={api_id:600,api_slotitem_id:600};
  h.set('slots',[{...W.entry(store,2),slots:[600,-1]}]);
  const badge=h.find(h.render(),n=>n.props['data-mechanism']==='illumination');
  assert(badge.children.includes('照明'));assert.equal(badge.props['data-category'],'support');
  const lightIcon=h.find(badge,n=>n.props.className==='paa-wb-mechanism-icon');
  assert(lightIcon);assert.equal(lightIcon.props['aria-hidden'],true);assert.equal(lightIcon.props['data-equipment-icon'],27);
  assert.equal(lightIcon.props.style.backgroundColor,'currentColor');
  assert.match(badge.props['data-tooltip'],/探照灯.*集火/);
  store.const.$equips[600].api_name='発煙装置(煙幕)';store.const.$equips[600].api_type=[0,0,54,0];
  const smoke=h.find(h.render(),n=>n.props['data-mechanism']==='smoke');assert(smoke.children.includes('烟幕'));
  const smokeIcon=h.find(smoke,n=>n.props.className==='paa-wb-mechanism-icon');
  assert(smokeIcon);assert.equal(smokeIcon.props['aria-hidden'],true);assert.equal(smokeIcon.props['data-equipment-icon'],54);
  assert.notEqual(lightIcon.props.style.maskImage,smokeIcon.props.style.maskImage);
  h.set('slots',[{...W.entry(store,2),slots:[-1,-1]}]);assert(!h.find(h.render(),n=>n.props['data-mechanism']==='illumination'));
  assert.equal(h.calls.fleet+h.calls.equipment,0);
});

test('expedition badge icons retain a single sparkle and cover morale, transport drums and income',()=>{
  const h=harness('expedition'),store=h.store;
  store.const.$equips[75]={api_id:75,api_name:'ドラム缶(輸送用)',api_type:[0,0,30,0]};
  store.info.equips[700]={api_id:700,api_slotitem_id:75};store.info.ships[1].api_slot=[700,-1];
  store.info.ships[1].api_cond=65;h.set('slots',[W.entry(store,1)]);
  const findIcon=badge=>h.find(badge,n=>n.props.className==='paa-wb-mechanism-icon');
  let tree=h.render(),morale=h.find(tree,n=>n.props['data-mechanism']==='expedition-morale');
  assert(morale.children.includes('✦ 有闪 65'));assert.match(morale.props['data-tooltip'],/\n\n士气：65\n/);assert(!findIcon(morale),'existing sparkle must not receive a second icon');
  const drums=findIcon(h.find(tree,n=>n.props['data-mechanism']==='expedition-drums'));assert(drums);
  assert.match(h.find(tree,n=>n.props['data-mechanism']==='expedition-drums').props['data-tooltip'],/\n\n运输桶：1 个\n/);assert.equal(drums.props['aria-hidden'],true);assert.equal(drums.props.tabIndex,undefined);assert.equal(drums.props['data-equipment-icon'],25);
  store.const.$equips[68]={api_id:68,api_name:'大発動艇',api_type:[0,0,24,20]};store.info.equips[701]={api_id:701,api_slotitem_id:68};
  h.set('slots',[{...W.entry(store,1),slots:[700,701]}]);tree=h.render();
  const income=h.find(tree,n=>n.props['data-mechanism']==='expedition-income');assert(income);assert(income.children.includes('基础收益 +5%'));
  assert.match(income.props['data-tooltip'],/\n\n装备加成：\+5%/);assert.equal(income.props['data-category'],'income');assert.equal(findIcon(income).props['data-equipment-icon'],20);
  const row=h.find(tree,n=>n.props.className==='paa-wb-mechanisms');assert(row.children.includes(income));assert(row.children.some(n=>n.props?.['data-mechanism']==='expedition-drums'));
  store.info.ships[1].api_cond=49;tree=h.render();morale=h.find(tree,n=>n.props['data-mechanism']==='expedition-morale');
  assert(morale.children.includes('士气 49'));assert(findIcon(morale));
  store.info.ships[1].api_cond=null;tree=h.render();morale=h.find(tree,n=>n.props['data-mechanism']==='expedition-morale');
  assert.equal(morale.props['data-state'],'unknown');assert(findIcon(morale));assert.equal(h.calls.fleet+h.calls.equipment,0);
});

test('mechanism masks reuse bundled game silhouettes and inherit each badge color',()=>{
  const fs=require('fs'),{fileURLToPath}=require('url');
  const icon=require('../../src/ui/components/mechanism_badges').createIcon({createElement:(type,props,...children)=>({type,props,children})});
  const cases=[['asw',null,18],['asw-synergy',null,17],
    ['torpedo',null,5],['spotting',null,2],['special-shelling',null,3],['special-night',null,3],['special-submarine',null,5],
    ['ground',null,12],['ground','rocket',31],['ground','landing',20],['ground','beaching',52],
    ['smoke',null,54],['illumination',null,27],['expedition-drums',null,25],['expedition-income',null,20]];
  for(const [key,variant,type] of cases){
    const node=icon({key,variant}),style=node.props.style,file=fileURLToPath(style.maskImage.match(/^url\("(.+)"\)$/)[1]),png=fs.readFileSync(file);
    assert.equal(node.props['data-equipment-icon'],type);assert.equal(node.props['aria-hidden'],true);assert.equal(node.props.tabIndex,undefined);
    assert.equal(node.type,'span');assert.equal(style.maskMode,'alpha');assert.equal(style.backgroundColor,'currentColor');
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    const size=style.maskSize.split(' ').map(parseFloat),position=style.maskPosition.split(' ').map(parseFloat);
    assert(size.every(n=>Number.isFinite(n)&&n>0)&&position.every(Number.isFinite));
    assert.equal(size[0]/size[1],png.readUInt32BE(16)/png.readUInt32BE(20));
    assert.equal(style.width,16);assert.equal(style.height,14);assert.equal(style.transform,undefined);
    if(['asw','asw-synergy'].includes(key)){const bounds=key==='asw'?[32,32]:[36,34];assert(Math.max(...bounds)*size[0]/png.readUInt32BE(16)<=13.01);}
    assert.equal(style.maskImage,`url("${require('../../src/ui/models/presentation_model').equipmentIconUrl(type)}")`);
  }
  const aa=icon({key:'aaci'});assert.equal(aa.type,'svg');assert.equal(aa.props['data-equipment-icon'],16);assert.equal(aa.props.fill,'currentColor');assert.equal(aa.props.width,14);assert.equal(aa.props.height,14);assert.equal(aa.props.viewBox,'13 10 32 32');assert.equal(aa.children.length,1);assert.equal(aa.children[0].type,'path');
  for(const key of ['night-contact','night-zuiun','opening-air']){
    const node=icon({key,variant:key==='opening-air'?'seaplane':undefined});assert.equal(node.type,'svg');assert.equal(node.props['data-equipment-icon'],10);
    assert.equal(node.props['data-mechanism-art'],'seaplane');assert.equal(node.props.fill,'currentColor');
    assert.equal(node.props.width,18);assert.equal(node.props.height,14);assert.equal(node.children.length,1);
    assert.equal(node.children[0].type,'path');
    assert.equal(node.children[0].props.d,icon({key:'night-contact'}).children[0].props.d);
  }
  for(const key of ['asw']){
    const plane=icon({key,effect:'aviation'});assert.equal(plane.props['data-mechanism-art'],'aircraft');
    assert.equal(plane.props.fill,'currentColor');assert.equal(plane.props.width,18);assert.equal(plane.props.height,14);
    assert.equal(plane.props['data-equipment-icon'],undefined);
  }
  assert.equal(icon({key:'asw-synergy',effect:'aviation'}).props['data-equipment-icon'],17,'synergy keeps its original depth-charge silhouette');
  for(const [key,variant] of [['opening-air'],['carrier-ci'],['night-air'],['night-carrier-ci'],['ground','aircraft']]){
    const node=icon({key,variant});
    assert.equal(node.type,'svg');assert.equal(node.props.fill,'currentColor');assert.equal(node.props['data-mechanism-art'],'aircraft');
    assert.equal(node.props.width,18);assert.equal(node.props.height,14);assert.equal(node.props['aria-hidden'],true);assert.equal(node.props.focusable,false);
    assert.equal(node.children.length,1);assert.equal(node.children[0].type,'path');
    assert.equal(node.props['data-equipment-icon'],undefined,'plane must not include the equipment emblem');
  }
  for(const [label,effect,type] of [['夜战连击','shelling',2],['夜战炮击 CI','shelling',2],['夜战雷击 CI','torpedo',5]])
    assert.equal(icon({key:'night',label,effect}).props['data-equipment-icon'],type);
  const barrage=icon({key:'barrage'});assert.equal(barrage.type,'svg');assert.equal(barrage.props.fill,'currentColor');assert.equal(barrage.props.width,14);assert.equal(barrage.props.height,14);assert.equal(barrage.children.length,1);
  assert.equal(icon({key:'speed'}),null);assert.equal(icon({key:'expedition-morale',label:'✦ 有闪 65'}),null);
});

test('jet assault has its own silver icon and precedes torpedo and ordinary aviation without changing badge height',()=>{
  const fs=require('fs'),{fileURLToPath}=require('url'),React={createElement:(type,props,...children)=>({type,props,children})};
  const badges=require('../../src/ui/components/mechanism_badges')(React)([
    {key:'opening-air',label:'开幕航空攻击',state:'ready'},{key:'torpedo',label:'先制雷击',state:'ready'},
    {key:'jet-assault',label:'喷式强袭',state:'ready'}]);
  assert.deepEqual(badges.map(b=>b.props['data-mechanism']),['jet-assault','torpedo','opening-air']);
  assert.equal(badges[0].props['data-category'],'jet');assert.equal(badges[0].props.className,'paa-wb-mechanism');
  const icon=require('../../src/ui/components/mechanism_badges').createIcon(React)({key:'jet-assault'});
  assert.equal(icon.props.style.width,18);assert.equal(icon.props.style.height,14);
  assert.equal(icon.props.style.backgroundColor,'currentColor');
  const asset=fileURLToPath(icon.props.style.maskImage.match(/^url\("(.+)"\)$/)[1]);
  assert.match(asset,/jet-assault\.svg$/);assert.match(fs.readFileSync(asset,'utf8'),/<path/);
});

test('jet SVG preserves selected twin-engine B instead of filling the transparent exterior',()=>{
  const svg=require('fs').readFileSync(require('path').join(__dirname,'../../data/icons/material/jet-assault.svg'),'utf8');
  const box=svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
  assert(!svg.includes('transform='),'compare the actual exported coordinates');
  const values=svg.match(/ d="([^"]+)"/)[1].match(/-?\d+(?:\.\d+)?/g).map(Number);
  const polygon=[];for(let i=0;i<values.length;i+=2)polygon.push([values[i],values[i+1]]);
  // Independent 48x32 alpha reference from selected B, before tracing its exterior.
  const reference=[
    '000000000000','000000000180','000000000300','000000000300','000000000300','000000020700','00000003c700','60000000ff00',
    'f80000003f80','3e0000003ff0','1f8000007efe','0fe00003fe02','07fc001ffc00','03fe00fff800','01ff83ffe000','00ffefffc000',
    '003fffff8000','007fffff0000','01fffffc0000','03f3fffc0000','03f3fffe0000','01e7ffff8000','001ffffff000','003ffffffc00',
    '007ff8ffff00','00ffe01fffc0','01ff803fffe0','03fe007f3ff8','03f800fe03fe','03e000fc003f','000000f00000','000000400000'
  ].map(row=>BigInt('0x'+row));
  let intersection=0,union=0;
  for(let y=0;y<32;y++)for(let x=0;x<48;x++){
    const px=box[0]+(x+.5)*box[2]/48,py=box[1]+(y+.5)*box[3]/32;let inside=false;
    for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
      const [ax,ay]=polygon[i],[bx,by]=polygon[j];
      if((ay>py)!==(by>py)&&px<(bx-ax)*(py-ay)/(by-ay)+ax)inside=!inside;
    }
    const expected=!!(reference[y]&(1n<<BigInt(47-x)));
    if(inside&&expected)intersection++;if(inside||expected)union++;
  }
  assert(intersection/union>.97,'the silhouette must match B, including transparent space outside wings and tail');
});

test('combined ground icons retain each game silhouette once inside a single noninteractive group',()=>{
  const icon=require('../../src/ui/components/mechanism_badges').createIcon({createElement:(type,props,...children)=>({type,props,children})});
  for(const ids of [['landing','rocket'],['landing','aircraft']]){
    const group=icon({key:'ground',variant:'combined',categories:ids.concat(ids[0]).map(id=>({id}))});
    assert.equal(group.props.className,'paa-wb-mechanism-icons');assert.equal(group.props['aria-hidden'],true);
    assert.equal(group.props.tabIndex,undefined);assert.equal(group.children.length,2);
    assert.equal(group.children[0].children[0].props['data-equipment-icon'],20);
    const second=group.children[1].children[0];
    if(ids[1]==='rocket')assert.equal(second.props['data-equipment-icon'],31);
    else assert.equal(second.props['data-mechanism-art'],'aircraft');
  }
});

test('special attack tags follow formation positions and expose formation and blocker details without search',()=>{
  const h=harness(),store=h.store;
  Object.assign(store.const.$ships[1],{api_name:'大和改二重',api_stype:10});
  Object.assign(store.const.$ships[2],{api_name:'武蔵改二',api_stype:9});
  for(const ship of Object.values(store.info.ships))Object.assign(ship,{api_nowhp:100,api_maxhp:100});
  const slots=[1,2,3,4,5,6].map(id=>W.entry(store,id));h.set('slots',slots);
  let badge=h.find(h.render(),n=>n.props['data-mechanism']==='special-shelling');
  assert(badge.children.includes('大和型齐射'));assert.equal(badge.props['data-category'],'special');
  assert.equal(badge.props['data-state'],'conditional');assert.match(badge.props['data-tooltip'],/梯形阵/);
  assert.match(badge.props['data-tooltip'],/第 2 位 武蔵改二\n昼战攻击力：/);assert(!badge.props['data-tooltip'].includes('发动后带动'));
  for(const id of [2,3,4,5,6]){
    const card=h.find(h.render(),n=>n.props['data-ship-id']===id);
    assert(!h.find(card,n=>n.props['data-mechanism']==='special-shelling'),'participants must not repeat the trigger badge');
  }
  const reordered=slots.slice();[reordered[1],reordered[2]]=[reordered[2],reordered[1]];h.set('slots',reordered);
  badge=h.find(h.render(),n=>n.props['data-mechanism']==='special-shelling');
  assert.equal(badge.props['data-state'],'blocked');assert.match(badge.props['data-tooltip'],/第 2 位需指定战舰/);
  [reordered[0],reordered[3]]=[reordered[3],reordered[0]];h.set('slots',reordered);
  assert(!h.find(h.render(),n=>n.props['data-mechanism']==='special-shelling'));
  Object.assign(store.const.$ships[4],{api_name:'金剛改二丙',api_stype:8});
  Object.assign(store.const.$ships[3],{api_name:'比叡改二丙',api_stype:8});
  badge=h.find(h.render(),n=>n.props['data-mechanism']==='special-night');
  assert.equal(badge.props['data-category'],'special');assert.match(badge.props['data-tooltip'],/单纵阵／梯形阵/);
  assert.equal(h.calls.fleet+h.calls.equipment,0);
});

test('French and submarine special tags keep gold category and only mark the commander',()=>{
  const h=harness(),store=h.store;
  Object.assign(store.const.$ships[1],{api_name:'Richelieu改',api_stype:8});
  Object.assign(store.const.$ships[2],{api_name:'Jean Bart改',api_stype:8});
  h.set('slots',[1,2,3,4,5,6].map(id=>W.entry(store,id)));
  let badge=h.find(h.render(),n=>n.props['data-mechanism']==='special-shelling');
  assert(badge.children.includes('Richelieu级齐射'));assert.equal(badge.props['data-category'],'special');
  assert.match(badge.props['data-tooltip'],/^参考发动率：待确认/);assert.match(badge.props['data-tooltip'],/复纵阵/);
  for(const id of [1,2])Object.assign(store.info.ships[id],{api_lv:99,api_lucky:[40,99]});
  let frenchTree=h.render();badge=h.find(frenchTree,n=>n.props['data-mechanism']==='special-shelling');
  assert.match(badge.props['data-tooltip'],/^参考发动率：65.0%/);
  assert(!h.find(h.find(frenchTree,n=>n.props['data-ship-id']===2),n=>n.props['data-mechanism']==='special-shelling'));
  Object.assign(store.const.$ships[1],{api_name:'Colorado改',api_stype:9});
  Object.assign(store.const.$ships[2],{api_name:'Maryland改',api_stype:9});
  Object.assign(store.const.$ships[3],{api_name:'長門改二',api_stype:9});
  Object.assign(store.info.ships[3],{api_lv:99,api_lucky:[40,99]});
  badge=h.find(h.render(),n=>n.props['data-mechanism']==='special-shelling');
  assert.match(badge.props['data-tooltip'],/^参考发动率：63.0%（待验证）/);
  Object.assign(store.const.$ships[1],{api_name:'迅鯨改',api_stype:20});
  Object.assign(store.const.$ships[2],{api_name:'伊58改',api_stype:14});
  Object.assign(store.const.$ships[3],{api_name:'伊168改',api_stype:13});
  store.info.useitems={95:{api_id:95,api_count:2}};h.set('slots',[1,2,3].map(id=>W.entry(store,id)));
  const tree=h.render();badge=h.find(tree,n=>n.props['data-mechanism']==='special-submarine');
  assert(badge.children.includes('潜水舰队攻击'));assert.equal(badge.props['data-category'],'special');
  assert.equal(badge.props['data-state'],'conditional');assert.match(badge.props['data-tooltip'],/持有物资：2 件/);
  assert.match(badge.props['data-tooltip'],/^参考发动率：66.0%（待验证）/);
  assert.equal(h.find(badge,n=>n.props['data-equipment-icon']===5)?.type,'span');
  for(const id of [2,3])assert(!h.find(h.find(tree,n=>n.props['data-ship-id']===id),n=>n.props['data-mechanism']==='special-submarine'));
  store.const.$equips[214]={api_id:214,api_name:'潜水艦搭載電探＆水防式望遠鏡',api_type:[0,0,51,11]};
  store.info.equips[214]={api_id:214,api_slotitem_id:214};
  h.set('slots',[W.entry(store,1),{...W.entry(store,2),ex:214},W.entry(store,3)]);
  badge=h.find(h.render(),n=>n.props['data-mechanism']==='special-submarine');
  assert.match(badge.props['data-tooltip'],/^参考发动率：76.0%（待验证）/);
  delete store.info.ships[3].api_lucky;
  badge=h.find(h.render(),n=>n.props['data-mechanism']==='special-submarine');
  assert.match(badge.props['data-tooltip'],/^参考发动率：待确认\n要求阵型：[^\n]+\n缺少第 3 位运/);
  assert.equal(h.calls.fleet+h.calls.equipment,0);
});

test('night Zuiun tag follows equipment edits and preserves night fallback in the same category',()=>{
  const h=harness(),store=h.store;
  Object.assign(store.const.$ships[1],{api_name:'最上改二特',api_stype:6,api_slot_num:3,api_maxeq:[0,0,12]});
  Object.assign(store.info.ships[1],{api_nowhp:30,api_maxhp:30});
  for(const [id,type,name] of [[600,2,'主炮'],[601,2,'主炮'],[602,11,'試製 夜間瑞雲(攻撃装備)']]){
    store.const.$equips[id]={api_id:id,api_name:name,api_type:[0,0,type,0]};
    store.info.equips[id]={api_id:id,api_slotitem_id:id};
  }
  h.set('slots',[{...W.entry(store,1),slots:[600,601,602]}]);
  const tree=h.render(),badge=h.find(tree,n=>n.props['data-mechanism']==='night-zuiun');
  assert(badge.children.includes('夜战瑞云 CI'));assert.equal(badge.props['data-category'],'night');
  assert.match(badge.props['data-tooltip'],/照明效果/);assert(h.find(tree,n=>n.props['data-mechanism']==='night'));
  h.set('slots',[{...W.entry(store,1),slots:[600,601,-1]}]);assert(!h.find(h.render(),n=>n.props['data-mechanism']==='night-zuiun'));
  assert.equal(h.calls.fleet+h.calls.equipment,0);
});

test('night contact follows draft equipment immediately, uses a night scout icon and retains its concise conditions',()=>{
  const h=harness(),store=h.store;
  Object.assign(store.const.$ships[1],{api_stype:6,api_maxeq:[0,4]});
  store.const.$equips[600]={api_id:600,api_name:'Walrus',api_type:[0,0,10,50]};
  store.info.equips[600]={api_id:600,api_slotitem_id:600};
  h.set('slots',[{...W.entry(store,1),slots:[-1,600]}]);
  let badge=h.find(h.render(),n=>n.props['data-mechanism']==='night-contact');
  assert(badge.children.includes('夜间接触'));assert.equal(badge.props['data-category'],'night');
  assert.equal(badge.props['data-state'],'conditional');assert.match(badge.props['data-tooltip'],/开幕夜战不限/);
  assert.equal(h.find(badge,n=>n.props.className==='paa-wb-mechanism-icon').props['data-equipment-icon'],10);
  h.set('slots',[{...W.entry(store,1),slots:[600,-1]}]);
  badge=h.find(h.render(),n=>n.props['data-mechanism']==='night-contact');
  assert.equal(badge.props['data-state'],'blocked');assert.match(badge.props['data-tooltip'],/容量：0 架/);
  h.set('slots',[{...W.entry(store,1),slots:[-1,-1]}]);
  assert(!h.find(h.render(),n=>n.props['data-mechanism']==='night-contact'));assert.equal(h.calls.fleet+h.calls.equipment,0);
});

test('night aviation tag follows equipment edits without a recommendation and uses the night category',()=>{
  const h=harness(),store=h.store;
  Object.assign(store.const.$ships[1],{api_name:'赤城改二戊',api_stype:11,api_slot_num:3,api_maxeq:[12,12,12]});
  Object.assign(store.const.$ships[1],{api_houg:[50,100],api_raig:[0,0]});
  Object.assign(store.info.ships[1],{api_lucky:[30,99],api_lv:99,api_kyouka:[10,0,0,0,0]});
  store.const.$equips[600]={api_id:600,api_name:'F6F-5N',api_type:[3,5,6,45,21]};
  store.info.equips[600]={api_id:600,api_slotitem_id:600};
  h.set('slots',[{...W.entry(store,1),slots:[600,-1,-1]}]);
  const badge=h.find(h.render(),n=>n.props['data-mechanism']==='night-air');
  assert(badge.children.includes('夜间航空攻击'));assert.equal(badge.props['data-category'],'night');
  assert.match(badge.props['data-tooltip'],/不要求空优/);
  store.const.$equips[601]={api_id:601,api_name:'TBM-3D',api_type:[3,5,8,46,0]};store.info.equips[601]={api_id:601,api_slotitem_id:601};
  h.set('slots',[{...W.entry(store,1),slots:[600,601,-1]}]);
  const tree=h.render(),cutin=h.find(tree,n=>n.props['data-mechanism']==='night-carrier-ci');
  assert(cutin.children.includes('空母夜袭 CI'));assert.equal(cutin.props['data-category'],'night');assert.match(cutin.props['data-tooltip'],/^发动率：55.8%\n\n夜战＋夜攻\n攻击力：.* × 1击/);
  assert.match(cutin.props['data-tooltip'],/发动率：55.8%/);
  assert(!/完好基准|临时加成|敌甲|Lv\.|运 /.test(cutin.props['data-tooltip']));
  const oldDetail=cutin.props['data-tooltip'];
  h.set('slots',[null,{...W.entry(store,1),slots:[600,601,-1]}]);
  const moved=h.find(h.render(),n=>n.props['data-mechanism']==='night-carrier-ci');
  assert.match(moved.props['data-tooltip'],/发动率：43.3%/);
  assert.notEqual(moved.props['data-tooltip'],oldDetail);
  assert(!h.find(tree,n=>n.props['data-mechanism']==='night-air'));assert(h.find(cutin,n=>n.props['data-mechanism-art']==='aircraft'));
  h.set('slots',[{...W.entry(store,1),slots:[-1,-1,-1]}]);assert(!h.find(h.render(),n=>n.props['data-mechanism']==='night-air'));
  assert.equal(h.calls.fleet+h.calls.equipment,0);
});

test('night tooltip recalculates blue combination bonuses after a manual radar change without searching',()=>{
  const h=harness(),store=h.store;
  Object.assign(store.const.$ships[1],{api_houg:[30,100],api_raig:[50,100],api_ctype:38,api_aftershipid:'0',api_slot_num:3});
  Object.assign(store.info.ships[1],{api_kyouka:[10,20,0,0,0],api_lv:99,api_lucky:[30,99]});
  store.const.$equips[267]={api_id:267,api_name:'12.7cm連装砲D型改二',api_type:[0,0,1,1],api_houg:3};
  store.const.$equips[28]={api_id:28,api_name:'22号対水上電探',api_type:[0,0,12,11],api_saku:5};
  for(const [id,master]of [[600,267],[601,267],[602,28]])store.info.equips[id]={api_id:id,api_slotitem_id:master,api_level:0};
  const entry={...W.entry(store,1),slots:[600,601,602]};h.set('slots',[entry]);
  let badge=h.find(h.render(),n=>n.props['data-mechanism']==='night');
  assert.match(badge.props['data-tooltip'],/\n\n双炮连击\n攻击力：150 × 2击/);assert(!/完好基准|未计临时|未扣敌甲|Lv\.|运 /.test(badge.props['data-tooltip']));
  h.set('slots',[{...entry,slots:[600,601,-1]}]);badge=h.find(h.render(),n=>n.props['data-mechanism']==='night');
  assert.match(badge.props['data-tooltip'],/\n\n双炮连击\n攻击力：144 × 2击/);assert.equal(h.calls.fleet+h.calls.equipment,0);
});

test('aircraft rows show full destination capacity alongside pins and update after equipment changes',()=>{
  const h=harness(),store=h.store;
  for(const [id,type] of [[600,6],[601,10],[602,2]]){
    store.const.$equips[id]={api_id:id,api_name:'装备'+id,api_type:[0,0,type,0]};
    store.info.equips[id]={api_id:id,api_slotitem_id:id};
  }
  Object.assign(store.const.$ships[1],{api_stype:11,api_slot_num:4,api_maxeq:[18,4,0,0]});
  Object.assign(store.info.ships[1],{api_slot:[600,601,602,-1],api_onslot:[0,1,0,0]});
  const draft={...W.entry(store,1),keep:{0:true}};h.set('slots',[draft]);
  const quantities=tree=>{const rows=[];const walk=n=>{if(!n||typeof n!=='object')return;
    if(n.props.className==='paa-wb-aircraft-count')rows.push(n);(n.children||[]).forEach(walk);};walk(tree);return rows;};
  let tree=h.render();assert.deepEqual(quantities(tree).map(n=>n.children[0]),['18 架','4 架']);
  assert.equal(quantities(tree)[0].props['aria-label'],'满载 18 架');assert(h.find(tree,n=>n.props.className==='paa-wb-kept'));
  h.set('slots',[{...draft,slots:[602,600,601,-1],ex:602}]);tree=h.render();
  assert.deepEqual(quantities(tree).map(n=>n.children[0]),['4 架','0 架']);
  store.const.$ships[1].api_maxeq=undefined;tree=h.render();
  assert.deepEqual(quantities(tree).map(n=>n.children[0]),['— 架','— 架']);
  assert.equal(quantities(tree)[0].props['aria-label'],'满载数量未知');
});

test('manual branch directions appear before filling a fleet and never claim a matched rule',()=>{
  const h=harness();h.set('area','5-3');h.set('mapRoute','guide:5-3-01');
  const tree=h.render(),choice=h.find(tree,n=>n.props.className==='paa-wb-player-choice');
  const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join(' ');
  assert(choice);assert.match(text(choice),/能动分歧.*请在游戏中选择 K 点/);
  assert(!h.find(tree,n=>n.props['data-state']==='matched'));
});

test('expanded map keeps the selected route and node without changing the fleet draft',()=>{
  const h=harness();h.set('mapRoute','guide:3-5-01');h.set('slots',[1,2,3,4,5,6].map(id=>W.entry(h.store,id)));
  for(const id of [1,2,3,4,5,6])h.store.info.ships[id].api_sakuteki=[200,200];
  h.set('report',W.inspect(h.service,h.store,h.get('slots'),{kind:'normal',fleet:1,area:'3-5',target:'boss',phase:'',missionId:1,revision:0}));
  const before=JSON.stringify(h.get('slots'));let tree=h.render();
  const viewport=h.find(tree,n=>n.props.className==='paa-map-viewport');
  assert(viewport.children.some(n=>n?.props?.className==='paa-map-expand'),'magnifier belongs to the map viewport');
  h.find(tree,n=>n.props['aria-label']==='放大海域地图').props.onClick();tree=h.render();
  let dialog=h.find(tree,n=>n.type==='dialog');assert(dialog);
  const maps=[];
  const walk=n=>{if(!n||typeof n!=='object')return;if(n.type==='svg'&&n.props.role==='group')maps.push(n);(n.children||[]).forEach(walk);};
  walk(tree);assert.equal(maps.length,2);
  const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join(' ');
  const routeLabels=map=>{const labels=[];const visit=n=>{if(!n||typeof n!=='object')return;
    if(['button','img'].includes(n.props.role)&&n.props.className?.split(' ').includes('active'))labels.push(n.props['aria-label']);
    (n.children||[]).forEach(visit);};visit(map);return labels;};
  assert.deepEqual(routeLabels(maps[0]),routeLabels(maps[1]));assert(routeLabels(maps[0]).length>1);
  const ids=n=>{const result=[];const visit=x=>{if(!x||typeof x!=='object')return;if(x.props.id)result.push(x.props.id);(x.children||[]).forEach(visit);};visit(n);return result;};
  assert(!ids(maps[0]).some(id=>ids(maps[1]).includes(id)),'map SVG masks and clips must not collide');
  h.find(dialog,n=>n.props.role==='button'&&n.props['aria-label']?.startsWith('F 点')).props.onClick({stopPropagation(){}});
  assert.equal(h.get('nodeId'),'F');tree=h.render();dialog=h.find(tree,n=>n.type==='dialog');
  const popover=h.find(dialog,n=>n.props.className==='paa-map-node-popover');
  assert(popover);assert.match(text(popover),/F 点/);
  assert(!h.find(dialog,n=>n.props.className==='paa-node-detail'),'node info must not add a row below the map');
  h.find(popover,n=>n.props['aria-label']==='关闭节点详情').props.onClick();tree=h.render();
  assert.equal(h.get('nodeId'),null);assert(!h.find(tree,n=>n.props.className==='paa-map-node-popover'));
  dialog=h.find(tree,n=>n.type==='dialog');assert(dialog,'closing node info keeps the enlarged map open');
  dialog.props.onCancel({preventDefault(){}});tree=h.render();
  assert(!h.find(tree,n=>n.type==='dialog'));assert.equal(h.get('mapRoute'),'guide:3-5-01');
  assert.equal(JSON.stringify(h.get('slots')),before);assert.equal(h.calls.fleet,0);
});

test('ship cards retain editable empty slots and controls without loadout explanations or donor provenance',()=>{
  const h=harness();h.set('area','1-1');h.set('slots',[W.entry(h.store,2),null,null,null,null,null]);
  const tree=h.render(),text=node=>typeof node==='string'?node:(node?.children||[]).map(text).join(' ');
  assert(!h.find(tree,n=>n.props.className==='paa-wb-loadout-reasons'));
  assert(!text(tree).includes('配装理由'));assert(text(tree).includes('空槽'));
  assert(h.find(h.find(tree,n=>n.props.className==='paa-wb-ship-head'),n=>n.props.className==='paa-wb-ship-actions'));
  assert(!h.find(tree,n=>n.props.className==='paa-wb-ship-footer'));
  assert(!h.find(tree,n=>n.props.className?.includes('paa-wb-gear changed')));
  assert(!text(tree).includes('借用自'));
});

test('direct ship removal preserves remaining drafts and equipment clearing stays in its picker',()=>{
  for(const kind of ['normal','expedition']){
    const h=harness(kind),draft=[W.entry(h.store,2),W.entry(h.store,3),{...W.entry(h.store,4),keep:{0:true},pin:true},null,null,null];
    h.set('slots',draft);const before=JSON.stringify(h.store);
    const card=tree=>h.find(tree,n=>n.props['data-ship-id']===3);
    let tree=h.render();h.find(card(tree),n=>n.props.className==='paa-wb-replace').props.onClick();
    tree=h.render();const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join(' ');
    assert(!text(h.find(tree,n=>n.props.className==='paa-wb-popup')).includes('移除'));
    h.set('popup',null);tree=h.render({busy:true});assert(h.find(card(tree),n=>n.props.className==='paa-wb-remove').props.disabled);
    tree=h.render();h.find(card(tree),n=>n.props.className==='paa-wb-remove').props.onClick();
    assert.deepEqual(h.get('slots'),[draft[0],draft[2],null,null,null,null]);
    assert.equal(h.get('popup'),null);assert.equal(JSON.stringify(h.store),before);
    assert.equal(h.calls.fleet,0);assert.equal(h.calls.equipment,0);
    tree=h.render();h.find(tree,n=>n.props.className==='paa-wb-gear').props.onClick();tree=h.render();
    assert(text(h.find(tree,n=>n.props.className==='paa-wb-popup')).includes('清空此槽'));
  }
});

test('apply becomes the same-position stop action during execution even when the draft is invalid',()=>{
  for(const kind of ['normal','expedition']){
    const h=harness(kind);let stops=0,applies=0;
    const props={onStop:()=>stops++,onApply:()=>applies++};
    const button=tree=>h.find(tree,n=>n.props.className==='paa-primary paa-wb-apply');
    let action=button(h.render(props));assert.equal(action.children[0],'应用编成');assert(action.props.disabled);
    action=button(h.render({...props,busy:true}));
    assert.equal(action.children[0],'停止操作');assert.equal(action.props.disabled,false);action.props.onClick();
    assert.equal(stops,1);assert.equal(applies,0);
    action=button(h.render({...props,busy:true,stopping:true}));
    assert.equal(action.children[0],'正在停止…');assert(action.props.disabled);action.props.onClick();assert.equal(stops,1);
    action=button(h.render(props));assert.equal(action.children[0],'应用编成');assert(action.props.disabled);
  }
});

test('automatic operations off hides the entire application module, preserves drafts, and keeps stop available',()=>{
  for(const kind of ['normal','expedition']){
    const h=harness(kind),slots=[W.entry(h.store,1),null,null,null,null,null];h.set('slots',slots);
    const module=tree=>h.find(tree,n=>n.props.className==='paa-wb-apply-controls');
    const before=JSON.stringify(h.get('slots'));
    assert(module(h.render({automaticOperations:true})));
    const off=h.render({automaticOperations:false});
    assert.equal(module(off),undefined);
    assert(h.find(off,n=>n.props.className==='paa-wb-complete'));
    assert(h.find(off,n=>n.type==='button'&&n.children.includes('一键清空')));
    assert.equal(JSON.stringify(h.get('slots')),before);
    let stops=0;const running=h.render({automaticOperations:false,busy:true,onStop:()=>stops++});
    const stop=h.find(running,n=>n.type==='button'&&n.children.includes('停止操作'));
    assert(stop);stop.props.onClick();assert.equal(stops,1);
    assert(module(h.render({automaticOperations:true})));
    assert.equal(JSON.stringify(h.get('slots')),before);
  }
});

test('ineligible expeditions and impossible Boss routes warn on apply without blocking intentional application',()=>{
  for(const kind of ['expedition','normal']){
    const h=harness(kind),fleet=kind==='expedition'?2:1,slots=[W.entry(h.store,1)],settings={kind,fleet,area:'3-5',target:'boss',phase:'',missionId:1,revision:0};
    h.set('slots',slots);
    const report=W.inspect(h.service,h.store,slots,settings);
    assert(report.valid);
    if(kind==='expedition')report.expedition={...report.expedition,eligible:false};
    else report.route={...report.route,verdict:'unreachable',probability:0,chanceRange:[0,0]};
    h.set('report',report);let applied=0;
    const button=props=>h.find(h.render({onApply:()=>applied++,...props}),n=>n.props.className==='paa-primary paa-wb-apply');
    let action=button();assert.equal(action.props['data-warning'],true);assert(!action.props.disabled);
    assert.match(action.children[0],kind==='expedition'?/未达标/:/不可达/);
    action.props.onClick();assert.equal(applied,1);
    action=button({busy:true});assert.equal(action.children[0],'停止操作');assert.equal(action.props['data-warning'],false);
    if(kind==='expedition')report.expedition.eligible=true;
    else report.route={...report.route,verdict:'possibleRandom',probability:.4,chanceRange:[.4,.4]};
    h.set('report',{...report});
    action=button();assert.equal(action.children[0],'应用编成');assert.equal(action.props['data-warning'],false);
  }
});

test('equipment popup groups and filters categories without hiding equipment beyond the first eighty rows',()=>{
  const h=harness();h.store.const.$shipTypes[3]={api_equip_type:{6:1,12:1}};
  for(let i=0;i<81;i++){
    h.store.const.$equips[1000+i]={api_id:1000+i,api_name:`测试飞机${i}`,api_type:[0,0,6,6]};
    h.store.info.equips[101+i]={api_id:101+i,api_slotitem_id:1000+i};
  }
  h.store.const.$equips[2000]={api_id:2000,api_name:'测试电探',api_type:[0,0,12,11],api_saku:3};
  h.store.info.equips[999]={api_id:999,api_slotitem_id:2000};
  h.set('slots',[W.entry(h.store,1)]);h.set('popup',{index:0,slot:0});
  let tree=h.render(),list=h.find(tree,n=>n.props.className==='paa-wb-popup-list');
  assert.equal(list.children.filter(n=>n?.type==='button').length,82);
  assert.deepEqual(list.children.filter(n=>n?.type==='h4').map(n=>n.children[0]),['舰上战斗机','电探']);
  h.control(tree,'装备分类').props.onChange({target:{value:'9'}});
  tree=h.render();list=h.find(tree,n=>n.props.className==='paa-wb-popup-list');
  const buttons=list.children.filter(n=>n?.type==='button');assert.equal(buttons.length,1);
  buttons[0].props.onClick();assert.equal(h.get('slots')[0].slots[0],999);assert(h.get('slots')[0].keep[0]);
  assert.equal(h.get('popup'),null);
  h.store.info.equips[998]={api_id:998,api_slotitem_id:2000}; // same configuration, different instance
  tree=h.render();h.find(tree,n=>n.props.className==='paa-wb-gear kept').props.onClick();
  tree=h.render();assert.equal(h.control(tree,'装备分类').props.value,'9');
  list=h.find(tree,n=>n.props.className==='paa-wb-popup-list');
  const option=list.children.find(n=>n?.type==='button');
  assert.equal(option.props.className,'paa-wb-equipment-option');assert.match(option.props['data-tooltip'],/测试电探/);
  const stats=h.find(option,n=>n.props.className==='paa-wb-equipment-stats');
  assert(stats);assert.equal(stats.children[0],'索敌+3');
  assert.equal(option.props['aria-current'],'true');assert(h.find(option,n=>n.props.className==='paa-wb-equipment-current'));
  assert.equal(list.children.filter(n=>n?.props?.['aria-current']==='true').length,1);
  assert(!h.find(option,n=>n.type==='small'));assert.equal(h.find(option,n=>n.type==='strong').children[0],'测试电探');
  h.set('popup',null);tree=h.render();h.find(tree,n=>n.props.className==='paa-wb-gear').props.onClick();
  tree=h.render();assert.equal(h.control(tree,'装备分类').props.value,'all','empty slot resets the category');
  assert(!h.find(tree,n=>n.props.className==='paa-wb-equipment-current'),'empty slot must not highlight another slot or a duplicate');
  h.store.info.equips[101].api_level=6;h.store.info.equips[101].api_alv=7;
  tree=h.render();const upgraded=h.find(tree,n=>n.props.className==='paa-wb-equipment-quality');
  assert.equal(upgraded.children[0],'★6 · 熟练 7');
  h.store.info.equips[101].api_level=0;tree=h.render();
  assert.equal(h.find(tree,n=>n.props.className==='paa-wb-equipment-quality').children[0],'熟练 7');
  h.store.info.equips[101].api_alv=0;tree=h.render();
  assert(!h.find(tree,n=>n.props.className==='paa-wb-equipment-quality'));
});

test('route details render separate combinations and clear current-rule highlights when the draft changes',()=>{
  const h=harness(),slots=[1,2,3,4,5,6].map(id=>W.entry(h.store,id));
  h.set('area','5-2');h.set('mapRoute','guide:5-2-02');h.set('slots',slots);
  h.set('report',W.inspect(h.service,h.store,slots,{kind:'normal',fleet:1,area:'5-2',target:'boss',phase:'',missionId:1,revision:0}));
  let tree=h.render();
  const detail=h.find(tree,n=>n.props.className==='paa-wb-route-requirements');
  const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join(' ');
  assert(text(detail).includes('≥ 63 且 < 70'));
  const combinations=h.find(detail,n=>n.type==='ul'&&n.children.length===5);
  assert(combinations,'Yubari combinations get five distinct rows');
  const numbers=combinations.children.map(n=>h.find(n,x=>x.props.className==='paa-wb-rule-number').children[0]);
  const parent=numbers[0].slice(0,numbers[0].lastIndexOf('.'));
  assert.deepEqual(numbers,Array.from({length:5},(_,i)=>`${parent}.${i+1}`));
  assert(text(detail).includes('5.1'));assert(text(detail).includes('5.2'));
  assert(h.find(detail,n=>n.props['data-state']==='matched'),'a checked fleet has a matched rule');
  h.set('slots',slots.slice(0,5));tree=h.render();
  const pending=h.find(tree,n=>n.props['data-result-region']==='route');
  assert.equal(pending.props['aria-busy'],true);
  assert.equal(pending.children[0].props['aria-hidden'],true,'stale rules remain mounted under the veil but inaccessible');
});

test('numeric route references keep normal condition highlights without sample-count warnings',()=>{
  const h=harness(),slots=[1,2,3,4,5,6].map(id=>W.entry(h.store,id));
  h.set('area','2-5');h.set('mapRoute','guide:2-5-07');h.set('slots',slots);
  const report=W.inspect(h.service,h.store,slots,{kind:'normal',fleet:1,area:'2-5',target:'boss',phase:'',missionId:1,revision:0});
  report.route.lineOfSight={status:'estimate',rawScoresByCoefficient:{1:100},scoresByCoefficient:{1:100}};
  h.set('report',report);
  const tree=h.render(),text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join(' ');
  const detail=h.find(tree,n=>n.props.className==='paa-wb-route-requirements');
  const gate=h.find(detail,n=>n.props.className==='paa-wb-route-rule'&&text(n).includes('战舰')&&text(n).includes('最多 3 艘'));
  assert(gate);assert.equal(gate.props['data-state'],'estimated');
  assert(text(detail).includes('< 49')&&text(detail).includes('否则继续判断'));
  assert(text(gate).includes('按配装估算命中'));
  assert(!/样本不足|疑似固定|规则待确认/.test(text(detail)));
  assert.equal(h.calls.fleet+h.calls.equipment,0,'displaying rules never launches a search');
});

test('pending calculations keep result subtrees mounted under an inert loading overlay until rechecked',()=>{
  const h=harness(),slots=[W.entry(h.store,2)],settings={kind:'normal',fleet:1,area:'1-1',target:'boss',phase:'',missionId:1,revision:0};
  h.store.const.$ships[2].api_stype=4;h.set('area','1-1');h.set('slots',slots);h.set('mapRoute',W.mapOverview('1-1').options[0].key);
  h.set('report',W.inspect(h.service,h.store,slots,settings));
  const region=(tree,key)=>h.find(tree,n=>n.props['data-result-region']===key);
  const settled=h.render(),routeContent=region(settled,'route').children[0].children,metricContent=region(settled,'metrics').children[0].children;
  h.set('report',{valid:false});h.set('slots',[{...slots[0],slots:[-1,-1]}]);
  h.set('working',true);h.set('activity','equipment');
  const pending=h.render();
  for(const [key,content] of [['route',routeContent],['metrics',metricContent]]){
    const block=region(pending,key);assert.equal(block.props['aria-busy'],true);
    assert.equal(block.children[0].props['aria-hidden'],true);
    assert.deepEqual(block.children[0].children,content,'the result geometry must not be replaced by empty placeholders');
    assert.equal(block.children[0].props.inert,'','stale content cannot be clicked or focused under the overlay');
    const overlay=block.children[1];assert.equal(overlay.props.role,'status');
    assert.equal(overlay.children[0].props.className,'paa-wb-calculation-label');
    assert.equal(overlay.children[0].children[1],'计算中…');
  }
  assert.equal(h.find(pending,n=>n.props.className==='paa-primary paa-wb-apply').props.disabled,true);
  h.set('working',false);h.set('activity','');h.set('report',W.inspect(h.service,h.store,h.get('slots'),settings));
  const finished=h.render();assert.equal(region(finished,'metrics').props['aria-busy'],false);
  assert.equal(region(finished,'metrics').children[0].props['aria-hidden'],undefined);
  assert.equal(region(finished,'metrics').children[0].props.inert,undefined);
  h.set('slots',[]);h.set('report',{valid:false});
  assert.equal(region(h.render(),'route').props['aria-busy'],false,'clearing a fleet must clear stale results rather than wait forever');
});

test('map stays manual, prepared styles switch immediately, and ship replacement only requests equipment',async()=>{
  const h=harness();let tree=h.render();
  assert(!h.control(tree,'目的'),'only the supported clear purpose is shown as text');
  assert(h.find(tree,n=>n.props.className==='paa-wb-left').children.includes(h.find(tree,n=>n.props.className==='paa-wb-context-controls')));
  assert(h.find(tree,n=>n.props.className==='paa-wb-right').children.includes(h.find(tree,n=>n.props.className==='paa-wb-command-area')));
  assert(h.find(tree,n=>n.type==='svg'&&n.props.role==='group'),'map exists before full search');
  await h.control(tree,'攻略流派').props.onChange({target:{value:'guide:3-5-05'}});
  assert.equal(h.calls.fleet,0,'no automatic full search before first completion');
  tree=h.render();await h.find(tree,n=>n.props.className==='paa-wb-complete').props.onClick();
  assert.equal(h.get('slots')[0].id,1);assert.equal(h.calls.fleet,1);
  tree=h.render();await h.control(tree,'攻略流派').props.onChange({target:{value:'guide:3-5-01'}});
  assert.equal(h.get('slots')[0].id,2);assert.equal(h.calls.fleet,1,'prepared route reused');
  tree=h.render();h.find(tree,n=>n.props.className==='paa-wb-replace').props.onClick();
  tree=h.render();await h.find(tree,n=>n.type==='button'&&n.children.some(c=>c?.children?.some(v=>v?.children?.includes('测试舰3')))).props.onClick();
  assert.equal(h.get('slots')[0].id,3);assert(h.get('slots')[0].pin);
  assert.equal(h.calls.equipment,1);assert.equal(h.calls.fleet,1);
  h.set('excluded',[1]);h.set('error','旧提示');
  const storeBefore=JSON.stringify(h.store);
  tree=h.render();h.find(tree,n=>n.type?.name==='AreaPicker').props.onChange('1-1');
  assert.deepEqual(h.get('slots'),Array(6).fill(null));assert.deepEqual(h.get('report'),{valid:false});
  assert.deepEqual(h.get('choices'),[]);assert.deepEqual(h.get('excluded'),[]);
  for(const name of ['error','notice','mapRoute','search','activity'])assert.equal(h.get(name),'',name);
  assert.equal(h.get('draftContext'),null);assert.equal(h.get('popup'),null);
  assert.equal(h.calls.fleet,1);assert.equal(h.calls.equipment,1);assert.equal(JSON.stringify(h.store),storeBefore);
  tree=h.render();assert(h.find(tree,n=>n.type==='svg'&&n.props.role==='group'),'new map still shows without a draft');
});

test('route selection can be cleared after completion without selecting a fallback or changing the fleet',async()=>{
  for(const area of ['3-5','2-2']){
    const h=harness();h.set('area',area);
    const option=W.mapOverview(area).options[0],label=area==='3-5'?'攻略流派':'参考路线';
    h.service.recommendNormalFleet=()=>{h.calls.fleet++;return {
      recommendations:[{routeKey:option.key,scheme:W.scheme([W.entry(h.store,2)],1)}]};};
    let tree=h.render();await h.find(tree,n=>n.props.className==='paa-wb-complete').props.onClick();
    h.set('nodeId',option.nodes.at(-1));h.set('error','旧路线提示');
    const before=JSON.stringify(h.get('slots'));
    tree=h.render();const select=h.control(tree,label);
    assert(!select.children.find(n=>n.props.value==='').props.disabled);
    await select.props.onChange({target:{value:''}});tree=h.render();
    assert.equal(h.control(tree,label).props.value,'');assert.equal(h.get('nodeId'),null);
    assert.equal(h.get('notice'),'');assert.equal(h.get('error'),'');
    assert.equal(h.calls.fleet,1);assert.equal(h.calls.equipment,0);
    assert.equal(JSON.stringify(h.get('slots')),before);
    assert(!h.find(tree,n=>n.props.className==='paa-real-route'));
    assert(!h.find(tree,n=>n.props.className==='paa-map-selection'));
    assert(!h.find(tree,n=>n.props.className==='paa-wb-route-requirements'));
    assert(h.find(tree,n=>n.type==='strong'&&n.children.includes('请选择路线')));
    await h.control(tree,label).props.onChange({target:{value:option.key}});
    assert.equal(h.get('mapRoute'),option.key);assert.equal(h.calls.fleet,1,'reselect reuses prepared recommendations');
  }
});

test('failed recommendations keep the draft, but obsolete results cannot refill a changed map',async()=>{
  const h=harness();let tree=h.render();
  await h.find(tree,n=>n.props.className==='paa-wb-complete').props.onClick();
  h.set('slots',h.get('slots').map(s=>s?{...s,pin:true}:null)); // invalidate cached fixed context
  h.service.recommendNormalFleet=()=>({recommendations:[]});
  tree=h.render();await h.control(tree,'攻略流派').props.onChange({target:{value:'guide:3-5-05'}});
  assert.equal(h.get('slots')[0].id,2);assert(h.get('error'));assert.equal(h.get('working'),false);
  let finish;h.service.recommendNormalFleet=()=>new Promise(resolve=>{finish=resolve;});
  tree=h.render();const pending=h.find(tree,n=>n.props.className==='paa-wb-complete').props.onClick();
  await new Promise(resolve=>setTimeout(resolve,30));
  tree=h.render();h.find(tree,n=>n.type?.name==='AreaPicker').props.onChange('1-1');h.render();
  finish({recommendations:[{routeKey:'guide:3-5-05',scheme:W.scheme([W.entry(h.store,1)],1)}]});await pending;
  assert.deepEqual(h.get('slots'),Array(6).fill(null));assert.equal(h.get('working'),false);assert.equal(h.get('error'),'');
});

test('global exclusions invalidate cached and in-flight recommendations while preserving the draft',async()=>{
  const h=harness(),F=require('../../src/config/recommendation_filters');
  let filters={...F.DEFAULTS.normal};const render=()=>h.render({automaticFilters:filters});
  let tree=render();await h.find(tree,n=>n.props.className==='paa-wb-complete').props.onClick();
  const before=JSON.stringify(h.get('slots'));assert.equal(h.calls.fleet,1);
  tree=render();await h.control(tree,'攻略流派').props.onChange({target:{value:'guide:3-5-05'}});
  assert.equal(h.calls.fleet,1,'same settings reuse prepared alternatives');
  filters={...filters,minLevel:60};tree=render();
  await h.find(tree,n=>n.props.className==='paa-wb-complete').props.onClick();
  assert.equal(h.calls.fleet,2,'new filter settings cannot reuse previous results');
  let finish;h.service.recommendNormalFleet=()=>new Promise(resolve=>{finish=resolve;});
  tree=render();const pending=h.find(tree,n=>n.props.className==='paa-wb-complete').props.onClick();
  await new Promise(resolve=>setTimeout(resolve,30));
  const current=JSON.stringify(h.get('slots'));filters={...filters,minLevel:80};render();
  finish({recommendations:[{routeKey:'guide:3-5-05',scheme:W.scheme([W.entry(h.store,8)],1)}]});await pending;
  assert.equal(JSON.stringify(h.get('slots')),current);assert.equal(h.get('working'),false);assert(before);
});

test('obsolete recommendation errors cannot restore old-map feedback',async()=>{
  const h=harness();let fail;
  h.service.recommendNormalFleet=()=>new Promise((resolve,reject)=>{fail=reject;});
  let tree=h.render();const pending=h.find(tree,n=>n.props.className==='paa-wb-complete').props.onClick();
  await new Promise(resolve=>setTimeout(resolve,30));
  tree=h.render();h.find(tree,n=>n.type?.name==='AreaPicker').props.onChange('1-1');
  fail(Error('旧海域计算失败'));await pending;
  assert.deepEqual(h.get('slots'),Array(6).fill(null));assert.equal(h.get('error'),'');
  assert.equal(h.get('activity'),'');assert.equal(h.get('working'),false);
});

test('fleet air thresholds follow the selected map path while fleet power keeps the current loadout',()=>{
  const h=harness(),slots=[W.entry(h.store,2)];h.set('slots',slots);h.set('mapRoute','guide:3-5-01');
  h.set('report',{valid:true,scheme:W.scheme(slots,1),
    settingsKey:JSON.stringify({kind:'normal',fleet:1,area:'3-5',target:'boss',phase:'',missionId:1,revision:0}),
    profile:W.selectedMapProfile(W.mapOverview('3-5'),'guide:3-5-05'),metrics:{airPower:{status:'range',min:500,max:501,
      slots:[{aircraftType:45,planes:[25,25],effectiveAntiAir:[100,100.2],proficiencyBonus:[0,0]}]}},
    route:{verdict:'guaranteed',airControl:{assessment:{superiority:{required:381}},profiles:[
      {route:'guide:3-5-05',superiority:381,supremacy:762},{route:'guide:3-5-01',superiority:35,supremacy:69}]}}});
  const tree=h.render(),metric=h.find(tree,n=>n.props.className==='paa-wb-metric air');
  assert(h.find(metric,n=>n.type==='small').children[0].includes('空优 35 · 空确 69'));
  assert(h.find(metric,n=>n.type==='strong').children[0].includes('500'));
  assert.equal(metric.props['data-tone'],'green');assert.equal(h.find(metric,n=>n.type==='strong').props['data-label'],'我方');
  assert(h.find(metric,n=>n.props.className==='paa-wb-metric-state').children.includes('全程空确'));
  assert.match(metric.props['data-tooltip'],/保守估算|不是实战保证/);
  h.set('mapRoute','');const cleared=h.find(h.render(),n=>n.props.className==='paa-wb-metric air');
  assert(h.find(cleared,n=>n.type==='small').children[0].includes('请选择路线'));
});

test('unavailable routes cannot be selected until clear, which also clears the route selection',async()=>{
  const h=harness();h.set('area','2-2');const options=W.mapOverview('2-2').options;
  h.service.recommendNormalFleet=args=>{h.calls.fleet++;return {routeResults:options.map((o,i)=>({...o,status:i===1?'notFound':'available',
    chance:i===1?null:{min:1,max:1,probability:1},recommendationIndex:i===1?null:i===0?0:1,diagnostics:i===1?{briefWarnings:['C → E：带路条件未满足']}:null})),
    recommendations:[0,2].map((i,j)=>({routeKey:options[i].key,scheme:W.scheme([W.entry(h.store,j+2)],1)}))};};
  await h.control(h.render(),'参考路线').props.onChange({target:{value:options[2].key}});
  await h.find(h.render(),n=>n.props.className==='paa-wb-complete').props.onClick();assert.equal(h.get('mapRoute'),options[2].key);
  await h.control(h.render(),'参考路线').props.onChange({target:{value:options[1].key}});
  assert.equal(h.get('mapRoute'),options[2].key);assert.equal(h.calls.fleet,1);
  h.set('excluded',[8]);h.set('nodeId','A');h.set('pathIndex',1);
  h.find(h.render(),n=>n.type==='button'&&n.children.includes('一键清空')).props.onClick();
  assert.equal(h.get('mapRoute'),'');assert(h.get('slots').every(s=>!s));assert.deepEqual(h.get('choices'),[]);
  assert.deepEqual(h.get('excluded'),[]);assert.equal(h.get('nodeId'),null);assert.equal(h.get('pathIndex'),0);
  await h.control(h.render(),'参考路线').props.onChange({target:{value:options[1].key}});
  assert.equal(h.get('mapRoute'),options[1].key);assert.equal(h.calls.fleet,1,'preselection does not calculate');
  await h.find(h.render(),n=>n.props.className==='paa-wb-complete').props.onClick();
  assert.equal(h.get('mapRoute'),options[1].key);assert.equal(h.get('error'),'');
  const warning=h.find(h.render(),n=>n.props['aria-label']==='推荐路线受阻条件');
  assert.deepEqual(warning.children.map(n=>n.children.join('')),['C → E：带路条件未满足']);
});

test('same-scheme route switches and pin or keep changes retain inspected probabilities',async()=>{
  const h=harness(),settings={kind:'normal',fleet:1,area:'2-3',target:'boss',phase:'',missionId:1,revision:0};
  h.store.const.$ships[1].api_stype=16;h.store.const.$ships[2].api_stype=3;
  const slots=[1,2,3,4,5,6].map(id=>W.entry(h.store,id)),options=W.mapOverview('2-3').options.slice(0,2);
  h.set('area','2-3');h.set('slots',slots);h.set('mapRoute',options[0].key);
  const report=W.inspect(h.service,h.store,slots,settings);assert(report.valid);h.set('report',report);
  const marker=(tree,edge)=>h.find(tree,n=>n.props.className==='paa-map-probability'&&n.props['data-edge']===edge);
  assert.equal(marker(h.render(),'G>I').props['data-probability'],0.65);

  h.set('popup',{index:0});
  const pin=h.find(h.render(),n=>n.type==='button'&&n.props.key===1&&n.children.some(c=>c?.children?.some(v=>v?.children?.includes('测试舰1'))));
  assert(pin);const fitting=pin.props.onClick();
  assert.equal(h.get('slots')[0].pin,true);assert.equal(h.get('report'),report,'pin metadata must not invalidate the same hull and loadout');
  assert(marker(h.render(),'G>I'));await fitting;assert.equal(h.get('report'),report);
  h.set('popup',{index:0,slot:0});
  h.find(h.render(),n=>n.type==='button'&&n.children.includes('清空此槽')).props.onClick();
  assert.equal(h.get('slots')[0].keep[0],true);assert.equal(h.get('report'),report,'reserving an already empty slot changes no route inputs');
  h.set('popup',{index:0,slot:0});
  h.find(h.render(),n=>n.type==='button'&&n.children.includes('交给自动配装')).props.onClick();
  assert.equal(h.get('report'),report);assert(marker(h.render(),'G>I'));

  h.set('choices',options);h.set('draftContext',JSON.stringify(['normal','2-3','boss','','clear','lower',1,'great',null]));
  h.service.recommendNormalFleet=()=>({routeResults:options.map((o,i)=>({...o,chance:{min:1,max:1},recommendationIndex:i})),
    recommendations:options.map(o=>({routeKey:o.key,scheme:W.scheme(slots,1)}))});
  const pending=h.control(h.render(),'参考路线').props.onChange({target:{value:options[1].key}});
  assert.equal(h.get('report'),report,'the current draft remains inspected while the alternative is loading');
  assert.equal(marker(h.render(),'G>I').props['data-probability'],.65,'a shared branch keeps the same conditional odds after changing presets');
  await pending;
  assert.equal(h.get('error'),'');assert(h.get('report').valid);
  assert.deepEqual(h.get('report').scheme,W.scheme(h.get('slots'),1));
  assert(h.find(h.render(),n=>n.props.className==='paa-map-probability'),'the first completed render has the new route probabilities');
  const inspectEffect=h.effects.filter(e=>String(e.fn).includes('resumePending.current=false;setReport(next)')).at(-1);
  assert.equal(inspectEffect.fn(),undefined,'an already matching report must not schedule another delayed inspection');
});

test('a route recommendation inspects the final changed hulls before the first completed render',async()=>{
  const h=harness(),settings={kind:'normal',fleet:1,area:'2-3',target:'boss',phase:'',missionId:1,revision:0};
  h.store.const.$ships[1].api_stype=16;h.store.const.$ships[2].api_stype=3;h.store.const.$ships[8].api_stype=11;
  const before=[1,2,3,4,5,6].map(id=>W.entry(h.store,id)),after=[8,2,3,4,5,6].map(id=>W.entry(h.store,id));
  const options=W.mapOverview('2-3').options.slice(0,2),old=W.inspect(h.service,h.store,before,settings);
  h.set('area','2-3');h.set('slots',before);h.set('mapRoute',options[0].key);h.set('report',old);
  h.set('choices',options);h.set('draftContext',JSON.stringify(['normal','2-3','boss','','clear','lower',1,'great',null]));
  h.service.recommendNormalFleet=()=>({routeResults:options.map((o,i)=>({...o,chance:{min:1,max:1},recommendationIndex:i})),
    recommendations:options.map((o,i)=>({routeKey:o.key,scheme:W.scheme(i?after:before,1),route:{obsolete:true}}))});
  await h.control(h.render(),'参考路线').props.onChange({target:{value:options[1].key}});
  assert.equal(h.get('error'),'');assert.deepEqual(h.get('slots').map(s=>s?.id),[8,2,3,4,5,6]);
  const report=h.get('report'),expected=W.inspect(h.service,h.store,h.get('slots'),settings);
  assert(report.valid);assert.notEqual(report,old);assert.equal(report.settingsKey,JSON.stringify(settings));
  assert.deepEqual(report.scheme,expected.scheme);assert.deepEqual(report.route,expected.route,'reinspect the merged draft rather than trusting the cached recommendation report');
  const tree=h.render(),profile=W.selectedMapProfile(W.mapOverview('2-3'),options[1].key,expected.profile,expected.route);
  assert(profile.edgeProbabilities.length);
  for(const edge of profile.edgeProbabilities){
    const marker=h.find(tree,n=>n.props.className==='paa-map-probability'&&
      n.props['data-edge'].replace(/^start#\d+>/,'start>')===`${edge.from}>${edge.to}`);
    assert(marker,`first render must include ${edge.from}>${edge.to}`);assert.equal(marker.props['data-probability'],edge.probability);
  }
  assert.equal(h.find(tree,n=>n.props.className==='paa-map-probability'&&n.props['data-edge']==='G>I').props['data-probability'],.45,'replacing AV changes the shared exit odds immediately');
});

test('merged 1-4 map highlights follow the actual fleet while keeping genuine random alternatives',()=>{
  const store=fixture(),overview=W.mapOverview('1-4');
  const option={key:'test:upper',name:'上路测试',nodes:[...'BCFEHL'],paths:[[...'BCFEHL'],[...'BCFHL']]};overview.options.push(option);
  const {evaluateNormalRoute}=require('../../src/domain/routes/normal_routes');
  const {profileForRoute}=require('../../src/domain/routes/sortie_profile');
  const draw=require('../../src/ui/maps/route_preview');
  const h=(type,props,...children)=>({type,props:props||{},children});
  const collect=(tree,p)=>!tree||typeof tree!=='object'?[]:[...(p(tree)?[tree]:[]),...(tree.children||[]).flatMap(n=>collect(n,p))];
  const inspect=()=>{
    const route=evaluateNormalRoute(store,{area:'1-4',scheme:W.scheme([1,2,3,4].map(id=>W.entry(store,id)),1)});
    return W.selectedMapProfile(overview,option.key,profileForRoute('1-4',route),route);
  };
  store.const.$ships[1].api_stype=16;store.const.$ships[4].api_stype=7; // AV + 2 DD + CVL: F -> E only.
  const fixed=inspect();
  assert.deepEqual(fixed.highlightPaths,[['B','C','F','E','H','L']]);
  for(const fixedNodes of [false,true]){
    const tree=draw(h,{profile:fixed,compact:true,fixedNodes,showDetails:false,showPaths:false,onNode:()=>{}});
    const edges=collect(tree,n=>n.props.className==='paa-real-route').map(n=>n.props.key);
    assert(edges.includes('F>E'));assert(edges.includes('E>H'));
    assert(!edges.includes('F>H'));assert(!edges.includes('E>F'));assert(!edges.includes('H>E'));
    assert(collect(tree,n=>n.props.key==='muted-F>H').length,'the real map keeps the alternate physical connection muted');
  }
  store.const.$ships[1].api_stype=3;store.const.$ships[4].api_stype=2; // CL + 3 DD: F -> E/H is 80/20.
  const random=inspect();assert.deepEqual(random.highlightPaths,option.paths);
  assert(random.edgeProbabilities.some(e=>e.from==='F'&&e.to==='H'&&e.probability===0.2));
  assert.deepEqual(W.selectedMapProfile(overview,option.key).highlightPaths,option.paths,'without a fleet, preview the whole selected style');
});

test('pending or stale fleet inspections do not preview full styles until the fleet is cleared',()=>{
  const h=harness(),option=W.mapOverview('1-4').options.find(o=>o.id==='1-4-05');
  [20,11,11,11,13,14].forEach((type,i)=>{h.store.const.$ships[i+1].api_stype=type;});
  h.set('area','1-4');h.set('mapRoute',option.key);h.set('slots',[1,2,3,4,5,6].map(id=>W.entry(h.store,id)));
  const settings={kind:'normal',fleet:1,area:'1-4',target:'boss',phase:'',missionId:1,revision:0};
  const report=W.inspect(h.service,h.store,h.get('slots'),settings);assert(report.valid);h.set('report',report);
  const highlighted=(tree,key)=>h.find(tree,n=>n.props.className==='paa-real-route'&&n.props.key===key);
  let tree=h.render();assert(highlighted(tree,'D>E'));assert(!highlighted(tree,'D>G'));
  h.set('report',{valid:false});tree=h.render();
  assert(!h.find(tree,n=>n.props.className==='paa-real-route'),'pending inspection cannot restore blocked alternatives');
  h.set('report',report);h.set('area','2-3');h.set('mapRoute',W.mapOverview('2-3').options[0].key);
  assert(!h.find(h.render(),n=>n.props.className==='paa-real-route'),'old map results cannot highlight the new map');
  h.set('area','1-4');h.set('mapRoute',option.key);h.set('report',{valid:false});
  h.find(h.render(),n=>n.type==='button'&&n.children.includes('一键清空')).props.onClick();
  assert.equal(h.get('mapRoute'),'');h.set('mapRoute',option.key);tree=h.render();assert(highlighted(tree,'A>D'));assert(highlighted(tree,'B>D'),'empty fleet previews both starts merging at D');
  assert(!highlighted(tree,'B>C'));assert(!highlighted(tree,'D>G'));
  assert.equal(h.calls.fleet,0);assert.equal(h.calls.equipment,0);
});

test('phase changes clear inspection without automatic recommendation while stale probabilities are discarded',async()=>{
  const h=harness(),slots=[W.entry(h.store,2)],base={kind:'normal',fleet:1,area:'7-3',target:'boss',phase:'gauge1',missionId:1,revision:0};
  const options=require('../../src/domain/routes/route_plans').routeOptions('7-3','boss'),first=options.find(o=>o.phase==='gauge1'),second=options.find(o=>o.phase==='gauge2');
  assert(first&&second);h.set('area','7-3');h.set('slots',slots);h.set('mapRoute',first.key);
  h.set('choices',[{key:first.key}]);
  const original=W.inspect(h.service,h.store,slots,base);assert(original.valid);h.set('report',original);
  h.service.recommendNormalFleet=args=>{h.calls.fleet++;assert.equal(args.phase,'gauge2');return {
    recommendations:[{routeKey:second.key,scheme:W.scheme(slots,1)}]};};
  await h.control(h.render(),'参考路线').props.onChange({target:{value:second.key}});
  const report=h.get('report');assert(!report.valid);assert.notEqual(report,original);assert(h.get('slots').every(s=>s===null));
  assert.equal(h.get('mapRoute'),second.key);
  assert.equal(h.calls.fleet,0,'selecting another phase does not automatically request a new recommendation');
  assert.equal(h.get('combatDeferredPhase'),'gauge2','the new phase battle assessment waits for explicit completion');

  h.set('area','1-1');h.set('slots',slots);h.set('mapRoute',W.mapOverview('1-1').options[0].key);
  const settings={...base,area:'1-1',phase:''},fresh=W.inspect(h.service,h.store,slots,settings);
  h.set('report',fresh);
  const hasProbability=tree=>!!h.find(tree,n=>n.props.className==='paa-map-probability');
  assert(hasProbability(h.render()));
  h.control(h.render(),'参考路线').props.onChange({target:{value:''}});
  assert.equal(h.get('report'),fresh);assert(!hasProbability(h.render()),'clearing only the route removes its markers while keeping fleet inspection');
  h.set('mapRoute',W.mapOverview('1-1').options[0].key);assert(hasProbability(h.render()));
  h.set('revision',1);assert(!hasProbability(h.render()),'new observed game state cannot reuse previous percentages');
  h.set('revision',0);h.control(h.render(),'编入').props.onChange({target:{value:'2'}});
  assert.equal(h.get('report').valid,false);assert(!hasProbability(h.render()));
  h.set('fleet',1);h.set('report',fresh);
  h.find(h.render(),n=>n.type==='button'&&n.children.includes('一键清空')).props.onClick();
  assert.equal(h.get('report').valid,false);assert(!hasProbability(h.render()));assert(h.get('slots').every(s=>s===null));
});

test('route warnings stay on the left and no stale chance or duplicate LoS badge survives',()=>{
  const h=harness(),slots=[W.entry(h.store,2)],settings={kind:'normal',fleet:1,area:'1-1',target:'boss',phase:'',missionId:1,revision:0};
  h.store.const.$ships[2].api_stype=4;h.set('area','1-1');h.set('slots',slots);h.set('mapRoute',W.mapOverview('1-1').options[0].key);
  h.set('report',W.inspect(h.service,h.store,slots,settings));
  const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join(' ');
  let tree=h.render(),left=h.find(tree,n=>n.props.className==='paa-wb-left'),right=h.find(tree,n=>n.props.className==='paa-wb-right');
  assert.match(text(left),/到达概率 80%/);assert.match(text(left),/随机分岐/);
  assert.equal(h.find(left,n=>n.props.className==='paa-wb-arrival-icon').props['data-kind'],'warning');
  assert(!text(right).includes('随机分岐'));assert(!text(right).includes('请留意路线条件'));
  assert(!h.find(left,n=>n.props.className==='paa-wb-los'));
  h.set('slots',[]);tree=h.render();left=h.find(tree,n=>n.props.className==='paa-wb-left');
  assert.match(text(left),/待核对编成/);assert(!text(left).includes('80%'));
  assert(!h.find(left,n=>n.props.className==='paa-wb-arrival-icon'),'unreviewed drafts keep a neutral status');
});

test('arrival status expands route requirements while notes and complete journey probabilities remain visible',()=>{
  const h=harness(),slots=[W.entry(h.store,2)],settings={kind:'normal',fleet:1,area:'1-1',target:'boss',phase:'',missionId:1,revision:0};
  h.store.const.$ships[2].api_stype=4;h.set('area','1-1');h.set('slots',slots);h.set('mapRoute',W.mapOverview('1-1').options[0].key);
  h.set('report',W.inspect(h.service,h.store,slots,settings));
  const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join(' ');
  let tree=h.render(),card=h.find(tree,n=>n.props.className==='paa-wb-route-status');
  let control=h.find(card,n=>n.props.className==='paa-wb-arrival');
  let rules=h.find(card,n=>n.props.className==='paa-wb-route-requirements');
  assert.equal(control.type,'button');assert.equal(control.props['aria-expanded'],false);
  assert.equal(control.props['aria-controls'],rules.props.id);assert.equal(rules.props['aria-hidden'],true);assert.equal(rules.props.inert,'');
  assert.match(text(control),/到达概率 80%/);
  assert(!text(card).includes('所选路线的舰种与带路要求'),'the arrival row is the only disclosure heading');
  const warning=h.find(card,n=>n.props['aria-label']==='路线条件');
  assert(!warning,'random-fork prose is redundant with the complete journey probability');
  const probabilities=h.find(card,n=>n.props['aria-label']==='各路线到达概率');
  assert(probabilities);assert(!h.find(rules,n=>n===probabilities),'probabilities remain visible when rules are collapsed');
  const note=h.find(card,n=>n.props.className==='paa-wb-arrival-note');
  if(note)assert(!h.find(rules,n=>n===note),'arrival notes remain outside the disclosure');
  control.props.onClick();tree=h.render();card=h.find(tree,n=>n.props.className==='paa-wb-route-status');
  control=h.find(card,n=>n.props.className==='paa-wb-arrival');rules=h.find(card,n=>n.props.className==='paa-wb-route-requirements');
  assert.equal(control.props['aria-expanded'],true);assert.equal(rules.props['aria-hidden'],false);assert.equal(rules.props.inert,undefined);
  assert(h.find(rules,n=>n.props.className==='paa-wb-route-rule'&&n.props['data-state']==='matched'));
  control.props.onClick();assert.equal(h.get('routeRulesOpen'),false);
  const empty=harness(),unselected=empty.render(),status=empty.find(unselected,n=>n.props.className==='paa-wb-arrival');
  assert.equal(status.type,'div');assert.equal(status.props['aria-expanded'],undefined);
  assert(!empty.find(unselected,n=>n.props.className==='paa-wb-route-requirements'));
  assert.equal(h.calls.fleet+h.calls.equipment,0,'expanding rules does not launch recommendations');
});

test('route card whitespace expands rules without toggling reading, selection or disabled controls',()=>{
  const h=harness(),slots=[W.entry(h.store,2)],settings={kind:'normal',fleet:1,area:'1-1',target:'boss',phase:'',missionId:1,revision:0};
  h.store.const.$ships[2].api_stype=4;h.set('area','1-1');h.set('slots',slots);h.set('mapRoute',W.mapOverview('1-1').options[0].key);
  h.set('report',W.inspect(h.service,h.store,slots,settings));
  const card=props=>h.find(h.render(props),node=>node.props.className==='paa-wb-route-status');
  const click=(target={},selection=null,extra={})=>({button:0,target,currentTarget:{ownerDocument:{getSelection:()=>selection},contains:()=>true},...extra});
  assert.equal(card().props['data-expandable'],true);
  card().props.onClick(click());assert.equal(h.get('routeRulesOpen'),true,'card padding opens the requirements');
  const protectedTarget={closest:()=>({})};
  card().props.onClick(click(protectedTarget));assert.equal(h.get('routeRulesOpen'),true,'native header and details clicks are handled independently');
  card().props.onClick(click({}, {isCollapsed:false,anchorNode:{}}));assert.equal(h.get('routeRulesOpen'),true,'copying text must not close the card');
  card().props.onClick(click({},null,{defaultPrevented:true}));assert.equal(h.get('routeRulesOpen'),true);
  card().props.onClick(click({},null,{button:2}));assert.equal(h.get('routeRulesOpen'),true);
  const warnings={getBoundingClientRect:()=>({left:10}),clientLeft:2,clientWidth:200};
  const warningText={closest:selector=>selector==='.paa-wb-route-warnings'?warnings:selector.includes('[role="region"]')?warnings:null};
  card().props.onClick(click(warningText,null,{clientX:80}));assert.equal(h.get('routeRulesOpen'),false,'random branch explanations also close the card');
  card().props.onClick(click(warningText,null,{clientX:80}));assert.equal(h.get('routeRulesOpen'),true,'random branch explanations also open the card');
  card().props.onClick(click(warningText,null,{clientX:213}));assert.equal(h.get('routeRulesOpen'),true,'using the warning scrollbar must not toggle the card');
  card().props.onClick(click(warningText,{isCollapsed:false,anchorNode:{}},{clientX:80}));assert.equal(h.get('routeRulesOpen'),true,'selecting branch explanation text keeps the card open');
  card().props.onClick(click());assert.equal(h.get('routeRulesOpen'),false,'the outer card also closes the requirements');
  const disabled=card({busy:true});assert.equal(disabled.props['data-expandable'],false);
  disabled.props.onClick(click());assert.equal(h.get('routeRulesOpen'),false);
  const fresh=harness(),empty=fresh.find(fresh.render(),node=>node.props.className==='paa-wb-route-status');assert.equal(empty.props['data-expandable'],false);
  empty.props.onClick(click());assert.equal(h.get('routeRulesOpen'),false);
  assert.equal(h.calls.fleet+h.calls.equipment,0,'card toggles never run a recommendation');
});

test('progress renders one compact boss row per stage, including completed and unobserved maps',()=>{
  const h=harness();
  h.set('area','7-3');h.set('phase','gauge1');
  h.store.info.maps={73:{api_gauge_type:1,api_gauge_num:2,api_required_defeat_count:4,api_defeat_count:1}};
  const list=h.find(h.render(),n=>n.props.className==='paa-wb-progress-list');
  assert.equal(list.children.length,2);
  const [first,second]=list.children;
  assert.equal(list.props['data-has-current'],true);
  assert.equal(first.props['aria-current'],undefined);assert.equal(second.props['aria-current'],'step');
  const heading=h.find(first,n=>n.props.className==='paa-wb-progress-heading');
  assert(heading.children.includes('E 点'));
  assert(h.find(second,n=>n.props.className==='paa-wb-progress-heading').children.includes('P 点'));
  assert.equal(h.find(first,n=>n.type==='progress').props.value,0);
  assert.equal(h.find(second,n=>n.type==='progress').props.value,3);
  const icon=h.find(heading,n=>n.props.className==='paa-map-boss-icon');
  assert.equal(icon.props.width,15);assert.equal(icon.props.height,15);
  assert.equal(h.find(icon,n=>n.type==='image').props.href,require('../../src/ui/maps/map_assets').bossDisplaySymbol.image,'Boss progress uses the same adjusted game sprite');
  h.set('area','7-5');
  const unknown=h.find(h.render(),n=>n.props.className==='paa-wb-progress-list');
  assert.equal(unknown.children.length,3);assert.equal(unknown.props['data-has-current'],false);
  assert(unknown.children.every(row=>h.find(row,n=>n.props.className==='paa-wb-progress-unknown')));
  h.set('area','1-1');h.set('phase','');h.store.info.maps[11]={api_cleared:1};
  const tree=h.render();assert(!h.find(tree,n=>n.props.className==='paa-wb-progress-list'));
  const mapSection=h.find(tree,n=>n.props.className==='paa-wb-map-section');
  assert(h.find(mapSection,n=>n.props.className==='paa-route-preview'));
  assert(!h.find(tree,n=>n.props.className==='paa-wb-map-divider'),'map section border replaces the loose divider');
  const controls=h.find(tree,n=>n.props.className==='paa-wb-context-controls');
  assert(h.find(controls,n=>n.type?.name==='RoutePicker'),'map and route selectors share the selection section');
});


test('expedition goal switches reuse the prepared pair and changed manual constraints retire it',async()=>{
  const h=harness('expedition');let calls=0;
  h.service.recommendExpeditionFleet=args=>{
    calls++;const goals=Object.fromEntries(['success','great'].map(goal=>[goal,{goal,recommendations:[{
      scheme:W.scheme([W.entry(h.store,args.fixedShipIds?.[0]||(goal==='success'?7:1))],2)}]}]));
    return {...goals[args.goal],goals};
  };
  await h.find(h.render(),n=>n.props.className==='paa-wb-complete').props.onClick();assert.equal(calls,1);
  for(const goal of ['success','great','success']){
    const pending=h.chooseGoal(h.render(),goal);h.render();await pending;
    assert.equal(calls,1);assert.equal(h.get('slots')[0].id,goal==='success'?7:1);
  }
  h.set('slots',[{...W.entry(h.store,2),pin:true}]);
  let pending=h.chooseGoal(h.render(),'great');h.render();await pending;
  assert.equal(calls,2);assert.equal(h.get('slots')[0].id,2);
  h.set('revision',1);pending=h.chooseGoal(h.render(),'success');h.render();await pending;
  assert.equal(calls,3,'new account revision cannot reuse the pair');
  h.store.info.ships[2].api_cond++;pending=h.chooseGoal(h.render(),'great');h.render();await pending;
  assert.equal(calls,4,'an in-place account mutation cannot reuse the pair');
  h.find(h.render(),n=>n.type?.name==='AreaPicker').props.onChange(2);assert(h.get('slots').every(s=>!s));
  await h.find(h.render(),n=>n.props.className==='paa-wb-complete').props.onClick();assert.equal(calls,5,'another mission requires a new pair');
});

test('fleet cards share activity-specific overlays without replacing ship slots',()=>{
  for(const kind of ['normal','expedition']){
    const h=harness(kind);h.set('slots',[W.entry(h.store,2),null,null,null,null,null]);
    const grid=tree=>h.find(tree,n=>n.props.className==='paa-wb-ships');
    const overlay=tree=>h.find(tree,n=>n.props.className==='paa-wb-calculating paa-wb-fleet-overlay');
    const cards=tree=>grid(tree).children.filter(n=>n?.props?.['data-fleet-slot']!==undefined).map(n=>[n.props.key,n.props['data-fleet-slot'],n.props['data-ship-id']]);
    const before=cards(h.render());
    h.set('working',true);
    for(const [activity,label] of [['complete','补全中'],['route','切换路线中'],['equipment','调整装备中']]){
      h.set('activity',activity);const pending=h.render(),mask=overlay(pending);
      assert.equal(mask.props.role,'status');assert.equal(mask.props['data-activity'],activity);
      assert.equal(mask.children[0].children[1],label);
      assert.deepEqual(cards(pending),before,'calculations keep the original cards and empty positions mounted');
    }
    h.set('working',false);h.set('activity','');assert(!overlay(h.render()));
    h.set('working',true);h.set('activity','');assert(!overlay(h.render()),'unknown activity must not get an incorrect status');
  }
});

test('1-4 route selector letters follow the inspected draft and reset to the catalog when cleared',()=>{
  const h=harness(),option=W.mapOverview('1-4').options.find(o=>o.id==='1-4-06');
  [16,3,2,2,2,2].forEach((type,i)=>{h.store.const.$ships[i+1].api_stype=type;});
  h.set('area','1-4');h.set('mapRoute',option.key);h.set('slots',[1,2,3,4,5,6].map(id=>W.entry(h.store,id)));
  const settings={kind:'normal',fleet:1,area:'1-4',target:'boss',phase:'',missionId:1,revision:0};
  const inspect=()=>{const report=W.inspect(h.service,h.store,h.get('slots'),settings);assert(report.valid);h.set('report',report);return report;};
  let report=inspect(),tree=h.render();
  const label=tree=>{const picker=h.find(tree,n=>n.type?.name==='RoutePicker');return '（'+picker.props.options.find(o=>o.key===picker.props.value).pathLabel+'）';};
  assert.equal(label(tree),'（A→D→G→J→L；B→C→F→E→H→L）');
  const actual=require('../../src/domain/routes/route_plans').fleetPathOption(report.route,option);
  h.set('choices',[actual]);
  [20,3,2,2,2,2].forEach((type,i)=>{h.store.const.$ships[i+1].api_stype=type;});
  h.set('slots',[1,2,3,4,5,6].map(id=>W.entry(h.store,id)));inspect();tree=h.render();
  assert.equal(label(tree),'（B→C→F→E→H→L）','manual edits override saved recommendation captions');
  const select=h.control(tree,'参考路线');
  assert(select.children.some(n=>n.type==='option'&&n.props.value===option.key&&n.children.includes(option.name+label(tree))));
  h.find(tree,n=>n.type==='button'&&n.children.includes('一键清空')).props.onClick();
  assert.equal(h.get('mapRoute'),'');h.set('mapRoute',option.key);assert.equal(label(h.render()),`（${option.pathLabel}）`);
  assert.equal(h.calls.fleet,0);assert.equal(h.calls.equipment,0);
});

test('merged 1-4 guidance shows the start, B fork, then D and later forks in travel order',()=>{
  const h=harness(),option=W.mapOverview('1-4').options.find(o=>o.id==='1-4-01');
  [20,7,3,2,2,2].forEach((type,i)=>{h.store.const.$ships[i+1].api_stype=type;});
  h.set('area','1-4');h.set('mapRoute',option.key);h.set('slots',[1,2,3,4,5,6].map(id=>W.entry(h.store,id)));
  h.set('report',W.inspect(h.service,h.store,h.get('slots'),{kind:'normal',fleet:1,area:'1-4',target:'boss',phase:'',missionId:1,revision:0}));
  const rules=h.find(h.render(),n=>n.props.className==='paa-wb-route-requirements');
  const scroll=h.find(rules,n=>n.props.className==='paa-wb-route-rules-scroll');
  const nodes=scroll.children.filter(n=>n&&n.type==='div'&&typeof n.props.key==='string').map(n=>n.props.key);
  assert.deepEqual(nodes,['start','B','D','F','E']);
});

test('a speed strategy caption follows its viable branch instead of the static strategy label',()=>{
  const h=harness(),P=require('../../src/domain/routes/route_plans'),option=W.mapOverview('3-2').options.find(o=>P.optionPaths(o).length>1);
  [3,2,2,2,2,2].forEach((type,i)=>{h.store.const.$ships[i+1].api_stype=type;});
  h.set('area','3-2');h.set('mapRoute',option.key);h.set('slots',[1,2,3,4,5,6].map(id=>W.entry(h.store,id)));
  const report=W.inspect(h.service,h.store,h.get('slots'),{kind:'normal',fleet:1,area:'3-2',target:'boss',phase:'',missionId:1,revision:0});
  report.route.ships.forEach(s=>{s.radarEquipped=true;});
  report.route.speed={status:'computed',fleetSpeed:'fastest',ships:report.route.ships.map(s=>({shipId:s.instanceId,status:'computed',speed:'fastest'}))};
  h.set('report',report);h.set('choices',[P.fleetPathOption(report.route,option)]);
  let tree=h.render();const caption=tree=>{const picker=h.find(tree,n=>n.type?.name==='RoutePicker');return '（'+picker.props.options.find(o=>o.key===picker.props.value).pathLabel+'）';};
  assert.equal(caption(tree),'（C→E→F→L）');
  assert(h.find(tree,n=>n.props.className==='paa-real-route'&&n.props.key==='C>E'));
  assert(!h.find(tree,n=>n.props.className==='paa-real-route'&&n.props.key==='C>G'));
  const scroll=h.find(tree,n=>n.props.className==='paa-wb-route-rules-scroll');
  const nodes=scroll.children.filter(n=>n&&n.type==='div'&&typeof n.props.key==='string').map(n=>n.props.key);
  assert(!nodes.includes('G'),'unreachable alternatives cannot supply current-rule highlights');
  h.set('slots',Array(6).fill(null));tree=h.render();
  assert.equal(caption(tree),'（'+option.pathLabel+'）','empty drafts cannot retain a cached restricted caption');
  assert.equal(h.calls.fleet,0);assert.equal(h.calls.equipment,0);
});
