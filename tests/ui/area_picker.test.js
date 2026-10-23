'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const create=require('../../src/ui/components/area_picker');
function harness(props){
  let i=0,tree;const states=[];
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),
    useState(initial){const k=i++;if(!(k in states))states[k]=typeof initial==='function'?initial():initial;return [states[k],value=>states[k]=value];},
    useRef(initial){const k=i++;return states[k]||(states[k]={current:initial});},useEffect:()=>{}};
  const Picker=create(React),render=()=>{i=0;tree=Picker(props);};
  const all=(node,fn)=>!node||typeof node!=='object'?[]:[...(fn(node)?[node]:[]),...node.children.flatMap(child=>all(child,fn))];
  const find=fn=>all(tree,fn)[0];render();
  return {render,find,all:fn=>all(tree,fn),open:()=>{find(n=>n.props['aria-label']===(props.kind==='expedition'?'远征':'海域')).props.onClick();render();}};
}
test('map panel groups the full catalog numerically without omitting or mutating maps',()=>{
  const maps=require('../../src/domain/routes/normal_routes').listNormalMaps().maps;
  const before=JSON.stringify(maps),rows=create.groups(maps.slice().reverse());
  assert.equal(rows.length,7);assert.equal(rows.flatMap(r=>r.maps).length,37);
  assert.deepEqual(rows.map(r=>r.world),[1,2,3,4,5,6,7]);
  assert.deepEqual(rows[0].maps.map(m=>m.area),['1-1','1-2','1-3','1-4','1-5','1-6']);
  assert.equal(new Set(rows.flatMap(r=>r.maps.map(m=>m.area))).size,37);
  assert.equal(JSON.stringify(maps),before);
});
test('panel selects directly, highlights current map, and closing leaves selection untouched',()=>{
  const calls=[],props={maps:[{area:'1-1',name:'近海'},{area:'3-5',name:'北方海域'}],value:'3-5',onChange:id=>calls.push(id)};
  const ui=harness(props);ui.open();
  assert(ui.find(n=>n.props.role==='dialog'));assert.equal(ui.find(n=>n.props['aria-current']==='true').props['aria-label'],'3-5 北方海域');
  ui.find(n=>n.props['aria-label']==='关闭海域选择').props.onClick();ui.render();
  assert(!ui.find(n=>n.props.role==='dialog'));assert.deepEqual(calls,[]);
  ui.open();ui.find(n=>n.props['aria-label']==='1-1 近海').props.onClick();ui.render();
  assert.deepEqual(calls,['1-1']);assert(!ui.find(n=>n.props.role==='dialog'));
  ui.open();ui.find(n=>n.props.role==='dialog').props.onKeyDown({key:'Escape',preventDefault(){},stopPropagation(){}});ui.render();
  assert(!ui.find(n=>n.props.role==='dialog'));assert.deepEqual(calls,['1-1']);
  props.disabled=true;ui.render();assert(ui.find(n=>n.props['aria-label']==='海域').props.disabled);
  ui.open();assert(!ui.find(n=>n.props.role==='dialog'));
});

test('map names come from live master data when the routing catalog has only numbers',()=>{
  const props={maps:[{area:'1-1'},{area:'3-5'}],mapMasters:{11:{api_name:'鎮守府正面海域'},35:{api_name:'北方AL海域'}},value:'3-5',onChange(){}};
  const ui=harness(props);ui.open();
  assert(ui.find(n=>n.props['aria-label']==='1-1 鎮守府正面海域'));
  assert.equal(ui.find(n=>n.props['aria-current']==='true').children.find(n=>n?.type==='small').children[0],'北方AL海域');
  assert.equal(ui.all(n=>n.props['data-tooltip']||n.props.title).length,0);
});

test('expeditions share the anchored non-modal panel and select numeric mission ids',()=>{
  const calls=[],missions=[{missionId:101,world:1,name:'兵站强化任务'},{missionId:2,world:1,name:'长距离练习航海'},{missionId:9,world:2,name:'油轮护卫任务'}];
  const before=JSON.stringify(missions),rows=create.sortMissions(missions,()=>({}));
  assert.deepEqual(rows.map(m=>m.missionId),[2,9,101]);assert.equal(JSON.stringify(missions),before);
  const ui=harness({kind:'expedition',missions,value:2,onChange:id=>calls.push(id)});ui.open();
  const anchor=ui.find(n=>n.props.className==='paa-area-anchor'),panel=ui.find(n=>n.props.role==='dialog');
  assert(anchor.children.includes(panel));assert.notEqual(panel.props['aria-modal'],true);
  assert.equal(ui.find(n=>n.props['aria-current']==='true').props['aria-label'],'2 长距离练习航海');
  ui.find(n=>n.props['aria-label']==='101 兵站强化任务').props.onClick();ui.render();
  assert.deepEqual(calls,[101]);assert(!ui.find(n=>n.props.role==='dialog'));
});

test('current selection is a no-op; trigger toggle, focus departure and hidden tabs dismiss without changing drafts',()=>{
  const calls=[],props={maps:[{area:'1-1'}],value:'1-1',onChange:id=>calls.push(id)};
  const ui=harness(props);ui.open();ui.find(n=>n.props['aria-current']==='true').props.onClick();ui.render();
  assert.deepEqual(calls,[]);assert(!ui.find(n=>n.props.role==='dialog'));
  ui.open();ui.open();assert(!ui.find(n=>n.props.role==='dialog'));
  ui.open();ui.find(n=>n.props.className==='paa-area-anchor').props.onBlur({currentTarget:{contains:()=>false},relatedTarget:{}});ui.render();
  assert(!ui.find(n=>n.props.role==='dialog'));
  ui.open();props.hidden=true;ui.render();assert(!ui.find(n=>n.props.role==='dialog'));assert.deepEqual(calls,[]);
});

test('expedition summaries combine display numbers, real duration and resources with possible item rewards',()=>{
  const mission={missionId:101,name:'海峡警备行动'},master={api_disp_no:'A2',api_time:55,api_win_mat_level:[1,1,0,1],api_win_item1:[3,1],api_win_item2:[1,1]};
  const before=JSON.stringify({mission,master}),summary=create.missionSummary(mission,master);
  assert.equal(summary.number,'A2');assert.equal(summary.time,'55分');
  assert.deepEqual(summary.rewards.map(r=>r.name),['燃料','弹药','铝土','开发资材','高速修复材']);
  assert.equal(summary.name,'海峡警备行动');
  assert.equal(JSON.stringify({mission,master}),before);
  const known=create.missionSummary({missionId:21},{api_time:140,api_win_item1:[10,1]});
  assert.equal(known.time,'2时20分');assert.deepEqual(known.rewards.slice(0,2),[{name:'燃料',amount:320},{name:'弹药',amount:270}]);
  assert(known.rewards.some(r=>r.name==='家具箱（小）'));
  assert.equal(create.missionSummary(mission).time,'—');
  assert.equal(create.missionSummary(mission,{api_time:0}).time,'—');
});

test('expedition trigger keeps number and name; comparison details remain in the open list',()=>{
  const missions=[{missionId:101,world:1,name:'海峡警备行动'}],missionMasters={101:{api_disp_no:'A2',api_time:55,api_win_mat_level:[1,1,0,1]}};
  const calls=[],ui=harness({kind:'expedition',missions,missionMasters,value:101,onChange:id=>calls.push(id)});
  const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join(' ');
  const trigger=ui.find(n=>n.props.className==='paa-area-trigger');
  assert.match(text(trigger),/A2/);assert(!text(trigger).includes('55分'));assert(text(trigger).includes('海峡警备行动'));
  assert.equal(trigger.props['data-tooltip'],undefined);
  ui.open();const option=ui.find(n=>n.props['aria-current']==='true');
  assert.match(text(option),/A2/);assert.match(text(option),/55分/);assert(text(option).includes('海峡警备行动'));
  assert(ui.find(n=>n.props.className==='paa-mission-rewards'&&n.props['aria-label']==='燃料、弹药、铝土'));
  option.props.onClick();assert.deepEqual(calls,[]);
});

test('expedition search and supported sorting preserve selection and keep every mission visible',()=>{
  const missions=[{missionId:101,world:1,name:'海峡警備行動'},{missionId:103,world:1,name:'南西方面連絡線哨戒'},{missionId:43,world:7,name:'ミ船団護衛'}];
  const missionMasters={101:{api_disp_no:'A2',api_time:55},103:{api_disp_no:'A4',api_time:110,api_reset_type:1},43:{api_disp_no:'43',api_time:720,api_reset_type:1,api_win_item2:[4,1]}};
  const missionProgress={period:'2026-10',records:{101:{state:2,period:'2026-09'},103:{state:1,period:'2026-10'},43:{state:2,period:'2026-10'}}};
  const calls=[],ui=harness({kind:'expedition',missions,missionMasters,missionProgress,value:101,onChange:id=>calls.push(id)});ui.open();
  const change=(label,value)=>{ui.find(n=>n.props['aria-label']===label).props.onChange({target:{value}});ui.render();};
  const options=()=>ui.all(n=>n.type==='button'&&n.props['data-completion']);
  assert.deepEqual(ui.all(n=>n.type==='option').map(n=>n.props.value),['number','short','long','fuel','ammo','steel','bauxite']);
  assert(!ui.find(n=>n.props['aria-label']==='远征类型'));assert(!ui.find(n=>n.props['aria-label']==='远征完成状态'));
  change('远征排序','short');assert.deepEqual(options().map(n=>n.props['aria-label'].split(' ')[0]),['101','103','43']);
  change('远征排序','long');assert.deepEqual(options().map(n=>n.props['aria-label'].split(' ')[0]),['43','103','101']);
  assert.equal(options().length,3);assert(!ui.find(n=>n.type==='h4'));
  change('搜索远征','a４');assert.equal(options().length,1);
  ui.find(n=>n.props.className==='paa-mission-search-reset').props.onClick();ui.render();assert.equal(options().length,3);
  assert.equal(ui.find(n=>n.props['aria-label']==='远征排序').props.value,'long');
  change('搜索远征','海峡警备');assert.equal(options().length,1);assert.match(options()[0].props['aria-label'],/^101 /);
  assert.deepEqual(calls,[]);assert(ui.find(n=>n.props.className==='paa-area-trigger').children.some(n=>n?.props?.className==='paa-area-name'));
  const summary=m=>create.missionSummary(m,missionMasters[m.missionId],{},missionProgress);
  assert.deepEqual(create.filterMissions(missions,summary,{query:'螺丝'}).map(m=>m.missionId),[43]);
});

test('reward icon hints provide Chinese names that can be used directly to search expeditions',()=>{
  const missions=[{missionId:101,name:'海峡警备行动'},{missionId:43,name:'船团护卫'}];
  const missionMasters={101:{api_time:55,api_win_item1:[3,1],api_win_item2:[1,1]},
    43:{api_time:720,api_win_item1:[12,1],api_win_item2:[4,1]}};
  const calls=[],ui=harness({kind:'expedition',missions,missionMasters,value:101,onChange:id=>calls.push(id)});ui.open();
  const labels=[...new Set(ui.all(n=>n.props.className==='paa-mission-reward-icon').map(n=>n.props['data-tooltip']))];
  assert(labels.includes('燃料'));assert(labels.includes('高速修复材'));assert(labels.includes('开发资材'));
  assert(labels.includes('改修资材'));assert(labels.includes('家具箱（大）'));
  for(const label of labels){
    ui.find(n=>n.props['aria-label']==='搜索远征').props.onChange({target:{value:label}});ui.render();
    const options=ui.all(n=>n.type==='button'&&n.props['data-completion']);assert(options.length>0,label);
    for(const option of options){
      const rewards=option.children.find(n=>n?.props?.className==='paa-mission-rewards');
      assert(rewards.children.some(n=>n.props['data-tooltip']===label),label);
    }
  }
  assert.deepEqual(calls,[]);assert.equal(ui.all(n=>n.props.title).length,0);
});

test('monthly completion expires independently, unknown stays unknown, and current expeditions retain historical completion',()=>{
  const mission={missionId:103,name:'月度测试'},master={api_time:110,api_reset_type:1};
  const progress={period:'2026-10',records:{103:{state:2,period:'2026-09'}}};
  const old=create.missionSummary(mission,master,{},progress);
  assert.equal(old.status,'unknown');assert.match(old.statusText,/同步/);assert.equal(old.monthly,true);
  progress.records[103].period='2026-10';const current=create.missionSummary(mission,master,{},progress);
  assert.equal(current.status,'completed');assert.match(current.statusText,/本期已完成/);
  const running=create.missionSummary(mission,master,{},progress,[{api_mission:[0]},{api_mission:[1,103,0]}]);
  assert.equal(running.status,'running');assert.equal(running.completion,'completed');assert.match(running.statusText,/第 2 舰队/);
});

test('resource icons bundle original game PNGs without a host path and preserve fallback size',()=>{
  const path=require('path'),fs=require('fs'),{fileURLToPath}=require('url'),createIcon=require('../../src/ui/components/resource_icon');
  const source=createIcon.resourceSource;
  const expected={燃料:1,弹药:2,钢材:3,铝土:4,高速建造材:5,高速修复材:6,开发资材:7,改修资材:8,'家具箱（小）':10,'家具箱（中）':11,'家具箱（大）':12};
  let bytes=0;
  for(const [name,id] of Object.entries(expected)){
    const file=fileURLToPath(source(name));
    assert.equal(file,path.resolve(__dirname,'../../data/icons/material',`0${id}.png`));
    const data=fs.readFileSync(file);bytes+=data.length;
    assert.equal(data.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(data.readUInt32BE(16),27);assert.equal(data.readUInt32BE(20),27);
  }
  assert.equal(bytes,18103);assert.equal(source('未知道具'),null);
  const item=fileURLToPath(source('伊良湖'));
  assert.match(item,/59\.png$/);assert(fs.existsSync(item));
  const React={createElement:(type,props,...children)=>({type,props,children})},Icon=createIcon(React);
  const node=Icon({name:'燃料',size:14}),image=node.children.find(n=>n?.type==='img');
  assert.deepEqual(node.props.style,{width:14,height:14});assert.equal(image.props.draggable,false);
  const parentElement={dataset:{}};image.props.onError({currentTarget:{parentElement}});
  assert.equal(parentElement.dataset.failed,'true');assert.deepEqual(node.props.style,{width:14,height:14});
  image.props.onLoad({currentTarget:{parentElement}});assert.equal(parentElement.dataset.failed,undefined);
  const missing=Icon({name:'未知道具'});assert.equal(missing.props['data-failed'],true);assert.equal(missing.children[0].children[0],'未');
});

test('locked expeditions differ from available uncompleted rows and never infer locks from missing or stale snapshots',()=>{
  const missions=[{missionId:1,name:'训练航海'},{missionId:103,name:'月度未解锁'},{missionId:104,name:'新远征'}];
  const progress={period:'2026-10',records:{1:{state:0,period:'2026-10'}},list:{period:'2026-10',ids:[1],catalogIds:[1,103]}};
  const summary=m=>create.missionSummary(m,{api_reset_type:m.missionId===1?0:1},{},progress);
  assert.equal(summary(missions[0]).completion,'incomplete');assert.equal(summary(missions[1]).completion,'locked');
  assert.equal(summary(missions[1]).statusText,'未解锁');assert.equal(summary(missions[2]).completion,'unknown');
  progress.list.period='2026-09';assert.equal(summary(missions[1]).completion,'unknown');
  delete progress.list;assert.equal(summary(missions[1]).completion,'unknown');
  progress.list={period:'2026-10',ids:[1,103],catalogIds:[1,103]};assert.equal(summary(missions[1]).completion,'unknown');
  progress.list.ids=[1];progress.records[103]={state:2,period:'2026-10'};assert.equal(summary(missions[1]).completion,'completed');
  delete progress.records[103];const running=create.missionSummary(missions[1],{api_reset_type:1},{},progress,[{api_mission:[1,103,0]}]);
  assert.equal(running.status,'running');assert.notEqual(running.completion,'locked');
});

test('picker labels locks, keeps planning selectable and marks only completed monthly cards for attenuation',()=>{
  const missions=[{missionId:1,name:'训练航海'},{missionId:103,name:'月度已完成'},{missionId:104,name:'月度未解锁'}];
  const missionMasters={1:{api_time:15},103:{api_time:110,api_reset_type:1},104:{api_time:180,api_reset_type:1}};
  const missionProgress={period:'2026-10',records:{1:{state:2,period:'2026-10'},103:{state:2,period:'2026-10'}},list:{period:'2026-10',ids:[1,103],catalogIds:[1,103,104]}};
  const calls=[],ui=harness({kind:'expedition',missions,missionMasters,missionProgress,value:1,onChange:id=>calls.push(id)});ui.open();
  const locked=ui.find(n=>n.type==='button'&&n.props['data-completion']==='locked');
  assert(locked);assert(ui.find(n=>n.props.className==='paa-mission-locked-label'&&n.children.includes('未解锁')));
  assert(ui.find(n=>n.props.className==='paa-mission-state'&&n.props['data-state']==='locked'));
  assert(!locked.props.disabled);locked.props.onClick();assert.deepEqual(calls,[104]);
  const css=require('../../src/ui/workbench/workbench_styles');
  assert.match(css,/button\[data-monthly=true\]\[data-completion=completed\]:not\(\[aria-current=true\]\):not\(:hover\):not\(:focus-visible\)\{opacity:\.6\}/);
});

test('expedition choices keep status accessible without status or prerequisite hover tooltips',()=>{
  const mission={missionId:43,name:'ミ船団護衛(二号船団)'},master={api_time:720,api_reset_type:1};
  const progress={period:'2026-10',records:{42:{state:0,period:'2026-10'}},list:{period:'2026-10',ids:[42],catalogIds:[42,43]}};
  const missionMasters={42:{api_disp_no:'42',api_name:'ミ船団護衛(一号船団)',api_reset_type:1},43:master};
  const ui=harness({kind:'expedition',missions:[mission],missionMasters,missionProgress:progress,value:43,onChange:()=>{}});
  ui.open();assert.equal(ui.all(n=>(n.props['data-tooltip']||n.props.title)&&n.props.className!=='paa-mission-reward-icon').length,0);
  assert(ui.find(n=>n.type==='button'&&n.props['data-completion']==='locked'));
  assert(ui.find(n=>n.props.className==='paa-mission-state'&&n.props['aria-label']==='未解锁'));
  progress.records[43]={state:2,period:'2026-10'};ui.render();
  assert(ui.find(n=>n.props.className==='paa-mission-state'&&n.props['aria-label']==='本期已完成'));
});

test('unlock explanations cover all expedition ids and separate historical success, monthly prerequisites and extra conditions',()=>{
  const {unlockText}=require('../../src/ui/expedition/expedition_model'),data=require('../../data/expedition_requirements.json');
  assert.deepEqual(Object.keys(data.unlocks.missions).sort(),Object.keys(data.missions).sort());
  const visit=(id,path=[])=>{assert(!path.includes(id),'Unlock cycle: '+[...path,id]);for(const next of data.unlocks.missions[id].missions||[]){assert(data.missions[next],'Missing prerequisite '+next);visit(next,[...path,id]);}};
  for(const id of Object.keys(data.missions))visit(Number(id));
  const progress={period:'2026-10',records:{40:{state:2,period:'2026-09'},41:{state:2,period:'2026-09'},103:{state:2,period:'2026-09'}}};
  let text=unlockText(44,{},progress);assert.match(text,/✓ 40（已完成）/);assert.match(text,/✓ 41（已完成）/);assert.match(text,/○ A4（本期待同步）/);
  progress.records[103]={state:2,period:'2026-10'};text=unlockText(44,{},progress);assert.match(text,/✓ A4（本期已完成）/);
  assert.match(unlockText(104),/A4/);assert.match(unlockText(104),/B3/);assert.match(unlockText(133),/D2/);assert.match(unlockText(141),/40/);
  assert.match(unlockText(23),/通关海域 1-5/);assert.match(unlockText(41),/通关海域 2-4/);assert.match(unlockText(1),/完成任务 A4/);
  assert.match(unlockText(999),/资料待补充/);
  progress.list={period:'2026-10',ids:[40,41],catalogIds:[40,41,103]};delete progress.records[103];
  assert.match(unlockText(44,{},progress),/A4（本期未解锁）/);
});

test('duration sorting keeps unknown values last in both directions and ties in canonical number order',()=>{
  const missions=[{missionId:111},{missionId:1},{missionId:4},{missionId:3},{missionId:2}],before=JSON.stringify(missions);
  const rows={1:{minutes:60},2:{minutes:60},3:{minutes:120},4:{minutes:0},111:{minutes:NaN}};
  const sort=order=>create.sortMissions(missions,m=>rows[m.missionId],order).map(m=>m.missionId);
  assert.deepEqual(sort('short'),[1,2,3,4,111]);assert.deepEqual(sort('long'),[3,1,2,4,111]);
  assert.deepEqual(sort('number'),[1,2,3,4,111]);assert.equal(JSON.stringify(missions),before);
});

test('fixed hourly net income presets cover the catalog and deduct fuel and ammunition before dividing by duration',()=>{
  const {referenceIncome}=require('../../src/ui/expedition/expedition_model'),data=require('../../data/expedition_rewards.json');
  const ids=Object.keys(require('../../data/expedition_requirements.json').missions).sort();
  assert.deepEqual(Object.keys(data.incomeReference.missions).sort(),ids);
  for(const id of ids){const row=referenceIncome(id);assert(row);assert(row.minutes>0);assert(row.cost.fuelCost>=0&&row.cost.ammoCost>=0);
    for(const value of Object.values(row.hourly))assert(Number.isFinite(value));}
  const row=referenceIncome(1);assert.equal(row.cost.fuelCost,8);assert.equal(row.cost.ammoCost,0);
  assert.equal(row.hourly['燃料'],-32);assert.equal(row.hourly['弹药'],120);assert.equal(row.hourly['钢材'],0);assert.equal(row.hourly['铝土'],0);
  const trip=referenceIncome(37),base=data.missions[37].resources;
  assert.equal(trip.hourly['燃料'],(base[0]-80)*60/165);assert.equal(trip.hourly['弹药'],(base[1]-108)*60/165);
  assert.equal(referenceIncome(999),null);
});

test('resource sorting uses unrounded net hourly values including losses, places missing presets last and breaks ties by id',()=>{
  const missions=[1,2,3,4,5].map(missionId=>({missionId}));
  for(const [order,name]of Object.entries({fuel:'燃料',ammo:'弹药',steel:'钢材',bauxite:'铝土'})){
    const values={1:0,2:-32,3:12.04,4:12.03};
    const rows=Object.fromEntries(missions.map(m=>[m.missionId,{income:m.missionId===5?null:{hourly:{[name]:values[m.missionId]}}}]));
    assert.deepEqual(create.sortMissions(missions,m=>rows[m.missionId],order).map(m=>m.missionId),[3,4,1,2,5]);
    rows[4].income.hourly[name]=12.04;
    assert.deepEqual(create.sortMissions(missions,m=>rows[m.missionId],order).map(m=>m.missionId),[3,4,1,2,5]);
  }
});

test('all four resource sorts show instant reference net rates without fleet calculation or changing the selected mission',()=>{
  const missions=[{missionId:1,name:'练习航海'},{missionId:5,name:'海上护卫任务'}],calls=[];
  const props={kind:'expedition',missions,value:1,onChange:id=>calls.push(id),missionMasters:{1:{api_time:15},5:{api_time:90}},
    getIncomeRanking:()=>{throw Error('Fixed references must never search a player fleet');}};
  const ui=harness(props);ui.open();
  const select=()=>ui.find(n=>n.props['aria-label']==='远征排序');
  for(const order of ['fuel','ammo','steel','bauxite']){
    assert(select().children.some(n=>n.props.value===order));select().props.onChange({target:{value:order}});ui.render();
    assert.equal(ui.all(n=>n.props.className==='paa-mission-hourly').length,2);
    assert(ui.find(n=>n.props.className==='paa-mission-count').children.some(text=>text.includes('预设补给')));
    assert.equal(ui.all(n=>(n.props['data-tooltip']||n.props.title)&&n.props.className!=='paa-mission-reward-icon').length,0);
    assert(!ui.find(n=>n.children.includes('计算中…')));
  }
  assert.deepEqual(calls,[]);assert.equal(ui.find(n=>n.props['aria-current']==='true').props['aria-label'],'1 练习航海');
});

test('reopening the plugin or remounting from home resets expedition search and sort without reading old storage',t=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage;});
  let storageAccess=0;
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){storageAccess++;throw Error('Old preferences must not be read or written');}});
  const calls=[],props={kind:'expedition',missions:[{missionId:1,name:'练习航海'},{missionId:5,name:'海上护卫任务'}],value:1,onChange:id=>calls.push(id)};
  const first=harness(props);first.open();
  first.find(n=>n.props['aria-label']==='搜索远征').props.onChange({target:{value:'海上'}});
  first.find(n=>n.props['aria-label']==='远征排序').props.onChange({target:{value:'bauxite'}});first.render();
  assert.equal(first.find(n=>n.props['aria-label']==='远征排序').props.value,'bauxite');
  first.find(n=>n.props['aria-label']==='关闭远征选择').props.onClick();first.render();first.open();
  assert.equal(first.find(n=>n.props['aria-label']==='远征排序').props.value,'bauxite');
  assert.equal(first.find(n=>n.props['aria-label']==='搜索远征').props.value,'海上');
  const reopened=harness(props);reopened.open();
  assert.equal(reopened.find(n=>n.props['aria-label']==='远征排序').props.value,'number');
  assert.equal(reopened.find(n=>n.props['aria-label']==='搜索远征').props.value,'');
  assert.equal(reopened.all(n=>n.type==='button'&&n.props['data-completion']).length,2);
  assert.equal(storageAccess,0);assert.deepEqual(calls,[]);
});

test('item rewards distinguish random single or first rewards from great-success-only second rewards',()=>{
  const {rewardItems}=require('../../src/ui/expedition/expedition_model');
  assert.deepEqual(rewardItems(),[]);
  const both=rewardItems({api_win_item1:[3,2],api_win_item2:[1,1]});
  assert.deepEqual(both,[{id:3,name:'开发资材',count:2,greatOnly:false},{id:1,name:'高速修复材',count:1,greatOnly:true}]);
  assert.equal(rewardItems({api_win_item1:[0,0],api_win_item2:[1,1]})[0].greatOnly,false);
  assert.deepEqual(rewardItems({api_win_item1:[999,0]},{999:{api_name:'测试道具'}}),[{id:999,name:'测试道具',count:null,greatOnly:false}]);
});

test('selected expedition displays monthly prerequisites first and item rewards inside the resource income table without hover',()=>{
  const React={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()})};
  const view=require('../../src/ui/expedition/expedition_view')(React),all=(n,p)=>!n||typeof n!=='object'?[]:[...(p(n)?[n]:[]),...n.children.flatMap(c=>all(c,p))];
  const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join(' ');
  const mission={missionId:43,name:'ミ船団護衛(二号船団)'},master={api_time:720,api_reset_type:1,api_win_item1:[3,2],api_win_item2:[1,1]};
  const missionMasters={42:{api_disp_no:'42',api_name:'ミ船団護衛(一号船団)',api_reset_type:1},43:master};
  const missionProgress={period:'2026-10',records:{42:{state:0,period:'2026-10'}},list:{period:'2026-10',ids:[42],catalogIds:[42,43]}};
  const props={mission,master,missionMasters,missionProgress,rate:0,hasShips:false};
  for(const incomeUnit of ['trip','hour']){
    const tree=view.overview({...props,incomeUnit}),income=all(tree,n=>n.props.className==='paa-exp-income')[0];
    assert.equal(tree.children[0].props.className,'paa-exp-unlock');
    assert.match(text(tree.children[0]),/未解锁/);assert.match(text(tree.children[0]),/42 ミ船団護衛\(一号船団\)（本期未完成）/);
    const items=all(income,n=>n.props.className==='paa-exp-income-row paa-exp-item-row');
    assert.equal(items.length,2);assert.match(text(items[0]),/开发资材.*0 ~ 2/);
    assert.match(text(items[1]),/高速修复材.*—/);
    assert.equal(text(items[0].children[0]).trim(),'开发资材');
    assert.equal(text(items[1].children[0]).trim(),'高速修复材');
    assert.deepEqual(items[0].children.filter(n=>n?.props?.role==='cell').map(text),['0 ~ 2 /次']);
    assert.deepEqual(items[1].children.filter(n=>n?.props?.role==='cell').map(text),['—']);
    assert.equal(all(tree,n=>n.props['data-tooltip']||n.props.title).length,0);
    assert.equal(all(income,n=>n.props.className==='paa-exp-income-row paa-exp-income-heading')[0].children.filter(Boolean).length,2,'zero chance shows only ordinary success, including item rewards');
    for(const row of all(income,n=>n.props.role==='row'))assert.equal(row.children.filter(Boolean).length,2);
  }
  const variable=view.overview({...props,master:{...master,api_win_item1:[3,1],api_win_item2:[1,3]}});
  assert.deepEqual(all(variable,n=>n.props.className==='paa-exp-item-condition').map(text),['0 ~ 1 /次','—']);
  const unknown=view.overview({...props,master:{...master,api_win_item1:[3,0],api_win_item2:[0,0]}});
  assert.deepEqual(all(unknown,n=>n.props.className==='paa-exp-item-condition').map(text),['待确认']);
  missionProgress.records[42]={state:2,period:'2026-10'};
  assert.match(text(view.overview(props)),/本期已完成/);
  missionProgress.records[42].period='2026-09';assert.match(text(view.overview(props)),/本期待同步/);
  const regular=view.overview({mission:{missionId:1},master:{api_time:15},rate:null,hasShips:false});
  assert.equal(all(regular,n=>n.props.className==='paa-exp-unlock').length,0,'ordinary unlocked missions do not repeat unlock requirements');
  assert.equal(all(regular,n=>n.props.className==='paa-exp-income-table')[0].props['data-columns'],2);
  for(const rate of [null,80,99.999,100]){
    const tree=view.overview({...props,rate}),table=all(tree,n=>n.props.className==='paa-exp-income-table')[0];
    assert.equal(table.props['data-columns'],rate===100?2:3);
    assert.equal(table.props['data-great-available'],rate>0);
    assert.deepEqual(all(table,n=>n.props.className==='paa-exp-item-condition').map(text),rate===100?['0 ~ 2 /次','1 /次']:['0 ~ 2 /次','0 ~ 2 /次','—','1 /次']);
  }
});

test('100 percent great success shows only its net rewards and gross breakdown in trip and hourly views',()=>{
  const React={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()})};
  const view=require('../../src/ui/expedition/expedition_view')(React),all=(n,p)=>!n||typeof n!=='object'?[]:[...(p(n)?[n]:[]),...n.children.flatMap(c=>all(c,p))];
  const text=n=>typeof n==='string'||typeof n==='number'?String(n):(n?.children||[]).map(text).join(' ');
  const income={rows:[{name:'燃料',net:70,greatNet:120,success:100,great:150,cost:30}]};
  for(const incomeUnit of ['trip','hour'])for(const hasItems of [false,true]){
    const props={mission:{missionId:43},master:{api_time:120,...(hasItems?{api_win_item1:[3,2],api_win_item2:[1,1]}:{})},
      rate:100,goal:'success',hasShips:true,income,incomeUnit};
    const tree=view.overview(props),table=all(tree,n=>n.props.className==='paa-exp-income-table')[0];
    assert.deepEqual(all(table,n=>n.props.role==='columnheader').map(n=>text(n).replace(/\s+/g,' ')),['奖励','大成功 100%']);
    assert.equal(all(table,n=>n.props.role==='cell')[0].children[0],incomeUnit==='hour'?'+60':'+120');
    assert.equal(all(table,n=>n.props.role==='cell')[0].children[1].props.className,'paa-exp-value-unit');
    assert.equal(all(table,n=>n.props.role==='cell')[0].children[1].children[0],incomeUnit==='hour'?'/小时':'/次');
    for(const row of all(table,n=>n.props.role==='row'))assert.equal(row.children.filter(Boolean).length,2);
    const details=all(tree,n=>n.props.className==='paa-exp-detail-table')[0];
    assert.deepEqual(details.children[0].children.filter(Boolean).map(text),['资源','大成功毛收益','补给消耗']);
    assert.deepEqual(details.children[1].children.filter(Boolean).map(text),['燃料','150','30']);
    const mixed=view.overview({...props,rate:99.999,goal:'great'}),mixedTable=all(mixed,n=>n.props.className==='paa-exp-income-table')[0];
    assert.deepEqual(all(mixedTable,n=>n.props.role==='columnheader').map(n=>text(n).replace(/\s+/g,' ')),['奖励','成功 0%','大成功 100%']);
    assert.equal(all(mixedTable,n=>n.props.role==='cell')[0].children[0],incomeUnit==='hour'?'+35':'+70');
  }
});

test('only known unlocked monthly expeditions collapse prerequisites and preserve navigation',()=>{
  const React={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()})};
  const view=require('../../src/ui/expedition/expedition_view')(React),all=(n,p)=>!n||typeof n!=='object'?[]:[...(p(n)?[n]:[]),...n.children.flatMap(c=>all(c,p))];
  const calls=[],props={mission:{missionId:43},master:{api_reset_type:1},hasShips:false,onMissionChange:id=>calls.push(id)};
  for(const state of ['listed','completed','running','locked','unknown','expired']){
    const missionProgress={period:'2026-10',records:{},list:{period:state==='expired'?'2026-09':'2026-10',ids:state==='locked'?[]:[43],catalogIds:[42,43]}};
    if(state==='unknown')delete missionProgress.list;
    if(state==='completed')missionProgress.records[43]={state:2,period:'2026-10'};
    const tree=view.overview({...props,missionProgress,fleets:state==='running'?[{api_mission:[1,43]}]:[]});
    const details=all(tree,n=>n.props.className==='paa-exp-unlock-details');
    assert.equal(details.length,['listed','completed','running'].includes(state)?1:0,state);
    if(details.length){assert.equal(details[0].props.open,undefined);assert.equal(details[0].props.key,43);}
    const link=all(tree,n=>n.props['data-mission-id']===42)[0];assert(link,state);link.props.onClick();
  }
  assert.deepEqual(calls,[42,42,42,42,42,42]);
});

test('empty drafts show local base rewards and actual drafts show net income with fleet bonus in top metrics',()=>{
  const React={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()})};
  const view=require('../../src/ui/expedition/expedition_view')(React),all=(n,p)=>!n||typeof n!=='object'?[]:[...(p(n)?[n]:[]),...n.children.flatMap(c=>all(c,p))];
  const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join(' ');
  const props={mission:{missionId:5},master:{api_time:90},rate:null,hasShips:false};
  for(const incomeUnit of ['trip','hour']){
    const tree=view.overview({...props,incomeUnit}),table=all(tree,n=>n.props.role==='table')[0];
    assert.equal(table.props['aria-label'],'远征基础奖励');assert.equal(table.props['data-preview'],true);
    assert.match(text(tree),/基础奖励.*未扣补给 · 未计加成/);
    assert.equal(all(table,n=>n.props.role==='cell')[0].children[0],incomeUnit==='hour'?'+133.3':'+200');
    assert.equal(all(tree,n=>n.props.className==='paa-exp-income-bonus').length,0);
  }
  const income={bonus:.224,rows:[{name:'燃料',net:214,greatNet:336,success:244,great:366,cost:30}]};
  const tree=view.overview({...props,hasShips:true,rate:100,income}),table=all(tree,n=>n.props.role==='table')[0];
  assert.equal(table.props['data-preview'],false);assert.equal(table.props['aria-label'],'扣补给后的远征收益');
  assert.equal(all(table,n=>n.props.role==='cell')[0].children[0],'+336');
  assert.equal(all(tree,n=>n.props.className==='paa-exp-income-bonus').length,0);
  assert(!text(tree).includes('资源已扣补给'));
  const status={count:1,sparkled:1,drums:0,carriers:0};
  assert.match(text(view.metrics({status,income})),/收益提升.*\+22.4%/);
  assert.match(text(view.metrics({status,income:{bonus:0}})),/无收益加成.*\+0%/);
  assert(!text(view.metrics({status})).includes('+0%'));
  assert(!text(view.metrics({status:{...status,count:0},income})).includes('+22.4%'));
  const missing=view.overview({...props,hasShips:true});assert.match(text(missing),/待核算补给/);assert(!text(missing).includes('基础奖励'));
  const unknown=view.overview({...props,mission:{missionId:999}});assert.match(text(unknown),/基础奖励资料不足/);
});

test('compact unmet conditions retain exact deficits without merging alternative ship compositions',()=>{
  const E=require('../../src/ui/expedition/expedition_model');
  const checks=[{type:'drums',sat:false,left:1,right:3},{type:'drumCarriers',sat:false,left:1,right:2},
    {type:'flagshipLevel',sat:false,left:20,right:30},{type:'levelSum',sat:false,left:100,right:120},
    {type:'fleetCompo',sat:false,detail:[{parts:[{estype:'DD',need:3,actual:2},{estype:'CL',need:1,actual:1}]}]},
    {type:'flagshipType',sat:false,right:'CL'},{type:'resupply',sat:false},
    {type:'totalAsw',sat:false,left:180,right:200},{type:'shipCount',sat:true,left:6,right:6}];
  const before=JSON.stringify(checks),messages=E.missingConditions({checks});
  assert.deepEqual(messages,['运输桶差 2 个','载桶舰差 1 艘','旗舰等级差 10 级','舰队总等级差 20 级','缺驱逐 1 艘','旗舰需为轻巡','需要补给','总对潜差 20']);
  assert.deepEqual(E.missingConditions({checks:[{type:'fleetCompo',sat:false,detail:[{parts:[]},{parts:[]}]}]}),['舰种组合不满足']);
  const React={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()})};
  const view=require('../../src/ui/expedition/expedition_view')(React),all=(n,p)=>!n||typeof n!=='object'?[]:[...(p(n)?[n]:[]),...n.children.flatMap(c=>all(c,p))];
  const props={mission:{missionId:5},hasShips:true,expedition:{eligible:false,checks}};
  const tree=view.overview(props),outcome=all(tree,n=>n.props.className==='paa-exp-outcome')[0];
  const shortfalls=all(outcome,n=>n.props.className==='paa-exp-shortfalls')[0];
  assert.equal(outcome.children[1],shortfalls,'collapsed shortfalls follow the disclosure so open state can hide them');
  assert.equal(all(shortfalls,n=>n.props.className==='paa-exp-condition').length,checks.filter(c=>c.sat===false).length);
  assert(all(shortfalls,n=>n.props.className==='paa-exp-condition').every(n=>n.props['data-satisfied']===false));
  const conditions=all(tree,n=>n.props.className==='paa-exp-requirements')[0];
  assert.equal(conditions.type,'details');assert.equal(conditions.props.open,undefined);
  assert.equal(all(conditions,n=>n.props.className==='paa-exp-condition').length,checks.length);
  assert.equal(all(view.overview({...props,expedition:null,hasShips:false}),n=>n.props.className==='paa-exp-shortfalls').length,0);
  const readyTree=view.overview({...props,expedition:{eligible:true,checks:checks.map(c=>({...c,sat:true}))}});
  const ready=all(readyTree,n=>n.props.className==='paa-exp-ready')[0];
  assert.equal(ready.props['data-ready'],true);assert.equal(ready.children[1].children[0],'全部满足');
  const readyIcon=all(ready,n=>n.props.className==='paa-exp-ready-icon')[0],clock=all(readyTree,n=>n.props.className==='paa-exp-duration')[0].children[0];
  for(const key of ['width','height','viewBox','strokeWidth','strokeLinecap','strokeLinejoin'])assert.equal(readyIcon.props[key],clock.props[key],key);
  for(const key of ['cx','cy','r'])assert.equal(all(readyIcon,n=>n.type==='circle')[0].props[key],all(clock,n=>n.type==='circle')[0].props[key],key);
  assert.equal(readyIcon.props.viewBox,'0 0 16 16');assert.equal(readyIcon.props.strokeWidth,1.7);
  assert(all(ready,n=>n.type==='path').some(n=>n.props.d==='m5 8 2 2 4-4'),'ready state uses a check icon');
  assert.equal(all(view.overview({...props,expedition:{eligible:true,checks:checks.map(c=>({...c,sat:true}))}}),n=>n.props.className==='paa-exp-shortfalls').length,0);
  assert.equal(JSON.stringify(checks),before);
});


test('expedition metrics distinguish actual sparkle coverage, both drum gates and real reward bonuses',()=>{
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()})},view=require('../../src/ui/expedition/expedition_view')(React);
  const status={count:6,sparkled:6,drums:4,carriers:3,unknownMorale:false},mission={drums:4,drumCarriers:3};
  const render=(patch={},selected=mission,income={bonus:.224})=>view.metrics({status:{...status,...patch},mission:selected,income});
  const label=metric=>metric.children[0].children[1],tone=metric=>metric.props['data-tone'];
  let metrics=render();assert.deepEqual(metrics.children.map(label),['全队有闪','运输桶达标','收益提升']);assert.deepEqual(metrics.children.map(tone),['green','green','income']);
  assert(metrics.children.every(m=>m.children[0].children[0].type==='svg'));
  assert.equal(label(render({sparkled:4}).children[0]),'部分有闪');assert.equal(tone(render({sparkled:4}).children[0]),'blue');
  assert.equal(label(render({sparkled:0}).children[0]),'全队无闪');assert.equal(tone(render({sparkled:0}).children[0]),'neutral');
  assert.equal(label(render({unknownMorale:true}).children[0]),'士气待确认');
  for(const patch of [{drums:3},{carriers:2}]){const metric=render(patch).children[1];assert.equal(label(metric),'运输桶不足');assert.equal(tone(metric),'warning');}
  assert.equal(label(render({},{}).children[1]),'无需运输桶');assert.equal(tone(render({},{}).children[1]),'green');
  assert.equal(label(render({},null).children[1]),'桶数待核对');
  assert.equal(label(render({drums:undefined}).children[1]),'桶数待核对');assert.equal(render({drums:undefined}).children[1].children[1].children[0],'—');
  assert.equal(label(render({count:0}).children[1]),'桶数待核对');
  assert.equal(label(render({},mission,{bonus:0}).children[2]),'无收益加成');assert.equal(tone(render({},mission,{bonus:0}).children[2]),'neutral');
  assert.equal(label(render({},mission,null).children[2]),'收益待核算');assert.equal(render({count:0}).children[2].children[1].children[0],'—');
});
