'use strict';
// Shared bridge API surface: the tool dispatch table and the public error
// mapping live here so http_server (HTTP server) and mcp_http (MCP protocol)
// can both depend on them without a module cycle.
const METHODS=Object.freeze({
  fleet_advisor_get_status:(service)=>service.getStatus(),
  fleet_advisor_get_contract:(service)=>service.getContract(),
  fleet_advisor_create_snapshot:(service)=>service.createSnapshot(),
  fleet_advisor_query_quests:(service,args)=>service.queryQuests(args),
  fleet_advisor_query_fleets:(service,args)=>service.queryFleets(args),
  fleet_advisor_query_fleet_presets:(service,args)=>service.queryFleetPresets(args),
  fleet_advisor_query_fleet_status:(service,args)=>service.queryFleetStatus(args),
  fleet_advisor_query_ships:(service,args)=>service.queryShips(args),
  fleet_advisor_query_equipment:(service,args)=>service.queryEquipment(args),
  fleet_advisor_query_equipment_options:(service,args)=>service.queryEquipmentOptions(args),
  fleet_advisor_evaluate_fleet:(service,args)=>service.evaluateFleet(args),
  fleet_advisor_query_expeditions:(service,args)=>service.listExpeditions(args),
  fleet_advisor_evaluate_expedition:(service,args)=>service.evaluateExpedition(args),
  fleet_advisor_recommend_expedition_fleet:(service,args)=>service.recommendExpeditionFleet({...args,goal:args.goal??service.getRecommendationFilters().expedition.defaultGoal}),
  fleet_advisor_recommend_expedition_equipment:(service,args)=>service.recommendExpeditionEquipment({...args,goal:args.goal??service.getRecommendationFilters().expedition.defaultGoal}),
  fleet_advisor_query_normal_maps:(service,args)=>service.listNormalMaps(args),
  fleet_advisor_query_normal_map:(service,args)=>service.queryNormalMap(args),
  fleet_advisor_evaluate_normal_route:(service,args)=>service.evaluateNormalRoute(args),
  fleet_advisor_recommend_normal_fleet:(service,args)=>service.recommendNormalFleet({...args,airGoal:args.airGoal??'superiority'}),
  fleet_advisor_recommend_normal_equipment:(service,args)=>service.recommendNormalEquipment(args)
});
const RETRYABLE=new Set(['PLUGIN_OFFLINE','STORE_NOT_READY','SNAPSHOT_EXPIRED','BUSY']);
const NEXT_ACTION={PLUGIN_OFFLINE:'启动 poi 并启用舰队参谋',STORE_NOT_READY:'等待游戏数据加载后重新建立快照',
  SNAPSHOT_EXPIRED:'重新建立快照',BUSY:'等待当前计算完成',PERMISSION_DENIED:'由用户在插件面板开启 MCP 接入',
  INVALID_SCHEME:'按合同 schemeSchema 修正方案结构'};
const publicError=reason=>{
  const code=reason?.code||'INTERNAL_ERROR';
  return {code,message:reason?.message||'请求失败',details:reason?.details||null,
    retryable:RETRYABLE.has(code),nextAction:NEXT_ACTION[code]||null};
};
function invokeTool(service,name,args){
  require('./tool_validation').validateToolArguments(name,args);
  return METHODS[name](service,args);
}
module.exports={METHODS,publicError,invokeTool};
