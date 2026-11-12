'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/workbench_fixture'),W=require('../../src/ui/workbench/workbench_model');

test('training list scrolling is isolated while changed fleet and equipment still revalidate',()=>{
  const store=fixture();store.practiceState={known:true,opponents:[],revision:1};store.questState={known:true,tasks:[]};
  const template=store.info.ships[1];for(let id=9;id<=110;id++)store.info.ships[id]={...template,api_id:id,api_lv:id};
  const page={states:[],refs:[]},list={states:[],refs:[]};let scope=page,index=0,refIndex=0,previews=0;
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),useEffect:()=>{},
    useRef(initial){const i=refIndex++;return scope.refs[i]||(scope.refs[i]={current:initial});},
    useState(initial){const current=scope,i=index++;if(!(i in current.states))current.states[i]=typeof initial==='function'?initial():initial;
      return [current.states[i],value=>{current.states[i]=typeof value==='function'?value(current.states[i]):value;}];}};
  const controller={preview(){previews++;return {ok:true};}},Page=require('../../src/ui/practice/practice_page')(React,{getStore:()=>store,getController:()=>controller});
  const render=(component,props,context)=>{scope=context;index=0;refIndex=0;return component(props);};
  const walk=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(walk)]:[];
  let tree=render(Page,{kind:'practice'},page);page.states[0]=[W.entry(store,1),null,null,null,null,null];
  tree=render(Page,{kind:'practice'},page);walk(tree).find(n=>n.props.className==='paa-practice-training-trigger').props.onClick();
  tree=render(Page,{kind:'practice'},page);let element=walk(tree).find(n=>typeof n.type==='function'&&n.type.name==='TrainingList');
  assert(element,'the scrollable list is an independently rendered component');
  let listTree=render(element.type,element.props,list),before=previews;
  for(let n=1;n<=25;n++){
    listTree.props.onScroll({currentTarget:{scrollTop:n*53}});
    listTree=render(element.type,element.props,list);
  }
  assert.equal(previews,before,'scrolling must not rerun fleet preview');
  assert(walk(listTree).some(n=>n.props['data-index']>=20),'scrolling updates the visible window');
  store.info.fleets=store.info.fleets.map((fleet,i)=>i?fleet:{...fleet,api_ship:[1,-1,-1,-1,-1,-1]});
  tree=render(Page,{kind:'practice'},page);assert.equal(previews,++before,'fleet updates still revalidate');
  store.info.equips={...store.info.equips,100:{api_id:100,api_slotitem_id:1}};
  tree=render(Page,{kind:'practice'},page);assert.equal(previews,++before,'equipment updates still revalidate');
});

test('practice observation schedules revalidation when live equipment or fleet tables change',t=>{
  t.mock.timers.enable({apis:['setInterval']});
  let store=fixture(),index=0,refIndex=0,previews=0;const states=[],refs=[],effects=[];
  store.practiceState={known:true,opponents:[],revision:1};store.questState={known:true,tasks:[]};
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),useEffect:fn=>effects.push(fn),
    useRef(initial){const i=refIndex++;return refs[i]||(refs[i]={current:initial});},
    useState(initial){const i=index++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;
      return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];}};
  const Page=require('../../src/ui/practice/practice_page')(React,{getStore:()=>store,getController:()=>({preview(){previews++;return {ok:true};}})});
  const render=()=>{index=0;refIndex=0;effects.length=0;return Page({kind:'practice'});};
  render();states[0]=[W.entry(store,1),null,null,null,null,null];render();
  const observe=effects.find(fn=>String(fn).includes('next.practiceState?.revision'));assert(observe);
  const cleanup=observe(),revision=states[6],before=previews;
  store={...store,info:{...store.info,equips:{...store.info.equips,100:{api_id:100,api_slotitem_id:1}}}};
  t.mock.timers.tick(1000);assert.equal(states[6],revision+1);render();assert.equal(previews,before+1);
  store={...store,info:{...store.info,fleets:store.info.fleets.map((fleet,i)=>i?fleet:{...fleet,api_ship:[1,-1,-1,-1,-1,-1]})}};
  t.mock.timers.tick(1000);assert.equal(states[6],revision+2);render();assert.equal(previews,before+2);cleanup();
});
