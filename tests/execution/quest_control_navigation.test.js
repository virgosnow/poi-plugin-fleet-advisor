'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ControlObserver,observeControls}=require('../../src/execution/control_observer');
const {canFallback}=require('../../src/execution/recognition_fallback');
const button=(id)=>({id,attached:true,visible:true,enabled:true,point:{x:600,y:360},bounds:{left:0,top:0,right:1200,bottom:720}});
const welcome=()=>({version:1,valid:true,blocked:false,scene:'quest-welcome',controls:[button('quest.welcome.dismiss')]});
const returned=()=>({version:1,valid:false,blocked:true,interruption:'expedition-return'});
test('quest welcome navigation requires the native enabled control',()=>{
  const s=welcome();
  assert.equal(observeControls(s,'screen',{allowPortReturn:true}).mode,'quest-welcome');
  assert.deepEqual(observeControls(s,'navigation',{destination:'quest-welcome-dismiss'}),{valid:true,point:{x:600,y:360}});
  assert.equal(observeControls(s,'screen',{}).valid,false);
  s.scene='other';assert.equal(observeControls(s,'navigation',{destination:'quest-welcome-dismiss'}).valid,false);s.scene='quest-welcome';
  s.controls[0].enabled=false;
  assert.equal(observeControls(s,'screen',{allowPortReturn:true}).valid,false);
  assert.equal(observeControls(s,'navigation',{destination:'quest-welcome-dismiss'}).valid,false);
});
test('actual expedition return interrupts observation and pre-input checks without visual fallback',async()=>{
  const host={readControls:async()=>returned(),getStore:()=>({})};
  const observer=new ControlObserver(host);
  await observer.start();
  const expected=e=>e.code==='EXPEDITION_RETURN_REQUIRED'&&/远征归港/.test(e.message)&&!canFallback({controlMode:true},e);
  await assert.rejects(observer.read('screen',{allowPortReturn:true}),expected);
  await assert.rejects(observer.prepareInput({kind:'click',x:600,y:360,controlId:'quest.welcome.dismiss'}),expected);
});
