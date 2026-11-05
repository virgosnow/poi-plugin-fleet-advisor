'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/workbench_fixture'),F=require('../../src/config/recommendation_filters');
const {recommendPractice,opponentProfile}=require('../../src/recommendation/practice');
test('practice defaults are independent and keep lower-level unremodeled unlocked ships eligible',()=>{
 const s=fixture();s.info.ships[1].api_lv=10;s.info.ships[1].api_locked=0;s.const.$ships[1].api_aftershipid='2';
 assert.deepEqual(F.evaluator(s,'practice')(1),[]);assert(F.evaluator(s,'normal')(1).includes('等级低于 30'));
 assert.equal(F.DEFAULTS.practice.excludeExpedition,true);assert.equal(F.DEFAULTS.practice.excludeRepairing,true);
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
test('practice selection by strength and level balance does not choose very weak ships',()=>{
 const s=fixture();
 [100,90,80,65,56,45,30,25].forEach((strength,index)=>{
  const ship=s.info.ships[index+1];ship.api_karyoku=[strength,strength];ship.api_raisou=[0,0];ship.api_taiku=[0,0];
  ship.api_lv=[99,98,70,60,50,90,1,1][index];
 });
 const ships3=recommendPractice(s,{capacity:3}).scheme.ships.map(ship=>ship.id);
 assert.deepEqual(ships3,[1,2,3],'top three by strength fill the fleet by default');
 assert(!ships3.includes(7),'very weak ship must not be chosen solely for its low level');
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
 assert.equal(existing[4],5,'existing training ship keeps its original position');
 assert.equal(existing[2],3,'manual ship keeps its original position');
 assert(existing.includes(7));assert.equal(new Set(existing).size,6);
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

test('a new opponent can replace old automatic recommendations while retaining fixed positions and targets',()=>{
 const s=fixture(),forecast=require('../../src/domain/combat/practice_forecast'),original=forecast.estimate;
 s.const.$ships[100]={api_id:100,api_stype:2};
 for(let id=1;id<=8;id++){const ship=s.info.ships[id];ship.api_karyoku=[id===8?200:50,200];ship.api_taisen=[id===8?200:50,200];ship.api_raisou=[0,0];ship.api_taiku=[0,0];}
 const entry=id=>({id,slots:[-1,-1],ex:-1,keep:{},pin:false});
 const slots=[{...entry(1),pin:true,keep:{0:true}},entry(2),entry(3),entry(4),entry(5),entry(6)];
 try{
  // Mock returns S for fleets with ship 8, D otherwise; xpScenarios let estimateFromScenarios score them.
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
