'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ControlObserver,observeControls}=require('../../src/execution/control_observer');
const {Session}=require('../../src/execution/session');
const {enterScreen}=require('../../src/execution/navigation');

const homeButton=()=>({id:'navigate.home',attached:true,visible:true,rendered:true,enabled:true,point:{x:68,y:60},bounds:{left:12,top:8,right:124,bottom:112}});
const page=(scene,extra={})=>({version:1,valid:true,blocked:false,scene,controls:[homeButton()],...extra});
const pages=[['generic port page',()=>page('other')],['fleet picker',()=>page('organization',{organization:{phase:'picker'}})],
  ['equipment picker',()=>page('equipment',{equipment:{phase:'picker'}})],['equipment confirmation',()=>page('equipment',{equipment:{phase:'confirm'}})]];

for(const [label,makePage] of pages)test(label+' returns through its enabled native home control',async()=>{
  let snapshot=makePage(),time=0;const clicks=[];
  const host={getStore:()=>({}),readControls:async()=>snapshot,check(){},cancel(){},input:async input=>{
    clicks.push(input);snapshot={version:1,valid:true,blocked:false,scene:'home',controls:[]};
  }};
  const observer=new ControlObserver(host);await observer.start();
  const session=new Session(host,observer,{now:()=>time});session.wait=async ms=>{time+=ms;};
  await enterScreen(session,'home');
  assert.deepEqual(clicks.map(c=>[c.x,c.y]),[[68,60]],'use the actual, freshly verified control point');
  assert.equal(clicks[0].mutation,undefined);
});

test('home return on non-base pages requires one visible and enabled control',()=>{
  for(const mutate of [s=>s.controls[0].visible=false,s=>s.controls[0].rendered=false,s=>s.controls[0].enabled=false,s=>s.controls[0].attached=false,
    s=>s.controls=[],s=>s.blocked=true,s=>s.valid=false,s=>s.controls.push(homeButton())]){
    const s=page('equipment',{equipment:{phase:'picker'}});mutate(s);
    assert.equal(observeControls(s,'screen',{allowPortReturn:true}).valid,false);
  }
});

test('a previously visible home control cannot authorize input after the page becomes blocked',async()=>{
  let snapshot=page('equipment',{equipment:{phase:'picker'}});
  const observer=new ControlObserver({getStore:()=>({}),readControls:async()=>snapshot});await observer.start();
  assert.equal((await observer.read('screen',{allowPortReturn:true})).mode,'port-return');
  snapshot={...snapshot,valid:false,blocked:true,reason:'Unrecognized modal covers the game controls'};
  await assert.rejects(observer.prepareInput({x:62,y:58,kind:'click',controlId:'navigate.home'}),{code:'CONTROL_RECOGNITION_UNAVAILABLE'});
});
