'use strict';
const W=require('./workbench_model'),V=require('../models/presentation_model');
const E=require('../expedition/expedition_model');
const T=require('../models/metric_tooltips');
const {arrivalNote}=require('../models/route_presentation');
const {describeCondition}=require('../models/route_conditions');
const {formatMissingRoutingShips,formatBlockedRoute}=require('../models/route_warnings');
const {fleetMechanisms,fleetSpeed,aircraftCapacity}=require('../../domain/combat/ship_mechanisms');
const routePreview=require('../maps/route_preview'),shipDrag=require('../components/ship_drag');
const mapLocalization=require('../maps/map_localization'),metricDisplay=require('../i18n/metric_display');
const airbaseView=require('./airbase_view');
const airbaseEditor=require('./airbase_editor');
const {retain,hiddenPage}=require('../components/retained_view');
const renderCombatBalance=require('../components/combat_balance');
const collapse=require('../components/collapse');
const shipDetailsView=require('../components/ship_details');
require('../i18n/readability');
const statIcon=require('../components/stat_icon');
const {assessCombat}=require('../../application/combat_assessment');
const {assessRouteChoices}=require('../../application/route_combat_assessments');
const {runRouteCombatBatch}=require('./route_combat_batch');
const {createShipPickerCache}=require('./ship_picker_cache');
const {shipGroup,matchesLock}=require('../components/ship_picker');
const equipmentPicker=require('../components/equipment_picker');
const {withoutClaimed}=require('../components/quest_selection');
const {recommendationError,formatError}=require('../models/recommendation_error');
const blank=()=>Array(6).fill(null),pad=rows=>rows.concat(Array(Math.max(0,6-rows.length)).fill(null));
const {createCalculationProgress,createProgressComponent}=require('../components/calculation_progress');
const {t,useLocale,getLocale}=require('../../shared/i18n');
require('../i18n/workbench_catalog');
function arrivalValue(arrival){
  return arrival.probabilityText?t('到达概率 {chance}',{chance:arrival.probabilityText}):t(arrival.value);
}
function gaugeDisplay(gauge){
  if(getLocale()==='zh-CN')return {label:gauge.label,detail:gauge.detail,title:gauge.title};
  const label=t('{nodes} 点',{nodes:gauge.node});
  const unit=gauge.unitKind==='transport'?'TP':t(gauge.unitKind==='arrival'?'次抵达':'次击破');
  const detail=gauge.state==='locked'?t('未解锁'):gauge.state==='complete'?t('已完成'):gauge.state==='pending'?t('未开始'):
    gauge.remaining!==null?t('剩余 {remaining} / {total}{unit}',{remaining:gauge.remaining,total:gauge.total,unit:gauge.unitKind==='transport'?' TP':''}):t('进度未知');
  const explanation=gauge.state==='locked'?t('海域尚未解锁，按本地资料显示完整进度条'):
    gauge.state==='unknown'?t('尚未取得该阶段的有效剩余量'):
      gauge.state==='pending'?t('后续阶段尚未开始；不代表解谜或起点已解锁'):detail;
  const total=gauge.total!==null?t(' · 总计 {total} {unit}',{total:gauge.total,unit}):'';
  return {label,detail,title:t('第 {stage} 阶段 · {label} · {detail}{total}',{stage:gauge.stage,label,detail:explanation,total})};
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
function normalSnapshotKey(store,area){
  const id=Number(String(area).replace('-',''));
  return JSON.stringify([require('../../application/snapshots').fingerprint(store),store.info?.maps?.[id],store.const?.$maps?.[id]]);
}
module.exports=function createWorkbench(React,{getController,getStore,subscribe,setQuestPageActive}){
  const expeditionView=require('../expedition/expedition_view')(React);
  const h=React.createElement,EquipmentIcon=require('../components/equipment_icon')(React);
  const mechanismBadges=require('../components/mechanism_badges')(React);
  const ExecutionCard=require('../components/execution_card')(React,{subscribe,getStore});
  const QuestSection=require('../components/quest_section')(React,{getController,subscribe});
  const questFocus=require('../components/quest_focus'),useQuestFocus=questFocus.createQuestFocus(React);
  const AreaPicker=require('../components/area_picker')(React);
  const RoutePicker=require('../components/route_picker')(React);
  const FleetTargetPicker=require('../components/fleet_target_picker')(React);
  const FleetImportPicker=require('../components/fleet_import_picker')(React);
  const ShipPicker=require('../components/ship_picker')(React);
  const EquipmentPicker=equipmentPicker(React);
  const useMapLoading=require('../maps/map_loading')(React,{getStore});
  const CalculationProgress=createProgressComponent(React);
  const summaryMetric=(reading,kind,{unselected=false}={})=>{
    const good=kind==='air'?['supremacy','superiority'].includes(reading.stateCode):['meets','notRequired'].includes(reading.stateCode);
    const warning=reading.bad||reading.uncertain||reading.stateCode==='estimatedMeets';
    const tone=warning?'warning':good?reading.stateCode==='supremacy'?'green':kind==='air'?'blue':'green':'neutral';
    const icon=h('svg',{viewBox:'0 0 16 16','aria-hidden':true},warning?
      h('path',{d:'M8 2 15 14H1ZM8 6v4m0 2v.1'}):
      [h('circle',{key:'circle',cx:8,cy:8,r:6}),h('path',{key:'mark',d:good?'m5 8 2 2 4-4':'M5 8h6'})]);
    const state=unselected?t(kind==='air'?'制空':'索敌'):t(reading.state);
    return h('div',{className:'paa-wb-metric '+kind+(reading.bad?' insufficient':''),'data-tone':tone,
      'data-tooltip':[reading.hint,reading.detail].filter(Boolean).join('\n'),
      'data-tooltip-content':reading.tooltipContent,tabIndex:0,
      'aria-label':t(kind==='air'?'制空 {value}，{state}':'33式索敌 {value}，{state}',{value:reading.value,state:unselected?t(reading.state):state})},
      h('span',{className:'paa-wb-metric-state'},icon,state),
      h('strong',{'data-label':t(kind==='air'?'我方':'33 式')},reading.value),
      unselected?null:h('small',null,metricDisplay.compactHint(reading.compactHint||reading.hint)));
  };
  const arrivalIcon=tone=>['good','warning','bad'].includes(tone)?h('svg',{className:'paa-wb-arrival-icon','data-kind':tone==='good'?'check':'warning',viewBox:'0 0 16 16',width:14,height:14,fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},
    tone==='good'?[h('circle',{key:'outline',cx:8,cy:8,r:6}),h('path',{key:'mark',d:'m5 8 2 2 4-4'})]:h('path',{d:'M8 2 15 14H1ZM8 6v4m0 2v.1'})):null;
  const conditionView=(node,active,number)=>{
    if(!node.operator)return h('span',null,describeCondition(node));
    // Keep deep composite rules readable within the narrow map column.
    // Their complete AND/OR text remains visible without endless indentation.
    if(number.split('.').length>=3)return h('span',null,describeCondition(node));
    if(node.operator==='all'&&node.children.every(c=>!c.operator))return h('span',null,describeCondition(node));
    return h('div',{className:'paa-wb-rule-condition'},
      h('span',{className:'paa-wb-rule-logic'},t(node.operator==='all'?'同时满足：':node.operator==='any'?'满足任一组：':'不满足以下条件：')),
      h('ul',{className:'paa-wb-rule-children'},...node.children.map((child,i)=>h('li',{key:i,
        'data-met':active&&node.operator==='any'?(child.met===true?'yes':'no'):undefined},
        h('span',{className:'paa-wb-rule-number'},`${number}.${i+1}`),
        h('div',null,conditionView(child,active&&child.met===true,`${number}.${i+1}`))))));
  };
  return function Workbench({kind,busy,automaticFilters,automaticOperations=false,stopping=false,onStop,stopButtonRef,onApply,onActivity,onNavigateQuest,operationFeedback,executionPlan,hidden=false,navigationIntent}){
    const selectionSettings=automaticFilters||getController()?.getRecommendationFilters?.()?.[kind];
    const defaultGoal=kind==='expedition'?'success':'great';
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
    const [mapFormationIndex,setMapFormationIndex]=React.useState(0);
    const [questState,setQuestState]=React.useState(()=>getStore().questState);
    const [routeRulesOpen,setRouteRulesOpen]=React.useState(false);
    const [combatDetailsOpen,setCombatDetailsOpen]=React.useState(false);
    const [shipLock,setShipLock]=React.useState('locked'),[shipSort,setShipSort]=React.useState('level-desc');
    const [routeDrafts,setRouteDrafts]=React.useState({});
    const [selectedQuests,setSelectedQuests]=React.useState([]);
    const [noPlan,setNoPlan]=React.useState('');
    const [expeditionCompleted,setExpeditionCompleted]=React.useState(false);
    const [attributeDetails,setAttributeDetails]=React.useState({});
    const [equipmentGroup,setEquipmentGroup]=React.useState('all'),[equipmentSort,setEquipmentSort]=React.useState('default');
    const [landBaseDrafts,setLandBaseDrafts]=React.useState({}),[basePopup,setBasePopup]=React.useState(null);
    const [baseClock,setBaseClock]=React.useState(()=>Date.now());
    const [shipWindow,setShipWindow]=React.useState(0);
    const [questFocusOpen,setQuestFocusOpen]=React.useState(false);
    const {ref:questFocusRef,change:changeQuestFocus}=useQuestFocus(questFocusOpen,hidden,setQuestFocusOpen);
    const locale=useLocale(React);
    const grid=React.useRef(null),alive=React.useRef(true),positions=React.useRef(new Map()),popupList=React.useRef(null);
    const resultViews=React.useRef(new Map());
    const pendingShipView=React.useRef(null);
    const pickerCache=React.useRef(null),pickerRowsCache=React.useRef(null);
    if(!pickerCache.current)pickerCache.current=createShipPickerCache();
    const calculationChannel=React.useRef({value:'',listeners:new Set()});
    const mapDialog=React.useRef(null),noPlanDialog=React.useRef(null);
    const operation=React.useRef(0),routeCache=React.useRef(null),latest=React.useRef(null),prepared=React.useRef(false);
    const routeCombatGeneration=React.useRef(0),routeCombatContext=React.useRef(null),routeCombatSnapshot=React.useRef(null),routeRequests=React.useRef(new Map());
    // Non-serializable, snapshot-bound results from the initial route assessment.
    const preparedRoutes=React.useRef(new Map());
    const handledNavigation=React.useRef(null);
    // Store references must stay outside serializable drafts (hot reload backs
    // drafts up on disk); an old or restored draft simply gets reassessed.
    const routeDraftCombatSnapshots=React.useRef(new WeakMap());
    const observed=React.useRef(null),view=React.useRef(null),page=React.useRef(null),resumePending=React.useRef(false),initialized=React.useRef(false),routeSelection=React.useRef(null),airbaseSnapshot=React.useRef(null);
    React.useEffect(()=>setMapFormationIndex(0),[area,nodeId]);
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
    React.useEffect(()=>{if(!paused&&!working)setSelectedQuests(current=>withoutClaimed(current,questState));},[questState,paused,working]);
    React.useEffect(()=>{
      if(kind!=='normal'||paused||!(store.info?.airbaseRelocations||[]).some(row=>Number.isFinite(row.startedAt)))return;
      setBaseClock(Date.now());const timer=setInterval(()=>{
        const now=Date.now();setBaseClock(now);
        if(!(store.info?.airbaseRelocations||[]).some(row=>Number.isFinite(row.startedAt)&&now-row.startedAt<720000))clearInterval(timer);
      },1000);return()=>clearInterval(timer);
    },[kind,paused,store.info?.airbaseRelocations]);
    const landBaseEntry=kind==='normal'?landBaseDrafts[area]:null;
    const landBases=kind==='normal'?(landBaseEntry?.bases||airbaseEditor.observedDraft(store,area)):null;
    const landBaseItems=[...new Set((landBaseEntry?.bases||[]).flatMap(base=>base.slots||[]).map(slot=>slot.itemId).filter(id=>id>0))];
    const mapAsset=useMapLoading(kind==='normal'?area:null,!paused);
    React.useEffect(()=>{
      const dialog=mapDialog.current;
      if(!mapExpanded||disabled||hidden){if(dialog?.open)dialog.close();if(mapExpanded)setMapExpanded(false);return;}
      const opener=dialog?.ownerDocument.activeElement;
      if(dialog&&!dialog.open){dialog.showModal();dialog.querySelector('button')?.focus();}
      return ()=>{if(dialog?.open)dialog.close();if(opener?.isConnected)opener.focus({preventScroll:true});};
    },[mapExpanded,disabled,hidden]);
    React.useEffect(()=>{
      const dialog=noPlanDialog.current;
      if(!noPlan||disabled||hidden){if(dialog?.open)dialog.close();return;}
      const opener=dialog?.ownerDocument.activeElement;
      if(dialog&&!dialog.open){dialog.showModal();dialog.querySelector('button')?.focus();}
      return()=>{if(dialog?.open)dialog.close();if(opener?.isConnected)opener.focus({preventScroll:true});};
    },[noPlan,disabled,hidden]);
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
      if(paused||working)return;
      // Precompute only plain data; images are requested lazily on opening.
      const host=grid.current?.ownerDocument?.defaultView;let idle;
      const prepare=()=>{try{pickerCache.current.get(getStore(),{kind,filters:selectionSettings});}catch(_){}};
      const timer=setTimeout(()=>{if(host?.requestIdleCallback)idle=host.requestIdleCallback(prepare,{timeout:1200});else prepare();},200);
      return()=>{clearTimeout(timer);if(idle!==undefined)host?.cancelIdleCallback?.(idle);};
    },[paused,working,revision,filterKey,kind]);
    const commit=(next,inspection)=>{
      const unchanged=report.valid&&report.settingsKey===JSON.stringify(settings)&&
        (kind!=='normal'||report.route?.encounterStage===require('../../domain/combat/encounter_stage').encounterStage(getStore(),area,effectivePhase))&&
        JSON.stringify(report.scheme)===JSON.stringify(W.scheme(next,fleet));
      if(!next.some(Boolean))setDraftContext(null);else if(!slots.some(Boolean))setDraftContext(conditionKey);
      setNotice('');setSlots(next);setError('');setReport(inspection||(unchanged?report:{valid:false}));
    };
    // Retain only last-search failures until clear or a new search. Successful
    // recommendations and their fleet-specific labels are stale after an edit.
    const invalidateRouteCombat=()=>{routeCombatGeneration.current++;routeCombatSnapshot.current=null;preparedRoutes.current.clear();setRouteCombatResults({});setBatchRouteChoices({});};
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
      commit(blank());setChoices([]);setRouteDrafts({});setLandBaseDrafts({});setBasePopup(null);setSelectedQuests([]);setExcluded([]);setPopup(null);setNoPlan('');setSearch('');setShipLock('locked');
      setWorking(false);setActivity('');
      setArea(value);const selected=catalog.find(m=>m.area===value);
      setTarget(selected?.bossNodes?.length?'boss':selected?.terminalNodes?.[0]||'boss');
      setPhase('');setCombatDeferredPhase('');setRoutePhaseAnchor('');setPurpose('clear');setMapRoute('');setPathIndex(0);setNodeId(null);
    };
    const changeMission=(value,{preserveDraft=false}={})=>{
      value=Number(value);if(value===missionId)return;
      operation.current++;routeCache.current=null;prepared.current=false;resultViews.current.clear();
      setExpeditionCompleted(false);
      if(preserveDraft){setReport({valid:false});setError('');setNotice('');}else{commit(blank());setShipLock('locked');}
      setChoices([]);setSelectedQuests([]);setExcluded([]);setPopup(null);setNoPlan('');setSearch('');
      setWorking(false);setActivity('');
      setShipType('all');setEquipmentCategory('all');setMissionId(value);setGoal(defaultGoal);
    };
    React.useEffect(()=>{
      const intent=navigationIntent;
      if(hidden||busy||working||!intent||intent.kind!==kind||handledNavigation.current===intent.id)return;
      handledNavigation.current=intent.id;
      const current=getStore(),nextArea=intent.area||area,nextMission=intent.missionId??missionId;
      const related=require('../../domain/quests/quest_requirements').listRelatedQuests({state:current,slots,deckId:fleet,
        mapId:kind==='normal'?nextArea:undefined,missionId:kind==='expedition'?nextMission:undefined,questState:current.questState});
      if(related.status!=='ready'||!related.tasks.some(task=>task.code===intent.code)){
        setError('任务已变化或未同步，请重新选择任务');return;
      }
      observed.current=current;setQuestState(current.questState);
      let changed=false;
      if(kind==='normal'){
        const nextTarget=intent.area?(intent.target||'boss'):target,nextPhase=intent.area?(intent.phase||''):phase;
        changed=nextArea!==area||nextTarget!==target||nextPhase!==phase;
        if(nextArea!==area)changeArea(nextArea);
        else if(changed){
          operation.current++;routeCache.current=null;prepared.current=false;invalidateRouteCombat();resultViews.current.clear();
          commit(blank());setChoices([]);setRouteDrafts({});setExcluded([]);setPopup(null);setNoPlan('');setSearch('');setShipLock('locked');
          setWorking(false);setActivity('');setMapRoute('');setPathIndex(0);setNodeId(null);
        }
        if(changed){setTarget(nextTarget);setPhase(nextPhase);setCombatDeferredPhase(nextPhase);setRoutePhaseAnchor(nextPhase);setPurpose('clear');}
      }else if(Number(nextMission)!==missionId){changed=true;changeMission(nextMission);}
      setSelectedQuests(previous=>changed?[intent.code]:previous.includes(intent.code)?previous:[...previous,intent.code].sort());
      setError('');
    },[navigationIntent,hidden,busy,working]);
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
      let previousAirbase=kind==='normal'?airbaseView.signature(previous,area):'';
      const inSortie=state=>Array.isArray(state?.sortie?.sortieStatus)&&state.sortie.sortieStatus.some(Boolean);
      let deferred=inSortie(previous);
      // A hidden page may have missed task-list responses. Show the latest
      // statuses on resume instead of flashing the old synchronization hint.
      setQuestState(previous.questState);
      const timer=setInterval(()=>{const next=getStore();
        // Quest changes update this small read-only section without invalidating
        // the route/loadout inspection or the recommendation caches.
        setQuestState(previous=>previous===next.questState?previous:next.questState);
        // Battle packets repeatedly replace ship and map data. Keep the draft
        // and its visible results stable until the fleet returns; explicit user
        // actions still inspect the latest store through their own paths.
        const ongoing=inSortie(next),sameAccount=(next.info?.basic?.api_member_id??null)===(previous.info?.basic?.api_member_id??null);
        if(ongoing&&sameAccount){deferred=true;return;}
        const stage=kind==='normal'?require('../../domain/combat/encounter_stage').encounterStage(next,area,effectivePhase):null;
        const nextAirbase=kind==='normal'?airbaseView.signature(next,area):'';
        if(deferred||stage!==previousStage||nextAirbase!==previousAirbase||['ships','equips','fleets','repairs','basic','maps'].some(k=>next.info?.[k]!==previous.info?.[k])||next.const!==previous.const||next.expeditionProgress!==previous.expeditionProgress){previous=next;previousStage=stage;previousAirbase=nextAirbase;deferred=ongoing;setRevision(x=>x+1);}
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
    React.useEffect(()=>{if(disabled){setPopup(null);setBasePopup(null);}},[disabled]);
    React.useEffect(()=>{if(!popup&&!basePopup)return;const document=popupList.current?.ownerDocument||grid.current?.ownerDocument;if(!document)return;
      const escape=e=>{if(e.key==='Escape'){setPopup(null);setBasePopup(null);}};
      document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape);
    },[popup,basePopup]);
    const open=(index,slot)=>{
      observed.current=getStore();
      const current=slot==='ex'?slots[index]?.ex:slots[index]?.slots[slot];
      const category=slot!==undefined&&current>0?W.equipmentOptions(observed.current,slots,index,slot,'',landBaseItems).find(row=>row.id===current)?.categoryId:null;
      const ship=slot===undefined&&slots[index]?observed.current.info?.ships?.[slots[index].id]:null;
      const type=ship&&observed.current.const?.$ships?.[ship.api_ship_id]?.api_stype;
      setSearch('');setEquipmentCategory(category===null||category===undefined?'all':String(category));
      setEquipmentGroup(category===null||category===undefined?'all':equipmentPicker.groupForCategory(category));setEquipmentSort('default');
      setShipType(type!=null?`type:${type}`:'all');setShipSort('level-desc');setPopup({index,slot});
    };
    const openBase=(rid,slotId)=>{
      if(disabled)return;
      observed.current=getStore();setPopup(null);setSearch('');setEquipmentCategory('all');setEquipmentGroup('all');setEquipmentSort('default');setBasePopup({rid,slotId});
    };
    const updateLandBases=updater=>{
      if(disabled||!landBases)return;
      const next=updater(data?.routeBases||landBases);invalidateRouteCombat();
      setLandBaseDrafts(previous=>({...previous,[area]:{bases:next,warnings:[]}}));
    };
    const changeBaseTarget=(rid,wave,value)=>{
      const limit=require('../../../data/sortie/land_base/maps.json').maps.find(map=>map.id===area)?.maxSortieSquadrons||0;
      const current=data?.routeBases||landBases;
      const other=(current||[]).filter(base=>base.rid!==rid&&base.targets?.some(Boolean)).length;
      if(value&&other>=limit){setLandBaseDrafts(previous=>({...previous,[area]:{bases:current,warnings:[`本海域最多出击 ${limit} 队`]}}));return;}
      updateLandBases(bases=>airbaseEditor.changeTarget(bases,rid,wave,value).map(base=>base.rid===rid?
        {...base,targetsLocked:true,...(value?{mode:1,modePlanned:true}:{})}:base));
    };
    React.useEffect(()=>{if(popupList.current)popupList.current.scrollTop=0;setShipWindow(0);},[popup,basePopup,search,equipmentCategory,equipmentGroup,equipmentSort,shipType,shipLock,shipSort]);
    const choosePlan=(row,key=conditionKey,selectedRoute='')=>{
      const current=getStore(),next=W.merge(current,slots,row.scheme,{preservePositions:kind!=='normal'}),
        nextRoute=row.routeKey||selectedRoute||'';
      if(!row.planningOnly)getController().preview('fleet',W.scheme(next,fleet));
      const inspection=W.inspect(getController(),current,next,{...settings,phase:phaseForRoute(nextRoute)});
      observed.current=current;commit(next,inspection);prepared.current=true;setDraftContext(key);setPathIndex(0);setNodeId(null);setNotice('路线与编成已同步');
      if(kind==='expedition')setExpeditionCompleted(true);
      setMapRoute(nextRoute);
    };
    const importCurrentFleet=number=>{
      if(disabled)return;
      const current=getStore(),imported=W.importFleet(current,number);
      if(imported.status!=='ready'){setError(({empty:'空舰队',unsynced:'舰队资料未同步',unsupported:'超过六艘'})[imported.status]||'舰队资料未同步');return;}
      const next=kind==='normal'?imported.slots.map(slot=>slot?{...slot,preselected:true,preselectionComplete:true}:slot):imported.slots;
      operation.current++;routeCache.current=null;invalidateRouteCombat();resultViews.current.clear();
      setChoices([]);setRouteDrafts({});setExcluded([]);setPopup(null);setBasePopup(null);setNoPlan('');setPathIndex(0);setNodeId(null);
      observed.current=current;prepared.current=kind==='normal';
      // An imported fleet is a fixed draft to inspect, not a recommendation
      // for whichever curated fleet strategy happened to be selected before.
      if(kind==='normal'){
        const adaptive=require('../../domain/routes/route_plans').recommendedOptions(area,target,effectivePhase,selectionSettings,current).find(option=>option.fallback);
        setMapRoute(adaptive?.key||'');
      }
      const inspection=W.inspect(getController(),current,next,settings);
      commit(next,inspection);setDraftContext(conditionKey);
      if(kind==='expedition')setExpeditionCompleted(false);
    };
    const cacheKey=(requestedGoal=goal,requestedPhase=phase)=>JSON.stringify([kind,area,target,requestedPhase,purpose,missionId,requestedGoal,fleet,excluded,filterKey,landBaseItems,
      slots.map((s,i)=>s&&(s.pin||Object.keys(s.keep).length)?[i,s.id,s.pin,Object.keys(s.keep).map(k=>[k,k==='ex'?s.ex:s.slots[k]])]:null),...(selectedQuests.length?[selectedQuests]:[])]);
    const normalHolds=rows=>W.recommendationHolds(rows,{preservePositions:false}).filter(Boolean).map(hold=>
      ({...hold,keep:Object.fromEntries(Object.entries(hold.keep).sort(([a],[b])=>a.localeCompare(b)))})).sort((a,b)=>a.id-b.id);
    const preparedRoute=(key,current,rows=slots)=>{
      const entry=preparedRoutes.current.get(key);
      if(!entry||entry.info!==current.info||entry.master!==current.const||
        entry.signature!==JSON.stringify([kind,area,target,purpose,missionId,goal,fleet,excluded,filterKey,normalHolds(rows),selectedQuests])||
        entry.fingerprint!==normalSnapshotKey(current,area)||
        entry.baseSignature!==null&&entry.baseSignature!==airbaseView.planningSignature(current)||
        entry.report.settingsKey!==JSON.stringify({...settings,phase:phaseForRoute(key,current)}))return null;
      return entry;
    };
    const publishCalculation=(value,progress)=>{const channel=calculationChannel.current;channel.progress=progress.snapshot();channel.value=value;for(const listener of channel.listeners)listener(value);};
    const startProgressTimer=(progress,isActive)=>{
      const timer=setInterval(()=>{
        if(!isActive()){clearInterval(timer);return;}
        const value=progress.tick();if(value)publishCalculation(value,progress);
      },1000);
      return timer;
    };
    const requestNormalRoute=(service,query,signature,initialStore,sourceFingerprint,onProgress)=>{
      const pending=routeRequests.current.get(signature);
      if(pending&&pending.info===initialStore.info&&pending.master===initialStore.const&&pending.fingerprint===sourceFingerprint)return pending.promise;
      const promise=(async()=>{const {snapshotId}=service.createSnapshot();return service.recommendNormalFleet({...query,snapshotId},onProgress);})();
      const entry={info:initialStore.info,master:initialStore.const,fingerprint:sourceFingerprint,promise};routeRequests.current.set(signature,entry);
      const clear=()=>{if(routeRequests.current.get(signature)===entry)routeRequests.current.delete(signature);};
      promise.then(clear,clear);return promise;
    };
    const startRouteCombat=(found,requestedPhase,initialStore,baseStore,baseSignature,sourceFingerprint,signature,proposeLandBases,selectLandBaseCombat,timings,planningBases)=>{
      const generation=++routeCombatGeneration.current,context=routeCombatContext.current,service=getController();
      const initialInfo=initialStore.info,initialMaster=initialStore.const;
      const prepared=new Map();preparedRoutes.current.clear();
      routeCombatSnapshot.current={info:initialInfo,master:initialMaster,signature};
      const routeOptions=require('../../domain/routes/route_plans').recommendedOptions(area,target,undefined,selectionSettings,initialStore)
        .filter(option=>!option.fallback||found.routeResults?.some(row=>row.key===option.key&&row.status==='available'));
      const current=requestedPhase||'';
      const currentKeys=new Set(routeOptions.filter(option=>(option.phase||'')===current).map(option=>option.key));
      setBatchRouteChoices(previous=>Object.fromEntries(Object.entries(previous).filter(([key])=>!currentKeys.has(key))));
      setRouteCombatResults(previous=>({...Object.fromEntries(Object.entries(previous).filter(([key,value])=>!currentKeys.has(key)&&value?.status!=='pending')),
        ...Object.fromEntries([...currentKeys].map(key=>[key,{status:'pending'}]))}));
      const cancelled=()=>{
        if(!alive.current||routeCombatGeneration.current!==generation)return true;
        const currentStore=getStore();
        if(routeCombatContext.current!==context||currentStore.info!==initialInfo||currentStore.const!==initialMaster||
          baseSignature!==null&&airbaseView.planningSignature(currentStore)!==baseSignature){invalidateRouteCombat();return true;}
        return false;
      };
      const choicesFor=result=>W.routeChoices(result);
      return runRouteCombatBatch({firstPhase:current,firstResult:found,isCancelled:cancelled,
        evaluate:(requested,result)=>assessRouteChoices({store:baseStore,service,slots,fleet,
          settings:{...settings,phase:requested},options:choicesFor(result),isCancelled:cancelled,
          landBases:planningBases?.length?(option,merged,checked)=>proposeLandBases(baseStore,
            {area,routeNodes:require('../../domain/routes/route_plans').orderedPathNodes(require('../../domain/routes/route_plans').fleetPaths(checked.route,option)),
              scheme:W.scheme(merged,fleet),bases:planningBases}):undefined,
          refineLandBaseEquipment:planningBases?.length&&typeof service?.recommendNormalEquipment==='function'?async({option,slots:merged,proposal})=>{
            const {snapshotId}=service.createSnapshot();
            const result=await service.recommendNormalEquipment({snapshotId,scheme:W.scheme(merged,fleet),area,target,
              phase:option.phase||requested||undefined,routeKey:option.fallback?undefined:option.key,
              heldSlots:W.recommendationHolds(merged,{preservePositions:false}),landBases:proposal.bases});
            if(cancelled())return null;
            const updated=W.withEquipment(merged,result.scheme);
            const checked=W.inspect(service,baseStore,updated,{...settings,fleet,phase:option.phase||requested||''});
            const issue=W.draftRouteIssue(checked,option,checked.valid);
            if(!checked.valid||issue)throw Error(checked.error||issue?.message||'联合配装未满足所选路线');
            return {slots:updated,report:checked};
          }:undefined,
          selectLandBaseCombat,onTiming:timings?rows=>timings.push(...rows):undefined,
          onPrepared:(option,result)=>prepared.set(option.key,{...result,info:initialInfo,master:initialMaster,
            fingerprint:sourceFingerprint,baseSignature,signature})}),
        publish:(requested,result,combat)=>{
          if(sourceFingerprint!==null&&normalSnapshotKey(getStore(),area)!==sourceFingerprint){invalidateRouteCombat();return;}
          const options=choicesFor(result).map(option=>{
            const ready=prepared.get(option.key);
            return ready&&option.row?{...option,row:{...option.row,scheme:W.scheme(ready.slots,fleet)}}:option;
          });
          const complete={...Object.fromEntries(routeOptions.filter(option=>(option.phase||'')===requested)
            .map(option=>[option.key,{status:'unknown'}])),...combat};
          preparedRoutes.current=prepared;
          setBatchRouteChoices(previous=>({...previous,...Object.fromEntries(options.map(option=>[option.key,option]))}));
          setRouteCombatResults(previous=>({...previous,...complete}));
        },
        onError:requested=>setRouteCombatResults(previous=>({...previous,...Object.fromEntries(routeOptions
          .filter(option=>(option.phase||'')===requested).map(option=>[option.key,{status:'unknown'}]))}))
      });
    };
    const complete=async(requestedStyle=style,automatic=false,requestedRoute=mapRoute,requestedGoal=goal)=>{
      if(disabled)return;
      const proposeLandBases=kind==='normal'?require('../../application/land_base_proposal_cache').createLandBaseProposalCache():null;
      const selectLandBaseCombat=kind==='normal'?require('../../application/land_base_combat_choice').createLandBaseCombatSelector():null;
      const diagnosticService=kind==='normal'?getController():null;
      const timings=diagnosticService?.getExperimentalSettings?.()?.performanceDebug?[]:null;
      let combatRequest=null;
      const token=++operation.current,key=JSON.stringify([kind,area,target,phase,'clear',requestedStyle,missionId,requestedGoal,filterKey,...(selectedQuests.length?[selectedQuests]:[])]);
      const progress=createCalculationProgress();let progressActive=true,completed=false;
      const origin=conditionKey,initialStore=getStore(),requestedPhase=phaseForRoute(requestedRoute,initialStore);
      const activeQuestCodes=withoutClaimed(selectedQuests,initialStore.questState),questSelectionChanged=activeQuestCodes!==selectedQuests;
      const resultKey=questSelectionChanged?JSON.stringify([kind,area,target,phase,'clear',requestedStyle,missionId,requestedGoal,filterKey,
        ...(activeQuestCodes.length?[activeQuestCodes]:[])]):key;
      const planningBases=kind==='normal'?airbaseEditor.rebaseDraft(initialStore,area,landBases):null;
      const planningItems=[...new Set((planningBases||[]).flatMap(base=>base.slots||[]).map(slot=>slot.itemId).filter(id=>id>0))];
      const initialInfo=initialStore.info,initialMaster=initialStore.const;
      let baseSignature=null,baseStore=initialStore,sourceFingerprint=null;
      try{
        if(kind==='normal')sourceFingerprint=normalSnapshotKey(initialStore,area);
        if(kind==='normal'&&landBases?.length){
          baseSignature=airbaseView.planningSignature(initialStore);
          // The observed airbase list can be an Electron cross-window proxy.
          // Read it once per request; later compare with the live signature.
          baseStore={...initialStore,info:{...initialInfo,airbase:structuredClone(initialInfo.airbase)}};
          if(airbaseView.planningSignature(initialStore)!==baseSignature)throw Error('基地航空队资料已变化，请重新补全');
        }
      }catch(error){setError(error?.message||'基地航空队资料读取失败，请重试');return;}
      const holds=normalHolds(slots);
      const combatSignature=JSON.stringify([kind,area,target,purpose,missionId,requestedGoal,fleet,excluded,filterKey,holds,activeQuestCodes]);
      const previousCombat=routeCombatSnapshot.current;
      if(kind==='normal'&&!automatic&&previousCombat&&(previousCombat.info!==initialInfo||previousCombat.master!==initialMaster||previousCombat.signature!==combatSignature))invalidateRouteCombat();
      const routeOnly=kind==='normal'&&automatic&&requestedRoute&&!String(requestedRoute).startsWith('fallback:');
      const fullSignature=cacheKey(requestedGoal,requestedPhase);
      const signature=kind==='expedition'?JSON.stringify([cacheKey('both'),revision]):routeOnly?
        JSON.stringify([fullSignature,requestedRoute]):fullSignature;
      publishCalculation(progress.update({stage:'prepare'}),progress);
      const progressTimer=startProgressTimer(progress,()=>progressActive&&alive.current&&token===operation.current);
      setWorking(true);setActivity(automatic?'route':'complete');setNotice('');setError('');setPopup(null);setNoPlan('');
      await new Promise(resolve=>setTimeout(resolve,20));
      try{
        if(activeQuestCodes.length){
          const related=require('../../domain/quests/quest_requirements').listRelatedQuests({state:initialStore,slots,deckId:fleet,
            mapId:kind==='normal'?area:undefined,missionId:kind==='expedition'?missionId:undefined,questState:initialStore.questState});
          if(related.status!=='ready'||activeQuestCodes.some(code=>!related.tasks.some(task=>task.code===code)))
            throw Error('所选任务已变化或未同步，请重新选择任务');
        }
        const stamp=kind==='expedition'?require('../../application/snapshots').fingerprint(initialStore):null;
        const fullCached=routeOnly&&!questSelectionChanged?routeCache.current?.get(fullSignature):null;
        const cached=(!questSelectionChanged&&routeCache.current?.get(signature))||((fullCached?.found?.routeResults?.some(row=>row.key===requestedRoute)||
          fullCached?.found?.recommendations?.some(row=>row.routeKey===requestedRoute))?fullCached:null);
        let found;
        if((automatic||kind==='expedition')&&cached&&(cached.key===signature||routeOnly&&cached.key===fullSignature)&&
          (kind==='expedition'?cached.stamp===stamp&&cached.found.goals?.[requestedGoal]:cached.info===initialInfo&&cached.master===initialMaster&&cached.fingerprint===sourceFingerprint))found=kind==='expedition'?{...cached.found,...cached.found.goals[requestedGoal]}:cached.found;
        else{
          const service=getController();
          const query={fleet,fixedShipIds:slots.filter(s=>s&&(s.pin||Object.keys(s.keep).length)).map(s=>s.id),excludedShipIds:excluded,
            ...(activeQuestCodes.length?{questCodes:activeQuestCodes}: {})};
          const onProgress=value=>{if(progressActive&&alive.current&&token===operation.current)publishCalculation(progress.update(value),progress);};
          const searchStart=timings?performance.now():0;
          if(kind==='normal')found=await requestNormalRoute(service,{...query,area,target,phase:requestedPhase||undefined,...(routeOnly?{routeKey:requestedRoute}:{}),
            ...(planningItems.length?{landBaseEquipmentIds:planningItems}:{}),airGoal:'superiority',heldSlots:W.recommendationHolds(slots,{preservePositions:false})},signature,initialStore,sourceFingerprint,onProgress);
          else {const {snapshotId}=service.createSnapshot();found=await service.recommendExpeditionFleet({...query,snapshotId,limit:3,missionId,goal:requestedGoal,heldSlots:W.recommendationHolds(slots),
              ...(slots[0]&&(slots[0].pin||Object.keys(slots[0].keep).length)?{fixedFlagshipId:slots[0].id}:{})},onProgress);}
          if(timings)timings.push({name:'workbench.search',ms:performance.now()-searchStart});
        }
        if(!alive.current||token!==operation.current||![origin,key].includes(latest.current))return;
        publishCalculation(progress.update({stage:'verify'}),progress);
        const currentStore=getStore();
        // The synchronized view may recreate info on every read. For
        // expeditions compare the actual account data, including in-place
        // mutations, instead of the wrapper's object identity.
        if(kind==='expedition'?require('../../application/snapshots').fingerprint(currentStore)!==stamp:
          currentStore.info!==initialInfo||currentStore.const!==initialMaster)throw Error('舰队资料已变化，请重新补全');
        if(baseSignature!==null&&airbaseView.planningSignature(currentStore)!==baseSignature)throw Error('基地航空队资料已变化，请重新补全');
        if(activeQuestCodes.length){
          const current=getStore(),related=require('../../domain/quests/quest_requirements').listRelatedQuests({state:current,slots,deckId:fleet,
            mapId:kind==='normal'?area:undefined,missionId:kind==='expedition'?missionId:undefined,questState:current.questState});
          if(withoutClaimed(activeQuestCodes,current.questState)!==activeQuestCodes){setSelectedQuests(previous=>withoutClaimed(previous,current.questState));return;}
          if(related.status!=='ready'||activeQuestCodes.some(code=>!related.tasks.some(task=>task.code===code)))throw Error('所选任务已变化，请重新选择任务');
        }
        if(!routeCache.current)routeCache.current=new Map();
        if(!questSelectionChanged)routeCache.current.set(signature,{key:signature,info:initialInfo,master:initialMaster,stamp,fingerprint:sourceFingerprint,found});
        // Keep recent gauges available when switching back, with the same
        // snapshot, filters and manual constraints. Bound retained full fleets.
        while(routeCache.current.size>8)routeCache.current.delete(routeCache.current.keys().next().value);
        const options=W.routeChoices(found);setChoices(previous=>previous.filter(c=>(routeOnly||['notFound','unconfirmed'].includes(c.status))&&!options.some(o=>o.key===c.key)).concat(options));
        let defaultRoute=null,rankedCombat=null;
        if(kind==='normal'&&(!automatic||landBases?.length)){
          setCombatDeferredPhase('');
          const sortStart=timings?performance.now():0;
          combatRequest=startRouteCombat(found,requestedPhase,initialStore,baseStore,baseSignature,sourceFingerprint,combatSignature,proposeLandBases,selectLandBaseCombat,timings,planningBases);
          if(timings)combatRequest.then(()=>timings.push({name:'workbench.routeSort',ms:performance.now()-sortStart}),()=>{});
          // With no player-selected route, wait for the same assessments that
          // order the picker before committing a fleet. This avoids first
          // showing a catalogue default and then jumping to the best route.
          if(landBases?.length||!requestedRoute||String(requestedRoute).startsWith('fallback:')){
            const combat=await combatRequest;rankedCombat=combat;
            if(!alive.current||token!==operation.current||![origin,key].includes(latest.current))return;
            const assessedStore=getStore();
            if(assessedStore.info!==initialInfo||assessedStore.const!==initialMaster)throw Error('舰队资料已变化，请重新补全');
            if(baseSignature!==null&&airbaseView.planningSignature(assessedStore)!==baseSignature)throw Error('基地航空队资料已变化，请重新补全');
            const byKey=new Map(options.map(option=>[option.key,option]));
            const ranked=require('../../domain/routes/route_plans').recommendedOptions(area,target,undefined,selectionSettings,initialStore)
              .map(option=>({...byKey.get(option.key),...option,combat:combat?.[option.key]}))
              .filter(option=>option.row&&option.chance);
            defaultRoute=require('../components/route_picker').routeNeighbor(ranked,'',requestedPhase,1);
          }
        }
        // Without an explicit selection, the route catalogue can begin with a
        // route for which the search found no fleet (for example 1-5's
        // coastal-defence route). Select the first result that has both an
        // arrival chance and a matching recommendation instead.
        const rescue=found.routeResults?.find(result=>result.fallback&&result.chance&&found.recommendations?.some(row=>row.routeKey===result.key));
        const preferredRoute=String(requestedRoute||'').startsWith('fallback:')?'':requestedRoute;
        const selectedKey=rescue?.key||preferredRoute||defaultRoute||found.routeResults?.find(result=>result.chance&&
          found.recommendations?.some(row=>row.routeKey===result.key))?.key||
          (!found.routeResults?.length?found.recommendations?.[0]?.routeKey:undefined);
        const routeResult=found.routeResults?.find(r=>r.key===selectedKey);
        if(kind==='normal'&&!found.recommendations?.length){
          const message=recommendationError(found,'当前条件下没有可到达的路线方案，请调整固定舰娘或目标');
          setError(message);setNoPlan({message:'本轮未找到符合路线和当前条件的编成。',
            hint:'可以调整任务勾选、固定舰娘或筛选条件后重试。当前编成已保留。'});
          if(routeResult&&!routeResult.chance)setMapRoute(selectedKey);
          return;
        }
        if(kind==='expedition'&&!found.recommendations?.length&&!found.closestRecommendation){
          setError(recommendationError(found,'当前条件下没有可用方案，请调整固定舰娘或目标'));
          setNoPlan({message:'本轮未找到符合远征和当前条件的编成。',
            hint:'可以调整任务勾选、固定舰娘或筛选条件后重试。当前编成已保留。'});
          return;
        }
        if(routeResult&&!routeResult.chance){setMapRoute(selectedKey);return;}
        if(kind==='normal'&&!selectedKey&&found.routeResults?.length)
          throw Error(found.reason||found.message||'当前条件下没有可到达的路线方案，请调整固定舰娘或目标');
        if(!found.recommendations?.length&&!(kind==='expedition'&&found.closestRecommendation))throw Error(found.reason||found.message||'当前条件下没有可用方案，请调整固定舰娘或目标');
        let row=kind==='normal'?found.recommendations.find(r=>r.routeKey===(selectedKey||found.recommendations[0]?.routeKey)):
          found.recommendations[0]||found.closestRecommendation;
        if(!row)throw Error('所选路线没有可用方案，当前编成已保留，请调整固定舰娘或装备');
        if(kind==='normal'&&landBases?.length){
          const ready=preparedRoutes.current.get(row.routeKey||selectedKey);
          if(ready)row={...row,scheme:W.scheme(ready.slots,fleet)};
          else if(rankedCombat?.[row.routeKey||selectedKey]?.status==='unknown')
            throw Error((rankedCombat[row.routeKey||selectedKey].reasons||[]).join('；')||'陆航与舰队配装尚未完成核对，请重试');
        }
        let finalBaseProposal=null;
        if(kind==='normal'&&landBases?.length){
          const option=options.find(candidate=>candidate.key===(row.routeKey||selectedKey));
          if(option){const finalStart=timings?performance.now():0;
            let proposal=rankedCombat?.[option.key]?.landBaseProposal;
            if(!proposal){const merged=W.merge(baseStore,slots,row.scheme,{preservePositions:false});
              const checked=W.inspect(getController(),baseStore,merged,{...settings,fleet,phase:option.phase||settings.phase||''});
              if(!checked.valid)throw Error(checked.error||'编成核对失败，已保留当前草稿');
              const plans=require('../../domain/routes/route_plans');
              const routeNodes=plans.orderedPathNodes(plans.fleetPaths(checked.route,option));
              proposal=proposeLandBases(baseStore,{area,routeNodes,scheme:W.scheme(merged,fleet),bases:planningBases});
              proposal=selectLandBaseCombat({store:baseStore,report:checked,option,proposal}).proposal;}
            if(timings)timings.push({name:'workbench.finalBase',ms:performance.now()-finalStart});
            finalBaseProposal=proposal;}
        }
        const finalStore=getStore();
        if(baseSignature!==null&&airbaseView.planningSignature(finalStore)!==baseSignature)throw Error('基地航空队资料已变化，请重新补全');
        if(sourceFingerprint!==null&&normalSnapshotKey(finalStore,area)!==sourceFingerprint)throw Error('舰队或装备资料已变化，请重新补全');
        choosePlan(row,resultKey,requestedRoute);
        if(finalBaseProposal)setLandBaseDrafts(previous=>({...previous,[area]:{bases:finalBaseProposal.bases,warnings:finalBaseProposal.warnings||[]}}));
        if(kind==='expedition'&&!found.recommendations?.length)setNoPlan({message:'本轮未找到达标的远征编成。',
          hint:'已显示最接近的参考编成，请检查任务及未满足的出航条件。'});
        completed=true;
      }catch(e){if(alive.current&&token===operation.current&&[origin,key].includes(latest.current))setError(e.message);}
      finally{
        if(timings){const publish=()=>diagnosticService?.recordWorkbenchTiming?.(timings);
          if(combatRequest)combatRequest.then(publish,publish);else publish();}
        progressActive=false;
        clearInterval(progressTimer);
        if(alive.current&&token===operation.current){
          if(questSelectionChanged)setSelectedQuests(previous=>withoutClaimed(previous,getStore().questState));
          if(completed){publishCalculation(progress.complete(),progress);await new Promise(resolve=>setTimeout(resolve,120));}
          if(alive.current&&token===operation.current){setWorking(false);setActivity('');}
        }
      }
    };
    const changeGoal=value=>{
      if(disabled||value===goal)return;
      if(expeditionCompleted){
        // Both goal-specific fleets were produced by the same recommendation.
        // Reuse them only while the snapshot, constraints and tasks still match.
        const current=getStore(),signature=JSON.stringify([cacheKey('both'),revision]),cached=routeCache.current?.get(signature);
        let reusable=false;
        try{
          const active=withoutClaimed(selectedQuests,current.questState);
          const related=active.length?require('../../domain/quests/quest_requirements').listRelatedQuests({state:current,slots,deckId:fleet,
            missionId,questState:current.questState}):null;
          reusable=active===selectedQuests&&(!active.length||related.status==='ready'&&active.every(code=>related.tasks.some(task=>task.code===code)))&&
            cached?.key===signature&&cached.stamp===require('../../application/snapshots').fingerprint(current);
        }catch(_){reusable=false;}
        const candidate=reusable?cached.found.goals?.[value]:null;
        const row=candidate?.recommendations?.[0]||candidate?.closestRecommendation;
        if(row){
          const key=JSON.stringify([kind,area,target,phase,'clear',style,missionId,value,filterKey,...(selectedQuests.length?[selectedQuests]:[])]);
          setGoal(value);setChoices([]);setError('');setNoPlan('');
          try{
            choosePlan(row,key);
            if(!candidate.recommendations?.length)setNoPlan({message:'本轮未找到达标的远征编成。',
              hint:'已显示最接近的参考编成，请检查任务及未满足的出航条件。'});
          }catch(error){setError(error.message);}
          return;
        }
        setGoal(value);setChoices([]);
        return complete(style,false,mapRoute,value);
      }
      setGoal(value);setChoices([]);
    };
    const refreshEquipment=async(next,{activate=false}={})=>{
      if(!next.some(Boolean))return;
      const activateDraft=items=>{
        if(!activate)return items;
        prepared.current=true;return items.map(s=>s?.preselectionComplete===false?{...s,preselectionComplete:true}:s);
      };
      const token=++operation.current,key=conditionKey,initialStore=getStore();
      const progress=createCalculationProgress();let progressActive=true,completed=false;
      publishCalculation(progress.update({stage:'prepareEquipment'}),progress);
      const progressTimer=startProgressTimer(progress,()=>progressActive&&alive.current&&token===operation.current);
      setWorking(true);setActivity('equipment');setNotice('');
      await new Promise(resolve=>setTimeout(resolve,20));
      try{
        const service=getController(),{snapshotId}=service.createSnapshot();
        const onProgress=value=>{if(progressActive&&alive.current&&token===operation.current)publishCalculation(progress.update(value),progress);};
        const result=await (kind==='expedition'?service.recommendExpeditionEquipment({snapshotId,scheme:W.scheme(next,fleet),missionId,goal,heldSlots:next.filter(Boolean)},onProgress):
          service.recommendNormalEquipment({snapshotId,scheme:W.scheme(next,fleet),area,target,phase:effectivePhase||undefined,heldSlots:next.filter(Boolean),routeKey:mapRoute,
            ...(landBaseItems.length?{landBaseEquipmentIds:landBaseItems}:{})},onProgress));
        if(!alive.current||token!==operation.current||latest.current!==key)return;
        publishCalculation(progress.update({stage:'verify'}),progress);
        if(getStore().info!==initialStore.info||getStore().const!==initialStore.const)throw Error('舰队资料已变化，已保留换船结果，请重新补全');
        const updated=activateDraft(W.withEquipment(next,result.scheme));
        if(kind==='expedition'&&Number(initialStore.info.fleets?.[fleet-1]?.api_mission?.[0])!==0){
          const validated=W.inspect(service,initialStore,updated,settings);if(!validated.valid)throw Error(validated.error||'编成需要调整');
        }else service.preview('fleet',W.scheme(updated,fleet));
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
          if(completed){publishCalculation(progress.complete(),progress);await new Promise(resolve=>setTimeout(resolve,120));}
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
      routeDrafts,routeCombatResults,combatDeferredPhase,working,prepared.current,landBaseEntry],()=>{
      const rows=V.fleetRows(store,W.scheme(slots,fleet));
      const rowById=new Map(rows.map(s=>[s.id,s]));
      const expeditionStatus=kind==='expedition'?E.fleetStatus(store,slots):null;
      const mission=catalog.find(m=>Number(m.missionId)===missionId),map=catalog.find(m=>m.area===area);
      const expedition=report.expedition,rate=expedition?.eligible&&Number.isFinite(expedition.greatSuccess?.estimatedPercent)?Math.min(100,Math.max(0,expedition.greatSuccess.estimatedPercent)):null;
      let income=null;try{if(kind==='expedition'&&rows.length)income=W.income(store,slots,missionId);}catch(_){}
      const dirty=report.settingsKey!==JSON.stringify(settings)||JSON.stringify(report.scheme)!==JSON.stringify(W.scheme(slots,fleet));
      const overview=kind==='normal'?W.mapOverview(area,target,phase,selectionSettings,store):null;
      const mapProfile=overview?W.selectedMapProfile(overview,mapRoute,dirty?null:report.profile,!dirty&&report.valid?report.route:null,rows.length>0,store):null;
      const finalStageNotice=mapRoute?W.finalStageNotice(mapProfile):'';
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
      const verifiedPaths=kind==='normal'&&!dirty&&report.valid&&report.route?.area===area&&selectedRoute?
        require('../../domain/routes/route_plans').displayFleetPaths(report.route,selectedRoute):[];
      const routeBases=kind==='normal'?airbaseEditor.constrainAutoTargets(landBases,verifiedPaths):landBases;
      const currentDraft=routeDrafts[mapRoute],currentDraftSnapshot=currentDraft&&routeDraftCombatSnapshots.current.get(currentDraft);
      const currentDraftCombat=currentDraft?.usable&&currentDraft.revision===revision&&currentDraft.fleet===fleet&&
        Array.isArray(currentDraft.slots)&&JSON.stringify(W.scheme(currentDraft.slots,fleet))===JSON.stringify(W.scheme(slots,fleet))&&
        currentDraftSnapshot?.info===store.info&&currentDraftSnapshot?.master===store.const?currentDraft.combat:null;
      const preparedCandidate=kind==='normal'&&mapRoute?preparedRoute(mapRoute,store):null;
      const reusableCombat=preparedCandidate&&preparedCandidate.report===report&&!dirty&&!preselecting&&!working&&
        preparedCandidate.combat?.reasonCode!=='timeBudgetExceeded'&&
        JSON.stringify(preparedCandidate.landBaseProposal?.bases||null)===JSON.stringify(routeBases||null)?preparedCandidate.combat:null;
      const combat=kind==='normal'&&(!combatDeferredPhase||combatDeferredPhase!==effectivePhase)?
        reusableCombat||assessCombat({store,report,option:selectedRoute,dirty:dirty||preselecting||working,landBases:routeBases}):
        currentDraftCombat||{status:'awaitingCompletion'};
      if(selectedRoute&&combat?.balance&&!dirty&&!preselecting&&!working)selectedRoute.combat=combat;
      const fallbackThreat=item=>item&&rows.length?{...item,status:'partial',warnings:['尚未按当前舰队核对']} : item;
      const threat=combat?.threats?.enroute||fallbackThreat(referenceThreat),
        targetThreat=targetNode?.boss?W.displayBossFlagship(mapProfile,targetNode.id):combat?.threats?.target||fallbackThreat(referenceTargetThreat);
      const routeReady=!dirty&&report.valid&&report.route?.area===area&&rows.length>0;
      const routeIssue=W.draftRouteIssue(report,selectedRoute,routeReady);
      const baseArrival=W.routeArrival(report,selectedRoute,routeReady,target);
      const arrival=routeIssue?{...baseArrival,value:routeIssue.value,usable:false,probabilityText:null,tone:'bad',unreachable:routeIssue.unreachable,note:'',noteLines:[],warnings:routeIssue.warnings}:baseArrival;
      const requirementGroups=new Map();
      const guidancePaths=!dirty&&report.valid&&selectedRoute?.displayPaths?.length?selectedRoute.displayPaths:
        require('../../domain/routes/route_plans').optionPaths(selectedRoute);
      for(const path of guidancePaths){
        for(const point of require('../../domain/routes/route_plans').requirementDetails(area,path,effectivePhase,!dirty&&report.valid?report.route:null,{structured:true})){
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
      const summary=W.fleetSummary(dirty?{}:report,mapProfile||report.profile,kind==='normal'?
        (!dirty&&report.valid&&report.route?.area===area&&report.route.ships?.length?verifiedPaths:
          require('../../domain/routes/route_plans').optionPaths(selectedRoute)):undefined,
        kind==='normal'?{store,landBases:routeBases}:undefined);
      if(kind==='normal'){
        summary.air.tooltipContent=JSON.stringify(T.air(store,dirty?null:report.metrics?.airPower,summary.air));
        summary.los.tooltipContent=JSON.stringify(T.los(dirty?null:report.metrics?.lineOfSight,summary.los));
      }
      const changeSummary=rows.length&&!dirty&&report.valid?W.changeSummary(store,slots,fleet):'';
      return {contextKey:conditionKey,effectivePhase,changeSummary,rows,rowById,expeditionStatus,mission,map,expedition,rate,income,dirty,overview,mapProfile,finalStageNotice,speedReading,speedRequirement,mechanisms,combat,currentDraftCombat,threat,targetThreat,targetNonCombat,progress,routeOptions,selectedRoute,verifiedPaths,routeBases,arrival,routeIssue,routeRequirements,routeSearchFailed,reasons,checks,summary};
    });
    const {changeSummary,rows,rowById,expeditionStatus,mission,map,expedition,rate,income,dirty,overview,mapProfile,finalStageNotice,speedReading,speedRequirement,mechanisms,combat,currentDraftCombat,threat,targetThreat,targetNonCombat,progress,routeOptions,selectedRoute,verifiedPaths,routeBases,arrival,routeIssue,routeRequirements,routeSearchFailed,reasons,checks,summary}=data||{rows:[],dirty:false,routeOptions:[]};
    React.useEffect(()=>{
      if(!paused&&!resumePending.current&&kind==='normal'&&mapRoute&&!routeOptions.some(o=>o.key===mapRoute))setMapRoute('');
    },[paused,kind,area,target,phase,mapRoute,store.info?.maps]);
    const preselecting=kind==='normal'&&!prepared.current&&slots.some(Boolean);
    const calculating=working||(!hidden&&!preselecting&&dirty&&rows.length>0);
    const resultsPending=!busy&&(working&&['complete','route','equipment'].includes(activity)||!preselecting&&dirty&&rows.length>0);
    // Keep the previous result's geometry under a veil, marked as stale.
    // Its DOM remains mounted (including expanded details and scroll position).
    const stableResult=(key,...children)=>{
      if(!resultsPending||!resultViews.current.has(key))resultViews.current.set(key,children);
      return h('div',{className:'paa-wb-calculation-region','data-result-region':key,'aria-busy':!!resultsPending},
        h('div',{className:'paa-wb-calculation-content','aria-hidden':resultsPending||undefined,inert:resultsPending?'':undefined},...resultViews.current.get(key)),
        resultsPending&&!['metrics','expedition-metrics'].includes(key)?h('div',{className:'paa-wb-calculating',role:'status'},
          h('span',{className:'paa-wb-calculation-label'},h('span',{className:'paa-wb-calculation-spinner','aria-hidden':true}),t('计算中…'))):null);
    };
    const airbase=retain(airbaseSnapshot,paused||resumePending.current,
      [kind,area,paused?'':airbaseView.signature(store,area),landBaseEntry,selectedRoute,mapProfile,routeBases,slots,disabled,baseClock,locale],()=>{
        if(kind!=='normal')return null;
        const targets=airbaseEditor.routeTargets(selectedRoute,mapProfile,!dirty&&report.valid?report.route:null),warnings=[...(landBaseEntry?.warnings||[])];
        if(landBaseEntry&&routeBases!==landBases)warnings.push('路线或编成已变化，路线外的自动派遣已清除，请重新补全基地方案');
        if(landBaseEntry&&routeBases?.some(base=>base.targets?.some(Boolean))){
          const check=require('../../recommendation/land_base').validatePlan(store,{area,bases:routeBases,scheme:W.scheme(slots,fleet)});
          warnings.push(...check.issues);
          if(selectedRoute&&routeBases.some(base=>base.targets?.some(node=>node&&!targets.some(target=>target.id===node))))
            warnings.push('部分基地攻击点不在当前路线，沿途不会生效');
        }
        return airbaseView.render(h,EquipmentIcon,store,area,{bases:routeBases,disabled,targets,now:baseClock,
          warnings:[...new Set(warnings)],onTarget:changeBaseTarget,onEditSlot:openBase});
      });
    React.useEffect(()=>{onActivity?.(previous=>previous[kind]===calculating?previous:{...previous,[kind]:calculating});},[calculating,kind,onActivity]);
    React.useEffect(()=>()=>onActivity?.(previous=>previous[kind]?{...previous,[kind]:false}:previous),[kind,onActivity]);
    if(hidden)return hiddenPage(h,page.current,{className:'paa-workbench','data-kind':kind,hidden});
    if(!data)return h('div',{className:'paa-workbench','data-kind':kind},operationFeedback,
      busy?h('button',{type:'button',ref:stopButtonRef,disabled:stopping,onClick:event=>{if(!stopping)onStop?.(event);}},t(stopping?'正在停止…':'停止操作')):null);
    const mapAirbases=kind==='normal'?airbaseView.model(store,area,routeBases)?.bases||[]:[];
    const selectMapNode=id=>{setNodeId(id);setMapFormationIndex(0);};
    const targetFleet=store.info?.fleets?.[fleet-1],targetUnavailable=!targetFleet||!Array.isArray(targetFleet.api_mission)||Number(targetFleet.api_mission[0])!==0;
    const applyDisabled=disabled||resumePending.current||targetUnavailable||!report.valid||report.planningOnly||dirty||!rows.length;
    const applyWarning=!busy&&!dirty&&rows.length?W.applicationWarning(kind,report,selectedRoute,target):null;
    const conditionsChanged=rows.length>0&&draftContext!==null&&draftContext!==conditionKey;
    const activityText=activity==='equipment'?'正在更新装备推荐…':activity==='route'?'正在同步路线与编成…':'正在补全…';
    const applyHint=busy?'正在应用编成':working?activityText:targetUnavailable?'目标舰队正在远征或状态未同步，请选择可用舰队':!rows.length||preselecting?'可先选入任务舰娘，也可直接补全':dirty?'正在核对编成…':report.planningOnly?'导入舰队当前仅供参考，暂不可应用':!report.valid?(report.error||'编成需要调整'):conditionsChanged?'条件已变更 · 当前编成已保留，请点击一键补全':checks.length?'远征条件未满足 · 可调整后再应用':notice||changeSummary+(reasons.length?' · 请留意路线条件':'');
    const portrait=(row,lazy=false,props=null)=>h(props?'button':'div',props?{type:'button',className:'paa-wb-portrait paa-fleet-portrait-toggle',...props}:{className:'paa-wb-portrait'},h('span',null,row.name.slice(0,2)),row.portrait?h('img',{src:row.portrait,alt:'',draggable:false,...(lazy?{loading:'lazy',decoding:'async'}:{}),onError:e=>{e.currentTarget.style.display='none';}}):null);
    const shipCard=(s,i)=>{
      const remove=()=>{
        const next=pad(slots.filter((x,j)=>x&&j!==i));invalidateRouteChoices();commit(next);
        if(kind==='expedition'&&!next.some(Boolean))setExpeditionCompleted(false);
        if(kind==='normal'){
          if(!next.some(Boolean)){prepared.current=false;return;}
          if(prepared.current||mapRoute)return refreshEquipment(next,{activate:!prepared.current});
        }else if(kind==='expedition'&&next.some(Boolean))return refreshEquipment(next);
      };
      if(!s)return h('button',{key:'empty-'+i,type:'button',className:'paa-wb-empty','data-fleet-slot':i,'data-empty':'true',disabled:disabled,onClick:()=>open(i)},h('span',null,'＋'),t('第 {position} 位 · 选择舰娘',{position:i+1}));
      if(!store.info.ships[s.id])return h('article',{key:s.id,className:'paa-wb-ship'},h('p',{className:'paa-error'},t('舰娘数据已变化，请重新选择')),h('button',{type:'button',disabled,onClick:()=>open(i)},t('重新选择')));
      const row=rowById.get(s.id),master=store.const.$ships[store.info.ships[s.id].api_ship_id];
      const gearSlot=k=>{
        const item=V.withAirPower(row.gearIcons.find(x=>x.slot===k),dirty?null:report.metrics?.airPower,s.id);
        const equipmentInstance=store.info.equips[item?.id];
        const displayName=item?(item.name+(equipmentInstance?.api_level>0?` ★${equipmentInstance.api_level}`:'')+
          (equipmentInstance?.api_alv>0?' · '+t('熟练度 {level}',{level:equipmentInstance.api_alv}):'')):'';
        const equipment=store.const.$equips[store.info.equips[item?.id]?.api_slotitem_id];
        const planes=aircraftCapacity(master,equipment,k);
        return h('button',{key:k,type:'button',disabled:disabled||preselecting,className:'paa-wb-gear'+(s.keep[k]?' kept':''),
          ...V.equipmentTooltipProps(item,[planes!==undefined?t('满载 {count} 架',{count:planes??t('未知')}):'',s.keep[k]?t('一键补全时保留'):''].filter(Boolean)),onClick:()=>open(i,k)},
          h('span',{className:'paa-wb-slot-label'},k==='ex'?t('增'):Number(k)+1),item?h(EquipmentIcon,{item}):h('span',{className:'paa-wb-gear-empty'},'＋'),
          h('span',{className:'paa-wb-gear-name'},item?displayName:t('空槽')),
          planes!==undefined?h('span',{className:'paa-wb-aircraft-count','data-planes':planes??'unknown','aria-label':planes===null?t('满载数量未知'):t('满载 {count} 架',{count:planes})},t('{count} 架',{count:planes??'—'})):null,
          s.keep[k]?h('span',{className:'paa-wb-kept'},t('定')):null);
      };
      const detailsId=`paa-workbench-stats-${kind}-${s.id}`,ship=store.info.ships[s.id];
      return h('article',{key:s.id,className:'paa-wb-ship','data-preselected':kind==='normal'&&!!s.preselected||undefined,'data-fleet-slot':i,'data-ship-id':s.id},
        kind==='normal'&&s.preselected?h('span',{className:'paa-wb-preselected'},t('预选')):null,
        h('div',{className:'paa-fleet-ship-heading'},h('div',{className:'paa-wb-ship-head'},portrait(row,false,{disabled,'aria-expanded':!!attributeDetails[s.id],
          'aria-controls':detailsId,'aria-label':t('{name}：属性',{name:row.name}),'data-tooltip':attributeDetails[s.id]?undefined:t('查看属性'),onClick:event=>shipDetailsView.toggle(setAttributeDetails,s.id,event)}),h('div',{className:'paa-wb-identity'},h('strong',null,row.name),h('small',null,`${i===0?t('旗舰'):t('第 {position} 位',{position:i+1})} · ${W.TYPES[master.api_stype]?t(W.TYPES[master.api_stype]):row.type} · Lv.${row.level}`)),
          h('div',{className:'paa-wb-ship-actions'},
            h('button',{type:'button',className:'paa-wb-replace',disabled:disabled,onClick:()=>open(i),'data-tooltip':t('替换舰娘')},t('换船')),
            h('button',{type:'button',className:'paa-wb-remove',disabled:disabled,onClick:remove,'data-tooltip':t('从当前编成移除')},t('移除')))),
          collapse(h,{open:attributeDetails[s.id],id:detailsId},h('dl',{className:'paa-fleet-ship-stats','aria-label':t('舰娘当前属性'),'data-tooltip':t('舰娘当前属性，未计入本页尚未应用的配装')},...shipDetailsView.stats(ship).map(stat=>h('div',{key:stat.label},h('dt',null,statIcon.react(React,stat.label),t(stat.label)),h('dd',null,stat.value===null?'—':stat.value)))))),
        h('div',{className:'paa-wb-mechanisms','aria-label':t(kind==='expedition'?'当前远征状态':'当前配装机制')},...mechanismBadges(mechanisms.get(s.id))),
        h('div',{className:'paa-wb-gears'},...s.slots.map((_,k)=>gearSlot(k)),store.info.ships[s.id].api_slot_ex!==0?gearSlot('ex'):h('div',{className:'paa-wb-gear-unopened'},t('增 · 未开启'))),
        h(ExecutionCard,{running:!!(busy&&!hidden&&executionPlan?.fleet===fleet&&executionPlan.targets?.[i]===s.id),stopping,fleet,index:i,ship:s.id}));
    };
    // A committed recommendation can change card heights before the 100%
    // overlay is removed. Keep the first pending view mounted until the whole
    // result is ready, including a manually selected ship already displayed
    // at the start of an equipment-only calculation.
    if(!resultsPending)pendingShipView.current=null;
    else if(working&&['complete','route','equipment'].includes(activity)&&!pendingShipView.current)pendingShipView.current=slots.map(shipCard);
    const shipCards=pendingShipView.current||slots.map(shipCard);
    const popupRows=popup&&!paused&&!resumePending.current?(popup.slot===undefined?(()=>{
      const selection={kind,filters:selectionSettings},prepared=pickerCache.current.get(store,selection);
      const key=JSON.stringify([slots.map(slot=>slot?.id||null),popup.index,search,shipType,shipLock,shipSort]);
      if(pickerRowsCache.current?.prepared===prepared&&pickerRowsCache.current.key===key)return pickerRowsCache.current.rows;
      const rows=W.replacementCandidates(store,slots,popup.index,search,'all',selection,prepared,{sortFirstFleet:false})
        .filter(row=>(shipType==='all'||(shipType.startsWith('type:')?String(row.typeId)===shipType.slice(5):shipGroup(row.typeId)===shipType))&&matchesLock(store,row.id,shipLock))
        .sort((a,b)=>shipSort==='level-asc'?a.level-b.level||a.id-b.id:shipSort==='morale-desc'?b.cond-a.cond||b.level-a.level||a.id-b.id:
          shipSort==='name'?a.name.localeCompare(b.name,'ja')||b.level-a.level||a.id-b.id:b.level-a.level||a.id-b.id);
      pickerRowsCache.current={prepared,key,rows};return rows;
    })():W.equipmentOptions(store,slots,popup.index,popup.slot,search,landBaseItems)):[];
    const currentEquipment=popup?.slot!==undefined?(popup.slot==='ex'?slots[popup.index]?.ex:slots[popup.index]?.slots[popup.slot]):null;
    const baseCurrent=basePopup?routeBases?.find(base=>base.rid===basePopup.rid)?.slots?.find(slot=>slot.slotId===basePopup.slotId)?.itemId:null;
    const baseRows=basePopup&&!paused?airbaseEditor.equipmentOptions(store,area,routeBases,W.scheme(slots,fleet),basePopup.rid,basePopup.slotId,search):[];
    const pickBase=row=>{
      if(!basePopup||disabled)return;
      const current=getStore();
      if(row.id>0&&!airbaseEditor.equipmentOptions(current,area,routeBases,W.scheme(slots,fleet),basePopup.rid,basePopup.slotId).some(item=>item.id===row.id)){
        setLandBaseDrafts(previous=>({...previous,[area]:{bases:routeBases,warnings:['飞机已不可用，请重新选择']}}));setBasePopup(null);return;
      }
      updateLandBases(bases=>airbaseEditor.replaceSlot(current,bases,basePopup.rid,basePopup.slotId,row.id));setBasePopup(null);
    };
    const replacementShip=popup?.slot===undefined&&slots[popup?.index]?store.info?.ships?.[slots[popup.index].id]:null;
    const replacementType=replacementShip&&store.const?.$ships?.[replacementShip.api_ship_id]?.api_stype;
    const replacementTypeLabel=W.TYPES[replacementType]||store.const?.$shipTypes?.[replacementType]?.api_name||'未知舰种';
    const pick=row=>{
      const next=slots.slice(),replacing=popup.slot===undefined&&!!slots[popup.index];
      if(popup.slot===undefined){next[popup.index]={...W.entry(store,row.id),pin:true,...kind==='normal'&&!prepared.current?{...(!slots[popup.index]?{preselected:true}:{}),preselectionComplete:false}:{}};setExcluded(ids=>ids.filter(id=>id!==row.id));}
      else{const s=next[popup.index],k=popup.slot;next[popup.index]={...s,slots:s.slots.slice(),keep:{...s.keep,[k]:true}};
        if(k==='ex')next[popup.index].ex=row.id;else next[popup.index].slots[k]=row.id;}
      invalidateRouteChoices();
      commit(next);setPopup(null);
      if(replacing&&(kind!=='normal'||prepared.current||mapRoute))return refreshEquipment(next,{activate:kind==='normal'&&!prepared.current});
    };
    const changeRoute=value=>{
        if(disabled||routeOptions.some(option=>option.key===value&&(option.fallback||['notFound','unconfirmed'].includes(option.status))))return;
        const nextPhase=routeOptions.find(option=>option.key===value)?.phase||phaseForRoute(value);
        if(value&&nextPhase!==effectivePhase){
          // A gauge is a fresh composition: don't carry a saved fleet, fixed
          // equipment, exclusions or predictions into the next stage.
          operation.current++;routeCache.current=null;routeRequests.current.clear();prepared.current=false;invalidateRouteCombat();resultViews.current.clear();
          commit(blank());setChoices([]);setRouteDrafts({});setExcluded([]);setPopup(null);setSearch('');setShipLock('locked');
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
            currentArrival.usable===true;
          const reading=usable?(!combatDeferredPhase||combatDeferredPhase!==effectivePhase?
            currentInspection===report&&combat?.status!=='pending'?combat:
              assessCombat({store:current,report:currentInspection,option:selectedRoute,dirty:false,landBases:routeBases}):currentDraftCombat):null;
          const draftCombat=reading||null;
          const saved={slots,excluded,prepared:prepared.current,draftContext,pathIndex,nodeId,routeRulesOpen,error,notice,usable,revision,fleet,combat:draftCombat,
            landBaseEntry:landBaseEntry?{...landBaseEntry,bases:routeBases}:null,
            choices:choices.filter(c=>['notFound','unconfirmed'].includes(c.status)).map(({key,phase,status,diagnostics,message})=>({key,phase,status,diagnostics,message}))};
          const cached=preparedRoute(mapRoute,current);
          routeDraftCombatSnapshots.current.set(saved,{info:current.info,master:current.const,
            ...(cached?.report===currentInspection?{report:currentInspection,fingerprint:cached.fingerprint}:{} )});
          setRouteDrafts(previous=>({...previous,[mapRoute]:saved}));
        }
        if(!value){setRoutePhaseAnchor(effectivePhase);setMapRoute('');setPathIndex(0);setNodeId(null);setNotice('');setError('');return;}
        setRoutePhaseAnchor(nextPhase);
        const saved=routeDrafts[value];
        if(saved){
          const constraints=rows=>JSON.stringify(normalHolds(rows));
          if(constraints(saved.slots)!==constraints(slots)||JSON.stringify(saved.excluded||[])!==JSON.stringify(excluded))invalidateRouteCombat();
          const current=getStore(),nextSettings={...settings,phase:phaseForRoute(value,current)};
          const snapshot=routeDraftCombatSnapshots.current.get(saved);
          const reusable=snapshot?.report&&snapshot.info===current.info&&snapshot.master===current.const&&
            snapshot.fingerprint===normalSnapshotKey(current,area)&&snapshot.report.settingsKey===JSON.stringify(nextSettings)&&
            saved.revision===revision&&saved.fleet===fleet;
          const inspection=saved.prepared?(reusable?snapshot.report:W.inspect(getController(),current,saved.slots,nextSettings)):{valid:false};
          operation.current++;observed.current=current;prepared.current=!!saved.prepared;
          if(Object.prototype.hasOwnProperty.call(saved,'landBaseEntry'))setLandBaseDrafts(previous=>{
            const next={...previous};if(saved.landBaseEntry)next[area]=saved.landBaseEntry;else delete next[area];return next;
          });
          setSlots(saved.slots);setExcluded(saved.excluded||[]);setChoices(saved.choices||[]);setDraftContext(saved.draftContext);
          setReport(inspection);setPathIndex(saved.pathIndex||0);setNodeId(saved.nodeId||null);setRouteRulesOpen(!!saved.routeRulesOpen);
          setMapRoute(value);setPopup(null);setNotice(saved.notice||'');setError(!saved.prepared||inspection.valid?(saved.error||''):inspection.error||'编成需要重新核对');return;
        }
        const current=getStore(),ready=prepared.current?preparedRoute(value,current):null;
        if(ready){
          operation.current++;observed.current=current;setSlots(ready.slots);setReport(ready.report);
          setDraftContext(conditionKey);setPathIndex(0);setNodeId(null);setPopup(null);setNotice('');setError('');
          if(ready.landBaseProposal)setLandBaseDrafts(previous=>({...previous,[area]:{
            bases:ready.landBaseProposal.bases,warnings:ready.landBaseProposal.warnings||[]}}));
          setMapRoute(value);return;
        }
        inspectSelection(value);setMapRoute(value);setNodeId(null);
        if((!combatDeferredPhase||combatDeferredPhase!==phaseForRoute(value))&&prepared.current&&
          (draftContext===conditionKey||!slots.some(Boolean)))return complete(style,true,value);
      };
    const normalRouteControl=kind==='normal'?h(RoutePicker,{options:routeOptions,value:mapRoute,area,disabled,hidden,
      currentPhase:require('../../domain/routes/route_plans').currentPhase(area,store),onChange:changeRoute}):null;
    const routeNeighbor=require('../components/route_picker').routeNeighbor;
    const previousRoute=kind==='normal'?routeNeighbor(routeOptions,mapRoute,effectivePhase,-1):null;
    const nextRoute=kind==='normal'?routeNeighbor(routeOptions,mapRoute,effectivePhase,1):null;
    const contextControls=h('div',{className:'paa-wb-context-controls'},
        kind==='normal'?h(AreaPicker,{maps:catalog,mapMasters:store.const.$maps,value:area,onChange:changeArea,disabled,hidden}):
        h(React.Fragment,null,h(AreaPicker,{kind:'expedition',missions:catalog,missionMasters:store.const.$missions,missionProgress:store.expeditionProgress,fleets:store.info.fleets,useItems:store.const.$useitems,value:missionId,onChange:changeMission,disabled,hidden}),expeditionView.goal({value:goal,onChange:changeGoal,disabled})),normalRouteControl);
    const commandControls=h('div',{className:'paa-wb-command-area','data-running':!!busy},h('div',{className:'paa-wb-command-row'},h('div',{className:'paa-wb-edit-controls'},h('button',{type:'button',className:'paa-wb-complete',disabled,onClick:()=>complete()},h('svg',{width:15,height:15,viewBox:'0 0 20 20',fill:'none',stroke:'currentColor',strokeWidth:1.5,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('path',{d:'m4 16 9-9 3 3-9 9zM4 3v4M2 5h4M14 1v3M12.5 2.5h3'})),t(working&&activity==='complete'?'计算中…':'一键补全')),
          h('button',{type:'button',className:'paa-wb-quiet',disabled,onClick:()=>{if(kind==='normal'){operation.current++;routeCache.current=null;prepared.current=false;invalidateRouteCombat();resultViews.current.clear();setExcluded([]);setPopup(null);setBasePopup(null);setLandBaseDrafts({});setSearch('');setWorking(false);setActivity('');setPhase('');setCombatDeferredPhase('');setRoutePhaseAnchor('');setPurpose('clear');setMapRoute('');setPathIndex(0);setNodeId(null);setRouteRulesOpen(false);setRouteDrafts({});}else setExpeditionCompleted(false);commit(blank());setChoices([]);setShipLock('locked');}},t('一键清空')),
          h(FleetImportPicker,{store,disabled,hidden,onImport:importCurrentFleet}),
        ),
        automaticOperations||busy?h('div',{className:'paa-wb-apply-controls'},h(FleetTargetPicker,{value:fleet,disabled,hidden,onChange:value=>{setFleet(value);setReport({valid:false});},options:[1,2,3,4].filter(n=>kind!=='expedition'||n>1).map(n=>{const f=store.info?.fleets?.[n-1],unavailable=!f||!Array.isArray(f.api_mission),away=f&&!unavailable&&Number(f.api_mission[0])!==0;return {value:n,label:t('第 {fleet} 舰队{status}',{fleet:n,status:unavailable?t('（未同步）'):away?t('（远征中）'):''}),disabled:unavailable||kind!=='expedition'&&away};})}),
        h('button',{type:'button',className:'paa-primary paa-wb-apply',ref:stopButtonRef,'data-running':!!busy,'data-warning':!!applyWarning,
          'data-base':kind==='normal'&&!!landBaseEntry&&(routeBases||[]).some(base=>base.modePlanned||base.slots?.some(slot=>slot.planned)),disabled:busy?stopping:applyDisabled,'data-tooltip':t(busy?'停止后续操作，已发送的操作会正常完成':applyDisabled?applyHint:applyWarning?.hint||'应用舰队及已规划的基地配置；更换飞机可能消耗资源并需要转场'),onClick:event=>{if(busy){if(!stopping)return onStop?.(event);return;}if(automaticOperations&&!applyDisabled){
          const bases=kind==='normal'&&landBaseEntry?(routeBases||[]).filter(base=>base.modePlanned||base.slots?.some(slot=>slot.planned))
            .map(({areaId,rid,mode,modePlanned,slots})=>({areaId,rid,mode,modePlanned,slots})):[];
          return onApply(W.scheme(slots,fleet),bases.length?{landBase:{area,bases}}:undefined);
        }}},busy?t(stopping?'正在停止…':'停止操作'):t(applyWarning?.label||'应用编成')+
          (kind==='normal'&&landBaseEntry&&(routeBases||[]).some(base=>base.modePlanned||base.slots?.some(slot=>slot.planned))?t('（含基地）'):''))):null));
    const rendered=h('div',{className:'paa-workbench','data-kind':kind,hidden},
      h('div',{className:'paa-wb-columns'},
        h('section',{className:'paa-wb-left',ref:questFocusRef,'data-quest-focus':questFocusOpen||undefined},
          questFocus.rows(h,kind==='normal'?[{key:'area',label:t('海域'),value:[area,map?.name].filter(Boolean).join(' ')},
            {key:'route',label:t('路线'),value:selectedRoute?require('../maps/map_localization').routeName(selectedRoute):t('选择路线')},
            {key:'arrival',label:t(arrival.label),value:mapRoute?arrivalValue(arrival):'—'},
            {key:'combat',label:t('战况预测'),value:combat?.balance?.label?t(combat.balance.label):'—'}]:[
            {key:'mission',label:t('远征'),value:[store.const.$missions?.[missionId]?.api_disp_no||missionId,store.const.$missions?.[missionId]?.api_name].filter(Boolean).join(' ')},
            {key:'goal',label:t('目标'),value:t(goal==='great'?'优先大成功':'成功即可')},
            {key:'time',label:t('远征时间'),value:Number.isFinite(store.const.$missions?.[missionId]?.api_time)?t('{m}分',{m:store.const.$missions[missionId].api_time}):'—'},
            {key:'requirements',label:t('出航条件'),value:expedition?(expedition.eligible?t('全部满足'):t('{n} 项待调整',{n:checks.length})):'—'},
            {key:'income',label:t('净收益'),value:'—'}],()=>changeQuestFocus(false),questFocusOpen),
          contextControls,
          kind==='expedition'?stableResult('expedition',expeditionView.overview({mission,master:store.const.$missions?.[missionId],missionMasters:store.const.$missions,missionProgress:store.expeditionProgress,fleets:store.info.fleets,useItems:store.const.$useitems,expedition,rate,income,goal,hasShips:rows.length>0,incomeUnit,onIncomeUnitChange:setIncomeUnit,onMissionChange:value=>changeMission(value,{preserveDraft:true}),disabled})):
          h(React.Fragment,null,h('section',{className:'paa-wb-map-section','aria-label':t('海域地图与攻略进度')},
            routePreview(h,{profile:mapProfile,mapAsset,pathIndex:0,nodeId,onPath:setPathIndex,onNode:selectMapNode,onBackground:()=>selectMapNode(null),onExpand:e=>{e?.currentTarget?.focus({preventScroll:true});setMapExpanded(true);},onPreviousRoute:previousRoute?()=>changeRoute(previousRoute):null,onNextRoute:nextRoute?()=>changeRoute(nextRoute):null,disabled,compact:true,showDetails:!!nodeId,nodePopup:true,textOnly:true,showPaths:false,airbases:mapAirbases}),
            progress?h('div',{className:'paa-wb-progress-list','aria-label':t('海域攻略进度'),'data-has-current':progress.some(gauge=>gauge.isCurrent)},
              ...progress.map(gauge=>{const display=gaugeDisplay(gauge);return h('div',{key:gauge.node,className:'paa-wb-progress','data-state':gauge.state,'aria-current':gauge.isCurrent?'step':undefined,'data-tooltip':display.title},
                h('span',{className:'paa-wb-progress-heading'},routePreview.bossIcon(h,{width:15,height:15}),display.label),
                gauge.remaining!==null&&gauge.total!==null?h('progress',{max:gauge.total,value:gauge.remaining,'aria-label':`${display.label} · ${display.detail}`}):
                  h('span',{className:'paa-wb-progress-unknown',role:'img','aria-label':t('{label} · 进度未知',{label:display.label})}),
                h('span',{className:'paa-wb-progress-value'},display.detail));})):
              null),
            airbase,
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
                h('span',null,t(arrival.label)),h('strong',null,arrivalIcon(arrival.tone),mapRoute?arrivalValue(arrival):'—')),
            !routeIssue&&!routeSearchFailed?arrivalNote(h,arrival):null,
            reasons.length?h('div',{className:'paa-wb-route-warnings','data-tone':routeIssue?'bad':undefined,role:'region',tabIndex:0,'aria-label':t('路线条件')},...reasons.map((reason,i)=>{
              const detail=routeIssue?.warningDetails?.find(item=>item.text===reason);
              return h('p',{key:i},detail?formatBlockedRoute(detail):t(reason));
            })):null,
            !routeIssue&&['notFound','unconfirmed'].includes(selectedRoute?.status)?h('div',{className:'paa-wb-route-warnings',role:'region',tabIndex:0,'aria-label':t('推荐路线受阻条件')},...(selectedRoute.diagnostics?.briefWarnings?.length?selectedRoute.diagnostics.briefWarnings:['未找到符合所选路线的编成']).map((text,i)=>{
              const detail=selectedRoute.diagnostics?.briefWarningDetails?.find(item=>item.text===text);
              return h('p',{key:i},detail?formatMissingRoutingShips(detail):t(text));
            })):null,
            routeRequirements.length?h('div',{id:`${kind}-route-requirements`,className:'paa-wb-route-requirements','data-open':routeRulesOpen,'aria-hidden':!routeRulesOpen,inert:routeRulesOpen?undefined:''},
              h('div',{className:'paa-wb-route-rules-clip'},
              h('div',{key:`${area}:${phase}:${mapRoute}`,className:'paa-wb-route-rules-scroll',role:'region',tabIndex:0,'aria-label':t('详细带路规则')},
              selectedRoute?.source?h('a',{href:selectedRoute.source,target:'_blank',rel:'noopener noreferrer'},t('攻略来源')):h('small',{className:'paa-muted'},t('推定路线')),
              selectedRoute?.phaseNote?h('small',{className:'paa-muted'},selectedRoute.phaseNote):null,
              h('small',{className:'paa-muted'},t('readability.routeGuide')),
              h('small',{className:'paa-wb-rule-legend'},...[
                ['matched','✓','当前命中'],['estimated','≈','按配装估算命中'],['pending','?','条件待确认'],['offRoute','×','readability.routeOff']
              ].filter(([state])=>routeRequirements.some(point=>point.rules.some(rule=>state==='offRoute'?rule.offRoute:rule.state===state||(state==='pending'&&rule.state==='tentative'))))
                .map(([state,icon,label])=>h('span',{key:state,'data-state':state},h('b',{'aria-hidden':true},icon),t(label)))),
              ...routeRequirements.map(p=>h('div',{key:p.from},h('strong',null,`${p.from==='start'?t('出发点'):p.from} → ${p.to}`),
                p.playerChoice?h('div',{className:'paa-wb-player-choice'},h('span',null,t('↔ 能动分歧')),t('请在游戏中选择 {node} 点',{node:p.to})):null,
                ...p.rules.map((r,i)=>h('div',{key:i,className:'paa-wb-route-rule','data-state':r.state,'data-off-route':r.offRoute||undefined},
                  h('div',{className:'paa-wb-rule-heading'},h('strong',null,`${i+1}. → ${r.destinations}`,
                    Number.isFinite(r.chance)?` (${Math.round(r.chance*10000)/100}%)`:null),
                    h('span',{'aria-label':[t(({matched:'当前命中',estimated:'按配装估算命中',pending:'条件待确认',tentative:'条件待确认'})[r.state]||''),r.offRoute?t('readability.routeOff'):''].filter(Boolean).join(' · ')},
                      ({matched:'✓',estimated:'≈',pending:'?',tentative:'?'})[r.state]||'',r.offRoute?' ×':'')),
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
                  onClick:()=>setCombatDetailsOpen(open=>!open)},h('span',{className:'paa-balance-title'},t('战况预测')),renderCombatBalance.renderTier(h,combat)):
                  h('h4',null,t('战况预测'))),
              renderCombatBalance(h,combat,{compactUnselected:true}),
              finalStageNotice?h('p',{className:'paa-balance-stage-note'},t(finalStageNotice)):null,
              collapse(h,{id:`${kind}-combat-details`,open:combatDetailsOpen&&!!renderCombatBalance.renderTier(h,combat)},renderCombatBalance.renderDetails(h,combat)),
              h('div',{className:'paa-threat-cards'},h('strong',{className:'paa-threat-title'},t('最大威胁')),
                ...(!mapRoute?[{unselected:true}]:targetNonCombat?(threat?.enemies?.length?threat.enemies.slice(0,2).map(enemy=>({enemy,item:threat})):[{item:threat}]):
                  [{enemy:targetThreat?.enemies?.[0],item:targetThreat},{enemy:threat?.enemies?.[0],item:threat}])
                  .map(({enemy,item,unselected},index)=>h('div',{key:index,className:unselected?'paa-threat-empty':'paa-threat-card'},
                    enemy?h('div',{className:'paa-threat-enemy'},portrait({name:mapLocalization.enemyName(enemy),portrait:V.portraitUrl(store,enemy.apiId)}),
                      h('span',{className:'paa-threat-identity'},h('span',{className:'paa-threat-name','data-tooltip':mapLocalization.enemyName(enemy),'data-tooltip-overflow':true,tabIndex:0},mapLocalization.enemyName(enemy)),
                        h('small',{className:'paa-threat-meta'},h('span',{className:'paa-threat-node'},t('{nodes} 点',{nodes:(enemy.nodes||[]).join(' / ')}))))):
                      h('span',{className:'paa-muted'},unselected?'—':t(item?.status==='none'?'无战斗':'敌情暂不可用')))))))),
          h(QuestSection,{key:navigationIntent?.id||'default',state:store,slots,deckId:fleet,kind,onNavigateQuest,open:questFocusOpen,onOpenChange:changeQuestFocus,mapId:kind==='normal'?area:undefined,
            missionId:kind==='expedition'?missionId:undefined,questState,paused,disabled,selectedQuests,onToggleQuest:code=>{
              if(disabled)return;operation.current++;routeCache.current=null;setRouteDrafts({});setChoices([]);invalidateRouteCombat();
              setSelectedQuests(current=>current.includes(code)?current.filter(item=>item!==code):[...current,code].sort());setError('');
            },onClearQuests:()=>{if(disabled)return;operation.current++;routeCache.current=null;setRouteDrafts({});setChoices([]);invalidateRouteCombat();setSelectedQuests([]);setError('');}})),
        h('section',{className:'paa-wb-right','aria-busy':working},commandControls,
          error?h('p',{className:'paa-operation-feedback','data-state':'error',role:'alert'},formatError(error)):null,
          !dirty&&report.planningOnly?h('p',{className:'paa-operation-feedback','data-state':'warning',role:'status'},t('导入舰队当前仅供参考，暂不可应用')):null,
          operationFeedback,
          h('div',{className:'paa-wb-fleet-results','aria-busy':!!resultsPending},
            h('div',{className:'paa-wb-fleet-results-content','aria-hidden':resultsPending||undefined,inert:resultsPending?'':undefined},
          kind==='expedition'?stableResult('expedition-metrics',expeditionView.metrics({status:expeditionStatus,mission,income})):null,
          kind==='normal'?stableResult('metrics',h('div',{className:'paa-wb-metrics','data-columns':3,'aria-label':t('舰队速力、制空与索敌'),'aria-live':'polite'},
            h('div',{className:'paa-wb-metric speed','data-tier':speedReading.tier,'data-has-requirement':speedRequirement.hint?'true':undefined,...T.attributes(T.speed(speedReading,speedRequirement)),tabIndex:0,'aria-label':t('舰队速力：{speed}',{speed:speedReading.ships.length?t(speedReading.label):'—'})},
              h('svg',{className:'paa-wb-speed-gauge',viewBox:'0 0 19 14','aria-hidden':true},...[1,2,3,4].map(t=>h('rect',{key:t,x:(t-1)*5,y:14-t*3,width:3,height:t*3,rx:0.6,fill:t<=speedReading.tier?'currentColor':'none',stroke:'currentColor',strokeWidth:0.6,opacity:t<=speedReading.tier?1:0.28}))),
              h('strong',null,speedReading.ships.length?t(speedReading.label):'—'),
              speedRequirement.hint?h('small',null,metricDisplay.compactHint(speedRequirement.hint)):null),
            summaryMetric(summary.air,'air',{unselected:!mapRoute}),summaryMetric(summary.los,'los',{unselected:!mapRoute}))):null,
          h('div',{className:'paa-wb-ships',ref:grid},...shipCards)),
            resultsPending?h('div',{className:'paa-wb-calculating paa-wb-fleet-overlay',role:'status','data-activity':activity},
              h('span',{className:'paa-wb-calculation-label'},h('span',{className:'paa-wb-calculation-heading'},
                h('span',{className:'paa-wb-calculation-spinner','aria-hidden':true}),t('计算中')),
                working?h(CalculationProgress,{channel:calculationChannel.current}):null)):null),
        )),
      kind==='normal'&&mapExpanded?h('dialog',{ref:mapDialog,className:'paa-wb-map-dialog','aria-label':t('{area} 海域地图',{area}),
        onCancel:e=>{e.preventDefault();setMapExpanded(false);},
        onClick:e=>{if(e.target!==e.currentTarget)return;const r=e.currentTarget.getBoundingClientRect();
          if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)setMapExpanded(false);}},
        h('div',{className:'paa-wb-section-head'},h('h3',null,t('{area} 海域地图',{area})),
          h('button',{type:'button',autoFocus:true,onClick:()=>setMapExpanded(false),'aria-label':t('关闭放大地图')},t('关闭'))),
        routePreview(h,{profile:mapProfile,mapAsset,pathIndex:0,nodeId,onNode:selectMapNode,onBackground:()=>selectMapNode(null),disabled,
          idSuffix:'-expanded',compact:true,fixedNodes:true,showDetails:!!nodeId,nodePopup:true,showPaths:false,
          airbases:mapAirbases,equipmentIcon:EquipmentIcon,formationIndex:mapFormationIndex,onFormationIndex:setMapFormationIndex,
          enemyPortrait:enemy=>portrait({name:enemy.name,portrait:V.portraitUrl(store,enemy.apiId)})})):null,
      noPlan?h('dialog',{ref:noPlanDialog,className:'paa-wb-no-plan-dialog','aria-labelledby':'paa-wb-no-plan-title','aria-describedby':'paa-wb-no-plan-message',
        onCancel:e=>{e.preventDefault();setNoPlan('');}},
        h('h3',{id:'paa-wb-no-plan-title'},t(kind==='expedition'?'未找到达标方案':'未找到可用方案')),
        h('p',{id:'paa-wb-no-plan-message'},t(noPlan.message)),
        h('p',{className:'paa-wb-no-plan-hint'},t(noPlan.hint)),
        h('div',{className:'paa-wb-no-plan-actions'},h('button',{type:'button',autoFocus:true,onClick:()=>setNoPlan('')},t('知道了')))):null,
      basePopup?EquipmentPicker({index:basePopup.rid-1,slot:basePopup.slotId-1,title:t('第 {base} 航空队 · 第 {slot} 槽',{base:basePopup.rid,slot:basePopup.slotId}),
        rows:baseRows,search,setSearch,group:equipmentGroup,setGroup:setEquipmentGroup,category:equipmentCategory,setCategory:setEquipmentCategory,
        sort:equipmentSort,setSort:setEquipmentSort,store,currentEquipment:baseCurrent,disabled,listRef:popupList,
        onClose:()=>setBasePopup(null),onPick:pickBase,onClear:()=>pickBase({id:0})}):
      popup&&popup.slot===undefined?ShipPicker({index:popup.index,rows:popupRows,search,setSearch,shipLock,setShipLock,shipType,setShipType,
        shipSort,setShipSort,replacementType,replacementTypeLabel,disabled,onClose:()=>setPopup(null),onPick:pick,listRef:popupList,store,kind,windowScroll:shipWindow,onWindowScroll:setShipWindow}):
      popup?EquipmentPicker({index:popup.index,slot:popup.slot,rows:popupRows,search,setSearch,group:equipmentGroup,setGroup:setEquipmentGroup,
        category:equipmentCategory,setCategory:setEquipmentCategory,sort:equipmentSort,setSort:setEquipmentSort,store,currentEquipment,disabled,listRef:popupList,
        onClose:()=>setPopup(null),onPick:pick,onClear:()=>pick({id:-1}),onAuto:slots[popup.index].keep[popup.slot]?()=>{const next=slots.slice(),s=next[popup.index];
          next[popup.index]={...s,keep:{...s.keep}};delete next[popup.index].keep[popup.slot];invalidateRouteChoices();commit(next);setPopup(null);}:null}):null);
    page.current=rendered;return rendered;
  };
};
