'use strict';
// Paused pages retain derived data, including across in-place store mutations.
// Resume invalidates once even if the host kept the same object references.
function retain(ref,paused,dependencies,calculate){
  const previous=ref.current;
  if(paused){if(previous)previous.paused=true;return previous?.value;}
  if(!previous||previous.paused||!dependencies||dependencies.length!==previous.dependencies?.length||dependencies.some((value,i)=>!Object.is(value,previous.dependencies[i]))){
    ref.current={value:calculate(),dependencies,paused:false};
  }
  return ref.current.value;
}
function hiddenPage(h,previous,props){
  return h('div',props,previous?.props?.children||previous?.children||null);
}
module.exports={retain,hiddenPage};
