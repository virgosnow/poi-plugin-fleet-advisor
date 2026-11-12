'use strict';

// The lightweight UI tests render element trees without React DOM. Give the
// independently stateful virtual list its own hooks, like a mounted component.
module.exports=function inlineTrainingList(React){
  const create=React.createElement;let states=[],refs=[],seen=false;
  React.createElement=(type,props,...children)=>{
    if(typeof type!=='function'||type.name!=='TrainingList')return create(type,props,...children);
    seen=true;let stateIndex=0,refIndex=0;const oldState=React.useState,oldRef=React.useRef;
    React.useState=initial=>{const i=stateIndex++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;
      return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];};
    React.useRef=initial=>{const i=refIndex++;return refs[i]||(refs[i]={current:initial});};
    try{return type(props||{});}finally{React.useState=oldState;React.useRef=oldRef;}
  };
  return render=>{seen=false;const tree=render();if(!seen){states=[];refs=[];}return tree;};
};
