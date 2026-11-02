'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {finalStageNotice}=require('../../src/ui/workbench/workbench_model');
const {routeAirReference}=require('../../src/domain/routes/route_air');
const profile=(area,target,path,encounterStage='before')=>({area,targetNodes:[target],routePaths:[{nodes:path}],encounterStage});

test('final-formation note does not depend on a change in air power',()=>{
  const before=routeAirReference({},'6-3',{examples:[['J']],encounterStage:'before'});
  const final=routeAirReference({},'6-3',{examples:[['J']],encounterStage:'final'});
  assert.equal(before.enemyAirPower,0);assert.equal(final.enemyAirPower,0);
  assert.match(finalStageNotice(profile('6-3','J',['J'])),/斩杀阶段/);
  assert.match(finalStageNotice(profile('6-3','J',['J'],'final')),/当前为斩杀阶段/);
});
test('final-formation note follows the selected route and multi-gauge target',()=>{
  assert.equal(finalStageNotice(profile('1-1','C',['A','C'])), '');
  assert.equal(finalStageNotice(profile('3-5','K',[])), '');
  assert.match(finalStageNotice(profile('7-3','E',['A','C','E'])),/斩杀阶段/);
  assert.equal(finalStageNotice(profile('7-3','P',['E'])), '');
  assert.match(finalStageNotice(profile('7-3','P',['P'])),/斩杀阶段/);
  assert.equal(finalStageNotice(profile('5-6','G',['G'])), '');
  assert.match(finalStageNotice(profile('5-6','Z',['X','Z'])),/斩杀阶段/);
});
