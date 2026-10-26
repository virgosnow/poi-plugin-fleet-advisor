'use strict';
module.exports=React=>{
  const h=React.createElement,feedback=require('./settings_feedback');
  return ({value,disabled,onChange,status,statuses={},mcpControls})=>{
    const option=(key,label,text)=>h('div',{className:'paa-settings-row'},
      h('span',{className:'paa-settings-label'},label,feedback(React,undefined,{label,text})),
      h('div',{className:'paa-settings-value'},
        h('button',{type:'button',role:'switch','aria-label':label+'开关','aria-checked':String(value[key]===true),className:'paa-switch',disabled,
          onClick:()=>{if(!disabled)onChange({[key]:!value[key]});}},
          h('span',{className:'paa-switch-track','aria-hidden':true},h('span',{className:'paa-switch-knob'})),
          h('span',{className:'paa-switch-label'},value[key]?'已开启':'已关闭')),feedback(React,statuses[key]||(key==='automaticOperations'?status:undefined))));
    return h('section',{className:'paa-settings-card paa-experimental-settings','aria-label':'实验功能'},
      h('div',{className:'paa-settings-section-head'},h('div',{className:'paa-settings-label'},h('h3',null,'实验功能'))),
      option('automaticOperations','自动操作','开启后允许模拟点击，应用舰队编成与装备。\n关闭时仍可查询、推荐、预览和编辑草稿。'),
      option('performanceDebug','性能调试','记录推荐阶段、模块耗时和缓存命中，详细日志保存在本地。\n可能增加少量计算耗时，排查后可关闭。\n在缓存文件的“日志缓存”中查看占用和清理。'),
      mcpControls);
  };
};
