'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const base=require('../../src/recommendation/land_base');
const fixture=require('../helpers/workbench_fixture');
function setup(){
 const s=fixture();s.airbaseSync={complete:true};
 const aircraft=(id,type=47,range=8,aa=2,torp=12,asw=0)=>{
  s.info.equips[id]={api_id:id,api_slotitem_id:1000+id,api_level:0,api_alv:0};
  s.const.$equips[1000+id]={api_id:1000+id,api_name:`测试飞机${id}`,api_type:[0,0,type,type],api_distance:range,api_tyku:aa,api_houk:0,api_raig:torp,api_baku:10,api_tais:asw,api_saku:8};
 };
 for(let i=1;i<=16;i++)aircraft(i);
 aircraft(20,48,7,10,0);aircraft(21,49,9,1,0);
 const slots=ids=>ids.map((id,index)=>({api_squadron_id:index+1,api_slotid:id,api_count:id?18:0,api_max_count:18,api_state:id?1:0}));
 s.info.airbase=[{api_area_id:6,api_rid:1,api_action_kind:1,api_distance:{api_base:8,api_bonus:0},api_plane_info:slots([1,0,0,0])},
  {api_area_id:6,api_rid:2,api_action_kind:1,api_distance:{api_base:8,api_bonus:0},api_plane_info:slots([2,0,0,0])},
  {api_area_id:7,api_rid:1,api_action_kind:1,api_plane_info:slots([3,0,0,0])}];
 s.info.ships[1].api_slot=[4,5];return s;
}
test('mixed strike team accepts a lower tier rather than sacrifice all bombers',()=>{
 const s=setup();s.info.ships={};s.info.equips={};s.const.$equips={};
 // Actual enemy I formation shape, including the reconnaissance AA omitted
 // from ordinary fleet air power (46 fleet, 47 base-air).
 for(const [id,name,type,aa] of [[9001,'深海棲艦戦 Mark.II',6,5],[9002,'深海棲艦爆 Mark.II',7,0],
   [9003,'深海棲艦攻 Mark.II',8,0],[9004,'深海棲艦偵察機',10,1]])
   s.const.$equips[id]={api_id:id,api_name:name,api_type:[0,0,type],api_tyku:aa};
 for(let i=1;i<=5;i++){
  s.info.equips[i]={api_id:i,api_slotitem_id:1000+i,api_level:0,api_alv:0};
  s.const.$equips[1000+i]={api_id:1000+i,api_name:`飞机${i}`,api_type:[0,0,i===5?47:48],
   api_distance:8,api_tyku:i===5?2:10,api_houk:0,api_raig:i===5?3:0,api_baku:0,api_tais:0,api_saku:0};
 }
 s.info.airbase=[{api_area_id:6,api_rid:1,api_action_kind:1,api_plane_info:[1,2,3,4].map((id,i)=>
  ({api_squadron_id:i+1,api_slotid:id,api_count:18,api_max_count:18,api_state:1}))}];
 const draft=base.sourceBases(s,'6-5');draft[0].targets=['I','I'];draft[0].targetsLocked=true;draft[0].slots[0].locked=true;
 const start=performance.now(),result=base.recommendLandBases(s,{area:'6-5',routeNodes:['I','M'],bases:draft});
 const reading=base.inspectSquadron(s,result.bases[0]);
 assert(performance.now()-start<3000);assert.deepEqual(result.bases[0].targets,['I','I']);
 assert.equal(result.bases[0].slots[0].itemId,1);assert(reading.range>=3);
 assert(reading.slots.some(slot=>slot.itemId===5));assert(reading.airPower.min>47/3);
 assert(reading.airPower.min<47*3,'the bombers remain useful even when four fighters would reach a higher tier');
 // The preference is not allowed to invent reach or a known air state.
 s.const.$equips[1005].api_distance=1;
 let fallback=base.recommendLandBases(s,{area:'6-5',routeNodes:['I'],bases:draft});
 assert(!fallback.bases[0].slots.some(slot=>slot.itemId===5));
 s.const.$equips[1005].api_distance=8;delete s.const.$equips[9004];
 fallback=base.recommendLandBases(s,{area:'6-5',routeNodes:['I'],bases:draft});
 assert(!fallback.bases[0].slots.some(slot=>slot.itemId===5));
});
test('plane types and capacity distinguish reconnaissance and heavy bombers',()=>{
 assert.equal(base.eligiblePlane({api_type:[0,0,47]}),true);
 assert.equal(base.eligiblePlane({api_type:[0,0,3]}),false);
 assert.equal(base.planeCapacity({api_type:[0,0,49]}),4);
 assert.equal(base.planeCapacity({api_type:[0,0,53]}),9);
 assert.equal(base.planeCapacity({api_type:[0,0,47]}),18);
});
test('recommendation compares actual land-bomber power with carrier torpedo planes',()=>{
 const s=setup();s.info.ships={};s.info.equips={};s.const.$equips={};
 for(let id=1;id<=8;id++){
  const land=id<=4;s.info.equips[id]={api_slotitem_id:1000+id,api_level:0,api_alv:0};
  s.const.$equips[1000+id]={api_id:1000+id,api_name:land?'一式陸攻':'流星改',api_type:[0,0,land?47:8],
   api_distance:8,api_tyku:0,api_raig:land?10:13,api_baku:0,api_tais:0};
 }
 s.info.airbase=[{api_area_id:6,api_rid:1,api_action_kind:0,api_plane_info:[1,2,3,4].map(slot=>
  ({api_squadron_id:slot,api_slotid:0,api_count:0,api_max_count:18,api_state:0}))}];
 const draft=base.sourceBases(s,'6-5');draft[0].targets=['M','M'];draft[0].targetsLocked=true;
 const result=base.recommendLandBases(s,{area:'6-5',routeNodes:['M'],bases:draft});
 assert.deepEqual(result.bases[0].slots.map(slot=>slot.itemId).sort((a,b)=>a-b),[1,2,3,4]);
});
test('a scout fit evaluates its own damage multiplier and does not stack two scouts',()=>{
 const s=setup();s.info.ships={};s.info.equips={};s.const.$equips={};
 for(let id=1;id<=3;id++){
  s.info.equips[id]={api_slotitem_id:1000+id,api_level:0,api_alv:0};
  s.const.$equips[1000+id]={api_name:'一式陸攻',api_type:[0,0,47],api_distance:8,api_tyku:0,api_raig:10,api_baku:12};
 }
 for(const [id,masterId,name] of [[4,480,'Mosquito PR Mk.IV'],[5,312,'二式陸上偵察機(熟練)']]){
  s.info.equips[id]={api_slotitem_id:masterId,api_level:0,api_alv:0};
  s.const.$equips[masterId]={api_name:name,api_type:[0,0,49],api_distance:8,api_tyku:0,api_saku:9};
 }
 s.info.airbase=[{api_area_id:6,api_rid:1,api_action_kind:0,api_plane_info:[1,2,3,4].map(slot=>
  ({api_squadron_id:slot,api_slotid:0,api_count:0,api_max_count:18,api_state:0}))}];
 const draft=base.sourceBases(s,'6-5');draft[0].targets=['M','M'];draft[0].targetsLocked=true;
 const result=base.recommendLandBases(s,{area:'6-5',routeNodes:['M'],bases:draft});
 const selected=result.bases[0].slots.map(slot=>slot.itemId);
 assert(selected.includes(5));assert(!selected.includes(4));
 assert.equal(selected.filter(id=>id>=1&&id<=3).length,3);
});
test('en-route and boss teams both retain three- and four-land-attacker alternatives',()=>{
 const s=setup();s.info.ships={};s.info.equips={};s.const.$equips={};s.airbaseSync={complete:true,relocationsComplete:true};
 const types=[47,47,48,48,47,47,48,48,47,47,47,47,49,49];
 types.forEach((type,index)=>{const id=index+1,masterId=type===49?312:1000+id;
   s.info.equips[id]={api_id:id,api_slotitem_id:masterId,api_level:0,api_alv:7};
   s.const.$equips[masterId]={api_name:type===49?'二式陸上偵察機(熟練)':`飞机${id}`,
     api_type:[0,0,type],api_distance:8,api_tyku:type===48?10:type===47?2:0,api_houk:0,
     api_raig:type===47?12:0,api_baku:type===47?10:0,api_tais:0,api_saku:9};
 });
 const slots=ids=>ids.map((id,i)=>({api_squadron_id:i+1,api_slotid:id,api_count:18,api_max_count:18,api_state:1}));
 s.info.airbase=[{api_area_id:6,api_rid:1,api_action_kind:1,api_distance:8,api_plane_info:slots([1,2,3,4])},
   {api_area_id:6,api_rid:2,api_action_kind:1,api_distance:8,api_plane_info:slots([5,6,7,8])}];
 const draft=base.sourceBases(s,'6-5');draft[0].targets=['M','M'];draft[1].targets=['I','I'];
 const before=JSON.stringify({s,draft}),options={area:'6-5',routeNodes:['B','F','I','M'],bases:draft,scheme:{ships:[]}};
 const plans=base.aircraftAlternatives(s,options);
 const changed=plans.map(plan=>plan.find((b,i)=>JSON.stringify(b.slots)!==JSON.stringify(draft[i].slots)));
 assert.equal(changed[0].rid,2,'en-route team is considered first');
 const swap=plans.find(plan=>plan.every((b,i)=>JSON.stringify(b.slots.map(s=>s.itemId))!==JSON.stringify(draft[i].slots.map(s=>s.itemId))));
 assert(swap,'same-world squadron exchanges are considered alongside warehouse fits');
 const oldIds=draft.flatMap(b=>b.slots.map(slot=>slot.itemId)).sort((a,b)=>a-b);
 assert.deepEqual(swap.flatMap(b=>b.slots.map(slot=>slot.itemId)).sort((a,b)=>a-b),oldIds,'exchange keeps both aircraft');
 assert(swap.flatMap(b=>b.slots).some(slot=>slot.withinBase));
 const broken=structuredClone(swap),replaced=broken[1].slots.find(slot=>slot.planned);replaced.itemId=9;
 assert(!base.validatePlan(s,{...options,bases:broken}).valid,'one-sided borrowing cannot masquerade as an exchange');
 for(const rid of [1,2]){
   const shapes=changed.filter(b=>b?.rid===rid).map(b=>b.slots.map(slot=>s.const.$equips[s.info.equips[slot.itemId]?.api_slotitem_id]?.api_type[2]));
   assert(shapes.some(types=>types.filter(t=>t===47).length===3&&types.includes(48)),`team ${rid}: three attackers and fighter`);
   assert(shapes.some(types=>types.filter(t=>t===47).length===3&&types.includes(49)),`team ${rid}: three attackers and scout`);
   assert(shapes.some(types=>types.filter(t=>t===47).length===4),`team ${rid}: four attackers`);
 }
 for(const plan of plans){
   assert(base.validatePlan(s,{...options,bases:plan}).valid);assert.deepEqual(plan.map(b=>b.targets),[['M','M'],['I','I']]);
   for(const squadron of plan){const ranks=squadron.slots.map(slot=>({47:0,48:1,49:2})[s.const.$equips[s.info.equips[slot.itemId].api_slotitem_id].api_type[2]]);
     assert.deepEqual(ranks,ranks.slice().sort((a,b)=>a-b),'even cross-team candidates follow the requested order');}
 }
 assert.equal(JSON.stringify({s,draft}),before);
 draft[1].slots[2].locked=true;
 for(const plan of base.aircraftAlternatives(s,{...options,bases:draft}))
   assert.equal(plan[1].slots[2].itemId,7,'manually locked aircraft is retained');
 draft[1].slots[2].locked=false;draft[1].targets=['B','I'];s.const.$equips[1005].api_tais=9;
 const split=base.aircraftAlternatives(s,{...options,bases:draft}).filter(plan=>
   JSON.stringify(plan[1].slots)!==JSON.stringify(draft[1].slots));
 assert(split.length>0,'mixed ASW and surface waves can still consider refits');
 for(const plan of split){assert.deepEqual(plan[1].targets,['B','I']);assert(plan[1].slots.some(slot=>slot.itemId===5));}
});
test('inventory excludes fleet and other base donors and nonready owned slots',()=>{
 const s=setup(),rows=base.inventory(s,{area:'6-5',baseRid:1}),ids=rows.map(r=>r.itemId);
 assert(ids.includes(1));assert(ids.includes(6));for(const id of [2,3,4,5])assert(!ids.includes(id));
 s.info.airbase[0].api_plane_info[0].api_state=2;
 assert(!base.inventory(s,{area:'6-5',baseRid:1}).some(row=>row.itemId===1));
 const scheme={ships:[{slots:[6],ex:-1}]};assert(!base.inventory(s,{area:'6-5',baseRid:1,scheme}).some(row=>row.itemId===6));
});
test('an aircraft in the port relocation list is not treated as warehouse stock',()=>{
 const s=setup();s.info.airbaseRelocations=[{itemId:6,startedAt:null}];
 assert(!base.inventory(s,{area:'6-5',baseRid:1}).some(row=>row.itemId===6));
 const draft=base.sourceBases(s,'6-5');draft[0].targets=['M',''];
 draft[0].slots[1]={slotId:2,itemId:6,count:18,maxCount:18,planned:true};
 const check=base.validatePlan(s,{area:'6-5',bases:draft});
 assert.equal(check.valid,false);assert(check.issues.some(issue=>issue.includes('转场中')));
});
test('recommendations use owned aircraft once, prefer reachable boss and retain a locked slot',()=>{
 const s=setup(),draft=base.sourceBases(s,'6-5');draft[0].slots[0].locked=true;
 const before=JSON.stringify(s),result=base.recommendLandBases(s,{area:'6-5',routeNodes:['A','C','M'],bases:draft});
 assert.equal(JSON.stringify(s),before);assert.equal(result.bases.length,2);
 assert.equal(result.bases[0].slots[0].itemId,1);
 assert.deepEqual(result.bases[0].targets,['M','M']);assert.deepEqual(result.bases[1].targets,['M','M']);
 const ids=result.bases.flatMap(b=>b.slots.map(x=>x.itemId).filter(Boolean));assert.equal(new Set(ids).size,ids.length);
 assert(!ids.some(id=>[3,4,5].includes(id)));assert(result.warnings.some(text=>text.includes('转场')));
 for(const squadron of result.bases)assert(base.inspectSquadron(s,squadron).range>=5);
});
test('unknown range or missing base data never invents a reachable proposal',()=>{
 const s=setup();for(const master of Object.values(s.const.$equips))delete master.api_distance;
 for(const b of s.info.airbase)b.api_distance=null;
 const result=base.recommendLandBases(s,{area:'6-5',routeNodes:['M']});
 assert.equal(result.status,'partial');assert(result.warnings.some(text=>text.includes('未找到')));
 assert(result.bases.every(b=>b.targets.length===0));
 const unknown=setup();unknown.info.airbase=[];unknown.airbaseSync={complete:false};
 assert.equal(base.recommendLandBases(unknown,{area:'6-5',routeNodes:['M']}).status,'unknown');
 assert.equal(base.recommendLandBases(unknown,{area:'1-1',routeNodes:['C']}).status,'unavailable');
});
test('unknown slot is not silently treated as an empty slot',()=>{
 const s=setup();delete s.info.airbase[0].api_plane_info[1].api_slotid;
 const result=base.recommendLandBases(s,{area:'6-4',routeNodes:['N']});
 assert.equal(result.bases[0].slots[1].itemId,null);assert.equal(result.bases[0].targets.length,0);
});

test('manual targets stay locked, while automatic targets update with the route',()=>{
 const s=setup(),draft=base.sourceBases(s,'6-5');draft[0].targets=['C','C'];draft[0].targetsLocked=true;
 let result=base.recommendLandBases(s,{area:'6-5',routeNodes:['A','C','M'],bases:draft});
 assert.deepEqual(result.bases[0].targets,['C','C']);
 result=base.recommendLandBases(s,{area:'6-5',routeNodes:['A','M'],bases:draft});
 assert.deepEqual(result.bases[0].targets,['C','C']);assert(result.warnings.some(text=>text.includes('不在所选路线')));
 draft[0].targetsLocked=false;result=base.recommendLandBases(s,{area:'6-5',routeNodes:['A','M'],bases:draft});
 assert.deepEqual(result.bases[0].targets,['M','M']);
});
test('a manually locked unreachable target is preserved and reported',()=>{
 const s=setup(),draft=base.sourceBases(s,'6-5');draft[0].targets=['M','M'];draft[0].targetsLocked=true;
 for(const item of Object.values(s.const.$equips))item.api_distance=2;
 draft[0].range={api_base:2,api_bonus:0};
 const result=base.recommendLandBases(s,{area:'6-5',routeNodes:['M'],bases:draft});
 assert.deepEqual(result.bases[0].targets,['M','M']);assert(result.warnings.some(text=>text.includes('未找到')));
});
test('a submarine node is not recommended without suitable antisubmarine aircraft',()=>{
 const s=setup(),result=base.recommendLandBases(s,{area:'6-5',routeNodes:['B']});
 assert(result.bases.every(b=>b.targets.length===0));assert(result.warnings.some(text=>text.includes('未找到')));
 for(const m of Object.values(s.const.$equips))m.api_tais=8;
 const ready=base.recommendLandBases(s,{area:'6-5',routeNodes:['B']});
 assert.deepEqual(ready.bases[0].targets,['B','B']);
});

test('locked targets preserve empty waves and an intentionally undispatched base',()=>{
 const s=setup(),draft=base.sourceBases(s,'6-5');draft[0].targets=['','M'];draft[0].targetsLocked=true;
 let result=base.recommendLandBases(s,{area:'6-5',routeNodes:['M'],bases:draft});
 assert.deepEqual(result.bases[0].targets,['','M']);
 draft[0].targets=['',''];const original=JSON.stringify(draft[0]);
 result=base.recommendLandBases(s,{area:'6-5',routeNodes:['M'],bases:draft});
 assert.equal(JSON.stringify(result.bases[0]),original);
});
test('unsynchronized bases never make unknown equipment look like free stock',()=>{
 const s=setup();s.airbaseSync={complete:false};
 const ids=base.inventory(s,{area:'6-5',baseRid:1}).map(row=>row.itemId);
 assert.deepEqual(ids,[1]);
});

test('single-base maps can select another usable base when the first cannot be planned',()=>{
 const s=setup();delete s.info.airbase[0].api_plane_info[1].api_slotid;
 const result=base.recommendLandBases(s,{area:'6-4',routeNodes:['N']});
 assert.deepEqual(result.bases[0].targets,[]);assert.deepEqual(result.bases[1].targets,['N','N']);
});
test('more user-locked sorties than the map permits are retained with a clear warning',()=>{
 const s=setup(),draft=base.sourceBases(s,'6-4');for(const b of draft){b.targets=['N','N'];b.targetsLocked=true;}
 const result=base.recommendLandBases(s,{area:'6-4',routeNodes:['N'],bases:draft});
 assert.deepEqual(result.bases.map(b=>b.targets),[['N','N'],['N','N']]);
 assert(result.warnings.some(text=>text.includes('超过海域可出击上限')));
});

test('plan validation accepts a feasible hypothetical fit and enforces map sortie limits',()=>{
 const s=setup(),scheme={fleet:1,ships:[]};
 let result=base.recommendLandBases(s,{area:'6-5',routeNodes:['M'],scheme});
 assert.deepEqual(base.validatePlan(s,{area:'6-5',bases:result.bases,scheme}),{valid:true,issues:[]});
 const draft=base.sourceBases(s,'6-4');for(const b of draft)b.targets=['N','N'];
 const check=base.validatePlan(s,{area:'6-4',bases:draft,scheme});
 assert.equal(check.valid,false);assert(check.issues.some(x=>x.includes('超过海域上限')));
});
test('plan validation rejects duplicates, foreign ownership and missing aircraft',()=>{
 const s=setup(),scheme={fleet:1,ships:[]},draft=base.sourceBases(s,'6-5');
 draft[0].targets=['M',''];
 draft[0].slots[1]={slotId:2,itemId:1,count:18,maxCount:18,planned:true};
 let check=base.validatePlan(s,{area:'6-5',bases:draft,scheme});
 assert.equal(check.valid,false);assert(check.issues.some(x=>x.includes('重复')));
 draft[0].slots[1]={slotId:2,itemId:2,count:18,maxCount:18,planned:true};
 check=base.validatePlan(s,{area:'6-5',bases:draft,scheme});assert(check.issues.some(x=>x.includes('跨队换装须')));
 draft[0].slots[1]={slotId:2,itemId:4,count:18,maxCount:18,planned:true};
 check=base.validatePlan(s,{area:'6-5',bases:draft,scheme});assert(check.issues.some(x=>x.includes('舰队占用')));
 draft[0].slots[1]={slotId:2,itemId:999999,count:18,maxCount:18,planned:true};
 check=base.validatePlan(s,{area:'6-5',bases:draft,scheme});assert(check.issues.some(x=>x.includes('资料不足')));
});
test('plan validation notices current slot changes, transfer and unknown sync',()=>{
 const s=setup(),scheme={fleet:1,ships:[]},draft=base.sourceBases(s,'6-5');draft[0].targets=['M','M'];
 s.info.airbase[0].api_plane_info[0].api_count=17;
 let check=base.validatePlan(s,{area:'6-5',bases:draft,scheme});
 assert.equal(check.valid,false);assert(check.issues.some(x=>x.includes('数量或状态已变化')));
 s.info.airbase[0].api_plane_info[0].api_count=18;s.info.airbase[0].api_plane_info[0].api_state=2;
 check=base.validatePlan(s,{area:'6-5',bases:draft,scheme});assert(check.issues.some(x=>x.includes('尚未就绪')));
 s.airbaseSync={complete:false};draft[0].slots[1]={slotId:2,itemId:6,count:18,maxCount:18,planned:true};
 check=base.validatePlan(s,{area:'6-5',bases:draft,scheme});assert(check.issues.some(x=>x.includes('尚未完整同步')));
});
test('plan validation rejects unknown range and out-of-reach targets',()=>{
 const s=setup(),scheme={fleet:1,ships:[]},draft=base.sourceBases(s,'6-5');draft[0].targets=['M','M'];
 s.const.$equips[1001].api_distance=2;draft[0].range=null;
 let check=base.validatePlan(s,{area:'6-5',bases:draft,scheme});assert(check.issues.some(x=>x.includes('无法抵达')));
 delete s.const.$equips[1001].api_distance;check=base.validatePlan(s,{area:'6-5',bases:draft,scheme});assert(check.issues.some(x=>x.includes('待确认')));
});

test('plan validation rejects an unknown slot or a night-only target',()=>{
 const s=setup(),scheme={fleet:1,ships:[]},draft=base.sourceBases(s,'6-5');draft[0].targets=['J',''];
 let check=base.validatePlan(s,{area:'6-5',bases:draft,scheme});
 assert.equal(check.valid,false);assert(check.issues.some(x=>x.includes('无法确认可发生基地攻击')));
 draft[0].targets=['M',''];draft[0].slots[1].itemId=null;
 check=base.validatePlan(s,{area:'6-5',bases:draft,scheme});assert(check.issues.some(x=>x.includes('资料不足')));
});

test('plan validation does not reuse a stale observed base range',()=>{
 const s=setup(),scheme={fleet:1,ships:[]},draft=base.sourceBases(s,'6-5');draft[0].targets=['M',''];
 s.info.airbase[0].api_distance.api_base=2;
 const check=base.validatePlan(s,{area:'6-5',bases:draft,scheme});
 assert.equal(check.valid,false);assert(check.issues.some(x=>x.includes('航程资料已变化')));
});

test('fighter escort remains a candidate when enemy air power is substantial',()=>{
 const s=setup();for(let i=30;i<34;i++){
  s.info.equips[i]={api_slotitem_id:1000+i,api_level:0,api_alv:7};
  s.const.$equips[1000+i]={api_type:[0,0,48,48],api_name:'长航程战斗机',api_distance:7,api_tyku:16,api_houk:1,api_baku:0,api_raig:0,api_tais:0};
 }
 const result=base.recommendLandBases(s,{area:'6-5',routeNodes:['M']});
 const items=result.bases.flatMap(b=>b.slots.map(slot=>s.const.$equips[s.info.equips[slot.itemId]?.api_slotitem_id]).filter(Boolean));
 assert(items.some(master=>master.api_type[2]===48),'escort fighter is not eliminated by the attack-only shortlist');
});

test('an undispatched squadron with missing or changed slot data does not block forecast',()=>{
 const s=setup(),scheme={fleet:1,ships:[]},draft=base.sourceBases(s,'6-5');draft[0].targets=['M',''];
 draft[1].slots[0].count=null;s.info.airbase[1].api_plane_info[1].api_slotid=null;
 let check=base.validatePlan(s,{area:'6-5',bases:draft,scheme});assert.deepEqual(check,{valid:true,issues:[]});
 s.airbaseSync={complete:false};check=base.validatePlan(s,{area:'6-5',bases:draft,scheme});assert.deepEqual(check,{valid:true,issues:[]});
 draft[1].slots[1]={slotId:2,itemId:1,count:18,maxCount:18,planned:true};
 check=base.validatePlan(s,{area:'6-5',bases:draft,scheme});assert.equal(check.valid,false);
 assert(check.issues.some(x=>x.includes('重复')),'idle base still reserves its claimed equipment');
});

test('6-5 starts with both sorties on Boss and plans a separate defense squadron',()=>{
 const s=setup();s.info.airbase=s.info.airbase.filter(row=>row.api_area_id===6);
 s.info.airbase.push({api_area_id:6,api_rid:3,api_action_kind:0,api_distance:{api_base:8,api_bonus:0},
   api_plane_info:Array.from({length:4},(_,i)=>({api_squadron_id:i+1,api_slotid:0,api_count:0,api_max_count:18,api_state:0}))});
 for(let id=30;id<34;id++){
   s.info.equips[id]={api_id:id,api_slotitem_id:1000+id,api_level:0,api_alv:7};
   s.const.$equips[1000+id]={api_id:1000+id,api_name:'局战',api_type:[0,0,48,48],api_distance:2,api_tyku:8,api_houk:4,api_houm:3};
 }
 const before=JSON.stringify(s),scheme={fleet:1,ships:[]};
 const result=base.recommendLandBases(s,{area:'6-5',routeNodes:['A','C','D','H','M'],scheme});
 const sorties=result.bases.filter(row=>row.targets.some(Boolean)),defense=result.bases.filter(row=>row.mode===2&&row.modePlanned);
 assert.equal(sorties.length,2);assert.equal(defense.length,1);assert(sorties.every(row=>row.mode===1&&row.modePlanned));
 assert(sorties.every(row=>row.targets.join(',')==='M,M'));assert(!sorties.some(row=>row.targets.includes('H')));
 assert(defense[0].slots.some(slot=>s.const.$equips[s.info.equips[slot.itemId]?.api_slotitem_id]?.api_type?.[2]===48));
 const ids=result.bases.flatMap(row=>row.slots.map(slot=>slot.itemId).filter(id=>id>0));
 assert.equal(ids.length,new Set(ids).size);assert.deepEqual(base.validatePlan(s,{area:'6-5',bases:result.bases,scheme}),{valid:true,issues:[]});
 assert.equal(JSON.stringify(s),before);
});

test('defense reservation does not hide aircraft already claimed by a sortie draft',()=>{
 const s=setup();s.info.ships={};s.info.airbase=s.info.airbase.filter(row=>row.api_area_id===6);
 for(const row of s.info.airbase)for(const slot of row.api_plane_info)Object.assign(slot,{api_slotid:0,api_count:0,api_state:0});
 s.info.airbase.push({api_area_id:6,api_rid:3,api_action_kind:0,api_plane_info:Array.from({length:4},(_,i)=>
   ({api_squadron_id:i+1,api_slotid:0,api_count:0,api_max_count:18,api_state:0}))});
 for(const id of Object.keys(s.info.equips))if(![6,7,21].includes(Number(id)))delete s.info.equips[id];
 for(const id of [6,7])Object.assign(s.const.$equips[1000+id],{api_raig:0,api_baku:0,api_tyku:0});
 for(const id of [30,31]){
   s.info.equips[id]={api_id:id,api_slotitem_id:1000+id,api_level:0,api_alv:7};
   s.const.$equips[1000+id]={api_id:1000+id,api_name:`局战${id}`,api_type:[0,0,48,48],api_distance:2,api_tyku:12,api_houk:4,api_houm:3};
 }
 const draft=base.sourceBases(s,'6-5');
 draft[0].slots[0]={slotId:1,itemId:30,count:18,maxCount:18,planned:true};
 draft[0].slots[1]={slotId:2,itemId:21,count:4,maxCount:4,planned:true};
 draft[0].targets=['M','M'];draft[0].targetsLocked=true;
 const result=base.recommendLandBases(s,{area:'6-5',routeNodes:['M'],bases:draft});
 assert.deepEqual(result.bases[0].targets,['M','M']);
 assert(result.bases[0].slots.some(slot=>slot.itemId===30));
 assert(base.inspectSquadron(s,result.bases[0]).range>=5);
 assert(result.bases.some(row=>row.mode===2));
});

test('sparse stock is shared across two teams instead of exhausting it on the first',()=>{
 const s=setup();s.info.ships[1].api_slot=[];
 s.info.airbase=s.info.airbase.filter(row=>row.api_area_id===6);
 for(const row of s.info.airbase)for(const slot of row.api_plane_info)Object.assign(slot,{api_slotid:0,api_count:0,api_state:0});
 for(const id of Object.keys(s.info.equips))if(![6,7,8,9].includes(Number(id)))delete s.info.equips[id];
 const result=base.recommendLandBases(s,{area:'6-5',routeNodes:['A','C','M'],scheme:{fleet:1,ships:[]}});
 const sorties=result.bases.filter(row=>row.targets.some(Boolean));assert.equal(sorties.length,2);
 assert(sorties.every(row=>row.slots.some(slot=>slot.itemId>0)));
 const ids=sorties.flatMap(row=>row.slots.map(slot=>slot.itemId).filter(id=>id>0));assert.equal(ids.length,new Set(ids).size);
});

test('manual targets and locked equipment remain untouched by sorties and defense',()=>{
 const s=setup(),draft=base.sourceBases(s,'6-5');draft[0].targets=['M',''];draft[0].targetsLocked=true;
 draft[0].slots[0].locked=true;draft[1].targets=['',''];draft[1].targetsLocked=true;
 const untouched=JSON.stringify(draft[1]);
 const result=base.recommendLandBases(s,{area:'6-5',routeNodes:['C','M'],bases:draft});
 assert.deepEqual(result.bases[0].targets,['M','']);assert.equal(result.bases[0].slots[0].itemId,1);
 assert.equal(JSON.stringify(result.bases[1]),untouched);
});
test('defense needs available fighters and is prepared for later 6-5 raid stages',()=>{
 const s=setup();s.info.airbase=s.info.airbase.filter(row=>row.api_area_id===6);
 s.info.airbase.push({api_area_id:6,api_rid:3,api_action_kind:0,api_distance:{api_base:8,api_bonus:0},
   api_plane_info:Array.from({length:4},(_,i)=>({api_squadron_id:i+1,api_slotid:0,api_count:0,api_max_count:18,api_state:0}))});
 delete s.info.equips[20];
 let result=base.recommendLandBases(s,{area:'6-5',routeNodes:['A','C','M']});
 assert(!result.bases.some(row=>row.mode===2&&row.modePlanned));assert(result.warnings.some(text=>text.includes('防空战斗机')));
 s.info.equips[20]={api_id:20,api_slotitem_id:1020,api_level:0,api_alv:0};
 s.const.$equips[1020].api_distance=2;
 s.info.maps={65:{api_gauge_type:1,api_required_defeat_count:6,api_defeat_count:1}};
 result=base.recommendLandBases(s,{area:'6-5',routeNodes:['A','C','M']});
 assert(result.bases.some(row=>row.mode===2&&row.modePlanned),'prepare defense before two boss kills');
 assert(result.warnings.some(text=>text.includes('当前血条阶段没有基地空袭')));
 s.info.maps={65:{api_gauge_type:1,api_required_defeat_count:6,api_defeat_count:6}};
 result=base.recommendLandBases(s,{area:'6-5',routeNodes:['A','C','M']});
 assert(result.bases.some(row=>row.mode===2&&row.modePlanned),'retain defense planning after clear');
 assert(result.warnings.some(text=>text.includes('当前血条阶段没有基地空袭')));
});
test('incomplete gauge counters do not incorrectly rule out a base raid',()=>{
 const s=setup();s.info.airbase=s.info.airbase.filter(row=>row.api_area_id===6);
 s.info.airbase.push({api_area_id:6,api_rid:3,api_action_kind:0,api_distance:{api_base:8,api_bonus:0},
   api_plane_info:Array.from({length:4},(_,i)=>({api_squadron_id:i+1,api_slotid:0,api_count:0,api_max_count:18,api_state:0}))});
 s.info.maps={65:{api_gauge_type:1,api_defeat_count:1}};
 s.const.$equips[1020].api_distance=2;
 const result=base.recommendLandBases(s,{area:'6-5',routeNodes:['A','C','M']});
 assert(result.bases.some(row=>row.mode===2&&row.modePlanned));
 assert(!result.warnings.some(text=>text.includes('当前血条阶段没有基地空袭')));
});
test('a reconnaissance-only sortie is not treated as an attacking team',()=>{
 const s=setup();s.info.ships[1].api_slot=[];s.info.airbase=s.info.airbase.filter(row=>row.api_area_id===6);
 for(const row of s.info.airbase)for(const slot of row.api_plane_info)Object.assign(slot,{api_slotid:0,api_count:0,api_state:0});
 for(const id of Object.keys(s.info.equips))if(Number(id)!==21)delete s.info.equips[id];
 const result=base.recommendLandBases(s,{area:'6-5',routeNodes:['C','M'],scheme:{fleet:1,ships:[]}});
 assert(result.bases.every(row=>!row.targets.some(Boolean)));assert(result.warnings.some(text=>text.includes('未找到')));
});
test('fighters can suppress a known enemy air force but cannot attack a node with no known aircraft',()=>{
 const s=setup();s.info.ships[1].api_slot=[];s.info.airbase=s.info.airbase.filter(row=>row.api_area_id===6);
 for(const row of s.info.airbase)for(const slot of row.api_plane_info)Object.assign(slot,{api_slotid:0,api_count:0,api_state:0});
 for(const id of Object.keys(s.info.equips))if(Number(id)!==20)delete s.info.equips[id];
 const scheme={fleet:1,ships:[]};
 const air=base.recommendLandBases(s,{area:'6-5',routeNodes:['C'],scheme});
 assert(air.bases.some(row=>row.targets.includes('C')));
 const noKnownAir=base.recommendLandBases(s,{area:'6-5',routeNodes:['A'],scheme});
 assert(noKnownAir.bases.every(row=>!row.targets.some(Boolean)));
});

test('current 6-5 route risks prioritize F and I rather than the safe submarine node',()=>{
 const s=setup(),draft=base.sourceBases(s,'6-5');
 draft[0].targets=['M','M'];draft[1].targets=['B','B'];
 const diagnostics={journeys:{samples:32},nodes:[{id:'B',visits:32,severe:0},{id:'F',visits:32,severe:8},
   {id:'I',visits:24,severe:16},{id:'J',visits:8,severe:3},{id:'M',visits:5,severe:5}]};
 const before=JSON.stringify({s,draft}),options={area:'6-5',routeNodes:['B','F','I','J','M'],bases:draft,diagnostics};
 const result=base.prioritizeTargets(s,options);
 assert.equal(result.changed,true);assert.deepEqual(result.bases[0].targets,['M','M']);
 assert.deepEqual(result.bases[1].targets,['F','I']);
 assert.equal(JSON.stringify({s,draft}),before,'selection is a pure draft update');
 assert.deepEqual(base.validatePlan(s,{area:'6-5',bases:result.bases,scheme:{ships:[]}}),{valid:true,issues:[]});
});
test('risk-based assignment preserves manual waves, range, Boss coverage and unknown data',()=>{
 const s=setup(),draft=base.sourceBases(s,'6-5');draft[0].targets=['M','M'];draft[1].targets=['B','B'];
 const opt={area:'6-5',routeNodes:['B','F','I','M'],bases:draft,
   diagnostics:{journeys:{samples:32},nodes:[{id:'F',visits:32,severe:8},{id:'I',visits:24,severe:16}]}};
 draft[1].targetsLocked=true;assert.equal(base.prioritizeTargets(s,opt).changed,false);
 delete draft[1].targetsLocked;s.const.$equips[1002].api_distance=2;draft[1].range=null;
 assert.deepEqual(base.prioritizeTargets(s,opt).bases[1].targets,['F','F'],'I requires radius 3');
 assert.equal(base.prioritizeTargets(s,{...opt,diagnostics:null}).changed,false);
 assert.equal(base.prioritizeTargets(s,{...opt,bases:[draft[1]]}).changed,false,'single Boss protection is not invented');
});
test('an ASW-only forward team refits once for the dangerous surface nodes',()=>{
 const s=setup(),rows=s.info.airbase[1].api_plane_info,ids=[2,6,7,8];
 rows.forEach((row,i)=>Object.assign(row,{api_slotid:ids[i],api_state:1,api_count:18}));
 ids.forEach(id=>Object.assign(s.const.$equips[1000+id],{api_raig:0,api_baku:2,api_tyku:0,api_tais:11}));
 const draft=base.sourceBases(s,'6-5');draft[0].targets=['M','M'];draft[1].targets=['B','B'];
 const diagnostics={journeys:{samples:32},nodes:[{id:'B',visits:32,severe:0},
   {id:'F',visits:32,severe:8},{id:'I',visits:24,severe:16},{id:'M',visits:5,severe:5}]};
 const scheme={ships:[]},before=JSON.stringify({s,draft});
 const result=base.prioritizeTargets(s,{area:'6-5',routeNodes:['B','F','I','M'],bases:draft,scheme,diagnostics});
 assert(result.changed);assert.deepEqual(result.bases[0].targets,['M','M']);assert.deepEqual(result.bases[1].targets,['F','I']);
 assert(result.bases[1].slots.some(slot=>s.const.$equips[s.info.equips[slot.itemId]?.api_slotitem_id]?.api_raig>0));
 assert(result.bases[1].slots.some(slot=>s.const.$equips[s.info.equips[slot.itemId]?.api_slotitem_id]?.api_tais>=7),'mixed team also protects the original ASW target');
 assert.deepEqual(result.alternatives.map(rows=>rows[1].targets),[['B','I'],['I','I']]);
 for(const rows of result.alternatives)assert.deepEqual(base.validatePlan(s,{area:'6-5',bases:rows,scheme}),{valid:true,issues:[]});
 assert(result.warnings.some(text=>text.includes('转场')));
 assert.deepEqual(base.validatePlan(s,{area:'6-5',bases:result.bases,scheme}),{valid:true,issues:[]});
 assert.equal(JSON.stringify({s,draft}),before);
});


test('air raid is retained when manually assigned but is not chosen automatically',()=>{
 const s=setup(),draft=base.sourceBases(s,'6-5');
 const auto=base.recommendLandBases(s,{area:'6-5',routeNodes:['G','M'],bases:draft});
 assert(auto.bases.every(row=>!row.targets.includes('G')));
 draft[0].targets=['G','G'];draft[0].targetsLocked=true;
 const manual=base.recommendLandBases(s,{area:'6-5',routeNodes:['G','M'],bases:draft});
 assert.deepEqual(manual.bases[0].targets,['G','G']);
 assert(base.inspectSquadron(s,manual.bases[0]).slots.some(row=>row.type===47));
});
test('unverified air-raid risk does not divert a Boss strike team',()=>{
 const s=setup(),draft=base.sourceBases(s,'6-5');
 draft[0].targets=['M','M'];draft[1].targets=['M','M'];
 const diagnostics={journeys:{samples:32},nodes:[{id:'G',visits:32,severe:25},{id:'M',visits:7,severe:2}]};
 const choice=base.prioritizeTargets(s,{area:'6-5',routeNodes:['G','M'],bases:draft,diagnostics});
 assert.equal(choice.changed,false);assert.deepEqual(choice.bases[1].targets,['M','M']);
});


test('short-ranged interceptors do not crowd reachable Boss attack aircraft out of the beam',()=>{
 const s=setup();s.info.ships={};s.info.airbase=s.info.airbase.filter(row=>row.api_area_id===6);
 for(let id=30;id<70;id++){
   s.info.equips[id]={api_id:id,api_slotitem_id:1000+id,api_level:0,api_alv:7};
   s.const.$equips[1000+id]={api_id:1000+id,api_name:'短航程局战',api_type:[0,0,48,48],
     api_distance:2,api_tyku:20,api_houk:4,api_baku:0,api_raig:0,api_tais:0};
 }
 const r=base.recommendLandBases(s,{area:'6-5',routeNodes:['B','F','I','M'],scheme:{ships:[]}});
 assert.equal(r.bases.filter(b=>b.targets.join(',')==='M,M').length,2);
 for(const b of r.bases){const view=base.inspectSquadron(s,b);assert(view.range>=5);}
});


test('first two squadrons sortie and the unlocked third defends even if it scores higher',()=>{
 const s=setup();s.info.ships={};s.info.airbase=s.info.airbase.filter(b=>b.api_area_id===6);
 s.info.airbase.push({api_area_id:6,api_rid:3,api_action_kind:1,api_distance:{api_base:8,api_bonus:0},
   api_plane_info:Array.from({length:4},(_,i)=>({api_squadron_id:i+1,api_slotid:i===0?16:0,api_count:i===0?18:0,api_max_count:18,api_state:i===0?1:0}))});
 s.const.$equips[1016].api_raig=60;s.const.$equips[1020].api_distance=2;
 const result=base.recommendLandBases(s,{area:'6-5',routeNodes:['B','F','I','M'],scheme:{ships:[]}});
 assert.deepEqual(result.bases.filter(b=>b.targets.some(Boolean)).map(b=>b.rid).sort(),[1,2]);
 assert.equal(result.bases.find(b=>b.rid===3).mode,2);
});
test('when third squadron is locked or absent the two available teams remain dedicated to sorties',()=>{
 const s=setup();s.info.ships={};s.info.airbase=s.info.airbase.filter(b=>b.api_area_id===6);
 const result=base.recommendLandBases(s,{area:'6-5',routeNodes:['F','I','M'],scheme:{ships:[]}});
 assert.deepEqual(result.bases.filter(b=>b.targets.some(Boolean)).map(b=>b.rid).sort(),[1,2]);
 assert(!result.bases.some(b=>b.mode===2&&b.modePlanned));
});
test('a manually assigned third sortie and manually locked modes are preserved',()=>{
 const s=setup();s.info.ships={};s.info.airbase=s.info.airbase.filter(b=>b.api_area_id===6);
 s.info.airbase.push({api_area_id:6,api_rid:3,api_action_kind:0,api_distance:{api_base:8,api_bonus:0},
   api_plane_info:Array.from({length:4},(_,i)=>({api_squadron_id:i+1,api_slotid:0,api_count:0,api_max_count:18,api_state:0}))});
 const draft=base.sourceBases(s,'6-5');draft[2].targets=['M','M'];draft[2].targetsLocked=true;
 draft[1].mode=2;draft[1].modeLocked=true;
 const r=base.recommendLandBases(s,{area:'6-5',routeNodes:['F','I','M'],bases:draft,scheme:{ships:[]}});
 assert.deepEqual(r.bases[2].targets,['M','M']);assert.equal(r.bases[1].mode,2);assert.equal(r.bases[1].modeLocked,true);
});


test('6-4 one squadron can split one wave to an observed en-route risk and one to Boss',()=>{
 const s=setup(),draft=base.sourceBases(s,'6-4');draft[0].targets=['N','N'];draft[0].slots[0].locked=true;
 const diagnostics={journeys:{samples:32},nodes:[{id:'A',visits:32,severe:4},{id:'C',visits:28,severe:12},{id:'N',visits:16,severe:2}]};
 const result=base.prioritizeTargets(s,{area:'6-4',routeNodes:['A','C','N'],bases:draft,scheme:{ships:[]},diagnostics});
 assert.equal(result.changed,true);assert.deepEqual(result.bases[0].targets,['C','N']);
 assert.equal(result.bases[0].slots[0].itemId,draft[0].slots[0].itemId);
 assert.deepEqual(base.validatePlan(s,{area:'6-4',bases:result.bases,scheme:{ships:[]}}),{valid:true,issues:[]});
 assert(result.alternatives.some(plan=>plan[0].targets.join(',')==='A,N'));
});
test('single squadron split respects a locked target and cannot guess an unreachable threat',()=>{
 const s=setup(),draft=base.sourceBases(s,'6-4');draft[0].targets=['N','N'];draft[0].targetsLocked=true;
 const opt={area:'6-4',routeNodes:['C','N'],bases:draft,scheme:{ships:[]},
  diagnostics:{journeys:{samples:32},nodes:[{id:'C',visits:32,severe:15},{id:'N',visits:12,severe:3}]}};
 assert.equal(base.prioritizeTargets(s,opt).changed,false);
 delete draft[0].targetsLocked;opt.routeNodes=['D','N'];opt.diagnostics.nodes[0].id='D';
 assert.equal(base.prioritizeTargets(s,opt).changed,false,'incomplete air-raid combat model remains manual only');
});
