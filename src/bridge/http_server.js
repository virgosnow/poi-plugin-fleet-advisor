'use strict';
const http=require('http'),crypto=require('crypto');
const {handleMcpPost}=require('./mcp_http');
const {publicError}=require('./service_api');
const DEFAULT_HTTP_PORT=47615;
class McpHttpServer {
  constructor(service,{httpPort=DEFAULT_HTTP_PORT}={}){
    this.service=service;this.instanceId=crypto.randomUUID();this.server=null;
    this.wantedHttpPort=httpPort;this.httpError=null;
  }
  get httpPort(){const address=this.server?.address();return address&&typeof address==='object'?address.port:null;}
  get httpAddress(){return this.httpPort?`http://127.0.0.1:${this.httpPort}/mcp`:null;}
  async start(){
    if(this.server)throw Error('MCP HTTP server already started');
    const server=this.server=http.createServer((request,response)=>{
      void this.handle(request,response).catch(()=>{if(!response.writableEnded){response.writeHead(500);response.end();}});
    });
    try{
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(this.wantedHttpPort,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
      return {instanceId:this.instanceId,port:this.httpPort,httpAddress:this.httpAddress,httpError:null};
    }catch(e){
      this.server=null;server.close();
      if(e.code==='EADDRINUSE')e.message=`端口 ${this.wantedHttpPort} 已被占用，请在设置中更换 HTTP 端口`;
      throw e;
    }
  }
  async handle(request,response){
    const send=(status,body)=>{
      if(response.writableEnded)return;
      response.writeHead(status,{'cache-control':'no-store',...(body==null?{}:{'content-type':'application/json; charset=utf-8'}),
        ...(status===405?{allow:'POST'}:{})});
      response.end(body==null?undefined:body);
    };
    const fail=(status,code,message)=>send(status,JSON.stringify({error:publicError({code,message})}));
    if(request.socket.remoteAddress!=='127.0.0.1'||request.headers.host!==`127.0.0.1:${this.httpPort}`||request.headers.origin!==undefined){
      fail(403,'FORBIDDEN','Only direct loopback clients without a browser Origin are accepted');return;
    }
    if(request.url!=='/mcp'){fail(404,'NOT_FOUND','Use the /mcp endpoint');return;}
    if(request.method!=='POST'){fail(405,'METHOD_NOT_ALLOWED','Stateless Streamable HTTP: use POST');return;}
    if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']||'')){
      fail(415,'UNSUPPORTED_MEDIA_TYPE','Content-Type must be application/json');return;
    }
    const revision=request.headers['mcp-protocol-version'];
    if(revision&&!require('./mcp_tools').SUPPORTED_PROTOCOL_VERSIONS.includes(revision)){
      fail(400,'UNSUPPORTED_PROTOCOL_VERSION','Unsupported MCP-Protocol-Version');return;
    }
    const buffers=[];let length=0;
    try{
      for await(const chunk of request){length+=chunk.length;if(length>262144){fail(413,'REQUEST_TOO_LARGE','Request exceeds 256 KiB');return;}buffers.push(chunk);}
    }catch(_){fail(400,'INVALID_REQUEST','Request body could not be read');return;}
    // Decode UTF-8 only after complete byte collection (chunk boundaries may
    // split multibyte ship names). All local clients share one executor.
    const outcome=await handleMcpPost(this.service,Buffer.concat(buffers).toString('utf8'));
    send(outcome.status,outcome.body);
  }
  async close(){const server=this.server;this.server=null;if(server)await new Promise(resolve=>server.close(()=>resolve()));}
}
module.exports={McpHttpServer,DEFAULT_HTTP_PORT};
