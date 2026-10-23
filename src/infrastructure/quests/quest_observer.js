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

// Memory-only, passive view of tasks actually returned by the game. Missing
// pages never imply that a task is locked, unavailable or already completed.
class QuestObserver {
  constructor({getState=()=>({}),now=()=>Date.now()}={}){
    this.readStore=getState;this.now=now;this.key=null;this.day=null;
    this.records=new Map();this.known=false;this.revision=0;this.closed=false;
    this.hostActive=null;this.state=Object.freeze({known:false,tasks:Object.freeze([])});
  }
  sync(store){
    const key=memberKey(store),day=questDay(this.now());
    const active=store?.info?.quests?.activeQuests||null;
    if(key===this.key&&day===this.day){this.hostActive=active;return;}
    const previousActive=this.hostActive,changedAccount=this.key!==key;
    this.key=key;this.day=day;this.records.clear();this.known=false;
    // poi's info reducer clears quests when require_info changes member ID.
    // Its activeQuests carries a timestamp for each real quest-list row. Only
    // seed same-day rows, and never reuse the previous account's object.
    if(key&&(!changedAccount||!previousActive||active!==previousActive)){
      for(const entry of Object.values(active||{})){
        const time=Number(entry?.time),task=taskCopy(entry?.detail);
        if(!task||!Number.isFinite(time)||time>this.now()||questDay(time)!==day)continue;
        if(task.api_state===2)this.records.set(task.api_no,task);
      }
      this.known=this.records.size>0;
    }
    this.hostActive=active;this.publish();
  }
  publish(){
    const tasks=[...this.records.values()].filter(task=>[1,2].includes(task.api_state))
      .sort((a,b)=>b.api_state-a.api_state||a.api_no-b.api_no);
    // Repeated list responses should not cause unnecessary workbench renders.
    if(this.state.known===this.known&&JSON.stringify(this.state.tasks)===JSON.stringify(tasks))return;
    this.state=Object.freeze({known:this.known,tasks:Object.freeze(tasks.map(task=>Object.freeze({...task})))});
    this.revision++;
  }
  view(store){
    if(this.closed)return this.state;
    try{this.sync(store===undefined?this.readStore():store);}catch(error){/* A closing host may have no Redux store. */}
    return this.state;
  }
  getState(store){return this.view(store);}
  query(store){return this.view(store);}
  // A direct read can finish before poi broadcasts its natural response. Merge
  // the actual returned list here without dispatching synthetic host events.
  acceptList(body,store){
    if(this.closed)return false;
    this.sync(store===undefined?this.readStore():store);
    body=responseBody(body);
    if(!this.key||!Array.isArray(body?.api_list))return false;
    for(const value of body.api_list){
      const task=taskCopy(value);if(!task)continue;
      if(task.api_state===3)this.records.delete(task.api_no);
      else this.records.set(task.api_no,task);
    }
    this.known=true;this.publish();return true;
  }
  // Short-lived in-process hot-reload handoff only. This is an actual observed
  // list, not an API response, a persistent account cache or progress history.
  snapshot(){
    if(this.closed)return null;
    try{
      this.sync(this.readStore());if(!this.key)return null;
      return {accountKey:this.key,day:this.day,capturedAt:this.now(),known:this.known,
        tasks:this.state.tasks.map(task=>taskCopy(task))};
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
      if(tasks.some(task=>!task||![1,2].includes(task.api_state))||
        new Set(tasks.map(task=>task.api_no)).size!==tasks.length||!snapshot.known&&tasks.length)return false;
      this.records=new Map(tasks.map(task=>[task.api_no,task]));this.known=snapshot.known;this.publish();
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
        this.acceptList(body,store);return;
      }else if(['/kcsapi/api_req_quest/start','/kcsapi/api_req_quest/stop','/kcsapi/api_req_quest/clearitemget'].includes(api)){
        const id=postId(detail.postBody);if(!id)return;
        if(api.endsWith('/clearitemget'))this.records.delete(id);
        else this.records.set(id,{...this.records.get(id),api_no:id,api_state:api.endsWith('/start')?2:1});
        this.known=true;
      }else return;
      this.publish();
    }catch(error){/* Never throw into poi's game.response dispatcher. */}
  }
  dispose(){this.closed=true;this.records.clear();this.known=false;this.hostActive=null;this.key=null;this.publish();}
}
module.exports={QuestObserver,questDay};
