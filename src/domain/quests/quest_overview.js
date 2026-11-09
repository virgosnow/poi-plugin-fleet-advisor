'use strict';
const {taskSnapshot,findDefinition,goalLabel,relation}=require('./quest_requirements');
const {listPracticeQuests}=require('./practice_quests');
const crypto=require('node:crypto');
const data=require('../../../data/quests/requirements.json');
const missions=require('../../../data/expedition_rewards.json').missions;
const guides=require('../../../data/normal_route_guides.json').maps;
const rewardCatalog=require('../../../data/quests/rewards.json').quests;
const eventRewards=require('../../../data/quests/limited/2026-halloween-rewards.json').quests;
const itemNames={1:'高速修复材',2:'高速建造材',3:'开发资材',4:'改修资材',10:'家具箱（小）',11:'家具箱（中）',12:'家具箱（大）',59:'伊良湖'};
const maps=new Set(Object.keys(guides).map(key=>key.split(':')[0]));
const missionNumbers=new Map();
for(const [id,row] of Object.entries(missions)){
  const number=String(id).toUpperCase(),wiki=String(row.wikiId||'').toUpperCase();
  if(!missionNumbers.has(number))missionNumbers.set(number,Number(id));
  if(wiki&&!missionNumbers.has(wiki))missionNumbers.set(wiki,Number(id));
}
const missionId=value=>{
  const key=String(value??'').toUpperCase();
  return missionNumbers.get(key)??null;
};
function mapDestination(area,goal){
  if(!maps.has(area))return null;
  const map=require(`../../../data/normal_routes/${area}.json`);
  const phase=Number.isInteger(Number(goal.phase))&&map.bossPhases?.[`gauge${goal.phase}`]?`gauge${goal.phase}`:undefined;
  const target=goal.kind==='reachNode'&&goal.node?String(goal.node):map.bossNodes?.length?'boss':map.terminalNodes?.[0]||'boss';
  return {kind:'normal',area,target,...(phase?{phase}:{}),label:area};
}
function destinations(goal,category){
  if(category==='D'){
    const ids=goal.anyMissionIds||[goal.missionId];
    if(ids.includes('any'))return [{kind:'expedition',missionId:null,label:'任意远征'}];
    return ids.map(id=>({id,missionId:missionId(id)})).filter(row=>Number.isInteger(row.missionId))
      .map(row=>({kind:'expedition',missionId:row.missionId,label:`${row.id}号远征`}));
  }
  if(goal.anyTargets)return goal.anyTargets.map(target=>mapDestination(String(target.map),{...goal,...target})).filter(Boolean);
  if(goal.map&&goal.map!=='any')return [mapDestination(String(goal.map),goal)].filter(Boolean);
  if(goal.kind==='sinkEnemy'){
    const area=Object.keys(data.enemyTargets||{}).find(id=>maps.has(id)&&relation(goal,{mapId:id})===true);
    return area?[{...mapDestination(area,goal),suggested:true}]:[];
  }
  return [{kind:'normal',area:null,target:null,label:'任意海域'}];
}
function rewardItem(item,state,lookup){
  const kind=Number(item?.api_kind??item?.kind),id=Number(item?.api_mst_id??item?.id),count=Number(item?.api_count??item?.count),level=Number(item?.api_slotitem_level??item?.level??0);
  if(!Number.isSafeInteger(count)||count<=0||!Number.isSafeInteger(level)||level<0||level>10)return null;
  if(item?.name){
    const master=lookup?lookup(item.name):Object.values(state?.const?.$equips||{}).find(row=>row?.api_name===item.name);
    return {name:item.name,count,...level?{level}:{},...master&&Number.isFinite(Number(master.api_type?.[3]))?{iconType:Number(master.api_type[3])}:{}};
  }
  if(kind===18)return {name:'战果',count};
  if(!Number.isSafeInteger(kind)||!Number.isSafeInteger(id)||id<=0)return null;
  const master=kind===12?state?.const?.$equips?.[id]:kind===13?state?.const?.$useitems?.[id]:kind===11?state?.const?.$ships?.[id]:null;
  const fallback={11:'舰娘',12:'装备',13:'道具',14:'家具'}[kind]||'奖励';
  return {name:kind===13&&itemNames[id]||master?.api_name||`${fallback} #${id}`,count,kind,id,...level?{level}:{},
    ...kind===12&&Number.isFinite(Number(master?.api_type?.[3]))?{iconType:Number(master.api_type[3])}:{}};
}
function rewards(live,state,definition,lookup){
  const names=['燃料','弹药','钢材','铝土'],values=live.api_get_material;
  const resources=Array.isArray(values)&&values.length===4&&values.every(n=>Number.isSafeInteger(n)&&n>=0)?
    values.map((amount,index)=>({name:names[index],amount})).filter(row=>row.amount>0):null;
  const entry=definition&&(eventRewards[definition.code]||rewardCatalog[definition.code]);
  const reference=entry&&(!entry.id||entry.id===Number(live.api_no))?entry:null;
  const fixed=(reference?.fixed||[]).map(item=>rewardItem(item,state,lookup)).filter(Boolean);
  const actual=Array.isArray(live.api_select_rewards)&&live.api_select_rewards.length?live.api_select_rewards:null;
  const source=actual||reference?.choices||[];
  const choices=source.filter(Array.isArray).map(group=>group.map(item=>rewardItem(item,state,lookup)).filter(Boolean)).filter(group=>group.length);
  return {resources,fixed,choices,reference:!!reference,choicesFromGame:!!actual,shipBonus:Number(live.api_bonus_flag)===2};
}
function listOverviewQuests({state,questState,now=Date.now()}={}){
  const snapshot=taskSnapshot(state,questState);
  if(!snapshot.known)return {status:'unknown',tasks:[]};
  const seen=new Set(),tasks=[];let equipmentByName;
  const practice=new Map(listPracticeQuests({state,questState:snapshot,now}).tasks.map(task=>[task.id,task]));
  // Build once per current store, only when a reward has a literal name. Do
  // not cache across snapshots: poi may update the master table in place.
  const lookup=name=>{
    if(!equipmentByName){equipmentByName=new Map();for(const row of Object.values(state?.const?.$equips||{}))
      if(row?.api_name&&!equipmentByName.has(row.api_name))equipmentByName.set(row.api_name,row);}
    return equipmentByName.get(name);
  };
  for(const live of snapshot.tasks){
    const id=Number(live?.api_no),status=Number(live?.api_state);
    if(!Number.isInteger(id)||id<=0||status!==2||seen.has(id))continue;
    const definition=findDefinition(live,now);
    const category=definition?.category||({2:'B',3:'C',4:'D'})[Number(live.api_category)];
    if(!['B','C','D'].includes(category))continue;
    seen.add(id);
    const practiceTask=category==='C'?practice.get(id):null;
    const goals=practiceTask?practiceTask.goals.map(goal=>({label:goal.label,known:!!goal.kind,destinations:practiceTask.supported&&['practice','practiceWin'].includes(goal.kind)?[{kind:'practice',label:'演习'}]:[]})):definition?(definition.goals||[]).map(goal=>({key:crypto.createHash('sha256').update(JSON.stringify(goal)).digest('hex'),count:Math.max(1,Number(goal.count)||1),label:goalLabel(goal,{}),destinations:destinations(goal,category)})):
      [{label:String(live.api_detail||'目标资料待收录').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim(),destinations:[]}];
    tasks.push({id,code:practiceTask?.supported?practiceTask.code:definition?.code||null,title:live.api_title||definition?.title||`任务 ${id}`,
      category,state:status,progressFlag:live.api_progress_flag==null?null:Number(live.api_progress_flag),period:practiceTask?.period||definition?.period||null,goals,rewards:rewards(live,state,definition,lookup)});
  }
  tasks.sort((a,b)=>a.id-b.id);
  return {status:'ready',tasks};
}
module.exports={listOverviewQuests,destinations,missionId,rewards};
