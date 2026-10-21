'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');

function fixture(){
  const listeners=new Map(),swaps=[],ghosts=[];let scroll=0;
  const classes=()=>{const values=new Set();return {add:x=>values.add(x),remove:x=>values.delete(x),contains:x=>values.has(x)};};
  const cards=Array.from({length:6},(_,i)=>({dataset:{fleetSlot:String(i),empty:'false'},classList:classes(),
    closest(selector){return selector==='[data-fleet-slot]'?this:null;},
    getBoundingClientRect(){return {left:i%2*210,top:Math.floor(i/2)*210-scroll,width:200,height:200};},
    cloneNode(){return {classList:classes(),style:{setProperty(){}},setAttribute(){},querySelectorAll:()=>[],appendChild(){},remove(){ghosts.splice(ghosts.indexOf(this),1);}};}}));
  const root={contains:card=>cards.includes(card),closest:()=>root,
    querySelectorAll:()=>cards.filter(c=>c.classList.contains('is-drop-target')),
    addEventListener:(type,fn)=>listeners.set('root:'+type,fn),removeEventListener:type=>listeners.delete('root:'+type)};
  const window={addEventListener:(type,fn,capture)=>listeners.set(type,{fn,capture}),removeEventListener:type=>listeners.delete(type)};
  const document={body:{appendChild:g=>ghosts.push(g)},createElement:()=>({}),elementFromPoint(x,y){
    if(x<0||x>=410||y<0||y>=240||x%210>=200||(y+scroll)%210>=200)return null;
    return cards[Math.floor((y+scroll)/210)*2+Math.floor(x/210)]||null;
  }};
  root.ownerDocument=document;document.defaultView=window;window.getComputedStyle=()=>({getPropertyValue:()=>''});
  // Portal content belongs to a child document; using main-window globals fails.
  const context={module:{exports:{}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../../src/ui/components/ship_drag'),'utf8'),context);
  const dispose=context.module.exports(root,(a,b)=>swaps.push([a,b]));
  const pointer=(type,x,y,extra={})=>{const e={target:cards[0],button:0,pointerId:1,clientX:x,clientY:y,preventDefault(){},...extra};
    (type==='pointerdown'?listeners.get('root:'+type):listeners.get(type)?.fn)?.(e);};
  return {cards,swaps,ghosts,listeners,dispose,pointer,
    scrollTo(value,notify=true){scroll=value;if(notify)listeners.get('scroll')?.fn();},
    target:()=>cards.findIndex(c=>c.classList.contains('is-drop-target'))};
}

test('scrolling both ways retargets a stationary drag and preserves its floating position',()=>{
  const f=fixture();f.pointer('pointerdown',40,40);f.pointer('pointermove',250,60);
  assert.equal(f.target(),1);const position={...f.ghosts[0].style};
  assert.equal(f.listeners.get('scroll').capture,true,'capture nested non-bubbling scrolls');
  f.scrollTo(180);assert.equal(f.target(),3);assert.deepEqual(f.ghosts[0].style,position);
  f.scrollTo(0);assert.equal(f.target(),1);
  f.scrollTo(180);f.pointer('pointerup',250,60);assert.deepEqual(f.swaps,[[0,3]]);
  assert.equal(f.ghosts.length,0);assert.equal(f.target(),-1);f.dispose();assert.equal(f.listeners.size,0);
});

test('grab offset survives scrolling before the first drag movement',()=>{
  const f=fixture();f.pointer('pointerdown',40,40);f.scrollTo(80);f.pointer('pointermove',60,50);
  assert.equal(f.ghosts[0].style.top,'0px');assert.equal(f.ghosts[0].style.transform,'translate(20px,10px) rotate(1deg)');f.dispose();
});

test('a drag starting after page scroll uses the current viewport grab position',()=>{
  const f=fixture();f.scrollTo(160);f.pointer('pointerdown',40,80,{target:f.cards[2]});f.pointer('pointermove',250,90);
  assert.equal(f.ghosts[0].style.top,'50px');assert.equal(f.target(),3);
  f.pointer('pointerup',250,90);assert.deepEqual(f.swaps,[[2,3]]);f.dispose();
});

test('release rechecks the actual card even before a queued scroll event arrives',()=>{
  const f=fixture();f.pointer('pointerdown',40,40);f.pointer('pointermove',250,60);
  f.scrollTo(180,false);assert.equal(f.target(),1);f.pointer('pointerup',250,60);
  assert.deepEqual(f.swaps,[[0,3]]);f.dispose();
});

test('leaving the clipped viewport clears the target and cannot swap the last hovered card',()=>{
  const f=fixture();f.pointer('pointerdown',40,40);f.pointer('pointermove',250,60);
  f.pointer('pointerup',250,260);assert.deepEqual(f.swaps,[]);assert.equal(f.ghosts.length,0);f.dispose();
});

test('clicks, scroll-only gestures, unrelated pointers and cancellation do not swap',()=>{
  const f=fixture();f.pointer('pointerdown',40,40);f.scrollTo(180);f.pointer('pointerup',250,60);assert.deepEqual(f.swaps,[]);
  f.scrollTo(0);f.pointer('pointerdown',40,40);f.pointer('pointermove',250,60);
  f.pointer('pointerup',250,60,{pointerId:2});assert.equal(f.ghosts.length,1);assert.deepEqual(f.swaps,[]);
  f.pointer('pointercancel',250,60);assert.equal(f.ghosts.length,0);assert.deepEqual(f.swaps,[]);f.dispose();
});
