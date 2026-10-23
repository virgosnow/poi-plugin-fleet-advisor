'use strict';
const W=require('./workbench_model'),V=require('../models/presentation_model');
const E=require('../expedition/expedition_model');
const {fleetMechanisms,fleetSpeed,aircraftCapacity}=require('../../domain/combat/ship_mechanisms');
const routePreview=require('../maps/route_preview'),shipDrag=require('../components/ship_drag');
const {retain,hiddenPage}=require('../components/retained_view');
const blank=()=>Array(6).fill(null),pad=rows=>rows.concat(Array(Math.max(0,6-rows.length)).fill(null));
module.exports=function createWorkbench(React,{getController,getStore,subscribe,setQuestPageActive}){
  const expeditionView=require('../expedition/expedition_view')(React);
  const h=React.createElement,EquipmentIcon=require('../components/equipment_icon')(React);
  const mechanismBadges=require('../components/mechanism_badges')(React);
  const ExecutionCard=require('../components/execution_card')(React,{subscribe,getStore});
  const QuestSection=require('../components/quest_section')(React);
  const AreaPicker=require('../components/area_picker')(React);
  const useMapLoading=require('../maps/map_loading')(React,{getStore});
  const summaryMetric=(reading,kind)=>{
    const good=kind==='air'?/^全程空/.test(reading.state):['索敌达标','无需索敌'].includes(reading.state);
    const warning=reading.bad||reading.uncertain||reading.state==='估算达标';
    const tone=warning?'warning':good?reading.state==='全程空确'?'green':kind==='air'?'blue':'green':'neutral';
    const icon=h('svg',{viewBox:'0 0 16 16','aria-hidden':true},warning?
      h('path',{d:'M8 2 15 14H1ZM8 6v4m0 2v.1'}):
      [h('circle',{key:'circle',cx:8,cy:8,r:6}),h('path',{key:'mark',d:good?'m5 8 2 2 4-4':'M5 8h6'})]);
    return h('div',{className:'paa-wb-metric '+kind+(reading.bad?' insufficient':''),'data-tone':tone,
      'data-tooltip':[reading.hint,reading.detail].filter(Boolean).join('\n'),
      'aria-label':`${kind==='air'?'制空':'33式索敌'} ${reading.value}，${reading.state}`},
      h('span',{className:'paa-wb-metric-state'},icon,reading.state),
      h('strong',{'data-label':kind==='air'?'我方':'33 式'},reading.value),
      h('small',null,reading.compactHint||reading.hint));
  };
  const arrivalIcon=tone=>['good','warning'].includes(tone)?h('svg',{className:'paa-wb-arrival-icon','data-kind':tone==='good'?'check':'warning',viewBox:'0 0 16 16',width:14,height:14,fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},
    tone==='good'?[h('circle',{key:'outline',cx:8,cy:8,r:6}),h('path',{key:'mark',d:'m5 8 2 2 4-4'})]:h('path',{d:'M8 2 15 14H1ZM8 6v4m0 2v.1'})):null;
  const conditionView=(node,active,number)=>{
    if(!node.operator)return h('span',null,node.text);
    // Keep deep composite rules readable within the narrow map column.
    // Their complete AND/OR text remains visible without endless indentation.
    if(number.split('.').length>=3)return h('span',null,node.text);
    if(node.operator==='all'&&node.children.every(c=>!c.operator))return h('span',null,node.text);
    return h('div',{className:'paa-wb-rule-condition'},
      h('span',{className:'paa-wb-rule-logic'},node.operator==='all'?'同时满足：':node.operator==='any'?'满足任一组：':'不满足以下条件：'),
      h('ul',{className:'paa-wb-rule-children'},...node.children.map((child,i)=>h('li',{key:i,
        'data-met':active&&node.operator==='any'?(child.met===true?'yes':'no'):undefined},
        h('span',{className:'paa-wb-rule-number'},`${number}.${i+1}`),
        h('div',null,conditionView(child,active&&child.met===true,`${number}.${i+1}`))))));
  };
  return function Workbench({kind,busy,automaticFilters,automaticOperations=false,stopping=false,onStop,stopButtonRef,onApply,onActivity,operationFeedback,executionPlan,hidden=false}){
    const selectionSettings=automaticFilters||getController()?.getRecommendationFilters?.()?.[kind];
    const defaultGoal=kind==='expedition'?require('../../config/recommendation_filters').normalizeGroup('expedition',selectionSettings).defaultGoal:'great';
    const [slots,setSlots]=React.useState(blank),[fleet,setFleet]=React.useState(kind==='expedition'?2:1);
    const [catalog,setCatalog]=React.useState([]),[area,setArea]=React.useState('1-1');
    const [purpose,setPurpose]=React.useState('clear'),[target,setTarget]=React.useState('boss'),[phase,setPhase]=React.useState('');
    const [missionId,setMissionId]=React.useState(1),[goal,setGoal]=React.useState(defaultGoal);
    const [incomeUnit,setIncomeUnit]=React.useState('trip');
    const [style,setStyle]=React.useState('lower'),[choices,setChoices]=React.useState([]);
    const [excluded,setExcluded]=React.useState([]);
    const [working,setWorking]=React.useState(false),[report,setReport]=React.useState({valid:false});
    const [error,setError]=React.useState('');
    const [popup,setPopup]=React.useState(null),[search,setSearch]=React.useState('');
    const [equipmentCategory,setEquipmentCategory]=React.useState('all');
    const [candidateScope,setCandidateScope]=React.useState('similar'),[draftContext,setDraftContext]=React.useState(null);
    const [pathIndex,setPathIndex]=React.useState(0),[nodeId,setNodeId]=React.useState(null);
    const [revision,setRevision]=React.useState(0);
    const [activity,setActivity]=React.useState(''),[notice,setNotice]=React.useState('');
    const [mapRoute,setMapRoute]=React.useState('');
    const [mapExpanded,setMapExpanded]=React.useState(false);
    const [questState,setQuestState]=React.useState(()=>getStore().questState);
    const [routeRulesOpen,setRouteRulesOpen]=React.useState(false);
    const grid=React.useRef(null),alive=React.useRef(true),positions=React.useRef(new Map()),popupList=React.useRef(null);
    const resultViews=React.useRef(new Map());
    const previousDefaultGoal=React.useRef(defaultGoal);
    const mapDialog=React.useRef(null);
    const operation=React.useRef(0),routeCache=React.useRef(null),latest=React.useRef(null),prepared=React.useRef(false);
    const observed=React.useRef(null),view=React.useRef(null),page=React.useRef(null),resumePending=React.useRef(false),initialized=React.useRef(false),routeSelection=React.useRef(null);
    const paused=busy||hidden;
    React.useEffect(()=>{
      setQuestPageActive?.(kind,!paused&&!working);
      return()=>setQuestPageActive?.(kind,false);
    },[kind,paused,working]);
    if(paused)resumePending.current=true;
    if(!observed.current)observed.current=getStore();
    if(choices.length)prepared.current=true;
    const disabled=busy||working,store=observed.current;
    const mapAsset=useMapLoading(kind==='normal'?area:null,!paused);
    React.useEffect(()=>{
      const dialog=mapDialog.current;
      if(!mapExpanded||disabled||hidden){if(dialog?.open)dialog.close();if(mapExpanded)setMapExpanded(false);return;}
      const opener=dialog?.ownerDocument.activeElement;
      if(dialog&&!dialog.open){dialog.showModal();dialog.querySelector('button')?.focus();}
      return ()=>{if(dialog?.open)dialog.close();if(opener?.isConnected)opener.focus({preventScroll:true});};
    },[mapExpanded,disabled,hidden]);
    const effectivePhase=phase||retain(routeSelection,paused,[kind,area,target,mapRoute],()=>kind==='normal'?require('../../domain/routes/route_plans').routeOptions(area,target).find(r=>r.key===mapRoute)?.phase:'')||'';
    const settings={kind,fleet,area,target,phase:effectivePhase,missionId,revision};
    const filterKey=selectionSettings?JSON.stringify(selectionSettings):null;
    const conditionKey=JSON.stringify([kind,area,target,phase,'clear',style,missionId,goal,filterKey]);
    latest.current=conditionKey;
    React.useEffect(()=>{
      const previous=previousDefaultGoal.current;previousDefaultGoal.current=defaultGoal;
      if(kind==='expedition'&&previous!==defaultGoal&&!busy&&!working&&!slots.some(Boolean)&&goal===previous)setGoal(defaultGoal);
    },[kind,defaultGoal,busy,working,slots,goal]);
    const commit=next=>{
      if(!next.some(Boolean))setDraftContext(null);else if(!slots.some(Boolean))setDraftContext(conditionKey);setNotice('');setSlots(next);setError('');setReport({valid:false});};
    const changeArea=value=>{
      if(value===area)return;
      // Retire pending recommendations before clearing the old map's draft.
      operation.current++;routeCache.current=null;prepared.current=false;
      commit(blank());setChoices([]);setExcluded([]);setPopup(null);setSearch('');
      setWorking(false);setActivity('');
      setArea(value);const selected=catalog.find(m=>m.area===value);
      setTarget(selected?.bossNodes?.length?'boss':selected?.terminalNodes?.[0]||'boss');
      setPhase('');setPurpose('clear');setMapRoute('');setPathIndex(0);setNodeId(null);
    };
    const changeMission=value=>{
      value=Number(value);if(value===missionId)return;
      operation.current++;routeCache.current=null;prepared.current=false;resultViews.current.clear();
      commit(blank());setChoices([]);setExcluded([]);setPopup(null);setSearch('');
      setWorking(false);setActivity('');
      setCandidateScope('similar');setEquipmentCategory('all');setMissionId(value);setGoal(defaultGoal);
    };
    React.useEffect(()=>{
      alive.current=true;
      return()=>{alive.current=false;operation.current++;};
    },[]);
    React.useEffect(()=>{
      if(paused||initialized.current)return;
      initialized.current=true;
      try{const service=getController(),{snapshotId}=service.createSnapshot();
        setCatalog(kind==='normal'?service.listNormalMaps({snapshotId}).maps:kind==='expedition'?service.listExpeditions({snapshotId}).missions:[]);
        const available=(getStore().info?.fleets||[]).map((f,i)=>({fleet:i+1,busy:Number(f.api_mission?.[0])!==0}))
          .filter(f=>(kind!=='expedition'||f.fleet>1)&&!f.busy);
        if(available.length)setFleet(previous=>available.some(f=>f.fleet===previous)?previous:available[0].fleet);
      }catch(e){setError(e.message);}
    },[paused]);
    React.useEffect(()=>{
      if(paused)return;
      let previous=getStore();
      // A hidden page may have missed task-list responses. Show the latest
      // statuses on resume instead of flashing the old synchronization hint.
      setQuestState(previous.questState);
      const timer=setInterval(()=>{const next=getStore();
        // Quest changes update this small read-only section without invalidating
        // the route/loadout inspection or the recommendation caches.
        setQuestState(previous=>previous===next.questState?previous:next.questState);
        if(['ships','equips','fleets','repairs','basic','maps'].some(k=>next.info?.[k]!==previous.info?.[k])||next.const!==previous.const||next.expeditionProgress!==previous.expeditionProgress){previous=next;setRevision(x=>x+1);}
      },1000);return()=>clearInterval(timer);
    },[paused]);
    React.useEffect(()=>{
      if(paused)return;
      const timer=setTimeout(()=>{if(alive.current){
        const current=getStore(),next=W.inspect(getController(),current,slots,settings);
        observed.current=current;resumePending.current=false;setReport(next);
      }},80);
      return()=>clearTimeout(timer);
    },[slots,fleet,area,target,effectivePhase,missionId,revision,paused]);
    React.useEffect(()=>shipDrag(grid.current,(a,b)=>{
      // Capture positions only for an explicit drag swap, relative to the grid.
      // Equipment edits and scrolling must never replay old viewport offsets.
      const origin=grid.current.getBoundingClientRect();
      positions.current=new Map([...grid.current.querySelectorAll('[data-ship-id]')].map(card=>{
        const box=card.getBoundingClientRect();return [card.dataset.shipId,{x:box.x-origin.x,y:box.y-origin.y}];
      }));
      const next=slots.slice();[next[a],next[b]]=[next[b],next[a]];commit(next);
    },disabled),[slots,disabled,fleet]);
    React.useEffect(()=>{
      const previous=positions.current;positions.current=new Map();
      if(!previous.size||!grid.current)return;
      const origin=grid.current.getBoundingClientRect();
      grid.current.querySelectorAll('[data-ship-id]').forEach(card=>{
        const box=card.getBoundingClientRect(),old=previous.get(card.dataset.shipId);
        const x=box.x-origin.x,y=box.y-origin.y;
        if(old&&card.animate&&(old.x!==x||old.y!==y))card.animate([
          {transform:`translate(${old.x-x}px,${old.y-y}px)`},{transform:'translate(0,0)'}],{duration:220,easing:'ease-out'});
      });
    },[slots]);
    React.useEffect(()=>{if(disabled)setPopup(null);},[disabled]);
    React.useEffect(()=>{if(!popup)return;const document=popupList.current?.ownerDocument||grid.current?.ownerDocument;if(!document)return;
      const escape=e=>{if(e.key==='Escape')setPopup(null);};
      document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape);
    },[popup]);
    const open=(index,slot)=>{
      const current=slot==='ex'?slots[index]?.ex:slots[index]?.slots[slot];
      const category=slot!==undefined&&current>0?W.equipmentOptions(store,slots,index,slot).find(row=>row.id===current)?.categoryId:null;
      setSearch('');setEquipmentCategory(category===null||category===undefined?'all':String(category));setCandidateScope('similar');setPopup({index,slot});
    };
    React.useEffect(()=>{if(popupList.current)popupList.current.scrollTop=0;},[popup,search,equipmentCategory]);
    const choosePlan=(row,key=conditionKey,selectedRoute='')=>{
      const next=W.merge(getStore(),slots,row.scheme);
      if(!row.planningOnly)getController().preview('fleet',W.scheme(next,fleet));
      commit(next);prepared.current=true;setDraftContext(key);setPathIndex(0);setNodeId(null);setNotice('路线与编成已同步');
      setMapRoute(row.routeKey||selectedRoute||row.guideStyle||(row.profile?.examples?.[0]||[]).join('>'));
    };
    const cacheKey=(requestedGoal=goal)=>JSON.stringify([kind,area,target,phase,purpose,missionId,requestedGoal,fleet,excluded,filterKey,
      slots.map((s,i)=>s&&(s.pin||Object.keys(s.keep).length)?[i,s.id,s.pin,Object.keys(s.keep).map(k=>[k,k==='ex'?s.ex:s.slots[k]])]:null)]);
    const complete=async(requestedStyle=style,automatic=false,requestedRoute=mapRoute,requestedGoal=goal)=>{
      if(disabled)return;
      const token=++operation.current,key=JSON.stringify([kind,area,target,phase,'clear',requestedStyle,missionId,requestedGoal,filterKey]);
      const origin=conditionKey,signature=kind==='expedition'?JSON.stringify([cacheKey('both'),revision]):cacheKey(requestedGoal),initialStore=getStore();
      setWorking(true);setActivity(automatic?'route':'complete');setNotice('');setError('');setPopup(null);
      await new Promise(resolve=>setTimeout(resolve,20));
      try{
        const stamp=kind==='expedition'?require('../../application/snapshots').fingerprint(initialStore):null;
        const cached=routeCache.current;
        let found;
        if((automatic||kind==='expedition')&&cached?.key===signature&&cached.info===initialStore.info&&cached.master===initialStore.const&&
          (kind!=='expedition'||cached.stamp===stamp&&cached.found.goals?.[requestedGoal]))found=kind==='expedition'?{...cached.found,...cached.found.goals[requestedGoal]}:cached.found;
        else{
          const service=getController(),{snapshotId}=service.createSnapshot();
          const query={snapshotId,fleet,fixedShipIds:slots.filter(s=>s&&(s.pin||Object.keys(s.keep).length)).map(s=>s.id),excludedShipIds:excluded,limit:3};
          found=await (kind==='normal'?service.recommendNormalFleet({...query,area,target,phase:phase||undefined,
            airGoal:'superiority',preference:'all',byRoute:true,heldSlots:W.recommendationHolds(slots)}):service.recommendExpeditionFleet({...query,missionId,goal:requestedGoal,heldSlots:W.recommendationHolds(slots),
              ...(slots[0]&&(slots[0].pin||Object.keys(slots[0].keep).length)?{fixedFlagshipId:slots[0].id}:{})}));
        }
        if(!alive.current||token!==operation.current||![origin,key].includes(latest.current))return;
        if(getStore().info!==initialStore.info||getStore().const!==initialStore.const||kind==='expedition'&&require('../../application/snapshots').fingerprint(getStore())!==stamp)throw Error('舰队资料已变化，请重新补全');
        routeCache.current={key:signature,info:initialStore.info,master:initialStore.const,stamp,found};
        const options=W.routeChoices(found);setChoices(options);
        const selectedKey=requestedRoute||(area==='3-5'?requestedStyle:found.routeResults?.[0]?.key);
        const routeResult=found.routeResults?.find(r=>r.key===selectedKey);
        if(routeResult&&!routeResult.chance){setMapRoute(selectedKey);return;}
        if(!found.recommendations?.length&&!(kind==='expedition'&&found.closestRecommendation))throw Error(found.reason||found.message||'当前条件下没有可用方案，请调整固定舰娘或目标');
        const row=found.routeResults?found.recommendations.find(r=>r.routeKey===selectedKey):area==='3-5'&&target==='boss'&&kind==='normal'?found.recommendations.find(r=>r.guideStyle===requestedStyle):
          kind==='normal'&&requestedRoute?found.recommendations.find(r=>(r.profile?.routePaths||[]).some(p=>p.nodes.join('>')===requestedRoute)):found.recommendations[0]||found.closestRecommendation;
        if(!row)throw Error('所选路线没有可用方案，当前编成已保留，请调整固定舰娘或装备');
        choosePlan(row,key,requestedRoute);
      }catch(e){if(alive.current&&token===operation.current&&[origin,key].includes(latest.current))setError(e.message);}
      finally{if(alive.current&&token===operation.current){setWorking(false);setActivity('');}}
    };
    const changeStyle=value=>{
      setStyle(value);setMapRoute(value);setNotice('');setNodeId(null);
      // A new map/purpose remains an explicit full-search action. Once a draft
      // belongs to this context, route changes use the prepared alternatives.
      const previous=draftContext?JSON.parse(draftContext):null;
      if(prepared.current&&(!slots.some(Boolean)||previous&&previous.every((v,i)=>i===5||v===JSON.parse(conditionKey)[i])))return complete(value,true,value);
    };
    const changeGoal=value=>{
      if(disabled||value===goal)return;
      setGoal(value);setChoices([]);
      return complete(style,false,mapRoute,value);
    };
    const refreshEquipment=async next=>{
      if(!next.some(Boolean))return;
      const token=++operation.current,key=conditionKey,initialStore=getStore();
      setWorking(true);setActivity('equipment');setNotice('');
      await new Promise(resolve=>setTimeout(resolve,20));
      try{
        const service=getController(),{snapshotId}=service.createSnapshot();
        const result=await (kind==='expedition'?service.recommendExpeditionEquipment({snapshotId,scheme:W.scheme(next,fleet),missionId,goal,heldSlots:next.filter(Boolean)}):
          service.recommendNormalEquipment({snapshotId,scheme:W.scheme(next,fleet),area,target,phase:effectivePhase||undefined,heldSlots:next.filter(Boolean),routeKey:mapRoute}));
        if(!alive.current||token!==operation.current||latest.current!==key)return;
        if(getStore().info!==initialStore.info||getStore().const!==initialStore.const)throw Error('舰队资料已变化，已保留换船结果，请重新补全');
        const updated=W.withEquipment(next,result.scheme);service.preview('fleet',W.scheme(updated,fleet));
        commit(updated);setDraftContext(key);setChoices([]);routeCache.current=null;
        if(result.warnings?.length)setError(result.warnings.join('；'));
        else setNotice(result.pathChance?.max===0?'已更新装备，但当前舰娘无法沿所选路线到达，请调整舰种':'装备推荐已更新 · 手动装备已保留');
      }catch(e){if(alive.current&&token===operation.current)setError('自动配装未完成：'+e.message);}
      finally{if(alive.current&&token===operation.current){setWorking(false);setActivity('');}}
    };
    if(!paused&&resumePending.current&&view.current&&view.current.value.contextKey!==conditionKey)resumePending.current=false;
    const data=retain(view,paused||resumePending.current,null,()=>{
      const rows=V.fleetRows(store,W.scheme(slots,fleet));
      const rowById=new Map(rows.map(s=>[s.id,s]));
      const expeditionStatus=kind==='expedition'?E.fleetStatus(store,slots):null;
      const mission=catalog.find(m=>Number(m.missionId)===missionId),map=catalog.find(m=>m.area===area);
      const expedition=report.expedition,rate=expedition?.eligible&&Number.isFinite(expedition.greatSuccess?.estimatedPercent)?Math.min(100,Math.max(0,expedition.greatSuccess.estimatedPercent)):null;
      let income=null;try{if(kind==='expedition'&&rows.length)income=W.income(store,slots,missionId);}catch(_){}
      const dirty=report.settingsKey!==JSON.stringify(settings)||JSON.stringify(report.scheme)!==JSON.stringify(W.scheme(slots,fleet));
      const overview=kind==='normal'?W.mapOverview(area,target,phase,selectionSettings,store):null;
      const mapProfile=overview?W.selectedMapProfile(overview,mapRoute,dirty?null:report.profile):null;
      const speedReading=kind==='expedition'?null:fleetSpeed(store,slots);
      const mechanisms=kind==='expedition'?E.shipBadges(expeditionStatus):fleetMechanisms(store,slots,speedReading,mapProfile);
      const threat=mapProfile?W.displayThreat(mapProfile,nodeId):null;
      const progress=kind==='normal'?W.mapProgress(store,area):null;
      const routeOptions=kind==='normal'?overview.options.map(o=>({...choices.find(c=>c.key===o.key),...o})):[];
      const selectedRoute=routeOptions.find(o=>o.key===mapRoute);
      const arrival=W.routeArrival(report,selectedRoute,!dirty&&report.route?.area===area&&rows.length>0,target);
      const requirementGroups=new Map();
      for(const path of require('../../domain/routes/route_plans').optionPaths(selectedRoute)){
        for(const point of require('../../domain/routes/route_plans').requirementDetails(area,path,effectivePhase,!dirty&&report.valid?report.route:null)){
          const previous=requirementGroups.get(point.from);
          if(previous){if(!previous.exits.includes(point.to))previous.exits.push(point.to);}
          else requirementGroups.set(point.from,{...point,exits:[point.to]});
        }
      }
      const routeRequirements=[...requirementGroups.values()].map(p=>({...p,to:p.exits.join(' / '),
        rules:p.rules.map(r=>({...r,offRoute:r.active&&p.exits.every(to=>!r.destinations.split('/').includes(to))}))}));
      const speedRequirement=W.routeSpeedSummary(routeRequirements,selectedRoute);
      const routeSearchFailed=['notFound','unconfirmed'].includes(selectedRoute?.status);
      const reasons=kind==='normal'&&!routeSearchFailed?arrival.warnings:[];
      const checks=(expedition?.checks||[]).filter(c=>!c.sat);
      // Fleet power belongs to the draft; thresholds belong to the selected map path.
      const summary=W.fleetSummary(dirty?{}:report,mapProfile||report.profile,kind==='normal'?require('../../domain/routes/route_plans').optionPaths(selectedRoute):undefined);
      const changeSummary=rows.length&&!dirty&&report.valid?W.changeSummary(store,slots,fleet):'';
      return {contextKey:conditionKey,effectivePhase,changeSummary,rows,rowById,expeditionStatus,mission,map,expedition,rate,income,dirty,overview,mapProfile,speedReading,speedRequirement,mechanisms,threat,progress,routeOptions,selectedRoute,arrival,routeRequirements,routeSearchFailed,reasons,checks,summary};
    });
    const {changeSummary,rows,rowById,expeditionStatus,mission,map,expedition,rate,income,dirty,overview,mapProfile,speedReading,speedRequirement,mechanisms,threat,progress,routeOptions,selectedRoute,arrival,routeRequirements,routeSearchFailed,reasons,checks,summary}=data||{rows:[],dirty:false,routeOptions:[]};
    React.useEffect(()=>{
      if(!paused&&!resumePending.current&&kind==='normal'&&mapRoute&&!routeOptions.some(o=>o.key===mapRoute))setMapRoute('');
    },[paused,kind,area,target,phase,selectionSettings?.maxRoutes,mapRoute,store.info?.maps]);
    const calculating=working||(!hidden&&dirty&&rows.length>0);
    const cardActivity=working?({complete:'补全中',route:'切换路线中',equipment:'调整装备中'})[activity]:null;
    const resultsPending=!busy&&(working&&['complete','route','equipment'].includes(activity)||dirty&&rows.length>0);
    // Keep the previous result's geometry under a veil, marked as stale.
    // Its DOM remains mounted (including expanded details and scroll position).
    const stableResult=(key,...children)=>{
      if(!resultsPending||!resultViews.current.has(key))resultViews.current.set(key,children);
      return h('div',{className:'paa-wb-calculation-region','data-result-region':key,'aria-busy':!!resultsPending},
        h('div',{className:'paa-wb-calculation-content','aria-hidden':resultsPending||undefined,inert:resultsPending?'':undefined},...resultViews.current.get(key)),
        resultsPending?h('div',{className:'paa-wb-calculating',role:'status'},
          h('span',{className:'paa-wb-calculation-label'},h('span',{className:'paa-wb-calculation-spinner','aria-hidden':true}),'计算中…')):null);
    };
    React.useEffect(()=>{onActivity?.(previous=>previous[kind]===calculating?previous:{...previous,[kind]:calculating});},[calculating,kind,onActivity]);
    React.useEffect(()=>()=>onActivity?.(previous=>previous[kind]?{...previous,[kind]:false}:previous),[kind,onActivity]);
    if(hidden)return hiddenPage(h,page.current,{className:'paa-workbench','data-kind':kind,hidden});
    if(!data)return h('div',{className:'paa-workbench','data-kind':kind},operationFeedback,
      busy?h('button',{type:'button',ref:stopButtonRef,disabled:stopping,onClick:()=>{if(!stopping)onStop?.();}},stopping?'正在停止…':'停止操作'):null);
    const applyDisabled=disabled||resumePending.current||!report.valid||dirty||!rows.length;
    const applyWarning=!busy&&!dirty&&rows.length?W.applicationWarning(kind,report,selectedRoute,target):null;
    const conditionsChanged=rows.length>0&&draftContext!==null&&draftContext!==conditionKey;
    const activityText=activity==='equipment'?'正在更新装备推荐…':activity==='route'?'正在同步路线与编成…':'正在补全…';
    const applyHint=busy?'正在应用编成':working?activityText:!rows.length?'可先选入任务舰娘，也可直接补全':dirty?'正在核对编成…':!report.valid?(report.error||'编成需要调整'):conditionsChanged?'条件已变更 · 当前编成已保留，请点击一键补全':checks.length?'远征条件未满足 · 可调整后再应用':notice||changeSummary+(reasons.length?' · 请留意路线条件':'');
    const portrait=row=>h('div',{className:'paa-wb-portrait'},h('span',null,row.name.slice(0,2)),row.portrait?h('img',{src:row.portrait,alt:'',draggable:false,onError:e=>{e.currentTarget.style.display='none';}}):null);
    const shipCard=(s,i)=>{
      const remove=()=>commit(pad(slots.filter((x,j)=>x&&j!==i)));
      if(!s)return h('button',{key:'empty-'+i,type:'button',className:'paa-wb-empty','data-fleet-slot':i,'data-empty':'true',disabled:disabled,onClick:()=>open(i)},h('span',null,'＋'),`第 ${i+1} 位 · 选择舰娘`);
      if(!store.info.ships[s.id])return h('article',{key:s.id,className:'paa-wb-ship'},h('p',{className:'paa-error'},'舰娘数据已变化，请重新选择'),h('button',{type:'button',disabled,onClick:()=>open(i)},'重新选择'));
      const row=rowById.get(s.id),master=store.const.$ships[store.info.ships[s.id].api_ship_id];
      const gearSlot=k=>{
        const item=row.gearIcons.find(x=>x.slot===k);
        const equipment=store.const.$equips[store.info.equips[item?.id]?.api_slotitem_id];
        const planes=aircraftCapacity(master,equipment,k);
        return h('button',{key:k,type:'button',disabled:disabled,className:'paa-wb-gear'+(s.keep[k]?' kept':''),
          'data-tooltip':(V.equipmentTooltip(item)||'空槽')+(planes!==undefined?` · 满载 ${planes??'未知'} 架`:'')+(s.keep[k]?' · 一键补全时保留':''),onClick:()=>open(i,k)},
          h('span',{className:'paa-wb-slot-label'},k==='ex'?'增':Number(k)+1),item?h(EquipmentIcon,{item}):h('span',{className:'paa-wb-gear-empty'},'＋'),
          h('span',{className:'paa-wb-gear-name'},item?item.tooltip.replace(/^.*? · /,''):'空槽'),
          planes!==undefined?h('span',{className:'paa-wb-aircraft-count','data-planes':planes??'unknown','aria-label':planes===null?'满载数量未知':`满载 ${planes} 架`},`${planes??'—'} 架`):null,
          s.keep[k]?h('span',{className:'paa-wb-kept'},'定'):null);
      };
      return h('article',{key:s.id,className:'paa-wb-ship','data-fleet-slot':i,'data-ship-id':s.id},
        h('div',{className:'paa-wb-ship-head'},portrait(row),h('div',{className:'paa-wb-identity'},h('strong',{'data-tooltip':row.name},row.name),h('small',null,`${i===0?'旗舰':`第 ${i+1} 位`} · ${W.TYPES[master.api_stype]||row.type} · Lv.${row.level}`)),
          h('div',{className:'paa-wb-ship-actions'},
            h('button',{type:'button',className:'paa-wb-replace',disabled:disabled,onClick:()=>open(i),'data-tooltip':'替换舰娘'},'换船'),
            h('button',{type:'button',className:'paa-wb-remove',disabled:disabled,onClick:remove,'data-tooltip':'从当前编成移除'},'移除'))),
        h('div',{className:'paa-wb-mechanisms','aria-label':kind==='expedition'?'当前远征状态':'当前配装机制'},...mechanismBadges(mechanisms.get(s.id))),
        h('div',{className:'paa-wb-gears'},...s.slots.map((_,k)=>gearSlot(k)),store.info.ships[s.id].api_slot_ex!==0?gearSlot('ex'):h('div',{className:'paa-wb-gear-unopened'},'增 · 未开启')),
        h(ExecutionCard,{running:!!(busy&&!hidden&&executionPlan?.fleet===fleet&&executionPlan.targets?.[i]===s.id),stopping,fleet,index:i,ship:s.id}));
    };
    const popupRows=popup&&!paused&&!resumePending.current?(popup.slot===undefined?W.replacementCandidates(store,slots,popup.index,search,candidateScope,{kind,filters:selectionSettings}):W.equipmentOptions(store,slots,popup.index,popup.slot,search)):[];
    const currentEquipment=popup?.slot!==undefined?(popup.slot==='ex'?slots[popup.index]?.ex:slots[popup.index]?.slots[popup.slot]):null;
    const equipmentGroups=new Map();
    if(popup?.slot!==undefined)for(const row of popupRows){
      if(!equipmentGroups.has(String(row.categoryId)))equipmentGroups.set(String(row.categoryId),{name:row.category,rows:[]});
      equipmentGroups.get(String(row.categoryId)).rows.push(row);
    }
    const selectedCategory=equipmentGroups.has(equipmentCategory)?equipmentCategory:'all';
    const visiblePopupRows=popup?.slot===undefined?popupRows.slice(0,80):
      selectedCategory==='all'?popupRows:equipmentGroups.get(selectedCategory).rows;
    const pick=row=>{
      const next=slots.slice();
      if(popup.slot===undefined){next[popup.index]={...W.entry(store,row.id),pin:true};setExcluded(ids=>ids.filter(id=>id!==row.id));}
      else{const s=next[popup.index],k=popup.slot;next[popup.index]={...s,slots:s.slots.slice(),keep:{...s.keep,[k]:true}};
        if(k==='ex')next[popup.index].ex=row.id;else next[popup.index].slots[k]=row.id;}
      commit(next);setPopup(null);
      if(popup.slot===undefined)return refreshEquipment(next);
    };
    const field=(label,value,onChange,options)=>h('label',{className:'paa-wb-field'},h('span',null,label),h('select',{'aria-label':label,value,disabled,onChange:e=>onChange(e.target.value)},...options.map(([value,name,optionDisabled])=>h('option',{key:value,value,disabled:optionDisabled},name))));
    const normalRouteControl=kind==='normal'?h('div',{className:'paa-wb-section-head paa-wb-route-picker'},h('h3',null,'路线'),
      field(area==='3-5'&&target==='boss'?'攻略流派':'参考路线',mapRoute,value=>{
        if(disabled)return;
        // Clearing the preview is not a request to assemble a default route.
        if(!value){setMapRoute('');setPathIndex(0);setNodeId(null);setNotice('');setError('');return;}
        if(area==='3-5'&&target==='boss')return changeStyle(value);
        setMapRoute(value);setNodeId(null);
        if(prepared.current&&(draftContext===conditionKey||!slots.some(Boolean)))return complete(style,true,value);
      },[['','选择路线'],...routeOptions.map(c=>[c.key,c.label])])):null;
    const contextControls=h('div',{className:'paa-wb-context-controls'},
        kind==='normal'?h(AreaPicker,{maps:catalog,mapMasters:store.const.$maps,value:area,onChange:changeArea,disabled,hidden}):
        h(React.Fragment,null,h(AreaPicker,{kind:'expedition',missions:catalog,missionMasters:store.const.$missions,missionProgress:store.expeditionProgress,fleets:store.info.fleets,useItems:store.const.$useitems,value:missionId,onChange:changeMission,disabled,hidden}),expeditionView.goal({value:goal,onChange:changeGoal,disabled})),normalRouteControl);
    const commandControls=h('div',{className:'paa-wb-command-area','data-running':!!busy},h('div',{className:'paa-wb-command-row'},h('div',{className:'paa-wb-edit-controls'},h('button',{type:'button',className:'paa-wb-complete',disabled,onClick:()=>complete()},h('svg',{width:15,height:15,viewBox:'0 0 20 20',fill:'none',stroke:'currentColor',strokeWidth:1.5,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('path',{d:'m4 16 9-9 3 3-9 9zM4 3v4M2 5h4M14 1v3M12.5 2.5h3'})),working&&activity==='complete'?'计算中…':'一键补全'),
          h('button',{type:'button',className:'paa-wb-quiet',disabled,onClick:()=>{commit(blank());setChoices([]);}},'一键清空'),
        ),
        automaticOperations||busy?h('div',{className:'paa-wb-apply-controls'},field('编入',fleet,value=>{const next=Number(value);setFleet(next);setReport({valid:false});},[1,2,3,4].filter(n=>kind!=='expedition'||n>1).map(n=>{const f=store.info?.fleets?.[n-1],unavailable=!f||Number(f.api_mission?.[0])!==0;return [n,`第 ${n} 舰队${unavailable?'（不可用）':''}`,unavailable];})),
        h('button',{type:'button',className:'paa-primary paa-wb-apply',ref:stopButtonRef,'data-running':!!busy,'data-warning':!!applyWarning,disabled:busy?stopping:applyDisabled,'data-tooltip':busy?'停止后续操作，已发送的操作会正常完成':applyDisabled?applyHint:applyWarning?.hint||'将当前编成应用到所选舰队',onClick:()=>{if(busy){if(!stopping)return onStop?.();return;}if(automaticOperations&&!applyDisabled)return onApply(W.scheme(slots,fleet));}},busy?(stopping?'正在停止…':'停止操作'):applyWarning?.label||'应用编成')):null));
    const rendered=h('div',{className:'paa-workbench','data-kind':kind,hidden},
      h('div',{className:'paa-wb-columns'},
        h('section',{className:'paa-wb-left'},contextControls,
          kind==='expedition'?stableResult('expedition',expeditionView.overview({mission,master:store.const.$missions?.[missionId],missionMasters:store.const.$missions,missionProgress:store.expeditionProgress,fleets:store.info.fleets,useItems:store.const.$useitems,expedition,rate,income,goal,hasShips:rows.length>0,incomeUnit,onIncomeUnitChange:setIncomeUnit,onMissionChange:changeMission,disabled})):
          h(React.Fragment,null,h('section',{className:'paa-wb-map-section','aria-label':'海域地图与攻略进度'},
            routePreview(h,{profile:mapProfile,mapAsset,pathIndex:0,nodeId,onPath:setPathIndex,onNode:setNodeId,onBackground:()=>setNodeId(null),onExpand:e=>{e?.currentTarget?.focus({preventScroll:true});setMapExpanded(true);},disabled,compact:true,showDetails:false,showPaths:false}),
            progress?h('div',{className:'paa-wb-progress-list','aria-label':'海域攻略进度','data-has-current':progress.some(gauge=>gauge.isCurrent)},
              ...progress.map(gauge=>h('div',{key:gauge.node,className:'paa-wb-progress','data-state':gauge.state,'aria-current':gauge.isCurrent?'step':undefined,'data-tooltip':gauge.title},
                h('span',{className:'paa-wb-progress-heading'},routePreview.bossIcon(h,{width:15,height:15}),gauge.label),
                gauge.remaining!==null&&gauge.total!==null?h('progress',{max:gauge.total,value:gauge.remaining,'aria-label':`${gauge.label} · ${gauge.detail}`}):
                  h('span',{className:'paa-wb-progress-unknown',role:'img','aria-label':`${gauge.label} · 进度未知`}),
                h('span',{className:'paa-wb-progress-value'},gauge.detail)))):
              null),
            stableResult('route',h('div',{className:'paa-wb-route-status','data-expandable':!!routeRequirements.length&&!disabled,onClick:event=>{
              if(disabled||!routeRequirements.length||event.defaultPrevented||event.button>0)return;
              if(event.target.closest?.('.paa-wb-arrival,.paa-wb-route-requirements,a,button,input,select,textarea,summary,[role="button"],[role="region"]'))return;
              const selection=event.currentTarget.ownerDocument?.getSelection();
              if(selection&&!selection.isCollapsed&&event.currentTarget.contains(selection.anchorNode))return;
              setRouteRulesOpen(open=>!open);
            }},
              h(routeRequirements.length?'button':'div',{className:'paa-wb-arrival','data-tone':arrival.tone,
                ...(routeRequirements.length?{type:'button',disabled,'aria-expanded':routeRulesOpen,'aria-controls':`${kind}-route-requirements`,onClick:()=>setRouteRulesOpen(open=>!open)}:{role:'status'})},
                h('span',null,arrival.label),h('strong',null,arrivalIcon(arrival.tone),arrival.value)),
            arrival.note&&!routeSearchFailed?h('small',{className:'paa-wb-arrival-note'},arrival.note):null,
            reasons.length?h('div',{className:'paa-wb-route-warnings',role:'region',tabIndex:0,'aria-label':'路线条件'},...reasons.map((reason,i)=>h('p',{key:i},reason))):null,
            ['notFound','unconfirmed'].includes(selectedRoute?.status)?h('div',{className:'paa-wb-route-warnings',role:'region',tabIndex:0,'aria-label':'推荐路线受阻条件'},...(selectedRoute.diagnostics?.briefWarnings?.length?selectedRoute.diagnostics.briefWarnings:['未找到符合所选路线的编成']).map((text,i)=>h('p',{key:i},text))):null,
            routeRequirements.length?h('div',{id:`${kind}-route-requirements`,className:'paa-wb-route-requirements',hidden:!routeRulesOpen},
              h('div',{key:`${area}:${phase}:${mapRoute}`,className:'paa-wb-route-rules-scroll',role:'region',tabIndex:0,'aria-label':'详细带路规则'},
              selectedRoute?.source?h('a',{href:selectedRoute.source,target:'_blank',rel:'noopener noreferrer'},'攻略来源'):h('small',{className:'paa-muted'},'推定路线'),
              h('small',{className:'paa-muted'},'各点从上到下判断；概率判定未命中时继续下一条。随机分岐不保证走所选出口。'),
              ...routeRequirements.map(p=>h('div',{key:p.from},h('strong',null,`${p.from==='start'?'出发点':p.from} → ${p.to}`),
                p.playerChoice?h('div',{className:'paa-wb-player-choice'},h('span',null,'↔ 能动分歧'),`请在游戏中选择 ${p.to} 点`):null,
                ...p.rules.map((r,i)=>h('div',{key:i,className:'paa-wb-route-rule','data-state':r.state,'data-off-route':r.offRoute||undefined},
                  h('div',{className:'paa-wb-rule-heading'},h('strong',null,`${i+1}. → ${r.destinations}`,
                    Number.isFinite(r.chance)?`（${Math.round(r.chance*10000)/100}%，否则继续判断）`:null),
                    h('span',null,({matched:'当前命中',estimated:'按配装估算命中',pending:'条件待确认'})[r.state]||'',r.offRoute?' · 不走所选出口':'')),
                  conditionView(r.conditionTree,r.active,String(i+1)))))))):null),
            h('div',{className:'paa-wb-threat','aria-live':'polite'},h('div',{className:'paa-wb-section-head'},h('h4',null,threat.title)),
              threat?.enemies?.length?h('div',{className:'paa-wb-enemies'},...threat.enemies.slice(0,2).map((e,i)=>h('div',{key:i},portrait({name:e.name,portrait:V.portraitUrl(store,e.apiId)}),h('span',null,e.name,h('small',null,`${(e.nodes||[]).join(' / ')} 点`))))):h('span',null,threat?.status==='none'?'此处没有记录到战斗敌舰':'敌情资料不足，暂不能比较'),
              ...(threat.warnings||[]).map((warning,i)=>h('small',{key:i,className:'paa-muted'},warning))))),
          h(QuestSection,{state:store,slots,deckId:fleet,kind,mapId:kind==='normal'?area:undefined,
            missionId:kind==='expedition'?missionId:undefined,questState,paused})),
        h('section',{className:'paa-wb-right','aria-busy':working},commandControls,
          error?h('p',{className:'paa-operation-feedback','data-state':'error',role:'alert'},error):null,
          operationFeedback,
          kind==='expedition'?stableResult('expedition-metrics',expeditionView.metrics({status:expeditionStatus,mission,income})):null,
          kind==='normal'?stableResult('metrics',h('div',{className:'paa-wb-metrics','data-columns':3,'aria-label':'舰队速力、制空与索敌','aria-live':'polite'},
            h('div',{className:'paa-wb-metric speed','data-tier':speedReading.tier,'data-has-requirement':speedRequirement.hint?'true':undefined,'data-tooltip':[speedRequirement.detail,speedReading.detail].filter(Boolean).join('\n\n')||'按当前编成与提速装备判定。','aria-label':`舰队速力：${speedReading.ships.length?speedReading.label:'—'}`},
              h('svg',{className:'paa-wb-speed-gauge',viewBox:'0 0 19 14','aria-hidden':true},...[1,2,3,4].map(t=>h('rect',{key:t,x:(t-1)*5,y:14-t*3,width:3,height:t*3,rx:0.6,fill:t<=speedReading.tier?'currentColor':'none',stroke:'currentColor',strokeWidth:0.6,opacity:t<=speedReading.tier?1:0.28}))),
              h('strong',null,speedReading.ships.length?speedReading.label:'—'),
              speedRequirement.hint?h('small',null,speedRequirement.hint):null),
            summaryMetric(summary.air,'air'),summaryMetric(summary.los,'los'))):null,
          h('div',{className:'paa-wb-ships',ref:grid},...slots.map(shipCard),
            cardActivity?h('div',{className:'paa-wb-calculating paa-wb-fleet-overlay',role:'status','data-activity':activity},
              h('span',{className:'paa-wb-calculation-label'},h('span',{className:'paa-wb-calculation-spinner','aria-hidden':true}),cardActivity)):null),
        )),
      kind==='normal'&&mapExpanded?h('dialog',{ref:mapDialog,className:'paa-wb-map-dialog','aria-label':`${area} 海域地图`,
        onCancel:e=>{e.preventDefault();setMapExpanded(false);},
        onClick:e=>{if(e.target!==e.currentTarget)return;const r=e.currentTarget.getBoundingClientRect();
          if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)setMapExpanded(false);}},
        h('div',{className:'paa-wb-section-head'},h('h3',null,`${area} 海域地图`),
          h('button',{type:'button',autoFocus:true,onClick:()=>setMapExpanded(false),'aria-label':'关闭放大地图'},'关闭')),
        routePreview(h,{profile:mapProfile,mapAsset,pathIndex:0,nodeId,onNode:setNodeId,onBackground:()=>setNodeId(null),disabled,
          idSuffix:'-expanded',compact:true,fixedNodes:true,showDetails:!!nodeId,nodePopup:true,showPaths:false,
          enemyPortrait:enemy=>portrait({name:enemy.name,portrait:V.portraitUrl(store,enemy.apiId)})})):null,
      popup?h('div',{className:'paa-wb-popup-shade',onClick:()=>setPopup(null)},h('section',{className:'paa-wb-popup',role:'dialog','aria-modal':true,'aria-label':popup.slot===undefined?'替换舰娘':'替换装备',onClick:e=>e.stopPropagation()},
        h('div',{className:'paa-wb-section-head'},h('h3',null,`第 ${popup.index+1} 位 · ${popup.slot===undefined?'选择舰娘':popup.slot==='ex'?'补强增设':`第 ${Number(popup.slot)+1} 槽`}`),h('button',{type:'button',onClick:()=>setPopup(null)},'关闭')),
        h('div',{className:'paa-wb-popup-filters'},h('input',{autoFocus:true,type:'search',value:search,'aria-label':'搜索候选',placeholder:popup.slot===undefined?'舰名 / 舰种 / ID':'装备名称 / 分类 / ID',onChange:e=>setSearch(e.target.value)}),
          popup.slot!==undefined?h('select',{'aria-label':'装备分类',value:selectedCategory,onChange:e=>setEquipmentCategory(e.target.value)},
            h('option',{value:'all'},'全部分类'),...[...equipmentGroups].map(([id,group])=>h('option',{key:id,value:id},`${group.name} (${group.rows.length})`))):null),
        popup.slot===undefined&&slots[popup.index]?h('div',{className:'paa-wb-candidate-tabs','aria-label':'候选范围'},...[["similar","同舰种"],["all","全部舰娘"]].map(([value,label])=>h('button',{key:value,type:'button','aria-pressed':candidateScope===value,onClick:()=>setCandidateScope(value)},label)),h('span',{className:'paa-muted'},kind==='expedition'?'换入后自动推荐远征装备':kind==='normal'?'换入后自动推荐装备':'换入后核对编成')):null,
        h('div',{className:'paa-wb-popup-list',ref:popupList},...visiblePopupRows.flatMap((row,i)=>[
          popup.slot!==undefined&&(i===0||row.categoryId!==visiblePopupRows[i-1].categoryId)?h('h4',{key:`category-${row.categoryId}`,className:'paa-wb-equipment-group'},row.category):null,
          h('button',{key:row.id,type:'button',className:popup.slot===undefined?undefined:'paa-wb-equipment-option','aria-current':row.id===currentEquipment?'true':undefined,'data-tooltip':popup.slot===undefined?undefined:V.equipmentTooltip(row),disabled:disabled||!!row.unavailable,onClick:()=>pick(row)},
          popup.slot===undefined?portrait(row):h(EquipmentIcon,{item:row}),h('span',{className:popup.slot===undefined?undefined:'paa-wb-equipment-label'},h('strong',null,row.name),popup.slot===undefined?h('small',null,`${row.type} · Lv.${row.level} · ${row.fleetLabel} · 疲劳 ${row.cond}${row.unavailable?' · '+row.unavailable:''}`):
            row.stars>0||row.proficiency>0?h('span',{className:'paa-wb-equipment-quality'},[row.stars>0?`★${row.stars}`:'',row.proficiency>0?`熟练 ${row.proficiency}`:''].filter(Boolean).join(' · ')):null,
            popup.slot!==undefined&&row.statsSummary?h('span',{className:'paa-wb-equipment-stats'},row.statsSummary):null,
            row.id===currentEquipment?h('span',{className:'paa-wb-equipment-current'},'当前'):null))]),!visiblePopupRows.length?h('p',{className:'paa-muted'},candidateScope==='similar'&&popup.slot===undefined?'没有匹配舰娘，可切换全部舰娘或修改搜索。':'没有匹配项，请修改搜索。'):null),
        h('div',{className:'paa-wb-popup-bottom'},h('span',{className:'paa-muted'},popup.slot===undefined?`${popupRows.length} 项${popupRows.length>80?' · 输入名称缩小范围':''}`:`${visiblePopupRows.length} 种配置`),
          popup.slot!==undefined?h('button',{type:'button',disabled,onClick:()=>pick({id:-1})},'清空此槽'):null,
          popup.slot!==undefined&&slots[popup.index].keep[popup.slot]?h('button',{type:'button',onClick:()=>{const next=slots.slice(),s=next[popup.index];next[popup.index]={...s,keep:{...s.keep}};delete next[popup.index].keep[popup.slot];commit(next);setPopup(null);}},'交给自动配装'):null))):null);
    page.current=rendered;return rendered;
  };
};
