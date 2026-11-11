'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const i18n=require('../../src/shared/i18n');
const render=require('../../src/ui/components/combat_balance');
const {compare}=require('../../src/domain/combat/combat_balance');
const h=(type,props,...children)=>({type,props:props||{},children:children.flat()});
const text=node=>node==null?'':typeof node==='string'||typeof node==='number'?String(node):
  typeof node==='object'?(node.children||[]).map(text).join(''):'';

test('battle tier translation does not change the rank, source label or color identifier',()=>{
  const assessment={status:'ready',balance:compare(2,1)},before=JSON.stringify(assessment);
  try{
    i18n.setLocale('ja-JP');let tier=render.renderTier(h,assessment),bar=render(h,assessment);
    assert.equal(tier.props['data-tier'],'明显优势');assert.equal(tier.children[1],'優勢');
    assert.match(bar.props['aria-label'],/勝率や通過率ではありません/);
    assert.equal(bar.children[1].children[0].props.style.width,`${2/3*100}%`);
    i18n.setLocale('zh-TW');tier=render.renderTier(h,assessment);
    assert.equal(tier.props['data-tier'],'明显优势');assert.equal(tier.children[1],'明顯優勢');
    assert.equal(JSON.stringify(assessment),before);
  }finally{i18n.setLocale('zh-CN');}
});

test('battle details translate uncertainty and retain exact counts and resource values',()=>{
  const assessment={diagnostics:{journeys:{samples:32,stoppedBeforeTarget:5},
    target:{visits:27,sVictories:15,includeNight:true,flagshipDamage:.4},
    representativePath:['B','D'],branchUncertain:true,
    supplyEstimates:[{strongChance:true,assumedBaseRate:true}],
    nodes:[{id:'B',visits:32,ownHpLoss:.125,enemyHpLoss:.4,severe:5,supplyBefore:{fuel:1,ammo:.8}}]}};
  const before=JSON.stringify(assessment);
  try{
    i18n.setLocale('ja-JP');const ja=text(render.renderDetails(h,assessment));
    for(const value of ['32','5','27','15','40%','12.5%','80%','10%','30%','B→D'])assert(ja.includes(value),value);
    assert.match(ja,/実際の確率ではありません/);assert.match(ja,/夜戦を含む/);
    assert.match(ja,/目標マス敵旗艦の平均損傷 40%/);assert.match(ja,/道中の味方大破/);assert.match(ja,/目標戦後の味方大破/);
    i18n.setLocale('zh-TW');const tw=text(render.renderDetails(h,assessment));
    assert.match(tw,/並非實際機率/);assert.match(tw,/含夜戰/);assert.match(tw,/5 \/ 32/);
    assert.match(tw,/目標點敵方旗艦平均損傷 40%/);assert.match(tw,/道中我方大破/);assert.match(tw,/目標戰後我方大破/);
    assert.equal(JSON.stringify(assessment),before);
  }finally{i18n.setLocale('zh-CN');}
});

test('fleet destination localizes its fallback label but preserves provided labels and values',()=>{
  let index=0;const states=[];
  const React={createElement:h,useEffect(){},useRef(value){const i=index++;return states[i]||(states[i]={current:value});},
    useState(value){const i=index++;if(!(i in states))states[i]=typeof value==='function'?value():value;return [states[i],next=>{states[i]=typeof next==='function'?next(states[i]):next;}];}};
  const Picker=require('../../src/ui/components/fleet_target_picker')(React),calls=[];
  try{
    i18n.setLocale('ja-JP');index=0;let view=Picker({value:2,options:[],onChange:value=>calls.push(value)});
    assert.equal(view.children[1].children[0].props['aria-label'],'編入先艦隊');
    assert.equal(view.children[1].children[0].children[0].children[0],'第2艦隊');
    index=0;view=Picker({value:2,options:[{value:2,label:'ユーザー名'}],onChange:value=>calls.push(value)});
    assert.equal(view.children[1].children[0].children[0].children[0],'ユーザー名');
    assert.deepEqual(calls,[]);
  }finally{i18n.setLocale('zh-CN');}
});
