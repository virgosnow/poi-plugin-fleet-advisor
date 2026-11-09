'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fixture=require('../../helpers/workbench_fixture');
const {listPracticeQuests,countPracticeQuests,resolvePracticeCodes}=require('../../../src/domain/quests/practice_quests');
test('practice tasks show observed entries, known conditions, periods and unknown tasks honestly',()=>{
 const state=fixture(),questState={known:true,complete:true,tasks:[
  {api_no:330,api_category:3,api_state:2,api_title:'空母機動部隊、演習始め！'},
  {api_no:999999,api_category:3,api_state:1,api_title:'未收录',api_detail:'<b>演習</b> 任務',api_label_type:2},
  {api_no:330,api_category:3,api_state:2}, {api_no:342,api_category:3,api_state:3}, {api_no:400,api_category:4,api_state:2}
 ]};
 const answer=listPracticeQuests({state,slots:[],deckId:1,questState});assert.equal(answer.tasks.length,2);
 assert.equal(answer.tasks[0].code,'P330');assert.equal(answer.tasks[0].period,'quarterly');assert.equal(answer.tasks[0].supported,true);
 assert.equal(answer.tasks[0].status,'unmet');assert.match(answer.tasks[0].goals[0].label,/演习胜利 4次/);
 assert.equal(answer.tasks[1].code,'P-unknown-999999');assert.equal(answer.tasks[1].status,'unknown');assert.equal(answer.tasks[1].supported,false);assert.equal(answer.tasks[1].goals[0].label,'演習 任務');
 assert.deepEqual(countPracticeQuests({questState}),{status:'ready',count:2});assert.equal(countPracticeQuests({questState:{...questState,complete:false}}).status,'unknown');
 assert.throws(()=>resolvePracticeCodes(['P-unknown-999999']),/尚未收录/);
});
test('current practice quest catalog contains reviewed definitions for observed tasks',()=>{
 const ids=[302,303,319,323,324,325,327,328,330,332,333,334,335,336,337,338,342,344,345,346,348,350,353,354,355,356,357,360,362,364,365,366,368,371,373,375,377];
 for(const id of ids){const q=resolvePracticeCodes(['P'+id])[0];assert(q.fleet&&q.goals.length,id);}
});
test('seasonal practice quests match both their recycled IDs and live titles',()=>{
 const state=fixture(),questState={known:true,tasks:[{api_no:313,api_category:3,api_state:2,api_title:'秋季大演習'},
   {api_no:326,api_category:3,api_state:2,api_title:'其他限时演习'}]};
 const tasks=listPracticeQuests({state,questState}).tasks;
 assert.equal(tasks[0].code,'P313');assert.equal(tasks[0].period,'limited');assert.match(tasks[0].goals[0].label,/胜利 8次/);
 assert.equal(tasks[1].code,'P-unknown-326');assert.equal(tasks[1].supported,false);
});
test('elite destroyer practice requires four eligible hulls at level 70 or above',()=>{
 const state={const:{$ships:{}},info:{ships:{}}};
 [30,38,30,38,18].forEach((ctype,i)=>{const id=i+1;state.const.$ships[id]={api_id:id,api_name:`驱逐${id}`,api_stype:2,api_ctype:ctype};state.info.ships[id]={api_id:id,api_ship_id:id,api_lv:70};});
 const questState={known:true,tasks:[{api_no:323,api_category:3,api_state:2}]};
 const read=ids=>listPracticeQuests({state,questState,slots:ids.map(id=>({id}))}).tasks[0].status;
 assert.equal(read([1,2,3,4]),'met');assert.equal(read([1,2,3,5]),'unmet');
 state.info.ships[4].api_lv=69;assert.equal(read([1,2,3,4]),'unmet');
});
test('Harusame annual practice requires her as flagship plus three distinct specified companions',()=>{
 const names=['春雨改二','村雨改二','夕立改二','五月雨改','白露改二','時雨改三','涼風改'];
 const state={const:{$ships:{}},info:{ships:{}}};
 names.forEach((name,i)=>{state.const.$ships[i+1]={api_id:i+1,api_name:name,api_stype:2};state.info.ships[i+1]={api_id:i+1,api_ship_id:i+1};});
 const questState={known:true,tasks:[{api_no:371,api_category:3,api_state:2,api_title:'春です！「春雨」、演習しますっ！'}]};
 const read=ids=>listPracticeQuests({state,questState,slots:ids.map(id=>({id}))}).tasks[0];
 assert.equal(read([1,2,3,4]).status,'met');assert.equal(read([2,1,3,4]).status,'unmet');
 assert.equal(read([1,2,3,7]).status,'unmet');assert.equal(read([1,4,5,6]).status,'met');
 assert.equal(read([1,2,3,4]).code,'P371');
});
test('multi-stage practice quests retain later sortie and consumable requirements',()=>{
 const state=fixture(),questState={known:true,tasks:[{api_no:317,api_category:3,api_state:2},
   {api_no:318,api_category:3,api_state:2},{api_no:376,api_category:3,api_state:1}]};
 const tasks=listPracticeQuests({state,questState}).tasks,task=id=>tasks.find(q=>q.id===id);
 assert.equal(task(317).code,'P317');assert.equal(task(317).supported,true);
 assert.equal(task(317).goals.length,5);assert.match(task(317).goals[0].label,/演习S胜 3次/);
 assert.match(task(317).goals[1].label,/演习完成后：2-2 Boss A胜以上/);
 assert(task(317).checks.some(check=>check.label==='第1舰队'));
 assert.equal(task(318).code,'P318');assert.match(task(318).goals[1].label,/战斗粮食 2件（领取时消耗）/);
 assert.equal(task(376).code,'P376');assert.equal(task(376).supported,true);
});
