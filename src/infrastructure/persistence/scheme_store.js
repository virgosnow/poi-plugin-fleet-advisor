'use strict';
const fs=require('fs'),path=require('path');
const {randomUUID}=require('crypto');
const {setTimeout:delay}=require('timers/promises');
const {error}=require('../../shared/errors');
const {normalizeName}=require('../../shared/name_matching');
const {cacheFiles,removeCacheFile,reserveCacheSpace}=require('../cache/disk_cache_budget');
const {DEFAULTS}=require('../../config/computation_settings');

// Temporary disk-backed MCP schemes, cleared through settings with the other
// caches. Nothing here sends game requests or touches the execution lock.
const LIMIT=200;
const RETRY_DELAYS=[25,50,100,200,400];
const RETRYABLE_RENAME=new Set(['EPERM','EACCES','EBUSY']);
const iso=millis=>new Date(millis).toISOString();
const positive=value=>Number.isSafeInteger(value)&&value>0;

// Shape-only validation mirroring contract.js schemeSchema and the unified
// split in controller.js; it deliberately does not resolve names against a
// store so schemes can be saved for a future roster.
function validateSchemeShape(scheme) {
  if(!scheme||typeof scheme!=='object'||Array.isArray(scheme))
    throw error('INVALID_SCHEME','方案须为对象');
  if(!positive(scheme.fleet)||scheme.fleet>4)throw error('INVALID_SCHEME','fleet 须为 1–4');
  if(!Array.isArray(scheme.ships)||scheme.ships.length<1||scheme.ships.length>6)
    throw error('INVALID_SCHEME','ships 须为 1–6 个条目的数组');
  const equipment=spec=>{
    if(spec===null||positive(spec)||spec===-1)return;
    if(typeof spec==='string'&&spec.length>0)return;
    if(typeof spec==='object'&&!Array.isArray(spec)&&typeof spec.name==='string'&&spec.name.length>0
      &&(spec.star===undefined||Number.isSafeInteger(spec.star)&&spec.star>=0&&spec.star<=10)
      &&(spec.alv===undefined||Number.isSafeInteger(spec.alv)&&spec.alv>=0&&spec.alv<=7))return;
    throw error('INVALID_SCHEME','装备规格须为正实例 id、-1、名称字符串、null 或 {name, star?, alv?}');
  };
  for(const [index,entry] of scheme.ships.entries()){
    const at=`ships[${index}] `;
    if(positive(entry))continue;
    if(typeof entry==='string'&&entry.length>0)continue;
    if(!entry||typeof entry!=='object'||Array.isArray(entry))
      throw error('INVALID_SCHEME',at+'须为实例 id、名称字符串或 {id?, name?, slots?, ex?}');
    if(entry.id===undefined&&entry.name===undefined)throw error('INVALID_SCHEME',at+'缺 id/name');
    if(entry.id!==undefined&&!positive(entry.id))throw error('INVALID_SCHEME',at+'id 须为正整数');
    if(entry.name!==undefined&&!(typeof entry.name==='string'&&entry.name.length>0))
      throw error('INVALID_SCHEME',at+'name 须为非空字符串');
    if(entry.slots!==undefined){
      if(!Array.isArray(entry.slots)||entry.slots.length>5)throw error('INVALID_SCHEME',at+'slots 最多 5 个');
      entry.slots.forEach(equipment);
    }
    if(entry.ex!==undefined)equipment(entry.ex);
  }
  for(const key of Object.keys(scheme))
    if(!['fleet','ships','name','format','note'].includes(key))
      throw error('INVALID_SCHEME',`未知顶层字段: ${key}`);
}

class Schemes {
  constructor(storageDir,now=()=>Date.now(),{getCacheLimit=()=>DEFAULTS.cacheLimitMiB*1024**2}={}) {
    this.now=now;this.file=path.join(storageDir,'schemes.json');
    this.cacheRoot=path.join(storageDir,'recommendation-cache');this.getCacheLimit=getCacheLimit;
    this.items=new Map();this.storeError=null;this.locked=false;this.pending=Promise.resolve();
    this.load();
  }
  load() {
    if(!fs.existsSync(this.file))return;
    try{
      const saved=JSON.parse(fs.readFileSync(this.file,'utf8'));
      if(!saved||saved.version!==1||typeof saved.schemes!=='object'||Array.isArray(saved.schemes))
        throw Error('unsupported store format');
      this.items=new Map(Object.entries(saved.schemes));
    }catch(e){
      // Keep the corrupt original for inspection; only lock writes when even
      // the backup rename fails, so a later save cannot clobber the evidence.
      this.items=new Map();this.storeError=`方案库文件损坏: ${e.message}`;
      try{fs.renameSync(this.file,`${this.file}.corrupt-${this.now()}`);}
      catch(renameError){this.locked=true;this.storeError+=`；备份失败: ${renameError.message}`;}
    }
  }
  enqueue(work) {
    const result=this.pending.then(work);
    // A failed save must not poison subsequent writes or expose pending items.
    this.pending=result.catch(()=>{});
    return result;
  }
  async persist(items) {
    if(this.locked)throw error('SCHEME_STORE_UNAVAILABLE','方案库已锁定（原文件损坏且无法备份），请检查存储目录');
    const body=JSON.stringify({version:1,schemes:Object.fromEntries(items)},null,2);
    const reservation=await reserveCacheSpace(this.cacheRoot,{limitBytes:this.getCacheLimit(),replace:this.file,bytes:Buffer.byteLength(body),now:this.now()});
    if(!reservation.fits)throw error('CACHE_CAPACITY_EXCEEDED','磁盘缓存空间不足，方案未保存；请清理缓存或提高磁盘缓存上限');
    const temp=`${this.file}.${randomUUID()}.tmp`;
    try{
      await fs.promises.writeFile(temp,body,{mode:0o600,flag:'wx'});
      // Keep atomic replacement: never unlink/truncate the existing library.
      // Short Windows sharing violations may clear after a scanner releases it.
      for(let attempt=0;;attempt++){
        try{await fs.promises.rename(temp,this.file);break;}
        catch(e){
          if(!RETRYABLE_RENAME.has(e.code)||attempt>=RETRY_DELAYS.length)throw e;
          await delay(RETRY_DELAYS[attempt]);
        }
      }
    }catch(cause){
      const e=error('SCHEME_STORE_WRITE_FAILED',`配置保存失败，原配置未更改；请稍后重试或检查目录权限（${cause.code||cause.message}）`);
      e.cause=cause;throw e;
    }finally{
      // Only our private staging file; cleanup failure cannot change save status.
      await fs.promises.unlink(temp).catch(()=>{});
    }
  }
  async cacheFiles() {
    return cacheFiles(this.cacheRoot,'schemes');
  }
  inspectCache() {
    return this.enqueue(async()=>{
      try{
        const files=await this.cacheFiles();
        return {count:this.items.size,files:files.length,bytes:files.reduce((sum,f)=>sum+f.size,0)};
      }catch(e){return {count:this.items.size,files:null,bytes:null,error:e.message};}
    });
  }
  clearCache() {
    // Serialize with saves/deletions: a save queued after clearing must survive.
    return this.enqueue(async()=>{
      const files=await this.cacheFiles();let removed=0,failed=0;
      const main=files.find(f=>f.file===this.file);
      if(main&&!await removeCacheFile(main.file))return {removed:0,failed:1};
      if(main)removed++;
      this.items=new Map();this.locked=false;this.storeError=null;
      for(const file of files){
        if(file===main)continue;
        if(await removeCacheFile(file.file))removed++;else failed++;
      }
      return {removed,failed};
    });
  }
  get(name) {
    const item=this.items.get(name);
    if(!item)throw error('SCHEME_NOT_FOUND','方案不存在，先用 fleet_advisor_query_schemes 核对名称');
    return item;
  }
  list({name,search='',offset=0,limit=50}={}) {
    if(!Number.isInteger(limit)||limit<1||limit>100)throw error('INVALID_QUERY','limit 须为 1–100');
    if(!Number.isSafeInteger(offset)||offset<0)throw error('INVALID_QUERY','offset 须为非负整数');
    if(typeof search!=='string')throw error('INVALID_QUERY','search 须为字符串');
    const term=normalizeName(search.trim()).toLowerCase();
    const all=[...this.items.entries()].filter(([key])=>(name===undefined||key===name)&&(!term||normalizeName(key).toLowerCase().includes(term)))
      .sort(([a],[b])=>(a<b?-1:a>b?1:0));
    return {total:all.length,items:all.slice(offset,offset+limit)
      .map(([key,item])=>({name:key,scheme:item.scheme,createdAt:iso(item.createdAt),updatedAt:iso(item.updatedAt)}))};
  }
  set({name,scheme,overwrite=false}) {
    // Capture the caller's configuration before yielding to queued work.
    validateSchemeShape(scheme);
    scheme=JSON.parse(JSON.stringify(scheme));
    return this.enqueue(async()=>{
    if(typeof name!=='string')throw error('INVALID_QUERY','name 须为字符串');
    const trimmed=name.trim();
    if(!trimmed||trimmed.length>64)throw error('INVALID_QUERY','name 须为 1–64 个字符（去首尾空白）');
    validateSchemeShape(scheme);
    if(this.items.has(trimmed)&&!overwrite)throw error('SCHEME_NAME_EXISTS','同名方案已存在；确认覆盖请传 overwrite: true');
    if(!this.items.has(trimmed)&&this.items.size>=LIMIT)
      throw error('SCHEME_LIMIT_REACHED',`方案数已达上限 ${LIMIT}，请先删除不用的方案`);
    const existing=this.items.get(trimmed),createdAt=existing?existing.createdAt:this.now();
    // Readers keep seeing committed data throughout asynchronous retries.
    const next=new Map(this.items);
    next.set(trimmed,{scheme,createdAt,updatedAt:this.now()});
    await this.persist(next);this.items=next;
    return {name:trimmed,createdAt:iso(createdAt),updatedAt:iso(this.items.get(trimmed).updatedAt),
      overwritten:!!existing};
    });
  }
  remove(name) {
    return this.enqueue(async()=>{
      const item=this.get(name),next=new Map(this.items);next.delete(name);
      await this.persist(next);this.items=next;
      return {name,scheme:item.scheme};
    });
  }
}
module.exports={Schemes,validateSchemeShape,LIMIT};
