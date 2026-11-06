'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {rangeOrder}=require('../../../src/domain/combat/range_order');
const {random,prepareBattle,runScenario}=require('../../../src/domain/combat/combat_battle');
const {enemyRecord}=require('../../../src/domain/combat/combat_encounters');
test('same-range actors are sampled while different ranges and original indices remain correct',()=>{
 const actors=[{range:2},{range:1},{range:2},{range:3}],copy=JSON.stringify(actors);
 assert.deepEqual(rangeOrder(actors,()=>.1,4).map(row=>row.i),[7,6,4,5]);
 assert.deepEqual(rangeOrder(actors,()=>.9,4).map(row=>row.i),[7,4,6,5]);
 const rng=random(773),counts=[0,0];for(let i=0;i<2000;i++)counts[rangeOrder([{range:2},{range:2}],rng)[0].i]++;
 assert(counts.every(count=>count>850&&count<1150),JSON.stringify(counts));assert.equal(JSON.stringify(actors),copy);
});
test('shelling and opening ASW randomize equal ranges while second round and night use fleet order',()=>{
 const ship={status:'known',stype:2,hp:1000,initialHp:1000,armor:10,fire:40,torpedo:35,intrinsicTorpedo:30,openingTorpedo:false,range:2,condition:49,submarine:false,hasAircraft:false,asw:{status:'known',normal:true,opening:true,power:90,penetration:0}};
 const enemy=id=>({...enemyRecord({apiId:id,apiIdStatus:'verified'}),hp:{min:1000,max:1000},armor:{min:0,max:0}});
 const battle=prepareBattle([ship,ship,{...ship,range:1}],[enemy(1501)],{includeNight:true});battle.foes[0].battleship=true;
 for(const [rng,expected] of [[()=>.1,[1,0,2]],[()=>.9,[0,1,2]]]){
  const trace=[];runScenario(battle,rng,{trace});const order=stage=>trace.filter(row=>row.side==='own'&&row.stage===stage).map(row=>row.attacker);
  assert.deepEqual(order('shelling'),expected);assert.deepEqual(order('secondShell'),[0,1,2]);assert.deepEqual(order('night'),[0,1,2]);
 }
 const submarine=prepareBattle([ship,ship],[enemy(1532)],{kind:'asw'});
 for(const [rng,expected] of [[()=>.1,[1,0]],[()=>.9,[0,1]]]){const trace=[];runScenario(submarine,rng,{trace});assert.deepEqual(trace.filter(row=>row.side==='own'&&row.stage==='openingAsw').map(row=>row.attacker),expected);}
});
