'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const B=require('../../../src/domain/combat/combat_balance');
test('five labels, exact boundaries and opposite sides use a stable scale',()=>{
  for(const [ratio,label] of [[0,'完败'],[1/3,'完败'],[.34,'劣势'],[2/3,'劣势'],[1,'均势'],[1.5,'优势'],[3,'完胜']]){
    assert.equal(B.fromRatio(ratio).label,label);
    assert.equal(B.fromRatio(ratio).blueShare,ratio/(1+ratio));
  }
  assert.equal(B.compare(100,100).blueShare,.5);
  assert.equal(B.compare(50,100).label,'劣势');assert.equal(B.compare(100,50).label,'优势');
});
test('missing, invalid, zero enemy and unknown ranges never become equal or a victory',()=>{
  for(const [a,b] of [[0,0],[1,0],[NaN,1],[-1,1],[Infinity,2],[1,null]])assert.equal(B.compare(a,b),null);
  assert.equal(B.compareRange({min:1,max:2},{min:0,max:1}).status,'unknown');
  assert.equal(B.compareRange({min:3,max:1},{min:1,max:2}).status,'unknown');
  const uncertain=B.compareRange({min:1,max:3},{min:1,max:1});
  assert.equal(uncertain.status,'partial');assert.equal(uncertain.balance,null);
  const known=B.compareRange({min:2,max:2.5},{min:1,max:1});
  assert.equal(known.status,'ready');assert.equal(known.balance.label,'优势');
});
test('bar grows monotonically and grades never improve when enemy grows',()=>{
  let prior=-1;for(let n=0;n<=100;n++){
    const value=B.compare(n,25);assert(value.blueShare>=prior);prior=value.blueShare;
  }
  assert(B.compare(100,10).rank>=B.compare(100,50).rank);
});
