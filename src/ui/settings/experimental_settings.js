'use strict';
require('../shared_catalog');
const i18n=require('../../shared/i18n');
const {OPERATION_WAITS,normalize}=require('../../config/experimental_settings');
module.exports=React=>{
  const h=React.createElement,feedback=require('./settings_feedback');
  return ({value,disabled,onChange,status,statuses={},mcpControls})=>{
    const t=i18n.t;
    const waitMs=normalize(value).operationWaitMs;
    const option=(key,label,text)=>h('div',{className:'paa-settings-row'},
      h('span',{className:'paa-settings-label'},t(label),feedback(React,undefined,{label:t(label),text:t(text)})),
      h('div',{className:'paa-settings-value'},
        h('button',{type:'button',role:'switch','aria-label':t('{label}开关',{label:t(label)}),'aria-checked':String(value[key]===true),className:'paa-switch',disabled,
          onClick:()=>{if(!disabled)onChange({[key]:!value[key]});}},
          h('span',{className:'paa-switch-track','aria-hidden':true},h('span',{className:'paa-switch-knob'})),
          h('span',{className:'paa-switch-label'},t(value[key]?'已开启':'已关闭'))),feedback(React,statuses[key]||(key==='automaticOperations'?status:undefined))));
    return h('section',{className:'paa-settings-card paa-experimental-settings','aria-label':t('实验功能')},
      h('div',{className:'paa-settings-section-head'},h('div',{className:'paa-settings-label'},h('h3',null,t('实验功能')))),
      h('div',{className:'paa-automatic-settings'},
        option('automaticOperations','自动操作','开启后允许模拟点击，应用舰队编成与装备。\n关闭时仍可查询、推荐、预览和编辑草稿。'),
        h('div',{className:'paa-settings-row paa-automatic-wait','data-disabled':String(!!disabled||!value.automaticOperations)},
          h('span',{className:'paa-settings-label'},h('label',{htmlFor:'paa-operation-wait'},t('额外等待'))),
          h('div',{className:'paa-settings-value'},h('div',{className:'paa-operation-wait-control'},
            h('input',{id:'paa-operation-wait',type:'range',min:0,max:2,step:1,'aria-label':t('每步额外等待时间'),
              value:OPERATION_WAITS.indexOf(waitMs),'aria-valuetext':waitMs===0?t('无额外等待'):t('每步额外等待 {seconds} 秒',{seconds:waitMs/1000}),
              disabled:!!disabled||!value.automaticOperations,onChange:e=>{
                const wait=OPERATION_WAITS[Number(e.target.value)];if(!disabled&&value.automaticOperations&&wait!==undefined)onChange({operationWaitMs:wait});
              }}),
            h('div',{className:'paa-operation-wait-ticks','aria-hidden':true},...OPERATION_WAITS.map(ms=>h('span',{key:ms,'data-selected':String(ms===waitMs)},t('{seconds} 秒',{seconds:ms/1000}))))),
            feedback(React,statuses.operationWaitMs)))),
      mcpControls);
  };
};
