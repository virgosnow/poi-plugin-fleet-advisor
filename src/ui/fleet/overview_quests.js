'use strict';
require('../shared_catalog');
require('../i18n/readability');
const i18n=require('../../shared/i18n');
const questDisplay=require('../i18n/quest_display');
const questText=require('../i18n/quest_localization');
const {listOverviewQuests}=require('../../domain/quests/quest_overview');
const collapse=require('../components/collapse');
module.exports=function createOverviewQuests(React,{getController=()=>null,subscribe=()=>()=>{}}={}){
  const h=React.createElement,rewardView=require('../components/quest_rewards')(React),badges=require('../components/quest_badges')(React);
  function OverviewQuests({state,questState,onNavigate,disabled=false}){
    i18n.useLocale(React);const t=i18n.t;
    const incomplete=(questState??state?.questState)?.complete===false;
    const unavailable=incomplete&&(questState??state?.questState)?.known!==true;
    const [revision,setRevision]=React.useState?React.useState(0):[0,()=>{}];
    const [category,setCategory]=React.useState?React.useState('B'):['B',()=>{}];
    const [narrow,setNarrow]=React.useState?React.useState(false):[false,()=>{}];
    const [openByLayout,setOpenByLayout]=React.useState?React.useState({}):[{},()=>{}];
    const root=React.useRef?React.useRef(null):{current:null};
    const layout=narrow?'narrow':'wide',expanded=openByLayout[layout]??!narrow;
    const layoutEffect=React.useLayoutEffect||React.useEffect;
    if(layoutEffect)layoutEffect(()=>{
      const container=root.current?.closest('.paa'),win=container?.ownerDocument?.defaultView;
      if(!container||!win)return;
      const update=()=>{const css=win.getComputedStyle(container),width=container.clientWidth-(parseFloat(css.paddingLeft)||0)-(parseFloat(css.paddingRight)||0);
        if(width>0)setNarrow(width<=780);};
      update();const observer=win.ResizeObserver?new win.ResizeObserver(update):null;
      if(observer)observer.observe(container);else win.addEventListener('resize',update);
      return()=>{if(observer)observer.disconnect();else win.removeEventListener('resize',update);};
    },[]);
    if(React.useEffect)React.useEffect(()=>subscribe(event=>{if(event?.type==='questProgress')setRevision(n=>n+1);}),[]);
    const service=getController();void revision;
    const result=React.useMemo?React.useMemo(()=>listOverviewQuests({state,questState}),[state,questState]):listOverviewQuests({state,questState}),tasks=result.tasks;
    const counts=tasks.length?service?.getQuestGoalProgressForTasks?.(tasks):null;
    let equipmentByName;
    const lookup=name=>{if(!equipmentByName){equipmentByName=new Map();for(const row of Object.values(state?.const?.$equips||{}))if(row?.api_name&&!equipmentByName.has(row.api_name))equipmentByName.set(row.api_name,row);}return equipmentByName.get(name);};
    const goalView=(task,goal,index)=>{
      const choices=goal.destinations||[],observed=goal.key?(counts?counts.get(`${task.id}:${goal.key}`):service?.getQuestGoalProgress?.(task,goal)):0;
      const count=task.state===3?goal.count:Number.isSafeInteger(observed)?Math.max(0,Math.min(observed,goal.count)):0;
      // This particular task has exactly one objective and its documented
      // 50% marker means one of the two required expedition returns. Other
      // tasks can have multiple objectives, so their markers cannot identify
      // an individual objective's count.
      const gameConfirmed=task.state===2&&task.id===443&&task.code==='D39'&&task.progressFlag===1&&task.goals.length===1&&
        goal.count===2&&choices.length===1&&choices[0].kind==='expedition'&&choices[0].missionId===30&&count<2;
      const hasCount=Number.isSafeInteger(goal.count)&&goal.count>0,complete=hasCount&&count>=goal.count;
      const progressText=gameConfirmed?'1 / 2':complete?`${count} / ${goal.count}`:
        count>0?`≥${count} / ${goal.count}`:`0 / ${goal.count}`;
      const progressDescription=gameConfirmed?t('目标进度 1/2，依据游戏任务进度'):complete?
        t('已观察目标进度 {count}/{total}',{count,total:goal.count}):count>0?t('已观察目标进度至少 {count}/{total}',{count,total:goal.count}):t('目标进度未确认');
      const status=hasCount?h('span',{className:'paa-overview-goal-status','data-complete':complete,
        'data-progress-source':gameConfirmed?'game':count>0?'observed':'unknown','aria-label':progressDescription,
        ...gameConfirmed?{title:t('依据游戏任务进度')}:count>0&&!complete?{title:t('根据已观察到的记录，实际进度可能更高')}:count===0?{title:t('目标进度未确认')}:{}},progressText):null;
      const button=(destination,label,key,showStatus=false)=>{
        const area=String(label).match(/^(\d+-\d+)(.*)$/);
        return h('button',{key,type:'button',disabled:disabled||unavailable||!task.code,
        className:'paa-overview-quest-target',onClick:()=>onNavigate?.({...destination,code:task.code}),
        'aria-label':t('{label}：前往{destination}并预选{title}{progress}',{label,destination:t(destination.kind==='normal'?'海域':destination.kind==='practice'?'演习':'远征'),title:task.title,progress:showStatus&&hasCount?`，${progressDescription}`:''})},
        h('span',{className:'paa-overview-target-label'},area?h(React.Fragment||'span',null,h('strong',null,area[1]),area[2]):label),
        showStatus?status:null);
      };
      let label=goal.kind?questDisplay.structuredGoal(goal,task.period):goal.label==='目标条件待确认'?t('目标条件待确认'):questDisplay.goal(goal.label,!!goal.key||goal.known===true);
      if(hasCount)label=label.replace(/\s+\d+(?:次|回)$/,'');
      const content=choices.length===1?button(choices[0],choices[0].suggested?`${label}（${questDisplay.destination(choices[0])}）`:label,index,true):
        choices.length>1?h(React.Fragment||'span',null,h('span',{className:'paa-overview-goal-label'},label),
          h('div',{className:'paa-overview-quest-choices'},...choices.map((destination,i)=>button(destination,questDisplay.destination(destination),i)))):
          h(React.Fragment||'span',null,h('span',{className:'paa-overview-goal-label'},label),goal.known||goal.label==='目标条件待确认'?null:h('small',null,t('目标待确认')));
      return h('li',{key:index,className:'paa-overview-goal','data-complete':complete},
        h('div',{className:'paa-overview-goal-content'},content),choices.length!==1?status:null);
    };
    const categoryName=category==='F'?(i18n.getLocale()==='zh-CN'?'工厂':t('quest.factoryCategory')):t(category==='B'?'出击':category==='C'?'演习':'远征');
    return h('section',{className:'paa-overview-quests','aria-label':t('进行中的任务'),ref:root},
      h('div',{className:'paa-overview-quests-heading','data-open':expanded},h('h3',null,
        h('button',{type:'button',className:'paa-overview-quests-toggle',disabled,'aria-expanded':expanded,'aria-controls':'paa-overview-tasks-content',
          onClick:()=>setOpenByLayout(previous=>({...previous,[layout]:!expanded}))},h('span',null,t('进行中的任务')),
          !expanded&&result.status==='ready'?h('small',null,t('{n} 项',{n:tasks.length})):null,
          h('svg',{className:'paa-fleet-chevron','data-open':expanded,viewBox:'0 0 16 16',width:12,height:12,fill:'none',stroke:'currentColor',strokeWidth:1.6,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('path',{d:'m6 3 5 5-5 5'})))),
        expanded&&result.status==='ready'?h('div',{className:'paa-overview-quest-tabs','aria-label':t('任务类型')},
        ...[['B','出击'],['D','远征'],['C','演习'],...(tasks.some(task=>task.category==='F')?[['F','quest.factoryCategory']]:[])].map(([key,label])=>h('button',{key,type:'button',disabled,'aria-pressed':category===key,onClick:()=>setCategory(key)},key==='F'&&i18n.getLocale()==='zh-CN'?'工厂':t(label),h('span',null,tasks.filter(task=>task.category===key).length)))):null),
      collapse(h,{open:expanded,id:'paa-overview-tasks-content'},
      result.status!=='ready'||incomplete&&!tasks.some(task=>task.category===category)?h('p',{className:'paa-overview-quests-empty'},t('任务资料正在后台同步')):
        !tasks.some(task=>task.category===category)?h('p',{className:'paa-overview-quests-empty'},t('暂无进行中的{category}任务',{category:categoryName})):
          h(React.Fragment||'div',null,
          incomplete?h('p',{className:'paa-overview-quests-empty'},t('已观察到部分任务，正在后台核实完整列表')):null,
          service?.getQuestProgressError?.()?h('p',{className:'paa-overview-quests-error',role:'alert'},service.getQuestProgressError()):null,
          h('div',{className:'paa-overview-quests-list',role:'region','aria-label':t('进行中的任务列表'),tabIndex:0},...tasks.filter(task=>task.category===category).map(task=>{
            const number=questText.number(task,state),requirements=task.fleetRequirements;
            return h('article',{key:task.id,className:'paa-overview-quest','data-quest-id':task.id},
              h('div',{className:'paa-overview-quest-header'},
                h('div',{className:'paa-overview-quest-heading'},badges.period(task.period,number),h('h4',!task.period&&number?{'data-tooltip':t('quest.number',{number}),tabIndex:0}:null,task.title)),
                h('div',{className:'paa-overview-quest-meta'},badges.status(task.state))),
              h('div',{className:'paa-quest-requirements'},h('span',{className:'paa-quest-row-label'},t('编成')),
                h('ul',null,...(requirements===null?[t('readability.fleetUnknown')]:requirements.length?requirements.map(questDisplay.fleetRule):[t('readability.fleetUnrestricted')]).map((label,index)=>h('li',{key:index},label)))),
              h('div',{className:'paa-quest-goals'},h('span',{className:'paa-quest-row-label'},t('目标')),
                h('ul',{className:'paa-overview-task-goals','aria-label':t('任务行动目标')},...task.goals.map((goal,index)=>goalView(task,goal,index)))),
              rewardView(task,state,lookup));})))));
  };
  return React.memo?React.memo(OverviewQuests):OverviewQuests;
};
