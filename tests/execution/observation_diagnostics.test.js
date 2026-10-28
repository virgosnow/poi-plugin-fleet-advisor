'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Session}=require('../../src/execution/session');
const {observationSummary}=require('../../src/execution/observation_diagnostics');
function fixture(result){
  let time=0,calls=0;
  const session=new Session({check(){},cancel(){},capture:async()=>{time+=5;return Buffer.from('frame');}},
    {observe:async()=>{time+=10;return result(++calls);}},{now:()=>time});
  session.wait=async ms=>{time+=ms;};return session;
}
test('timeout records failed subchecks, bounded results and timings, without raw payloads',async()=>{
  const s=fixture(()=>({valid:false,results:[{valid:true,mode:'stock',token:'secret'},
    {valid:false,expectedType:11,actualType:10,frame:'private image',inventory:{secret:1}}]}));
  await assert.rejects(s.until('batch',{checks:[{kind:'equipmode'},{kind:'rowicon'}]},undefined,180),e=>{
    assert.equal(e.message,'Observation timed out: batch');assert.equal(e.code,'OBSERVATION_TIMEOUT');
    const d=e.diagnostics;assert.equal(d.cause,'recognition-failed');assert(d.attempts>=2);
    assert.equal(d.captureMs,d.attempts*5);assert.equal(d.observeMs,d.attempts*10);
    assert.equal(d.checks[1].observed.actualType,10);
    assert(!e.stack.includes('secret'));assert(!e.stack.includes('private image'));return true;
  });
});
test('readable values that fail the expected predicate are distinguished from recognition failures',async()=>{
  const s=fixture(()=>({valid:true,activePage:2}));
  await assert.rejects(s.until('pageread',{},r=>r.activePage===3,180),e=>{
    assert.equal(e.diagnostics.cause,'expectation-mismatch');assert.equal(e.diagnostics.checks[0].observed.activePage,2);return true;
  });
});
test('unstable valid observations keep both recent states and preserve two-frame confirmation',async()=>{
  const s=fixture(i=>({valid:true,activePage:i%2+1}));
  await assert.rejects(s.until('pageread',{},undefined,180),e=>{
    assert.equal(e.diagnostics.cause,'not-stable');assert.notEqual(e.diagnostics.previous.activePage,e.diagnostics.checks[0].observed.activePage);return true;
  });
});
test('late valid observation reports the expired deadline instead of false recognition failure',async()=>{
  const s=fixture(()=>({valid:true}));
  await assert.rejects(s.until('screen',{},undefined,10),e=>{
    assert.equal(e.message,'Observation timed out: screen');assert.equal(e.diagnostics.cause,'deadline-exceeded');return true;
  });
});
test('summary enforces field, array, string and nesting bounds',()=>{
  const value={valid:false,reason:'x'.repeat(500),labels:Array(100).fill(1),password:'hidden',page:{page:{page:{page:{page:{secret:'hidden'}}}}}};
  const summary=observationSummary(value);assert.equal(summary.reason.length,160);assert.equal(summary.labels.length,8);
  assert(!JSON.stringify(summary).includes('hidden'));
});
