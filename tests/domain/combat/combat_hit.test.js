'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evadeTerm,referenceHit}=require('../../../src/domain/combat/combat_hit');
test('route reference uses the documented evasion cap, fuel and morale without inventing missing stats',()=>{
  assert.equal(evadeTerm(60,0,'lineAhead',1),53);
  assert.equal(evadeTerm(60,0,'lineAhead',.72),50);
  assert.equal(evadeTerm(null,0),null);
  const enemy={side:'enemy'},normal={side:'own',evasion:60,luck:0,condition:49};
  const air=referenceHit(enemy,normal,{phase:'air',fuel:1});
  assert.equal(air,.43);
  assert(referenceHit(enemy,{...normal,condition:60},{phase:'air'})<air);
  assert(referenceHit(enemy,normal,{phase:'air',fuel:.52})>air);
  assert(referenceHit(enemy,{...normal,stype:6},{phase:'night'})<referenceHit(enemy,normal,{phase:'night'}));
  assert.equal(referenceHit(enemy,{...normal,evasion:null},{phase:'air'}),null);
  assert.equal(referenceHit(normal,enemy,{phase:'air'}),null);
  assert.equal(referenceHit(enemy,normal,{phase:'torpedo'}),null,'attack power is required');
});
test('enemy torpedo hit uses attack and defense formations, evasion, fatigue and fuel',()=>{
  const enemy={side:'enemy',torpedoAccuracyBonus:70},ship={side:'own',evasion:60,luck:0,condition:49,torpedoEvasionBonus:0};
  const opts={phase:'openingTorpedo',attackPower:108,attackerFormation:'echelon',defenderFormation:'lineAbreast',fuel:1};
  assert.equal(evadeTerm(60,0,'lineAbreast',1,'torpedo'),63);
  assert.equal(referenceHit(enemy,ship,opts),.75);
  assert.equal(referenceHit(enemy,ship,{...opts,attackerFormation:'lineAbreast'}),.11);
  assert(referenceHit(enemy,ship,{...opts,defenderFormation:'lineAhead'})>referenceHit(enemy,ship,opts));
  assert(referenceHit(enemy,{...ship,condition:60},opts)<referenceHit(enemy,ship,opts));
  assert(referenceHit(enemy,ship,{...opts,fuel:.52})>referenceHit(enemy,ship,opts));
  assert(referenceHit(enemy,{...ship,torpedoEvasionBonus:4.5},opts)<referenceHit(enemy,ship,opts));
  assert.equal(referenceHit(enemy,{...ship,evasion:null},opts),null);
  assert.equal(referenceHit(enemy,{...ship,torpedoEvasionBonus:null},opts),null);
});
test('known enemy torpedo accuracy bonuses are distinct from unknown ships',()=>{
  const {enemyTorpedoBonus}=require('../../../src/domain/combat/combat_hit');
  assert.equal(enemyTorpedoBonus('潜水ソ級elite'),60);assert.equal(enemyTorpedoBonus('潜水ソ級flagship'),70);
  assert.equal(enemyTorpedoBonus('未知の敵艦'),null);
});
test('enemy level, luck and equipment accuracy affect the torpedo reference',()=>{
  const {enemies}=require('../../../data/sortie/enemy_accuracy.json');
  assert.deepEqual(enemies['1571'],{level:50,luck:30,equipmentAccuracy:0});
  assert.deepEqual(enemies['1572'],{level:50,luck:45,equipmentAccuracy:0});
  // Adjacent equipment labels beginning with digits must not be concatenated
  // into a previous equipment's accuracy value during the Wiki import.
  assert.equal(enemies['1613'].equipmentAccuracy,15);
  assert.equal(enemies['1665'].equipmentAccuracy,22);
  const enemy={side:'enemy',torpedoAccuracyBonus:70,torpedoReferenceStats:enemies['1572']};
  const ship={side:'own',evasion:60,luck:0,condition:49,torpedoEvasionBonus:0};
  const options={phase:'openingTorpedo',attackPower:108,attackerFormation:'echelon',defenderFormation:'lineAbreast'};
  assert.equal(referenceHit(enemy,ship,options),.82);
  assert(referenceHit({...enemy,torpedoReferenceStats:{...enemy.torpedoReferenceStats,equipmentAccuracy:10}},ship,options)>.82);
  assert(referenceHit({...enemy,torpedoReferenceStats:{...enemy.torpedoReferenceStats,luck:0}},ship,options)<.82);
});
test('imported enemy references map to known identities and bounded numeric fields',()=>{
  const {enemies}=require('../../../data/sortie/enemy_accuracy.json');
  const catalog=new Set(require('../../../data/sortie/enemy_catalog.json').enemies.map(row=>String(row.apiId)));
  assert(Object.keys(enemies).length>=100);
  for(const [id,row] of Object.entries(enemies)){
    assert(catalog.has(id),id);
    assert(Number.isInteger(row.level)&&row.level>=1&&row.level<=999,id);
    assert(Number.isInteger(row.luck)&&row.luck>=0&&row.luck<=200,id);
    assert(Number.isInteger(row.equipmentAccuracy)&&Math.abs(row.equipmentAccuracy)<=200,id);
  }
});
