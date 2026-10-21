'use strict';
const M=require('../shell/model');
// Clock/progress state lives below the page, never in the workbench's parent.
module.exports=(React,{subscribe,getStore})=>{
  const h=React.createElement;
  return function ExecutionFeedback({running,busy,stopping,status,job,detail,copied,onCopy,progressRef}){
    const [progress,setProgress]=React.useState(''),[elapsed,setElapsed]=React.useState(0);
    React.useEffect(()=>{
      if(!running)return;
      setProgress(job?.progress?M.progressText(job.progress,getStore()):'');
      return subscribe(event=>{
        if(!event.phase)return;
        const text=M.progressText(event,getStore());progressRef.current=text;setProgress(text);
      });
    },[running,job?.jobId]);
    React.useEffect(()=>{
      if(!busy)return;
      const start=Date.now();setElapsed(0);
      const timer=setInterval(()=>setElapsed((Date.now()-start)/1000),250);
      return()=>clearInterval(timer);
    },[busy]);
    return h('div',{className:'paa-operation-feedback','data-state':status.state},
      h('p',{role:status.state==='error'?'alert':'status'},running&&status.state!=='error'?
        `${stopping?'正在停止后续操作':progress||'正在执行编成'}${busy?` · ${elapsed.toFixed(1)} 秒`:''}`:status.text),
      status.state==='error'&&detail?h('details',null,h('summary',null,'诊断信息'),
        h('button',{type:'button',onClick:()=>onCopy(detail)},'复制诊断'),copied?h('span',{className:'paa-muted'},copied):null,
        h('pre',null,detail)):null);
  };
};
