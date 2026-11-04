'use strict';

// Move one highlight behind the selected card without moving its contents.
function attach(list){
  const indicator=list.querySelector('.paa-practice-opponent-indicator'),win=list.ownerDocument.defaultView;
  if(!indicator||!win)return {select(){},dispose(){}};
  let frame=null,disposed=false;
  const measure=(tracking=false)=>{
    if(disposed)return;
    const target=list.querySelector('.paa-practice-opponent-item[data-selected="true"]');
    if(!target){delete indicator.dataset.ready;delete indicator.dataset.tracking;delete list.dataset.motionReady;return;}
    const parent=list.getBoundingClientRect(),rect=target.getBoundingClientRect();
    if(!rect.width||!rect.height)return;
    if(tracking)indicator.dataset.tracking='true';else delete indicator.dataset.tracking;
    indicator.style.transform=`translate(${rect.left-parent.left-list.clientLeft}px,${rect.top-parent.top-list.clientTop}px)`;
    indicator.style.width=rect.width+'px';indicator.style.height=rect.height+'px';
    if(!indicator.dataset.ready){indicator.getBoundingClientRect();indicator.dataset.ready='true';}
    list.dataset.motionReady='true';
  };
  const schedule=()=>{if(frame===null&&!disposed)frame=win.requestAnimationFrame(()=>{frame=null;measure(true);});};
  const observer=win.ResizeObserver?new win.ResizeObserver(schedule):null;
  for(const element of [list,...list.querySelectorAll('.paa-practice-opponent-item')])observer?.observe(element);
  win.addEventListener('resize',schedule);measure();
  return {select:()=>measure(),dispose(){disposed=true;observer?.disconnect();if(frame!==null)win.cancelAnimationFrame(frame);
    win.removeEventListener('resize',schedule);delete indicator.dataset.ready;delete indicator.dataset.tracking;delete list.dataset.motionReady;}};
}
function useOpponentMotion(React,root,hidden,known,opponentKey,opponentId){
  const motion=React.useRef(null),layoutEffect=React.useLayoutEffect||React.useEffect;
  layoutEffect(()=>{if(hidden||!known||!root.current)return;const current=attach(root.current);motion.current=current;
    return()=>{current.dispose();motion.current=null;};},[root,hidden,known,opponentKey]);
  layoutEffect(()=>{motion.current?.select();},[opponentId,hidden,known,opponentKey]);
}
module.exports=useOpponentMotion;
module.exports.attach=attach;
