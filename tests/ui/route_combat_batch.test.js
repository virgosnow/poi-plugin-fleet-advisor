'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {runRouteCombatBatch}=require('../../src/ui/workbench/route_combat_batch');
test('evaluates and publishes only the explicitly requested phase',async()=>{
  const events=[];
  await runRouteCombatBatch({firstPhase:'gauge2',firstResult:'current',phases:['gauge1','gauge2','gauge3'],
    search:async p=>{events.push(`search:${p}`);return p;},
    evaluate:async(p,result)=>{events.push(`evaluate:${p}:${result}`);return {[p]:{status:'estimated'}};},
    publish:p=>events.push(`publish:${p}`),isCancelled:()=>false,yieldControl:async()=>{}});
  assert.deepEqual(events,['evaluate:gauge2:current','publish:gauge2']);
});
test('cancelled evaluations are not published',async()=>{
  let stopped=false;const events=[];
  await runRouteCombatBatch({firstPhase:'a',firstResult:'current',evaluate:async p=>{events.push(`evaluate:${p}`);stopped=true;return {};},
    publish:p=>events.push(`publish:${p}`),isCancelled:()=>stopped,yieldControl:async()=>{}});
  assert.deepEqual(events,['evaluate:a']);
});
test('reports an error only for the requested phase',async()=>{
  const events=[];
  await runRouteCombatBatch({firstPhase:'a',firstResult:'current',evaluate:async()=>{throw Error('failed');},
    publish:p=>events.push(`publish:${p}`),onError:p=>events.push(`error:${p}`),
    isCancelled:()=>false,yieldControl:async()=>{}});
  assert.deepEqual(events,['error:a']);
});
