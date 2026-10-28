'use strict';

// Deliberately exclude screenshots, raw OCR, inventory, URLs and request data.
const fields=new Set(['valid','reason','mode','category','primary','activePage','labels','selected',
  'level','direction','states','expectedType','actualType','page','sort','filter','tab','results',
  'border','score','bright','contrast','goldCount','dx','dy']);
function observationSummary(value,depth=0){
  if(depth>4)return undefined;
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(typeof value==='string')return value.slice(0,160);
  if(Array.isArray(value))return value.slice(0,8).map(v=>observationSummary(v,depth+1));
  if(!value||typeof value!=='object')return undefined;
  return Object.fromEntries(Object.entries(value).filter(([k])=>fields.has(k))
    .map(([k,v])=>[k,observationSummary(v,depth+1)]));
}
function attachDiagnostics(error,diagnostic){
  error.diagnostics=diagnostic;
  // UI's existing error.stack logger also receives this bounded text. Keep
  // message unchanged: navigation recovery matches the exact timeout message.
  error.stack=(error.stack||String(error))+'\nObservation diagnostics: '+JSON.stringify(diagnostic);
  return error;
}
function observationTimeout(kind,arg,{elapsedMs,attempts,stableFrames,last,previous,accepted,late,captureMs,observeMs,captureBreakdown,slowCaptures}){
  const checks=(kind==='batch'?arg?.checks||[]:[{kind}]).map((c,i)=>({kind:c.kind,
    observed:observationSummary(kind==='batch'?last?.results?.[i]:last)}));
  return attachDiagnostics(Object.assign(new Error('Observation timed out: '+kind),{code:'OBSERVATION_TIMEOUT'}),{
    kind,elapsedMs:Math.round(elapsedMs),captureMs:Math.round(captureMs),observeMs:Math.round(observeMs),attempts,stableFrames,
    cause:late?'deadline-exceeded':accepted?'not-stable':last?.valid?'expectation-mismatch':'recognition-failed',
    checks,previous:observationSummary(previous),
    ...(captureBreakdown?{captureBreakdown:{...captureBreakdown},slowCaptures:slowCaptures.slice(-4)}:{}),
  });
}
function equipmentSelectionFailure(error,context){
  if(error.code!=='OBSERVATION_TIMEOUT')return error;
  const d=error.diagnostics,checks=d.checks||[],mode=checks[0]?.observed,view=checks[1]?.observed,icon=checks[2]?.observed;
  const page=context.slot==='ex'?view:view?.page,issues=[];
  if(!mode?.valid)issues.push('装备来源模式不可读');
  else if(mode.mode!==context.mode)issues.push('装备来源模式不符');
  if(!page?.valid)issues.push('页码不可读');
  else if(page.activePage!==context.page)issues.push('页码不符');
  if(context.slot!=='ex'&&view?.category!==context.category)issues.push(view?.category==null?'分类不可读':'分类不符');
  if(!icon?.valid)issues.push('装备图标不符或不可读');
  const summary='选装前核对超时：'+(issues.join('；')||'识别未能在期限内完成');
  const enriched=Object.assign(new Error(error.message+'（'+summary+'）'),{code:error.code});
  // Retain the original executor stack rather than only the enrichment site.
  enriched.stack=error.stack.split('\nObservation diagnostics:')[0].replace(error.message,enriched.message);
  return attachDiagnostics(enriched,{...d,phase:'equipment-row-selection',target:context,issues});
}
module.exports={observationSummary,observationTimeout,equipmentSelectionFailure};
