'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {WorkerObserver}=require('../../src/vision/worker_observer');

test('stop during successful-run cleanup does not reuse a terminated observer',async()=>{
  const entry=path.join(__dirname,'../../src/application/controller.js'),module={exports:{}};
  const plan={done:false,targets:[1]};
  vm.runInNewContext(fs.readFileSync(entry,'utf8'),{module,performance,require(name){
    if(name==='../execution/organize')return {resolvePlan:()=>plan,restoreOrganization:async()=>({ok:true})};
    return require(path.resolve(path.dirname(entry),name));
  }});
  let releaseCleanup,notifyCleanup,observers=0,hosts=0;
  const cleanupStarted=new Promise(resolve=>notifyCleanup=resolve);
  const c=new module.exports.Controller({getStore:()=>({info:{fleets:[]}}),
    createHost(){const first=++hosts===1;return {start:async()=>{},cancel(){},check(){},
      dispose:()=>first?new Promise(resolve=>{releaseCleanup=resolve;notifyCleanup();}):Promise.resolve()};},
    createObserver(){observers++;let closed=false;return {
      start:async()=>{if(closed)throw Error('Observer already terminated');},
      dispose:async()=>{closed=true;}};}
  });
  try {
    const first=c.run('organization',{});
    await cleanupStarted;c.stop();releaseCleanup();await first;
    assert((await c.run('organization',{})).ok);
    assert.equal(observers,2);
  } finally {c.dispose();}
});

test('a worker message serialization failure does not poison the next observation',async()=>{
  const observer=new WorkerObserver();
  try {
    await assert.rejects(observer.observe('initialize',undefined,{uncloneable(){}}),/clone/i);
    await observer.start();
  } finally {await observer.dispose();}
});
