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
