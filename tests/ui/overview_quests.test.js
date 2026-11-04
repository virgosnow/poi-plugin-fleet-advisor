'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const create=require('../../src/ui/fleet/overview_quests');
const catalog=require('../../data/quests/requirements.json').quests;
const task=code=>{const q=catalog.find(row=>row.code===code);return {api_no:q.ids[0],api_title:q.title,api_state:2};};
const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()})};
const walk=(node,p)=>!node||typeof node!=='object'?[]:[...(p(node)?[node]:[]),...(node.children||[]).flatMap(child=>walk(child,p))];
const strings=node=>!node||typeof node!=='object'?String(node??''):(node.children||[]).map(strings).join(' ');
function harness(props,options){
  const states=[];let index=0,tree;
  const react={...React,useState(initial){const i=index++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;
    return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];}};
  const Component=create(react,options),render=()=>{index=0;tree=Component(props);return tree;};
  render();return {render,find:p=>walk(tree,p)[0],all:p=>walk(tree,p)};
}

test('overview task goals navigate separately without changing game state',()=>{
  const Component=create(React),calls=[],state={questState:{known:true,tasks:[task('B131'),task('Dw2')]}};
  const before=JSON.stringify(state),ui=harness({state,onNavigate:destination=>calls.push(destination)}),tree=ui.render();
  const buttons=walk(tree,node=>node.type==='button'&&node.props.className==='paa-overview-quest-target');
  buttons.find(node=>strings(node).includes('7-2')).props.onClick();
  ui.find(node=>node.type==='button'&&strings(node).startsWith('远征')).props.onClick();ui.render();
  ui.all(node=>node.type==='button'&&node.props.className==='paa-overview-quest-target').find(node=>strings(node).includes('38号远征')).props.onClick();
  assert.deepEqual(calls.map(({kind,area,phase,missionId,code})=>({kind,area,phase,missionId,code})),[
    {kind:'normal',area:'7-2',phase:'gauge2',missionId:undefined,code:'B131'},
    {kind:'expedition',area:undefined,phase:undefined,missionId:38,code:'Dw2'}]);
  assert.equal(JSON.stringify(state),before);
  const disabled=Component({state,disabled:true,onNavigate:()=>{throw Error('disabled');}});
  assert(walk(disabled,node=>node.type==='button').every(node=>node.props.disabled));
});

test('overview shows active tasks, progress hints and helpful empty states',()=>{
  const Component=create(React),active={...task('B131'),api_progress_flag:1};
  const tree=Component({state:{questState:{known:true,tasks:[active,{...task('Dw2'),api_state:1}]}}});
  const content=strings(tree);
  assert.match(content,/进行中的任务/);assert(!content.includes('点击目标'));assert.match(content,/进度 50% 以上/);
  assert.equal(walk(tree,node=>node.type==='article').length,1);
  assert.match(strings(Component({state:{questState:{known:true,tasks:[]}}})),/暂无进行中的出击任务/);
  assert.match(strings(Component({state:{}})),/任务资料正在后台同步/);
});

test('goal progress is read-only and rewards use the game data',()=>{
  const state={questState:{known:true,tasks:[{...task('Bd7'),api_get_material:[300,0,0,200],api_select_rewards:[[{api_kind:12,api_mst_id:35,api_count:2}]]}]},const:{$equips:{35:{api_name:'测试装备'}}}};
  const service={getQuestGoalProgress:()=>1};
  const Component=create(React,{getController:()=>service});
  const tree=Component({state});
  assert.equal(walk(tree,node=>node.type==='input').length,0);
  assert(walk(tree,node=>node.children?.includes('至少 1/5')).length);
  assert(walk(tree,node=>node.props['aria-label']==='燃料 300').length);
  assert(walk(tree,node=>node.props['aria-label']==='铝土 200').length);
  assert(walk(tree,node=>node.type==='span'&&node.children?.join('').includes('测试装备 ×2')).length);
});

test('overview batches progress reads and is memoized when React supports it',()=>{
  let memo=0,batches=0,individual=0;
  const ReactWithMemo={...React,memo:component=>{memo++;return component;}};
  const state={questState:{known:true,tasks:[task('B131'),task('Dw2')]}};
  const service={getQuestGoalProgressForTasks:tasks=>{batches++;return new Map(tasks.flatMap(task=>task.goals.map(goal=>[`${task.id}:${goal.key}`,1])));},
    getQuestGoalProgress:()=>{individual++;return 0;}};
  const Component=create(ReactWithMemo,{getController:()=>service}),tree=Component({state});
  assert.equal(memo,1);assert.equal(batches,1);assert.equal(individual,0);
  assert(walk(tree,node=>node.props.className==='paa-overview-goal-status'&&node.props['data-complete']&&node.children.includes('✓ 1/1')).length);
});

test('goal progress distinguishes unknown, observed lower bounds and completed counts',()=>{
  let observed;
  const Component=create(React,{getController:()=>({getQuestGoalProgress:()=>observed})});
  const state={questState:{known:true,tasks:[task('Bd7')]}};
  const status=()=>walk(Component({state}),node=>node.props.className==='paa-overview-goal-status')[0];
  assert.equal(status().children[0],'进度未确认');assert.equal(status().props['data-complete'],false);
  observed=0;assert.equal(status().children[0],'进度未确认');
  observed=2;assert.equal(status().children[0],'至少 2/5');assert.equal(status().props['data-complete'],false);
  assert.equal(status().props['aria-label'],'已观察目标进度至少 2/5');
  observed=5;assert.equal(status().children[0],'✓ 5/5');assert.equal(status().props['data-complete'],true);
  observed=9;assert.equal(status().children[0],'✓ 5/5');assert.equal(observed,9);
});

test('D39 game progress verifies its sole 30 expedition goal without inventing counts for other tasks',()=>{
  let observed=0;
  const state={questState:{known:true,tasks:[{...task('D39'),api_progress_flag:1},
    {...task('D7'),api_progress_flag:1},{...task('Dy7'),api_progress_flag:1}]}};
  const ui=harness({state},{getController:()=>({getQuestGoalProgress:()=>observed})});
  ui.find(node=>node.type==='button'&&strings(node).startsWith('远征')).props.onClick();ui.render();
  const article=id=>ui.find(node=>node.type==='article'&&node.props['data-quest-id']===id);
  const status=node=>walk(node,n=>n.props.className==='paa-overview-goal-status');
  const exact=status(article(443))[0];
  assert.equal(exact.children[0],'1/2');assert.equal(exact.props['data-progress-source'],'game');
  assert.equal(exact.props['aria-label'],'目标进度 1/2，依据游戏任务进度');
  assert(status(article(408)).every(row=>row.children[0]==='进度未确认'),
    'other tasks cannot infer objective counts from a coarse flag');
  assert(status(article(442)).every(row=>row.children[0]==='进度未确认'),
    'a multi-objective marker cannot identify which expedition was completed');
  observed=2;ui.render();assert.equal(status(article(443))[0].children[0],'✓ 2/2',
    'a newer observed completion is not overwritten by a stale 50% marker');
  state.questState.tasks[0].api_progress_flag=0;observed=0;ui.render();
  assert.equal(status(article(443))[0].children[0],'进度未确认');
});

test('reward details expand in place while category switching retains the selected task and exact rewards',()=>{
  const sortie={...task('Bd7'),api_get_material:[300,0,0,200],api_select_rewards:[[{api_kind:12,api_mst_id:35,api_count:2}]]};
  const state={questState:{known:true,tasks:[sortie,task('Dw2')]},const:{$equips:{35:{api_name:'测试装备'}}}};
  const ui=harness({state});const tab=label=>ui.find(n=>n.type==='button'&&strings(n).startsWith(label));
  assert.equal(tab('出击').props['aria-pressed'],true);assert.equal(ui.all(n=>n.type==='article').length,1);
  const toggle=ui.find(n=>n.props.className==='paa-overview-reward-toggle');assert(toggle);assert.equal(toggle.props['aria-expanded'],false);
  toggle.props.onClick();ui.render();assert.equal(ui.find(n=>n.props.className==='paa-overview-reward-toggle').props['aria-expanded'],true);
  const details=ui.find(n=>n.props.className==='paa-overview-reward-details');assert.match(strings(details),/任选其一/);assert.match(strings(details),/测试装备/);
  tab('远征').props.onClick();ui.render();assert.equal(tab('远征').props['aria-pressed'],true);assert.match(strings(ui.find(n=>n.type==='article')),/远征/);
  tab('出击').props.onClick();ui.render();assert.equal(ui.find(n=>n.props.className==='paa-overview-reward-toggle').props['aria-expanded'],true);
});

test('task module defaults by container width and remembers manual choices independently',()=>{
  let index=0,tree,onResize,cleanup;const states=[];
  const container={clientWidth:812,ownerDocument:{defaultView:{getComputedStyle:()=>({paddingLeft:'16px',paddingRight:'16px'}),
    ResizeObserver:class{constructor(cb){onResize=cb;}observe(){}disconnect(){}}}}};
  const react={...React,useState(initial){const i=index++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;
    return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},
    useRef(initial){const i=index++;return states[i]||(states[i]={current:initial});},
    useLayoutEffect(fn){if(!cleanup)cleanup=fn;},useEffect(){}};
  const state={questState:{known:true,tasks:[task('B131'),task('Dw2')]}};
  const Component=create(react),render=()=>{index=0;tree=Component({state});tree.props.ref.current={closest:()=>container};return tree;};
  const button=()=>walk(tree,n=>n.props.className==='paa-overview-quests-toggle')[0];
  const content=()=>walk(tree,n=>n.props.id==='paa-overview-tasks-content')[0];
  render();const dispose=cleanup();render();assert.equal(button().props['aria-expanded'],false);assert.equal(content().props.inert,'');
  button().props.onClick();render();assert.equal(button().props['aria-expanded'],true);assert.equal(content().props.inert,undefined);
  container.clientWidth=1000;onResize();render();assert.equal(button().props['aria-expanded'],true,'wide defaults open');
  button().props.onClick();render();assert.equal(button().props['aria-expanded'],false);
  container.clientWidth=812;onResize();render();assert.equal(button().props['aria-expanded'],true,'narrow manual choice remains');
  container.clientWidth=1000;onResize();render();assert.equal(button().props['aria-expanded'],false,'wide manual choice remains');
  dispose();
});
