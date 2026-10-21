'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path'),{EventEmitter}=require('events');
const S=require('../../src/config/computation_settings');
const C=require('../../src/infrastructure/cache/recommendation_cache');
const {RecommendationWorker}=require('../../src/infrastructure/workers/recommendation_worker');
function directory(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paa-resources-'));
  t.after(()=>{assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'paa-resources-'));fs.rmSync(dir,{recursive:true,force:true});});return dir;
}
test('resource defaults migrate old settings and validate explicit budgets',()=>{
  assert.deepEqual(S.normalize(),S.DEFAULTS);assert.deepEqual(S.normalize(null),S.DEFAULTS);
  assert.equal(S.DEFAULTS.cacheLimitMiB,256);assert.deepEqual(S.LIMITS,[128,256,384,512]);
  for(const cacheLimitMiB of S.LIMITS){S.validate({cacheLimitMiB});assert.equal(S.normalize({cacheLimitMiB}).cacheLimitMiB,cacheLimitMiB);}
  for(const cacheLimitMiB of [32,64])assert.equal(S.normalize({cacheLimitMiB}).cacheLimitMiB,128,'legacy small budgets migrate to the smallest offered size');
  assert.equal(S.normalize({}).schemeCache,true);assert.equal(S.normalize({schemeCache:false}).schemeCache,false);
  assert.throws(()=>S.validate({schemeCache:0}));
  assert.equal(new C.RecommendationCache('unused').maxBytes,256*1024*1024,'each cache may use the full shared budget');
  for(const value of [{threads:9},{threads:-1},{threads:1.2},{expeditionThreads:0},{expeditionThreads:3},{expeditionThreads:1.5},{resultCache:1},{cacheLimitMiB:32},{cacheLimitMiB:64},{cacheLimitMiB:99},{cacheLimitMiB:1024},{unknown:true},null,[]])assert.throws(()=>S.validate(value));
  assert.deepEqual([1,2,4,8,32].map(cpus=>S.resources({},cpus).effectiveThreads),[1,1,2,6,6]);
  assert.equal(S.resources({threads:8},4).effectiveThreads,4);assert.equal(S.resources({threads:1},32).effectiveThreads,1);
  assert.equal(S.normalize({threads:1}).expeditionThreads,2,'legacy normal-map preferences do not disable expedition parallelism');
  assert.equal(S.resources({threads:1},32).effectiveExpeditionThreads,2);
  assert.equal(S.resources({threads:8,expeditionThreads:1},32).effectiveExpeditionThreads,1);
  assert.equal(S.resources({threads:8,expeditionThreads:1},32).effectiveThreads,8);
  assert.equal(S.resources({},1).effectiveExpeditionThreads,1);
});
for(const asyncMode of [false,true])test(`independent persistent cache switches preserve results (${asyncMode?'async':'sync'})`,async t=>{
  const {calculationTable}=require('../../src/shared/calculation_cache');
  for(const resultCache of [false,true])for(const calculationCache of [false,true]){
    const dir=directory(t),policy={resultCache,calculationCache,cacheLimitMiB:128};let evaluations=0,pure=0;
    const evaluate=()=>{evaluations++;const compute=()=>{pure++;return 42;},table=calculationTable('settings-test',{version:1});return {answer:table?table.memo('x',compute):compute()};};
    const call=store=>asyncMode?C.cachedRecommendationAsync(dir,'test',store,{},async(scope,cache)=>{
      assert.equal(!!cache.cacheDirectory,calculationCache);if(resultCache||calculationCache)assert.equal(cache.cacheMaxBytes,128*1024*1024);
      return scope(evaluate);
    },policy):C.cachedRecommendation(dir,'test',store,{},evaluate,policy);
    for(const store of [{},{},{changed:true}])assert.deepEqual(await call(store),{answer:42});
    assert.equal(evaluations,resultCache?2:3);assert.equal(pure,calculationCache?1:evaluations);
    const stats=await C.inspectCache(dir);assert.equal(stats.results.files>0,resultCache);assert.equal(stats.calculations.files>0,calculationCache);
  }
});
test('cache management removes only recognized files and rejects linked directories',async t=>{
  const root=directory(t),calc=path.join(root,'calculations'),outside=directory(t);fs.mkdirSync(calc);
  const name='a'.repeat(64)+'.bin';fs.writeFileSync(path.join(root,name),'1234');fs.writeFileSync(path.join(calc,name),'123456');
  fs.writeFileSync(path.join(root,'draft.json'),'keep');fs.mkdirSync(path.join(root,'nested'));fs.writeFileSync(path.join(root,'nested',name),'keep');
  assert.deepEqual(await C.inspectCache(root),{results:{files:1,bytes:4},calculations:{files:1,bytes:6}});
  assert.deepEqual(await C.maintainCache(root,{clear:'results'}),{removed:1,failed:0});
  assert.equal((await C.inspectCache(root)).calculations.files,1);
  assert.deepEqual(await C.maintainCache(root,{clear:'all'}),{removed:1,failed:0});
  assert.equal(fs.readFileSync(path.join(root,'draft.json'),'utf8'),'keep');assert(fs.existsSync(path.join(root,'nested',name)));
  fs.rmdirSync(calc);fs.writeFileSync(path.join(outside,name),'outside');fs.symlinkSync(outside,calc,'junction');
  await assert.rejects(C.maintainCache(root,{clear:'calculations'}),/不是普通目录/);
  assert((await C.inspectCache(root)).calculations.error);assert.equal(fs.readFileSync(path.join(outside,name),'utf8'),'outside');
  await assert.rejects(C.maintainCache(root,{clear:'../'}),/类别/);
});
test('capacity reduction and expiry trim both computation classes as one pool',async t=>{
  const root=directory(t),old=new Date(Date.now()-8*86400000);
  for(const dir of [root,path.join(root,'calculations')]){
    fs.mkdirSync(dir,{recursive:true});
    for(let i=0;i<3;i++){const file=path.join(dir,String(i).repeat(64)+'.bin');fs.writeFileSync(file,'');fs.truncateSync(file,i===0?1:33*1024*1024);fs.utimesSync(file,i===0?old:new Date(),i===0?old:new Date());}
  }
  const r=await C.maintainCache(root,{limitMiB:128});assert.equal(r.removed,3);assert.equal(r.failed,0);
  const groups=Object.values(await C.inspectCache(root));assert.equal(groups.reduce((n,g)=>n+g.files,0),3);assert(groups.reduce((n,g)=>n+g.bytes,0)<=128*1024*1024);
});
test('transient file locks retry and permanent errors are reported',async()=>{
  let calls=0;assert(await C.removeCacheFile('test',async()=>{if(++calls<3)throw Object.assign(Error('busy'),{code:'EBUSY'});}));assert.equal(calls,3);
  calls=0;assert.equal(await C.removeCacheFile('test',async()=>{calls++;throw Object.assign(Error('denied'),{code:'EIO'});}),false);assert.equal(calls,1);
});
test('maintenance is serialized with calculations and queued jobs use the latest resource settings',async()=>{
  let value={threads:2},complete;const seen=[],events=[];
  const runner=new RecommendationWorker({getSettings:()=>value,createWorker:(_file,options)=>{
    seen.push(options.workerData.settings);events.push('start');const worker=new EventEmitter();worker.terminate=async()=>{};
    complete=()=>{events.push('finish');worker.emit('message',{ok:true,result:42});};return worker;
  }});
  try{
    const first=runner.run('recommendNormalFleet',{},{});await Promise.resolve();
    const clear=runner.maintain(async()=>{events.push('clear');});
    const next=runner.run('recommendNormalFleet',{},{});assert.equal(runner.queued,3);value={threads:8,resultCache:false};
    complete();assert.equal(await first,42);await clear;await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(events,['start','finish','clear','start']);assert.equal(seen[0].threads,2);assert.equal(seen[1].threads,8);assert.equal(seen[1].resultCache,false);
    complete();await next;assert.equal(runner.queued,0);
  }finally{await runner.dispose();}
});
test('resource preferences persist, roll back failed saves and leave selection settings alone',async t=>{
  const {FleetAdvisorService}=require('../../src/application/fleet_advisor_service'),storageDir=directory(t),store=require('../helpers/workbench_fixture')();
  const options={storageDir,getStore:()=>store,controller:{dispose(){}}},service=new FleetAdvisorService(options);
  try{
    const filters=service.getRecommendationFilters();await service.setComputationSettings({threads:2,expeditionThreads:1,resultCache:false,cacheLimitMiB:512});
    assert.deepEqual(service.getRecommendationFilters(),filters);
    const reopened=new FleetAdvisorService(options);try{assert.deepEqual(reopened.getComputationSettings(),service.getComputationSettings());}finally{await reopened.dispose();}
    const previous=service.getComputationSettings();service.persist=()=>{throw Error('read only');};
    await assert.rejects(service.setComputationSettings({threads:8}),/保存失败/);assert.deepEqual(service.getComputationSettings(),previous);
    await assert.rejects(service.clearRecommendationCache(undefined),/类别/);
  }finally{await service.dispose();}
});
test('global recommendation reset persists four sections together and preserves Agent settings',async t=>{
  const {FleetAdvisorService}=require('../../src/application/fleet_advisor_service'),F=require('../../src/config/recommendation_filters');
  const storageDir=directory(t),service=new FleetAdvisorService({storageDir,getStore:require('../helpers/workbench_fixture'),controller:{dispose(){}}});
  try{
    service.mcpEnabled=true;service.httpPort=49999;
    service.setRecommendationFilters({normal:{minLevel:70,maxRoutes:9},expedition:{defaultGoal:'success',minLevel:50,excludeUnremodeled:true}});
    await service.setComputationSettings({threads:8,expeditionThreads:1,resultCache:false,calculationCache:false,cacheLimitMiB:128});
    const beforeFilters=service.getRecommendationFilters(),beforeCompute=service.getComputationSettings(),persist=service.persist.bind(service);
    service.persist=()=>{throw Error('只读');};
    await assert.rejects(service.resetRecommendationSettings(),/默认设置保存失败/);
    assert.deepEqual(service.getRecommendationFilters(),beforeFilters);assert.deepEqual(service.getComputationSettings(),beforeCompute);
    let writes=0;service.persist=()=>{writes++;persist();};
    const result=await service.resetRecommendationSettings();
    assert.equal(writes,1);assert.deepEqual(result.filters,F.normalize());assert.deepEqual(result.computation.settings,S.DEFAULTS);
    const saved=JSON.parse(fs.readFileSync(service.stateFile,'utf8'));
    assert.deepEqual(saved.recommendationFilters,F.normalize());assert.deepEqual(saved.computationSettings,S.DEFAULTS);
    assert.equal(saved.mcpEnabled,true);assert.equal(saved.httpPort,49999);
  }finally{await service.dispose();}
});

test('settings clears MCP scheme cache in memory and on disk, independently or with all caches',async t=>{
  const {FleetAdvisorService}=require('../../src/application/fleet_advisor_service');
  const storageDir=directory(t),store=require('../helpers/workbench_fixture')(),before=JSON.stringify(store);
  const service=new FleetAdvisorService({storageDir,getStore:()=>store,controller:{dispose(){}}});
  try{
    service.persist();const stateBefore=fs.readFileSync(service.stateFile,'utf8');
    const scheme={fleet:1,ships:[1]},root=service.recommendations.cacheDir,name='a'.repeat(64)+'.bin';
    fs.mkdirSync(path.join(root,'calculations'),{recursive:true});
    fs.writeFileSync(path.join(root,name),'result');fs.writeFileSync(path.join(root,'calculations',name),'calculation');
    await service.saveScheme({name:'scratch',scheme});
    const status=await service.getComputationStatus();
    assert.equal(status.cache.schemes.count,1);assert.equal(status.cache.schemes.bytes,fs.statSync(service.schemes.file).size);
    assert.equal((await service.clearRecommendationCache('results')).cache.schemes.count,1);
    const cleared=await service.clearRecommendationCache('schemes');
    assert.equal(cleared.cache.schemes.bytes,0);assert.equal(cleared.cache.calculations.files,1);
    assert.equal(service.querySchemes().total,0);assert.throws(()=>service.resolveSchemeSource({schemeName:'scratch'}),e=>e.code==='SCHEME_NOT_FOUND');
    await service.saveScheme({name:'scratch',scheme});
    const all=await service.clearRecommendationCache('all');assert.deepEqual(all.maintenance,{removed:2,failed:0});
    for(const group of Object.values(all.cache)){assert.equal(group.bytes,0);assert.equal(group.files,0);}
    assert.equal(service.querySchemes().total,0);
    const reopened=new FleetAdvisorService({storageDir,getStore:()=>store,controller:{dispose(){}}});
    try{assert.equal(reopened.querySchemes().total,0);assert.deepEqual(reopened.getComputationSettings(),service.getComputationSettings());}
    finally{await reopened.dispose();}
    assert.equal(JSON.stringify(store),before);assert.equal(fs.readFileSync(service.stateFile,'utf8'),stateBefore,'execution/settings state is not a cache');
  }finally{await service.dispose();}
});

test('all-cache cleanup still clears schemes when another cache directory cannot be inspected',async t=>{
  const {FleetAdvisorService}=require('../../src/application/fleet_advisor_service'),storageDir=directory(t);
  const service=new FleetAdvisorService({storageDir,getStore:require('../helpers/workbench_fixture'),controller:{dispose(){}}});
  try{
    await service.saveScheme({name:'temporary',scheme:{fleet:1,ships:[1]}});
    fs.writeFileSync(service.recommendations.cacheDir,'not a directory');
    const result=await service.clearRecommendationCache('all');
    assert.equal(result.maintenance.failed,1);assert.equal(result.maintenance.removed,1);
    assert(result.cache.results.error);assert.equal(result.cache.schemes.bytes,0);assert.equal(service.querySchemes().total,0);
  }finally{await service.dispose();}
});

test('scheme cache switch persists and rejects new and queued MCP saves, while reads and deletion remain available',async t=>{
  const {FleetAdvisorService}=require('../../src/application/fleet_advisor_service'),{invokeTool,publicError}=require('../../src/bridge/service_api');
  const options={storageDir:directory(t),getStore:require('../helpers/workbench_fixture'),controller:{dispose(){}}},service=new FleetAdvisorService(options);
  try{
    const args={name:'temporary',scheme:{fleet:1,ships:[1]}};
    await invokeTool(service,'fleet_advisor_save_scheme',args);
    let release,started;const running=new Promise(r=>{started=r;});
    const compute=service.recommendations.maintain(()=>{started();return new Promise(r=>{release=r;});});await running;
    const queued=invokeTool(service,'fleet_advisor_save_scheme',{...args,name:'queued'});
    const rejected=assert.rejects(queued,e=>e.code==='SCHEME_CACHE_DISABLED'&&publicError(e).nextAction.includes('inline'));
    const disabling=service.setComputationSettings({schemeCache:false});release();await compute;await rejected;await disabling;
    assert.equal(service.getStatus().schemes.enabled,false);assert.equal(service.querySchemes().total,1);
    await assert.rejects(invokeTool(service,'fleet_advisor_save_scheme',{...args,name:'new'}),e=>e.code==='SCHEME_CACHE_DISABLED');
    const reopened=new FleetAdvisorService(options);
    try{assert.equal(reopened.getComputationSettings().schemeCache,false);assert.equal(reopened.querySchemes().total,1);}
    finally{await reopened.dispose();}
    await invokeTool(service,'fleet_advisor_delete_scheme',{name:'temporary'});assert.equal(service.querySchemes().total,0);
    await service.setComputationSettings({schemeCache:true});await invokeTool(service,'fleet_advisor_save_scheme',args);
    assert.equal(service.querySchemes().total,1);
  }finally{await service.dispose();}
});

test('lowering the shared disk limit counts scheme files and does not divide remaining capacity by category',async t=>{
  const {FleetAdvisorService}=require('../../src/application/fleet_advisor_service');
  const storageDir=directory(t),service=new FleetAdvisorService({storageDir,getStore:require('../helpers/workbench_fixture'),controller:{dispose(){}}});
  try{
    await service.saveScheme({name:'temporary',scheme:{fleet:1,ships:[1]}});
    const root=service.recommendations.cacheDir;fs.mkdirSync(path.join(root,'calculations'),{recursive:true});
    const result=path.join(root,'a'.repeat(64)+'.bin'),calculation=path.join(root,'calculations','b'.repeat(64)+'.bin');
    fs.writeFileSync(result,'');fs.truncateSync(result,90*1024**2);
    fs.writeFileSync(calculation,'');fs.truncateSync(calculation,90*1024**2);
    fs.utimesSync(result,new Date(Date.now()-10000),new Date(Date.now()-10000));
    const status=await service.setComputationSettings({cacheLimitMiB:128});
    assert.equal(status.cache.results.files,0);assert.equal(status.cache.calculations.bytes,90*1024**2);
    assert.equal(status.cache.schemes.count,1);assert(Object.values(status.cache).reduce((sum,g)=>sum+g.bytes,0)<=128*1024**2);
    await service.setComputationSettings({cacheLimitMiB:256});
    fs.truncateSync(service.schemes.file,129*1024**2);
    const small=await service.setComputationSettings({cacheLimitMiB:128});
    assert.equal(small.cache.schemes.count,0);assert.equal(service.querySchemes().total,0);
    assert(Object.values(small.cache).reduce((sum,g)=>sum+g.bytes,0)<=128*1024**2);
  }finally{await service.dispose();}
});

test('shared tooltip placement stays beside its anchor and inside the CSS viewport',()=>{
  const {position}=require('../../src/ui/components/tooltip');
  assert.deepEqual(position({left:100,top:70,bottom:104},{width:240,height:50},{width:800,height:600}),{left:100,top:112});
  assert.deepEqual(position({left:700,top:550,bottom:584},{width:240,height:50},{width:800,height:600}),{left:552,top:492});
  assert.deepEqual(position({left:-20,top:2,bottom:36},{width:300,height:160},{width:320,height:180}),{left:8,top:8});
});
test('resource settings reach real workers without changing complete recommendations',async t=>{
  const store=require('../helpers/workbench_fixture')(),args={area:'2-3',byRoute:true,airGoal:'superiority'},root=directory(t);
  const expected=require('../../src/recommendation/index').recommendNormalFleet(store,args);
  for(const threads of [1,2,8]){
    const runner=new RecommendationWorker({cacheDir:root,getSettings:()=>({threads,resultCache:false,calculationCache:threads!==1,cacheLimitMiB:128})});
    try{assert.deepEqual(await runner.run('recommendNormalFleet',store,args),expected);}finally{await runner.dispose();}
  }
});
test('resource panel saves independent controls, reports failures and clears the chosen cache',async()=>{
  let saved=S.normalize(),data={settings:saved,...S.resources(saved,8,16*1024**3),busy:false,cache:{results:{files:2,bytes:100},calculations:{files:3,bytes:200},schemes:{count:2,files:1,bytes:400}}};
  const state=[data],refs=[],effects=[],patches=[],clears=[];let index=0,refIndex=0,first=true;
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),
    useState(initial){const i=index++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return [state[i],v=>{state[i]=typeof v==='function'?v(state[i]):v;}];},
    useRef(v){const i=refIndex++;return refs[i]||(refs[i]={current:v});},useEffect(fn){if(first)effects.push(fn);}};
  const service={setComputationSettings:async patch=>{patches.push(patch);saved={...saved,...patch};return data={...data,settings:saved,...S.resources(saved,8)};},
    clearRecommendationCache:async kind=>{clears.push(kind);return data={...data,cache:kind==='all'?{results:{files:0,bytes:0},calculations:{files:0,bytes:0},schemes:{count:0,files:0,bytes:0}}:{...data.cache,[kind]:{count:0,files:0,bytes:0}}};}};
  const Panel=require('../../src/ui/settings/computation_settings')(React,{getController:()=>service});
  const render=disabled=>{index=0;refIndex=0;const tree=Panel({active:false,disabled});if(first){first=false;effects.forEach(fn=>fn());}return tree;};
  const find=(n,p)=>n&&typeof n==='object'&&(p(n)?n:n.children?.map(c=>find(c,p)).find(Boolean));
  let tree=render(false);const control=label=>find(tree,n=>n.props['aria-label']===label);
  assert(find(control('计算'),n=>n.props['aria-label']==='常规图线程'));
  for(const label of ['计算','缓存文件']){
    const section=control(label),header=find(section,n=>n.props.className==='paa-settings-section-head');
    const help=find(header,n=>n.props['aria-label']===label+'说明');assert.equal(help.type,'button');assert(help.props['data-tooltip']);
  }
  assert(!find(tree,n=>n.props.className?.includes('paa-resource-control')&&find(n,c=>c.props.className==='paa-settings-help')),'resource controls have no question marks');
  assert(!find(control('计算'),n=>n.props['aria-label']==='启用底层计算缓存'));
  assert(find(control('缓存文件'),n=>n.props['aria-label']==='启用底层计算缓存'));
  const capacity=find(tree,n=>n.props.className?.includes('paa-cache-capacity')&&find(n,c=>c.props['aria-label']==='磁盘缓存上限'));
  assert(find(capacity,n=>n.props['aria-label']==='清理全部缓存'));
  assert(find(capacity,n=>n.props.className==='paa-cache-usage'&&n.children.some(c=>typeof c==='string'&&c.startsWith('已用 '))));
  assert(!find(find(control('缓存文件'),n=>n.props.className==='paa-settings-section-head'),n=>n.props['aria-label']==='清理全部缓存'),'cache heading has no detached cleanup action');
  assert(find(capacity,n=>n.children.includes('已用 700 B')));
  assert(find(tree,n=>n.children.includes('400 B · 2 个方案')));
  assert(control('启用编成方案缓存').props.checked);
  assert.equal(control('磁盘缓存上限').props.value,256);
  assert.deepEqual(control('磁盘缓存上限').children.map(n=>[n.props.value,n.children[0]]),[[128,'128 MiB'],[256,'256 MiB（默认）'],[384,'384 MiB'],[512,'512 MiB']]);
  assert(!/逻辑处理器|GiB 内存|最多使用/.test(JSON.stringify(tree)));
  await control('常规图线程').props.onChange({target:{value:'2'}});tree=render(false);assert.equal(control('常规图线程').props.value,2);assert.deepEqual(patches[0],{threads:2});
  assert.equal(control('远征线程').props.value,2);
  assert.deepEqual(control('远征线程').children.map(n=>n.props.value),[2,1]);
  await control('远征线程').props.onChange({target:{value:'1'}});tree=render(false);
  assert.equal(control('远征线程').props.value,1);assert.equal(control('常规图线程').props.value,2);
  assert.deepEqual(patches[1],{expeditionThreads:1});
  await control('磁盘缓存上限').props.onChange({target:{value:'512'}});tree=render(false);
  assert.equal(control('磁盘缓存上限').props.value,512);assert.deepEqual(patches[2],{cacheLimitMiB:512});
  await control('启用完整推荐缓存').props.onChange({target:{checked:false}});tree=render(false);assert(!control('启用完整推荐缓存').props.checked);assert(control('启用底层计算缓存').props.checked);
  await control('启用编成方案缓存').props.onChange({target:{checked:false}});tree=render(false);assert(!control('启用编成方案缓存').props.checked);assert.deepEqual(patches.at(-1),{schemeCache:false});
  assert(!control('清理编成方案缓存').props.disabled,'disabled storage can still be cleared');
  await control('清理完整推荐缓存').props.onClick();tree=render(false);assert.deepEqual(clears,['results']);assert(control('清理完整推荐缓存').props.disabled);assert(!control('清理底层计算缓存').props.disabled);
  await control('清理底层计算缓存').props.onClick();tree=render(false);assert(!control('清理全部缓存').props.disabled,'scheme-only cache is still clearable');
  await control('清理编成方案缓存').props.onClick();tree=render(false);assert(control('清理编成方案缓存').props.disabled);
  data={...data,cache:{...data.cache,schemes:{count:1,files:1,bytes:250}}};state[0]=data;tree=render(false);
  await control('清理全部缓存').props.onClick();tree=render(false);assert.deepEqual(clears,['results','calculations','schemes','all']);assert(control('清理全部缓存').props.disabled);assert(control('清理底层计算缓存').props.disabled);assert(control('清理编成方案缓存').props.disabled);
  service.setComputationSettings=async()=>{throw Error('磁盘不可写');};await control('常规图线程').props.onChange({target:{value:'8'}});tree=render(false);
  assert.equal(control('常规图线程').props.value,2);const field=find(tree,n=>n.props.className==='paa-settings-value'&&find(n,c=>c.props['aria-label']==='常规图线程'));
  assert(find(field,n=>n.props.role==='alert'&&n.props['data-tooltip']==='磁盘不可写'));
  assert(!find(control('缓存文件'),n=>n.props.role==='alert'));
  tree=render(true);assert(control('常规图线程').props.disabled);assert(control('远征线程').props.disabled);assert(control('清理底层计算缓存').props.disabled);assert(control('启用编成方案缓存').props.disabled);
});

test('expedition worker uses one child by default, no child in serial mode or on paired cache hits',async t=>{
  const dir=directory(t),hook=path.join(dir,'probe.cjs'),store=require('../helpers/workbench_fixture')();
  fs.writeFileSync(hook,`const w=require('worker_threads');if(w.workerData?.probe){const stats=new Int32Array(w.workerData.probe),Native=w.Worker;w.Worker=function(file,options){const child=new Native(file,options);if(options.workerData?.kind==='expedition-goal'){Atomics.add(stats,0,1);const n=Atomics.add(stats,1,1)+1;Atomics.store(stats,2,Math.max(n,Atomics.load(stats,2)));child.once('exit',()=>{Atomics.sub(stats,1,1);Atomics.add(stats,3,1);});}return child;};}`);
  const args={missionId:1,fleet:2,limit:3},expected=require('../../src/recommendation/index').recommendExpeditionGoals(store,args),before=JSON.stringify(store);
  let settings={threads:1,resultCache:false,calculationCache:true},probe;
  const runner=new RecommendationWorker({cacheDir:dir,getSettings:()=>settings,createWorker:(file,options)=>{
    probe=new Int32Array(new SharedArrayBuffer(16));return new (require('worker_threads').Worker)(file,
      {...options,execArgv:['--require',hook],workerData:{...options.workerData,probe:probe.buffer}});
  }});
  try{
    for(const expeditionThreads of [undefined,1,2]){
      settings={...settings,threads:expeditionThreads===1?8:1,expeditionThreads};
      const result=await runner.run('recommendExpeditionFleet',store,{...args,goal:'great'});
      assert.deepEqual(result.goals,expected);assert.deepEqual(result.recommendations,expected.great.recommendations);
      const children=S.resources(settings).effectiveExpeditionThreads-1;
      assert.equal(probe[0],children);assert.equal(probe[2],children);assert.equal(probe[1],0);assert.equal(probe[3],children);
    }
    settings={...settings,expeditionThreads:2,resultCache:true};
    await runner.run('recommendExpeditionFleet',store,args);
    assert.equal(probe[0],S.resources(settings).effectiveExpeditionThreads-1);
    settings={...settings,threads:8,expeditionThreads:1};
    const hit=await runner.run('recommendExpeditionFleet',store,{...args,goal:'great',snapshotId:'changed-transport-id'});
    assert.deepEqual(hit.goals,expected);assert.equal(probe[0],0,'both thread modes read the same complete paired cache');
    assert.equal(JSON.stringify(store),before);
  }finally{await runner.dispose();}
});
