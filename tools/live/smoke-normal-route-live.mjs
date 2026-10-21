// Read-only live MCP smoke: no fleet or equipment mutation.
const endpoint=process.env.POI_FLEET_ADVISOR_MCP_URL||'http://127.0.0.1:47615/mcp';
let id=0;
async function call(method,params={}){
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',
    'accept':'application/json, text/event-stream','mcp-protocol-version':'2026-07-28'},
    body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
  const body=await response.json();
  if(!response.ok||body.error)throw Error(JSON.stringify(body.error||body));
  return body.result;
}
const tool=async(name,args={})=>{
  const result=await call('tools/call',{name,arguments:args});
  if(result.isError)throw Error(JSON.stringify(result.structuredContent?.error));
  return result.structuredContent;
};
const status=await tool('fleet_advisor_get_status');
if(!status.dataReady)throw Error(status.dataReason||'poi data not ready');
const names=(await call('tools/list')).tools.map(item=>item.name);
for(const name of ['fleet_advisor_query_normal_maps','fleet_advisor_evaluate_normal_route'])
  if(!names.includes(name))throw Error(`${name} is not loaded`);
const snapshot=await tool('fleet_advisor_create_snapshot');
const args={snapshotId:snapshot.snapshotId};
const catalog=await tool('fleet_advisor_query_normal_maps',args);
if(catalog.maps.length!==37)throw Error(`expected 37 maps, got ${catalog.maps.length}`);
const checks=[];
for(const input of [{area:'1-1',fleet:1},{area:'1-3',fleet:1},{area:'1-5',fleet:1},
  {area:'1-6',target:'N',fleet:1},{area:'2-1',fleet:1},
  {area:'3-2',fleet:1},{area:'6-2',fleet:1},{area:'7-3',phase:'gauge2',fleet:1},
  {area:'7-5',phase:'gauge3',fleet:1},{area:'7-5',target:'M',fleet:1}]){
  const result=await tool('fleet_advisor_evaluate_normal_route',{...args,...input});
  checks.push({area:result.area,target:result.target,phase:result.phase,
    targetNodes:result.targetNodes,verdict:result.verdict,
    bossNodes:result.bossNodes,pointCount:result.pointAssessments?.length||0});
}
const find=(area,phase)=>checks.find(check=>check.area===area&&check.phase===phase);
if(JSON.stringify(find('1-3',null).targetNodes)!=='["J"]'||
  JSON.stringify(find('1-5',null).targetNodes)!=='["J"]'||
  JSON.stringify(find('2-1',null).targetNodes)!=='["H"]'||
  JSON.stringify(find('7-3','gauge2').targetNodes)!=='["P"]'||
  JSON.stringify(find('7-5','gauge3').targetNodes)!=='["T"]'||
  JSON.stringify(find('6-2',null).targetNodes)!=='["K"]')
  throw Error('live boss target mismatch');
console.log(JSON.stringify({ok:true,toolCount:names.length,mapCount:catalog.maps.length,checks},null,2));
