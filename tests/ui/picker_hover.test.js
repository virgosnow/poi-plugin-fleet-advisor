'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const usePickerToggle=require('../../src/ui/components/picker_hover');
function picker(doc){
  let open=false,enabled=true,hook,cleanup;const ref={current:null};
  const React={useRef:()=>ref,useEffect:fn=>{cleanup=fn();}};
  const anchor={current:{ownerDocument:doc}};
  const render=()=>{hook=usePickerToggle(React,{enabled,open,anchor,onOpen:()=>{open=true;},onClose:()=>{open=false;}});};
  render();return {get hook(){return hook;},get open(){return open;},render,disable(){enabled=false;render();},unmount(){cleanup?.();}};
}
test('only clicks toggle panels; elapsed time never opens or closes them',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const p=picker({});
  assert.equal(p.hook.enter,undefined);assert.equal(p.hook.leave,undefined);
  t.mock.timers.tick(5000);assert.equal(p.open,false);
  p.hook.click();p.render();assert.equal(p.open,true);
  t.mock.timers.tick(5000);assert.equal(p.open,true);
  p.hook.click();p.render();assert.equal(p.open,false);
  p.disable();p.hook.click();assert.equal(p.open,false);
});
test('opening another selector closes the previous selector in the same document',()=>{
  const doc={},first=picker(doc),second=picker(doc),independent=picker({});
  first.hook.click();first.render();independent.hook.click();independent.render();assert.equal(first.open,true);
  second.hook.click();second.render();assert.equal(second.open,true);assert.equal(first.open,false);assert.equal(independent.open,true);
});
test('unmount releases the active picker without closing its replacement',()=>{
  const doc={},first=picker(doc),second=picker(doc);first.hook.click();first.render();first.unmount();
  second.hook.click();second.render();first.hook.dismiss();assert.equal(second.open,true);
});
test('the existing 200 ms accidental-click guard preserves keyboard input',t=>{
  let now=1000;t.mock.method(Date,'now',()=>now);const p=picker({});
  const click=(detail=1)=>{const result={prevented:false,stopped:false};
    p.hook.guardClick({detail,preventDefault(){result.prevented=true;},stopPropagation(){result.stopped=true;}});return result;};
  assert.deepEqual(click(),{prevented:false,stopped:false});p.hook.click();p.render();now+=199;
  assert.deepEqual(click(),{prevented:true,stopped:true});assert.deepEqual(click(0),{prevented:false,stopped:false});
  now++;assert.deepEqual(click(),{prevented:false,stopped:false});p.hook.click();p.render();assert.equal(p.open,false);
});
