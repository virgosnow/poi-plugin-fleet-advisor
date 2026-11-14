'use strict';
// Preferences affect automatic selection, never the user's explicit draft.
const DEFAULTS={
  normal:{borrowIdleShips:true,borrowFleetShips:true,minLevel:30,excludeUnremodeled:true,excludeExpedition:true,excludeRepairing:true,excludeUnlocked:true,excludeHeavyDamage:true,excludeFatigued:true,excludeFleetShips:false},
  practice:{borrowIdleShips:true,borrowFleetShips:false,minLevel:0,excludeUnremodeled:false,excludeUnlocked:true,excludeExpedition:true,excludeRepairing:true,excludeHeavyDamage:true,excludeFatigued:true,excludeFleetShips:true},
  expedition:{borrowIdleShips:true,borrowFleetShips:false,minLevel:0,excludeUnremodeled:false,excludeExpedition:true,excludeRepairing:true,excludeUnlocked:true,excludeHeavyDamage:true,excludeFatigued:true,excludeFleetShips:true},
};
function normalizeGroup(kind,value={}){
  const defaults=DEFAULTS[kind],out={};
  for(const [key,fallback]of Object.entries(defaults))out[key]=key==='minLevel'?
    (Number.isInteger(value?.[key])&&value[key]>=0&&value[key]<=999?value[key]:fallback):
    (typeof value?.[key]==='boolean'?value[key]:fallback);
  // Carry forward an explicit old expedition preference; new installations
  // use the fleet-wide default and an explicit new option always wins.
  if(kind==='expedition'&&typeof value?.excludeFleetShips!=='boolean'&&typeof value?.excludeFirstFleet==='boolean')out.excludeFleetShips=value.excludeFirstFleet;
  // A legacy on/off switch did not express a separate fleet-source choice.
  // Keep its idle-ship preference; use the new conservative default for
  // expedition/practice fleet ships unless a new explicit setting exists.
  if(typeof value?.allowEquipmentBorrowing==='boolean'){
    if(typeof value.borrowIdleShips!=='boolean')out.borrowIdleShips=value.allowEquipmentBorrowing;
    if(typeof value.borrowFleetShips!=='boolean')out.borrowFleetShips=kind==='normal'&&value.allowEquipmentBorrowing;
  }
  return out;
}
const normalize=value=>Object.fromEntries(Object.keys(DEFAULTS).map(kind=>[kind,normalizeGroup(kind,value?.[kind])]));
// Keep the existing public Chinese reasons for callers and MCP compatibility,
// while internal filtering and deduplication operate on stable reason codes.
function reasonText(reason){
  switch(reason.code){
    case 'missingShip':return '舰娘不存在';
    case 'minimumLevel':return `等级低于 ${reason.minimum}`;
    case 'unremodeled':return '未改造';
    case 'expedition':return '远征中';
    case 'repairing':return '入渠中';
    case 'unlocked':return '未锁定';
    case 'heavyDamage':return '大破';
    case 'fatigued':return '士气低于 40';
    case 'firstFleet':return '第一舰队成员';
    case 'fleetShips':return '编队内的舰娘';
    default:return '';
  }
}
function structuredEvaluator(store,kind,value){
  const settings=normalizeGroup(kind,value),masters=store.const?.$ships||{};
  // Names like zwei/due/Mk.II are not reliable remodel indicators. Use the
  // master's incoming remodel edges, including reversible conversions.
  const remodeled=new Set(Object.values(masters).map(m=>Number(m.api_aftershipid)).filter(id=>id>0));
  const repairing=new Set((store.info.repairs||[]).map(d=>Number(typeof d==='object'?d.api_ship_id:d)));
  const away=new Set((store.info.fleets||[]).filter(f=>Number(f.api_mission?.[0]||0)!==0).flatMap(f=>f.api_ship||[]));
  const fleetShips=new Set((store.info.fleets||[]).flatMap(f=>f.api_ship||[]).map(Number).filter(id=>id>0));
  return id=>{
    const ship=store.info.ships[id],master=masters[ship?.api_ship_id];if(!ship||!master)return [{code:'missingShip'}];
    const reasons=[];
    if(Number(ship.api_lv)<settings.minLevel)reasons.push({code:'minimumLevel',minimum:settings.minLevel});
    // A ship with no remodel at all is not an unremodeled version to exclude.
    if(settings.excludeUnremodeled&&Number(master.api_aftershipid)>0&&!remodeled.has(Number(ship.api_ship_id)))reasons.push({code:'unremodeled'});
    if(settings.excludeExpedition&&away.has(Number(id)))reasons.push({code:'expedition'});
    if(settings.excludeRepairing&&(repairing.has(Number(id))||ship.api_situation===2))reasons.push({code:'repairing'});
    if(settings.excludeUnlocked&&Number(ship.api_locked)===0)reasons.push({code:'unlocked'});
    if(settings.excludeHeavyDamage&&Number(ship.api_maxhp)>0&&Number(ship.api_nowhp)/Number(ship.api_maxhp)<=.25)reasons.push({code:'heavyDamage'});
    if(settings.excludeFatigued&&Number(ship.api_cond)<40)reasons.push({code:'fatigued'});
    if(settings.excludeFleetShips&&fleetShips.has(Number(id)))reasons.push({code:'fleetShips'});
    return reasons;
  };
}
function evaluator(store,kind,value){
  const evaluate=structuredEvaluator(store,kind,value);
  return id=>evaluate(id).map(reasonText);
}
// Optional future planning when busy ships are explicitly included. Only the
// private calculation copy is released; live preview/execution stays strict.
function planningStore(store,settings){
  if(settings.excludeExpedition&&settings.excludeRepairing)return store;
  // Including expedition hulls for future planning never makes their gear
  // borrowable. Repairing ships, in contrast, can lend their equipment.
  const busy=new Set((store.info.fleets||[]).filter(f=>Number(f.api_mission?.[0]||0)!==0).flatMap(f=>f.api_ship||[]));
  const locked=new Set(store.planningUnavailableEquipmentIds||[]);
  for(const [id,ship]of Object.entries(store.info.ships))if(busy.has(Number(id)))
    for(const item of [...(ship.api_slot||[]),ship.api_slot_ex])if(item>0)locked.add(item);
  return {...store,planningUnavailableEquipmentIds:[...locked],info:{...store.info,
    fleets:settings.excludeExpedition?store.info.fleets:store.info.fleets.map(f=>({...f,api_mission:[0,0,0]})),
    repairs:settings.excludeRepairing?store.info.repairs:[],
    ships:settings.excludeRepairing?store.info.ships:Object.fromEntries(Object.entries(store.info.ships).map(([id,s])=>[id,{...s,api_situation:s.api_situation===2?0:s.api_situation}]))}};
}
// Inspect the full owned roster, not the already-filtered search pool. The
// context's availability is authoritative (including manual ship overrides).
function shipRequirementWarningDetails(store,requirements,ctx,settings,{compact=false}={}){
  const reasons=structuredEvaluator(store,'normal',settings),rows=[...ctx.byId.values()];
  const away=new Set(store.info.fleets.filter(f=>Number(f.api_mission?.[0]||0)!==0).flatMap(f=>f.api_ship||[]));
  const repair=new Set((store.info.repairs||[]).map(d=>Number(typeof d==='object'?d.api_ship_id:d)));
  const family=row=>typeof row.master.api_yomi==='string'&&row.master.api_yomi.trim()?
    row.master.api_yomi.normalize('NFKC').trim():row.ship.api_ship_id;
  const describe=({prefixes,min})=>{
    const owned=rows.filter(row=>prefixes.some(p=>row.name.startsWith(p)));
    const available=new Set(owned.filter(row=>row.available).map(family)).size;
    if(available>=min)return null;
    const label=prefixes.join(' / ')+(prefixes.length>1?`（需 ${min} 艘）`:'');
    if(!owned.length)return {prefixes:[...prefixes],min,available,missingAll:true,ships:[],missingPrefixes:[],text:`${label}：未持有`};
    const ships=owned.map(row=>{
      if(row.available)return {id:row.id,name:row.name,level:row.level,available:true,reasons:[],text:`${row.name} Lv.${row.level} 可用`};
      const filters=reasons(row.id),blocked=filters.map(reason=>({origin:'setting',reason}));
      if(ctx.excluded.includes(row.id))blocked.push({origin:'manual'});
      if(away.has(row.id)&&!filters.some(reason=>reason.code==='expedition'))blocked.push({origin:'busy',reason:{code:'expedition'}});
      if((repair.has(row.id)||row.ship.api_situation===2)&&!filters.some(reason=>reason.code==='repairing'))blocked.push({origin:'busy',reason:{code:'repairing'}});
      const label=entry=>entry.origin==='setting'?(compact?reasonText(entry.reason):`出击设置「${reasonText(entry.reason)}」`):
        entry.origin==='manual'?'手动排除':`${reasonText(entry.reason)}，当前不能编入`;
      const text=blocked.map(label).join('、')||'当前不能编入';
      const rendered=compact?`${row.name} Lv.${row.level}（${text}，已排除）`:`${row.name} Lv.${row.level} 已持有，但被排除：${text}`;
      return {id:row.id,name:row.name,level:row.level,available:false,reasons:blocked,text:rendered};
    });
    const missingPrefixes=prefixes.filter(prefix=>!owned.some(row=>row.name.startsWith(prefix)));
    const details=[...ships.map(row=>row.text),...missingPrefixes.map(prefix=>`${prefix}：未持有`)];
    const text=(prefixes.length>1?`${label}：`:'')+details.join('；')+
      (min>1?`；可用 ${available}/${min} 艘（同舰不同实例不重复计数）`:'');
    return {prefixes:[...prefixes],min,available,missingAll:false,ships,missingPrefixes,text};
  };
  return requirements.flatMap(point=>{
    const alternatives=point.alternatives.map(a=>{
      const unique=new Map();for(const item of a.map(describe).filter(Boolean))if(!unique.has(item.text))unique.set(item.text,item);
      return [...unique.values()];
    });
    if(alternatives.some(a=>!a.length))return [];
    // A second alternative with the same missing ships plus more missing ships
    // adds no useful action to the compact hint. Full API diagnostics stay intact.
    const visible=compact?alternatives.filter(a=>!alternatives.some(b=>b.length<a.length&&b.every(s=>a.some(item=>item.text===s.text)))):alternatives;
    const uniqueChoices=new Map();
    for(const items of visible){const text=items.map(item=>item.text).join('；');if(!uniqueChoices.has(text))uniqueChoices.set(text,items);}
    const choices=[...uniqueChoices.entries()];
    const text=`${point.from==='start'?'出发点':point.from} → ${point.to}${compact?'：':' 缺少可用带路船：'}`+
      (choices.length===1?choices[0][0]:choices.map(([value],i)=>`方案 ${i+1}：${value}`).join('；或 '));
    return [{code:'missingRoutingShips',from:point.from,to:point.to,compact,choices:choices.map(([,items])=>items),text}];
  });
}
const shipRequirementWarnings=(store,requirements,ctx,settings,options)=>shipRequirementWarningDetails(store,requirements,ctx,settings,options).map(item=>item.text);
module.exports={DEFAULTS,normalize,normalizeGroup,evaluator,structuredEvaluator,reasonText,planningStore,shipRequirementWarnings,shipRequirementWarningDetails};
