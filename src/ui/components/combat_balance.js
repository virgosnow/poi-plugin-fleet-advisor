'use strict';
const {LABELS}=require('../../domain/combat/combat_balance');
// Missing evidence is not an even battle. An estimated comparison is a
// model reference, not an empirically measured victory or retreat rate.
const TIER_MARKS={
  '压倒性优势':['M2 2.5 5.5 6 2 9.5','M6 2.5 9.5 6 6 9.5'],
  '明显优势':['M4 2.5 7.5 6 4 9.5'],
  '势均力敌':['M6 2 10 6 6 10 2 6Z'],
  '明显劣势':['M8 2.5 4.5 6 8 9.5'],
  '压倒性劣势':['M10 2.5 6.5 6 10 9.5','M6 2.5 2.5 6 6 9.5']
};
function validBalance(assessment){
  return ['ready','estimated'].includes(assessment?.status)&&assessment?.balance&&
    Number.isFinite(assessment.balance.blueShare)&&assessment.balance.blueShare>=0&&assessment.balance.blueShare<=1&&
    LABELS.includes(assessment.balance.label);
}
function renderTier(h,assessment){
  if(!validBalance(assessment))return null;
  const {label}=assessment.balance;
  return h('strong',{className:'paa-balance-tier','data-tier':label,
    'aria-label':`路线战况预测：${label}，参考对比，不代表胜率或通过率`},
    h('svg',{viewBox:'0 0 12 12','aria-hidden':true,focusable:false},
      ...TIER_MARKS[label].map((d,i)=>h('path',{key:i,d}))),label);
}
function renderCombatBalance(h,assessment){
  if(!validBalance(assessment)){
    const text=({partial:'部分待确认',unselected:'选择路线',empty:'选择舰娘',pending:'计算中',awaitingCompletion:'一键补全后计算',unreachable:'当前编成无法沿此路线到达'})[assessment?.status]||'战况预测待确认';
    return h('div',{className:'paa-balance-pending',role:'status','aria-label':`路线战况预测：${text}`},
      h('div',{className:'paa-balance-labels','aria-hidden':true},h('span',null,'我方'),
        h('span',{className:'paa-balance-placeholder-text'},text),h('span',null,'敌方')),
      h('div',{className:'paa-balance-track','data-pending':true,'aria-hidden':true}));
  }
  const {blueShare,label}=assessment.balance;
  return h('div',{className:'paa-combat-balance','data-tier':label,
    'aria-label':`路线战况预测：${label}，参考对比，不代表胜率或通过率`},
    h('div',{className:'paa-balance-labels'},h('span',null,'我方'),h('span',null,'敌方')),
    h('div',{className:'paa-balance-track','aria-hidden':true},
      h('span',{className:'paa-balance-blue',style:{width:`${blueShare*100}%`}}),
      h('span',{className:'paa-balance-divider',style:{left:`${blueShare*100}%`}})));
}
// Per-node losses use simulated samples, not observed probabilities. Missing
// or unvisited data is shown as a dash instead of an invented zero.
function renderDetails(h,assessment){
  const rows=Array.isArray(assessment?.diagnostics?.nodes)?assessment.diagnostics.nodes:[];
  const journeys=assessment?.diagnostics?.journeys;
  const stopped=Number.isInteger(journeys?.stoppedBeforeTarget)&&journeys.stoppedBeforeTarget>0&&
    Number.isInteger(journeys.samples)&&journeys.samples>=journeys.stoppedBeforeTarget?
    `${journeys.stoppedBeforeTarget} / ${journeys.samples} 个参考场景在目标前大破停止。`:'';
  const target=assessment?.diagnostics?.target;
  const outcome=Number.isInteger(target?.visits)&&target.visits>0&&Number.isInteger(target.sVictories)&&
    target.sVictories>=0&&target.sVictories<=target.visits?
    `目标战 S 胜参考：${target.sVictories} / ${target.visits}${target.includeNight?'（含夜战）':''}；战后大破只计损耗。`:'';
  const percent=value=>Number.isFinite(value)&&value>=0?`${(value*100).toFixed(1)}%`:'—';
  const supply=value=>Number.isFinite(value)&&value>=0?(value>=1?'满':`${Math.round(value*100)}%`):'—';
  const whirlpools=assessment?.diagnostics?.supplyEstimates||[];
  const supplyNote=whirlpools.length?'漩涡后显示各舰剩余比例均值，按电探搭载舰数估算。'+
    (whirlpools.some(node=>node.strongChance)?'强漩涡暂按约 10% 发生率参考。':'')+
    (whirlpools.some(node=>node.assumedBaseRate)?'损失率未知的节点暂按普通漩涡 30% 参考。':''):'';
  const ratio=(left,right)=>h('span',{className:'paa-balance-ratio','aria-label':`${left} / ${right}`},
    h('span',null,left),h('span',{'aria-hidden':true},'/'),h('span',null,right));
  return h('div',{className:'paa-balance-details'},
    h('p',null,`${stopped}${outcome}从当前耐久出发，损失为该点新增战损占最大耐久的比例；场景次数并非实际概率。油弹按满补给出发和参考分支估算。${supplyNote}`),
    rows.length?h('table',{'aria-label':'逐点敌我战况参考'},
      h('thead',null,h('tr',null,...['节点','战前油弹','我方损失','敌方损失','大破场景'].map(label=>h('th',{key:label,scope:'col'},label)))),
      h('tbody',null,...rows.map((row,i)=>h('tr',{key:`${row.id}:${i}`},
        h('th',{scope:'row'},`${row.id} 点`),
        h('td',null,ratio(supply(row.supplyBefore?.fuel),supply(row.supplyBefore?.ammo))),
        h('td',{className:'paa-balance-percent'},h('span',null,row.visits>0?percent(row.ownHpLoss):'—')),
        h('td',{className:'paa-balance-percent'},h('span',null,row.visits>0?percent(row.enemyHpLoss):'—')),
        h('td',null,row.visits>0&&Number.isInteger(row.severe)?ratio(row.severe,row.visits):'—'))))):
      h('p',{className:'paa-muted'},'暂无逐点参考数据'));
}
module.exports=renderCombatBalance;
module.exports.renderTier=renderTier;
module.exports.renderDetails=renderDetails;
