'use strict';
// Practice uses the same reviewed Wiki catalogue and identity matching as
// sortie and expedition; live quest availability still comes from the game.
const DATA=require('../../../data/quests/requirements.json');
const events=require('../../../data/quests/limited');
const {createFleetRequirementEvaluator}=require('./fleet_requirements');
const {findDefinition,goalLabel,taskSnapshot}=require('./quest_requirements');
const plain=v=>String(v||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const isPracticeGoal=goal=>['practice','practiceWin'].includes(goal?.kind);
function definitions(now=Date.now()){
 const day=new Date(now+9*60*60*1000).toISOString().slice(0,10);
 return [...DATA.quests.filter(q=>q.category==='C'),...events.filter(e=>day>=e.startDate&&(!e.endDate||day<=e.endDate)).flatMap(e=>e.quests.filter(q=>q.category==='C'))];
}
function resolvePracticeCodes(codes,now=Date.now()){
 if(!Array.isArray(codes)||codes.some(x=>typeof x!=='string')||new Set(codes).size!==codes.length)throw Error('任务选择无效，请重新选择');
 const all=definitions(now);return codes.map(code=>{
  const matches=all.filter(q=>q.code===code&&q.fleet&&(q.goals||[]).some(isPracticeGoal));
  if(matches.length!==1)throw Error('所选演习任务的编成资料尚未收录，暂无法按任务补全');return matches[0];
 });
}
function listPracticeQuests({state,slots=[],deckId,questState,now=Date.now()}={}){
 const snapshot=taskSnapshot(state,questState);if(!snapshot.known)return {status:'unknown',tasks:[]};
 const evaluate=createFleetRequirementEvaluator(state),seen=new Set(),tasks=[];
 for(const live of snapshot.tasks){const id=Number(live?.api_no);if(Number(live?.api_category)!==3||![1,2].includes(Number(live?.api_state))||seen.has(id))continue;seen.add(id);
  const match=findDefinition(live,now),definition=match?.category==='C'?match:null;
  const supported=!!(definition?.fleet&&(definition.goals||[]).some(isPracticeGoal));
  const evaluation=supported?evaluate(definition.fleet,slots,deckId):{status:'unknown',checks:[{label:'任务编成资料尚未收录',status:'unknown'}]};
  const label=Number(live.api_label_type),period=definition?.period||(label>=101&&label<=112?'yearly':({1:'once',2:'daily',3:'weekly',6:'monthly',7:'quarterly'})[label]);
  const goals=definition?(definition.goals||[]).map(goal=>({kind:goal.kind,label:`${goal.stage>1?'演习完成后：':''}${goalLabel(goal,{period})}`})):
    [{label:plain(live.api_detail)||'任务目标待确认'}];
  tasks.push({id,code:definition?.code||`P-unknown-${id}`,title:plain(live.api_title),state:Number(live.api_state),period,
    status:evaluation.status,checks:evaluation.checks,goals,supported});
 }
 tasks.sort((a,b)=>b.state-a.state||a.id-b.id);return {status:'ready',tasks};
}
function countPracticeQuests({state,questState}={}){
 const snapshot=taskSnapshot(state,questState);
 if(!snapshot.known||snapshot.complete===false)return {status:'unknown',count:null};
 const ids=new Set(snapshot.tasks.filter(q=>Number(q?.api_category)===3&&[1,2].includes(Number(q.api_state))&&Number(q.api_no)>0).map(q=>Number(q.api_no)));
 return {status:'ready',count:ids.size};
}
module.exports={listPracticeQuests,countPracticeQuests,resolvePracticeCodes};
