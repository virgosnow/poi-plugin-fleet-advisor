'use strict';
const OPERATION_WAITS=Object.freeze([0,300,800]);
const DEFAULTS=Object.freeze({automaticOperations:false,performanceDebug:false,operationWaitMs:0,recognitionMode:'controls'});
const normalize=value=>({...Object.fromEntries(['automaticOperations','performanceDebug'].map(key=>[key,value?.[key]===true])),
  operationWaitMs:OPERATION_WAITS.includes(value?.operationWaitMs)?value.operationWaitMs:DEFAULTS.operationWaitMs,
  recognitionMode:['controls','image'].includes(value?.recognitionMode)?value.recognitionMode:DEFAULTS.recognitionMode});
function validate(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||
    Object.entries(value).some(([key,v])=>!Object.hasOwn(DEFAULTS,key)||(key==='operationWaitMs'?!OPERATION_WAITS.includes(v):key==='recognitionMode'?!['image','controls'].includes(v):typeof v!=='boolean')))
    throw Error('无效的实验功能设置');
}
module.exports={DEFAULTS,OPERATION_WAITS,normalize,validate};
