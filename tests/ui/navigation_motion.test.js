'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {attach}=require('../../src/ui/shell/navigation_motion');
function fixture(){
  const listeners=new Map(),frames=new Map();let frameId=0,disconnected=false;
  const indicator={style:{},dataset:{},getBoundingClientRect:()=>({})};
  const rect={left:70,top:25,width:100,height:34},target={getBoundingClientRect:()=>rect};
  const nav={clientLeft:1,clientTop:1,getBoundingClientRect:()=>({left:20,top:20}),querySelector:s=>s==='.paa-tab-indicator'?indicator:s==='button[aria-pressed="true"]'?target:null,querySelectorAll:()=>[target]};
  const win={addEventListener:(e,fn)=>listeners.set(e,fn),removeEventListener:e=>listeners.delete(e),
    requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id),ResizeObserver:class{observe(){}disconnect(){disconnected=true;}}};
  // Navigation must never inspect, transform or animate the page body again.
  const root={ownerDocument:{defaultView:win},querySelector:s=>{assert.equal(s,'.paa-tabs');return nav;}};
  return {motion:attach(root),indicator,rect,listeners,frames,get disconnected(){return disconnected;}};
}
test('tab marker follows selection while navigation leaves page content untouched',()=>{
  const f=fixture();assert.equal(f.indicator.dataset.ready,'true');assert.equal(f.indicator.style.transform,'translate(49px,4px)');
  f.rect.left=200;f.rect.width=120;f.motion.select('normal');
  assert.equal(f.indicator.style.transform,'translate(179px,4px)');assert.equal(f.indicator.style.width,'120px');
  f.rect.left=70;f.motion.select('manual');assert.equal(f.indicator.style.transform,'translate(49px,4px)');
  f.motion.select('manual');assert.equal(f.frames.size,0,'selection never queues body animations');f.motion.dispose();
});
test('resize measurements coalesce and disposal releases pending frames and observers',()=>{
  const f=fixture();f.listeners.get('resize')();f.listeners.get('resize')();assert.equal(f.frames.size,1);
  f.rect.left=300;const [id,measure]=[...f.frames.entries()][0];f.frames.delete(id);measure();
  assert.equal(f.indicator.style.transform,'translate(279px,4px)');
  f.listeners.get('resize')();f.motion.dispose();assert.equal(f.frames.size,0);assert.equal(f.listeners.size,0);assert(f.disconnected);
  f.rect.left=700;f.motion.select('settings');assert.equal(f.indicator.style.transform,'translate(279px,4px)','disposed callbacks cannot update navigation');
});
