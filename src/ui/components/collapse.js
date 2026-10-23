'use strict';
// Keep the body mounted for both directions; collapsed content is not focusable.
module.exports=(h,{open,id},...children)=>h('div',{className:'paa-collapse',id,'data-open':!!open,'aria-hidden':!open,inert:open?undefined:''},
  h('div',{className:'paa-collapse-clip'},...children));
