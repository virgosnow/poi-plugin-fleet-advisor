'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {withoutClaimed}=require('../../src/ui/components/quest_selection');
const quests=require('../../data/quests/requirements.json').quests;
test('only explicit claimed task ids clear preselection, including practice unknowns',()=>{
  const quest=quests.find(q=>q.code==='B1'),selected=['B1','P-unknown-991','P368'];
  assert.equal(withoutClaimed(selected,{known:true,complete:false,tasks:[]}),selected);
  assert.equal(withoutClaimed(selected,{known:false,claimedTaskIds:[quest.ids[0]]}),selected);
  assert.deepEqual(withoutClaimed(selected,{known:true,complete:false,claimedTaskIds:[quest.ids[0],991]}),['P368']);
  assert.deepEqual(withoutClaimed(selected,{known:true,complete:true,tasks:[{api_no:368}]}),['P368']);
  assert.deepEqual(withoutClaimed(['P368'],{known:true,complete:true,tasks:[{api_no:368,api_state:3}]}),['P368']);
  assert.equal(withoutClaimed(['unrecognized'],{known:true,complete:true,tasks:[]})[0],'unrecognized');
});
