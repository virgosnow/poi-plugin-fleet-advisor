'use strict';
// Display-only formatting. The calculation and tooltip parsers keep their
// original data; this module never participates in mechanic detection.
const {t,registerCatalog,getLocale}=require('../../shared/i18n');
const catalog=require('./mechanism_catalog');
registerCatalog('ja',catalog.ja);registerCatalog('zh-TW',catalog.zhTW);
const prefixes=new Set(['攻击力','发动率','参考发动率','照明弹发动率','本舰数量','出击内成功次数','门槛','对潜','士气','潜水舰等级','速度群','提速装备','提速来源','本舰钢材消耗']);
const status=new Set(['待确认','未知','不可用','未就绪']);
function value(raw){
  if(typeof raw!=='string')return raw;
  if(status.has(raw))return t(raw);
  const direct=t(raw);if(direct!==raw)return direct;
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
