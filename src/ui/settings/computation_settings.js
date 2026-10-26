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
        h('div',{className:'paa-settings-section-head'},h('div',{className:'paa-settings-label'},h('h3',null,'缓存文件'),feedback(React,undefined,{label:'缓存文件',text:'各类缓存共用一个磁盘容量上限，空间不足时自动清理较旧的缓存，不按类别分配容量。\n关闭编成方案缓存后，AI 工具不能保存方案；已有方案仍可查询、清理，并继续计入占用。\n日志由实验功能中的性能调试开关控制，最多保留64份、7天。\n清理全部会删除全部缓存和调试日志，不影响游戏舰队、游戏编成预设和插件设置。'}))),
        h('div',{className:'paa-cache-list'},
        h('div',{className:'paa-cache-row paa-cache-capacity'},
          h('div',{className:'paa-settings-row paa-resource-control paa-cache-capacity-controls'},h('span',{className:'paa-settings-label'},h('label',{htmlFor:'paa-cache-limit'},'磁盘缓存上限')),
            h('span',{className:'paa-settings-value'},h('select',{id:'paa-cache-limit','aria-label':'磁盘缓存上限',value:value.cacheLimitMiB,disabled:locked,onChange:e=>change({cacheLimitMiB:Number(e.target.value)})},
              ...defaults.LIMITS.map(n=>h('option',{key:n,value:n},`${n} MiB${n===defaults.DEFAULTS.cacheLimitMiB?'（默认）':''}`))),feedback(React,feedbacks.cacheLimitMiB))),
          h('div',{className:'paa-cache-usage-cell'},h('span',{className:'paa-cache-usage'},`已用 ${formatBytes(total)}`),feedback(React,feedbacks.read)),
          h('div',{className:'paa-settings-value paa-cache-actions'},h('button',{type:'button','aria-label':'清理全部缓存',disabled:locked||status?.busy||!hasFiles,onClick:()=>clear('all')},'清理全部'),feedback(React,feedbacks['clear:all']))),
        ...[
          ['results','resultCache','完整推荐'],
          ['calculations','calculationCache','底层计算'],
          ['schemes','schemeCache','编成方案'],
          ['logs',null,'日志']
        ].map(([kind,key,label])=>{
          const row=status?.cache?.[kind];
          return h('div',{className:'paa-cache-row',key:kind},
            h('div',{className:'paa-settings-label'},key?h('label',{className:'paa-selection-option'},h('input',{type:'checkbox',checked:value[key],disabled:locked,
              'aria-label':'启用'+label+'缓存',onChange:e=>change({[key]:e.target.checked})}),h('span',null,label+'缓存')):
              h('span',{className:'paa-selection-option'},'日志缓存'),feedback(React,row?.writeError?{kind:'error',text:row.writeError}:feedbacks[key])),
            h('span',{className:'paa-cache-usage','data-tooltip':row?.error||undefined},row?.error?'读取失败':row?`${formatBytes(row.bytes)} · ${kind==='schemes'?row.count+' 个方案':row.files+' 个文件'}`:'—'),
            h('div',{className:'paa-settings-value paa-cache-actions'},h('button',{type:'button',disabled:locked||status?.busy||!row?.files&&!row?.writeError,'aria-label':'清理'+label+'缓存',onClick:()=>clear(kind)},'清理'),feedback(React,feedbacks['clear:'+kind])));
        }))));
  };
};
