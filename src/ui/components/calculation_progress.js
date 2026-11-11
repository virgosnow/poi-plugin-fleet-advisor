'use strict';
const {t,registerCatalog}=require('../../shared/i18n');
const progressLabels={prepare:'准备舰队资料与计算环境',hulls:'筛选舰娘',seeds:'评估候选编成',gear:'规划装备',
  'path-fit':'核对路线配装','speed-fit':'调整舰队航速','speed-refit':'复核航速与配装','los-fit':'调整索敌装备',
  practice:'筛选演习编成与配装',combat:'评估战力',refinement:'优化编成',expedition:'准备远征计算','expedition-candidates':'筛选远征编成',
  'expedition-fit':'规划远征装备与收益','expedition-rescue':'补充搜索远征编成','expedition-wait':'核对另一种远征目标',
  prepareEquipment:'准备装备资料',equipment:'计算装备',finalize:'核对结果',verify:'核对结果',complete:'计算完成'};
registerCatalog('ja',{
  '准备舰队资料与计算环境':'艦隊データと計算環境を準備中','筛选舰娘':'艦娘を選定中','评估候选编成':'編成候補を評価中','规划装备':'装備を検討中',
  '核对路线配装':'ルートと装備を確認中','调整舰队航速':'艦隊速力を調整中','复核航速与配装':'速力と装備を再確認中','调整索敌装备':'索敵装備を調整中',
  '筛选演习编成与配装':'演習編成と装備を選定中','评估战力':'戦力を評価中','优化编成':'編成を最適化中','准备远征计算':'遠征の計算を準備中',
  '筛选远征编成':'遠征編成を選定中','规划远征装备与收益':'遠征装備と収支を検討中','补充搜索远征编成':'遠征編成を追加検索中','核对另一种远征目标':'別の遠征目標を確認中',
  '准备装备资料':'装備データを準備中','计算装备':'装備を計算中','核对结果':'結果を確認中','计算完成':'計算完了','正在计算':'計算中'
});
registerCatalog('zh-TW',{
  '准备舰队资料与计算环境':'準備艦隊資料與計算環境','筛选舰娘':'篩選艦娘','评估候选编成':'評估候選編成','规划装备':'規劃裝備',
  '核对路线配装':'核對路線配裝','调整舰队航速':'調整艦隊航速','复核航速与配装':'複核航速與配裝','调整索敌装备':'調整索敵裝備',
  '筛选演习编成与配装':'篩選演習編成與配裝','评估战力':'評估戰力','优化编成':'最佳化編成','准备远征计算':'準備遠征計算',
  '筛选远征编成':'篩選遠征編成','规划远征装备与收益':'規劃遠征裝備與收益','补充搜索远征编成':'補充搜尋遠征編成','核对另一种远征目标':'核對另一種遠征目標',
  '准备装备资料':'準備裝備資料','计算装备':'計算裝備','核对结果':'核對結果','计算完成':'計算完成','正在计算':'計算中'
});
function createCalculationProgress(){
  // Search branches and fitting passes are decided as the calculation runs,
  // so these stage weights estimate overall progress rather than count a
  // fixed total. Repeated stages and fallback searches must never go backward.
  // Between worker updates, elapsed time advances the estimate conservatively;
  // it cannot reach completion until the actual result has been accepted.
  let percent=0,lastStage='',expeditionPass=0;
  const ranges={prepare:[1,1],prepareEquipment:[1,1],hulls:[4,18],seeds:[18,48],gear:[48,64],
    'path-fit':[64,78],'speed-fit':[64,78],'speed-refit':[68,80],'los-fit':[72,82],
    practice:[5,5],combat:[80,87],refinement:[87,93],expedition:[3,3],'expedition-wait':[88,88],
    equipment:[5,5],finalize:[95,95],verify:[97,97]};
  return {
    update(value){
      const stage=value?.stage||'prepare';
      if(stage==='expedition-candidates'&&lastStage!==stage)expeditionPass++;
      lastStage=stage;
      const pass=expeditionPass>1;
      const range=stage==='expedition-candidates'?(pass?[55,55]:[8,8]):
        stage==='expedition-fit'?(pass?[78,78]:[42,42]):stage==='expedition-rescue'?(pass?[86,86]:[52,52]):ranges[stage]||[percent,percent];
      const done=Number(value?.completed),total=Number(value?.total);
      const fraction=total>0&&Number.isFinite(done)?Math.max(0,Math.min(1,done/total)):0;
      percent=Math.max(percent,Math.min(97,Math.floor(range[0]+(range[1]-range[0])*fraction)));
      return `${progressLabels[stage]||'正在计算'} · 预计总进度 ${percent}%`;
    },
    tick(){
      if(percent>=94)return null;
      percent=Math.min(94,percent+Math.max(1,Math.floor((94-percent)*0.04)));
      return `${progressLabels[lastStage]||'正在计算'} · 预计总进度 ${percent}%`;
    },
    complete(){percent=100;lastStage='complete';return `${progressLabels.complete} · 预计总进度 100%`;},
    // Keep the legacy text channel while exposing language-independent data.
    snapshot(){return {stage:lastStage||'prepare',percent};}
  };
}
function createProgressComponent(React){
  const h=React.createElement;
  return function CalculationProgress({channel}){
    const [value,setValue]=React.useState(channel.value);
    React.useEffect(()=>{channel.listeners.add(setValue);setValue(channel.value);return()=>channel.listeners.delete(setValue);},[channel]);
    if(!value)return null;
    const state=channel.progress;
    const structured=state&&Number.isFinite(state.percent)&&state.percent>=0&&state.percent<=100;
    // Older integrations still receive their existing textual fallback; new
    // publishers pass the stage and percentage separately from the wording.
    const match=structured?[null,t(progressLabels[state.stage]||'正在计算'),`${state.percent}%`]:
      /^(.*?)\s*·\s*预计总进度\s+(\d+%)$/.exec(value);
    return h('span',{className:'paa-wb-calculation-detail'},match?
      [h('strong',{key:'percentage',className:'paa-wb-calculation-percent'},match[2]),
        h('span',{key:'track',className:'paa-wb-calculation-track','aria-hidden':true},
          h('span',{className:'paa-wb-calculation-fill',style:{width:match[2]}})),
        h('small',{key:'stage',className:'paa-wb-calculation-stage'},match[1])]:
      h('small',{className:'paa-wb-calculation-stage'},value));
  }
}
module.exports={createCalculationProgress,createProgressComponent};
