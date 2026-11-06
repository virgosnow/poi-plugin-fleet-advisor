'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/workbench_fixture');

test('level 99 remains selectable manually as a training target and fleet member',()=>{
  const store=fixture(),states=[];let i=0,applied=0;store.info.ships[1].api_lv=99;store.info.ships[1].api_locked=1;
  store.practiceState={known:true,opponents:[],revision:1};store.questState={known:true,tasks:[]};
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),useEffect:()=>{},useRef:value=>({current:value}),
    useState(initial){const at=i++;if(!(at in states))states[at]=typeof initial==='function'?initial():initial;return [states[at],value=>{states[at]=typeof value==='function'?value(states[at]):value;}];}};
  const Page=require('../../src/ui/practice/practice_page')(React,{getStore:()=>store,getController:()=>({preview:()=>({valid:true})})});
  const render=()=>{i=0;return Page({kind:'practice',automaticOperations:true,onApply:()=>{applied++;}});};
  const walk=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(walk)]:[];
  let tree=render();walk(tree).find(n=>n.props.className==='paa-practice-training-trigger').props.onClick();tree=render();
  const training=walk(tree).find(n=>n.props.className==='paa-practice-training-option'&&n.props.key===1);
  const checkbox=walk(training).find(n=>n.type==='input');assert.equal(checkbox.props.disabled,false);checkbox.props.onChange();tree=render();
  assert(walk(tree).find(n=>n.props.className==='paa-practice-training-option'&&n.props.key===1).props['data-selected']);
  walk(tree).find(n=>n.props.className==='paa-practice-training-trigger').props.onClick();tree=render();
  walk(tree).find(n=>n.props.className==='paa-wb-empty').props.onClick();tree=render();
  const popup=walk(tree).find(n=>n.props['aria-label']==='替换舰娘'),row=walk(popup).find(n=>n.type==='button'&&n.props.key===1);
  assert.equal(row.props.disabled,false);row.props.onClick();tree=render();assert.equal(states[0][0].id,1);
  const apply=walk(tree).find(n=>n.props.className==='paa-primary paa-wb-apply');assert.equal(apply.props.disabled,false);
  apply.props.onClick({});assert.equal(applied,1);
});

test('practice portrait hints follow the expanded state for the whole card row',()=>{
  const store=fixture(),states=[];let i=0;
  store.practiceState={known:true,opponents:[],revision:1};store.questState={known:true,tasks:[]};
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),useEffect:()=>{},useRef:value=>({current:value}),
    useState(initial){const at=i++;if(!(at in states))states[at]=typeof initial==='function'?initial():initial;return [states[at],value=>{states[at]=typeof value==='function'?value(states[at]):value;}];}};
  const Page=require('../../src/ui/practice/practice_page')(React,{getStore:()=>store,getController:()=>({preview:()=>({})})});
  const render=()=>{i=0;return Page({kind:'practice',automaticOperations:false});};
  const walk=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(walk)]:[];
  const portrait=(tree,id)=>walk(tree).find(n=>n.props['aria-controls']===`paa-practice-stats-${id}`);
  const model=require('../../src/ui/workbench/workbench_model');states[0]=[model.entry(store,1),model.entry(store,2),null,null,null,null];
  const grid={children:[1,2].map(id=>({dataset:{shipId:String(id)},classList:{contains:()=>true},querySelector:()=>true,getBoundingClientRect:()=>({top:100})}))};
  grid.children.forEach(card=>card.parentElement=grid);const event={currentTarget:{closest:()=>grid.children[0]}};
  let tree=render();assert.equal(portrait(tree,1).props['data-tooltip'],'查看属性');
  portrait(tree,1).props.onClick(event);tree=render();assert.equal(portrait(tree,1).props['data-tooltip'],undefined);assert.equal(portrait(tree,2).props['data-tooltip'],undefined);
  portrait(tree,1).props.onClick(event);tree=render();assert.equal(portrait(tree,1).props['data-tooltip'],'查看属性');assert.equal(portrait(tree,2).props['data-tooltip'],'查看属性');
});

test('practice uses the shared picker and remembers the lock filter until cleared',()=>{
  const store=fixture(),states=[];let i=0;
  store.info.fleets.forEach((fleet,index)=>{fleet.api_ship=[[1,2],[3],[7],[8]][index];});
  Object.values(store.info.ships).forEach(ship=>{ship.api_locked=ship.api_id===7?0:1;});
  store.practiceState={known:true,opponents:[],revision:1};store.questState={known:true,tasks:[]};
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),useEffect:()=>{},useRef:value=>({current:value}),
    useState(initial){const at=i++;if(!(at in states))states[at]=typeof initial==='function'?initial():initial;return [states[at],value=>{states[at]=typeof value==='function'?value(states[at]):value;}];}};
  const Page=require('../../src/ui/practice/practice_page')(React,{getStore:()=>store,getController:()=>({preview:()=>({})})});
  const render=()=>{i=0;return Page({kind:'practice',automaticOperations:false});};
  const walk=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(walk)]:[];
  const text=node=>typeof node==='string'?node:(node?.children||[]).map(text).join('');
  const find=(tree,predicate)=>walk(tree).find(predicate);
  let tree=render();find(tree,n=>n.props.className==='paa-wb-empty').props.onClick();tree=render();
  let dialog=find(tree,n=>n.props['aria-label']==='替换舰娘');assert(dialog);
  let lock=find(dialog,n=>n.props['aria-label']==='锁定筛选');
  assert.equal(find(lock,n=>n.type==='button'&&text(n)==='已锁定').props['aria-pressed'],true);
  assert(find(dialog,n=>n.props['aria-label']==='舰种筛选'));
  assert.equal(find(dialog,n=>n.props['aria-label']==='排序方式').props.value,'level-desc');
  find(lock,n=>n.type==='button'&&text(n)==='未锁定').props.onClick();tree=render();
  dialog=find(tree,n=>n.props['aria-label']==='替换舰娘');
  let list=find(dialog,n=>n.props.className==='paa-wb-popup-list');
  const candidates=walk(list).filter(n=>n.type==='button');assert.equal(candidates.length,1);assert.match(text(candidates[0]),/测试舰7/);
  candidates[0].props.onClick();tree=render();assert.equal(states[0][0].id,7);
  find(tree,n=>n.props.className==='paa-wb-replace').props.onClick();tree=render();
  dialog=find(tree,n=>n.props['aria-label']==='替换舰娘');lock=find(dialog,n=>n.props['aria-label']==='锁定筛选');
  assert.equal(find(lock,n=>n.type==='button'&&text(n)==='未锁定').props['aria-pressed'],true);
  const type=find(dialog,n=>n.props['aria-label']==='舰种筛选');
  assert.equal(find(type,n=>n.type==='button'&&text(n).startsWith('同舰种')).props['aria-pressed'],true);
  find(dialog,n=>n.type==='button'&&text(n)==='关闭').props.onClick();tree=render();
  find(tree,n=>n.type==='button'&&text(n)==='一键清空').props.onClick();tree=render();
  find(tree,n=>n.props.className==='paa-wb-empty').props.onClick();tree=render();
  lock=find(tree,n=>n.props['aria-label']==='锁定筛选');
  assert.equal(find(lock,n=>n.type==='button'&&text(n)==='已锁定').props['aria-pressed'],true);
  assert.deepEqual(store.info.fleets.map(f=>f.api_ship),[[1,2],[3],[7],[8]],'draft edits do not operate on game fleets');
});

test('practice equipment picker shares filtering, sorting, counts and preserves draft-only selection',()=>{
  const store=fixture(),states=[];let i=0;
  store.practiceState={known:true,opponents:[],revision:1};store.questState={known:true,tasks:[]};
  store.const.$shipTypes[3]={api_equip_type:{6:1,12:1}};
  for(let n=0;n<105;n++){
    store.const.$equips[1000+n]={api_id:1000+n,api_name:`飞机${n}`,api_type:[0,0,6,6],api_tyku:n};
    store.info.equips[1000+n]={api_id:1000+n,api_slotitem_id:1000+n};
  }
  store.info.equips[9000]={api_id:9000,api_slotitem_id:1000};
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),useEffect:()=>{},useRef:value=>({current:value}),
    useState(initial){const at=i++;if(!(at in states))states[at]=typeof initial==='function'?initial():initial;return [states[at],value=>{states[at]=typeof value==='function'?value(states[at]):value;}];}};
  const Page=require('../../src/ui/practice/practice_page')(React,{getStore:()=>store,getController:()=>({preview:()=>({})})});
  const render=()=>{i=0;return Page({kind:'practice',automaticOperations:false});};
  const walk=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(walk)]:[];
  const find=(tree,predicate)=>walk(tree).find(predicate),text=node=>typeof node==='string'?node:(node?.children||[]).map(text).join('');
  states[0]=[require('../../src/ui/workbench/workbench_model').entry(store,1),null,null,null,null,null];
  let tree=render();find(tree,n=>n.props.className==='paa-wb-gear').props.onClick();tree=render();
  let dialog=find(tree,n=>n.props['aria-label']==='替换装备');assert(dialog);
  assert(find(dialog,n=>n.props['aria-label']==='装备大类'));assert(find(dialog,n=>n.props['aria-label']==='装备细类'));
  let list=find(dialog,n=>n.props.className==='paa-wb-popup-list');assert.equal(list.children.filter(n=>n?.type==='button').length,105);
  assert.match(text(list),/可用 2/);
  const priorities=find(dialog,n=>n.props['aria-label']==='优先属性选项');
  find(priorities,n=>n.type==='button'&&text(n)==='对空').props.onClick({currentTarget:{closest:()=>({})}});tree=render();
  dialog=find(tree,n=>n.props['aria-label']==='替换装备');list=find(dialog,n=>n.props.className==='paa-wb-popup-list');
  assert.match(text(list.children[0]),/飞机104/);assert.match(text(list.children[0]),/对空 104/);
  list.children[0].props.onClick();assert.equal(states[0][0].slots[0],1104);assert.equal(store.info.ships[1].api_slot[0],-1);
  tree=render();find(tree,n=>n.props.className==='paa-wb-gear').props.onClick();tree=render();
  dialog=find(tree,n=>n.props['aria-label']==='替换装备');assert(find(dialog,n=>n.props['aria-current']==='true'));
  find(dialog,n=>n.type==='button'&&text(n)==='清空此槽').props.onClick();assert.equal(states[0][0].slots[0],-1);
});
