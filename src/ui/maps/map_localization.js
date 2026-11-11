'use strict';
const {t,getLocale,registerCatalog}=require('../../shared/i18n');
const catalog=require('../i18n/maps'),routeNames=require('../i18n/route_names.json');
const enemyNamesTW=require('../i18n/enemy_names_zh_tw.json');
const enemyFamilyTW=require('../i18n/enemy_family_zh_tw.json');
const enemiesById=new Map(require('../../../data/sortie/enemy_catalog.json').enemies.map(row=>[Number(row.apiId),row]));
registerCatalog('zh-CN',catalog.zhCN);registerCatalog('ja',catalog.ja);registerCatalog('zh-TW',catalog.zhTW);

// Stable route key plus source name avoids mislabelling an adaptively renamed
// fixed path or a route changed after the review catalog was prepared.
function routeName(option){
  if(!option)return '';
  const item=routeNames[option.key],name=option.name||'';
  if(item&&item.source===name){
    const locale=getLocale();
    return locale==='ja-JP'?item.ja:locale==='zh-TW'?item.zhTW:name;
  }
  return t(name);
}
function phaseLabel(label){
  const match=/^第\s*(\d+)\s*阶段$/.exec(String(label||''));
  return match?t('map.phase',{number:match[1]}):t(label||'推荐路线');
}
function airState(value){
  if(value==='制空待确认')return t(value);
  const match=/^预计(空确|空优|空均|空劣|丧失)(?:～(空确|空优|空均|空劣|丧失))?$/.exec(String(value||''));
  if(!match)return value;
  return t('map.predictedAir',{state:t(match[1])+(match[2]?'～'+t(match[2]):'')});
}
function enemyName(enemy){
  const original=enemy?.name||'',id=Number(enemy?.apiId),entry=enemiesById.get(id);
  if(!entry||enemy?.identityVerified===false)return original;
  // A family aggregates distinct variants; the representative portrait's ID
  // must not turn the label into that individual variant's name.
  if(enemy?.familyKey)return getLocale()==='ja-JP'?enemy.familyKey:
    getLocale()==='zh-TW'?(enemyFamilyTW[original]||original):original;
  return getLocale()==='ja-JP'?(entry.kcwikiNameJa||entry.name||original):
    getLocale()==='zh-TW'?(enemyNamesTW[String(id)]||original):original;
}
function airbaseName(base){return base?.nameIsFallback?t('map.airbaseName',{number:base.id}):base?.name||'';}
module.exports={routeName,phaseLabel,airState,enemyName,airbaseName};
