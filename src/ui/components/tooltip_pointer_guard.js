'use strict';
const EVENT='paa-tooltip-pointer-guard';
// Closing a popover can expose a tooltip underneath a stationary pointer.
// Only suppress pointer-triggered hints until the user actually moves again.
function guardPointerTooltip(event){
  if(!event||event.detail===0||!Number.isFinite(event.clientX)||!Number.isFinite(event.clientY))return;
  const target=event.currentTarget,CustomEvent=target?.ownerDocument?.defaultView?.CustomEvent;
  if(!target||!CustomEvent)return;
  target.dispatchEvent(new CustomEvent(EVENT,{bubbles:true,detail:{x:event.clientX,y:event.clientY}}));
}
module.exports={EVENT,guardPointerTooltip};
