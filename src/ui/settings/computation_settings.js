'use strict';
const defaults=require('../../config/computation_settings');
const formatBytes=bytes=>bytes===null||bytes===undefined?'—':bytes<1024?`${bytes} B`:bytes<1024*1024?`${(bytes/1024).toFixed(1)} KiB`:`${(bytes/1024/1024).toFixed(1)} MiB`;
module.exports=(React,{getController})=>{
  const h=React.createElement,feedback=require('./settings_feedback');
  return function ComputationSettings({active,disabled,onBusyChange}){
    const [status,setStatus]=React.useState(null),[pending,setPending]=React.useState(false),[feedbacks,setFeedbacks]=React.useState({});
    const report=(target,kind,text)=>setFeedbacks(previous=>({...previous,[target]:{kind,text}}));
    const alive=React.useRef(false),working=React.useRef(false),request=React.useRef(0);
    React.useEffect(()=>{
      alive.current=true;return()=>{alive.current=false;request.current++;};
    },[]);
    React.useEffect(()=>{
      if(!active)return;
      let stopped=false;
      const refresh=async()=>{
        if(working.current)return;
        const id=++request.current;
        try{const next=await getController().getComputationStatus();if(!stopped&&alive.current&&id===request.current){setStatus(next);setFeedbacks(previous=>({...previous,read:undefined}));}}
        catch(e){if(!stopped&&alive.current&&id===request.current)report('read','error',e.message);}
      };
      refresh();const timer=setInterval(refresh,3000);
      return()=>{stopped=true;clearInterval(timer);request.current++;};
    },[active]);
    const act=async(target,operation,message)=>{
      if(working.current||disabled)return;
      working.current=true;request.current++;setPending(true);onBusyChange?.(true);report(target,'pending','正在处理…');
      try{
        const next=await operation();if(!alive.current)return;
        setStatus(next);
        if(next.maintenance?.failed||next.maintenance?.error)report(target,'error','部分缓存未能清理：'+(next.maintenance.error||`${next.maintenance.failed} 个文件被占用，请稍后重试。`));
        else report(target,'success',message);
      }catch(e){if(alive.current)report(target,'error',e.message);}
      finally{working.current=false;onBusyChange?.(false);if(alive.current)setPending(false);}
    };
    const value=status?.settings||defaults.normalize(),locked=disabled||pending||!status;
    const change=(patch,target=Object.keys(patch)[0])=>act(target,()=>getController().setComputationSettings(patch),'已保存，下次计算生效');
    const clear=kind=>act('clear:'+kind,()=>getController().clearRecommendationCache(kind),'缓存已清理');
    const kinds=['results','calculations','schemes','logs'];
    const total=status?.cache&&kinds.every(k=>Number.isFinite(status.cache[k]?.bytes))?
      kinds.reduce((sum,k)=>sum+status.cache[k].bytes,0):null;
    const hasFiles=kinds.some(k=>status?.cache?.[k]?.files>0);
    return h('div',{className:'paa-computation-settings paa-selection-settings','aria-label':'缓存与计算资源'},
      h('section',{className:'paa-settings-card','aria-label':'计算'},
        h('div',{className:'paa-settings-section-head'},h('div',{className:'paa-settings-label'},h('h3',null,'计算'),feedback(React,undefined,{label:'计算',text:'通常保持默认即可。增加线程有时能算得更快，也会更占电脑资源。\n如果计算时有些卡顿，可以调低线程数，不会降低推荐质量。'}))),
        h('div',{className:'paa-settings-row paa-resource-control'},h('span',{className:'paa-settings-label'},h('label',{htmlFor:'paa-normal-threads'},'常规图线程')),
          h('span',{className:'paa-settings-value'},h('select',{id:'paa-normal-threads','aria-label':'常规图线程',value:value.threads,disabled:locked,onChange:e=>change({threads:Number(e.target.value)})},
            h('option',{value:0},'自动（推荐）'),...Array.from({length:8},(_,i)=>h('option',{key:i+1,value:i+1},`${i+1} 线程`))),feedback(React,feedbacks.threads))),
        h('div',{className:'paa-settings-row paa-resource-control'},h('span',{className:'paa-settings-label'},h('label',{htmlFor:'paa-expedition-threads'},'远征线程')),
          h('span',{className:'paa-settings-value'},h('select',{id:'paa-expedition-threads','aria-label':'远征线程',value:value.expeditionThreads,disabled:locked,onChange:e=>change({expeditionThreads:Number(e.target.value)})},
            h('option',{value:2},'2 线程（默认）'),h('option',{value:1},'1 线程')),feedback(React,feedbacks.expeditionThreads)))),
      h('section',{className:'paa-settings-card paa-cache-card','aria-label':'缓存文件'},
        h('div',{className:'paa-settings-section-head'},h('div',{className:'paa-settings-label'},h('h3',null,'缓存文件'),feedback(React,undefined,{label:'缓存文件',text:'各类缓存共用一个磁盘容量上限，完整推荐、底层计算和编成方案缓存保持启用。\n日志由性能调试开关控制，关闭后保留已有日志。\n清理只移除本地缓存与日志，不影响游戏舰队、游戏编成预设或设置。'}))),
        h('div',{className:'paa-cache-list'},
        h('div',{className:'paa-cache-row paa-cache-capacity'},
          h('div',{className:'paa-settings-row paa-resource-control paa-cache-capacity-controls'},h('span',{className:'paa-settings-label'},h('label',{htmlFor:'paa-cache-limit'},'磁盘缓存上限')),
            h('span',{className:'paa-settings-value'},h('select',{id:'paa-cache-limit','aria-label':'磁盘缓存上限',value:value.cacheLimitMiB,disabled:locked,onChange:e=>change({cacheLimitMiB:Number(e.target.value)})},
              ...defaults.LIMITS.map(n=>h('option',{key:n,value:n},`${n} MiB${n===defaults.DEFAULTS.cacheLimitMiB?'（默认）':''}`))),feedback(React,feedbacks.cacheLimitMiB))),
          h('div',{className:'paa-cache-usage-cell'},h('span',{className:'paa-cache-usage'},`已用 ${formatBytes(total)}`),feedback(React,feedbacks.read)),
          h('div',{className:'paa-settings-value paa-cache-actions'},h('button',{type:'button','aria-label':'清理全部缓存',disabled:locked||status?.busy||!hasFiles,onClick:()=>clear('all')},'清理全部'),feedback(React,feedbacks['clear:all']))),
        ...[
          ['results','完整推荐'],
          ['calculations','底层计算'],
          ['schemes','编成方案'],
          ['logs','日志']
        ].map(([kind,label])=>{
          const row=status?.cache?.[kind];
          return h('div',{className:'paa-cache-row paa-cache-entry',key:kind},
            h('div',{className:'paa-settings-label'},h('span',{className:'paa-cache-name'},label+'缓存'),feedback(React,row?.writeError?{kind:'error',text:row.writeError}:undefined)),
            h('span',{className:'paa-cache-usage','data-tooltip':row?.error||undefined},row?.error?'读取失败':row?`${formatBytes(row.bytes)} · ${kind==='schemes'?row.count+' 个方案':row.files+' 个文件'}`:'—'),
            h('div',{className:'paa-settings-value paa-cache-actions'},h('button',{type:'button',disabled:locked||status?.busy||!row?.files&&!row?.writeError,'aria-label':'清理'+label+'缓存',onClick:()=>clear(kind)},'清理'),feedback(React,feedbacks['clear:'+kind])));
        }))));
  };
};
