'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {PerformanceLogs}=require('../../src/infrastructure/cache/performance_logs');
const {cacheFiles,reserveCacheSpace}=require('../../src/infrastructure/cache/disk_cache_budget');
const {inspectCache,maintainCache}=require('../../src/infrastructure/cache/recommendation_cache');
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-advisor-logs-'));
  t.after(()=>{if(path.dirname(dir)===os.tmpdir()&&path.basename(dir).startsWith('fleet-advisor-logs-'))fs.rmSync(dir,{recursive:true,force:true});});return dir;}
const report=()=>({version:1,level:'modules',method:'recommendNormalFleet',area:'4-5',status:'success',elapsedMs:100,workerMs:90,startupAndTransferMs:10,queueMs:0,
  stages:[{name:'batch.gear',ms:89}],spans:[{name:'air.trial',calls:12,totalMs:18,selfMs:5}],counters:{'air.trial.hit':9},children:[],dispatch:[]});

test('logs whitelist diagnostics, respect capacity without evicting existing logs and preserve unrelated files',async t=>{
  const root=setup(t),logs=new PerformanceLogs(root,{getLimitBytes:()=>6000});
  const value=report();Object.assign(value,{store:{nickname:'PRIVATE_TEST'},args:{token:'PRIVATE_TEST'},error:'PRIVATE_TEST'});
  value.spans[0].shipId='PRIVATE_TEST';
  value.teardownMs=12;value.runtime={execution:'utility-process',peakRssMiB:1400,prewarmed:true,preloadMs:50,pid:'PRIVATE_TEST',store:'PRIVATE_TEST'};
  assert((await logs.write(value)).saved);
  const file=(await cacheFiles(root,'logs'))[0],text=fs.readFileSync(file.file,'utf8'),parsed=JSON.parse(text);
  assert(!text.includes('PRIVATE_TEST'));assert.equal(parsed.profile.area,'4-5');assert.equal(parsed.summary.modules[0].calls,12);
  assert.equal(parsed.summary.teardownMs,12);
  assert.deepEqual(parsed.profile.runtime,{execution:'utility-process',prewarmed:true,peakRssMiB:1400,preloadMs:50});
  let full=false;for(let i=0;i<10;i++)if(!(await logs.write(report())).saved)full=true;
  assert(full);assert(fs.existsSync(file.file));
  const files=await cacheFiles(root,'logs');assert(files.length<11);assert(files.reduce((n,f)=>n+f.size,0)<=6000);
  const unrelated=path.join(logs.directory,'my-notes.json');fs.writeFileSync(unrelated,'keep');
  assert((await inspectCache(root)).logs.files>0);
  await maintainCache(root,{clear:'logs'});assert.equal((await cacheFiles(root,'logs')).length,0);
  assert.equal(fs.readFileSync(unrelated,'utf8'),'keep');
});

test('old logs survive age, entry limits and automatic capacity maintenance until explicit clearing',async t=>{
  const root=setup(t);let now=1793000000000;
  const logs=new PerformanceLogs(root,{now:()=>now});await logs.write(report());const first=(await cacheFiles(root,'logs'))[0];
  fs.utimesSync(first.file,new Date(now-8*86400000),new Date(now-8*86400000));
  for(let i=0;i<66;i++){now++;await logs.write(report());}
  assert(fs.existsSync(first.file));assert.equal((await cacheFiles(root,'logs')).length,67);
  assert.equal((await reserveCacheSpace(root,{limitBytes:1})).fits,false);assert(fs.existsSync(first.file));assert.equal((await cacheFiles(root,'logs')).length,67);
  await maintainCache(root,{clear:'logs'});assert.equal((await cacheFiles(root,'logs')).length,0);
});

test('turning logging off skips queued writes, retains prior logs, and preserves abnormal detail safely',async t=>{
  const root=setup(t);let enabled=true;const logs=new PerformanceLogs(root,{isEnabled:()=>enabled});
  const value={...report(),reaping:{abnormal:true,reasons:['slow'],main:{events:[{event:'killReturned',at:1000,ok:true,message:'PRIVATE_TEST'}]},
    renderer:{waitMs:900,message:'PRIVATE_TEST'},store:'PRIVATE_TEST'}};
  await logs.write(value);const files=await cacheFiles(root,'logs'),before=fs.readFileSync(files[0].file,'utf8');
  assert(JSON.parse(before).profile.reaping.abnormal);assert(!before.includes('PRIVATE_TEST'));
  let release;logs.pending=new Promise(resolve=>{release=resolve;});const pending=logs.write(value);enabled=false;release();
  assert.deepEqual(await pending,{saved:false,disabled:true});assert.deepEqual(await logs.write(value),{saved:false,disabled:true});
  assert.equal((await cacheFiles(root,'logs')).length,1);assert.equal(fs.readFileSync(files[0].file,'utf8'),before);
});

test('disabling during a pending file write prevents publishing and cleans only its new temporary file',async t=>{
  const root=setup(t);let enabled=true;const logs=new PerformanceLogs(root,{isEnabled:()=>enabled});await logs.write(report());
  const prior=(await cacheFiles(root,'logs'))[0],before=fs.readFileSync(prior.file,'utf8'),write=fs.promises.writeFile.bind(fs.promises);
  t.mock.method(fs.promises,'writeFile',async(...args)=>{const result=await write(...args);enabled=false;return result;});
  assert.deepEqual(await logs.write(report()),{saved:false,disabled:true});assert.equal(fs.readFileSync(prior.file,'utf8'),before);
  assert.deepEqual(fs.readdirSync(logs.directory),[path.basename(prior.file)]);
});

test('unwritable or linked log directories fail without following links or rejecting recommendations',async t=>{
  const root=setup(t),outside=setup(t),logs=new PerformanceLogs(root);
  fs.symlinkSync(outside,logs.directory,'junction');
  const result=await logs.write(report());assert.equal(result.saved,false);assert(logs.lastError);
  assert.equal(fs.readdirSync(outside).length,0);await assert.rejects(maintainCache(root,{clear:'logs'}),/不是普通目录/);
  const denied=new PerformanceLogs(setup(t),{getLimitBytes:()=>1});assert.equal((await denied.write(report())).saved,false);
});
