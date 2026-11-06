'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/workbench_fixture'),F=require('../../src/config/recommendation_filters');
const {recommendPractice,opponentProfile}=require('../../src/recommendation/practice');
function openingRoleFixture(){
 const s=fixture();
 for(const [id,type,fire,torp,asw] of [[1,3,20,20,10],[2,2,25,40,85],[3,11,110,0,0],[4,4,50,90,20],[5,9,120,0,0],[6,9,115,0,0],[7,2,20,30,10],[8,2,20,30,10]]){
  Object.assign(s.const.$ships[id],{api_stype:type,api_slot_num:3,api_maxeq:type===11?[20,15,10]:[0,0,0],api_ctype:1,api_aftershipid:'0'});
  Object.assign(s.info.ships[id],{api_locked:1,api_lv:70,api_slot:[-1,-1,-1],api_onslot:type===11?[20,15,10]:[0,0,0],api_karyoku:[fire,fire],api_raisou:[torp,torp],api_taisen:[asw,asw],api_taiku:[20,20]});
  s.const.$shipTypes[type]={api_equip_type:{2:1,14:1,15:1,...(type===4?{22:1}:{}),6:1,7:1,8:1}};
 }
 for(const [mid,type,name,stat] of [[500,2,'主炮',{api_houg:9}],[501,14,'声呐',{api_tais:12}],[502,15,'爆雷',{api_tais:8}],[503,22,'甲標的 甲型',{api_raig:10}],[504,6,'舰战',{api_tyku:8}],[505,8,'舰攻',{api_raig:8}]]){
  s.const.$equips[mid]={api_id:mid,api_name:name,api_type:[0,0,type,type],...stat};
  for(let n=1;n<=4;n++)s.info.equips[mid*10+n]={api_id:mid*10+n,api_slotitem_id:mid,api_level:0};
 }
 s.const.$ships[100]={api_id:100,api_name:'潜艇',api_stype:13,api_souk:[10,20]};
 s.const.$ships[101]={api_id:101,api_name:'敌战舰',api_stype:9,api_souk:[50,100]};
 return s;
}
test('mixed practice selects a truly equipped opening ASW escort and opening torpedo ship',()=>{
 const s=openingRoleFixture(),forecast=require('../../src/domain/combat/practice_forecast'),original=forecast.estimate;
 const {openingASW}=require('../../src/domain/combat/opening_asw');
 try{
  forecast.estimate=()=>({status:'unknown'});
  const opponent={ships:[{masterId:100},{masterId:101}]};
  const result=recommendPractice(s,{capacity:3,trainingShipIds:[1],opponent}).scheme;
  assert.equal(result.ships[0].id,1,'the explicit training target remains flagship');
  const escort=result.ships.find(e=>e.id===2),torpedo=result.ships.find(e=>e.id===4);
  assert(escort,'a small ASW escort is selected');assert(torpedo,'an opening torpedo hull is selected');
  assert.equal(openingASW(s,{id:2,ship:s.info.ships[2],master:s.const.$ships[2],before:{slots:s.info.ships[2].api_slot,ex:0},after:escort}).eligible,true,JSON.stringify(result));
  assert(torpedo.slots.some(id=>s.const.$equips[s.info.equips[id]?.api_slotitem_id]?.api_type?.[2]===22));
 }finally{forecast.estimate=original;}
});
test('practice does not claim opening ASW when required gear is unavailable',()=>{
 const s=openingRoleFixture(),forecast=require('../../src/domain/combat/practice_forecast'),original=forecast.estimate;
 for(const [id,item] of Object.entries(s.info.equips))if([501,502].includes(item.api_slotitem_id))delete s.info.equips[id];
 try{forecast.estimate=()=>({status:'unknown'});
  const result=recommendPractice(s,{capacity:3,trainingShipIds:[1],opponent:{ships:[{masterId:100},{masterId:101}]}});
  assert.equal(result.scheme.ships.length,3);assert.equal(result.scheme.ships[0].id,1);
  const {openingASW}=require('../../src/domain/combat/opening_asw');
  assert(!result.scheme.ships.some(e=>{const ship=s.info.ships[e.id];return openingASW(s,{id:e.id,ship,master:s.const.$ships[ship.api_ship_id],before:{slots:ship.api_slot,ex:ship.api_slot_ex},after:e}).eligible===true;}));
 }finally{forecast.estimate=original;}
});
test('opening torpedo is preferred over an automatically selected carrier, while a manual carrier is retained',()=>{
 const s=openingRoleFixture(),forecast=require('../../src/domain/combat/practice_forecast'),original=forecast.estimate;
 s.const.$ships[102]={api_id:102,api_name:'敌航母',api_stype:11,api_souk:[20,50]};
 try{forecast.estimate=()=>({status:'unknown'});
  const args={capacity:2,trainingShipIds:[1],opponent:{ships:[{masterId:102}]}};
  assert.deepEqual(recommendPractice(s,args).scheme.ships.map(e=>e.id),[1,4]);
  const manual={id:3,pin:true,slots:[-1,-1,-1],ex:-1,keep:{}};
  assert.deepEqual(recommendPractice(s,{...args,slots:[null,manual]}).scheme.ships.map(e=>e.id),[1,3]);
 }finally{forecast.estimate=original;}
});
test('opening roles do not displace a better or known practice forecast',()=>{
 const s=openingRoleFixture(),forecast=require('../../src/domain/combat/practice_forecast');
 const xp=require('../../src/domain/combat/practice_experience'),resources=require('../../src/domain/combat/practice_resources');
 const originals=[forecast.estimate,xp.estimateFromScenarios,resources.estimate];
 s.const.$ships[102]={api_id:102,api_name:'敌航母',api_stype:11,api_souk:[20,50]};
 const args={capacity:2,trainingShipIds:[1],opponent:{ships:[{masterId:102}]}};
 let roleResult='bad',otherResult='good';
 try{
  forecast.estimate=(_store,scheme,_enemy,{samples})=>{
   const outcome=scheme.ships.some(ship=>ship.id===4)?roleResult:otherResult;
   if(outcome==='unknown')return {status:'unknown'};
   return {status:'estimated',samples,rows:[{label:outcome==='good'?'S':'D',count:samples}],xpScenarios:[]};
  };
  xp.estimateFromScenarios=(_store,scheme)=>({status:'estimated',expectedTotal:scheme.ships.length*100,expectedPerShip:scheme.ships.map(()=>100)});
  resources.estimate=()=>({status:'known',fuel:0,ammoDay:0,ammoNight:0,bauxite:{max:0}});
  assert(!recommendPractice(s,args).scheme.ships.some(ship=>ship.id===4),'a zero-win role fleet must not replace a winning fleet');
  roleResult='unknown';
  assert(!recommendPractice(s,args).scheme.ships.some(ship=>ship.id===4),'an unknown role forecast must not replace a known one');
  roleResult='good';otherResult='good';
  assert(recommendPractice(s,args).scheme.ships.some(ship=>ship.id===4),'comparable winning fleets retain the opening role preference');
  roleResult='good';otherResult='unknown';
  assert(recommendPractice(s,args).scheme.ships.some(ship=>ship.id===4),'a known forecast can replace an unknown one');
 }finally{[forecast.estimate,xp.estimateFromScenarios,resources.estimate]=originals;}
});
test('opening ASW trial does not borrow equipment held by a different manual ship',()=>{
 const s=openingRoleFixture(),forecast=require('../../src/domain/combat/practice_forecast'),original=forecast.estimate;
 for(const [id,item] of Object.entries(s.info.equips))if(item.api_slotitem_id===501&&Number(id)!==5011)delete s.info.equips[id];
 const held={id:1,pin:true,slots:[5011,-1,-1],ex:-1,keep:{0:true}};
 try{forecast.estimate=()=>({status:'unknown'});
  const ships=recommendPractice(s,{capacity:3,trainingShipIds:[],slots:[held],opponent:{ships:[{masterId:100},{masterId:101}]}}).scheme.ships;
  assert.equal(ships[0].slots[0],5011);
  assert.equal(ships.flatMap(e=>e.slots).filter(id=>id===5011).length,1);
 }finally{forecast.estimate=original;}
});
function armorChoiceFixture(armor){
 const s=fixture();for(const id of Object.keys(s.info.ships))if(Number(id)>2)delete s.info.ships[id];
 Object.assign(s.const.$ships[1],{api_name:'测试战舰',api_stype:9});
 Object.assign(s.const.$ships[2],{api_name:'测试轻巡',api_stype:3});
 for(const [id,fire,torpedo] of [[1,130,0],[2,50,80]])Object.assign(s.info.ships[id],{
  api_locked:1,api_lv:80,api_karyoku:[fire,fire],api_raisou:[torpedo,torpedo],api_taiku:[0,0],api_taisen:[0,0]});
 s.const.$ships[100]={api_id:100,api_name:'测试对手',api_stype:9};
 if(armor!==undefined)s.const.$ships[100].api_souk=armor;
 return s;
}
test('practice excludes level 99 only from automatic choices',()=>{
 const store=armorChoiceFixture(60);store.info.ships[1].api_lv=99;store.info.ships[2].api_lv=98;
 const opponent={ships:[{masterId:100,level:80}]};
 assert.deepEqual(recommendPractice(store,{capacity:1,opponent,trainingShipIds:[]}).scheme.ships.map(s=>s.id),[2]);
 assert.deepEqual(recommendPractice(store,{capacity:1,opponent,trainingShipIds:[],slots:[{id:1,slots:[],keep:{}}]}).scheme.ships.map(s=>s.id),[2]);
 assert.equal(recommendPractice(store,{capacity:1,opponent,trainingShipIds:[1]}).scheme.ships[0].id,1);
 assert.equal(recommendPractice(store,{capacity:1,opponent,trainingShipIds:[],slots:[{id:1,slots:[],pin:true}]}).scheme.ships[0].id,1);
 assert.equal(recommendPractice(store,{capacity:1,opponent,slots:[{id:1,slots:[]}]}).scheme.ships[0].id,1);
});
test('married ships have lower automatic priority but remain available and honor manual choices',()=>{
 const store=armorChoiceFixture();store.info.ships[1].api_karyoku=[125,125];store.info.ships[1].api_lv=100;store.info.ships[2].api_lv=80;
 const recommend=args=>recommendPractice(store,{capacity:1,trainingShipIds:[],...args}).scheme.ships[0].id;
 assert.equal(recommend({}),2,'prefer a competitive unmarried ship');
 assert.equal(recommend({slots:[{id:1,slots:[],keep:{}}]}),2,'previous automatic choices are reassessed');
 assert.equal(recommend({slots:[{id:1,slots:[],pin:true}]}),1);
 assert.equal(recommendPractice(store,{capacity:1,trainingShipIds:[1]}).scheme.ships[0].id,1);
 delete store.info.ships[2];assert.equal(recommend({}),1,'married ships remain eligible when needed');
});
test('unknown opponent armour keeps the balanced default rather than assuming a soft target',()=>{
 const forecast=require('../../src/domain/combat/practice_forecast'),original=forecast.estimate;
 try{
  forecast.estimate=()=>({status:'unknown'});
  for(const armor of [undefined,null,[30,null],[30,'unknown'],[30,''],[30,NaN]]){
   const s=armorChoiceFixture(armor),result=recommendPractice(s,{capacity:1,opponent:{ships:[{masterId:100,level:80}]}});
   assert.equal(result.scheme.ships[0].id,1,`incomplete armour ${String(armor)} must not trigger the torpedo preference`);
  }
  const mixed=armorChoiceFixture([30,99]);mixed.const.$ships[101]={api_id:101,api_stype:9};
  assert.equal(recommendPractice(mixed,{capacity:1,opponent:{ships:[{masterId:100},{masterId:101}]}}).scheme.ships[0].id,1,
   'one incomplete opponent prevents treating the entire fleet as lightly armoured');
 }finally{forecast.estimate=original;}
});
test('armour preference varies gradually without a 99/100 discontinuity',()=>{
 const forecast=require('../../src/domain/combat/practice_forecast'),original=forecast.estimate;
 try{
  forecast.estimate=()=>({status:'unknown'});
  for(const [armor,expected] of [[0,2],[49,2],[50,2],[99,2],[100,2],[149,1],[150,1],[200,1]]){
   const s=armorChoiceFixture([0,armor]);
   const result=recommendPractice(s,{capacity:1,opponent:{ships:[{masterId:100,level:80}]}});
   assert.equal(result.scheme.ships[0].id,expected,`unexpected candidate for armour ${armor}`);
  }
 }finally{forecast.estimate=original;}
});
test('opponents retain both torpedo and balanced candidates for battle comparison',()=>{
 const forecast=require('../../src/domain/combat/practice_forecast'),xp=require('../../src/domain/combat/practice_experience');
 const resources=require('../../src/domain/combat/practice_resources');
 const originals=[forecast.estimate,xp.estimateFromScenarios,resources.estimate];let evaluated=[];
 try{
  forecast.estimate=(_store,scheme)=>{
   const id=scheme.ships[0].id;evaluated.push(id);const label=id===1?'S':'D';
   return {status:'estimated',samples:1,rows:[{label,count:1}],xpScenarios:[{rank:label,ownHp:[30],mvpIndex:0}]};
  };
  xp.estimateFromScenarios=()=>({status:'estimated',expectedTotal:100,expectedPerShip:[100]});
  resources.estimate=()=>({status:'known',fuel:0,ammoDay:0,ammoNight:0,bauxite:{max:0}});
  for(const armor of [50,99,100,150,200]){
   evaluated=[];const s=armorChoiceFixture([30,armor]);
   const result=recommendPractice(s,{capacity:1,opponent:{ships:[{masterId:100,level:80}]}});
   assert.equal(result.scheme.ships[0].id,1,'the simulated stronger candidate should win');
   assert(evaluated.includes(1),'balanced battleship candidate must reach the forecast');
   assert(evaluated.includes(2),'low-cost alternative must remain available for comparison');
  }
  forecast.estimate=(_store,scheme)=>{
   evaluated.push(scheme.ships[0].id);
   return {status:'estimated',samples:1,rows:[{label:'S',count:1}],xpScenarios:[{rank:'S',ownHp:[30],mvpIndex:0}]};
  };
  resources.estimate=(_store,scheme)=>({status:'known',fuel:scheme.ships[0].id===1?100:10,ammoDay:0,ammoNight:0,bauxite:{max:0}});
  const viable=armorChoiceFixture([30,99]);
  assert.equal(recommendPractice(viable,{capacity:1,opponent:{ships:[{masterId:100,level:80}]}}).scheme.ships[0].id,2,
   'the lower-consumption candidate remains preferred when both perform equally');
  evaluated=[];
  forecast.estimate=(_store,scheme)=>{evaluated.push(scheme.ships[0].id);return {status:'unknown'};};
  const s=armorChoiceFixture([30,99]);
  assert.equal(recommendPractice(s,{capacity:1,opponent:{ships:[{masterId:100,level:80}]}}).scheme.ships[0].id,2,
   'an unavailable forecast retains the original torpedo-oriented candidate');
 }finally{[forecast.estimate,xp.estimateFromScenarios,resources.estimate]=originals;}
});
test('practice defaults are independent and keep lower-level unremodeled ships eligible',()=>{
 const s=fixture();s.info.ships[1].api_lv=10;s.info.ships[1].api_locked=0;s.const.$ships[1].api_aftershipid='2';
 assert.deepEqual(F.evaluator(s,'practice')(1),['未锁定'],'unlocked ships are excluded by default');
 assert(F.evaluator(s,'normal')(1).includes('等级低于 30'));
 assert.equal(F.DEFAULTS.practice.excludeExpedition,true);assert.equal(F.DEFAULTS.practice.excludeRepairing,true);
 assert.equal(F.DEFAULTS.practice.excludeUnlocked,true,'practice excludes unlocked ships by default');
 // A locked ship at low level (no minLevel for practice) should still be included
 s.info.ships[1].api_locked=1;
 const result=recommendPractice(s,{slots:[{id:1,slots:s.info.ships[1].api_slot.slice(),ex:-1,keep:{}}]});
 assert(result.scheme.ships.some(ship=>ship.id===1));assert.equal(result.enemyKnown,false);
 assert.equal(new Set(result.scheme.ships.map(ship=>ship.id)).size,result.scheme.ships.length);
});
test('practice opponent assessment does not claim knowledge for missing ships',()=>{
 const s=fixture();assert.equal(opponentProfile(s,{ships:[{masterId:999999}]}).known,false);
 s.const.$ships[1].api_stype=13;s.const.$ships[2].api_stype=11;
 const known=opponentProfile(s,{ships:[{masterId:1},{masterId:2}]});assert.equal(known.known,true);assert.equal(known.submarines,1);assert.equal(known.carriers,1);
});
test('practice completion handles known surface, mixed and submarine opponents without map route data',()=>{
 for(const types of [[11,2],[11,13],[13,14]]){
  const s=fixture();s.const.$ships[100]={api_id:100,api_stype:types[0]};s.const.$ships[101]={api_id:101,api_stype:types[1]};
  const before=JSON.stringify(s.info),opponent={ships:[{masterId:100},{masterId:101}]};
  const result=recommendPractice(s,{opponent,slots:[{id:1,slots:[-1,-1],ex:-1,keep:{}}]});
  assert.equal(result.enemyKnown,true);assert.equal(result.scheme.ships.length,6);
  assert.equal(result.scheme.ships[0].id,1);assert.equal(JSON.stringify(s.info),before);
 }
});
test('practice anchors one strong ship then fills with low-level growth hulls',()=>{
 const s=fixture();
 [100,90,80,65,56,45,30,25].forEach((strength,index)=>{
  const ship=s.info.ships[index+1];ship.api_karyoku=[strength,strength];ship.api_raisou=[0,0];ship.api_taiku=[0,0];
  ship.api_lv=[98,97,70,60,50,90,1,1][index];
 });
 const ships3=recommendPractice(s,{capacity:3}).scheme.ships.map(ship=>ship.id);
 assert.equal(ships3[0],1,'strongest ship is the anchor');
 assert(!ships3.includes(7),'very weak ship below the 35% floor is not chosen');
 assert.deepEqual(recommendPractice(s).scheme,recommendPractice(s,{capacity:6}).scheme,'omitting capacity uses the default of 6');
});
test('practice recommendation does not promote a special-attack flagship or rearrange its partners',()=>{
 const setup=name=>{
  const s=fixture();
  s.const.$ships[3].api_name=name;s.const.$ships[3].api_stype=8;
  [100,95,90,85,80,75,70,65].forEach((fire,index)=>{
   const ship=s.info.ships[index+1];ship.api_karyoku=[fire,fire];ship.api_raisou=[0,0];ship.api_taiku=[0,0];
  });
  return s;
 };
 const standard=setup('测试战舰'),nelson=setup('Nelson改');
 const opponent={ships:[{masterId:1}]};
 const ordinary=recommendPractice(standard,{goal:'victory',opponent}).scheme;
 const withNelson=recommendPractice(nelson,{goal:'victory',opponent}).scheme;
 assert.deepEqual(withNelson,ordinary,'the special-attack-capable name must not change selection, order or loadout');
 assert.deepEqual(withNelson.ships.map(ship=>ship.id),[1,2,3,4,5,6]);
});
test('practice capacity preserves chosen ships and rejects an overfull draft',()=>{
 const s=fixture(),chosen=id=>({id,slots:s.info.ships[id].api_slot.slice(),ex:-1,keep:{}});
 for(let capacity=1;capacity<=6;capacity++){
  const result=recommendPractice(s,{capacity,slots:[chosen(2)]});
  assert.equal(result.scheme.ships.length,capacity);assert.equal(result.scheme.ships[0].id,2);
 }
 const slots=[chosen(1),chosen(2)],before=JSON.stringify(slots);
 assert.throws(()=>recommendPractice(s,{capacity:1,slots}),/已选 2 艘.*超过.*1 艘/);
 assert.equal(JSON.stringify(slots),before);
 assert.throws(()=>recommendPractice(s,{capacity:0}),/1 至 6/);
});
test('training targets displace optional previous recommendations while keeping manual positions',()=>{
 const s=fixture(),entry=(id,pin=false)=>({id,slots:s.info.ships[id].api_slot.slice(),ex:-1,keep:{},pin});
 const slots=[entry(1),entry(2),entry(3,true),entry(4),entry(5),entry(6)];
 const before=JSON.stringify(slots),result=recommendPractice(s,{slots,trainingShipIds:[7,8]});
 assert.deepEqual(result.scheme.ships.map(ship=>ship.id),[7,8,3,1,2,4]);
 assert.equal(result.scheme.ships[2].id,3);assert.equal(JSON.stringify(slots),before);
 const existing=recommendPractice(s,{slots,trainingShipIds:[5,7]}).scheme.ships.map(ship=>ship.id);
 assert.equal(existing[0],5,'existing unpinned training ship becomes flagship');
 assert.equal(existing[2],3,'manual ship keeps its original position');
 assert(existing.includes(7));assert.equal(new Set(existing).size,6);
});
test('training flagship promotion respects fixed ships and does not mutate the draft',()=>{
 const s=fixture(),entry=(id,pin=false,keep={})=>({id,slots:s.info.ships[id].api_slot.slice(),ex:-1,keep,pin});
 const slots=[entry(1),entry(2),entry(3),entry(4),entry(5),entry(6)];
 const before=JSON.stringify(slots);
 const promoted=recommendPractice(s,{slots,trainingShipIds:[5]}).scheme.ships.map(ship=>ship.id);
 assert.equal(promoted[0],5);assert.equal(promoted.filter(id=>id===5).length,1);
 assert.equal(JSON.stringify(slots),before);
 const fixedFlagship=[entry(1,true),...slots.slice(1)];
 assert.equal(recommendPractice(s,{slots:fixedFlagship,trainingShipIds:[5]}).scheme.ships[0].id,1);
 for(const target of [entry(5,true),entry(5,false,{0:true})]){
  const fixedTarget=slots.slice();fixedTarget[4]=target;
  assert.equal(recommendPractice(s,{slots:fixedTarget,trainingShipIds:[5]}).scheme.ships[4].id,5);
 }
});
test('training targets reject impossible selections while honoring explicit choices',()=>{
 const s=fixture(),entry=id=>({id,slots:s.info.ships[id].api_slot.slice(),ex:-1,keep:{},pin:true});
 assert.throws(()=>recommendPractice(s,{slots:[1,2,3,4,5,6].map(entry),trainingShipIds:[7]}),/共 7 艘.*超过 6 艘/);
 assert.throws(()=>recommendPractice(s,{trainingShipIds:[7,7]}),/不重复/);
 assert.throws(()=>recommendPractice(s,{trainingShipIds:[999]}),/不存在.*不能编入/);
 s.info.ships[7].api_locked=0;
 assert(recommendPractice(s,{trainingShipIds:[7],settings:{excludeUnlocked:true}}).scheme.ships.some(ship=>ship.id===7),
  'an explicitly selected training ship bypasses optional automatic filters');
 s.info.repairs=[{api_ship_id:7}];
 assert.throws(()=>recommendPractice(s,{trainingShipIds:[7]}),/不能编入/);
});

test('pure-submarine practice fills available ASW gear while preserving explicitly held equipment',()=>{
 const s=fixture();for(let i=1;i<=6;i++){
  Object.assign(s.const.$ships[i],{api_stype:2,api_slot_num:3,api_maxeq:[0,0,0]});
  Object.assign(s.info.ships[i],{api_slot:[-1,-1,-1],api_onslot:[0,0,0],api_taisen:[60,60]});
 }
 s.const.$shipTypes[2]={api_equip_type:{1:1,14:1,15:1}};
 for(const [mid,type,stat] of [[500,1,{api_houg:8}],[501,14,{api_tais:12}],[502,15,{api_tais:8}]]){
  s.const.$equips[mid]={api_id:mid,api_name:'装备'+mid,api_type:[0,0,type,type],...stat};
  for(let n=1;n<=6;n++)s.info.equips[mid*10+n]={api_id:mid*10+n,api_slotitem_id:mid,api_level:0};
 }
 s.const.$ships[100]={api_id:100,api_stype:13};
 const held={id:1,pin:true,slots:[5001,-1,-1],ex:-1,keep:{0:true}};
 const result=recommendPractice(s,{opponent:{ships:[{masterId:100,level:80}]},slots:[held],trainingShipIds:[]});
 const types=entry=>entry.slots.map(id=>s.const.$equips[s.info.equips[id]?.api_slotitem_id]?.api_type?.[2]);
 assert.equal(result.scheme.ships[0].slots[0],5001,'manual gun stays held');
 for(const entry of result.scheme.ships){assert(types(entry).includes(14),'each ASW ship receives sonar');assert(types(entry).includes(15),'each ASW ship receives depth gear: '+entry.id+' '+types(entry));}
 assert(result.scheme.ships.slice(1).every(entry=>!types(entry).includes(1)),'automatic pure-ASW slots are not spent on guns');
});

test('practice compares a cheaper viable fleet without changing pinned positions or training targets',()=>{
 const s=fixture(),forecast=require('../../src/domain/combat/practice_forecast'),original=forecast.estimate;
 s.const.$ships[100]={api_id:100,api_stype:2};
 for(let i=1;i<=8;i++){
  const heavy=i<=3;Object.assign(s.const.$ships[i],{api_fuel_max:heavy?250:20,api_bull_max:heavy?300:20});
  Object.assign(s.info.ships[i],{api_karyoku:[heavy?100:80,100],api_raisou:[0,0],api_taiku:[0,0],api_lv:80});
 }
 const held={id:1,pin:true,slots:[-1,-1],ex:-1,keep:{0:true}},slots=[null,held,null,null,null,null];
 try{
  // Mock returns uniform S-rank results with xpScenarios so estimateFromScenarios can score variants.
  const mockXp=n=>Array.from({length:n},()=>({rank:'S',ownHp:[30,30,30,30,30,30],mvpIndex:0}));
  forecast.estimate=()=>({status:'estimated',samples:128,rows:[{label:'S',count:128,percent:100}],xpScenarios:mockXp(128)});
  const out=recommendPractice(s,{opponent:{ships:[{masterId:100,level:50}]},slots,trainingShipIds:[8]});
  assert.equal(out.scheme.ships[1].id,1);assert.equal(out.scheme.ships[1].slots[0],-1);
  assert(out.scheme.ships.some(ship=>ship.id===8));
  assert(out.scheme.ships.filter(ship=>ship.id<=3).length<3,'equivalent cheaper fleet avoids unnecessary heavy hulls');
 }finally{forecast.estimate=original;}
});

test('practice can replace one automatic high-level battleship without moving manual or training ships',()=>{
 const s=fixture(),forecast=require('../../src/domain/combat/practice_forecast'),xp=require('../../src/domain/combat/practice_experience');
 const resources=require('../../src/domain/combat/practice_resources'),originals=[forecast.estimate,xp.estimateFromScenarios,resources.estimate];
 s.const.$ships[100]={api_id:100,api_stype:2,api_souk:[10,30]};
 Object.assign(s.const.$ships[2],{api_name:'自动战舰',api_stype:9});
 s.info.ships[2].api_lv=97;s.info.ships[4].api_lv=20;
 for(let i=1;i<=8;i++){s.info.ships[i].api_locked=1;s.info.ships[i].api_karyoku=[i===2?150:i===4?100:40,150];s.info.ships[i].api_raisou=[0,0];s.info.ships[i].api_taiku=[0,0];}
 const slot=(id,pin=false)=>({id,pin,slots:[-1,-1],ex:-1,keep:{}});
 const slots=[slot(1),slot(2),slot(3,true)],args={capacity:3,slots,trainingShipIds:[1],opponent:{ships:[{masterId:100,level:80}]}};
 try{
  let needsBattleship=false;
  forecast.estimate=(_store,scheme)=>{const rank=needsBattleship&&!scheme.ships.some(x=>x.id===2)?'D':'S';
   return {status:'estimated',samples:1,rows:[{label:rank,count:1}],xpScenarios:[{rank,ownHp:[30,30,30],mvpIndex:0}]};};
  xp.estimateFromScenarios=()=>({status:'estimated',expectedTotal:300,expectedPerShip:[100,100,100]});
  resources.estimate=(_store,scheme)=>({status:'known',fuel:scheme.ships.some(x=>x.id===2)?100:10,ammoDay:0,ammoNight:0,bauxite:{max:0}});
  let result=recommendPractice(s,args);
  assert.deepEqual(result.scheme.ships.map(x=>x.id),[1,4,3],'only the automatic battleship should be replaced');
  needsBattleship=true;result=recommendPractice(s,args);
  assert.deepEqual(result.scheme.ships.map(x=>x.id),[1,2,3],'keep the battleship when alternatives cannot win');
  needsBattleship=false;result=recommendPractice(s,{...args,trainingShipIds:[1,2]});
  assert.deepEqual(result.scheme.ships.map(x=>x.id),[1,2,3],'explicit training targets remain mandatory');
 }finally{[forecast.estimate,xp.estimateFromScenarios,resources.estimate]=originals;}
});

test('practice compares a light fleet when multiple automatic battleships are unnecessary',()=>{
 const s=fixture(),forecast=require('../../src/domain/combat/practice_forecast'),xp=require('../../src/domain/combat/practice_experience');
 const resources=require('../../src/domain/combat/practice_resources'),originals=[forecast.estimate,xp.estimateFromScenarios,resources.estimate];
 s.const.$ships[100]={api_id:100,api_stype:2,api_souk:[10,30]};
 for(const id of [2,4]){s.const.$ships[id].api_stype=9;s.info.ships[id].api_lv=97;}
 for(let id=1;id<=8;id++){s.info.ships[id].api_locked=1;s.info.ships[id].api_karyoku=[id===5?120:50,120];s.info.ships[id].api_raisou=[0,0];s.info.ships[id].api_taiku=[0,0];}
 const slot=(id,pin=false)=>({id,pin,slots:[-1,-1],ex:-1,keep:{}});
 const args={capacity:4,slots:[slot(1),slot(2),slot(3,true),slot(4)],trainingShipIds:[1],opponent:{ships:[{masterId:100,level:80}]}};
 try{
  forecast.estimate=()=>({status:'estimated',samples:1,rows:[{label:'S',count:1}],xpScenarios:[{rank:'S',ownHp:[30,30,30,30],mvpIndex:0}]});
  xp.estimateFromScenarios=()=>({status:'estimated',expectedTotal:400,expectedPerShip:[100,100,100,100]});
  resources.estimate=(_store,scheme)=>({status:'known',fuel:scheme.ships.some(x=>[2,4].includes(x.id))?100:10,ammoDay:0,ammoNight:0,bauxite:{max:0}});
  const result=recommendPractice(s,args),ids=result.scheme.ships.map(x=>x.id);
  assert.equal(ids[0],1);assert.equal(ids[2],3);
  assert(!ids.includes(2)&&!ids.includes(4),'the simulated light fleet can replace both automatic battleships');
  assert(ids.includes(5),'the light candidate retains a strong anchor');
 }finally{[forecast.estimate,xp.estimateFromScenarios,resources.estimate]=originals;}
});

test('a new opponent can replace old automatic recommendations while retaining fixed positions and targets',()=>{
 const s=fixture(),forecast=require('../../src/domain/combat/practice_forecast'),original=forecast.estimate;
 s.const.$ships[100]={api_id:100,api_stype:2};
 // Ship 8 is the strongest and lowest-level anchor candidate among free ships.
 for(let id=1;id<=8;id++){const ship=s.info.ships[id];ship.api_karyoku=[id===8?200:50,200];ship.api_taisen=[id===8?200:50,200];ship.api_raisou=[0,0];ship.api_taiku=[0,0];ship.api_lv=id===8?2:60;}
 const entry=id=>({id,slots:[-1,-1],ex:-1,keep:{},pin:false});
 const slots=[{...entry(1),pin:true,keep:{0:true}},entry(2),entry(3),entry(4),entry(5),entry(6)];
 try{
  // Mock returns S for fleets with ship 8 (very low level = high growth xp),
  // D otherwise; simulate drives the variant comparison to pick the fleet with 8.
  forecast.estimate=(store,scheme)=>{const label=scheme.ships.some(x=>x.id===8)?'S':'D';
   return {status:'estimated',samples:128,rows:[{label,count:128}],
     xpScenarios:Array.from({length:128},()=>({rank:label,ownHp:[30,30,30,30,30,30],mvpIndex:0}))};
  };
  for(const type of [2,13]){
   s.const.$ships[100].api_stype=type;
   const result=recommendPractice(s,{opponent:{ships:[{masterId:100,level:50}]},slots,trainingShipIds:[2]});
   assert.equal(result.scheme.ships[0].id,1);assert.equal(result.scheme.ships[0].slots[0],-1);
   assert.equal(result.scheme.ships[1].id,2);assert(result.scheme.ships.some(x=>x.id===8));
  }
 }finally{forecast.estimate=original;}
});

test('mixed practice gives ASW escorts space for sonar while preserving held equipment',()=>{
 const s=fixture(),types=[4,3,9,8,8,9];s.info.ships={};
 types.forEach((type,index)=>{const id=index+1;s.const.$ships[id]={api_id:id,api_name:'舰'+id,api_stype:type,api_slot_num:3,api_maxeq:[0,0,0],api_fuel_max:40,api_bull_max:40};
  s.info.ships[id]={api_id:id,api_ship_id:id,api_lv:80,api_situation:0,api_slot:[-1,-1,-1],api_slot_ex:0,api_onslot:[0,0,0],api_karyoku:[60,60],api_raisou:[30,30],api_taiku:[30,30],api_taisen:[id<=2?80:0,80],api_sakuteki:[30,30]};
  s.const.$shipTypes[type]={api_equip_type:{1:1,2:1,3:1,14:1,15:1,22:1}};
 });
 for(const [mid,type,name,stat] of [[500,2,'主炮',{api_houg:9}],[501,14,'声呐',{api_tais:12}],[502,15,'爆雷',{api_tais:8}],[503,22,'甲標的 甲型',{api_raig:10}]]){
  s.const.$equips[mid]={api_id:mid,api_name:name,api_type:[0,0,type,type],...stat};for(let n=1;n<=6;n++)s.info.equips[mid*10+n]={api_id:mid*10+n,api_slotitem_id:mid,api_level:0};
 }
 s.const.$ships[100]={api_id:100,api_stype:13};s.const.$ships[101]={api_id:101,api_stype:9};
 const slots=types.map((_,i)=>({id:i+1,pin:true,slots:[-1,-1,-1],ex:-1,keep:{}}));slots[0].keep={0:true};slots[0].slots[0]=5031;
 const result=recommendPractice(s,{opponent:{ships:[{masterId:100,level:80},{masterId:100,level:80},{masterId:101,level:80}]},slots,trainingShipIds:[]});
 assert.equal(result.scheme.ships[0].slots[0],5031);
 for(const entry of result.scheme.ships.slice(0,2))assert(entry.slots.some(id=>s.const.$equips[s.info.equips[id]?.api_slotitem_id]?.api_type?.[2]===14),'each ASW escort retains a sonar slot');
});

test('practice quest selection fills a fleet satisfying task requirements and retains manual positions',()=>{
 const s=fixture();for(const [id,name] of [[1,'天津風'],[2,'雪風'],[3,'自由舰三'],[4,'自由舰四'],[5,'自由舰五'],[6,'自由舰六'],[7,'自由舰七'],[8,'自由舰八']])s.const.$ships[id].api_name=name;
 const slot={id:7,pin:true,slots:[-1,-1],ex:-1,keep:{0:true}};
 const result=recommendPractice(s,{slots:[null,null,slot],trainingShipIds:[],questCodes:['P368']});
 assert.equal(result.scheme.ships[2].id,7);assert.equal(result.scheme.ships[2].slots[0],-1);
 assert(result.scheme.ships.some(x=>x.id===1));assert(result.scheme.ships.some(x=>x.id===2));
 const {evaluateFleetRequirements}=require('../../src/domain/quests/fleet_requirements'),{resolvePracticeCodes}=require('../../src/domain/quests/practice_quests');
 assert.equal(evaluateFleetRequirements(resolvePracticeCodes(['P368'])[0].fleet,s,result.scheme.ships,1).status,'met');
});

test('practice quest seeds only use a level 99 task ship when explicitly selected',()=>{
 const s=fixture();for(const [id,name] of [[1,'天津風'],[2,'雪風'],[3,'自由舰三'],[4,'自由舰四'],[5,'自由舰五'],[6,'自由舰六'],[7,'自由舰七'],[8,'自由舰八']])s.const.$ships[id].api_name=name;
 s.info.ships[1].api_lv=99;
 assert.throws(()=>recommendPractice(s,{trainingShipIds:[],questCodes:['P368']}),/未找到/);
 const pinned={id:1,pin:true,slots:[-1,-1],ex:-1,keep:{}};
 assert(recommendPractice(s,{slots:[pinned],trainingShipIds:[],questCodes:['P368']}).scheme.ships.some(ship=>ship.id===1));
 assert(recommendPractice(s,{trainingShipIds:[1],questCodes:['P368']}).scheme.ships.some(ship=>ship.id===1));
});

test('practice rejects unreviewed or impossible selected task constraints',()=>{
 const s=fixture();assert.throws(()=>recommendPractice(s,{questCodes:['P-unknown-999']}),/尚未收录/);
 assert.throws(()=>recommendPractice(s,{questCodes:['P368']}),/未找到.*所选演习任务/);
});

test('a training target may move to satisfy a selected task flagship while manual pins stay fixed',()=>{
 const s=fixture();s.const.$ships[1].api_stype=7;s.const.$ships[2].api_stype=11;
 const target={id:3,slots:[-1,-1],ex:-1,keep:{},pin:false};
 const result=recommendPractice(s,{slots:[target],trainingShipIds:[3],questCodes:['P330']});
 assert([7,11,18].includes(s.const.$ships[s.info.ships[result.scheme.ships[0].id].api_ship_id].api_stype));
 assert(result.scheme.ships.some(ship=>ship.id===3));assert.notEqual(result.scheme.ships[0].id,3);
 assert.throws(()=>recommendPractice(s,{slots:[{...target,pin:true}],trainingShipIds:[3],questCodes:['P330']}),/未找到/);
});
