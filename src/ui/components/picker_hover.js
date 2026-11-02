'use strict';

// Guard accidental clicks immediately after opening; keyboard input stays responsive.
const OPEN_DELAY=400,CLOSE_DELAY=220,CLICK_GUARD=200;
const activeByDocument=new WeakMap();

module.exports=function usePickerHover(React,{enabled,open,anchor,onOpen,onClose}){
  const ref=React.useRef(null);
  if(!ref.current)ref.current={openTimer:null,closeTimer:null,doc:null,source:null};
  const state=ref.current;
  Object.assign(state,{enabled,open,anchor,onOpen,onClose});
  const cancel=()=>{
    if(state.openTimer!==null)clearTimeout(state.openTimer);
    if(state.closeTimer!==null)clearTimeout(state.closeTimer);
    state.openTimer=state.closeTimer=null;
  };
  const dismiss=()=>{
    cancel();
    if(state.doc&&activeByDocument.get(state.doc)===state)activeByDocument.delete(state.doc);
    state.doc=null;state.source=null;state.open=false;
  };
  state.close=()=>{dismiss();state.onClose();};
  const show=source=>{
    if(!state.enabled||state.open)return;
    const doc=state.anchor.current?.ownerDocument;
    if(doc){const previous=activeByDocument.get(doc);if(previous&&previous!==state)previous.close();
      activeByDocument.set(doc,state);state.doc=doc;}
    state.source=source;state.open=true;state.openedAt=Date.now();state.onOpen();
  };
  const enter=event=>{
    if(event.pointerType!=='mouse'||!state.enabled)return;
    if(state.closeTimer!==null){clearTimeout(state.closeTimer);state.closeTimer=null;}
    if(state.open||state.openTimer!==null)return;
    state.openTimer=setTimeout(()=>{state.openTimer=null;show('hover');},OPEN_DELAY);
  };
  const leave=event=>{
    if(event.pointerType!=='mouse')return;
    if(state.openTimer!==null){clearTimeout(state.openTimer);state.openTimer=null;}
    if(!state.open||state.closeTimer!==null)return;
    state.closeTimer=setTimeout(()=>{state.closeTimer=null;state.close();},CLOSE_DELAY);
  };
  const click=()=>{cancel();if(state.open)state.close();else show('click');};
  const guardClick=event=>{
    if(state.open&&event.detail!==0&&Date.now()-state.openedAt<CLICK_GUARD){event.preventDefault();event.stopPropagation();}
  };
  React.useEffect(()=>{if(!enabled)dismiss();return dismiss;},[enabled]);
  return {enter,leave,click,guardClick,dismiss,isHover:()=>state.source==='hover'};
};
