'use strict';
const os=require('os');
const DEFAULTS={threads:0,expeditionThreads:2,resultCache:true,calculationCache:true,schemeCache:true,cacheLimitMiB:256};
const LIMITS=[128,256,384,512];
function normalize(value={}){
  return {threads:Number.isInteger(value?.threads)&&value.threads>=0&&value.threads<=8?value.threads:0,
    expeditionThreads:[1,2].includes(value?.expeditionThreads)?value.expeditionThreads:2,
    resultCache:typeof value?.resultCache==='boolean'?value.resultCache:true,
    calculationCache:typeof value?.calculationCache==='boolean'?value.calculationCache:true,
    schemeCache:typeof value?.schemeCache==='boolean'?value.schemeCache:true,
    cacheLimitMiB:LIMITS.includes(value?.cacheLimitMiB)?value.cacheLimitMiB:[32,64].includes(value?.cacheLimitMiB)?128:DEFAULTS.cacheLimitMiB};
}
function validate(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('无效的计算资源设置');
  const normalized=normalize(value);
  for(const [key,item] of Object.entries(value))if(!(key in DEFAULTS)||normalized[key]!==item)throw Error('无效的计算资源选项：'+key);
}
function parallelism(cpus=os.availableParallelism?.()||os.cpus().length){return Math.max(1,Math.min(6,cpus-2));}
function resources(value,cpus=os.availableParallelism?.()||os.cpus().length,memory=os.totalmem()){
  const settings=normalize(value),available=Math.max(1,cpus);
  return {logicalProcessors:available,memoryGiB:Math.round(memory/1024**3),automaticThreads:parallelism(available),
    effectiveExpeditionThreads:Math.min(settings.expeditionThreads,available),
    effectiveThreads:settings.threads?Math.min(settings.threads,available):parallelism(available)};
}
module.exports={DEFAULTS,LIMITS,normalize,validate,parallelism,resources};
