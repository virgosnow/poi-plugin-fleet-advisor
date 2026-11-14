'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const create=require('../../src/ui/components/quest_wiki_menu');

test('shared wiki menu positions without scrolling and closes on scrolling or page hiding',()=>{
  const states=[],effects=[],listeners={},windowListeners={};let cursor=0,changed,focusOptions,observer;
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),
    useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},
    useRef(initial){const i=cursor++;return states[i]||(states[i]={current:initial});},
    useLayoutEffect(fn){effects.push(fn);},useEffect(){}};
  const workbench={hidden:false,hasAttribute:()=>false,getAttribute:()=>null};
  const win={addEventListener:(name,fn)=>{windowListeners[name]=fn;},removeEventListener:name=>{delete windowListeners[name];},
    MutationObserver:class{constructor(cb){changed=cb;observer=this;}observe(target,options){assert.equal(target,workbench);assert.deepEqual(options.attributeFilter,['hidden','inert','aria-hidden']);}disconnect(){this.disconnected=true;}}};
  const doc={defaultView:win,documentElement:{clientWidth:500,clientHeight:400},
    addEventListener:(name,fn)=>{listeners[name]=fn;},removeEventListener:name=>{delete listeners[name];}};
  const node={ownerDocument:doc,style:{},closest:()=>workbench,getBoundingClientRect:()=>({width:160,height:80}),
    querySelector:()=>({focus:options=>{focusOptions=options;}}),matches:()=>false,showPopover(){},contains:()=>false};
  const hook=create(React),render=()=>{cursor=0;effects.length=0;return hook();};
  let ui=render();const anchor={ownerDocument:doc,getBoundingClientRect:()=>({left:0,top:0,width:100,height:60})};
  const open=()=>{ui.open({currentTarget:anchor,clientX:480,clientY:390,preventDefault(){},stopPropagation(){}},{title:'任務'});ui=render();ui.element.props.ref.current=node;return effects[0]();};
  let cleanup=open();assert.equal(node.style.left,'332px');assert.equal(node.style.top,'312px');assert.deepEqual(focusOptions,{preventScroll:true});
  listeners.scroll();ui=render();assert.equal(ui.element,null);cleanup();assert(observer.disconnected);
  cleanup=open();workbench.hidden=true;changed();ui=render();assert.equal(ui.element,null);cleanup();
});
