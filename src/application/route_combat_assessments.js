'use strict';

// Assess exactly the candidate that choosing each recommendation would place
// in the workbench. Every iteration yields so a list of bounded simulations
// cannot monopolize the renderer; a changed snapshot cancels the batch.
const W=require('../ui/workbench/workbench_model');
const {assessCombat}=require('./combat_assessment');
const {valid:validComparison,preservesRouting,improvesOrMatches}=require('./joint_fitting_comparison');

function createRouteCombatAssessor({merge=W.merge,inspect=W.inspect,assess=assessCombat,
  yieldControl=()=>new Promise(resolve=>setTimeout(resolve,0))}={}){
  return async function assessRouteChoices({store,service,slots,fleet,settings={},options,landBases,selectLandBaseCombat,refineLandBaseEquipment,onTiming,onPrepared,
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
        let merged=merge(store,slots,option.row.scheme,{preservePositions:false});
        let report=inspect(service,store,merged,{...settings,fleet,phase:option.phase||settings.phase||''});
        const inspected=onTiming?performance.now():0;
        if(!report.valid){outcomes[option.key]={status:'unknown',reasons:report.error?[report.error]:[]};continue;}
        const proposal=typeof landBases==='function'?landBases(option,merged,report):landBases;
        const planned=onTiming?performance.now():0;
        if(selectLandBaseCombat&&proposal){
          const selected=selectLandBaseCombat({store,report,option,proposal});
          outcomes[option.key]={...selected.assessment,landBaseProposal:selected.proposal};
        }else outcomes[option.key]=assess({store,report,option,dirty:false,landBases:proposal?.bases||proposal});
        let chosen=outcomes[option.key].landBaseProposal||proposal;
        if(refineLandBaseEquipment&&chosen?.bases?.some(base=>base.targets?.some(Boolean))){
          // One bounded feedback step: the fitted fleet can change where base
          // support is most valuable. A changed proposal is fitted once more,
          // so the published equipment always matches the published bases.
          for(let pass=0;pass<2;pass++){
            let refined;
            try{refined=await refineLandBaseEquipment({option,slots:merged,report,proposal:chosen});}
            catch(error){
              if(isCancelled())return null;
              const previous=outcomes[option.key],retained=previous?.landBaseProposal;
              if(!validComparison(previous)||!retained)throw error;
              outcomes[option.key]={...previous,landBaseProposal:{...retained,warnings:[...new Set([
                ...(retained.warnings||[]),'联合调装未完成，保留已核对的原配装'])]}};
              break;
            }
            if(isCancelled())return null;
            if(!refined)throw Error('联合配装未完成');
            if(!refined.report?.valid)throw Error(refined.report?.error||'联合配装核对失败');
            const reading=assess({store,report:refined.report,option,dirty:false,landBases:chosen.bases});
            // The previous fleet and its previous base proposal remain a
            // candidate. A missing or worse forecast cannot silently replace
            // them merely because the new outfit has a higher air tier.
            if(!preservesRouting(report,refined.report,option,chosen.bases)||!improvesOrMatches(outcomes[option.key],reading))break;
            merged=refined.slots;report=refined.report;
            outcomes[option.key]={...reading,landBaseProposal:chosen};
            if(pass||!selectLandBaseCombat)break;
            const reviewed=selectLandBaseCombat({store,report,option,proposal:chosen});
            if(!reviewed.proposal?.bases?.some(base=>base.targets?.some(Boolean))||
              JSON.stringify(reviewed.proposal.bases)===JSON.stringify(chosen.bases))break;
            chosen=reviewed.proposal;
          }
        }
        // Only final borderline verdicts receive a second, larger population;
        // preserve the original complete result if the bounded retry times out.
        if(outcomes[option.key]?.status==='estimated'&&outcomes[option.key].uncertain){
          await yieldControl();if(isCancelled())return null;
          const finalProposal=outcomes[option.key].landBaseProposal||proposal;
          let refined;
          try{refined=assess({store,report,option,dirty:false,landBases:finalProposal?.bases||finalProposal,samples:64});}
          catch(_error){/* keep the completed first pass */}
          if(refined?.status==='estimated')outcomes[option.key]={...refined,
            ...(outcomes[option.key].landBaseProposal?{landBaseProposal:outcomes[option.key].landBaseProposal}:{})};
        }
        onPrepared?.(option,{slots:merged,report,combat:outcomes[option.key],
          landBaseProposal:outcomes[option.key].landBaseProposal||proposal});
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
