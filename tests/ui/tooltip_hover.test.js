'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const useTooltip=require('../../src/ui/components/tooltip');

test('enemy-name tooltips activate only when their text is truncated',()=>{
  const node=(marked,scrollWidth,clientWidth)=>({hasAttribute:key=>key==='data-tooltip-overflow'&&marked,scrollWidth,clientWidth});
  assert.equal(useTooltip.tooltipAllowed(node(true,120,60)),true);
  assert.equal(useTooltip.tooltipAllowed(node(true,60,60)),false);
  assert.equal(useTooltip.tooltipAllowed(node(false,60,60)),true);
});

function harness(structured){
  const events=()=>({listeners:{},addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);},
    removeEventListener(type,fn){this.listeners[type]=(this.listeners[type]||[]).filter(f=>f!==fn);},
    emit(type,event={}){for(const fn of this.listeners[type]||[])fn(event);}});
  const rect={left:20,top:20,bottom:50,width:100,height:30},doc=events(),win=events();let currentTip=null;
  const page={...events(),ownerDocument:doc,parentElement:null,contains:n=>n===target};
  const target={dataset:{tooltip:'测试提示',...(structured?{tooltipContent:JSON.stringify({sections:[]})}:{})},
    isConnected:true,getClientRects:()=>[rect],closest:selector=>selector==='[data-tooltip]'?target:null,
    querySelector:()=>null,contains:n=>n===target,getBoundingClientRect:()=>rect,
    getAttribute:()=>null,setAttribute(){},removeAttribute(){}};
  const other={closest:()=>null};
  doc.body={appendChild(node){currentTip=node;node.isConnected=true;}};
  doc.createElement=()=>({...events(),style:{setProperty(){}},children:[],appendChild(child){this.children.push(child);},
    setAttribute(){},querySelector:()=>null,contains(n){return n===this;},getBoundingClientRect:()=>({width:100,height:40}),
    remove(){this.isConnected=false;if(currentTip===this)currentTip=null;}});
  Object.assign(win,{innerWidth:1000,innerHeight:800,setTimeout,clearTimeout,getComputedStyle:()=>({getPropertyValue:()=>''}),
    MutationObserver:class{observe(){}disconnect(){}}});doc.defaultView=win;
  let cleanup;useTooltip({useEffect:fn=>{cleanup=fn();}},{current:page},'test');
  return {page,doc,target,other,get tip(){return currentTip;},cleanup};
}

for(const structured of [false,true])test((structured?'structured':'plain')+' tooltip waits on exit and remains open if the pointer returns',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const h=harness(structured);
  h.page.emit('pointerover',{target:h.target,buttons:0});t.mock.timers.tick(350);assert(h.tip);
  h.page.emit('pointerout',{target:h.target,relatedTarget:h.other});
  h.page.emit('pointermove',{target:h.other,buttons:0});t.mock.timers.tick(400);assert(h.tip);
  h.tip.emit('pointerenter');t.mock.timers.tick(500);assert(h.tip,'returning to the panel cancels the pending close');
  h.tip.emit('pointerleave',{relatedTarget:h.other});t.mock.timers.tick(400);assert(h.tip);
  h.page.emit('pointerover',{target:h.target,buttons:0});t.mock.timers.tick(500);assert(h.tip,'returning to the trigger also cancels close');
  h.page.emit('pointerout',{target:h.target,relatedTarget:h.other});t.mock.timers.tick(499);assert(h.tip);
  t.mock.timers.tick(1);assert.equal(h.tip,null);h.cleanup();
});

test('an outside click immediately dismisses a tooltip even during the grace period',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const h=harness(true);
  h.page.emit('pointerover',{target:h.target,buttons:0});t.mock.timers.tick(350);assert(h.tip);
  h.page.emit('pointerout',{target:h.target,relatedTarget:h.other});h.doc.emit('pointerdown',{target:h.other});
  assert.equal(h.tip,null);t.mock.timers.tick(500);assert.equal(h.tip,null);h.cleanup();
});
