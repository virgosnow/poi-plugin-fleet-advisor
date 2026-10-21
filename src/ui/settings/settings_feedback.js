'use strict';
// Reserve a small inline slot so saving never moves nearby controls.
module.exports=(React,state,help)=>{
  const h=React.createElement,kind=state?.kind,text=state?.text||'';
  if(help)return h('button',{type:'button',className:'paa-settings-help','aria-label':help.label+'说明','data-tooltip':help.text},'?');
  return h('span',{className:'paa-setting-feedback','data-state':kind||undefined,
    'data-tooltip':text||undefined,tabIndex:kind==='error'?0:undefined,
    role:kind==='error'?'alert':'status','aria-live':kind==='error'?'assertive':'polite'},
    h('span',{'aria-hidden':true},kind==='error'?'!':kind==='pending'?'…':kind==='success'?'✓':''),
    h('span',{className:'paa-settings-sr-only'},text));
};
