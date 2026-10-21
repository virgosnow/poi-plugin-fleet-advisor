'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {pathToFileURL}=require('url');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const MAX_BYTES=16*1024*1024;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function validateImage(data,resource){
  const buffer=Buffer.from(data||[]);
  if(buffer.length<33||buffer.length>MAX_BYTES||buffer.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||
    buffer.toString('ascii',12,16)!=='IHDR'||buffer.readUInt32BE(16)!==resource.width||
    buffer.readUInt32BE(20)!==resource.height||hash(buffer)!==resource.sha256)
    throw Object.assign(Error('海图资源与当前坐标资料不匹配'),{code:'MAP_VERSION_MISMATCH'});
  return buffer;
}

// Only immutable, verified game images are stored here. No account state,
// navigation decisions or executable content enters this cache.
class MapResourceCache {
  constructor({directory,readResource,fetchResource,timeoutMs=15000}){
    this.directory=directory;this.readResource=readResource;this.fetchResource=fetchResource;
    this.timeoutMs=timeoutMs;this.pending=new Map();this.ready=new Map();
  }
  async timed(action){
    let timer;
    try{return await Promise.race([Promise.resolve().then(action),new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(Error('海图读取超时')),this.timeoutMs);
    })]);}finally{clearTimeout(timer);}
  }
  async persist(resource,buffer){
    const file=path.join(this.directory,resource.sha256+'.png');
    let temporary;
    try{
      await fs.promises.mkdir(this.directory,{recursive:true});
      temporary=file+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';
      await fs.promises.writeFile(temporary,buffer,{flag:'wx'});
      for(let attempt=0;;attempt++){
        try{await fs.promises.rename(temporary,file);break;}
        catch(error){if(!['EBUSY','EPERM','EACCES'].includes(error.code)||attempt===3)throw error;
          await pause(50*(attempt+1));}
      }
      return {image:pathToFileURL(file).href,persisted:true};
    }catch(error){
      // A read-only/full disk must not hide an otherwise available map.
      return {image:'data:image/png;base64,'+buffer.toString('base64'),persisted:false,
        warning:'海图缓存未能保存，本次仍可显示；请检查磁盘空间或目录权限。'};
    }finally{if(temporary)await fs.promises.unlink(temporary).catch(()=>{});}
  }
  async loadResource(resource,serverIp){
    if(!/^[a-f0-9]{64}$/.test(resource.sha256)||!/^\/kcs2\/resources\/map\/\d{3}\/\d{2}_image\d*\.png$/.test(resource.path)||
      !Number.isInteger(resource.width)||!Number.isInteger(resource.height)||resource.width<1||resource.height<1||
      resource.width*resource.height>32*1024*1024)throw Error('无效的海图资源索引');
    const key=resource.sha256;
    if(this.ready.has(key))return this.ready.get(key);
    if(this.pending.has(key))return this.pending.get(key);
    const task=(async()=>{
      const file=path.join(this.directory,key+'.png');
      try{
        validateImage(await fs.promises.readFile(file),resource);
        return {image:pathToFileURL(file).href,persisted:true,source:'plugin-cache'};
      }catch(error){/* Cache miss or damaged file: fetch and atomically replace. */}
      const attempts=[
        this.readResource&&(()=>this.readResource(resource.path,serverIp)),
        serverIp&&this.fetchResource&&(()=>this.fetchResource(`https://${serverIp}${resource.path}`)),
        resource.fallbackUrl&&this.fetchResource&&(()=>this.fetchResource(resource.fallbackUrl))
      ].filter(Boolean);
      let mismatch=false;
      for(const read of attempts){
        try{
          const buffer=validateImage(await this.timed(read),resource);
          return {...await this.persist(resource,buffer),source:'poi'};
        }catch(error){mismatch=mismatch||error.code==='MAP_VERSION_MISMATCH';}
      }
      throw Error(mismatch?'海图暂未加载：资源与坐标版本不一致，请更新插件资料后重试':'海图暂未加载，请检查网络后重试');
    })();
    this.pending.set(key,task);
    try{const value=await task;this.ready.set(key,value);return value;}
    finally{this.pending.delete(key);}
  }
  async loadMap(map,serverIp){
    if(!map?.resources?.length)throw Error('缺少海图资源索引');
    const parts=await Promise.all(map.resources.map(async resource=>({
      ...await this.loadResource(resource,serverIp),width:resource.width,height:resource.height,offsetY:resource.offsetY
    })));
    return {status:'ready',parts,persisted:parts.every(p=>p.persisted),warning:parts.find(p=>p.warning)?.warning};
  }
}
module.exports={MapResourceCache,validateImage,MAX_BYTES};
