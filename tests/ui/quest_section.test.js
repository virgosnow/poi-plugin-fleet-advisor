'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const create=require('../../src/ui/components/quest_section');

function harness(props,result){
  const hooks=[],calls=[];let cursor=0,tree;
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),
    useRef(initial){const index=cursor++;return hooks[index]||(hooks[index]={current:initial});},
    useState(initial){const index=cursor++;if(!(index in hooks))hooks[index]=initial;return [hooks[index],value=>{hooks[index]=value;}];},
    useMemo(compute,deps){const index=cursor++,cached=hooks[index];if(!cached||deps.some((value,i)=>!Object.is(value,cached.deps[i])))hooks[index]={value:compute(),deps};return hooks[index].value;}};
  const Component=create(React,{listRelatedQuests:input=>{calls.push(input);return typeof result==='function'?result(input):result;}});
  const walk=(node,match)=>!node||typeof node!=='object'?[]:[...(match(node)?[node]:[]),...node.children.flatMap(child=>walk(child,match))];
  const render=()=>{cursor=0;tree=Component(props);return tree;};
  const find=match=>walk(tree,match)[0];
  const content=node=>node===null||node===undefined||node===false?'':typeof node==='object'?node.children.map(content).join(''):String(node);
  render();
  return {calls,render,find,all:match=>walk(tree,match),text:()=>content(tree),
    toggle(open){find(node=>node.type==='details').props.onToggle({currentTarget:{open}});render();}};
}
function task(overrides={}){
  return {id:1001,code:'B141',title:'「夕張改二」試してみてもいいかしら？',state:2,period:'季常',status:'met',
    checks:[{label:'夕张改二系旗舰',status:'met'},{label:'六水战驱逐舰',status:'met',actual:3,required:3}],
    goals:[{label:'1-5 Boss S胜 1 回'}],...overrides};
}
function cardClicks(ui){
  let forwarded=0,selection={isCollapsed:true};
  const root={ownerDocument:{getSelection:()=>selection},closest:()=>null,
    querySelector:selector=>{assert.equal(selector,':scope > summary');return summary;}};
  const dispatch=(target=root,options={})=>ui.find(n=>n.type==='details').props.onClick({
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

test('related tasks stay folded and perform no evaluation until opened',()=>{
  const props={state:{ships:{}},slots:[],deckId:1,kind:'normal',mapId:'1-5',questState:{status:'ready'}};
  const ui=harness(props,{status:'ready',tasks:[task()]});
  assert.equal(ui.find(n=>n.type==='details').props.open,false);
  assert.equal(ui.text(),'相关任务');assert.equal(ui.calls.length,0);
  props.mapId='2-5';ui.render();assert.equal(ui.calls.length,0);
  ui.toggle(true);assert.equal(ui.calls.length,1);
  assert.equal(ui.calls[0].mapId,'2-5');assert.equal(ui.calls[0].slots,props.slots);
  assert.match(ui.text(),/相关任务1 项/);
  ui.render();assert.equal(ui.calls.length,1,'unrelated rerenders reuse the current evaluation');
  ui.toggle(false);props.slots=[{id:5,slots:[18],ex:-1}];ui.render();assert.equal(ui.calls.length,1);
  const folded=ui.find(n=>n.props.className==='paa-quest-content');
  assert.equal(folded.props['aria-hidden'],true);assert.equal(folded.props.inert,'');
  assert(ui.find(n=>n.props['data-quest-id']===1001),'keep the last body during its closing transition without re-evaluation');
  ui.toggle(true);assert.equal(ui.calls.length,2);assert.equal(ui.calls[1].slots,props.slots);
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

test('only accepted or available tasks render, and outcome requirements remain visible when fleet checks pass',()=>{
  const ui=harness({slots:[]},{status:'ready',tasks:[task(),task({id:1002,state:1,title:'可受领任务'}),
    task({id:1003,state:3,title:'完成待领奖'}),task({id:1004,state:0,title:'未解锁任务'})]});
  ui.toggle(true);
  assert.equal(ui.all(n=>n.type==='article').length,2);
  assert.match(ui.text(),/「夕張改二」試してみてもいいかしら？/);
  assert.match(ui.text(),/目标1-5 Boss S胜 1 回/);
  assert.match(ui.text(),/编成条件满足/);assert.doesNotMatch(ui.text(),/任务可完成|完成待领奖|未解锁任务/);
  assert.equal(ui.all(n=>n.props['data-status']==='met').length,6);
});

test('known empty results and unsynchronized quest lists have different neutral messages',()=>{
  const unknown=harness({}, {status:'unknown',tasks:[]});unknown.toggle(true);
  assert.match(unknown.text(),/请在游戏中打开任务列表以同步/);
  assert.doesNotMatch(unknown.text(),/暂无/);
  const empty=harness({}, {status:'ready',tasks:[task({state:3})]});empty.toggle(true);
  assert.match(empty.text(),/暂无可受领或进行中的相关任务/);
  assert.doesNotMatch(empty.text(),/请在游戏中/);
});

test('zero counts, unmet checks and genuinely unknown checks remain distinct',()=>{
  const ui=harness({}, {status:'ready',tasks:[task({status:'unmet',checks:[
    {label:'驱逐舰',status:'unmet',actual:0,required:3},
    {label:'第二舰资料',status:'unknown'},
    {label:'潜水舰',status:'met',actual:0,required:0}],goals:[{label:'1-6 抵达终点 1 回'}]})]});
  ui.toggle(true);
  assert.match(ui.text(),/0 \/ 3/);assert.match(ui.text(),/0 \/ 0/);
  assert(ui.find(n=>n.props['aria-label']==='当前 0\n要求 3'));
  assert(ui.find(n=>n.props['data-tooltip']==='当前 0\n要求 0'));
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
  assert.deepEqual(goals.children.map(row=>row.props['data-related']),['true','false']);
  assert.match(ui.text(),/其他：1-5、2-3 Boss S胜 1次；2-2 Boss A胜以上 2次；完成额外条件/);
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
