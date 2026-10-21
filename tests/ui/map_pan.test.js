'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {mapPan}=require('../../src/ui/maps/map_pan');
function fixture(){
  const classes=new Set(),captures=new Set(),calls=[];
  const viewport={scrollLeft:200,scrollTop:120,scrollWidth:1200,clientWidth:600,
    scrollHeight:720,clientHeight:480,classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)},
    setPointerCapture:id=>{captures.add(id);calls.push(['capture',id]);},
    hasPointerCapture:id=>captures.has(id),
    releasePointerCapture:id=>{captures.delete(id);calls.push(['release',id]);}};
  const event=(props={})=>({currentTarget:viewport,pointerId:1,pointerType:'mouse',
    button:0,buttons:1,isPrimary:true,clientX:300,clientY:200,detail:1,
    preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...props});
  return {viewport,event,classes,calls};
}
test('a left drag pans both axes and suppresses the resulting node click, but preserves a fresh click',()=>{
  const {viewport,event,classes,calls}=fixture(),handlers=mapPan(true);
  handlers.onPointerDown(event());
  const move=event({clientX:220,clientY:150});
  // The next render can create new handlers without losing the gesture.
  mapPan(true).onPointerMove(move);
  assert.equal(viewport.scrollLeft,280);assert.equal(viewport.scrollTop,170);
  assert(classes.has('is-panning'));assert(move.prevented);
  handlers.onPointerUp(event({buttons:0}));
  assert(!classes.has('is-panning'));assert.deepEqual(calls,[['capture',1],['release',1]]);
  const click=event();handlers.onClickCapture(click);assert(click.stopped);
  handlers.onPointerDown(event());handlers.onPointerUp(event({buttons:0}));
  const nextClick=event();handlers.onClickCapture(nextClick);assert(!nextClick.stopped);
});
test('ordinary node clicks, keyboard activation and right buttons remain unaffected',()=>{
  const {viewport,event,calls}=fixture(),handlers=mapPan(true);
  handlers.onPointerDown(event());handlers.onPointerMove(event({clientX:303,clientY:202}));
  handlers.onPointerUp(event({buttons:0}));
  assert.equal(viewport.scrollLeft,200);assert.equal(viewport.scrollTop,120);
  assert.deepEqual(calls,[],'a small movement must not retarget the click by capturing the viewport');
  const click=event();handlers.onClickCapture(click);assert(!click.stopped);
  handlers.onPointerDown(event({button:2,buttons:2}));handlers.onPointerMove(event({clientX:20,buttons:2}));
  assert.equal(viewport.scrollLeft,200);
  handlers.onPointerDown(event());handlers.onPointerMove(event({clientX:200}));
  handlers.onPointerUp(event({buttons:0}));
  const keyboard=event({detail:0});handlers.onClickCapture(keyboard);assert(!keyboard.stopped);
});
test('cancel or lost capture ends panning, and a non-scrollable or unzoomed map does not start a drag',()=>{
  const {viewport,event,classes}=fixture(),handlers=mapPan(true);
  handlers.onPointerDown(event());handlers.onPointerMove(event({clientY:150}));
  handlers.onPointerCancel(event());assert(!classes.has('is-panning'));
  const before=viewport.scrollTop;handlers.onPointerMove(event({clientY:40}));assert.equal(viewport.scrollTop,before);
  handlers.onPointerDown(event());handlers.onPointerMove(event({clientY:100}));
  handlers.onLostPointerCapture(event());assert(!classes.has('is-panning'));
  viewport.scrollWidth=viewport.clientWidth;viewport.scrollHeight=viewport.clientHeight;
  const left=viewport.scrollLeft;handlers.onPointerDown(event());handlers.onPointerMove(event({clientX:50}));
  assert.equal(viewport.scrollLeft,left);assert.deepEqual(mapPan(false),{});
});
