'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/workbench_fixture');
const {recommendPractice}=require('../../src/recommendation/practice');
const {resolvePracticeCodes}=require('../../src/domain/quests/practice_quests');
const {createQuestChecker}=require('../../src/recommendation/quest_constraints');
function scenario(){
 const store=fixture(),templateShip=store.info.ships[1],templateMaster=store.const.$ships[1];store.info.ships={};store.const.$ships={};
 const rows=[
  ['Atlanta','atlanta',3,11],['武蔵改二','むさし',9,97],['武蔵','むさし',9,12],['大和改二重','やまと',10,97],['大和','やまと',9,9],
  ['天津風改二','あまつかぜ',2,75],['雪風改','ゆきかぜ',2,98],['時津風改','ときつかぜ',2,60],['初風改','はつかぜ',2,20],['鹿島改','かしま',21,68],['翔鶴改二甲','しょうかく',18,124]
 ];
 rows.forEach(([name,reading,type,level],i)=>{const id=i+1;store.const.$ships[id]={...templateMaster,api_id:id,api_name:name,api_yomi:reading,api_stype:type,api_slot_num:2,api_maxeq:[0,0],api_aftershipid:'0'};
  store.info.ships[id]={...templateShip,api_id:id,api_ship_id:id,api_lv:level,api_locked:1,api_nowhp:30,api_maxhp:30,api_soukou:[20,30],api_slot:[-1,-1],api_onslot:[0,0]};store.const.$shipTypes[type]={api_equip_type:{}};});
 store.const.$ships[100]={api_id:100,api_name:'对手',api_stype:2,api_souk:[10,20]};
 return store;
}
test('Harusame practice recommendation puts her in the flagship position and supplies three named companions',()=>{
 const store=scenario(),forecast=require('../../src/domain/combat/practice_forecast'),resources=require('../../src/domain/combat/practice_resources'),old=[forecast.estimate,resources.estimate];
 ['春雨改二','村雨改二','夕立改二','五月雨改','白露改二'].forEach((name,i)=>{
   const id=20+i;store.const.$ships[id]={...store.const.$ships[6],api_id:id,api_name:name,api_yomi:name};
   store.info.ships[id]={...store.info.ships[6],api_id:id,api_ship_id:id};
 });
 try{
  forecast.estimate=(_s,scheme)=>({status:'estimated',samples:1,rows:[{label:'S',count:1}],xpScenarios:[{rank:'S',ownHp:scheme.ships.map(()=>30),mvpIndex:0}]});
  resources.estimate=()=>({status:'known',fuel:100,ammoDay:100,ammoNight:100,bauxite:{max:0}});
  const result=recommendPractice(store,{fleet:1,capacity:6,slots:Array(6).fill(null),questCodes:['P371'],opponent:{level:120,ships:[{masterId:100,level:118}]}});
  assert.equal(result.scheme.ships[0].id,20);assert(createQuestChecker(store,resolvePracticeCodes(['P371']))(result.scheme));
 }finally{[forecast.estimate,resources.estimate]=old;}
});
test('two practice quests consider a training cruiser and low-level same-family task ships',()=>{
 const store=scenario(),forecast=require('../../src/domain/combat/practice_forecast'),resources=require('../../src/domain/combat/practice_resources'),old=[forecast.estimate,resources.estimate];
 const args={fleet:1,capacity:6,slots:Array(6).fill(null),trainingShipIds:[1],questCodes:['P357','P368'],opponent:{level:120,ships:[{masterId:100,level:118}]}};
 try{
  forecast.estimate=(_s,scheme)=>({status:'estimated',samples:1,rows:[{label:'S',count:1}],xpScenarios:[{rank:'S',ownHp:scheme.ships.map(()=>30),mvpIndex:0}]});
  resources.estimate=()=>({status:'known',fuel:100,ammoDay:100,ammoNight:100,bauxite:{max:0}});
  const result=recommendPractice(store,args),ids=result.scheme.ships.map(x=>x.id);
  assert(createQuestChecker(store,resolvePracticeCodes(args.questCodes))(result.scheme));assert.equal(ids[0],1);
  assert(ids.includes(3),'level 12 Musashi is included');assert(ids.includes(5),'level 9 Yamato is included');assert(ids.includes(10),'Kashima supplies the training bonus');
  assert(!ids.includes(2)&&!ids.includes(4),'avoid using the near-maxed alternatives when success is equivalent');
 }finally{[forecast.estimate,resources.estimate]=old;}
});
test('a trainer is not selected when its candidate loses the exercise',()=>{
 const store=scenario(),forecast=require('../../src/domain/combat/practice_forecast'),resources=require('../../src/domain/combat/practice_resources'),old=[forecast.estimate,resources.estimate];
 const args={fleet:1,capacity:6,slots:Array(6).fill(null),trainingShipIds:[1],questCodes:['P357','P368'],opponent:{level:120,ships:[{masterId:100,level:118}]}};
 try{
  forecast.estimate=(_s,scheme)=>{const rank=scheme.ships.some(x=>x.id===10)?'D':'S';return {status:'estimated',samples:1,rows:[{label:rank,count:1}],xpScenarios:[{rank,ownHp:scheme.ships.map(()=>30),mvpIndex:0}]};};
  resources.estimate=()=>({status:'known',fuel:100,ammoDay:100,ammoNight:100,bauxite:{max:0}});
  const result=recommendPractice(store,args);assert(createQuestChecker(store,resolvePracticeCodes(args.questCodes))(result.scheme));
  assert(!result.scheme.ships.some(x=>x.id===10),'the XP bonus cannot displace a winning fleet');
 }finally{[forecast.estimate,resources.estimate]=old;}
});

test('training-cruiser quest search preserves an explicitly fixed ship and equipment slot',()=>{
 const store=scenario(),forecast=require('../../src/domain/combat/practice_forecast'),resources=require('../../src/domain/combat/practice_resources'),old=[forecast.estimate,resources.estimate];
 const held={id:3,pin:true,slots:[-1,-1],ex:-1,keep:{0:true}};
 const args={fleet:1,capacity:6,slots:[null,held,null,null,null,null],trainingShipIds:[1],questCodes:['P357','P368'],opponent:{level:120,ships:[{masterId:100,level:118}]}};
 try{
  forecast.estimate=(_s,scheme)=>({status:'estimated',samples:1,rows:[{label:'S',count:1}],xpScenarios:[{rank:'S',ownHp:scheme.ships.map(()=>30),mvpIndex:0}]});
  resources.estimate=()=>({status:'known',fuel:100,ammoDay:100,ammoNight:100,bauxite:{max:0}});
  const result=recommendPractice(store,args);assert(createQuestChecker(store,resolvePracticeCodes(args.questCodes))(result.scheme));
  assert.equal(result.scheme.ships[0].id,1);assert.equal(result.scheme.ships[1].id,3);assert.equal(result.scheme.ships[1].slots[0],-1);
  assert(result.scheme.ships.some(x=>x.id===10),'Kashima remains available alongside the held slot');
 }finally{[forecast.estimate,resources.estimate]=old;}
});

test('a fleet that already meets the tasks can still improve by adding a training cruiser',()=>{
 const store=scenario(),forecast=require('../../src/domain/combat/practice_forecast'),resources=require('../../src/domain/combat/practice_resources'),old=[forecast.estimate,resources.estimate];
 store.const.$ships[12]={...store.const.$ships[6],api_id:12,api_name:'练级驱逐',api_yomi:'れんしゅう'};
 store.info.ships[12]={...store.info.ships[6],api_id:12,api_ship_id:12,api_lv:2};
 const fixed=[1,3,5,6,7].map(id=>({id,pin:true,slots:[-1,-1],ex:-1,keep:{}}));
 const args={fleet:1,capacity:6,slots:[...fixed,null],trainingShipIds:[1],questCodes:['P357','P368'],opponent:{level:120,ships:[{masterId:100,level:118}]}};
 try{
  const evaluated=[];forecast.estimate=(_s,scheme)=>{evaluated.push(scheme.ships.map(x=>x.id));return {status:'estimated',samples:1,rows:[{label:'S',count:1}],xpScenarios:[{rank:'S',ownHp:scheme.ships.map(()=>30),mvpIndex:0}]};};
  resources.estimate=()=>({status:'known',fuel:100,ammoDay:100,ammoNight:100,bauxite:{max:0}});
  const result=recommendPractice(store,args);assert(!evaluated[0].includes(10),'the initial fleet already satisfies both quests without the trainer');
  assert(result.scheme.ships.some(x=>x.id===10),'the trainer is compared even when the first fleet meets the quests');
  assert.deepEqual(result.scheme.ships.slice(0,5).map(x=>x.id),[1,3,5,6,7]);
 }finally{[forecast.estimate,resources.estimate]=old;}
});

test('when quests fill every slot, growth search still considers low-level task ships without a trainer',()=>{
 const store=scenario(),forecast=require('../../src/domain/combat/practice_forecast'),resources=require('../../src/domain/combat/practice_resources'),old=[forecast.estimate,resources.estimate];
 const args={fleet:1,capacity:5,slots:Array(5).fill(null),trainingShipIds:[1],questCodes:['P357','P368'],opponent:{level:120,ships:[{masterId:100,level:118}]}};
 try{
  forecast.estimate=(_s,scheme)=>({status:'estimated',samples:1,rows:[{label:'S',count:1}],xpScenarios:[{rank:'S',ownHp:scheme.ships.map(()=>30),mvpIndex:0}]});
  resources.estimate=()=>({status:'known',fuel:100,ammoDay:100,ammoNight:100,bauxite:{max:0}});
  const result=recommendPractice(store,args),ids=result.scheme.ships.map(x=>x.id);
  assert(createQuestChecker(store,resolvePracticeCodes(args.questCodes))(result.scheme));assert.equal(ids.length,5);
  assert(ids.includes(3)&&ids.includes(5),'low-level Musashi and Yamato remain eligible');assert(!ids.includes(10),'no room remains for the trainer');
 }finally{[forecast.estimate,resources.estimate]=old;}
});
