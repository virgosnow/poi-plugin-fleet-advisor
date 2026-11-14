'use strict';
require('../shared_catalog');
require('../i18n/readability');
const i18n=require('../../shared/i18n');
module.exports=React=>{
  const h=React.createElement,feedback=require('./settings_feedback');
  const common=[['excludeUnremodeled','排除未改造舰'],['excludeUnlocked','排除未锁定舰'],['excludeExpedition','排除远征中的舰'],
    ['excludeRepairing','排除入渠中的舰']];
  const specific={normal:[['excludeHeavyDamage','排除大破舰'],['excludeFatigued','排除疲劳舰']],
    practice:[['excludeHeavyDamage','排除大破舰'],['excludeFatigued','排除疲劳舰']],
    expedition:[['excludeHeavyDamage','排除大破舰'],['excludeFatigued','排除疲劳舰']]};
  return ({value,onChange,disabled,feedbacks={}})=>{
    const locale=i18n.getLocale(),t=i18n.t;
    return h('section',{className:'paa-selection-settings','aria-label':t('全局推荐排除')},
    h('div',{className:'paa-selection-grid'},...['normal','expedition','practice'].map(kind=>{
      const group=value[kind]||require('../../config/recommendation_filters').normalizeGroup(kind),title=kind==='normal'?'出击设置':kind==='practice'?'演习设置':'远征设置';
      const change=(key,v)=>onChange({...value,[kind]:{...group,[key]:v}},kind+'.'+key);
      const hint='readability.borrowHelp';
      return h('section',{className:'paa-settings-card',key:kind},h('div',{className:'paa-settings-section-head'},h('div',{className:'paa-settings-label'},h('h3',null,t(title)),feedback(React,undefined,{label:t(title),text:t(hint)}))),
        h('div',{className:'paa-settings-row paa-selection-exclusions'},h('div',{className:'paa-selection-caption'},t('装备借用')),
          h('div',{className:'paa-selection-options',role:'group','aria-label':t(kind==='practice'?'演习装备借用':kind==='expedition'?'远征装备借用':'出击装备借用')},
            ...[['borrowIdleShips','borrow.idle'],['borrowFleetShips','borrow.fleet']].map(([key,label])=>
              h('div',{className:'paa-settings-label',key},h('label',{className:'paa-selection-option'},
                h('input',{type:'checkbox',checked:group[key],disabled,'aria-label':t(label),onChange:e=>change(key,e.target.checked)}),
                h('span',null,t(label))),feedback(React,feedbacks[kind+'.'+key]))))),
        h('div',{className:'paa-settings-row paa-selection-exclusions paa-selection-ship-filter'},h('div',{className:'paa-selection-caption'},t('排除以下舰娘')),
        h('div',{className:'paa-selection-options'},
        h('div',{className:'paa-selection-level'},
          h('label',null,h('input',{type:'checkbox',checked:group.minLevel>0,disabled,'aria-label':t(title)+t('等级限制'),onChange:e=>change('minLevel',e.target.checked?30:0)}),locale==='ja-JP'?'Lv.':t('低于')),
          h('input',{type:'number',min:1,max:999,step:1,value:group.minLevel||30,disabled:disabled||group.minLevel===0,'aria-label':t(title)+t('最低等级'),onChange:e=>{const v=Number(e.target.value);if(Number.isInteger(v)&&v>=1&&v<=999)change('minLevel',v);}}),h('span',null,locale==='ja-JP'?'未満':t('级')),feedback(React,feedbacks[kind+'.minLevel'])),
        ...[...common,...specific[kind],['excludeFleetShips','排除编队内的舰娘']].map(([key,label])=>h('div',{className:'paa-settings-label',key},h('label',{className:'paa-selection-option'},
          h('input',{type:'checkbox',checked:group[key],disabled,'aria-label':t(title)+'：'+t(label),onChange:e=>change(key,e.target.checked)}),h('span',null,t(({excludeUnremodeled:'未改造',excludeExpedition:'远征中',excludeRepairing:'入渠中',excludeUnlocked:'未锁定',excludeHeavyDamage:'大破',excludeFatigued:'疲劳（士气 < 40）',excludeFleetShips:'编队内的舰娘'})[key]))),feedback(React,feedbacks[kind+'.'+key]))))));
    })));
  };
};
