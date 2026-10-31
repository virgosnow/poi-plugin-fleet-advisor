'use strict';
const W=require('./workbench_model'),V=require('../models/presentation_model');
const E=require('../expedition/expedition_model');
const T=require('../models/metric_tooltips');
const {arrivalNote}=require('../models/route_presentation');
const {fleetMechanisms,fleetSpeed,aircraftCapacity}=require('../../domain/combat/ship_mechanisms');
const routePreview=require('../maps/route_preview'),shipDrag=require('../components/ship_drag');
const {retain,hiddenPage}=require('../components/retained_view');
const renderCombatBalance=require('../components/combat_balance');
const collapse=require('../components/collapse');
const {assessCombat}=require('../../application/combat_assessment');
const {assessRouteChoices}=require('../../application/route_combat_assessments');
const {runRouteCombatBatch}=require('./route_combat_batch');
const SHIP_GROUPS=[['small','驱逐／海防',[1,2]],['cruiser','巡洋舰',[3,4,5,6,21]],['battleship','战舰',[8,9,10,12]],['carrier','空母',[7,11,18]],['submarine','潜艇',[13,14]],['other','辅助舰',[16,17,19,20,22]]];
const shipGroup=type=>SHIP_GROUPS.find(group=>group[2].includes(Number(type)))?.[0]||'other';
const blank=()=>Array(6).fill(null),pad=rows=>rows.concat(Array(Math.max(0,6-rows.length)).fill(null));
const progressLabels={prepare:'准备舰队资料与计算环境',hulls:'筛选舰娘',seeds:'评估候选编成',gear:'规划装备',
  'path-fit':'核对路线配装','speed-fit':'调整舰队航速','speed-refit':'复核航速与配装','los-fit':'调整索敌装备',
  combat:'评估战力',refinement:'优化编成',expedition:'准备远征计算','expedition-candidates':'筛选远征编成',
  'expedition-fit':'规划远征装备与收益','expedition-rescue':'补充搜索远征编成','expedition-wait':'核对另一种远征目标',
  prepareEquipment:'准备装备资料',equipment:'计算装备',finalize:'核对结果',verify:'核对结果',complete:'计算完成'};
function createCalculationProgress(){
  // Search branches and fitting passes are decided as the calculation runs,
  // so these stage weights estimate overall progress rather than count a
  // fixed total. Repeated stages and fallback searches must never go backward.
  // Between worker updates, elapsed time advances the estimate conservatively;
  // it cannot reach completion until the actual result has been accepted.
  let percent=0,lastStage='',expeditionPass=0;
  const ranges={prepare:[1,1],prepareEquipment:[1,1],hulls:[4,18],seeds:[18,48],gear:[48,64],
    'path-fit':[64,78],'speed-fit':[64,78],'speed-refit':[68,80],'los-fit':[72,82],
    combat:[80,87],refinement:[87,93],expedition:[3,3],'expedition-wait':[88,88],
    equipment:[5,5],finalize:[95,95],verify:[97,97]};
  return {
    update(value){
      const stage=value?.stage||'prepare';
      if(stage==='expedition-candidates'&&lastStage!==stage)expeditionPass++;
      lastStage=stage;
      const pass=expeditionPass>1;
      const range=stage==='expedition-candidates'?(pass?[55,55]:[8,8]):
        stage==='expedition-fit'?(pass?[78,78]:[42,42]):stage==='expedition-rescue'?(pass?[86,86]:[52,52]):ranges[stage]||[percent,percent];
      const done=Number(value?.completed),total=Number(value?.total);
      const fraction=total>0&&Number.isFinite(done)?Math.max(0,Math.min(1,done/total)):0;
      percent=Math.max(percent,Math.min(97,Math.floor(range[0]+(range[1]-range[0])*fraction)));
      return `${progressLabels[stage]||'正在计算'} · 预计总进度 ${percent}%`;
    },
    tick(){
      if(percent>=94)return null;
      percent=Math.min(94,percent+Math.max(1,Math.floor((94-percent)*0.04)));
      return `${progressLabels[lastStage]||'正在计算'} · 预计总进度 ${percent}%`;
    },
    complete(){percent=100;return `${progressLabels.complete} · 预计总进度 100%`;}
  };
}
function draftDataKey(store,slots,{area,fleet,missionId}){
  // Host snapshots can be mutated in place. Check only the six displayed hulls
  // and their equipment rather than serializing the entire player inventory.
  const mapId=Number(String(area).replace('-',''));
  return JSON.stringify([store.info?.basic,store.info?.resources,store.info?.useitems,store.info?.server,
    store.info?.fleets?.[fleet-1],store.info?.repairs,store.info?.maps?.[mapId],store.info?.maps?.[11],
    store.const?.$maps?.[mapId],store.const?.$missions?.[missionId],store.expeditionProgress,slots.map(slot=>{
    if(!slot)return null;
    const ship=store.info?.ships?.[slot.id],master=store.const?.$ships?.[ship?.api_ship_id];
    const graphs=store.const?.$shipgraph,graph=Array.isArray(graphs)?graphs.find(row=>row.api_id===ship?.api_ship_id):graphs?.[ship?.api_ship_id];
    const equipment=[...slot.slots||[],slot.ex,...ship?.api_slot||[],ship?.api_slot_ex].filter(id=>id>0)
      .map(id=>{const item=store.info?.equips?.[id];return [item,store.const?.$equips?.[item?.api_slotitem_id]];});
    return [slot,ship,master,store.const?.$shipTypes?.[master?.api_stype],graph,equipment];
  })]);
}
module.exports=function createWorkbench(React,{getController,getStore,subscribe,setQuestPageActive}){
  const expeditionView=require('../expedition/expedition_view')(React);
  const h=React.createElement,EquipmentIcon=require('../components/equipment_icon')(React);
  const mechanismBadges=require('../components/mechanism_badges')(React);
  const ExecutionCard=require('../components/execution_card')(React,{subscribe,getStore});
  const QuestSection=require('../components/quest_section')(React);
  const AreaPicker=require('../components/area_picker')(React);
  const RoutePicker=require('../components/route_picker')(React);
  const useMapLoading=require('../maps/map_loading')(React,{getStore});
  function CalculationProgress({channel}){
    const [value,setValue]=React.useState(channel.value);
    React.useEffect(()=>{channel.listeners.add(setValue);setValue(channel.value);return()=>channel.listeners.delete(setValue);},[channel]);
    if(!value)return null;
    const match=/^(.*?)\s*·\s*预计总进度\s+(\d+%)$/.exec(value);
    return h('span',{className:'paa-wb-calculation-detail'},match?
      [h('strong',{key:'percentage',className:'paa-wb-calculation-percent'},match[2]),
        h('span',{key:'track',className:'paa-wb-calculation-track','aria-hidden':true},
          h('span',{className:'paa-wb-calculation-fill',style:{width:match[2]}})),
        h('small',{key:'stage',className:'paa-wb-calculation-stage'},match[1])]:
      h('small',{className:'paa-wb-calculation-stage'},value));
  }
  const summaryMetric=(reading,kind)=>{
    const good=kind==='air'?/^全程空/.test(reading.state):['索敌达标','无需索敌'].includes(reading.state);
    const warning=reading.bad||reading.uncertain||reading.state==='估算达标';
    const tone=warning?'warning':good?reading.state==='全程空确'?'green':kind==='air'?'blue':'green':'neutral';
    const icon=h('svg',{viewBox:'0 0 16 16','aria-hidden':true},warning?
      h('path',{d:'M8 2 15 14H1ZM8 6v4m0 2v.1'}):
      [h('circle',{key:'circle',cx:8,cy:8,r:6}),h('path',{key:'mark',d:good?'m5 8 2 2 4-4':'M5 8h6'})]);
    return h('div',{className:'paa-wb-metric '+kind+(reading.bad?' insufficient':''),'data-tone':tone,
      'data-tooltip':[reading.hint,reading.detail].filter(Boolean).join('\n'),
      'data-tooltip-content':reading.tooltipContent,tabIndex:0,
      'aria-label':`${kind==='air'?'制空':'33式索敌'} ${reading.value}，${reading.state}`},
      h('span',{className:'paa-wb-metric-state'},icon,reading.state),
      h('strong',{'data-label':kind==='air'?'我方':'33 式'},reading.value),
      h('small',null,reading.compactHint||reading.hint));
  };
  const arrivalIcon=tone=>['good','warning','bad'].includes(tone)?h('svg',{className:'paa-wb-arrival-icon','data-kind':tone==='good'?'check':'warning',viewBox:'0 0 16 16',width:14,height:14,fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},
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
    const [routeCombatResults,setRouteCombatResults]=React.useState({}),[batchRouteChoices,setBatchRouteChoices]=React.useState({});
    const [combatDeferredPhase,setCombatDeferredPhase]=React.useState('');
    const [routePhaseAnchor,setRoutePhaseAnchor]=React.useState('');
    const [excluded,setExcluded]=React.useState([]);
    const [working,setWorking]=React.useState(false),[report,setReport]=React.useState({valid:false});
    const [error,setError]=React.useState('');
    const [popup,setPopup]=React.useState(null),[search,setSearch]=React.useState('');
    const [equipmentCategory,setEquipmentCategory]=React.useState('all');
    const [shipType,setShipType]=React.useState('all'),[draftContext,setDraftContext]=React.useState(null);
    const [pathIndex,setPathIndex]=React.useState(0),[nodeId,setNodeId]=React.useState(null);
    const [revision,setRevision]=React.useState(0);
    const [activity,setActivity]=React.useState(''),[notice,setNotice]=React.useState('');
    const [mapRoute,setMapRoute]=React.useState('');
    const [mapExpanded,setMapExpanded]=React.useState(false);
    const [questState,setQuestState]=React.useState(()=>getStore().questState);
    const [routeRulesOpen,setRouteRulesOpen]=React.useState(false);
    const [combatDetailsOpen,setCombatDetailsOpen]=React.useState(false);
    const [shipFleet,setShipFleet]=React.useState('all'),[shipSort,setShipSort]=React.useState('level-desc');
    const [routeDrafts,setRouteDrafts]=React.useState({});
    const [selectedQuests,setSelectedQuests]=React.useState([]);
    const grid=React.useRef(null),alive=React.useRef(true),positions=React.useRef(new Map()),popupList=React.useRef(null);
    const resultViews=React.useRef(new Map());
    const calculationChannel=React.useRef({value:'',listeners:new Set()});
    const previousDefaultGoal=React.useRef(defaultGoal);
    const mapDialog=React.useRef(null);
    const operation=React.useRef(0),routeCache=React.useRef(null),latest=React.useRef(null),prepared=React.useRef(false);
    const routeCombatGeneration=React.useRef(0),routeCombatContext=React.useRef(null),routeCombatSnapshot=React.useRef(null),routeRequests=React.useRef(new Map());
    // Store references must stay outside serializable drafts (hot reload backs
    // drafts up on disk); an old or restored draft simply gets reassessed.
    const routeDraftCombatSnapshots=React.useRef(new WeakMap());
    const observed=React.useRef(null),view=React.useRef(null),page=React.useRef(null),resumePending=React.useRef(false),initialized=React.useRef(false),routeSelection=React.useRef(null);
    const paused=busy||hidden;
    React.useEffect(()=>{
      getController()?.setRecommendationPageActive?.(kind,!paused);
      return()=>getController()?.setRecommendationPageActive?.(kind,false);
    },[kind,paused]);
    React.useEffect(()=>{
      setQuestPageActive?.(kind,!paused&&!working);
      return()=>setQuestPageActive?.(kind,false);
    },[kind,paused,working]);
    if(paused)resumePending.current=true;
    if(!observed.current)observed.current=getStore();
    // Persist the completion state with manually selected ships across reloads.
    if(kind==='normal'&&!prepared.current&&slots.some(Boolean)&&slots.every(s=>!s||s.preselectionComplete!==false&&(!s.preselected||s.preselectionComplete)))prepared.current=true;
    const disabled=busy||working,store=observed.current;
    const mapAsset=useMapLoading(kind==='normal'?area:null,!paused);
    React.useEffect(()=>{
      const dialog=mapDialog.current;
      if(!mapExpanded||disabled||hidden){if(dialog?.open)dialog.close();if(mapExpanded)setMapExpanded(false);return;}
      const opener=dialog?.ownerDocument.activeElement;
      if(dialog&&!dialog.open){dialog.showModal();dialog.querySelector('button')?.focus();}
      return ()=>{if(dialog?.open)dialog.close();if(opener?.isConnected)opener.focus({preventScroll:true});};
    },[mapExpanded,disabled,hidden]);
    const phaseForRoute=(value,current=store)=>phase||(kind==='normal'?
      require('../../domain/routes/route_plans').routeOptions(area,target).find(row=>row.key===value)?.phase||
      (!value?routePhaseAnchor:'')||
      (target==='boss'?require('../../domain/routes/route_plans').currentPhase(area,current):''):'')||'';
    const selectedMap=store.info?.maps?.[Number(String(area).replace('-',''))];
    const effectivePhase=retain(routeSelection,paused,[kind,area,target,phase,mapRoute,routePhaseAnchor,store.info?.maps,selectedMap?.api_gauge_num],()=>phaseForRoute(mapRoute));
    const settings={kind,fleet,area,target,phase:effectivePhase,missionId,revision};
    const filterKey=selectionSettings?JSON.stringify(selectionSettings):null;
    const conditionKey=JSON.stringify([kind,area,target,phase,'clear',style,missionId,goal,filterKey,...(selectedQuests.length?[selectedQuests]:[])]);
    latest.current=conditionKey;
    routeCombatContext.current=JSON.stringify([conditionKey,fleet,excluded]);
    React.useEffect(()=>{
      const previous=previousDefaultGoal.current;previousDefaultGoal.current=defaultGoal;
      if(kind==='expedition'&&previous!==defaultGoal&&!busy&&!working&&!slots.some(Boolean)&&goal===previous)setGoal(defaultGoal);
    },[kind,defaultGoal,busy,working,slots,goal]);
    const commit=(next,inspection)=>{
      const unchanged=report.valid&&report.settingsKey===JSON.stringify(settings)&&
        (kind!=='normal'||report.route?.encounterStage===require('../../domain/combat/encounter_stage').encounterStage(getStore(),area,effectivePhase))&&
        JSON.stringify(report.scheme)===JSON.stringify(W.scheme(next,fleet));
      if(!next.some(Boolean))setDraftContext(null);else if(!slots.some(Boolean))setDraftContext(conditionKey);
      setNotice('');setSlots(next);setError('');setReport(inspection||(unchanged?report:{valid:false}));
    };
    // Retain only last-search failures until clear or a new search. Successful
    // recommendations and their fleet-specific labels are stale after an edit.
    const invalidateRouteCombat=()=>{routeCombatGeneration.current++;routeCombatSnapshot.current=null;setRouteCombatResults({});setBatchRouteChoices({});};
    const invalidateRouteChoices=()=>{if(kind==='normal'){
      invalidateRouteCombat();
      setChoices(current=>current.filter(c=>['notFound','unconfirmed'].includes(c.status)).map(({key,phase,status})=>({key,phase,status})));
      routeCache.current=null;
    }};
    const inspectSelection=value=>{
      if(kind!=='normal'||!prepared.current||!slots.some(Boolean))return;
      const current=getStore(),nextSettings={...settings,phase:phaseForRoute(value)};
      if(report.valid&&report.settingsKey===JSON.stringify(nextSettings)&&
        report.route?.encounterStage===require('../../domain/combat/encounter_stage').encounterStage(current,area,nextSettings.phase)&&
        JSON.stringify(report.scheme)===JSON.stringify(W.scheme(slots,fleet))&&current.info===store.info&&current.const===store.const)return;
      observed.current=current;setReport(W.inspect(getController(),current,slots,nextSettings));
    };
    const changeArea=value=>{
      if(value===area)return;
      // Retire pending recommendations before clearing the old map's draft.
      operation.current++;routeCache.current=null;prepared.current=false;
      invalidateRouteCombat();
      commit(blank());setChoices([]);setRouteDrafts({});setSelectedQuests([]);setExcluded([]);setPopup(null);setSearch('');
      setWorking(false);setActivity('');
      setArea(value);const selected=catalog.find(m=>m.area===value);
      setTarget(selected?.bossNodes?.length?'boss':selected?.terminalNodes?.[0]||'boss');
      setPhase('');setCombatDeferredPhase('');setRoutePhaseAnchor('');setPurpose('clear');setMapRoute('');setPathIndex(0);setNodeId(null);
    };
    const changeMission=value=>{
      value=Number(value);if(value===missionId)return;
      operation.current++;routeCache.current=null;prepared.current=false;resultViews.current.clear();
      commit(blank());setChoices([]);setSelectedQuests([]);setExcluded([]);setPopup(null);setSearch('');
      setWorking(false);setActivity('');
      setShipType('all');setEquipmentCategory('all');setMissionId(value);setGoal(defaultGoal);
    };
    React.useEffect(()=>{
      alive.current=true;
      return()=>{alive.current=false;operation.current++;routeCombatGeneration.current++;};
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
    React.useEffect(()=>{if(kind==='normal')invalidateRouteCombat();},[revision,filterKey,fleet]);
    React.useEffect(()=>{
      if(kind!=='normal'||paused||!routeCombatSnapshot.current)return;
      const current=getStore(),snapshot=routeCombatSnapshot.current;
      if(current.info!==snapshot.info||current.const!==snapshot.master)invalidateRouteCombat();
    },[paused]);
    React.useEffect(()=>{
      if(paused)return;
      let previous=getStore();
      let previousStage=kind==='normal'?require('../../domain/combat/encounter_stage').encounterStage(previous,area,effectivePhase):null;
      // A hidden page may have missed task-list responses. Show the latest
      // statuses on resume instead of flashing the old synchronization hint.
      setQuestState(previous.questState);
      const timer=setInterval(()=>{const next=getStore();
        // Quest changes update this small read-only section without invalidating
        // the route/loadout inspection or the recommendation caches.
        setQuestState(previous=>previous===next.questState?previous:next.questState);
        const stage=kind==='normal'?require('../../domain/combat/encounter_stage').encounterStage(next,area,effectivePhase):null;
        if(stage!==previousStage||['ships','equips','fleets','repairs','basic','maps'].some(k=>next.info?.[k]!==previous.info?.[k])||next.const!==previous.const||next.expeditionProgress!==previous.expeditionProgress){previous=next;previousStage=stage;setRevision(x=>x+1);}
      },1000);return()=>clearInterval(timer);
    },[paused,kind,area,effectivePhase]);
    React.useEffect(()=>{
      if(paused)return;
      // Prepared route changes already inspected the exact merged draft.
      // Avoid clearing it or repeating the same work after the debounce.
      if(!resumePending.current&&report.valid&&report.settingsKey===JSON.stringify(settings)&&
        (kind!=='normal'||report.route?.encounterStage===require('../../domain/combat/encounter_stage').encounterStage(getStore(),area,effectivePhase))&&
        JSON.stringify(report.scheme)===JSON.stringify(W.scheme(slots,fleet)))return;
      const timer=setTimeout(()=>{if(alive.current){
        const current=getStore(),next=kind==='normal'&&!prepared.current?{valid:false}:W.inspect(getController(),current,slots,settings);
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
      const next=slots.slice();[next[a],next[b]]=[next[b],next[a]];invalidateRouteChoices();commit(next);
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
      observed.current=getStore();
      const current=slot==='ex'?slots[index]?.ex:slots[index]?.slots[slot];
      const category=slot!==undefined&&current>0?W.equipmentOptions(observed.current,slots,index,slot).find(row=>row.id===current)?.categoryId:null;
      const ship=slot===undefined&&slots[index]?observed.current.info?.ships?.[slots[index].id]:null;
      const type=ship&&observed.current.const?.$ships?.[ship.api_ship_id]?.api_stype;
      setSearch('');setEquipmentCategory(category===null||category===undefined?'all':String(category));
      setShipType(type!=null?`type:${type}`:'all');setShipFleet(slot===undefined&&!slots[index]?'1':'all');setShipSort('level-desc');setPopup({index,slot});
    };
    React.useEffect(()=>{if(popupList.current)popupList.current.scrollTop=0;},[popup,search,equipmentCategory,shipType,shipFleet,shipSort]);
    const choosePlan=(row,key=conditionKey,selectedRoute='')=>{
      const current=getStore(),next=W.merge(current,slots,row.scheme,{preservePositions:kind!=='normal'}),
        nextRoute=row.routeKey||selectedRoute||'';
      if(!row.planningOnly)getController().preview('fleet',W.scheme(next,fleet));
      const inspection=W.inspect(getController(),current,next,{...settings,phase:phaseForRoute(nextRoute)});
      observed.current=current;commit(next,inspection);prepared.current=true;setDraftContext(key);setPathIndex(0);setNodeId(null);setNotice('路线与编成已同步');
      setMapRoute(nextRoute);
    };
    const cacheKey=(requestedGoal=goal,requestedPhase=phase)=>JSON.stringify([kind,area,target,requestedPhase,purpose,missionId,requestedGoal,fleet,excluded,filterKey,
      slots.map((s,i)=>s&&(s.pin||Object.keys(s.keep).length)?[i,s.id,s.pin,Object.keys(s.keep).map(k=>[k,k==='ex'?s.ex:s.slots[k]])]:null),...(selectedQuests.length?[selectedQuests]:[])]);
    const normalHolds=rows=>W.recommendationHolds(rows,{preservePositions:false}).filter(Boolean).map(hold=>
      ({...hold,keep:Object.fromEntries(Object.entries(hold.keep).sort(([a],[b])=>a.localeCompare(b)))})).sort((a,b)=>a.id-b.id);
    const publishCalculation=value=>{const channel=calculationChannel.current;channel.value=value;for(const listener of channel.listeners)listener(value);};
    const startProgressTimer=(progress,isActive)=>{
      const timer=setInterval(()=>{
        if(!isActive()){clearInterval(timer);return;}
        const value=progress.tick();if(value)publishCalculation(value);
      },1000);
      return timer;
    };
    const requestNormalRoute=(service,query,signature,initialStore,onProgress)=>{
      const pending=routeRequests.current.get(signature);
      if(pending&&pending.info===initialStore.info&&pending.master===initialStore.const)return pending.promise;
      const promise=(async()=>{const {snapshotId}=service.createSnapshot();return service.recommendNormalFleet({...query,snapshotId},onProgress);})();
      const entry={info:initialStore.info,master:initialStore.const,promise};routeRequests.current.set(signature,entry);
      const clear=()=>{if(routeRequests.current.get(signature)===entry)routeRequests.current.delete(signature);};
      promise.then(clear,clear);return promise;
    };
    const startRouteCombat=(found,requestedPhase,initialStore,signature)=>{
      const generation=++routeCombatGeneration.current,context=routeCombatContext.current,service=getController();
      const initialInfo=initialStore.info,initialMaster=initialStore.const;
      routeCombatSnapshot.current={info:initialInfo,master:initialMaster,signature};
      const routeOptions=require('../../domain/routes/route_plans').recommendedOptions(area,target,undefined,selectionSettings,initialStore);
      const current=requestedPhase||'';
      const currentKeys=new Set(routeOptions.filter(option=>(option.phase||'')===current).map(option=>option.key));
      setBatchRouteChoices(previous=>Object.fromEntries(Object.entries(previous).filter(([key])=>!currentKeys.has(key))));
      setRouteCombatResults(previous=>({...Object.fromEntries(Object.entries(previous).filter(([key,value])=>!currentKeys.has(key)&&value?.status!=='pending')),
        ...Object.fromEntries([...currentKeys].map(key=>[key,{status:'pending'}]))}));
      const cancelled=()=>{
        if(!alive.current||routeCombatGeneration.current!==generation)return true;
        const currentStore=getStore();
        if(routeCombatContext.current!==context||currentStore.info!==initialInfo||currentStore.const!==initialMaster){invalidateRouteCombat();return true;}
        return false;
      };
      const choicesFor=result=>W.routeChoices(result);
      void runRouteCombatBatch({firstPhase:current,firstResult:found,isCancelled:cancelled,
        evaluate:(requested,result)=>assessRouteChoices({store:initialStore,service,slots,fleet,
          settings:{...settings,phase:requested},options:choicesFor(result),isCancelled:cancelled}),
        publish:(requested,result,combat)=>{
          const options=choicesFor(result);
          const complete={...Object.fromEntries(routeOptions.filter(option=>(option.phase||'')===requested)
            .map(option=>[option.key,{status:'unknown'}])),...combat};
          setBatchRouteChoices(previous=>({...previous,...Object.fromEntries(options.map(option=>[option.key,option]))}));
          setRouteCombatResults(previous=>({...previous,...complete}));
        },
        onError:requested=>setRouteCombatResults(previous=>({...previous,...Object.fromEntries(routeOptions
          .filter(option=>(option.phase||'')===requested).map(option=>[option.key,{status:'unknown'}]))}))
      });
    };
    const complete=async(requestedStyle=style,automatic=false,requestedRoute=mapRoute,requestedGoal=goal)=>{
      if(disabled)return;
      const token=++operation.current,key=JSON.stringify([kind,area,target,phase,'clear',requestedStyle,missionId,requestedGoal,filterKey,...(selectedQuests.length?[selectedQuests]:[])]);
      const progress=createCalculationProgress();let progressActive=true,completed=false;
      const origin=conditionKey,initialStore=getStore(),requestedPhase=phaseForRoute(requestedRoute,initialStore);
      const initialInfo=initialStore.info,initialMaster=initialStore.const;
      const holds=normalHolds(slots);
      const combatSignature=JSON.stringify([kind,area,target,purpose,missionId,requestedGoal,fleet,excluded,filterKey,holds,selectedQuests]);
      const previousCombat=routeCombatSnapshot.current;
      if(kind==='normal'&&!automatic&&previousCombat&&(previousCombat.info!==initialInfo||previousCombat.master!==initialMaster||previousCombat.signature!==combatSignature))invalidateRouteCombat();
      const signature=kind==='expedition'?JSON.stringify([cacheKey('both'),revision]):cacheKey(requestedGoal,requestedPhase);
      publishCalculation(progress.update({stage:'prepare'}));
      const progressTimer=startProgressTimer(progress,()=>progressActive&&alive.current&&token===operation.current);
      setWorking(true);setActivity(automatic?'route':'complete');setNotice('');setError('');setPopup(null);
      await new Promise(resolve=>setTimeout(resolve,20));
      try{
        if(selectedQuests.length){
          const related=require('../../domain/quests/quest_requirements').listRelatedQuests({state:initialStore,slots,deckId:fleet,
            mapId:kind==='normal'?area:undefined,missionId:kind==='expedition'?missionId:undefined,questState:initialStore.questState});
          if(related.status!=='ready'||selectedQuests.some(code=>!related.tasks.some(task=>task.code===code)))
            throw Error('所选任务已变化或未同步，请重新选择任务');
        }
        const stamp=kind==='expedition'?require('../../application/snapshots').fingerprint(initialStore):null;
        const cached=routeCache.current?.get(signature);
        let found;
        if((automatic||kind==='expedition')&&cached?.key===signature&&cached.info===initialInfo&&cached.master===initialMaster&&
          (kind!=='expedition'||cached.stamp===stamp&&cached.found.goals?.[requestedGoal]))found=kind==='expedition'?{...cached.found,...cached.found.goals[requestedGoal]}:cached.found;
        else{
          const service=getController();
          const query={fleet,fixedShipIds:slots.filter(s=>s&&(s.pin||Object.keys(s.keep).length)).map(s=>s.id),excludedShipIds:excluded,
            ...(selectedQuests.length?{questCodes:selectedQuests}: {})};
          const onProgress=value=>{if(progressActive&&alive.current&&token===operation.current)publishCalculation(progress.update(value));};
          if(kind==='normal')found=await requestNormalRoute(service,{...query,area,target,phase:requestedPhase||undefined,
            airGoal:'superiority',heldSlots:W.recommendationHolds(slots,{preservePositions:false})},signature,initialStore,onProgress);
          else {const {snapshotId}=service.createSnapshot();found=await service.recommendExpeditionFleet({...query,snapshotId,limit:3,missionId,goal:requestedGoal,heldSlots:W.recommendationHolds(slots),
              ...(slots[0]&&(slots[0].pin||Object.keys(slots[0].keep).length)?{fixedFlagshipId:slots[0].id}:{})},onProgress);}
        }
        if(!alive.current||token!==operation.current||![origin,key].includes(latest.current))return;
        publishCalculation(progress.update({stage:'verify'}));
        if(getStore().info!==initialInfo||getStore().const!==initialMaster||kind==='expedition'&&require('../../application/snapshots').fingerprint(getStore())!==stamp)throw Error('舰队资料已变化，请重新补全');
        if(selectedQuests.length){
          const current=getStore(),related=require('../../domain/quests/quest_requirements').listRelatedQuests({state:current,slots,deckId:fleet,
            mapId:kind==='normal'?area:undefined,missionId:kind==='expedition'?missionId:undefined,questState:current.questState});
          if(related.status!=='ready'||selectedQuests.some(code=>!related.tasks.some(task=>task.code===code)))throw Error('所选任务已变化，请重新选择任务');
        }
        if(!routeCache.current)routeCache.current=new Map();
        routeCache.current.set(signature,{key:signature,info:initialInfo,master:initialMaster,stamp,found});
        // Keep recent gauges available when switching back, with the same
        // snapshot, filters and manual constraints. Bound retained full fleets.
        while(routeCache.current.size>8)routeCache.current.delete(routeCache.current.keys().next().value);
        const options=W.routeChoices(found);setChoices(previous=>previous.filter(c=>['notFound','unconfirmed'].includes(c.status)&&!options.some(o=>o.key===c.key)).concat(options));
        if(kind==='normal'&&!automatic){setCombatDeferredPhase('');startRouteCombat(found,requestedPhase,initialStore,combatSignature);}
        // Without an explicit selection, the route catalogue can begin with a
        // route for which the search found no fleet (for example 1-5's
        // coastal-defence route). Select the first result that has both an
        // arrival chance and a matching recommendation instead.
        const selectedKey=requestedRoute||found.routeResults?.find(result=>result.chance&&
          found.recommendations?.some(row=>row.routeKey===result.key))?.key||
          (!found.routeResults?.length?found.recommendations?.[0]?.routeKey:undefined);
        const routeResult=found.routeResults?.find(r=>r.key===selectedKey);
        if(routeResult&&!routeResult.chance){setMapRoute(selectedKey);return;}
        if(kind==='normal'&&!selectedKey&&found.routeResults?.length)
          throw Error(found.reason||found.message||'当前条件下没有可到达的路线方案，请调整固定舰娘或目标');
        if(!found.recommendations?.length&&!(kind==='expedition'&&found.closestRecommendation))throw Error(found.reason||found.message||'当前条件下没有可用方案，请调整固定舰娘或目标');
        const row=kind==='normal'?found.recommendations.find(r=>r.routeKey===(selectedKey||found.recommendations[0]?.routeKey)):
          found.recommendations[0]||found.closestRecommendation;
        if(!row)throw Error('所选路线没有可用方案，当前编成已保留，请调整固定舰娘或装备');
        choosePlan(row,key,requestedRoute);
        completed=true;
      }catch(e){if(alive.current&&token===operation.current&&[origin,key].includes(latest.current))setError(e.message);}
      finally{
        progressActive=false;
        clearInterval(progressTimer);
        if(alive.current&&token===operation.current){
          if(completed){publishCalculation(progress.complete());await new Promise(resolve=>setTimeout(resolve,120));}
          if(alive.current&&token===operation.current){setWorking(false);setActivity('');}
        }
      }
    };
    const changeGoal=value=>{
      if(disabled||value===goal)return;
      setGoal(value);setChoices([]);
      return complete(style,false,mapRoute,value);
    };
    const refreshEquipment=async(next,{activate=false}={})=>{
      if(!next.some(Boolean))return;
      const activateDraft=items=>{
        if(!activate)return items;
        prepared.current=true;return items.map(s=>s?.preselectionComplete===false?{...s,preselectionComplete:true}:s);
      };
      const token=++operation.current,key=conditionKey,initialStore=getStore();
      const progress=createCalculationProgress();let progressActive=true,completed=false;
      publishCalculation(progress.update({stage:'prepareEquipment'}));
      const progressTimer=startProgressTimer(progress,()=>progressActive&&alive.current&&token===operation.current);
      setWorking(true);setActivity('equipment');setNotice('');
      await new Promise(resolve=>setTimeout(resolve,20));
      try{
        const service=getController(),{snapshotId}=service.createSnapshot();
        const onProgress=value=>{if(progressActive&&alive.current&&token===operation.current)publishCalculation(progress.update(value));};
        const result=await (kind==='expedition'?service.recommendExpeditionEquipment({snapshotId,scheme:W.scheme(next,fleet),missionId,goal,heldSlots:next.filter(Boolean)},onProgress):
          service.recommendNormalEquipment({snapshotId,scheme:W.scheme(next,fleet),area,target,phase:effectivePhase||undefined,heldSlots:next.filter(Boolean),routeKey:mapRoute},onProgress));
        if(!alive.current||token!==operation.current||latest.current!==key)return;
        publishCalculation(progress.update({stage:'verify'}));
        if(getStore().info!==initialStore.info||getStore().const!==initialStore.const)throw Error('舰队资料已变化，已保留换船结果，请重新补全');
        const updated=activateDraft(W.withEquipment(next,result.scheme));service.preview('fleet',W.scheme(updated,fleet));
        const unchanged=report.valid&&report.settingsKey===JSON.stringify(settings)&&JSON.stringify(report.scheme)===JSON.stringify(W.scheme(updated,fleet));
        const inspection=kind==='normal'?(unchanged?report:W.inspect(service,initialStore,updated,settings)):null;
        const option=kind==='normal'?W.mapOverview(area,target,phase,selectionSettings,initialStore).options.find(o=>o.key===mapRoute):null;
        const issue=kind==='normal'?W.draftRouteIssue(inspection,option,inspection?.valid):null;
        commit(updated,inspection);setDraftContext(key);if(kind==='expedition')setChoices([]);routeCache.current=null;
        completed=true;
        if(!issue&&result.warnings?.length)setError(result.warnings.join('；'));
        else if(!issue)setNotice('装备推荐已更新 · 手动装备已保留');
      }catch(e){if(alive.current&&token===operation.current){
        const service=getController(),current=getStore(),inspection=kind==='normal'&&current.info===initialStore.info&&current.const===initialStore.const?W.inspect(service,current,next,settings):null;
        const option=kind==='normal'?W.mapOverview(area,target,phase,selectionSettings,current).options.find(o=>o.key===mapRoute):null;
        const issue=kind==='normal'?W.draftRouteIssue(inspection,option,inspection?.valid):null;
        if(activate)setSlots(activateDraft(next));
        if(issue){observed.current=current;setReport(inspection);setError('');}
        else setError('自动配装未完成：'+e.message);
      }}
      finally{
        progressActive=false;
        clearInterval(progressTimer);
        if(alive.current&&token===operation.current){
          if(completed){publishCalculation(progress.complete());await new Promise(resolve=>setTimeout(resolve,120));}
          if(alive.current&&token===operation.current){setWorking(false);setActivity('');}
        }
      }
    };
    if(!paused&&resumePending.current&&view.current&&view.current.value.contextKey!==conditionKey)resumePending.current=false;
    // Picker typing, map-node focus and disclosure changes do not alter the
    // fleet or route. Keep the expensive fleet/map derivation across those
    // renders; revision and resume still invalidate mutable game snapshots.
    const data=retain(view,paused||resumePending.current,[kind,slots,paused?'':draftDataKey(store,slots,{area,fleet,missionId}),fleet,catalog,area,target,phase,effectivePhase,missionId,revision,
      filterKey,conditionKey,store.info,store.const,store.const?.$ships,store.const?.$equips,store.const?.$shipgraph,
      store.const?.$equipShip,store.const?.$exslotEquips,store.const?.$exslotEquipShips,store.const?.$exslotEquipLimits,
      store.selectorTables,store.expeditionProgress,report,mapRoute,choices,batchRouteChoices,
      routeDrafts,routeCombatResults,combatDeferredPhase,working,prepared.current],()=>{
      const rows=V.fleetRows(store,W.scheme(slots,fleet));
      const rowById=new Map(rows.map(s=>[s.id,s]));
      const expeditionStatus=kind==='expedition'?E.fleetStatus(store,slots):null;
      const mission=catalog.find(m=>Number(m.missionId)===missionId),map=catalog.find(m=>m.area===area);
      const expedition=report.expedition,rate=expedition?.eligible&&Number.isFinite(expedition.greatSuccess?.estimatedPercent)?Math.min(100,Math.max(0,expedition.greatSuccess.estimatedPercent)):null;
      let income=null;try{if(kind==='expedition'&&rows.length)income=W.income(store,slots,missionId);}catch(_){}
      const dirty=report.settingsKey!==JSON.stringify(settings)||JSON.stringify(report.scheme)!==JSON.stringify(W.scheme(slots,fleet));
      const overview=kind==='normal'?W.mapOverview(area,target,phase,selectionSettings,store):null;
      const mapProfile=overview?W.selectedMapProfile(overview,mapRoute,dirty?null:report.profile,!dirty&&report.valid?report.route:null,rows.length>0,store):null;
      const preselecting=kind==='normal'&&!prepared.current&&slots.some(Boolean);
      const speedReading=kind==='expedition'?null:fleetSpeed(store,preselecting?[]:slots);
      const mechanisms=kind==='expedition'?E.shipBadges(expeditionStatus):preselecting?new Map():fleetMechanisms(store,slots,speedReading,mapProfile);
      const referenceThreat=mapProfile&&mapRoute?W.displayThreat(mapProfile,null):null;
      const targetNodes=mapRoute?mapProfile?.targetNodes||[]:[],targetNode=targetNodes.length===1?mapProfile.mapPreview?.nodes.find(n=>n.id===targetNodes[0]):null;
      // An absent or unknown target is not evidence of a non-combat endpoint.
      // 1-6 and similar transport/end points show two enroute threats instead.
      const targetNonCombat=targetNodes.length>0&&targetNodes.every(id=>{
        const node=mapProfile?.mapPreview?.nodes.find(n=>n.id===id);
        return node&&['start','noBattle','item','resources','transport','activeBranch','airRecon','whirlpool'].includes(node.kind);
      });
      const referenceTargetThreat=targetNode?W.displayThreat(mapProfile,targetNode.id):null;
      const progress=kind==='normal'?W.mapProgress(store,area):null;
      const routeOptions=kind==='normal'?overview.options.map(o=>{
        const saved=batchRouteChoices[o.key]||choices.find(c=>c.key===o.key),draft=routeDrafts[o.key];
        const draftSnapshot=draft&&routeDraftCombatSnapshots.current.get(draft);
        const draftValid=draft?.usable&&draft.revision===revision&&draft.fleet===fleet&&draftSnapshot?.info===store.info&&draftSnapshot?.master===store.const&&
          (o.key!==mapRoute||Array.isArray(draft.slots)&&JSON.stringify(W.scheme(draft.slots,fleet))===JSON.stringify(W.scheme(slots,fleet)));
        const option={...saved,...o,combat:draftValid?draft.combat:routeCombatResults[o.key],...(draft?.usable&&o.key!==mapRoute&&draft.revision===revision&&draft.fleet===fleet?{status:'available'}:{}),displayPaths:undefined,displayPathLabel:undefined,
          ...(rows.length&&saved?.displayPaths?{name:saved.name||o.name,presetName:o.name,label:saved.label,pathLabel:saved.pathLabel,displayPaths:saved.displayPaths,displayPathLabel:saved.displayPathLabel||saved.pathLabel}:{})};
        return o.key===mapRoute&&!dirty&&report.valid&&report.route?.area===area?
          require('../../domain/routes/route_plans').fleetPathOption(report.route,option):option;
      }):[];
      const selectedRoute=routeOptions.find(o=>o.key===mapRoute);
      const currentDraft=routeDrafts[mapRoute],currentDraftSnapshot=currentDraft&&routeDraftCombatSnapshots.current.get(currentDraft);
      const currentDraftCombat=currentDraft?.usable&&currentDraft.revision===revision&&currentDraft.fleet===fleet&&
        Array.isArray(currentDraft.slots)&&JSON.stringify(W.scheme(currentDraft.slots,fleet))===JSON.stringify(W.scheme(slots,fleet))&&
        currentDraftSnapshot?.info===store.info&&currentDraftSnapshot?.master===store.const?currentDraft.combat:null;
      const combat=kind==='normal'&&(!combatDeferredPhase||combatDeferredPhase!==effectivePhase)?
        assessCombat({store,report,option:selectedRoute,dirty:dirty||preselecting||working}):
        currentDraftCombat||{status:'awaitingCompletion'};
      if(selectedRoute&&combat?.balance&&!dirty&&!preselecting&&!working)selectedRoute.combat=combat;
      const fallbackThreat=item=>item&&rows.length?{...item,status:'partial',warnings:['尚未按当前舰队核对']} : item;
      const threat=combat?.threats?.enroute||fallbackThreat(referenceThreat),
        targetThreat=targetNode?.boss?W.displayBossFlagship(mapProfile,targetNode.id):combat?.threats?.target||fallbackThreat(referenceTargetThreat);
      const routeReady=!dirty&&report.valid&&report.route?.area===area&&rows.length>0;
      const routeIssue=W.draftRouteIssue(report,selectedRoute,routeReady);
      const baseArrival=W.routeArrival(report,selectedRoute,routeReady,target);
      const arrival=routeIssue?{...baseArrival,value:routeIssue.value,tone:'bad',unreachable:routeIssue.unreachable,note:'',noteLines:[],warnings:routeIssue.warnings}:baseArrival;
      const requirementGroups=new Map();
      const guidancePaths=!dirty&&report.valid&&selectedRoute?.displayPaths?.length?selectedRoute.displayPaths:
        require('../../domain/routes/route_plans').optionPaths(selectedRoute);
      for(const path of guidancePaths){
        for(const point of require('../../domain/routes/route_plans').requirementDetails(area,path,effectivePhase,!dirty&&report.valid?report.route:null)){
          const previous=requirementGroups.get(point.from);
          if(previous){if(!previous.exits.includes(point.to))previous.exits.push(point.to);}
          else requirementGroups.set(point.from,{...point,exits:[point.to]});
        }
      }
      const nodeOrder=require('../../domain/routes/route_plans').orderedPathNodes(guidancePaths);
      const routeRequirements=[...requirementGroups.values()].sort((a,b)=>nodeOrder.indexOf(a.from)-nodeOrder.indexOf(b.from)).map(p=>({...p,to:p.exits.join(' / '),
        rules:p.rules.map(r=>({...r,offRoute:r.active&&p.exits.every(to=>!r.destinations.split('/').includes(to))}))}));
      const speedRequirement=W.routeSpeedSummary(routeRequirements,selectedRoute);
      const routeSearchFailed=['notFound','unconfirmed'].includes(selectedRoute?.status);
      const reasons=kind==='normal'&&(routeIssue||!routeSearchFailed)?arrival.warnings:[];
      const checks=(expedition?.checks||[]).filter(c=>!c.sat);
      // Fleet power belongs to the draft; thresholds belong to the selected map path.
      const summary=W.fleetSummary(dirty?{}:report,mapProfile||report.profile,kind==='normal'?require('../../domain/routes/route_plans').optionPaths(selectedRoute):undefined);
      if(kind==='normal'){
        summary.air.tooltipContent=JSON.stringify(T.air(store,dirty?null:report.metrics?.airPower,summary.air));
        summary.los.tooltipContent=JSON.stringify(T.los(dirty?null:report.metrics?.lineOfSight,summary.los));
      }
      const changeSummary=rows.length&&!dirty&&report.valid?W.changeSummary(store,slots,fleet):'';
      return {contextKey:conditionKey,effectivePhase,changeSummary,rows,rowById,expeditionStatus,mission,map,expedition,rate,income,dirty,overview,mapProfile,speedReading,speedRequirement,mechanisms,combat,currentDraftCombat,threat,targetThreat,targetNonCombat,progress,routeOptions,selectedRoute,arrival,routeIssue,routeRequirements,routeSearchFailed,reasons,checks,summary};
    });
    const {changeSummary,rows,rowById,expeditionStatus,mission,map,expedition,rate,income,dirty,overview,mapProfile,speedReading,speedRequirement,mechanisms,combat,currentDraftCombat,threat,targetThreat,targetNonCombat,progress,routeOptions,selectedRoute,arrival,routeIssue,routeRequirements,routeSearchFailed,reasons,checks,summary}=data||{rows:[],dirty:false,routeOptions:[]};
    React.useEffect(()=>{
      if(!paused&&!resumePending.current&&kind==='normal'&&mapRoute&&!routeOptions.some(o=>o.key===mapRoute))setMapRoute('');
    },[paused,kind,area,target,phase,mapRoute,store.info?.maps]);
    const preselecting=kind==='normal'&&!prepared.current&&slots.some(Boolean);
    const calculating=working||(!hidden&&!preselecting&&dirty&&rows.length>0);
    const cardActivity=working?({complete:'补全中',route:'切换路线中',equipment:'调整装备中'})[activity]:null;
    const resultsPending=!busy&&(working&&['complete','route','equipment'].includes(activity)||!preselecting&&dirty&&rows.length>0);
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
    const applyHint=busy?'正在应用编成':working?activityText:!rows.length||preselecting?'可先选入任务舰娘，也可直接补全':dirty?'正在核对编成…':!report.valid?(report.error||'编成需要调整'):conditionsChanged?'条件已变更 · 当前编成已保留，请点击一键补全':checks.length?'远征条件未满足 · 可调整后再应用':notice||changeSummary+(reasons.length?' · 请留意路线条件':'');
    const portrait=row=>h('div',{className:'paa-wb-portrait'},h('span',null,row.name.slice(0,2)),row.portrait?h('img',{src:row.portrait,alt:'',draggable:false,onError:e=>{e.currentTarget.style.display='none';}}):null);
    const shipCard=(s,i)=>{
      const remove=()=>{
        const next=pad(slots.filter((x,j)=>x&&j!==i));invalidateRouteChoices();commit(next);
        if(kind==='normal'){
          if(!next.some(Boolean)){prepared.current=false;return;}
          if(prepared.current||mapRoute)return refreshEquipment(next,{activate:!prepared.current});
        }else if(kind==='expedition'&&next.some(Boolean))return refreshEquipment(next);
      };
      if(!s)return h('button',{key:'empty-'+i,type:'button',className:'paa-wb-empty','data-fleet-slot':i,'data-empty':'true',disabled:disabled,onClick:()=>open(i)},h('span',null,'＋'),`第 ${i+1} 位 · 选择舰娘`);
      if(!store.info.ships[s.id])return h('article',{key:s.id,className:'paa-wb-ship'},h('p',{className:'paa-error'},'舰娘数据已变化，请重新选择'),h('button',{type:'button',disabled,onClick:()=>open(i)},'重新选择'));
      const row=rowById.get(s.id),master=store.const.$ships[store.info.ships[s.id].api_ship_id];
      const gearSlot=k=>{
        const item=V.withAirPower(row.gearIcons.find(x=>x.slot===k),dirty?null:report.metrics?.airPower,s.id);
        const equipment=store.const.$equips[store.info.equips[item?.id]?.api_slotitem_id];
        const planes=aircraftCapacity(master,equipment,k);
        return h('button',{key:k,type:'button',disabled:disabled||preselecting,className:'paa-wb-gear'+(s.keep[k]?' kept':''),
          ...V.equipmentTooltipProps(item,[planes!==undefined?`满载 ${planes??'未知'} 架`:'',s.keep[k]?'一键补全时保留':''].filter(Boolean)),onClick:()=>open(i,k)},
          h('span',{className:'paa-wb-slot-label'},k==='ex'?'增':Number(k)+1),item?h(EquipmentIcon,{item}):h('span',{className:'paa-wb-gear-empty'},'＋'),
          h('span',{className:'paa-wb-gear-name'},item?item.tooltip.replace(/^.*? · /,''):'空槽'),
          planes!==undefined?h('span',{className:'paa-wb-aircraft-count','data-planes':planes??'unknown','aria-label':planes===null?'满载数量未知':`满载 ${planes} 架`},`${planes??'—'} 架`):null,
          s.keep[k]?h('span',{className:'paa-wb-kept'},'定'):null);
      };
      return h('article',{key:s.id,className:'paa-wb-ship','data-preselected':kind==='normal'&&!!s.preselected||undefined,'data-fleet-slot':i,'data-ship-id':s.id},
        kind==='normal'&&s.preselected?h('span',{className:'paa-wb-preselected'},'预选'):null,
        h('div',{className:'paa-wb-ship-head'},portrait(row),h('div',{className:'paa-wb-identity'},h('strong',{'data-tooltip':row.name},row.name),h('small',null,`${i===0?'旗舰':`第 ${i+1} 位`} · ${W.TYPES[master.api_stype]||row.type} · Lv.${row.level}`)),
          h('div',{className:'paa-wb-ship-actions'},
            h('button',{type:'button',className:'paa-wb-replace',disabled:disabled,onClick:()=>open(i),'data-tooltip':'替换舰娘'},'换船'),
            h('button',{type:'button',className:'paa-wb-remove',disabled:disabled,onClick:remove,'data-tooltip':'从当前编成移除'},'移除'))),
        h('div',{className:'paa-wb-mechanisms','aria-label':kind==='expedition'?'当前远征状态':'当前配装机制'},...mechanismBadges(mechanisms.get(s.id))),
        h('div',{className:'paa-wb-gears'},...s.slots.map((_,k)=>gearSlot(k)),store.info.ships[s.id].api_slot_ex!==0?gearSlot('ex'):h('div',{className:'paa-wb-gear-unopened'},'增 · 未开启')),
        h(ExecutionCard,{running:!!(busy&&!hidden&&executionPlan?.fleet===fleet&&executionPlan.targets?.[i]===s.id),stopping,fleet,index:i,ship:s.id}));
    };
    const popupRows=popup&&!paused&&!resumePending.current?(popup.slot===undefined?W.replacementCandidates(store,slots,popup.index,search,'all',{kind,filters:selectionSettings})
      .filter(row=>(shipType==='all'||(shipType.startsWith('type:')?String(row.typeId)===shipType.slice(5):shipGroup(row.typeId)===shipType))&&(shipFleet==='all'||row.fleet===Number(shipFleet)))
      .sort((a,b)=>shipSort==='level-asc'?a.level-b.level||a.id-b.id:shipSort==='morale-desc'?b.cond-a.cond||b.level-a.level||a.id-b.id:
        shipSort==='name'?a.name.localeCompare(b.name,'ja')||b.level-a.level||a.id-b.id:b.level-a.level||a.id-b.id):W.equipmentOptions(store,slots,popup.index,popup.slot,search)):[];
    const currentEquipment=popup?.slot!==undefined?(popup.slot==='ex'?slots[popup.index]?.ex:slots[popup.index]?.slots[popup.slot]):null;
    const replacementShip=popup?.slot===undefined&&slots[popup?.index]?store.info?.ships?.[slots[popup.index].id]:null;
    const replacementType=replacementShip&&store.const?.$ships?.[replacementShip.api_ship_id]?.api_stype;
    const replacementTypeLabel=W.TYPES[replacementType]||store.const?.$shipTypes?.[replacementType]?.api_name||'未知舰种';
    const equipmentGroups=new Map();
    if(popup?.slot!==undefined)for(const row of popupRows){
      if(!equipmentGroups.has(String(row.categoryId)))equipmentGroups.set(String(row.categoryId),{name:row.category,rows:[]});
      equipmentGroups.get(String(row.categoryId)).rows.push(row);
    }
    const selectedCategory=equipmentGroups.has(equipmentCategory)?equipmentCategory:'all';
    const visiblePopupRows=popup?.slot===undefined?popupRows.slice(0,80):
      selectedCategory==='all'?popupRows:equipmentGroups.get(selectedCategory).rows;
    const pick=row=>{
      const next=slots.slice(),replacing=popup.slot===undefined&&!!slots[popup.index];
      if(popup.slot===undefined){next[popup.index]={...W.entry(store,row.id),pin:true,...kind==='normal'&&!prepared.current?{...(!slots[popup.index]?{preselected:true}:{}),preselectionComplete:false}:{}};setExcluded(ids=>ids.filter(id=>id!==row.id));}
      else{const s=next[popup.index],k=popup.slot;next[popup.index]={...s,slots:s.slots.slice(),keep:{...s.keep,[k]:true}};
        if(k==='ex')next[popup.index].ex=row.id;else next[popup.index].slots[k]=row.id;}
      invalidateRouteChoices();
      commit(next);setPopup(null);
      if(popup.slot===undefined&&(kind!=='normal'||prepared.current||replacing&&mapRoute))return refreshEquipment(next,{activate:kind==='normal'&&!prepared.current});
    };
    const field=(label,value,onChange,options,route)=>h('label',{className:'paa-wb-field','data-route-caption':!!route},h('span',null,label),h('select',{'aria-label':label,value,disabled,onChange:e=>onChange(e.target.value)},...options.map(([value,name,optionDisabled])=>h('option',{key:value,value,disabled:optionDisabled},name))),
      route?h('span',{className:'paa-wb-route-caption','aria-hidden':true},h('span',{className:'paa-wb-route-name'},route.name),h('span',{className:'paa-wb-route-path'},`（${route.displayPathLabel||route.strategy?.pathLabel||route.pathLabel||route.nodes.join('→')}）`)):null);
    const normalRouteControl=kind==='normal'?h(RoutePicker,{options:routeOptions,value:mapRoute,area,disabled,hidden,
      showNext:routeOptions.some(option=>(option.phase||'')===(selectedRoute?.phase||effectivePhase||'')&&option.key!==mapRoute&&!['notFound','unconfirmed'].includes(option.status)),
      currentPhase:require('../../domain/routes/route_plans').currentPhase(area,store),onChange:value=>{
        if(disabled||routeOptions.some(option=>option.key===value&&['notFound','unconfirmed'].includes(option.status)))return;
        const nextPhase=routeOptions.find(option=>option.key===value)?.phase||phaseForRoute(value);
        if(value&&nextPhase!==effectivePhase){
          // A gauge is a fresh composition: don't carry a saved fleet, fixed
          // equipment, exclusions or predictions into the next stage.
          operation.current++;routeCache.current=null;routeRequests.current.clear();prepared.current=false;invalidateRouteCombat();resultViews.current.clear();
          commit(blank());setChoices([]);setRouteDrafts({});setExcluded([]);setPopup(null);setSearch('');
          setWorking(false);setActivity('');setPhase('');setCombatDeferredPhase(nextPhase);setRoutePhaseAnchor(nextPhase);setPurpose('clear');
          setMapRoute(value);setPathIndex(0);setNodeId(null);setRouteRulesOpen(false);return;
        }
        // Keep each route's manual composition and disclosures, including
        // preselection drafts that have not yet been calculated.
        if(mapRoute&&slots.some(Boolean)){
          const current=getStore(),currentInspection=!prepared.current?null:report.valid&&report.settingsKey===JSON.stringify(settings)&&
            JSON.stringify(report.scheme)===JSON.stringify(W.scheme(slots,fleet))?report:W.inspect(getController(),current,slots,settings);
          const currentArrival=currentInspection?.valid?W.routeArrival(currentInspection,selectedRoute,true,target):null;
          const usable=!!currentInspection?.valid&&!W.draftRouteIssue(currentInspection,selectedRoute,true)&&
            (currentArrival.value==='固定到达'||currentArrival.value.startsWith('到达概率'));
          const reading=usable?(!combatDeferredPhase||combatDeferredPhase!==effectivePhase?
            assessCombat({store:current,report:currentInspection,option:selectedRoute,dirty:false}):currentDraftCombat):null;
          const draftCombat=reading||null;
          const saved={slots,excluded,prepared:prepared.current,draftContext,pathIndex,nodeId,routeRulesOpen,error,notice,usable,revision,fleet,combat:draftCombat,
            choices:choices.filter(c=>['notFound','unconfirmed'].includes(c.status)).map(({key,phase,status,diagnostics,message})=>({key,phase,status,diagnostics,message}))};
          routeDraftCombatSnapshots.current.set(saved,{info:current.info,master:current.const});
          setRouteDrafts(previous=>({...previous,[mapRoute]:saved}));
        }
        if(!value){setRoutePhaseAnchor(effectivePhase);setMapRoute('');setPathIndex(0);setNodeId(null);setNotice('');setError('');return;}
        setRoutePhaseAnchor(nextPhase);
        const saved=routeDrafts[value];
        if(saved){
          const constraints=rows=>JSON.stringify(normalHolds(rows));
          if(constraints(saved.slots)!==constraints(slots)||JSON.stringify(saved.excluded||[])!==JSON.stringify(excluded))invalidateRouteCombat();
          const current=getStore(),nextSettings={...settings,phase:phaseForRoute(value,current)};
          const inspection=saved.prepared?W.inspect(getController(),current,saved.slots,nextSettings):{valid:false};
          operation.current++;observed.current=current;prepared.current=!!saved.prepared;
          setSlots(saved.slots);setExcluded(saved.excluded||[]);setChoices(saved.choices||[]);setDraftContext(saved.draftContext);
          setReport(inspection);setPathIndex(saved.pathIndex||0);setNodeId(saved.nodeId||null);setRouteRulesOpen(!!saved.routeRulesOpen);
          setMapRoute(value);setPopup(null);setNotice(saved.notice||'');setError(!saved.prepared||inspection.valid?(saved.error||''):inspection.error||'编成需要重新核对');return;
        }
        inspectSelection(value);setMapRoute(value);setNodeId(null);
        if((!combatDeferredPhase||combatDeferredPhase!==phaseForRoute(value))&&prepared.current&&
          (draftContext===conditionKey||!slots.some(Boolean)))return complete(style,true,value);
      }}):null;
    const contextControls=h('div',{className:'paa-wb-context-controls'},
        kind==='normal'?h(AreaPicker,{maps:catalog,mapMasters:store.const.$maps,value:area,onChange:changeArea,disabled,hidden}):
        h(React.Fragment,null,h(AreaPicker,{kind:'expedition',missions:catalog,missionMasters:store.const.$missions,missionProgress:store.expeditionProgress,fleets:store.info.fleets,useItems:store.const.$useitems,value:missionId,onChange:changeMission,disabled,hidden}),expeditionView.goal({value:goal,onChange:changeGoal,disabled})),normalRouteControl);
    const commandControls=h('div',{className:'paa-wb-command-area','data-running':!!busy},h('div',{className:'paa-wb-command-row'},h('div',{className:'paa-wb-edit-controls'},h('button',{type:'button',className:'paa-wb-complete',disabled,onClick:()=>complete()},h('svg',{width:15,height:15,viewBox:'0 0 20 20',fill:'none',stroke:'currentColor',strokeWidth:1.5,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('path',{d:'m4 16 9-9 3 3-9 9zM4 3v4M2 5h4M14 1v3M12.5 2.5h3'})),working&&activity==='complete'?'计算中…':'一键补全'),
          h('button',{type:'button',className:'paa-wb-quiet',disabled,onClick:()=>{if(kind==='normal'){operation.current++;routeCache.current=null;prepared.current=false;invalidateRouteCombat();resultViews.current.clear();setExcluded([]);setPopup(null);setSearch('');setWorking(false);setActivity('');setPhase('');setCombatDeferredPhase('');setRoutePhaseAnchor('');setPurpose('clear');setMapRoute('');setPathIndex(0);setNodeId(null);setRouteRulesOpen(false);setRouteDrafts({});}commit(blank());setChoices([]);}},'一键清空'),
        ),
        automaticOperations||busy?h('div',{className:'paa-wb-apply-controls'},field('编入',fleet,value=>{const next=Number(value);setFleet(next);setReport({valid:false});},[1,2,3,4].filter(n=>kind!=='expedition'||n>1).map(n=>{const f=store.info?.fleets?.[n-1],unavailable=!f||Number(f.api_mission?.[0])!==0;return [n,`第 ${n} 舰队${unavailable?'（不可用）':''}`,unavailable];})),
        h('button',{type:'button',className:'paa-primary paa-wb-apply',ref:stopButtonRef,'data-running':!!busy,'data-warning':!!applyWarning,disabled:busy?stopping:applyDisabled,'data-tooltip':busy?'停止后续操作，已发送的操作会正常完成':applyDisabled?applyHint:applyWarning?.hint||'将当前编成应用到所选舰队',onClick:()=>{if(busy){if(!stopping)return onStop?.();return;}if(automaticOperations&&!applyDisabled)return onApply(W.scheme(slots,fleet));}},busy?(stopping?'正在停止…':'停止操作'):applyWarning?.label||'应用编成')):null));
    const rendered=h('div',{className:'paa-workbench','data-kind':kind,hidden},
      h('div',{className:'paa-wb-columns'},
        h('section',{className:'paa-wb-left'},contextControls,
          kind==='expedition'?stableResult('expedition',expeditionView.overview({mission,master:store.const.$missions?.[missionId],missionMasters:store.const.$missions,missionProgress:store.expeditionProgress,fleets:store.info.fleets,useItems:store.const.$useitems,expedition,rate,income,goal,hasShips:rows.length>0,incomeUnit,onIncomeUnitChange:setIncomeUnit,onMissionChange:changeMission,disabled})):
          h(React.Fragment,null,h('section',{className:'paa-wb-map-section','aria-label':'海域地图与攻略进度'},
            routePreview(h,{profile:mapProfile,mapAsset,pathIndex:0,nodeId,onPath:setPathIndex,onNode:setNodeId,onBackground:()=>setNodeId(null),onExpand:e=>{e?.currentTarget?.focus({preventScroll:true});setMapExpanded(true);},disabled,compact:true,showDetails:!!nodeId,nodePopup:true,textOnly:true,showPaths:false}),
            progress?h('div',{className:'paa-wb-progress-list','aria-label':'海域攻略进度','data-has-current':progress.some(gauge=>gauge.isCurrent)},
              ...progress.map(gauge=>h('div',{key:gauge.node,className:'paa-wb-progress','data-state':gauge.state,'aria-current':gauge.isCurrent?'step':undefined,'data-tooltip':gauge.title},
                h('span',{className:'paa-wb-progress-heading'},routePreview.bossIcon(h,{width:15,height:15}),gauge.label),
                gauge.remaining!==null&&gauge.total!==null?h('progress',{max:gauge.total,value:gauge.remaining,'aria-label':`${gauge.label} · ${gauge.detail}`}):
                  h('span',{className:'paa-wb-progress-unknown',role:'img','aria-label':`${gauge.label} · 进度未知`}),
                h('span',{className:'paa-wb-progress-value'},gauge.detail)))):
              null),
            stableResult('route',h('div',{className:'paa-wb-route-status','data-expandable':!!routeRequirements.length&&!disabled,onClick:event=>{
              if(disabled||!routeRequirements.length||event.defaultPrevented||event.button>0)return;
              const target=event.target?.nodeType===3?event.target.parentElement:event.target;
              if(target.closest?.('.paa-wb-arrival,.paa-wb-route-requirements,a,button,input,select,textarea,summary,[role="button"]'))return;
              const warnings=target.closest?.('.paa-wb-route-warnings');
              if(warnings&&event.clientX>=warnings.getBoundingClientRect().left+warnings.clientLeft+warnings.clientWidth)return;
              const selection=event.currentTarget.ownerDocument?.getSelection();
              if(selection&&!selection.isCollapsed&&event.currentTarget.contains(selection.anchorNode))return;
              setRouteRulesOpen(open=>!open);
            }},
              h(routeRequirements.length?'button':'div',{className:'paa-wb-arrival','data-tone':arrival.tone,
                ...(routeRequirements.length?{type:'button',disabled,'aria-expanded':routeRulesOpen,'aria-controls':`${kind}-route-requirements`,onClick:()=>setRouteRulesOpen(open=>!open)}:{role:'status'})},
                h('span',null,arrival.label),h('strong',null,arrivalIcon(arrival.tone),arrival.value)),
            !routeIssue&&!routeSearchFailed?arrivalNote(h,arrival):null,
            reasons.length?h('div',{className:'paa-wb-route-warnings','data-tone':routeIssue?'bad':undefined,role:'region',tabIndex:0,'aria-label':'路线条件'},...reasons.map((reason,i)=>h('p',{key:i},reason))):null,
            !routeIssue&&['notFound','unconfirmed'].includes(selectedRoute?.status)?h('div',{className:'paa-wb-route-warnings',role:'region',tabIndex:0,'aria-label':'推荐路线受阻条件'},...(selectedRoute.diagnostics?.briefWarnings?.length?selectedRoute.diagnostics.briefWarnings:['未找到符合所选路线的编成']).map((text,i)=>h('p',{key:i},text))):null,
            routeRequirements.length?h('div',{id:`${kind}-route-requirements`,className:'paa-wb-route-requirements','data-open':routeRulesOpen,'aria-hidden':!routeRulesOpen,inert:routeRulesOpen?undefined:''},
              h('div',{className:'paa-wb-route-rules-clip'},
              h('div',{key:`${area}:${phase}:${mapRoute}`,className:'paa-wb-route-rules-scroll',role:'region',tabIndex:0,'aria-label':'详细带路规则'},
              selectedRoute?.source?h('a',{href:selectedRoute.source,target:'_blank',rel:'noopener noreferrer'},'攻略来源'):h('small',{className:'paa-muted'},'推定路线'),
              selectedRoute?.phaseNote?h('small',{className:'paa-muted'},selectedRoute.phaseNote):null,
              h('small',{className:'paa-muted'},'各点从上到下判断；概率判定未命中时继续下一条。随机分岐不保证走所选出口。'),
              ...routeRequirements.map(p=>h('div',{key:p.from},h('strong',null,`${p.from==='start'?'出发点':p.from} → ${p.to}`),
                p.playerChoice?h('div',{className:'paa-wb-player-choice'},h('span',null,'↔ 能动分歧'),`请在游戏中选择 ${p.to} 点`):null,
                ...p.rules.map((r,i)=>h('div',{key:i,className:'paa-wb-route-rule','data-state':r.state,'data-off-route':r.offRoute||undefined},
                  h('div',{className:'paa-wb-rule-heading'},h('strong',null,`${i+1}. → ${r.destinations}`,
                    Number.isFinite(r.chance)?`（${Math.round(r.chance*10000)/100}%，否则继续判断）`:null),
                    h('span',null,({matched:'当前命中',estimated:'按配装估算命中',pending:'条件待确认'})[r.state]||'',r.offRoute?' · 不走所选出口':'')),
                  conditionView(r.conditionTree,r.active,String(i+1))))))))):null),
            h('div',{className:'paa-wb-threat','aria-live':'polite','data-expandable':!!renderCombatBalance.renderTier(h,combat)&&!disabled,onClick:event=>{
              if(disabled||!renderCombatBalance.renderTier(h,combat)||event.defaultPrevented||event.button>0)return;
              const target=event.target?.nodeType===3?event.target.parentElement:event.target;
              if(target.closest?.('.paa-balance-toggle,.paa-collapse,.paa-threat-cards,a,button,input,select,textarea,summary,[role="button"]'))return;
              const selection=event.currentTarget.ownerDocument?.getSelection();
              if(selection&&!selection.isCollapsed&&event.currentTarget.contains(selection.anchorNode))return;
              setCombatDetailsOpen(open=>!open);
            }},h('div',{className:'paa-wb-section-head'},
                renderCombatBalance.renderTier(h,combat)?h('button',{type:'button',className:'paa-balance-toggle',disabled,
                  'aria-expanded':combatDetailsOpen,'aria-controls':`${kind}-combat-details`,
                  onClick:()=>setCombatDetailsOpen(open=>!open)},h('span',{className:'paa-balance-title'},'战况预测'),renderCombatBalance.renderTier(h,combat)):
                  h('h4',null,'战况预测')),
              renderCombatBalance(h,combat),
              collapse(h,{id:`${kind}-combat-details`,open:combatDetailsOpen&&!!renderCombatBalance.renderTier(h,combat)},renderCombatBalance.renderDetails(h,combat)),
              h('div',{className:'paa-threat-cards'},h('strong',{className:'paa-threat-title'},'最大威胁'),
                ...(targetNonCombat?(threat?.enemies?.length?threat.enemies.slice(0,2).map(enemy=>({enemy,item:threat})):[{item:threat}]):
                  [{enemy:targetThreat?.enemies?.[0],item:targetThreat},{enemy:threat?.enemies?.[0],item:threat}])
                  .map(({enemy,item},index)=>h('div',{key:index,className:'paa-threat-card'},
                    enemy?h('div',{className:'paa-threat-enemy'},portrait({name:enemy.name,portrait:V.portraitUrl(store,enemy.apiId)}),
                      h('span',null,enemy.name,h('small',null,`${(enemy.nodes||[]).join(' / ')} 点`))):
                      h('span',{className:'paa-muted'},!mapRoute?'请选择路线':item?.status==='none'?'无战斗':'敌情暂不可用'))))))),
          h(QuestSection,{state:store,slots,deckId:fleet,kind,mapId:kind==='normal'?area:undefined,
            missionId:kind==='expedition'?missionId:undefined,questState,paused,disabled,selectedQuests,onToggleQuest:code=>{
              if(disabled)return;operation.current++;routeCache.current=null;setRouteDrafts({});setChoices([]);invalidateRouteCombat();
              setSelectedQuests(current=>current.includes(code)?current.filter(item=>item!==code):[...current,code].sort());setError('');
            },onClearQuests:()=>{if(disabled)return;operation.current++;routeCache.current=null;setRouteDrafts({});setChoices([]);invalidateRouteCombat();setSelectedQuests([]);setError('');}})),
        h('section',{className:'paa-wb-right','aria-busy':working},commandControls,
          error?h('p',{className:'paa-operation-feedback','data-state':'error',role:'alert'},error):null,
          operationFeedback,
          kind==='expedition'?stableResult('expedition-metrics',expeditionView.metrics({status:expeditionStatus,mission,income})):null,
          kind==='normal'?stableResult('metrics',h('div',{className:'paa-wb-metrics','data-columns':3,'aria-label':'舰队速力、制空与索敌','aria-live':'polite'},
            h('div',{className:'paa-wb-metric speed','data-tier':speedReading.tier,'data-has-requirement':speedRequirement.hint?'true':undefined,...T.attributes(T.speed(speedReading,speedRequirement)),tabIndex:0,'aria-label':`舰队速力：${speedReading.ships.length?speedReading.label:'—'}`},
              h('svg',{className:'paa-wb-speed-gauge',viewBox:'0 0 19 14','aria-hidden':true},...[1,2,3,4].map(t=>h('rect',{key:t,x:(t-1)*5,y:14-t*3,width:3,height:t*3,rx:0.6,fill:t<=speedReading.tier?'currentColor':'none',stroke:'currentColor',strokeWidth:0.6,opacity:t<=speedReading.tier?1:0.28}))),
              h('strong',null,speedReading.ships.length?speedReading.label:'—'),
              speedRequirement.hint?h('small',null,speedRequirement.hint):null),
            summaryMetric(summary.air,'air'),summaryMetric(summary.los,'los'))):null,
          h('div',{className:'paa-wb-ships',ref:grid},...slots.map(shipCard),
            cardActivity?h('div',{className:'paa-wb-calculating paa-wb-fleet-overlay',role:'status','data-activity':activity},
              h('span',{className:'paa-wb-calculation-label'},h('span',{className:'paa-wb-calculation-heading'},
                h('span',{className:'paa-wb-calculation-spinner','aria-hidden':true}),cardActivity),
                h(CalculationProgress,{channel:calculationChannel.current}))):null),
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
      popup?h('div',{className:'paa-wb-popup-shade',onClick:()=>setPopup(null)},h('section',{className:'paa-wb-popup','data-picker':popup.slot===undefined?'ship':'equipment',role:'dialog','aria-modal':true,'aria-label':popup.slot===undefined?'替换舰娘':'替换装备',onClick:e=>e.stopPropagation()},
        h('div',{className:'paa-wb-section-head'},h('h3',null,`第 ${popup.index+1} 位 · ${popup.slot===undefined?'选择舰娘':popup.slot==='ex'?'补强增设':`第 ${Number(popup.slot)+1} 槽`}`),h('button',{type:'button',onClick:()=>setPopup(null)},'关闭')),
        h('div',{className:'paa-wb-popup-filters'},h('input',{autoFocus:true,type:'search',value:search,'aria-label':'搜索候选',placeholder:popup.slot===undefined?'舰名 / 舰种 / ID':'装备名称 / 分类 / ID',onChange:e=>setSearch(e.target.value)}),
          popup.slot!==undefined?h('select',{'aria-label':'装备分类',value:selectedCategory,onChange:e=>setEquipmentCategory(e.target.value)},
            h('option',{value:'all'},'全部分类'),...[...equipmentGroups].map(([id,group])=>h('option',{key:id,value:id},`${group.name} (${group.rows.length})`))):
            h('select',{'aria-label':'排序方式',value:shipSort,onChange:e=>setShipSort(e.target.value)},
              h('option',{value:'level-desc'},'等级从高到低'),h('option',{value:'level-asc'},'等级从低到高'),
              h('option',{value:'morale-desc'},'士气从高到低'),h('option',{value:'name'},'舰名排序'))),
        popup.slot===undefined?h('div',{className:'paa-wb-ship-filters'},
          h('div',{className:'paa-wb-ship-filter-row',role:'group','aria-label':'舰队筛选'},h('span',null,'舰队'),
            h('div',{className:'paa-wb-ship-filter-options'},... [['all','全部'],['1','第一舰队'],['2','第二舰队'],['3','第三舰队'],['4','第四舰队']].map(([key,label])=>h('button',{key,type:'button','aria-pressed':shipFleet===key,onClick:()=>setShipFleet(key)},label)))),
          h('div',{className:'paa-wb-ship-filter-row',role:'group','aria-label':'舰种筛选'},h('span',null,'舰种'),
            h('div',{className:'paa-wb-ship-filter-options'},... [['all','全部'],...(replacementType!=null?[[`type:${replacementType}`,`同舰种：${replacementTypeLabel}`]]:[]),...SHIP_GROUPS].map(([key,label])=>h('button',{key,type:'button','aria-pressed':shipType===key,onClick:()=>setShipType(key)},label))))):null,
        popup.slot===undefined?h('p',{className:'paa-muted'},kind==='expedition'?'换入后自动推荐远征装备':kind==='normal'&&!prepared.current?'先预选舰娘，一键补全后统一配装':'换入后自动推荐装备'):null,
        h('div',{className:'paa-wb-popup-list',ref:popupList},...visiblePopupRows.flatMap((row,i)=>[
          popup.slot!==undefined&&(i===0||row.categoryId!==visiblePopupRows[i-1].categoryId)?h('h4',{key:`category-${row.categoryId}`,className:'paa-wb-equipment-group'},row.category):null,
          h('button',{key:row.id,type:'button',className:popup.slot===undefined?undefined:'paa-wb-equipment-option','aria-current':row.id===currentEquipment?'true':undefined,...popup.slot===undefined?{}:V.equipmentTooltipProps(row),disabled:disabled||!!row.unavailable,onClick:()=>pick(row)},
          popup.slot===undefined?portrait(row):h(EquipmentIcon,{item:row}),h('span',{className:popup.slot===undefined?undefined:'paa-wb-equipment-label'},h('strong',null,row.name),popup.slot===undefined?h('small',null,`${row.type} · Lv.${row.level} · ${row.fleetLabel} · 疲劳 ${row.cond}${row.unavailable?' · '+row.unavailable:row.preferenceReasons.length?' · 自动筛选：'+row.preferenceReasons.join('、')+'（可手动选入）':''}`):
            row.stars>0||row.proficiency>0?h('span',{className:'paa-wb-equipment-quality'},[row.stars>0?`★${row.stars}`:'',row.proficiency>0?`熟练 ${row.proficiency}`:''].filter(Boolean).join(' · ')):null,
            popup.slot!==undefined&&row.statsSummary?h('span',{className:'paa-wb-equipment-stats'},row.statsSummary):null,
            row.id===currentEquipment?h('span',{className:'paa-wb-equipment-current'},'当前'):null))]),!visiblePopupRows.length?h('p',{className:'paa-muted'},popup.slot===undefined?'没有匹配舰娘，请调整筛选或搜索。':'没有匹配项，请修改搜索。'):null),
        h('div',{className:'paa-wb-popup-bottom'},h('span',{className:'paa-muted'},popup.slot===undefined?`${popupRows.length} 项${popupRows.length>80?' · 输入名称缩小范围':''}`:`${visiblePopupRows.length} 种配置`),
          popup.slot!==undefined?h('button',{type:'button',disabled,onClick:()=>pick({id:-1})},'清空此槽'):null,
          popup.slot!==undefined&&slots[popup.index].keep[popup.slot]?h('button',{type:'button',onClick:()=>{const next=slots.slice(),s=next[popup.index];next[popup.index]={...s,keep:{...s.keep}};delete next[popup.index].keep[popup.slot];invalidateRouteChoices();commit(next);setPopup(null);}},'交给自动配装'):null))):null);
    page.current=rendered;return rendered;
  };
};
