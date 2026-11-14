'use strict';
// Display-only adapter for structured missing-routing-ship diagnostics. The
// legacy Chinese string remains the authoritative compatibility fallback.
const {t,registerCatalog,getLocale}=require('../../shared/i18n');
const {describeCondition,describeExpression}=require('./route_conditions');
registerCatalog('ja',{
 'route.missing.start':'出撃地点','route.missing.fullSuffix':' 必要なルート指定艦が不足：',
 'route.missing.count':'（{count}隻必要）','route.missing.notOwned':'未所持','route.missing.available':'{name} Lv.{level} 使用可能',
 'route.missing.excludedCompact':'{name} Lv.{level}（{reasons}、除外済み）','route.missing.excludedFull':'{name} Lv.{level} は所持済みですが除外されています：{reasons}',
 'route.missing.availableCount':'使用可能 {available}/{minimum} 隻（同じ艦の複数保有は重複計上しません）',
 'route.missing.choice':'案 {number}：{requirements}','route.missing.choiceOr':'；または ',
 'route.missing.setting':'出撃設定「{reason}」','route.missing.manual':'手動で除外','route.missing.busy':'{reason}、現在は編成不可',
 'route.missing.unavailable':'現在は編成不可','route.missing.missingShip':'艦娘が存在しません','route.missing.minimumLevel':'レベル {minimum} 未満',
 'route.missing.unremodeled':'未改装','route.missing.expedition':'遠征中','route.missing.repairing':'入渠中','route.missing.unlocked':'未ロック',
 'route.missing.heavyDamage':'大破','route.missing.fatigued':'疲労度 40 未満','route.missing.firstFleet':'第1艦隊所属','route.missing.fleetShips':'艦隊所属艦'
});
registerCatalog('zh-TW',{
 'route.missing.start':'出發點','route.missing.fullSuffix':' 缺少可用導航艦：',
 'route.missing.count':'（需 {count} 艘）','route.missing.notOwned':'未持有','route.missing.available':'{name} Lv.{level} 可用',
 'route.missing.excludedCompact':'{name} Lv.{level}（{reasons}，已排除）','route.missing.excludedFull':'{name} Lv.{level} 已持有，但被排除：{reasons}',
 'route.missing.availableCount':'可用 {available}/{minimum} 艘（同艦不同個體不重複計數）',
 'route.missing.choice':'方案 {number}：{requirements}','route.missing.choiceOr':'；或 ',
 'route.missing.setting':'出擊設定「{reason}」','route.missing.manual':'手動排除','route.missing.busy':'{reason}，目前無法編入',
 'route.missing.unavailable':'目前無法編入','route.missing.missingShip':'艦娘不存在','route.missing.minimumLevel':'等級低於 {minimum}',
 'route.missing.unremodeled':'未改造','route.missing.expedition':'遠征中','route.missing.repairing':'入渠中','route.missing.unlocked':'未上鎖',
 'route.missing.heavyDamage':'大破','route.missing.fatigued':'士氣低於 40','route.missing.firstFleet':'第一艦隊成員','route.missing.fleetShips':'編隊內的艦娘'
});
registerCatalog('ja',{
 'route.blocked.stageNotOpen':'この段階では該当マスは未開放','route.blocked.stageUnknown':'この段階で該当マスが開放済みかは未確認',
 'route.blocked.tentative':'ルールのサンプル不足：{reason}','route.blocked.unknownExit':'行き先は要確認',
 'route.blocked.matched':'現在の編成が該当：{condition} → {destinations}',
 'route.blocked.fixed':'現在は {destination} に固定','route.blocked.unknownRule':'このマスの分岐ルールは未確認',
 'route.blocked.require':'；必要条件 {conditions}','route.blocked.or':' または ',
 'route.blocked.chance':'；{chance}% で {destinations} に進み、外れた場合は判定続行',
 'route.blocked.los':'33式索敵（係数 {coefficient}） ≥ {required}',
 'route.blocked.strategySpeed':'編成方針の速力条件：全艦{speed}統一。現在の装備では満たしていません。',
 'route.blocked.strategyRadar':'編成方針の電探条件：少なくとも{count}隻に電探が必要です。現在の装備では満たしていません。',
 'route.blocked.fleetRequirement':'編成条件：{condition}。現在の編成では満たしていません。',
 'route.blocked.incompatible':'{path}：ルートの組み合わせに矛盾。{reason}'
});
registerCatalog('zh-TW',{
 'route.blocked.stageNotOpen':'目前階段尚未開放此節點','route.blocked.stageUnknown':'目前階段是否開放此節點待確認',
 'route.blocked.tentative':'規則樣本不足：{reason}','route.blocked.unknownExit':'出口待確認',
 'route.blocked.matched':'目前命中：{condition} → {destinations}',
 'route.blocked.fixed':'目前固定前往 {destination}','route.blocked.unknownRule':'此點的導航規則尚未確認',
 'route.blocked.require':'；需要 {conditions}','route.blocked.or':' 或 ',
 'route.blocked.chance':'；{chance}% 前往 {destinations}，否則繼續判斷',
 'route.blocked.los':'33 式索敵（係數 {coefficient}） ≥ {required}',
 'route.blocked.strategySpeed':'流派速力要求：全隊{speed}統一；目前配裝未達到。',
 'route.blocked.strategyRadar':'流派電探要求：至少 {count} 艘攜帶電探；目前配裝未達到。',
 'route.blocked.fleetRequirement':'攻略編成要求：{condition}；目前編成未滿足。',
 'route.blocked.incompatible':'{path}：路線組合不相容，{reason}'
});
// Reviewed translations are keyed by the reason's stable data identifier.
// A changed meaning must receive a new ID; unknown IDs retain the full text.
const incompatible={
 '6-2:C>D>H':{ja:'C→Dには戦艦級と空母系が計3隻以上必要ですが、D→Hでは両方とも0隻が必要なため条件が矛盾します。',tw:'C→D 要求戰艦級與空母系合計至少 3 艘；D→H 要求兩者均為 0 艘，條件矛盾。'},
 '7-2:start>A>B>C>E>G':{ja:'Aに進む艦種・隻数ではC→Eの条件を満たせないか、補給艦・潜水艦の条件で先にDへ向かいます。',tw:'進入 A 的艦種與數量條件無法再滿足 C→E，或因補給艦／潛水艦條件提前轉往 D。'},
 '7-2:start>C>D>I>M':{ja:'Cへ直行してDに進むには補給艦が必要です。Iでは先にJへ向かうため、Mには到達できません。',tw:'直達 C 且能轉往 D 的編成必須包含補給艦；I 點會提前轉往 J，無法抵達 M。'},
 '7-2:start>C>D>H':{ja:'Cへ直行してDに進むには補給艦を含み大型艦が最大1隻の編成が必要で、DからHには進めません。',tw:'直達 C 且能轉往 D 的編成必須包含補給艦且大型艦最多 1 艘；D 不可能轉往 H。'},
 '7-4:start>C>E>G':{ja:'E→Gは補給艦・揚陸艦と海防艦または練習巡洋艦による護衛6隻編成に限られ、この編成は出撃地点からAに固定されます。',tw:'E→G 限定補給艦／揚陸艦與海防艦或練巡護航的 6 艦編成，此編成出發後固定前往 A。'},
 '7-4:start>C>E>J>P':{ja:'J→Pを通れる海防艦・駆逐艦・大鷹型・練習巡洋艦の編成は、出撃地点→CとC→Eを同時に満たせません。CからJへはL/Kを経由します。',tw:'J→P 允許的海防艦／驅逐艦／大鷹型／練巡編成，無法同時滿足出發到 C 和 C→E；經 C 到 J 需走 L/K。'}
};
const codes=new Set(['missingShip','minimumLevel','unremodeled','expedition','repairing','unlocked','heavyDamage','fatigued','firstFleet','fleetShips']);
function formatReason(entry,compact){
 if(entry?.origin==='manual')return t('route.missing.manual');
 const reason=entry?.reason;if(!reason||!codes.has(reason.code))return null;
 const text=t('route.missing.'+reason.code,reason);
 if(entry.origin==='setting')return compact?text:t('route.missing.setting',{reason:text});
 if(entry.origin==='busy')return t('route.missing.busy',{reason:text});
 return null;
}
function formatRequirement(item,compact){
 if(!Array.isArray(item?.prefixes)||!Array.isArray(item?.ships)||!Array.isArray(item?.missingPrefixes))return null;
 const label=item.prefixes.join(' / ')+(item.prefixes.length>1?t('route.missing.count',{count:item.min}):'');
 if(item.missingAll)return `${label}：${t('route.missing.notOwned')}`;
 const ships=[];
 for(const ship of item.ships){
  if(ship.available){ships.push(t('route.missing.available',{name:ship.name,level:ship.level}));continue;}
  if(!Array.isArray(ship.reasons))return null;
  const rendered=ship.reasons.map(entry=>formatReason(entry,compact));if(rendered.some(value=>value===null))return null;
  const reasons=rendered.join('、')||t('route.missing.unavailable');
  ships.push(t(compact?'route.missing.excludedCompact':'route.missing.excludedFull',{name:ship.name,level:ship.level,reasons}));
 }
 const missing=item.missingPrefixes.map(prefix=>`${prefix}：${t('route.missing.notOwned')}`);
 return (item.prefixes.length>1?label+'：':'')+[...ships,...missing].join('；')+
   (item.min>1?'；'+t('route.missing.availableCount',{available:item.available,minimum:item.min}):'');
}
function formatMissingRoutingShips(detail){
 if(getLocale()==='zh-CN'||detail?.code!=='missingRoutingShips')return detail?.text||'';
 if(!Array.isArray(detail.choices)||!detail.choices.length)return detail.text||'';
 const choices=[];
 for(const items of detail.choices){
  if(!Array.isArray(items)||!items.length)return detail.text||'';
  const parts=items.map(item=>formatRequirement(item,detail.compact));
  if(parts.some(value=>value===null))return detail.text||'';
  choices.push(parts.join('；'));
 }
 const from=detail.from==='start'?t('route.missing.start'):detail.from;
 const prefix=`${from} → ${detail.to}`+(detail.compact?'：':t('route.missing.fullSuffix'));
 const message=choices.length===1?choices[0]:choices.map((choice,i)=>t('route.missing.choice',{number:i+1,requirements:choice})).join(t('route.missing.choiceOr'));
 return prefix+message;
}
function formatRule(detail){
 if(detail?.code==='losMinimum')return t('route.blocked.los',{coefficient:detail.coefficient,required:detail.required});
 if(detail?.code!=='rule'||!detail.conditionTree)return null;
 let text=describeCondition(detail.conditionTree);
 if(Number.isFinite(detail.chance))text+=t('route.blocked.chance',{
   chance:Math.round(detail.chance*10000)/100,destinations:detail.destinations});
 return text;
}
function formatBlockedRoute(detail){
 if(getLocale()==='zh-CN')return detail?.text||'';
 if(detail?.code==='fleetRequirement'){
   const condition=describeExpression(detail.expression);
   return condition===null?detail.text||'':t('route.blocked.fleetRequirement',{condition});
 }
 if(detail?.code==='incompatiblePath'){
   if(!Array.isArray(detail.nodes))return detail.text||'';
   const expectedId=detail.area+':'+detail.nodes.join('>');
   const found=detail.reasonId===expectedId?incompatible[detail.reasonId]:null;
   if(!found)return detail.text||'';
   const path=detail.nodes.map(node=>node==='start'?t('route.missing.start'):node).join('→');
   return t('route.blocked.incompatible',{path,reason:getLocale()==='ja-JP'?found.ja:found.tw});
 }
 if(detail?.code==='strategySpeed')return ['fast','fastPlus','fastest'].includes(detail.minimumSpeed)?
   t('route.blocked.strategySpeed',{speed:t('route.speed.'+detail.minimumSpeed)}):detail.text||'';
 if(detail?.code==='strategyRadar')return Number.isFinite(detail.radarCarriers)?
   t('route.blocked.strategyRadar',{count:detail.radarCarriers}):detail.text||'';
 if(detail?.code!=='routeBlocked')return detail?.text||'';
 const current=detail.current;if(!current||!Array.isArray(detail.requirements))return detail.text||'';
 let text;
 if(current.code==='stageNotOpen'||current.code==='stageUnknown'||current.code==='unknownRule')text=t('route.blocked.'+current.code);
 else if(current.code==='fixed')text=t('route.blocked.fixed',{destination:current.destination});
 else if(current.code==='matched'){
   // Unknown free-text reasons can come from external rule data; do not guess.
   if(current.reason)return detail.text||'';
   const condition=formatRule({...current,code:'rule'});if(condition===null)return detail.text||'';
   text=t('route.blocked.matched',{condition,destinations:current.destinations});
 }else if(current.code==='tentative'){
   if(current.reason)return detail.text||'';
   const reason=current.reasonCode==='unknownExit'?t('route.blocked.unknownExit'):
     formatRule({...current,code:'rule'});
   if(reason===null)return detail.text||'';
   text=t('route.blocked.tentative',{reason});
 }else return detail.text||'';
 const requirements=detail.requirements.map(formatRule);
 if(requirements.some(value=>value===null))return detail.text||'';
 const from=detail.from==='start'?t('route.missing.start'):detail.from;
 return `${from} → ${detail.to}：${text}`+(requirements.length?t('route.blocked.require',{conditions:requirements.join(t('route.blocked.or'))}):'');
}
module.exports={formatMissingRoutingShips,formatBlockedRoute};
