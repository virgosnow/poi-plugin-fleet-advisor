'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const useTooltip=require('../../src/ui/components/tooltip');

test('enemy-name tooltips activate only when their text is truncated',()=>{
  const node=(marked,scrollWidth,clientWidth)=>({hasAttribute:key=>key==='data-tooltip-overflow'&&marked,scrollWidth,clientWidth});
  assert.equal(useTooltip.tooltipAllowed(node(true,120,60)),true);
  assert.equal(useTooltip.tooltipAllowed(node(true,60,60)),false);
  assert.equal(useTooltip.tooltipAllowed(node(false,60,60)),true);
});

function harness(structured,tooltipText='测试提示'){
  const events=()=>({listeners:{},addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);},
    removeEventListener(type,fn){this.listeners[type]=(this.listeners[type]||[]).filter(f=>f!==fn);},
    emit(type,event={}){for(const fn of this.listeners[type]||[])fn(event);}});
  const rect={left:20,top:20,bottom:50,width:100,height:30},doc=events(),win=events();let currentTip=null;
  const page={...events(),ownerDocument:doc,parentElement:null,contains:n=>n===target};
  const target={dataset:{tooltip:tooltipText,...(structured?{tooltipContent:JSON.stringify({sections:[]})}:{})},
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
  return {page,doc,win,target,other,get tip(){return currentTip;},cleanup};
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

test('a pending tooltip does not appear if its trigger is removed before the delay',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const h=harness(false);
  h.page.emit('focusin',{target:h.target,buttons:0});t.mock.timers.tick(200);
  delete h.target.dataset.tooltip;t.mock.timers.tick(150);
  assert.equal(h.tip,null);h.cleanup();
});

test('a real map node tooltip shows radius after the delay and closes on click or scroll',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const create=(type,props,...children)=>({type,props:props||{},children});
  const walk=(tree,predicate)=>!tree||typeof tree!=='object'?[]:
    [...(predicate(tree)?[tree]:[]),...(tree.children||[]).flatMap(child=>walk(child,predicate))];
  const profile=require('../../src/domain/routes/sortie_profile').previewForMap('6-5');
  const tree=require('../../src/ui/maps/route_preview')(create,{profile,compact:true,textOnly:true});
  const node=walk(tree,row=>row.props?.className?.includes('paa-map-node ')&&row.props['aria-label']?.startsWith('M 点'))[0];
  assert(node);const h=harness(false,node.props['data-tooltip']);
  h.page.emit('pointerover',{target:h.target,buttons:0});t.mock.timers.tick(349);assert.equal(h.tip,null);
  t.mock.timers.tick(1);assert.match(h.tip.textContent,/M 点 · Boss 战.*基地航程 5/);
  h.doc.emit('click',{target:h.other});assert.equal(h.tip,null);
  h.page.emit('pointerover',{target:h.target,buttons:0});t.mock.timers.tick(350);assert(h.tip);
  h.win.emit('scroll',{target:h.other});assert.equal(h.tip,null);h.cleanup();
});

test('language switching dismisses stale or pending tooltip and next hover uses the new locale',t=>{
  const locale=require('../../src/shared/i18n');t.mock.timers.enable({apis:['setTimeout']});const h=harness(false,'满足先制雷击条件时固定发动');h.target.dataset.mechanism='torpedo';
  try{
    locale.setLocale('zh-CN');h.page.emit('pointerover',{target:h.target,buttons:0});t.mock.timers.tick(350);
    assert.match(h.tip.textContent,/满足先制雷击条件时固定发动/);
    locale.setLocale('ja-JP');assert.equal(h.tip,null,'existing tooltip is dismissed');
    h.page.emit('pointerover',{target:h.target,buttons:0});t.mock.timers.tick(350);
    assert.match(h.tip.textContent,/開幕雷撃/);assert.doesNotMatch(h.tip.textContent,/先制雷击/);
    h.page.emit('focusout',{});h.page.emit('pointerover',{target:h.target,buttons:0});
    locale.setLocale('zh-TW');t.mock.timers.tick(350);assert.equal(h.tip,null,'old pending timer is cancelled');
    h.page.emit('pointerover',{target:h.target,buttons:0});t.mock.timers.tick(350);assert.match(h.tip.textContent,/先制雷擊/);
  }finally{h.cleanup();locale.setLocale('zh-CN');}
});
