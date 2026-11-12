'use strict';

const MODES=new Set(['home','organization','equipment']);
const ENTRY={home:[107,355],organization:[292,202],equipment:[477,339]};
const known=r=>r.valid&&MODES.has(r.mode);
const returnable=r=>r.valid&&r.mode==='port-return'&&r.returnButton?.x===62&&r.returnButton?.y===58;
const questWelcome=r=>r.valid&&r.mode==='quest-welcome';
const expeditionReturn=error=>error?.code==='EXPEDITION_RETURN_REQUIRED';
const timedOut=error=>error.message==='Observation timed out: screen';
const readStable=(session,arg,predicate)=>session.until('screen',arg,predicate,6000,{captureAllowanceMs:12000});
const navigationReady=(session,destination)=>session.controlMode?session.until('navigation',{destination}):Promise.resolve();

// Stable base screens or a verified non-home return button authorize navigation. Capture failures,
// cancellation and store drift must never trigger a recovery click.
async function readScreen(session,arg={}) {
  try {return await readStable(session,arg,r=>known(r)||(arg.allowPortReturn&&returnable(r))||(session.controlMode&&questWelcome(r)));}
  catch(error) {
    if(expeditionReturn(error))throw error;
    session.check();
    if(session.controlMode&&error.code==='OBSERVATION_TIMEOUT')throw error;
      if(!timedOut(error))throw error;
      // A covered button or the home hide-UI toggle cannot authorize a click.
      const failure=Object.assign(new Error('无法识别当前画面或可用的返回母港按钮；请关闭遮挡弹窗，或恢复被隐藏的母港界面后重试'),{code:'NAV_SCREEN_NOT_RECOGNIZED'});
      if(error.diagnostics){failure.diagnostics=error.diagnostics;failure.stack+='\n'+error.stack;}
      throw failure;
  }
}

async function enterScreen(session,target) {
  if(!MODES.has(target))throw new Error('Unsupported navigation target');
  const arg={...(target==='equipment'?{includeFleet:true}:{}),allowPortReturn:true};
  let screen=await readScreen(session,arg);
  if(questWelcome(screen)){
    // The task panel's welcome screen covers its return control. Dismiss it
    // once using its verified native control, then wait for the panel or home.
    const ready=await navigationReady(session,'quest-welcome-dismiss');
    await session.input(ready.point.x,ready.point.y,undefined,'click',{settleMs:0,controlId:'quest.welcome.dismiss'});
    screen=await readStable(session,arg,r=>(r.valid&&r.mode==='home')||returnable(r));
  }
  if(returnable(screen)){
    session.onProgress?.({phase:'return-home'});
    await navigationReady(session,'home');
    await session.input(screen.returnButton.x,screen.returnButton.y,undefined,'click',{settleMs:0,controlId:'navigate.home'});
    // This coordinate becomes hide-UI after arriving. Never click twice.
    try {screen=await readStable(session,arg,r=>known(r)&&r.mode==='home');}
    catch(error){
      if(session.controlMode&&error.code==='OBSERVATION_TIMEOUT')throw error;
      if(!timedOut(error))throw error;
      const failure=Object.assign(new Error('已点击返回母港，但未确认母港画面；已停止，未重复点击'),{code:'NAV_RETURN_NOT_CONFIRMED'});
      failure.diagnostics=error.diagnostics;failure.stack+='\n'+error.stack;throw failure;
    }
  }
  if(screen.mode===target)return screen;
  const move=async(destination,point=ENTRY[destination])=>{
    const origin=screen.mode;
    for(let attempt=0;attempt<3;attempt++) {
      await navigationReady(session,destination);
      await session.input(...point,undefined,'click',{settleMs:0,controlId:'navigate.'+destination});
      try {
        screen=await readStable(session,arg,r=>known(r)&&r.mode===destination);
        return;
      } catch(error) {
        if(expeditionReturn(error))throw error;
        session.check();
        if(session.controlMode&&error.code==='OBSERVATION_TIMEOUT')throw error;
        if(!timedOut(error))throw error;
      }
      screen=await readScreen(session,arg);
      if(screen.mode===destination)return; // Late arrival: no duplicate click.
      if(screen.mode!==origin)throw Object.assign(new Error('导航后画面发生意外变化，已停止操作'),{code:'NAV_UNEXPECTED_SCREEN'});
    }
    throw Object.assign(new Error('画面切换失败（已尝试 3 次），请手动返回母港后重试'),{code:'NAV_SWITCH_FAILED'});
  };
  // The native side menu stays available on the verified organization base
  // screen. Its remodel sprite is at x=0,y=356,size=63x70 (port_sidemenu 9/10).
  if(screen.mode==='organization'&&target==='equipment'){
    await move('equipment',[30,390]);return screen;
  }
  if(screen.mode!=='home')await move('home');
  if(target!=='home')await move(target);
  return screen;
}

module.exports={enterScreen};
