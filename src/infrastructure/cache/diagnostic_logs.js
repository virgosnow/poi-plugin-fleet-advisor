'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {reserveCacheSpaceSync}=require('./disk_cache_budget');
const JOB_NAME=/^job-\d{13}-[a-f0-9-]{36}\.json$/;
const OLD_RUN=/^run-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z\.json$/;
const MAX_FILE=4*1024*1024,MAX_SYNC=1024*1024;

class DiagnosticLogs{
  constructor(root,{getLimitBytes=()=>256*1024**2,now=()=>Date.now()}={}){
    this.root=path.resolve(root);this.directory=path.join(this.root,'logs');
    this.getLimitBytes=getLimitBytes;this.now=now;this.syncFile=null;
  }
  prepare(){
    fs.mkdirSync(this.root,{recursive:true,mode:0o700});
    for(const dir of [this.root,this.directory]){
      if(dir===this.directory)fs.mkdirSync(dir,{recursive:true,mode:0o700});
      const stat=fs.lstatSync(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('日志目录不是普通目录');
    }
  }
  name(kind,extension='json'){
    return `${kind}-${String(Math.trunc(this.now())).padStart(13,'0')}-${crypto.randomUUID()}.${extension}`;
  }
  space(file,bytes){
    return reserveCacheSpaceSync(this.root,{limitBytes:this.getLimitBytes(),replace:file,bytes,now:this.now()}).fits;
  }
  write(kind,value){
    if(!['run','job'].includes(kind))return null;
    try{
      const data=JSON.stringify(value,null,2)+'\n',bytes=Buffer.byteLength(data);
      if(bytes>MAX_FILE)return null;
      this.prepare();const name=this.name(kind),file=path.join(this.directory,name);
      if(!this.space(file,bytes))return null;
      fs.writeFileSync(file,data,{flag:'wx',mode:0o600});return name;
    }catch(error){return null;}
  }
  sync(code,message){
    try{
      const data=JSON.stringify({time:new Date(this.now()).toISOString(),code,message})+'\n',bytes=Buffer.byteLength(data);
      if(bytes>MAX_SYNC)return false;
      this.prepare();let file=this.syncFile,size=0;
      if(file){try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())return false;size=stat.size;}
        catch(error){if(error.code!=='ENOENT')throw error;}}
      if(!file||size+bytes>MAX_SYNC){file=path.join(this.directory,this.name('sync','jsonl'));size=0;}
      if(!this.space(file,size+bytes))return false;
      fs.appendFileSync(file,data,{flag:size?'a':'ax',mode:0o600});this.syncFile=file;return true;
    }catch(error){return false;}
  }
  readJob(name){
    if(typeof name!=='string'||!JOB_NAME.test(name))return null;
    try{this.prepare();const file=path.join(this.directory,name),stat=fs.lstatSync(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_FILE)return null;
      return JSON.parse(fs.readFileSync(file,'utf8'));
    }catch(error){return null;}
  }
  migrateRuns(source){
    try{
      const dir=fs.lstatSync(source);if(!dir.isDirectory()||dir.isSymbolicLink())return;
      for(const name of fs.readdirSync(source)){
        if(!OLD_RUN.test(name))continue;
        const file=path.join(source,name);let stat;
        try{stat=fs.lstatSync(file);}catch(error){continue;}
        if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_FILE)continue;
        let target=null,copied=false;
        try{this.prepare();target=path.join(this.directory,this.name('run'));
          if(!this.space(target,stat.size))continue;
          fs.copyFileSync(file,target,fs.constants.COPYFILE_EXCL);copied=true;fs.unlinkSync(file);
        }catch(error){
          // Do not leave a duplicate which could be reimported after clearing.
          if(copied)try{fs.unlinkSync(target);}catch(ignore){}
        }
      }
    }catch(error){/* The old log directory is optional. */}
  }
}
module.exports={DiagnosticLogs};
