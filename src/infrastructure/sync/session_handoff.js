'use strict';

// Only in-memory data from this renderer is transferable. The opaque reader
// key binds account, game frame and document; no URL or credentials are saved.
function captureHandoff({reader,quest,basic}){
  if(typeof reader?.sessionKey!=='string'||!reader.sessionKey||reader.verifiedSessionKey!==reader.sessionKey)return null;
  return {version:1,sessionKey:reader.sessionKey,quest:quest?.snapshot()??null,basic:basic?.snapshot()??null};
}

// Cover the gap between the old and new listeners. Any game traffic in that
// gap makes the old relocation list unsuitable for use as a complete list.
function watchGap(window,value){
  let dirty=false,closed=false;
  const types=['game.request','game.response','game.start','network.error','network.invalid.result'];
  const mark=()=>{dirty=true;};
  for(const type of types)window.addEventListener(type,mark);
  const stop=()=>{if(closed)return;closed=true;clearTimeout(timer);for(const type of types)window.removeEventListener(type,mark);};
  const timer=setTimeout(stop,30000);
  value.finishGap=()=>{stop();value.gapSafe=!dirty;delete value.finishGap;};
}

async function restoreHandoff({value,reader,quest,basic,getStore,isCurrent=()=>true}){
  if(value?.version!==1||typeof value.sessionKey!=='string'||!value.sessionKey)return false;
  const store=getStore();
  quest.view(store);
  const revision=quest.revision;
  const basicRevision=basic?.revision;
  const context=await reader.context({cached:true});
  if(!isCurrent()||!context.ready||!context.identityVerified||context.sessionKey!==value.sessionKey)return false;
  const current=getStore();
  // view() may itself notice an account or cycle change; always check the
  // resulting revision before restoring any older snapshot.
  quest.view(current);
  // Plugin unload leaves an observation gap. Same account and document prove
  // ownership, not freshness. Keep task rows only as partial information and
  // require a fresh complete read. Practice and other basic data are reread.
  if(!quest.hasComplete(current)&&quest.revision===revision&&value.quest)quest.restore({...value.quest,complete:false},current);
  if(value.gapSafe&&value.basic&&basic?.revision===basicRevision)basic?.restoreRelocations(value.basic,current,value.sessionKey);
  return true;
}
module.exports={captureHandoff,restoreHandoff,watchGap};
