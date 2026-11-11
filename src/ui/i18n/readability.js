'use strict';
// Compact, presentation-only copy. Keep identifiers and game names unchanged.
const {registerCatalog}=require('../../shared/i18n');
const entries={
  'readability.and': ['且','かつ','且'],
  'readability.resourceRewards': ['资源报酬','資源報酬','資源報酬'],
  'readability.fixedRewards': ['固定报酬','確定報酬','固定報酬'],
  'readability.fleetUnrestricted': ['自由编成','編成自由','自由編成'],
  'readability.fleetUnknown': ['编成要求待确认','編成条件は要確認','編成要求待確認'],
  'readability.borrowHelp':[
    '不借用：仓库及本队\n允许借用：含入渠舰；不含远征舰\n排除条件只影响自动选船，不改草稿',
    '借用しない：装備在庫と編成艦\n借用する：入渠中は可、遠征中は不可\n除外条件は自動選択のみ。下書きは保持',
    '不借用：倉庫及本隊\n允許借用：含入渠艦；不含遠征艦\n排除條件只影響自動選船，不改草稿'],
  'readability.expeditionHelp':[
    '切换远征时使用默认目标\n排除条件只影响推荐，不改已有编成',
    '遠征変更時に既定の目標を選択\n除外条件は推薦のみ。編成は保持',
    '切換遠征時使用預設目標\n排除條件只影響推薦，不改已有編成'],
  'readability.computeHelp':[
    '默认设置适用于大多数情况\n线程越多可能更快，也更占资源\n调低线程不影响推荐质量',
    '通常は初期設定で十分です\nスレッドを増やすと速くなる一方、負荷も増えます\nスレッド数は推薦品質に影響しません',
    '預設設定適用於大多數情況\n執行緒越多可能更快，也更佔資源\n調低執行緒不影響推薦品質'],
  'readability.cacheHelp':[
    '各类缓存共用磁盘上限\n清理游戏数据会删除本地任务记录\n清理不改变游戏舰队、预设或设置；日志可单独清理',
    '各キャッシュは容量上限を共有\nゲームデータを削除するとローカル任務記録も消去\n艦隊・編成記録・設定は変わりません。ログは個別削除可',
    '各類快取共用磁碟上限\n清除遊戲資料會刪除本機任務紀錄\n清除不改變遊戲艦隊、預設或設定；日誌可個別清除'],
  'readability.mcpHelp':[
    '仅本机 Streamable HTTP，无需认证头\n更改端口后，需同步修改 AI 工具地址',
    'ローカルの Streamable HTTP のみ。認証ヘッダー不要\nポート変更時は AI ツールの接続先も更新',
    '僅限本機 Streamable HTTP，無需驗證標頭\n變更連接埠後，需同步修改 AI 工具網址'],
  'readability.routeGuide':[
    '规则按顺序判断；概率未命中则继续判断。随机分歧不保证出口。',
    '上から順に判定。確率判定に外れると次へ進みます。ランダム分岐は出口を保証しません。',
    '規則依序判定；機率未命中時繼續。隨機分歧不保證出口。'],
  'readability.routeOff': ['不走所选出口','選択出口以外','不走所選出口'],
  'readability.airLoad': ['当前搭载','現在の搭載数','目前搭載'],
  'readability.airFull': ['出击前满载','出撃前の満載','出擊前滿載'],
  'readability.airRange': ['熟练度等未知，保留区间','熟練度など未確定のため範囲表示','熟練度等未知，保留區間'],
  'readability.airLoss': ['道中损耗为估算；分支显示可能范围','道中損耗は推定。分岐は可能な範囲を表示','道中損耗為估算；分歧顯示可能範圍'],
  'readability.losCurrent': ['带路按各节点系数与门槛','ルート判定は各マスの係数と閾値','帶路依各節點係數與門檻'],
  'readability.resourceFull': ['满补给、满载；弹药为昼战至夜战范围','補給・搭載最大。弾薬は昼戦～夜戦の範囲','滿補給、滿載；彈藥為晝戰至夜戰範圍']
};
for(const [key,values] of Object.entries(entries))for(const [i,locale] of ['zh-CN','ja-JP','zh-TW'].entries())registerCatalog(locale,{[key]:values[i]});
