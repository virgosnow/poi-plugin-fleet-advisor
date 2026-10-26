'use strict';

// Draft capability checks; selected routes reuse cached air estimates. No game operations.
// Rules checked 2026-10-12 against wikiwiki.jp/kancolle:
// 対潜攻撃#trigger_conditions, 対空砲火/対空カットイン一覧表,
// 戦闘について#Observation/#FAcutin, 発煙装置(煙幕)#SmokeScreen,
// 夜戦#heec6dd0, 対潜攻撃#ASWSynergy, 12cm30連装噴進砲改二#SpecialAttack.
const {projectFleet,asw,speed,speedGroup}=require('../fleet/fleet_metrics');
const {fleetSpecialAttacks}=require('./special_attacks');
const {groundBadge,groundCombatContext,routeGroundTargets}=require('./installation_attack');
const {antiAirBadge,fleetAntiAir,rocketBarrage}=require('./anti_air_cutin');
const nightCI=require('./night_cutin');
const carrierCI=require('./carrier_cutin');
const tooltip=require('../../shared/mechanism_text'),spotting=require('./day_spotting');
const openingPower=require('./opening_attack_power');
const jets=require('./jet_aviation');
const {cap}=require('./attack_power');
const SPEED_LABELS={slow:'低速',fast:'高速',fastPlus:'高速+',fastest:'最速'};
const SPEED_CODES={slow:5,fast:10,fastPlus:15,fastest:20};
const SPEED_GROUPS={fastA:'高速 A 群',fastB1:'高速 B1 群',fastB2:'高速 B2 群',fastC:'高速 C 群',slowA:'低速 A 群',slowB:'低速 B 群',slowSpecialB:'低速特殊 B 群',slowC:'低速 C 群',slowD:'低速 D 群',slowE:'低速 E 群'};
const compact=name=>String(name||'').replace(/\s/g,'').replace(/＋/g,'+');
const named=(name,list)=>list.split('|').some(value=>compact(value)===compact(name));
const mainGun=e=>[1,2,3,38].includes(e.type);
const damaged=(ship,ratio)=>Number(ship.api_maxhp)>0&&Number(ship.api_nowhp)/Number(ship.api_maxhp)<=ratio;
const AIRCRAFT_TYPES=new Set([6,7,8,9,10,11,25,26,41,45,56,57,58,59]);

// Workbench capabilities and counts assume full resupply before sortie.
// undefined = not an aircraft slot; null = unknown capacity; 0 = real zero slot.
function aircraftCapacity(shipMaster,equipmentMaster,slot){
  if(slot==='ex'||!AIRCRAFT_TYPES.has(Number(equipmentMaster?.api_type?.[2])))return undefined;
  const raw=shipMaster?.api_maxeq?.[slot];
  return raw!==undefined&&raw!==null&&Number.isInteger(Number(raw))&&Number(raw)>=0?Number(raw):null;
}

function aircraftSlots(target){
  return target.after.slots.flatMap((id,slot)=>{
    const equipment=target.items.find(e=>e.id===id);if(!equipment)return [];
    const planes=aircraftCapacity(target.master,equipment.master,slot);
    return planes===undefined?[]:[{equipment,slot,planes}];
  });
}

// 航空戦, checked 2026-10-15. Opening airstrikes are
// available to any hull carrying attack aircraft, including seaplane bombers.
// Carrier shelling damage restrictions must not hide its opening capability.
function openingAviation(target,variant,store){
  const all=aircraftSlots(target).filter(({equipment:e})=>[7,8,11,57,58].includes(e.type)&&Number(e.master?.api_type?.[0])!==21);
  const attack=all.filter(({equipment:e})=>variant==='seaplane'?e.type===11:e.type!==11);
  if(!attack.length)return null;
  const live=attack.some(s=>s.planes>0),possible=attack.some(s=>s.planes===null);
  const state=live?'ready':possible?'unknown':'blocked';
  const reason=live?'':possible?'攻击机槽位容量：待确认。':'攻击机槽位容量：0 架；需换槽。';
  const power=openingPower.aviationPowers(target,store,attack,all);
  return {key:'opening-air',label:'开幕航空攻击',variant,state,attacks:power.rows,detail:tooltip(live?'有可用攻击机时固定发动':possible?'发动情况：待确认':'当前无法发动',power.detail,
    [...power.notes,'开幕航空战中攻击敌舰；中大破仍可发动。','按出击前满载；未计损耗、触接与暴击。',reason,...power.reasons])};
}

function nightAttack(target,flagship,store){
  const {ship,master}=target,type=Number(master.api_stype);
  // Carrier night aviation has separate conditions; do not infer it from guns.
  if([7,11,18].includes(type)||Number(master.api_houg?.[0])===0&&Number(master.api_raig?.[0])===0)return null;
  const modes=nightCI.surfaceModes(target);if(!modes.length)return null;
  const double=modes[0].coefficient===null,taiha=damaged(ship,0.25);
  const effect=double||[140,130].includes(modes[0].coefficient)&&!['鱼见电','鱼水电'].includes(modes[0].label)?'shelling':'torpedo';
  const ci=nightCI.reading(target,flagship,modes,nightCI.surfacePower(target,store));
  return {key:'night',label:double?'夜战连击':effect==='shelling'?'夜战炮击 CI':'夜战雷击 CI',effect,state:taiha?'blocked':'ready',ci,detail:
    tooltip.withNotes(ci.detail,taiha?'当前大破，修复后可用。':'',taiha?'发动率：0.0%':null)};
}

function nightAircraftKind(e){
  if(Number(e.master?.api_type?.[0])===21)return null;
  if(({6:45,8:46,7:58})[e.type]===Number(e.master?.api_type?.[3]))return ({6:'fighter',8:'attacker',7:'bomber'})[e.type];
  if(e.type===7&&named(e.master?.api_name,'彗星一二型(三一号光電管爆弾搭載機)'))return 'photo';
  if([7,8].includes(e.type)&&(/^(?:Swordfish|SwordfishMk\.(?:II|III)\(熟練\))$/.test(compact(e.master?.api_name))||/^零戦62型\(爆戦[／/]岩井隊\)$/.test(compact(e.master?.api_name))))return 'auxiliary';
  return null;
}

// Night aviation is distinct from Graf/Swordfish-style ordinary night combat.
// Wiki checked 2026-10-14: 夜戦#CarrierNightAttacks, 夜間作戦航空要員,
// しまね丸改. API icons 45/46/58 identify night fighter/attacker/bomber.
function nightAviation(target,store){
  const {master,items,ship}=target,type=Number(master.api_stype),name=compact(master.api_name);
  const shimane=type===22&&name==='しまね丸改';
  if(![7,11,18].includes(type)&&!shimane)return null;
  const native=shimane||named(name,'Saratoga Mk.II|赤城改二戊|加賀改二戊|龍鳳改二戊|Independence Flight II');
  const crew=items.some(e=>named(e.master?.api_name,'夜間作戦航空要員|夜間作戦航空要員＋熟練甲板員'));
  if(!native&&!crew)return null;
  const planes=aircraftSlots(target).filter(({equipment:e})=>['fighter','attacker','bomber'].includes(nightAircraftKind(e)));
  if(!planes.length)return null;
  const capacity=planes.some(p=>p.planes>0),unknown=!capacity&&planes.some(p=>p.planes===null);
  const healthKnown=Number(ship.api_maxhp)>0&&Number.isFinite(Number(ship.api_nowhp))&&ship.api_nowhp!=null;
  const cannotAttack=damaged(ship,type===18?0.25:0.5);
  const state=cannotAttack||!capacity&&!unknown?'blocked':unknown||!healthKnown?'unknown':'ready';
  const reason=cannotAttack?'当前损伤无法夜间发舰，修复后可用。':
    unknown?'夜间飞机的槽位容量：待确认。':!capacity?'夜间飞机槽位容量：0 架；需换槽。':!healthKnown?'当前损伤状态待确认。':'';
  const power=nightCI.aviationPower(target,planes.map(p=>({...p,kind:nightAircraftKind(p.equipment)})),store);
  const value=!capacity||unknown||power.basePower==null?null:cap(power.basePower,360);
  return {key:'night-air',label:'夜间航空攻击',effect:'aviation',state,attacks:[{label:'夜间航空攻击',power:value,hits:1}],detail:
    tooltip(state==='ready'?'满足夜间发舰条件时固定发动':state==='blocked'?'当前无法发动':'发动情况：待确认',
      `夜间航空攻击\n攻击力：${value??'待确认'} × 1击`,[`不要求空优。需夜间飞机${native?'':'＋夜间要员'}。${reason}`,...power.reasons||[]])};
}

// 夜戦#CarrierNightSpecialAttacks, checked 2026-10-16.
// One aircraft slot is one member of a combination; remaining current planes are ignored.
function carrierNightCutIn(target,aviation,flagship,store){
  if(!aviation)return null;
  const slots=aircraftSlots(target).map(slot=>({...slot,kind:nightAircraftKind(slot.equipment)})).filter(slot=>slot.kind);
  const combinations=rows=>{
    const count=kind=>rows.filter(row=>row.kind===kind).length;
    const f=count('fighter'),a=count('attacker'),b=count('bomber'),p=count('photo'),modes=[];
    if(f>=2&&a)modes.push({label:'夜战×2＋夜攻',multiplier:1.25,hits:1,coefficient:105});
    if(f&&a)modes.push({label:'夜战＋夜攻',multiplier:1.2,hits:1,coefficient:120});
    const mixed=[];
    if(f&&p)mixed.push('夜战＋光电管彗星');
    if(!f&&a&&p)mixed.push('夜攻＋光电管彗星');
    if(f&&b)mixed.push('夜战＋夜爆');
    if(a&&b)mixed.push('夜攻＋夜爆');
    if(b&&p)mixed.push('夜爆＋光电管彗星');
    if(mixed.length)modes.push({label:mixed.join(' / '),multiplier:1.2,hits:1,coefficient:120});
    if(f&&rows.length>=3)modes.push({label:'夜战＋另外两槽夜间机',multiplier:1.18,hits:1,coefficient:130});
    return modes;
  };
  const equipped=combinations(slots);if(!equipped.length)return null;
  const live=combinations(slots.filter(row=>row.planes>0));
  const possible=combinations(slots.filter(row=>row.planes>0||row.planes===null));
  const state=aviation.state==='blocked'||!possible.length?'blocked':aviation.state==='unknown'||!live.length?'unknown':'conditional';
  const modes=live.length?live:possible.length?possible:equipped;
  const reason=state==='blocked'?'当前损伤或槽位容量不满足，需修复／换槽。':state==='unknown'?'容量或损伤资料待确认。':'';
  const capacityKnown=slots.every(s=>s.planes!==null)&&live.length>0;
  const ci=nightCI.reading(target,flagship,modes,capacityKnown?nightCI.aviationPower(target,slots,store):null,{available:capacityKnown,aviation:true});
  return {key:'night-carrier-ci',label:'空母夜袭 CI',effect:'aviation',state,ci,detail:
    tooltip.withNotes(ci.detail,`无需空优；不发动时为普通夜间航空攻击。${reason}`,state==='blocked'?'发动率：0.0%':null)};
}

// 試製 夜間瑞雲(攻撃装備)#nightZuiunCutin, checked 2026-10-14.
function nightZuiunAttack(target,lighting,flagship,store){
  const {master,items,ship}=target;
  if(![3,4,6,10,16].includes(Number(master.api_stype))||items.filter(mainGun).length<2)return null;
  const planes=aircraftSlots(target).filter(({equipment:e})=>e.type===11&&/夜間瑞雲/.test(e.master.api_name||''));
  if(!planes.length)return null;
  const capacity=planes.some(p=>p.planes>0),unknown=!capacity&&planes.some(p=>p.planes===null);
  const healthKnown=Number(ship.api_maxhp)>0&&ship.api_nowhp!=null&&Number.isFinite(Number(ship.api_nowhp));
  const cannotAttack=healthKnown&&damaged(ship,0.5);
  const state=cannotAttack||!capacity&&!unknown?'blocked':unknown||!healthKnown?'unknown':'conditional';
  const reason=cannotAttack?'当前中破或大破，修复后可用。':unknown?'夜间瑞云的槽位容量：待确认。':
    !capacity?'夜间瑞云槽位容量：0 架；需换槽。':!healthKnown?'当前损伤状态待确认。':'';
  const capacityKnown=planes.every(p=>p.planes!==null)&&capacity;
  const ci=nightCI.reading(target,flagship,nightCI.zuiunModes(target,capacityKnown?planes:planes.map(p=>({...p,planes:1}))),
    capacityKnown?nightCI.surfacePower(target,store):null,{zuiun:true,available:capacityKnown});
  return {key:'night-zuiun',label:'夜战瑞云 CI',effect:'shelling',state,ci,detail:
    tooltip.withNotes(ci.detail,`可分散目标并提供照明效果；需未中破。${reason}${lighting?'照明弹／探照灯会降低该 CI 的发动率（未计入）。':''}`,state==='blocked'?'发动率：0.0%':null)};
}

// 九八式水上偵察機(夜偵)#NightContact, checked 2026-10-16.
// API icon 50 identifies all night scouts; ordinary scouts and night Zuiun do not qualify.
function nightContact(target){
  const planes=aircraftSlots(target).filter(({equipment:e})=>e.type===10&&Number(e.master?.api_type?.[3])===50);
  if(!planes.length)return null;
  const live=planes.some(p=>p.planes>0),unknown=planes.some(p=>p.planes===null);
  const state=live?'conditional':unknown?'unknown':'blocked';
  const reason=live?'':unknown?'夜侦槽位容量：待确认。':'夜侦槽位容量：0 架；需换槽。';
  return {key:'night-contact',label:'夜间接触',state,detail:
    tooltip(state==='blocked'?'发动率：0.0%':'发动率：待确认','提高全队夜战攻击力与命中。',
      `昼转夜需空优／空确／空劣，均衡与空丧不可；开幕夜战不限。${reason}`)};
}

function illumination(target){
  const flares=target.items.some(e=>e.type===33),lights=target.items.some(e=>[29,42].includes(e.type));
  if(!flares&&!lights)return null;
  const hp=Number(target.ship.api_nowhp),known=target.ship.api_nowhp!=null&&Number.isFinite(hp);
  const usable=known&&(flares&&hp>4||lights&&hp>1);
  const state=usable?'conditional':known?'blocked':'unknown';
  const effects=[flares?'照明弹：概率提高全队夜战命中和 CI，抑制敌方 CI。':'',
    lights?'探照灯：提供全队夜战辅助，携带舰更易被集火。':''].filter(Boolean);
  if(known&&flares&&hp<=4)effects.push('照明弹耐久门槛：>4。');
  if(known&&lights&&hp<=1)effects.push('探照灯耐久门槛：>1。');
  if(!known)effects.push('当前耐久待确认。');
  return {key:'illumination',label:'照明',state,detail:tooltip([
    flares?`照明弹发动率：${!known?'待确认':hp<=4?'0.0%':'70.0%'}`:'',
    lights?(known&&hp>1?'耐久 >1 时探照灯固定发动':known?'探照灯当前无法发动':'探照灯发动情况：待确认'):''
  ],effects.filter(s=>!s.includes('门槛')&&!s.includes('待确认')),effects.filter(s=>s.includes('门槛')||s.includes('待确认')))};
}

function carrierCutIn(target,flagship,context,store){
  const type=Number(target.master.api_stype);if(![7,11,18].includes(type))return null;
  const slots=aircraftSlots(target);
  const combinations=rows=>{
    return jets.carrierModes(rows.filter(r=>Number(r.equipment.master?.api_type?.[0])!==21).map(r=>r.equipment.type));
  };
  const equipped=combinations(slots);if(!equipped.length)return null;
  const live=combinations(slots.filter(r=>r.planes>0));
  const possible=combinations(slots.filter(r=>r.planes===null||r.planes>0));
  const cannotAttack=damaged(target.ship,type===18?0.25:0.5);
  const modes=live.length?live:possible.length?possible:equipped;
  const state=cannotAttack||!possible.length?'blocked':live.length?'conditional':'unknown';
  const unavailable=equipped.filter(mode=>!live.includes(mode));
  const ci=carrierCI.read(context(),target,flagship,modes,{blocked:state==='blocked',uncertain:live.join('/')!==possible.join('/')});
  const power=carrierCI.attackPowers(target,store,modes);
  return {key:'carrier-ci',label:`战爆联合·${modes[0]}`,state,hint:'需空优',ci,detail:
    tooltip(ci.detail,power.rows.map(r=>`${r.label}\n攻击力：${r.power??'待确认'} × 1击`),
      ['需空优／空确，水面目标。',
       unavailable.length?'槽位容量不满足或待确认：'+unavailable.join(' / '):'',cannotAttack?'当前损伤无法炮击。':'',...power.reasons]),attacks:power.rows};
}

function aswSynergy(target){
  const items=target.items,sonar=items.some(e=>[14,40].includes(e.type));
  // These share API type 15. Neither type 44 (洋上補給) nor equipment ASW
  // values can distinguish a depth charge from its projector or a mortar.
  const depthNames='九五式爆雷|二式爆雷|二式爆雷改二|対潜短魚雷(試作初期型)|Hedgehog(初期型)';
  const projectorNames='九四式爆雷投射機|三式爆雷投射機|三式爆雷投射機改|三式爆雷投射機 集中配備|試製15cm9連装対潜噴進砲|RUR-4A Weapon Alpha改|Mk.32 対潜魚雷(Mk.2落射機)';
  const mortarNames='二式12cm迫撃砲改|二式12cm迫撃砲改 集中配備';
  const weapons=items.filter(e=>e.type===15);
  const depth=weapons.some(e=>named(e.master?.api_name,depthNames));
  const projector=weapons.some(e=>named(e.master?.api_name,projectorNames));
  const mortar=weapons.some(e=>named(e.master?.api_name,mortarNames));
  const groups=[];
  if(sonar&&(projector||depth||mortar)||projector&&depth){
    if(sonar)groups.push(items.some(e=>e.type===14)?'小型声呐':'大型声呐');
    if(projector)groups.push('投射机');if(depth)groups.push('爆雷');if(mortar)groups.push('迫击炮');
    return {key:'asw-synergy',label:'对潜协同',state:'ready',detail:tooltip('本舰可对潜时固定生效',`提高对潜伤害。\n${groups.join('＋')}`,'不代表具备先制对潜。')};
  }
  if(sonar&&weapons.some(e=>!named(e.master?.api_name,depthNames+'|'+projectorNames+'|'+mortarNames)))
    return {key:'asw-synergy',label:'对潜协同',state:'unknown',detail:tooltip('发动情况：待确认','提高对潜伤害；需本舰可对潜。','声呐＋未收录的对潜兵装，协同待确认。')};
  return null;
}

function draftTargets(store,entries){
  const valid=(entries||[]).filter(s=>s&&store.info?.ships?.[s.id]&&store.const?.$ships?.[store.info.ships[s.id].api_ship_id]);
  const plan={organization:{targets:valid.map(s=>s.id)},equipment:{expected:valid.map(s=>({shipId:s.id,state:{slots:s.slots,ex:s.ex}}))}};
  return projectFleet(store,plan);
}

function fleetSpeed(store,entries){
  const targets=draftTargets(store,entries),reading=speed(store,targets);
  const ships=reading.ships.map((s,i)=>{
    const target=targets[i],group=s.group||speedGroup(target);
    const baseCode=Number(target.master.api_soku),baseLabel=SPEED_LABELS[Object.keys(SPEED_CODES).find(k=>SPEED_CODES[k]===baseCode)]||'未知';
    const label=SPEED_LABELS[s.speed]||'速力待确认',boosted=SPEED_CODES[s.speed]>baseCode;
    const engines=new Map();
    for(const e of target.items.filter(e=>[33,34,87].includes(Number(e.instance?.api_slotitem_id)))){
      const star=e.instance?.api_level,name=(e.master?.api_name||'动力装备')+(star==null?' ★待确认':Number(star)>0?' ★'+Number(star):'');
      engines.set(name,(engines.get(name)||0)+1);
    }
    const equipment=[...engines].map(([name,count])=>name+(count>1?' ×'+count:''));
    const attributes=`速度群：${SPEED_GROUPS[group]||'待确认'}`;
    const boost=(boosted||s.status==='unknown')&&equipment.length?'提速装备：'+equipment.join('、'):
      boosted?'提速来源：待确认':'';
    const detail=[attributes,boost,s.status==='unknown'?s.reason:''].filter(Boolean).join('\n\n');
    return {...s,name:target.master.api_name,label,boosted,baseLabel,group:group||null,groupLabel:SPEED_GROUPS[group]||'待确认',boostEquipment:equipment,detail};
  });
  return {...reading,ships,valueLabel:!ships.length?'—':SPEED_LABELS[reading.fleetSpeed]||'待确认',tier:!ships.length?0:({slow:1,fast:2,fastPlus:3,fastest:4})[reading.fleetSpeed]||0,
    label:!ships.length?'速力 —':reading.status==='unknown'?'速力待确认':
    (reading.fleetSpeed==='slow'?'含低速舰':`${SPEED_LABELS[reading.fleetSpeed]}统一`),
    detail:ships.map(s=>`${s.name}：${s.label}\n${s.detail}`).join('\n')};
}

function fleetMechanisms(store,entries,speedReading,profile,{conditionalGroundDouble=false}={}){
  const targets=draftTargets(store,entries),aswRows=asw(store,targets).ships;
  const speedRows=(speedReading||fleetSpeed(store,entries)).ships;
  const specialAttacks=fleetSpecialAttacks(targets,entries,{store});
  const antiAir=fleetAntiAir(targets);
  const lighting=targets.some(target=>target.items.some(e=>[29,33,42].includes(e.type)));
  let observation;
  const carrierContext=()=>observation||(observation=carrierCI.createContext(store,targets,profile,
    {incomplete:(entries||[]).filter(Boolean).length!==targets.length}));
  const groundContext=profile&&routeGroundTargets(profile).length?groundCombatContext(store,
    {ships:targets.map(t=>({id:t.id,...t.after}))},profile,
    {airReference:require('../routes/route_air').routeAirReference({},profile.area,profile)}):null;
  return new Map(targets.map((target,i)=>{
    const badges=[],items=target.items,ship=target.ship;
    // Empty draft positions must not promote the first populated card to flagship.
    const flagship=entries?.[0]?.id===target.id;
    const add=(key,label,state,detail,extra={})=>badges.push({key,label,state,detail,...extra});
    const propulsion=speedRows.find(s=>s.shipId===target.id);
    add('speed',propulsion?.label||'速力待确认',['observed','computed'].includes(propulsion?.status)?'ready':'unknown',
      propulsion?.detail||'缺少速力资料');
    badges[0].tier=SPEED_CODES[propulsion?.speed]/5||0;
    const special=specialAttacks.get(target.id);if(special)badges.push(special);
    const opening=aswRows[i],synergy=aswSynergy(target);
    const aswPower=opening.eligible!==false||synergy?openingPower.aswPower(target,store,{opening:opening.eligible===true}):null;
    const aswArt=[7,11,18].includes(Number(target.master.api_stype))?{effect:'aviation'}:{};
    if(opening.eligible!==false)add('asw','先制对潜',opening.eligible===true?'ready':'unknown',tooltip(
      opening.eligible===true?'满足对潜攻击条件时固定发动':'发动情况：待确认',aswPower.detail,
      ['开幕攻击潜艇；同航战，已计当前配装的对潜协同。',
       opening.threshold!=null?`对潜：${opening.totalAsw??'待确认'}\n门槛：${opening.threshold}${opening.totalAsw==null?'\n'+opening.reason:''}`:opening.reason,...aswPower.reasons||[],aswPower.reason]),{...aswArt,attacks:aswPower.rows});
    if(synergy){const [activation,effect,notes]=synergy.detail.split('\n\n');badges.push({...synergy,attacks:aswPower.rows,
      detail:tooltip(activation,[aswPower.detail,effect],['同航战，显示协同后的整套配装攻击力。',notes,...aswPower.reasons||[],aswPower.reason])});}
    const aaci=antiAirBadge(target,antiAir);if(aaci)badges.push(aaci);
    const ground=groundBadge(target,store,{profile,context:groundContext,conditionalDayDouble:conditionalGroundDouble});
    if(ground){
      const categories=ground.categories;
      badges.push({...ground,label:categories.length>1?'对地·'+categories.map(c=>({landing:'登陆',rocket:'火箭',aircraft:'轰炸'})[c.id]||c.label.replace(/^对地·/,'')).join('／'):categories[0].label,
        variant:categories.length===1?categories[0].id:'combined',state:categories.length===1?categories[0].state||ground.state:ground.state});
    }
    const barrage=rocketBarrage(target,store);if(barrage)badges.push(barrage);
    const torpedo=items.some(e=>e.type===22)||[13,14].includes(Number(target.master.api_stype))&&Number(ship.api_lv)>=10;
    if(torpedo){
      const power=openingPower.torpedoPower(target,store);
      add('torpedo','先制雷击','ready',tooltip('满足先制雷击条件时固定发动',power.detail,
        [(items.some(e=>e.type===22)?'已装备甲标的。':`潜水舰等级：${Number(ship.api_lv)}\n门槛：10。`),'同航战、单纵阵，按完好状态计算。',...power.reasons]),{attacks:[{label:'鱼雷',power:power.power,hits:1}]});
    }
    const smoke=items.filter(e=>/^発煙装置(?:改)?\(煙幕\)$/.test(compact(e.master?.api_name)));
    if(smoke.length)add('smoke','烟幕',targets.length>=4?'conditional':'blocked',tooltip(targets.length>=4?'发动率：待确认':'发动率：0.0%',
      `降低敌我命中。\n本舰数量：${smoke.length} 件\n出击内成功次数：1 次`,`${targets.length<4?'当前不足 4 舰，无法选择阵形和烟幕。':'阵形选择时手动开启。'}开幕夜战和演习不可用。`));
    const light=illumination(target);if(light)badges.push(light);
    const main=items.filter(mainGun).length,secondary=items.some(e=>e.type===4);
    const planes=aircraftSlots(target).filter(x=>[10,11].includes(x.equipment.type));
    if([3,4,5,6,8,9,10,21].includes(Number(target.master.api_stype))&&(main>=2||main>=1&&secondary)&&planes.length){
      // Zero capacity is structural; observed losses do not affect draft tags.
      const live=planes.some(x=>x.planes>0),unknown=!live&&planes.some(x=>x.planes===null);
      const taiha=damaged(ship,0.25);
      const result=spotting.read(target,store,flagship,carrierContext(),{blocked:taiha||!live&&!unknown,uncertain:unknown});
      const double=result.attacks.find(r=>r.hits===2),doubleAttack=double?{power:double.power,hits:2}:null;
      const label=double?(result.attacks.length>1?'昼战连击·CI':'昼战连击'):'弹着 CI';
      add('spotting',label,taiha?'blocked':unknown?'unknown':!live?'blocked':'conditional',result.detail,
        {ci:result.ci,attacks:result.attacks,...doubleAttack?{doubleAttack}:{}});
    }
    for(const variant of ['aircraft','seaplane']){
      const openingAir=openingAviation(target,variant,store);if(openingAir)badges.push(openingAir);
    }
    const jet=jets.assaultBadge(target,store,profile);if(jet)badges.push(jet);
    const carrier=carrierCutIn(target,flagship,carrierContext,store);if(carrier)badges.push(carrier);
    const nightAir=nightAviation(target,store);if(nightAir)badges.push(carrierNightCutIn(target,nightAir,flagship,store)||nightAir);
    const contact=nightContact(target);if(contact)badges.push(contact);
    const nightZuiun=nightZuiunAttack(target,lighting,flagship,store);if(nightZuiun)badges.push(nightZuiun);
    const night=nightAttack(target,flagship,store);if(night)badges.push(night);
    return [target.id,badges];
  }));
}

module.exports={fleetMechanisms,fleetSpeed,aircraftCapacity};
