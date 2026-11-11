'use strict';
// Localize progress only after the execution controller has made its decisions.
// Raw phase identifiers and diagnostic text remain untouched.
const i18n=require('../../shared/i18n');
const common={
 '正在停止后续操作':['後続の操作を停止中','正在停止後續操作'],
 '正在执行编成':['編成を適用中','正在執行編成'],
 '诊断信息':['診断情報','診斷資訊'],'复制诊断':['診断情報をコピー','複製診斷'],
 ' · {seconds} 秒':[' · {seconds}秒',' · {seconds} 秒'],
 '空位':['空き','空位'],'舰船 #{id}':['艦船 #{id}','艦船 #{id}'],
 '控件识别不可用，切换图像识别继续':['操作部品を認識できないため、画像認識に切り替えます','無法辨識操作元件，改用影像辨識繼續'],
 '控件识别超时，正在重新识别':['操作部品の認識がタイムアウト、再認識中','操作元件辨識逾時，正在重新辨識'],
 '正在准备舰队编成':['艦隊編成を準備中','正在準備艦隊編成'],
 '第 {slot} 位 · 已编入 {ship}':['{slot}番艦 · {ship}を編成済み','第 {slot} 位 · 已編入 {ship}'],
 '舰队已编入 · 正在准备换装':['艦隊編成済み · 装備変更を準備中','艦隊已編入 · 正在準備換裝'],
 '正在准备逐舰换装':['各艦の装備変更を準備中','正在準備逐艦換裝'],
 '{ship} · 正在换装':['{ship} · 装備変更中','{ship} · 正在換裝'],
 '{ship} · 已完成 {completed} / {total} 步':['{ship} · {completed} / {total} 操作完了','{ship} · 已完成 {completed} / {total} 步'],
 '{ship} · 已换装完毕':['{ship} · 装備変更完了','{ship} · 已換裝完畢'],
 '正在配置基地航空队第 {base} 队':['基地航空隊 第{base}部隊を編成中','正在配置基地航空隊第 {base} 隊'],
 '舰队编成与换装已完成':['艦隊編成と装備変更が完了','艦隊編成與換裝已完成'],
 '第 {fleet} 舰队 · 正在解除随伴舰':['第{fleet}艦隊 · 随伴艦を解除中','第 {fleet} 艦隊 · 正在解除隨伴艦'],
 '第 {fleet} 舰队 · 正在移除第 {slot} 位多余舰娘':['第{fleet}艦隊 · {slot}番艦を解除中','第 {fleet} 艦隊 · 正在移除第 {slot} 位多餘艦娘'],
 '第 {slot} 位 · 正在定位 {ship}':['{slot}番艦 · {ship}を検索中','第 {slot} 位 · 正在定位 {ship}'],
 '解除普通槽装备':['通常スロットの装備を解除','解除普通裝備格的裝備'],
 '调整补强增设':['補強増設を変更','調整補強增設'],
 '调整普通槽 {slot}':['通常スロット {slot} を変更','調整普通裝備格 {slot}'],
 '正在返回母港':['母港に戻っています','正在返回母港'],'正在核对游戏状态':['ゲーム状態を確認中','正在核對遊戲狀態']
};
for(const [locale,index] of [['ja',0],['zh-TW',1]])i18n.registerCatalog(locale,Object.fromEntries(Object.entries(common).map(([key,value])=>[key,value[index]])));
function name(state,id){
 if(!id||id<0)return i18n.t('空位');
 const ship=state?.info?.ships?.[id],master=state?.const?.$ships?.[ship?.api_ship_id];
 return master?`${master.api_name} · Lv.${ship.api_lv}`:i18n.t('舰船 #{id}',{id});
}
function progress(p,state){
 if(!p)return '';
 const t=i18n.t,ship=()=>name(state,p.ship);
 switch(p.phase){
  case 'recognition-fallback':return t('控件识别不可用，切换图像识别继续');
  case 'recognition-retry':return t('控件识别超时，正在重新识别');
  case 'organization-start':return t('正在准备舰队编成');
  case 'organized':return t('第 {slot} 位 · 已编入 {ship}',{slot:p.slot,ship:ship()});
  case 'organization-ready':return t('舰队已编入 · 正在准备换装');
  case 'equipment-start':return t('正在准备逐舰换装');
  case 'equipment-ship':return t('{ship} · 正在换装',{ship:ship()});
  case 'equipment-step':return t('{ship} · 已完成 {completed} / {total} 步',{ship:ship(),completed:p.completed,total:p.total});
  case 'equipment-done':return t('{ship} · 已换装完毕',{ship:ship()});
  case 'land-base':return t('正在配置基地航空队第 {base} 队',{base:p.base});
  case 'fleet-complete':return t('舰队编成与换装已完成');
  case 'clear-escorts':return t('第 {fleet} 舰队 · 正在解除随伴舰',{fleet:p.fleet});
  case 'remove-escort':return t('第 {fleet} 舰队 · 正在移除第 {slot} 位多余舰娘',{fleet:p.fleet,slot:p.slot});
  case 'picker':return t('第 {slot} 位 · 正在定位 {ship}',{slot:p.slot,ship:name(state,p.target)});
  // p.detail is supplied by execution and may contain instance/game names;
  // preserve it until its own structured event becomes available.
  case 'equipment':return p.detail||`${ship()} · ${p.slot==='all'?t('解除普通槽装备'):p.slot==='ex'?t('调整补强增设'):t('调整普通槽 {slot}',{slot:p.slot})}`;
  case 'return-home':return t('正在返回母港');
  default:return t('正在核对游戏状态');
 }
}
module.exports={progress};
