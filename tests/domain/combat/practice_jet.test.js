'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../../helpers/workbench_fixture');
const jet=require('../../../src/domain/combat/practice_jet');
const air=require('../../../src/domain/combat/practice_enemy_air');
const {runScenario}=require('../../../src/domain/combat/combat_battle');
function sample(){
 const store=fixture();store.info.resources={steel:100};store.const.$ships[1].api_maxeq=[24,18];store.const.$ships[2].api_maxeq=[18,18];
 store.const.$equips[199]={api_id:199,api_name:'喷式景云改',api_type:[0,0,57],api_tyku:6,api_baku:15};
 store.const.$equips[548]={api_id:548,api_name:'噴式震電',api_type:[0,0,56],api_tyku:12};
 store.const.$equips[11]={api_id:11,api_name:'烈風',api_type:[0,0,6],api_tyku:10};
 store.info.equips[99]={api_slotitem_id:199,api_alv:7};store.info.equips[98]={api_slotitem_id:548,api_alv:7};store.info.equips[11]={api_slotitem_id:11,api_alv:7};
 return {store,scheme:{ships:[{id:1,slots:[99,98]}]},reference:{status:'estimated',ships:[{masterId:2,slots:[{slot:0,masterId:11}]}]}};
}
test('jet assault models steel, unknown interception and loss before normal air power without mutating the store',()=>{
 const {store,scheme,reference}=sample(),before=JSON.stringify(store);
 const j=jet.estimate(store,scheme,[{submarine:false}]);
 assert.equal(j.active,true);assert.equal(j.steel,100);assert.equal(j.attacks[0].attacks.length,1);
 assert.deepEqual(j.aircraft[0][0],{min:0,max:24,reference:12});
 assert.equal(j.aircraft[0][1].reference,18);assert.match(j.assumptions,/实际喷式机和拦截能力未知/);
 assert.deepEqual(jet.ordinaryRemaining(store,scheme,j.aircraft,['loss']),[{0:[0,21],1:[12,16]}]);
 const normal=air.estimate(store,scheme,reference),after=air.estimate(store,scheme,reference,{jetAircraft:j.aircraft});
 assert.equal(after.status,'estimated');assert.ok(after.ownAirPower.max<normal.ownAirPower.max);
 assert.equal(JSON.stringify(store),before);
});
test('jet assault is unavailable at zero steel or against only submarines; missing steel is explicit',()=>{
 const {store,scheme}=sample();store.info.resources.steel=0;
 const none=jet.estimate(store,scheme,[{submarine:false}]);assert.equal(none.active,false);assert.equal(none.steel,0);
 store.info.resources.steel=100;assert.equal(jet.estimate(store,scheme,[{submarine:true}]).active,false);
 delete store.info.resources.steel;assert.match(jet.estimate(store,scheme,[{submarine:false}]).reason,/钢材/);
});
test('jet assault resolves before normal air and damages the opponent only in its own stage',()=>{
 const own={side:'own',index:0,hp:30,initialHp:30,armor:20,fire:0,torpedo:0,stype:11,carrier:true,armedCarrier:false};
 const foe={side:'enemy',index:0,hp:500,armor:0,fire:0,torpedo:0,stype:2};
 const attack={attacks:[{powerMin:60,powerMax:60,referencePowers:[60]}]};
 const prep={status:'estimated',kind:'battle',allies:[own],foes:[foe],combined:false,mainCount:1,includeNight:false,
  ownFormation:'lineAhead',enemyFormation:'lineAhead',ownJet:[attack],ownAir:[attack],enemyAir:[]};
 const trace=[],result=runScenario(prep,()=>0,{trace});
 assert.equal(result.status,'estimated');assert.deepEqual(trace.filter(e=>e.phase==='air').map(e=>e.stage),['jet','air']);
 assert.ok(result.enemyHp[0]<500);const noJet=runScenario({...prep,ownJet:null},()=>0);
 assert.ok(result.enemyHp[0]<noJet.enemyHp[0]);
});
