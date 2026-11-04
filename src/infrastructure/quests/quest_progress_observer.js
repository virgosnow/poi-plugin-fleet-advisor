'use strict';
const crypto=require('node:crypto');
const {findDefinition,taskSnapshot}=require('../../domain/quests/quest_requirements');
const {listOverviewQuests,missionId}=require('../../domain/quests/quest_overview');
const {evaluateFleetRequirements}=require('../../domain/quests/fleet_requirements');
const {accountKey,cycle}=require('../persistence/quest_progress');
const post=(body,key)=>typeof body==='string'?new URLSearchParams(body).get(key):body?.[key];
const voyageKey=(id,end)=>`${Number(id)}:${Number(end)||0}`;
const ranks={S:4,A:3,B:2,C:1,D:0,E:-1};
function sufficient(rank,minimum){return ranks[String(rank).toUpperCase()]!==undefined&&ranks[String(rank).toUpperCase()]>=({win:2,S:4,A:3,B:2,C:1,D:0,E:-1}[minimum]??99);}
class QuestProgressObserver {
  constructor({progress,now=()=>Date.now(),onChange=()=>{}}){this.progress=progress;this.now=now;this.onChange=onChange;this.sortie=null;this.departures=new Map();this.consumed=new Map();this.account=null;}
  sync(store){const key=accountKey(store);if(key!==this.account){this.account=key;this.sortie=null;this.departures.clear();this.consumed.clear();}return key;}
  resetSession(){this.account=null;this.sortie=null;this.departures.clear();this.consumed.clear();}
  // poi retains the active mission ID even when this plugin is enabled after
  // departure. Capture only in-flight voyages; task eligibility is checked
  // when the real result arrives, as tasks can be accepted after departure.
  remember(store){
    if(!this.sync(store))return;
    const active=new Map();
    for(const [index,fleet] of (store?.info?.fleets||[]).entries()){
      const [state,id,end]=fleet?.api_mission||[];
      if(Number(state)>0&&Number.isInteger(Number(id))&&Number(id)>0){
        const deck=index+1,previous=this.departures.get(deck),key=voyageKey(id,end);
        if(this.consumed.get(deck)===key)continue;
        this.consumed.delete(deck);
        if(previous?.key===key){const {missingSince,...stillActive}=previous;active.set(deck,{...stillActive,key});}
        else active.set(deck,{id:Number(id),key});
      }
    }
    // Redux can clear an arriving fleet just before the result event reaches
    // this listener. Keep its last observed voyage briefly so the event can
    // still be paired, without keeping an absent voyage indefinitely.
    for(const [deck,previous] of this.departures)if(!active.has(deck)&&this.consumed.get(deck)!==previous.key){
      const missingSince=previous.missingSince??this.now();
      if(this.now()-missingSince<=5000)active.set(deck,{...previous,missingSince});
    }
    this.departures=active;
  }
  snapshot(store){
    if(!this.account||this.account!==accountKey(store))return null;
    try{return JSON.parse(JSON.stringify({version:1,account:this.account,capturedAt:this.now(),sortie:this.sortie,departures:[...this.departures],consumed:[...this.consumed]}));}
    catch(e){return null;}
  }
  restore(snapshot,store){
    const account=this.sync(store),now=this.now();
    if(!account||snapshot?.version!==1||snapshot.account!==account||!Number.isFinite(snapshot.capturedAt)||
      snapshot.capturedAt>now||now-snapshot.capturedAt>30000)return false;
    if(Array.isArray(snapshot.consumed))for(const entry of snapshot.consumed){
      const deck=Number(entry?.[0]),key=entry?.[1],mission=store?.info?.fleets?.[deck-1]?.api_mission;
      if(Number.isInteger(deck)&&deck>=1&&deck<=4&&Number(mission?.[0])>0&&key===voyageKey(mission[1],mission[2]))this.consumed.set(deck,key);
    }
    // Keep only tasks and goal identities that still match the loaded catalog.
    const prepared=rows=>Array.isArray(rows)?rows.flatMap(row=>{
      const task=row?.task,definition=findDefinition({api_no:task?.id,api_title:task?.title},now);
      if(!definition||definition.code!==task.code||row.period!==cycle(task.period,now)||!Array.isArray(task.goals)||
        definition.goals.length!==task.goals.length)return [];
      const valid=definition.goals.every((goal,i)=>task.goals[i]?.key===crypto.createHash('sha256').update(JSON.stringify(goal)).digest('hex')&&
        task.goals[i].count===Math.max(1,Number(goal.count)||1));
      return valid?[{task,definition,period:row.period}]:[];
    }):[];
    const prior=snapshot.sortie,match=String(prior?.map||'').match(/^(\d+)-(\d+)$/),deck=Number(prior?.deck),live=store?.sortie;
    if(match&&Number.isInteger(deck)&&deck>=1&&deck<=4&&Number(live?.sortieMapId)===Number(match[1])*10+Number(match[2])&&
      Array.isArray(live?.sortieStatus)&&live.sortieStatus[deck-1]===true&&!Number(live.combinedFlag)){
      const node=Number(live.currentNode),boss=Number(live.bossSpot),changed=Number.isInteger(node)&&node>0&&node!==prior.node;
      this.sortie={...prior,deck,prepared:prepared(prior.prepared),
        node:Number.isInteger(node)&&node>0?node:prior.node,boss:Number.isInteger(boss)&&boss>0?boss:prior.boss,
        ...changed?{consumed:false,eventId:null,nodeSeenAt:snapshot.capturedAt}:{}};
      // poi may have received the result while this plugin was disabled. Only
      // consume its real result when map, node, timestamp and voyage agree.
      const battle=store?.battle?.result;
      if(!this.sortie.consumed&&battle?.valid===true&&battle.combined===false&&
        Number(battle.map)===Number(live.sortieMapId)&&Number(battle.mapCell)===this.sortie.node&&
        Number.isFinite(battle.time)&&Number.isFinite(this.sortie.nodeSeenAt)&&battle.time>=this.sortie.nodeSeenAt&&
        battle.time<=now&&typeof battle.boss==='boolean'&&ranks[battle.rank]!==undefined)
        this.battleResult(store,battle.rank,battle.boss);
    }
    if(Array.isArray(snapshot.departures))for(const entry of snapshot.departures){
      const deck=Number(entry?.[0]),departure=entry?.[1],mission=store?.info?.fleets?.[deck-1]?.api_mission;
      if(Number.isInteger(deck)&&deck>=1&&deck<=4&&Number(mission?.[0])>0&&Number(mission?.[1])===Number(departure?.id)&&
        departure?.key===voyageKey(mission[1],mission[2])&&this.consumed.get(deck)!==departure.key)
        this.departures.set(deck,{id:Number(departure.id),key:voyageKey(mission[1],mission[2]),prepared:prepared(departure.prepared)});
    }
    return true;
  }
  eligible(store,deck){
    const slots=store?.info?.fleets?.[deck-1]?.api_ship;
    if(!Array.isArray(slots)||!slots.some(id=>Number(id)>0))return [];
    const overview=listOverviewQuests({state:store,now:this.now()}).tasks,live=store?.questState?.tasks||[];
    return overview.flatMap(task=>{
      const definition=findDefinition(live.find(row=>Number(row.api_no)===task.id),this.now());
      if(!definition||definition.acceptanceInitialization||definition.completionChecks||
        evaluateFleetRequirements(definition.fleet,store,slots,deck).status!=='met')return [];
      return [{task,definition,period:cycle(task.period,this.now())}];
    });
  }
  record(store,prepared,kind,match){
    this.recordMany(store,prepared,[{kind,match}]);
  }
  battleResult(store,rank,boss){
    const s=this.sortie;if(!s||s.consumed||s.node===null)return;s.consumed=true;
    const rules=[{kind:'battleWin',match:goal=>!goal.bossOnly&&(goal.map===s.map||goal.map==='any')&&sufficient(rank,goal.rankMin||'win')}];
    if(boss)rules.push({kind:'bossWin',match:goal=>(goal.map===s.map||goal.map==='any')&&sufficient(rank,goal.rankMin||'win')},
      {kind:'sortie',match:goal=>goal.anyTargets?.some(target=>target.map===s.map&&!target.phase&&!target.node)&&sufficient(rank,goal.rankMin||'win')});
    this.recordMany(store,s.prepared,rules);
  }
  recordMany(store,prepared,rules){
    if(!prepared.length)return;
    const now=this.now(),candidates=[];
    for(const {task,definition,period} of prepared){
      if(period!==cycle(task.period,now))continue;
      definition.goals.forEach((goal,index)=>{
        if(goal.phase||goal.node||goal.within||goal.items||!rules.some(rule=>goal.kind===rule.kind&&rule.match(goal)))return;
        const display=task.goals[index];
        if(display?.key&&Number.isSafeInteger(display.count))candidates.push({task,display});
      });
    }
    if(!candidates.length)return;
    const snapshot=taskSnapshot(store),active=new Set();
    if(snapshot.known)for(const live of snapshot.tasks){
      if(Number(live?.api_state)!==2)continue;
      const definition=findDefinition(live,now);
      if(definition&&['B','D'].includes(definition.category))active.add(`${Number(live.api_no)}:${definition.code}`);
    }
    const updates=candidates.filter(({task})=>active.has(`${task.id}:${task.code}`)).map(({task,display})=>({task,goal:display}));
    if(updates.length)void this.progress.incrementMany(store,updates).then(changed=>{if(changed)this.onChange();}).catch(()=>this.onChange());
  }
  observe(detail,store){
    try{
      if(!this.sync(store))return;
      const api=String(detail?.path||'').split('?')[0],body=detail?.body?.api_data||detail?.body;
      if(!body||detail?.body?.api_result!=null&&Number(detail.body.api_result)!==1)return;
      if(api==='/kcsapi/api_get_member/questlist'){
        if(Array.isArray(body.api_list))void this.progress.reconcile(store,body.api_list).then(()=>this.onChange()).catch(()=>this.onChange());
      }else if(api==='/kcsapi/api_req_quest/clearitemget'){
        const id=Number(post(detail.postBody,'api_quest_id'));if(id>0)void this.progress.clearTask(store,id).then(()=>this.onChange()).catch(()=>this.onChange());
      }else if(api==='/kcsapi/api_req_map/start'){
        const deck=Number(post(detail.postBody,'api_deck_id')),area=Number(post(detail.postBody,'api_maparea_id')),map=Number(post(detail.postBody,'api_mapinfo_no'));
        this.sortie=deck>0&&area>0&&map>0?{deck,map:`${area}-${map}`,prepared:this.eligible(store,deck),node:null,boss:null,eventId:null,consumed:false}:null;
        if(this.sortie){this.node(body);this.record(store,this.sortie.prepared,'departSortie',goal=>!goal.map||goal.map==='any'||goal.map===this.sortie.map);}
      }else if(api==='/kcsapi/api_req_map/next')this.node(body);
      else if(api==='/kcsapi/api_req_sortie/battleresult'&&this.sortie&&!this.sortie.consumed){
        const s=this.sortie;this.battleResult(store,body.api_win_rank,s.boss!==null&&s.node===s.boss||s.eventId===5);
      }else if(api==='/kcsapi/api_req_mission/start'){
        const deck=Number(post(detail.postBody,'api_deck_id')),id=Number(post(detail.postBody,'api_mission_id'));
        const mission=store?.info?.fleets?.[deck-1]?.api_mission;
        if(deck>0&&id>0){const end=body.api_complatetime||(Number(mission?.[1])===id?mission?.[2]:0);
          const departure={id,key:voyageKey(id,end),prepared:this.eligible(store,deck)};this.consumed.delete(deck);this.departures.set(deck,departure);
          this.record(store,departure.prepared,'expeditionDepart',goal=>goal.missionId==='any'||missionId(goal.missionId)===id);}
      }else if(api==='/kcsapi/api_req_mission/result'){
        const deck=Number(post(detail.postBody,'api_deck_id'));
        const mission=store?.info?.fleets?.[deck-1]?.api_mission;
        const key=voyageKey(mission?.[1],mission?.[2]);
        const saved=this.departures.get(deck);
        const departure=(saved&&(saved.missingSince==null||this.now()-saved.missingSince<=5000)?saved:null)||
          (Number(mission?.[0])>0&&Number(mission?.[1])>0&&this.consumed.get(deck)!==key?{id:Number(mission[1]),key}:null);
        this.departures.delete(deck);
        if(departure)this.consumed.set(deck,Number(mission?.[1])===departure.id?key:departure.key||voyageKey(departure.id,0));
        const result=Number(body.api_clear_result);
        if(departure&&(result===1||result===2)){
          const previous=new Map((departure.prepared||[]).map(row=>[row.task.id,row.period]));
          // A pre-reset active row is not proof the recurring task was
          // accepted again after its reset. New tasks can still be accepted
          // while the fleet is already at sea.
          const ready=this.eligible(store,deck).filter(row=>!previous.has(row.task.id)||previous.get(row.task.id)===row.period);
          this.record(store,ready,'expeditionReturn',goal=>
            (goal.missionId==='any'||missionId(goal.missionId)===departure.id||goal.anyMissionIds?.some(id=>missionId(id)===departure.id))&&
            (goal.resultMin==='success'||goal.resultMin==='greatSuccess'&&result===2));
        }
      }
      if(api!=='/kcsapi/api_req_mission/start'&&api!=='/kcsapi/api_req_mission/result')this.remember(store);
    }catch(e){/* A partial game event must never affect gameplay. */}
  }
  node(body){if(!this.sortie)return;const node=Number(body?.api_no),boss=Number(body?.api_bosscell_no),event=Number(body?.api_event_id);
    this.sortie.node=Number.isInteger(node)&&node>0?node:null;
    this.sortie.nodeSeenAt=this.now();
    if(Number.isInteger(boss)&&boss>0)this.sortie.boss=boss;
    this.sortie.eventId=Number.isInteger(event)&&event>0?event:null;
    this.sortie.consumed=false;
  }
}
module.exports={QuestProgressObserver,sufficient};
