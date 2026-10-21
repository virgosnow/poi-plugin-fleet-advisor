'use strict';
const fs=require('fs'),path=require('path'),os=require('os');
const {MapResourceCache,MAX_BYTES}=require('../infrastructure/cache/map_resource_cache');

function validUrl(value){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password)throw Error('无效的静态资源地址');
  return url.href;
}

// net.request is available in older Electron/poi versions without session.fetch.
// Both paths use poi's default session, including its configured network proxy.
function requestResource(net,session,url,timeoutMs=15000){
  return new Promise((resolve,reject)=>{
    let done=false,size=0,timer;const chunks=[];
    const request=net.request({url:validUrl(url),session});
    const finish=(error,buffer)=>{if(done)return;done=true;clearTimeout(timer);if(error){request.abort();reject(error);}else resolve(buffer);};
    timer=setTimeout(()=>finish(Error('海图下载超时')),timeoutMs);
    request.on('error',error=>finish(error));
    request.on('response',response=>{
      if(response.statusCode!==200){finish(Error('海图下载失败'));return;}
      response.on('error',error=>finish(error));
      response.on('aborted',()=>finish(Error('海图下载中断')));
      response.on('data',chunk=>{size+=chunk.length;if(size>MAX_BYTES)finish(Error('海图资源过大'));else chunks.push(Buffer.from(chunk));});
      response.on('end',()=>finish(null,Buffer.concat(chunks)));
    });
    request.end();
  });
}

function hostRemote(){try{return require('@electron/remote');}catch(error){return require('electron').remote;}}
function createPoiMapResources({remote=hostRemote(),directory=path.join(os.homedir(),'.poi-plugin-fleet-advisor','map-cache')}={}){
  let modern,config,cacheDirectory;
  try{modern=remote.require('./lib/kcs-resource').readKcsResource;}catch(error){/* Older poi. */}
  try{config=remote.require('./lib/config');cacheDirectory=config.get('poi.misc.cache.path',remote.getGlobal('DEFAULT_CACHE_PATH'));}catch(error){/* No shared disk cache. */}
  const electron=remote.require('electron'),session=electron.session.defaultSession,net=electron.net;
  const fetchResource=async url=>{
    url=validUrl(url);
    if(typeof session.fetch!=='function')return requestResource(net,session,url);
    const response=await session.fetch(url);
    if(!response.ok)throw Error('海图下载失败');
    const length=Number(response.headers?.get('content-length'));
    if(length>MAX_BYTES)throw Error('海图资源过大');
    const buffer=Buffer.from(await response.arrayBuffer());
    if(buffer.length>MAX_BYTES)throw Error('海图资源过大');
    return buffer;
  };
  return new MapResourceCache({directory,fetchResource,readResource:async(resource,ip)=>{
    // Never reconfigure poi's resource handlers or intercept game requests.
    if(typeof modern==='function')return modern(resource,ip);
    if(typeof cacheDirectory==='string'){
      try{return await fs.promises.readFile(path.join(cacheDirectory,'KanColle',resource));}catch(error){/* Fetch below. */}
    }
    return undefined;
  }});
}
module.exports={createPoiMapResources,requestResource};
