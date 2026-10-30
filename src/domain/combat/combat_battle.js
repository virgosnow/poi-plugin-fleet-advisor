'use strict';
// Bounded, reproducible battle scenarios for relative pre-sortie comparison.
// Scenario frequencies are NOT observed hit, victory, or retreat probabilities.
// Unknown equipment, engagement, targeting and losses are kept in `reasons`.
// https://wikiwiki.jp/kancolle/戦闘について
const {cap}=require('./attack_power');
const {fromRatio}=require('./combat_balance');
const {enemyOpeningTorpedo,enemyAswPower}=require('./combat_air_asw');
const {projectShip}=require('../fleet/fleet_metrics');
const {nightAviation,carrierNightCutIn}=require('./ship_mechanisms');
const nightCombat=require('./night_cutin');
const {fleetSpecialAttacks}=require('./special_attacks');
const {groundAttackPower}=require('./combat_ground');
const catalog=new Map(require('../../../data/sortie/enemy_catalog.json').enemies.map(e=>[e.apiId,e]));
const CARRIERS=new Set([7,11,18]),BATTLESHIPS=new Set([8,9,10,12]);
const FINITE=n=>Number.isFinite(n)&&n>=0;
const upper=value=>typeof value==='number'?value:FINITE(value?.max)?value.max:null;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const FORMATION={lineAhead:1,doubleLine:.8,diamond:.7,echelon:.75,lineAbreast:.6,
  combinedFirst:.8,combinedSecond:1,combinedThird:.7,combinedFourth:1.1};
const TORPEDO_FORMATION={...FORMATION,combinedFirst:.7,combinedSecond:.9,combinedThird:.6,combinedFourth:1};
const ASW_FORMATION={lineAhead:.6,doubleLine:.8,diamond:1.2,echelon:1.1,lineAbreast:1.3,
  combinedFirst:1.3,combinedSecond:1.1,combinedThird:1,combinedFourth:.7};
const RANGE={'超長+':5,'超長':4,'長':3,'中':2,'短':1,'超短':0,'なし':0};
const LABEL={単縦:'lineAhead',複縦:'doubleLine',輪形:'diamond',梯形:'echelon',単横:'lineAbreast',
  第一警戒航行序列:'combinedFirst',第二警戒航行序列:'combinedSecond',
  第三警戒航行序列:'combinedThird',第四警戒航行序列:'combinedFourth'};
function random(seed=1){
  let s=(Number(seed)>>>0)||0x9e3779b9;
  return ()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return (s>>>0)/4294967296;};
}
function shipType(source){
  const text=source?.shipType||'';
  return {submarine:/潜水/.test(text),carrier:/空母/.test(text),battleship:/戦艦/.test(text),
    installation:/陸上/.test(text),asw:/駆逐|軽巡|雷装巡|海防/.test(text)};
}
function enemyActor(record,index,nodeKind,airReading,combined=false){
  const master=catalog.get(record.apiId),type=shipType(master);
  const hp=upper(record.hp),armor=upper(record.armor),fire=upper(record.fire),torpedo=upper(record.torpedo);
  const airOnly=record.airOnly===true;
  if(record.status!=='known'||!FINITE(hp)||hp===0||airOnly&&nodeKind!=='aerialRaid'||
    !airOnly&&![armor,fire,torpedo].every(FINITE))return null;
  const equip=(master?.equipment||[]).map(e=>e.name||'');
  const name=master?.name||record.name||'';
  const opening=enemyOpeningTorpedo(record,{nodeKind});
  const slotRemaining={};
  for(const attack of airReading?.attacks||[])if(Number.isInteger(attack.slot)&&Number.isInteger(attack.planesMin)&&Number.isInteger(attack.planesMax))
    slotRemaining[attack.slot]=[attack.planesMin,attack.planesMax];
  const asw=enemyAswPower(record,{phase:'shelling',slotRemaining}),nightAsw=enemyAswPower(record,{phase:'night',slotRemaining,nightStart:nodeKind==='nightBattle'||combined});
  const possibleAsw=asw.eligible===true||asw.eligible===null&&(type.asw||type.carrier||type.installation&&!airOnly||/レ級/.test(name));
  // Enemy RE is an intrinsic-ASW exception that attacks submarines at night
  // even if its aircraft are empty. Ordinary plane-only carriers/BBVs do not.
  // The exact nighttime power remains a reference where the source reports a range.
  const reNight=/^戦艦レ級(?:elite)?$/.test(name);
  const nightAswCapable=reNight||type.asw&&nightAsw.eligible!==false;
  const nativeFire=Array.isArray(master?.stats?.火力)?master.stats.火力[0]:master?.stats?.火力;
  const nightCarrier=type.carrier&&(/^(空母ヲ級|軽母ヌ級)(?:改)?flagship/.test(name)||/鬼|姫/.test(name));
  const guns=equip.filter(n=>/砲/.test(n)&&!/副砲/.test(n)).length;
  const secondaries=equip.filter(n=>/副砲/.test(n)).length;
  const torpedoes=equip.filter(n=>/魚雷/.test(n)).length;
  const nightMode=torpedoes>=2?{multiplier:1.5,hits:2,rate:.4}:
    guns+secondaries>=2?{multiplier:1.2,hits:2,rate:.7}:null;
  return {side:'enemy',index,id:record.apiId,name:record.name||name,hp,armor,fire,torpedo,
    range:RANGE[master?.stats?.射程]??null,submarine:type.submarine,carrier:type.carrier,
    battleship:type.battleship,installation:record.kind==='installation'||type.installation,aswCapable:possibleAsw,
    enemyAsw:asw,nightAsw,nightAswCapable,nightCarrier,nightBase:nightCarrier&&FINITE(nativeFire)?nativeFire+torpedo:null,
    openingTorpedo:opening.eligible===true,openingUncertain:opening.status!=='known'&&torpedo>0,
    nightMode,aircraft:upper(record.aircraft),master};
}
function friendlyActor(ship,index){
  if(ship?.status!=='known'||!FINITE(ship.hp)||ship.hp===0||!FINITE(ship.armor))return null;
  const hp=ship.hp,initialHp=FINITE(ship.initialHp)?clamp(ship.initialHp,0,hp):hp;
  return {...ship,side:'own',index,hp,initialHp,carrier:CARRIERS.has(ship.stype),
    battleship:BATTLESHIPS.has(ship.stype),installation:false,
    aswCapable:ship.asw?.status==='known'&&!!ship.asw.normal};
}
// Build night-carrier references from exactly the candidate's ships and gear.
// slotRemaining, when supplied, maps slot indexes to [min,max] or a count.
// Missing losses are ranges, not a claim that all aircraft survived.
function deriveOwnNight(store,entry,{flagship=false,slotRemaining}={}){
  const ship=store?.info?.ships?.[entry?.id],master=store?.const?.$ships?.[ship?.api_ship_id];
  if(!ship||!master||!Array.isArray(entry?.slots))return {status:'unknown',available:null,reasons:['舰娘或配装缺失']};
  if(!CARRIERS.has(Number(master.api_stype)))return {status:'known',available:false,reasons:[]};
  const target=projectShip(store,entry.id,{slots:entry.slots,ex:entry.ex});
  if(target.items.some(item=>!item.master))return {status:'unknown',available:null,reasons:['夜战装备资料缺失']};
  const normalized=String(master.api_name||'').replace(/[\s　]/g,''),names=target.items.map(item=>String(item.master.api_name||''));
  const surfaceNight=/^(GrafZeppelin(?:改)?|Saratoga|加賀改二護|(大鷹|雲鷹|神鷹)改二)$/.test(normalized)||
    /^ArkRoyal(?:改)?$/.test(normalized)&&names.some(name=>/^Swordfish/.test(name));
  if(!Array.isArray(master.api_maxeq))return {status:'unknown',available:null,reasons:['夜间航空槽容量缺失']};
  const sizes=entry.slots.map((id,slot)=>{
    const item=target.items.find(row=>row.id===id),capacity=Number(master.api_maxeq[slot]);
    const category=Number(item?.master?.api_type?.[2]),icon=Number(item?.master?.api_type?.[3]);
    const name=String(item?.master?.api_name||'').normalize('NFKC').replace(/\s/g,'');
    const auxiliary=/^(?:Swordfish|SwordfishMk\.(?:II|III)\(熟練\))$/.test(name)||/^零戦62型\(爆戦[／/]岩井隊\)$/.test(name);
    const nightPlane=category===6&&icon===45||category===8&&icon===46||category===7&&icon===58||
      category===7&&name==='彗星一二型(三一号光電管爆弾搭載機)'||[7,8].includes(category)&&auxiliary;
    if(!nightPlane)return null;
    if(!Number.isInteger(capacity)||capacity<0)return false;
    const reading=slotRemaining?.[slot];
    if(reading===undefined)return [0,capacity];
    const range=Number.isInteger(reading)?[reading,reading]:reading;
    if(!Array.isArray(range)||range.length!==2||!range.every(Number.isInteger)||range[0]<0||range[1]<range[0]||range[1]>capacity)return false;
    return range;
  });
  if(sizes.includes(false))return {status:'unknown',available:null,reasons:['夜间航空槽容量或损耗资料缺失']};
  const view=upper=>({...target,ship:{...ship,api_nowhp:ship.api_maxhp},master:{...master,
    api_maxeq:master.api_maxeq.map((n,i)=>sizes[i]?sizes[i][upper?1:0]:n)}});
  const hi=view(true),lo=view(false),aviation=nightAviation(hi,store);
  if(!aviation||sizes.filter(Array.isArray).every(range=>range[1]===0)){
    if(!surfaceNight)return {status:'known',available:false,reasons:[]};
    const power=nightCombat.surfacePower(hi,store);
    if(!FINITE(power?.basePower))return {status:'unknown',available:null,reasons:['普通空母夜战攻击力资料缺失']};
    return {status:'known',available:true,power:cap(power.basePower,360),mode:'surface',modes:[],reasons:[]};
  }
  const upperPower=aviation.attacks?.[0]?.power;
  if(!FINITE(upperPower))return {status:'unknown',available:null,reasons:['夜间航空攻击力资料不足']};
  const lowAviation=nightAviation(lo,store),lowPower=lowAviation?.attacks?.[0]?.power;
  const minimum=FINITE(lowPower)?lowPower:0;
  const ci=carrierNightCutIn(hi,aviation,!!flagship,store);
  const modes=(ci?.ci?.rows||[]).map(row=>({power:row.power,rate:row.rate,hits:row.hits}));
  const unresolved=modes.some(mode=>!FINITE(mode.power)||!FINITE(mode.rate));
  const ranges=sizes.some(range=>Array.isArray(range)&&range[0]!==range[1]);
  const reasons=[...(ranges?['夜间飞机沿途损耗按范围参考']:[]),...(unresolved?['空母夜袭发动资料待确认']:[])];
  return {status:reasons.length?'partial':'known',available:minimum>0?true:upperPower>0?null:false,
    power:upperPower,powerMin:minimum,powerMax:upperPower,mode:'aviation',modes:unresolved?[]:modes,reasons};
}
// This is a candidate tactic, not a claim about the formation the player will
// choose. The caller must explicitly opt into the exact required formation.
function deriveFleetSpecial(store,entries){
  if(!Array.isArray(entries)||!entries.length||entries.length>6||entries.some(e=>!e?.id))
    return {status:'unknown',available:null,reasons:['舰队编成资料不足']};
  if(entries.some(e=>!store?.info?.ships?.[e.id]||!Array.isArray(e.slots)||
    !store?.const?.$ships?.[store.info.ships[e.id].api_ship_id]))
    return {status:'unknown',available:null,reasons:['舰娘或装备槽资料不足']};
  const targets=entries.map(e=>projectShip(store,e.id,{slots:e.slots,ex:e.ex}));
  if(targets.some(t=>t.items.some(item=>!item.master)))return {status:'unknown',available:null,reasons:['特殊炮击装备资料不足']};
  const badge=fleetSpecialAttacks(targets,entries,{store}).get(entries[0].id);
  if(!badge||badge.state==='blocked')return {status:'known',available:false,reasons:[]};
  if(badge.state!=='conditional'||badge.key!=='special-shelling')
    return {status:'unknown',available:null,reasons:['该特殊攻击的条件或类型尚未接入']};
  const formation={'复纵阵':'doubleLine','梯形阵':'echelon'}[badge.formation];
  const rate=badge.activation?.percent;
  const attacks=(badge.attacks||[]).map(row=>({index:row.position-1,power:row.day,nightPower:row.night,hits:row.hits}));
  if(!formation||!FINITE(rate)||rate>100||!attacks.length||attacks.some(row=>!Number.isInteger(row.index)||row.index<0||row.index>=entries.length||!Number.isInteger(row.hits)||row.hits<1||!FINITE(row.power)))
    return {status:'unknown',available:null,reasons:['特殊炮击阵形、发动率或攻击力待确认']};
  const hpLimits=/^(Nelson|Rodney) Touch$/.test(badge.label)?[[0,.5]]:
    badge.label==='大和三舰齐射'?[[0,.5],[1,.5],[2,.5]]:
    /大和/.test(badge.label)?[[0,.5],[1,.5]]:
    badge.label==='Colorado级齐射'?[[0,.5],[1,.25],[2,.25]]:[[0,.5],[1,.25]];
  const reasons=['按特殊炮击阵形参考，实际须选阵形'];
  if(badge.activation?.reference||badge.activation?.tentative)reasons.push('特殊炮击发动率为参考');
  return {status:badge.activation?.reference||badge.activation?.tentative?'partial':'known',available:true,
    label:badge.label,formation,rate:rate/100,phase:badge.activation.phase,attacks,hpLimits,reasons};
}
function airByShip(readings,index){
  const value=readings?.[index];return value?.attacks||[];
}
function prepareBattle(friendly,enemies,{kind='battle',ownFormation,enemyFormation,ownAir,ownAirSecond,enemyAir,ownNight,includeNight=false,escort=[],special,ground}={}){
  if(!Array.isArray(friendly)||!Array.isArray(enemies)||!Array.isArray(escort)||!friendly.length||!enemies.length||friendly.length>6||enemies.length>6||escort.length>6)
    return {status:'unknown',reasons:['舰队或敌编成资料不完整']};
  if(!['battle','asw','nightBattle','aerialRaid','aerialCombat'].includes(kind))
    return {status:'unknown',reasons:['战斗类型暂不支持']};
  if(escort.length&&kind!=='battle')return {status:'unknown',reasons:['此敌联合战斗类型尚未建模']};
  const combined=escort.length>0,mainCount=enemies.length;
  const allies=friendly.map(friendlyActor),foes=[...enemies,...escort].map((e,i)=>enemyActor(e,i,kind,enemyAir?.[i],combined)),reasons=new Set();
  if(allies.some(s=>!s)||foes.some(s=>!s))return {status:'unknown',reasons:['舰娘或敌舰耐久、装甲、攻击资料不足']};
  // Range affects the first shelling round, not air-only or opening-night
  // nodes. Keep conflicting source evidence visible on the assessment.
  if(kind==='battle'||kind==='asw')for(const foe of foes)if(foe.master?.rangeSourceNote)reasons.add(foe.master.rangeSourceNote);
  for(let i=0;i<allies.length;i++){
    // Night ASW is based on intrinsic ASW; plane-only BBV/CAV/AV/CVL do not
    // inherit their ordinary daytime ASW targeting. Other unusual exceptions
    // remain disclosed as incomplete.
    allies[i].nightAswCapable=[1,2,3,4,21,22].includes(allies[i].stype)&&
      allies[i].asw?.status==='known'&&allies[i].asw.normal&&allies[i].asw.hull>0;
    allies[i].nightAswScratchOnly=kind!=='nightBattle'&&!combined;
    const night=ownNight?.[i];if(!allies[i].carrier||!night)continue;
    if(!['known','partial'].includes(night.status)||![true,false,null].includes(night.available)||night.available!==false&&!FINITE(night.power)){
      reasons.add('己方空母夜战资格或攻击力待确认');continue;
    }
    if(night.status==='partial')reasons.add((night.reasons||[]).join('；')||'己方空母夜战资料部分待确认');
    allies[i].nightCarrier=night.available!==false;allies[i].nightBase=night.power;
    allies[i].nightPowerRange=FINITE(night.powerMin)&&FINITE(night.powerMax)?[night.powerMin,night.powerMax]:null;
    allies[i].nightCarrierMode=night.mode;
    allies[i].nightOptions=night.modes||[];
  }
  // When night-ASW targeting for a particular aircraft-capable hull is not
  // established, use a conservative reference: a surviving submarine diverts
  // that night action and deals at most scratch damage. This is deliberately
  // not a claim that the game always selects this target. A light carrier
  // without night participation has no night action to divert.
  if((kind==='nightBattle'||includeNight)&&foes.some(s=>s.submarine)){
    const candidates=allies.filter(s=>s.asw?.status==='known'&&s.asw.normal&&
      (s.stype===10&&s.asw.hull>0||s.stype===7&&s.nightCarrier));
    if(candidates.length){
      for(const s of candidates){s.nightAswCapable=true;s.nightAswScratchOnly=true;}
      reasons.add('假设轻母或航战夜间被潜艇牵制，对潜仅按擦伤下限参考，可能低估火力');
    }
  }
  const groundIndexes=foes.flatMap((foe,i)=>foe.installation?[i]:[]);
  if(groundIndexes.length&&kind!=='aerialRaid'){
    let incomplete=false;
    for(let i=0;i<allies.length;i++){
      allies[i].ground=Array.isArray(ground?.[i])?ground[i]:[];
      for(const j of groundIndexes){
        const reading=allies[i].ground[j];
        for(const assumption of reading?.assumptions||[])if(assumption.startsWith('假设'))reasons.add(assumption);
        const phases=kind==='nightBattle'?[true]:includeNight?[false,true]:[false];
        if(!reading||phases.some(night=>groundAttackPower(reading,{night}).status==='unknown'||
          night&&allies[i].nightModes?.length&&groundAttackPower(reading,{night:true,special:true}).status==='unknown'))incomplete=true;
      }
    }
    if(incomplete)reasons.add('陆上目标的装备特效或攻击资格待确认');
    if(kind!=='nightBattle'&&allies.some(s=>s.hasAircraft))reasons.add('假设航空开幕对陆上目标伤害为零，可能低估火力');
    if(kind!=='nightBattle')reasons.add('敌方陆基攻击方式按参考估算');
    if(combined)reasons.add('敌联合对地炮击补正待确认');
    if((kind==='nightBattle'||includeNight)&&allies.some(ship=>ship.nightModes?.length))
      reasons.add('对地夜战特殊攻击发动按参考估算');
  }
  if(combined){
    reasons.add(includeNight?'敌联合舰队夜战去向为参考规则，基地航空和特殊攻击尚未计入':'敌联合舰队夜战、基地航空和特殊攻击尚未计入');
    if(allies.some(s=>s.hasAircraft))reasons.add('敌联合舰队航空修正按参考值估算');
  }
  if(allies.some(s=>s.submarine)){
    const readings=foes.flatMap(s=>[
      ...(kind!=='nightBattle'&&s.aswCapable?[s.enemyAsw]:[]),
      ...((kind==='nightBattle'||includeNight)&&s.nightAswCapable?[s.nightAsw]:[])]);
    if(readings.some(r=>r.status==='unknown'||!FINITE(r.powerMin)||!FINITE(r.powerMax)))
      reasons.add('敌方对潜攻击力资料不完整');
    if(readings.some(r=>r.status==='partial'))
      reasons.add('敌方对潜按已知攻击范围参考，夜战擦伤及飞机损耗可能影响结果');
  }
  if(allies.some(s=>s.asw?.status==='unknown')&&foes.some(s=>s.submarine))reasons.add('部分舰娘对潜能力待确认');
  if(allies.some(s=>!FINITE(s.range))||foes.some(s=>!FINITE(s.range)))reasons.add('部分射程未知，按编队顺序估计');
  if(kind!=='nightBattle'&&kind!=='aerialRaid'&&kind!=='aerialCombat'&&foes.some(s=>s.openingUncertain))reasons.add('部分敌舰先制雷击条件待确认');
  if(allies.some(s=>!FINITE(s.fire)||!FINITE(s.torpedo)))reasons.add('部分舰娘火力或雷装待确认');
  if(allies.some(s=>s.hpEstimated))reasons.add('部分舰娘当前耐久未知，暂按满耐久参考');
  if(allies.some(s=>s.condition==null))reasons.add('部分舰娘士气未知，轰沉保护按普通状态参考');
  if(!enemyFormation)reasons.add('敌方阵形未知，按单纵阵参考');
  if(kind!=='nightBattle'&&allies.some(s=>s.carrier&&s.armedCarrier&&!FINITE(s.carrierRaw)))reasons.add('舰娘空母炮击威力待确认');
  if(kind==='nightBattle'&&allies.some(s=>!s.carrier&&!FINITE(s.nightBase)))reasons.add('部分舰娘夜战攻击力按面板参考');
  if((kind==='nightBattle'||includeNight)&&allies.some(s=>s.carrier&&!ownNight?.[s.index]))reasons.add('己方空母夜战和夜间航空攻击尚未完整计入');
  if(includeNight&&!combined&&(allies.some(s=>s.submarine)||foes.some(s=>s.submarine)))reasons.add('昼转夜对潜按擦伤参考');
  if(kind!=='nightBattle'){
    if(foes.some(s=>s.carrier))reasons.add('敌方空母满载炮击及损伤按参考估算');
    for(let i=0;i<allies.length;i++)if(allies[i].hasAircraft&&(!ownAir?.[i]||ownAir[i].status!=='known'))reasons.add('己方航空攻击或沿途载机损耗待确认');
    for(const reading of [...(ownAir||[]),...(ownAirSecond||[])])for(const reason of reading?.reasons||[])
      if(reason.startsWith('假设'))reasons.add(reason);
    if(kind==='aerialCombat'&&!ownAirSecond)reasons.add('假设第二轮航空损耗按第一轮参考');
    const participating=combined?mainCount:foes.length;
    for(let i=0;i<participating;i++)if(foes[i].aircraft>0&&(!enemyAir?.[i]||enemyAir[i].status!=='known'))reasons.add('敌方航空攻击或载机损耗待确认');
  }
  const own=ownFormation||((kind==='asw'||foes.every(s=>s.submarine))?'lineAbreast':'lineAhead');
  const enemy=LABEL[enemyFormation]||enemyFormation||'lineAhead';
  if(!FORMATION[own]||!FORMATION[enemy])return {status:'unknown',reasons:['阵形资料未支持']};
  const specialValid=special?.available===true&&['known','partial'].includes(special.status)&&
    FINITE(special.rate)&&special.rate<=1&&Array.isArray(special.attacks)&&special.attacks.length>0&&special.attacks.length<=3&&
    special.attacks.every(row=>Number.isInteger(row.index)&&row.index>=0&&row.index<allies.length&&FINITE(row.power)&&Number.isInteger(row.hits)&&row.hits>=1&&row.hits<=3)&&
    Array.isArray(special.hpLimits)&&special.hpLimits.every(row=>Array.isArray(row)&&row.length===2&&Number.isInteger(row[0])&&row[0]>=0&&row[0]<allies.length&&FINITE(row[1])&&row[1]<=1);
  const specialEnabled=!!ownFormation&&specialValid&&own===special.formation&&!groundIndexes.length;
  if(special?.available===true&&!specialEnabled)reasons.add('特殊炮击未计入：未明确选择其发动阵形或资料不足');
  if(specialEnabled){
    for(const reason of special.reasons||[])reasons.add(reason);
    reasons.add('特殊炮击参与舰受损和发动顺序按参考估算');
    if((kind==='nightBattle'||includeNight)&&special.phase==='day-night'&&special.attacks.some(row=>!FINITE(row.nightPower)))
      reasons.add('特殊炮击夜战攻击力待确认');
  }
  return {status:reasons.size?'partial':'estimated',kind,allies,foes,combined,mainCount,includeNight:!!includeNight,
    enemyMain:foes.slice(0,mainCount),enemyEscort:foes.slice(mainCount),ownFormation:own,enemyFormation:enemy,special:specialEnabled?special:null,
    ownAir,ownAirSecond,enemyAir,reasons:[...reasons],assumptions:['按出击前补给及当前耐久',
      ...(!ownFormation?[`己方阵形尚未选择，按${own==='lineAbreast'?'单横':'单纵'}阵参考`]:[]),
      `未计支援、基地航空队与弹着观测${specialEnabled?'':'、特殊炮击'}`,
      '固定参考命中与交战条件；仅作相对比较，不是实际胜率或撤退率','航空损耗区间取中间架数参考，不代表实际损耗概率',
      '敌舰夜战发动与未确认机制为参考假设']};
}
function pick(list,rng){return list[Math.min(list.length-1,Math.floor(rng()*list.length))];}
function isSevere(actor,hp){return hp<=actor.hp*.25;}
function medium(actor,hp){return hp<=actor.hp*.5;}
function canAct(actor,hp,phase){
  if(hp<=0)return false;
  if((phase==='night'||phase==='nightAsw')&&isSevere(actor,hp))return false;
  if(phase==='night'&&actor.side==='own'&&actor.carrier&&actor.nightCarrierMode!=='surface'&&actor.stype!==18&&medium(actor,hp))return false;
  if(phase==='torpedo'&&medium(actor,hp))return false;
  if(phase==='openingTorpedo'&&isSevere(actor,hp))return false;
  if(phase==='shelling'&&actor.carrier&&(actor.stype===18?isSevere(actor,hp):medium(actor,hp)))return false;
  return true;
}
function targetPool(actor,other,otherHp,phase){
  const living=other.map((s,i)=>({s,i})).filter(x=>otherHp[x.i]>0);
  if(phase==='air')return living.filter(x=>!x.s.submarine&&(actor.side==='own'||!x.s.installation));
  if(phase==='torpedo'||phase==='openingTorpedo')return living.filter(x=>!x.s.submarine&&!x.s.installation);
  if(phase==='openingAsw'||phase==='asw'||phase==='nightAsw')return living.filter(x=>x.s.submarine);
  if(phase==='night'){
    const subs=living.filter(x=>x.s.submarine);
    if(actor.nightAswCapable&&subs.length)return subs;
    return living.filter(x=>!x.s.submarine&&(!x.s.installation||actor.side==='own'&&actor.ground?.[x.i]?.night?.eligible!==false));
  }
  const subs=living.filter(x=>x.s.submarine);
  if(subs.length&&actor.aswCapable)return subs;
  return living.filter(x=>!x.s.submarine&&(!x.s.installation||actor.side==='own'&&actor.ground?.[x.i]?.day?.eligible!==false));
}
// Approximate protection on lethal normal hits, not a simulation of red
// fatigue, damage-control equipment or a promise against sinking.
function applyDamage(actor,hp,damage,rng){
  if(damage<=0||hp<=0)return hp;
  if(actor.side==='own'&&damage>=hp){
    if(actor.index>0&&actor.condition!==null&&actor.condition<=19)return 1;
    const protectedDamage=Math.floor(hp*.5)+Math.floor(rng()*hp*.3);
    return Math.max(1,hp-protectedDamage);
  }
  return Math.max(0,hp-damage);
}
function scenarioPower(actor,hp,phase,formation,rng,adjust=0){
  if(phase==='openingAsw'||phase==='asw'||phase==='nightAsw'){
    if(actor.side==='enemy'){
      const reading=phase==='nightAsw'?actor.nightAsw:actor.enemyAsw;
      if(reading?.status==='unknown'||!FINITE(reading?.powerMin)||!FINITE(reading?.powerMax))return null;
      if(reading.eligible===false)return 0;
      const base=FINITE(reading.referencePower)?reading.referencePower:rng()<.5?reading.powerMin:reading.powerMax;
      if(phase==='nightAsw'&&base===0)return {power:0,hits:1}; // day-to-night: scratch damage
      return cap(base*(ASW_FORMATION[formation]||.6)*(medium(actor,hp)?.7:1),170);
    }
    if(actor.asw?.status!=='known')return null;
    if(phase==='openingAsw'?!actor.asw.opening:!actor.asw.normal)return 0;
    if(phase==='nightAsw'&&actor.nightAswScratchOnly)return {power:0,hits:1};
    const damageMultiplier=medium(actor,hp)?.7:1;
    return cap(actor.asw.power*(ASW_FORMATION[formation]||.6)*damageMultiplier,170);
  }
  if(phase==='openingTorpedo'&&!actor.openingTorpedo)return 0;
  if(phase==='torpedo'||phase==='openingTorpedo'){
    if(actor.carrier||!FINITE(actor.torpedo))return actor.carrier?0:null;
    if(phase==='torpedo'&&actor.side==='enemy'&&actor.torpedo===0)return 0;
    if(phase==='torpedo'&&actor.side==='own'&&(!FINITE(actor.intrinsicTorpedo)||actor.intrinsicTorpedo===0))return FINITE(actor.intrinsicTorpedo)?0:null;
    const base=FINITE(actor.torpedoRaw)?actor.torpedoRaw:actor.torpedo+5;
    return cap(Math.max(0,base+adjust)*(TORPEDO_FORMATION[formation]||1)*(medium(actor,hp)?.8:1),180);
  }
  if(phase==='night'){
    if(actor.carrier&&!actor.nightCarrier)return 0;
    const base=FINITE(actor.nightBase)?actor.nightBase:FINITE(actor.fire)&&FINITE(actor.torpedo)?actor.fire+actor.torpedo:null;
    if(base===null)return null;
    const damageMultiplier=medium(actor,hp)?.7:1;
    if(actor.side==='own'&&actor.carrier){
      if(actor.nightPowerRange&&rng()<.5){
        if(actor.nightPowerRange[0]===0)return 0;
        return {power:Math.floor(actor.nightPowerRange[0]*damageMultiplier),hits:1};
      }
      for(const option of actor.nightOptions||[]){
        if(!FINITE(option.power)||!FINITE(option.rate))return null;
        if(rng()<option.rate)return {power:Math.floor(option.power*damageMultiplier),hits:option.hits||1};
      }
      return {power:Math.floor(base*damageMultiplier),hits:1};
    }
    let mode=actor.nightMode;
    if(actor.side==='own'&&actor.nightModes?.length){
      const raw=actor.nightModes[0],fixed=actor.nightFixed?.term;
      mode={multiplier:raw.multiplier,hits:raw.hits,rate:raw.coefficient&&FINITE(fixed)?clamp((fixed+(actor.index===0?15:0))/raw.coefficient,0,1):raw.coefficient?.4:.7};
    }
    const activated=mode&&rng()<mode.rate;
    return {power:cap(base*damageMultiplier*(activated?mode.multiplier:1),360),hits:activated?(typeof mode.hits==='number'?mode.hits:1+(rng()<.5?1:0)):1};
  }
  if(phase==='shelling'){
    if(actor.submarine)return 0;
    if(actor.carrier&&actor.side==='own'&&!actor.armedCarrier)return 0;
    // The enemy catalogue's equipped carrier fire value is already the
    // shelling basic power (e.g. Nu-class 65), including the +55 constant.
    const base=actor.carrier?(actor.side==='own'?actor.carrierRaw:actor.fire):FINITE(actor.fire)?actor.fire+5:null;
    if(!FINITE(base))return null;
    const damageMultiplier=isSevere(actor,hp)?.4:medium(actor,hp)?.7:1;
    // Carrier combined correction is inside the 1.5 carrier multiplier.
    // The imported enemy/base number is already floored, so a +5 friendly
    // correction can differ by one from a fully reconstructed expression.
    const adjusted=actor.carrier?Math.floor(base+adjust*1.5):base+adjust;
    return cap(Math.max(0,adjusted)*(FORMATION[formation]||1)*damageMultiplier,220);
  }
  return 0;
}
function hitDamage(power,defender,rng,ammo=1,asw=false,penetration=0,currentHp=defender.hp){
  if(!FINITE(power))return null;
  const armor=Math.max(asw?1:0,defender.armor-penetration),defense=armor*.7+Math.floor(armor*rng())*.6;
  const raw=Math.floor((power-defense)*clamp(ammo,0,1));
  if(raw>0)return raw;
  // Wiki 戦闘について: when armor blocks a hit, percentage scratch damage
  // is based on remaining HP, ignores ammo penalty and cannot sink a ship.
  if(!FINITE(currentHp)||currentHp<=0)return 0;
  return Math.min(Math.max(0,currentHp-1),Math.floor(currentHp*.06+Math.floor(currentHp*rng())*.08));
}
// The reported main/escort night-selection rule has documented exceptions;
// it is a reference, never a proven guarantee of reaching the flagship.
function combinedNightTarget(main,escort,mainHp,escortHp){
  if(!mainHp.some(hp=>hp>0))return 'escort';
  if(!escortHp.some(hp=>hp>0))return 'main';
  const score=(escortHp[0]>0?1:0)+escort.reduce((sum,ship,i)=>
    sum+(escortHp[i]>ship.hp*.5?1:escortHp[i]>ship.hp*.25?.7:0),0);
  return score>=3?'escort':'main';
}
// Run a single scenario. `initialHp` allows the caller to propagate damage
// between route nodes. Enemies always start at full HP on every new node.
function runScenario(prepared,rng=random(1),{initialHp,ammo=1,trace,specialUsed=false}={}){
  if(!prepared||prepared.status==='unknown')return {status:'unknown'};
  const own=prepared.allies,enemy=prepared.foes;
  if(initialHp&&(!Array.isArray(initialHp)||initialHp.length!==own.length||initialHp.some((v,i)=>!FINITE(v)||v>own[i].hp)))return {status:'unknown'};
  const ohp=own.map((s,i)=>initialHp?initialHp[i]:s.initialHp),ehp=enemy.map(s=>s.hp),damageByEnemy=enemy.map(()=>0);
  // Normal sortie policy does not progress from an already-severely damaged
  // fleet. Preserve its HP and leave this node unvisited for route callers.
  if(own.some((s,i)=>isSevere(s,ohp[i])))return {status:'estimated',ownHp:ohp,enemyHp:ehp,
    ...(prepared.combined?{enemyMainHp:ehp.slice(0,prepared.mainCount),enemyEscortHp:ehp.slice(prepared.mainCount)}:{}),severe:true,stopped:true,
    specialUsed:!!specialUsed,damageByEnemy,enemyLost:0,ownLost:own.reduce((n,s,i)=>n+(s.hp-ohp[i])/s.hp,0)/own.length};
  let partial=false,stage='',nightTarget=null;
  const fire=(attacker,attackerHp,defenders,defenderHp,phase,formation,power,record,selectionHp=defenderHp)=>{
    const targets=targetPool(attacker,defenders,selectionHp,phase);
    if(!targets.length||!canAct(attacker,attackerHp,phase))return;
    const target=pick(targets,rng);
    // Aircraft-to-installation damage is not yet modelled. Count this as a
    // wasted launch rather than retargeting a surface ship or fabricating
    // installation damage, making the reference explicitly conservative.
    if(phase==='air'&&attacker.side==='own'&&target.s.installation)return;
    let adjust=0;
    if(prepared.combined){
      if(phase==='shelling')adjust=attacker.side==='own'?5:attacker.index<prepared.mainCount?10:-5;
      else if(phase==='torpedo'||phase==='openingTorpedo')adjust=10;
    }
    let p;
    if(target.s.installation&&attacker.side==='own'&&(phase==='shelling'||phase==='night')){
      const reading=attacker.ground?.[target.i],night=phase==='night';
      let special=false;
      if(night&&attacker.nightModes?.length){
        const mode=attacker.nightModes[0],fixed=attacker.nightFixed?.term;
        const rate=mode.coefficient&&FINITE(fixed)?clamp((fixed+(attacker.index===0?15:0))/mode.coefficient,0,1):mode.coefficient?.4:.7;
        special=rng()<rate;
      }
      const damage=isSevere(attacker,attackerHp)?.4:medium(attacker,attackerHp)?.7:1;
      const result=groundAttackPower(reading,{night,formation:night?1:FORMATION[formation],damage,special});
      if(result.status==='blocked')return;
      if(result.status!=='known'){partial=true;return;}
      p={power:result.power,hits:result.hits};
    }else p=power??scenarioPower(attacker,attackerHp,phase,formation,rng,adjust);
    // Combined-fleet aviation has different power terms against main/escort.
    // The per-slot input is already capped, so the correction is approximate.
    if(prepared.combined&&phase==='air'&&attacker.side==='own'&&FINITE(p))p=Math.max(0,p-(target.i<prepared.mainCount?10:20));
    if(p===null||p===undefined){partial=true;return;}
    if(p===0)return;
    if(Array.isArray(trace))trace.push({stage,phase,side:attacker.side,attacker:attacker.index,
      target:target.i,targetGroup:attacker.side==='own'&&prepared.combined?
        (target.i<prepared.mainCount?'main':'escort'):null});
    const spec=typeof p==='object'?p:{power:p,hits:1};
    if(!FINITE(spec.power)){partial=true;return;}
    for(let hit=0;hit<(spec.hits||1)&&defenderHp[target.i]>0;hit++){
      // Fixed reference hit chance, deliberately not a predicted actual rate.
      if(rng()>=.75)continue;
      const isAsw=phase==='asw'||phase==='openingAsw'||phase==='nightAsw';
      const before=defenderHp[target.i],value=hitDamage(spec.power,target.s,rng,attacker.side==='own'?ammo:1,isAsw,isAsw?(attacker.asw?.penetration||0):0,before);
      defenderHp[target.i]=applyDamage(target.s,before,value,rng);
      if(record!==undefined)damageByEnemy[record]+=before-defenderHp[target.i];
    }
  };
  const ownAttack=(i,phase,power)=>fire(own[i],ohp[i],enemy,ehp,phase,prepared.ownFormation,power);
  const enemyAttack=(i,phase,power)=>fire(enemy[i],ehp[i],own,ohp,phase,prepared.enemyFormation,power,i);
  let firedSpecial=!!specialUsed;
  const ownTurn=(i,phase,selection=()=>ehp)=>{
    const spec=prepared.special,night=phase==='night';
    const phaseAllowed=night?spec?.phase==='day-night':phase==='shelling'&&spec?.phase!=='night';
    if(i===0&&!firedSpecial&&spec&&phaseAllowed&&canAct(own[0],ohp[0],phase)&&
      spec.hpLimits.every(([idx,fraction])=>ohp[idx]>own[idx].hp*fraction)&&
      spec.attacks.every(row=>ohp[row.index]>0)&&rng()<spec.rate){
      const eligible=night?spec.attacks.every(row=>FINITE(row.nightPower)):true;
      if(eligible){
        firedSpecial=true;
        for(const attack of spec.attacks)for(let hit=0;hit<attack.hits;hit++){
          const power=night?attack.nightPower:attack.power;
          fire(own[attack.index],ohp[attack.index],enemy,ehp,phase,prepared.ownFormation,power,undefined,selection());
        }
        return;
      }
      partial=true;
    }
    fire(own[i],ohp[i],enemy,ehp,phase,prepared.ownFormation,undefined,undefined,selection());
  };
  const air=(ownAir=prepared.ownAir)=>{
    // Aircraft stages are simultaneous: build and resolve the launch list
    // before using any damage to decide which slots were launched.
    const launches=[];
    if(prepared.kind!=='aerialRaid')for(let i=0;i<own.length;i++)for(const p of airByShip(ownAir,i))launches.push({side:'own',i,p});
    const enemyLaunchers=prepared.combined?prepared.mainCount:enemy.length;
    for(let i=0;i<enemyLaunchers;i++)for(const p of airByShip(prepared.enemyAir,i))launches.push({side:'enemy',i,p});
    const ownBefore=ohp.slice(),enemyBefore=ehp.slice(),ownAfter=ohp.slice(),enemyAfter=ehp.slice();
    for(const launch of launches){
      const p=launch.p,lo=p.powerMin,hi=p.powerMax;if(!FINITE(lo)||!FINITE(hi)){partial=true;continue;}
      // Aircraft loss intervals are bounds, not a two-point distribution.
      // Friendly and enemy aircraft both use the midpoint-count reference;
      // a carrier torpedo may still have its two distinct attack-power modes.
      const ref=p.referencePowers;
      const attack=Array.isArray(ref)&&ref.length&&ref.every(FINITE)?pick(ref,rng):rng()<.5?lo:hi;
      if(launch.side==='own')fire(own[launch.i],ownBefore[launch.i],enemy,enemyAfter,'air',prepared.ownFormation,attack,undefined,enemyBefore);
      else fire(enemy[launch.i],enemyBefore[launch.i],own,ownAfter,'air',prepared.enemyFormation,attack,launch.i,ownBefore);
    }
    ohp.splice(0,ohp.length,...ownAfter);ehp.splice(0,ehp.length,...enemyAfter);
  };
  if(prepared.kind==='nightBattle'){
    stage='night';
    const rounds=Math.max(own.length,enemy.length);
    for(let i=0;i<rounds;i++){
      if(i<own.length){const phase=targetPool(own[i],enemy,ehp,'night')[0]?.s.submarine?'nightAsw':'night';ownTurn(i,phase);}
      if(i<enemy.length){const phase=targetPool(enemy[i],own,ohp,'night')[0]?.s.submarine?'nightAsw':'night';enemyAttack(i,phase);}
    }
  }else{
    stage='air';air();if(prepared.kind==='aerialCombat'){stage='air2';air(prepared.ownAirSecond||prepared.ownAir);}
    if(prepared.kind!=='aerialRaid'&&prepared.kind!=='aerialCombat'){
      stage='openingAsw';
      const escortOnly=hp=>hp.map((v,i)=>i>=prepared.mainCount?v:0);
      const mainOnly=hp=>hp.map((v,i)=>i<prepared.mainCount?v:0);
      // Opening ASW attacks occur in range order, not fleet slot order.
      const openingOrder=own.map((s,i)=>({i,range:s.range??0})).sort((a,b)=>b.range-a.range||a.i-b.i);
      for(const {i} of openingOrder){
        if(prepared.combined)fire(own[i],ohp[i],enemy,ehp,'openingAsw',prepared.ownFormation,undefined,undefined,escortOnly(ehp));
        else ownAttack(i,'openingAsw');
      }
      // The actual opening torpedoes are simultaneous. A snapshot of both
      // sides' HP determines eligibility for both volleys.
      stage='openingTorpedo';
      const ownBefore=ohp.slice(),enemyBefore=ehp.slice(),ownAfter=ohp.slice(),enemyAfter=ehp.slice();
      for(let i=0;i<own.length;i++)fire(own[i],ownBefore[i],enemy,enemyAfter,'openingTorpedo',prepared.ownFormation,undefined,undefined,enemyBefore);
      for(let i=0;i<enemy.length;i++)fire(enemy[i],enemyBefore[i],own,ownAfter,'openingTorpedo',prepared.enemyFormation,undefined,i,ownBefore);
      ohp.splice(0,ohp.length,...ownAfter);ehp.splice(0,ehp.length,...enemyAfter);
      const ordered=(actors,start=0)=>actors.map((s,i)=>({i:i+start,range:s.range??0})).sort((a,b)=>b.range-a.range||a.i-b.i);
      if(prepared.combined){
        const a=ordered(own),escortOrder=ordered(prepared.enemyEscort,prepared.mainCount),mainOrder=ordered(prepared.enemyMain);
        const shell=(order,select,label)=>{
          stage=label;const n=Math.max(a.length,order.length);
          for(let j=0;j<n;j++){
            if(!select(ehp).some(hp=>hp>0))break;
            if(j<a.length){const i=a[j].i,eligible=select(ehp),phase=targetPool(own[i],enemy,eligible,'shelling')[0]?.s.submarine?'asw':'shelling';
              ownTurn(i,phase,()=>select(ehp));}
            if(j<order.length){const i=order[j].i,phase=targetPool(enemy[i],own,ohp,'shelling')[0]?.s.submarine?'asw':'shelling';enemyAttack(i,phase);}
          }
        };
        // Against an enemy combined fleet the escort shelling precedes the
        // simultaneous torpedo phase, followed by main shelling. The second
        // main round may target either surviving enemy component.
        shell(escortOrder,escortOnly,'escortShell');
        stage='torpedo';
        const beforeOwn=ohp.slice(),beforeEnemy=ehp.slice(),afterOwn=ohp.slice(),afterEnemy=ehp.slice();
        for(let i=0;i<own.length;i++)fire(own[i],beforeOwn[i],enemy,afterEnemy,'torpedo',prepared.ownFormation,undefined,undefined,beforeEnemy);
        for(let i=prepared.mainCount;i<enemy.length;i++)fire(enemy[i],beforeEnemy[i],own,afterOwn,'torpedo',prepared.enemyFormation,undefined,i,beforeOwn);
        ohp.splice(0,ohp.length,...afterOwn);ehp.splice(0,ehp.length,...afterEnemy);
        shell(mainOrder,mainOnly,'mainShell');
        if(own.some(s=>s.battleship)||enemy.some(s=>s.battleship)){
          stage='secondShell';
          for(let i=0;i<Math.max(own.length,prepared.mainCount);i++){
            if(i<own.length){const phase=targetPool(own[i],enemy,ehp,'shelling')[0]?.s.submarine?'asw':'shelling';ownTurn(i,phase);}
            if(i<prepared.mainCount){const phase=targetPool(enemy[i],own,ohp,'shelling')[0]?.s.submarine?'asw':'shelling';enemyAttack(i,phase);}
          }
        }
        if(prepared.includeNight){
          nightTarget=combinedNightTarget(prepared.enemyMain,prepared.enemyEscort,
            ehp.slice(0,prepared.mainCount),ehp.slice(prepared.mainCount));
          const select=nightTarget==='main'?mainOnly:escortOnly;
          const start=nightTarget==='main'?0:prepared.mainCount;
          const size=nightTarget==='main'?prepared.mainCount:enemy.length-prepared.mainCount;
          stage='night';
          for(let i=0;i<Math.max(own.length,size);i++){
            if(i<own.length){const phase=targetPool(own[i],enemy,select(ehp),'night')[0]?.s.submarine?'nightAsw':'night';ownTurn(i,phase,()=>select(ehp));}
            if(i<size){const id=start+i,phase=targetPool(enemy[id],own,ohp,'night')[0]?.s.submarine?'nightAsw':'night';enemyAttack(id,phase);}
          }
        }
      }else{
      const a=ordered(own),b=ordered(enemy),n=Math.max(a.length,b.length);
      stage='shelling';
      for(let j=0;j<n;j++){
        if(j<a.length){const i=a[j].i,phase=targetPool(own[i],enemy,ehp,'shelling')[0]?.s.submarine?'asw':'shelling';ownTurn(i,phase);}
        if(j<b.length){const i=b[j].i,phase=targetPool(enemy[i],own,ohp,'shelling')[0]?.s.submarine?'asw':'shelling';enemyAttack(i,phase);}
      }
      if(own.some(s=>s.battleship)||enemy.some(s=>s.battleship))for(let i=0;i<Math.max(own.length,enemy.length);i++){
        stage='secondShell';
        if(i<own.length){const phase=targetPool(own[i],enemy,ehp,'shelling')[0]?.s.submarine?'asw':'shelling';ownTurn(i,phase);}
        if(i<enemy.length){const phase=targetPool(enemy[i],own,ohp,'shelling')[0]?.s.submarine?'asw':'shelling';enemyAttack(i,phase);}
      }
      stage='torpedo';
      const beforeOwn=ohp.slice(),beforeEnemy=ehp.slice(),afterOwn=ohp.slice(),afterEnemy=ehp.slice();
      for(let i=0;i<own.length;i++)fire(own[i],beforeOwn[i],enemy,afterEnemy,'torpedo',prepared.ownFormation,undefined,undefined,beforeEnemy);
      for(let i=0;i<enemy.length;i++)fire(enemy[i],beforeEnemy[i],own,afterOwn,'torpedo',prepared.enemyFormation,undefined,i,beforeOwn);
      ohp.splice(0,ohp.length,...afterOwn);ehp.splice(0,ehp.length,...afterEnemy);
      if(prepared.includeNight){
        stage='night';
        for(let i=0;i<Math.max(own.length,enemy.length);i++){
          if(i<own.length){const phase=targetPool(own[i],enemy,ehp,'night')[0]?.s.submarine?'nightAsw':'night';ownTurn(i,phase);}
          if(i<enemy.length){const phase=targetPool(enemy[i],own,ohp,'night')[0]?.s.submarine?'nightAsw':'night';enemyAttack(i,phase);}
        }
      }
      }
    }
  }
  const severe=own.some((s,i)=>isSevere(s,ohp[i]));
  return {status:partial?'partial':'estimated',ownHp:ohp,enemyHp:ehp,
    ...(prepared.combined?{enemyMainHp:ehp.slice(0,prepared.mainCount),enemyEscortHp:ehp.slice(prepared.mainCount),nightTarget}:{}),severe,specialUsed:firedSpecial,
    damageByEnemy,enemyLost:enemy.reduce((n,s,i)=>n+(s.hp-ehp[i])/s.hp,0)/enemy.length,
    ownLost:own.reduce((n,s,i)=>n+(s.hp-ohp[i])/s.hp,0)/own.length};
}
function evaluateBattle(friendly,enemies,{samples=16,seed=1,...options}={}){
  const prepared=prepareBattle(friendly,enemies,options);
  if(prepared.status==='unknown')return prepared;
  if(!Number.isInteger(samples)||samples<1||samples>32)return {status:'unknown',reasons:['战斗采样数量超过预算']};
  const rng=random(seed),outcomes=[];
  for(let i=0;i<samples;i++)outcomes.push(runScenario(prepared,rng));
  if(outcomes.some(x=>x.status==='unknown'))return {status:'unknown',reasons:['战斗计算资料不足']};
  const avg=key=>outcomes.reduce((n,x)=>n+x[key],0)/samples;
  const ownImpact=avg('enemyLost'),ownLost=avg('ownLost'),severeRisk=outcomes.filter(x=>x.severe).length/samples;
  // The severe-event component makes the reference responsive to one fragile
  // ship rather than averaging her danger away across the entire fleet.
  const enemyImpact=clamp(.45*ownLost+.55*severeRisk,0,1);
  const balance=fromRatio((ownImpact+.05)/(enemyImpact+.05));
  const hp=prepared.allies.map((_,i)=>outcomes.reduce((n,x)=>n+x.ownHp[i],0)/samples);
  const threatByEnemy=prepared.foes.map((s,i)=>({index:i,apiId:s.id,name:s.name,
    impact:outcomes.reduce((n,x)=>n+x.damageByEnemy[i],0)/samples}));
  const reasons=[...prepared.reasons];if(outcomes.some(x=>x.status==='partial'))reasons.push('部分敌我攻击能力缺少数据');
  return {status:reasons.length?'partial':'estimated',ownImpact,enemyImpact,severeRisk,balance,ownHp:hp,
    threatByEnemy,samples,reasons:[...new Set(reasons)],assumptions:prepared.assumptions};
}
module.exports={random,prepareBattle,runScenario,evaluateBattle,scenarioPower,hitDamage,combinedNightTarget,deriveOwnNight,deriveFleetSpecial};
