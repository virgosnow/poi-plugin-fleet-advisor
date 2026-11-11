'use strict';
require('../shared_catalog');
require('../i18n/readability');
const i18n=require('../../shared/i18n');
const questDisplay=require('../i18n/quest_display');
const questText=require('../i18n/quest_localization');
const {taskSnapshot,findDefinition}=require('../../domain/quests/quest_requirements');
const {rewards}=require('../../domain/quests/quest_overview');

const PERIODS={once:'单次',single:'单次',oneTime:'单次','one-time':'单次',daily:'日常',weekly:'周常',monthly:'月常',quarterly:'季常',yearly:'年常',annual:'年常'};
const STATUS_TEXT={met:'编成条件满足',unmet:'编成条件未满足',unknown:'编成条件待确认'};
const status=value=>Object.hasOwn(STATUS_TEXT,value)?value:'unknown';
const text=value=>typeof value==='string'?value:typeof value==='number'&&Number.isFinite(value)?String(value):'';
function comparison(check){
  const actual=text(check.actual),required=text(check.required);
  return required?`${actual||'—'} / ${required}`:actual;
}
function goalRows(task){
  const unique=new Map();
  for(const goal of Array.isArray(task.goals)?task.goals:[]){
    const label=typeof goal==='string'?goal:text(goal?.label);if(!label)continue;
    const related=typeof goal!=='object'||goal?.relatedToCurrent!==false;
    const previous=unique.get(label);
    unique.set(label,{label,related:related||!!previous?.related,map:typeof goal==='object'&&goal?.map||previous?.map,goal:typeof goal==='object'?goal:null,
      key:typeof goal==='object'?goal.key:undefined,count:typeof goal==='object'?goal.count:undefined});
  }
  return unique.size?[...unique.values()]:[{label:'目标条件待确认',related:true}];
}
const goalText=task=>goalRows(task).map(row=>row.label).join('；');
function displayGoalRows(task){
  const rows=goalRows(task),groups=new Map();
  // Each tracked objective needs its own progress, even when other maps have
  // identical conditions. Never merge their counts into a single row.
  if(rows.some(row=>row.key||row.count))return rows;
  for(const row of rows.filter(row=>!row.related)){
    const map=typeof row.map==='string'&&row.map!=='any'?row.map:'';
    if(map&&row.label.startsWith(`${map} `)){
      const suffix=row.label.slice(map.length);
      const key=`map:${suffix}`;
      if(!groups.has(key))groups.set(key,{maps:[],suffix});
      groups.get(key).maps.push(map);
    }else groups.set(`label:${row.label}`,{label:row.label});
  }
  const other=[...groups.values()].map(group=>group.label||`${group.maps.join('、')}${group.suffix}`);
  return [...rows.filter(row=>row.related),...other.map((label,index)=>({label:index?label:`其他：${label}`,related:false}))];
}

module.exports=function createQuestSection(React,options={}){
  const h=React.createElement,rewardView=require('./quest_rewards')(React);let nextContentId=0;
  const toggleCardSpace=event=>{
    if(event.defaultPrevented||event.button!==undefined&&event.button!==0)return;
    const card=event.currentTarget,target=event.target?.nodeType===3?event.target.parentElement:event.target;
    // Keep summary activation native, and leave the entire reading/scrolling
    // region alone. Forward only the card's surrounding whitespace once.
    if(!target||target.closest?.('summary, .paa-quest-content'))return;
    if(card.ownerDocument?.getSelection?.()?.isCollapsed===false)return;
    card.querySelector(':scope > details > summary')?.click();
  };
  // Evaluate while expanded or while selected tasks must remain visible.
  const listRelatedQuests=options.listRelatedQuests||((input)=>require('../../domain/quests/quest_requirements').listRelatedQuests(input));
  const countRelatedQuests=options.countRelatedQuests||((input)=>require('../../domain/quests/quest_requirements').countRelatedQuests(input));
  return function QuestSection({state,slots,deckId,kind='normal',mapId,missionId,questState,selectedQuests=[],onToggleQuest,onClearQuests,onNavigateQuest,disabled=false,paused=false,defaultOpen=false,open:controlledOpen,onOpenChange,readOnly=false,listTasks,countTasks}){
    const [internalOpen,setOpen]=React.useState(!!defaultOpen),open=controlledOpen===undefined?internalOpen:!!controlledOpen;
    const last=React.useRef(null),lastCount=React.useRef(null);
    const displayQuestState=questState??state?.questState;
    const contentId=React.useRef(null);if(!contentId.current)contentId.current=`paa-quest-content-${++nextContentId}`;
    const count=React.useMemo(()=>!paused&&(kind==='normal'||kind==='practice'&&countTasks)?(kind==='practice'?countTasks:countRelatedQuests)({state,mapId,questState:displayQuestState}):lastCount.current,
      [kind,mapId,displayQuestState,state?.questState,state?.info?.quests,paused,countTasks]);
    if((kind==='normal'||kind==='practice')&&!paused)lastCount.current=count;
    const needsTasks=open||selectedQuests.length>0;
    const related=React.useMemo(()=>needsTasks?(listTasks||listRelatedQuests)({state,slots,deckId,kind,mapId,missionId,questState:displayQuestState}):last.current,
      [needsTasks,state,slots,deckId,kind,mapId,missionId,displayQuestState,listTasks]);
    if(needsTasks)last.current=related;
    i18n.useLocale(React);
    const t=i18n.t;
    const ready=related?.status==='ready';
    const incomplete=displayQuestState?.complete===false;
    const unavailable=incomplete&&displayQuestState?.known!==true;
    const tasks=ready&&Array.isArray(related.tasks)?related.tasks.filter(task=>task&&[1,2,3].includes(Number(task.state)))
      .sort((a,b)=>Number(b.state)-Number(a.state)):[];
    const service=options.getController?.(),counts=tasks.length?service?.getQuestGoalProgressForTasks?.(tasks):null;
    const [progressRevision,setProgressRevision]=React.useState(0);void progressRevision;
    if(React.useEffect)React.useEffect(()=>options.subscribe?.(event=>{if(event?.type==='questProgress')setProgressRevision(n=>n+1);}),[]);
    const liveTasks=needsTasks?new Map(taskSnapshot(state,displayQuestState).tasks.filter(row=>row&&Number.isSafeInteger(Number(row.api_no)))
      .map(row=>[Number(row.api_no),row])):new Map();
    let equipmentByName;
    const lookup=name=>{if(!equipmentByName){equipmentByName=new Map();for(const row of Object.values(state?.const?.$equips||{}))
      if(row?.api_name&&!equipmentByName.has(row.api_name))equipmentByName.set(row.api_name,row);}return equipmentByName.get(name);};
    const taskView=task=>{
      const localizedGoals={...task,goals:(Array.isArray(task.goals)?task.goals:[]).map(goal=>typeof goal==='object'&&goal?.kind?{...goal,label:questDisplay.structuredGoal(goal,task.period)}:goal)};
      const conditionStatus=status(task.status),checks=Array.isArray(task.checks)?task.checks:[],period=text(task.period),selected=selectedQuests.includes(task.code),taskState=Number(task.state),flag=Number(task.progressFlag);
      const progress=taskState===3?'已达成':taskState===2?(task.progressFlag==null?'进度未确认':flag===2?'进度 80% 以上':flag===1?'进度 50% 以上':flag===0?'进度未满 50%':'进度未确认'):'';
      const toggle=()=>{if(!disabled&&!unavailable&&task.code)onToggleQuest?.(task.code);};
      const number=questText.number(task,state);
      const live=liveTasks.get(Number(task.id)),rewardData=task.rewards||rewards(live||{},state,live?findDefinition(live,Date.now()):null,lookup);
      const sameRule=(left,right)=>left&&right&&JSON.stringify(left)===JSON.stringify(right);
      const staticChecks=task.fleetRequirements===null?[{label:t('readability.fleetUnknown')}]:Array.isArray(task.fleetRequirements)?
        (task.fleetRequirements.length?task.fleetRequirements.map(rule=>typeof rule==='string'?checks.find(check=>check.label===rule)||{label:rule}:checks.find(check=>sameRule(check.rule,rule))||{rule}):[{label:t('readability.fleetUnrestricted')}])
        :readOnly?[{label:t('readability.fleetUnknown')}]:checks.length?checks.filter(check=>check.label!=='请先选择舰娘'):
          task.summary&&text(task.summary)!==goalText(task)?[{label:text(task.summary)}]:[{label:t('readability.fleetUnknown')}];
      const additional=readOnly||!Array.isArray(task.fleetRequirements)?[]:checks.filter(check=>check.code!=='selectShip'&&check.label!=='请先选择舰娘'&&!task.fleetRequirements.some(rule=>typeof rule==='string'?rule===check.label:sameRule(rule,check.rule)));
      const heading=h('div',{className:'paa-quest-heading'},number?h('span',{className:'paa-quest-number'},number):null,h('h4',null,text(task.title)||text(task.code)||t('任务 {id}',{id:task.id})));
      const meta=h('div',{className:'paa-quest-meta'},
        period?h('span',{className:'paa-quest-period'},t(PERIODS[period]||period)):null,
        h('span',{className:'paa-quest-state','data-active':taskState>=2},t(taskState>=2?'进行中':'可受领')),
        readOnly?null:h('span',{className:'paa-quest-condition-status','data-status':conditionStatus},t(STATUS_TEXT[conditionStatus])),
        progress?h('span',{className:'paa-quest-progress','data-complete':taskState===3},t(progress)):null);
      return h('article',{key:task.id??task.code,className:'paa-quest-item',style:readOnly?{cursor:'default'}:undefined,...readOnly?{}:{role:'checkbox',tabIndex:disabled||unavailable||!task.code?-1:0,
        'aria-checked':selected,'aria-disabled':disabled||unavailable||!task.code||undefined,'aria-label':t('选择任务：{title}',{title:text(task.title)||text(task.code)})},
        'data-quest-id':task.id,'data-condition-status':readOnly?undefined:conditionStatus,'data-selected':selected||undefined,'data-progress':!!progress,
        onClick:readOnly?undefined:event=>{if(event.defaultPrevented||event.button!==undefined&&event.button!==0||event.target?.closest?.('button,a'))return;
          if(event.currentTarget.ownerDocument?.getSelection?.()?.isCollapsed===false)return;toggle();},
        onKeyDown:readOnly?undefined:event=>{if(event.target?.closest?.('button,a,input,select,textarea,summary'))return;
          if((event.key===' '||event.key==='Enter')&&!event.repeat){event.preventDefault();toggle();}}},
        selected?h('span',{className:'paa-quest-preselected'},t('预选')):null,
        h('div',{className:'paa-quest-header'},heading,meta),
        h('div',{className:'paa-quest-requirements'},h('span',{className:'paa-quest-row-label'},t('编成')),
          h('ul',{className:'paa-quest-checks','aria-label':t('当前编成要求')},...[...staticChecks,...additional].map((check,index)=>{
              const checkStatus=readOnly?undefined:check.status&&status(check.status),value=readOnly?'':comparison(check);
              const detail=[text(check.actual)?t('当前 {value}',{value:text(check.actual)}):'',text(check.required)?t('要求 {value}',{value:text(check.required)}):''].filter(Boolean).join('\n');
              return h('li',{key:index,'data-status':checkStatus},
                checkStatus?h('span',{className:'paa-quest-check-mark','aria-hidden':true},checkStatus==='met'?'✓':checkStatus==='unmet'?'!':'?'):h('span',null),
                h('span',{className:'paa-quest-check-label'},check.rule?questDisplay.fleetRule(check.rule):questDisplay.check(text(check.label))),value?h('span',{className:'paa-quest-check-value','aria-label':detail},value):null);
            }))),
        h('div',{className:'paa-quest-goals'},h('span',{className:'paa-quest-row-label'},t('目标')),
          h('ul',{'aria-label':t('任务行动目标')},...displayGoalRows(localizedGoals).map(({label,related,key,count,goal},index)=>{
            if(i18n.getLocale()!=='zh-CN'&&label.startsWith('其他：'))label=t('quest.other',{value:label.slice(3)});
            if(label==='目标条件待确认')label=t(label);
            const amount=Number.isSafeInteger(count)&&count>0?count:null;
            const observed=amount&&key?(counts?counts.get(`${task.id}:${key}`):service?.getQuestGoalProgress?.(task,{key,count:amount})):null;
            const n=taskState===3&&amount?amount:Number.isSafeInteger(observed)?Math.max(0,Math.min(observed,amount||0)):0;
            if(amount)label=label.replace(/\s+\d+(?:次|回)$/,'');
            const map=kind==='normal'||kind==='practice'?label.match(/^(\d+-\d+)(.*)$/):null;
            const targets=goal&&(goal.map||goal.anyTargets)?require('../../domain/quests/quest_overview').destinations(goal,'B'):[];
            const content=map?[h('strong',{key:'map'},map[1]),map[2]]:[label];
            const link=(destination,children,index)=>h('button',{key:index,type:'button',className:'paa-quest-goal-link',disabled:disabled||unavailable||!task.code,onClick:()=>onNavigateQuest({...destination,code:task.code})},...children);
            const body=onNavigateQuest&&targets.length===1?link(targets[0],content,0):h('span',{className:'paa-quest-goal-text'},...content,
              onNavigateQuest&&targets.length>1?h('span',{className:'paa-quest-goal-links'},...targets.map((target,i)=>link(target,[questDisplay.destination(target)],i))):null);
            return h('li',{key:index,'data-related':related?'true':'false'},body,
              amount?h('span',{className:'paa-quest-goal-progress','data-complete':n>=amount,'aria-label':n?t('已观察目标进度至少 {count}/{total}',{count:n,total:amount}):t('目标进度未确认'),...!n?{title:t('目标进度未确认')}:{}},n>=amount?`${amount} / ${amount}`:n?`≥${n} / ${amount}`:`0 / ${amount}`):null);
          }))),
        rewardView({...task,rewards:rewardData}));
    };
    const selectedTasks=tasks.filter(task=>selectedQuests.includes(task.code));
    const missing=selectedQuests.filter(code=>!selectedTasks.some(task=>task.code===code));
    const compactSelection=kind==='normal'||kind==='practice';
    return h('section',{className:'paa-quest-section','aria-label':t('相关任务'),onClick:toggleCardSpace},
      h('details',{className:'paa-quest-disclosure',open,onToggle:event=>{const next=Boolean(event.currentTarget.open);setOpen(next);onOpenChange?.(next);}},
        h('summary',{'aria-controls':contentId.current},h('span',null,t('相关任务')),
          compactSelection&&count?.status==='ready'?h('span',{className:'paa-quest-count'},t('{n} 件',{n:count.count})+(selectedQuests.length?t(' · 预选 {n}',{n:selectedQuests.length}):'')):
            selectedQuests.length?h('span',{className:'paa-quest-count'},t(compactSelection?'预选 {n}':'已选 {n}',{n:selectedQuests.length})):open&&ready?h('span',{className:'paa-quest-count'},t('{n} 项',{n:tasks.length})):null,
          h('svg',{className:'paa-quest-expand-icon',viewBox:'0 0 16 16','aria-hidden':true},h('path',{d:open?'m4 3 4 3 4-3M4 13l4-3 4 3':'m4 6 4-4 4 4M4 10l4 4 4-4'})))),
      compactSelection&&!open&&selectedQuests.length?h('div',{className:'paa-quest-content paa-quest-selected-compact'},
        selectedTasks.length?h('ul',{'aria-label':t('已预选任务')},...selectedTasks.map(task=>
          h('li',{key:task.id??task.code},questText.number(task,state)?h('span',{className:'paa-quest-number'},questText.number(task,state)+' '):null,text(task.title)||text(task.code)||t('任务 {id}',{id:task.id})))):null,
        missing.length?h('p',{className:'paa-quest-empty'},t('任务资料待同步或已变化：{codes}',{codes:missing.join('、')})):null):
      !compactSelection&&selectedQuests.length?h('div',{className:'paa-quest-content paa-quest-selected'},
        h('div',{className:'paa-quest-selection'},h('span',null,t('已选 {n} 项，补全时同时满足编成要求',{n:selectedQuests.length})),
          h('button',{type:'button',disabled,onClick:()=>onClearQuests?.()},t('清除选择'))),
        !open&&selectedTasks.length?h('div',{className:'paa-quest-list',role:'region','aria-label':t('已预选任务'),tabIndex:0},...selectedTasks.map(taskView)):null,
        missing.length?h('p',{className:'paa-quest-empty'},t('任务资料待同步或已变化：{codes}',{codes:missing.join('、')})):null):null,
      h('div',{id:contentId.current,className:'paa-quest-content','aria-hidden':!open,inert:open?undefined:'',hidden:!open},
        incomplete&&tasks.length?h('p',{className:'paa-quest-empty'},t('已观察到部分任务，正在后台核实完整列表')):null,
        compactSelection&&selectedQuests.length?h('div',{className:'paa-quest-selection'},h('span',null,t('预选 {n} 项，补全时同时满足编成要求',{n:selectedQuests.length})),
          h('button',{type:'button',disabled,onClick:()=>onClearQuests?.()},t('清除选择'))):null,
        compactSelection&&missing.length?h('p',{className:'paa-quest-empty'},t('任务资料待同步或已变化：{codes}',{codes:missing.join('、')})):null,
        open||related?(
        !ready||incomplete&&!tasks.length?h('p',{className:'paa-quest-empty'},t('任务资料正在后台同步')):
          !tasks.length?h('p',{className:'paa-quest-empty'},t('暂无可受领或进行中的相关任务')):
            h('div',{className:'paa-quest-list',role:'region','aria-label':t('相关任务要求'),tabIndex:0},...tasks.map(taskView))):null));
  };
};
