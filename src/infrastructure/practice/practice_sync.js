'use strict';
const {cycle}=require('./practice_observer');
const retry=require('../sync/retry_policy');
const FLEET_REFRESH_MS=5*60*1000;
// Share the guarded game-frame reader with task synchronization. Each actual
// successful data is scoped to a session and rotation. Temporary failures
// are retried with bounded backoff and never masquerade as completed data.
class PracticeSync{
  constructor({reader,observer,getStore,now=()=>Date.now(),isActive=()=>true}={}){
    this.reader=reader;this.observer=observer;this.getStore=getStore;this.now=now;this.isActive=isActive;
    this.session=null;this.period=null;this.attempted=new Set();this.retries=new Map();this.running=false;this.closed=false;this.abort=null;
    this.listDirty=false;this.refreshVersion=0;
  }
  snapshot(){return {version:1,session:this.session,period:this.period,attempted:[...this.attempted],listDirty:this.listDirty};}
  restore(value){if(value?.version===1&&typeof value.session==='string'&&Number.isSafeInteger(value.period)&&Array.isArray(value.attempted)){
    this.session=value.session;this.period=value.period;this.attempted=new Set(value.attempted.filter(x=>x==='list'||/^enemy:[1-9]\d*$/.test(x)));this.listDirty=value.listDirty===true;}}
  reset(){this.abort?.abort();this.session=null;this.period=null;this.attempted.clear();this.retries.clear();this.listDirty=false;this.refreshVersion++;}
  observeResult(detail){
    const body=detail?.body?.api_data??detail?.body;
    if(String(detail?.path||'').split('?')[0]!=='/kcsapi/api_req_practice/battle_result'||
      detail?.body?.api_result!=null&&Number(detail.body.api_result)!==1||
      !/^(SS|S|A|B|C|D|E)$/.test(String(body?.api_win_rank||'')))return;
    this.listDirty=true;this.refreshVersion++;this.retries.delete('list');this.abort?.abort();
  }
  failure(attempt){const count=(this.retries.get(attempt)?.count||0)+1;
    this.retries.set(attempt,{count,at:retry.exhausted(count)?Infinity:this.now()+retry.retryDelay(count)});this.attempted.delete(attempt);}
  needsFleet(row){const age=this.now()-row.fleetUpdatedAt;return !row.ships||!Number.isFinite(row.fleetUpdatedAt)||age<0||age>=FLEET_REFRESH_MS;}
  needsList(state){const age=this.now()-state.listUpdatedAt;return this.listDirty||!state.known||state.needsProfileRefresh||!Number.isFinite(state.listUpdatedAt)||age<0||age>=FLEET_REFRESH_MS;}
  suspend(){this.abort?.abort();}
  dispose(){this.closed=true;this.abort?.abort();}
  async tick(){
    if(this.closed||this.running||!this.isActive())return {status:'deferred'};this.running=true;
    let attempt=null,sessionKey=null,period=null,revision=null;
    try{
      const session=await this.reader.context({cached:true});period=cycle(this.now());
      if(this.closed||!this.isActive()||!session.ready||!session.sessionKey)return {status:'deferred'};
      if(this.session!==session.sessionKey||this.period!==period){this.abort?.abort();this.session=session.sessionKey;this.period=period;this.attempted.clear();this.retries.clear();}
      sessionKey=session.sessionKey;
      const current=this.observer.view(this.getStore());
      const missing=current.known?(current.opponents||[]).filter(row=>this.needsFleet(row)):[];
      const enemy=missing.find(row=>this.now()>=(this.retries.get('enemy:'+row.id)?.at||0));
      attempt=this.needsList(current)?'list':enemy?'enemy:'+enemy.id:null;
      if(!attempt)return {status:missing.length?missing.every(row=>retry.exhausted(this.retries.get('enemy:'+row.id)?.count||0))?'exhausted':'backoff':'cached'};
      if(retry.exhausted(this.retries.get(attempt)?.count||0))return {status:'exhausted'};
      if(this.now()<(this.retries.get(attempt)?.at||0))return {status:'backoff'};
      const ready=await this.reader.context();
      if(this.closed||!this.isActive()||!ready.idle||!ready.compatible||ready.sessionKey!==session.sessionKey||cycle(this.now())!==period)return {status:'deferred'};
      const before=this.observer.view(this.getStore());
      if(attempt==='list'&&!this.needsList(before)||attempt!=='list'&&enemy&&!before.opponents.some(row=>row.id===enemy.id&&this.needsFleet(row)))return {status:'deferred'};
      revision=before.revision;const refreshVersion=this.refreshVersion,controller=new AbortController();this.abort=controller;
      const result=await this.reader.read({signal:controller.signal,sessionKey:session.sessionKey,
        kind:attempt==='list'?'practice':'practice-enemy',...(attempt!=='list'?{enemyId:enemy.id}:{})});
      const latest=await this.reader.context({cached:true}),state=this.observer.view(this.getStore());
      if(this.closed||!this.isActive()||controller.signal.aborted||result?.deferred||latest.sessionKey!==session.sessionKey||cycle(this.now())!==period||state.revision!==revision||refreshVersion!==this.refreshVersion){
        if(!this.closed&&!controller.signal.aborted&&this.session===sessionKey&&this.period===period&&state.revision===revision){
          if(result?.attempted)this.failure(attempt);
          else if(result?.deferred)this.retries.set(attempt,{count:this.retries.get(attempt)?.count||0,at:Number.isFinite(result.retryAt)?result.retryAt:this.now()+2000});
        }
        return {status:'deferred'};
      }
      const accepted=attempt==='list'?result?.list&&this.observer.acceptList(result.list,this.getStore()):result?.enemy&&this.observer.acceptEnemy(result.enemy,this.getStore());
      if(!accepted){this.failure(attempt);return {status:'failed'};}
      if(attempt==='list')this.listDirty=false;
      this.attempted.add(attempt);this.retries.delete(attempt);return {status:'ready'};
    }catch(_){if(attempt&&revision!==null&&!this.closed&&!this.abort?.signal?.aborted&&this.session===sessionKey&&this.period===period)this.failure(attempt);return {status:'failed'};}
    finally{this.abort=null;this.running=false;}
  }
}
module.exports={PracticeSync,FLEET_REFRESH_MS};
