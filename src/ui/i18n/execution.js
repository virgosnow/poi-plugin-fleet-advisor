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
// Codes are supplied by execution; diagnostics keep the original message and
// stack so presentation never changes control flow or discards evidence.
const errors={
 EXPEDITION_RETURN_REQUIRED:['遠征の帰投を検出したため編成を停止しました。ゲーム内で帰投結果を確認し、適用済みの編成を確認してから再試行してください。','偵測到遠征歸港，已停止編成。請先在遊戲中處理歸港，並核對可能已生效的部分編成後再重試。'],
 OBSERVATION_TIMEOUT:['画面の確認がタイムアウトしました。ゲーム内の状態と変更済みの編成・装備を確認し、診断情報をご覧ください。','畫面確認逾時。請核對遊戲狀態與可能已變更的編成、裝備，並查看診斷資訊。'],
 CONTROL_RECOGNITION_UNAVAILABLE:['ゲーム画面の操作部品を確認できません。ゲーム内の状態と変更済みの編成・装備を確認してください。','無法確認遊戲畫面中的操作元件。請核對遊戲狀態與可能已變更的編成、裝備。'],
 PICKER_MODE_UNREADABLE:['装備の取得元を確認できません。ゲーム内の装備状態を確認してから再試行してください。','無法確認裝備來源。請在遊戲中核對裝備狀態後再重試。'],
 EQUIPMENT_CONFIRMATION_TIMEOUT:['ゲームへの操作は確認されましたが、装備の変更結果を確認できませんでした。操作は再送していません。ゲーム内で装備状態を確認してください。','已觀察到遊戲操作，但無法確認裝備變更結果，操作未重複送出。請在遊戲中核對裝備狀態。'],
 NAV_SCREEN_NOT_RECOGNIZED:['現在の画面または母港への戻るボタンを確認できません。ポップアップを閉じ、非表示の画面を戻してから再試行してください。','無法辨識目前畫面或返回母港的按鈕。請關閉遮擋視窗，或恢復隱藏的畫面後再重試。'],
 NAV_RETURN_NOT_CONFIRMED:['母港に戻る操作後、母港画面を確認できなかったため停止しました。操作は繰り返していません。','點擊返回母港後無法確認母港畫面，已停止且未重複點擊。'],
 NAV_UNEXPECTED_SCREEN:['画面遷移後に想定外の画面を検出したため、操作を停止しました。','切換後出現非預期的畫面，已停止操作。'],
 NAV_SWITCH_FAILED:['画面の切り替えに失敗しました。ゲーム内で母港に戻ってから再試行してください。','畫面切換失敗，請在遊戲中返回母港後再重試。'],
 BUSY:['編成または装備変更がすでに実行中です。','已有編成或換裝工作正在執行。'],
 AUTOMATIC_OPERATIONS_DISABLED:['自動操作が無効です。設定の実験機能で自動操作を有効にしてください。','自動操作已關閉，請在設定的實驗功能中開啟。']
};
for(const [locale,index] of [['ja',0],['zh-TW',1]])i18n.registerCatalog(locale,Object.fromEntries(Object.entries(errors).map(([code,value])=>[`execution.error.${code}`,value[index]])));
function failure(status){
 if(i18n.getLocale()==='zh-CN'||!Object.hasOwn(errors,status?.errorCode||''))return i18n.t(status?.text||'');
 return i18n.t(`execution.error.${status.errorCode}`);
}
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
module.exports={progress,failure};
