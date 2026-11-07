'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {SyncDiagnostics}=require('../../src/infrastructure/sync/sync_diagnostics');

test('diagnostics print fixed messages by default, rate limit repeats and ignore unknown input',()=>{
  let now=1000;const lines=[];
  const log=new SyncDiagnostics({now:()=>now,write:line=>lines.push(line)});
  log.report('identity_unavailable');log.report('identity_unavailable');log.report('private-test-token');
  assert.equal(lines.length,1);assert.match(lines[0],/identity_unavailable/);
  now+=60000;log.report('identity_unavailable');log.report('identity_verified');
  assert.equal(lines.length,3);assert(!lines.join(' ').includes('private-test-token'));
});

test('a logging failure cannot stop synchronization',()=>{
  const log=new SyncDiagnostics({write:()=>{throw Error('unavailable');}});
  assert.doesNotThrow(()=>log.report('started'));
});
