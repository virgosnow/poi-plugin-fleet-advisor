'use strict';
const quests=require('../../../data/quests/requirements.json').quests;
const limited=require('../../../data/quests/limited');
const idsByCode=new Map();
for(const quest of [...quests,...limited.flatMap(event=>event.quests)]){
  if(!quest.code)continue;
  const ids=idsByCode.get(quest.code)||new Set();
  for(const id of quest.ids||[])ids.add(Number(id));
  idsByCode.set(quest.code,ids);
}
// A missing or partial quest page is not proof of a completed task. A direct
// claim or a fully synchronized list can establish a selection is no longer available.
function withoutClaimed(selected,questState){
  if(!selected.length||!questState?.known)return selected;
  const claimed=new Set((questState.claimedTaskIds||[]).map(Number));
  const complete=questState.complete===true&&Array.isArray(questState.tasks);
  if(!claimed.size&&!complete)return selected;
  const live=complete?new Set(questState.tasks.map(task=>Number(task?.api_no))):null;
  const kept=selected.filter(code=>{
    const unknown=String(code).match(/^P-unknown-(\d+)$/);
    const ids=unknown?[Number(unknown[1])]:[...(idsByCode.get(code)||[])];
    return !ids.some(id=>claimed.has(id))&&!(live&&ids.length&&!ids.some(id=>live.has(id)));
  });
  return kept.length===selected.length?selected:kept;
}
module.exports={withoutClaimed};
