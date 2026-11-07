'use strict';
const crypto=require('crypto');
const {expeditionPeriod}=require('./expedition_progress');
const endpoints={mapinfo:'/kcsapi/api_get_member/mapinfo',presets:'/kcsapi/api_get_member/preset_deck',missions:'/kcsapi/api_get_member/mission'};
const account=store=>store?.info?.basic?.api_member_id==null?null:crypto.createHash('sha256').update(String(store.info.basic.api_member_id)).digest('hex');
// Data is held only by this plugin. Natural poi updates win; never dispatch a
// fabricated game response or mutate the host's Redux state.
class BasicDataSync{
  constructor({reader,getStore,expedition,now=()=>Date.now()}={}){
    this.reader=reader;this.getStore=getStore;this.expedition=expedition;this.now=now;
    this.key=null;this.session=null;this.pending=new Set(Object.keys(endpoints));this.attempted=new Set();this.retries=new Map();
    this.maps=null;this.airbase=null;this.presets=null;this.relocations=null;this.relocationsComplete=false;this.pendingPlane=null;this.planeRequestPending=false;this.missionPeriod=null;this.overlayCache=null;this.revision=0;this.closed=false;this.running=false;this.abort=null;
  }
  syncAccount(store){
    const key=account(store);if(key===this.key)return;
    this.abort?.abort();this.key=key;this.session=null;this.pending=new Set(Object.keys(endpoints));this.attempted.clear();this.retries.clear();
    this.maps=null;this.airbase=null;this.presets=null;this.relocations=null;this.relocationsComplete=false;this.pendingPlane=null;this.planeRequestPending=false;this.missionPeriod=null;this.revision++;
  }
  reset(){this.abort?.abort();this.key=null;this.session=null;this.pending=new Set(Object.keys(endpoints));this.attempted.clear();this.retries.clear();this.maps=null;this.airbase=null;this.presets=null;this.relocations=null;this.relocationsComplete=false;this.pendingPlane=null;this.planeRequestPending=false;this.missionPeriod=null;this.revision++;}
  request(kind){if(!Object.hasOwn(endpoints,kind))return false;this.pending.add(kind);this.attempted.delete(kind);this.retries.delete(kind);this.revision++;return true;}
  failure(kind){
    const count=(this.retries.get(kind)?.count||0)+1;
    this.retries.set(kind,{count,at:this.now()+Math.min(300000,2000*2**Math.min(count-1,8))});
    this.attempted.delete(kind);this.pending.add(kind);
  }
  observeRequest(detail,store){
    if(this.closed)return;this.syncAccount(store);if(!this.key)return;
    if(String(detail?.path||'').split('?')[0]!=='/kcsapi/api_req_air_corps/set_plane')return;
    this.revision++;this.planeRequestPending=true;
    const body=typeof detail.body==='string'?Object.fromEntries(new URLSearchParams(detail.body)):detail.body;
    const area=Number(body?.api_area_id),rid=Number(body?.api_base_id),slot=Number(body?.api_squadron_id),item=Number(body?.api_item_id);
    if(![area,rid,slot,item].every(Number.isSafeInteger)||area<1||rid<1||slot<1||slot>4){this.pendingPlane=null;return;}
    const bases=this.airbase||store?.info?.airbase||[],matches=bases.filter(b=>Number(b.api_area_id)===area&&Number(b.api_rid)===rid);
    const old=matches.length===1?matches[0].api_plane_info?.find(p=>Number(p.api_squadron_id)===slot):null;
    const donors=bases.filter(b=>Number(b.api_area_id)===area&&Number(b.api_rid)!==rid)
      .flatMap(b=>(b.api_plane_info||[]).filter(p=>Number(p.api_slotid)===item&&Number(p.api_state)===1));
    this.pendingPlane=old?{area,rid,slot,item,previous:Number(old.api_slotid),previousState:Number(old.api_state),
      crossSwap:donors.length===1&&Number(old.api_slotid)>0&&Number(old.api_state)===1}:null;
  }
  observe(detail,store){
    if(this.closed)return;this.syncAccount(store);if(!this.key)return;
    const api=String(detail?.path||'').split('?')[0],body=detail?.body;
    if(body?.api_result!=null&&Number(body.api_result)!==1){if(api==='/kcsapi/api_req_air_corps/set_plane'){this.pendingPlane=null;this.planeRequestPending=false;}return;}
    const data=body?.api_data??body;
    // Port is authoritative: removed aircraft can remain unavailable even
    // after they no longer appear in any base squadron. The field is omitted
    // when there are none. Keep observed start times only for the same IDs.
    if(api==='/kcsapi/api_port/port'&&data&&typeof data==='object'){
      const ids=data.api_plane_info?.api_base_convert_slot??[];
      if(Array.isArray(ids)&&ids.every(id=>Number.isSafeInteger(id)&&id>0)){
        const previous=new Map((this.relocations||[]).map(row=>[row.itemId,row]));
        this.relocations=[...new Set(ids)].map(itemId=>previous.get(itemId)||{itemId,startedAt:null});this.relocationsComplete=true;this.revision++;
      }
    }else if(api==='/kcsapi/api_req_air_corps/set_plane'&&Array.isArray(data?.api_plane_info)){
      const pending=data.api_plane_info.filter(row=>row?.api_state===2&&Number.isSafeInteger(row.api_slotid)&&row.api_slotid>0).map(row=>row.api_slotid);
      const p=this.pendingPlane,changed=p&&data.api_plane_info.find(row=>Number(row.api_squadron_id)===p.slot);
      if(!changed){this.relocationsComplete=false;this.revision++;}
      const crossSwap=p?.crossSwap&&Number(changed?.api_slotid)===p.item&&Number(changed?.api_state)===1;
      if(changed&&p.previousState===1&&p.previous>0&&p.previous!==p.item&&
        !crossSwap&&!data.api_plane_info.some(row=>Number(row.api_state)===1&&Number(row.api_slotid)===p.previous))pending.push(p.previous);
      this.pendingPlane=null;this.planeRequestPending=false;
      if(pending.length){const previous=new Map((this.relocations||[]).map(row=>[row.itemId,row]));
        for(const id of pending)if(!previous.has(id))previous.set(id,{itemId:id,startedAt:this.now()});
        this.relocations=[...previous.values()];this.revision++;}
    }else if(api==='/kcsapi/api_req_air_corps/set_plane'){this.pendingPlane=null;this.planeRequestPending=false;this.relocationsComplete=false;this.revision++;}
    if(api===endpoints.mapinfo&&Array.isArray(data?.api_map_info)&&data.api_map_info.some(row=>row?.api_id===11)&&
      Array.isArray(data.api_air_base)&&data.api_air_base.every(row=>Array.isArray(row?.api_plane_info)&&row.api_plane_info.every(p=>Number.isSafeInteger(p?.api_slotid)))){
      this.pending.delete('mapinfo');this.attempted.add('mapinfo');this.retries.delete('mapinfo');this.maps=null;this.airbase=null;this.revision++;
    }else if(api===endpoints.presets&&data&&typeof data.api_deck==='object'){
      this.pending.delete('presets');this.attempted.add('presets');this.retries.delete('presets');this.presets=null;this.revision++;
    }else if(api===endpoints.missions&&(Array.isArray(data)||Array.isArray(data?.api_list_items)||Array.isArray(data?.api_list))){
      this.pending.delete('missions');this.attempted.add('missions');this.retries.delete('missions');this.revision++;
    }else if(api==='/kcsapi/api_req_mission/result')this.request('missions');
    else if(/^\/kcsapi\/api_req_air_corps\//.test(api)||/^\/kcsapi\/api_req_(?:sortie|combined_battle)\/battleresult$/.test(api)){
      this.maps=null;this.airbase=null;this.request('mapinfo');
    }else if(/^\/kcsapi\/api_req_hensei\/preset_(?:register|delete|order_change)/.test(api)){
      this.presets=null;this.request('presets');
    }
  }
  view(store){
    this.syncAccount(store);
    const airbaseSync={complete:!!this.key&&this.attempted.has('mapinfo')&&!this.pending.has('mapinfo'),relocationsComplete:this.relocationsComplete};
    if(!this.maps&&!this.airbase&&!this.presets&&!this.relocations){this.overlayCache=null;return {...store,airbaseSync};}
    const fields=Object.entries(store.info||{}),old=this.overlayCache;
    if(!old||old.source!==store.info||old.maps!==this.maps||old.airbase!==this.airbase||old.presets!==this.presets||old.relocations!==this.relocations||
      old.fields.length!==fields.length||fields.some(([key,value],index)=>old.fields[index]?.[0]!==key||old.fields[index]?.[1]!==value)){
      this.overlayCache={source:store.info,maps:this.maps,airbase:this.airbase,presets:this.presets,relocations:this.relocations,fields,
        info:{...store.info,...(this.maps?{maps:this.maps}:{}),...(this.airbase?{airbase:this.airbase}:{}),...(this.presets?{presets:this.presets}:{}),
          ...(this.relocations?{airbaseRelocations:this.relocations}:{})}};
    }
    return {...store,info:this.overlayCache.info,airbaseSync};
  }
  snapshot(){return this.key?{version:1,key:this.key,session:this.session,time:this.now(),pending:[...this.pending],attempted:[...this.attempted],maps:this.maps,airbase:this.airbase,presets:this.presets,relocations:this.relocations,relocationsComplete:this.relocationsComplete&&!this.planeRequestPending,missionPeriod:this.missionPeriod}:null;}
  restoreRelocations(value,store,session){
    this.syncAccount(store);
    if(this.closed||this.relocationsComplete||!this.key||value?.version!==1||value.key!==this.key||
      value.session!==session||this.session!==session||!Number.isFinite(value.time)||this.now()-value.time<0||this.now()-value.time>30000||
      value.relocationsComplete!==true||!Array.isArray(value.relocations)||
      value.relocations.some(row=>!Number.isSafeInteger(row?.itemId)||row.itemId<=0||
        !(row.startedAt===null||Number.isFinite(row.startedAt))))return false;
    this.relocations=value.relocations.map(row=>({...row}));this.relocationsComplete=true;this.revision++;return true;
  }
  restore(value,store){this.syncAccount(store);if(!this.key||value?.version!==1||value.key!==this.key||!Number.isFinite(value.time)||this.now()-value.time<0||this.now()-value.time>30000)return;
    this.session=value.session;this.pending=new Set((value.pending||[]).filter(k=>Object.hasOwn(endpoints,k)));this.attempted=new Set((value.attempted||[]).filter(k=>Object.hasOwn(endpoints,k)));
    this.maps=value.maps||null;this.airbase=value.airbase||null;this.presets=value.presets||null;this.relocations=Array.isArray(value.relocations)?value.relocations:null;this.relocationsComplete=value.relocationsComplete===true&&Array.isArray(value.relocations);this.missionPeriod=value.missionPeriod||null;
    // Do not restore success markers without their actual data. Mission data
    // lives in another owner and is independently refreshed after a reload.
    if(!this.maps||!this.airbase){this.pending.add('mapinfo');this.attempted.delete('mapinfo');}
    if(!this.presets){this.pending.add('presets');this.attempted.delete('presets');}
    this.pending.add('missions');this.attempted.delete('missions');this.retries.clear();this.revision++;}
  dispose(){this.closed=true;this.abort?.abort();}
  async tick(){
    if(this.closed||this.running)return {status:'deferred'};this.running=true;
    let kind=null,revision=null,key=null,sessionKey=null;
    try{
      this.syncAccount(this.getStore());const period=expeditionPeriod(this.now());
      if(this.missionPeriod&&this.missionPeriod!==period)this.request('missions');this.missionPeriod=period;
      const cached=await this.reader.context({cached:true});
      if(this.closed||!this.key||!cached.ready||!cached.sessionKey)return {status:'deferred'};
      if(this.session&&this.session!==cached.sessionKey){this.pending=new Set(Object.keys(endpoints));this.attempted.clear();this.retries.clear();this.maps=null;this.airbase=null;this.presets=null;this.relocations=null;this.relocationsComplete=false;this.revision++;}
      this.session=cached.sessionKey;sessionKey=cached.sessionKey;
      kind=[...this.pending].find(k=>this.now()>=(this.retries.get(k)?.at||0));
      if(!kind)return {status:this.pending.size?'backoff':'cached'};
      const ready=await this.reader.context();if(this.closed||!ready.idle||!ready.compatible||ready.sessionKey!==cached.sessionKey)return {status:'deferred'};
      revision=this.revision;key=this.key;const controller=new AbortController();this.abort=controller;
      const result=await this.reader.read({signal:controller.signal,sessionKey:cached.sessionKey,kind});
      const latest=await this.reader.context({cached:true});this.syncAccount(this.getStore());
      if(this.closed||controller.signal.aborted||result?.deferred||latest.sessionKey!==cached.sessionKey||this.key!==key||this.revision!==revision){
        if(!this.closed&&this.key===key&&this.revision===revision&&this.session===sessionKey)this.failure(kind);
        return {status:'deferred'};}
      if(kind==='mapinfo'&&result?.mapinfo){this.maps=Object.fromEntries(result.mapinfo.maps.map(row=>[row.api_id,row]));this.airbase=result.mapinfo.airbase;}
      else if(kind==='presets'&&result?.presets)this.presets=result.presets;
      else if(kind==='missions'&&result?.missions&&this.expedition.acceptMissions(result.missions,this.getStore())){}
      else {this.failure(kind);return {status:'failed',kind};}
      this.pending.delete(kind);this.attempted.add(kind);this.retries.delete(kind);this.revision++;return {status:'ready',kind};
    }catch(_){if(kind&&revision!==null&&!this.closed&&this.key===key&&this.revision===revision&&this.session===sessionKey)this.failure(kind);return {status:'failed'};}
    finally{this.abort=null;this.running=false;}
  }
}
module.exports={BasicDataSync};
