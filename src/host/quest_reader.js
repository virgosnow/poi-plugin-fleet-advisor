'use strict';
const crypto=require('node:crypto');
const retry=require('../infrastructure/sync/retry_policy');
const PORT='/kcsapi/api_port/port';
const START_DATA='/kcsapi/api_start2/getData';
const QUIET_MS=2000;

// This function runs in the game frame. It observes input without replacing
// handlers or modifying the game, and never returns a URL or credentials.
async function frameOperation(key,action,args={}){
  const root=globalThis;
  const nativeSource=/^function(?:\s+[A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*\{\s*\[native code\]\s*\}$/;
  let watch=root[key];
  if(action==='install'&&watch&&watch.href!==location.href){
    watch.read?.abort();
    for(const name of ['pointerdown','pointerup','wheel','keydown'])document.removeEventListener(name,watch.listen,{capture:true});
    delete root[key];watch=null;
  }
  if(action==='install'&&!watch){
    const describe=Function.prototype.toString;
    let nativeFetch=null;
    try{
      if(nativeSource.test(describe.call(describe))&&typeof root.fetch==='function'&&
        nativeSource.test(describe.call(root.fetch)))nativeFetch=root.fetch;
    }catch(error){/* A replaced inspection function or fetch is unsupported. */}
    // timeOrigin is scoped to this document and survives plugin reloads.
    // For older hosts keep a non-sensitive per-document fallback on the frame.
    const fallbackKey='__fleetAdvisorDocumentIdentity';
    if(!(typeof performance!=='undefined'&&Number.isFinite(performance.timeOrigin))&&!root[fallbackKey])
      Object.defineProperty(root,fallbackKey,{value:String(Date.now())+':'+Math.random(),configurable:false});
    const documentId=typeof performance!=='undefined'&&Number.isFinite(performance.timeOrigin)?String(performance.timeOrigin):root[fallbackKey];
    watch={installedAt:Date.now(),lastInputAt:0,inputCount:0,
      documentId,href:location.href,read:null,describe,nativeFetch};
    watch.listen=()=>{watch.lastInputAt=Date.now();watch.inputCount++;watch.read?.abort();};
    for(const name of ['pointerdown','pointerup','wheel','keydown'])
      document.addEventListener(name,watch.listen,{capture:true,passive:true});
    Object.defineProperty(root,key,{value:watch,configurable:true});
  }
  // A host may temporarily wrap fetch while the plugin is starting. Retry
  // discovery only when no native function was captured in this document.
  if(action==='install'&&watch&&!watch.nativeFetch&&!watch.read){
    const describe=Function.prototype.toString;
    try{
      if(nativeSource.test(describe.call(describe))&&typeof root.fetch==='function'&&
        nativeSource.test(describe.call(root.fetch))){watch.describe=describe;watch.nativeFetch=root.fetch;}
    }catch(error){/* Keep waiting for the original native functions. */}
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
  // A background/minimized game document can be perfectly valid. Rendering
  // visibility and screen capture are not preconditions for a read-only API.
  const canvas=document.querySelector('canvas');
  const attached=!!canvas&&canvas.isConnected!==false&&(!document.readyState||document.readyState==='complete');
  const current=watch.href===location.href;
  const probe={documentId:watch.documentId,installedAt:watch.installedAt,
    inputCount:watch.inputCount,lastInputAt:watch.lastInputAt,attached,current,nativeFetch};
  if(action!=='read')return probe;
  if(!nativeFetch||!current||!attached||watch.read||watch.documentId!==args.documentId||
    watch.inputCount!==args.inputCount||
    Date.now()-Math.max(watch.installedAt,watch.lastInputAt)<2000)return {deferred:true};
  const token=new URL(location.href).searchParams.get('api_token');
  if(!token)return {deferred:true};
  const abort=new AbortController();watch.read=abort;
  const timer=setTimeout(()=>abort.abort('timeout'),10000),kind=args.kind||'quest';
  let sent=false;
  try{
    if(!['identity','quest','practice','practice-enemy','mapinfo','presets','missions'].includes(kind)||kind==='practice-enemy'&&(!Number.isSafeInteger(args.enemyId)||args.enemyId<1))throw new Error('Invalid read');
    const endpoint=({quest:'/kcsapi/api_get_member/questlist',practice:'/kcsapi/api_get_member/practice',
      'practice-enemy':'/kcsapi/api_req_member/get_practice_enemyinfo',mapinfo:'/kcsapi/api_get_member/mapinfo',
      presets:'/kcsapi/api_get_member/preset_deck',missions:'/kcsapi/api_get_member/mission',identity:'/kcsapi/api_get_member/basic'})[kind];
    sent=true;
    const response=await watch.nativeFetch.call(root,new URL(endpoint,location.origin).href,{
      method:'POST',credentials:'same-origin',signal:abort.signal,
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({api_verno:'1',api_token:token,...(kind==='quest'?{api_tab_id:'0',
        ...(Number.isInteger(args.page)?{api_page_no:String(args.page)}:{})}:kind==='practice-enemy'?{api_member_id:String(args.enemyId)}:{})}).toString()
    });
    if(!response.ok)throw new Error('Quest list unavailable');
    const payload=JSON.parse((await response.text()).replace(/^svdata=/,''));
    if(abort.signal.aborted||watch.href!==location.href||watch.inputCount!==args.inputCount)
      throw new Error('Quest read interrupted');
    if(payload.api_result!==1||!payload.api_data)throw new Error('Read unavailable');
    if(kind==='identity')return {identityMatch:String(payload.api_data.api_member_id??'')===String(args.expectedMember??'')&&String(args.expectedMember??'')!==''};
    const fields=(row,names)=>Object.fromEntries(names.filter(k=>Number.isFinite(row?.[k])).map(k=>[k,row[k]]));
    if(kind==='mapinfo'){
      const data=payload.api_data,rows=data.api_map_info,bases=data.api_air_base;
      if(!Array.isArray(rows)||rows.length>500||!rows.some(row=>row?.api_id===11)||rows.some(row=>!Number.isSafeInteger(row?.api_id)||row.api_id<1)||new Set(rows.map(row=>row.api_id)).size!==rows.length||
        !Array.isArray(bases)||bases.length>100||bases.some(row=>!Array.isArray(row?.api_plane_info)||row.api_plane_info.length>10||
          row.api_plane_info.some(p=>!Number.isSafeInteger(p?.api_slotid))))throw new Error('Read unavailable');
      const maps=rows.map(row=>({...fields(row,['api_id','api_cleared','api_defeat_count','api_required_defeat_count','api_gauge_num','api_gauge_type','api_gauge_type_e','api_s_no','api_air_base_decks']),
        ...(Array.isArray(row.api_sally_flag)&&row.api_sally_flag.every(Number.isFinite)?{api_sally_flag:row.api_sally_flag.slice()}:{}),
        ...(row.api_eventmap&&typeof row.api_eventmap==='object'?{api_eventmap:fields(row.api_eventmap,['api_limit_flag','api_max_maphp','api_now_maphp','api_selected_rank','api_state'])}:{})}));
      const airbase=bases?.map(row=>({...fields(row,['api_action_kind','api_area_id','api_rid']),
        ...(typeof row.api_name==='string'?{api_name:row.api_name}:{}),
        ...(row.api_distance&&typeof row.api_distance==='object'?{api_distance:fields(row.api_distance,['api_base','api_bonus'])}:{}),
        api_plane_info:row.api_plane_info.map(p=>fields(p,['api_cond','api_count','api_max_count','api_slotid','api_squadron_id','api_state']))}));
      if(airbase?.some(row=>!Number.isSafeInteger(row.api_area_id)||!Number.isSafeInteger(row.api_rid)))throw new Error('Read unavailable');
      return {mapinfo:{maps,airbase}};
    }
    if(kind==='presets'){
      const data=payload.api_data,deck=data.api_deck;
      if(!Number.isSafeInteger(data.api_max_num)||data.api_max_num<0||!deck||typeof deck!=='object'||Array.isArray(deck)||Object.keys(deck).length>100)throw new Error('Read unavailable');
      const entries=Object.entries(deck).map(([key,row])=>{
        if(!/^\d+$/.test(key)||!row||!Array.isArray(row.api_ship)||row.api_ship.length>7||!row.api_ship.every(Number.isSafeInteger))throw new Error('Read unavailable');
        return [key,{...fields(row,['api_preset_no','api_lock_flag']),...(typeof row.api_name==='string'?{api_name:row.api_name}:{}),api_ship:row.api_ship.slice()}];
      });
      return {presets:{api_max_num:data.api_max_num,api_deck:Object.fromEntries(entries)}};
    }
    if(kind==='missions'){
      const data=payload.api_data,rows=Array.isArray(data)?data:data.api_list_items||data.api_list;
      if(!Array.isArray(rows)||!rows.length||rows.length>1000||rows.some(row=>!Number.isSafeInteger(row?.api_mission_id)||row.api_mission_id<1))throw new Error('Read unavailable');
      return {missions:{...(Number.isFinite(data?.api_limit_time)?{api_limit_time:data.api_limit_time}:
        Array.isArray(data?.api_limit_time)&&data.api_limit_time.length<=10&&data.api_limit_time.every(Number.isFinite)?{api_limit_time:data.api_limit_time.slice()}:{}),
        api_list_items:rows.map(row=>fields(row,['api_mission_id','api_state']))}};
    }
    if(kind==='practice'){
      const rows=payload.api_data.api_list;
      if(!Array.isArray(rows)||rows.length>5||rows.some(row=>!row||!Number.isSafeInteger(row.api_enemy_id)||row.api_enemy_id<1))throw new Error('Read unavailable');
      return {list:{api_list:rows.map(row=>({api_enemy_id:row.api_enemy_id,
        ...Object.fromEntries(['api_enemy_name','api_enemy_rank','api_enemy_comment'].filter(k=>typeof row[k]==='string').map(k=>[k,row[k].slice(0,512)])),
        ...Object.fromEntries(['api_enemy_level','api_enemy_flag_ship','api_state'].filter(k=>Number.isFinite(row[k])).map(k=>[k,row[k]]))}))}};
    }
    if(kind==='practice-enemy'){
      const data=payload.api_data,ships=data.api_deck?.api_ships;
      if(Number(data.api_member_id)!==args.enemyId||!Array.isArray(ships)||ships.length>7)throw new Error('Read unavailable');
      return {enemy:{api_member_id:args.enemyId,...(typeof data.api_cmt==='string'?{api_cmt:data.api_cmt.slice(0,512)}:{}),api_deck:{api_ships:ships.filter(s=>s&&Number.isSafeInteger(s.api_ship_id)&&s.api_ship_id>0)
        .map(s=>({api_ship_id:s.api_ship_id,...(Number.isFinite(s.api_level)?{api_level:s.api_level}:{})}))}}};
    }
    if(
      !Array.isArray(payload.api_data.api_list)&&!(payload.api_data.api_count===0&&payload.api_data.api_list==null))
      throw new Error('Quest list unavailable');
    // Return only task-list fields. A malformed response cannot export a
    // credential or an arbitrary object from the game context.
    const data=payload.api_data,list={api_list:[]};
    for(const field of ['api_count','api_page_count','api_disp_page','api_exec_count'])
      if(Number.isFinite(data[field]))list[field]=data[field];
    for(const row of data.api_list||[]){
      if(row===-1){list.api_list.push(-1);continue;}
      if(!row||!Number.isInteger(row.api_no)||row.api_no<1)throw new Error('Quest list unavailable');
      const task={};
      for(const field of ['api_no','api_category','api_type','api_label_type','api_state','api_progress_flag','api_daily_flag','api_bonus_flag','api_invalid_flag'])
        if(Number.isFinite(row[field]))task[field]=row[field];
      for(const field of ['api_title','api_detail'])if(typeof row[field]==='string')task[field]=row[field];
      if(Array.isArray(row.api_get_material)&&row.api_get_material.every(Number.isFinite))task.api_get_material=row.api_get_material.slice();
      if(Array.isArray(row.api_select_rewards)&&row.api_select_rewards.length<=20&&row.api_select_rewards.every(group=>Array.isArray(group)&&group.length<=20))
        task.api_select_rewards=row.api_select_rewards.map(group=>group.filter(item=>item&&['api_no','api_kind','api_mst_id','api_count'].every(key=>Number.isSafeInteger(item[key]))).map(item=>
          ({api_no:item.api_no,api_kind:item.api_kind,api_mst_id:item.api_mst_id,api_count:item.api_count,
            ...Number.isSafeInteger(item.api_slotitem_level)&&item.api_slotitem_level>=0&&item.api_slotitem_level<=10?{api_slotitem_level:item.api_slotitem_level}:{}})));
      list.api_list.push(task);
    }
    return {list};
  }catch(error){if(kind!=='quest'&&abort.signal.aborted&&abort.signal.reason!=='timeout')return {deferred:true,...(sent?{attempted:true}:{})};
    throw new Error(abort.signal.aborted?'Quest read interrupted':'Quest list unavailable');}
  finally{clearTimeout(timer);if(watch.read===abort)watch.read=null;}
}

function apiPath(detail){
  const path=detail?.path;
  return typeof path==='string'&&(path===START_DATA||/^\/kcsapi\/[a-z0-9_]+\/[a-z0-9_]+$/.test(path))?path:null;
}
async function bounded(operation,timeout){
  let timer;
  try{return await Promise.race([operation,new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error('Quest host unavailable')),timeout);
  })]);}finally{clearTimeout(timer);}
}

class QuestReader{
  constructor({window,getRemote,getStore,now=()=>Date.now(),isBusy=()=>false,onDiagnostic=()=>{}}={}){
    this.window=window;this.getRemote=getRemote;this.getStore=getStore;this.now=now;this.isBusy=isBusy;
    this.onDiagnostic=onDiagnostic;
    this.key='__fleetAdvisorQuestRead_'+crypto.randomBytes(12).toString('hex');
    this.portAt=null;this.lastApiAt=Number(now());this.epoch=0;
    this.failed=false;this.closed=false;this.sessionKey=null;this.verifiedSessionKey=null;this.frame=null;this.wc=null;
    this.pausedSession=null;this.sessionFailures=0;this.sessionRetryAt=0;
    this.identitySession=null;this.identityFailures=0;this.identityRetryAt=0;
    this.frames=new Set();this.documentId=null;this.loginBarrier=null;this.startDataSeen=false;this.loginReady=false;this.ticket=null;this.reading=false;
    // Attach the passive input observer as soon as the game frame exists.
    // If discovery is too early, later context probes retry it.
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
    if(path===START_DATA&&(detail?.body?.api_result==null||Number(detail.body.api_result)===1))this.startDataSeen=true;
    if(path===PORT&&detail?.body&&typeof detail.body==='object'&&
      (detail.body.api_result==null||Number(detail.body.api_result)===1)){
      this.failed=false;this.resumeSession();this.portAt=this.lastApiAt;
      if(this.startDataSeen)this.loginReady=true;
    }else if(path===PORT){
      this.observeFailure({suspend:true});
    }else if(detail?.body?.api_result!=null&&Number(detail.body.api_result)!==1){this.observeFailure({suspend:true});}
    else if(Number(detail?.body?.api_result)===1&&!this.loginBarrier){this.resumeSession();}
  }
  observeFailure({suspend=false}={}){
    if(this.closed)return;
    // A recent error invalidates identity and restarts the quiet interval.
    this.failed=true;this.verifiedSessionKey=null;this.portAt=null;this.startDataSeen=false;this.loginReady=false;this.lastApiAt=Number(this.now());this.invalidate();
    if(suspend)this.pauseSession(this.sessionKey);
  }
  observeError(){this.observeFailure();}
  observeStart(){
    // poi emits game.start for both main.js and start2, including twice in
    // the same document. Keep the previous frame blocked until navigation or
    // a complete start2 -> port sequence, followed by account validation.
    // If login starts before the previous document was observed, its identity
    // is unknown. A new successful login port must settle that ambiguity.
    this.loginBarrier=this.documentId||'unobserved';
    this.startDataSeen=false;this.loginReady=false;
    this.resetIdentity(null);
    this.observeFailure();this.sessionKey=null;this.documentId=null;
    this.installation=this.installEarly();
  }
  safeTimeline(){
    const time=Number(this.now());
    return !this.closed&&!this.isBusy()&&
      time>=this.lastApiAt&&time-this.lastApiAt>=QUIET_MS;
  }
  resetIdentity(sessionKey){
    this.identitySession=sessionKey;this.identityFailures=0;this.identityRetryAt=0;this.verifiedSessionKey=null;
  }
  pauseSession(sessionKey,reason='session_unavailable'){
    const key=sessionKey||'pending',now=Number(this.now());
    if(this.pausedSession!==key){this.pausedSession=key;this.sessionFailures=0;this.sessionRetryAt=0;}
    this.verifiedSessionKey=null;this.ticket=null;
    // Multiple notifications for the same failure must not consume retries.
    if(!retry.exhausted(this.sessionFailures)&&now>=this.sessionRetryAt)this.sessionFailures++;
    const blocked=retry.exhausted(this.sessionFailures);
    if(!blocked&&now>=this.sessionRetryAt)this.sessionRetryAt=now+retry.retryDelay(this.sessionFailures);
    this.diagnostic(blocked?'session_paused':'session_backoff');
    return {deferred:true,attempted:true,blocked,reason,...!blocked?{retryAt:this.sessionRetryAt}:{}};
  }
  resumeSession(){
    if(this.pausedSession!==null){this.pausedSession=null;this.sessionFailures=0;this.sessionRetryAt=0;this.resetIdentity(this.sessionKey);}
  }
  deferIdentity(sessionKey,reason){
    this.diagnostic(reason);
    if(this.identitySession!==sessionKey)this.resetIdentity(sessionKey);
    this.identityFailures=Math.min(this.identityFailures+1,16);
    this.identityRetryAt=Number(this.now())+Math.min(300000,2000*2**(this.identityFailures-1));
    return {deferred:true,attempted:true,reason,retryAt:this.identityRetryAt};
  }
  diagnostic(code){try{this.onDiagnostic(code);}catch(error){/* Diagnostics must never block synchronization. */}}
  async context({cached=false}={}){
    const result={ready:false,idle:false,compatible:false,sessionKey:null};
    if(this.closed)return result;
    this.ticket=null;
    try{
      const target=this.discover(),state=this.getStore?.();
      if(!target){this.diagnostic('frame_unavailable');return result;}
      const member=state?.info?.basic?.api_member_id;
      if(member==null||String(member)===''){this.diagnostic('account_unavailable');return result;}
      await this.installation;
      if(this.closed)return {...result,ready:false};
      this.frames.add(target.frame);
      const before=await this.execute(target.frame,'install');
      result.compatible=before.nativeFetch===true;
      if(!before.documentId||!before.current||!before.attached){this.diagnostic('document_unready');return result;}
      if(this.loginBarrier&&(
        this.loginBarrier==='unobserved'?this.portAt===null:before.documentId===this.loginBarrier&&!this.loginReady)){this.diagnostic('session_transition');return result;}
      this.loginBarrier=null;
      const frameIdentity=[target.wc.id??'',target.frame.processId??'',target.frame.routingId??'',before.documentId];
      // Never persist or return the URL, token, member ID or raw document key.
      const sessionKey=crypto.createHash('sha256').update(JSON.stringify([String(member),target.frame.url,frameIdentity])).digest('hex');
      const changed=this.sessionKey&&this.sessionKey!==sessionKey;
      if(changed){this.observeFailure();this.resumeSession();this.documentId=null;this.resetIdentity(sessionKey);}
      this.sessionKey=sessionKey;result.sessionKey=sessionKey;result.ready=true;
      result.identityVerified=this.verifiedSessionKey===sessionKey;
      if(!result.compatible)this.diagnostic('transport_unavailable');
      this.documentId=before.documentId;this.frame=target.frame;this.wc=target.wc;
      if(this.pausedSession===sessionKey||this.pausedSession==='pending'){
        if(retry.exhausted(this.sessionFailures))return {...result,blocked:true,reason:'session_paused'};
        if(Number(this.now())<this.sessionRetryAt)return {...result,backoff:true,reason:'session_backoff',retryAt:this.sessionRetryAt};
      }
      if(cached)return result;
      if(!result.compatible||!this.safeTimeline()||this.reading||
        Number(this.now())-Math.max(before.installedAt,before.lastInputAt)<QUIET_MS){
        if(result.compatible)this.diagnostic('waiting_idle');return result;
      }
      const epoch=this.epoch;
      const after=await this.execute(target.frame,'probe');
      result.compatible=after.nativeFetch===true;
      const latest=this.discover();
      if(!result.compatible||!latest||latest.frame!==target.frame||this.epoch!==epoch||!this.safeTimeline()||
        !after.current||!after.attached||after.documentId!==before.documentId||after.inputCount!==before.inputCount)return result;
      const latestMember=this.getStore?.()?.info?.basic?.api_member_id;
      if(latestMember==null||crypto.createHash('sha256').update(JSON.stringify([String(latestMember),latest.frame.url,frameIdentity])).digest('hex')!==sessionKey)return result;
      this.ticket={...target,epoch,documentId:after.documentId,inputCount:after.inputCount,member:String(member),sessionKey};
      result.idle=true;return result;
    }catch(error){this.diagnostic('context_failed');return result;}
  }
  async read({signal,sessionKey,page,kind='quest',enemyId,countSuccess=true}={}){
    if(this.closed||this.reading||signal?.aborted)return {deferred:true};
    const context=await this.context();
    if(context.blocked)return {deferred:true,blocked:true,reason:context.reason};
    if(context.backoff)return {deferred:true,reason:context.reason,retryAt:context.retryAt};
    const ticket=this.ticket;
    if(signal?.aborted||this.reading||!context.idle||!context.compatible||!ticket||context.sessionKey!==sessionKey||
      this.epoch!==ticket.epoch||!this.safeTimeline())return {deferred:true};
    this.reading=true;
    const abort=()=>{void Promise.resolve(this.execute(ticket.frame,'abort')).catch(()=>{});};
    signal?.addEventListener('abort',abort,{once:true});
    try{
      if(signal?.aborted||this.closed)return {deferred:true};
      if(this.verifiedSessionKey!==sessionKey){
        if(this.identitySession!==sessionKey)this.resetIdentity(sessionKey);
        if(Number(this.now())<this.identityRetryAt)return {deferred:true,reason:'identity_backoff',retryAt:this.identityRetryAt};
        let identity;
        try{identity=await this.execute(ticket.frame,'read',{documentId:ticket.documentId,inputCount:ticket.inputCount,
          kind:'identity',expectedMember:ticket.member});}
        catch(error){return signal?.aborted||this.closed||this.epoch!==ticket.epoch||!this.safeTimeline()?
          this.deferIdentity(sessionKey,'identity_interrupted'):this.pauseSession(sessionKey,'identity_unavailable');}
        if(identity?.identityMatch===false)return this.pauseSession(sessionKey,'identity_mismatch');
        if(!identity?.identityMatch||signal?.aborted||this.closed||this.epoch!==ticket.epoch||!this.safeTimeline())
          return identity?.attempted||identity?.identityMatch===true?this.deferIdentity(sessionKey,'identity_interrupted'):{deferred:true};
        const fresh=await this.context({cached:true});
        if(fresh.sessionKey!==sessionKey||this.epoch!==ticket.epoch||!this.safeTimeline())
          return this.deferIdentity(sessionKey,'identity_interrupted');
        this.resetIdentity(sessionKey);this.verifiedSessionKey=sessionKey;
        this.diagnostic('identity_verified');
      }
      if(kind==='identity')return {identityVerified:true};
      const result=await this.execute(ticket.frame,'read',{documentId:ticket.documentId,
        inputCount:ticket.inputCount,...(page!==undefined?{page}:{}),...(kind!=='quest'?{kind}:{}),...(enemyId!==undefined?{enemyId}:{})});
      if(this.epoch!==ticket.epoch||!this.safeTimeline()||signal?.aborted||this.closed)return {deferred:true};
      const latest=await this.context({cached:true});
      if(latest.sessionKey!==sessionKey)return {deferred:true};
      if(countSuccess&&!result?.deferred)this.resumeSession();
      return result;
    }catch(error){if(!signal?.aborted&&!this.closed&&this.epoch===ticket.epoch&&this.safeTimeline())this.pauseSession(sessionKey);
      this.diagnostic('read_failed');throw new Error('Quest list unavailable');}
    finally{signal?.removeEventListener('abort',abort);this.reading=false;this.ticket=null;}
  }
  // Explicit and automatic reads collect every page independently, rechecking the
  // existing game-screen and session guards before each request. Never return
  // a partially collected list as complete.
  async readAll({signal,sessionKey}={}){
    if(this.collecting||this.closed||signal?.aborted)return {status:'deferred'};
    this.collecting=true;
    try{
      const context=await this.context();
      if(context.blocked)return {status:'deferred',blocked:true,reason:context.reason};
      if(context.backoff)return {status:'deferred',reason:context.reason,retryAt:context.retryAt};
      if(signal?.aborted||!context.idle||!context.compatible||!context.sessionKey||
        sessionKey&&sessionKey!==context.sessionKey)return {status:'deferred'};
      const epoch=this.epoch,rows=[],ids=new Set();let pages=null,count=null;
      for(let page=1;page<=(pages??1);page++){
        const result=await this.read({signal,sessionKey:context.sessionKey,countSuccess:false,...(page>1?{page}:{})});
        if(signal?.aborted||this.epoch!==epoch||result?.deferred||!result?.list)return {status:'deferred',
          ...(result?.attempted?{attempted:true}:{}),...(result?.reason?{reason:result.reason}:{}),
          ...(Number.isFinite(result?.retryAt)?{retryAt:result.retryAt}:{})};
        const list=result.list;
        // Modern responses can contain the entire tab in one unpaged list.
        // Verify the count before requiring legacy page metadata.
        if(page===1&&Number.isInteger(list.api_count)&&list.api_count>=0&&
          list.api_list.filter(row=>row!==-1).length===list.api_count){
          const entries=list.api_list.filter(row=>row!==-1);
          if(new Set(entries.map(row=>row.api_no)).size!==entries.length)return {status:'incomplete'};
          this.resumeSession();return {status:'ready',tasks:entries,pages:1};
        }
        if(!Number.isInteger(list.api_page_count)||list.api_page_count<1||list.api_page_count>100||
          !Number.isInteger(list.api_count)||list.api_count<0||list.api_disp_page!==page||
          pages!==null&&(list.api_page_count!==pages||list.api_count!==count))return {status:'incomplete'};
        pages=list.api_page_count;count=list.api_count;
        for(const row of list.api_list){
          if(row===-1)continue;
          if(!row||ids.has(row.api_no))return {status:'incomplete'};
          ids.add(row.api_no);rows.push(row);
        }
      }
      if(rows.length!==count)return {status:'incomplete'};
      this.resumeSession();return {status:'ready',tasks:rows,pages};
    }catch(error){return {status:'failed'};}
    finally{this.collecting=false;}
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
