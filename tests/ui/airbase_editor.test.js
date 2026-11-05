'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const editor=require('../../src/ui/workbench/airbase_editor');
const W=require('../../src/ui/workbench/workbench_model');
const P=require('../../src/domain/routes/route_plans');
const {evaluateNormalRoute}=require('../../src/domain/routes/normal_routes');

test('6-5 selectable and automatic targets follow the actual merged-fleet branch',()=>{
 const store=require('../helpers/workbench_fixture')();
 [10,10,3,2,2,2].forEach((type,i)=>{
   const ship=store.info.ships[i+1];store.const.$ships[ship.api_ship_id].api_stype=type;
   ship.api_sakuteki=[1000,1000];
 });
 const route=evaluateNormalRoute(store,{area:'6-5',scheme:{fleet:1,ships:[1,2,3,4,5,6]}});
 const option={key:'merged',paths:[['B','C','D','G','M'],['B','F','I','J','M']]};
 const actual=P.fleetPaths(route,option);assert.deepEqual(actual,[['B','F','I','J','M']]);
 const choices=editor.routeTargets(option,W.mapOverview('6-5').profile,route).map(item=>item.id);
 assert(choices.includes('F'));assert(choices.includes('I'));assert(choices.includes('M'));
 assert(!choices.includes('C'));assert(!choices.includes('G'));
 const bases=[{rid:1,targets:['C','M']},{rid:2,targets:['G','F'],targetsLocked:true}];
 const before=JSON.stringify(bases),restricted=editor.constrainAutoTargets(bases,actual);
 assert.deepEqual(restricted[0].targets,['','M']);
 assert.deepEqual(restricted[1].targets,['G','F'],'manual selections remain visible and separately warned');
 assert.equal(JSON.stringify(bases),before);
 assert.strictEqual(editor.constrainAutoTargets(bases,null),bases,'no inferred path must not mutate the source');
});
