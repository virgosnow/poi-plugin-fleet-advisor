'use strict';
// Display-only formatting. The calculation and tooltip parsers keep their
// original data; this module never participates in mechanic detection.
const {t,registerCatalog,getLocale}=require('../../shared/i18n');
const catalog=require('./mechanism_catalog');
registerCatalog('ja',catalog.ja);registerCatalog('zh-TW',catalog.zhTW);
const prefixes=new Set(['攻击力','发动率','参考发动率','照明弹发动率','本舰数量','出击内成功次数','门槛','对潜','士气','潜水舰等级','速度群','提速装备','提速来源','本舰钢材消耗']);
const status=new Set(['待确认','未知','不可用','未就绪']);
const knownReasons=new Set(['舰队舰娘资料缺失','舰队基础索敌资料不足','无法还原舰娘基础索敌','水侦／水爆索敌或容量资料不足',
  '舰娘属性缺失','舰娘火力或近代化资料缺失','舰娘雷装或近代化资料缺失','装备改修资料缺失',
  '装备属性或改修资料缺失','包含尚未收录蓝字的新装备','舰娘改造形态超出蓝字资料范围','缺少舰型，无法核对蓝字','缺少改造链，无法核对蓝字']);
function value(raw){
  if(typeof raw!=='string')return raw;
  if(status.has(raw))return t(raw);
  const direct=t(raw);if(direct!==raw)return direct;
  const tentative=raw.match(/^(\d+(?:\.\d+)?%)（待验证）$/);
  if(tentative)return tentative[1]+t('（待验证）');
  const hits=raw.match(/^((?:\d+(?:\.\d+)?|待确认)(?: 或 (?:\d+(?:\.\d+)?|待确认))*) × (\d+)击$/);
  if(hits)return t('{value} × {hits}击',{value:hits[1].split(' 或 ').map(part=>status.has(part)?t(part):part).join(` ${t('或')} `),hits:hits[2]});
  const perTrip=raw.match(/^(待确认|\d+(?:\.\d+)?)／次$/);
  if(perTrip)return t('{n}／次',{n:perTrip[1]==='待确认'?t(perTrip[1]):perTrip[1]});
  const aa=raw.match(/^固定击坠×([\d.]+)，保底\+(\d+)机$/);
  if(aa)return t('固定击坠×{multiplier}，保底+{count}机',{multiplier:aa[1],count:aa[2]});
  return raw;
}
function line(raw){
  if(!raw||getLocale()==='zh-CN')return raw;
  const direct=t(raw);if(direct!==raw)return direct;
  const reasons=raw.split('；');
  if(reasons.length>1&&reasons.every(reason=>knownReasons.has(reason)))return reasons.map(reason=>t(reason)).join('；');
  const airRate=raw.match(/^(参考发动率|发动率|主主 CI|主彻 CI|主电 CI|主副 CI|昼战连击|FBA|BBA|BA)（(?:(\w+(?:／\w+)*) 点，)?(空优|空确|空均|空劣|空丧|制空不足)）：(.*)$/);
  if(airRate){const where=airRate[2]?t('tooltip.nodeAirState',{nodes:airRate[2],state:t(airRate[3])}):t(airRate[3]);
    return `${t(airRate[1])}（${where}）：${value(airRate[4])}`;}
  const powerReason=raw.match(/^攻击力待确认：(.+)。$/);
  if(powerReason)return t('tooltip.powerUnknown',{reason:powerReason[1].split('；').map(part=>t(part)).join('；')});
  const formation=raw.match(/^要求阵型：(.+)$/);
  if(formation)return t('tooltip.requiredFormation',{formation:formation[1].split('／').map(part=>t(part)).join('／')});
  const needShips=raw.match(/^需至少 (\d+) 艘水上舰$/);
  if(needShips)return t('tooltip.needSurfaceShips',{count:needShips[1]});
  const needSub=raw.match(/^第 (\d+) 位需潜水舰／潜水空母$/);
  if(needSub)return t('tooltip.needSubmarine',{position:needSub[1]});
  const resources=raw.match(/^持有物资：(待确认|\d+ 件)；每节点消耗 1 件。$/);
  if(resources)return t('tooltip.submarineSupplies',{count:resources[1]==='待确认'?t('待确认'):t('tooltip.itemCount',{count:resources[1].replace(' 件','')})});
  const damage=raw.match(/^每次出击(最多 3 次| 1 次)；(.+)。$/);
  if(damage){const clauses=damage[2].split('；').map(part=>{
    const m=part.match(/^第 ([\d、]+) 位需(未中破|未大破)$/);
    return m?t(m[2]==='未中破'?'tooltip.noModerateDamage':'tooltip.noHeavyDamage',{positions:m[1]}):part;
  });return t(damage[1].startsWith('最多')?'tooltip.sortieMaxThree':'tooltip.sortieOnce',{conditions:clauses.join('；')});}
  if(raw.startsWith('待确认：'))return t('待确认：')+line(raw.slice('待确认：'.length));
  if(raw.startsWith('槽位容量不满足或待确认：'))return t('槽位容量不满足或待确认：')+raw.slice('槽位容量不满足或待确认：'.length);
  const equipment=raw.split('＋');
  if(equipment.length>1&&equipment.every(part=>['小型声呐','大型声呐','投射机','爆雷','迫击炮'].includes(part)))
    return equipment.map(part=>t(part)).join('＋');
  const match=raw.match(/^([^：\n]+)：(.*)$/);
  if(match&&prefixes.has(match[1]))return t(match[1])+'：'+(match[1]==='提速装备'?match[2]:value(match[2]));
  // Sentences are translated independently only when an exact reviewed
  // message exists. Unrecognized pieces, including equipment and ship names,
  // remain untouched.
  return raw.split(/(?<=。)/u).map(part=>t(part)).join('');
}
function text(raw){return typeof raw==='string'?raw.split('\n').map(line).join('\n'):raw;}
function aircraftTitle(raw){
  if(typeof raw!=='string')return raw;
  return raw.replace(/（(\d+|—|待确认) 架）$/,(_,n)=>t('（{n} 架）',{n:n==='待确认'?t(n):n}));
}
function label(badge){
  if(!badge||getLocale()==='zh-CN')return badge?.label;
  if(badge.key==='ground'&&Array.isArray(badge.categories)&&badge.categories.length){
    if(badge.categories.length===1)return t(badge.categories[0].label||badge.label);
    const names={landing:'登陆',rocket:'火箭',aircraft:'轰炸'};
    if(badge.categories.every(c=>names[c.id]))
      return t('对地·{types}',{types:badge.categories.map(c=>t(names[c.id])).join('／')});
  }
  if(badge.key==='carrier-ci'){
    const match=String(badge.label).match(/^战爆联合·(.+)$/);
    if(match)return t('战爆联合·{mode}',{mode:match[1]});
  }
  const patterns={
    'expedition-morale':[[/^✦ 有闪 (\d+)$/,'✦ 有闪 {value}'],[/^士气 (\d+)$/,'士气 {value}']],
    'expedition-drums':[[/^运输桶 (\d+)$/,'运输桶 {value}']],
    'expedition-income':[[/^基础收益 \+([\d.]+)%$/,'基础收益 +{value}%']]
  };
  for(const [pattern,key] of patterns[badge.key]||[]){const m=String(badge.label).match(pattern);if(m)return t(key,{value:m[1]});}
  return t(badge.label);
}
module.exports={label,line,text,value,aircraftTitle};
