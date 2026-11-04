'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {attach}=require('../../src/ui/practice/opponent_motion');
function fixture(){
 const frames=new Map(),listeners=new Map(),observed=[];let id=0,resize,disconnected=false,selected=0;
 const indicator={style:{},dataset:{},getBoundingClientRect:()=>({})};
 const rects=[{left:10,top:20,width:300,height:50},{left:10,top:76,width:300,height:100}];
 const items=rects.map(rect=>({getBoundingClientRect:()=>rect}));
 const win={requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:n=>frames.delete(n),
  addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),
  ResizeObserver:class{constructor(fn){resize=fn;}observe(node){observed.push(node);}disconnect(){disconnected=true;}}};
 const list={ownerDocument:{defaultView:win},dataset:{},clientLeft:0,clientTop:0,getBoundingClientRect:()=>({left:10,top:20}),
  querySelector:selector=>selector==='.paa-practice-opponent-indicator'?indicator:selected===null?null:items[selected],querySelectorAll:()=>items};
 const motion=attach(list);
 const flush=()=>{const [key,fn]=frames.entries().next().value;frames.delete(key);fn();};
 return {motion,indicator,list,rects,frames,listeners,observed,select:n=>{selected=n;motion.select();},resize:()=>resize(),flush,get disconnected(){return disconnected;}};
}
test('one indicator follows selection and the entire expanded card',()=>{
 const f=fixture();assert.equal(f.indicator.dataset.ready,'true');assert.equal(f.list.dataset.motionReady,'true');
 assert.equal(f.indicator.style.transform,'translate(0px,0px)');assert.equal(f.indicator.style.height,'50px');
 f.select(1);assert.equal(f.indicator.style.transform,'translate(0px,56px)');assert.equal(f.indicator.style.height,'100px');
 f.rects[0].height=80;f.rects[1].top=106;f.rects[1].height=140;f.resize();f.resize();assert.equal(f.frames.size,1);f.flush();
 assert.equal(f.indicator.style.transform,'translate(0px,86px)');assert.equal(f.indicator.style.height,'140px');assert.equal(f.indicator.dataset.tracking,'true');assert.equal(f.observed.length,3);
 f.select(null);assert.equal(f.indicator.dataset.ready,undefined);assert.equal(f.list.dataset.motionReady,undefined);
 f.select(0);assert.equal(f.indicator.dataset.ready,'true');assert.equal(f.indicator.dataset.tracking,undefined);f.motion.dispose();
});
test('indicator cleanup cancels measurements and releases resize listeners',()=>{
 const f=fixture();f.listeners.get('resize')();f.motion.dispose();assert.equal(f.frames.size,0);assert.equal(f.listeners.size,0);assert(f.disconnected);
 assert.equal(f.list.dataset.motionReady,undefined);f.rects[0].top=300;f.motion.select();assert.equal(f.indicator.style.transform,'translate(0px,0px)');
});
