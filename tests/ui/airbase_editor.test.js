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

test('completion rebases unlocked slots to live aircraft and keeps manual choices',()=>{
 const store=require('../helpers/workbench_fixture')();
 const planes=[1,2,3,4].map((id,i)=>({api_squadron_id:i+1,api_slotid:id,api_count:18,api_max_count:18,api_state:1}));
 store.info.airbase=[{api_area_id:6,api_rid:1,api_action_kind:1,api_distance:7,api_plane_info:planes}];
 const draft=editor.observedDraft(store,'6-5');draft[0].targets=['I','M'];draft[0].targetsLocked=true;
 draft[0].slots[0]={...draft[0].slots[0],itemId:100,planned:true};
 draft[0].slots[1]={...draft[0].slots[1],itemId:101,planned:true,locked:true};
 planes[0].api_slotid=5;planes[2].api_count=12;store.info.airbase[0].api_distance=8;
 const before=JSON.stringify({store,draft}),updated=editor.rebaseDraft(store,'6-5',draft);
 assert.equal(updated[0].slots[0].itemId,5);assert.equal(updated[0].slots[2].count,12);
 assert.equal(updated[0].slots[1].itemId,101);assert.equal(updated[0].slots[1].locked,true);
 assert.equal(updated[0].range,null,'a held planned slot requires the range to be recalculated');
 assert.deepEqual(updated[0].targets,['I','M']);assert.equal(updated[0].targetsLocked,true);
 assert.equal(JSON.stringify({store,draft}),before);
});

test('same-world occupied squadrons can be selected and exchanged without relocation',()=>{
 const store=require('../helpers/workbench_fixture')();store.airbaseSync={complete:true,relocationsComplete:true};
 store.info.ships={};store.info.equips={};store.const.$equips={};
 for(let id=1;id<=9;id++){
   store.info.equips[id]={api_id:id,api_slotitem_id:1000+id,api_level:0,api_alv:7};
   store.const.$equips[1000+id]={api_id:1000+id,api_name:`测试飞机${id}`,api_type:[0,0,47],api_distance:8,api_tyku:2,api_raig:10};
 }
 const slots=ids=>ids.map((id,i)=>({api_squadron_id:i+1,api_slotid:id,api_count:18,api_max_count:18,api_state:1}));
 store.info.airbase=[{api_area_id:6,api_rid:1,api_action_kind:1,api_distance:8,api_plane_info:slots([1,2,3,4])},
   {api_area_id:6,api_rid:2,api_action_kind:1,api_distance:8,api_plane_info:slots([5,6,7,8])},
   {api_area_id:7,api_rid:1,api_action_kind:1,api_distance:8,api_plane_info:slots([9,0,0,0])}];
 const draft=editor.observedDraft(store,'6-5');draft[0].targets=['M','M'];draft[1].targets=['I','I'];
 const before=JSON.stringify({store,draft}),options=editor.equipmentOptions(store,'6-5',draft,{ships:[]},1,1);
 assert(options.some(row=>row.id===5),'ready aircraft from the other squadron is selectable');
 assert(!options.some(row=>row.id===9),'another world stays excluded');
 const changed=editor.replaceSlot(store,draft,1,1,5);
 assert.equal(changed[0].slots[0].itemId,5);assert.equal(changed[1].slots[0].itemId,1);
 assert(changed[0].slots[0].withinBase&&changed[1].slots[0].withinBase);
 assert(changed[0].slots[0].locked&&changed[1].slots[0].locked);
 const plan=require('../../src/recommendation/land_base').validatePlan(store,{area:'6-5',bases:changed,scheme:{ships:[]}});
 assert.deepEqual(plan,{valid:true,issues:[]});
 assert(!require('../../src/domain/combat/land_base').inspectSquadron(store,changed[0]).reasons.some(text=>text.includes('转场')));
 assert.equal(JSON.stringify({store,draft}),before);
 draft[1].slots[0].locked=true;
 assert(!editor.equipmentOptions(store,'6-5',draft,{ships:[]},1,1).some(row=>row.id===5));
 assert.throws(()=>editor.replaceSlot(store,draft,1,1,5),/锁定/);
});
