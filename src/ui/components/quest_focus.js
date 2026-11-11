'use strict';
const {t,registerCatalog}=require('../../shared/i18n');
registerCatalog('ja',{'关闭任务视图':'任務表示を閉じる'});
registerCatalog('zh-TW',{'关闭任务视图':'關閉任務檢視'});

// Keep each compact heading visually attached to the section it represents.
// The rows share one layout container, so record each original section's
// position before it collapses instead of animating all rows from the bottom.
const ORIGINS={
  normal:{area:'.paa-area-picker:not(.paa-wb-route-picker)',route:'.paa-wb-route-picker',arrival:'.paa-wb-route-status',combat:'.paa-wb-threat'},
  expedition:{mission:'.paa-area-picker',goal:'.paa-exp-goal-field',time:'.paa-exp-time',requirements:'.paa-exp-outcome',income:'.paa-exp-income'},
  practice:{training:'.paa-practice-training',opponent:'.paa-practice-opponent-section',forecast:'.paa-practice-forecast-section'},
};
function markOrigins(node){
  const kind=node.closest?.('.paa-workbench')?.dataset?.kind,selectors=ORIGINS[kind]||{};
  const rows=[...node.querySelectorAll?.('.paa-quest-focus-row')||[]];
  if(!rows.length)return;
  const win=node.ownerDocument.defaultView,style=win.getComputedStyle(node);
  const group=node.querySelector('.paa-quest-focus-rows'),gap=parseFloat(win.getComputedStyle(group).rowGap)||0;
  const top=parseFloat(style.paddingTop)||0,left=parseFloat(style.paddingLeft)||0,right=parseFloat(style.paddingRight)||0;
  const trainingLabel=kind==='practice'?rows.find(row=>row.dataset.questFocusKey==='training')?.firstElementChild:null;
  trainingLabel?.style.setProperty('transition','none');
  node.style.removeProperty('--paa-quest-training-label-offset');
  node.style.setProperty('--paa-quest-rows-left',`${left}px`);
  node.style.setProperty('--paa-quest-rows-right',`${right}px`);
  // Set up start positions without animating from an offset left by a prior
  // visit. All reads and writes happen before the next frame is painted.
  let height=0;
  for(const row of rows){row.style.setProperty('transition','none');row.style.removeProperty('--paa-quest-origin-offset');
    row.style.setProperty('--paa-quest-row-top',`${top+height}px`);height+=row.getBoundingClientRect().height+gap;}
  node.style.setProperty('--paa-quest-rows-height',`${Math.max(0,height-gap)}px`);
  void node.offsetHeight;
  for(const row of rows){
    const selector=selectors[row.dataset.questFocusKey],anchor=selector&&node.querySelector(selector);
    if(!anchor||!row.getBoundingClientRect)continue;
    const delta=anchor.getBoundingClientRect().top-row.getBoundingClientRect().top;
    if(Number.isFinite(delta))row.style.setProperty('--paa-quest-origin-offset',`${delta}px`);
  }
  // The training heading is padded inside its original card. Animate its
  // text as well as the compact row so the two labels meet at the same point.
  const trainingTitle=trainingLabel&&node.querySelector('.paa-practice-training-title');
  if(trainingTitle){
    const delta=trainingTitle.getBoundingClientRect().top-trainingLabel.getBoundingClientRect().top;
    if(Number.isFinite(delta))node.style.setProperty('--paa-quest-training-label-offset',`${delta}px`);
  }
  void node.offsetHeight;
  for(const row of rows)row.style.removeProperty('transition');
  trainingLabel?.style.removeProperty('transition');
}

// All three workbenches share the same viewport bottom, regardless of the
// amount of content above the task card. Keep the rest of the UI mounted.
function createQuestFocus(React){
  const effect=React.useLayoutEffect||React.useEffect;
  return function useQuestFocus(open,hidden,setOpen){
    const ref=React.useRef(null);
    if(!ref.transitionState)ref.transitionState={timer:null,collapsedHeight:null};
    const transitionState=ref.transitionState;
    const change=next=>{
      if(next===open)return;
      const node=ref.current,win=node?.ownerDocument?.defaultView;
      const reduced=win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      const supported=win?.CSS?.supports?.('interpolate-size','allow-keywords');
      if(node&&win&&!reduced&&supported){
        if(transitionState.timer!==null)win.clearTimeout(transitionState.timer);
        if(next){const height=node.querySelector(':scope > .paa-quest-section')?.getBoundingClientRect().height;
          if(Number.isFinite(height)&&height>0)transitionState.collapsedHeight=height;}
        // On close, switching the summary rows to absolute positioning makes
        // their intrinsic height zero. Freeze their current height first, so
        // the task heading does not jump upward before the transition begins.
        const group=!next?node.querySelector('.paa-quest-focus-rows'):null;
        if(group?.style){const height=group.getBoundingClientRect().height;
          if(Number.isFinite(height)){group.style.setProperty('transition','none');group.style.setProperty('height',`${height}px`);}}
        node.style.setProperty('--paa-quest-collapsed-height',`${Math.max(52,transitionState.collapsedHeight||52)}px`);
        node.setAttribute('data-quest-transition','true');
        void node.offsetHeight; // Establish the current geometry before React changes the layout.
        if(group?.style){group.style.removeProperty('height');group.style.removeProperty('transition');void node.offsetHeight;}
        if(next){markOrigins(node);void node.offsetHeight;}
        // CSS transitions start on the next rendered frame, not when the
        // attribute is set. Leave a frame allowance before hiding the old
        // sections so their final padding/border interpolation can finish.
        transitionState.timer=win.setTimeout(()=>{node.removeAttribute('data-quest-transition');node.style.removeProperty('--paa-quest-collapsed-height');transitionState.timer=null;},450);
      }
      setOpen(next);
    };
    effect(()=>{
      const node=ref.current;if(!open||hidden||!node)return;
      const root=node.closest('.paa'),win=node.ownerDocument?.defaultView;
      if(!root||!win)return;
      // Opening from a low task card should reveal the compact sections above it.
      if(root.scrollTo)root.scrollTo({top:0,behavior:win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches?'auto':'smooth'});else root.scrollTop=0;
      const resize=()=>{
        const top=node.getBoundingClientRect().top+root.scrollTop,bottom=Math.min(win.innerHeight,root.getBoundingClientRect().bottom);
        node.style.setProperty('--paa-quest-focus-height',`${Math.max(280,Math.floor(bottom-top-16))}px`);
      };
      resize();win.addEventListener('resize',resize);
      const observer=win.ResizeObserver?new win.ResizeObserver(resize):null;observer?.observe(root);
      return()=>{observer?.disconnect();win.removeEventListener('resize',resize);node.style.removeProperty('--paa-quest-focus-height');};
    },[open,hidden]);
    React.useEffect(()=>()=>{const node=ref.current,win=node?.ownerDocument?.defaultView;if(transitionState.timer!==null)win?.clearTimeout(transitionState.timer);},[]);
    return {ref,change};
  };
}
function rows(h,items,onClose,open){
  return h('div',{className:'paa-quest-focus-rows','aria-hidden':!open,inert:open?undefined:''},...items.map(({key,label,value})=>h('button',{
    key,type:'button',className:'paa-quest-focus-row','data-quest-focus-key':key,'aria-label':`${label}${value?' · '+value:''} · ${t('关闭任务视图')}`,onClick:onClose},
    h('span',null,label),h('span',{className:'paa-quest-focus-value'},value||'—'),
    h('svg',{viewBox:'0 0 16 16','aria-hidden':true},h('path',{d:'m5 6 3 3 3-3'})))));
}
module.exports={createQuestFocus,rows};
