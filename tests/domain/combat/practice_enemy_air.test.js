'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../../helpers/workbench_fixture');
const {estimate}=require('../../../src/domain/combat/practice_enemy_air');
function sample(){
 const store=fixture();
 store.const.$ships[1].api_maxeq=[18,18];store.const.$ships[2].api_maxeq=[18,18];
 store.const.$equips[11]={api_id:11,api_name:'烈風',api_type:[0,0,6],api_tyku:10,api_baku:0,api_raig:0};
 store.const.$equips[12]={api_id:12,api_name:'天山',api_type:[0,0,8],api_tyku:0,api_baku:0,api_raig:9};
 store.info.equips[11]={api_slotitem_id:11,api_alv:7};store.info.equips[12]={api_slotitem_id:12,api_alv:7};
 return {store,scheme:{ships:[{id:1,slots:[11,12]}]},reference:{status:'estimated',ships:[{masterId:2,level:50,slots:[{slot:0,masterId:11},{slot:1,masterId:12}]}]}};
}
test('reference aircraft yield an independent air range and conservative interception bounds',()=>{
 const {store,scheme,reference}=sample(),before=JSON.stringify(store.info);
 const r=estimate(store,scheme,reference);
 assert.equal(r.status,'estimated');assert.deepEqual(r.enemyAirPower,{min:42,max:70});
 assert.deepEqual(r.ownAirPower,{min:70,max:70});assert.deepEqual(r.states,['parity','superiority']);
 assert.equal(r.enemyAir[0].attacks[0].planesMax,18);
 assert.deepEqual(r.ownRemaining,[{1:[0,17]}]);assert.deepEqual(r.bauxite,{min:10,max:115});
 assert.match(r.assumptions.join(' '),/并非实际装备/);assert.equal(JSON.stringify(store.info),before);
});
test('missing opponent data is unknown rather than a fictitious zero-air opponent',()=>{
 const {store,scheme,reference}=sample();
 assert.equal(estimate(store,scheme,null).status,'unknown');
 reference.ships[0].slots[0].masterId=123456;
 assert.equal(estimate(store,scheme,reference).status,'unknown');
});
test('zero-slot opponents need no aircraft-capacity array, but cannot have virtual equipment',()=>{
 const {store,scheme,reference}=sample();store.const.$ships[2].api_slot_num=0;delete store.const.$ships[2].api_maxeq;
 reference.ships[0].slots=[];
 const r=estimate(store,scheme,reference);assert.equal(r.status,'estimated');assert.deepEqual(r.enemyAirPower,{min:0,max:0});
 reference.ships[0].slots=[{slot:0,masterId:11}];assert.equal(estimate(store,scheme,reference).status,'unknown');
});
test('special or unresolved aircraft losses do not yield a narrow conditional interval',()=>{
 const {store,scheme,reference}=sample();store.const.$equips[489]={api_id:489,api_type:[0,0,26],api_tyku:3};
 store.info.equips[13]={api_slotitem_id:489,api_alv:7};scheme.ships[0].slots[0]=13;
 const r=estimate(store,scheme,reference);assert.equal(r.status,'estimated');assert.equal(r.bauxite,null);assert.equal(r.ownRemaining,null);
});
test('ordinary patrol planes never gain imagined proficiency-based air power',()=>{
 const {store,scheme,reference}=sample();store.const.$equips[26]={api_id:26,api_type:[0,0,26],api_tyku:0};
 store.info.equips[26]={api_slotitem_id:26,api_alv:7};scheme.ships[0].slots=[26,-1];
 const r=estimate(store,scheme,reference);assert.deepEqual(r.ownAirPower,{min:0,max:0});assert.equal(r.bauxite.min,0);
});
test('zero air power with an attacking plane is supremacy before interception, even if that slot can be wiped',()=>{
 const {store,scheme,reference}=sample();
 store.const.$ships[1].api_maxeq=[48,1];reference.ships[0].slots=[];
 store.info.equips[12].api_alv=0;scheme.ships[0].slots=[12,-1];
 const r=estimate(store,scheme,reference);
 assert.deepEqual(r.ownAirPower,{min:0,max:0});assert.deepEqual(r.enemyAirPower,{min:0,max:0});
 assert.deepEqual(r.states,['supremacy']);
 assert.deepEqual(r.ownRemaining,[{0:[0,47]}]);assert.equal(r.bauxite.min,5);
});
test('zero air power with only a night scout has no aviation battle; a live enemy attacker prevents that state',()=>{
 const {store,scheme,reference}=sample();
 store.const.$equips[13]={api_id:13,api_name:'九八式水上偵察機(夜偵)',api_type:[0,0,10,50],api_tyku:0};
 store.info.equips[13]={api_slotitem_id:13,api_alv:0};scheme.ships[0].slots=[13,-1];reference.ships[0].slots=[];
 const noAttack=estimate(store,scheme,reference);assert.deepEqual(noAttack.ownAirPower,{min:0,max:0});
 assert.deepEqual(noAttack.enemyAirPower,{min:0,max:0});assert.deepEqual(noAttack.states,['noAirBattle']);
 reference.ships[0].slots=[{slot:0,masterId:12}];
 const enemyAttack=estimate(store,scheme,reference);
 assert.equal(enemyAttack.enemyAirPower.min,0);assert.deepEqual(enemyAttack.states,['loss','supremacy']);
 assert.ok(!enemyAttack.states.includes('noAirBattle'));
 store.const.$ships[2].api_maxeq[0]=0;
 assert.deepEqual(estimate(store,scheme,reference).states,['noAirBattle']);
});
