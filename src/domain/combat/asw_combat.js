'use strict';
// Normal-hit, full-supply references. No assumed criticals, support fleets,
// Tokai sorties or favorable engagement. These are not sortie success rates.
// https://wikiwiki.jp/kancolle/戦闘について/与ダメージの算定に関わる要素の考察#AntiSubmarine
const {bonus,openingASW}=require('./opening_asw');
const {consumption}=require('../routes/sortie_profile');
const catalog=new Map(require('../../../data/sortie/enemy_catalog.json').enemies.map(e=>[e.apiId,e]));
const number=v=>v==null||!Number.isFinite(Number(v))?null:Number(v);
const first=v=>number(Array.isArray(v)?v[0]:v);
const kind=m=>Number(m?.api_type?.[2]);
const compact=s=>String(s||'').normalize('NFKC').replace(/\s/g,'');
const isAswWeapon=m=>[14,15,40].includes(kind(m)); // Type 44 is underway replenishment.
const weaponTypes=new Set([7,8,11,14,15,25,26,40]);
const depthIds=new Set([226,227,378,439,488]);
const penetrationIds=new Set([...depthIds,472,473]);
function roles(item){
  const t=kind(item.master),name=compact(item.master?.api_name),id=Number(item.master?.api_id);
  const depth=t===15&&(depthIds.has(id)||/^(九五式爆雷|二式爆雷(?:改二)?|Hedgehog\(初期型\)|対潜短魚雷\(試作初期型\))$/.test(name));
  const mortar=t===15&&/迫撃砲/.test(name);
  return {small:t===14,large:t===40,depth,mortar,projector:t===15&&!depth&&!mortar,
    penetration:t===15&&(penetrationIds.has(id)||/^(RUR-4A|Mk\.32)/.test(name))};
}
function aswAttack(store,target){
  const before=requireItems(store,target.before),after=requireItems(store,target.after);
  const stype=Number(target.master.api_stype),surface=[1,2,3,4,21,22].includes(stype);
  const aviation=[6,7,10,16,17,20].includes(stype)||compact(target.master.api_name)==='加賀改二護';
  if(!surface&&!aviation)return {status:'known',power:0,opening:false,normal:false,hull:0};
  const items=after.map(e=>({...e,planes:e.slot==='ex'?0:Number(target.master.api_maxeq?.[e.slot]??target.ship.api_onslot?.[e.slot]??0)}));
  const aircraft=items.some(e=>[7,8,11,25,41].includes(e.type)&&e.planes>0&&
    (e.raw>0||[11,25,41].includes(e.type)));
  const opening=openingASW(store,target).eligible===true&&(surface||items.some(e=>[7,8,11,25,26].includes(e.type)&&e.planes>0));
  if(!surface&&!aircraft&&!opening)return {status:'known',power:0,opening:false,normal:false,hull:0};
  const old=bonus(store,target,before),next=bonus(store,target,after),observed=first(target.ship.api_taisen);
  const unknown=[...old.reasons,...next.reasons];
  if(observed===null||!old.known||!next.known)return {status:'unknown',power:null,reason:unknown.join('；')||'对潜属性缺失'};
  const hull=observed-before.reduce((n,e)=>n+(e.raw||0),0)-old.value;
  if(hull<0)return {status:'unknown',power:null,reason:'对潜面板与装备资料不一致'};
  const normal=surface&&hull>0||aviation&&aircraft;
  if(!normal&&!opening)return {status:'known',power:0,opening:false,normal:false,hull};
  const air=!surface,rs=items.map(roles),has=name=>rs.some(r=>r[name]);
  const sonar=has('small')||has('large'),depth=has('depth'),projector=has('projector');
  const oldSynergy=sonar&&(projector||has('mortar'))?1.15:1;
  const newSynergy=1+(depth&&(has('small')||has('large')&&!projector&&!has('mortar')) ? .15 : 0)+(depth&&projector ? .1 : 0);
  const raw=items.filter(e=>weaponTypes.has(e.type)&&(![7,8,11,25,26].includes(e.type)||e.planes>0))
    .reduce((n,e)=>n+(e.raw||0),0);
  const improvements=items.filter(e=>isAswWeapon(e.master)).reduce((n,e)=>n+Math.sqrt(Math.max(0,Number(e.level||0))),0);
  const penetration=items.reduce((n,e,i)=>n+(rs[i].penetration?Math.sqrt(Math.max(0,(e.raw||0)-2))+(stype===1?1:0):0),0);
  return {status:'known',power:(2*Math.sqrt(hull)+1.5*(raw+next.value)+improvements+(air?8:13))*oldSynergy*newSynergy,
    opening,normal,hull,equipmentAsw:raw,blue:next.value,improvements,synergy:oldSynergy*newSynergy,penetration};
}
function requireItems(store,state){
  return (state?.slots||[]).map((id,slot)=>({id,slot})).concat({id:state?.ex,slot:'ex'}).filter(e=>e.id>0).map(({id,slot})=>{
    const item=store.info.equips[id],master=store.const.$equips[item?.api_slotitem_id];
    return {id:Number(item?.api_slotitem_id),slot,level:item?.api_level||0,type:kind(master),master,raw:Number(master?.api_tais||0)};
  });
}
const formationMultipliers={lineAhead:.6,doubleLine:.8,diamond:1.2,echelon:1.1,lineAbreast:1.3};
const damageCache=new WeakMap();
// Wiki 7-4 tactics: these bonuses apply to DE/CT attacks at J, L and P.
function mapBonus(area,node,stype){
  return area==='7-4'&&['J','L','P'].includes(node)?
    stype===1?(node==='P'?1.33:1.25):stype===21?(node==='P'?1.23:1.15):1:1;
}
function aswDamage(attack,enemy,{formation='lineAhead',engagement=1,bonus=1,ammo=1}={}){
  if(!Number.isFinite(attack.power)||!Number.isFinite(enemy.hp)||!Number.isFinite(enemy.armor)||!formationMultipliers[formation])return {status:'unknown'};
  let cache=damageCache.get(attack);if(!cache){cache=new Map();damageCache.set(attack,cache);}
  const key=[enemy.hp,enemy.armor,formation,engagement,bonus,ammo].join(':');
  if(cache.has(key))return cache.get(key);
  const pre=attack.power*formationMultipliers[formation]*engagement;
  const power=Math.floor((pre>170?170+Math.sqrt(pre-170):pre)*bonus);
  const armor=Math.max(1,enemy.armor-(attack.penetration||0)),rolls=Math.ceil(armor);
  let total=0,kill=0,disable=0,min=Infinity,max=0;
  for(let roll=0;roll<rolls;roll++){
    const weight=Math.min(1,armor-roll)/armor;
    // Do not credit scratch damage as an effective ASW attack or a kill.
    const damage=Math.max(0,Math.floor((power-armor*.7-roll*.6)*ammo));
    total+=damage*weight;kill+=Number(damage>=enemy.hp)*weight;disable+=Number(damage>=Math.ceil(enemy.hp/2))*weight;
    min=Math.min(min,damage);max=Math.max(max,damage);
  }
  const result={status:'known',power,min,max,mean:total,killOnHit:kill,disableOnHit:disable};
  cache.set(key,result);return result;
}
const profiles=new WeakMap(),readings=new WeakMap(),encounters=new Map();
function submarineEncounters(profile){
  if(!profile||typeof profile!=='object')return [];
  if(profiles.has(profile))return profiles.get(profile);
  const paths=profile.routePaths?.length?profile.routePaths.map(p=>p.nodes):profile.examples||[];
  if(!profile.area||!paths.length)return [];
  const selected=new Set(paths.flat());
  if(!encounters.has(profile.area)){
    try{encounters.set(profile.area,require(`../../../data/sortie/encounters/${profile.area}.json`));}
    catch(_){return [];}
  }
  const data=encounters.get(profile.area);
  const result=[];
  for(const id of selected){
    const node=data.nodes[id];if(!node||!['asw','battle'].includes(node.kind))continue;
    const patterns=Object.values(node.phases||{}).flatMap(phase=>phase.patterns||[]);
    const forms=new Map();
    for(const pattern of patterns){
      const subs=[...(pattern.enemyShips||[]),...(pattern.escortFleet?.enemyShips||[])].filter(e=>/潜水/.test(catalog.get(e.apiId)?.shipType||e.name)).map(e=>{
        const enemy=catalog.get(e.apiId),stats=enemy?.stats;
        const upper=v=>Array.isArray(v)?Math.max(...v):number(v);
        return {id:e.apiId,name:e.name,hp:upper(stats?.耐久),armor:upper(stats?.装甲)};
      });
      if(subs.length)forms.set(JSON.stringify(subs),subs);
    }
    if(!forms.size)continue;
    // Ammo is measured on entry to this node, independently for every
    // alternative path. A later branch must not drain an earlier ASW battle.
    const ammo=paths.filter(path=>path.includes(id)).map(path=>{
      const costs=path.slice(0,path.indexOf(id)).map(n=>consumption(data.nodes[n]||{},profile.area).ammo);
      return costs.some(v=>v===null)?null:Math.min(1,Math.max(0,1-costs.reduce((a,b)=>a+b,0))*2);
    });
    if(forms.size)result.push({id,kind:node.kind,boss:profile.targetNodes?.includes(id)||false,
      ammo:ammo.includes(null)?null:Math.min(...ammo),formations:[...forms.values()]});
  }
  profiles.set(profile,result);return result;
}
// Stores are immutable calculation snapshots. Reuse hull/loadout readings
// across candidate preferences and route projections, never inventory choices.
function reading(store,entry){
  let cache=readings.get(store);if(!cache){cache=new Map();readings.set(store,cache);}
  const key=JSON.stringify([entry.id,entry.slots,entry.ex]);
  if(!cache.has(key)){
    const ship=store.info.ships[entry.id],master=store.const.$ships[ship.api_ship_id];
    cache.set(key,aswAttack(store,{id:entry.id,ship,master,before:{slots:ship.api_slot,ex:ship.api_slot_ex},after:entry}));
    if(cache.size>8192)cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}
function assessAsw(store,scheme,profile,{limit=6,formation,details=false}={}){
  const encounters=submarineEncounters(profile);if(!encounters.length)return {status:'none',score:0,readiness:1,nodes:[]};
  const objective=encounters.some(node=>node.boss&&(node.kind==='asw'||
    profile.mapPreview?.nodes.find(n=>n.id===node.id)?.submarineFlagship));
  const attackers=scheme.ships.map(entry=>({entry,attack:reading(store,entry),
    stype:Number(store.const.$ships[store.info.ships[entry.id].api_ship_id].api_stype)}));
  let score=0,readiness=1,unknown=false;
  const nodes=encounters.map(node=>{
    if(node.ammo===null)unknown=true;
    const primary=node.kind==='asw'||node.boss&&profile.mapPreview?.nodes.find(n=>n.id===node.id)?.submarineFlagship;
    const chosen=formation||(primary?'lineAbreast':'lineAhead');
    let worst=null;
    for(const enemies of node.formations){
      const known=enemies.every(e=>Number.isFinite(e.hp)&&Number.isFinite(e.armor));
      if(!known){unknown=true;continue;}
      const required=Math.min(limit,enemies.length);
      const rows=attackers.map(({entry,attack,stype})=>{
        const damage=enemies.map(enemy=>aswDamage(attack,enemy,{formation:chosen,bonus:mapBonus(profile.area,node.id,stype),ammo:node.ammo??1}));
        if(damage.some(d=>d.status==='unknown')){unknown=true;return {id:entry.id,effect:0,opening:0,normal:0,damage};}
        const fraction=damage.reduce((n,d,i)=>n+Math.min(1,d.mean/enemies[i].hp),0)/enemies.length;
        return {id:entry.id,effect:fraction*(Number(attack.opening)+Number(attack.normal)*.5),
          opening:attack.opening?fraction:0,normal:attack.normal?fraction:0,damage};
      }).sort((a,b)=>b.effect-a.effect||a.id-b.id).slice(0,Math.min(limit,enemies.length));
      const early=rows.reduce((n,r)=>n+r.opening,0),normal=rows.reduce((n,r)=>n+r.normal,0);
      // Pure submarine objectives favor effective opening attacks before
      // torpedoes. Surface routes credit a bounded escort capacity; damage
      // beyond that capacity must not keep displacing boss-combat weapons.
      const coverage=objective?early:early+normal*.5;
      // Clearing the weak escorts must not hide zero effective damage to
      // the armored flagship in that same enemy formation.
      const hardest=enemies.reduce((a,e,i)=>e.hp+e.armor>enemies[a].hp+enemies[a].armor?i:a,0);
      const hardRequired=Math.min(required,enemies.filter(e=>e.hp===enemies[hardest].hp&&e.armor===enemies[hardest].armor).length);
      const hardCapacity=rows.reduce((n,row)=>n+Math.min(1,(row.damage[hardest]?.mean||0)/enemies[hardest].hp)*
        (Number(row.opening>0)+(objective?0:Number(row.normal>0)*.5)),0);
      const ready=required?Math.min(1,coverage/required,hardCapacity/hardRequired):1;
      const value={formation:chosen,ammo:node.ammo,enemyCount:enemies.length,required,
        openingCapacity:early,firstShellingCapacity:normal,hardTargetCapacity:hardCapacity,score:ready*required*200,
        readiness:ready,
        ...(details?{enemies,ships:rows}: {})};
      if(!worst||value.readiness<worst.readiness-1e-9||Math.abs(value.readiness-worst.readiness)<1e-9&&value.required>worst.required)worst=value;
    }
    if(!worst){readiness=0;return {id:node.id,status:'unknown'};}
    score+=worst.score;readiness=Math.min(readiness,worst.readiness);
    return {id:node.id,...worst};
  });
  return {status:unknown?'partial':'known',score:score/encounters.length,readiness,nodes};
}
function maintainsAsw(store,before,after,profile,limit){
  if(!requiresAswPackages(profile))return true;
  const a=assessAsw(store,before,profile,{limit});
  if(a.status==='partial'){
    const items=entries=>entries.flatMap(e=>e.slots.concat(e.ex)).filter(id=>isAswWeapon(store.const.$equips[store.info.equips[id]?.api_slotitem_id]));
    const retained=new Set(items(after.ships));return items(before.ships).every(id=>retained.has(id));
  }
  if(a.status!=='known')return true;
  const b=assessAsw(store,after,profile,{limit});
  return b.status==='known'&&b.readiness+1e-9>=a.readiness;
}
// Every selected submarine encounter uses the same damage model. The escort
// budget and capped capacity, rather than a map-specific gate, bound fitting.
function requiresAswPackages(profile){
  return submarineEncounters(profile).length>0;
}
// Bounded complete packages on the final route shortlist. Ordinary seed
// fitting stays cheap; no exhaustive whole-inventory allocation is introduced.
module.exports={isAswWeapon,roles,aswAttack,aswDamage,submarineEncounters,mapBonus,reading,assessAsw,maintainsAsw,requiresAswPackages};
