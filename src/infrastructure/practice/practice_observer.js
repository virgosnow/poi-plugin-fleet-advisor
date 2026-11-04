'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
// Opponents rotate at 03:00 and 15:00 JST. Do not carry their identity or
// inspected fleet into the next rotation or another account.
const cycle=time=>Math.floor((time+6*3600000)/(12*3600000));
const account=store=>store?.info?.basic?.api_member_id==null?null:crypto.createHash('sha256').update(String(store.info.basic.api_member_id)).digest('hex');
const body=value=>value&&typeof value==='object'&&(value.api_result==null||Number(value.api_result)===1)?value.api_data??value:null;
const id=value=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
const param=(value,key)=>typeof value==='string'?new URLSearchParams(value).get(key):value?.[key];
// Game's practice-result atlas: 0 is unplayed, 1–6 are E,D,C,B,A,S.
// The list collapses perfect SS and S into state 6, while battle_result can
// still provide the exact SS rank during the current session.
const STATE_RANK={1:'E',2:'D',3:'C',4:'B',5:'A',6:'S'};
const RANK_STATE={E:1,D:2,C:3,B:4,A:5,S:6,SS:6};
const validState=value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=6?value:null;
const rankForState=(state,recorded)=>state===6&&recorded==='SS'?'SS':STATE_RANK[state]||null;
class PracticeObserver{
  constructor(directory,{now=()=>Date.now(),legacyHistoryPath=null}={}){this.directory=directory;this.now=now;this.key=null;this.period=null;this.opponents=[];this.known=false;this.history=[];this.legacy=[];this.pending=null;this.revision=0;this.closed=false;
    require('./local_history').readLocalHistory(legacyHistoryPath).then(rows=>{if(!this.closed){this.legacy=rows;this.revision++;}});}
  sync(store){
    const key=account(store),period=cycle(this.now());
    if(key!==this.key){this.key=key;this.history=[];this.period=null;
      if(key)try{const saved=JSON.parse(fs.readFileSync(path.join(this.directory,key+'.json'),'utf8'));
        if(saved.schemaVersion===1&&Array.isArray(saved.history))this.history=saved.history.filter(x=>x&&Number.isFinite(x.time)&&/^(SS|S|A|B|C|D|E)$/.test(x.rank)).slice(0,100);
      }catch(_){} }
    if(period!==this.period){this.period=period;this.opponents=[];this.known=false;this.pending=null;this.revision++;}
  }
  view(store){this.sync(store);return {known:this.known,opponents:this.opponents,history:this.history,localHistory:this.legacy,revision:this.revision};}
  snapshot(store){this.sync(store);return this.key?{key:this.key,period:this.period,time:this.now(),known:this.known,opponents:JSON.parse(JSON.stringify(this.opponents)),pending:this.pending}:null;}
  resetSession(){this.opponents=[];this.known=false;this.pending=null;this.revision++;}
  restore(value,store){this.sync(store);if(!this.key||value?.key!==this.key||value.period!==this.period||!Number.isFinite(value.time)||this.now()-value.time<0||this.now()-value.time>30000||!Array.isArray(value.opponents))return;
    // Earlier session snapshots recorded the server state but did not decode
    // it into rank. Decode on handoff as well as on a fresh list response.
    this.opponents=value.opponents.map(row=>{
      const state=validState(row?.state),recorded=row?.rank;
      // The old observer recorded battle_result.rank without updating state.
      // A recent, same-session handoff is evidence of that observation when
      // the last list was unplayed or had no state; fresh lists never inherit it.
      if((row?.state==null||row.state===0)&&typeof recorded==='string'&&Object.hasOwn(RANK_STATE,recorded))
        return {...row,state:RANK_STATE[recorded],rank:recorded};
      return {...row,state,rank:rankForState(state,recorded)};
    });
    this.known=value.known===true||value.known===undefined&&value.opponents.length>0;this.pending=value.pending||null;this.revision++;}
  save(){if(!this.key)return;try{fs.mkdirSync(this.directory,{recursive:true});const file=path.join(this.directory,this.key+'.json'),tmp=file+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify({schemaVersion:1,history:this.history.slice(0,100)}));fs.renameSync(tmp,file);}catch(_){/* Keep observed history in memory. */}}
  acceptList(data,store){
    this.sync(store);if(this.closed||!this.key||!Array.isArray(data?.api_list))return false;
    const prior=new Map(this.opponents.map(x=>[x.id,x]));
    this.opponents=data.api_list.slice(0,5).flatMap((x,index)=>{const enemy=id(x.api_enemy_id);if(!enemy)return [];
      const state=validState(x.api_state);
      const recorded=prior.get(enemy)?.rank;
      // Retain an observed SS only while the server still reports S. Any
      // other fresh state, including unplayed or unknown, supersedes it.
      const rank=rankForState(state,recorded);
      return [{id:enemy,index:index+1,name:String(x.api_enemy_name||''),level:Number(x.api_enemy_level)||null,
        flagship:id(x.api_enemy_flag_ship),state,ships:prior.get(enemy)?.ships||null,rank}];});this.known=true;this.revision++;return true;
  }
  acceptEnemy(data,store){
    this.sync(store);if(this.closed||!this.key)return false;
    const enemy=id(data?.api_member_id),row=this.opponents.find(x=>x.id===enemy);if(!row||!Array.isArray(data.api_deck?.api_ships))return false;
    row.ships=data.api_deck.api_ships.flatMap(s=>id(s.api_ship_id)?[{masterId:id(s.api_ship_id),level:id(s.api_level)}]:[]);this.revision++;return true;
  }
  observe(detail,store){
    if(this.closed)return;try{this.sync(store);if(!this.key)return;
      const api=String(detail?.path||'').split('?')[0],data=body(detail?.body);if(!data)return;
      if(api==='/kcsapi/api_get_member/practice'&&Array.isArray(data.api_list)){
        this.acceptList(data,store);
      }else if(api==='/kcsapi/api_req_member/get_practice_enemyinfo'){
        this.acceptEnemy(data,store);
      }else if(api==='/kcsapi/api_req_practice/battle'){
        const enemy=id(param(detail.postBody,'api_enemy_id'));this.pending=enemy?{enemy,time:this.now()}:null;
      }else if(api==='/kcsapi/api_req_practice/battle_result'){
        const rank=String(data.api_win_rank||'');if(!/^(SS|S|A|B|C|D|E)$/.test(rank))return;
        const row=this.pending&&this.opponents.find(x=>x.id===this.pending.enemy);
        if(row){row.rank=rank;row.state=RANK_STATE[rank];}
        this.history.unshift({time:this.now(),rank,baseExp:Number.isFinite(Number(data.api_get_base_exp))?Number(data.api_get_base_exp):null,
          opponent:row?.name||null});this.history=this.history.slice(0,100);this.pending=null;this.revision++;this.save();
      }
    }catch(_){/* Passive observation never affects game traffic. */}
  }
  dispose(){this.closed=true;this.opponents=[];this.known=false;this.pending=null;}
}
module.exports={PracticeObserver,cycle};
