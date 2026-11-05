'use strict';

// Assess exactly the candidate that choosing each recommendation would place
// in the workbench. Every iteration yields so a list of bounded simulations
// cannot monopolize the renderer; a changed snapshot cancels the batch.
const W=require('../ui/workbench/workbench_model');
const {assessCombat}=require('./combat_assessment');

function createRouteCombatAssessor({merge=W.merge,inspect=W.inspect,assess=assessCombat,
  yieldControl=()=>new Promise(resolve=>setTimeout(resolve,0))}={}){
  return async function assessRouteChoices({store,service,slots,fleet,settings={},options,landBases,selectLandBaseCombat,onTiming,
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
        const started=onTiming?performance.now():0;
        const merged=merge(store,slots,option.row.scheme,{preservePositions:false});
        const report=inspect(service,store,merged,{...settings,fleet,phase:option.phase||settings.phase||''});
        const inspected=onTiming?performance.now():0;
        if(!report.valid){outcomes[option.key]={status:'unknown',reasons:report.error?[report.error]:[]};continue;}
        const proposal=typeof landBases==='function'?landBases(option,merged,report):landBases;
        const planned=onTiming?performance.now():0;
        if(selectLandBaseCombat&&proposal){
          const selected=selectLandBaseCombat({store,report,option,proposal});
          outcomes[option.key]={...selected.assessment,landBaseProposal:selected.proposal};
        }else outcomes[option.key]=assess({store,report,option,dirty:false,landBases:proposal?.bases||proposal});
        if(onTiming)onTiming([{name:'route.inspect',ms:inspected-started},{name:'route.base',ms:planned-inspected},
          {name:'route.combat',ms:performance.now()-planned}]);
      }catch(error){
        outcomes[option.key]={status:'unknown',reasons:[error?.message||'战况暂无法计算']};
      }
    }
    return isCancelled()?null:outcomes;
  };
}

module.exports={createRouteCombatAssessor,assessRouteChoices:createRouteCombatAssessor()};
