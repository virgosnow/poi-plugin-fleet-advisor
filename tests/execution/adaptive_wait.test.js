'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Session}=require('../../src/execution/session');
function fixture(captureMs,validAfter=0){
  let time=0,captures=0,inputs=0;const starts=[],waits=[];
  const host={check(){},cancel(){},capture:async()=>{starts.push(time);time+=captureMs;captures++;return {};},input:async()=>inputs++};
  const s=new Session(host,{observe:async()=>({valid:time>=validAfter})},{now:()=>time});
  s.wait=async ms=>{waits.push(ms);time+=ms;};
  return {s,starts,waits,stats:()=>({time,captures,inputs})};
}
test('slow captures supply stable-frame spacing without an additional fixed wait',async()=>{
  const f=fixture(150);await f.s.until('list',{});
  assert.deepEqual(f.starts,[0,150]);assert.deepEqual(f.waits,[]);assert.equal(f.stats().captures,2);
});
test('fast captures retain at least 40ms between fresh observation starts',async()=>{
  const f=fixture(15);await f.s.until('list',{});
  assert.deepEqual(f.starts,[0,40]);assert.deepEqual(f.waits,[25]);assert.equal(f.stats().captures,2);
});
test('an opening menu is polled until readable and stable rather than waiting 450ms first',async()=>{
  const f=fixture(30,200);await f.s.until('cells',{});
  assert(f.stats().time<450);assert(f.stats().captures>=2);
  assert(f.starts.every((time,i)=>i===0||time-f.starts[i-1]>=40));assert.equal(f.stats().inputs,0);
});
test('unreadable and alternating frames never authorize the next input',async()=>{
  for(const alternating of [false,true]){
    const f=fixture(120,Infinity);let calls=0;
    if(alternating)f.s.observer.observe=async()=>({valid:true,page:++calls%2});
    await assert.rejects(f.s.until('cells',{},undefined,500),/timed out/);assert.equal(f.stats().inputs,0);
  }
});
test('unready observations back off, then immediately return to normal stable-frame spacing',async()=>{
  const f=fixture(30,240);await f.s.until('cells',{});
  assert.deepEqual(f.waits,[100,140,10]);assert.equal(f.stats().captures,4);
  assert(f.stats().time>=240+40,'readiness still needs a second independent image');
});
