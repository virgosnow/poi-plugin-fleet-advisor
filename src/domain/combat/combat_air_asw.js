'use strict';
// Bounded per-slot normal-hit references for use by the battle estimator.
// Air superiority is never converted into a damage or survival probability.
// Actual carrier counts, contact, criticals, enemy special attacks and RNG are
// not assumed: callers must propagate their uncertainty into the final result.
// References: wikiwiki.jp/kancolle/航空戦 and wikiwiki.jp/kancolle/対潜攻撃.
const {projectShip}=require('../fleet/fleet_metrics');
const {aviationPowers}=require('./opening_attack_power');
const {combatBonuses}=require('./equipment_bonuses');
const {cap}=require('./attack_power');
const jets=require('./jet_aviation');
const catalog=new Map(require('../../../data/sortie/enemy_catalog.json').enemies.map(e=>[e.apiId,e]));
const AIR_ATTACKS=new Set([7,8,11,57,58]);
const MAX_SLOTS=6;
// Source: https://en.kancollewiki.net/Enemy/Common, individual I/Ro/Ho/He
// pages, and https://en.kancollewiki.net/Battleship_Re-Class. Values are
// intrinsic ASW for the precise API ID. Equipment is checked against the
// documented loadout before its static ASW contribution is used.
// Other standard variants: https://en.kancollewiki.net/Destroyer_Ha-Class,
// https://en.kancollewiki.net/Destroyer_Ni-Class_Elite,
// https://en.kancollewiki.net/Light_Cruiser_Ho-Class,
// https://en.kancollewiki.net/Light_Cruiser_He-Class,
// https://en.kancollewiki.net/Light_Cruiser_To-Class_Elite,
// https://en.kancollewiki.net/Torpedo_Cruiser_Chi-Class,
// https://en.kancollewiki.net/Light_Cruiser_Tsu-Class and
// https://en.kancollewiki.net/Enemy_Equipment.
const ENEMY_ASW=new Map([
  [1501,{base:25,gear:['5inch単装砲']}],
  [1502,{base:25,gear:['5inch連装砲']}],
  [1503,{base:30,gear:['5inch連装砲','21inch魚雷前期型']}],
  [1504,{base:35,gear:['5inch連装砲','21inch魚雷前期型']}],
  [1505,{base:30,gear:['5inch単装高射砲','深海棲艦偵察機']}],
  [1506,{base:40,gear:['6inch連装速射砲','深海棲艦偵察機']}],
  [1508,{base:30,gear:['5inch単装高射砲','21inch魚雷前期型','21inch魚雷前期型']}],
  [1516,{base:40,gear:['5inch連装砲','高速深海魚雷']}],
  [1517,{base:45,gear:['5inch連装砲','高速深海魚雷']}],
  [1518,{base:40,gear:['5inch単装高射砲','深海棲艦偵察機']}],
  [1519,{base:45,gear:['6inch連装速射砲','深海棲艦偵察機']}],
  [1520,{base:50,gear:['6inch連装速射砲','21inch魚雷前期型','深海棲艦偵察機']}],
  [1521,{base:40,gear:['6inch連装速射砲','21inch魚雷後期型','21inch魚雷後期型']}],
  [1554,{base:70,gear:['5inch単装高射砲','深海爆雷投射機','深海ソナー'],equipment:16,synergy:1.15}],
  [1555,{base:80,gear:['6inch連装速射砲','深海棲艦偵察機','深海爆雷投射機','深海ソナー'],equipment:16,synergy:1.15}],
  [1559,{base:50,gear:['6inch連装速射砲','高速深海魚雷','高速深海魚雷']}],
  // Nu flagship: aircraft ASW stats are 2, 2 and 4, respectively.
  // https://en.kancollewiki.net/Light_Carrier_Nu-Class
  [1560,{base:0,gear:['深海棲艦戦 Mark.II','深海棲艦爆 Mark.II','深海棲艦爆 Mark.II','深海棲艦攻 Mark.II'],airSlots:[[1,2],[2,2],[3,4]]}],
  [1575,{base:72,gear:['5inch連装砲','深海ソナー Mk.II','深海爆雷投射機'],equipment:23,synergy:1.15}],
  [1576,{base:72,gear:['5inch連装砲','深海ソナー Mk.II','深海爆雷投射機'],equipment:23,synergy:1.15}],
  [1577,{base:80,gear:['5inch連装砲','高速深海魚雷','深海爆雷投射機'],equipment:7}],
  [1578,{base:88,gear:['5inch連装砲','高速深海魚雷','深海爆雷投射機'],equipment:7}],
  // Northern Princess and these Supply Depot variants use aircraft for day
  // ASW despite being land installations. Their night ASW is unavailable.
  // https://en.kancollewiki.net/Northern_Princess
  // https://en.kancollewiki.net/Supply_Depot_Princess
  [1587,{base:0,gear:['5inch単装高射砲','深海棲艦戦 Mark.III','深海地獄艦爆','深海棲艦攻 Mark.II'],airSlots:[[2,4],[3,4]]}],
  [1588,{base:0,gear:['5inch単装高射砲','深海猫艦戦','深海地獄艦爆','深海復讐艦攻'],airSlots:[[2,4],[3,5]]}],
  [1589,{base:0,gear:['5inch単装高射砲','深海棲艦戦 Mark.III','深海地獄艦爆','深海棲艦攻 Mark.II'],airSlots:[[2,4],[3,4]]}],
  [1590,{base:0,gear:['5inch単装高射砲','深海猫艦戦','深海地獄艦爆','深海復讐艦攻'],airSlots:[[2,4],[3,5]]}],
  [1591,{base:96,gear:['5inch連装両用莢砲','5inch連装両用莢砲','深海ソナー Mk.II','深海棲艦偵察機'],equipment:16}],
  [1592,{base:98,gear:['5inch連装両用莢砲','5inch連装両用莢砲','深海ソナー Mk.II','深海棲艦偵察機'],equipment:16}],
  // https://en.kancollewiki.net/Destroyer_Princess
  // https://en.kancollewiki.net/Light_Cruiser_Demon
  [1597,{base:98,gear:['5inch連装砲','5inch連装砲','高速深海魚雷']}],
  [1598,{base:98,gear:['5inch連装砲','5inch連装砲','高速深海魚雷']}],
  [1601,{base:98,gear:['6inch連装速射砲','6inch連装速射砲','水上レーダ― Mark.II','深海棲艦偵察機']}],
  [1602,{base:98,gear:['6inch連装速射砲','6inch連装速射砲','水上レーダ― Mark.II','深海棲艦偵察機']}],
  [1653,{base:0,gear:['深海解放陸爆','深海解放陸爆','深海解放陸爆','深海解放陸爆'],airSlots:[[0,5],[1,5],[2,5],[3,5]]}],
  [1656,{base:0,gear:['深海解放陸爆Ace','深海解放陸爆','深海解放陸爆','深海解放陸爆'],airSlots:[[0,7],[1,5],[2,5],[3,5]]}],
  // https://en.kancollewiki.net/Supply_Depot_Princess_B
  [1922,{base:0,gear:['深海解放陸爆Ace','深海解放陸爆','深海解放陸爆','深海解放陸爆'],airSlots:[[0,7],[1,5],[2,5],[3,5]]}],
  [1925,{base:0,gear:['深海解放陸爆Ace','深海解放陸爆Ace','深海解放陸爆','深海解放陸爆'],airSlots:[[0,7],[1,7],[2,5],[3,5]]}],
  // Wiki shows 42/43 for these two BBVs. The +8 aviation and +13 surface
  // constants give different values; retain both until this is verified.
  [1561,{base:90,gear:['16inch三連装砲','12.5inch連装副砲','高速深海魚雷','飛び魚艦爆'],equipment:7,airSlot:3}],
  [1562,{base:100,gear:['16inch三連装砲','12.5inch連装副砲','深海烏賊魚雷','飛び魚艦爆'],equipment:7,airSlot:3}],
  // Wiki explicitly states that these two original Nu variants cannot ASW.
  [1510,{unavailable:true,gear:['深海棲艦戦','深海棲艦爆','深海棲艦攻']}],
  [1523,{unavailable:true,gear:['深海棲艦戦 Mark.II','深海棲艦爆','深海棲艦攻']}]
]);
const ENEMY_OPENING_TORPEDO=new Set([1532,1533,1534,1535,1571,1572,1736,1737,1738,1789,2049,1562]);
const ENEMY_NO_OPENING_TORPEDO=new Set([1530,1531,1570,1561]);
// The normal-map variants below are neither listed as exceptional surface
// opening-torpedo ships nor equipped with Abyssal Cuttlefish Torpedo. Match
// the exact catalog loadout as well as the ID: a future data correction must
// not silently inherit a decision made for a different configuration.
// https://wikiwiki.jp/kancolle/戦闘について
// https://en.kancollewiki.net/Opening_Torpedo_Salvo
// https://en.kancollewiki.net/Hi_Convoy_Princess
// https://en.kancollewiki.net/Harbour_Princess
// https://en.kancollewiki.net/Northern_Princess
// https://en.kancollewiki.net/Light_Cruiser_Demon
// https://en.kancollewiki.net/Destroyer_Princess
// https://en.kancollewiki.net/Aircraft_Carrier_Demon
// https://en.kancollewiki.net/Aircraft_Carrier_Princess
// https://en.kancollewiki.net/Batavia_Princess
// https://en.kancollewiki.net/Supply_Depot_Princess
// https://en.kancollewiki.net/Supply_Depot_Princess_B
// https://en.kancollewiki.net/South_Pacific_Aircraft_Carrier_Princess
const VERIFIED_NO_OPENING=new Map([
  [1527,['8inch三連装砲','6inch連装速射砲','高速深海魚雷','深海棲艦偵察機']],
  [1528,['深海棲艦戦 Mark.II','深海棲艦攻 Mark.II','深海棲艦爆 Mark.II']],
  [1548,['16inch三連装砲','16inch三連装砲','深海棲艦戦 Mark.II','深海水上レーダー']],
  [1555,['6inch連装速射砲','深海棲艦偵察機','深海爆雷投射機','深海ソナー']],
  [1565,['深海棲艦戦 Mark.III','深海棲艦爆 Mark.II','深海棲艦攻 Mark.III','深海棲艦攻 Mark.III']],
  [1573,['深海棲艦戦 Mark.III','深海棲艦爆 Mark.II','深海棲艦攻 Mark.II','深海棲艦攻 Mark.II']],
  [1575,['5inch連装砲','深海ソナー Mk.II','深海爆雷投射機']],
  [1576,['5inch連装砲','深海ソナー Mk.II','深海爆雷投射機']],
  [1577,['5inch連装砲','高速深海魚雷','深海爆雷投射機']],
  [1578,['5inch連装砲','高速深海魚雷','深海爆雷投射機']],
  [1579,['深海猫艦戦','深海地獄艦爆','深海復讐艦攻','深海復讐艦攻']],
  [1587,['5inch単装高射砲','深海棲艦戦 Mark.III','深海地獄艦爆','深海棲艦攻 Mark.II']],
  [1588,['5inch単装高射砲','深海猫艦戦','深海地獄艦爆','深海復讐艦攻']],
  [1589,['5inch単装高射砲','深海棲艦戦 Mark.III','深海地獄艦爆','深海棲艦攻 Mark.II']],
  [1590,['5inch単装高射砲','深海猫艦戦','深海地獄艦爆','深海復讐艦攻']],
  [1586,['深海猫艦戦','深海地獄艦爆','深海復讐艦攻','深海対空レーダ―']],
  [1591,['5inch連装両用莢砲','5inch連装両用莢砲','深海ソナー Mk.II','深海棲艦偵察機']],
  [1592,['5inch連装両用莢砲','5inch連装両用莢砲','深海ソナー Mk.II','深海棲艦偵察機']],
  [1595,['8inch三連装砲','8inch三連装砲','高速深海魚雷','深海棲艦偵察機']],
  [1597,['5inch連装砲','5inch連装砲','高速深海魚雷']],
  [1598,['5inch連装砲','5inch連装砲','高速深海魚雷']],
  [1601,['6inch連装速射砲','6inch連装速射砲','水上レーダ― Mark.II','深海棲艦偵察機']],
  [1602,['6inch連装速射砲','6inch連装速射砲','水上レーダ― Mark.II','深海棲艦偵察機']],
  [1613,['15inch要塞砲','15inch要塞砲','劣化徹甲弾','深海復讐艦攻']],
  [1615,['深海猫艦戦改','深海地獄艦爆改','深海復讐艦攻改','深海復讐艦攻改']],
  [1619,['深海猫艦戦改','深海地獄艦爆改','深海復讐艦攻改','深海対空レーダ―']],
  [1620,['深海猫艦戦改','深海地獄艦爆改','深海復讐艦攻改','深海対空レーダ―']],
  [1653,['深海解放陸爆','深海解放陸爆','深海解放陸爆','深海解放陸爆']],
  [1656,['深海解放陸爆Ace','深海解放陸爆','深海解放陸爆','深海解放陸爆']],
  [1898,['深海8inch三連装砲 Mk.9','深海8inch三連装砲 Mk.9','高速深海魚雷 mod.3','深海水上偵察観測機']],
  [1899,['深海8inch三連装砲 Mk.9','深海8inch三連装砲 Mk.9','高速深海魚雷 mod.3','深海水上偵察観測機']],
  [1901,['深海8inch三連装砲 Mk.9','深海8inch三連装砲 Mk.9','高速深海魚雷 mod.3','深海水上偵察観測機']],
  [1902,['深海8inch三連装砲 Mk.9','深海8inch三連装砲 Mk.9','高速深海魚雷 mod.3','深海水上偵察観測機']],
  [1922,['深海解放陸爆Ace','深海解放陸爆','深海解放陸爆','深海解放陸爆']],
  [1925,['深海解放陸爆Ace','深海解放陸爆Ace','深海解放陸爆','深海解放陸爆']],
  [1971,['夜猫深海艦戦','夜深海艦爆','深海地獄艦爆改','夜復讐深海艦攻']],
  [1974,['夜猫深海艦戦','夜深海艦爆','深海地獄艦爆改','夜復讐深海艦攻']],
  [2059,['深海戦爆複座鷹','夜復讐深海艦攻II','夜猫深海艦戦II','深海戦爆複座鷹']],
  [2060,['深海戦爆複座鷹改','夜復讐深海艦攻II','夜猫深海艦戦II','深海戦爆複座鷹改']],
  [2061,['深海戦爆複座鷹改','夜復讐深海艦攻II','夜猫深海艦戦II','深海戦爆複座鷹']],
  [2062,['深海戦爆複座鷹改','夜復讐深海艦攻II','夜猫深海艦戦II','深海戦爆複座鷹改']]
]);
const finite=n=>Number.isFinite(n)&&n>=0;
const number=n=>typeof n==='number'&&Number.isFinite(n)?n:null;
const normalize=name=>String(name||'').normalize('NFKC').replace(/\s+/g,'');
const namesCache=new WeakMap();
function enemyEquipmentIndex(masters){
  if(!masters||typeof masters!=='object')return null;
  let result=namesCache.get(masters);if(result)return result;
  result=new Map();
  for(const item of Object.values(masters)){
    const name=normalize(item?.api_name);if(!name)continue;
    const type=Number(item.api_type?.[2]),bomb=number(item.api_baku),torpedo=number(item.api_raig);
    if(!result.has(name))result.set(name,new Map());
    result.get(name).set([type,bomb,torpedo].join(':'),{id:item.api_id,type,bomb,torpedo});
  }
  namesCache.set(masters,result);return result;
}
function counts(capacity,remaining,slot){
  if(!Number.isInteger(capacity)||capacity<0)return null;
  const value=remaining?.[slot];
  if(value===undefined)return [0,capacity];
  const range=Number.isInteger(value)?[value,value]:value;
  return Array.isArray(range)&&range.length===2&&range.every(n=>Number.isInteger(n)&&n>=0)&&
    range[0]<=range[1]&&range[1]<=capacity?range:null;
}
function dormant(kind,side){return kind==='nightBattle'||kind==='aerialRaid'&&side==='friendly';}
function deriveFriendlyAir(store,entry,{slotRemaining,nodeKind}={}){
  if(dormant(nodeKind,'friendly'))return {status:'known',attacks:[],reasons:[]};
  const ship=store?.info?.ships?.[entry?.id],master=store?.const?.$ships?.[ship?.api_ship_id];
  if(!ship||!master||!Array.isArray(entry?.slots)||entry.slots.length>MAX_SLOTS)
    return {status:'unknown',attacks:[],reasons:['舰娘或装备槽资料不足']};
  const target=projectShip(store,entry.id,{slots:entry.slots,ex:entry.ex});
  if(target.items.some(item=>!item.master))return {status:'unknown',attacks:[],reasons:['装备资料缺失']};
  const slots=[];let assumed=false;
  for(let slot=0;slot<entry.slots.length;slot++){
    const item=target.items.find(e=>e.id===entry.slots[slot]);
    if(!item||!AIR_ATTACKS.has(item.type)||Number(item.master.api_type?.[0])===21)continue;
    const stat=item.type===8?item.master.api_raig:item.master.api_baku;
    if(!finite(stat))return {status:'unknown',attacks:[],reasons:[`第 ${slot+1} 槽航空攻击属性缺失`]};
    const range=counts(master.api_maxeq?.[slot],slotRemaining,slot);
    if(!range)return {status:'unknown',attacks:[],reasons:[`第 ${slot+1} 槽搭载或损耗资料不足`]};
    if(slotRemaining?.[slot]===undefined&&range[1]>0)assumed=true;
    slots.push({equipment:item,slot,range});
  }
  if(!slots.length)return {status:'known',attacks:[],reasons:[]};
  const points=side=>slots.map(s=>({equipment:s.equipment,slot:s.slot,planes:s.range[side]}));
  // Loss bounds are not probabilities: repeatedly treating the extreme
  // lower bound as a 50% roll creates implausibly frequent empty squadrons.
  // Use a single midpoint count as a *reference scenario*, while retaining the
  // original bounds for callers that need the full interval.
  const midpoint=slots.map(s=>({equipment:s.equipment,slot:s.slot,
    planes:Math.round((s.range[0]+s.range[1])/2)}));
  const opts={withoutBlueReference:!combatBonuses(store,target).known};
  const calc=slots=>aviationPowers(target,store,slots,slots,opts);
  const low=calc(points(0)),high=calc(points(1)),reference=calc(midpoint);
  const reasons=[...new Set([...low.reasons,...high.reasons,...reference.reasons,...(assumed?['缺少该节点航空损耗，按零至满载保守范围']:[]),
    ...(slots.some(s=>[57,58].includes(s.equipment.type)&&s.range[1]>0)?['喷式强袭阶段未计入']:[])])];
  const bySlot=rows=>new Map(rows.map(row=>[row.slot,row]));
  const l=bySlot(low.rows),h=bySlot(high.rows),mid=bySlot(reference.rows),attacks=[];
  for(const s of slots){
    const lows=l.get(s.slot)?.powers,highs=h.get(s.slot)?.powers,refs=mid.get(s.slot)?.powers;
    if(!lows||!highs||!refs||lows.includes(null)||highs.includes(null)||refs.includes(null)){
      return {status:'unknown',attacks:[],reasons:[...reasons,`第 ${s.slot+1} 槽航空攻击力资料不足`]};
    }
    const min=lows.length?Math.min(...lows):0,max=highs.length?Math.max(...highs):0;
    // Plane bonus allocation can change between endpoints, so do not reverse
    // an unusual interval into an apparently exact value.
    if(min>max)return {status:'unknown',attacks:[],reasons:[...reasons,`第 ${s.slot+1} 槽蓝字分配待确认`]};
    attacks.push({slot:s.slot,itemId:s.equipment.id,planesMin:s.range[0],planesMax:s.range[1],
      powerMin:min,powerMax:max,targetKinds:['surface'],installationTarget:'unknown',
      referencePlanes:mid.get(s.slot).planes,referencePowers:refs.length?refs:[0],
      kind:s.equipment.type===8?'torpedo':'bomb'});
  }
  const status=reasons.length?'partial':'known';
  return {status,attacks,reasons:[...new Set(reasons)]};
}
function enemyPlanePower(type,item,planes){
  if(planes===0)return [0,0];
  if(type===58)return null;
  const value=type===8?item.torpedo:item.bomb;
  if(!finite(value))return null;
  const base=value*Math.sqrt(planes)+25;
  if(type===8)return [cap(base*.8,170),cap(base*1.5,170)];
  if(type===57){const p=jets.jetPower(value,planes,{phase:'ordinary'});return p===null?null:[p,p];}
  const p=cap(base,170);return [p,p];
}
// Only names whose role is unambiguously non-attacking can be excluded when
// a game equipment master is missing. Other unknown slots remain a possible
// attack rather than being silently treated as an empty airstrike.
function certainlyNonAttackName(name){
  const value=normalize(name);
  return /^(?:\d+(?:\.\d+)?(?:inch|cm).*(?:砲|高角砲)|深海烏賊魚雷|高速深海魚雷|\d+inch魚雷.*|深海棲艦偵察機|深海(?:水上|対空)レーダー|深海(?:ソナー|爆雷投射機)|対空レーダー|水上レーダー)$/.test(value);
}
function deriveEnemyAir(store,enemy,{slotRemaining,nodeKind}={}){
  if(dormant(nodeKind,'enemy'))return {status:'known',attacks:[],reasons:[],unresolvedAttack:false};
  if(enemy?.status!=='known'||!Number.isInteger(enemy.apiId))
    return {status:'unknown',attacks:[],reasons:['敌舰身份待确认'],unresolvedAttack:true};
  const master=catalog.get(enemy.apiId),index=enemyEquipmentIndex(store?.const?.$equips);
  if(master?.stats?.['搭載']===0)return {status:'known',attacks:[],reasons:[],unresolvedAttack:false};
  if(!master||!Array.isArray(master.equipment)||!master.equipment.length||master.equipment.length>MAX_SLOTS||!index)
    return {status:'unknown',attacks:[],reasons:['敌机装备资料不足'],unresolvedAttack:true};
  const attacks=[],reasons=[];let unresolvedAttack=false;
  for(let slot=0;slot<master.equipment.length;slot++){
    const equip=master.equipment[slot];if(equip.notEquippable)continue;
    const matches=index.get(normalize(equip.name));
    if(!matches||matches.size!==1){
      if(!certainlyNonAttackName(equip.name)){unresolvedAttack=true;reasons.push(`敌舰第 ${slot+1} 槽装备资料不足或有歧义`);}
      continue;
    }
    const item=[...matches.values()][0];
    if(!AIR_ATTACKS.has(item.type))continue;
    const range=counts(equip.slotCapacity,slotRemaining,slot);
    if(!range){unresolvedAttack=true;reasons.push(`敌舰第 ${slot+1} 槽搭载或损耗资料不足`);continue;}
    const low=enemyPlanePower(item.type,item,range[0]),high=enemyPlanePower(item.type,item,range[1]),
      referencePlanes=Math.round((range[0]+range[1])/2),referencePowers=enemyPlanePower(item.type,item,referencePlanes);
    if(!low||!high||!referencePowers){unresolvedAttack=true;reasons.push(`敌舰第 ${slot+1} 槽航空攻击规则待确认`);continue;}
    if(slotRemaining?.[slot]===undefined&&range[1]>0)reasons.push('缺少敌机损耗，按零至满载保守范围');
    if([57,58].includes(item.type)&&range[1]>0)reasons.push('敌方喷式强袭阶段未计入');
    attacks.push({slot,masterId:item.id,planesMin:range[0],planesMax:range[1],
      powerMin:Math.min(...low),powerMax:Math.max(...high),targetKinds:['surface'],
      referencePlanes,referencePowers,
      submarineTarget:nodeKind==='aerialRaid'?'unknown':false,kind:item.type===8?'torpedo':'bomb'});
  }
  return {status:reasons.length?'partial':'known',attacks,reasons:[...new Set(reasons)],unresolvedAttack};
}
// Common normal-map cases are explicitly documented by the respective Wiki
// enemy pages. All unreviewed enemy variants stay unknown, including other
// special opening-torpedo ships. This is eligibility, not an activation rate.
function enemyOpeningTorpedo(enemy,{nodeKind}={}){
  if(nodeKind==='nightBattle')return {status:'known',eligible:false};
  if(enemy?.status!=='known'||!Number.isInteger(enemy.apiId))return {status:'unknown',eligible:null};
  if(!catalog.has(enemy.apiId))return {status:'unknown',eligible:null};
  // Explicit IDs, including documented New Submarine Princess variants.
  // Other special enemies and event-specific phases are intentionally unknown.
  if(ENEMY_OPENING_TORPEDO.has(enemy.apiId))
    return {status:'known',eligible:true};
  if(ENEMY_NO_OPENING_TORPEDO.has(enemy.apiId))return {status:'known',eligible:false};
  const expected=VERIFIED_NO_OPENING.get(enemy.apiId),master=catalog.get(enemy.apiId);
  if(expected&&Array.isArray(master.equipment)&&master.equipment.every(item=>
    item?.notEquippable===true||typeof item?.name==='string'&&item.name.length>0)){
    const actual=master.equipment.filter(item=>!item.notEquippable).map(item=>normalize(item.name));
    if(actual.join('|')===expected.map(normalize).join('|'))return {status:'known',eligible:false};
  }
  return {status:'unknown',eligible:null};
}
// Enemy normal-hit attack power BEFORE formation, engagement, damage state,
// armor and ammunition. It is not a hit, damage, or retreat probability.
// A potentially depleted RE aircraft leaves the lower bound at zero.
function enemyAswPower(enemy,{phase='shelling',slotRemaining,nightStart}={}){
  if(enemy?.status!=='known'||!Number.isInteger(enemy.apiId))
    return {status:'unknown',eligible:null,powerMin:null,powerMax:null,reasons:['敌舰身份待确认']};
  const master=catalog.get(enemy.apiId),rule=ENEMY_ASW.get(enemy.apiId);
  if(!master)return {status:'unknown',eligible:null,powerMin:null,powerMax:null,reasons:['敌舰对潜资料未收录']};
  if(!['shelling','night','openingAsw'].includes(phase))
    return {status:'unknown',eligible:null,powerMin:null,powerMax:null,reasons:['该对潜阶段尚未核对']};
  // The standard Wo-class regular carrier does not attack submarines.
  // Limit this to the documented class, not all carrier-like bosses.
  // https://wikiwiki.jp/kancolle/FAQ
  if(master.shipType==='正規空母'&&/^空母ヲ級/.test(master.name||''))
    return {status:'known',eligible:false,powerMin:0,powerMax:0,reasons:[]};
  if(!rule)return {status:'unknown',eligible:null,powerMin:null,powerMax:null,reasons:['敌舰对潜资料未收录']};
  const gear=(master.equipment||[]).filter(item=>typeof item.name==='string').map(item=>normalize(item.name));
  if(gear.join('|')!==rule.gear.map(normalize).join('|'))
    return {status:'unknown',eligible:null,powerMin:null,powerMax:null,reasons:['敌舰装备与资料来源不一致']};
  if(phase==='openingAsw'||rule.unavailable)
    return {status:'known',eligible:false,powerMin:0,powerMax:0,reasons:[]};
  if(rule.airSlots){
    // Ordinary Nu flagship cannot conduct night ASW. Daytime aircraft ASW
    // requires at least one bomber alive, and slot losses change its gear
    // ASW contribution; preserve a range instead of assuming full aircraft.
    if(phase==='night')return {status:'known',eligible:false,powerMin:0,powerMax:0,reasons:[]};
    const rows=rule.airSlots.map(([slot,value])=>({value,range:counts(master.equipment[slot]?.slotCapacity,slotRemaining,slot)}));
    if(rows.some(row=>!row.range))return {status:'unknown',eligible:null,powerMin:null,powerMax:null,reasons:['敌机搭载或损耗资料不足']};
    const minimum=rows.reduce((n,row)=>n+(row.range[0]>0?row.value:0),0),maximum=rows.reduce((n,row)=>n+(row.range[1]>0?row.value:0),0);
    if(!maximum)return {status:'known',eligible:false,powerMin:0,powerMax:0,reasons:[]};
    const uncertain=rows.some(row=>row.range[0]===0&&row.range[1]>0);
    const reference=rows.reduce((n,row)=>n+(Math.round((row.range[0]+row.range[1])/2)>0?row.value:0),0);
    return {status:uncertain?'partial':'known',eligible:minimum>0?true:null,
      powerMin:minimum>0?2*Math.sqrt(rule.base)+1.5*minimum+8:0,
      powerMax:2*Math.sqrt(rule.base)+1.5*maximum+8,
      referencePower:reference>0?2*Math.sqrt(rule.base)+1.5*reference+8:0,
      reasons:uncertain?['敌机对潜按损耗范围中间架数参考']:[],source:'https://en.kancollewiki.net/Light_Carrier_Nu-Class'};
  }
  const base=2*Math.sqrt(rule.base)+1.5*(rule.equipment||0),synergy=rule.synergy||1;
  if(rule.airSlot===undefined){
    const power=(base+13)*synergy;
    if(phase==='night'&&nightStart!==true)return {status:'partial',eligible:true,powerMin:0,
      powerMax:nightStart===false?0:power,
      reasons:[nightStart===false?'昼转夜的对潜伤害需单独处理擦伤':'开幕夜战或昼转夜尚未指定'],
      source:'https://wikiwiki.jp/kancolle/対潜攻撃'};
    return {status:'known',eligible:true,powerMin:power,powerMax:power,reasons:[],
      source:'https://en.kancollewiki.net/Enemy/Common'};
  }
  const slot=rule.airSlot,capacity=master.equipment[slot]?.slotCapacity,range=counts(capacity,slotRemaining,slot);
  // Enemy RE has intrinsic ASW and prioritizes submarines at night even after
  // all aircraft are lost. Opening-night and day-then-night ASW use different
  // damage rules; do not infer one from an unspecified "night" label.
  if(phase==='night'){
    const reasons=['敌航战夜间对潜与飞机损耗的火力修正待确认'];
    if(!range)reasons.push('敌机搭载或损耗资料不足');
    if(nightStart!==true)reasons.push(nightStart===false?'昼转夜的对潜伤害需单独处理擦伤':'开幕夜战或昼转夜尚未指定');
    const low=nightStart===true?(range?.[0]>0?base:2*Math.sqrt(rule.base))+8:0;
    const high=nightStart===false?0:base+13;
    return {status:'partial',eligible:true,powerMin:low,powerMax:high,reasons,
      source:'https://wikiwiki.jp/kancolle/戦闘について'};
  }
  if(!range)return {status:'unknown',eligible:null,powerMin:null,powerMax:null,reasons:['敌机搭载或损耗资料不足']};
  if(range[1]===0)return {status:'known',eligible:false,powerMin:0,powerMax:0,reasons:[]};
  const reasons=['敌航战对潜常数尚待核对，保留两种计算范围'];
  if(range[0]===0)reasons.push('飞鱼舰爆是否全部损失待确认');
  return {status:'partial',eligible:range[0]>0?true:null,
    powerMin:range[0]===0?0:(base+8)*synergy,powerMax:(base+13)*synergy,reasons,
    source:'https://en.kancollewiki.net/Battleship_Re-Class'};
}
// Extract the post-interception aircraft counts for one actual selected path.
// On a terminal node the existing air estimator can leave interception unknown
// while still reporting air control; never present those counts as verified.
function aircraftAfterNode(reference,estimate,{pathIndex=0,nodeId,round=1,shipId}={}){
  const path=reference?.paths?.[pathIndex],simulation=estimate?.paths?.[pathIndex];
  // Another path (or a later node on this path) may lack air data. A fully
  // recorded earlier step on this selected path is still usable.
  if(reference?.status!=='known'||!path?.includes(nodeId)||!simulation)
    return {status:'unknown',slots:{},reason:'所选路径的航空损耗资料不足'};
  const node=reference.nodes?.find(row=>row.id===nodeId),step=simulation.steps?.find(row=>row.node===nodeId&&row.round===round);
  if(!node||node.noAirBattle||node.kind==='aerialRaid'||node.antiAir?.status!=='known'||!Array.isArray(step?.aircraft))
    return {status:'unknown',slots:{},reason:'该节点攻击机迎击损耗待确认'};
  const rows=step.aircraft.filter(row=>row.shipId===shipId),slots={};
  for(const row of rows){
    if(!Number.isInteger(row.slot)||!Array.isArray(row.planes)||row.planes.length!==2||
      !row.planes.every(n=>Number.isInteger(n)&&n>=0)||row.planes[0]>row.planes[1])
      return {status:'unknown',slots:{},reason:'航空槽损耗范围异常'};
    slots[row.slot]=row.planes.slice();
  }
  return {status:'estimated',slots,reason:'沿途制空及迎击损耗范围，非概率'};
}
module.exports={deriveFriendlyAir,deriveEnemyAir,aircraftAfterNode,enemyOpeningTorpedo,enemyAswPower};
