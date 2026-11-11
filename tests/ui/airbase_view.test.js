'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const view=require('../../src/ui/workbench/airbase_view');
const fixture=require('../helpers/workbench_fixture');
const h=(type,props,...children)=>({type,props:props||{},children:children.flat()});
const find=(node,predicate)=>node&&typeof node==='object'&&(predicate(node)?node:(node.children||[]).map(child=>find(child,predicate)).find(Boolean));
const text=node=>typeof node==='string'||typeof node==='number'?String(node):(node?.children||[]).map(text).join('');

test('only supported maps show their own area bases with aircraft and observed state',()=>{
  const store=fixture();
  store.info.equips[1001]={api_slotitem_id:501,api_level:3,api_alv:7};
  store.const.$equips[501]={api_name:'测试陆攻',api_type:[0,0,47,47]};
  store.info.airbase=[
    {api_area_id:7,api_rid:1,api_name:'南西航空队',api_action_kind:2,api_distance:{api_base:4,api_bonus:2},api_plane_info:[{api_squadron_id:1,api_slotid:1001,api_count:14,api_max_count:18,api_state:1},{api_squadron_id:2,api_slotid:0,api_state:0}]},
    {api_area_id:6,api_rid:2,api_action_kind:1,api_distance:{api_base:5,api_bonus:0},api_plane_info:[]},
    {api_area_id:6,api_rid:1,api_action_kind:0,api_distance:8,api_plane_info:[]}
  ];
  const before=JSON.stringify(store);
  assert.equal(view.model(store,'7-5'),null);
  assert.equal(view.model(store,'5-6'),null);
  const central=view.model(store,'6-5');
  assert.equal(central.map.maxSortieSquadrons,2);
  assert.deepEqual(central.bases.map(base=>base.id),[1,2]);
  assert(central.bases.every(base=>base.nameIsFallback),'locally generated names are distinguished from game names');
  assert.equal(central.bases[0].distance,8);
  assert.equal(central.bases[1].mode,'出击');
  const southwest=view.model(store,'7-4');
  assert.equal(southwest.bases[0].nameIsFallback,false);assert.equal(southwest.bases[0].name,'南西航空队');
  assert.equal(southwest.map.maxSortieSquadrons,1);
  assert.equal(southwest.bases[0].distance,6);
  assert.equal(southwest.bases[0].mode,'防空');
  assert.match(southwest.bases[0].slots[0].name,/测试陆攻.*★3.*熟练度 7/);
  assert.equal(southwest.bases[0].slots[0].count,'14/18');
  assert.equal(southwest.bases[0].slots[1].name,'空槽');
  assert.equal(southwest.bases[0].slots[2].name,'资料待同步');
  const tree=view.render(h,()=>null,store,'7-4');
  assert.match(text(tree),/基地航空队.*出击上限 1 队.*南西航空队.*防空/);
  assert(find(tree,node=>node.props['aria-label']==='航程 6'));
  const details=find(tree,node=>node.type==='details'&&node.props.className==='paa-airbase-disclosure');
  assert(details);assert.equal(details.props.open,undefined,'the details are folded by default');
  const summary=find(details,node=>node.type==='summary');
  assert.match(text(summary),/1 队.*防空/,'the folded summary retains the squadron status');
  assert(!find(summary,node=>node.props['aria-label']==='航程 6'),'range remains in expanded details');
  assert(find(summary,node=>node.props['aria-label']==='攻击目标未指定'));
  assert(!text(summary).includes('测试陆攻'),'aircraft details appear only inside the collapsed content');
  assert(find(details,node=>node.props.className==='paa-airbase-list'));
  assert.equal(find(tree,node=>node.type==='button'),undefined);
  assert.equal(JSON.stringify(store),before);
});

test('missing base, partial range and unknown aircraft do not become known values',()=>{
  const store=fixture();
  assert.match(text(view.render(h,()=>null,store,'6-4')),/基地航空队待同步/);
  store.info.airbase=[{api_area_id:6,api_rid:1,api_action_kind:99,api_distance:{api_base:5},api_plane_info:[
    {api_squadron_id:1,api_slotid:1001,api_count:0,api_state:2},
    {api_squadron_id:2,api_slotid:0,api_state:0}]}];
  const base=view.model(store,'6-4').bases[0];
  assert.equal(base.distance,null);assert.equal(base.mode,'状态待确认');
  assert.equal(base.slots[0].name,'飞机资料待同步');assert.equal(base.slots[0].count,'0/?');
  assert.equal(base.slots[0].state,'转场中');assert.equal(base.slots[1].name,'空槽');
  assert.match(text(view.render(h,()=>null,store,'6-4')),/转场中/);
  assert.equal(base.slots[2].name,'资料待同步');
  const southwest=view.model(store,'7-4');
  assert.deepEqual(southwest.bases,[],'central bases must never be displayed for the southwest');
  assert.match(text(view.render(h,()=>null,store,'7-4')),/基地航空队待同步/);
  store.airbaseSync={complete:true};
  const locked=view.render(h,()=>null,store,'7-4');
  assert.match(text(locked),/待解锁/);
  assert(find(locked,node=>node.type==='svg'&&node.props['aria-hidden']===true),'lock icon is visible');
  assert(find(locked,node=>node.props['data-state']==='locked'));
  assert.equal(find(locked,node=>node.type==='button'),undefined);
});
test('a removal countdown shows the maintenance range and never treats timeout as a server release',()=>{
  assert.equal(view.relocationLabel(10000,10000),'转场 6:00–12:00');
  assert.equal(view.relocationLabel(10000,70000),'转场 5:00–11:00');
  assert.equal(view.relocationLabel(10000,730000),'转场中');
  assert.equal(view.relocationLabel(null,70000),'转场中');
});

test('change signature detects in-place base and assigned equipment updates',()=>{
  const store=fixture();store.info.equips[1001]={api_slotitem_id:501,api_level:0};
  store.const.$equips[501]={api_name:'测试陆攻',api_type:[0,0,47,47]};
  store.info.airbase=[{api_area_id:6,api_rid:1,api_plane_info:[{api_squadron_id:1,api_slotid:1001,api_count:18}]}];
  let before=view.signature(store,'6-4');store.info.airbase[0].api_plane_info[0].api_count=17;
  assert.notEqual(view.signature(store,'6-4'),before);
  before=view.signature(store,'6-4');store.info.equips[1001].api_level=1;
  assert.notEqual(view.signature(store,'6-4'),before);
  assert.equal(view.signature(store,'7-5'),'');
});

test('defence and sortie proposals are distinguished from the actual game mode',()=>{
  const store=fixture();store.info.airbase=[{api_area_id:6,api_rid:1,api_action_kind:0,api_distance:5,api_plane_info:[]}];
  const draft={rid:1,mode:2,modePlanned:true,targets:[],slots:[]};
  assert.equal(view.model(store,'6-5',[draft]).bases[0].mode,'防空方案');
  assert.equal(view.model(store,'6-5',[{...draft,modePlanned:false}]).bases[0].mode,'待机');
  assert.equal(view.model(store,'6-5',[{...draft,mode:1,targets:['M','M']}]).bases[0].mode,'出击方案');
  assert.equal(store.info.airbase[0].api_action_kind,0);
});

test('base squadron air values follow sortie or defense plans and update with aircraft',()=>{
  const store=fixture();store.info.equips[1001]={api_slotitem_id:501,api_level:0,api_alv:7};
  store.const.$equips[501]={api_name:'测试局战',api_type:[0,0,48],api_tyku:6,api_houk:2,api_houm:5,api_distance:2};
  const planes=Array.from({length:4},(_,i)=>({api_squadron_id:i+1,api_slotid:i?0:1001,api_count:i?0:18,api_max_count:18,api_state:i?0:1}));
  store.info.airbase=[{api_area_id:6,api_rid:1,api_action_kind:1,api_distance:2,api_plane_info:planes}];
  const before=JSON.stringify(store);let squad=view.model(store,'6-5').bases[0];
  assert.deepEqual([squad.air.label,squad.air.value],['出击制空','63']);
  const draft={rid:1,areaId:6,mode:2,modePlanned:true,targets:[],slots:planes.map(row=>({slotId:row.api_squadron_id,
    itemId:row.api_slotid,count:row.api_count,maxCount:row.api_max_count,state:row.api_state}))};
  squad=view.model(store,'6-5',[draft]).bases[0];assert.deepEqual([squad.air.label,squad.air.value],['防空制空','101']);
  const tree=view.render(h,()=>null,store,'6-5',{bases:[draft],targets:[]});
  const metric=find(tree,node=>node.props.className==='paa-airbase-air'&&node.props['aria-label']==='防空制空 101');
  assert(metric);assert.equal(text(metric),'制空101');assert.equal(find(metric,node=>node.type==='svg'),undefined);
  const range=find(tree,node=>node.props.className==='paa-airbase-range'&&node.props['aria-label']==='航程 2');
  assert(range);assert.equal(text(range),'航程2');assert.equal(find(range,node=>node.type==='svg'),undefined);
  draft.slots[0]={...draft.slots[0],planned:true,count:9};squad=view.model(store,'6-5',[draft]).bases[0];
  assert.notEqual(squad.air.value,'101');assert.doesNotMatch(squad.air.tooltip,/转场|补给/);
  assert.equal(JSON.stringify(store),before);
});

test('folded three-base summary shows one air value and the two planned target waves',()=>{
  const store=fixture();
  store.const.$equips[501]={api_name:'测试陆攻',api_type:[0,0,47],api_tyku:3,api_raig:10,api_distance:8};
  store.info.equips[1001]={api_slotitem_id:501,api_level:0,api_alv:7};
  const planes=Array.from({length:4},(_,i)=>({api_squadron_id:i+1,api_slotid:i?0:1001,api_count:i?0:18,api_max_count:18,api_state:i?0:1}));
  store.info.airbase=[1,2,3].map(id=>({api_area_id:6,api_rid:id,api_action_kind:id===3?2:1,api_distance:8,api_plane_info:planes}));
  const slots=planes.map(row=>({slotId:row.api_squadron_id,itemId:row.api_slotid,count:row.api_count,maxCount:row.api_max_count,state:row.api_state}));
  const bases=[{rid:1,areaId:6,slots,targets:['M','M']},{rid:2,areaId:6,slots,targets:['C','']},{rid:3,areaId:6,slots,targets:[]}];
  const model=view.model(store,'6-5',bases),tree=view.render(h,()=>null,store,'6-5',{bases,targets:[]});
  const summary=find(tree,node=>node.type==='summary'),unit=find(summary,node=>node.props.className==='paa-airbase-summary-unit');
  const air=find(unit,node=>node.props.className==='paa-airbase-air');
  assert(model.bases[0].air.power.min<model.bases[0].air.power.max);
  assert.equal(text(air),`制空${model.bases[0].air.power.min}`);
  assert.match(air.props['data-tooltip'],/摘要显示下限/);
  assert.match(air.props['data-tooltip'],new RegExp(model.bases[0].air.value));
  assert.match(text(summary),/1 队.*出击.*目标M\/M.*2 队.*出击.*目标C\/—.*3 队.*防空.*目标—/);
  assert(find(summary,node=>node.props['aria-label']==='第 1 波：C 点；第 2 波：未指定'));
  assert.doesNotMatch(text(summary),/航程/);
  const expanded=find(tree,node=>node.props.className==='paa-airbase-list');
  assert.match(text(expanded),new RegExp(model.bases[0].air.value));
  assert.match(text(expanded),/航程/);
});

test('compact controls keep their labels and omit repeated transfer and resupply explanations',()=>{
  const store=fixture();store.info.equips[1001]={api_slotitem_id:501,api_level:0,api_alv:7};
  store.const.$equips[501]={api_name:'测试陆攻',api_type:[0,0,47],api_tyku:3,api_raig:10,api_distance:8};
  const planes=Array.from({length:4},(_,i)=>({api_squadron_id:i+1,api_slotid:i?0:1001,api_count:i?0:18,api_max_count:18,api_state:i?0:1}));
  store.info.airbase=[{api_area_id:6,api_rid:1,api_name:'第一航空队',api_action_kind:0,api_distance:8,api_plane_info:planes}];
  const draft={rid:1,areaId:6,mode:1,modePlanned:true,targets:['C','N'],slots:planes.map(row=>({slotId:row.api_squadron_id,
    itemId:row.api_slotid,count:row.api_count,maxCount:row.api_max_count,state:row.api_state,planned:!!row.api_slotid}))};
  let changed;const warnings=['第 1 航空队换装后需完成转场和补给','C 点资料待确认'];
  const tree=view.render(h,()=>null,store,'6-4',{bases:[draft],targets:[{id:'C',label:'C 点'},{id:'N',label:'N 点 · Boss'}],warnings,
    onTarget:(...args)=>{changed=args;},onEditSlot(){}});
  const summary=find(tree,node=>node.type==='summary');
  assert(find(summary,node=>node.props['aria-label']==='第 1 波：C 点；第 2 波：N 点'));
  assert.match(text(summary),/目标C\/N/);
  assert.doesNotMatch(text(tree),/转场|补给后|需在游戏中配置/);
  assert.match(text(tree),/C 点资料待确认/,'real unknowns remain visible');
  assert(find(tree,node=>node.props['aria-label']?.startsWith('出击制空 ')));
  const wave=find(tree,node=>node.type==='select'&&node.props['aria-label']==='第一航空队第 1 波攻击点');
  assert(wave);wave.props.onChange({target:{value:'N'}});assert.deepEqual(changed,[1,0,'N']);
  assert.deepEqual(warnings,['第 1 航空队换装后需完成转场和补给','C 点资料待确认']);
});
