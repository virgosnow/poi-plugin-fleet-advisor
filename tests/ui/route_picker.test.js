'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const create=require('../../src/ui/components/route_picker');
function harness(props){
  let i=0,tree;const states=[];
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),
    useState(initial){const k=i++;if(!(k in states))states[k]=initial;return [states[k],v=>states[k]=v];},
    useRef(initial){const k=i++;return states[k]||(states[k]={current:initial});},useEffect:()=>{}};
  const Picker=create(React),render=()=>{i=0;tree=Picker(props);};
  const all=(node,p)=>!node||typeof node!=='object'?[]:[...(p(node)?[node]:[]),...node.children.flatMap(c=>all(c,p))];
  render();return {render,all:p=>all(tree,p),find:p=>all(tree,p)[0],open(){all(tree,n=>n.props['aria-haspopup']==='dialog')[0].props.onClick();render();}};
}
test('route popup groups stages, highlights selection, resets preview and closes without confirmation',()=>{
  const options=require('../../src/domain/routes/route_plans').recommendedOptions('7-3'),calls=[];
  const props={options,value:options[0].key,currentPhase:'gauge2',onChange:v=>calls.push(v)},ui=harness(props);
  ui.open();assert(ui.find(n=>n.props.role==='dialog'));assert.equal(ui.all(n=>n.props.role==='group')[0].props['aria-label'],'第 2 阶段');
  assert.equal(ui.all(n=>n.props['aria-selected']===true).length,1);
  ui.all(n=>n.props.role==='option')[0].props.onClick();ui.render();assert.deepEqual(calls,['']);
  assert(!ui.find(n=>n.props.role==='dialog'));
  ui.open();ui.find(n=>n.props.className==='paa-route-option'&&n.props['aria-selected']===false).props.onClick();ui.render();
  assert.equal(calls.length,2);assert(!ui.find(n=>n.props.role==='dialog'));
  props.disabled=true;ui.open();assert(!ui.find(n=>n.props.role==='dialog'));
});
test('route popup stays anchored and Escape never changes the fleet or selected route',()=>{
  const options=require('../../src/domain/routes/route_plans').recommendedOptions('1-4'),calls=[];
  const ui=harness({options,value:options[0].key,onChange:v=>calls.push(v)});ui.open();
  const anchor=ui.find(n=>n.props.className==='paa-area-anchor'),panel=ui.find(n=>n.props.role==='dialog');assert(anchor.children.includes(panel));
  assert.equal(ui.all(n=>n.props.role==='group').length,1);assert.equal(ui.all(n=>n.type==='h4').length,0);
  anchor.props.onKeyDown({key:'Escape',preventDefault(){},stopPropagation(){}});ui.render();assert.deepEqual(calls,[]);assert(!ui.find(n=>n.props.role==='dialog'));
});

test('other gauges stay folded and cannot be selected until explicitly expanded; expansion does not search',()=>{
  const options=require('../../src/domain/routes/route_plans').recommendedOptions('5-6'),calls=[];
  const props={area:'5-6',options,value:'',currentPhase:'gauge3',onChange:key=>calls.push(key)},ui=harness(props);
  const toggles=()=>ui.all(n=>n.props.className==='paa-route-phase-toggle');
  const bodies=()=>ui.all(n=>n.props.className==='paa-collapse');
  ui.open();assert.equal(toggles().length,3);
  assert.deepEqual(toggles().map(n=>n.props['aria-expanded']),[true,false,false]);
  assert.deepEqual(bodies().map(n=>n.props['aria-hidden']),[false,true,true]);
  const first=options.find(o=>o.phase==='gauge1');
  const option=()=>ui.find(n=>n.props.key===first.key);
  assert.equal(option().props.tabIndex,-1);option().props.onClick();assert.deepEqual(calls,[]);
  toggles()[1].props.onClick();ui.render();assert.deepEqual(calls,[]);
  assert.equal(option().props.tabIndex,0);option().props.onClick();ui.render();assert.deepEqual(calls,[first.key]);
  props.value=first.key;ui.open();assert.equal(bodies()[1].props['aria-hidden'],false,'selected phase stays visible when reopening');
  props.area='7-3';props.options=require('../../src/domain/routes/route_plans').recommendedOptions('7-3');props.value='';props.currentPhase='gauge2';ui.render();
  assert.deepEqual(toggles().map(n=>n.props['aria-expanded']),[true,false],'expansion from another map cannot leak');
});

test('next-route shortcut stays hidden until enabled and cycles only within the selected gauge',()=>{
  const options=require('../../src/domain/routes/route_plans').recommendedOptions('5-6'),calls=[];
  const first=options.filter(o=>o.phase==='gauge1'),third=options.filter(o=>o.phase==='gauge3');
  const props={area:'5-6',options,value:first.at(-1).key,currentPhase:'gauge3',onChange:key=>calls.push(key)},ui=harness(props);
  const next=()=>ui.find(n=>n.props['aria-label']==='下一条路线');
  assert(!next());props.showNext=true;ui.render();assert(next());
  next().props.onClick();assert.deepEqual(calls,[first[0].key],'wrapping cannot advance to another gauge');
  props.value=first[0].key;ui.render();next().props.onClick();assert.equal(calls.at(-1),first[1].key);
  props.value='';ui.render();next().props.onClick();assert.equal(calls.at(-1),third[0].key,'an empty selection starts in the active gauge');
  props.disabled=true;ui.render();assert(next().props.disabled);const count=calls.length;next().props.onClick();assert.equal(calls.length,count);
  props.disabled=false;props.hidden=true;ui.render();next().props.onClick();assert.equal(calls.length,count);
});

test('next-route shortcut safely handles one route or an empty catalogue and closes a popup on switching',()=>{
  const only={key:'only',name:'唯一路线',nodes:['A','B']},calls=[];
  const props={options:[only],value:'only',showNext:true,onChange:key=>calls.push(key)},ui=harness(props);
  const next=()=>ui.find(n=>n.props['aria-label']==='下一条路线');
  assert(next().props.disabled);next().props.onClick();assert.deepEqual(calls,[]);
  props.value='';ui.render();assert(!next().props.disabled);ui.open();next().props.onClick();ui.render();
  assert.deepEqual(calls,['only']);assert(!ui.find(n=>n.props.role==='dialog'));
  props.options=[];ui.render();assert(next().props.disabled);next().props.onClick();assert.equal(calls.length,1);
});

test('popup grid navigation follows its columns and skips folded stages',()=>{
  const options=require('../../src/domain/routes/route_plans').recommendedOptions('5-6');
  const ui=harness({options,value:'',currentPhase:'gauge3',onChange:()=>{}});ui.open();
  const anchor=ui.find(n=>n.props.className==='paa-area-anchor'),focused=[];
  const rows=Array.from({length:6},(_,i)=>({focus:()=>focused.push(i),closest:()=>grid}));
  const grid={querySelectorAll:()=>rows,ownerDocument:{defaultView:{getComputedStyle:()=>({gridTemplateColumns:'200px 200px'})}}};
  const ref=anchor.props.ref;ref.current={};
  const folded={focus:()=>assert.fail('folded phase received focus'),closest:selector=>selector==='[aria-hidden=true]'?{}:null};
  const section=ui.find(n=>n.props.role==='dialog');section.props.ref.current={querySelectorAll:()=>[...rows,folded]};
  rows.forEach(row=>{row.closest=selector=>selector==='.paa-route-options'?grid:null;});
  const press=(key,target)=>anchor.props.onKeyDown({key,target,preventDefault(){}});
  press('ArrowDown',rows[0]);press('ArrowUp',rows[4]);press('ArrowRight',rows[1]);press('ArrowLeft',rows[2]);press('End',rows[2]);
  assert.deepEqual(focused,[2,2,2,1,5]);
});
