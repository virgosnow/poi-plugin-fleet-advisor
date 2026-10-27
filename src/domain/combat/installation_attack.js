'use strict';
const {snapshotMemo}=require('../fleet/equipment_planner');
// Shared equipment effects; badges use reference power, ranking keeps its bounded proxy.
const rules=require('../../../data/installation_effects.json');
const attack=require('./attack_power');
const nightCI=require('./night_cutin');
const {airPower}=require('../fleet/fleet_metrics');
const {estimateRouteAir}=require('../routes/route_air');
const normalize=name=>String(name||'').normalize('NFKC').replace(/\s/g,'');
const equipmentRules=Object.fromEntries(Object.entries(rules.equipment).map(([name,tags])=>[normalize(name),tags]));
const flagCache=new WeakMap(),noFlags=[];
function flags(master){
  if(!master)return noFlags;
  const cached=flagCache.get(master);if(cached&&cached.name===master.api_name)return cached.flags;
  const found=equipmentRules[normalize(master.api_name)]||noFlags;
  flagCache.set(master,{name:master.api_name,flags:found});return found;
}
const type=master=>Number(master?.api_type?.[2]);
const dedicated=master=>flags(master).length>0;
const groundBombers=new Set(rules.groundBombers.map(name=>normalize(name).replace(/／/g,'/')));
const groundBomber=master=>type(master)===7&&groundBombers.has(normalize(master.api_name).replace(/／/g,'/'));
function carrierGroundState(items){
  const aircraft=items.filter(e=>[7,8,57,58].includes(type(e.master))),live=aircraft.filter(e=>e.planes>0);
  if(live.some(e=>groundBomber(e.master)))return 'ready';
  const unknown=aircraft.filter(e=>e.planes==null);
  if(unknown.some(e=>groundBomber(e.master)))return 'unknown';
  if(live.some(e=>[7,57].includes(type(e.master))))return 'blocked';
  if(unknown.some(e=>[7,57].includes(type(e.master))))return 'unknown';
  return live.length?'ready':unknown.length?'unknown':'blocked';
}
function equipmentEffects(items,target='soft',{night=false,stype=0}={}){
  const spec=rules.targets[target];if(!spec)return null;
  const counts={},groups={},unknown=[];
  for(const item of items){
    const tags=flags(item.master);
    for(const tag of tags){counts[tag]=(counts[tag]||0)+1;(groups[tag]||=[]).push(item);}
    if(!tags.length&&[24,37,46,52].includes(type(item.master)))unknown.push(type(item.master)===52?'陆战部队对地倍率未收录':item.master.api_name||'未收录对地装备');
  }
  const n=key=>counts[key]||0,pair=(values,count)=>count?values[Math.min(count,2)-1]:1;
  const avg=key=>groups[key]?.reduce((sum,e)=>sum+Number(e.instance?.api_level||0),0)/n(key)||0;
  const upgrade=1+(avg('landing')+avg('katsu'))/50,kamiUpgrade=1+avg('kami')/30;
  const landing=n('landing')+n('katsu');
  const armySynergy=n('army')>=2||n('army')&&(n('chiha')||n('chihaKai'))||n('chiha')&&n('chihaKai');
  // Multi-M4-family and repeated Chi-Ha/Sherman coefficients remain unverified.
  if(n('m4')>1||n('chiha')>1||n('chihaKai')>1||n('sherman')>1)unknown.push('同类战车多装倍率未确认');
  if(target==='supply'&&n('africa2')>1)unknown.push('II号战车多装集积地倍率未确认');
  if([...groups.landing||[],...groups.katsu||[],...groups.kami||[]].some(e=>e.instance?.api_level==null))unknown.push('改修资料缺失');
  const landingFactor=(r,post=false)=>{
    if(!landing)return 1;
    let a=r.landing*(n('large')?r.large:1)*(n('army')?r.army:1)*(armySynergy?r.armyExtra:1)*
      (n('africa2')?r.army:1)*(n('africa2')>=2&&!post?r.armyExtra:1)*(n('m4')?r.m4:1)*
      (n('katsuKai')?r.katsu:1);
    if(post||!night){if(n('support'))a*=r.support;if(n('support')>=2||n('katsu')>=2)a*=r.supportExtra;}
    const power=post?(n('army')&&n('africa2')?3:n('army')||n('africa2')?2:1):1;
    return a*Math.pow(upgrade,power);
  };
  const r=rules.targets[spec.pre||target];
  const seaplane=items.some(e=>[11,45].includes(type(e.master)));
  const bombers=items.filter(e=>[7,57].includes(type(e.master))).length;
  let multiplier=(n('shell')?r.shell:1)*pair(r.wg,n('wg'))*
    pair(r.rocket,n('rocket')+n('rocketConcentrated'))*pair(r.mortar,n('mortar')+n('mortarConcentrated'))*
    landingFactor(r)*pair(r.kami,n('kami'))*(n('kami')?kamiUpgrade:1)*
    (items.some(e=>type(e.master)===19)?r.ap:1)*(seaplane?r.seaplane:1)*pair(r.bomber,bombers),addition=0;
  const steps=[];
  const affine=(condition,a,b,label)=>{if(condition){multiplier*=a;addition=addition*a+b;steps.push(label);}};
  affine(n('regiment'),1.8,25,'战车联队');affine(n('sherman'),1.4,35,'M4A1');
  affine(n('honi'),1.3,42,'一式炮战车');affine(n('chiha'),1.4,28,'战车');
  affine(n('chihaKai'),1.5,33,'战车改');affine(n('katsu'),1.2,42,'特四式');affine(n('katsuKai'),1.1,28,'特四式改');
  const other1=n('landing')-n('support')-n('regiment')-n('chiha')-n('chihaKai')+n('honi')+n('katsu');
  const other2=n('regiment')-n('honi')+n('chiha')+n('chihaKai')+n('kami');
  if(n('support')&&other1+other2>0){
    const both=n('armed')&&n('ab'),a=both?(other1+other2>=2?1.5:other2?1.4:1.3):1.2;
    affine(true,a,(a-1)*50,'登陆支援协同');
  }
  for(const [key,values]of Object.entries(rules.additions))addition+=values[Math.min(n(key),4)];
  let postMultiplier=1;
  if(spec.post){const p=spec.post;postMultiplier=pair(p.wg,n('wg'))*pair(p.rocket,n('rocket')+n('rocketConcentrated'))*
    pair(p.mortar,n('mortar')+n('mortarConcentrated'))*landingFactor(p,true)*pair(p.kami,n('kami'))*(n('kami')?kamiUpgrade:1);}
  return {target,label:spec.label,multiplier,addition,postMultiplier,steps,
    hullMultiplier:target==='pillbox'&&[2,3].includes(Number(stype))?1.4:1,
    hullAddition:[13,14].includes(Number(stype))?30:0,
    status:unknown.length?'unknown':'known',unknown:[...new Set(unknown)]};
}
function itemsForEntry(store,entry){
  const ship=store.info.ships[entry.id];
  const sm=store.const.$ships[ship.api_ship_id];
  return [...(entry.slots||ship.api_slot),entry.ex??ship.api_slot_ex].flatMap((id,k)=>{
    if(id<=0)return [];const instance=store.info.equips[id],master=store.const.$equips[instance?.api_slotitem_id];
    return master?[{id,instance,master,planes:sm.api_maxeq?.[k]??null}]:[];
  });
}
// Normal-attack presentation families, not separate damage sources.
// Wiki AGEEffect confirms rocket/landing and aircraft/landing can coexist.
// CI/observation can override the animation; modifiers remain independent.
function groundConfiguration(items,{carrier=false,master}={}){
  carrier=carrier||attack.groundAviation(master,items);
  const count=key=>items.filter(e=>flags(e.master).includes(key)).length;
  const countAny=keys=>items.filter(e=>flags(e.master).some(key=>keys.includes(key))).length;
  const shell=count('shell'),army=countAny(['army','africa2']),kami=count('kami'),katsu=count('katsu');
  const tanks=countAny(['army','africa2','regiment','sherman','chiha','chihaKai']);
  const rocket=count('wg')+count('rocket')+count('rocketConcentrated');
  const mortar=count('mortar')+count('mortarConcentrated'),support=count('support');
  const landing=count('landing'),bomber=carrier?items.filter(e=>groundBomber(e.master)).length:0;
  const landUnits=items.filter(e=>type(e.master)===52).length;
  const momochi=[727,945].includes(Number(master?.api_id))||/^第百一号[輸输]送[艦舰](改)?$/.test(normalize(master?.api_name));
  const beaching=momochi&&landUnits?{units:landUnits,tanks:Math.min(2,landUnits),active:!(rocket||mortar)}:null;
  const summary=[];
  const add=(name,n)=>{if(n)summary.push(`${name}${n>1?'×'+n:''}`);};
  add('三式弹',shell);
  add('陆战队',army);add('战车',tanks-army);
  add('特二式内火艇',kami);add('特四式内火艇',katsu);
  // Plain Daihatsu still contributes a separate shared landing base when no
  // tank / Katsu already supplies it. Support boats have their own heading.
  if(!tanks&&!katsu&&!support)add('登陆艇',landing);
  add('对地火箭',rocket);add('对地迫击炮',mortar);
  add('登陆支援艇',support);add('对地舰爆',bomber);
  add('陆战部队',landUnits);
  // Plain Daihatsu and Type 3 shells have no dedicated ground animation.
  const landingAnimation=countAny(['large','army','africa2','regiment','sherman','chiha','chihaKai','kami','katsu','support']);
  const aviation=carrier&&items.some(e=>[7,8,57,58].includes(type(e.master))&&e.planes!==0);
  let categories=[['landing','登陆作战',landingAnimation],['rocket','火箭弹',rocket||mortar],['aircraft','航空轰炸',aviation]]
    .filter(([, ,n])=>n).map(([id,name])=>({id,label:'对地·'+name}));
  const unverifiedMix=categories.length>1&&!(categories.length===2&&categories.some(c=>c.id==='landing'));
  // Do not invent priority for combinations without confirmed coexistence.
  if(!categories.length||unverifiedMix)categories=[{id:'normal',label:'对地攻击'}];
  // Momochi's beaching replaces the ordinary landing effect. Rockets/mortars
  // override it; adding a Kami then retains the known rocket + Kami pair.
  if(beaching?.active)categories=[{id:'beaching',label:'对地·接岸登陆',state:'ready'}];
  const equipment=new Map();
  for(const e of items.filter(e=>dedicated(e.master)||type(e.master)===52||carrier&&groundBomber(e.master))){
    const name=e.master.api_name+(Number(e.instance?.api_level)>0?' ★'+e.instance.api_level:'');
    equipment.set(name,(equipment.get(name)||0)+1);
  }
  return {categories,label:categories.map(c=>c.label).join(' / '),unverifiedMix,beaching,summary:summary.join('＋'),
    equipment:[...equipment].map(([name,n])=>name+(n>1?' ×'+n:'')).join('、')};
}
function groundBadge(target,store,{profile,context,conditionalDayDouble=false}={}){
  const carrier=attack.groundAviation(target.master,target.items);
  const hybrid=carrier&&Number(target.master.api_stype)===22;
  // Hayasui's aviation conversion is daytime only. Use surface night power
  // as a reference, independently of the daytime aircraft capacity check.
  const surfaceNight=!carrier||hybrid;
  if(!target.items.some(e=>dedicated(e.master)||type(e.master)===52||carrier&&groundBomber(e.master)))return null;
  const presentationItems=carrier?target.items.map(e=>({...e,planes:
    target.master.api_maxeq?.[target.after?.slots?.indexOf(e.id)]??null})):target.items;
  const carrierState=carrier?carrierGroundState(presentationItems):'ready';
  const canDay=![13,14].includes(Number(target.master.api_stype))&&carrierState!=='blocked';
  const encountered=profile?routeGroundEncounters(profile):null;
  const selectedIds=new Set((profile?.examples?.length?profile.examples:profile?.routePaths?.map(p=>p.nodes)||[]).flat());
  const missingEnemies=profile?.mapPreview?.nodes?.some(n=>selectedIds.has(n.id)&&
    ['battle','nightBattle','unknown'].includes(n.kind)&&!n.enemies?.length&&n.threatStatus!=='none');
  if(encountered&&!encountered.length&&selectedIds.size&&!missingEnemies)return null;
  const relevant=encountered?encountered.flatMap(n=>n.targets.map(key=>({key,node:n.node,
    label:n.enemies.filter(e=>e.target===key).map(e=>e.name).join('／')+`（${n.node} 点）`} ))):
    Object.keys(rules.targets).map(key=>({key,label:rules.targets[key].label}));
  const rows=relevant.map(({key,label,node})=>{
    const day=equipmentEffects(target.items,key,{stype:target.master.api_stype});
    const night=equipmentEffects(target.items,key,{night:true,stype:target.master.api_stype});
    return {...day,label,node,night};
  });
  const dayBase=attack.fireBase(target,store),nightBase=surfaceNight?attack.fireBase(target,store,{night:true}):null,nightMode=attack.groundNightMode(target);
  const scout=target.items.some(e=>[10,11].includes(e.type)&&Number(target.master.api_maxeq?.[target.after?.slots?.indexOf(e.id)])>0);
  // The status page has no enemy/route to determine air control. It may show
  // the equipped double-attack reference with explicit conditions, without
  // inventing an air state or changing route-aware recommendation scoring.
  const conditional=conditionalDayDouble&&!profile;
  const taiha=Number(target.ship?.api_maxhp)>0&&Number(target.ship?.api_nowhp)/Number(target.ship.api_maxhp)<=.25;
  const doubleCapable=!carrier&&[3,4,5,6,8,9,10,21].includes(Number(target.master.api_stype))&&!taiha&&scout&&
    target.items.filter(e=>[1,2,3,38].includes(e.type)).length>=2;
  const double=r=>doubleCapable&&(conditional||context?.combatPlanes&&['superiority','supremacy'].includes(context.states.get(r.node)));
  const attacks=rows.map(r=>({target:r.target,label:r.label,node:r.node,
    day:!canDay||carrier&&carrierState!=='ready'?null:attack.groundAttack(target,r,dayBase,{groundBomber,multiplier:double(r)?1.2:1}),dayHits:double(r)?2:1,
    night:surfaceNight?attack.groundAttack(target,r.night,nightBase,{night:true,multiplier:nightMode.multiplier}):null,nightHits:nightMode.hits,
    ...(conditional&&double(r)?{dayConditional:true}:{}),
    ...(hybrid?{nightReference:true}:{})}));
  const line=r=>`${r.label}\n昼战${r.dayHits===2?'连击':''}攻击力：${canDay?`${r.day??'待确认'} × ${r.dayHits}击`:'不可用'}`+
    (surfaceNight?`\n夜战${hybrid?'参考':''}攻击力：${r.night??'待确认'} × ${r.nightHits}击`:'');
  const unknown=[...new Set([...rows.flatMap(r=>r.unknown),...dayBase.reasons,...(nightBase?.reasons||[])])];
  const configuration=groundConfiguration(presentationItems,{carrier,master:target.master});
  const beaching=configuration.beaching,beachingDetail=beaching?
    (beaching.active?'接岸放下跳板，战车突击；优先攻击陆上目标。':`接岸登陆演出被${presentationItems.some(e=>flags(e.master).some(f=>['mortar','mortarConcentrated'].includes(f)))?'迫击炮':'火箭弹'}覆盖；仍优先攻击陆上目标。`)+
      `\n陆战部队：${beaching.units}件${beaching.active?`\n演出战车：${beaching.tanks}辆`:''}\n\n`:'';
  return {key:'ground',label:configuration.label,categories:configuration.categories,state:carrierState==='blocked'?'blocked':unknown.length||carrierState==='unknown'||encountered&&!attacks.length?'unknown':'ready',effects:rows,attacks,detail:require('../../shared/mechanism_text')(
    carrierState==='blocked'?'当前昼战无法发动':carrierState==='unknown'?'发动情况：待确认':'攻击陆上目标时固定生效',
    attacks.length?attacks.map(line):'对地攻击力：待确认',
    [beachingDetail,(attacks.length?'单纵阵／同航战；'+(attacks.some(r=>r.dayHits===2)?
      conditional?'昼战连击需空优／空确，概率发动。':'昼战连击按路线制空估算，概率发动。':carrier?'昼战按航空炮击。':'昼战按普通炮击。'):
      (missingEnemies?'所选路线敌情资料不足，对地攻击力待确认。':'选择路线后显示对应陆上目标的攻击力。'))+
    (configuration.unverifiedMix?'混装演出待确认。':'')+
    (carrier?(hybrid?'速吸改昼间按航空炮击计算，夜战参考普通炮击。':'仅昼间对地炮击。')+(carrierState==='blocked'?'当前昼战配装不可用：需可用对地舰爆，或只带舰攻。':carrierState==='unknown'?'航空槽容量待确认。':''):'')+
    (unknown.length?'\n待确认：'+unknown.join('、'):'')])};
}
const targetCache=new WeakMap();
function groundTarget(name){
  if(/集積地棲姫III.*バカンス|港湾夏姫|泊地水鬼|船渠棲姫/.test(name))return null;
  if(/集積地棲姫/.test(name))return 'supply';
  if(/砲台小鬼|トーチカ/.test(name))return 'pillbox';
  if(/離島棲姫/.test(name))return 'island';
  if(/港湾棲姫|北方棲姫|飛行場姫|集積地夏姫/.test(name))return 'soft';
  return null;
}
const encounterCache=new WeakMap();
function routeGroundEncounters(profile){
  if(!profile)return [];
  if(encounterCache.has(profile))return encounterCache.get(profile);
  const paths=profile.examples?.length?profile.examples:profile.routePaths?.map(p=>p.nodes)||[],ids=new Set(paths.flat()),found=[];
  for(const node of profile.mapPreview?.nodes||[]){
    if(!ids.has(node.id)||node.kind&&!['battle','nightBattle'].includes(node.kind))continue;
    const enemies=[];
    for(const enemy of node.enemies||[]){
      const name=enemy.originalName||enemy.name||'',target=groundTarget(name);
      if(target&&!enemies.some(e=>e.target===target&&e.name===(enemy.name||name)))enemies.push({target,name:enemy.name||name});
    }
    if(enemies.length)found.push({node:node.id,night:node.kind==='nightBattle',targets:[...new Set(enemies.map(e=>e.target))],enemies});
  }
  encounterCache.set(profile,found);return found;
}
function routeGroundTargets(profile){
  if(!profile)return [];
  if(targetCache.has(profile))return targetCache.get(profile);
  const result=[...new Set(routeGroundEncounters(profile).flatMap(n=>n.targets))];targetCache.set(profile,result);return result;
}
// Deliberately bounded power proxy; diminishing returns preserve room for
// ordinary combat gear. This is not a prediction of hits or damage.
function groundPower(items,targets,fire,stype,master={api_stype:stype}){
  const carrier=attack.groundAviation(master,items);
  if(carrier&&carrierGroundState(items)!=='ready')return 0;
  if(!items.some(e=>dedicated(e.master)||carrier&&groundBomber(e.master)))return 0;
  let sum=0;
  for(const key of targets){
    const e=equipmentEffects(items,key,{stype});if(e.status!=='known')continue;
    let raw=((Math.max(0,fire)+5)*e.hullMultiplier+e.hullAddition)*e.multiplier+e.addition;
    if(carrier){const bomb=attack.groundBombingValue(master,items,groundBomber);
      raw=Math.floor((raw+Math.floor(bomb*1.3)+15)*1.5)+25;}
    const power=raw<=220?raw:220+Math.sqrt(raw-220);
    sum+=Math.min(2000,power*e.postMultiplier);
  }
  return sum/Math.max(1,targets.length);
}
function fleetGroundScore(store,scheme,profile,fireFor,options){
  const targets=routeGroundTargets(profile);if(!targets.length)return {bonus:0,targets};
  const context=groundCombatContext(store,scheme,profile,options);
  const powers=scheme.ships.map(entry=>context.score(entry,fireFor?.(entry)).score).sort((a,b)=>b-a);
  return {bonus:powers.reduce((s,p,i)=>s+p*(i<2?1:.35),0),targets,powers};
}

// Compare complete ground loadouts. This is a bounded combat ranking, not a
// prediction of damage: enemy armour, hit rolls and criticals are not simulated.
// Day spotting is weighted by its fixed-condition activation rate and the
// conservative air state at the actual land encounter, including route losses.
function groundCombatContext(store,scheme,profile,{airReference,airEstimate,scoreCache}={}){
  const targets=routeGroundTargets(profile),paths=profile.examples?.length?profile.examples:
    profile.routePaths?.map(p=>p.nodes)||[],ids=new Set(paths.flat());
  const projected=scheme.ships.map(entry=>{
    const ship=store.info.ships[entry.id],master=store.const.$ships[ship.api_ship_id];
    return {id:entry.id,ship,master,before:{slots:ship.api_slot,ex:ship.api_slot_ex},
      after:entry,items:itemsForEntry(store,entry).map(e=>({...e,type:type(e.master)}))};
  });
  const byId=new Map(projected.map(t=>[t.id,t])),air=airPower(store,projected);
  const estimate=airEstimate||(airReference?estimateRouteAir(air,airReference):null);
  const combatPlanes=air.slots.some(s=>s.planes?.[0]>0&&[6,7,8,11,45].includes(s.aircraftType));
  const states=new Map();
  // Every merged path must support the credited spotting opportunity.
  for(const path of estimate?.paths||[])for(const step of path.steps||[]){
    const state=step.before.min>=step.required.supremacy?'supremacy':
      step.before.min>=step.required.superiority?'superiority':'none';
    const old=states.get(step.node);
    states.set(step.node,old==='none'||state==='none'?'none':old==='superiority'||state==='superiority'?'superiority':state);
  }
  const encounters=routeGroundEncounters(profile).map(n=>({...n,state:combatPlanes?states.get(n.node)||'none':'none'}));
  const surfaceNodes=(profile.mapPreview?.nodes||[]).filter(n=>ids.has(n.id)&&n.kind==='battle'&&
    !encounters.some(e=>e.node===n.id)).length;
  const recon=t=>t.items.reduce((s,e)=>s+([10,11].includes(e.type)&&e.planes>0?
    Number(e.master.api_saku||0)*Math.floor(Math.sqrt(e.planes)):0),0);
  const fleetLoS=projected.reduce((s,t)=>{
    const observed=Number(Array.isArray(t.ship.api_sakuteki)?t.ship.api_sakuteki[0]:t.ship.api_sakuteki)||0;
    const old=[...(t.ship.api_slot||[]),t.ship.api_slot_ex].reduce((n,id)=>n+
      Number(store.const.$equips[store.info.equips[id]?.api_slotitem_id]?.api_saku||0),0);
    return s+Math.max(0,observed-old)+recon(t);
  },0);
  const cache=scoreCache||snapshotMemo(store,'groundCombatScores','all',()=>new Map()),airKey=JSON.stringify([combatPlanes,[...states],encounters.map(n=>[n.node,n.night,n.targets]),surfaceNodes]);
  const score=(entry,fallbackFire,{flagship=projected[0]?.id===entry.id}={})=>{
    const original=byId.get(entry.id);
    const key=[entry.id,entry.slots.join(','),entry.ex,fallbackFire,fleetLoS-recon(original),flagship,airKey].join(':');
    if(cache.has(key))return cache.get(key);
    // Ship/loadout damage is independent of route air state and fleet LoS.
    // Reuse it across those contexts, then apply their observation rates below.
    const facts=snapshotMemo(store,'groundAttackFacts',JSON.stringify([entry.id,entry.slots,entry.ex,fallbackFire,flagship]),()=>{
      const target={...original,after:{...entry,slots:entry.slots.slice()},
        items:itemsForEntry(store,entry).map(e=>({...e,type:type(e.master)}))};
      const carrier=attack.groundAviation(target.master,target.items),sub=[13,14].includes(Number(target.master.api_stype));
      const surfaceNight=!carrier||Number(target.master.api_stype)===22;
      const dayBase=attack.fireBase(target,store),nightImprovements=target.items.map(nightCI.nightImprovement);
      const nightBase={...dayBase,value:dayBase.value===null||nightImprovements.includes(null)?null:
        dayBase.value-target.items.reduce((s,e)=>s+(attack.dayImprovement(e)||0),0)+nightImprovements.reduce((a,b)=>a+b,0)};
      // Missing historical intrinsic data must not erase all ranking value. Keep
      // the existing panel-difference fallback private to the heuristic.
      if(dayBase.value===null||nightBase.value===null){
        const raw=items=>items.reduce((s,e)=>s+Number(e.master.api_houg||0),0);
        const observed=Number(Array.isArray(target.ship.api_karyoku)?target.ship.api_karyoku[0]:target.ship.api_karyoku)||0;
        const before=itemsForEntry(store,{id:entry.id});
        const fire=fallbackFire??observed-raw(before)+raw(target.items);
        if(dayBase.value===null)dayBase.value=fire+target.items.reduce((s,e)=>s+(attack.dayImprovement(e)||0),0);
        if(nightBase.value===null)nightBase.value=fire+target.items.reduce((s,e)=>s+(nightCI.nightImprovement(e)||0),0);
      }
      const main=target.items.filter(e=>[1,2,3,38].includes(e.type)).length,
        secondary=target.items.some(e=>e.type===4),ap=target.items.some(e=>e.type===19),
        radar=target.items.some(e=>[12,13,93].includes(e.type));
      const scout=target.items.some(e=>[10,11].includes(e.type)&&e.planes>0);
      const modes=[];
      if(!carrier&&!sub&&scout){
        if(main>=2&&ap)modes.push({multiplier:1.5,hits:1,coefficient:150});
        if(main&&secondary&&ap)modes.push({multiplier:1.3,hits:1,coefficient:140});
        if(main&&secondary&&radar)modes.push({multiplier:1.2,hits:1,coefficient:130});
        if(main&&secondary)modes.push({multiplier:1.1,hits:1,coefficient:120});
        if(main>=2)modes.push({multiplier:1.2,hits:2,coefficient:130});
      }
      const nightMode=attack.groundNightMode(target);
      const nightRate=nightMode.hits===2?1:nightMode.multiplier===1?0:
        nightCI.reading(target,flagship,[{...nightMode,coefficient:main>=3?140:130}],null).rows[0].rate??0;
      const rawLuck=Array.isArray(target.ship.api_lucky)?target.ship.api_lucky[0]:target.ship.api_lucky,
        luck=rawLuck==null?NaN:Number(rawLuck);
      const ready=!carrier||carrierGroundState(target.items)==='ready';
      const gearLoS=target.items.reduce((s,e)=>s+Number(e.master.api_saku||0),0);
      const powers=new Map();
      const powerFor=key=>{
        if(powers.has(key))return powers.get(key);
        const effect=equipmentEffects(target.items,key,{stype:target.master.api_stype}),
          nightEffect=equipmentEffects(target.items,key,{night:true,stype:target.master.api_stype});
        const singleDay=ready&&!sub?attack.groundAttack(target,effect,dayBase,{groundBomber})||0:0;
        const modesPower=modes.map(mode=>(attack.groundAttack(target,effect,dayBase,{groundBomber,multiplier:mode.multiplier})||0)*mode.hits);
        const singleNight=surfaceNight?attack.groundAttack(target,nightEffect,nightBase,{night:true})||0:0;
        const night=surfaceNight?singleNight+nightRate*((attack.groundAttack(target,nightEffect,nightBase,
          {night:true,multiplier:nightMode.multiplier})||0)*nightMode.hits-singleNight):0;
        const value={singleDay,modesPower,night};powers.set(key,value);return value;
      };
      return {target,carrier,sub,dayBase,main,scout,modes,nightMode,luck,gearLoS,powerFor};
    });
    const {target,carrier,sub,dayBase,main,scout,modes,nightMode,luck,gearLoS,powerFor}=facts;
    const saku=Math.max(0,fleetLoS-recon(original)+recon(target)),fleetTerm=Math.floor(Math.sqrt(saku)+saku*.1);
    const probability=(mode,state)=>{
      if(!Number.isFinite(luck)||state==='none')return 0;
      const term=Math.floor(Math.floor(Math.sqrt(Math.max(0,luck))+10)+
        (state==='supremacy'?.7*(fleetTerm+1.6*gearLoS+10):.6*(fleetTerm+1.2*gearLoS)))+(flagship?15:0);
      return Math.min(1,Math.max(0,term/mode.coefficient));
    };
    const attacks=[];let total=0;
    for(const encounter of encounters){
      let encounterPower=0;
      for(const key of encounter.targets){
        const {singleDay,modesPower,night}=powerFor(key);
        let day=singleDay,remaining=1,doubleRate=0;
        for(let i=0;i<modes.length;i++){
          const mode=modes[i],occurrence=remaining*probability(mode,encounter.state);remaining-=occurrence;
          day+=occurrence*(modesPower[i]-singleDay);if(mode.hits===2)doubleRate+=occurrence;
        }
        // Night follow-up is a combat opportunity, not an assumed extra round.
        const power=encounter.night?night:day+night*.65;
        encounterPower+=power<=1000?power:1000+20*Math.sqrt(power-1000);
        attacks.push({node:encounter.node,target:key,day,night,dayDoubleRate:doubleRate,nightHits:nightMode.hits});
      }
      total+=encounterPower/Math.max(1,encounter.targets.length);
    }
    const surface=carrier||sub?0:attack.cap(dayBase.value+5,220)*(main>=2&&scout&&encounters.some(n=>n.state!=='none')?1.5:1);
    const utility=surface*Math.min(1,surfaceNodes/Math.max(1,encounters.length))*.2;
    const result={score:total/Math.max(1,encounters.length)+utility,attacks};
    if(cache.size>=8192)cache.delete(cache.keys().next().value);cache.set(key,result);return result;
  };
  return {targets,score,states,combatPlanes};
}
module.exports={equipmentEffects,groundBadge,groundConfiguration,routeGroundTargets,routeGroundEncounters,groundPower,fleetGroundScore,groundCombatContext,itemsForEntry,dedicated,flags,carrierGroundState,groundBomber};
