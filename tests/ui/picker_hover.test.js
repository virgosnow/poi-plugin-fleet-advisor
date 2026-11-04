'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const usePickerHover=require('../../src/ui/components/picker_hover');

function picker(doc,shouldHoldOpen){
  let open=false,enabled=true,hook,cleanup;const ref={current:null};
  const React={useRef:()=>ref,useEffect:fn=>{cleanup=fn();}};
  const anchor={current:{ownerDocument:doc}};
  const render=()=>{hook=usePickerHover(React,{enabled,open,anchor,onOpen:()=>{open=true;},onClose:()=>{open=false;},shouldHoldOpen});};
  render();
  return {get hook(){return hook;},get open(){return open;},render,disable(){enabled=false;render();},unmount(){cleanup?.();}};
}
const mouse={pointerType:'mouse'};

test('hover waits; a click during the delay opens immediately and cancels the timer',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const p=picker({});
  p.hook.enter(mouse);t.mock.timers.tick(200);assert.equal(p.open,false);
  p.hook.click();p.render();assert.equal(p.open,true);
  t.mock.timers.tick(500);assert.equal(p.open,true);
  p.hook.click();p.render();assert.equal(p.open,false);
  p.hook.click();p.render();assert.equal(p.open,true);
  p.hook.click();p.render();assert.equal(p.open,false);
});

test('hover stays open during departure grace and cancels closing on return',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const p=picker({});
  p.hook.enter(mouse);t.mock.timers.tick(399);assert.equal(p.open,false);
  t.mock.timers.tick(1);p.render();assert.equal(p.open,true);assert.equal(p.hook.isHover(),true);
  p.hook.leave(mouse);t.mock.timers.tick(400);p.hook.enter(mouse);t.mock.timers.tick(500);assert.equal(p.open,true);
  p.hook.leave(mouse);t.mock.timers.tick(499);assert.equal(p.open,true);t.mock.timers.tick(1);p.render();assert.equal(p.open,false);
  p.hook.enter(mouse);t.mock.timers.tick(200);p.hook.leave(mouse);t.mock.timers.tick(400);assert.equal(p.open,false);
});

test('click-opened panels also close on departure and disabled or unmounted panels cannot open later',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const p=picker({});
  p.hook.click();p.render();assert.equal(p.open,true);
  p.hook.leave(mouse);t.mock.timers.tick(500);p.render();assert.equal(p.open,false);
  p.hook.enter(mouse);p.disable();t.mock.timers.tick(400);assert.equal(p.open,false);
  const q=picker({});q.hook.enter(mouse);q.unmount();t.mock.timers.tick(400);assert.equal(q.open,false);
});

test('a search being edited keeps the panel open after pointer departure',t=>{
  t.mock.timers.enable({apis:['setTimeout']});let editing=false;const p=picker({},()=>editing);
  p.hook.click();p.render();p.hook.leave(mouse);t.mock.timers.tick(100);
  editing=true;t.mock.timers.tick(400);assert.equal(p.open,true);
  editing=false;p.hook.leave(mouse);t.mock.timers.tick(500);assert.equal(p.open,false);
});

test('keyboard navigation keeps the focused picker open without changing ordinary hover dismissal',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const focused={},doc={activeElement:focused},panel={contains:node=>node===focused},p=picker(doc);
  p.hook.click();p.render();p.hook.engageKeyboard({key:'ArrowDown',currentTarget:panel});
  p.hook.leave(mouse);t.mock.timers.tick(500);assert.equal(p.open,true);
  doc.activeElement={};p.hook.leave(mouse);t.mock.timers.tick(500);assert.equal(p.open,false);
  p.hook.click();p.render();doc.activeElement=focused;
  p.hook.leave(mouse);t.mock.timers.tick(500);assert.equal(p.open,false);
});

test('an active native select can be used after the pointer leaves the panel',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const focused={},doc={activeElement:focused},panel={contains:node=>node===focused},p=picker(doc);
  p.hook.click();p.render();p.hook.engageSelect({target:{tagName:'SELECT'},currentTarget:panel});
  p.hook.leave(mouse);t.mock.timers.tick(500);assert.equal(p.open,true);
  p.hook.click();p.render();assert.equal(p.open,false);
});

test('returning to pointer navigation restores automatic dismissal',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const focused={},doc={activeElement:focused},panel={contains:node=>node===focused},p=picker(doc);
  p.hook.click();p.render();p.hook.engageKeyboard({key:'ArrowDown',currentTarget:panel});
  p.hook.engageSelect({target:{tagName:'BUTTON'},currentTarget:panel});
  p.hook.leave(mouse);t.mock.timers.tick(500);assert.equal(p.open,false);
});

test('opening another selector closes the previous selector in the same document',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const doc={},first=picker(doc),second=picker(doc);
  first.hook.click();first.render();assert.equal(first.open,true);
  second.hook.enter(mouse);t.mock.timers.tick(400);second.render();assert.equal(second.open,true);assert.equal(first.open,false);
});

test('mouse clicks inside the selector are ignored for 200 ms after opening, without blocking keyboard input',t=>{
  t.mock.timers.enable({apis:['setTimeout']});let now=1000;t.mock.method(Date,'now',()=>now);
  const p=picker({});
  const click=(detail=1)=>{
    const result={prevented:false,stopped:false};
    p.hook.guardClick({detail,preventDefault(){result.prevented=true;},stopPropagation(){result.stopped=true;}});
    return result;
  };
  assert.deepEqual(click(),{prevented:false,stopped:false});
  p.hook.enter(mouse);t.mock.timers.tick(400);p.render();assert.equal(p.open,true);
  now+=199;assert.deepEqual(click(),{prevented:true,stopped:true});
  assert.deepEqual(click(0),{prevented:false,stopped:false});
  now++;assert.deepEqual(click(),{prevented:false,stopped:false});
  p.hook.click();p.render();assert.equal(p.open,false);
  p.hook.click();p.render();assert.equal(p.open,true);
  assert.deepEqual(click(),{prevented:true,stopped:true});
  now+=200;assert.deepEqual(click(),{prevented:false,stopped:false});
});
