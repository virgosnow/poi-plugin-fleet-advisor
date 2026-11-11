'use strict';
// Localize cached metric *presentation* at render time. Numeric values and
// route/combat decisions never pass through these functions.
const {t}=require('../../shared/i18n');
require('./mechanism_display');
function title(content){
  const data=content.titleData||{};
  if(content.displayKind==='fleet-speed')return t('舰队速力：{value}',{value:t(data.value||'—')});
  if(content.displayKind==='fleet-air')return t('综合制空：{value}',{value:data.value||'—'})+(data.state?`（${t(data.state)}）`:'');
  if(content.displayKind==='fleet-los')return t(data.value||'舰队索敌');
  return content.title;
}
const enumKeys=new Set(['speed','outcome','position']);
const numericKeys=new Set(['friendlyAir','enemyAir','current']);
function cell(content,section,index,value){
  if(!content.displayKind||typeof value!=='string')return value;
  const key=section.columnKeys?.[index];
  if(enumKeys.has(key))return value.split(/( → |～)/).map(part=>part===' → '||part==='～'?part:t(part)).join('');
  if(numericKeys.has(key)){
    if(['待确认','待估算','待计算'].includes(value))return t(value);
    return value.replace(/（上限）$/,t('（上限）'));
  }
  return value;
}
function notes(content){
  if(!Array.isArray(content.noteData))return content.notes;
  return content.noteData.map(note=>note.kind==='message'?t(note.value):
    note.kind==='ship-reason'?`${note.name}：${note.fallback?t(note.reason):note.reason}`:note.value);
}
module.exports={title,cell,notes};
