'use strict';
require('../i18n/readability');
require('../shared_catalog');
const i18n=require('../../shared/i18n');
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
      working.current=true;request.current++;setPending(true);onBusyChange?.(true);report(target,'pending',t('正在处理…'));
      try{
        const next=await operation();if(!alive.current)return;
        setStatus(next);
        if(next.maintenance?.failed||next.maintenance?.error)report(target,'error','部分缓存未能清理：'+(next.maintenance.error||`${next.maintenance.failed} 个文件被占用，请稍后重试。`));
        else report(target,'success',message);
      }catch(e){if(alive.current)report(target,'error',e.message);}
      finally{working.current=false;onBusyChange?.(false);if(alive.current)setPending(false);}
    };
    i18n.useLocale(React);const t=i18n.t;
    const value=status?.settings||defaults.normalize(),locked=disabled||pending||!status;
    const change=(patch,target=Object.keys(patch)[0])=>act(target,()=>getController().setComputationSettings(patch),t('已保存，下次计算生效'));
    const clear=kind=>act('clear:'+kind,()=>getController().clearRecommendationCache(kind),t('缓存已清理'));
    const kinds=['results','calculations','gameData','logs'];
    const total=status?.cache&&kinds.every(k=>Number.isFinite(status.cache[k]?.bytes))?
      kinds.reduce((sum,k)=>sum+status.cache[k].bytes,0):null;
    const hasFiles=kinds.some(k=>status?.cache?.[k]?.files>0);
    return h('div',{className:'paa-computation-settings paa-selection-settings','aria-label':t('缓存与计算资源')},
      h('section',{className:'paa-settings-card','aria-label':t('计算')},
        h('div',{className:'paa-settings-section-head'},h('div',{className:'paa-settings-label'},h('h3',null,t('计算')),feedback(React,undefined,{label:t('计算'),text:t('readability.computeHelp')}))),
        h('div',{className:'paa-settings-row paa-resource-control'},h('span',{className:'paa-settings-label'},h('label',{htmlFor:'paa-normal-threads'},t('常规图线程'))),
          h('span',{className:'paa-settings-value'},h('select',{id:'paa-normal-threads','aria-label':t('常规图线程'),value:value.threads,disabled:locked,onChange:e=>change({threads:Number(e.target.value)})},
            h('option',{value:0},t('自动（推荐）')),...Array.from({length:8},(_,i)=>h('option',{key:i+1,value:i+1},t('{n} 线程',{n:i+1})))),feedback(React,feedbacks.threads))),
        h('div',{className:'paa-settings-row paa-resource-control'},h('span',{className:'paa-settings-label'},h('label',{htmlFor:'paa-expedition-threads'},t('远征线程'))),
          h('span',{className:'paa-settings-value'},h('select',{id:'paa-expedition-threads','aria-label':t('远征线程'),value:value.expeditionThreads,disabled:locked,onChange:e=>change({expeditionThreads:Number(e.target.value)})},
            h('option',{value:2},t('2 线程（默认）')),h('option',{value:1},t('1 线程'))),feedback(React,feedbacks.expeditionThreads)))),
      h('section',{className:'paa-settings-card paa-cache-card','aria-label':t('缓存文件')},
        h('div',{className:'paa-settings-section-head'},h('div',{className:'paa-settings-label'},h('h3',null,t('缓存文件')),feedback(React,undefined,{label:t('缓存文件'),text:t('readability.cacheHelp')}))),
        h('div',{className:'paa-cache-list'},
        h('div',{className:'paa-cache-row paa-cache-capacity'},
          h('div',{className:'paa-settings-row paa-resource-control paa-cache-capacity-controls'},h('span',{className:'paa-settings-label'},h('label',{htmlFor:'paa-cache-limit'},t('磁盘缓存上限'))),
            h('span',{className:'paa-settings-value'},h('select',{id:'paa-cache-limit','aria-label':t('磁盘缓存上限'),value:value.cacheLimitMiB,disabled:locked,onChange:e=>change({cacheLimitMiB:Number(e.target.value)})},
              ...defaults.LIMITS.map(n=>h('option',{key:n,value:n},n===defaults.DEFAULTS.cacheLimitMiB?t('{n} MiB（默认）',{n}):`${n} MiB`))),feedback(React,feedbacks.cacheLimitMiB))),
          h('div',{className:'paa-cache-usage-cell'},h('span',{className:'paa-cache-usage'},t('已用 {size}',{size:formatBytes(total)})),feedback(React,feedbacks.read)),
          h('div',{className:'paa-settings-value paa-cache-actions'},h('button',{type:'button','aria-label':t('清理全部缓存'),disabled:locked||status?.busy||!hasFiles,onClick:()=>clear('all')},t('清理全部')),feedback(React,feedbacks['clear:all']))),
        ...[
          ['results','完整推荐'],
          ['calculations','底层计算'],
          ['gameData','游戏数据'],
          ['logs','日志']
        ].map(([kind,label])=>{
          const row=status?.cache?.[kind];
          return h('div',{className:'paa-cache-row paa-cache-entry',key:kind},
            h('div',{className:'paa-settings-label'},h('span',{className:'paa-cache-name'},t('{label}缓存',{label:t(label)})),feedback(React,row?.writeError?{kind:'error',text:row.writeError}:undefined)),
            h('span',{className:'paa-cache-usage','data-tooltip':row?.error||undefined},row?.error?t('读取失败'):row?t('{size} · {n} 个文件',{size:formatBytes(row.bytes),n:row.files}):'—'),
            h('div',{className:'paa-settings-value paa-cache-actions'},h('button',{type:'button',disabled:locked||status?.busy||!row?.files&&!row?.writeError,'aria-label':t('清理{label}缓存',{label:t(label)}),onClick:()=>clear(kind)},t('清理')),feedback(React,feedbacks['clear:'+kind])));
        }))));
  };
};
