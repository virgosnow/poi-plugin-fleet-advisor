'use strict';
// Only assess the phase explicitly requested by the player. A changed snapshot
// or edited draft cancels the pending publication.
async function runRouteCombatBatch({firstPhase,firstResult,evaluate,publish,onError,isCancelled,
  yieldControl=()=>new Promise(resolve=>setTimeout(resolve,0))}){
  const cancelled=()=>!!isCancelled?.();
  await yieldControl();if(cancelled())return;
  try{
    const assessment=await evaluate(firstPhase,firstResult);
    if(cancelled()||assessment===null)return;
    publish(firstPhase,firstResult,assessment);
  }catch(error){if(cancelled())return;onError?.(firstPhase,error);}
}
module.exports={runRouteCombatBatch};
