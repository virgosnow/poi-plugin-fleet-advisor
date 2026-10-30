'use strict';

// Assess exactly the candidate that choosing each recommendation would place
// in the workbench. Every iteration yields so a list of bounded simulations
// cannot monopolize the renderer; a changed snapshot cancels the batch.
const W=require('../ui/workbench/workbench_model');
const {assessCombat}=require('./combat_assessment');

function createRouteCombatAssessor({merge=W.merge,inspect=W.inspect,assess=assessCombat,
  yieldControl=()=>new Promise(resolve=>setTimeout(resolve,0))}={}){
  return async function assessRouteChoices({store,service,slots,fleet,settings={},options,
    isCancelled=()=>false}){
    const outcomes=Object.create(null);
    for(const option of options||[]){
      if(isCancelled())return null;
      await yieldControl();
      if(isCancelled())return null;
      if(!option?.key)continue;
      if(!option.row?.scheme){
        // A bounded recommendation search not finding a candidate does not
        // prove that the route is physically impossible.
        outcomes[option.key]={status:option.status==='notFound'?'notFound':'unknown'};
        continue;
      }
      try{
        const merged=merge(store,slots,option.row.scheme,{preservePositions:false});
        const report=inspect(service,store,merged,{...settings,fleet,phase:option.phase||settings.phase||''});
        outcomes[option.key]=report.valid?assess({store,report,option,dirty:false}):
          {status:'unknown',reasons:report.error?[report.error]:[]};
      }catch(error){
        outcomes[option.key]={status:'unknown',reasons:[error?.message||'战况暂无法计算']};
      }
    }
    return isCancelled()?null:outcomes;
  };
}

module.exports={createRouteCombatAssessor,assessRouteChoices:createRouteCombatAssessor()};
