'use strict';
const {t,registerCatalog}=require('../../shared/i18n');
registerCatalog('ja',{
  '本轮未找到同时满足攻略舰种、练度、关键装备和可达路线的编成；可调整固定舰娘、装备或制空目标':'艦種・練度・装備・到達ルートの条件を満たす編成が見つかりません。指定艦娘や装備、制空目標を調整してください',
  '本轮未找到同时满足已选任务及路线条件的编成，请调整勾选任务或固定舰娘。':'選択した任務とルートの条件を満たす編成が見つかりません。任務または指定艦娘を調整してください。',
  '本轮未找到同时满足已选任务和远征条件的编成，请调整勾选任务或固定舰娘。':'選択した任務と遠征の条件を満たす編成が見つかりません。任務または指定艦娘を調整してください。',
  '在本轮有界搜索中未找到到达率可确认的可用编成；不等于不存在解':'今回の探索では到達率を確認できる編成が見つかりませんでした。解が存在しないとは限りません',
  '没有找到合适的编成':'適切な編成が見つかりません',
  '未找到达标方案，已提供最接近的参考编成；请调整未满足的出航条件':'条件を満たす編成がないため、最も近い参考編成を表示します。未達の出撃条件を調整してください',
  '未找到可预览的参考编成；请检查可用舰娘、排除设置与固定舰娘':'参考編成が見つかりません。使用可能な艦娘、除外設定、指定艦娘を確認してください',
  '演习舰队规模应为 1 至 6 艘':'演習艦隊は1～6隻にしてください',
  '舰队草稿格式无效':'艦隊の編成案が不正です',
  '目标练级舰娘须为不重复的舰娘实例 ID':'育成対象は重複しない艦娘を選択してください',
  '当前已选 {count} 艘舰娘，超过设定的 {capacity} 艘；请调整舰队规模或移除舰娘':'選択中の艦娘は{count}隻で、設定の{capacity}隻を超えています。艦隊規模を変更するか艦娘を外してください',
  '已选舰娘的舰位超过 {capacity} 艘，请调整舰队':'選択した艦娘の位置が{capacity}隻を超えています。艦隊を調整してください',
  '手动选择和目标练级舰娘共 {count} 艘，超过 {capacity} 艘；请移除部分舰娘':'指定艦娘と育成対象は計{count}隻で、{capacity}隻を超えています。一部の艦娘を外してください',
  '没有符合演习设置的可用舰娘':'演習設定に合う艦娘がいません',
  '可用舰娘不足，无法保留已选舰娘的位置':'艦娘が不足しているため、選択艦娘の位置を維持できません',
  '预选舰娘与任务条件冲突':'指定艦娘と任務条件が一致しません',
  '未找到同时满足所选演习任务和固定舰娘的编成，请检查舰娘、装备与筛选设置':'選択した演習任務と指定艦娘の条件を満たす編成が見つかりません。艦娘・装備・除外設定を確認してください',
  '全局排除：{items}。可到设置调整':'除外設定：{items}。設定で変更できます',
  '编队内的舰娘':'艦隊所属艦',
  '等级低于 {level}':'練度 {level} 未満','未改造':'未改造','远征中':'遠征中','入渠中':'入渠中','未锁定':'未ロック','大破':'大破','士气低于 40':'疲労中','第一舰队成员':'第1艦隊所属','舰娘不存在':'艦娘データなし','{reason} {count} 艘':'{reason} {count}隻'
});
registerCatalog('zh-TW',{
  '本轮未找到同时满足攻略舰种、练度、关键装备和可达路线的编成；可调整固定舰娘、装备或制空目标':'本次未找到同時滿足艦種、練度、關鍵裝備及可達路線的編成；可調整指定艦娘、裝備或制空目標',
  '本轮未找到同时满足已选任务及路线条件的编成，请调整勾选任务或固定舰娘。':'本次未找到同時滿足已選任務及路線條件的編成，請調整勾選任務或指定艦娘。',
  '本轮未找到同时满足已选任务和远征条件的编成，请调整勾选任务或固定舰娘。':'本次未找到同時滿足已選任務和遠征條件的編成，請調整勾選任務或指定艦娘。',
  '在本轮有界搜索中未找到到达率可确认的可用编成；不等于不存在解':'本次搜尋未找到可確認抵達率的編成；不代表不存在解',
  '没有找到合适的编成':'找不到合適的編成','全局排除：{items}。可到设置调整':'全域排除：{items}。可至設定調整',
  '编队内的舰娘':'編隊內的艦娘',
  '未找到达标方案，已提供最接近的参考编成；请调整未满足的出航条件':'未找到達標方案，已提供最接近的參考編成；請調整未滿足的出航條件',
  '未找到可预览的参考编成；请检查可用舰娘、排除设置与固定舰娘':'未找到可預覽的參考編成；請檢查可用艦娘、排除設定與指定艦娘',
  '演习舰队规模应为 1 至 6 艘':'演習艦隊規模應為 1 至 6 艘',
  '舰队草稿格式无效':'艦隊草稿格式無效',
  '目标练级舰娘须为不重复的舰娘实例 ID':'目標練級艦娘不可重複',
  '当前已选 {count} 艘舰娘，超过设定的 {capacity} 艘；请调整舰队规模或移除舰娘':'目前已選 {count} 艘艦娘，超過設定的 {capacity} 艘；請調整艦隊規模或移除艦娘',
  '已选舰娘的舰位超过 {capacity} 艘，请调整舰队':'已選艦娘的艦位超過 {capacity} 艘，請調整艦隊',
  '手动选择和目标练级舰娘共 {count} 艘，超过 {capacity} 艘；请移除部分舰娘':'手動選擇和目標練級艦娘共 {count} 艘，超過 {capacity} 艘；請移除部分艦娘',
  '没有符合演习设置的可用舰娘':'沒有符合演習設定的可用艦娘',
  '可用舰娘不足，无法保留已选舰娘的位置':'可用艦娘不足，無法保留已選艦娘的位置',
  '预选舰娘与任务条件冲突':'預選艦娘與任務條件衝突',
  '未找到同时满足所选演习任务和固定舰娘的编成，请检查舰娘、装备与筛选设置':'未找到同時滿足所選演習任務和指定艦娘的編成，請檢查艦娘、裝備與篩選設定',
  '等级低于 {level}':'等級低於 {level}','未改造':'未改造','远征中':'遠征中','入渠中':'入渠中','未锁定':'未鎖定','大破':'大破','士气低于 40':'士氣低於 40','第一舰队成员':'第一艦隊成員','舰娘不存在':'艦娘不存在','{reason} {count} 艘':'{reason} {count} 艘'
});
const labels={missingShip:'舰娘不存在',unremodeled:'未改造',expedition:'远征中',repairing:'入渠中',unlocked:'未锁定',heavyDamage:'大破',fatigued:'士气低于 40',firstFleet:'第一舰队成员',fleetShips:'编队内的舰娘'};
const practiceLabels={PRACTICE_CAPACITY_INVALID:'演习舰队规模应为 1 至 6 艘',PRACTICE_DRAFT_INVALID:'舰队草稿格式无效',PRACTICE_TRAINING_INVALID:'目标练级舰娘须为不重复的舰娘实例 ID',
  PRACTICE_FIXED_OVER_CAPACITY:'当前已选 {count} 艘舰娘，超过设定的 {capacity} 艘；请调整舰队规模或移除舰娘',
  PRACTICE_POSITION_OVER_CAPACITY:'已选舰娘的舰位超过 {capacity} 艘，请调整舰队',
  PRACTICE_TARGETS_OVER_CAPACITY:'手动选择和目标练级舰娘共 {count} 艘，超过 {capacity} 艘；请移除部分舰娘',
  PRACTICE_NO_SHIPS:'没有符合演习设置的可用舰娘',PRACTICE_POSITIONS_UNAVAILABLE:'可用舰娘不足，无法保留已选舰娘的位置',
  PRACTICE_QUEST_CONFLICT:'预选舰娘与任务条件冲突',PRACTICE_QUEST_NO_FLEET:'未找到同时满足所选演习任务和固定舰娘的编成，请检查舰娘、装备与筛选设置'};
function practiceError(error,fallback){
  return practiceLabels[error?.code]?{kind:'practiceError',code:error.code,details:error.details||{}}:error?.message||fallback;
}
function recommendationError(result,fallback){
  const base=result.reasonBase||result.reason||result.message||fallback,details=result.selectionFilters?.details||[];
  return details.length?{kind:'recommendationError',base,details}:base;
}
function formatError(error){
  if(error?.kind==='practiceError')return t(practiceLabels[error.code],error.details);
  if(!error||error.kind!=='recommendationError')return t(error);
  const items=error.details.map(detail=>{
    const reason=detail.code==='minimumLevel'?t('等级低于 {level}',{level:detail.minimum}):t(labels[detail.code]||detail.code);
    return t('{reason} {count} 艘',{reason,count:detail.count});
  });
  return [t(error.base),items.length?t('全局排除：{items}。可到设置调整',{items:items.join('、')}):''].filter(Boolean).join('；');
}
module.exports={recommendationError,practiceError,formatError};
