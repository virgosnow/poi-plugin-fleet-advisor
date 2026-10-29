'use strict';

const {enterScreen}=require('./navigation');

function controlUnavailable(message,cause){
  return Object.assign(new Error(message,{cause}),{code:'CONTROL_RECOGNITION_UNAVAILABLE'});
}
function canFallback(session,error){
  return session?.controlMode===true&&!session.pendingMutation&&!session.abort?.signal.aborted&&
    ['CONTROL_RECOGNITION_UNAVAILABLE','OBSERVATION_TIMEOUT','PICKER_MODE_UNREADABLE'].includes(error?.code);
}
// Abandon the native picker context before replanning. Never reuse its row
// order, selected instance or coordinates in the image executor.
async function recoverImageScreen(session){
  if(session.controlMode)throw Error('Image recovery requires image recognition');
  const screen=await session.until('recognitionRecovery',{});
  if(screen.mode==='borrow-cancel'){
    if(!screen.cancel)throw Error('Borrow cancellation not confirmed');
    await session.input(screen.cancel.x,screen.cancel.y,undefined,'click',{settleMs:0});
  }
  await enterScreen(session,'home');
  session.check();
}
module.exports={controlUnavailable,canFallback,recoverImageScreen};
