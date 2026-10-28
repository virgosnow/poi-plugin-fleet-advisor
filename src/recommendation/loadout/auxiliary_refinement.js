'use strict';
// Bounded proposals for the equipped finalists, not another fleet search.
const value=require('./combat_value');
const {fleetAntiAir}=require('../../domain/combat/anti_air_cutin');
const night=require('../../domain/combat/night_cutin');
const {fleetSpecialAttacks}=require('../../domain/combat/special_attacks');
const {canEquip,acceptsOtherSlot}=require('../../domain/fleet/equipment_rules');
const {memoLoadout,referenceKey}=require('./search_memo');
const perf=require('../../shared/performance_trace');
const AUX=new Set([12,13,21,27,36,39,93]),RADAR=new Set([12,13,93]);
const role=t=>RADAR.has(t)?'radar':t;
function auxiliaryVariants(store,scheme,inventory,{profile,heldSlots=[],limit=6}={}){
  return memoLoadout(store,inventory,'auxiliary',[scheme,referenceKey(store,profile),heldSlots,limit],()=>{
    const timing=perf.begin('loadout.auxiliary');
    try{return propose(store,scheme,inventory,profile,heldSlots,Math.min(6,Math.max(0,limit)));}
    finally{perf.end(timing);}
  });
}
function propose(store,scheme,inventory,profile,heldSlots,limit){
  if(!limit)return [];
  const holds=new Map(heldSlots.filter(Boolean).map(e=>[e.id,e.keep||{}]));
  const master=id=>store.const.$equips[store.info.equips[id]?.api_slotitem_id];
  const type=id=>Number(master(id)?.api_type?.[2]);
  const targets=scheme.ships.map(e=>value.targetFor(store,e)),special=fleetSpecialAttacks(targets,scheme.ships);
  const air=value.airExposure(store,profile),los=value.losNeeded(store,profile,profile?.area);
  const allIds=scheme.ships.flatMap(e=>[...e.slots,e.ex]).filter(id=>id>0),baseAa=value.antiAirScore(store,scheme,profile).value;
  const stock=new Map(inventory.map(i=>[i.id,i]));
  const merit=e=>{const p=value.plannedStats(store,e);return p.firePower*30+p.torpedo*16+p.armor*9+p.antiAir*3*air;};
  const candidates=[];
  for(const entry of scheme.ships){
    if(store.info.ships[entry.id].api_slot_ex===0)continue;
    const keep=holds.get(entry.id)||{},positions=entry.slots.map((_,k)=>k).concat('ex').filter(k=>
      !keep[k]&&((k==='ex'?entry.ex:entry.slots[k])<=0||AUX.has(type(k==='ex'?entry.ex:entry.slots[k]))));
    if(!positions.length||!entry.slots.some(id=>AUX.has(type(id)))||entry.ex>0&&!AUX.has(type(entry.ex)))continue;
    const target=value.targetFor(store,entry),oldCi=fleetAntiAir([target]),oldModes=night.surfaceModes(target);
    const oldTerm=oldModes.some(m=>m.coefficient)?night.fixedTerm(target,scheme.ships[0].id===entry.id).term:null;
    const critical=special.has(entry.id)?target.items.filter(e=>RADAR.has(e.type)).map(e=>e.id):[];
    const mutable=new Set(positions.map(k=>k==='ex'?entry.ex:entry.slots[k]).filter(id=>id>0));
    const reserved=new Set(allIds.filter(id=>!mutable.has(id)));
    const pool=inventory.filter(i=>AUX.has(Number(i.master.api_type[2]))&&!reserved.has(i.id));
    const legal=(id,k)=>{try{const i=stock.get(id);return i&&canEquip(store,entry.id,id,k)&&
      (!i.sourceShipId||i.sourceShipId===entry.id||acceptsOtherSlot(store,entry.id,id,k));}catch(_){return false;}};
    const ownBest=[],seen=new Set(),oldMerit=merit(entry);
    const consider=trial=>{
      const signature=JSON.stringify(trial);if(seen.has(signature))return;seen.add(signature);
      const ids=trial.slots.concat(trial.ex).filter(id=>id>0);
      if(new Set(ids).size!==ids.length||critical.some(id=>!ids.includes(id))||
        trial.slots.some((id,k)=>id<=0&&trial.slots.slice(k+1).some(id=>id>0)))return;
      const next=value.targetFor(store,trial),newCi=fleetAntiAir([next]);
      if(oldCi.rows.some(c=>!newCi.rows.some(n=>n.id===c.id))||oldCi.known&&!newCi.known)return;
      const modes=night.surfaceModes(next);
      if(oldModes.some(m=>!modes.some(n=>n.label===m.label&&n.multiplier>=m.multiplier)))return;
      if(oldTerm!==null&&(night.fixedTerm(next,scheme.ships[0].id===entry.id).term??-Infinity)<oldTerm)return;
      // Lookout occurrence is a presence bonus, not a reason to retain two.
      if(oldModes.some(m=>m.coefficient)&&target.items.some(e=>e.type===39)&&!next.items.some(e=>e.type===39))return;
      const surfaceRadar=t=>t.items.some(e=>RADAR.has(e.type)&&Number(e.master?.api_saku)>=5);
      if(target.items.some(e=>e.type===11&&/夜間瑞雲/.test(e.master?.api_name||''))&&surfaceRadar(target)&&!surfaceRadar(next))return;
      const proposed={...scheme,ships:scheme.ships.map(e=>e.id===entry.id?trial:e)};
      const nextAa=value.antiAirScore(store,proposed,profile).value;if(nextAa<baseAa-1e-8)return;
      const gain=merit(trial)-oldMerit+(nextAa-baseAa)*20;
      perf.count('loadout.auxiliary.screened');if(gain<=1e-8)return;
      ownBest.push({scheme:proposed,gain,shipId:entry.id});
      ownBest.sort((a,b)=>b.gain-a.gain);if(ownBest.length>2)ownBest.length=2;
    };
    for(const k of positions){
      const roles=new Map(),effects=new Set();
      const choices=value.rankEquipment(store,entry,pool,k,{air,los,auxiliary:true}).filter(i=>{
        const key=JSON.stringify([i.master.api_id,store.info.equips[i.id]?.api_level]);
        if(effects.has(key))return false;effects.add(key);
        const r=role(Number(i.master.api_type[2])),n=roles.get(r)||0;if(n>=2)return false;roles.set(r,n+1);return true;
      });
      for(const item of choices){
        const trial={...entry,slots:entry.slots.slice()};if(k==='ex')trial.ex=item.id;else trial.slots[k]=item.id;
        consider(trial);
        // Move an existing auxiliary item between normal and expansion slots
        // while filling the freed slot. No main guns/planes/engines are moved.
        for(const other of positions.filter(j=>(j==='ex')!==(k==='ex'))){
          const old=k==='ex'?entry.ex:entry.slots[k];if(old<=0||!legal(old,other))continue;
          const moved={...trial,slots:trial.slots.slice()};if(other==='ex')moved.ex=old;else moved.slots[other]=old;
          consider(moved);
        }
      }
    }
    candidates.push(...ownBest);
  }
  candidates.sort((a,b)=>b.gain-a.gain);
  const best=[...new Map(candidates.slice().reverse().map(c=>[c.shipId,c])).values()].sort((a,b)=>b.gain-a.gain);
  let combined=scheme,count=0;
  for(const c of best){
    const next={...combined,ships:combined.ships.map(e=>e.id===c.shipId?c.scheme.ships.find(n=>n.id===e.id):e)};
    const ids=next.ships.flatMap(e=>[...e.slots,e.ex]).filter(id=>id>0);
    if(new Set(ids).size!==ids.length)continue;combined=next;count++;
  }
  const result=(count>1?[{scheme:combined,gain:best.reduce((n,c)=>n+c.gain,0)}]:[])
    .concat(best,candidates).filter((c,i,a)=>a.findIndex(p=>JSON.stringify(p.scheme)===JSON.stringify(c.scheme))===i).slice(0,limit);
  perf.count('loadout.auxiliary.proposed',result.length);return result;
}
module.exports={auxiliaryVariants};
