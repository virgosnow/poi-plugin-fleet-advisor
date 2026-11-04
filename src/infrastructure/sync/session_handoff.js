'use strict';

// Only in-memory data from this renderer is transferable. The opaque reader
// key binds account, game frame and document; no URL or credentials are saved.
function captureHandoff({reader,quest}){
  if(typeof reader?.sessionKey!=='string'||!reader.sessionKey||reader.verifiedSessionKey!==reader.sessionKey)return null;
  return {version:1,sessionKey:reader.sessionKey,quest:quest?.snapshot()??null};
}

async function restoreHandoff({value,reader,quest,getStore,isCurrent=()=>true}){
  if(value?.version!==1||typeof value.sessionKey!=='string'||!value.sessionKey)return false;
  const store=getStore();
  quest.view(store);
  const revision=quest.revision;
  const context=await reader.context({cached:true});
  if(!isCurrent()||!context.ready||!context.identityVerified||context.sessionKey!==value.sessionKey)return false;
  const current=getStore();
  // view() may itself notice an account or cycle change; always check the
  // resulting revision before restoring any older snapshot.
  quest.view(current);
  // Plugin unload leaves an observation gap. Same account and document prove
  // ownership, not freshness. Keep task rows only as partial information and
  // require a fresh complete read. Practice and basic data are reread.
  if(!quest.hasComplete(current)&&quest.revision===revision&&value.quest)quest.restore({...value.quest,complete:false},current);
  return true;
}
module.exports={captureHandoff,restoreHandoff};
