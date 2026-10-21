'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');

// Monthly expeditions reset at noon JST on the 15th, not the quest reset.
function expeditionPeriod(now=Date.now()){
  const date=new Date(now+9*3600000);
  let year=date.getUTCFullYear(),month=date.getUTCMonth();
  if(date.getUTCDate()<15||date.getUTCDate()===15&&date.getUTCHours()<12){month--;if(month<0){year--;month=11;}}
  return `${year}-${String(month+1).padStart(2,'0')}`;
}
const accountKey=store=>{
  const id=store?.info?.basic?.api_member_id;
  return id?crypto.createHash('sha256').update(String(id)).digest('hex'):null;
};

// Status persistence and optional read-only startup refresh. No game input,
// synthetic response events or interception of normal game requests.
class ExpeditionProgress {
  constructor(directory,{now=()=>Date.now(),load=null,getStore=null}={}){
    this.directory=path.join(directory,'expedition-status');this.now=now;
    this.key=null;this.records={};this.list=null;this.departures=new Map();this.pending=Promise.resolve();this.viewState=null;
    this.load=load;this.getStore=getStore;this.refreshState=null;this.loading=null;this.closed=false;this.revision=0;
  }
  sync(store){
    const key=accountKey(store);
    if(key===this.key)return;
    this.key=key;this.records={};this.list=null;this.departures.clear();this.viewState=null;this.refreshState=null;this.revision++;
    if(key)try{
      const saved=JSON.parse(fs.readFileSync(path.join(this.directory,key+'.json'),'utf8'));
      if(saved.schemaVersion===1&&saved.records&&typeof saved.records==='object'){
        for(const [id,row]of Object.entries(saved.records))
          if(/^\d+$/.test(id)&&row&&[0,1,2].includes(row.state)&&/^\d{4}-\d{2}$/.test(row.period))
            this.records[id]={state:row.state,period:row.period};
        const list=saved.list,validIds=ids=>Array.isArray(ids)&&ids.every(id=>Number.isInteger(id)&&id>0);
        if(list&&/^\d{4}-\d{2}$/.test(list.period)&&validIds(list.ids)&&validIds(list.catalogIds))
          this.list={period:list.period,ids:list.ids,catalogIds:list.catalogIds};
      }
    }catch(error){/* Missing/corrupt status is unknown, never incomplete. */}
    this.remember(store);
  }
  remember(store){
    const next=new Map();
    for(const [index,fleet]of (store.info?.fleets||[]).entries()){
      const [active,id,ends]=fleet.api_mission||[],minutes=store.const?.$missions?.[id]?.api_time;
      if(active>0&&id>0)next.set(index+1,{id,period:Number.isFinite(ends)&&Number.isFinite(minutes)?expeditionPeriod(ends-minutes*60000):null});
    }
    this.departures=next;
  }
  view(store){
    this.sync(store);const period=expeditionPeriod(this.now());
    // The workbench polls this snapshot; wait for login, deduplicate reads and
    // retry transient startup failures at most three times, 30 seconds apart.
    this.refresh(store,period);
    if(!this.viewState||this.viewState.period!==period)this.viewState={period,records:this.records,list:this.list};
    return this.viewState;
  }
  refresh(store,period=expeditionPeriod(this.now())){
    if(this.closed||!this.load||!this.getStore||!this.key||this.loading)return;
    if(this.refreshState?.period!==period)this.refreshState={period,attempts:0,complete:false,next:0};
    const state=this.refreshState;
    if(state.complete||state.attempts>=3||this.now()<state.next)return;
    const key=this.key,revision=this.revision,records=this.records;state.attempts++;state.next=this.now()+30000;
    this.loading=Promise.resolve().then(()=>this.closed?null:this.load()).then(body=>{
      if(this.closed||!body)return;
      const current=this.getStore();this.sync(current);
      if(this.key!==key||this.refreshState!==state)return;
      // A natural mission-list response or return may have supplied newer data.
      if(this.revision===revision){
        const newer=Object.entries(this.records).filter(([id,row])=>row!==records[id]);
        this.observe({path:'/kcsapi/api_get_member/mission',body},current);
        if(newer.length){this.records={...this.records,...Object.fromEntries(newer)};this.save();}
      }
    }).catch(()=>{/* Keep the last known record; never interrupt the player. */}).finally(()=>{this.loading=null;});
  }
  save(){
    if(!this.key)return;
    const file=path.join(this.directory,this.key+'.json'),record=JSON.stringify({schemaVersion:1,records:this.records,list:this.list});
    this.viewState=null;
    this.pending=this.pending.then(async()=>{
      const temporary=file+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';
      try{
        await fs.promises.mkdir(this.directory,{recursive:true});
        await fs.promises.writeFile(temporary,record,{flag:'wx',mode:0o600});
        for(let attempt=0;;attempt++)try{await fs.promises.rename(temporary,file);break;}
        catch(error){if(!['EBUSY','EPERM','EACCES'].includes(error.code)||attempt===2)throw error;
          await new Promise(resolve=>setTimeout(resolve,40*(attempt+1)));}
      }catch(error){/* UI can still use the observed in-memory record. */}
      finally{await fs.promises.unlink(temporary).catch(()=>{});}
    });
  }
  observe(detail,store){
    try{
      this.sync(store);if(!this.key)return;
      const {path:api,body,postBody={}}=detail||{},period=expeditionPeriod(this.now());
      if(api==='/kcsapi/api_get_member/mission'){
        const list=Array.isArray(body)?body:body?.api_list_items||body?.api_list;
        const limit=Number(body?.api_limit_time),limitMs=limit<1e11?limit*1000:limit;
        // A response begun before the reset may arrive after it. Attribute the
        // snapshot to the server's own cycle endpoint when it is provided.
        const listPeriod=Number.isFinite(limitMs)&&limitMs>0?expeditionPeriod(limitMs-1):period;
        if(Array.isArray(list)&&list.length&&list.every(r=>r&&Number.isInteger(r.api_mission_id)&&r.api_mission_id>0)){
          // The game resets all master missions to -1, then applies listed
          // rows. Absence means locked only within a full, current snapshot
          // and the master catalogue known when that snapshot was received.
          this.list={period:listPeriod,ids:list.map(r=>r.api_mission_id),
            catalogIds:Object.keys(store.const?.$missions||{}).map(Number).filter(id=>Number.isInteger(id)&&id>0)};
          this.records=Object.fromEntries(list.filter(r=>[0,1,2].includes(r.api_state)).map(r=>[r.api_mission_id,{state:r.api_state,period:listPeriod}]));this.revision++;this.save();
          if(this.refreshState?.period===listPeriod)this.refreshState.complete=true;
        }
      }else if(api==='/kcsapi/api_req_mission/result'&&body?.api_clear_result>0){
        const departure=this.departures.get(Number(postBody.api_deck_id));
        const id=departure?.id;
        const master=store.const?.$missions?.[id];
        if(id&&master&&(Number(master.api_reset_type)!==1||departure.period===period)){
          this.records={...this.records,[id]:{state:2,period}};this.save();
        }
      }
      // A result may already have cleared the fleet in Redux: use the previous
      // departure above before capturing the newly observed fleet state.
      this.remember(store);
    }catch(error){/* Never throw into poi's game.response dispatcher. */}
  }
  async dispose(){this.closed=true;await this.loading;await this.pending;}
}
module.exports={ExpeditionProgress,expeditionPeriod};
