'use strict';
// The assessment follows the inspected draft and its selected, feasible paths;
// it never uses map-overview paths as proof of reachability. Cache only for an
// immutable inspection and the same store references, never across snapshots.
function createCombatAssessment({plans,profileForRoute,evaluate}){
  const inspections=new WeakMap();
  return function assess({store,report,option,dirty=false}){
    if(!option)return {status:'unselected',reasons:['请选择路线']};
    if(!report?.scheme?.ships?.length)return {status:'empty',reasons:['请选择舰娘']};
    if(dirty||!report.valid||!report.route?.area||
      option.phase&&option.phase!==report.route.phase)
      return {status:'pending',reasons:['正在核对当前编成与路线']};
    let cache=inspections.get(report);
    if(!cache){cache=new Map();inspections.set(report,cache);}
    const key=JSON.stringify([option.key||null,option.phase||null,plans.optionPaths(option)]);
    const prior=cache.get(key);
    if(prior&&prior.info===store.info&&prior.master===store.const)return prior.value;
    let value;
    try{
      const paths=plans.fleetPaths(report.route,option);
      if(!paths.length)value={status:'unreachable',reasons:['当前编成无法沿所选路线到达']};
      else{
        const profile=profileForRoute(report.route.area,report.route,paths);
        const expected=new Set(paths.map(nodes=>nodes.join('>')));
        const found=new Set((profile.routePaths||[]).map(path=>path.nodes.join('>')));
        if(profile.status==='unavailable'||!found.size||found.size!==expected.size||[...expected].some(path=>!found.has(path)))
          value={status:'unknown',reasons:[profile.reason||'所选路线资料不足']};
        else {
          // A full-graph walk can be incomplete because of another route. Only
          // clear its graph-wide flags when every selected, fleet-checked path
          // was explicitly found. Per-path uncertainty is retained unchanged.
          const selected={...profile,incomplete:false,truncated:false,selectedPathsVerified:true};
          value=evaluate(store,report.scheme,selected,{route:report.route,airPower:report.metrics?.airPower});
        }
      }
    }catch(error){value={status:'unknown',reasons:['战力资料暂无法计算']};}
    if(cache.size>=8)cache.delete(cache.keys().next().value);
    cache.set(key,{info:store.info,master:store.const,value});
    return value;
  };
}
const assessCombat=createCombatAssessment({plans:require('../domain/routes/route_plans'),
  profileForRoute:require('../domain/routes/sortie_profile').profileForRoute,
  evaluate:require('../domain/combat/route_estimate').evaluateRoute});
module.exports={createCombatAssessment,assessCombat};
