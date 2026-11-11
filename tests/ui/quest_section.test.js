'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const create=require('../../src/ui/components/quest_section');

function harness(props,result,options={}){
  const hooks=[],calls=[],countCalls=[];let cursor=0,tree;
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),
    useRef(initial){const index=cursor++;return hooks[index]||(hooks[index]={current:initial});},
    useState(initial){const index=cursor++;if(!(index in hooks))hooks[index]=initial;return [hooks[index],value=>{hooks[index]=typeof value==='function'?value(hooks[index]):value;}];},
    useMemo(compute,deps){const index=cursor++,cached=hooks[index];if(!cached||deps.some((value,i)=>!Object.is(value,cached.deps[i])))hooks[index]={value:compute(),deps};return hooks[index].value;}};
  const Component=create(React,{listRelatedQuests:input=>{calls.push(input);return typeof result==='function'?result(input):result;},
    countRelatedQuests:input=>{countCalls.push(input);return typeof result==='function'||result.status!=='ready'?{status:'unknown',count:null}:
      {status:'ready',count:result.tasks.filter(task=>[1,2,3].includes(Number(task.state))).length};},...options});
  const walk=(node,match)=>!node||typeof node!=='object'?[]:[...(match(node)?[node]:[]),...node.children.flatMap(child=>walk(child,match))];
  const render=()=>{cursor=0;tree=Component(props);return tree;};
  const find=match=>walk(tree,match)[0];
  const content=node=>node===null||node===undefined||node===false?'':typeof node==='object'?node.children.map(content).join(''):String(node);
  render();
  return {calls,countCalls,render,find,all:match=>walk(tree,match),text:()=>content(tree),
    toggle(open){find(node=>node.type==='details').props.onToggle({currentTarget:{open}});render();}};
}
function task(overrides={}){
  return {id:1001,code:'B141',title:'「夕張改二」試してみてもいいかしら？',state:2,period:'季常',status:'met',
    checks:[{label:'夕张改二系旗舰',status:'met'},{label:'六水战驱逐舰',status:'met',actual:3,required:3}],
    goals:[{label:'1-5 Boss S胜 1 回'}],...overrides};
}

test('known objectives are localized while game task title and unknown objective stay verbatim',()=>{
  const {setLocale}=require('../../src/shared/i18n');
  try{
    setLocale('ja-JP');
    const ui=harness({defaultOpen:true},{status:'ready',tasks:[task({title:'任意远征',
      goals:[{kind:'bossWin',map:'1-5',rankMin:'S',label:'1-5 Boss S胜 1次'}, {label:'本周演习A胜以上 4次'}],
      checks:[{label:'旗舰：雪風 ≥1艘',status:'met'}]})]});
    assert.match(ui.text(),/任意远征/);
    assert.match(ui.text(),/1-5 ボス S勝利 1回/);
    assert.match(ui.text(),/本周演习A胜以上 4次/);
    assert.match(ui.text(),/旗艦：雪風 ≥1隻/);
  }finally{setLocale('zh-CN');}
});

test('quest cards toggle selection by click and keyboard without a separate button',()=>{
  const selected=[];
  const props={selectedQuests:selected,onToggleQuest:code=>{const at=selected.indexOf(code);if(at<0)selected.push(code);else selected.splice(at,1);}};
  const ui=harness(props,{status:'ready',tasks:[task(),task({id:1002,code:'B142',title:'第二任务'})]});ui.toggle(true);
  const article=()=>ui.find(n=>n.props['data-quest-id']===1001);
  article().props.onClick({button:0,target:{closest:()=>null},currentTarget:{ownerDocument:{getSelection:()=>({isCollapsed:true})}}});ui.render();
  assert.deepEqual(selected,['B141']);assert.equal(article().props['data-selected'],true);
  assert.equal(article().props.role,'checkbox');assert.equal(article().props['aria-checked'],true);
  assert(!ui.find(n=>n.type==='button'&&n.props.className==='paa-quest-select'));
  let prevented=false;article().props.onKeyDown({key:' ',repeat:false,preventDefault(){prevented=true;}});ui.render();
  assert(prevented);assert.deepEqual(selected,[]);assert.equal(ui.find(n=>n.type==='details').props.open,true);
  props.disabled=true;ui.render();assert.equal(article().props['aria-disabled'],true);assert.equal(article().props.tabIndex,-1);
  article().props.onKeyDown({key:'Enter',repeat:false,preventDefault(){}});assert.deepEqual(selected,[]);
});

test('read-only related tasks use the same cards without selection or invented fleet checks',()=>{
  let selected=0;
  const props={kind:'practice',readOnly:true,onToggleQuest:()=>selected++};
  const ui=harness(props,{status:'ready',tasks:[task({checks:[{label:'不应显示的要求',status:'met'}],goals:[{label:'演習で勝利'}]})]});
  ui.toggle(true);
  const card=ui.find(n=>n.type==='article');
  assert(card);assert.equal(card.props.role,undefined);assert.equal(card.props.onClick,undefined);assert.equal(card.props.onKeyDown,undefined);
  assert.equal(card.props.style.cursor,'default');
  assert.match(ui.text(),/演習で勝利/);assert.match(ui.text(),/进行中/);
  assert.doesNotMatch(ui.text(),/编成条件|不应显示的要求|补全时/);assert.equal(selected,0);
});

test('all related-task pages display observed resources and fixed/selectable rewards',()=>{
  const definition=require('../../data/quests/requirements.json').quests.find(q=>q.code==='B27');
  const id=definition.ids[0],live={api_no:id,api_category:2,api_title:definition.title,api_state:2,
    api_get_material:[300,0,100,0],api_select_rewards:[[{api_kind:12,api_mst_id:35,api_count:2}]]};
  const state={questState:{known:true,tasks:[live]},const:{$equips:{35:{api_name:'测试选项'},103:{api_name:'测试固定装备'}}}};
  for(const kind of ['normal','expedition','practice']){
    const ui=harness({kind,state,defaultOpen:true},{status:'ready',tasks:[task({id,code:'B27',title:definition.title})]});
    assert(ui.find(n=>n.props['aria-label']==='燃料 300'),kind);assert(ui.find(n=>n.props['aria-label']==='钢材 100'),kind);
    assert.match(ui.text(),/测试固定装备/);assert.match(ui.text(),/固定报酬/);assert.doesNotMatch(ui.text(),/固定报酬 · 参考/);
    assert.match(ui.text(),/测试选项/);assert.match(ui.text(),/任选其一/);
    assert.doesNotMatch(ui.text(),/任选其一 · 参考/,kind+' uses game-provided choices');
    const card=ui.find(n=>n.type==='article'),order=card.children.map(child=>child?.props?.className);
    assert(order.indexOf('paa-quest-requirements')<order.indexOf('paa-quest-goals'),kind+' presents fleet conditions first');
    assert(order.indexOf('paa-quest-goals')<order.indexOf('paa-overview-rewards'),kind+' presents rewards last');
  }
});

test('task rewards stay visible without a disclosure before and after task selection',()=>{
  const selected=[],definition=require('../../data/quests/requirements.json').quests.find(q=>q.code==='B27'),id=definition.ids[0];
  const live={api_no:id,api_category:2,api_title:definition.title,api_state:2,api_get_material:[0,0,0,0],
    api_select_rewards:[[{api_kind:13,api_mst_id:3,api_count:2}]]};
  const state={questState:{known:true,tasks:[live]}};
  const ui=harness({kind:'normal',state,defaultOpen:true,onToggleQuest:code=>selected.push(code)},
    {status:'ready',tasks:[task({id,code:'B27',title:definition.title})]});
  const card=()=>ui.find(n=>n.type==='article');
  assert.equal(ui.find(n=>n.props.className==='paa-overview-reward-toggle'),undefined);
  assert.match(ui.text(),/开发资材/);
  card().props.onKeyDown({key:'Enter',repeat:false,preventDefault(){}});ui.render();
  assert.deepEqual(selected,['B27']);assert.match(ui.text(),/开发资材/);
});

test('each map objective shows its own observed progress and navigates independently',()=>{
  const visits=[],selected=[];
  const goal={kind:'bossWin',map:'1-5',rankMin:'S',key:'goal-one',count:3,label:'1-5 Boss S胜 3次',relatedToCurrent:true};
  const ui=harness({kind:'normal',defaultOpen:true,onNavigateQuest:x=>visits.push(x),onToggleQuest:x=>selected.push(x)},
    {status:'ready',tasks:[task({fleetRequirements:['旗舰：夕張改二 ≥1艘'],goals:[goal]})]},
    {getController:()=>({getQuestGoalProgressForTasks:()=>new Map([['1001:goal-one',1]])})});
  const card=ui.find(n=>n.type==='article'),order=card.children.map(n=>n?.props?.className);
  assert(order.indexOf('paa-quest-requirements')<order.indexOf('paa-quest-goals'));
  assert(order.indexOf('paa-quest-goals')<order.indexOf('paa-overview-rewards'));
  assert.equal(ui.find(n=>n.props.className==='paa-quest-goal-progress').children[0],'≥1 / 3');
  ui.find(n=>n.props.className==='paa-quest-goal-link').props.onClick();
  assert.equal(visits[0].area,'1-5');assert.equal(visits[0].code,'B141');assert.deepEqual(selected,[]);
});

test('choice labels stay concise even for locally sourced reward groups',()=>{
  const rewards={resources:[],fixed:[],choices:[[{name:'装备甲',count:1}],[{name:'装备乙',count:1}]],reference:true,choicesFromGame:false};
  const ui=harness({kind:'normal',defaultOpen:true},{status:'ready',tasks:[task({rewards})]});
  const labels=ui.all(n=>n.props.className==='paa-overview-reward-choice').map(n=>n.children[0].children[0]);
  assert.deepEqual(labels,['任选其一 1','任选其一 2']);
});

test('missing and zero resource data stay distinct in related task rewards',()=>{
  for(const [data,expected] of [[undefined,'资源报酬待同步'],[[0,0,0,0],'无资源报酬']]){
    const live={api_no:1001,api_state:2,...(data?{api_get_material:data}:{})};
    const ui=harness({kind:'normal',state:{questState:{known:true,tasks:[live]}},defaultOpen:true},{status:'ready',tasks:[task()]});
    assert.match(ui.text(),new RegExp(expected));
  }
});

test('confirmed resource-only rewards omit the unknown-other-rewards message',()=>{
  for(const kind of ['normal','expedition','practice']){
    const known={resources:[{name:'燃料',amount:100}],fixed:[],choices:[],reference:true,shipBonus:false};
    const ui=harness({kind,defaultOpen:true},{status:'ready',tasks:[task({rewards:known})]});
    assert(ui.find(n=>n.props['aria-label']==='燃料 100'));
    assert.doesNotMatch(ui.text(),/其他报酬以游戏为准/,kind);
    assert.equal(ui.find(n=>n.props.className==='paa-overview-reward-details'),undefined);
    const unknown=harness({kind,defaultOpen:true},{status:'ready',tasks:[task({rewards:{...known,reference:false}})]});
    assert.match(unknown.text(),/其他报酬以游戏为准/,kind);
  }
});

test('controlled disclosure restores its externally saved open state',()=>{
  const props={kind:'practice',readOnly:true,open:false,onOpenChange:value=>{props.open=value;}};
  const ui=harness(props,{status:'ready',tasks:[task()]});
  assert.equal(ui.find(n=>n.type==='details').props.open,false);
  props.open=true;ui.render();assert.equal(ui.find(n=>n.type==='details').props.open,true);
  ui.toggle(false);assert.equal(props.open,false);assert.equal(ui.find(n=>n.type==='details').props.open,false);
});

test('an injected task list and disclosure state are used by read-only pages',()=>{
  const opened=[],inputs=[];
  const ui=harness({kind:'practice',readOnly:true,onOpenChange:value=>opened.push(value),listTasks:input=>{
    inputs.push(input);return {status:'ready',tasks:[task({goals:[{label:'演習で勝利'}]})]};
  }},{status:'unknown',tasks:[]});
  assert.equal(inputs.length,0);ui.toggle(true);assert.equal(inputs.length,1);assert.deepEqual(opened,[true]);
  assert.match(ui.text(),/演習で勝利/);assert.equal(ui.calls.length,0);
});
function cardClicks(ui){
  let forwarded=0,selection={isCollapsed:true};
  const root={ownerDocument:{getSelection:()=>selection},closest:()=>null,
    querySelector:selector=>{assert.equal(selector,':scope > details > summary');return summary;}};
  const dispatch=(target=root,options={})=>ui.find(n=>n.props.className==='paa-quest-section').props.onClick({
    target,currentTarget:root,button:0,defaultPrevented:false,
    preventDefault(){assert.fail('Native summary behavior must not be prevented');},...options});
  const summary={closest:()=>summary,click(){
    forwarded++;ui.toggle(!ui.find(n=>n.type==='details').props.open);
    dispatch(summary); // Native click bubbles once through the parent card.
  }};
  const content={closest:()=>content};
  return {dispatch,summary,content,get forwarded(){return forwarded;},
    select(){selection={isCollapsed:false};},clearSelection(){selection={isCollapsed:true};}};
}

test('the whole card whitespace toggles once while preserving native summary activation',()=>{
  const ui=harness({}, {status:'ready',tasks:[task()]}),clicks=cardClicks(ui);
  const summary=ui.find(n=>n.type==='summary');
  assert.equal(summary.props.onClick,undefined);assert.equal(summary.props.onKeyDown,undefined);
  clicks.dispatch();assert.equal(clicks.forwarded,1);assert.equal(ui.find(n=>n.type==='details').props.open,true);
  clicks.dispatch();assert.equal(clicks.forwarded,2);assert.equal(ui.find(n=>n.type==='details').props.open,false);
  clicks.dispatch(clicks.summary);assert.equal(clicks.forwarded,2,'A summary click must not be forwarded a second time');
  assert.equal(ui.calls.length,1);
});

test('reading, scrolling and selecting content never collapses populated or empty task sections',()=>{
  for(const result of [{status:'ready',tasks:[task()]},{status:'ready',tasks:[]},{status:'unknown',tasks:[]}]){
    const ui=harness({},result),clicks=cardClicks(ui);ui.toggle(true);
    clicks.dispatch(clicks.content);
    clicks.dispatch({nodeType:3,parentElement:clicks.content});
    clicks.select();clicks.dispatch();
    assert.equal(clicks.forwarded,0);assert.equal(ui.find(n=>n.type==='details').props.open,true);
    clicks.clearSelection();clicks.dispatch();
    assert.equal(clicks.forwarded,1);assert.equal(ui.find(n=>n.type==='details').props.open,false);
  }
});

test('cancelled or secondary pointer clicks on card whitespace do not toggle it',()=>{
  const ui=harness({}, {status:'ready',tasks:[]}),clicks=cardClicks(ui);
  clicks.dispatch(undefined,{defaultPrevented:true});clicks.dispatch(undefined,{button:1});clicks.dispatch(undefined,{button:2});
  assert.equal(clicks.forwarded,0);assert.equal(ui.find(n=>n.type==='details').props.open,false);
  assert.equal(ui.calls.length,0);
});

test('related tasks show their lightweight count while folded and perform no fleet evaluation until opened',()=>{
  const props={state:{ships:{}},slots:[],deckId:1,kind:'normal',mapId:'1-5',questState:{status:'ready'}};
  const ui=harness(props,{status:'ready',tasks:[task()]});
  assert.equal(ui.find(n=>n.type==='details').props.open,false);
  assert.equal(ui.text(),'相关任务1 件');assert.equal(ui.calls.length,0);assert.equal(ui.countCalls.length,1);
  props.mapId='2-5';ui.render();assert.equal(ui.calls.length,0);assert.equal(ui.countCalls.length,2);
  ui.toggle(true);assert.equal(ui.calls.length,1);
  assert.equal(ui.calls[0].mapId,'2-5');assert.equal(ui.calls[0].slots,props.slots);
  assert.match(ui.text(),/相关任务1 件/);
  ui.render();assert.equal(ui.calls.length,1,'unrelated rerenders reuse the current evaluation');
  ui.toggle(false);props.slots=[{id:5,slots:[18],ex:-1}];ui.render();assert.equal(ui.calls.length,1);assert.equal(ui.countCalls.length,2,'equipment changes do not recompute the task count');
  const folded=ui.find(n=>n.props.className==='paa-quest-content');
  assert.equal(folded.props['aria-hidden'],true);assert.equal(folded.props.inert,'');
  assert(ui.find(n=>n.props['data-quest-id']===1001),'keep the last body during its closing transition without re-evaluation');
  ui.toggle(true);assert.equal(ui.calls.length,2);assert.equal(ui.calls[1].slots,props.slots);
});

test('normal selected tasks show only compact names when folded and keep original order when expanded',()=>{
  const selected=['B142'],props={kind:'normal',selectedQuests:selected,slots:[],onToggleQuest:code=>{
    const at=selected.indexOf(code);if(at<0)selected.push(code);else selected.splice(at,1);},onClearQuests:()=>selected.splice(0)};
  const ui=harness(props,{status:'ready',tasks:[task(),task({id:1002,code:'B142',title:'第二任务'}),task({id:1003,code:'B143',title:'第三任务'})]});
  const compact=()=>ui.find(n=>n.props.className==='paa-quest-content paa-quest-selected-compact');
  assert.equal(ui.find(n=>n.type==='details').props.open,false);assert.equal(ui.calls.length,1);
  assert.match(ui.text(),/3 件 · 预选 1/);
  assert.deepEqual(compact().children[0].children.map(n=>n.children.at(-1)),['第二任务']);
  assert.equal(compact().children[0].children[0].children[0].children[0],'B142 ');
  assert.equal(ui.find(n=>n.props.id===ui.find(n=>n.type==='summary').props['aria-controls']).props.hidden,true);
  ui.toggle(true);assert(!compact());
  assert.match(ui.text(),/预选 1 项，补全时同时满足编成要求/);
  assert.deepEqual(ui.all(n=>n.type==='article').map(n=>n.props['data-quest-id']),[1001,1002,1003]);
  assert.equal(ui.find(n=>n.props['data-quest-id']===1002).props['aria-checked'],true);
  assert.equal(ui.all(n=>n.props['data-quest-id']===1002).length,1);
  ui.find(n=>n.props['data-quest-id']===1001).props.onKeyDown({key:'Enter',repeat:false,preventDefault(){}});ui.render();
  ui.toggle(false);assert.deepEqual(compact().children[0].children.map(n=>n.children.at(-1)),['「夕張改二」試してみてもいいかしら？','第二任务']);
  ui.toggle(true);ui.find(n=>n.type==='button'&&n.children.includes('清除选择')).props.onClick();ui.render();
  assert.deepEqual(selected,[]);assert(!compact());
});

test('expedition selected tasks retain their existing folded behavior',()=>{
  const selected=['B141'],props={kind:'expedition',selectedQuests:selected,slots:[],onToggleQuest:code=>selected.splice(selected.indexOf(code),1),onClearQuests:()=>selected.splice(0)};
  const ui=harness(props,{status:'ready',tasks:[task(),task({id:1002,code:'B142',title:'其他任务'})]});
  const card=()=>ui.find(n=>n.props['data-quest-id']===1001);
  assert.equal(ui.find(n=>n.type==='details').props.open,false);assert.equal(ui.calls.length,1);
  assert(card());assert.equal(card().props['aria-checked'],true);
  ui.toggle(true);assert.equal(ui.all(n=>n.props['data-quest-id']===1001).length,1);assert(ui.find(n=>n.props['data-quest-id']===1002));
  ui.toggle(false);card().props.onKeyDown({key:'Enter',repeat:false,preventDefault(){}});ui.render();
  assert.deepEqual(selected,[]);assert(!ui.find(n=>n.props.className==='paa-quest-content paa-quest-selected'));
});

test('all related task lists put ongoing tasks first without moving selected available tasks ahead',()=>{
  for(const kind of ['normal','expedition','practice']){
    const rows=[task({id:101,code:'A',state:1}),task({id:102,code:'B',state:'2'}),
      task({id:103,code:'C',state:1}),task({id:104,code:'D',state:2})];
    const ui=harness({kind,selectedQuests:['A'],onToggleQuest(){}},{status:'ready',tasks:rows});
    ui.toggle(true);
    assert.deepEqual(ui.all(n=>n.type==='article').map(n=>n.props['data-quest-id']),[102,104,101,103],kind);
    assert.deepEqual(rows.map(row=>row.id),[101,102,103,104],'do not mutate source order');
    assert.equal(ui.find(n=>n.props['data-quest-id']===101).props['aria-checked'],true);
    assert.equal(ui.all(n=>n.props.className==='paa-quest-state'&&n.props['data-active']).length,2);
    ui.toggle(false);assert(ui.text().includes('预选')||ui.find(n=>n.props['data-quest-id']===101));
  }
});

test('task cards show the observed progress at the upper right and keep achieved tasks preselected',()=>{
  for(const kind of ['normal','expedition','practice']){
    const rows=[task({id:101,code:'A',state:2,progressFlag:0}),task({id:102,code:'B',state:2,progressFlag:1}),
      task({id:103,code:'C',state:2,progressFlag:2}),task({id:104,code:'D',state:3}),task({id:105,code:'E',state:2})];
    const ui=harness({kind,selectedQuests:['D'],onToggleQuest(){}},{status:'ready',tasks:rows});ui.toggle(true);
    const card=id=>ui.find(n=>n.props['data-quest-id']===id);
    const value=id=>card(id).children.find(n=>n?.props?.className==='paa-quest-header')?.children
      .find(n=>n?.props?.className==='paa-quest-meta')?.children.find(n=>n?.props?.className==='paa-quest-progress')?.children[0];
    assert.equal(value(101),'进度未满 50%');assert.equal(value(102),'进度 50% 以上');
    assert.equal(value(103),'进度 80% 以上');assert.equal(value(104),'已达成');assert.equal(value(105),'进度未确认');
    assert.equal(card(104).props['aria-checked'],true);assert.equal(ui.all(n=>n.type==='article')[0].props['data-quest-id'],104);
  }
});

test('opened tasks re-evaluate the current ships, equipment, destination and quest state',()=>{
  const props={state:{ships:{}},slots:[{id:1,slots:[10],ex:-1}],deckId:1,mapId:'1-5',questState:{status:'ready'}};
  const ui=harness(props,input=>({status:'ready',tasks:[task({status:input.slots[0].slots[0]===11?'met':'unmet'})]}));
  ui.toggle(true);assert.match(ui.text(),/编成条件未满足/);
  props.slots=[{id:1,slots:[11],ex:-1}];ui.render();assert.match(ui.text(),/编成条件满足/);
  props.state={ships:{1:{api_lv:90}}};ui.render();
  props.deckId=2;ui.render();props.mapId='2-5';ui.render();
  props.questState={status:'ready',revision:2};ui.render();
  assert.equal(ui.calls.length,6);
  assert.equal(ui.calls.at(-1).questState,props.questState);
});

test('expedition quests receive the mission and target fleet without a separate UI model',()=>{
  const props={state:{},slots:[],deckId:3,kind:'expedition',missionId:30,questState:{status:'ready'}};
  const ui=harness(props,{status:'ready',tasks:[task({id:700,code:'D7',title:'潜水艦派遣作戦',state:1,period:'once',
    status:'unknown',checks:[{label:'潜水舰 4 艘',status:'unknown'}],goals:[{label:'远征 30 成功 2 回'}]})]});
  ui.toggle(true);
  assert.equal(ui.calls[0].missionId,30);assert.equal(ui.calls[0].deckId,3);assert.equal(ui.calls[0].kind,'expedition');
  assert.match(ui.text(),/单次可受领/);assert.match(ui.text(),/远征 30 成功 2 回/);assert.match(ui.text(),/编成条件待确认/);
});

test('accepted, completed and available tasks render, and fleet checks remain visible',()=>{
  const ui=harness({slots:[]},{status:'ready',tasks:[task(),task({id:1002,state:1,title:'可受领任务'}),
    task({id:1003,state:3,title:'完成待领奖'}),task({id:1004,state:0,title:'未解锁任务'})]});
  ui.toggle(true);
  assert.equal(ui.all(n=>n.type==='article').length,3);
  assert.match(ui.text(),/「夕張改二」試してみてもいいかしら？/);
  assert.match(ui.text(),/目标1-5 Boss S胜 1 回/);
  assert.match(ui.text(),/编成条件满足/);assert.match(ui.text(),/完成待领奖/);assert.doesNotMatch(ui.text(),/任务可完成|未解锁任务/);
  assert.equal(ui.all(n=>n.props['data-status']==='met').length,9);
});

test('known empty results and unsynchronized quest lists have different neutral messages',()=>{
  const unknown=harness({}, {status:'unknown',tasks:[]});unknown.toggle(true);
  assert.match(unknown.text(),/任务资料正在后台同步/);
  assert.doesNotMatch(unknown.text(),/暂无/);
  const empty=harness({}, {status:'ready',tasks:[task({state:0})]});empty.toggle(true);
  assert.match(empty.text(),/暂无可受领或进行中的相关任务/);
  assert.doesNotMatch(empty.text(),/请在游戏中/);
});

test('partial task observations are not presented as a confirmed empty list',()=>{
  const ui=harness({questState:{known:true,complete:false,tasks:[]}},{status:'ready',tasks:[]});
  ui.toggle(true);assert.match(ui.text(),/任务资料正在后台同步/);assert.doesNotMatch(ui.text(),/暂无可受领/);
});
test('partial task rows stay visible but cannot drive a preselection before refresh',()=>{
  let picked=null;const ui=harness({questState:{known:true,complete:false},onToggleQuest:value=>{picked=value;}},{status:'ready',tasks:[task()]});
  ui.toggle(true);assert.match(ui.text(),/后台核实完整列表/);
  const card=ui.find(node=>node.type==='article');assert.equal(card.props['aria-disabled'],true);
  card.props.onClick({target:{closest:()=>null},currentTarget:{}});assert.equal(picked,null);
});

test('zero counts, unmet checks and genuinely unknown checks remain distinct',()=>{
  const ui=harness({}, {status:'ready',tasks:[task({status:'unmet',checks:[
    {label:'驱逐舰',status:'unmet',actual:0,required:3},
    {label:'第二舰资料',status:'unknown'},
    {label:'潜水舰',status:'met',actual:0,required:0}],goals:[{label:'1-6 抵达终点 1 回'}]})]});
  ui.toggle(true);
  assert.match(ui.text(),/0 \/ 3/);assert.match(ui.text(),/0 \/ 0/);
  assert(ui.find(n=>n.props['aria-label']==='当前 0\n要求 3'));
  const zero=ui.find(n=>n.props['aria-label']==='当前 0\n要求 0');assert(zero);assert.equal(zero.props['data-tooltip'],undefined);
  assert.equal(ui.all(n=>n.type==='li'&&n.props['data-status']==='unknown').length,1);
  assert.equal(ui.all(n=>n.type==='li'&&n.props['data-status']==='unmet').length,1);
  assert.match(ui.text(),/编成条件未满足/);assert.match(ui.text(),/1-6 抵达终点 1 回/);
});

test('missing objective information is not hidden behind a satisfied fleet result',()=>{
  const ui=harness({}, {status:'ready',tasks:[task({checks:[],goals:[],summary:'无额外舰种限制'})]});ui.toggle(true);
  assert.match(ui.text(),/目标条件待确认/);assert.match(ui.text(),/无额外舰种限制/);assert.match(ui.text(),/编成条件满足/);
});

test('unrestricted task goals are not repeated as a second description',()=>{
  const goal='任意远征成功 3 次';
  const ui=harness({}, {status:'ready',tasks:[task({checks:[],goals:[{label:goal}],summary:goal})]});
  ui.toggle(true);assert.equal(ui.text().split(goal).length-1,1);
});

test('other map goals remain visible and are visually muted',()=>{
  const ui=harness({}, {status:'ready',tasks:[task({checks:[],goals:[
    {map:'1-2',label:'1-2 Boss S胜 1次',relatedToCurrent:true},{map:'1-5',label:'1-5 Boss S胜 1次',relatedToCurrent:false},
    {map:'2-2',label:'2-2 Boss S胜 1次',relatedToCurrent:false}],summary:'1-2 Boss S胜 1次；1-5 Boss S胜 1次；2-2 Boss S胜 1次'})]});
  ui.toggle(true);const goals=ui.find(n=>n.props['aria-label']==='任务行动目标');
  assert.deepEqual(goals.children.map(row=>row.props['data-related']),['true','false']);
  assert.match(ui.text(),/1-2 Boss S胜 1次/);assert.match(ui.text(),/其他：1-5、2-2 Boss S胜 1次/);
  assert(!ui.find(n=>n.props.className==='paa-quest-requirement-summary'));
});

test('compact other goals retain different requirements and mapless labels',()=>{
  const ui=harness({}, {status:'ready',tasks:[task({checks:[],goals:[
    {map:'1-5',label:'1-5 Boss S胜 1次',relatedToCurrent:false},
    {map:'2-2',label:'2-2 Boss A胜以上 2次',relatedToCurrent:false},
    {label:'完成额外条件',relatedToCurrent:false},
    {map:'1-2',label:'1-2 Boss S胜 1次',relatedToCurrent:true},
    {map:'2-3',label:'2-3 Boss S胜 1次',relatedToCurrent:false}]})]});
  ui.toggle(true);const goals=ui.find(n=>n.props['aria-label']==='任务行动目标');
  assert.deepEqual(goals.children.map(row=>row.props['data-related']),['true','false','false','false']);
  assert.match(ui.text(),/其他：1-5、2-3 Boss S胜 1次/);
  assert.match(ui.text(),/2-2 Boss A胜以上 2次/);assert.match(ui.text(),/完成额外条件/);
});

test('goals remain separate and condition results stay beside the task metadata in both pages',()=>{
  for(const kind of ['normal','expedition']){
    const ui=harness({kind},{status:'ready',tasks:[task({goals:[{label:'Boss S胜 1 回'},{label:'Boss S胜 1 回'},{label:'到达时保持指定编成'}]})]});
    ui.toggle(true);
    const goals=ui.find(n=>n.props['aria-label']==='任务行动目标');assert.equal(goals.type,'ul');assert.equal(goals.children.length,2);
    const meta=ui.find(n=>n.props.className==='paa-quest-meta');assert(meta.children.some(n=>n?.props?.className==='paa-quest-condition-status'));
    assert.equal(ui.all(n=>n.props.className==='paa-quest-condition-status').length,1,'do not repeat fleet status below every task');
    assert.equal(ui.find(n=>n.props.className==='paa-quest-requirements').children[0].children[0],'编成');
    const row=ui.find(n=>n.type==='li'&&n.props['data-status']==='met'&&n.children.some(c=>c?.props?.className==='paa-quest-check-value'));
    assert.equal(row.children[2].children[0],'3 / 3');assert.equal(row.children[2].props['aria-label'],'当前 3\n要求 3');
  }
});

test('practice uses the same compact preselection and card hierarchy as normal maps',()=>{
 const selected=['P368'],items=[task({id:368,code:'P368',title:'十六驱演习',goals:[{label:'本日演习 S胜 3次'}]})];
 const props={kind:'practice',selectedQuests:selected,slots:[],listTasks:()=>({status:'ready',tasks:items}),countTasks:()=>({status:'ready',count:1}),onToggleQuest:()=>selected.splice(0),onClearQuests:()=>selected.splice(0)};
 const ui=harness(props,{status:'ready',tasks:[]});assert.match(ui.text(),/1 件 · 预选 1/);
 assert(ui.find(n=>n.props.className==='paa-quest-content paa-quest-selected-compact'));
 ui.toggle(true);const card=ui.find(n=>n.props['data-quest-id']===368);assert.equal(card.props['aria-checked'],true);
 const heading=ui.find(n=>n.props.className==='paa-quest-meta'),title=ui.find(n=>n.props.className==='paa-quest-heading');assert(heading&&title);
 card.props.onKeyDown({key:'Enter',repeat:false,preventDefault(){}});ui.render();assert.deepEqual(selected,[]);
});
