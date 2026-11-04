'use strict';
// Reviewed practice quest conditions. Unlisted game tasks remain visible but
// cannot be treated as having known composition requirements.
// Source: https://wikiwiki.jp/kancolle/任務/演習任務
const {normalizeName}=require('../../shared/name_matching');
const {createFleetRequirementEvaluator}=require('./fleet_requirements');
const events=require('../../../data/quests/limited');
const type=(...stypeIds)=>({kind:'shipType',stypeIds});
const ship=(name,masterIds)=>({kind:'ship',name,...masterIds?{masterIds}: {}});
const oneOf=(...selectors)=>({anyOf:selectors});
const count=(selector,min,positions)=>({kind:'count',selector,min,scope:'fleetTotal',...positions?{positions}: {}});
const named=(...names)=>names.map(name=>count(ship(name),1));
const flag=selector=>count(selector,1,[1]);
const small=type(1,2),cruiser=type(3,4,21),carrier=type(7,11,18),dd=type(2),heavy=type(5,6),french={kind:'shipClass',name:'法国舰',ctypeIds:[70,79,128,129]};
const task=(id,period,rank,times,rules=[],extra={})=>({id,code:`P${id}`,period,fleet:{uniqueShipFamilies:true,allOf:rules,...extra},goal:`${period==='weekly'?'本周':'本日'}演习${rank||''} ${times}次`});
const DATA=[
 task(301,'once','',1),task(302,'weekly','胜利',20),task(303,'daily','',3),task(304,'daily','胜利',5),
 task(307,'once','胜利',3),task(308,'once','胜利',4),task(309,'once','胜利',4),task(311,'monthly','胜利',7),task(312,'once','胜利',4),task(316,'once','胜利',4),
 task(320,'once','胜利',4,[count(dd,4)]),task(322,'once','胜利',2,[flag(type(1)),count(dd,2)]),
 task(331,'once','A胜以上',3,[flag(type(11,18)),count(type(11,18),2),count(dd,2)]),
 task(339,'quarterly','S胜',3,named('磯波','浦波','綾波','敷波')),
 task(343,'once','胜利',4,[flag(type(11,18)),count(type(11,18),2),count(dd,2)]),
 task(347,'once','S胜',4,[flag(ship('雪風')),count(dd,4)]),
 task(351,'once','A胜以上',4,[flag(ship('最上改二')),count(dd,3)]),
 task(352,'once','S胜',4,[flag(ship('矢矧改二')),count(dd,4)]),
 task(358,'once','S胜',4,[count(ship('Samuel B.Roberts',[561,681,920]),1),count(ship('Johnston'),1),count(ship('Gambier Bay',[544,396,707]),1)]),
 task(372,'yearly','A胜以上',4,[flag({kind:'shipClass',name:'秋月型',ctypeIds:[54]}),count(dd,3),count(type(10),2)]),
 task(330,'quarterly','胜利',4,[flag(carrier),count(carrier,2),count(dd,2)]),
 task(337,'quarterly','S胜',3,named('霞','霰','陽炎','不知火')),
 task(342,'quarterly','A胜以上',4,[count(small,3),count(type(1,2,3,4,21),4)]),
 task(345,'yearly','A胜以上',4,[count(oneOf(...['Warspite','金剛','Ark Royal','Nelson','Jervis','Janus','Javelin'].map(x=>ship(x))),4)]),
 task(348,'yearly','A胜以上',4,[flag(type(3,21)),count(cruiser,3),count(dd,2)]),
 task(350,'yearly','A胜以上',3,named('朧','曙','漣','潮')),
 task(353,'yearly','胜利',5,[flag(heavy),count(heavy,4),count(dd,2)],{sizeExact:6}),
 task(354,'yearly','S胜',4,[flag(ship('Gambier Bay Mk.II',[707])),count({kind:'shipClass',name:'Fletcher级／John C.Butler级',ctypeIds:[91,87]},2)]),
 task(357,'yearly','S胜',3,[...named('大和','武蔵'),count(type(3),1),count(dd,2)]),
 task(360,'once','S胜',5,[flag(oneOf(ship('鳳翔改二',[894]),ship('鳳翔改二戦',[899]))),count(dd,3)]),
 task(362,'yearly','A胜以上',4,named('吹雪','白雪','初雪','深雪')),
 task(368,'yearly','S胜',3,[count(oneOf(...['天津風','雪風','時津風','初風'].map(x=>ship(x))),2)]),
 task(373,'yearly','A胜以上',4,[flag(french),count(french,3)]),
 task(375,'yearly','S胜',4,[...named('比叡','霧島'),count(type(3),1),count(dd,2)])
];
const plain=v=>String(v||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
function definitions(now=Date.now()){
 const day=new Date(now+9*60*60*1000).toISOString().slice(0,10);
 return [...DATA,...events.filter(e=>day>=e.startDate&&(!e.endDate||day<=e.endDate)).flatMap(e=>e.quests.filter(q=>q.category==='C').map(q=>({...q,id:q.ids[0],goal:(q.goals||[]).map(g=>g.kind==='practiceWin'?`本日演习${g.rankMin==='S'?'S胜':g.rankMin==='A'?'A胜以上':'胜利'} ${g.count||1}次`:'目标条件待确认').join('；')})))];
}
function resolvePracticeCodes(codes,now=Date.now()){
 if(!Array.isArray(codes)||codes.some(x=>typeof x!=='string')||new Set(codes).size!==codes.length)throw Error('任务选择无效，请重新选择');
 const all=definitions(now);return codes.map(code=>{const matches=all.filter(q=>q.code===code);if(matches.length!==1)throw Error('所选演习任务的编成资料尚未收录，暂无法按任务补全');return matches[0];});
}
function listPracticeQuests({state,slots=[],deckId,questState,now=Date.now()}={}){
 const snapshot=questState??state?.questState;if(!snapshot?.known||!Array.isArray(snapshot.tasks))return {status:'unknown',tasks:[]};
 const catalog=definitions(now),evaluate=createFleetRequirementEvaluator(state),seen=new Set(),tasks=[];
 for(const live of snapshot.tasks){const id=Number(live?.api_no);if(Number(live?.api_category)!==3||![1,2].includes(Number(live?.api_state))||seen.has(id))continue;seen.add(id);
  const definition=catalog.find(q=>q.id===id&&(!q.requireTitleMatch||normalizeName(q.title||'')===normalizeName(live.api_title||'')));
  const evaluation=definition?evaluate(definition.fleet,slots,deckId):{status:'unknown',checks:[{label:'任务编成资料尚未收录',status:'unknown'}]};
  const label=Number(live.api_label_type),period=definition?.period||(label>=101&&label<=112?'yearly':({1:'once',2:'daily',3:'weekly',6:'monthly',7:'quarterly'})[label]);
  tasks.push({id,code:definition?.code||`P-unknown-${id}`,title:plain(live.api_title),state:Number(live.api_state),period,
    status:evaluation.status,checks:evaluation.checks,goals:[{label:definition?.goal||plain(live.api_detail)||'任务目标待确认'}],supported:!!definition});
 }
 tasks.sort((a,b)=>b.state-a.state||a.id-b.id);return {status:'ready',tasks};
}
function countPracticeQuests({state,questState}={}){
 const snapshot=questState??state?.questState;
 if(!snapshot?.known||!Array.isArray(snapshot.tasks)||snapshot.complete===false)return {status:'unknown',count:null};
 const ids=new Set(snapshot.tasks.filter(q=>Number(q?.api_category)===3&&[1,2].includes(Number(q.api_state))&&Number(q.api_no)>0).map(q=>Number(q.api_no)));
 return {status:'ready',count:ids.size};
}
module.exports={listPracticeQuests,countPracticeQuests,resolvePracticeCodes};
