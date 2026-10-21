// Read-only protocol and page-coverage smoke. Never prints credentials,
// roster details, saved schemes or inventory. Never executes a game plan.
const endpoint=process.env.POI_FLEET_ADVISOR_MCP_URL||'http://127.0.0.1:47615/mcp';
const url=new URL(endpoint);
if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/mcp'||url.search||url.username||url.password)
  throw Error('Expected a direct loopback /mcp URL');
let id=0;
async function rpc(method,params={}){
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',
    accept:'application/json, text/event-stream','mcp-protocol-version':'2026-07-28'},
    body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
  if(!response.ok)throw Error(`MCP HTTP ${response.status}`);
  const body=await response.json();if(body.error)throw Error(`MCP protocol error ${body.error.code}`);return body.result;
}
async function tool(name,args={}){
  const result=await rpc('tools/call',{name:'fleet_advisor_'+name,arguments:args});
  if(result.isError)throw Error(`Tool ${name} failed: ${result.structuredContent?.error?.code}`);return result.structuredContent;
}
await rpc('initialize',{protocolVersion:'2026-07-28',capabilities:{},clientInfo:{name:'fleet-advisor-readonly-smoke',version:'1'}});
const catalog=await rpc('tools/list'),status=await tool('get_status');
if(!status.dataReady)throw Error('poi account data is not ready');
const snapshot=await tool('create_snapshot'),args={snapshotId:snapshot.snapshotId};
const [fleets,presets,maps,missions]=await Promise.all([
  tool('query_fleets',args),tool('query_fleet_presets',args),tool('query_normal_maps',args),tool('query_expeditions',args)]);
const fleet=await tool('query_fleet_status',{...args,fleet:1});
const map=await tool('query_normal_map',{...args,area:'1-2'});
const evaluation=await tool('evaluate_normal_route',{...args,area:'1-2',fleet:1,routeKey:map.routes[0].key});
if(!evaluation.fleetSummary?.air||!evaluation.fleetSummary?.los)throw Error('Missing selected-route metrics');
const inventory=await tool('query_equipment',{...args,limit:1,fields:['masterId']});
const ships=await tool('query_ships',{...args,limit:1,fields:['level']});
console.log(JSON.stringify({ok:true,transport:'streamable-http',toolCount:catalog.tools.length,fleets:fleets.items.length,
  presetCount:presets.items.length,presetsSynced:presets.synced,mapCount:maps.maps.length,expeditionCount:missions.missions.length,
  fleetShipCount:fleet.ships.length,inventoryCount:inventory.total,shipCount:ships.total},null,2));
