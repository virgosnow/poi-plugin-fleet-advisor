'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),{performance}=require('node:perf_hooks');

// Settings APIs are synchronous. Keep retries short and bounded instead of
// reporting a transient Windows sharing violation as a failed save.
const DELAYS=[20,40,80,160,320],LOCKED=new Set(['EPERM','EACCES','EBUSY']);
const sleeper=typeof SharedArrayBuffer==='function'?new Int32Array(new SharedArrayBuffer(4)):null;
function delay(ms){
  if(sleeper)try{Atomics.wait(sleeper,0,0,ms);return;}catch(_){}
  // Electron renderers can disable SharedArrayBuffer. The existing settings
  // contract is synchronous, so a short bounded wait is needed on that path.
  const until=performance.now()+ms;while(performance.now()<until){}
}
function retry(operation,wait=delay){
  for(let attempt=0;;attempt++)try{return operation();}
  catch(error){if(!LOCKED.has(error?.code)||attempt>=DELAYS.length)throw error;wait(DELAYS[attempt]);}
}
function atomicWriteSync(file,contents,{io=fs,wait=delay,uuid=crypto.randomUUID}={}){
  const temp=`${file}.${uuid()}.tmp`;let owned=false;
  try{
    const fd=retry(()=>io.openSync(temp,'wx',0o600),wait);owned=true;
    try{io.writeFileSync(fd,contents);}finally{io.closeSync(fd);}
    retry(()=>io.renameSync(temp,file),wait);owned=false;
  }finally{
    // Never remove the destination or a temp file belonging to another writer.
    if(owned)try{io.unlinkSync(temp);}catch(_){}
  }
}
module.exports={atomicWriteSync};
