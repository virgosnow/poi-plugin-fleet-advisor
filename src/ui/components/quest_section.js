'use strict';

const PERIODS={once:'单次',single:'单次',oneTime:'单次','one-time':'单次',daily:'日常',weekly:'周常',monthly:'月常',quarterly:'季常',yearly:'年常',annual:'年常'};
const STATUS_TEXT={met:'编成条件满足',unmet:'编成条件未满足',unknown:'编成条件待确认'};
const status=value=>Object.hasOwn(STATUS_TEXT,value)?value:'unknown';
const text=value=>typeof value==='string'?value:typeof value==='number'&&Number.isFinite(value)?String(value):'';
function comparison(check){
  const actual=text(check.actual),required=text(check.required);
  return required?`${actual||'—'} / ${required}`:actual;
}
function goalLabels(task){
  const labels=(Array.isArray(task.goals)?task.goals:[]).map(goal=>typeof goal==='string'?goal:text(goal?.label)).filter(Boolean);
  return labels.length?[...new Set(labels)]:['目标条件待确认'];
}
const goalText=task=>goalLabels(task).join('；');

module.exports=function createQuestSection(React,options={}){
  const h=React.createElement;
  const toggleCardSpace=event=>{
    if(event.defaultPrevented||event.button!==undefined&&event.button!==0)return;
    const card=event.currentTarget,target=event.target?.nodeType===3?event.target.parentElement:event.target;
    // Keep summary activation native, and leave the entire reading/scrolling
    // region alone. Forward only the card's surrounding whitespace once.
    if(!target||target.closest?.('summary, .paa-quest-content'))return;
    if(card.ownerDocument?.getSelection?.()?.isCollapsed===false)return;
    card.querySelector(':scope > summary')?.click();
  };
  // Loading the quest catalog and evaluating a draft are both deferred until opened.
  const listRelatedQuests=options.listRelatedQuests||((input)=>require('../../domain/quests/quest_requirements').listRelatedQuests(input));
  return function QuestSection({state,slots,deckId,kind='normal',mapId,missionId,questState}){
    const [open,setOpen]=React.useState(false);
    const related=React.useMemo(()=>open?listRelatedQuests({state,slots,deckId,kind,mapId,missionId,questState}):null,
      [open,state,slots,deckId,kind,mapId,missionId,questState]);
    const ready=related?.status==='ready';
    const tasks=ready&&(Array.isArray(related.tasks))?related.tasks.filter(task=>task&&(Number(task.state)===1||Number(task.state)===2)):[];
    const taskView=task=>{
      const conditionStatus=status(task.status),checks=Array.isArray(task.checks)?task.checks:[],period=text(task.period);
      return h('article',{key:task.id??task.code,className:'paa-quest-item','data-quest-id':task.id,'data-condition-status':conditionStatus},
        h('div',{className:'paa-quest-heading'},
          h('h4',null,text(task.title)||text(task.code)||`任务 ${task.id}`)),
        h('div',{className:'paa-quest-meta'},
          period?h('span',{className:'paa-quest-period'},PERIODS[period]||period):null,
          h('span',{className:'paa-quest-state','data-active':Number(task.state)===2},Number(task.state)===2?'进行中':'可受领'),
          h('span',{className:'paa-quest-condition-status','data-status':conditionStatus},STATUS_TEXT[conditionStatus])),
        h('div',{className:'paa-quest-goals'},h('span',{className:'paa-quest-row-label'},'目标'),
          h('ul',{'aria-label':'任务行动目标'},...goalLabels(task).map((label,index)=>h('li',{key:index},label)))),
        checks.length?h('div',{className:'paa-quest-requirements'},h('span',{className:'paa-quest-row-label'},'编成'),
          h('ul',{className:'paa-quest-checks','aria-label':'当前编成要求'},...checks.map((check,index)=>{
          const checkStatus=status(check.status),value=comparison(check);
          const detail=[text(check.actual)?`当前 ${text(check.actual)}`:'',text(check.required)?`要求 ${text(check.required)}`:''].filter(Boolean).join('\n');
          return h('li',{key:index,'data-status':checkStatus},
            h('span',{className:'paa-quest-check-mark','aria-hidden':true},checkStatus==='met'?'✓':checkStatus==='unmet'?'!':'?'),
            h('span',{className:'paa-quest-check-label'},text(check.label)),
            value?h('span',{className:'paa-quest-check-value','data-tooltip':detail,'aria-label':detail},value):null);
        }))):task.summary&&text(task.summary)!==goalText(task)?h('div',{className:'paa-quest-requirements'},h('span',{className:'paa-quest-row-label'},'编成'),h('p',{className:'paa-quest-requirement-summary'},text(task.summary))):null);
    };
    return h('details',{className:'paa-quest-section',open,'aria-label':'相关任务',onClick:toggleCardSpace,onToggle:event=>setOpen(Boolean(event.currentTarget.open))},
      h('summary',null,h('span',null,'相关任务'),open&&ready?h('span',{className:'paa-quest-count'},`${tasks.length} 项`):null),
      open?h('div',{className:'paa-quest-content'},
        !ready?h('p',{className:'paa-quest-empty'},'请在游戏中打开任务列表以同步'):
          !tasks.length?h('p',{className:'paa-quest-empty'},'暂无可受领或进行中的相关任务'):
            h('div',{className:'paa-quest-list',role:'region','aria-label':'相关任务要求',tabIndex:0},...tasks.map(taskView))):null);
  };
};
