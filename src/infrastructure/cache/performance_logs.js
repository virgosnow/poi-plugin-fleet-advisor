'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {reserveCacheSpace}=require('./disk_cache_budget');
const {summarize}=require('../../shared/performance_trace');
const NAME=/^[a-z][a-zA-Z0-9_.-]{0,95}$/;
const numbers=(value,keys)=>Object.fromEntries(keys.filter(key=>Number.isFinite(value?.[key])&&value[key]>=0).map(key=>[key,value[key]]));
const counters=value=>Object.fromEntries(Object.entries(value||{}).filter(([key,n])=>NAME.test(key)&&Number.isFinite(n)&&n>=0));
function traceData(value){
  return {spans:(value?.spans||[]).slice(0,512).filter(row=>NAME.test(row.name)).map(row=>
    ({name:row.name,...numbers(row,['calls','totalMs','selfMs'])})),counters:counters(value?.counters)};
}
// Explicit schema: callers can never accidentally dump snapshots, request
// arguments, raw errors, ship/equipment instances or arbitrary debug payloads.
function sanitize(report){
  return {version:1,status:report.status==='error'?'error':'success',level:report.level==='modules'?'modules':'stages',
    implementation:/^[a-f0-9]{64}$/.test(report.implementation)?report.implementation:null,
    method:['recommendNormalFleet','recommendNormalEquipment','recommendExpeditionFleet','recommendExpeditionEquipment'].includes(report.method)?report.method:null,
    area:/^\d-\d$/.test(report.area)?report.area:null,phase:/^gauge\d(?:Or\d)?$/.test(report.phase)?report.phase:null,
    ...numbers(report,['elapsedMs','queueMs','workerMs','startupAndTransferMs','teardownMs']),...traceData(report),
    runtime:{...Object.fromEntries(Object.entries(report.runtime||{}).filter(([key,v])=>['plugin','node','v8'].includes(key)&&/^[0-9][a-zA-Z0-9.-]{0,63}$/.test(v))),
      ...(['utility-process','worker-thread'].includes(report.runtime?.execution)?{execution:report.runtime.execution}:{}),
      ...(typeof report.runtime?.prewarmed==='boolean'?{prewarmed:report.runtime.prewarmed}:{}),
      ...numbers(report.runtime,['peakRssMiB','preloadMs'])},
    stages:(report.stages||[]).slice(0,2048).filter(row=>NAME.test(row.name)).map(row=>({name:row.name,...numbers(row,['ms'])})),
    children:(report.children||[]).slice(0,8).map(child=>({...numbers(child,['worker','startupMs']),...traceData(child),
      calculationStats:Object.fromEntries(Object.entries(child.calculationStats||{}).filter(([name])=>NAME.test(name))
        .map(([name,value])=>[name,counters(value)]))})),
    dispatch:(report.dispatch||[]).slice(0,256).filter(row=>NAME.test(row.kind)).map(row=>
      ({kind:row.kind,...numbers(row,['worker','batches','items','roundTripMs','computeMs'])}))};
}
class PerformanceLogs {
  constructor(root,{getLimitBytes=()=>256*1024**2,now=()=>Date.now()}={}){
    this.root=path.resolve(root);this.directory=path.join(this.root,'logs');this.getLimitBytes=getLimitBytes;this.now=now;
    this.pending=Promise.resolve();this.lastError=null;
  }
  write(report){
    const task=this.pending.then(()=>this.save(report));this.pending=task.catch(()=>{});return task;
  }
  async save(report){
    let temporary;
    try{
      const now=this.now(),profile=sanitize(report),data=JSON.stringify({version:1,createdAt:new Date(now).toISOString(),summary:summarize(profile),profile},null,2)+'\n';
      const bytes=Buffer.byteLength(data),limitBytes=this.getLimitBytes();
      if(bytes>4*1024**2||bytes>limitBytes)throw Error('性能日志超过缓存容量，未保存');
      await fs.promises.mkdir(this.root,{recursive:true,mode:0o700});
      for(const dir of [this.root,this.directory]){
        if(dir===this.directory)await fs.promises.mkdir(dir,{recursive:true,mode:0o700});
        const stat=await fs.promises.lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('性能日志目录不是普通目录');
      }
      const reservation=await reserveCacheSpace(this.root,{limitBytes,bytes,now});
      if(!reservation.fits)throw Error('缓存空间不足或文件被占用，性能日志未保存');
      const file=path.join(this.directory,`performance-${String(now).padStart(13,'0')}-${crypto.randomUUID()}.json`);
      temporary=file+'.'+crypto.randomUUID()+'.tmp';
      await fs.promises.writeFile(temporary,data,{flag:'wx',mode:0o600});
      for(let attempt=0;;attempt++)try{await fs.promises.rename(temporary,file);break;}
      catch(error){if(!['EBUSY','EPERM','EACCES'].includes(error.code)||attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,40*(attempt+1)));}
      await reserveCacheSpace(this.root,{limitBytes,now});
      this.lastError=null;return {saved:true};
    }catch(error){this.lastError=error.code?'性能日志写入失败：'+error.code:error.message;return {saved:false,error:this.lastError};}
    finally{if(temporary)try{await fs.promises.unlink(temporary);}catch(_){};}
  }
}
module.exports={PerformanceLogs,sanitize};
