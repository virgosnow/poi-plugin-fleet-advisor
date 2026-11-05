'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const create=require('../../src/ui/components/route_picker');
test('map route shortcuts follow picker order, skip blocked and adaptive routes, and stay in the same gauge',()=>{
  const {routeNeighbor}=create,{fromRatio}=require('../../src/domain/combat/combat_balance');
  const combat=ratio=>({status:'estimated',balance:fromRatio(ratio)});
  const options=[{key:'a',phase:'gauge1',combat:combat(1)},{key:'b',phase:'gauge1',combat:combat(3)},
    {key:'blocked',phase:'gauge1',status:'notFound',combat:combat(2)},
    {key:'adaptive',phase:'gauge1',fallback:true},{key:'other',phase:'gauge2'}];
  assert.equal(routeNeighbor(options,'','gauge1',1),'b');
  assert.equal(routeNeighbor(options,'','gauge1',-1),'a');
  assert.equal(routeNeighbor(options,'b','gauge1',1),'a');
  assert.equal(routeNeighbor(options,'a','gauge1',-1),'b');
  assert.equal(routeNeighbor(options,'a','gauge1',1),'b');
  assert.equal(routeNeighbor(options,'other','gauge2',1),null);
  assert.equal(routeNeighbor(options,'adaptive','gauge1',1),'b');
});
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

test('route picker clicks toggle the panel',()=>{
  const options=require('../../src/domain/routes/route_plans').recommendedOptions('1-4'),calls=[];
  const props={options,value:options[0].key,onChange:key=>calls.push(key)},ui=harness(props);
  const anchor=()=>ui.find(n=>n.props.className==='paa-area-anchor'),panel=()=>ui.find(n=>n.props.role==='dialog');
  assert.equal(anchor().props.onPointerEnter,undefined);assert.equal(anchor().props.onPointerLeave,undefined);assert.equal(typeof anchor().props.onClickCapture,'function');
  ui.find(n=>n.props['aria-label']==='路线').props.onClick();ui.render();assert(panel());
  ui.find(n=>n.props['aria-label']==='路线').props.onClick();ui.render();assert(!panel());
  ui.find(n=>n.props['aria-label']==='路线').props.onClick();ui.render();assert(panel());
  ui.find(n=>n.props['aria-label']==='路线').props.onClick();ui.render();assert(!panel());
  props.disabled=true;ui.render();assert(!panel());
  assert.deepEqual(calls,[]);
});

test('click-opened route picker stays open without pointer-dependent timers',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const calls=[],ui=harness({options:[{key:'a',name:'路线',nodes:['A']}],value:'',onChange:key=>calls.push(key)});
  ui.open();
  const anchor=ui.find(n=>n.props.className==='paa-area-anchor');
  assert.equal(anchor.props.onPointerEnter,undefined);assert.equal(anchor.props.onPointerLeave,undefined);
  t.mock.timers.tick(5000);ui.render();assert(ui.find(n=>n.props.role==='dialog'));assert.deepEqual(calls,[]);
  anchor.props.onKeyDown({key:'Escape',preventDefault(){},stopPropagation(){}});ui.render();
  assert(!ui.find(n=>n.props.role==='dialog'));
});

test('battle predictions replace priority labels and rank routes within each phase without changing selections',()=>{
  const {fromRatio}=require('../../src/domain/combat/combat_balance');
  const combat=ratio=>({status:'estimated',balance:fromRatio(ratio)});
  const options=[
    {key:'low',name:'较弱',phase:'gauge2',priority:'优先',combat:combat(.5)},
    {key:'high',name:'较强',phase:'gauge2',combat:combat(4)},
    {key:'tie1',name:'同档一',phase:'gauge2',combat:combat(2)},
    {key:'tie2',name:'同档二',phase:'gauge2',combat:combat(2)},
    {key:'mid',name:'同档更强',phase:'gauge2',combat:combat(2.5)},
    {key:'pending',name:'计算中',phase:'gauge2',combat:{status:'pending'}},
    {key:'unknown',name:'未能评估',phase:'gauge2',combat:{status:'unknown'}},
    {key:'blocked',name:'缺船',phase:'gauge2',status:'notFound',combat:combat(10)},
    {key:'other',name:'其他阶段',phase:'gauge1',combat:combat(20)}
  ];
  const before=options.map(option=>option.key),calls=[];
  const ui=harness({options,value:'low',currentPhase:'gauge2',onChange:key=>calls.push(key)});ui.open();
  const groups=ui.all(n=>n.props.role==='group');
  assert.deepEqual(groups.map(n=>n.props['aria-label']),['第 2 阶段','第 1 阶段']);
  const rows=ui.all(n=>n.props.className==='paa-route-option');
  assert.deepEqual(rows.map(n=>n.props.key),['high','mid','tie1','tie2','low','pending','unknown','blocked','other']);
  assert.deepEqual(options.map(option=>option.key),before,'input order must not be mutated');
  const texts=node=>typeof node==='string'?node:node&&typeof node==='object'?node.children.map(texts).join(''):'';
  const row=key=>rows.find(n=>n.props.key===key);
  assert.match(texts(row('high')),/压倒性优势/);assert.match(texts(row('low')),/明显劣势/);
  assert(!texts(row('low')).includes('优先'));assert.match(texts(row('pending')),/计算中/);
  assert.match(texts(row('unknown')),/暂不可评估/);assert.match(texts(row('blocked')),/上次未找到方案/);
  assert.equal(row('low').props['aria-selected'],true);assert.deepEqual(calls,[]);
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

test('reset button clears any selected route and closes the picker without changing gauge',()=>{
  const options=require('../../src/domain/routes/route_plans').recommendedOptions('5-6'),calls=[];
  const first=options.filter(o=>o.phase==='gauge1'&&!o.fallback);
  const props={area:'5-6',options,value:first.at(-1).key,currentPhase:'gauge3',onChange:key=>calls.push(key)},ui=harness(props);
  const reset=()=>ui.find(n=>n.props['aria-label']==='重置路线');
  assert(reset());ui.open();reset().props.onClick();ui.render();assert.deepEqual(calls,['']);
  assert(!ui.find(n=>n.props.role==='dialog'));
  props.value='';ui.render();assert(reset());assert(reset().props.disabled);
  reset().props.onClick();assert.deepEqual(calls,['']);
  props.value=first[0].key;props.disabled=true;ui.render();assert(reset().props.disabled);
  reset().props.onClick();assert.deepEqual(calls,['']);
  props.disabled=false;props.hidden=true;ui.render();reset().props.onClick();assert.deepEqual(calls,['']);
});

test('adaptive result is display-only, cannot be selected, and can be reset',()=>{
  const options=require('../../src/domain/routes/route_plans').recommendedOptions('1-2'),fallback=options.find(o=>o.fallback);
  const curated=options.filter(o=>!o.fallback),calls=[];
  const props={area:'1-2',options,value:fallback.key,onChange:key=>calls.push(key)},ui=harness(props);
  assert.match(ui.find(n=>n.props.className==='paa-wb-route-name').children.join(''),/自适应路线/);
  ui.open();assert(!ui.find(n=>n.props.role==='option'&&n.props.key===fallback.key));
  assert(ui.find(n=>n.props.role==='option'&&n.props.key===curated[0].key));
  const reset=ui.find(n=>n.props['aria-label']==='重置路线');assert(reset);reset.props.onClick();
  assert.deepEqual(calls,['']);assert(!calls.includes(fallback.key));
});

test('reset remains available for a single route, including an unavailable one',()=>{
  const only={key:'only',name:'唯一路线',nodes:['A','B']},calls=[];
  const props={options:[{...only,status:'notFound'}],value:'only',onChange:key=>calls.push(key)},ui=harness(props);
  const reset=ui.find(n=>n.props['aria-label']==='重置路线');assert(reset);reset.props.onClick();
  assert.deepEqual(calls,['']);
});

test('failed or unconfirmed route choices are disabled until their status is cleared',()=>{
  const calls=[],options=[{key:'ok',name:'可用',nodes:['A']},{key:'bad',name:'缺船',nodes:['B'],status:'notFound'},
    {key:'unknown',name:'待确认',nodes:['C'],status:'unconfirmed'}],props={options,value:'ok',onChange:key=>calls.push(key)};
  const ui=harness(props);ui.open();
  const row=key=>ui.find(n=>n.props.key===key&&n.props.role==='option');
  assert(row('bad').props.disabled);assert.equal(row('bad').props.tabIndex,-1);assert(row('unknown').props.disabled);
  row('bad').props.onClick();row('unknown').props.onClick();assert.deepEqual(calls,[]);
  props.options=options.map(({status,...option})=>option);ui.render();assert(!row('bad').props.disabled);
  row('bad').props.onClick();assert.deepEqual(calls,['bad']);
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
