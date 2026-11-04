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
 const ids=[302,303,330,337,342,345,348,350,353,354,357,360,362,368,373,375];
 for(const id of ids){const q=resolvePracticeCodes(['P'+id])[0];assert(q.fleet&&q.goal,id);}
});
