'use strict';
const DEFAULTS=Object.freeze({automaticOperations:false,performanceDebug:false});
const normalize=value=>Object.fromEntries(Object.keys(DEFAULTS).map(key=>[key,value?.[key]===true]));
function validate(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||
    Object.entries(value).some(([key,v])=>!Object.hasOwn(DEFAULTS,key)||typeof v!=='boolean'))
    throw Error('无效的实验功能设置');
}
module.exports={DEFAULTS,normalize,validate};
