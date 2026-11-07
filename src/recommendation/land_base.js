'use strict';
// A bounded, read-only land-base proposal. It never changes game equipment.
// Radius and combat calculations are delegated to the shared base evaluator.
const {maps}=require('../../data/sortie/land_base/maps.json');
const land=require('../domain/combat/land_base');
const {sortBases,createBaseSorter}=require('./land_base_order');
const {eligiblePlane}=require('../domain/fleet/airbase_relocation');
const RECON_TYPES=new Set([9,10,41,49,59,94]);
const SURFACE_TYPES=new Set([7,8,11,47,53,57,58,91]);
const ASW_TYPES=new Set([7,8,10,11,25,26,47,53,57,58,91]);
const typeOf=master=>Number(master?.api_type?.[2]);
const validId=id=>Number.isSafeInteger(Number(id))&&Number(id)>0;
const mapFor=area=>maps.find(map=>map.id===area&&map.available);
const planeCapacity=master=>!eligiblePlane(master)?null:RECON_TYPES.has(typeOf(master))?4:typeOf(master)===53?9:18;
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const enemyCatalog=new Map(require('../../data/sortie/enemy_catalog.json').enemies.map(enemy=>[enemy.apiId,enemy]));
const upper=value=>Array.isArray(value)?Math.max(...value):value;
const normalizeId=slot=>Number(slot?.itemId??slot?.api_slotid??0);
const unique=values=>[...new Set(values)];
function sourceBases(store,area){
  const map=mapFor(area);if(!map)return [];
  return (Array.isArray(store?.info?.airbase)?store.info.airbase:[]).filter(b=>Number(b.api_area_id)===map.baseAreaId)
    .sort((a,b)=>Number(a.api_rid)-Number(b.api_rid)).map(base=>({
      areaId:Number(base.api_area_id),rid:Number(base.api_rid),mode:Number(base.api_action_kind),
      range:base.api_distance&&typeof base.api_distance==='object'?{...base.api_distance}:base.api_distance,
      targets:[],slots:(Array.isArray(base.api_plane_info)?base.api_plane_info:[]).slice().sort((a,b)=>Number(a.api_squadron_id)-Number(b.api_squadron_id)).map((slot,index)=>({
        slotId:Number(slot.api_squadron_id??index+1),itemId:slot.api_slotid==null?null:Number(slot.api_slotid),
        count:slot.api_count??null,maxCount:slot.api_max_count??null,state:slot.api_state??null
      }))
    }));
}
// Stock and the specified base's observed equipment are the only safe donors.
// Equipment on ships, elsewhere in the base group, or reserved in the draft is
// not silently borrowed. A transferred/not-ready current slot is not a donor.
function inventory(store,{area,bases,scheme,baseRid}={}){
  const map=mapFor(area);if(!map)return [];
  const items=store?.info?.equips||{},masters=store?.const?.$equips||{},shipItems=new Set();
  const relocating=new Set((store?.info?.airbaseRelocations||[]).map(row=>Number(row.itemId)));
  for(const ship of Object.values(store?.info?.ships||{}))for(const id of [...(ship?.api_slot||[]),ship?.api_slot_ex])if(validId(id))shipItems.add(Number(id));
  for(const ship of scheme?.ships||[])for(const id of [...(ship?.slots||[]),ship?.ex])if(validId(id))shipItems.add(Number(id));
  const original=new Map();
  for(const base of store?.info?.airbase||[])for(const slot of base?.api_plane_info||[])if(validId(slot?.api_slotid))
    original.set(Number(slot.api_slotid),{areaId:Number(base.api_area_id),rid:Number(base.api_rid),slotId:Number(slot.api_squadron_id),slot});
  const reserved=new Map();
  for(const base of bases||[])for(const slot of base?.slots||[])if(validId(slot?.itemId)){
    const id=Number(slot.itemId),claims=reserved.get(id)||[];
    claims.push({areaId:Number(base.areaId),rid:Number(base.rid),slotId:Number(slot.slotId)});reserved.set(id,claims);
  }
  const out=[];
  for(const [key,item] of Object.entries(items)){
    const itemId=Number(key),masterId=Number(item?.api_slotitem_id),master=masters[masterId],old=original.get(itemId),draft=reserved.get(itemId);
    if(!validId(itemId)||!eligiblePlane(master)||shipItems.has(itemId)||relocating.has(itemId))continue;
    // Until mapinfo has identified all bases an apparently free item might
    // belong to an unsynchronized base. Never present it as warehouse stock.
    if(!old&&(store?.airbaseSync?.complete!==true||store?.airbaseSync?.relocationsComplete===false))continue;
    if(old&&(old.areaId!==map.baseAreaId||baseRid==null||old.rid!==Number(baseRid)||Number(old.slot?.api_state)!==1||!positive(old.slot?.api_count)||old.slot.api_count<=0))continue;
    if(draft?.some(claim=>claim.areaId!==map.baseAreaId||baseRid==null||claim.rid!==Number(baseRid)))continue;
    out.push({itemId,masterId,master,item,source:old?'base':'stock',areaId:old?.areaId??null,rid:old?.rid??null,slotId:old?.slotId??null,
      count:old?.slot?.api_count??null,maxCount:old?.slot?.api_max_count??null,state:old?.slot?.api_state??null});
  }
  return out.sort((a,b)=>a.itemId-b.itemId);
}
function nodesFor(area,routeNodes){
  const map=mapFor(area);if(!map||!Array.isArray(routeNodes))return [];
  let nodes;try{nodes=require(`../../data/sortie/encounters/${area}.json`).nodes||{};}catch(_){return [];}
  return unique(routeNodes.filter(id=>typeof id==='string')).map((id,index)=>{
    const data=nodes[id],radius=land.nodeRadius(area,id);
    if(!data||!['battle','asw','aerialRaid','aerialCombat'].includes(data.kind)||radius===null)return null;
    const patterns=Object.values(data.phases||{}).flatMap(phase=>phase.patterns||[]),air=patterns.map(p=>p.enemyAirPower).filter(positive);
    const defenses=patterns.flatMap(pattern=>[...(pattern.enemyShips||[]),...(pattern.escortFleet?.enemyShips||[])])
      .map(ship=>enemyCatalog.get(ship.apiId)).filter(enemy=>enemy&&!/潜水/.test(enemy.shipType||''))
      .map(enemy=>({armor:upper(enemy.stats?.装甲),hp:upper(enemy.stats?.耐久)}))
      .filter(enemy=>positive(enemy.armor)&&positive(enemy.hp)&&enemy.hp>0);
    const notable=map.notableNodes?.find(node=>node.id===id),boss=map.bossNodes.includes(id);
    return {id,index,radius,kind:data.kind,boss,enemyAir:air.length?Math.max(...air):null,defenses,
      ground:!!notable?.targetTypes?.includes('installation'),mixedAsw:!!notable?.targetTypes?.includes('submarine'),
      // Start with the objective, not the node with the largest air number.
      // Forward assignments are compared with combat scenarios later.
      priority:boss?1000:(data.kind==='battle'?250:data.kind==='asw'?180:80)+Math.min(100,Math.max(0,...air)*0.2)};
  }).filter(Boolean);
}
// Enemy land-base air power includes reconnaissance and can differ from the
// fleet-air value printed in the encounter data. Unknown formations must not
// be used to claim that a change preserves air control.
function withBaseAirTargets(store,area,nodes){
  try{
    const {routeAirReference}=require('../domain/routes/route_air');
    const {encounterStage}=require('../domain/combat/encounter_stage');
    const enemy=require('../domain/combat/enemy_land_air');
    const ref=routeAirReference({},area,{area,routePaths:[{nodes:nodes.map(n=>n.id)}],encounterStage:encounterStage(store,area)});
    const index=enemy.equipmentIndex(store);
    return nodes.map(node=>{
      const found=ref.nodes.find(row=>row.id===node.id),formations=found&&enemy.alternatives(found,index);
      return {...node,baseEnemyAir:formations?.length?Math.max(...formations.map(slots=>enemy.power(slots,true))):null};
    });
  }catch(_){return nodes;}
}
function airTier(air,enemy){
  if(enemy===0)return 4;
  return air>=3*enemy?4:air*2>=3*enemy?3:air*3>2*enemy?2:air*3>enemy?1:0;
}
function surfaceAttack(slot,target){
  if(target.kind==='asw'||!SURFACE_TYPES.has(slot.type))return false;
  if(target.ground&&!([7,11,47,53,57,91].includes(slot.type)))return false;
  return (target.ground?slot.fire:[8,47,53,58].includes(slot.type)?slot.torpedo:slot.fire)>0;
}
function attackScore(row,target,recon=1,count){
  const m=row.master,t=typeOf(m),asw=Math.max(0,Number(m.api_tais)||0),stars=Number(row.item?.api_level)||0;
  const planes=count??planeCapacity(m)??18;
  if(target.kind==='asw')return ASW_TYPES.has(t)&&asw>=7?
    (((asw+.66*Math.sqrt(stars))*Math.sqrt(1.8*planes)+25)*(asw>=10?.85:.575)*(t===47?1.8:1)*recon)*.4:0;
  if(!SURFACE_TYPES.has(t)||target.ground&&!([7,11,47,53,57,91].includes(t)))return 0;
  const slot={type:t,torpedo:Math.max(0,Number(m.api_raig)||0),fire:Math.max(0,Number(m.api_baku)||0),stars};
  if(!(target.ground?slot.fire:[8,47,53,58].includes(t)?slot.torpedo:slot.fire))return 0;
  return land.surfacePower(slot,planes,recon,!!target.ground)*.4;
}
function itemScore(row,target){
  const m=row.master,t=typeOf(m),aa=Math.max(0,Number(m.api_tyku)||0)+(t===48?1.5*Math.max(0,Number(m.api_houk)||0):0);
  const asw=Math.max(0,Number(m.api_tais)||0),attack=attackScore(row,target);
  const mixed=target.mixedAsw&&ASW_TYPES.has(t)&&asw>=7?asw*1.5:0;
  return attack+mixed+aa*2.5+(t===49?6:0)+(row.source==='base'?0.01:0);
}
const emptySlot=(slot,index)=>({slotId:Number(slot?.slotId??index+1),itemId:0,count:0,maxCount:slot?.maxCount??null,locked:!!slot?.locked,
  ...(validId(slot?.itemId)||slot?.planned?{planned:true}:{})});
function draftSlot(row,old,index){
  if(row.source==='base'&&row.itemId===old?.itemId)return {...old,slotId:old.slotId??index+1};
  if(row.source==='base')return {slotId:Number(old?.slotId??index+1),itemId:row.itemId,count:row.count,maxCount:row.maxCount,state:row.state,locked:!!old?.locked,planned:true,withinBase:true};
  const max=planeCapacity(row.master);
  return {slotId:Number(old?.slotId??index+1),itemId:row.itemId,count:max,maxCount:max,planned:true,locked:!!old?.locked};
}
function scoreReading(store,reading,target){
  if(reading.range===null||reading.range<target.radius||reading.airPower===null)return null;
  let attack=0,asw=0,useful=false;const recon=land.reconAttackMultiplier(reading.slots);
  for(const slot of reading.slots){
    const row={master:store.const.$equips[slot.masterId],item:store.info?.equips?.[slot.itemId],source:'stock'};
    const rawAttack=attackScore(row,target,recon,slot.count);
    // Against surface fleets compare damage after representative enemy armor,
    // so a scout can improve a three-bomber strike instead of receiving only
    // an unrelated flat bonus. This is a ranking heuristic, not a hit forecast.
    const surface=target.kind!=='asw'&&!target.ground&&rawAttack>0&&target.defenses?.length;
    const adjusted=surface?target.defenses.reduce((sum,enemy)=>sum+
      Math.min(enemy.hp,Math.max(0,rawAttack/.4-enemy.armor)),0)/target.defenses.length*.4:rawAttack;
    attack+=itemScore(row,target)+adjusted-attackScore(row,target);
    if(ASW_TYPES.has(slot.type)&&slot.asw>=7)asw++;
    if(target.kind==='asw')useful||=ASW_TYPES.has(slot.type)&&slot.asw>=7;
    else {
      // A reconnaissance-only team cannot attack or suppress opposing air.
      // Fighters alone are useful only against a known nonzero enemy air force.
      if(target.enemyAir>0&&land.airCombat.has(slot.type)&&slot.aa>0)useful=true;
      if(SURFACE_TYPES.has(slot.type)){
        const stat=target.ground?slot.fire:[8,47,53,58].includes(slot.type)?slot.torpedo:slot.fire;
        if((!target.ground||[7,11,47,53,57,91].includes(slot.type))&&stat>0)useful=true;
      }
    }
  }
  if(!reading.slots.length||!useful||target.kind==='asw'&&!asw)return null;
  const air=reading.airPower.min,airTarget=target.enemyAir;
  const control=airTarget>0?(air>=3*airTarget?120:air*2>=3*airTarget?80:air*3>=2*airTarget?45:0):0;
  return {score:attack+Math.min(air,Math.max(30,airTarget*1.5))*0.8+control,reading};
}
function scoreSquadron(store,base,target){return scoreReading(store,land.inspectSquadron(store,base),target);}
// Keep the search bounded independently of how many duplicate aircraft a
// veteran account owns. Diversity by category prevents fighters from evicting
// reconnaissance or bombers before a complete fit is evaluated.
function shortlist(rows,target,oldIds,score=itemScore){
  const distance=row=>Number(row.master.api_distance),valid=rows.filter(row=>Number.isFinite(distance(row))&&distance(row)>0&&distance(row)>=target.radius-3);
  const ranked=valid.slice().sort((a,b)=>score(b,target)-score(a,target)||a.itemId-b.itemId);
  const attackers=ranked.filter(r=>SURFACE_TYPES.has(typeOf(r.master))),
    escorts=ranked.filter(r=>[6,45,48,56].includes(typeOf(r.master))),
    scouts=ranked.filter(r=>RECON_TYPES.has(typeOf(r.master))),
    asw=ranked.filter(r=>ASW_TYPES.has(typeOf(r.master))&&Number(r.master.api_tais)>=7),
    original=ranked.filter(r=>oldIds.has(r.itemId));
  const picked=new Map(),add=(items,limit)=>{for(const row of items.slice(0,limit))picked.set(row.itemId,row);};
  // A fighter's short range can dominate a naive score ranking and evict all
  // aircraft able to reach Boss. Keep independent long-range attack/escort
  // candidates before allowing short-range + reconnaissance combinations.
  add(original,4);
  add(attackers.filter(row=>distance(row)>=target.radius),8);
  add(escorts.filter(row=>distance(row)>=target.radius),8);
  add(asw.filter(row=>distance(row)>=target.radius),5);
  add(scouts,5);
  add(attackers,3);add(escorts,3);add(asw,3);
  const result=[...picked.values()];
  return result;
}
function candidateFor(store,base,target,available,lockedSlots,requiredTargets=[],shape=null,evaluationCache=null){
  const sortCandidate=createBaseSorter(store,lockedSlots);
  const locked=new Set((lockedSlots||[]).filter(s=>Number(s.rid)===Number(base.rid)).map(s=>Number(s.slotId)));
  const input=Array.isArray(base.slots)?base.slots:[];if(input.length!==4||input.some(slot=>slot?.itemId==null))return null;
  const fixed=input.map((s,i)=>!!s?.locked||locked.has(Number(s?.slotId??i+1)));
  const initiallyUsed=new Set(input.filter((s,i)=>fixed[i]&&validId(s?.itemId)).map(s=>Number(s.itemId)));
  if(initiallyUsed.size!==input.filter((s,i)=>fixed[i]&&validId(s?.itemId)).length)return null;
  const scores=new Map(),score=(row,node)=>{
    let values=scores.get(row.itemId);if(!values){values=new Map();scores.set(row.itemId,values);}
    if(!values.has(node))values.set(node,itemScore(row,node));return values.get(node);
  };
  const oldIds=new Set(input.map(s=>Number(s.itemId)).filter(validId)),targets=[target,...requiredTargets],
    pool=[...new Map(targets.flatMap(node=>shortlist(available,node,oldIds,score)).map(row=>[row.itemId,row])).values()];
  const bestScore=new Map(pool.map(row=>[row.itemId,Math.max(...targets.map(node=>score(row,node)))]));
  const categories=new Map();
  for(const id of new Set([...oldIds,...pool.map(row=>row.itemId)])){
    const item=store?.info?.equips?.[id],master=store?.const?.$equips?.[item?.api_slotitem_id],type=typeOf(master);
    const attack=!!master&&attackScore({master,item},target)>0;
    categories.set(id,{fighter:[6,45,48,56].includes(type),recon:RECON_TYPES.has(type),asw:ASW_TYPES.has(type)&&Number(master?.api_tais)>=7,
      attack,landAttack:attack&&[47,53].includes(type),distance:Number(master?.api_distance)});
  }
  const fitsShape=(slots,remaining)=>{
    if(!shape)return true;
    const counts={fighter:0,recon:0,attack:0,landAttack:0};
    for(const slot of slots){const c=categories.get(Number(slot.itemId));if(c)for(const key of Object.keys(counts))if(c[key])counts[key]++;}
    return Object.entries(shape).every(([key,wanted])=>counts[key]<=wanted&&counts[key]+remaining>=wanted);
  };
  let beams=[{slots:[],used:initiallyUsed,rough:0}];
  for(let i=0;i<4;i++){
    const old=input[i];if(fixed[i]){beams=beams.map(b=>({...b,slots:b.slots.concat({...old,locked:true})}));continue;}
    let next=[];for(const beam of beams){
      next.push({slots:beam.slots.concat(emptySlot(old,i)),used:beam.used,rough:beam.rough});
      for(const row of pool){if(beam.used.has(row.itemId))continue;
        const used=new Set(beam.used);used.add(row.itemId);
        next.push({slots:beam.slots.concat(draftSlot(row,old,i)),used,rough:beam.rough+bestScore.get(row.itemId)});
      }
    }
    // Discard shapes that cannot possibly meet this role before sorting the
    // beam. Most permutations are irrelevant to a constrained comparison.
    if(shape)next=next.filter(beam=>fitsShape(beam.slots,4-beam.slots.length));
    next.sort((a,b)=>b.rough-a.rough);
    // Preserve materially different fighter/recon/ASW structures; retaining
    // only the highest attack totals would prune every useful escort fighter.
    const direct=new Map(),extended=new Map(),needed=Math.max(...targets.map(node=>node.radius));
    for(const beam of next){
      let fighters=0,recon=0,asw=0,attack=0,directRange=true;
      for(const slot of beam.slots){const category=categories.get(Number(slot.itemId));
        if(category?.fighter)fighters++;if(category?.recon)recon++;if(category?.asw)asw++;if(category?.attack)attack++;
        if(category&&(!Number.isFinite(category.distance)||category.distance<needed))directRange=false;}
      // Reserve half the beam for aircraft that can reach without extension.
      // Otherwise dozens of stronger short-range interceptors crowd out every
      // feasible Boss combination before range is checked.
      const lane=directRange?direct:extended,key=`${fighters}:${recon}:${asw}:${attack}`;
      let group=lane.get(key);if(!group){group={rows:[],seen:new Set()};lane.set(key,group);}
      // Slot permutations of the same aircraft should not occupy all four
      // places for a composition before scouts or other aircraft can compete.
      const signature=beam.slots.map(slot=>Number(slot.itemId)||0).sort((a,b)=>a-b).join(',');
      if(group.rows.length>=4||group.seen.has(signature))continue;
      group.seen.add(signature);group.rows.push(beam);
    }
    // Admit each distinct composition before spending the remaining bounded
    // beam on close alternatives. Raw attack scores alone underprice scouts.
    const take=groups=>{const rows=[];for(let rank=0;rank<4&&rows.length<30;rank++)
      for(const group of groups.values())if(group.rows[rank]&&rows.length<30)rows.push(group.rows[rank]);return rows;};
    beams=take(direct).concat(take(extended));
  }
  let best=null;const mixed=[];
  // Also compare the exact original outfit: missing range data can still be
  // verified with the observed base range, but never after a modification.
  const original={...base,slots:input.map(slot=>({...slot}))};
  const allowed=new Set(available.map(row=>row.itemId));
  for(const slots of [original.slots,...beams.map(b=>b.slots)]){
    if(!fitsShape(slots,0))continue;
    if(new Set(slots.filter(s=>validId(s.itemId)).map(s=>Number(s.itemId))).size!==slots.filter(s=>validId(s.itemId)).length)continue;
    if(slots.some(s=>validId(s.itemId)&&!allowed.has(Number(s.itemId))))continue;
    const changed=slots.some((slot,i)=>Number(slot.itemId)!==Number(input[i].itemId));
    const candidate=sortCandidate([{...base,slots,...(changed?{range:null,api_distance:null}:{})}])[0];
    const cacheKey=evaluationCache?JSON.stringify(candidate):null;
    let evaluated=evaluationCache?.get(cacheKey);
    if(evaluated===undefined){
      evaluated=scoreSquadron(store,candidate,target);
      if(evaluated&&requiredTargets.some(node=>!scoreSquadron(store,candidate,node)))evaluated=null;
      evaluationCache?.set(cacheKey,evaluated);
    }
    if(!evaluated)continue;
    const adjustments=candidate.slots.filter((s,i)=>Number(s.itemId)!==Number(input[i].itemId)).length;
    const score=evaluated.score-adjustments*0.01;
    const entry={base:candidate,score,reading:evaluated.reading};
    if(!best||score>best.score)best=entry;
    if(evaluated.reading.slots.some(slot=>surfaceAttack(slot,target)))mixed.push(entry);
  }
  // A strike team has two jobs: damage the enemy and reduce its aircraft.
  // Once at least air disadvantage is attainable, pursuing a higher tier at
  // the cost of every bomber is not the default 6-5 (or general) strategy.
  // Unknown enemy air and multiple locked destinations stay conservative.
  const combatTargets=targets.filter(node=>node.kind!=='asw');
  if(best&&target.kind!=='asw'&&combatTargets.length&&
      combatTargets.every(node=>positive(node.baseEnemyAir))){
    const usable=mixed.filter(entry=>combatTargets.every(node=>
      airTier(entry.reading.airPower.min,node.baseEnemyAir)>=Math.min(1,airTier(best.reading.airPower.min,node.baseEnemyAir))));
    // The bonus rewards retaining a strike capability, not every additional
    // bomber: otherwise a useful recon aircraft can never win the comparison.
    const strikeValue=entry=>entry.score+90;
    if(usable.length)best=usable.reduce((a,b)=>strikeValue(a)>=strikeValue(b)?a:b);
  }
  return best;
}
// Defense is a separate hypothetical assignment; never relabel an idle or
// manually locked squadron as useful unless it actually has a ready fighter.
// Existing in-transit aircraft cannot be moved by this planning operation.
function defenseCandidate(store,base,available,lockedSlots){
  const input=base.slots;if(!Array.isArray(input)||input.length!==4||input.some(s=>s?.itemId==null))return null;
  const fixed=new Set((lockedSlots||[]).filter(s=>Number(s.rid)===Number(base.rid)).map(s=>Number(s.slotId)));
  if(input.some(s=>validId(s.itemId)&&!s.planned&&Number(s.state)!==1))return null;
  const score=row=>{
    const master=row.master,type=typeOf(master);
    if(![6,45,48,56].includes(type))return 0;
    return Math.max(0,Number(master.api_tyku)||0)+(type===48?Math.max(0,Number(master.api_houk)||0)+2*Math.max(0,Number(master.api_houm)||0):0)+
      (Number(row.item.api_level)||0)*.2+(Number(row.item.api_alv)||0)*.1;
  };
  const pool=available.filter(row=>score(row)>0).sort((a,b)=>score(b)-score(a)||a.itemId-b.itemId);
  const used=new Set(input.filter(s=>s.locked||fixed.has(s.slotId)).map(s=>Number(s.itemId)).filter(validId)),slots=[];
  let total=0,ready=0;
  for(let index=0;index<input.length;index++){
    const old=input[index];
    if(old.locked||fixed.has(old.slotId)){
      slots.push({...old});const row=available.find(r=>r.itemId===Number(old.itemId));
      if(row&&score(row)>0){total+=score(row);ready++;}continue;
    }
    const row=pool.find(candidate=>!used.has(candidate.itemId));
    if(!row){slots.push(emptySlot(old,index));continue;}
    used.add(row.itemId);slots.push(draftSlot(row,old,index));total+=score(row);ready++;
  }
  return ready?{base:sortBases(store,[{...base,slots,mode:2,modePlanned:true,targets:[]}],lockedSlots)[0],score:total,ready}:null;
}
// Validate a hypothetical plan against the latest live snapshot.  In
// particular, planned equipment is not assumed to have been deployed yet;
// this establishes safe ownership and model inputs, not execution readiness.
function validatePlan(store,{area,bases,scheme}={}){
  const issues=[],map=mapFor(area);
  if(!map)return {valid:false,issues:['该海域没有已确认的基地航空队资料']};
  if(!Array.isArray(bases))return {valid:false,issues:['基地航空队方案资料不足']};
  if(!scheme||!Array.isArray(scheme.ships))issues.push('舰队编成资料不足');
  if(!Array.isArray(store?.info?.airbase))issues.push('基地航空队资料尚未完整同步');
  if(!store?.info?.equips||!store?.const?.$equips||!store?.info?.ships)issues.push('装备或舰娘资料尚未完整同步');
  const owned=store?.info?.equips||{},masters=store?.const?.$equips||{},ships=store?.info?.ships||{};
  const occupiedShips=new Set();
  for(const ship of Object.values(ships))for(const id of [...(ship?.api_slot||[]),ship?.api_slot_ex])if(validId(id))occupiedShips.add(Number(id));
  for(const ship of scheme?.ships||[])for(const id of [...(ship?.slots||[]),ship?.ex])if(validId(id))occupiedShips.add(Number(id));
  const observedBases=new Map(),observedItems=new Map(),relocating=new Set((store?.info?.airbaseRelocations||[]).map(row=>Number(row.itemId)));
  for(const b of store?.info?.airbase||[]){
    const areaId=Number(b.api_area_id),rid=Number(b.api_rid),key=`${areaId}:${rid}`;
    const group=observedBases.get(key)||[];group.push(b);observedBases.set(key,group);
    for(const s of b.api_plane_info||[])if(validId(s?.api_slotid)){
      const id=Number(s.api_slotid),sources=observedItems.get(id)||[];
      sources.push({areaId,rid,slotId:Number(s.api_squadron_id),slot:s});observedItems.set(id,sources);
    }
  }
  const crossCounts=new Map();
  for(const base of bases)for(const slot of Array.isArray(base?.slots)?base.slots:[]){
    const source=(observedItems.get(Number(slot?.itemId))||[])[0];
    if(source&&source.areaId===Number(base.areaId)&&source.rid!==Number(base.rid)){
      const key=`${source.areaId}:${source.rid}:${Number(base.rid)}`;
      crossCounts.set(key,(crossCounts.get(key)||0)+1);
    }
  }
  for(const [key,count] of crossCounts){
    const [areaId,from,to]=key.split(':');
    if((crossCounts.get(`${areaId}:${to}:${from}`)||0)!==count){issues.push('跨队换装须与同海域已就绪飞机直接交换');break;}
  }
  const claims=new Map();
  for(const b of bases)for(const slot of Array.isArray(b?.slots)?b.slots:[])if(validId(slot?.itemId)){
    const id=Number(slot.itemId),items=claims.get(id)||[];
    items.push({active:Array.isArray(b.targets)&&b.targets.some(Boolean)});claims.set(id,items);
  }
  for(const entries of claims.values())if(entries.length>1&&entries.some(entry=>entry.active))issues.push('出击航空队装备与其他基地槽重复');
  const seenBases=new Set();let dispatched=0;
  for(const base of bases){
    // Idle bases do not participate in this forecast. Their declared plane
    // IDs are still checked above for conflicts with an active squadron.
    if(!Array.isArray(base?.targets)||!base.targets.some(Boolean))continue;
    const areaId=Number(base?.areaId),rid=Number(base?.rid),key=`${areaId}:${rid}`,name=`第 ${rid} 航空队`;
    if(areaId!==map.baseAreaId||!Number.isSafeInteger(rid)||rid<=0){issues.push('基地航空队区域或编号无效');continue;}
    if(seenBases.has(key)){issues.push(`${name}在方案中重复`);continue;}seenBases.add(key);
    const actualGroup=observedBases.get(key)||[],actual=actualGroup.length===1?actualGroup[0]:null;
    if(!actual||!Array.isArray(actual.api_plane_info)){issues.push(`${name}当前资料不足`);continue;}
    const distance=value=>positive(value)?value:positive(value?.api_base)&&positive(value?.api_bonus)?value.api_base+value.api_bonus:null;
    if(!base.slots?.some(slot=>slot?.planned)&&(base.range!=null||base.api_distance!=null)){
      const plannedRange=distance(base.range??base.api_distance),actualRange=distance(actual.api_distance);
      if(plannedRange===null||actualRange===null||plannedRange!==actualRange)issues.push(`${name}当前航程资料已变化或待确认`);
    }
    const targets=base.targets;
    if(!Array.isArray(targets)||targets.length>2||targets.some(node=>typeof node!=='string')){issues.push(`${name}攻击波次资料不足`);continue;}
    const targetNodes=targets.filter(Boolean);if(targetNodes.length)dispatched++;
    const observedSlots=new Map(actual.api_plane_info.map(s=>[Number(s.api_squadron_id),s])),seenSlots=new Set();
    if(!Array.isArray(base.slots)||base.slots.length!==4){issues.push(`${name}飞机槽资料不足`);continue;}
    for(let index=0;index<base.slots.length;index++){
      const slot=base.slots[index],slotId=Number(slot?.slotId),id=slot?.itemId;
      if(!Number.isInteger(slotId)||slotId<1||slotId>4||seenSlots.has(slotId)){issues.push(`${name}槽位编号无效或重复`);continue;}
      seenSlots.add(slotId);const observed=observedSlots.get(slotId),prefix=`${name}第 ${slotId} 槽`;
      if(!observed||observed.api_slotid==null||id==null||!Number.isSafeInteger(Number(id))||Number(id)<0){issues.push(`${prefix}当前装备资料不足`);continue;}
      const instanceId=Number(id),sources=observedItems.get(instanceId)||[],source=sources[0];
      if(!slot.planned){
        if(Number(observed.api_slotid)!==instanceId){issues.push(`${prefix}装备已变化`);continue;}
        if(instanceId&&(!Number.isInteger(slot.count)||!Number.isInteger(Number(observed.api_count))||slot.count!==Number(observed.api_count)||
          slot.maxCount!=null&&Number(slot.maxCount)!==Number(observed.api_max_count)||
          slot.state!=null&&Number(slot.state)!==Number(observed.api_state)))issues.push(`${prefix}飞机数量或状态已变化`);
      }
      if(!instanceId)continue;
      const item=owned[instanceId],master=masters[item?.api_slotitem_id];
      if(!item||!master){issues.push(`${prefix}装备实例或机型资料不足`);continue;}
      if(!eligiblePlane(master)){issues.push(`${prefix}不是可用飞机类型`);continue;}
      if(relocating.has(instanceId))issues.push(`${prefix}飞机转场中`);
      if(occupiedShips.has(instanceId))issues.push(`${prefix}装备被舰队占用`);
      if(!sources.length&&store?.airbaseSync?.complete!==true)issues.push(`${prefix}装备归属尚未完整同步`);
      if(sources.length>1)issues.push(`${prefix}当前基地装备归属存在冲突`);
      if(sources.some(source=>source.areaId!==areaId))issues.push(`${prefix}装备由其他海域基地占用`);
      if(source&&source.areaId===areaId&&source.rid!==rid){
        const other=bases.find(row=>Number(row.areaId)===areaId&&Number(row.rid)===source.rid);
        const returned=other?.slots?.find(row=>(observedItems.get(Number(row.itemId))||[])
          .some(origin=>origin.areaId===areaId&&origin.rid===rid&&Number(origin.slot.api_state)===1));
        // Within one airbase group the game permits an occupied-slot swap.
        // The exchange can precede subsequent reordering within either team;
        // the balanced cross-team counts above still require a return plane.
        if(Number(source.slot.api_state)!==1||!returned)
          issues.push(`${prefix}跨队换装须与同海域已就绪飞机直接交换`);
      }
      if(slot.planned&&source&&(Number(source.slot.api_state)!==1||!positive(source.slot.api_count)||source.slot.api_count<=0))
        issues.push(`${prefix}来源飞机尚未就绪`);
      if(targetNodes.length&&(!Number.isInteger(slot.count)||slot.count<=0||!Number.isInteger(slot.maxCount)||slot.maxCount<=0||slot.count>slot.maxCount))
        issues.push(`${prefix}飞机搭载数不足或未知`);
      if(targetNodes.length&&!slot.planned&&Number(observed.api_state)!==1)issues.push(`${prefix}飞机尚未就绪`);
    }
    if(targetNodes.length){
      const reading=land.inspectSquadron(store,base);
      if(reading.range===null||reading.airPower===null)issues.push(`${name}航程或制空资料待确认`);
      for(const target of targetNodes){const radius=land.nodeRadius(area,target);
        if(radius===null)issues.push(`${name}的 ${target} 点航程资料待确认`);
        else if(reading.range!==null&&reading.range<radius)issues.push(`${name}无法抵达 ${target} 点`);
        if(!nodesFor(area,[target]).length)issues.push(`${name}的 ${target} 点无法确认可发生基地攻击`);
      }
    }
  }
  if(dispatched>map.maxSortieSquadrons)issues.push(`指定 ${dispatched} 队出击，超过海域上限 ${map.maxSortieSquadrons} 队`);
  const uniqueIssues=unique(issues);return {valid:uniqueIssues.length===0,issues:uniqueIssues};
}
function recommendLandBases(store,{area,routeNodes,scheme,bases,lockedSlots=[]}={}){
  const map=mapFor(area);if(!map)return {status:'unavailable',bases:[],warnings:['此海域没有已知可用的基地航空队']};
  const draft=Array.isArray(bases)?bases:sourceBases(store,area);
  if(!draft.length)return {status:store?.airbaseSync?.complete?'unavailable':'unknown',bases:[],warnings:[store?.airbaseSync?.complete?'基地航空队未解锁':'基地航空队资料尚未同步']};
  const nodes=withBaseAirTargets(store,area,nodesFor(area,routeNodes));if(!nodes.length)return {status:'unknown',bases:draft,warnings:['所选路线没有可确认半径的基地攻击节点']};
  const result=draft.map(base=>({...base,slots:(base.slots||[]).map(slot=>({...slot})),targets:[...(base.targets||[])]}));
  const remaining=result.filter(base=>Number(base.areaId)===map.baseAreaId),warnings=[],used=new Set(),chosen=new Set();
  const ordered=nodes.slice().sort((a,b)=>b.priority-a.priority||a.index-b.index);
  const mapInfo=store?.info?.maps?.[Number(area.replace('-',''))],defeated=mapInfo?.api_defeat_count,required=mapInfo?.api_required_defeat_count;
  const raidNotStarted=Number(mapInfo?.api_gauge_type)===1&&Number.isInteger(required)&&required>0&&
    Number.isInteger(defeated)&&defeated>=0&&defeated<=required&&Number.isInteger(map.baseRaid?.startAfterBossKills)&&defeated<map.baseRaid.startAfterBossKills;
  const cleared=require('../domain/combat/encounter_stage').encounterStage(store,area)==='after';
  // Prepare the spare squadron for the map's potential base raids even when
  // the current gauge has not reached them yet. The player can keep this
  // configuration as progress advances, without changing either sortie team.
  const defensePlanEnabled=!!map.baseRaid?.possible;
  // On maps with a spare squadron, reserve its conventional numbered slot
  // for defense. A locked or unavailable squadron is never invented.
  const defenseRid=map.maxSortieSquadrons+1;
  const defenseAvailable=defensePlanEnabled&&remaining.some(base=>Number(base.rid)===defenseRid&&!base.targetsLocked&&!base.modeLocked);
  if(store?.airbaseSync?.complete!==true)warnings.push('基地库存资料尚未完整同步，未借用仓库飞机');
  if(!remaining.length)warnings.push('当前海域没有可用的基地航空队');
  // Short-ranged interceptors are particularly useful defending the base;
  // retain them for that role only if there are also enough separate aircraft
  // that can reach a useful sortie target. Existing/manual slots stay reserved.
  const defenseReserve=new Set();
  if(defenseAvailable&&remaining.length>map.maxSortieSquadrons&&ordered.some(node=>node.boss)){
    const pool=inventory(store,{area,bases:result,scheme,baseRid:remaining[0].rid}).filter(row=>row.source==='stock');
    // A stock aircraft already claimed by an existing draft belongs to that
    // squadron until the draft actually releases it. Reserving it for defense
    // while also keeping the old claim makes it inaccessible to both sides and
    // can silently destroy an otherwise reachable Boss assignment.
    const boss=ordered.find(node=>node.boss),assignedIds=new Set(result.flatMap(base=>(base.slots||[])
      .map(slot=>slot.itemId).filter(validId)));
    const short=pool.filter(row=>[6,45,48,56].includes(typeOf(row.master))&&Number(row.master.api_distance)>0&&
      Number(row.master.api_distance)<boss.radius&&!assignedIds.has(row.itemId));
    const sortie=pool.filter(row=>!short.includes(row)&&[6,7,8,11,45,47,48,53,56].includes(typeOf(row.master))&&Number(row.master.api_distance)>=boss.radius);
    if(sortie.length>=2)for(const row of short.sort((a,b)=>Number(b.master.api_tyku||0)-Number(a.master.api_tyku||0)).slice(0,4))defenseReserve.add(row.itemId);
  }
  const lockedDispatch=remaining.filter(base=>base.targetsLocked&&base.targets?.some(Boolean));
  if(lockedDispatch.length>map.maxSortieSquadrons)
    return {status:'partial',bases:result,warnings:[...warnings,`手动指定了 ${lockedDispatch.length} 队，超过海域可出击上限 ${map.maxSortieSquadrons} 队`]};
  for(let turn=0;turn<map.maxSortieSquadrons&&remaining.length;turn++){
    const proposals=[];
    for(const base of remaining){
      if(base.modeLocked&&base.mode!==1)continue;
      let available=inventory(store,{area,bases:result,scheme,baseRid:base.rid}).filter(row=>!used.has(row.itemId)&&!defenseReserve.has(row.itemId));
      const lockedTargets=base.targetsLocked&&Array.isArray(base.targets)?base.targets.slice(0,2):null;
      const specified=lockedTargets?lockedTargets.filter(id=>typeof id==='string'&&id!==''):[],
        explicit=specified.filter(id=>nodes.some(node=>node.id===id));
      if(lockedTargets&&!specified.length)continue; // Explicitly undispatched.
      if(lockedTargets&&explicit.length!==specified.length){warnings.push(`第 ${base.rid} 航空队指定的节点不在所选路线，未更改目标`);continue;}
      // Leave an eligible aircraft for the second team on sparse inventories.
      // Only stock may be reserved: existing aircraft on another base remain
      // unavailable and no manually locked slot may be silently displaced.
      if(turn===0&&map.maxSortieSquadrons>1&&remaining.length>1){
        const lockedIds=new Set((base.slots||[]).filter(slot=>slot.locked||(lockedSlots||[]).some(lock=>Number(lock.rid)===base.rid&&Number(lock.slotId)===slot.slotId)).map(slot=>slot.itemId));
        const candidates=available.filter(row=>row.source==='stock'&&!lockedIds.has(row.itemId)&&
          [6,7,8,11,45,47,48,53,56].includes(typeOf(row.master))&&ordered.some(node=>Number(row.master.api_distance)>=node.radius));
        const stock=available.filter(row=>row.source==='stock');
        if(stock.length>1&&candidates.length){
          const reserved=candidates.sort((a,b)=>itemScore(a,ordered[0])-itemScore(b,ordered[0])||a.itemId-b.itemId)[0];
          available=available.filter(row=>row.itemId!==reserved.itemId);
        }
      }
      let best=null;
      // Air-raid targets can be attacked in-game, but our present forecast
      // lacks their enemy armor/AA detail. Keep them manually selectable; do
      // not auto-divert a squadron based on an incomplete simulation.
      for(const target of explicit.length?[nodes.find(node=>node.id===explicit[0])]:ordered.filter(node=>node.kind!=='aerialRaid')){
        const fit=candidateFor(store,base,target,available,lockedSlots,explicit.map(id=>nodes.find(node=>node.id===id)));if(!fit)continue;
        // Boss concentration is the baseline. A forward or ASW diversion is
        // considered later against actual fleet-specific combat scenarios;
        // high enemy air alone does not prove an air-raid node is worthwhile.
        const value=target.priority+fit.score;
        if(!best||value>best.value)best={...fit,target,value};
        // Targets are ordered by strategic priority. Once a reachable Boss
        // fit is found, lower-priority nodes are compared later by battle
        // assessment; repeatedly fitting each one is expensive and misleading.
        if(!lockedTargets&&target.boss)break;
      }
      if(!best){if(lockedTargets)warnings.push(`第 ${base.rid} 航空队未找到符合手动目标的可确认航程与飞机`);continue;}
      proposals.push({base,lockedTargets,best,priority:best.value+(lockedTargets?100000:0)+(base.mode===1?.001:0)});
    }
    if(!proposals.length)break;
    proposals.sort((a,b)=>Number(!!b.lockedTargets)-Number(!!a.lockedTargets)||
      Number(Number(a.base.rid)===defenseRid&&defenseAvailable)-Number(Number(b.base.rid)===defenseRid&&defenseAvailable)||
      b.priority-a.priority||a.base.rid-b.base.rid);
    const {base,lockedTargets,best}=proposals[0];remaining.splice(remaining.indexOf(base),1);chosen.add(base);
    Object.assign(base,best.base,{mode:1,modePlanned:true,targets:lockedTargets||[best.target.id,best.target.id]});
    for(const slot of base.slots)if(validId(slot.itemId))used.add(Number(slot.itemId));
    if(base.slots.some(slot=>slot.planned&&!slot.withinBase))warnings.push(`第 ${base.rid} 航空队换装后需完成转场和补给`);
    if(best.target.enemyAir===null)warnings.push(`${best.target.id} 点敌方制空资料待确认`);
    warnings.push(...best.reading.reasons);
  }
  for(const base of remaining)if(!base.targetsLocked&&!base.modeLocked)base.targets=[];
  if(chosen.size<Math.min(map.maxSortieSquadrons,result.length)&&!remaining.every(base=>base.targetsLocked))
    warnings.push('未找到足够可确认出击的航空队；当前推荐不跨基地取机，其他基地的飞机可手动调配或转场');
  if(defensePlanEnabled){
    const defenders=[];
    for(const base of remaining){
      if(Number(base.rid)!==defenseRid||base.targetsLocked||base.modeLocked)continue;
      const available=inventory(store,{area,bases:result,scheme,baseRid:base.rid}).filter(row=>!used.has(row.itemId));
      const candidate=defenseCandidate(store,base,available,lockedSlots);
      if(candidate)defenders.push({original:base,planned:candidate});
    }
    defenders.sort((a,b)=>b.planned.score-a.planned.score||(b.original.mode===2)-(a.original.mode===2)||a.original.rid-b.original.rid);
    if(defenders.length){
      const {original,planned}=defenders[0];Object.assign(original,planned.base);
      if(raidNotStarted||cleared)warnings.push('当前血条阶段没有基地空袭，防空方案可供后续攻略使用');
      if(planned.ready<4)warnings.push(`防空航空队仅有 ${planned.ready} 槽可用战斗机`);
      if(planned.base.slots.some(slot=>slot.planned&&!slot.withinBase))warnings.push(`第 ${planned.base.rid} 航空队防空换装后需完成转场和补给`);
    }else if(defenseAvailable&&remaining.some(base=>Number(base.rid)===defenseRid&&!base.targetsLocked&&!base.modeLocked))
      warnings.push('未找到可确认就绪的防空战斗机');
  }
  return {status:chosen.size&&!warnings.length?'ready':warnings.length?'partial':'unknown',bases:sortBases(store,result,lockedSlots),warnings:unique(warnings)};
}
// Assign already-fitted aircraft from a bounded, fleet-specific reference.
// This does not run a new aircraft search or treat scenario counts as actual
// probabilities. The recorded route is one conservative reachable branch;
// nodes with missing or zero visits cannot be asserted safe or dangerous.
function aircraftAlternatives(store,{area,routeNodes,bases,scheme}={}){
  const map=mapFor(area);
  if(!map||!Array.isArray(bases)||!Array.isArray(routeNodes))return [];
  const nodes=withBaseAirTargets(store,area,nodesFor(area,routeNodes)),byId=new Map(nodes.map(node=>[node.id,node]));
  // Compare en-route squadrons first, then Boss squadrons. Keep each base's
  // exact target waves, manual slot locks, and the other teams' equipment.
  const active=bases.filter(base=>base.targets?.some(Boolean)).slice().sort((a,b)=>
    Number(!a.targets.some(id=>id&&!map.bossNodes.includes(id)))-Number(!b.targets.some(id=>id&&!map.bossNodes.includes(id)))||a.rid-b.rid);
  const perBase=[];
  for(const base of active){
    if(!Array.isArray(base.slots)||base.slots.length!==4)continue;
    const targets=unique(base.targets.filter(Boolean)).map(id=>byId.get(id));
    if(!targets.length||targets.some(node=>!node)||targets.some(node=>node.kind==='aerialRaid'))continue;
    // A split sortie can cover an ASW node and a surface node. Optimize its
    // surface attack while still requiring an eligible ASW aircraft for the
    // other wave; a purely ASW team uses its existing specialized planner.
    targets.sort((a,b)=>Number(a.kind==='asw')-Number(b.kind==='asw'));
    if(targets[0].kind==='asw')continue;
    const available=inventory(store,{area,bases,scheme,baseRid:base.rid});
    const evaluationCache=new Map();
    const fits=[null,{landAttack:3,attack:3,fighter:1,recon:0},{landAttack:3,attack:3,fighter:0,recon:1},
      {landAttack:4,attack:4,fighter:0,recon:0},{landAttack:2,attack:2,fighter:1,recon:1}]
      .map(shape=>candidateFor(store,base,targets[0],available,[],targets.slice(1),shape,evaluationCache)).filter(Boolean);
    const current=JSON.stringify(base.slots.map(slot=>slot.itemId)),seen=new Set([current]),rows=[];
    for(const entry of fits){
      const signature=JSON.stringify(entry.base.slots.map(slot=>slot.itemId));if(seen.has(signature))continue;seen.add(signature);
      const candidate=sortBases(store,bases.map(row=>row===base?{...entry.base,targets:base.targets.slice()}:row));
      if(validatePlan(store,{area,bases:candidate,scheme}).valid)rows.push(candidate);
    }
    if(rows.length)perBase.push(rows);
  }
  const result=[];
  for(let i=0;i<5;i++)for(const rows of perBase)if(rows[i])result.push(rows[i]);
  // Compare a bounded number of reciprocal occupied-slot swaps across the
  // same world's squadrons. Preserve held slots and never infer a move to an
  // empty slot. The actual game state must still match both instances.
  const observed=store?.info?.airbase||[],swaps=[];
  const liveSlot=(base,slot)=>observed.find(row=>Number(row.api_area_id)===Number(base.areaId)&&Number(row.api_rid)===Number(base.rid))
    ?.api_plane_info?.find(row=>Number(row.api_squadron_id)===Number(slot.slotId));
  for(const team of active){
    if(!Array.isArray(team.slots))continue;
    const target=byId.get(team.targets.find(Boolean));if(!target||target.kind==='asw'||target.kind==='aerialRaid')continue;
    const before=scoreSquadron(store,team,target);if(!before)continue;
    const choices=[],pairs=[];
    for(const other of bases){
      if(other===team||Number(other.areaId)!==Number(team.areaId)||!Array.isArray(other.slots))continue;
      for(const left of team.slots)for(const right of other.slots){
        if(left.locked||right.locked||!validId(left.itemId)||!validId(right.itemId))continue;
        const actualLeft=liveSlot(team,left),actualRight=liveSlot(other,right);
        if(Number(actualLeft?.api_slotid)!==Number(left.itemId)||Number(actualRight?.api_slotid)!==Number(right.itemId)||
          Number(actualLeft.api_state)!==1||Number(actualRight.api_state)!==1||
          Number(actualLeft.api_count)!==Number(left.count)||Number(actualRight.api_count)!==Number(right.count))continue;
        const row=slot=>{const item=store.info.equips[slot.itemId];return {item,master:store.const.$equips[item?.api_slotitem_id],source:'base'};};
        const old=row(left),incoming=row(right);if(!old.master||!incoming.master)continue;
        pairs.push({other,left,right,rough:itemScore(incoming,target)-itemScore(old,target)});
      }
    }
    pairs.sort((a,b)=>b.rough-a.rough);
    for(const {other,left,right} of pairs.slice(0,12)){
      const exchanged=(slot,plane)=>({...slot,itemId:plane.itemId,count:plane.count,maxCount:plane.maxCount,
        state:plane.state,planned:true,withinBase:true});
      const candidate=sortBases(store,bases.map(base=>base===team?{...base,range:null,slots:base.slots.map(slot=>slot===left?exchanged(slot,right):slot)}:
        base===other?{...base,range:null,slots:base.slots.map(slot=>slot===right?exchanged(slot,left):slot)}:base));
      const updated=candidate.find(base=>base.rid===team.rid),scored=scoreSquadron(store,updated,target);
      if(!scored||!validatePlan(store,{area,bases:candidate,scheme}).valid)continue;
      // A swap must not silently make the other team's ASW or surface wave
      // unusable, including when it has two different locked destinations.
      const losesCapability=[team,other].some(previous=>{
        const next=candidate.find(base=>base.rid===previous.rid);
        return (previous.targets||[]).filter(Boolean).some(id=>{
          const node=byId.get(id);return node&&scoreSquadron(store,previous,node)&&!scoreSquadron(store,next,node);
        });
      });
      if(losesCapability)continue;
      // Base-raid defense is outside the route simulation.
      if(!other.targets?.some(Boolean)&&Number(other.mode)===2){
        const defense=require('../domain/combat/land_base_defense');
        const old=defense.defenseAirPower(store,other).airPower,newValue=defense.defenseAirPower(store,candidate.find(base=>base.rid===other.rid)).airPower;
        if(!old||!newValue||newValue.min<old.min)continue;
      }
      choices.push({candidate,score:scored.score-before.score});
    }
    choices.sort((a,b)=>b.score-a.score);swaps.push(...choices.slice(0,2).map(row=>row.candidate));
  }
  result.push(...swaps);
  return result;
}
function prioritizeTargets(store,{area,routeNodes,bases,scheme,diagnostics}={}){
  const map=mapFor(area),samples=diagnostics?.journeys?.samples;
  if(!map||!Array.isArray(bases)||!Array.isArray(diagnostics?.nodes)||!Number.isInteger(samples)||samples<=0)
    return {bases,changed:false};
  const nodes=withBaseAirTargets(store,area,nodesFor(area,routeNodes)),data=new Map(nodes.map(node=>[node.id,node]));
  const order=targets=>targets.slice().sort((a,b)=>(data.get(a)?.index??Infinity)-(data.get(b)?.index??Infinity));
  const risks=diagnostics.nodes.map((row,index)=>({node:data.get(row?.id),row,index})).filter(({node,row})=>
    node&&!node.boss&&node.kind!=='aerialRaid'&&Number.isInteger(row.visits)&&row.visits>0&&Number.isInteger(row.severe)&&row.severe>0&&row.severe<=row.visits&&row.visits<=samples)
    .sort((a,b)=>b.row.severe-a.row.severe||a.index-b.index);
  if(!risks.length)return {bases,changed:false};
  const active=bases.filter(base=>Array.isArray(base.targets)&&base.targets.some(Boolean));
  if(!active.length)return {bases,changed:false};
  // Retain the existing Boss team (or a locked Boss assignment) intact. A
  // second sortie may cover the highest-risk node, or split two waves when
  // both nodes account for substantial numbers of adverse scenarios.
  const bossTeam=active.find(base=>base.targetsLocked&&base.targets.some(id=>map.bossNodes.includes(id)))||
    active.find(base=>base.targets.some(id=>map.bossNodes.includes(id)));
  if(!bossTeam)return {bases,changed:false};
  if(active.length===1){
    // With one squadron, keep one wave on the objective and compare sending
    // the other to a reachable, observed en-route threat. A user-locked
    // target or aircraft must never be overwritten.
    if(bossTeam.targetsLocked||bossTeam.modeLocked&&bossTeam.mode!==1)return {bases,changed:false};
    const bossId=bossTeam.targets.find(id=>map.bossNodes.includes(id)),boss=data.get(bossId);
    if(!boss)return {bases,changed:false};
    const alternatives=[];let warnings=[];
    for(const {node} of risks.slice(0,3)){
      let selected=bossTeam,reading=land.inspectSquadron(store,bossTeam);
      if((!scoreReading(store,reading,node)||!scoreReading(store,reading,boss))&&Array.isArray(scheme?.ships)){
        const available=inventory(store,{area,bases,scheme,baseRid:bossTeam.rid});
        const fit=candidateFor(store,bossTeam,boss,available,[],[node]);
        if(fit){selected=fit.base;reading=fit.reading;
          if(selected.slots.some(slot=>slot.planned&&!slot.withinBase))warnings.push(`第 ${bossTeam.rid} 航空队换装后需完成转场和补给`);}
      }
      if(!scoreReading(store,reading,node)||!scoreReading(store,reading,boss))continue;
      const targets=order([node.id,bossId]);
      if(targets.every((target,i)=>target===bossTeam.targets[i])&&selected===bossTeam)continue;
      alternatives.push(bases.map(base=>base===bossTeam?{...selected,targets}:base));
    }
    if(!alternatives.length)return {bases,changed:false};
    return {bases:alternatives[0],changed:true,warnings:unique(warnings),alternatives:alternatives.slice(1)};
  }
  let changed=false;const warnings=[],otherTargets=[];
  const next=bases.map((base,index)=>{
    if(base===bossTeam||base.targetsLocked||!active.includes(base))return base;
    let selected=base,reading=land.inspectSquadron(store,base);
    const previous=data.get(base.targets.find(id=>id&&!map.bossNodes.includes(id)));
    // An ASW-only team can suppress a submarine node but cannot damage the
    // surface fleet that is actually causing the route's worst damage.
    // Refit this one team once for the worst observed target, preserving all
    // locked slots and other teams' aircraft. Never consume fleet equipment.
    if(!scoreReading(store,reading,risks[0].node)&&Array.isArray(scheme?.ships)){
      const available=inventory(store,{area,bases,scheme,baseRid:base.rid});
      // Prefer a mixed team that can still support its old target (typically
      // ASW) and attack the newly dangerous node. This bounded search runs at
      // most once for each chosen role; fallback only if mixed fit is absent.
      const preserve=previous&&scoreReading(store,reading,previous)?[previous]:[];
      const fit=candidateFor(store,base,risks[0].node,available,[],preserve)||
        (preserve.length?candidateFor(store,base,risks[0].node,available,[],[]):null);
      if(fit){selected=fit.base;reading=fit.reading;
        if(selected.slots.some(slot=>slot.planned&&!slot.withinBase))warnings.push(`第 ${base.rid} 航空队换装后需完成转场和补给`);}
    }
    const eligible=risks.filter(({node})=>scoreReading(store,reading,node));
    if(!eligible.length)return base;
    const first=eligible[0],second=eligible[1];
    const targets=order([first.node.id,second&&second.row.severe>=first.row.severe*.35?second.node.id:first.node.id]);
    if(selected===base&&targets.every((target,i)=>target===base.targets[i]))return base;
    if(previous&&previous.id!==first.node.id&&scoreReading(store,reading,previous))
      otherTargets.push({index,targets:order([previous.id,first.node.id])});
    if(targets[0]!==targets[1])otherTargets.push({index,targets:[first.node.id,first.node.id]});
    changed=true;return {...selected,targets};
  });
  const alternatives=otherTargets.map(({index,targets})=>next.map((base,i)=>i===index?{...base,targets}:base));
  return {bases:changed?next:bases,changed,warnings,alternatives};
}
module.exports={eligiblePlane,planeCapacity,inventory,sourceBases,nodesFor,nodeRadius:land.nodeRadius,
  inspectSquadron:land.inspectSquadron,validatePlan,recommendLandBases,aircraftAlternatives,prioritizeTargets};
