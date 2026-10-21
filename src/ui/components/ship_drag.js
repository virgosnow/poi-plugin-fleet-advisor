'use strict';
// Pointer-based drag keeps interactive controls clickable and previews the swap.
module.exports=function shipDrag(root,onSwap,disabled=false){
  if(!root||disabled)return ()=>{};
  const document=root.ownerDocument,window=document.defaultView;
  let drag=null;
  const clear=()=>{if(!drag)return;drag.ghost?.remove();drag.card.classList.remove('is-dragging');
    root.querySelectorAll('.is-drop-target').forEach(x=>x.classList.remove('is-drop-target'));drag=null;};
  const down=e=>{
    const card=e.target.closest('[data-fleet-slot]');
    if(e.button!==0||!card||!root.contains(card)||card.dataset.empty==='true'||e.target.closest('button,input,select,textarea,a,summary'))return;
    drag={card,index:Number(card.dataset.fleetSlot),x:e.clientX,y:e.clientY,
      lastX:e.clientX,lastY:e.clientY,rect:card.getBoundingClientRect(),pointer:e.pointerId,target:null};
  };
  const updateTarget=()=>{
    if(!drag?.ghost)return;
    const over=document.elementFromPoint(drag.lastX,drag.lastY)?.closest('[data-fleet-slot]');
    root.querySelectorAll('.is-drop-target').forEach(x=>x.classList.remove('is-drop-target'));
    drag.target=over&&root.contains(over)&&over!==drag.card&&over.dataset.empty!=='true'?Number(over.dataset.fleetSlot):null;
    if(drag.target!==null)over.classList.add('is-drop-target');
    drag.hint.textContent=drag.target===null?'拖动调整顺序':`与第 ${drag.target+1} 位交换`;
  };
  const move=e=>{
    if(!drag||e.pointerId!==drag.pointer)return;
    drag.lastX=e.clientX;drag.lastY=e.clientY;
    if(!drag.ghost&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<6)return;
    e.preventDefault();
    if(!drag.ghost){
      // Preserve the grab offset even if the page scrolled since pointerdown.
      const rect=drag.rect,ghost=drag.card.cloneNode(true);
      ghost.classList.add('paa-drag-ghost');ghost.setAttribute('aria-hidden','true');
      ghost.querySelectorAll('[id]').forEach(x=>x.removeAttribute('id'));
      Object.assign(ghost.style,{position:'fixed',width:rect.width+'px',height:rect.height+'px',left:rect.left+'px',top:rect.top+'px',pointerEvents:'none',zIndex:'2147483000'});
      const style=window.getComputedStyle(root.closest('.paa'));for(const name of ['bg','card','line','text','muted','accent','soft','good','bad'])ghost.style.setProperty('--paa-'+name,style.getPropertyValue('--paa-'+name));
      const hint=document.createElement('span');hint.className='paa-drag-hint';ghost.appendChild(hint);
      document.body.appendChild(ghost);drag.ghost=ghost;drag.hint=hint;drag.card.classList.add('is-dragging');
    }
    drag.ghost.style.transform=`translate(${e.clientX-drag.x}px,${e.clientY-drag.y}px) rotate(1deg)`;
    updateTarget();
  };
  const up=e=>{
    if(!drag||e.pointerId!==drag.pointer)return;
    // Scroll events may still be queued when the pointer is released.
    drag.lastX=e.clientX;drag.lastY=e.clientY;updateTarget();
    const {index,target}=drag;clear();if(target!==null)onSwap(index,target);
  };
  const key=e=>{if(e.key==='Escape')clear();};
  // Capture nested scrolling too; the pointer can stay still while cards move.
  window.addEventListener('scroll',updateTarget,true);
  root.addEventListener('pointerdown',down);window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',up);window.addEventListener('pointercancel',clear);window.addEventListener('blur',clear);window.addEventListener('keydown',key);
  return ()=>{clear();window.removeEventListener('scroll',updateTarget,true);root.removeEventListener('pointerdown',down);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',clear);window.removeEventListener('blur',clear);window.removeEventListener('keydown',key);};
};
