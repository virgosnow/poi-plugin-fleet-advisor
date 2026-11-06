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
  assert.equal(referenceHit(enemy,normal,{phase:'torpedo'}),null);
});
