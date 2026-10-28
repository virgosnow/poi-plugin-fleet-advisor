'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Worker}=require('node:worker_threads');
const {WorkerObserver}=require('../../src/vision/worker_observer');
const {Observer}=require('../../src/vision/observers');
const {Pixels,resampleArea}=require('../../src/vision/pixels');
const {Session}=require('../../src/execution/session');
const frame=()=>fs.readFileSync(path.join(__dirname,'../fixtures/equip/picker-transport.png'));
const row={box:[546,196,599,240],t3:20};

test('authorized same-frame observations reuse pixels but still run the requested checks',async()=>{
  const o=new WorkerObserver();try{
    await o.start();const image=frame();
    const picker=await o.observe('equippicker',image,{layout:'equip',total:161});assert(picker.valid);
    assert((await o.observe('rowicon',image,row,{reuseFrame:true})).valid);
    assert(!(await o.observe('rowicon',image,{...row,t3:7},{reuseFrame:true})).valid);
    assert.equal(o.frameMetrics.decodes,1);assert.equal(o.frameMetrics.normalizations,1);assert.equal(o.frameMetrics.reuses,2);
    assert.equal(o.frameMetrics.retainedBytes,1200*720*4);
  }finally{await o.dispose();assert.equal(o.frameMetrics.retainedBytes,0);}
});

test('fresh reads and equal PNG bytes cannot masquerade as an authorized reused capture',async()=>{
  const o=new WorkerObserver();try{
    await o.start();const image=frame();
    await o.observe('rowicon',image,row);
    await o.observe('rowicon',image,row); // Same Buffer, but a fresh capture.
    await o.observe('rowicon',Buffer.from(image),row,{reuseFrame:true}); // Equal bytes, different capture.
    assert.equal(o.frameMetrics.decodes,3);assert.equal(o.frameMetrics.reuses,0);
    assert.equal(o.frameMetrics.peakRetainedBytes,1200*720*4);
    o.releaseFrame();assert.equal(o.frameMetrics.retainedBytes,0);
    await o.observe('rowicon',image,row,{reuseFrame:true});
    assert.equal(o.frameMetrics.decodes,4);assert.equal(o.frameMetrics.reuses,0);
  }finally{await o.dispose();}
});

test('worker pixel reuse produces identical results to uncached recognition at every supported scale',async()=>{
  const o=new WorkerObserver(),direct=new Observer();try{
    await o.start();const original=Pixels.decode(frame());
    const checks=[{kind:'equippicker',arg:{layout:'equip',total:161}},{kind:'rowicon',arg:row}];
    for(const scale of [1,1.25,1.5,1.75]){
      const image=(scale===1?original:resampleArea(original,1200*scale,720*scale)).png();
      const expected=await direct.observe('batch',image,{checks});
      assert.deepEqual(await o.observe('batch',image,{checks}),expected);
      assert.deepEqual(await o.observe('batch',image,{checks},{reuseFrame:true}),expected);
      assert.equal(o.frameMetrics.retainedBytes,1200*720*4);
    }
    assert.equal(o.frameMetrics.decodes,4);assert.equal(o.frameMetrics.resamples,3);assert.equal(o.frameMetrics.reuses,4);
  }finally{await o.dispose();}
});

test('worker refuses a missing or invalidated parsed-frame token instead of consulting another image',async()=>{
  const worker=new Worker(require.resolve('../../src/vision/worker'));let sequence=0;
  const ask=message=>new Promise(resolve=>{worker.once('message',resolve);worker.postMessage({id:++sequence,...message});});
  try{
    assert((await ask({kind:'rowicon',frame:frame(),frameToken:1,arg:row})).result.valid);
    const wrong=await ask({kind:'rowicon',reuseFrame:true,frameToken:2,arg:row});
    assert.match(wrong.error,/unavailable or invalidated/);assert.equal(wrong.frameMetrics.retainedBytes,0);
    const missing=await ask({kind:'rowicon',reuseFrame:true,frameToken:1,arg:row});
    assert.match(missing.error,/unavailable or invalidated/);
    // Preserve the uncached raw-worker protocol used by package smoke tests.
    assert((await ask({kind:'rowicon',frame:frame(),arg:row})).result.valid);
  }finally{await worker.terminate();}
});

test('an observation error clears the cached pixels and later reuse sends a new frame',async()=>{
  const o=new WorkerObserver();try{
    await o.start();const image=frame();await o.observe('rowicon',image,row);
    await assert.rejects(o.observe('unsupported',image,{}, {reuseFrame:true}),/Unsupported observation/);
    assert.equal(o.frameMetrics.retainedBytes,0);
    assert((await o.observe('rowicon',image,row,{reuseFrame:true})).valid);
    assert.equal(o.frameMetrics.decodes,2);
    await assert.rejects(o.observe('rowicon',Buffer.from('invalid PNG'),row));assert.equal(o.frameMetrics.retainedBytes,0);
  }finally{await o.dispose();}
});

test('the transport omits PNG bytes only for explicitly authorized frame reuse',async()=>{
  const sent=[];
  const o=new WorkerObserver({createWorker:filename=>{
    const worker=new Worker(filename),send=worker.postMessage.bind(worker);
    worker.postMessage=message=>{sent.push(message);send(message);};return worker;
  }});
  try{
    await o.start();const image=frame();await o.observe('rowicon',image,row);
    await o.observe('rowicon',image,row,{reuseFrame:true});
    const messages=sent.filter(m=>m.kind==='rowicon');assert(messages[0].frame);assert.equal(messages[1].frame,undefined);
    assert.equal(messages[1].frameToken,messages[0].frameToken);
  }finally{await o.dispose();}
});

test('a warm worker initialization never carries parsed pixels into the next run',async()=>{
  const o=new WorkerObserver();try{
    await o.start();const image=frame();await o.observe('rowicon',image,row);
    await o.start();assert.equal(o.frameMetrics.retainedBytes,0);assert.equal(o.frameMetrics.decodes,0);
    assert((await o.observe('rowicon',image,row,{reuseFrame:true})).valid);
    assert.equal(o.frameMetrics.decodes,1);assert.equal(o.frameMetrics.reuses,0);
  }finally{await o.dispose();}
});

test('stopping during worker recognition cannot revive a released parsed-frame lease',async()=>{
  const o=new WorkerObserver(),image=frame();
  const s=new Session({check(){},cancel(){},capture:async()=>image},o);
  try{
    await o.start();const observe=o.observe.bind(o);let inFlight,begin;
    const started=new Promise(resolve=>{begin=resolve;});
    o.observe=(...args)=>{const pending=observe(...args);if(args[0]==='rowicon'){inFlight=pending;begin();}return pending;};
    const pending=s.observe('rowicon',row);await started;s.stop();
    await assert.rejects(pending,/stopped/);
    assert.equal(o.frameMetrics.retainedBytes,0);
    await inFlight;assert.equal(o.frameMetrics.retainedBytes,0);
    await o.start();assert.equal(o.frameMetrics.retainedBytes,0);
  }finally{await o.dispose();}
});

for(const reason of ['fresh','input','expiry','stable','stop','failed-reuse'])test('Session retains existing '+reason+' freshness and validation rules with parsed pixels',async()=>{
  const o=new WorkerObserver();let time=0,captures=0,inputs=0,validations=0;
  const image=frame(),host={check(){},cancel(){},capture:async()=>{captures++;return image;},input:async()=>{inputs++;}};
  const s=new Session(host,o,{now:()=>time});s.wait=async ms=>{time+=ms;};s.validate=()=>{validations++;};
  try{
    await o.start();await s.observe('rowicon',row);
    if(reason==='input')await s.input(1,1,undefined,'click',{settleMs:0});
    if(reason==='expiry')time+=501;
    if(reason==='stop'){
      s.stop();assert.equal(o.frameMetrics.retainedBytes,0);
      await assert.rejects(s.observe('rowicon',row,{reuseLastFrame:true}),/stopped/);assert.equal(captures,1);return;
    }
    if(reason==='stable')await s.until('rowicon',row,undefined,6000,{stableFrames:2,reuseLastFrame:true});
    else if(reason==='failed-reuse'){
      let attempts=0;
      await s.until('rowicon',row,()=>++attempts===2,6000,{stableFrames:1,reuseLastFrame:true});
    }else await s.observe('rowicon',row,{reuseLastFrame:reason!=='fresh'});
    assert.equal(captures,reason==='stable'?3:reason==='failed-reuse'?2:reason==='fresh'||reason==='input'||reason==='expiry'?2:1);
    assert.equal(o.frameMetrics.decodes,captures);assert.equal(o.frameMetrics.reuses,reason==='failed-reuse'?1:0);
    assert.equal(inputs,reason==='input'?1:0);assert(validations>=4);
  }finally{s.stop();await o.dispose();}
});

test('Session authorizes only the same capture inside 500ms and still validates before and after reuse',async()=>{
  const o=new WorkerObserver();let time=0,captures=0,validations=0;
  const image=frame(),s=new Session({check(){},cancel(){},capture:async()=>{captures++;return image;}},o,{now:()=>time});
  s.validate=()=>{validations++;};
  try{
    await o.start();await s.observe('rowicon',row);time=500;
    await s.observe('rowicon',row,{reuseLastFrame:true});
    assert.equal(captures,1);assert.equal(o.frameMetrics.decodes,1);assert.equal(o.frameMetrics.reuses,1);assert.equal(validations,4);
  }finally{s.stop();await o.dispose();}
});
