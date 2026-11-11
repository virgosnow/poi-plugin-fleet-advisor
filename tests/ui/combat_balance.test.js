'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const render=require('../../src/ui/components/combat_balance');
const {compare}=require('../../src/domain/combat/combat_balance');
const h=(type,props,...children)=>({type,props:props||{},children:children.flat()});
const text=node=>node==null?'':typeof node==='object'?(node.children||[]).map(text).join(''):String(node);
test('ready route uses a red blue comparison with the requested label',()=>{
  const v=render(h,{status:'ready',balance:compare(2,1),reasons:['对潜已计入']});
  assert.equal(v.props['data-tier'],'明显优势');assert.equal(v.props['data-tooltip'],undefined);
  const track=v.children[1];assert.equal(track.children[0].props.className,'paa-balance-blue');
  assert.equal(track.children[0].props.style.width,`${2/3*100}%`);
});
test('missing and partial inputs preserve an outline without implying a balance',()=>{
  for(const input of [null,{status:'partial'},{status:'ready',balance:{label:'势均力敌',blueShare:NaN}}]){
    const v=render(h,input);assert.equal(v.props.className,'paa-balance-pending');assert.equal(v.props.role,'status');
    assert.deepEqual([v.children[0].children[0].children[0],v.children[0].children[2].children[0]],['我方','敌方']);
    assert.equal(v.children[1].props.className,'paa-balance-track');assert.equal(v.children[1].props['data-pending'],true);
    assert.equal(v.children[1].props['aria-hidden'],true);assert.equal(v.children[1].children.length,0);
  }
});
test('bounded scenario reference keeps the accessible description without a hover tooltip',()=>{
  const v=render(h,{status:'estimated',balance:compare(2,1),reasons:['连续战损参考']});
  assert.equal(v.props['data-tier'],'明显优势');
  assert.equal(v.props['data-tooltip'],undefined);
  assert.match(v.props['aria-label'],/不代表胜率或通过率/);
});
test('each tier displays its icon and colored text without changing the comparison',()=>{
  for(const label of ['压倒性优势','明显优势','势均力敌','明显劣势','压倒性劣势']){
    const value={status:'estimated',balance:{label,blueShare:.4},reasons:['假设中间搭载']};
    const view=render(h,value),badge=render.renderTier(h,value);
    assert.equal(badge.props.className,'paa-balance-tier');
    assert.equal(badge.props['data-tier'],label);assert.equal(badge.props['data-tooltip'],undefined);
    assert.equal(badge.children[0].type,'svg');
    assert.equal(badge.children[0].props['aria-hidden'],true);
    assert(badge.children[0].children.every(child=>child.type==='path'));
    assert.equal(badge.children[1],label);
    assert.match(badge.props['aria-label'],new RegExp(label));
    assert.match(view.props['aria-label'],new RegExp(label));
    assert.deepEqual(view.children[0].children.map(child=>child.children[0]),['我方','敌方']);
    assert.equal(view.children[1].children[0].props.style.width,'40%');
  }
});
test('header does not retain a stale tier when the assessment is absent, pending or invalid',()=>{
  for(const input of [null,{status:'unselected'},{status:'empty'},{status:'pending'},
    {status:'unknown'},{status:'unreachable'}, {status:'estimated',balance:{label:'势均力敌',blueShare:NaN}}]){
    assert.equal(render.renderTier(h,input),null);
  }
});
test('balance animations honor reduced motion and track remains compact',()=>{
  const styles=require('../../src/ui/workbench/workbench_styles');
  assert.match(styles,/\.paa-balance-pending\{height:31px/);
  assert.match(styles,/\.paa-balance-labels\{[^}]*height:18px/);
  assert.match(styles,/\.paa-balance-track\{height:9px/);
  for(const [label,color] of Object.entries({'压倒性优势':'var(--paa-good)','明显优势':'var(--paa-accent)','明显劣势':'#ce934c','压倒性劣势':'var(--paa-bad)'}))
    assert(styles.includes(`.paa-balance-tier[data-tier=${label}]{--paa-balance-tone:${color}}`));
  assert(styles.indexOf('.bp5-dark .paa-balance-tier,.bp6-dark .paa-balance-tier')<styles.indexOf('.paa-balance-tier[data-tier=压倒性优势]'));
  assert.match(styles,/@media\(prefers-reduced-motion:reduce\)\{\.paa-balance-blue,\.paa-balance-divider\{transition:none\}\}/);
});
test('unreachable fleet displays its route status above the outline',()=>{
  const v=render(h,{status:'unreachable'});
  assert.equal(v.props.className,'paa-balance-pending');assert.equal(v.children[0].children[1].children[0],'当前编成无法沿此路线到达');
});
test('pending comparison has no hover tooltip',()=>{
  const v=render(h,{status:'unknown',reasons:['敌方对潜资料不足']});
  assert.equal(v.props.className,'paa-balance-pending');
  assert.equal(v.props['data-tooltip'],undefined);assert.equal(v.props.tabIndex,undefined);
});

test('per-node details distinguish simulated losses and unvisited or air raid nodes',()=>{
  const v=render.renderDetails(h,{diagnostics:{nodes:[
    {id:'A',visits:32,ownHpLoss:.125,enemyHpLoss:.4,severe:3,supplyBefore:{fuel:1,ammo:1}},
    {id:'B',kind:'aerialRaid',visits:29,ownHpLoss:.01,enemyHpLoss:null,severe:1,supplyBefore:{fuel:.8,ammo:.8}},
    {id:'C',visits:0,ownHpLoss:null,enemyHpLoss:null,severe:0,supplyBefore:{fuel:null,ammo:.76}},
    {id:'D',visits:1,ownHpLoss:0,enemyHpLoss:0,severe:0,supplyBefore:{fuel:1,ammo:.8}},
    {id:'E',visits:1,ownHpLoss:0,enemyHpLoss:0,severe:0,supplyBefore:{fuel:.9999,ammo:1}} ]}});
  const body=v.children[1].children[1];
  const cellText=cell=>cell.children[0]?.props?.['aria-label']??cell.children[0]?.children?.[0]??cell.children[0];
  assert.deepEqual(body.children.map(row=>row.children.map(cellText)),[
    ['A 点','满 / 满','12.5%','40.0%','3 / 32'],['B 点','80% / 80%','1.0%','—','1 / 29'],['C 点','— / 76%','—','—','—'],
    ['D 点','满 / 80%','0.0%','0.0%','0 / 1'],['E 点','100% / 满','0.0%','0.0%','0 / 1']]);
  assert.match(text(v.children[0]),/并非实际概率/);
  assert.match(text(v.children[0]),/我方油弹按满补给与参考分支估算/);
  assert.match(text(v.children[0]),/逐点损失为各舰新增损伤占最大耐久的平均/);
  assert.equal(v.children[1].children[0].children[0].children[4].children[0],'我方大破');
  const styles=require('../../src/ui/workbench/workbench_styles');
  assert.match(styles,/\.paa-balance-details table\{[^}]*table-layout:fixed/);
  assert.match(styles,/\.paa-balance-details :is\(th,td\)\{[^}]*text-align:center/);
  assert.match(styles,/\.paa-balance-details \.paa-balance-ratio\{[^}]*grid-template-columns:minmax\(0,1fr\) auto minmax\(0,1fr\)/);
  assert.match(styles,/\.paa-balance-details td\.paa-balance-percent>span\{[^}]*text-align:right/);
  assert.match(styles,/\.paa-balance-details thead\{border-bottom:1px solid/);
  assert.match(styles,/\.paa-balance-details tbody tr\+tr\{border-top:1px solid/);
  assert.match(styles,/\.paa-balance-details\{[^}]*overflow-x:auto/);
});

test('a newly selected stage prompts for explicit completion instead of claiming to be calculating',()=>{
  const v=render(h,{status:'awaitingCompletion'});
  assert.equal(v.props.className,'paa-balance-pending');assert.equal(v.children[0].children[1].children[0],'一键补全后计算');
});

test('route details state why the target is not reached without calling scene counts a probability',()=>{
  const v=render.renderDetails(h,{diagnostics:{journeys:{samples:32,completed:0,stoppedBeforeTarget:32},nodes:[]}});
  assert.match(text(v.children[0]),/道中我方大破32 \/ 32/);
  assert.match(text(v.children[0]),/从当前耐久计算/);
  assert.match(text(v.children[0]),/并非实际概率/);
});

test('target victory details distinguish post-battle repairs from en-route retreat',()=>{
  const v=render.renderDetails(h,{diagnostics:{journeys:{samples:32,completed:32,stoppedBeforeTarget:0},
    target:{id:'C',visits:32,sVictories:32,severe:32,includeNight:true,flagshipDamage:.4},nodes:[]}});
  assert.match(text(v.children[0]),/道中我方大破0 \/ 32/);
  assert.match(text(v.children[0]),/目标点 S 胜32 \/ 32（含夜战）/);
  assert.match(text(v.children[0]),/目标点敌方旗舰平均损伤 40%/);
  assert.match(text(v.children[0]),/目标战后我方大破仅计损耗/);
});

test('target result is not presented as an S failure when no scenario reached it',()=>{
  const v=render.renderDetails(h,{diagnostics:{journeys:{samples:32,stoppedBeforeTarget:32},
    target:{id:'C',visits:0,sVictories:0},nodes:[]}});
  assert.match(text(v.children[0]),/均未抵达，无法评价战果/);
});
test('the node table distinguishes weighted branches from incomplete route probabilities',()=>{
  const view=branchUncertain=>render.renderDetails(h,{diagnostics:{representativePath:['A','C'],branchUncertain,nodes:[]}});
  assert.match(text(view(false).children[0]),/总评价按所选分支概率加权/);
  assert.match(text(view(true).children[0]),/分支概率不完整.*A→C/);
});
