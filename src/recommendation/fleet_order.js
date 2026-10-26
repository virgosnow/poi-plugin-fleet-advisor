'use strict';
// Final departure-order heuristic, not a damage/survival simulation.
// Second shelling rounds and night combat follow fleet order; flagship terms
// come from the same fixed-condition CI readers as the mechanism tooltips.
// https://wikiwiki.jp/kancolle/戦闘について
// https://wikiwiki.jp/kancolle/夜戦
const attack=require('../domain/combat/attack_power');
const night=require('../domain/combat/night_cutin');
const observation=require('../domain/combat/carrier_cutin');
const spotting=require('../domain/combat/day_spotting');
const mechanisms=require('../domain/combat/ship_mechanisms');
const ground=require('../domain/combat/installation_attack');
const jets=require('../domain/combat/jet_aviation');
const {fleetSpecialAttacks}=require('../domain/combat/special_attacks');
const {plannedCombatStat}=require('./scoring');
const {routeDifficulty}=require('./route_economy');
const {submarineObjective}=require('./loadout/loadout_policy');

function nightExpected(badge,fallback){
  if(!badge||badge.state==='blocked')return fallback;
  if(!badge.ci)return badge.attacks?.[0]?.power??fallback;
  let value=fallback;
  for(const row of badge.ci.rows){
    if(row.power===null)continue;
    // Unknown multi-hit branches get their one-hit lower bound. Double attack
    // uses the existing recommendation convention, not a new activation rate.
    const hits=Number.isFinite(row.hits)?row.hits:1;
    const rate=row.coefficient===null?1:row.occurrence??0;
    value+=rate*(row.power*hits-fallback);
  }
  return value;
}
function dayExpected(base,reading,attacks){
  const groups=reading?.route?.groups;
  if(!groups?.length)return base;
  let total=0,count=0;
  for(const group of groups){
    const weight=group.nodes.length||1;let value=base;
    for(const row of reading.rates[group.state]?.rows||[]){
      const hit=attacks.find(a=>a.label===row.label);
      if(hit?.power!=null)value+=(row.rate??0)*(hit.power*hit.hits-base);
    }
    total+=value*weight;count+=weight;
  }
  return count?total/count:base;
}
function combatReadings(store,scheme,profile,rows,air){
  const targets=scheme.ships.map(entry=>{const ship=store.info.ships[entry.id];return {
    id:entry.id,ship,master:store.const.$ships[ship.api_ship_id],
    before:{slots:ship.api_slot,ex:ship.api_slot_ex},after:entry,
    items:ground.itemsForEntry(store,entry).map(e=>({...e,type:Number(e.master.api_type[2])}))};});
  const context=observation.createContext(store,targets,profile,
    {airReference:air?.routeAirReference,airEstimate:air?.routeAirEstimate});
  const land=ground.routeGroundTargets(profile).length?ground.groundCombatContext(store,scheme,profile,
    {airReference:air?.routeAirReference,airEstimate:air?.routeAirEstimate}):null;
  const lighting=targets.some(t=>t.items.some(e=>[29,33,42].includes(e.type)));
  const readings=new Map(targets.map(t=>{
    const type=Number(t.master.api_stype),carrier=[7,11,18].includes(type),sub=[13,14].includes(type);
    const fire=attack.fireBase(t,store).value??plannedCombatStat(store,rows.find(r=>r.id===t.id),scheme,'api_karyoku','api_houg');
    const power=night.surfacePower(t,store),plainNight=attack.cap(power.basePower??fire+
      plannedCombatStat(store,rows.find(r=>r.id===t.id),scheme,'api_raisou','api_raig'),360);
    const aviation=carrier?mechanisms.nightAviation(t,store):null;
    return [t.id,[false,true].map(flagship=>{
      let day=sub?0:attack.cap(fire+5,220),atNight=plainNight;
      if(carrier){
        const types=t.after.slots.flatMap((id,k)=>{
          const e=t.items.find(e=>e.id===id);return t.master.api_maxeq?.[k]>0&&e&&Number(e.master.api_type[0])!==21?[e.type]:[];
        });
        const modes=jets.carrierModes(types),p=observation.attackPowers(t,store,modes);
        day=types.some(v=>[7,8,57].includes(v))?dayExpected(p.basePower??day,observation.read(context,t,flagship,modes),p.rows):0;
        atNight=aviation?nightExpected(mechanisms.carrierNightCutIn(t,aviation,flagship,store)||aviation,aviation.attacks[0]?.power??0):0;
      }else{
        if(!sub&&t.items.some(e=>[10,11].includes(e.type)&&e.planes>0)){
          const p=spotting.read(t,store,flagship,context);day=dayExpected(day,p.ci,p.attacks);
        }
        atNight=nightExpected(mechanisms.nightAttack(t,flagship,store),plainNight);
        atNight=nightExpected(mechanisms.nightZuiunAttack(t,lighting,flagship,store),atNight);
      }
      const landAttacks=land?.score(t.after,fire,{flagship}).attacks||[];
      return {day,night:atNight,landDay:landAttacks.length?landAttacks.reduce((s,a)=>s+a.day,0)/landAttacks.length:day,
        landNight:landAttacks.length?landAttacks.reduce((s,a)=>s+a.night,0)/landAttacks.length:atNight};
    })];
  }));
  return {readings,targets,land:!!land};
}

// A lone durability outlier can benefit from flagship covering. This relative
// threshold is a recommendation policy, not a formula for being covered or sunk.
function fragileEscort(rows,profile,{store,scheme}={}){
  if(rows.length<4||routeDifficulty(profile).tier==='routine')return null;
  const values=rows.map(row=>{const hp=Number(row.ship.api_maxhp),armor=store&&scheme?plannedCombatStat(store,row,scheme,'api_soukou','api_souk'):Number(row.ship.api_soukou?.[0]);
    return {id:row.id,stype:row.stype,durability:hp>0&&armor>0?hp*armor:null};});
  if(values.some(v=>v.durability===null))return null;
  const ranked=values.slice().sort((a,b)=>a.durability-b.durability),first=ranked[0];
  if([13,14].includes(first.stype))return null;
  const rest=ranked.slice(1),middle=rest[Math.floor(rest.length/2)].durability;
  return first.durability<middle*.55&&rest[0].durability>=first.durability*1.6?first.id:null;
}
function fleetOrderChoices(store,scheme,profile,rows,{locked=new Map(),air,limit=8}={}){
  const surface=profile.counts?.surface?.maximum||0,nightBattles=profile.counts?.night?.maximum||0;
  if(scheme.ships.length<2||locked.size>=scheme.ships.length||!surface&&!nightBattles||submarineObjective(profile,store))return [];
  const positions=new Map(locked),{readings,targets,land}=combatReadings(store,scheme,profile,rows,air);
  const special=fleetSpecialAttacks(targets,scheme.ships).get(scheme.ships[0].id);
  if(special?.state==='conditional')for(const p of special.participants)positions.set(p.position-1,p.id);
  if([...positions].some(([i,id])=>scheme.ships[i]?.id!==id))return [];
  const visited=new Set((profile.routePaths?.map(p=>p.nodes)||profile.examples||[]).flat());
  const secondRound=rows.some(r=>[8,9,10].includes(r.stype))||
    (profile.mapPreview?.nodes||[]).some(n=>visited.has(n.id)&&
      n.enemies?.some(e=>/戦艦|战舰|战列/.test(e.type||'')||/戦艦/.test(e.originalName||'')));
  // Day rounds receive their route count; optional boss night gets a smaller
  // opportunity weight. These are ranking weights, never battle probabilities.
  const weights={surface:secondRound?Math.max(0,surface-(land?1:0)):0,
    land:secondRound&&land?1:0,night:nightBattles||(surface?0.65:0)};
  const value=(id,position)=>{const r=readings.get(id)[position===0?1:0];return r.day*weights.surface+r.landDay*weights.land+
    (land?r.landNight:r.night)*weights.night;};
  const merit=entries=>entries.reduce((sum,e,i)=>sum+value(e.id,i)*(entries.length-i),0);
  const fragile=fragileEscort(rows,profile,{store,scheme}),original=merit(scheme.ships),choices=[];
  const originalProtection=Number(fragile!==null&&scheme.ships[0].id===fragile);
  // For each possible flagship, decreasing position weights make a stable
  // descending sort optimal among the remaining free ships. At most six
  // candidates, not 6! full fleet evaluations; every legal flagship is tried.
  for(const flag of scheme.ships){
    if(positions.has(0)&&positions.get(0)!==flag.id||[...positions].some(([p,id])=>p!==0&&id===flag.id))continue;
    const order=Array(scheme.ships.length).fill(null);order[0]=flag;
    for(const [position,id]of positions)order[position]=scheme.ships.find(e=>e.id===id);
    const assigned=new Set(order.filter(Boolean).map(e=>e.id));
    const remaining=scheme.ships.filter(e=>!assigned.has(e.id)).sort((a,b)=>value(b.id,1)-value(a.id,1));
    for(let i=0;i<order.length;i++)if(!order[i])order[i]=remaining.shift();
    const priority=merit(order),protection=Number(fragile!==null&&order[0].id===fragile);
    if(protection<originalProtection||protection===originalProtection&&priority<=original+1e-8)continue;
    choices.push({scheme:{...scheme,ships:order},priority,protection,reason:protection?'flagshipProtection':'attackOrder',
      moves:order.reduce((n,e,i)=>n+Number(e.id!==scheme.ships[i].id),0)});
  }
  return choices.sort((a,b)=>b.protection-a.protection||b.priority-a.priority||a.moves-b.moves).slice(0,limit);
}
module.exports={fleetOrderChoices,combatReadings,fragileEscort};
