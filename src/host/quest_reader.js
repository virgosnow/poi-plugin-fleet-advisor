'use strict';
const crypto=require('node:crypto');
const PORT='/kcsapi/api_port/port';
const QUIET_MS=2000;

// This function runs in the game frame. It observes input without replacing
// handlers or modifying the game, and never returns a URL or credentials.
async function frameOperation(key,action,args={}){
  const root=globalThis;
  const nativeSource=/^function(?:\s+[A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*\{\s*\[native code\]\s*\}$/;
  let watch=root[key];
  if(action==='install'&&!watch){
    const describe=Function.prototype.toString;
    let nativeFetch=null;
    try{
      if(nativeSource.test(describe.call(describe))&&typeof root.fetch==='function'&&
        nativeSource.test(describe.call(root.fetch)))nativeFetch=root.fetch;
    }catch(error){/* A replaced inspection function or fetch is unsupported. */}
    watch={installedAt:Date.now(),lastInputAt:0,inputCount:0,
      documentId:String(Date.now())+':'+Math.random(),href:location.href,read:null,describe,nativeFetch};
    watch.listen=()=>{watch.lastInputAt=Date.now();watch.inputCount++;watch.read?.abort();};
    for(const name of ['pointerdown','pointerup','wheel','keydown'])
      document.addEventListener(name,watch.listen,{capture:true,passive:true});
    Object.defineProperty(root,key,{value:watch,configurable:true});
  }
  if(!watch)return {deferred:true};
  if(action==='dispose'){
    watch.read?.abort();
    for(const name of ['pointerdown','pointerup','wheel','keydown'])
      document.removeEventListener(name,watch.listen,{capture:true});
    delete root[key];return null;
  }
  if(action==='abort'){watch.read?.abort();return null;}
  // Keep the native function in its own frame. Never replace fetch or forward
  // its result through poi's XHR bridge, which would generate game.response.
  let nativeFetch=false;
  try{
    nativeFetch=!!watch.nativeFetch&&root.fetch===watch.nativeFetch&&Function.prototype.toString===watch.describe&&
      nativeSource.test(watch.describe.call(watch.describe))&&nativeSource.test(watch.describe.call(watch.nativeFetch));
  }catch(error){}
  const canvas=document.querySelector('canvas'),rect=canvas?.getBoundingClientRect();
  const style=canvas&&getComputedStyle(canvas);
  const visible=!!canvas&&canvas.isConnected!==false&&!!rect&&rect.width>0&&rect.height>0&&
    style?.display!=='none'&&style?.visibility!=='hidden'&&style?.opacity!=='0'&&
    document.visibilityState!=='hidden';
  const current=watch.href===location.href;
  const probe={documentId:watch.documentId,installedAt:watch.installedAt,
    inputCount:watch.inputCount,lastInputAt:watch.lastInputAt,visible,current,nativeFetch};
  if(action!=='read')return probe;
  if(!nativeFetch||!current||!visible||watch.read||watch.documentId!==args.documentId||
    watch.inputCount!==args.inputCount||
    Date.now()-Math.max(watch.installedAt,watch.lastInputAt)<2000)return {deferred:true};
  const token=new URL(location.href).searchParams.get('api_token');
  if(!token)return {deferred:true};
  const abort=new AbortController();watch.read=abort;
  const timer=setTimeout(()=>abort.abort(),10000);
  try{
    const response=await watch.nativeFetch.call(root,new URL('/kcsapi/api_get_member/questlist',location.origin).href,{
      method:'POST',credentials:'same-origin',signal:abort.signal,
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({api_verno:'1',api_token:token,api_tab_id:'0'}).toString()
    });
    if(!response.ok)throw new Error('Quest list unavailable');
    const payload=JSON.parse((await response.text()).replace(/^svdata=/,''));
    if(abort.signal.aborted||watch.href!==location.href||watch.inputCount!==args.inputCount)
      throw new Error('Quest read interrupted');
    if(payload.api_result!==1||!payload.api_data||!Array.isArray(payload.api_data.api_list))
      throw new Error('Quest list unavailable');
    // Return only task-list fields. A malformed response cannot export a
    // credential or an arbitrary object from the game context.
    const data=payload.api_data,list={api_list:[]};
    for(const field of ['api_count','api_page_count','api_disp_page','api_exec_count'])
      if(Number.isFinite(data[field]))list[field]=data[field];
    for(const row of data.api_list){
      if(row===-1){list.api_list.push(-1);continue;}
      if(!row||!Number.isInteger(row.api_no)||row.api_no<1)throw new Error('Quest list unavailable');
      const task={};
      for(const field of ['api_no','api_category','api_type','api_state','api_progress_flag','api_daily_flag','api_bonus_flag','api_invalid_flag'])
        if(Number.isFinite(row[field]))task[field]=row[field];
      for(const field of ['api_title','api_detail'])if(typeof row[field]==='string')task[field]=row[field];
      if(Array.isArray(row.api_get_material)&&row.api_get_material.every(Number.isFinite))task.api_get_material=row.api_get_material.slice();
      list.api_list.push(task);
    }
    return {list};
  }catch(error){throw new Error(abort.signal.aborted?'Quest read interrupted':'Quest list unavailable');}
  finally{clearTimeout(timer);if(watch.read===abort)watch.read=null;}
}

function apiPath(detail){
  const path=detail?.path;
  return typeof path==='string'&&/^\/kcsapi\/[a-z0-9_]+\/[a-z0-9_]+$/.test(path)?path:null;
}
async function bounded(operation,timeout){
  let timer;
  try{return await Promise.race([operation,new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error('Quest host unavailable')),timeout);
  })]);}finally{clearTimeout(timer);}
}

class QuestReader{
  constructor({window,getRemote,getStore,now=()=>Date.now(),isBusy=()=>false,
    observeScreen}={}){
    this.window=window;this.getRemote=getRemote;this.getStore=getStore;this.now=now;this.isBusy=isBusy;
    this.observeScreen=observeScreen||(async(buffer)=>{
      const {Observer}=require('../vision/observers');
      return new Observer().observe('screen',buffer);
    });
    this.key='__fleetAdvisorQuestRead_'+crypto.randomBytes(12).toString('hex');
    this.portAt=null;this.lastApiAt=Number(now());this.epoch=0;
    this.failed=false;this.closed=false;this.sessionKey=null;this.frame=null;this.wc=null;
    this.frames=new Set();this.documentId=null;this.ticket=null;this.reading=false;
    // Install the passive listener as early as possible, before the first
    // port response. If discovery is too early, later context probes retry it.
    this.installation=this.installEarly();
  }
  execute(frame,action,args){
    return bounded(frame.executeJavaScript(`(${frameOperation.toString()})(${JSON.stringify(this.key)},${JSON.stringify(action)},${JSON.stringify(args||{})})`),action==='read'?12000:1500);
  }
  discover(){
    const ref=this.window?.getStore('layout.webview.ref');
    if(!ref)return null;
    const wc=typeof ref.getWebContentsId==='function'?this.getRemote?.()?.webContents?.fromId(ref.getWebContentsId()):
      typeof ref.getWebContents==='function'?ref.getWebContents():ref;
    if(!wc||wc.isDestroyed?.())return null;
    const candidates=(wc.mainFrame?.framesInSubtree||[]).filter(frame=>{
      try{const url=new URL(frame.url);return /^https?:$/.test(url.protocol)&&/^\/kcs2\/index\.(php|html)$/.test(url.pathname)&&url.searchParams.has('api_token');}
      catch(error){return false;}
    });
    if(candidates.length!==1||typeof candidates[0].executeJavaScript!=='function')return null;
    return {wc,frame:candidates[0]};
  }
  async installEarly(){
    try{const target=this.discover();if(target){this.frames.add(target.frame);await this.execute(target.frame,'install');}}
    catch(error){/* Discovery is optional until a context probe succeeds. */}
  }
  invalidate(){this.epoch++;this.ticket=null;}
  observeRequest(detail){
    if(this.closed)return;
    const path=apiPath(detail);if(!path)return this.observeFailure();
    // poi emits game.request on XHR load, not send. These notifications only
    // establish recent activity; they cannot count requests still in flight.
    this.lastApiAt=Number(this.now());this.invalidate();
  }
  observeResponse(detail){
    if(this.closed)return;
    const path=apiPath(detail);if(!path)return this.observeFailure();
    this.lastApiAt=Number(this.now());this.invalidate();
    if(path===PORT&&detail?.body&&typeof detail.body==='object'&&
      (detail.body.api_result==null||Number(detail.body.api_result)===1)){
      this.failed=false;this.portAt=this.lastApiAt;
    }else if(path===PORT){
      this.observeFailure();
    }else if(detail?.body?.api_result!=null&&Number(detail.body.api_result)!==1){this.observeFailure();}
  }
  observeFailure(){
    if(this.closed)return;
    // No precise in-flight state is available through these notifications.
    // A failed game operation requires a fresh successful port response.
    this.failed=true;this.portAt=null;this.lastApiAt=Number(this.now());this.invalidate();
  }
  observeError(){this.observeFailure();}
  observeStart(){
    this.observeFailure();this.sessionKey=null;this.documentId=null;
    this.installation=this.installEarly();
  }
  safeTimeline(){
    const time=Number(this.now());
    return !this.closed&&!this.failed&&this.portAt!==null&&!this.isBusy()&&
      time>=this.lastApiAt&&time-this.lastApiAt>=QUIET_MS;
  }
  async context({cached=false}={}){
    const result={ready:false,idle:false,compatible:false,sessionKey:null};
    if(this.closed)return result;
    this.ticket=null;
    try{
      const target=this.discover(),state=this.getStore?.();
      if(!target)return result;
      const member=state?.info?.basic?.api_member_id;
      if(member==null||String(member)==='')return result;
      // The URL is used only within this expression; retain only its hash.
      const sessionKey=crypto.createHash('sha256').update(String(member)+'|'+target.frame.url).digest('hex');
      const changed=this.sessionKey&&this.sessionKey!==sessionKey;
      if(changed){this.observeFailure();this.documentId=null;}
      this.sessionKey=sessionKey;result.sessionKey=sessionKey;result.ready=true;
      if(cached)return result;
      await this.installation;
      if(this.closed)return {...result,ready:false};
      this.frames.add(target.frame);
      const before=await this.execute(target.frame,'install');
      result.compatible=before.nativeFetch===true;
      if(this.documentId&&this.documentId!==before.documentId)this.observeFailure();
      this.documentId=before.documentId;this.frame=target.frame;this.wc=target.wc;
      if(!result.compatible||!this.safeTimeline()||this.reading||!before.current||!before.visible||
        before.installedAt>this.portAt||before.lastInputAt>this.portAt||
        Number(this.now())-Math.max(before.installedAt,before.lastInputAt)<QUIET_MS)return result;
      const epoch=this.epoch;
      if(typeof target.wc.capturePage!=='function')return result;
      const image=await bounded(target.wc.capturePage(),1500),buffer=image?.toPNG?.();
      // Reuse the calibrated normalization for high-DPI captures. No image
      // or account pixels are written to disk.
      const {Pixels}=require('../vision/pixels');
      const normalized=Pixels.decode(buffer).normalize();
      const screen=await this.observeScreen(normalized);
      if(!screen?.valid||screen.mode!=='home')return result;
      const after=await this.execute(target.frame,'probe');
      result.compatible=after.nativeFetch===true;
      const latest=this.discover();
      if(!result.compatible||!latest||latest.frame!==target.frame||this.epoch!==epoch||!this.safeTimeline()||
        !after.current||!after.visible||after.documentId!==before.documentId||after.inputCount!==before.inputCount)return result;
      const latestMember=this.getStore?.()?.info?.basic?.api_member_id;
      if(latestMember==null||crypto.createHash('sha256').update(String(latestMember)+'|'+latest.frame.url).digest('hex')!==sessionKey)return result;
      this.ticket={...target,epoch,documentId:after.documentId,inputCount:after.inputCount,portAt:this.portAt,sessionKey};
      result.idle=true;return result;
    }catch(error){return result;}
  }
  async read({signal,sessionKey}={}){
    if(this.closed||this.reading||signal?.aborted)return {deferred:true};
    const context=await this.context();
    const ticket=this.ticket;
    if(signal?.aborted||!context.idle||!context.compatible||!ticket||context.sessionKey!==sessionKey||
      this.epoch!==ticket.epoch||!this.safeTimeline())return {deferred:true};
    this.reading=true;
    const abort=()=>{void Promise.resolve(this.execute(ticket.frame,'abort')).catch(()=>{});};
    signal?.addEventListener('abort',abort,{once:true});
    try{
      if(signal?.aborted||this.closed)return {deferred:true};
      return await this.execute(ticket.frame,'read',{documentId:ticket.documentId,
        inputCount:ticket.inputCount});
    }catch(error){throw new Error('Quest list unavailable');}
    finally{signal?.removeEventListener('abort',abort);this.reading=false;this.ticket=null;}
  }
  async dispose(){
    if(this.closed)return;
    this.closed=true;this.invalidate();
    await this.installation;
    await Promise.allSettled([...this.frames].map(frame=>this.execute(frame,'dispose')));
    this.frames.clear();this.frame=null;this.wc=null;
  }
}
module.exports={QuestReader};
