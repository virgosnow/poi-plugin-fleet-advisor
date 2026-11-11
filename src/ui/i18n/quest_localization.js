'use strict';
// Preserve the reviewed community number; never replace internal task codes.
function number(task){
  if(!task)return '';
  const code=String(task.code||'');
  if(code&&!/^P(?:-|\d)/.test(code))return code;
  const anchor=String(task.source?.url||'').match(/#id-(C[a-zA-Z0-9]+)$/);
  if(anchor)return anchor[1];
  return Number.isSafeInteger(Number(task.id))&&Number(task.id)>0?`#${Number(task.id)}`:'';
}
module.exports={number};
