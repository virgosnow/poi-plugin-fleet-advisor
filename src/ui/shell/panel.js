'use strict';
const M=require('./model'),css=require('./styles');
const {t,useLocale,setLocale,registerCatalog}=require('../../shared/i18n');
const shellCatalog=require('../i18n/shell');
require('../i18n/readability');
registerCatalog('ja',shellCatalog.ja);registerCatalog('zh-TW',shellCatalog.zhTW);
const createWorkbench=require('../workbench/workbench');
const useNavigationMotion=require('./navigation_motion');
// React comes from poi's entry point, keeping a single host React instance.
module.exports=function createPanel(React,{getController,getStore,subscribe,appendLog,getMcpStatus,setMcpEnabled,setMcpHttpPort,setQuestPageActive}){
  const log=entry=>{try{if(appendLog)appendLog(entry);}catch(e){}};
  const h=React.createElement,settingFeedback=require('../settings/settings_feedback');
  const Workbench=createWorkbench(React,{getController,getStore,subscribe,setQuestPageActive});
  const CurrentFleet=require('../fleet/current_fleet')(React,{getStore,setQuestPageActive,getController,subscribe});
  const PracticePage=require('../practice/practice_page')(React,{getStore,setQuestPageActive,getController,subscribe});
  const ExecutionFeedback=require('../components/execution_feedback')(React,{subscribe,getStore});
  const filterSettings=require('../settings/recommendation_settings')(React);
  const experimentalControls=require('../settings/experimental_settings')(React);
  const useTooltip=require('../components/tooltip');
  const ComputationSettings=require('../settings/computation_settings')(React,{getController});
  function PanelContents(){
    const [mode,setMode]=React.useState('manual');
    const [busy,setBusy]=React.useState(false);
    const locale=useLocale(React);
    const [status,setStatus]=React.useState({state:'idle',title:'准备方案',text:'读取当前配置作为起点，或粘贴已有方案。'});
    const [detail,setDetail]=React.useState('');
    const [copied,setCopied]=React.useState('');
    const [mcpEnabled,setMcpEnabledState]=React.useState(()=>getMcpStatus?.()?.mcpEnabled||false);
    const [externalJob,setExternalJob]=React.useState(null);
    const [mcpHttp,setMcpHttp]=React.useState(()=>getMcpStatus?.()?.mcpHttp||null);
    const [portDraft,setPortDraft]=React.useState(()=>String(getMcpStatus?.()?.mcpHttp?.wanted||''));
    const [mcpCopied,setMcpCopied]=React.useState(false);
    const [settingsFeedbacks,setSettingsFeedbacks]=React.useState({});
    const reportSetting=(target,kind,text)=>setSettingsFeedbacks(previous=>({...previous,[target]:{kind,text}}));
    const [resettingSettings,setResettingSettings]=React.useState(false),[resourceBusy,setResourceBusy]=React.useState(false),[resourceEpoch,setResourceEpoch]=React.useState(0);
    const tooltipRoot=React.useRef(null),resetInFlight=React.useRef(false);
    useTooltip(React,tooltipRoot,mode);
    useNavigationMotion(React,tooltipRoot,mode);
    React.useEffect(()=>{
      require('../../host/plugin_title').syncPluginTitle({host:typeof window==='undefined'?null:window,
        document:tooltipRoot.current?.ownerDocument,React,locale});
    },[locale]);
    React.useEffect(()=>{
      const root=tooltipRoot.current;if(!root)return;
      const window=root.ownerDocument.defaultView;let idle;
      const mark=event=>{
        if(event.target!==root)return;
        root.dataset.scrolling='true';window.clearTimeout(idle);
        idle=window.setTimeout(()=>{delete root.dataset.scrolling;},700);
      };
      root.addEventListener('scroll',mark,{passive:true});
      return()=>{root.removeEventListener('scroll',mark);window.clearTimeout(idle);delete root.dataset.scrolling;};
    },[]);
    const [draftEpoch,setDraftEpoch]=React.useState(0);
    const [questNavigation,setQuestNavigation]=React.useState(null);
    const [recommendationFilters,setRecommendationFilters]=React.useState(()=>getController()?.getRecommendationFilters?.()||require('../../config/recommendation_filters').normalize());
    const [experimentalSettings,setExperimentalSettings]=React.useState(()=>getController()?.getExperimentalSettings?.()||require('../../config/experimental_settings').normalize());
    const copyMcpAddress=async text=>{
      const document=tooltipRoot.current?.ownerDocument,navigator=document?.defaultView?.navigator;
      try{await navigator.clipboard.writeText(text);}
      catch(e){
        try{
          const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);
          ta.select();document.execCommand('copy');ta.remove();
        }catch(e2){return;}
      }
      setMcpCopied(true);setTimeout(()=>setMcpCopied(false),2500);
    };
    const active=React.useRef(false),stopped=React.useRef(false),mounted=React.useRef(true),progressRef=React.useRef(''),executionPlan=React.useRef(null);
    const stopButton=React.useRef(null),returnFocus=React.useRef(null),workspace=React.useRef(null),questNavigationId=React.useRef(0),running=busy||!!externalJob;
    React.useEffect(()=>{
      const document=workspace.current?.ownerDocument||tooltipRoot.current?.ownerDocument;if(!document)return;
      if(running){
        if(mode==='settings'){setMode('manual');return;}
        if(document.activeElement!==document.body&&document.activeElement!==stopButton.current)returnFocus.current=document.activeElement;
        // Inert every sibling along the stop button's ancestor path, so the
        // original apply button remains usable without duplicating/portaling it.
        const previous=new Map();
        const lock=()=>{
          for(let node=stopButton.current;node&&node!==workspace.current;node=node.parentElement){
            for(const sibling of node.parentElement?.children||[]){
              if(sibling===node)continue;
              if(!previous.has(sibling))previous.set(sibling,sibling.inert);
              if(!sibling.inert)sibling.inert=true;
            }
          }
        };
        lock();const observer=new document.defaultView.MutationObserver(lock);
        if(workspace.current)observer.observe(workspace.current,{childList:true,subtree:true});
        // The apply button becomes the stop button in place. Moving focus to
        // the workspace prevents unrelated Enter/Space presses from stopping
        // an operation; Tab still reaches the enabled stop button.
        workspace.current?.focus({preventScroll:true});
        return()=>{observer.disconnect();for(const [node,inert] of previous)node.inert=inert;};
      }else if(returnFocus.current){
        if(returnFocus.current.isConnected)returnFocus.current.focus({preventScroll:true});
        returnFocus.current=null;
      }
    },[running,mode]);
    React.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
    React.useEffect(()=>{
      if(!getMcpStatus)return;
      const refresh=()=>{
        const service=getController();if(!service)return;
        const current=getMcpStatus();setMcpEnabledState(current.mcpEnabled);
        const experiments=current.experimentalSettings||service.getExperimentalSettings?.()||require('../../config/experimental_settings').normalize();
        setExperimentalSettings(previous=>JSON.stringify(previous)===JSON.stringify(experiments)?previous:experiments);
        const http=current.mcpHttp||null;setMcpHttp(previous=>JSON.stringify(previous)===JSON.stringify(http)?previous:http);
        const id=current.activeJobId;
        const currentJob=id&&service.getJob?service.getJob({jobId:id}):null;
        // Local runs already own busy; a polled copy would delay their finish.
        const job=currentJob?.source==='panel'?null:currentJob;
        setExternalJob(previous=>previous?.jobId===job?.jobId&&previous?.state===job?.state?previous:job);
      };
      refresh();const timer=setInterval(refresh,1000);return()=>clearInterval(timer);
    },[]);
    const reset=()=>{setDetail('');progressRef.current='';setStatus({state:'idle',title:'准备方案',text:''});};
    const home=()=>{
      if(running||active.current||getMcpStatus?.()?.activeJobId)return;
      reset();setCopied('');setSettingsFeedbacks({});setMcpCopied(false);
      setPortDraft(String(getMcpStatus?.()?.mcpHttp?.wanted||''));
      setQuestNavigation(null);setMode('manual');setDraftEpoch(value=>value+1);
      workspace.current?.closest('.paa')?.scrollIntoView({block:'start'});
    };
    const fail=error=>{setStatus({state:'error',title:'未能完成',text:error.message});setDetail(error.stack||error.message);};
    const navigateQuest=destination=>{
      if(running||active.current||!destination?.code||!['normal','expedition','practice'].includes(destination.kind))return;
      setQuestNavigation({...destination,id:++questNavigationId.current});setMode(destination.kind);reset();
    };
    const copyDetail=async text=>{
      const document=tooltipRoot.current?.ownerDocument,navigator=document?.defaultView?.navigator;
      try{await navigator.clipboard.writeText(text);setCopied('已复制到剪贴板');}
      catch(e){
        try{
          const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);
          ta.select();document.execCommand('copy');ta.remove();setCopied('已复制到剪贴板');
        }catch(e2){setCopied('复制失败，请在下方详细信息中手动选择');}
      }
      setTimeout(()=>setCopied(''),2500);
    };
    const action=async(execute,source,options)=>{
      if(execute&&!experimentalSettings.automaticOperations)return false;
      if(active.current||getMcpStatus?.()?.activeJobId)return false;
      stopped.current=false;
      let outcome=status,diagnostic=detail;
      const reportStatus=value=>{outcome=value;setStatus(value);};
      const reportDetail=value=>{diagnostic=value;setDetail(value);};
      try {
        const controller=getController();if(!controller)throw Error('插件尚未启用，请在 poi 插件设置中检查状态。');
        const input=M.parse(source);if(input.error)throw Error('JSON 格式有误：'+input.error);
        const plan=controller.preview('fleet',input.value,options);
        reportDetail(M.format(plan));progressRef.current='';
        if(!execute){reportStatus({state:'preview',title:plan.done?'已符合方案':'预览已就绪',text:'预览未修改游戏；执行时会重新核对实时状态。'});return true;}
        returnFocus.current=tooltipRoot.current?.ownerDocument.activeElement;
        executionPlan.current={fleet:plan.fleet||input.value.fleet,targets:plan.organization?.targets||input.value.ships.map(s=>typeof s==='number'?s:s.id)};
        active.current=true;stopped.current=false;setBusy(true);
        reportStatus({state:'running',title:'正在执行',text:'正在准备识别与操作环境。'});
        const result=await controller.run('fleet',input.value,options);
        if(!mounted.current)return;
        reportDetail(M.format(result));
        if(result.ok&&result.done){reportStatus({state:'success',title:result.changed?'配置已完成':'已符合方案，无需变更',text:`已完成 ${result.changed||0} 次变更${result.metrics?` · ${(result.metrics.totalMs/1000).toFixed(1)} 秒`:''}`});}
        else throw Error('执行未返回完成状态，请查看诊断信息。');
        return true;
      }catch(error){if(mounted.current){if(stopped.current){reportStatus({state:'stopped',title:'已停止后续操作',text:'已发送的变更可能已经生效，请核对当前舰队与装备。'});reportDetail(error.stack||error.message);}else {reportStatus({state:'error',title:'未能完成',text:error.message});reportDetail(error.stack||error.message);}}return false;}
      finally{
        active.current=false;if(mounted.current)setBusy(false);
        log({time:new Date().toISOString(),kind:'fleet',scheme:source.slice(0,4000),status:outcome.state+' · '+outcome.title+' · '+outcome.text,detail:diagnostic.slice(0,8000),progress:progressRef.current});
      }
    };
    const stop=event=>{
      const native=event?.nativeEvent||event;
      try{getController()?.recordDiagnostic?.({phase:'execution',stage:'stop-request',source:'panel',page:mode,
        trusted:typeof native?.isTrusted==='boolean'?native.isTrusted:null,
        detail:Number.isFinite(native?.detail)?native.detail:null,
        pointerType:typeof native?.pointerType==='string'?native.pointerType:null});}catch(_){}
      if(!active.current&&externalJob?.source==='mcp'){
        if(externalJob.state==='stopping')return;
        try{getController()?.cancelJob({jobId:externalJob.jobId});setExternalJob(previous=>previous?{...previous,state:'stopping'}:previous);}catch(error){fail(error);}
        return;
      }
      if(!active.current||stopped.current)return;
      try{getController()?.stop();stopped.current=true;setStatus({state:'stopping',title:'正在停止',text:'正在结束后续操作并释放资源。'});}catch(error){fail(error);}
    };
    const resetSettings=async()=>{
      if(running||resourceBusy||resetInFlight.current)return;
      resetInFlight.current=true;setResettingSettings(true);reportSetting('reset','pending','正在恢复默认…');
      try{
        const result=await getController().resetRecommendationSettings();if(!mounted.current)return;
        setRecommendationFilters(result.filters);setResourceEpoch(v=>v+1);
        const maintenance=result.computation.maintenance;
        setSettingsFeedbacks(previous=>Object.fromEntries(Object.entries(previous).filter(([key])=>key.startsWith('agent'))));
        reportSetting('reset',maintenance?.failed||maintenance?.error?'error':'success',maintenance?.failed||maintenance?.error?
          '默认设置已恢复，部分缓存未能整理：'+(maintenance.error||`${maintenance.failed} 个文件被占用`):'已恢复出击、远征、演习、计算和缓存默认设置');
      }catch(e){if(mounted.current)reportSetting('reset','error',e.message);}
      finally{resetInFlight.current=false;if(mounted.current)setResettingSettings(false);}
    };
    const stopping=status.state==='stopping'||externalJob?.state==='stopping';
    const feedback=running||['error','success','stopped'].includes(status.state)?h(ExecutionFeedback,
      {running,busy,stopping,status,job:externalJob,detail,copied,onCopy:copyDetail,progressRef}):null;
    return h('section',{className:'paa',ref:tooltipRoot,'aria-label':t('舰队参谋')},
      h('style',null,css),
      h('div',{className:'paa-masthead','data-running':running},
      h('nav',{className:'paa-tabs','aria-label':t('编成方式')},
        h('button',{type:'button',className:'paa-home-toggle','aria-label':t('回到主页'),'data-tooltip':t('回到主页：重置三页临时选项与编成'),disabled:running,onClick:home},
          h('svg',{width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},
            h('path',{d:'m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9'}))),
        h('span',{className:'paa-tab-indicator','aria-hidden':true}),
        ...[['manual','当前舰队'],['normal','常规海域'],['expedition','远征'],['practice','演习']].map(([value,label])=>
          h('button',{key:value,type:'button','aria-pressed':mode===value,disabled:busy||!!externalJob,
            onClick:()=>{setMode(value);if(mode!=='settings')reset();}},t(label))),
        h('div',{className:'paa-settings-tools',role:'group','aria-label':t('设置操作'),'data-expanded':mode==='settings'},
        h('button',{type:'button',className:'paa-settings-toggle','aria-label':t('设置'),'data-tooltip':t('设置'),'aria-pressed':mode==='settings',disabled:busy||!!externalJob,onClick:()=>setMode('settings')},
          h('svg',{width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},
            h('path',{d:'M9.5 3h5l.6 2.4 1.5.9 2.4-.7 2.5 4.3-1.8 1.7v1.8l1.8 1.7-2.5 4.3-2.4-.7-1.5.9-.6 2.4h-5l-.6-2.4-1.5-.9-2.4.7-2.5-4.3 1.8-1.7v-1.8L2 9.9l2.5-4.3 2.4.7 1.5-.9z'}),h('circle',{cx:12,cy:12,r:3})),...(mode==='settings'?[t('设置')]:[])),
        ...(mode==='settings'?[h('div',{className:'paa-settings-reset-actions'},
          h('button',{type:'button',className:'paa-settings-reset','aria-label':t('恢复默认设置'),'data-tooltip':t('恢复默认：恢复出击、远征、演习、计算和缓存设置，不改变实验功能开关和 MCP 端口。'),disabled:running||resettingSettings||resourceBusy,onClick:resetSettings},
            h('svg',{width:18,height:18,viewBox:'0 0 20 20',fill:'none',stroke:'currentColor',strokeWidth:1.5,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},
              h('path',{d:'M4 7a6 6 0 1 1 0 6M4 3v4h4'})),t('恢复默认')),
          settingFeedback(React,settingsFeedbacks.reset))]:[])))),
      h('div',{className:'paa-workspace','aria-busy':running},
      h('div',{className:'paa-workspace-content',ref:workspace,tabIndex:-1},
      ...['normal','practice','expedition','manual'].map(kind=>h(kind==='manual'?CurrentFleet:kind==='practice'?PracticePage:Workbench,{key:`${kind}:${draftEpoch}`,kind,locale,automaticFilters:recommendationFilters[kind],automaticOperations:experimentalSettings.automaticOperations,hidden:mode!==kind,busy:running,stopping,onStop:stop,stopButtonRef:mode===kind?stopButton:undefined,operationFeedback:mode===kind?feedback:null,executionPlan:busy?executionPlan.current:null,onNavigateQuest:navigateQuest,...(kind!=='manual'?{onApply:(candidate,options)=>action(true,M.format(candidate),options),navigationIntent:questNavigation?.kind===kind?questNavigation:null}:{})})),
      h('section',{className:'paa-settings-page',hidden:mode!=='settings','aria-label':t('设置面板')},
      h('section',{className:'paa-settings-card'},h('div',{className:'paa-settings-row'},
        h('label',{className:'paa-settings-label',htmlFor:'paa-language'},t('语言')),
        h('div',{className:'paa-settings-value'},h('select',{id:'paa-language',value:locale,disabled:running,'aria-label':t('语言设置'),onChange:event=>{
          try{const language=getController()?.setLanguage?.(event.target.value);if(language){setLocale(language);reportSetting('language','success',t('已保存'));}}
          catch(e){reportSetting('language','error',e.message);}
        }},h('option',{value:'zh-CN'},'简体中文'),h('option',{value:'zh-TW'},'繁體中文'),h('option',{value:'ja-JP'},'日本語')),settingFeedback(React,settingsFeedbacks.language)))),
      filterSettings({value:recommendationFilters,disabled:running||resettingSettings,feedbacks:settingsFeedbacks,onChange:(value,target)=>{
        try{setRecommendationFilters(getController().setRecommendationFilters(value));reportSetting(target,'success',t('已保存'));}
        catch(e){reportSetting(target,'error',e.message);}
      }}),
      h(ComputationSettings,{key:resourceEpoch,active:mode==='settings',disabled:running||resettingSettings,onBusyChange:setResourceBusy}),
      experimentalControls({value:experimentalSettings,disabled:running||resettingSettings,
        statuses:{automaticOperations:settingsFeedbacks['experimental.automaticOperations'],operationWaitMs:settingsFeedbacks['experimental.operationWaitMs']},onChange:value=>{
        const target='experimental.'+Object.keys(value)[0];
        try{setExperimentalSettings(getController().setExperimentalSettings(value));reportSetting(target,'success',t('已保存'));}
        catch(e){reportSetting(target,'error',e.message);}
      },mcpControls:getMcpStatus?h('section',{className:'paa-experimental-mcp','aria-label':t('AI 工具接入（MCP）')},
        h('div',{className:'paa-settings-row paa-experimental-mcp-head'},
          h('div',{className:'paa-settings-label'},h('span',null,t('AI 工具接入（MCP）')),settingFeedback(React,undefined,{label:t('AI 工具接入（MCP）'),text:t('readability.mcpHelp')})),
          h('div',{className:'paa-settings-value'},h('button',{type:'button',role:'switch','aria-checked':String(mcpEnabled),className:'paa-switch',disabled:busy||settingsFeedbacks.agentSwitch?.kind==='pending',
            'aria-label':t('MCP 接入开关'),onClick:()=>{
              reportSetting('agentSwitch','pending',t('正在保存…'));
              Promise.resolve().then(()=>setMcpEnabled?.(!mcpEnabled))
                .then(()=>reportSetting('agentSwitch','success',t('已保存')))
                .catch(error=>reportSetting('agentSwitch','error',error.message));
            }},
            h('span',{className:'paa-switch-track','aria-hidden':true},h('span',{className:'paa-switch-knob'})),
            h('span',{className:'paa-switch-label'},t(mcpEnabled?'已开启':'已关闭'))),settingFeedback(React,settingsFeedbacks.agentSwitch))),
        h('div',{className:'paa-agent-connection'},
          h('div',{className:'paa-settings-row paa-agent-port'},
            h('label',{htmlFor:'paa-agent-http-port',className:'paa-agent-label'},t('HTTP 端口')),
            h('div',{className:'paa-agent-control'},
              h('input',{id:'paa-agent-http-port',type:'number',min:1,max:65535,value:portDraft,disabled:busy||settingsFeedbacks.agentPort?.kind==='pending','aria-label':t('MCP HTTP 端口'),onChange:e=>setPortDraft(e.target.value)}),
              h('button',{type:'button',disabled:busy||!portDraft||settingsFeedbacks.agentPort?.kind==='pending',onClick:()=>{
                reportSetting('agentPort','pending',t('正在保存…'));
                const port=Number(portDraft);
                Promise.resolve().then(()=>setMcpHttpPort(port))
                  .then(applied=>reportSetting('agentPort','success',t(applied&&applied.active?'端口已保存并生效。':'端口已保存，将在开启 MCP 后生效。')))
                  .catch(error=>reportSetting('agentPort','error',error.message));
              }},t('应用端口')),settingFeedback(React,settingsFeedbacks.agentPort))),
          h('div',{className:'paa-settings-row paa-agent-endpoint'},
            h('span',{className:'paa-settings-label'},h('span',{className:'paa-agent-label'},t('连接地址'))),
            h('div',{className:'paa-agent-address','data-active':!!(mcpEnabled&&mcpHttp?.active&&mcpHttp?.address)},
              mcpEnabled&&mcpHttp?.active&&mcpHttp?.address?
                h(React.Fragment,null,h('code',null,mcpHttp.address),
                  h('button',{type:'button',onClick:()=>{void copyMcpAddress(mcpHttp.address);}},t(mcpCopied?'已复制':'复制地址'))):
                h('span',{className:mcpEnabled&&mcpHttp?.error?'paa-error paa-agent-connection-error':'paa-muted','data-tooltip':mcpEnabled?mcpHttp?.error:undefined,role:mcpEnabled&&mcpHttp?.error?'alert':undefined},mcpEnabled?(mcpHttp?.error||t('正在准备连接…')):t('开启后显示连接地址')))))):null}))),
      running?h('div',{className:'paa-run-mask','aria-hidden':true}):null));
  }
  // poi can render its plugin host after every game response. This panel does
  // not consume host props; its own subscriptions update the relevant data.
  if(!React.memo)return PanelContents;
  const StablePanel=React.memo(PanelContents);
  return function FleetAdvisorPanel(){return h(StablePanel);};
};
