'use strict';
// Import only structured reward facts from a local reviewed upstream snapshot.
// The upstream application, quest descriptions and player data are not copied.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'../..'),source=process.argv[2];
if(!source)throw Error('Usage: node tools/data/import-quest-rewards.js <quests.json>');
const bytes=fs.readFileSync(source),upstream=JSON.parse(bytes).quests;
const quests=require('../../data/quests/requirements.json').quests;
const key=s=>String(s||'').replace(/[^\p{L}\p{N}]/gu,'');
function item(value){
  const kind=value?.api_kind,id=value?.api_mst_id,count=value?.api_count,level=value?.api_slotitem_level;
  if(![11,12,13,14,18].includes(kind)||!Number.isSafeInteger(count)||count<=0||
    kind!==18&&(!Number.isSafeInteger(id)||id<=0)||level!==undefined&&(!Number.isSafeInteger(level)||level<0||level>10))return null;
  return {kind,...id!==undefined?{id}:{},count,...level>0?{level}:{}};
}
const rows={};
for(const quest of quests){
  const match=quest.ids.map(id=>upstream[id]).find(row=>row?.wikiId===quest.code&&key(row.nameJa)===key(quest.title));
  if(!match)continue;
  const fixed=Array.isArray(match.fixedReward)?match.fixedReward.map(item):[];
  const choices=Array.isArray(match.choiceReward)?match.choiceReward.map(group=>Array.isArray(group)?group.map(item):[null]):[];
  if(fixed.includes(null)||choices.some(group=>!group.length||group.includes(null)))continue;
  if(fixed.length||choices.length)rows[quest.code]={id:match.id,fixed,choices};
}
const result={schemaVersion:1,source:{url:'https://github.com/cnxin/poi-plugin-quest-line/blob/master/assets/quests.json',
  sha256:crypto.createHash('sha256').update(bytes).digest('hex'),generatedAt:upstream&&JSON.parse(bytes).meta?.generatedAt,
  license:'MIT; Copyright (c) 2026 cnxin; see SOURCE_LICENSE'},quests:rows};
fs.writeFileSync(path.join(root,'data/quests/rewards.json'),JSON.stringify(result,null,2)+'\n');
console.log(`Imported ${Object.keys(rows).length} matched quest reward records`);
