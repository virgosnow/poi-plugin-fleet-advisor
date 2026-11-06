'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const land=require('../../../src/domain/combat/land_base');
function fixture(){
  const masters={1:{api_name:'一式戦',api_type:[0,0,48],api_tyku:10,api_houk:3,api_distance:5},
    2:{api_name:'一式陸攻',api_type:[0,0,47],api_tyku:3,api_raig:10,api_baku:8,api_tais:9,api_distance:8},
    3:{api_name:'二式陸上偵察機',api_type:[0,0,49],api_tyku:0,api_saku:8,api_distance:9},
    4:{api_name:'東海',api_type:[0,0,47],api_tyku:0,api_raig:0,api_baku:0,api_tais:11,api_distance:8}};
  const equips=Object.fromEntries(Object.keys(masters).map(id=>[Number(id)+100,{api_id:Number(id)+100,api_slotitem_id:Number(id),api_level:0,api_alv:7}]));
  const slots=[1,2,3].map((id,i)=>({slotId:i+1,itemId:id+100,count:id===3?4:18,state:1}));
  return {store:{info:{equips,airbase:[]},const:{$equips:masters}},base:{areaId:6,rid:1,slots,targets:['N','N']}};
}
test('base air power applies interception, scout bonus and scout range extension',()=>{
  const {store,base}=fixture(),result=land.inspectSquadron(store,base);
  assert.equal(result.status,'ready');assert.equal(result.range,7);assert.equal(result.reconMultiplier,1.15);
  const expected=Math.floor((Math.floor((10+1.5*3)*Math.sqrt(18)+22+Math.sqrt(100/10))+
    Math.floor(3*Math.sqrt(18)+Math.sqrt(100/10))+Math.floor(Math.sqrt(100/10)))*1.15);
  assert.equal(result.airPower.min,expected);assert(result.airPower.max>=expected);
});
test('land-based attack power and recon bonuses are separate from air power',()=>{
  const bomber={type:47,torpedo:10,fire:12,stars:0},carrier={type:8,torpedo:13,fire:0,stars:0};
  assert.equal(land.surfacePower(bomber,18),117);
  assert.equal(land.surfacePower(carrier,18),98);
  const standard={type:49,masterId:311,count:4},skilled={type:49,masterId:312,count:4},mosquito={type:49,masterId:480,count:4};
  assert.equal(land.reconAttackMultiplier([standard]),1.125);
  assert.equal(land.reconAttackMultiplier([mosquito]),1.125);
  assert.equal(land.reconAttackMultiplier([standard,skilled,mosquito]),1.15,'multiple scouts do not stack');
  assert.equal(land.reconAttackMultiplier([{...skilled,count:0}]),1);
  assert(land.surfacePower(bomber,18,1.125)>land.surfacePower(bomber,18));
  assert.equal(land.surfacePower({type:53,torpedo:16,fire:0,stars:0},9),73,'heavy land aircraft is not an ordinary land bomber');
});
test('waves use the specific scout attack bonus even when air bonuses match',()=>{
  const bomber={itemId:101,slotId:1,count:18,type:47,aa:0,proficiency:[0,0],torpedo:10,fire:0,asw:0,stars:0};
  const recon={itemId:102,slotId:2,count:4,type:49,masterId:480,aa:0,proficiency:[0,0],stars:0};
  const wave={rid:1,slots:[bomber,recon],reconMultiplier:1.18},powers=[];
  land.simulateWaves([wave],0,[{hp:1000,armor:0}],[1000],()=>0,
    {hitDamage:power=>(powers.push(power),power),applyDamage:(_target,hp,damage)=>hp-damage});
  assert.equal(powers[0],land.surfacePower(bomber,18,1.125));
});
test('reconnaissance aircraft contributes its own AA and proficiency in a base',()=>{
  const {store,base}=fixture();store.const.$equips[3].api_tyku=2;
  const without=land.inspectSquadron(store,{...base,slots:base.slots.slice(0,2)}).airPower.min;
  const withRecon=land.inspectSquadron(store,base).airPower.min;
  assert(withRecon>without+Math.floor(2*Math.sqrt(4)),'base recon AA and proficiency are not dropped');
});
test('base readiness, unknown range and planned replacement remain explicit',()=>{
  const {store,base}=fixture();base.slots[0].state=0;
  assert.equal(land.inspectSquadron(store,base).status,'unknown');
  base.slots[0].state=undefined;assert.equal(land.inspectSquadron(store,base).status,'unknown');
  base.slots[0].planned=true;const planned=land.inspectSquadron(store,base);
  assert.equal(planned.status,'partial');assert.match(planned.reasons.join(),/转场/);
  delete store.const.$equips[1].api_distance;assert.equal(land.inspectSquadron(store,base).range,null);
  base.range=7;assert.equal(land.inspectSquadron(store,base).range,null,'changed loadout cannot reuse old range');
  base.slots[0].planned=false;base.slots[0].state=1;
  assert.equal(land.inspectSquadron(store,base).range,7,'unchanged observed base may use its observed range');
});
test('missing equipment IDs and readiness are unknown, not silently empty slots',()=>{
  const {store,base}=fixture();
  for(const value of [null,undefined,{}]){
    const result=land.inspectSquadron(store,{...base,slots:[value]});
    assert.equal(result.status,'unknown');assert.match(result.reasons.join(),/实例资料不足/);
  }
  const missing=land.inspectSquadron(store,{...base,slots:[{itemId:null,count:18,state:1}]});
  assert.equal(missing.status,'unknown');assert.match(missing.reasons.join(),/实例资料不足/);
  const empty=land.inspectSquadron(store,{...base,slots:[{itemId:0,count:0}],range:5});
  assert.notEqual(empty.status,'unknown','an explicitly empty slot is different from missing data');
});
test('only explicitly assigned reachable waves are applied, and unrelated maps remain unaffected',()=>{
  const {store,base}=fixture();
  assert.equal(land.prepare(store,[base],{area:'1-1',nodeId:'N',nodeKind:'battle',enemyAirPower:10}).status,'none');
  assert.equal(land.prepare(store,[base],{area:'6-4',nodeId:'C',nodeKind:'battle',enemyAirPower:10}).status,'none');
  const ready=land.prepare(store,[base],{area:'6-4',nodeId:'N',nodeKind:'battle',enemyAirPower:78});
  assert.equal(ready.waves.length,2);assert.match(ready.reasons.join(),/参考估算/);
  assert.equal(land.prepare(store,[base],{area:'6-4',nodeId:'N',nodeKind:'battle'}).status,'unknown');
  base.slots[0].state=0;assert.equal(land.prepare(store,[base],{area:'6-4',nodeId:'N',nodeKind:'battle',enemyAirPower:78}).status,'unknown');
});
test('base area, equipment identity and sortie-team limits cannot silently create extra waves',()=>{
  const {store,base}=fixture(),target={area:'6-4',nodeId:'N',nodeKind:'battle',enemyAirPower:78};
  assert.equal(land.prepare(store,[{...base,areaId:7}],target).status,'unknown');
  const duplicate={...base,slots:[base.slots[0],{...base.slots[0],slotId:2}]};
  assert.equal(land.prepare(store,[duplicate],target).status,'unknown');
  const first={...base,targets:['C','C']},second={...base,rid:2,targets:['N','N']};
  assert.equal(land.prepare(store,[first,second],target).status,'none','6-4 allows only the first sortie squadron');
});
test('waves damage enemies before fleet battle and concentrate using the same starting aircraft',()=>{
  const {store,base}=fixture(),prepared=land.prepare(store,[base],{area:'6-4',nodeId:'N',nodeKind:'battle',enemyAirPower:78});
  const hp=[10000],traces=[],state={counts:{}};
  const result=land.simulateWaves(prepared.waves,78,[{hp:10000,armor:0,submarine:false,installation:false}],hp,()=>0,
    {hitDamage:power=>power,applyDamage:(target,health,damage)=>Math.max(0,health-damage),trace:traces,state});
  assert.equal(traces.length,2);assert(hp[0]<10000);assert(result.enemyPower<78);assert(result.remainingRatio<1);
  assert(state.counts['1:2:102']<18,'wave losses persist for later nodes');
  assert(traces.every(row=>row.stage==='landBase'&&row.slot===2));
});
test('enemy fleet AA reduces base attack aircraft but not fighters or reconnaissance',()=>{
  const bomber={itemId:101,slotId:1,count:18,type:47,aa:0,proficiency:[0,0],torpedo:10,fire:0,asw:0,stars:0};
  const fighter={...bomber,itemId:102,slotId:2,type:48};
  const scout={...bomber,itemId:103,slotId:3,type:49};
  const wave={rid:1,slots:[bomber,fighter,scout],reconMultiplier:1};
  const enemy={hp:10000,armor:0,submarine:false,installation:false},state={counts:{}},powers=[];
  const antiAir={status:'known',profiles:[{weighted:400,defense:0,combinedFactor:1}]};
  land.simulateWaves([wave],0,[enemy],[10000],()=>0,{antiAir,state,
    hitDamage:power=>(powers.push(power),power),applyDamage:(_target,hp,damage)=>hp-damage});
  assert.equal(state.counts['1:1:101'],0);
  assert.equal(state.counts['1:2:102'],18);assert.equal(state.counts['1:3:103'],18);
  assert.deepEqual(powers,[],'an intercepted attack slot must not deal damage');
  const unknown={counts:{}};
  land.simulateWaves([wave],0,[enemy],[10000],()=>0,{antiAir:{status:'unknown'},state:unknown,
    hitDamage:power=>power,applyDamage:(_target,hp,damage)=>hp-damage});
  assert.equal(unknown.counts['1:1:101'],18,'unknown AA must not invent a numeric loss');
});
test('concentrated waves restore first-wave losses while dispersed nodes carry them forward',()=>{
  const slot={itemId:101,slotId:1,count:18,type:47,aa:0,proficiency:[0,0],torpedo:10,fire:0,asw:0,stars:0};
  const wave={rid:1,slots:[slot],reconMultiplier:1},foes=[{hp:10000,armor:0,submarine:false,installation:false}];
  const run=(waves,state,powers)=>land.simulateWaves(waves,100,foes,[10000],()=>0,
    {state,hitDamage:power=>(powers.push(power),power),applyDamage:(_target,hp,damage)=>hp-damage});
  const concentrated={counts:{}},concentratedPower=[];
  run([wave,wave],concentrated,concentratedPower);
  assert.equal(concentratedPower.length,2);assert.equal(concentratedPower[0],concentratedPower[1]);
  assert.equal(concentrated.counts['1:1:101'],14,'only the second wave loss persists');
  const dispersed={counts:{}},dispersedPower=[];
  run([wave],dispersed,dispersedPower);assert.equal(dispersed.counts['1:1:101'],14);
  run([wave],dispersed,dispersedPower);assert.equal(dispersed.counts['1:1:101'],11);
  assert(dispersedPower[1]<dispersedPower[0],'the later node receives the remaining aircraft');
});
test('ASW-capable planes can attack submarines and absent ASW capability cannot',()=>{
  const {store,base}=fixture();base.slots=[{slotId:1,itemId:104,count:18,state:1}];
  const view=land.inspectSquadron(store,base),wave={rid:1,slots:view.slots,reconMultiplier:1},hp=[10000],trace=[];
  const enemy={hp:10000,armor:0,submarine:true,installation:false};
  land.simulateWaves([wave],0,[enemy],hp,()=>0,{hitDamage:power=>power,applyDamage:(t,h,d)=>h-d,trace});
  assert.equal(trace[0].phase,'asw');assert(hp[0]<10000);
  wave.slots[0].asw=0;const hp2=[10000];land.simulateWaves([wave],0,[enemy],hp2,()=>0,{hitDamage:power=>power,applyDamage:(t,h,d)=>h-d});
  assert.equal(hp2[0],10000);
  const state={counts:{}};land.simulateWaves([wave],0,[enemy],[10000],()=>0,{hitDamage:power=>power,applyDamage:(t,h,d)=>h-d,state});
  assert.deepEqual(state.counts,{},'no eligible anti-submarine aircraft means no base attack or attrition');
});


test('manually targeting an air raid discloses that enemy ship damage is not fully modeled',()=>{
 const {store,base}=fixture();base.targets=['G','G'];
 const result=land.prepare(store,[base],{area:'6-5',nodeId:'G',nodeKind:'aerialRaid',enemyAirPower:100});
 assert.equal(result.waves.length,2);assert(result.reasons.some(reason=>reason.includes('对敌舰伤害尚未完整建模')));
});
