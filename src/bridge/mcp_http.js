'use strict';
const {toolList,instructions,SERVER_INFO,PROTOCOL_VERSION,SUPPORTED_PROTOCOL_VERSIONS}=require('./mcp_tools');
const {METHODS,publicError,invokeTool}=require('./service_api');

// Stateless MCP Streamable-HTTP handler mounted at POST /mcp on the local
// bridge: one JSON-RPC message per request, no sessions, no SSE stream (GET
// returns 405 so clients fall back to plain request/response). Local MCP
// clients configure http://127.0.0.1:<port>/mcp without authentication headers.
const jsonrpc=(id,result)=>({jsonrpc:'2.0',id,result});
const jsonrpcError=(id,code,message)=>({jsonrpc:'2.0',id,error:{code,message}});
const CONTRACT_URI='poi-plugin-fleet-advisor://contract/v2';
const PAGE_TEXT_LIMIT=8192;
function toolText(name,result){
  const full=JSON.stringify(result);
  if(!['fleet_advisor_query_ships','fleet_advisor_query_equipment'].includes(name)||
    Buffer.byteLength(full,'utf8')<=PAGE_TEXT_LIMIT)return full;
  return JSON.stringify({snapshotId:result.snapshotId,total:result.total,count:result.items?.length,
    nextCursor:result.nextCursor,
    note:'完整列表位于 structuredContent；仅支持文本的客户端请用较小 limit 重试，并用 fields 选择所需字段。'});
}

async function callTool(service,name,args){
  try{
    const result=await invokeTool(service,name,args);
    return {...jsonrpc(null,result),content:[{type:'text',text:toolText(name,result)}],structuredContent:result};
  }catch(error){
    // Tool-level failures are results (isError), not transport errors, so
    // agents can read code/nextAction without guessing from text.
    const value=publicError(error);
    return {...jsonrpc(null,{error:value}),content:[{type:'text',text:JSON.stringify({error:value})}],structuredContent:{error:value},isError:true};
  }
}

async function dispatch(service,message){
  const {id,method}=message||{};
  if(method==='initialize'){
    const requested=message.params?.protocolVersion;
    return jsonrpc(id,{protocolVersion:SUPPORTED_PROTOCOL_VERSIONS.includes(requested)?requested:PROTOCOL_VERSION,
      capabilities:{tools:{listChanged:false},resources:{subscribe:false,listChanged:false}},serverInfo:SERVER_INFO,instructions});
  }
  if(method==='ping')return jsonrpc(id,{});
  if(method==='tools/list')return jsonrpc(id,{tools:toolList()});
  if(method==='tools/call'){
    const name=message.params?.name;
    if(typeof name!=='string'||!Object.hasOwn(METHODS,name))return jsonrpcError(id,-32602,`未知工具: ${name}`);
    const args=message.params?.arguments;
    if(args!==undefined&&(!args||typeof args!=='object'||Array.isArray(args)))return jsonrpcError(id,-32602,'arguments must be an object');
    const outcome=await callTool(service,name,args&&typeof args==='object'&&!Array.isArray(args)?args:{});
    // MCP tool results: content/structuredContent/isError live INSIDE the
    // JSON-RPC result object, not beside it.
    const result={content:outcome.content,structuredContent:outcome.structuredContent};
    if(outcome.isError)result.isError=true;
    return jsonrpc(id,result);
  }
  if(method==='resources/list')return jsonrpc(id,{resources:[{uri:CONTRACT_URI,name:'fleet-advisor-contract',title:'舰队参谋方案合同',mimeType:'application/json'}]});
  if(method==='resources/read'){
    if(message.params?.uri!==CONTRACT_URI)return jsonrpcError(id,-32602,'未知资源');
    const contract=await METHODS.fleet_advisor_get_contract(service,{});
    return jsonrpc(id,{contents:[{uri:CONTRACT_URI,mimeType:'application/json',text:JSON.stringify(contract)}]});
  }
  return jsonrpcError(id,-32601,`未知方法: ${method}`);
}

// Returns {status:200|202,body:string|null}. Never throws — malformed input
// becomes JSON-RPC parse/invalid-request errors.
async function handleMcpPost(service,bodyText){
  let message;
  try{message=JSON.parse(bodyText);}
  catch(_){return {status:400,body:JSON.stringify(jsonrpcError(null,-32700,'解析错误'))};}
  if(!message||Array.isArray(message)||typeof message!=='object'||message.jsonrpc!=='2.0'||typeof message.method!=='string'||
    message.id!==undefined&&typeof message.id!=='string'&&typeof message.id!=='number')
    return {status:400,body:JSON.stringify(jsonrpcError(message?.id??null,-32600,'无效请求'))};
  if(message.id===undefined)return {status:202,body:null}; // notification
  try{return {status:200,body:JSON.stringify(await dispatch(service,message))};}
  catch(e){return {status:200,body:JSON.stringify(jsonrpcError(message.id,-32603,publicError(e).message))};}
}
module.exports={handleMcpPost};
