'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const catalog=require('../../../data/sortie/enemy_catalog.json').enemies;
const {enemyRecord}=require('../../../src/domain/combat/combat_encounters');
const {deriveEnemyAir}=require('../../../src/domain/combat/combat_air_asw');
const {prepareBattle}=require('../../../src/domain/combat/combat_battle');

// Source slot values carry question marks in the Japanese wiki and are
// reference values; Chinese and English wiki rows identify the same IDs.
const cases=[
  [1653,['深海解放陸爆','深海解放陸爆','深海解放陸爆','深海解放陸爆'],[12,12,8,4],4],
  [1656,['深海解放陸爆Ace','深海解放陸爆','深海解放陸爆','深海解放陸爆'],[16,16,12,4],4],
  [1922,['深海解放陸爆Ace','深海解放陸爆','深海解放陸爆','深海解放陸爆'],[12,12,12,12],4],
  [1925,['深海解放陸爆Ace','深海解放陸爆Ace','深海解放陸爆','深海解放陸爆'],[18,18,18,18],4],
  [1971,['夜猫深海艦戦','夜深海艦爆','深海地獄艦爆改','夜復讐深海艦攻'],[22,22,22,11],3],
  [1974,['夜猫深海艦戦','夜深海艦爆','深海地獄艦爆改','夜復讐深海艦攻'],[23,23,22,22],3]
];
const specs=[['深海解放陸爆Ace',7,16,0],['深海解放陸爆',7,11,0],['夜猫深海艦戦',6,0,0],
  ['夜深海艦爆',7,16,0],['深海地獄艦爆改',7,15,0],['夜復讐深海艦攻',8,0,15]];
const equipment=Object.fromEntries(specs.map(([name,type,bomb,torpedo],i)=>[i+1,
  {api_id:i+1,api_name:name,api_type:[0,0,type,0],api_baku:bomb,api_raig:torpedo}]));

test('documented 7-5 and 5-6 enemies retain aircraft and reference slot capacities',()=>{
  for(const [id,names,capacities,count] of cases){
    const row=catalog.find(item=>item.apiId===id);assert(row);
    assert.deepEqual(row.equipment.map(item=>item.name),names);
    assert.deepEqual(row.equipment.map(item=>item.slotCapacity),capacities);
    assert(row.equipment.every(item=>item.slotCapacityEstimated===true));
    const enemy=enemyRecord({apiId:id,apiIdStatus:'verified(test)'});
    const reading=deriveEnemyAir({const:{$equips:equipment}},enemy,{nodeKind:'battle'});
    assert.equal(reading.unresolvedAttack,false,`${id}: ${reading.reasons.join('；')}`);
    assert.equal(reading.attacks.length,count,`${id} aircraft attacks`);
  }
});

test('conflicting South Pacific carrier ranges are surfaced when shelling order matters',()=>{
  const friendly={status:'known',stype:2,hp:30,initialHp:30,armor:10,fire:40,torpedo:35,
    intrinsicTorpedo:30,openingTorpedo:false,range:1,condition:49,submarine:false,hasAircraft:false,
    asw:{status:'known',normal:true,opening:false,power:90,penetration:0}};
  for(const id of [1971,1974]){
    const row=catalog.find(item=>item.apiId===id),enemy=enemyRecord({apiId:id,apiIdStatus:'verified(test)'});
    const battle=prepareBattle([friendly],[enemy],{kind:'battle'});
    assert.equal(row.stats['射程'],'超長');assert.equal(battle.foes[0].range,4);
    assert(battle.reasons.some(reason=>/超长参考，中英文资料记载中射程/.test(reason)));
    const raid=prepareBattle([friendly],[enemy],{kind:'aerialRaid'});
    assert(!raid.reasons.some(reason=>/超长参考，中英文资料记载中射程/.test(reason)));
  }
});
