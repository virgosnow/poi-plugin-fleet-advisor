'use strict';
// User-selected reference policy: retain source records, use their existing
// numbers, and give a selected unknown random exit a 50% reference chance.
// Missing conditions and player-controlled exits remain separate cases.
// Source notes do not depend on a candidate fleet. Bound by text, not rule
// identity, so source edits and live reloads cannot reuse a stale description.
const noteCache=new Map();
function referenceNote(note=''){
  if(noteCache.has(note))return noteCache.get(note);
  let cleaned=note;
  if(/[?？]/.test(cleaned))cleaned=cleaned.replace(/(\d(?:[\d.%~～/]+)?)[?？]/g,'$1');
  // Avoid quadratic unanchored scans on long imported notes with no sample caveat.
  if(cleaned.includes('样本不足')||cleaned.includes('样本少'))
    cleaned=cleaned.replace(/；?[^；。]*样本(?:不足|少)[^；。]*/g,'');
  cleaned=cleaned.replace(/（幅付きのため未確定）/g,'');
  if(noteCache.size>=512)noteCache.delete(noteCache.keys().next().value);
  noteCache.set(note,cleaned);return cleaned;
}
function effectiveRule(rule){
  if(rule.conditionUnknown)return {...rule,tentative:false,uncertain:true};
  if(/能動分岐|能动分岐/.test(rule.note||''))return rule;
  return {...rule,tentative:false,uncertain:false,
    ...(rule.assumedTo?{to:rule.assumedTo,choices:undefined}:{}),
    note:referenceNote(rule.note||'')};
}
function referenceWeights(choices,shipCount){
  const weights=choices.map(choice=>({to:choice.to,
    probability:choice.weightByShipCount?.[shipCount]??choice.weight??null}));
  const missing=weights.filter(w=>!Number.isFinite(w.probability));
  if(!missing.length)return {weights};
  // One remaining weight is determined by the explicit numbers, not guessed.
  const known=weights.filter(w=>Number.isFinite(w.probability)).reduce((sum,w)=>sum+w.probability,0);
  if(missing.length===1&&known>=0&&known<=1)missing[0].probability=1-known;
  else if(weights.length===2)for(const weight of missing)weight.probability=.5;
  else return {weights,referencePathProbability:.5};
  return {weights};
}
module.exports={effectiveRule,referenceWeights};
