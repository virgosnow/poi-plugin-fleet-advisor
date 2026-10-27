'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {BatchReceiver}=require('../../src/infrastructure/workers/batch_transport');
test('common query data is registered once, reused by chunks and replaced for later phases',()=>{
  const receiver=new BatchReceiver(),profile={nodes:['A','B']},args={area:'4-5',heldSlots:[{id:1,keep:{0:true}}]};
  const first=receiver.read(structuredClone({batchId:1,header:{kind:'gear',args},items:[{profile,number:Infinity,missing:undefined}]}));
  assert.deepEqual(first,{kind:'gear',args,items:[{profile,number:Infinity,missing:undefined}]});
  const next=receiver.read(structuredClone({batchId:1,items:[{profile}]}));assert.equal(first.args,next.args);
  assert.deepEqual(receiver.read({batchId:2,header:{kind:'seeds',args:{area:'7-3',phase:'gauge2'}},items:[[1,2]]}),
    {kind:'seeds',args:{area:'7-3',phase:'gauge2'},items:[[1,2]]});
  assert.throws(()=>receiver.read({batchId:1,items:[]}),/Missing batch header/);
});
test('a missing registration is rejected rather than evaluated with a stale fleet query',()=>{
  assert.throws(()=>new BatchReceiver().read({batchId:9,items:[1,2]}),/Missing batch header/);
});
