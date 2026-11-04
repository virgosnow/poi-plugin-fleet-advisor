'use strict';
const W=require('../workbench/workbench_model'),V=require('../models/presentation_model');
const {opponentProfile}=require('../../recommendation/practice');
const {fleetMechanisms,fleetSpeed,aircraftCapacity}=require('../../domain/combat/ship_mechanisms');
const practiceForecast=require('../../domain/combat/practice_forecast');
const practiceResources=require('../../domain/combat/practice_resources');
const practiceExperience=require('../../domain/combat/practice_experience');
const {projectShip,airPower}=require('../../domain/fleet/fleet_metrics');
const metricTooltips=require('../models/metric_tooltips');
const details=require('../components/ship_details'),statIcon=require('../components/stat_icon'),collapse=require('../components/collapse');
const drag=require('../components/ship_drag');
const shipPicker=require('../components/ship_picker');
const usePickerHover=require('../components/picker_hover');
const {normalizeName}=require('../../shared/name_matching');
const equipmentPicker=require('../components/equipment_picker');
const recommendationFilters=require('../../config/recommendation_filters');
const empty=()=>Array(6).fill(null);
const rankText=rank=>`${rank}${['SS','S','A','B'].includes(rank)?'胜':'败'}`;
const {listPracticeQuests:practiceTasks,countPracticeQuests}=require('../../domain/quests/practice_quests');
module.exports=(React,{getStore,getController,setQuestPageActive})=>{
  const h=React.createElement,EquipmentIcon=require('../components/equipment_icon')(React),ResourceIcon=require('../components/resource_icon')(React),badges=require('../components/mechanism_badges')(React),QuestSection=require('../components/quest_section')(React),ShipPicker=shipPicker(React),EquipmentPicker=equipmentPicker(React);
  return function PracticePage({kind='practice',hidden=false,busy=false,stopping=false,onStop,stopButtonRef,onApply,operationFeedback,automaticOperations,automaticFilters}){
    const [slots,setSlots]=React.useState(empty),[fleet,setFleet]=React.useState(1),[opponentId,setOpponentId]=React.useState(null);
    const [attributeDetails,setAttributeDetails]=React.useState({}),[popup,setPopup]=React.useState(null),[search,setSearch]=React.useState('');
    const [revision,setRevision]=React.useState(0),[working,setWorking]=React.useState(false),[message,setMessage]=React.useState(''),[questsOpen,setQuestsOpen]=React.useState(false);
    const [shipFleet,setShipFleet]=React.useState('all'),[shipType,setShipType]=React.useState('all'),[shipSort,setShipSort]=React.useState('level-desc');
    const [equipmentGroup,setEquipmentGroup]=React.useState('all'),[equipmentCategory,setEquipmentCategory]=React.useState('all'),[equipmentSort,setEquipmentSort]=React.useState('default');
    const [openOpponents,setOpenOpponents]=React.useState({});
    const [practiceGoal,setPracticeGoal]=React.useState('balanced'),[practiceFormation,setPracticeFormation]=React.useState('auto');
    const [trainingShipIds,setTrainingShipIds]=React.useState([]),[trainingOpen,setTrainingOpen]=React.useState(false),[trainingSearch,setTrainingSearch]=React.useState('');
    const [trainingType,setTrainingType]=React.useState('all'),[trainingSort,setTrainingSort]=React.useState('level-asc');
    const [selectedQuests,setSelectedQuests]=React.useState([]);
    const grid=React.useRef(null),popupList=React.useRef(null),forecastCache=React.useRef(null),store=getStore(),practice=store.practiceState||{},quest=store.questState||{};
    const trainingAnchor=React.useRef(null),trainingDialog=React.useRef(null),trainingTrigger=React.useRef(null),editingTrainingSearch=React.useRef(false),trainingPointerInside=React.useRef(false);
    const trainingHover=usePickerHover(React,{enabled:!hidden&&!busy&&!working,open:trainingOpen,anchor:trainingAnchor,
      onOpen:()=>setTrainingOpen(true),onClose:()=>{editingTrainingSearch.current=false;setTrainingOpen(false);},
      shouldHoldOpen:()=>editingTrainingSearch.current&&trainingAnchor.current?.ownerDocument?.activeElement===trainingDialog.current?.querySelector('input[type=search]')});
    const closeTraining=()=>{editingTrainingSearch.current=false;trainingHover.dismiss();setTrainingOpen(false);trainingTrigger.current?.focus();};
    React.useEffect(()=>{setQuestPageActive?.('practice',!hidden&&!busy);return()=>setQuestPageActive?.('practice',false);},[hidden,busy]);
    React.useEffect(()=>{if(hidden||busy)return;let previous=getStore();const timer=setInterval(()=>{const next=getStore();
      if(next.practiceState?.revision!==previous.practiceState?.revision||next.questState!==previous.questState||
        ['ships','equips','fleets','resources'].some(key=>next.info?.[key]!==previous.info?.[key])){previous=next;setRevision(v=>v+1);}},1000);return()=>clearInterval(timer);},[hidden,busy]);
    React.useEffect(()=>drag(grid.current,(a,b)=>setSlots(previous=>{const next=previous.slice();[next[a],next[b]]=[next[b],next[a]];return next;}),hidden||busy||working),[hidden,busy,working,slots]);
    React.useEffect(()=>{if(popupList.current)popupList.current.scrollTop=0;},[popup,search,shipType,shipFleet,shipSort,equipmentGroup,equipmentCategory,equipmentSort]);
    const opponentKey=(practice.opponents||[]).map(opponent=>opponent.id).join(',');
    const selectionRef=React.useRef(null);selectionRef.current={opponentId,opponentKey};
    React.useEffect(()=>{setOpenOpponents({});setPracticeFormation('auto');},[opponentKey]);
    React.useEffect(()=>{if(hidden||busy||working){editingTrainingSearch.current=false;trainingHover.dismiss();setTrainingOpen(false);}},[hidden,busy,working]);
    React.useEffect(()=>{if(!trainingOpen||hidden||busy||working)return;const root=trainingAnchor.current,panel=trainingDialog.current;if(!root||!panel)return;
      const doc=root.ownerDocument,win=doc.defaultView;
      const place=()=>{const r=root.getBoundingClientRect(),width=Math.min(520,doc.documentElement.clientWidth-24);panel.style.width=`${width}px`;
        panel.style.left=`${Math.max(12-r.left,Math.min(0,doc.documentElement.clientWidth-12-r.left-width))}px`;
        panel.style.maxHeight=`${Math.max(100,Math.min(560,doc.documentElement.clientHeight-r.bottom-18))}px`;};
      const outside=e=>{if(!root.contains(e.target)){editingTrainingSearch.current=false;trainingHover.dismiss();setTrainingOpen(false);}};
      place();if(!trainingHover.isHover())panel.querySelector('input[type=search]')?.focus({preventScroll:true});
      const pointerEnd=()=>setTimeout(()=>{trainingPointerInside.current=false;},0);
      doc.addEventListener('pointerdown',outside,true);doc.addEventListener('pointerup',pointerEnd,true);doc.addEventListener('pointercancel',pointerEnd,true);
      win.addEventListener('resize',place);doc.addEventListener('scroll',place,true);
      return()=>{trainingPointerInside.current=false;doc.removeEventListener('pointerdown',outside,true);doc.removeEventListener('pointerup',pointerEnd,true);
        doc.removeEventListener('pointercancel',pointerEnd,true);win.removeEventListener('resize',place);doc.removeEventListener('scroll',place,true);};
    },[trainingOpen,hidden,busy,working]);
    void revision;
    if(hidden)return h('div',{className:'paa-workbench paa-practice','data-kind':'practice',hidden:true});
    const opponents=practice.opponents||[],selected=opponents.find(o=>o.id===opponentId)||null,enemy=opponentProfile(store,selected),disabled=busy||working;
    const filled=slots.filter(Boolean),scheme=W.scheme(slots,fleet),rows=V.fleetRows(store,scheme),rowById=new Map(rows.map(r=>[r.id,r]));
    const trainingSelected=new Set(trainingShipIds),pinned=new Set(filled.filter(s=>s.pin||Object.keys(s.keep||{}).length).map(s=>s.id));
    const occupied=new Set([...pinned,...trainingShipIds]);
    const trainingReasons=recommendationFilters.evaluator(store,'practice',automaticFilters);
    const trainingRows=Object.values(store.info.ships||{}).map(ship=>{
      const master=store.const.$ships[ship.api_ship_id];if(!master)return null;
      const remodel=shipPicker.nextRemodel(master,ship);
      const id=Number(ship.api_id),typeId=Number(master.api_stype),fleetIndex=(store.info.fleets||[]).findIndex(f=>(f.api_ship||[]).includes(id));
      return {id,name:master.api_name||'舰娘',level:Number(ship.api_lv)||0,remodel,reasons:trainingReasons(id),typeId,locked:ship.api_locked==null?null:Number(ship.api_locked)===1,
        type:W.TYPES[typeId]||store.const.$shipTypes?.[typeId]?.api_name||'未知舰种',fleet:fleetIndex<0?null:fleetIndex+1,
        fleetLabel:fleetIndex<0?'未编入舰队':`第 ${fleetIndex+1} 舰队`,cond:Number(ship.api_cond)||0,masterId:ship.api_ship_id};
    }).filter(Boolean);
    const trainingQuery=normalizeName(trainingSearch).toLowerCase();
    const trainingMatches=trainingRows.filter(row=>(!trainingQuery||normalizeName(`${row.name} ${row.type} ${row.id} ${row.level} ${row.remodel}`).toLowerCase().includes(trainingQuery))&&
      (trainingType==='all'||shipPicker.shipGroup(row.typeId)===trainingType))
      .sort((a,b)=>trainingSort==='level-asc'?a.level-b.level||a.id-b.id:trainingSort==='morale-desc'?b.cond-a.cond||b.level-a.level||a.id-b.id:
        trainingSort==='name'?a.name.localeCompare(b.name,'ja')||b.level-a.level||a.id-b.id:b.level-a.level||a.id-b.id);
    const selectedNames=trainingShipIds.map(id=>trainingRows.find(row=>row.id===id)?.name||'舰娘资料待同步');
    const trainingLabel=selectedNames.length?selectedNames.join('、'):'请添加要培养的舰娘';
    let consumption;try{consumption=practiceResources.estimate(store,scheme,{enemy});}catch(_){consumption={status:'unknown',reason:'补给资料不足'};}
    let forecast=null;
    if(selected&&enemy.known&&filled.length){
      const key=[slots,selected,selected.ships,practiceFormation,store.info.ships,store.info.equips,store.const.$ships,store.const.$equips];
      if(!forecastCache.current||key.some((part,i)=>part!==forecastCache.current.key[i])){
        let value;try{value=practiceForecast.estimate(store,scheme,enemy,{ownFormation:practiceFormation});}catch(_){value={status:'unknown',reason:'战斗资料不足'};}
        forecastCache.current={key,value};
      }
      forecast=forecastCache.current.value;
    }
    let experience=null;
    if(selected&&filled.length)try{experience=practiceExperience.estimateForecast(store,scheme,selected,forecast);}catch(_){experience={status:'unknown',reason:'经验资料不足'};}
    const colors={S:'#e3bc65',A:'#7bc8a6',B:'#6aa6d8',C:'#d39b69',D:'#d87e80'};
    const formationNames={lineAhead:'单纵',doubleLine:'复纵',lineAbreast:'单横',echelon:'梯形',diamond:'轮形'};
    const forecastChart=()=>{
      let start=0;const stops=forecast.rows.map(row=>{const end=start+row.count/forecast.samples*100,color=colors[row.label];const segment=`${color} ${start}% ${end}%`;start=end;return segment;});
      return h('div',{className:'paa-practice-forecast'},h('div',{className:'paa-practice-pie',role:'img',
        'aria-label':forecast.rows.map(row=>`${rankText(row.label)} ${row.percent||'少于 1'}%`).join('，'),
        style:{background:`conic-gradient(${stops.join(',')})`}}),
      h('div',{className:'paa-practice-forecast-legend'},...forecast.rows.map(row=>h('div',{key:row.label},
        h('span',{className:'paa-practice-forecast-dot',style:{background:colors[row.label]}}),h('span',null,rankText(row.label)),
        h('strong',null,row.percent?`${row.percent}%`:'<1%')))));
    };
    const forecastNote=()=>{
      const rows=(forecast.assumedEquipment||[]).map(ship=>[ship.name,(ship.slots||[]).map(slot=>`${slot.slot}槽 ${slot.name}`).join('、')||'无参考装备']);
      const detail=rows.length?metricTooltips.attributes({title:'对手假设配装',sections:[{title:'可开发装备参考',columns:['舰娘','装备'],rows}],
        notes:[forecast.assumptions]}):{'data-tooltip':forecast.assumptions};
      return h('p',{className:'paa-practice-forecast-note',tabIndex:0,...detail},
        `参考模拟 · 我方${formationNames[forecast.ownFormation]||'待确认'} / 对手${formationNames[forecast.enemyFormation]||'待确认'} · 假设对手使用可开发装备`);
    };
    const resourceSummary=()=>{
      if(consumption.status!=='known')return {items:[],detail:consumption.status==='empty'?'添加舰娘后计算':consumption.reason||'补给资料待确认'};
      const range=value=>value===null?'待确认':value.min===value.max?String(value.min):`${value.min}–${value.max}`;
      const referenceAir=forecast?.air?.status==='estimated'?forecast.air:null,referenceLoss=referenceAir?.bauxite;
      const items=[['燃料',String(consumption.fuel)],['弹药',range({min:consumption.ammoDay,max:consumption.ammoNight})],
        ['铝土',referenceLoss?`参考 ${range(referenceLoss)}`:consumption.bauxite===null?'待确认':consumption.bauxite.max===0?'0':`≤${consumption.bauxite.max}`],...(consumption.hasJets?[['钢材',range(consumption.steel)]]:[])];
      const scenario=consumption.bauxite?.max>0&&consumption.airScenarios?.find(row=>row.state==='supremacy'),airRange=scenario?.stageOneBauxite;
      const airNote=referenceLoss?`假设对手配装 · 敌方制空 ${range(referenceAir.enemyAirPower)}`:
        airRange?`空确时制空损耗 ${range(airRange)} 铝 · 对空损耗另计`:'铝为理论上限';
      const airDetails=consumption.airScenarios?.map(row=>`${row.label}：${range(row.stageOneBauxite)} 铝（不含对空）`).join('\n');
      return {items,detail:[consumption.detail,`满补给出击 · ${airNote}`,...(referenceAir?.assumptions||[]),airDetails].filter(Boolean).join('\n')};
    };
    const fmtRange=value=>!value?'—':value.min===value.max?String(value.min):`${value.min}–${value.max}`;
    let mechanisms=new Map(),speed=null,preview=null,ownAir=null;
    if(filled.length){
      try{speed=fleetSpeed(store,filled);mechanisms=fleetMechanisms(store,filled,speed,undefined,{conditionalGroundDouble:true,practice:true});}catch(_){}
      try{preview=getController()?.preview('fleet',scheme);}catch(_){}
      try{
        const projected=filled.map(entry=>{
          const target=projectShip(store,entry.id,{slots:entry.slots,ex:entry.ex??-1});
          // Practice assumes a full resupply. Ordinary patrol planes do not
          // contribute to air power; the 20th Squadron is a special case.
          const aircraft=target.after.slots.map(id=>{
            const item=store.info.equips[id],master=store.const.$equips[item?.api_slotitem_id],type=Number(master?.api_type?.[2]);
            return type===26&&![489,491].includes(Number(item?.api_slotitem_id))&&!/20戦隊/.test(master?.api_name||'')?-1:id;
          });
          return {...target,ship:{...target.ship,api_onslot:target.master.api_maxeq},before:{...target.before,slots:aircraft},after:{...target.after,slots:aircraft}};
        });
        ownAir=airPower(store,projected);
      }catch(_){ownAir={status:'unknown',reason:'航空资料不足'};}
    }
    const metrics=()=>{
      const airValue=ownAir?.status==='range'?fmtRange(ownAir):filled.length?'待确认':'—';
      const opponentAir=forecast?.air?.status==='estimated'?forecast.air:null;
      const stateNames={supremacy:'空确',superiority:'空优',parity:'空均',disadvantage:'空劣',loss:'空丧',noAirBattle:'无航空战'};
      const stateText=opponentAir?.states?.length?opponentAir.states.map(state=>stateNames[state]||'待确认').join('～'):null;
      const airWarning=!!opponentAir?.states?.some(state=>state==='loss'||state==='disadvantage');
      const metricIcon=(kind)=>h('svg',{viewBox:'0 0 16 16','aria-hidden':true},kind==='warning'?
        h('path',{d:'M8 2 15 14H1ZM8 6v4m0 2v.1'}):
        [h('circle',{key:'outline',cx:8,cy:8,r:6}),h('path',{key:'mark',d:kind==='check'?'m5 8 2 2 4-4':'M5 8h6'})]);
      const airHint=opponentAir?`假设对手配装 · 敌方 ${fmtRange(opponentAir.enemyAirPower)}`:!selected?'选择对手后可参考制空状态':!enemy.known?'对手舰队资料待同步':'对手制空待确认';
      const airDetail=[filled.length?'己方按出击前满载计算。':'添加舰娘后显示己方制空。',ownAir?.reason,
        opponentAir?`对手制空 ${fmtRange(opponentAir.enemyAirPower)}：按假设的可开发装备及熟练度范围计算，非实际配装。`:airHint,
        stateText?`参考制空状态：${stateText}`:''].filter(Boolean).join('\n');
      const flag=experience?.status==='estimated'?experience.ships.find(row=>row.flagship):null;
      const escorts=experience?.status==='estimated'?experience.ships.filter(row=>!row.flagship&&row.normal):[];
      const escort=escorts.length?{min:Math.min(...escorts.map(row=>row.normal.min)),max:Math.max(...escorts.map(row=>row.normal.max))}:null;
      const expRows=(experience?.ships||[]).map(row=>{const ship=store.info.ships[row.id],master=store.const.$ships[ship?.api_ship_id];
        return [`${master?.api_name||'舰娘'}${row.flagship?'（旗舰）':''}`,fmtRange(row.normal),fmtRange(row.mvp)];});
      const expDetail=experience?.status==='estimated'?metricTooltips.attributes({title:'经验参考',sections:[{title:'模拟战果范围',columns:['舰娘','普通','MVP'],rows:expRows}],
        notes:experience.notes||[]}):{'data-tooltip':experience?.reason||(!selected?'选择对手后计算':!filled.length?'添加舰娘后计算':'经验资料待确认')};
      const xpValue=flag?.normal?(experience.sOnly?`约 ${flag.representativeNormal}`:fmtRange(flag.normal)):selected&&filled.length?'待确认':'—';
      const xpHint=escort?`${experience.sOnly?'S 胜参考':'战果参考'} · 随伴 ${fmtRange(escort)}`:experience?.status==='estimated'?`${experience.sOnly?'S 胜参考':'战果参考'} · 悬停查看明细`:!selected?'选择对手后计算':!filled.length?'添加舰娘后计算':experience?.reason||'经验资料待确认';
      const resources=resourceSummary();
      return h('div',{className:'paa-wb-metrics','data-columns':3,'aria-label':'经验、制空与资源消耗','aria-live':'polite'},
        h('div',{className:'paa-wb-metric speed','data-tier':experience?.status==='estimated'?'2':'0','data-has-requirement':'true',tabIndex:0,'aria-label':`旗舰经验参考：${xpValue}`,...expDetail},
          h('svg',{viewBox:'0 0 16 16','aria-hidden':true},h('circle',{cx:8,cy:8,r:5,fill:'none',stroke:'currentColor',strokeWidth:1.6}),h('path',{d:'m5.5 8 1.5 1.5 3-3',fill:'none',stroke:'currentColor',strokeWidth:1.4})),
          h('strong',null,`旗舰经验 ${xpValue}`),h('small',null,xpHint)),
        h('div',{className:'paa-wb-metric air','data-tone':stateText?(airWarning?'warning':'blue'):'neutral',tabIndex:0,'aria-label':`综合制空 ${airValue}${stateText?`，参考${stateText}`:''}`,'data-tooltip':airDetail},
          h('span',{className:'paa-wb-metric-state'},metricIcon(airWarning?'warning':stateText?'check':'neutral'),stateText?`参考${stateText}`:'综合制空'),h('strong',{'data-label':'我方'},airValue),h('small',null,airHint)),
        h('div',{className:'paa-wb-metric los paa-practice-resources','data-tone':resources.items.length?'green':'neutral',tabIndex:0,'aria-label':'预计资源消耗','data-tooltip':resources.detail},
          h('span',{className:'paa-wb-metric-state'},metricIcon(resources.items.length?'check':'neutral'),'预计消耗'),
          h('small',{className:'paa-practice-resource-items'},resources.items.length?resources.items.map(([name,value])=>h('span',{className:'paa-practice-consumption-item',key:name,'aria-label':`${name} ${value}`},
            h(ResourceIcon,{name,size:14}),h('span',null,value))):resources.detail)));
    };
    const enemyShip=(s,index)=>{
      const name=s.master.api_name||'舰娘',portrait=V.portraitUrl(store,s.masterId);
      return h('div',{className:'paa-practice-enemy-ship',key:index},
        h('div',{className:'paa-practice-enemy-head'},h('span',{className:'paa-practice-enemy-portrait'},h('span',null,name.slice(0,2)),portrait?h('img',{src:portrait,alt:'',draggable:false,onError:e=>{e.currentTarget.style.display='none';}}):null),
          h('div',{className:'paa-practice-enemy-identity'},h('strong',null,name),h('small',null,s.level?`Lv.${s.level}`:'等级待同步'))));
    };
    const choose=(index,slot)=>{setSearch('');if(slot===undefined){const ship=store.info.ships[slots[index]?.id],type=store.const.$ships[ship?.api_ship_id]?.api_stype;
      setShipType(type!=null?`type:${type}`:'all');setShipSort('level-desc');}else{
      const current=slot==='ex'?slots[index]?.ex:slots[index]?.slots[slot],category=current>0?W.equipmentOptions(store,slots,index,slot).find(row=>row.id===current)?.categoryId:null;
      setEquipmentCategory(category==null?'all':String(category));setEquipmentGroup(category==null?'all':equipmentPicker.groupForCategory(category));setEquipmentSort('default');}setPopup({index,slot});};
    const replacementShip=popup?.slot===undefined&&slots[popup?.index]?store.info.ships[slots[popup.index].id]:null;
    const replacementType=replacementShip&&store.const.$ships[replacementShip.api_ship_id]?.api_stype;
    const replacementTypeLabel=W.TYPES[replacementType]||store.const.$shipTypes?.[replacementType]?.api_name||'未知舰种';
    const pickRows=popup?(popup.slot===undefined?W.replacementCandidates(store,slots,popup.index,search,'all',{kind:'practice',filters:automaticFilters},undefined,{sortFirstFleet:false})
      .filter(row=>(shipType==='all'||(shipType.startsWith('type:')?String(row.typeId)===shipType.slice(5):shipPicker.shipGroup(row.typeId)===shipType))&&(shipFleet==='all'||row.fleet===Number(shipFleet)))
      .sort((a,b)=>shipSort==='level-asc'?a.level-b.level||a.id-b.id:shipSort==='morale-desc'?b.cond-a.cond||b.level-a.level||a.id-b.id:
        shipSort==='name'?a.name.localeCompare(b.name,'ja')||b.level-a.level||a.id-b.id:b.level-a.level||a.id-b.id):
      W.equipmentOptions(store,slots,popup.index,popup.slot,search)):[];
    const currentEquipment=popup?.slot!==undefined?(popup.slot==='ex'?slots[popup.index]?.ex:slots[popup.index]?.slots[popup.slot]):null;
    const pick=row=>{const next=slots.slice();if(popup.slot===undefined)next[popup.index]={...W.entry(store,row.id),pin:true};
      else{const old=next[popup.index],s={...old,slots:old.slots.slice(),keep:{...old.keep,[popup.slot]:true}};if(popup.slot==='ex')s.ex=row.id;else s.slots[popup.slot]=row.id;next[popup.index]=s;}
      setSlots(next);setPopup(null);setMessage('');};
    const complete=async()=>{if(disabled)return;const startSelection={...selectionRef.current};setWorking(true);setMessage('');try{
      if(selectedQuests.length){
        const current=getStore(),related=practiceTasks({state:current,slots,deckId:fleet,questState:current.questState});
        if(current.questState?.complete===false||related.status!=='ready'||selectedQuests.some(code=>!related.tasks.some(task=>task.code===code)))throw Error('所选任务已变化或尚未同步，请重新选择');
        if(selectedQuests.some(code=>!related.tasks.find(task=>task.code===code)?.supported))throw Error('所选演习任务的编成资料尚未收录，暂无法按任务补全');
      }
      const service=getController(),{snapshotId}=service.createSnapshot();
      const result=await service.recommendPracticeFleet({snapshotId,fleet,slots,opponent:selected,goal:'balanced',capacity:6,trainingShipIds,...selectedQuests.length?{questCodes:selectedQuests}: {}});
      if(selectedQuests.length){const current=getStore(),related=practiceTasks({state:current,slots,deckId:fleet,questState:current.questState});
        if(current.questState?.complete===false||related.status!=='ready'||selectedQuests.some(code=>!related.tasks.some(task=>task.code===code)))throw Error('所选任务已变化，请重新选择');}
      const old=new Map(slots.filter(Boolean).map(s=>[s.id,s]));setSlots(result.scheme.ships.map(s=>({...s,pin:!!old.get(s.id)?.pin,keep:old.get(s.id)?.keep||{}})).concat(Array(Math.max(0,6-result.scheme.ships.length)).fill(null)));
      if(selectionRef.current.opponentId===startSelection.opponentId&&selectionRef.current.opponentKey===startSelection.opponentKey){
        let recommendation=null;try{recommendation=practiceForecast.recommendFormation(store,result.scheme,enemy);}catch(_){}
        setPracticeFormation(recommendation||'auto');
      }
      if(result.planningOnly)setMessage('方案包含目前不能编入的舰娘，请等待远征或入渠结束。');
      else if(!result.enemyKnown)setMessage('尚未取得完整对手编成，已按通用演习配装。');
    }catch(error){setMessage(error.message||'未找到可用编成');}finally{setWorking(false);}};
    const card=(slot,index)=>{
      if(!slot)return h('button',{type:'button',className:'paa-wb-empty',key:`empty-${index}`,'data-fleet-slot':index,'data-empty':'true',disabled,onClick:()=>choose(index)},h('span',null,'＋'),`第 ${index+1} 位 · 选择舰娘`);
      const ship=store.info.ships[slot.id],master=store.const.$ships[ship?.api_ship_id],row=rowById.get(slot.id);if(!ship||!master||!row)return h('div',{key:slot.id,className:'paa-wb-empty'},'舰娘资料待同步');
      const detailId=`paa-practice-stats-${slot.id}`;
      const gear=k=>{const eq=row.gearIcons.find(x=>x.slot===k),type=store.const.$equips[store.info.equips[eq?.id]?.api_slotitem_id],capacity=aircraftCapacity(master,type,k);
        return h('button',{key:k,type:'button',disabled,className:'paa-wb-gear',...V.equipmentTooltipProps(eq),onClick:()=>choose(index,k)},
          h('span',{className:'paa-wb-slot-label'},k==='ex'?'增':k+1),eq?h(EquipmentIcon,{item:eq}):h('span',{className:'paa-wb-gear-empty'},'＋'),
          h('span',{className:'paa-wb-gear-name'},eq?eq.tooltip.replace(/^.*? · /,''):'空槽'),capacity!==undefined?h('span',{className:'paa-wb-aircraft-count'},`${capacity??'—'} 架`):null);};
      return h('article',{key:slot.id,className:'paa-wb-ship','data-fleet-slot':index,'data-ship-id':slot.id},h('div',{className:'paa-fleet-ship-heading'},
        h('div',{className:'paa-wb-ship-head'},h('button',{type:'button',className:'paa-wb-portrait paa-fleet-portrait-toggle',disabled,'aria-expanded':!!attributeDetails[slot.id],
          'aria-controls':detailId,'aria-label':`${row.name}：属性`,'data-tooltip':attributeDetails[slot.id]?undefined:'查看属性',onClick:e=>details.toggle(setAttributeDetails,slot.id,e)},
          h('span',null,row.name.slice(0,2)),row.portrait?h('img',{src:row.portrait,alt:'',draggable:false}):null),
          h('div',{className:'paa-wb-identity'},h('strong',null,row.name),h('small',null,`${index===0?'旗舰':`第 ${index+1} 位`} · ${W.TYPES[master.api_stype]||row.type} · Lv.${row.level}`)),
          h('div',{className:'paa-wb-ship-actions'},h('button',{type:'button',className:'paa-wb-replace',disabled,onClick:()=>choose(index)},'换船'),
            h('button',{type:'button',className:'paa-wb-remove',disabled,onClick:()=>setSlots(previous=>previous.filter((_,i)=>i!==index).concat(null))},'移除'))),
        collapse(h,{open:attributeDetails[slot.id],id:detailId},h('dl',{className:'paa-fleet-ship-stats','aria-label':'舰娘当前属性','data-tooltip':'舰娘当前属性，未计入本页尚未应用的配装'},
          ...details.stats(ship).map(s=>h('div',{key:s.label},h('dt',null,statIcon.react(React,s.label),s.label),h('dd',null,s.value??'—')))))),
        h('div',{className:'paa-wb-mechanisms','aria-label':'当前配装机制'},...badges((mechanisms.get(slot.id)||[]).filter(b=>!['special-shelling','special-night','special-submarine','smoke'].includes(b.key)))),
        h('div',{className:'paa-wb-gears'},...slot.slots.map((_,i)=>gear(i)),ship.api_slot_ex!==0?gear('ex'):h('div',{className:'paa-wb-gear-unopened'},'增 · 未开启')));
    };
    return h('div',{className:'paa-workbench paa-practice','data-kind':kind},h('div',{className:'paa-wb-columns'},
      h('section',{className:'paa-wb-left'},h('div',{className:'paa-wb-context-controls paa-practice-context'},
        h('div',{className:'paa-practice-training',ref:trainingAnchor,onPointerEnter:trainingHover.enter,onPointerLeave:trainingHover.leave,
          onClickCapture:trainingHover.guardClick,onKeyDown:e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeTraining();}},
          onBlur:e=>{const anchor=e.currentTarget;if(anchor.contains(e.relatedTarget))return;
            setTimeout(()=>{if(!trainingPointerInside.current&&(!anchor.isConnected||!anchor.contains(anchor.ownerDocument.activeElement))){
              editingTrainingSearch.current=false;trainingHover.dismiss();setTrainingOpen(false);}},0);}},
          h('button',{type:'button',ref:trainingTrigger,className:'paa-practice-training-trigger',disabled,'aria-label':`优先培养舰娘：${trainingLabel}`,'aria-haspopup':'dialog','aria-expanded':trainingOpen,
            onClick:trainingHover.click},
            h('span',{className:'paa-practice-training-title'},'优先培养舰娘',h('span',{className:'paa-area-chevron','aria-hidden':true})),
            trainingShipIds.length?h('span',{className:'paa-practice-training-portraits','aria-label':trainingLabel},
              ...trainingShipIds.slice(0,4).map((id,index)=>{const ship=store.info.ships[id],url=V.portraitUrl(store,ship?.api_ship_id);return h('span',{className:'paa-practice-training-portrait',key:id},
                url?h('img',{src:url,alt:selectedNames[index],draggable:false}):h('span',null,selectedNames[index]));}),
              ...[2,3,4].map(limit=>trainingShipIds.length>limit?h('span',{className:`paa-practice-training-more paa-practice-training-more-${limit}`,key:`more-${limit}`},`+${trainingShipIds.length-limit}`):null)):
              h('span',{className:'paa-practice-training-empty-hint'},'请添加要培养的舰娘')),
          trainingOpen&&!disabled?h('section',{ref:trainingDialog,className:'paa-practice-training-panel',role:'dialog','aria-label':'选择要培养的舰娘',
            onKeyDownCapture:trainingHover.engageKeyboard,onPointerDownCapture:e=>{trainingPointerInside.current=true;trainingHover.engageSelect(e);}},
            h('div',{className:'paa-area-panel-head'},h('span',null,'选择培养舰娘'),h('span',{className:'paa-mission-count'},`已选择 ${trainingShipIds.length} / 6 艘 · ${trainingMatches.length} 项`),
              h('button',{type:'button','aria-label':'关闭舰娘选择',onClick:closeTraining},'×')),
            h('div',{className:'paa-mission-controls paa-practice-training-controls'},
              h('input',{type:'search',className:'paa-practice-training-search',value:trainingSearch,placeholder:'舰名 / 舰种 / ID','aria-label':'搜索舰娘',
                onPointerDown:()=>{editingTrainingSearch.current=true;},onCompositionStart:()=>{editingTrainingSearch.current=true;},
                onBlur:()=>{editingTrainingSearch.current=false;},onChange:e=>{editingTrainingSearch.current=true;setTrainingSearch(e.target.value);}}),
              h('select',{'aria-label':'排序方式',value:trainingSort,onChange:e=>setTrainingSort(e.target.value)},
                ...[['level-asc','等级从低到高'],['level-desc','等级从高到低'],['morale-desc','士气从高到低'],['name','舰名排序']].map(([key,label])=>h('option',{key,value:key},label)))),
            h('div',{className:'paa-practice-training-tabs',role:'group','aria-label':'舰种筛选'},
              ...[['all','全部'],...shipPicker.SHIP_GROUPS].map(([key,label])=>
                h('button',{key,type:'button','aria-pressed':trainingType===key,onClick:()=>setTrainingType(key)},label))),
            h('div',{className:'paa-practice-training-list'},...trainingMatches.map(row=>{const checked=trainingSelected.has(row.id),full=!checked&&!occupied.has(row.id)&&occupied.size>=6,portrait=V.portraitUrl(store,row.masterId);
              return h('label',{key:row.id,className:'paa-practice-training-option','data-selected':checked,'data-unavailable':full},
                h('input',{type:'checkbox',checked,disabled:full,onChange:()=>setTrainingShipIds(previous=>checked?previous.filter(id=>id!==row.id):previous.concat(row.id))}),
                h('span',{className:'paa-wb-portrait'},h('span',null,row.name.slice(0,2)),portrait?h('img',{src:portrait,alt:'',draggable:false,loading:'lazy',decoding:'async',onError:e=>{e.currentTarget.style.display='none';}}):null),
                h('span',{className:'paa-practice-training-identity'},h('strong',{className:'paa-practice-training-name'},row.name),
                  h('small',null,`${row.type} · Lv.${row.level} · ${row.remodel}`)),
                row.locked===null?null:h('svg',{className:'paa-practice-training-lock','data-locked':row.locked,viewBox:'0 0 16 16',role:'img','aria-label':row.locked?'已锁定':'未锁定'},
                  h('rect',{x:3,y:7,width:10,height:7,rx:1.5,fill:'none',stroke:'currentColor',strokeWidth:1.5}),
                  h('path',{d:row.locked?'M5 7V5a3 3 0 0 1 6 0v2':'M5 7V5a3 3 0 0 1 5.6-1.5',fill:'none',stroke:'currentColor',strokeWidth:1.5,strokeLinecap:'round'})));
            }),trainingMatches.length?null:h('div',{className:'paa-practice-training-empty'},'没有匹配舰娘，请调整筛选或搜索。'))):null)),
        h('section',{className:'paa-practice-block paa-practice-opponent-section'},h('h3',null,'演习对手'),
        !practice.known?h('p',{className:'paa-muted'},'等待游戏空闲后同步演习对手。'):h('div',{className:'paa-practice-opponents'},...opponents.map(o=>{
          const master=store.const.$ships[o.flagship],img=master?V.portraitUrl(store,o.flagship):null;
          const rank=/^(SS|S|A|B|C|D|E)$/.test(o.rank||'')?o.rank:null,win=rank&&['SS','S','A','B'].includes(rank);
          const result=rank?rankText(rank):null,open=!!openOpponents[o.id],detailId=`paa-practice-opponent-${o.id}`;
          const profile=opponentProfile(store,o);
          return h('div',{key:o.id,className:'paa-practice-opponent-item'},h('div',{className:'paa-practice-opponent-row'},
            h('button',{type:'button',className:'paa-practice-opponent-select',disabled,'aria-pressed':o.id===opponentId,
            'aria-label':`${o.index} 号对手 ${o.name||'对手'}，Lv.${o.level??'未知'}${result?`，${result}`:''}`,onClick:()=>{if(o.id!==opponentId){selectionRef.current={opponentId:o.id,opponentKey};setPracticeFormation('auto');setOpponentId(o.id);}}},
            h('span',{className:'paa-practice-opponent-number'},String(o.index)),h('span',{className:'paa-practice-opponent-body'},h('strong',null,o.name||'对手'),
              h('small',null,`Lv.${o.level??'—'} · ${o.ships?`${o.ships.length} 艘`:'舰队待同步'}`)),
            img?h('img',{src:img,alt:'',draggable:false}):null,
            h('span',{className:'paa-practice-rank','data-outcome':rank?(win?'win':'loss'):undefined,'aria-hidden':true},
              rank?h('span',null,win?'胜利':'败北'):null,rank?h('strong',null,rank):null)),
            h('button',{type:'button',className:'paa-practice-opponent-toggle',disabled,'aria-expanded':open,'aria-controls':detailId,
              'aria-label':`${open?'收起':'展开'}${o.name||`第 ${o.index} 位对手`}的舰队`,onClick:()=>setOpenOpponents(previous=>({...previous,[o.id]:!previous[o.id]}))},
              h('svg',{viewBox:'0 0 16 16','aria-hidden':true},h('path',{d:'m4 6 4 4 4-4'})))),
            collapse(h,{open,id:detailId},h('div',{className:'paa-practice-enemy-detail'},!profile.known?h('p',{className:'paa-muted'},'对手舰队资料待同步。'):
              h('div',{className:'paa-practice-enemy-ships','aria-label':'对手编成'},...profile.ships.map(enemyShip)))));
        }))),
        h('section',{className:'paa-practice-block paa-practice-forecast-section'},h('h3',null,'战况预测'),forecast?.status==='estimated'?
          h('div',null,forecastChart(),forecastNote()):
          h('p',{className:'paa-muted'},!selected?'选择对手后查看。':!enemy.known?'对手舰队资料待同步。':!filled.length?'添加己方舰娘后查看。':forecast?.reason||'战斗资料不足。')),
        h(QuestSection,{state:store,slots,deckId:fleet,kind:'practice',questState:quest,paused:hidden||busy,disabled,open:questsOpen,onOpenChange:setQuestsOpen,listTasks:practiceTasks,countTasks:countPracticeQuests,
          selectedQuests,onToggleQuest:code=>{if(!disabled){setSelectedQuests(current=>current.includes(code)?current.filter(item=>item!==code):[...current,code].sort());setMessage('');}},
          onClearQuests:()=>{if(!disabled){setSelectedQuests([]);setMessage('');}}})),
      h('section',{className:'paa-wb-right'},h('div',{className:'paa-wb-command-area','data-running':!!busy},h('div',{className:'paa-wb-command-row'},
        h('div',{className:'paa-wb-edit-controls'},h('button',{type:'button',className:'paa-wb-complete',disabled,onClick:complete},
          h('svg',{width:15,height:15,viewBox:'0 0 20 20',fill:'none',stroke:'currentColor',strokeWidth:1.5,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('path',{d:'m4 16 9-9 3 3-9 9zM4 3v4M2 5h4M14 1v3M12.5 2.5h3'})),working?'计算中…':'一键补全'),
          h('button',{type:'button',className:'paa-wb-quiet',disabled,onClick:()=>{setSlots(empty());setMessage('');setShipFleet('all');}},'一键清空')),
        automaticOperations||busy?h('div',{className:'paa-wb-apply-controls'},h('label',{className:'paa-wb-field'},h('span',null,'编入'),h('select',{'aria-label':'编入舰队',value:fleet,disabled,onChange:e=>setFleet(Number(e.target.value))},
          ...[1,2,3,4].map(n=>h('option',{key:n,value:n},`第 ${n} 舰队`)))),
          h('button',{type:'button',className:'paa-primary paa-wb-apply',ref:stopButtonRef,'data-running':!!busy,disabled:busy?stopping:disabled||!preview,onClick:e=>busy?onStop?.(e):onApply?.(scheme)},busy?(stopping?'正在停止…':'停止操作'):'应用编成')):null)),
        operationFeedback,message?h('p',{className:'paa-fleet-warning',role:'status'},message):null,
        metrics(),
        h('div',{className:'paa-wb-ships',ref:grid},...slots.map(card)))),
      popup&&popup.slot===undefined?ShipPicker({index:popup.index,rows:pickRows,search,setSearch,shipFleet,setShipFleet,shipType,setShipType,shipSort,setShipSort,replacementType,replacementTypeLabel,disabled,onClose:()=>setPopup(null),onPick:pick,hint:'选择舰娘后可继续调整装备',listRef:popupList,store,kind:'practice'}):
      popup?EquipmentPicker({index:popup.index,slot:popup.slot,rows:pickRows,search,setSearch,group:equipmentGroup,setGroup:setEquipmentGroup,
        category:equipmentCategory,setCategory:setEquipmentCategory,sort:equipmentSort,setSort:setEquipmentSort,store,currentEquipment,disabled,listRef:popupList,
        onClose:()=>setPopup(null),onPick:pick,onClear:()=>pick({id:-1})}):null);
  };
};
