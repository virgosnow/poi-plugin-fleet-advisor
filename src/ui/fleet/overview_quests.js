'use strict';
const {listOverviewQuests}=require('../../domain/quests/quest_overview');
const collapse=require('../components/collapse');
const PERIODS={once:'单次',single:'单次',oneTime:'单次','one-time':'单次',daily:'日常',weekly:'周常',monthly:'月常',quarterly:'季常',yearly:'年常',annual:'年常'};
module.exports=function createOverviewQuests(React,{getController=()=>null,subscribe=()=>()=>{}}={}){
  const h=React.createElement,resourceIcon=require('../components/resource_icon'),ResourceIcon=resourceIcon(React),equipmentIconUrl=require('../models/presentation_model').equipmentIconUrl;
  function OverviewQuests({state,questState,onNavigate,disabled=false}){
    const [revision,setRevision]=React.useState?React.useState(0):[0,()=>{}];
    const [category,setCategory]=React.useState?React.useState('B'):['B',()=>{}];
    const [rewardOpen,setRewardOpen]=React.useState?React.useState({}):[{},()=>{}];
    if(React.useEffect)React.useEffect(()=>subscribe(event=>{if(event?.type==='questProgress')setRevision(n=>n+1);}),[]);
    const service=getController();void revision;
    const result=React.useMemo?React.useMemo(()=>listOverviewQuests({state,questState}),[state,questState]):listOverviewQuests({state,questState}),tasks=result.tasks;
    const counts=tasks.length?service?.getQuestGoalProgressForTasks?.(tasks):null;
    const goalView=(task,goal,index)=>{
      const choices=goal.destinations||[],observed=goal.key?(counts?counts.get(`${task.id}:${goal.key}`):service?.getQuestGoalProgress?.(task,goal)):0;
      const count=Number.isSafeInteger(observed)?Math.max(0,Math.min(observed,goal.count)):0,complete=!!goal.key&&count>=goal.count;
      const status=goal.key?h('span',{className:'paa-overview-goal-status','data-complete':complete,'aria-label':`目标进度 ${count}/${goal.count}`},
        complete?`✓ ${count}/${goal.count}`:`${count}/${goal.count}`):null;
      const button=(destination,label,key,showStatus=false)=>{
        const area=String(label).match(/^(\d+-\d+)(.*)$/);
        return h('button',{key,type:'button',disabled:disabled||!task.code,
        className:'paa-overview-quest-target',onClick:()=>onNavigate?.({...destination,code:task.code}),
        'aria-label':`${label}：前往${destination.kind==='normal'?'海域':'远征'}并预选${task.title}${showStatus&&goal.key?`，目标进度 ${count}/${goal.count}`:''}`},
        h('span',{className:'paa-overview-target-label'},area?h(React.Fragment||'span',null,h('strong',null,area[1]),area[2]):label),
        showStatus?status:null,h('span',{className:'paa-overview-target-arrow','aria-hidden':true},'›'));
      };
      const content=choices.length===1?button(choices[0],choices[0].suggested?`${goal.label}（${choices[0].label}）`:goal.label,index,true):
        choices.length>1?h(React.Fragment||'span',null,h('span',{className:'paa-overview-goal-label'},goal.label),
          h('div',{className:'paa-overview-quest-choices'},...choices.map((destination,i)=>button(destination,destination.label,i)))):
          h(React.Fragment||'span',null,h('span',{className:'paa-overview-goal-label'},goal.label),h('small',null,'目标待确认'));
      return h('li',{key:index,className:'paa-overview-goal','data-complete':complete},
        h('div',{className:'paa-overview-goal-content'},content),choices.length!==1?status:null);
    };
    const rewardView=task=>{
      const {resources,fixed,choices,reference,choicesFromGame,shipBonus}=task.rewards;
      const itemView=(item,key)=>{const icon=equipmentIconUrl(item.iconType);
        return h('span',{className:'paa-overview-reward-item',key},icon?h('img',{src:icon,alt:'',draggable:false,onError:event=>{event.currentTarget.style.display='none';}}):resourceIcon.resourceSource(item.name)?h(ResourceIcon,{name:item.name,size:15}):null,
          h('span',null,item.name,item.level?` ★${item.level}`:'',` ×${item.count}`));};
      const needsDetails=fixed.length>1||choices.length>0||shipBonus||!reference,expanded=!!rewardOpen[task.id],id=`paa-overview-reward-${task.id}`;
      return h('div',{className:'paa-overview-rewards'},h('div',{className:'paa-overview-reward-summary'},
        h('span',{className:'paa-overview-rewards-heading'},'报酬'),
        resources===null?h('span',{className:'paa-overview-rewards-unknown'},'资源报酬待同步'):
          resources.length?h('div',{className:'paa-overview-reward-list'},...resources.map(row=>h('span',{key:row.name,className:'paa-overview-reward','aria-label':`${row.name} ${row.amount}`},
            h(ResourceIcon,{name:row.name,size:15}),h('span',null,row.amount.toLocaleString())))):
            h('span',{className:'paa-overview-rewards-unknown'},'无资源报酬'),
        fixed.length?h('span',{className:'paa-overview-reward-preview','data-tooltip':'固定报酬 · 参考'},itemView(fixed[0],0)):null,
        needsDetails?h('button',{type:'button',className:'paa-overview-reward-toggle',disabled,'aria-expanded':expanded,'aria-controls':id,
          onClick:()=>setRewardOpen(previous=>({...previous,[task.id]:!previous[task.id]}))},expanded?'收起':'其他报酬'):null),
        needsDetails?collapse(h,{open:expanded,id},h('div',{className:'paa-overview-reward-details'},
        fixed.length?h('div',{className:'paa-overview-reward-choice'},h('span',null,'固定报酬 · 参考'),
          h('div',{className:'paa-overview-reward-items'},...fixed.map(itemView))):null,
        ...choices.map((group,index)=>h('div',{key:index,className:'paa-overview-reward-choice'},h('span',null,`任选其一${choices.length>1?` ${index+1}`:''}${choicesFromGame?'':' · 参考'}`),
          h('div',{className:'paa-overview-reward-items'},...group.map(itemView)))),
        shipBonus&&!fixed.length?h('span',{className:'paa-overview-rewards-unknown'},'舰娘报酬详情以游戏为准'):null,
        !reference&&!choices.length&&!shipBonus?h('span',{className:'paa-overview-rewards-unknown'},'其他报酬以游戏为准'):null)):null);
    };
    return h('section',{className:'paa-overview-quests','aria-label':'出击与远征任务'},
      h('div',{className:'paa-overview-quests-heading'},h('h3',null,'进行中的任务'),result.status==='ready'?h('div',{className:'paa-overview-quest-tabs','aria-label':'任务类型'},
        ...[['B','出击'],['D','远征']].map(([key,label])=>h('button',{key,type:'button',disabled,'aria-pressed':category===key,onClick:()=>setCategory(key)},label,h('span',null,tasks.filter(task=>task.category===key).length)))):null),
      result.status!=='ready'?h('p',{className:'paa-overview-quests-empty'},'请在游戏中打开任务列表以同步'):
        !tasks.some(task=>task.category===category)?h('p',{className:'paa-overview-quests-empty'},`暂无进行中的${category==='B'?'出击':'远征'}任务`):
          h(React.Fragment||'div',null,
          service?.getQuestProgressError?.()?h('p',{className:'paa-overview-quests-error',role:'alert'},service.getQuestProgressError()):null,
          h('div',{className:'paa-overview-quests-list',role:'region','aria-label':'进行中的任务列表',tabIndex:0},...tasks.filter(task=>task.category===category).map(task=>
            h('article',{key:task.id,className:'paa-overview-quest','data-quest-id':task.id},
              task.period||task.progressFlag===1||task.progressFlag===2?h('div',{className:'paa-overview-quest-meta'},task.period?h('span',{className:'paa-overview-quest-category'},PERIODS[task.period]||task.period):null,
                task.progressFlag===1||task.progressFlag===2?h('span',{'data-active':true},`进度 ${task.progressFlag===1?'50':'80'}% 以上`):null):null,
              h('h4',null,task.title),
              h('ul',null,...task.goals.map((goal,index)=>goalView(task,goal,index))),rewardView(task))))));
  };
  return React.memo?React.memo(OverviewQuests):OverviewQuests;
};
