'use strict';
const fs=require('fs'),path=require('path');
const {DEFAULTS}=require('../../config/computation_settings');
const SCHEME_FILE=/^schemes\.json(?:\.corrupt-\d+|\.[a-f0-9-]{36}\.tmp)?$/;
const COMPUTATION_FILE=/^[a-f0-9]{64}(?:\.bin|\.[a-f0-9-]{36}\.tmp)$/;
const LOG_FILE=/^performance-\d{13}-[a-f0-9-]{36}\.json(?:\.[a-f0-9-]{36}\.tmp)?$/;
const KINDS=['results','calculations','schemes','logs'];
const TTL=7*24*60*60*1000;

function location(root,kind){
  root=path.resolve(root);
  if(!KINDS.includes(kind))throw Error('无效的缓存类别');
  const directory=kind==='schemes'?path.dirname(root):['calculations','logs'].includes(kind)?path.join(root,kind):root;
  return {directory,folders:new Set(kind==='schemes'?[directory]:[root,directory]),
    pattern:kind==='schemes'?SCHEME_FILE:kind==='logs'?LOG_FILE:COMPUTATION_FILE};
}
function checkDirectory(stat){if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('缓存目录不是普通目录');}
function record(file,stat,kind){
  if(!stat.isFile()||stat.isSymbolicLink())throw Error('缓存文件不是普通文件');
  return {file,size:stat.size,time:stat.mtimeMs,kind,primary:kind==='schemes'&&path.basename(file)==='schemes.json'};
}
// Exact owned paths only; never recurse, follow links or deserialize payloads.
async function cacheFiles(root,kind){
  const {directory,folders,pattern}=location(root,kind),files=[];
  for(const folder of folders)try{checkDirectory(await fs.promises.lstat(folder));}
  catch(e){if(e.code==='ENOENT')return files;throw e;}
  for(const name of await fs.promises.readdir(directory)){
    if(!pattern.test(name))continue;
    const file=path.join(directory,name);
    try{files.push(record(file,await fs.promises.lstat(file),kind));}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  return files;
}
function cacheFilesSync(root,kind){
  const {directory,folders,pattern}=location(root,kind),files=[];
  for(const folder of folders)try{checkDirectory(fs.lstatSync(folder));}
  catch(e){if(e.code==='ENOENT')return files;throw e;}
  for(const name of fs.readdirSync(directory)){
    if(!pattern.test(name))continue;
    const file=path.join(directory,name);
    try{files.push(record(file,fs.lstatSync(file),kind));}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  return files;
}
async function removeCacheFile(file,unlink=fs.promises.unlink.bind(fs.promises)){
  for(let attempt=0;attempt<3;attempt++)try{await unlink(file);return true;}
  catch(e){if(e.code==='ENOENT')return true;if(!['EBUSY','EPERM','EACCES'].includes(e.code)||attempt===2)return false;
    await new Promise(resolve=>setTimeout(resolve,40*(attempt+1)));}
}

// A single pool, without per-category byte quotas. The application serializes
// scheme writes with the owning recommendation worker. Child workers only read.
// Primary schemes are protected here because only Schemes may update its memory;
// the application can clear them if a reduced limit cannot hold that file.
function* evictions(files,{limitBytes=DEFAULTS.cacheLimitMiB*1024**2,replace,bytes=0,now=Date.now(),maxEntries=64}={}){
  if(!Number.isSafeInteger(limitBytes)||limitBytes<0||!Number.isSafeInteger(bytes)||bytes<0)throw Error('无效的缓存容量');
  const remaining=files.filter(f=>f.file!==replace),expired=new Set();
  let total=remaining.reduce((sum,f)=>sum+f.size,bytes),removed=0,failed=0;
  if(bytes>limitBytes)return {removed,failed,fits:false,bytes:total};
  for(const kind of ['results','calculations','logs']){
    const group=remaining.filter(f=>f.kind===kind).sort((a,b)=>b.time-a.time);
    group.forEach((file,i)=>{if(now-file.time>TTL||i>=maxEntries)expired.add(file);});
  }
  const candidates=remaining.filter(f=>!f.primary).sort((a,b)=>Number(expired.has(b))-Number(expired.has(a))||a.time-b.time||a.file.localeCompare(b.file));
  for(const file of candidates){
    if(total<=limitBytes&&!expired.has(file))continue;
    if(yield file){total-=file.size;removed++;}else failed++;
  }
  return {removed,failed,fits:total<=limitBytes,bytes:total};
}
async function reserveCacheSpace(root,options){
  const files=(await Promise.all(KINDS.map(kind=>cacheFiles(root,kind)))).flat();
  const plan=evictions(files,options);let step=plan.next();
  while(!step.done)step=plan.next(await removeCacheFile(step.value.file));
  return step.value;
}
function reserveCacheSpaceSync(root,options){
  const plan=evictions(KINDS.flatMap(kind=>cacheFilesSync(root,kind)),options);let step=plan.next();
  while(!step.done){
    let removed=true;
    try{fs.unlinkSync(step.value.file);}catch(e){removed=e.code==='ENOENT';}
    step=plan.next(removed);
  }
  return step.value;
}
module.exports={cacheFiles,cacheFilesSync,removeCacheFile,reserveCacheSpace,reserveCacheSpaceSync};
