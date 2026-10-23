'use strict';
module.exports=React=>{
  const h=React.createElement,feedback=require('./settings_feedback');
  return ({value,disabled,onChange,status,mcpControls})=>h('section',{className:'paa-settings-card paa-experimental-settings','aria-label':'实验功能'},
    h('div',{className:'paa-settings-section-head'},h('div',{className:'paa-settings-label'},h('h3',null,'实验功能'))),
    h('div',{className:'paa-settings-row'},
      h('span',{className:'paa-settings-label'},'自动操作',feedback(React,undefined,{label:'自动操作',
        text:'开启后允许模拟点击，应用舰队编成与装备。\n关闭时仍可查询、推荐、预览和编辑草稿。'})),
      h('div',{className:'paa-settings-value'},
        h('button',{type:'button',role:'switch','aria-label':'自动操作开关','aria-checked':String(value.automaticOperations),className:'paa-switch',disabled,
          onClick:()=>{if(!disabled)onChange({automaticOperations:!value.automaticOperations});}},
          h('span',{className:'paa-switch-track','aria-hidden':true},h('span',{className:'paa-switch-knob'})),
          h('span',{className:'paa-switch-label'},value.automaticOperations?'已开启':'已关闭')),feedback(React,status))),
    mcpControls);
};
