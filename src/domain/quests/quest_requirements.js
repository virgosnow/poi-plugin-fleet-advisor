'use strict';

const DATA=require('../../../data/quests/requirements.json');
const LIMITED_EVENTS=require('../../../data/quests/limited');
const MISSIONS=require('../../../data/expedition_rewards.json').missions;
const {normalizeName}=require('../../shared/name_matching');
const {evaluateFleetRequirements}=require('./fleet_requirements');
const INDEX=new Map();
for(const [quests,event] of [[DATA.quests,null],...LIMITED_EVENTS.map(event=>[event.quests.filter(q=>['B','D'].includes(q.category)),event])])
  for(const quest of quests)for(const id of quest.ids){
    if(!INDEX.has(id))INDEX.set(id,[]);INDEX.get(id).push({quest,event});
  }
const titleKey=value=>normalizeName(String(value||'')).replace(/\s/g,'');
const enemyLabel={carrier:'空母',submarine:'潜水舰',transport:'运输舰'};
const statusOf=checks=>checks.some(c=>c.status==='unmet')?'unmet':checks.some(c=>c.status==='unknown')?'unknown':'met';

function taskSnapshot(state,provided){
  const snapshot=provided??state?.questState;
  if(snapshot)return snapshot.known===true&&Array.isArray(snapshot.tasks)?snapshot:{known:false,tasks:[]};
  const legacy=state?.info?.quests;
  if(Array.isArray(legacy))return {known:true,tasks:legacy};
  if(legacy&&typeof legacy==='object'&&!legacy.activeQuests&&!legacy.records){
    const tasks=Object.values(legacy);
    if(tasks.every(q=>q&&Number(q.api_no)>0))return {known:true,tasks};
  }
  return {known:false,tasks:[]};
}
function findDefinition(task,now){
  const candidates=INDEX.get(Number(task.api_no))||[];
  const title=titleKey(task.api_title);
  const day=new Date(now+9*60*60*1000).toISOString().slice(0,10);
  const allowed=candidates.filter(({quest,event})=>
    (!event||day>=event.startDate&&(!event.endDate||day<=event.endDate))&&
    (!(quest.requireTitleMatch||candidates.length>1)||titleKey(quest.title)===title));
  return allowed.length===1?allowed[0].quest:null;
}
function missionNumber(id){
  const raw=String(id??'').toUpperCase();return String(MISSIONS[raw]?.wikiId||raw);
}
function relation(goal,{mapId,missionId}){
  if(missionId!==undefined&&missionId!==null){
    if(!['expeditionDepart','expeditionReturn'].includes(goal.kind))return false;
    const id=missionNumber(missionId);
    return goal.missionId==='any'||missionNumber(goal.missionId)===id||goal.anyMissionIds?.some(value=>missionNumber(value)===id)||false;
  }
  if(!mapId||['expeditionDepart','expeditionReturn'].includes(goal.kind))return false;
  if(goal.kind==='sinkEnemy'){
    const targets=DATA.enemyTargets[mapId];
    if(!targets)return 'unknown';
    if(!Object.hasOwn(targets,goal.enemyGroup))return 'unknown';
    return targets[goal.enemyGroup].some(name=>!(goal.excludedNames||[]).some(excluded=>name.startsWith(excluded)));
  }
  if(goal.anyTargets)return goal.anyTargets.some(target=>target.map===String(mapId));
  return goal.map==='any'||goal.map===String(mapId)||!goal.map&&goal.kind==='departSortie';
}
function goalLabel(goal,{mapId,missionId}){
  const count=Number(goal.count||1),map=goal.map==='any'?'任意海域':goal.map||String(mapId||'');
  const place=goal.node?`${map} ${goal.node}点`:goal.phase?`${map} 第${goal.phase}阶段`:map;
  const rank=goal.rankMin==='win'?'胜利':goal.rankMin==='B'?'B胜以上':goal.rankMin==='A'?'A胜以上':goal.rankMin==='S'?'S胜':goal.rankMin?`${goal.rankMin}胜以上`:'';
  switch(goal.kind){
    case 'bossWin':return `${place} Boss ${rank} ${count}次`;
    case 'battleWin':return `${place} ${rank} ${count}次`;
    case 'battle':return `${place}${goal.bossOnly?' Boss':''}交战 ${count}次${goal.defeatAllowed?'（败北也可）':''}`;
    case 'departSortie':return `${map||'任意海域'}出击 ${count}次`;
    case 'bossReach':return `${place}抵达Boss ${count}次`;
    case 'reachGoal':return `${place}抵达终点 ${count}次`;
    case 'reachNode':return `${place}抵达 ${count}次`;
    case 'mapGaugeClear':return `${place}击破血条 ${count}次`;
    case 'sinkEnemy':return `击沉${enemyLabel[goal.enemyGroup]||goal.enemyGroup} ${count}艘${goal.excludedNames?.length?`（不含${goal.excludedNames.join('／')}）`:''}`;
    case 'sortie':return `${goal.anyTargets.map(target=>target.map).join('／')} Boss合计${rank} ${count}次`;
    case 'expeditionDepart':return `${goal.missionId==='any'?'任意远征':missionNumber(goal.missionId||missionId)+'号远征'}出发 ${count}次`;
    case 'expeditionReturn':{
      const missions=goal.anyMissionIds?`${goal.anyMissionIds.join('／')}号远征合计`:goal.missionId==='any'?'任意远征':missionNumber(goal.missionId)+'号远征';
      return `${missions}${goal.resultMin==='greatSuccess'?'大成功':'成功'} ${count}次`;
    }
    default:return '任务目标待确认';
  }
}
function resourcesChecks(quest,state){
  const requested=quest.recommendationActionResources||quest.claimResources;
  if(!requested)return [];
  const source=state?.info?.resources;
  const names={fuel:['燃料',0,1],ammo:['弹药',1,2],steel:['钢材',2,3],bauxite:['铝土',3,4]};
  return Object.entries(requested).map(([key,required])=>{
    const [name,index,apiId]=names[key]||[key,-1,-1];
    let value;
    if(Array.isArray(source)){
      const record=source.find(item=>item&&typeof item==='object'&&Number(item.api_id)===apiId);
      value=record?record.api_value:typeof source[index]==='number'?source[index]:undefined;
    }else value=source?.[key];
    const known=value!==undefined&&Number.isFinite(Number(value));
    return {label:`${name}≥${required}（领取消耗）`,required,...known?{actual:Number(value)}:{},status:known?Number(value)>=required?'met':'unmet':'unknown'};
  });
}

// This function checks a draft against requirements. It neither tracks quest
// completion nor promises that the next sortie/expedition will succeed.
function listRelatedQuests({state,mapId,missionId,slots=[],deckId,questState,now=Date.now()}={}){
  const snapshot=taskSnapshot(state,questState);
  if(!snapshot.known)return {status:'unknown',tasks:[]};
  const tasks=[],seen=new Set();
  for(const live of snapshot.tasks){
    if(!live||![1,2].includes(Number(live.api_state))||seen.has(Number(live.api_no)))continue;
    const definition=findDefinition(live,now);
    if(!definition)continue;
    const entries=definition.goals.map(goal=>({goal,relation:relation(goal,{mapId,missionId})}));
    const related=entries.filter(entry=>entry.relation!==false);
    if(!related.length)continue;
    seen.add(Number(live.api_no));
    const evaluation=evaluateFleetRequirements(definition.fleet,state,slots,deckId);
    const checks=evaluation.checks.concat(resourcesChecks(definition,state));
    if(related.some(entry=>entry.relation==='unknown'))checks.push({label:'本海域目标敌舰资料待确认',status:'unknown'});
    const goals=entries.map(({goal,relation})=>({...goal,label:goalLabel(goal,{mapId,missionId}),relatedToCurrent:relation!==false}));
    const completion=definition.completionChecks||[];
    if(completion.some(check=>check.kind==='noRetreatedShips'))goals.push({kind:'noRetreatedShips',label:'到达目标时所需舰娘均未退避'});
    if(completion.some(check=>check.kind==='recheckFleetAtGoal'))goals.push({kind:'recheckFleetAtGoal',label:'到达目标时仍须保持指定编成'});
    tasks.push({id:Number(live.api_no),code:definition.code,title:live.api_title||definition.title,
      state:Number(live.api_state),period:definition.period,source:definition.source,
      summary:goals.map(goal=>goal.label).join('；'),checks,status:statusOf(checks),goals});
  }
  tasks.sort((a,b)=>b.state-a.state||a.id-b.id);
  return {status:'ready',tasks};
}

module.exports={listRelatedQuests,evaluateFleetRequirements};
