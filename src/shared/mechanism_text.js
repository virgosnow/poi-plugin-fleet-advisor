'use strict';
// Activation, effect, then optional conditions. Keep paragraph spacing shared
// by status pages, editable drafts and their exported examples.
const lines=value=>(Array.isArray(value)?value.flat(Infinity):[value]).filter(Boolean)
  .map(text=>String(text).trim().replace(/\n{2,}/g,'\n')).filter(Boolean).join('\n');
const tooltip=(activation,effect,notes)=>[activation,effect,notes].map(lines).filter(Boolean).join('\n\n');
tooltip.withNotes=(detail,notes,activation)=>{const [first,effect,previous]=detail.split('\n\n');return tooltip(activation||first,effect,[previous,notes]);};
module.exports=tooltip;
