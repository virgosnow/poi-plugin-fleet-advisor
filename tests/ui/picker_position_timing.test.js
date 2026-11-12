'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/workbench_fixture');

function harness(make,props){
  const states=[],refs=[],layout=[],passive=[];let stateIndex=0,refIndex=0,tree;
  const React={createElement:(type,attributes,...children)=>({type,props:attributes||{},children:children.flat()}),
    useState(initial){const index=stateIndex++;if(!(index in states))states[index]=typeof initial==='function'?initial():initial;
      return [states[index],value=>{states[index]=typeof value==='function'?value(states[index]):value;}];},
    useRef(initial){const index=refIndex++;return refs[index]||(refs[index]={current:initial});},
    useEffect:fn=>passive.push(fn),useLayoutEffect:fn=>layout.push(fn)};
  const Component=make(React),render=()=>{stateIndex=0;refIndex=0;layout.length=0;passive.length=0;tree=Component(props);return tree;};
  const walk=node=>!node||typeof node!=='object'?[]:[node,...(node.children||[]).flatMap(walk)];
  const find=predicate=>walk(tree).find(predicate);
  render();return {render,find,layout,passive};
}
function geometry(){
  const listeners=new Map(),win={addEventListener:(name,fn)=>listeners.set(`window:${name}`,fn),removeEventListener(){}},
    doc={documentElement:{clientWidth:800,clientHeight:700},defaultView:win,
      addEventListener:(name,fn)=>listeners.set(`document:${name}`,fn),removeEventListener(){}};
  const root={ownerDocument:doc,getBoundingClientRect:()=>({left:200,right:400,bottom:100,width:200}),
    closest:()=>({getBoundingClientRect:()=>({left:140,width:400})}),contains:()=>false};
  const focus={count:0,focus(){this.count++;}},panel={style:{},querySelector:selector=>selector==='input[type=search]'?focus:null};
  return {root,panel,focus,listeners};
}
test('map, expedition and route panels are positioned in layout effects before passive effects',()=>{
  for(const kind of ['normal','expedition','route']){
    const props=kind==='route'?{options:[],value:'',onChange(){}}:
      {kind,maps:[{area:'1-1'}],missions:[{missionId:1,name:'远征'}],value:kind==='normal'?'1-1':1,onChange(){}};
    const ui=harness(React=>kind==='route'?require('../../src/ui/components/route_picker')(React):require('../../src/ui/components/area_picker')(React),props);
    const env=geometry();ui.find(n=>n.props.className==='paa-area-anchor').props.ref.current=env.root;
    ui.find(n=>n.props['aria-haspopup']==='dialog').props.onClick();ui.render();
    ui.find(n=>n.props.className==='paa-area-anchor').props.ref.current=env.root;
    ui.find(n=>n.props.role==='dialog').props.ref.current=env.panel;
    const positioning=ui.layout.find(fn=>String(fn).includes('pickerPlacement(root'));
    assert(positioning,`${kind} must position before paint`);
    assert(!ui.passive.some(fn=>String(fn).includes('pickerPlacement(root')));
    const cleanup=positioning();
    assert.equal(env.panel.style.width,`${env.root.getBoundingClientRect().width}px`);assert.equal(env.panel.style.left,'0px');
    assert.equal(env.panel.style.maxHeight,kind==='expedition'?'400px':kind==='route'?'350px':'320px');
    assert(env.listeners.has('window:resize'));assert(env.listeners.has('document:scroll'));
    if(kind==='expedition')assert.equal(env.focus.count,1);
    cleanup();
  }
});
test('practice training picker also positions before paint',()=>{
  const store=fixture(),ui=harness(React=>require('../../src/ui/practice/practice_page')(React,{getStore:()=>store,getController:()=>({})}),{});
  const env=geometry();ui.find(n=>n.props.className==='paa-practice-training').props.ref.current=env.root;
  ui.find(n=>n.props.className==='paa-practice-training-trigger').props.onClick();ui.render();
  ui.find(n=>n.props.className==='paa-practice-training').props.ref.current=env.root;
  ui.find(n=>n.props.className==='paa-practice-training-panel').props.ref.current=env.panel;
  const positioning=ui.layout.find(fn=>String(fn).includes('trainingAnchor.current,panel=trainingDialog.current'));
  assert(positioning);assert(!ui.passive.some(fn=>String(fn).includes('trainingAnchor.current,panel=trainingDialog.current')));
  const cleanup=positioning();assert.equal(env.panel.style.width,'200px');assert.equal(env.panel.style.left,'0px');
  assert.equal(env.panel.style.maxHeight,'560px');assert.equal(env.focus.count,1);cleanup();
});
