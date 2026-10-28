'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {planNormalChanges}=require('../../../src/domain/fleet/equipment_changes');
const cost=ops=>ops.reduce((n,op)=>n+(op.kind==='slot'?8:op.kind==='remove'?5:6),0);
function apply(before,ops){
  const slots=before.slice();
  for(const op of ops){
    if(op.kind==='clear')slots.fill(-1);
    else if(op.kind==='remove'){assert(slots[op.j]>0);slots.splice(op.j,1);slots.push(-1);}
    else {assert(!slots.includes(op.id));assert(slots[op.j]>0||slots.indexOf(-1)===op.j);slots[op.j]=op.id;}
    const ids=slots.filter(id=>id>0);assert.equal(new Set(ids).size,ids.length);
    assert(!slots.slice(slots.indexOf(-1)+1).some(id=>id>0)||!slots.includes(-1));
  }
  return slots;
}
test('one replacement leaves four correct slots untouched',()=>{
  const before=[1,2,3,4,5],wanted=[1,2,9,4,5],ops=planNormalChanges(before,wanted);
  assert.deepEqual(ops,[{kind:'slot',j:2,id:9}]);assert.deepEqual(apply(before,ops),wanted);
});
test('local swapping and shortening retain the correct prefix',()=>{
  for(const wanted of [[1,2,4,3,5],[1,2,3,4,-1]]){
    const before=[1,2,3,4,5],ops=planNormalChanges(before,wanted);
    assert(!ops.some(op=>op.kind==='clear'));assert(ops.every(op=>op.j>=2));assert.deepEqual(apply(before,ops),wanted);
  }
});
test('replacement ordering frees an instance without first unloading it',()=>{
  assert.deepEqual(planNormalChanges([1,2],[2,3]),[{kind:'slot',j:1,id:3},{kind:'slot',j:0,id:2}]);
});
test('whole clearing remains cheaper when almost everything is being discarded',()=>{
  assert.equal(planNormalChanges([1,2,3,4,5],[1,-1,-1,-1,-1])[0].kind,'clear');
});
test('a rebuild cannot remove a retained item that cannot legally be installed again',()=>{
  const before=[1,2,3,4,5],wanted=[1,-1,-1,-1,-1];
  const ops=planNormalChanges(before,wanted,{canInstall:id=>id!==1});
  assert(!ops.some(op=>op.kind==='clear'));assert.deepEqual(apply(before,ops),wanted);
});
test('all one-to-five slot target permutations preserve exact instances and never cost more than rebuilding',()=>{
  let checked=0;
  for(let n=1;n<=5;n++){
    const before=Array.from({length:n},(_,i)=>i+1),pool=Array.from({length:n+2},(_,i)=>i+1);
    function visit(prefix){
      const wanted=prefix.concat(Array(n-prefix.length).fill(-1)),ops=planNormalChanges(before,wanted);
      assert(ops,JSON.stringify({before,wanted}));assert.deepEqual(apply(before,ops),wanted);
      assert(cost(ops)<=6+8*prefix.length);checked++;
      if(prefix.length<n)for(const id of pool)if(!prefix.includes(id))visit(prefix.concat(id));
    }
    visit([]);
  }
  assert(checked>4000);
});
