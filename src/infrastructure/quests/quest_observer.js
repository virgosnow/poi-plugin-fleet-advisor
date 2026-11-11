'use strict';
const crypto=require('node:crypto');

const DAY=24*60*60*1000;
// A task day starts at 05:00 JST. Expire all observed statuses conservatively;
// this component does not infer individual reset rules or detailed progress.
const questDay=time=>Math.floor((time+4*60*60*1000)/DAY);
const memberKey=store=>{
  const id=store?.info?.basic?.api_member_id;
  return id==null||String(id)===''?null:crypto.createHash('sha256').update(String(id)).digest('hex');
};
const taskId=value=>{
  const id=Number(value);
  return Number.isInteger(id)&&id>0?id:null;
};
function taskCopy(task){
  if(!task||typeof task!=='object'||Array.isArray(task))return null;
  const id=taskId(task.api_no),state=Number(task.api_state);
  if(!id||![1,2,3].includes(state))return null;
  // API data must remain independent of poi's Redux objects and UI consumers.
  try{return {...JSON.parse(JSON.stringify(task)),api_no:id,api_state:state};}
  catch(error){return null;}
}
function responseBody(body){
  if(!body||typeof body!=='object'||Array.isArray(body))return null;
  if(body.api_result!=null&&Number(body.api_result)!==1)return null;
  return body.api_data&&typeof body.api_data==='object'?body.api_data:body;
}
function postId(postBody){
  if(typeof postBody==='string')return taskId(new URLSearchParams(postBody).get('api_quest_id'));
  return taskId(postBody?.api_quest_id);
}

// The last complete server snapshot is persisted per account. A restored
// snapshot can be used immediately but still triggers a fresh login read.
class QuestObserver {
  constructor({getState=()=>({}),now=()=>Date.now()}={}){
    this.readStore=getState;this.now=now;this.key=null;this.day=null;
    this.records=new Map();this.claimed=new Set();this.known=false;this.complete=false;this.fresh=false;this.baseline=false;this.cache=null;this.revision=0;this.closed=false;
    this.state=Object.freeze({known:false,tasks:Object.freeze([])});
  }
  setCache(cache){this.cache=cache;if(this.key&&!this.known){this.loadCached();this.publish();}}
  loadCached(){
    if(!this.key||!this.cache?.getQuestSnapshot)return false;
    try{
      const saved=this.cache.getQuestSnapshot(this.key);
      if(saved?.version!==1||!Number.isFinite(saved.capturedAt)||saved.capturedAt>this.now()||
        typeof saved.complete!=='boolean'||!Array.isArray(saved.tasks)||!Array.isArray(saved.claimedTaskIds))return false;
      const tasks=saved.tasks.map(taskCopy),claimed=saved.claimedTaskIds;
      if(tasks.some(task=>!task)||new Set(tasks.map(task=>task.api_no)).size!==tasks.length||claimed.some(id=>!taskId(id)))return false;
      this.records=new Map(tasks.map(task=>[task.api_no,task]));this.claimed=new Set(claimed.map(Number));
      this.known=true;this.complete=saved.complete;this.fresh=false;this.baseline=true;return true;
    }catch(_){return false;}
  }
  persist(){
    if(!this.key||!this.known||!this.baseline||!this.cache?.saveQuestSnapshot)return;
    const snapshot={version:1,capturedAt:this.now(),complete:this.complete,
      tasks:this.state.tasks.map(task=>taskCopy(task)),claimedTaskIds:[...this.claimed]};
    void this.cache.saveQuestSnapshot(this.key,snapshot).catch(()=>{});
  }
  sync(store){
    const key=memberKey(store),day=questDay(this.now());
    if(key===this.key){if(day!==this.day){this.day=day;this.revision++;}return;}
    this.key=key;this.day=day;this.records.clear();this.claimed.clear();this.known=false;this.complete=false;this.fresh=false;this.baseline=false;
    if(key)this.loadCached();this.publish();
  }
  publish(){
    const tasks=[...this.records.values()].filter(task=>[1,2,3].includes(task.api_state))
      .sort((a,b)=>b.api_state-a.api_state||a.api_no-b.api_no);
    // Repeated list responses should not cause unnecessary workbench renders.
    const claimedTaskIds=[...this.claimed].sort((a,b)=>a-b);
    if(this.state.known===this.known&&JSON.stringify(this.state.tasks)===JSON.stringify(tasks)&&
      JSON.stringify(this.state.claimedTaskIds||[])===JSON.stringify(claimedTaskIds))return;
    this.state=Object.freeze({known:this.known,tasks:Object.freeze(tasks.map(task=>Object.freeze({...task}))),
      ...(claimedTaskIds.length?{claimedTaskIds:Object.freeze(claimedTaskIds)}:{})});
    this.revision++;
  }
  view(store){
    if(this.closed)return this.state;
    try{this.sync(store===undefined?this.readStore():store);}catch(error){/* A closing host may have no Redux store. */}
    return this.state;
  }
  getState(store){return this.view(store);}
  query(store){return this.view(store);}
  resetSession(){
    if(this.closed)return;
    this.key=null;this.day=null;this.records.clear();this.claimed.clear();this.known=false;this.complete=false;this.fresh=false;this.baseline=false;this.publish();
  }
  hasComplete(store){this.view(store);return this.complete;}
  hasFreshComplete(store){this.view(store);return this.complete&&this.fresh;}
  // Only a validated complete all-tab read may replace older partial rows.
  acceptComplete(rows,store){
    if(this.closed||!Array.isArray(rows))return false;
    this.sync(store===undefined?this.readStore():store);
    if(!this.key)return false;
    const tasks=rows.map(taskCopy);
    if(tasks.some(task=>!task)||new Set(tasks.map(task=>task.api_no)).size!==tasks.length)return false;
    this.records=new Map(tasks.map(task=>[task.api_no,task]));
    for(const task of tasks)if([2,3].includes(task.api_state))this.claimed.delete(task.api_no);
    this.known=true;this.complete=true;this.fresh=true;this.baseline=true;this.publish();this.persist();return true;
  }
  // A direct read can finish before poi broadcasts its natural response. Merge
  // the actual returned list here without dispatching synthetic host events.
  acceptList(body,store){
    if(this.closed)return false;
    this.sync(store===undefined?this.readStore():store);
    body=responseBody(body);
    if(!this.key||!Array.isArray(body?.api_list))return false;
    for(const value of body.api_list){
      const task=taskCopy(value);if(!task)continue;
      if([2,3].includes(task.api_state))this.claimed.delete(task.api_no);
      this.records.set(task.api_no,task);
    }
    this.known=true;this.publish();this.persist();return true;
  }
  // Short-lived in-process hot-reload handoff only. This is an actual observed
  // list, not an API response, a persistent account cache or progress history.
  snapshot(){
    if(this.closed)return null;
    try{
      this.sync(this.readStore());if(!this.key)return null;
      return {accountKey:this.key,day:this.day,capturedAt:this.now(),known:this.known,complete:this.complete,
        tasks:this.state.tasks.map(task=>taskCopy(task)),claimedTaskIds:[...this.claimed]};
    }catch(error){return null;}
  }
  restore(snapshot,store){
    if(this.closed)return false;
    try{
      this.sync(store===undefined?this.readStore():store);
      const now=this.now(),capturedAt=snapshot?.capturedAt;
      if(!this.key||snapshot?.accountKey!==this.key||snapshot.day!==this.day||
        !Number.isFinite(capturedAt)||capturedAt>now||now-capturedAt>30000||
        questDay(capturedAt)!==this.day||typeof snapshot.known!=='boolean'||!Array.isArray(snapshot.tasks))return false;
      const tasks=snapshot.tasks.map(taskCopy);
      if(tasks.some(task=>!task||![1,2,3].includes(task.api_state))||
        new Set(tasks.map(task=>task.api_no)).size!==tasks.length||!snapshot.known&&tasks.length)return false;
      const claimed=snapshot.claimedTaskIds??[];
      if(!Array.isArray(claimed)||claimed.some(id=>!taskId(id)))return false;
      this.records=new Map(tasks.map(task=>[task.api_no,task]));this.claimed=new Set(claimed.map(Number));this.known=snapshot.known;
      this.complete=snapshot.known&&snapshot.complete===true;this.fresh=false;this.publish();
      return true;
    }catch(error){return false;}
  }
  observe(detail,store){
    if(this.closed)return;
    try{
      this.sync(store===undefined?this.readStore():store);if(!this.key)return;
      const api=String(detail?.path||'').split('?')[0],body=responseBody(detail?.body);
      if(!body)return;
      if(api==='/kcsapi/api_get_member/questlist'){
        const post=detail.postBody,tab=typeof post==='string'?new URLSearchParams(post).get('api_tab_id'):post?.api_tab_id;
        if(String(tab)==='0'&&Number.isInteger(body.api_count)&&Array.isArray(body.api_list)){
          const rows=body.api_list.filter(row=>row!==-1);
          if(rows.length===body.api_count&&this.acceptComplete(rows,store))return;
        }
        this.acceptList(body,store);return;
      }else if(['/kcsapi/api_req_quest/start','/kcsapi/api_req_quest/stop','/kcsapi/api_req_quest/clearitemget'].includes(api)){
        const id=postId(detail.postBody);if(!id)return;
        if(api.endsWith('/clearitemget')){
          this.records.delete(id);
          this.claimed.add(id);
          // Claiming can unlock tasks absent from the old complete list.
          this.complete=false;this.fresh=false;
        }
        else {if(api.endsWith('/start'))this.claimed.delete(id);
          this.records.set(id,{...this.records.get(id),api_no:id,api_state:api.endsWith('/start')?2:1});}
        this.known=true;
      }else return;
      this.publish();this.persist();
    }catch(error){/* Never throw into poi's game.response dispatcher. */}
  }
  dispose(){this.closed=true;this.records.clear();this.claimed.clear();this.known=false;this.complete=false;this.fresh=false;this.baseline=false;this.key=null;this.publish();}
}
module.exports={QuestObserver,questDay};
