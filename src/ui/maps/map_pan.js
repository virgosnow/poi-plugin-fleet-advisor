'use strict';
// Keep a gesture on the viewport DOM node so a render during a drag cannot
// reset its origin. Pointer capture allows releasing outside the map safely.
const gestures=new WeakMap();
function finish(event){
  const viewport=event.currentTarget,gesture=gestures.get(viewport);
  if(!gesture||gesture.pointerId!==event.pointerId)return;
  viewport.classList.remove('is-panning');
  if(gesture.moved)gestures.set(viewport,{blockClickUntil:Date.now()+400});
  else gestures.delete(viewport);
  if(viewport.hasPointerCapture?.(event.pointerId))viewport.releasePointerCapture(event.pointerId);
}
function mapPan(enabled){
  if(!enabled)return {};
  return {
    onPointerDown(event){
      if(event.button!==0||event.isPrimary===false)return;
      const viewport=event.currentTarget;
      gestures.delete(viewport);
      if(viewport.scrollWidth<=viewport.clientWidth&&viewport.scrollHeight<=viewport.clientHeight)return;
      gestures.set(viewport,{pointerId:event.pointerId,x:event.clientX,y:event.clientY,
        left:viewport.scrollLeft,top:viewport.scrollTop,moved:false});
    },
    onPointerMove(event){
      const viewport=event.currentTarget,gesture=gestures.get(viewport);
      if(!gesture||gesture.pointerId!==event.pointerId)return;
      if(event.pointerType==='mouse'&&(event.buttons&1)===0){finish(event);return;}
      const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
      if(!gesture.moved){
        if(Math.hypot(dx,dy)<5)return;
        gesture.moved=true;viewport.classList.add('is-panning');
        // Capture only after a drag starts. Capturing on pointerdown would
        // retarget an ordinary node click to the viewport instead of the node.
        try{viewport.setPointerCapture(event.pointerId);}catch(_){/* synthetic events have no active pointer */}
      }
      event.preventDefault();
      viewport.scrollLeft=gesture.left-dx;viewport.scrollTop=gesture.top-dy;
    },
    onPointerUp:finish,onPointerCancel:finish,onLostPointerCapture:finish,
    onClickCapture(event){
      const gesture=gestures.get(event.currentTarget);
      if(event.detail>0&&gesture?.blockClickUntil>=Date.now()){
        event.preventDefault();event.stopPropagation();gestures.delete(event.currentTarget);
      }
    },
    onDragStart(event){event.preventDefault();}
  };
}
module.exports={mapPan};
