'use strict';
const test=require('node:test'),assert=require('node:assert/strict');

function setup(rect={left:760,right:790,top:100,bottom:132,width:30}){
  const states=[],refs=[],effects=[];let si=0,ri=0,tree,chosen;
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),
    useState(value){const i=si++;if(!(i in states))states[i]=value;return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];},
    useRef(value){const i=ri++;return refs[i]||(refs[i]={current:value});},useEffect(){},useLayoutEffect:fn=>effects.push(fn)};
  const Component=require('../../src/ui/components/fleet_target_picker')(React),options=[
    {value:1,label:'第 1 舰队'},{value:2,label:'第 2 舰队（远征中）',disabled:true},{value:3,label:'第 3 舰队'}];
  const render=()=>{si=0;ri=0;effects.length=0;tree=Component({value:1,options,onChange:v=>{chosen=v;}});};
  const find=predicate=>{const walk=node=>!node||typeof node!=='object'?[]:[node,...(node.children||[]).flatMap(walk)];return walk(tree).find(predicate);};
  const listeners={},win={addEventListener:(k,fn)=>{listeners[`window:${k}`]=fn;},removeEventListener(){}},doc={documentElement:{clientWidth:800,clientHeight:600},defaultView:win,addEventListener:(k,fn)=>{listeners[k]=fn;},removeEventListener(){}};
  const root={ownerDocument:doc,getBoundingClientRect:()=>rect,contains:target=>target==='inside'};
  let focused=0;const focus={focus(){focused++;}},menu={style:{},scrollHeight:110,querySelector:()=>focus};
  render();find(n=>n.props.className==='paa-fleet-target').props.ref.current=root;
  find(n=>n.props['aria-label']==='编入舰队').props.onClick();render();
  find(n=>n.props.className==='paa-fleet-target-menu').props.ref.current=menu;
  const cleanup=effects[0]();
  return {render,find,menu,listeners,cleanup,get chosen(){return chosen;},get focused(){return focused;}};
}

test('fleet menu is positioned inside the window before paint, including near both edges',()=>{
  const right=setup();assert.equal(right.menu.style.width,'156px');assert.equal(right.menu.style.left,'-126px');
  assert.equal(right.menu.style.top,'calc(100% + 4px)');assert.equal(right.focused,1);right.cleanup();
  const left=setup({left:2,right:32,top:550,bottom:582,width:30});
  assert.equal(left.menu.style.left,'6px');assert.equal(left.menu.style.bottom,'calc(100% + 4px)');left.cleanup();
});
test('fleet menu retains unavailable state, selects an available fleet and dismisses outside',()=>{
  const ui=setup(),item=value=>ui.find(n=>n.props.role==='option'&&n.props.key===value);
  assert.equal(item(2).props.disabled,true);item(2).props.onClick();assert.equal(ui.chosen,undefined);
  item(3).props.onClick();assert.equal(ui.chosen,3);ui.render();assert.equal(ui.find(n=>n.props.role==='listbox'),undefined);ui.cleanup();
  const outside=setup();outside.listeners.pointerdown({target:'elsewhere'});outside.render();assert.equal(outside.find(n=>n.props.role==='listbox'),undefined);outside.cleanup();
});
