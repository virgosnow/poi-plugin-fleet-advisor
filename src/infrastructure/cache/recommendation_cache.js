'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),v8=require('v8');
const settings=require('../../config/computation_settings');
const perf=require('../../shared/performance_trace');
const {cacheFiles,removeCacheFile,reserveCacheSpace,reserveCacheSpaceSync}=require('./disk_cache_budget');
const MAX_BYTES=settings.DEFAULTS.cacheLimitMiB*1024*1024,MAX_ENTRIES=64,TTL=7*24*60*60*1000;
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const ENTRY=/^[a-f0-9]{64}\.bin$/;
const TEMP=/^[a-f0-9]{64}\.[a-f0-9-]{36}\.tmp$/;

// Run in the calculation worker, including all disk I/O and snapshot hashing.
// Hash file contents, not mtimes or the package version (hot updates may keep
// that version). A new worker loads the same source/data covered by this hash.
function algorithmVersion(root){
  const hash=crypto.createHash('sha256').update('recommendation-cache-v1').update(JSON.stringify(process.versions));
  const walk=directory=>{
    for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
      const file=path.join(directory,entry.name);
      if(entry.isDirectory())walk(file);
      else if(/\.(js|json)$/.test(entry.name))hash.update(path.relative(root,file)).update('\0').update(fs.readFileSync(file)).update('\0');
    }
  };
  walk(path.join(root,'src'));walk(path.join(root,'data'));
  hash.update(fs.readFileSync(path.join(root,'package.json')));
  // npm excludes package-lock.json from the published tarball.
  const lock=path.join(root,'package-lock.json');if(fs.existsSync(lock))hash.update(fs.readFileSync(lock));
  return hash.digest('hex');
}

class RecommendationCache {
  constructor(directory,{version,now=()=>Date.now(),maxEntries=MAX_ENTRIES,maxBytes=MAX_BYTES,budgetRoot}={}){
    this.directory=directory;this.version=version;this.now=now;this.maxEntries=maxEntries;this.maxBytes=maxBytes;this.budgetRoot=budgetRoot;
  }
  key(method,store,args){
    // Snapshot UUID is transport metadata. Hash the complete actual input,
    // including planning copies, inventory, masters, fixed/held slots and all
    // filters. Deliberately conservative: no selection of supposedly irrelevant
    // account fields that could silently become relevant to future algorithms.
    const {snapshotId,...options}=args;
    return digest(JSON.stringify([this.version,method,store,options]));
  }
  read(key){
    try{
      const file=path.join(this.directory,key+'.bin'),stat=fs.statSync(file);
      if(stat.size>this.maxBytes||this.now()-stat.mtimeMs>TTL)return null;
      const entry=v8.deserialize(fs.readFileSync(file));
      if(entry.key!==key||!Buffer.isBuffer(entry.payload)||digest(entry.payload)!==entry.digest)return null;
      return {result:v8.deserialize(entry.payload)};
    }catch(_){return null;}
  }
  write(key,result){
    let temporary;
    try{
      const payload=v8.serialize(result),bytes=v8.serialize({key,payload,digest:digest(payload)});
      if(bytes.length>this.maxBytes)return;
      if(this.budgetRoot&&!reserveCacheSpaceSync(this.budgetRoot,{limitBytes:this.maxBytes,replace:path.resolve(this.directory,key+'.bin'),bytes:bytes.length,now:this.now()}).fits)return;
      fs.mkdirSync(this.directory,{recursive:true,mode:0o700});
      temporary=path.join(this.directory,key+'.'+crypto.randomUUID()+'.tmp');
      fs.writeFileSync(temporary,bytes,{flag:'wx',mode:0o600});
      fs.renameSync(temporary,path.join(this.directory,key+'.bin'));
      this.prune();
    }catch(_){/* Optional cache failure must never fail a recommendation. */}
    finally{if(temporary)try{fs.unlinkSync(temporary);}catch(_){}}
  }
  prune(){
    const files=[];
    for(const name of fs.readdirSync(this.directory)){
      if(!ENTRY.test(name)&&!TEMP.test(name))continue;
      const file=path.join(this.directory,name),stat=fs.statSync(file);
      if(this.now()-stat.mtimeMs>TTL){try{fs.unlinkSync(file);}catch(_){};continue;}
      files.push({file,size:stat.size,time:stat.mtimeMs});
    }
    files.sort((a,b)=>b.time-a.time);let bytes=0;
    for(const [index,file] of files.entries()){
      bytes+=file.size;
      if(index>=this.maxEntries||bytes>this.maxBytes)try{fs.unlinkSync(file.file);}catch(_){}
    }
  }
}

function caches(directory,options){
  const policy=settings.normalize(options),maxBytes=policy.cacheLimitMiB*1024*1024;
  if(directory&&(policy.resultCache||policy.calculationCache))try{
    const version=algorithmVersion(path.join(__dirname,'../../..'));
    return {version,maxBytes,result:policy.resultCache?new RecommendationCache(directory,{version,maxBytes,budgetRoot:directory}):null,
      calculation:policy.calculationCache?new RecommendationCache(path.join(directory,'calculations'),{version,maxBytes,budgetRoot:directory}):null};
  }catch(_){/* Optional storage must not prevent calculation. */}
  return {};
}
function cacheKey(cache,method,store,args){try{return cache?.key(method,store,args);}catch(_){return null;}}
function prepare(directory,method,store,args,options){
  return perf.stage('cache.prepare',()=>{
    const cache=caches(directory,options),key=cacheKey(cache.result,method,store,args);
    const trace=perf.current();if(trace&&cache.version)trace.implementation=cache.version;
    const entry=key?cache.result.read(key):null;
    perf.count(entry?'cache.result.hit':key?'cache.result.miss':'cache.result.disabled');
    return {cache,key,entry};
  });
}
function calculationStats(cache){
  if(!perf.current()||!cache)return;
  for(const [name,stats]of Object.entries(cache.stats))
    for(const [kind,value]of Object.entries(stats))perf.count('calculation.'+name+'.'+kind,value);
}
function cachedRecommendation(directory,method,store,args,calculate,options){
  const {cache,key,entry}=prepare(directory,method,store,args,options);if(entry)return entry.result;
  const {CalculationCache,withCalculationCache}=require('../../shared/calculation_cache');
  const calculations=cache.calculation?new CalculationCache(cache.calculation):null;
  const result=calculations?withCalculationCache(calculations,calculate,{flush:false}):calculate();
  perf.stage('cache.persist',()=>{calculations?.flush();if(key)cache.result.write(key,result);});calculationStats(calculations);
  return result;
}
async function cachedRecommendationAsync(directory,method,store,args,calculate,options){
  const {cache,key,entry}=prepare(directory,method,store,args,options);if(entry)return entry.result;
  const {CalculationCache,withCalculationCache}=require('../../shared/calculation_cache');
  const cacheDirectory=cache.calculation?.directory;
  const calculations=cache.calculation?new CalculationCache(cache.calculation):null;
  // Scope each synchronous continuation separately; never expose a snapshot's
  // cache to unrelated work while the coordinator awaits its child workers.
  const scope=fn=>calculations?withCalculationCache(calculations,fn,{flush:false}):fn();
  const result=await calculate(scope,{cacheDirectory,version:cache.version,cacheMaxBytes:cache.maxBytes,mergeEquipmentEntries:records=>calculations?.mergeEquipmentEntries(records),
    mergeHullEntries:records=>calculations?.mergeHullEntries(records)});
  perf.stage('cache.persist',()=>{calculations?.flush();if(key)cache.result.write(key,result);});calculationStats(calculations);
  return result;
}

// Both goals share the complete snapshot and manual constraints. Displaying
// the other goal reuses this pair instead of running another fleet search.
function cachedExpeditionRecommendation(directory,store,args,options){
  const {goal='success',...query}=args;
  if(!['success','great'].includes(goal))throw require('../../application/snapshots').error('INVALID_QUERY','goal 须为 success 或 great');
  const goals=cachedRecommendation(directory,'recommendExpeditionGoals',store,query,
    ()=>require('../../recommendation/index').recommendExpeditionGoals(store,query),options);
  return {...goals[goal],goals};
}
async function cachedExpeditionRecommendationAsync(directory,store,args,calculate,options){
  const {goal='success',...query}=args;
  if(!['success','great'].includes(goal))throw require('../../application/snapshots').error('INVALID_QUERY','goal 须为 success 或 great');
  const goals=await cachedRecommendationAsync(directory,'recommendExpeditionGoals',store,query,
    (scope,cache)=>calculate(query,scope,cache),options);
  return {...goals[goal],goals};
}

async function inspectCache(root){
  const result={};
  for(const kind of ['results','calculations','logs']){
    try{const files=await cacheFiles(root,kind);result[kind]={files:files.length,bytes:files.reduce((n,f)=>n+f.size,0)};}
    catch(e){result[kind]={files:null,bytes:null,error:e.message};}
  }
  return result;
}
async function maintainCache(root,{clear,limitMiB=settings.DEFAULTS.cacheLimitMiB}={}){
  if(clear&&!['results','calculations','logs','all'].includes(clear))throw Error('无效的缓存类别');
  if(!settings.LIMITS.includes(limitMiB))throw Error('无效的缓存容量');
  if(!clear){
    const result=await reserveCacheSpace(root,{limitBytes:limitMiB*1024**2});
    return {removed:result.removed,failed:result.failed,...(!result.fits?{overLimit:result.bytes-limitMiB*1024**2}: {})};
  }
  let removed=0,failed=0;
  for(const kind of ['results','calculations','logs']){
    if(clear!=='all'&&clear!==kind)continue;
    for(const file of await cacheFiles(root,kind)){
      if(await removeCacheFile(file.file))removed++;else failed++;
    }
  }
  return {removed,failed};
}
module.exports={RecommendationCache,algorithmVersion,cachedRecommendation,cachedRecommendationAsync,cachedExpeditionRecommendation,cachedExpeditionRecommendationAsync,inspectCache,maintainCache,removeCacheFile};
