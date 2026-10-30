'use strict';
// Missing evidence is not an even battle. An estimated comparison is a
// model reference, not an empirically measured victory or retreat rate.
const TIER_MARKS={
  '完胜':['M2 2.5 5.5 6 2 9.5','M6 2.5 9.5 6 6 9.5'],
  '优势':['M4 2.5 7.5 6 4 9.5'],
  '均势':['M6 2 10 6 6 10 2 6Z'],
  '劣势':['M8 2.5 4.5 6 8 9.5'],
  '完败':['M10 2.5 6.5 6 10 9.5','M6 2.5 2.5 6 6 9.5']
};
const TIER_LABELS={'完胜':'压倒性优势','优势':'明显优势','均势':'僵持','劣势':'明显劣势','完败':'压倒性劣势'};
function validBalance(assessment){
  return ['ready','estimated'].includes(assessment?.status)&&assessment?.balance&&
    Number.isFinite(assessment.balance.blueShare)&&assessment.balance.blueShare>=0&&assessment.balance.blueShare<=1&&
    ['完胜','优势','均势','劣势','完败'].includes(assessment.balance.label);
}
function renderTier(h,assessment){
  if(!validBalance(assessment))return null;
  const {label}=assessment.balance;
  return h('strong',{className:'paa-balance-tier','data-tier':label,
    'aria-label':`路线战况预测：${TIER_LABELS[label]}，参考对比，不代表胜率或通过率`},
    h('svg',{viewBox:'0 0 12 12','aria-hidden':true,focusable:false},
      ...TIER_MARKS[label].map((d,i)=>h('path',{key:i,d}))),TIER_LABELS[label]);
}
function renderCombatBalance(h,assessment){
  if(!validBalance(assessment)){
    const text=({partial:'部分待确认',unselected:'选择路线',empty:'选择舰娘',pending:'计算中',awaitingCompletion:'一键补全后计算',unreachable:'当前编成无法沿此路线到达'})[assessment?.status]||'战况预测待确认';
    return h('div',{className:'paa-balance-pending',role:'status'},text);
  }
  const {blueShare,label}=assessment.balance;
  return h('div',{className:'paa-combat-balance','data-tier':label,
    'aria-label':`路线战况预测：${TIER_LABELS[label]}，参考对比，不代表胜率或通过率`},
    h('div',{className:'paa-balance-labels'},h('span',null,'我方'),h('span',null,'敌方')),
    h('div',{className:'paa-balance-track','aria-hidden':true},
      h('span',{className:'paa-balance-blue',style:{width:`${blueShare*100}%`}}),
      h('span',{className:'paa-balance-divider',style:{left:`${blueShare*100}%`}})));
}
// Per-node losses use simulated samples, not observed probabilities. Missing
// or unvisited data is shown as a dash instead of an invented zero.
function renderDetails(h,assessment){
  const rows=Array.isArray(assessment?.diagnostics?.nodes)?assessment.diagnostics.nodes:[];
  const percent=value=>Number.isFinite(value)&&value>=0?`${(value*100).toFixed(1)}%`:'—';
  return h('div',{className:'paa-balance-details'},
    h('p',null,'参考场景：按各舰最大耐久计算平均损失；大破场景是模拟次数，并非实际概率'),
    rows.length?h('table',{'aria-label':'逐点敌我战况参考'},
      h('thead',null,h('tr',null,...['节点','我方损失','敌方损失','大破场景'].map(label=>h('th',{key:label,scope:'col'},label)))),
      h('tbody',null,...rows.map((row,i)=>h('tr',{key:`${row.id}:${i}`},
        h('th',{scope:'row'},`${row.id} 点`),
        h('td',null,row.visits>0?percent(row.ownHpLoss):'—'),
        h('td',null,row.visits>0?percent(row.enemyHpLoss):'—'),
        h('td',null,row.visits>0&&Number.isInteger(row.severe)?`${row.severe} / ${row.visits}`:'—'))))):
      h('p',{className:'paa-muted'},'暂无逐点参考数据'));
}
module.exports=renderCombatBalance;
module.exports.renderTier=renderTier;
module.exports.renderDetails=renderDetails;
