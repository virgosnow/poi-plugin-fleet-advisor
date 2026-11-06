'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),os=require('os');
const {RecommendationCache,algorithmVersion,cachedRecommendation,cachedRecommendationAsync}=require('../../src/infrastructure/cache/recommendation_cache');
function directory(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paa-search-cache-'));
  t.after(()=>{assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
  return dir;
}

test('async search scopes preserve pure tables across awaits without leaking, and cache hits skip dispatch',async t=>{
  const dir=directory(t),{calculationTable}=require('../../src/shared/calculation_cache');let calculations=0;
  const calculate=async scope=>{
    const one=scope(()=>calculationTable('test',{version:1}).memo('x',()=>++calculations));
    assert.equal(calculationTable('test',{version:1}),undefined);
    await new Promise(resolve=>setImmediate(resolve));
    const two=scope(()=>calculationTable('test',{version:1}).memo('x',()=>++calculations));
    return {one,two};
  };
  assert.deepEqual(await cachedRecommendationAsync(dir,'async',{}, {},calculate),{one:1,two:1});
  assert.equal(calculations,1);
  assert.deepEqual(await cachedRecommendationAsync(dir,'async',{}, {},()=>assert.fail('cache hit must not create workers')),{one:1,two:1});
  assert.deepEqual(await cachedRecommendationAsync(dir,'async',{changed:true}, {},calculate),{one:1,two:1});
  assert.equal(calculations,1,'cross-snapshot pure table is reused');
  for(let i=0;i<2;i++)await assert.rejects(cachedRecommendationAsync(dir,'failure',{}, {},async()=>{throw Error('failed');}),/failed/);
});
test('persistent recommendations survive reopening, ignore snapshot UUIDs and retain exact result values',t=>{
  const dir=directory(t),cache=new RecommendationCache(dir,{version:'v1'}),store={info:{ships:{1:{level:30}}}};
  const args={snapshotId:'old',area:'5-2',fixedShipIds:[1,2],heldSlots:[{id:1,slots:[42]}]},result={scheme:{ships:[1,2]},optional:undefined,score:NaN,limit:Infinity};
  const key=cache.key('recommendNormalFleet',store,args);cache.write(key,result);
  const reopened=new RecommendationCache(dir,{version:'v1'});
  assert.deepEqual(reopened.read(reopened.key('recommendNormalFleet',store,{...args,snapshotId:'new'})).result,result);
  const changed=[
    reopened.key('recommendNormalEquipment',store,args),
    reopened.key('recommendNormalFleet',{info:{ships:{1:{level:31}}}},args),
    reopened.key('recommendNormalFleet',store,{...args,fixedShipIds:[2,1]}),
    reopened.key('recommendNormalFleet',store,{...args,heldSlots:[{id:1,slots:[43]}]}),
    reopened.key('recommendNormalFleet',store,{...args,automaticFilters:{minLevel:40}}),
    reopened.key('recommendNormalFleet',store,{...args,area:'4-5'}),
    reopened.key('recommendNormalFleet',store,{...args,airGoal:'supremacy'}),
    new RecommendationCache(dir,{version:'v2'}).key('recommendNormalFleet',store,args)
  ];
  for(const next of changed){assert.notEqual(next,key);assert.equal(reopened.read(next),null);}
  const first=reopened.read(key);first.result.scheme.ships[0]=99;
  assert.deepEqual(reopened.read(key).result,result,'callers cannot mutate saved results');
});
test('all account input changes invalidate results, including gear, repair, mission and masters',t=>{
  const cache=new RecommendationCache(directory(t),{version:'v1'}),fixture=require('../helpers/workbench_fixture');
  const key=cache.key('recommendNormalFleet',fixture(),{area:'5-2'});
  for(const edit of [s=>s.info.ships[2].api_slot=[500],s=>s.info.ships[2].api_lv++,
    s=>s.info.repairs=[{api_ship_id:2}],s=>s.info.fleets[0].api_mission=[1,2],
    s=>s.info.equips[999]={api_id:999,api_slotitem_id:1,api_level:10,api_alv:7},
    s=>s.const.$ships[2].api_soku=20,s=>s.const.$exslotEquipLimits={changed:true}]){
    const store=fixture();edit(store);assert.notEqual(cache.key('recommendNormalFleet',store,{area:'5-2'}),key);
  }
});
test('bad cache, full or inaccessible storage and calculation failures fall back without caching errors',t=>{
  const dir=directory(t),cache=new RecommendationCache(dir,{version:'v1'}),key=cache.key('m',{},{});
  fs.writeFileSync(path.join(dir,key+'.bin'),'broken');assert.equal(cache.read(key),null);
  cache.write(key,{ok:true});let bytes=fs.readFileSync(path.join(dir,key+'.bin'));bytes[bytes.length-3]^=1;
  fs.writeFileSync(path.join(dir,key+'.bin'),bytes);assert.equal(cache.read(key),null);
  const blocked=path.join(dir,'not-a-directory');fs.writeFileSync(blocked,'occupied');
  assert.deepEqual(cachedRecommendation(blocked,'m',{}, {},()=>({ok:true})),{ok:true});
  let calls=0;
  for(let i=0;i<2;i++)assert.throws(()=>cachedRecommendation(dir,'failing',{}, {},()=>{calls++;throw Error('fail');}),/fail/);
  assert.equal(calls,2);
  const small=new RecommendationCache(dir,{version:'v1',maxBytes:1});small.write('a'.repeat(64),{ok:true});
  assert.equal(small.read('a'.repeat(64)),null);
});
test('cache retention is bounded and old entries expire without touching unrelated files',t=>{
  const dir=directory(t),cache=new RecommendationCache(dir,{version:'v1',maxEntries:2});
  fs.writeFileSync(path.join(dir,'keep.txt'),'keep');
  for(let i=0;i<4;i++)cache.write(cache.key('m',{}, {i}),{i});
  assert.equal(fs.readdirSync(dir).filter(n=>n.endsWith('.bin')).length,2);
  const expired=new RecommendationCache(dir,{version:'v1',now:()=>Date.now()+8*86400000});
  for(const file of fs.readdirSync(dir).filter(n=>n.endsWith('.bin')))assert.equal(expired.read(file.slice(0,-4)),null);
  expired.prune();assert.deepEqual(fs.readdirSync(dir),['keep.txt']);
});
test('code and data content changes invalidate persisted searches even without a version bump',t=>{
  const root=directory(t);
  for(const dir of ['src','data'])fs.mkdirSync(path.join(root,dir));
  for(const file of ['src/algorithm.js','data/routes.json','package.json','package-lock.json'])fs.writeFileSync(path.join(root,file),'{}');
  let version=algorithmVersion(root);
  for(const file of ['src/algorithm.js','data/routes.json','package-lock.json']){
    fs.writeFileSync(path.join(root,file),'{"new":true}');const next=algorithmVersion(root);
    assert.notEqual(next,version);version=next;
  }
  fs.unlinkSync(path.join(root,'package-lock.json'));
  assert.match(algorithmVersion(root),/^[a-f0-9]{64}$/,'published packages need no lockfile');
});
test('worker cache returns identical results across worker restarts without rewriting a cache hit',async t=>{
  const {RecommendationWorker}=require('../../src/infrastructure/workers/recommendation_worker'),dir=directory(t);
  const store=require('../helpers/workbench_fixture')(),args={snapshotId:'one',area:'1-1',};
  let runner=new RecommendationWorker({cacheDir:dir});
  try{
    const first=await runner.run('recommendNormalFleet',store,args);
    await runner.dispose();
    const files=fs.readdirSync(dir).filter(n=>n.endsWith('.bin'));assert.equal(files.length,1);
    const file=path.join(dir,files[0]),past=new Date(Date.now()-60000);fs.utimesSync(file,past,past);
    const stamp=fs.statSync(file).mtimeMs;
    runner=new RecommendationWorker({cacheDir:dir});
    assert.deepEqual(await runner.run('recommendNormalFleet',store,{...args,snapshotId:'two'}),first);
    assert.equal(fs.statSync(file).mtimeMs,stamp,'second worker reads the on-disk result');
    assert.deepEqual(first,require('../../src/recommendation/index').recommendNormalFleet(store,args));
    const calculations=path.join(dir,'calculations'),tables=fs.readdirSync(calculations).filter(n=>n.endsWith('.bin'));
    assert(tables.length>0,'worker persists low-level tables as well as final results');
    for(const name of tables)fs.utimesSync(path.join(calculations,name),past,past);
    const times=tables.map(name=>fs.statSync(path.join(calculations,name)).mtimeMs);
    const next=structuredClone(store);next.info.basic.api_nickname='new snapshot';
    assert.deepEqual(await runner.run('recommendNormalFleet',next,{...args,snapshotId:'three'}),first);
    assert.equal(fs.readdirSync(dir).filter(n=>n.endsWith('.bin')).length,2,'new snapshot recomputes full search');
    assert.deepEqual(tables.map(name=>fs.statSync(path.join(calculations,name)).mtimeMs),times,'identical hull facts reuse persisted tables without rewrites');
  }finally{await runner.dispose();}
});

test('parallel hull facts survive a changed snapshot and reordered descriptor dictionaries',async t=>{
  const dir=directory(t),store=require('../helpers/workbench_fixture')(),{RecommendationPool}=require('../../src/infrastructure/workers/recommendation_pool');
  const {recommendNormalFleet,recommendNormalFleetParallel}=require('../../src/recommendation/index');
  const args={area:'2-3',airGoal:'superiority'};
  for(let round=0;round<2;round++){
    store.info.basic.api_nickname='cache-test-'+round;
    const result=await cachedRecommendationAsync(dir,'recommendNormalFleet',store,args,async(scope,cache)=>{
      const pool=new RecommendationPool(store,cache);
      try{const result=await recommendNormalFleetParallel(store,args,(b,f)=>pool.run(b,f),scope);await pool.flush();return result;}
      finally{await pool.dispose();}
    });
    assert.deepEqual(result,recommendNormalFleet(store,args));
  }
  const cache=new RecommendationCache(path.join(dir,'calculations'),{version:algorithmVersion(path.resolve(__dirname,'../..'))});
  const records=fs.readdirSync(cache.directory).filter(n=>n.endsWith('.bin')).map(n=>cache.read(n.slice(0,-4)).result);
  assert(records.some(r=>r.tokens.size>0&&r.entries.size>0),'worker hull entries must reach disk with their dictionary');
});


test('expedition result cache prepares both goals once and invalidates on constraints or snapshot changes',t=>{
  const {cachedExpeditionRecommendation}=require('../../src/infrastructure/cache/recommendation_cache'),r=require('../../src/recommendation/index');
  const store=require('../helpers/workbench_fixture')(),dir=directory(t),original=r.recommendExpeditionGoals;let calls=0;
  r.recommendExpeditionGoals=(...args)=>{calls++;return original(...args);};
  t.after(()=>{r.recommendExpeditionGoals=original;});
  const args={missionId:1,fleet:2,limit:1};
  const success=cachedExpeditionRecommendation(dir,store,{...args,goal:'success',snapshotId:'a'});
  const great=cachedExpeditionRecommendation(dir,store,{...args,goal:'great',snapshotId:'b'});
  assert.equal(calls,1);assert.equal(success.goal,'success');assert.equal(great.goal,'great');
  assert.deepEqual(success.goals.great,great.goals.great);assert.deepEqual(great.recommendations,great.goals.great.recommendations);
  success.goals.great.recommendations[0].scheme.ships[0].id=-99;
  assert.notEqual(cachedExpeditionRecommendation(dir,store,{...args,goal:'great'}).recommendations[0].scheme.ships[0].id,-99);
  cachedExpeditionRecommendation(dir,store,{...args,goal:'great',fixedShipIds:[1]});assert.equal(calls,2);
  store.info.ships[1].api_cond=60;cachedExpeditionRecommendation(dir,store,{...args,goal:'great'});assert.equal(calls,3);
  assert.throws(()=>cachedExpeditionRecommendation(dir,store,{...args,goal:'other'}),e=>e.code==='INVALID_QUERY');assert.equal(calls,3);
});
