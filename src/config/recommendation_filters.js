'use strict';
// Preferences affect automatic selection, never the user's explicit draft.
const DEFAULTS={
  normal:{maxRoutes:5,minLevel:30,excludeUnremodeled:true,excludeExpedition:true,excludeRepairing:true,excludeUnlocked:true,excludeHeavyDamage:true,excludeFatigued:true},
  expedition:{defaultGoal:'great',minLevel:0,excludeUnremodeled:false,excludeExpedition:true,excludeRepairing:true,excludeUnlocked:true,excludeFirstFleet:true},
};
function normalizeGroup(kind,value={}){
  const defaults=DEFAULTS[kind],out={};
  for(const [key,fallback]of Object.entries(defaults))out[key]=key==='defaultGoal'?
    (['great','success'].includes(value?.[key])?value[key]:fallback):key==='maxRoutes'?
    (Number.isInteger(value?.[key])&&value[key]>=1&&value[key]<=20?value[key]:fallback):key==='minLevel'?
    (Number.isInteger(value?.[key])&&value[key]>=0&&value[key]<=999?value[key]:fallback):
    (typeof value?.[key]==='boolean'?value[key]:fallback);
  return out;
}
const normalize=value=>Object.fromEntries(Object.keys(DEFAULTS).map(kind=>[kind,normalizeGroup(kind,value?.[kind])]));
function evaluator(store,kind,value){
  const settings=normalizeGroup(kind,value),masters=store.const?.$ships||{};
  // Names like zwei/due/Mk.II are not reliable remodel indicators. Use the
  // master's incoming remodel edges, including reversible conversions.
  const remodeled=new Set(Object.values(masters).map(m=>Number(m.api_aftershipid)).filter(id=>id>0));
  const repairing=new Set((store.info.repairs||[]).map(d=>Number(typeof d==='object'?d.api_ship_id:d)));
  const away=new Set((store.info.fleets||[]).filter(f=>Number(f.api_mission?.[0]||0)!==0).flatMap(f=>f.api_ship||[]));
  const first=new Set(store.info.fleets?.[0]?.api_ship||[]);
  return id=>{
    const ship=store.info.ships[id],master=masters[ship?.api_ship_id];if(!ship||!master)return ['舰娘不存在'];
    const reasons=[];
    if(Number(ship.api_lv)<settings.minLevel)reasons.push(`等级低于 ${settings.minLevel}`);
    // A ship with no remodel at all is not an unremodeled version to exclude.
    if(settings.excludeUnremodeled&&Number(master.api_aftershipid)>0&&!remodeled.has(Number(ship.api_ship_id)))reasons.push('未改造');
    if(settings.excludeExpedition&&away.has(Number(id)))reasons.push('远征中');
    if(settings.excludeRepairing&&(repairing.has(Number(id))||ship.api_situation===2))reasons.push('入渠中');
    if(settings.excludeUnlocked&&Number(ship.api_locked)===0)reasons.push('未锁定');
    if(settings.excludeHeavyDamage&&Number(ship.api_maxhp)>0&&Number(ship.api_nowhp)/Number(ship.api_maxhp)<=.25)reasons.push('大破');
    if(settings.excludeFatigued&&Number(ship.api_cond)<40)reasons.push('士气低于 40');
    if(settings.excludeFirstFleet&&first.has(Number(id)))reasons.push('第一舰队成员');
    return reasons;
  };
}
// Optional future planning when busy ships are explicitly included. Only the
// private calculation copy is released; live preview/execution stays strict.
function planningStore(store,settings){
  if(settings.excludeExpedition&&settings.excludeRepairing)return store;
  return {...store,info:{...store.info,
    fleets:settings.excludeExpedition?store.info.fleets:store.info.fleets.map(f=>({...f,api_mission:[0,0,0]})),
    repairs:settings.excludeRepairing?store.info.repairs:[],
    ships:settings.excludeRepairing?store.info.ships:Object.fromEntries(Object.entries(store.info.ships).map(([id,s])=>[id,{...s,api_situation:s.api_situation===2?0:s.api_situation}]))}};
}
// Inspect the full owned roster, not the already-filtered search pool. The
// context's availability is authoritative (including manual ship overrides).
function shipRequirementWarnings(store,requirements,ctx,settings,{compact=false}={}){
  const reasons=evaluator(store,'normal',settings),rows=[...ctx.byId.values()];
  const away=new Set(store.info.fleets.filter(f=>Number(f.api_mission?.[0]||0)!==0).flatMap(f=>f.api_ship||[]));
  const repair=new Set((store.info.repairs||[]).map(d=>Number(typeof d==='object'?d.api_ship_id:d)));
  const family=row=>typeof row.master.api_yomi==='string'&&row.master.api_yomi.trim()?
    row.master.api_yomi.normalize('NFKC').trim():row.ship.api_ship_id;
  const describe=({prefixes,min})=>{
    const owned=rows.filter(row=>prefixes.some(p=>row.name.startsWith(p)));
    const available=new Set(owned.filter(row=>row.available).map(family)).size;
    if(available>=min)return null;
    const label=prefixes.join(' / ')+(prefixes.length>1?`（需 ${min} 艘）`:'');
    if(!owned.length)return `${label}：未持有`;
    const details=owned.map(row=>{
      if(row.available)return `${row.name} Lv.${row.level} 可用`;
      const filters=reasons(row.id),blocked=filters.map(reason=>`出击设置「${reason}」`);
      if(ctx.excluded.includes(row.id))blocked.push('手动排除');
      if(away.has(row.id)&&!filters.includes('远征中'))blocked.push('远征中，当前不能编入');
      if((repair.has(row.id)||row.ship.api_situation===2)&&!filters.includes('入渠中'))blocked.push('入渠中，当前不能编入');
      if(compact)return `${row.name} Lv.${row.level}（${blocked.map(reason=>reason.replace(/^出击设置「(.+)」$/,'$1')).join('、')||'当前不能编入'}，已排除）`;
      return `${row.name} Lv.${row.level} 已持有，但被排除：${blocked.join('、')||'当前不能编入'}`;
    });
    for(const prefix of prefixes)if(!owned.some(row=>row.name.startsWith(prefix)))details.push(`${prefix}：未持有`);
    return (prefixes.length>1?`${label}：`:'')+details.join('；')+
      (min>1?`；可用 ${available}/${min} 艘（同舰不同实例不重复计数）`:'');
  };
  return requirements.flatMap(point=>{
    const alternatives=point.alternatives.map(a=>[...new Set(a.map(describe).filter(Boolean))]);
    if(alternatives.some(a=>!a.length))return [];
    // A second alternative with the same missing ships plus more missing ships
    // adds no useful action to the compact hint. Full API diagnostics stay intact.
    const visible=compact?alternatives.filter(a=>!alternatives.some(b=>b.length<a.length&&b.every(s=>a.includes(s)))):alternatives;
    const choices=[...new Set(visible.map(a=>a.join('；')))];
    return [`${point.from==='start'?'出发点':point.from} → ${point.to}${compact?'：':' 缺少可用带路船：'}`+
      (choices.length===1?choices[0]:choices.map((s,i)=>`方案 ${i+1}：${s}`).join('；或 '))];
  });
}
module.exports={DEFAULTS,normalize,normalizeGroup,evaluator,planningStore,shipRequirementWarnings};
