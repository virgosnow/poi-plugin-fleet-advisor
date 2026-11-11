'use strict';
// Display-only formatting for machine-readable route predicates. The original
// predicate, match state, rule ordering and route calculations never use these
// translated strings. Unknown shapes retain their existing text.
const {getLocale,t,registerCatalog}=require('../../shared/i18n');
const ja={
 'route.other':'その他の編成','route.unknown':'未確認の条件','route.all':'{items}','route.and':'、かつ ', 'route.or':' または ',
 'route.not':'次を満たさない：{condition}','route.count.exact':'{name} {count}隻','route.count.min':'{name}が{count}隻以上','route.count.max':'{name}が{count}隻以下',
 'route.fleet':'艦隊','route.openingTorpedo':'先制雷撃可能艦','route.passed':'{node}マスを経由済み','route.allShips':'全艦が次の艦種・艦のみ：{names}',
 'route.flagship':'旗艦：{names}','route.includes':'{names}を含む','route.los':'33式索敵（係数 {coefficient}） {limits}',
 'route.speed.minimum':'全艦{speed}以上','route.speed.exact':'全艦の速力が{speed}','route.speed.contains':'{speed}艦を含む',
 'route.radarCarriers':'電探搭載艦','route.drumCarriers':'ドラム缶搭載艦','route.landingCraftCarriers':'上陸用舟艇搭載艦','route.transportEquipCount':'輸送装備数',
 'route.speed.slow':'低速','route.speed.fast':'高速','route.speed.fastPlus':'高速+','route.speed.fastest':'最速',
 'route.type.1':'海防艦','route.type.2':'駆逐艦','route.type.3':'軽巡','route.type.4':'雷巡','route.type.5':'重巡','route.type.6':'航巡','route.type.7':'軽空母',
 'route.type.8':'高速戦艦','route.type.9':'戦艦','route.type.10':'航戦','route.type.11':'正規空母','route.type.12':'戦艦','route.type.13':'潜水艦',
 'route.type.14':'潜水空母','route.type.16':'水母','route.type.17':'揚陸艦','route.type.18':'装甲空母','route.type.19':'工作艦','route.type.20':'潜水母艦',
 'route.type.21':'練習巡洋艦','route.type.22':'補給艦','route.group.carrier':'空母系','route.group.fleetCarrier':'正規／装甲空母','route.group.battleship':'戦艦級',
 'route.group.supply':'補給艦','route.group.heavyCruiser':'重巡／航巡','route.group.slowBattleship':'低速戦艦'
};
const tw={
 'route.other':'其餘編成','route.unknown':'尚未確認的條件','route.all':'{items}','route.and':'，且 ', 'route.or':' 或 ',
 'route.not':'不滿足 {condition}','route.count.exact':'{name} {count} 艘','route.count.min':'{name}至少 {count} 艘','route.count.max':'{name}最多 {count} 艘',
 'route.fleet':'艦隊','route.openingTorpedo':'可先制雷擊艦','route.passed':'已經過 {node} 點','route.allShips':'全隊僅含 {names}',
 'route.flagship':'旗艦為 {names}','route.includes':'包含 {names}','route.los':'33 式索敵（係數 {coefficient}） {limits}',
 'route.speed.minimum':'全隊{speed}以上','route.speed.exact':'全隊速力為{speed}','route.speed.contains':'含{speed}艦',
 'route.radarCarriers':'載電探艦','route.drumCarriers':'載運輸桶艦','route.landingCraftCarriers':'載登陸艇艦','route.transportEquipCount':'運輸裝備計數',
 'route.speed.slow':'低速','route.speed.fast':'高速','route.speed.fastPlus':'高速+','route.speed.fastest':'最速',
 'route.type.1':'海防','route.type.2':'驅逐','route.type.3':'輕巡','route.type.4':'雷巡','route.type.5':'重巡','route.type.6':'航巡','route.type.7':'輕空母',
 'route.type.8':'高速戰艦','route.type.9':'戰艦','route.type.10':'航戰','route.type.11':'正規空母','route.type.12':'戰艦','route.type.13':'潛水艦',
 'route.type.14':'潛水空母','route.type.16':'水母','route.type.17':'揚陸艦','route.type.18':'裝甲空母','route.type.19':'工作艦','route.type.20':'潛水母艦',
 'route.type.21':'練巡','route.type.22':'補給艦','route.group.carrier':'空母系','route.group.fleetCarrier':'正規／裝甲空母','route.group.battleship':'戰艦級',
 'route.group.supply':'補給艦','route.group.heavyCruiser':'重巡／航巡','route.group.slowBattleship':'低速戰艦'
};
registerCatalog('ja',ja);registerCatalog('zh-TW',tw);
const localized=(key,value)=>Object.prototype.hasOwnProperty.call(ja,key)?t(key):String(value);
const shipType=type=>localized('route.type.'+type,type);
const groupType=group=>localized('route.group.'+group,group);
const speed=value=>localized('route.speed.'+value,value);
function describeCondition(node){
 if(!node)return '';
 if(getLocale()==='zh-CN')return node.text||'';
 const children=node.children||[];
 if(node.operator==='all')return children.map(describeCondition).join(t('route.and'));
 if(node.operator==='any')return '('+children.map(describeCondition).join(t('route.or'))+')';
 if(node.operator==='not')return t('route.not',{condition:describeCondition(children[0])});
 const v=node.expression;
 if(v===true||v==='otherwise')return t('route.other');
 if(!v||typeof v!=='object')return node.text||t('route.unknown');
 const count=(name,c)=>c.exact!==undefined?t('route.count.exact',{name,count:c.exact}):
   c.min!==undefined?t('route.count.min',{name,count:c.min}):t('route.count.max',{name,count:c.max});
 const names=value=>[...(value.stypes||[]).map(shipType),...(value.groups||[]).map(groupType),...(value.prefixes||[])].join('/');
 if(v.count)return count(names(v.count),v.count);
 if(v.shipCount)return count(t('route.fleet'),v.shipCount);
 if(v.openingTorpedoCarriers)return count(t('route.openingTorpedo'),v.openingTorpedoCarriers);
 if(v.pathIncludes)return t('route.passed',{node:v.pathIncludes});
 if(v.allStypes)return t('route.allShips',{names:v.allStypes.map(shipType).join('/')});
 if(v.allHulls)return t('route.allShips',{names:[...(v.allHulls.stypes||[]).map(shipType),...(v.allHulls.prefixes||[])].join('/')});
 if(v.flagshipStype)return t('route.flagship',{names:v.flagshipStype.map(shipType).join('/')});
 if(v.flagshipName)return t('route.flagship',{names:v.flagshipName.prefixes.join('/')});
 if(v.shipName)return t('route.includes',{names:v.shipName.prefixes.join('/')});
 if(v.los){const limits=[v.los.gte!==undefined?`≥ ${v.los.gte}`:null,v.los.lt!==undefined?`< ${v.los.lt}`:null].filter(Boolean).join(t('route.and'));
   return t('route.los',{coefficient:v.los.coefficient,limits});}
 if(v.speedAtLeast)return Object.prototype.hasOwnProperty.call(ja,'route.speed.'+v.speedAtLeast)?t('route.speed.minimum',{speed:speed(v.speedAtLeast)}):node.text;
 if(v.speedIs)return Object.prototype.hasOwnProperty.call(ja,'route.speed.'+v.speedIs)?t('route.speed.exact',{speed:speed(v.speedIs)}):node.text;
 if(v.anyShipSpeed)return Object.prototype.hasOwnProperty.call(ja,'route.speed.'+v.anyShipSpeed.speedIs)?t('route.speed.contains',{speed:speed(v.anyShipSpeed.speedIs)}):node.text;
 for(const key of ['radarCarriers','drumCarriers','landingCraftCarriers','transportEquipCount'])if(v[key])return count(t('route.'+key),v[key]);
 if(v.unknown)return t('route.unknown');
 return node.text||t('route.unknown');
}
// Build an independent presentation tree from the machine predicate without
// evaluating, changing, or translating the original rule. Unsupported future
// shapes return null so callers can retain the complete legacy wording.
function describeExpression(expression){
 const known=['count','shipCount','openingTorpedoCarriers','pathIncludes','allStypes','allHulls',
   'flagshipStype','flagshipName','shipName','los','speedAtLeast','speedIs','anyShipSpeed',
   'radarCarriers','drumCarriers','landingCraftCarriers','transportEquipCount','unknown'];
 const tree=value=>{
  if(value===true||value==='otherwise')return {operator:null,expression:value,text:'',children:[]};
  if(!value||typeof value!=='object')return null;
  const operator=value.all?'all':value.any?'any':value.not?'not':null;
  if(operator){
   const parts=operator==='not'?[value.not]:value[operator];
   if(!Array.isArray(parts))return null;
   const children=parts.map(tree);return children.some(child=>!child)?null:{operator,text:'',children};
  }
  if(!known.some(key=>value[key]))return null;
  return {operator:null,expression:value,text:'',children:[]};
 };
 const node=tree(expression);return node?describeCondition(node):null;
}
module.exports={describeCondition,describeExpression};
