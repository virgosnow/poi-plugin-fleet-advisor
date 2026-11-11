'use strict';
const M=require('../shell/model');
const i18n=require('../../shared/i18n'),{progress:displayProgress}=require('../i18n/execution');
// Clock/progress state lives below the page, never in the workbench's parent.
module.exports=(React,{subscribe,getStore})=>{
  const h=React.createElement;
  return function ExecutionFeedback({running,busy,stopping,status,job,detail,copied,onCopy,progressRef}){
    const [progress,setProgress]=React.useState(''),[elapsed,setElapsed]=React.useState(0);
    React.useEffect(()=>{
      if(!running)return;
      setProgress(job?.progress?displayProgress(job.progress,getStore()):'');
      return subscribe(event=>{
        if(!event.phase)return;
        const state=getStore(),text=M.progressText(event,state);progressRef.current=text;setProgress(displayProgress(event,state));
      });
    },[running,job?.jobId]);
    React.useEffect(()=>{
      if(!busy)return;
      const start=Date.now();setElapsed(0);
      const timer=setInterval(()=>setElapsed((Date.now()-start)/1000),250);
      return()=>clearInterval(timer);
    },[busy]);
    i18n.useLocale(React);const t=i18n.t;
    return h('div',{className:'paa-operation-feedback','data-state':status.state},
      h('p',{role:status.state==='error'?'alert':'status'},running&&status.state!=='error'?
        `${stopping?t('正在停止后续操作'):progress||t('正在执行编成')}${busy?t(' · {seconds} 秒',{seconds:elapsed.toFixed(1)}):''}`:t(status.text)),
      status.state==='error'&&detail?h('details',null,h('summary',null,t('诊断信息')),
        h('button',{type:'button',onClick:()=>onCopy(detail)},t('复制诊断')),copied?h('span',{className:'paa-muted'},t(copied)):null,
        h('pre',null,detail)):null);
  };
};
