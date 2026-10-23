'use strict';
// Only the tab marker moves; page content stays at its final coordinates.
function attach(root){
  const nav=root.querySelector('.paa-tabs'),indicator=nav?.querySelector('.paa-tab-indicator');
  const win=root.ownerDocument.defaultView;
  if(!nav||!indicator)return {select(){},dispose(){}};
  let frame=null,disposed=false;
  const measure=()=>{
    if(disposed)return;
    const target=nav.querySelector('button[aria-pressed="true"]');if(!target)return;
    const parent=nav.getBoundingClientRect(),rect=target.getBoundingClientRect();
    indicator.style.transform=`translate(${rect.left-parent.left-nav.clientLeft}px,${rect.top-parent.top-nav.clientTop}px)`;
    indicator.style.width=rect.width+'px';indicator.style.height=rect.height+'px';
    if(!indicator.dataset.ready){
      // Establish initial geometry before enabling transitions, avoiding a fly-in.
      indicator.getBoundingClientRect();indicator.dataset.ready='true';
    }
  };
  const schedule=()=>{if(frame===null&&!disposed)frame=win.requestAnimationFrame(()=>{frame=null;measure();});};
  const observer=win.ResizeObserver?new win.ResizeObserver(schedule):null;
  for(const element of [nav,...nav.querySelectorAll('button'),nav.querySelector('.paa-settings-tools')].filter(Boolean))observer?.observe(element);
  win.addEventListener('resize',schedule);
  measure();
  return {
    select:measure,
    dispose(){
      disposed=true;observer?.disconnect();
      if(frame!==null)win.cancelAnimationFrame(frame);
      win.removeEventListener('resize',schedule);
      delete indicator.dataset.ready;
    }
  };
}
function useNavigationMotion(React,root,mode){
  const motion=React.useRef(null),layoutEffect=React.useLayoutEffect||React.useEffect;
  layoutEffect(()=>{
    if(!root.current)return;
    const current=attach(root.current);motion.current=current;
    return()=>{current.dispose();motion.current=null;};
  },[root]);
  layoutEffect(()=>{motion.current?.select(mode);},[mode]);
}
module.exports=useNavigationMotion;
module.exports.attach=attach;
