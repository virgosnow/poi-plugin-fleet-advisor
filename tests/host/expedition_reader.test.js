'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {readExpeditionProgress}=require('../../src/host/expedition_reader');
function fixture(fetch,search='?api_token=private-test-token'){
  const context={location:{href:'https://example.test/kcs2/index.php'+search,origin:'https://example.test'},URL,URLSearchParams,AbortController,setTimeout,clearTimeout,fetch};
  const frame={url:context.location.href,executeJavaScript:source=>vm.runInNewContext(source,context)};
  const wc={mainFrame:{framesInSubtree:[{url:'https://example.test/other'},frame]}};
  return {window:{getStore:()=>({getWebContentsId:()=>7})},remote:{webContents:{fromId:id=>{assert.equal(id,7);return wc;}}},wc};
}
test('startup mission read uses only the read-only endpoint and never returns session data',async()=>{
  let requests=0;const f=fixture(async(url,options)=>{
    requests++;assert.equal(url,'https://example.test/kcsapi/api_get_member/mission');assert.equal(options.method,'POST');
    assert.equal(new URLSearchParams(options.body).get('api_token'),'private-test-token');assert.equal(options.credentials,'same-origin');
    return {ok:true,text:async()=> 'svdata='+JSON.stringify({api_result:1,api_data:{api_limit_time:123,api_list_items:[{api_mission_id:1,api_state:2,private:'omit'}],secret:'omit'}})};
  });
  const result=await readExpeditionProgress(f.window,f.remote);
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{api_limit_time:123,api_list_items:[{api_mission_id:1,api_state:2}]});assert.equal(requests,1);
});
test('missing game frame/session, transport failures and malformed mission lists fail without other requests',async()=>{
  let calls=0;let f=fixture(async()=>{calls++;throw Error('network');},'');
  await assert.rejects(readExpeditionProgress(f.window,f.remote),/session unavailable/);assert.equal(calls,0);
  f.wc.mainFrame.framesInSubtree=[];await assert.rejects(readExpeditionProgress(f.window,f.remote),/frame unavailable/);
  for(const response of [{ok:false},{ok:true,text:async()=> 'svdata={"api_result":0}'},{ok:true,text:async()=> 'svdata={"api_result":1,"api_data":{}}'}]){
    f=fixture(async()=>response);await assert.rejects(readExpeditionProgress(f.window,f.remote),/unavailable/);
  }
});
