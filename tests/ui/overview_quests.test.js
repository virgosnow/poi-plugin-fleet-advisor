'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const create=require('../../src/ui/fleet/overview_quests');
const catalog=require('../../data/quests/requirements.json').quests;
const task=code=>{const q=catalog.find(row=>row.code===code);return {api_no:q.ids[0],api_title:q.title,api_state:2};};
const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()})};
const walk=(node,p)=>!node||typeof node!=='object'?[]:[...(p(node)?[node]:[]),...(node.children||[]).flatMap(child=>walk(child,p))];

test('overview task goals navigate separately without changing game state',()=>{
  const Component=create(React),calls=[],state={questState:{known:true,tasks:[task('B131'),task('Dw2')]}};
  const before=JSON.stringify(state),tree=Component({state,onNavigate:destination=>calls.push(destination)});
  const buttons=walk(tree,node=>node.type==='button'&&node.props.className==='paa-overview-quest-target');
  buttons.find(node=>node.children[0].includes('7-2')).props.onClick();
  buttons.find(node=>node.children[0]==='38号远征').props.onClick();
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
  const strings=node=>!node||typeof node!=='object'?String(node??''):(node.children||[]).map(strings).join(' ');
  const content=strings(tree);
  assert.match(content,/进行中的任务/);assert.match(content,/点击目标/);assert.match(content,/进度 50% 以上/);
  assert.equal(walk(tree,node=>node.type==='article').length,1);
  assert.match(strings(Component({state:{questState:{known:true,tasks:[]}}})),/暂无进行中的出击与远征任务/);
  assert.match(strings(Component({state:{}})),/打开任务列表以同步/);
});

test('goal progress is read-only and rewards use the game data',()=>{
  const state={questState:{known:true,tasks:[{...task('Bd7'),api_get_material:[300,0,0,200],api_select_rewards:[[{api_kind:12,api_mst_id:35,api_count:2}]]}]},const:{$equips:{35:{api_name:'测试装备'}}}};
  const service={getQuestGoalProgress:()=>1};
  const Component=create(React,{getController:()=>service});
  const tree=Component({state});
  assert.equal(walk(tree,node=>node.type==='input').length,0);
  assert(walk(tree,node=>node.children?.includes('1/5')).length);
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
  assert(walk(tree,node=>node.props.className==='paa-overview-goal-status'&&node.props['data-complete']&&node.children.includes('1/1')).length);
});

test('goal progress shows zero, observed and completed counts without changing stored values',()=>{
  let observed;
  const Component=create(React,{getController:()=>({getQuestGoalProgress:()=>observed})});
  const state={questState:{known:true,tasks:[task('Bd7')]}};
  const status=()=>walk(Component({state}),node=>node.props.className==='paa-overview-goal-status')[0];
  assert.equal(status().children[0],'0/5');assert.equal(status().props['data-complete'],false);
  observed=2;assert.equal(status().children[0],'2/5');assert.equal(status().props['data-complete'],false);
  observed=5;assert.equal(status().children[0],'5/5');assert.equal(status().props['data-complete'],true);
  observed=9;assert.equal(status().children[0],'5/5');assert.equal(observed,9);
});
