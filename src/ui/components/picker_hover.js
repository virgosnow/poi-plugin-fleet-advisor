'use strict';

// Guard accidental clicks immediately after opening; keyboard input stays responsive.
const CLICK_GUARD=200;
const activeByDocument=new WeakMap();

module.exports=function usePickerToggle(React,{enabled,open,anchor,onOpen,onClose}){
  const ref=React.useRef(null);
  if(!ref.current)ref.current={doc:null};
  const state=ref.current;
  Object.assign(state,{enabled,open,anchor,onOpen,onClose});
  const dismiss=()=>{
    if(state.doc&&activeByDocument.get(state.doc)===state)activeByDocument.delete(state.doc);
    state.doc=null;state.open=false;
  };
  state.close=()=>{dismiss();state.onClose();};
  const show=()=>{
    if(!state.enabled||state.open)return;
    const doc=state.anchor.current?.ownerDocument;
    if(doc){const previous=activeByDocument.get(doc);if(previous&&previous!==state)previous.close();
      activeByDocument.set(doc,state);state.doc=doc;}
    state.open=true;state.openedAt=Date.now();state.onOpen();
  };
  const click=()=>{if(!state.enabled)return;if(state.open)state.close();else show();};
  const guardClick=event=>{
    if(state.open&&event.detail!==0&&Date.now()-state.openedAt<CLICK_GUARD){event.preventDefault();event.stopPropagation();}
  };
  React.useEffect(()=>{if(!enabled)dismiss();return dismiss;},[enabled]);
  return {click,guardClick,dismiss};
};
