'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../../helpers/workbench_fixture');
const {estimate,rank,percentages,opponentActor,opponentFormation,playerFormation,recommendFormation,referenceHp}=require('../../../src/domain/combat/practice_forecast');
const own=[{hp:30,initialHp:30}],enemy=Array.from({length:6},()=>({hp:30}));
function equippedFixture(){
 const s=fixture();
 for(const [id,type] of Object.entries({2:1,3:1,15:5,27:12,47:14,213:32}))
  s.const.$equips[id]={api_id:Number(id),api_name:`装备${id}`,api_type:[0,0,type,type],api_houg:Number(id)===3?2:0,api_raig:Number(id)===213?15:0};
 s.const.$shipTypes={2:{api_equip_type:{1:1,5:1,12:1,14:1}},13:{api_equip_type:{5:1,32:1}}};
 return s;
}
test('practice rank applies knockout, flagship and damage rules',()=>{
 assert.equal(rank(own,enemy,[30],[0,0,0,0,0,0]),'SS');
 assert.equal(rank(own,enemy,[20],[0,0,0,0,0,0]),'S');
 assert.equal(rank(own,enemy,[20],[30,30,0,0,0,0]),'A');
 assert.equal(rank(own,enemy,[20],[0,30,30,30,30,30]),'B');
 assert.equal(rank(own,enemy,[29],[30,30,30,30,30,30]),'D');
});
test('rounding preserves the full distribution',()=>{
 const rows=percentages({S:1,A:1,B:1},3);assert.equal(rows.reduce((n,r)=>n+r.percent,0),100);
 assert.deepEqual(rows.map(r=>r.label),['S','A','B']);
 const merged=percentages({SS:1,S:1,A:1},3);
 assert.deepEqual(merged.map(r=>[r.label,r.count,r.percent]),[['S',2,67],['A',1,33]]);
});
test('practice enemy formations obey fleet size, flagship and submarine priority',()=>{
 const ship=stype=>({stype}),normal=[ship(2)],subs=[ship(13),ship(14)];
 assert.equal(opponentFormation(subs,[ship(13),ship(7),ship(7)]),'lineAhead');
 assert.equal(opponentFormation(subs,[ship(7),ship(2),ship(2),ship(2),ship(2)]),'lineAbreast');
 assert.equal(opponentFormation(normal,[ship(13),ship(2),ship(2),ship(2)]),'echelon');
 assert.equal(opponentFormation(normal,[ship(16),ship(2),ship(2),ship(2),ship(2)]),'diamond');
 assert.equal(opponentFormation(normal,[ship(7),ship(2),ship(2),ship(2)]),'lineAhead');
 assert.equal(opponentFormation(normal,[ship(2),ship(2),ship(2),ship(2),ship(2),ship(2)]),'lineAhead');
});
test('all-submarine opponents do not select line abreast with fewer than four friendly ships',()=>{
 const foe=[{submarine:true}],ship={stype:2};
 assert.equal(playerFormation([ship,ship,ship],foe),'lineAhead');
 assert.equal(playerFormation([ship,ship,ship,ship],foe),'lineAbreast');
 assert.equal(playerFormation([ship,ship,ship,ship],[{submarine:false}]),'lineAhead');
});
test('formation recommendation uses only known opponent types and actual fleet size',()=>{
 const s=fixture(),surface={known:true,ships:[{masterId:1}]};s.const.$ships[8].api_stype=13;
 const submarine={known:true,ships:[{masterId:8}]},small={ships:[{id:1},{id:2},{id:3}]},full={ships:[{id:1},{id:2},{id:3},{id:4}]};
 assert.equal(recommendFormation(s,full,submarine),'lineAbreast');
 assert.equal(recommendFormation(s,small,submarine),'lineAhead');
 assert.equal(recommendFormation(s,full,surface),'lineAhead');
 assert.equal(recommendFormation(s,full,{known:true,ships:[{masterId:999}]}),null);
 assert.equal(recommendFormation(s,full,{known:false}),null);
});
test('opponent reference HP uses known wedding bonus and explicit exceptions',()=>{
 const m=(name,hp)=>({api_name:name,api_taik:[hp,hp+10]});
 assert.equal(referenceHp(m('驱逐',29),99),29);
 assert.equal(referenceHp(m('驱逐',29),100),33);
 assert.equal(referenceHp(m('驱逐',30),100),35);
 assert.equal(referenceHp(m('战舰',91),120),100);
 assert.equal(referenceHp(m('大和',93),120),98);
 assert.equal(referenceHp(m('Bismarck drei',96),100),99);
 assert.equal(referenceHp(m('速吸改',48),100),50);
 assert.equal(referenceHp(m('未知',5),100),null);
});
test('assumed equipment modifies opponent panels, night attacks and opening torpedoes',()=>{
 const gun={api_name:'8inch三連装砲 Mk.9',api_type:[0,0,2],api_houg:11,api_souk:0};
 const mini={api_name:'甲標的 甲型',api_type:[0,0,22],api_raig:12};
 const master={api_name:'雷巡',api_stype:4,api_taik:[30,40],api_houg:[10,40],api_raig:[10,50],api_souk:[5,30],api_luck:[20,50]};
 const ship={master,level:80,slots:[{slot:0,master:gun},{slot:1,master:gun},{slot:2,master:mini}]},before=JSON.stringify(ship);
 const actor=opponentActor(ship,1);
 assert.equal(actor.fire,62);assert.equal(actor.torpedo,62);assert.equal(actor.openingTorpedo,true);
 assert.equal(actor.nightMode.multiplier,1.2);assert.equal(actor.nightMode.hits,2);assert.equal(JSON.stringify(ship),before);
 const tube={api_name:'後期型艦首魚雷(6門)',api_type:[0,0,32],api_raig:15};
 const sub=opponentActor({master:{...master,api_stype:13},level:80,slots:[{slot:0,master:tube},{slot:1,master:tube}]},1);
 assert.equal(sub.nightMode.multiplier,1.6);assert.equal(sub.nightMode.hits,2);
});
test('assumed carrier shelling uses bomber and torpedo-plane stats only with a live attack slot',()=>{
 const m={api_name:'空母',api_stype:11,api_taik:[50,60],api_houg:[0,30],api_raig:[0,0],api_souk:[20,40],api_maxeq:[24,12]};
 const torpedo={api_name:'流星改',api_type:[0,0,8],api_raig:13},bomber={api_name:'彗星一二型甲',api_type:[0,0,7],api_baku:10};
 const actor=opponentActor({master:m,level:50,slots:[{slot:0,master:torpedo},{slot:1,master:bomber}]},0);
 assert.equal(actor.fire,139);
 const none=opponentActor({master:{...m,api_maxeq:[0,0]},level:50,slots:[{slot:0,master:torpedo},{slot:1,master:bomber}]},0);
 assert.equal(none.fire,0);
});
test('simulation uses opponent hull maxima and does not invent missing data',()=>{
 const s=equippedFixture();for(const ship of Object.values(s.info.ships))Object.assign(ship,{api_nowhp:30,api_maxhp:30,api_kyouka:[0,0,0,0,0],api_lucky:[20,99]});
 Object.assign(s.const.$ships[2],{api_houg:[10,40],api_raig:[10,70],api_souk:[10,30]});
 Object.assign(s.const.$ships[1],{api_stype:2,api_taik:[30,40],api_houg:[10,40],api_raig:[10,70],api_souk:[10,30],api_leng:1});
 const e={known:true,ships:[{masterId:1,master:s.const.$ships[1],level:50}]},scheme={fleet:1,ships:[{id:2,slots:[-1,-1],ex:-1}]};
 assert.equal(opponentActor(e.ships[0],0).fire,40);assert.equal(opponentActor(e.ships[0],0).armor,30);
 const before=JSON.stringify(s),out=estimate(s,scheme,e,{samples:64});assert.equal(out.status,'estimated',out.reason);assert.equal(out.rows.reduce((n,r)=>n+r.count,0),64);
 assert.deepEqual(out.assumedEquipment[0].slots.map(x=>x.slot),[1,2]);assert.equal(JSON.stringify(s),before);
 assert.match(out.assumptions,/并非真实配装/);
 assert.deepEqual(estimate(s,scheme,e,{samples:64}),out);
 delete s.const.$ships[1].api_souk;assert.equal(estimate(s,scheme,e).status,'unknown');
});
test('manual formation changes the actual simulation, including double line',()=>{
 const s=equippedFixture();
 for(const ship of Object.values(s.info.ships))Object.assign(ship,{api_nowhp:30,api_maxhp:30,api_karyoku:[70,70],api_soukou:[45,45],api_kyouka:[0,0,0,0,0],api_lucky:[20,99]});
 for(const master of Object.values(s.const.$ships))Object.assign(master,{api_stype:2,api_taik:[30,40],api_houg:[10,20],api_raig:[10,40],api_souk:[10,25],api_leng:1});
 const e={known:true,ships:[1,2,3,4,5,6].map(masterId=>({masterId,level:50}))};
 const scheme={fleet:1,ships:[1,2,3,4,5,6].map(id=>({id,slots:[-1,-1],ex:-1}))};
 const outputs=['lineAhead','doubleLine','diamond','echelon','lineAbreast'].map(ownFormation=>estimate(s,scheme,e,{samples:256,ownFormation}));
 for(const [i,out] of outputs.entries()){
  assert.equal(out.status,'estimated',out.reason);
  assert.equal(out.ownFormation,['lineAhead','doubleLine','diamond','echelon','lineAbreast'][i]);
  assert.doesNotMatch(out.assumptions,/undefined/);
 }
 assert.notDeepEqual(outputs[0].rows,outputs[4].rows);
 assert.equal(estimate(s,scheme,e,{ownFormation:'bogus'}).reason,'己方阵形无效');
 assert.match(estimate(s,{ships:scheme.ships.slice(0,3)},e,{ownFormation:'doubleLine'}).reason,/不足 4 艘/);
});
test('practice forecast recognizes night scout and documents its air and damage assumptions',()=>{
 const s=equippedFixture();
 for(const ship of Object.values(s.info.ships))Object.assign(ship,{api_nowhp:30,api_maxhp:30,api_kyouka:[0,0,0,0,0],api_lucky:[20,99]});
 for(const master of Object.values(s.const.$ships))Object.assign(master,{api_taik:[30,40],api_houg:[10,40],api_raig:[10,70],api_souk:[10,30],api_leng:1});
 s.const.$ships[1].api_maxeq=[5,1];
 s.const.$equips[102]={api_id:102,api_name:'九八式水上偵察機(夜偵)',api_type:[0,0,10,50],api_saku:3,api_houm:1};
 s.const.$equips[21]={api_id:21,api_name:'测试舰战',api_type:[0,0,6,6],api_tyku:9};
 s.info.equips[1]={api_slotitem_id:21,api_level:0,api_alv:7};s.info.equips[2]={api_slotitem_id:102,api_level:0,api_alv:7};
 const result=estimate(s,{fleet:1,ships:[{id:1,slots:[1,2],ex:-1}]},{known:true,ships:[{masterId:2,level:50}]},{samples:64});
 assert.equal(result.status,'estimated',result.reason);assert.deepEqual(result.air.states,['supremacy']);
 assert.match(result.assumptions,/夜间接触按装备、等级/);assert.match(result.assumptions,/命中加成未计/);
});
test('unknown opposing anti-submarine capability does not become a false forecast',()=>{
 const s=equippedFixture();Object.assign(s.const.$ships[1],{api_stype:13,api_taik:[15,20],api_houg:[1,5],api_raig:[10,50],api_souk:[3,12]});
 Object.assign(s.info.ships[1],{api_nowhp:15,api_maxhp:15});
 Object.assign(s.const.$ships[2],{api_stype:2,api_taik:[15,20],api_houg:[1,5],api_raig:[10,50],api_souk:[3,12]});
 const e={known:true,ships:[{masterId:2,level:50}]};
 const out=estimate(s,{ships:[{id:1,slots:[-1,-1],ex:-1}]},e);
 assert.match(out.reason,/对潜/);assert.ok(out.air);assert.equal(out.assumedEquipment[0].masterId,2);
});
test('submarine-only opponents do not cause an unsupported ASW guess',()=>{
 const s=equippedFixture();Object.assign(s.const.$ships[1],{api_stype:13,api_taik:[15,20],api_houg:[1,5],api_raig:[10,50],api_souk:[3,12]});
 Object.assign(s.info.ships[1],{api_nowhp:15,api_maxhp:15,api_kyouka:[0,0,0,0,0],api_lucky:[20,99]});
 const e={known:true,ships:[{masterId:1,level:50}]};
 const result=estimate(s,{ships:[{id:1,slots:[-1,-1],ex:-1}]},e,{samples:32});
 assert.equal(result.status,'estimated');assert.deepEqual(result.rows,[{label:'D',count:32,percent:100}]);
});
