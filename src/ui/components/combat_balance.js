'use strict';
const {LABELS}=require('../../domain/combat/combat_balance');
const {t,registerCatalog}=require('../../shared/i18n');
const catalog=require('../i18n/combat');
registerCatalog('zh-CN',catalog.zhCN);registerCatalog('ja',catalog.ja);registerCatalog('zh-TW',catalog.zhTW);
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
    'aria-label':t('combat.aria',{label:t(label)})},
    h('svg',{viewBox:'0 0 12 12','aria-hidden':true,focusable:false},
      ...TIER_MARKS[label].map((d,i)=>h('path',{key:i,d}))),t(label));
}
function renderCombatBalance(h,assessment){
  if(!validBalance(assessment)){
    const text=({partial:'部分待确认',unselected:'选择路线',empty:'选择舰娘',pending:'计算中',awaitingCompletion:'一键补全后计算',unreachable:'当前编成无法沿此路线到达'})[assessment?.status]||'战况预测待确认';
    return h('div',{className:'paa-balance-pending',role:'status','aria-label':t('combat.pendingAria',{status:t(text)})},
      h('div',{className:'paa-balance-labels','aria-hidden':true},h('span',null,t('我方')),
        h('span',{className:'paa-balance-placeholder-text'},t(text)),h('span',null,t('敌方'))),
      h('div',{className:'paa-balance-track','data-pending':true,'aria-hidden':true}));
  }
  const {blueShare,label}=assessment.balance;
  return h('div',{className:'paa-combat-balance','data-tier':label,
    'aria-label':t('combat.aria',{label:t(label)})},
    h('div',{className:'paa-balance-labels'},h('span',null,t('我方')),h('span',null,t('敌方'))),
    h('div',{className:'paa-balance-track','aria-hidden':true},
      h('span',{className:'paa-balance-blue',style:{width:`${blueShare*100}%`}}),
      h('span',{className:'paa-balance-divider',style:{left:`${blueShare*100}%`}})));
}
// Per-node losses use simulated samples, not observed probabilities. Missing
// or unvisited data is shown as a dash instead of an invented zero.
function renderDetails(h,assessment){
  const rows=Array.isArray(assessment?.diagnostics?.nodes)?assessment.diagnostics.nodes:[];
  const journeys=assessment?.diagnostics?.journeys;
  const stopped=Number.isInteger(journeys?.stoppedBeforeTarget)&&journeys.stoppedBeforeTarget>=0&&
    Number.isInteger(journeys.samples)&&journeys.samples>=journeys.stoppedBeforeTarget?
    `${journeys.stoppedBeforeTarget} / ${journeys.samples}`:null;
  const target=assessment?.diagnostics?.target;
  const targetDamage=Number.isFinite(target?.flagshipDamage)?t('combat.flagshipDamage',{percent:(target.flagshipDamage*100).toFixed(0)}):'';
  const outcome=Number.isInteger(target?.visits)&&target.visits>0&&Number.isInteger(target.sVictories)&&
    target.sVictories>=0&&target.sVictories<=target.visits?
    `${target.sVictories} / ${target.visits}`:target&&target.visits===0?
      t('combat.noTarget'):'';
  const percent=value=>Number.isFinite(value)&&value>=0?`${(value*100).toFixed(1)}%`:'—';
  const supply=value=>Number.isFinite(value)&&value>=0?(value>=1?t('满'):`${Math.round(value*100)}%`):'—';
  const whirlpools=assessment?.diagnostics?.supplyEstimates||[];
  const branch=assessment?.diagnostics?.representativePath;
  const branchNote=Array.isArray(branch)&&branch.length?(assessment?.diagnostics?.branchUncertain?
    t('combat.branchUncertainShort',{path:branch.join('→')}):
    t('combat.branchShort',{path:branch.join('→')})):'';
  const supplyNotes=whirlpools.length?[t('combat.supplyBase'),
    ...(whirlpools.some(node=>node.strongChance)?[t('combat.supplyStrong')]:[]),
    ...(whirlpools.some(node=>node.assumedBaseRate)?[t('combat.supplyUnknown')]:[])]:[];
  const ratio=(left,right)=>h('span',{className:'paa-balance-ratio','aria-label':`${left} / ${right}`},
    h('span',null,left),h('span',{'aria-hidden':true},'/'),h('span',null,right));
  return h('div',{className:'paa-balance-details'},
    h('div',{className:'paa-balance-summary'},
      stopped!==null||outcome?h('div',{className:'paa-balance-summary-head'},h('span',null,t('combat.referenceCases'))):null,
      stopped!==null?h('div',{className:'paa-balance-summary-row'},h('span',null,t('combat.enroute')),h('strong',null,stopped)):null,
      outcome?h('div',{className:'paa-balance-summary-row'},h('span',null,t('combat.targetS')),
        h('strong',null,outcome,target?.visits>0&&target.includeNight?t('（含夜战）'):'')):null,
      target?.visits>0&&targetDamage?h('div',{className:'paa-balance-summary-row'},h('span',null,targetDamage)):null,
      h('p',{className:'paa-balance-summary-note'},t('combat.summaryBasis')),
      target?.visits>0?h('p',{className:'paa-balance-summary-note'},t('combat.afterTarget')):null,
      branchNote?h('p',{className:'paa-balance-summary-note'},branchNote):null,
      ...supplyNotes.map((note,i)=>h('p',{key:i,className:'paa-balance-summary-note'},note))),
    rows.length?h('table',{'aria-label':t('逐点敌我战况参考')},
      h('thead',null,h('tr',null,...['节点','战前油弹','我方损失','敌方损失','我方大破'].map(label=>h('th',{key:label,scope:'col'},t(label))))),
      h('tbody',null,...rows.map((row,i)=>h('tr',{key:`${row.id}:${i}`},
        h('th',{scope:'row'},t('combat.point',{node:row.id})),
        h('td',null,ratio(supply(row.supplyBefore?.fuel),supply(row.supplyBefore?.ammo))),
        h('td',{className:'paa-balance-percent'},h('span',null,row.visits>0?percent(row.ownHpLoss):'—')),
        h('td',{className:'paa-balance-percent'},h('span',null,row.visits>0?percent(row.enemyHpLoss):'—')),
        h('td',null,row.visits>0&&Number.isInteger(row.severe)?ratio(row.severe,row.visits):'—'))))):
      h('p',{className:'paa-muted'},t('暂无逐点参考数据')));
}
module.exports=renderCombatBalance;
module.exports.renderTier=renderTier;
module.exports.renderDetails=renderDetails;
