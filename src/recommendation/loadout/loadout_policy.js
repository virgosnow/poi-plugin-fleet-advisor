'use strict';
const {canEquip,acceptsOtherSlot}=require('../../domain/fleet/equipment_rules');
const type=m=>Number(m?.api_type?.[2]);
const master=(store,id)=>store.const.$equips[store.info.equips[id]?.api_slotitem_id];
const oneOneIrrelevant=new Set([14,15,17,18,19,24,30,37,40,42,43,44,46,54,93]);
const attackValue=m=>Number(m?.api_houg||0)*3+Number(m?.api_houm||0)*2+Number(m?.api_raig||0);

function selectedCombatNodes(profile){
  const paths=profile?.routePaths?.length?profile.routePaths.map(path=>path.nodes):profile?.examples||[];
  const selected=paths.length?new Set(paths.flat()):null;
  return (profile?.mapPreview?.nodes||[]).filter(node=>!selected||selected.has(node.id));
}
function submarineObjective(profile){
  return selectedCombatNodes(profile).some(node=>profile.targetNodes?.includes(node.id)&&
    (node.kind==='asw'||node.submarineFlagship===true));
}
// A surface-boss route needs an escort, not six dedicated ASW attackers.
// Pure ASW routes and submarine objectives keep their full-fleet weighting.
function aswEscortLimit(profile){
  if(submarineObjective(profile))return Infinity;
  const nodes=selectedCombatNodes(profile);
  const pureAsw=(profile?.counts?.asw?.maximum||0)>0||nodes.some(node=>node.kind==='asw');
  const mixed=nodes.reduce((max,node)=>node.kind!=='battle'?max:Math.max(max,
    Math.min(profile?.targetNodes?.includes(node.id)?6:2,node.submarines?.maximum||0)),0);
  if(!pureAsw&&!mixed)return 0;
  const surface=profile?.counts?.surface?.maximum||profile?.counts?.air?.maximum||
    nodes.some(node=>['battle','nightBattle','aerialCombat','aerialRaid'].includes(node.kind));
  return !surface?Infinity:Math.max(pureAsw?2:0,mixed);
}
// A mixed node is already a surface encounter, not an extra submarine battle.
// Its escort credit must not multiply ASW priority across a long surface route.
const aswEncounterWeight=profile=>Math.max(profile?.counts?.asw?.maximum||0,
  Math.min(1,(profile?.counts?.mixedAsw?.maximum||0)*0.25));
function aswEscortIds(store,entries,limit){
  const rows=entries.filter(entry=>[1,2,3,4,21,22].includes(Number(store.const.$ships[store.info.ships[entry.id].api_ship_id]?.api_stype)));
  if(!limit)return new Set();
  if(limit>=rows.length)return new Set(rows.map(entry=>entry.id));
  return new Set(rows.map(entry=>{
    const ship=store.info.ships[entry.id],sm=store.const.$ships[ship.api_ship_id];
    const before={slots:ship.api_slot,ex:ship.api_slot_ex};
    const reading=require('../../domain/combat/opening_asw').openingASW(store,{id:entry.id,ship,master:sm,before,after:entry});
    return {id:entry.id,score:(reading.eligible?10000:0)+(reading.totalAswEstimate||0)};
  }).sort((a,b)=>b.score-a.score||a.id-b.id).slice(0,limit).map(row=>row.id));
}

function availableEquipment(store){
  const sources=new Map();
  for(const [shipId,ship] of Object.entries(store.info.ships))
    for(const id of [...(ship.api_slot||[]),ship.api_slot_ex])if(id>0)sources.set(id,Number(shipId));
  const busy=new Set(store.info.fleets.filter(f=>Number(f.api_mission?.[0])!==0)
    .flatMap(f=>f.api_ship||[]));
  const docked=new Set((store.info.repairs||[]).map(row=>Number(typeof row==='object'?row.api_ship_id:row)));
  const airbase=new Set();
  for(const base of store.info.airbase||[])for(const slot of base.api_plane_info||[])
    if(slot?.api_slotid>0)airbase.add(Number(slot.api_slotid));
  return Object.entries(store.info.equips).filter(([id])=>{
    const itemId=Number(id),source=sources.get(itemId);
    return !airbase.has(itemId)&&(!source||!busy.has(source)&&!docked.has(source)&&
      store.info.ships[source]?.api_situation!==2);
  }).map(([id,item])=>({id:Number(id),sourceShipId:sources.get(Number(id))||null,
    master:store.const.$equips[item.api_slotitem_id]}))
    .filter(row=>Array.isArray(row.master?.api_type));
}

// Blank only the proposed loadout. The observed store remains intact for
// eligibility, inventory ownership and the execution diff.
function emptyLoadout(store,scheme,heldSlots=[]){
  const held=new Map(heldSlots.filter(Boolean).map(s=>[s.id,s]));
  return {fleet:scheme.fleet,ships:scheme.ships.map(entry=>{
    const ship=store.info.ships[entry.id],sm=store.const.$ships[ship.api_ship_id],lock=held.get(entry.id);
    const count=Number(sm.api_slot_num??ship.api_slotnum??ship.api_slot.length);
    return {id:entry.id,slots:Array.from({length:count},(_,k)=>lock?.keep?.[k]?lock.slots[k]:-1),
      ex:lock?.keep?.ex?lock.ex:-1};
  })};
}

const poolCache=new WeakMap();
function combatPools(inventory){
  if(poolCache.has(inventory))return poolCache.get(inventory);
  const select=(types,score=attackValue)=>inventory.filter(i=>types.includes(type(i.master)))
    .sort((a,b)=>score(b.master)-score(a.master)||a.id-b.id);
  const air=m=>Number(m.api_raig||0)+Number(m.api_baku||0)+Number(m.api_houm||0);
  const pools={guns:select([1,2,3]),torpedo:select([5,32]),opening:select([22],m=>Number(m.api_raig||0)),
    fighter:select([6],m=>Number(m.api_tyku||0)),
    bomber:select([7,8,11,57,58],air),torpedoPlane:select([8,58],air),divePlane:select([7,57],air),
    recon:select([9,10,41],m=>Number(m.api_saku||0)),shell:select([19]),
    sonar:select([14,40],m=>Number(m.api_tais||0)),depth:select([15],m=>Number(m.api_tais||0)),
    auxiliary:select([12,13,21,27,39],m=>attackValue(m)+Number(m.api_souk||0)+Number(m.api_houk||0)+Number(m.api_saku||0))};
  poolCache.set(inventory,pools);return pools;
}

// Complete the whole fleet together so an instance cannot be assigned twice.
// Route-specific air/LoS/engine/ground variants may replace these utility slots.
function completeCombatLoadout(store,scheme,inventory,{area,asw=false,profile,heldSlots=[]}={}){
  const pool=combatPools(inventory),locks=new Map(heldSlots.filter(Boolean).map(s=>[s.id,s.keep||{}]));
  const entries=scheme.ships.map(s=>({...s,slots:s.slots.slice()}));
  const used=new Set(entries.flatMap(s=>s.slots.concat(s.ex)).filter(id=>id>0));
  const limit=profile?aswEscortLimit(profile):area==='1-5'?Infinity:2;
  const escorts=aswEscortIds(store,entries,asw?limit:0);
  // Keep a repairable escort seed for mixed bosses. Surface fitting also
  // compares the two-gun kit; forcing it here can remove the only LoS slot
  // before the route-specific fitting stage ever sees these stronger hulls.
  const escortSeed=selectedCombatNodes(profile).some(node=>profile?.targetNodes?.includes(node.id)&&node.submarines?.maximum>0);
  for(const entry of entries){
    const ship=store.info.ships[entry.id],sm=store.const.$ships[ship.api_ship_id],stype=Number(sm.api_stype),keep=locks.get(entry.id)||{};
    const carrier=[7,11,18].includes(stype),sub=[13,14].includes(stype),pure=area==='1-5';
    const capacity=k=>Number(ship.api_onslot?.[k]??sm.api_maxeq?.[k]??0);
    const count=types=>entry.slots.filter(id=>types.includes(type(master(store,id)))).length;
    const positions=entry.slots.map((_,k)=>k);
    const assign=(items,where=positions)=>{
      for(const k of where){
        if(keep[k]||(k==='ex'?entry.ex:entry.slots[k])>0)continue;
        const chosen=items.find(i=>{
          if(used.has(i.id))return false;
          const t=type(i.master);
          if([7,8,9,10,11,41,57,58].includes(t)&&(k==='ex'||capacity(k)<=0))return false;
          try{return canEquip(store,entry.id,i.id,k)&&(!i.sourceShipId||i.sourceShipId===entry.id||acceptsOtherSlot(store,entry.id,i.id,k));}catch(_){return false;}
        });
        if(chosen){if(k==='ex')entry.ex=chosen.id;else entry.slots[k]=chosen.id;used.add(chosen.id);return true;}
      }
      return false;
    };
    const opening=pool.opening.filter(i=>/甲標的/.test(i.master.api_name||''));
    if(!pure&&stype===16&&!count([11]))assign(pool.bomber.filter(i=>type(i.master)===11));
    if(!pure&&!count([22]))assign(opening);
    if(asw&&pure&&[1,2,3,4,21,22].includes(stype)){
      if(!count([14,40]))assign(pool.sonar);
      if(pure&&!count([15]))assign(pool.depth);
    }
    if(sub){while(assign(pool.torpedo)){};}
    else if(carrier){
      const airSlots=positions.slice().sort((a,b)=>capacity(b)-capacity(a)||a-b);
      if(area!=='1-1'&&entry.slots.length>1&&!count([6]))assign(pool.fighter,airSlots);
      if(!count([8,58]))assign(pool.torpedoPlane,airSlots);
      if(!count([7,57]))assign(pool.divePlane,airSlots);
      while(assign(pool.bomber,airSlots)){};
    }else if(!pure){
      const target=asw&&(submarineObjective(profile)||escortSeed)&&[1,2,21,22].includes(stype)?1:2;
      while(count([1,2,3])<target&&assign(pool.guns)){};
      // Water tenders and aviation hulls need useful aircraft, not inherited cargo.
      if(!count([9,10,11,41]))assign(area==='1-1'||stype===16?pool.bomber:pool.recon);
      if(area!=='1-1'&&[8,9,10].includes(stype)&&!count([19]))assign(pool.shell);
    }
    if(asw&&!pure&&escorts.has(entry.id)&&!count([14,40]))assign(pool.sonar);
    if(pure){while(assign([...pool.depth,...pool.sonar])){};}
  }
  // Allocate scarce auxiliary permissions first (e.g. Yubari's fifth slot),
  // across the whole fleet. A flexible earlier slot must not consume the only
  // radar another slot accepts while a large radar remains unused.
  const auxiliary=pool.auxiliary.filter(i=>area==='1-1'?attackValue(i.master)>0:
    attackValue(i.master)+Number(i.master.api_souk||0)+Number(i.master.api_houk||0)+Number(i.master.api_saku||0)>0);
  const legal=(entry,k,item)=>{try{return canEquip(store,entry.id,item.id,k)&&
    (!item.sourceShipId||item.sourceShipId===entry.id||acceptsOtherSlot(store,entry.id,item.id,k));}catch(_){return false;}};
  const pending=entries.flatMap(entry=>entry.slots.map((id,k)=>({entry,id,k})).concat(
    store.info.ships[entry.id].api_slot_ex!==0?[{entry,id:entry.ex,k:'ex'}]:[]))
    .filter(p=>p.id<=0&&!locks.get(p.entry.id)?.[p.k])
    .map(p=>({...p,options:auxiliary.filter(i=>!used.has(i.id)&&legal(p.entry,p.k,i))}));
  while(pending.length){
    pending.sort((a,b)=>a.options.filter(i=>!used.has(i.id)).length-b.options.filter(i=>!used.has(i.id)).length);
    const p=pending.shift(),chosen=p.options.find(i=>!used.has(i.id));if(!chosen)continue;
    if(p.k==='ex')p.entry.ex=chosen.id;else p.entry.slots[p.k]=chosen.id;used.add(chosen.id);
  }
  // The game's normal slots compact on removal. Keep explicit manual gaps
  // untouched for validation, but don't create new gaps when inventory is short.
  for(const entry of entries)for(let k=0;k<entry.slots.length;k++){
    if(entry.slots[k]>0||locks.get(entry.id)?.[k])continue;
    const later=entry.slots.findIndex((id,j)=>j>k&&id>0&&!locks.get(entry.id)?.[j]&&
      legal(entry,k,{id,sourceShipId:null}));
    if(later>=0){entry.slots[k]=entry.slots[later];entry.slots[later]=-1;}
  }
  return {fleet:scheme.fleet,ships:entries};
}

function explainLoadout(store,entry,{kind='normal',area,fleetEntries=[entry]}={}){
  const ship=store.info.ships[entry.id],sm=store.const.$ships[ship.api_ship_id],oneOne=kind==='normal'&&area==='1-1';
  const normal=entry.slots.map(id=>master(store,id)),opening=normal.some(m=>type(m)===22&&/甲標的/.test(m.api_name));
  const guns=normal.filter(m=>[1,2,3].includes(type(m))).length;
  const role=oneOne?(opening?'以甲标开幕雷击削减敌舰，炮击负责补刀；本图不需要运输、对地或对潜装备。':'以水上攻击为主；本图不需要运输、对地或对潜装备。'):
    kind==='expedition'?'按远征成功条件与净收益核对整套装备。':kind==='manual'?'以下说明当前 JSON 配装的用途；不代表系统已为这套组合做过优化。':
      opening?'具备开幕雷击能力，其他装备承担炮击、制空或路线需求。':'按当前整套装备说明用途；是否满足路线要求以制空、索敌与带路检查为准。';
  const rows=[];let fill;
  const emptyReason=k=>{
    if(kind!=='normal')return kind==='manual'?'JSON 指定留空，未自动配置装备。':'未配置此槽；是否有收益或属性缺口以远征检查为准。';
    if(!fill){
      const inventory=availableEquipment(store),entries=fleetEntries.filter(Boolean);
      const scheme={fleet:1,ships:entries.map(s=>({id:s.id,slots:s.slots,ex:s.ex}))};
      fill=completeCombatLoadout(store,scheme,inventory,{area,asw:require('../../domain/routes/sortie_profile').hasAswNodes(area),heldSlots:entries});
    }
    const fitted=fill.ships.find(s=>s.id===entry.id),id=k==='ex'?fitted?.ex:fitted?.slots[k];
    if(id>0)return '仍有可用的'+master(store,id)?.api_name+'；当前编成未配置，可重新一键补全。';
    return '未配置：可用库存中没有尚未分配且符合当前配装规则的装备；不以无用途装备填槽。';
  };
  const describe=(id,k)=>{
    const m=master(store,id),t=type(m),fixed=entry.keep?.[k];let reason,warning=false;
    if(id<=0){
      reason=fixed?'手动指定留空，自动补全会保留。':emptyReason(k);
      if(!fixed&&oneOne&&/夕張改二/.test(sm.api_name||'')&&Number(k)>=3)reason+=Number(k)===4?'第五槽仅允许小型电探、机枪或战斗粮食。':'此槽不能装主炮、鱼雷或甲标。';
    }else if(oneOne&&oneOneIrrelevant.has(t)){
      reason='本图没有对应作战或带路用途，应移除或替换。';warning=true;
    }else if(t===22&&/甲標的/.test(m.api_name))reason='启用开幕雷击，在炮击前争取消灭敌舰。';
    else if([1,2,3].includes(t))reason='增加炮击火力'+(guns===2&&!normal.some(m=>[4,5].includes(type(m)))?'；当前双主炮组合可用于夜战连击。':'。');
    else if(t===5)reason='提高雷装，增强雷击；夜战攻击形式取决于整套组合。';
    else if([6,45,48,56].includes(t))reason='提供制空能力，帮助舰队达到制空目标。';
    else if([7,8,11,57,58].includes(t))reason='参与航空攻击；实际效果受搭载量、制空与机种影响。';
    else if([9,10,41,59].includes(t))reason='承担侦察、索敌或观测辅助；能否发动还需满足搭载与战斗条件。';
    else if([12,13].includes(t))reason=oneOne?'利用电探的命中/火力属性帮助炮击；1-1 没有索敌门槛。':'提高命中与索敌，门槛是否达标见右侧索敌卡片。';
    else if([14,15,40].includes(t))reason='承担对潜输出；先制对潜还需核对舰娘与整套装备条件。';
    else if([24,46].includes(t))reason=kind==='expedition'?'用于适用远征的运输或收益加成；具体收益见左侧。':'用于适用的运输、对地或带路条件；当前组合仍需对照所选路线。';
    else if([18,37].includes(t))reason='针对适用陆上目标，不能当作通用水上战增益。';
    else if(t===17)reason='用于速力调整；是否必要取决于所选路线。';
    else if(t===19)reason='用于对适用大型水上目标的穿甲增益；观测攻击还需满足主炮、侦察机与制空条件。';
    else if(t===21)reason=oneOne?'利用机枪的附加火力/命中属性；本图不靠对空收益选择它。':'提供对空能力及装备附加属性。';
    else if(t===27)reason='提供装甲与防护'+(attackValue(m)>0?'，同时利用装备附加的攻击属性。':'。');
    else if(t===39)reason='利用熟练见张员的附加属性；夜战辅助效果仍需满足舰种和整套装备条件。';
    else reason='当前组合保留此装备；推荐器尚未提供专门的用途论证。';
    if(fixed&&id>0)reason='手动保留。'+reason;
    rows.push({slot:k,label:k==='ex'?'增设':`第 ${k+1} 槽`,name:m?.api_name||'空槽',reason,warning});
  };
  entry.slots.forEach(describe);if(ship.api_slot_ex!==0)describe(entry.ex,'ex');
  return {role,rows};
}
module.exports={availableEquipment,emptyLoadout,completeCombatLoadout,explainLoadout,aswEscortLimit,aswEscortIds,submarineObjective,aswEncounterWeight};
