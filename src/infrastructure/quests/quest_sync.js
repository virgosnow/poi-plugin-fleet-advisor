'use strict';

// A complete background read is committed only while its observer, account,
// session and natural-response revision are unchanged.
async function syncQuests({observer,reader,service,isCurrent=()=>true,signal,sessionKey}){
  observer.view();
  const revision=observer.revision;
  const result=await reader.readAll({signal,sessionKey});
  if(result?.status!=='ready')return result;
  const context=await reader.context({cached:true});
  if(signal?.aborted||!isCurrent()||context.sessionKey!==sessionKey||observer.revision!==revision)
    return {status:'deferred'};
  if(!observer.acceptComplete(result.tasks))return {status:'failed'};
  service?.reconcileQuestProgress(result.tasks);
  return {status:'ready'};
}
module.exports={syncQuests};
