'use strict';
const {OPERATION_WAITS,normalize}=require('../../config/experimental_settings');
module.exports=React=>{
  const h=React.createElement,feedback=require('./settings_feedback');
  return ({value,disabled,onChange,status,statuses={},mcpControls})=>{
    const waitMs=normalize(value).operationWaitMs;
    const option=(key,label,text)=>h('div',{className:'paa-settings-row'},
      h('span',{className:'paa-settings-label'},label,feedback(React,undefined,{label,text})),
      h('div',{className:'paa-settings-value'},
        h('button',{type:'button',role:'switch','aria-label':label+'开关','aria-checked':String(value[key]===true),className:'paa-switch',disabled,
          onClick:()=>{if(!disabled)onChange({[key]:!value[key]});}},
          h('span',{className:'paa-switch-track','aria-hidden':true},h('span',{className:'paa-switch-knob'})),
          h('span',{className:'paa-switch-label'},value[key]?'已开启':'已关闭')),feedback(React,statuses[key]||(key==='automaticOperations'?status:undefined))));
    return h('section',{className:'paa-settings-card paa-experimental-settings','aria-label':'实验功能'},
      h('div',{className:'paa-settings-section-head'},h('div',{className:'paa-settings-label'},h('h3',null,'实验功能'))),
      h('div',{className:'paa-automatic-settings'},
        option('automaticOperations','自动操作','开启后允许模拟点击，应用舰队编成与装备。\n关闭时仍可查询、推荐、预览和编辑草稿。'),
        h('div',{className:'paa-settings-row paa-automatic-mode','data-disabled':String(!!disabled||!value.automaticOperations)},
          h('span',{className:'paa-settings-label'},h('label',{htmlFor:'paa-operation-recognition'},'识别方式')),
          h('div',{className:'paa-settings-value'},h('select',{id:'paa-operation-recognition','aria-label':'自动操作识别方式',value:normalize(value).recognitionMode,
            disabled:!!disabled||!value.automaticOperations,onChange:e=>{if(!disabled&&value.automaticOperations)onChange({recognitionMode:e.target.value});}},
            h('option',{value:'controls'},'控件优先（图像兜底）'),h('option',{value:'image'},'仅图像识别')),feedback(React,statuses.recognitionMode))),
        h('div',{className:'paa-settings-row paa-automatic-wait','data-disabled':String(!!disabled||!value.automaticOperations)},
          h('span',{className:'paa-settings-label'},h('label',{htmlFor:'paa-operation-wait'},'额外等待')),
          h('div',{className:'paa-settings-value'},h('div',{className:'paa-operation-wait-control'},
            h('input',{id:'paa-operation-wait',type:'range',min:0,max:2,step:1,'aria-label':'每步额外等待时间',
              value:OPERATION_WAITS.indexOf(waitMs),'aria-valuetext':waitMs===0?'无额外等待':`每步额外等待 ${waitMs/1000} 秒`,
              disabled:!!disabled||!value.automaticOperations,onChange:e=>{
                const wait=OPERATION_WAITS[Number(e.target.value)];if(!disabled&&value.automaticOperations&&wait!==undefined)onChange({operationWaitMs:wait});
              }}),
            h('div',{className:'paa-operation-wait-ticks','aria-hidden':true},...OPERATION_WAITS.map(ms=>h('span',{key:ms,'data-selected':String(ms===waitMs)},`${ms/1000} 秒`)))),
            feedback(React,statuses.operationWaitMs)))),
      mcpControls);
  };
};
