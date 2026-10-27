'use strict';

const MODES=new Set(['home','organization','equipment']);
const ENTRY={home:[107,355],organization:[292,202],equipment:[477,339]};
const known=r=>r.valid&&MODES.has(r.mode);
const timedOut=error=>error.message==='Observation timed out: screen';

// Only stable base screens authorize navigation. Capture failures,
// cancellation and store drift must never trigger a recovery click.
async function readScreen(session,arg={}) {
  try {return await session.until('screen',arg,known);}
  catch(error) {
    session.check();
      if(!timedOut(error))throw error;
      // Two known non-screen states read as unknown: a leftover confirmation
      // card from an interrupted run, and the top-left button's hidden-UI
      // toggle at home (clicking that button AT home hides all UI; clicking
      // it again restores). Surfacing both saves a support round-trip; the
      // assistant never clicks its way out on its own.
      throw new Error('无法识别当前画面，请检查：1) 是否有未关闭的确认卡片（点灰色取消按钮）；2) 画面是否被左上角圆钮隐藏了全部 UI（再点一次该按钮恢复）；处理后返回母港重试');
  }
}

async function enterScreen(session,target) {
  if(!MODES.has(target))throw new Error('Unsupported navigation target');
  const arg=target==='equipment'?{includeFleet:true}:{};
  let screen=await readScreen(session,arg);
  if(screen.mode===target)return screen;
  const move=async destination=>{
    const origin=screen.mode;
    for(let attempt=0;attempt<3;attempt++) {
      await session.input(...ENTRY[destination]);
      try {
        screen=await session.until('screen',arg,r=>known(r)&&r.mode===destination);
        return;
      } catch(error) {
        session.check();
        if(!timedOut(error))throw error;
      }
      screen=await readScreen(session,arg);
      if(screen.mode===destination)return; // Late arrival: no duplicate click.
      if(screen.mode!==origin)throw new Error('导航后画面发生意外变化，已停止操作');
    }
    throw new Error('画面切换失败（已尝试 3 次），请手动返回母港后重试');
  };
  if(screen.mode!=='home')await move('home');
  if(target!=='home')await move(target);
  return screen;
}

module.exports={enterScreen};
