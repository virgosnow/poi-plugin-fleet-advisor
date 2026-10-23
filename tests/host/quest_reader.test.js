'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {PNG}=require('pngjs');
const {QuestReader}=require('../../src/host/quest_reader');
const PORT='/kcsapi/api_port/port',QUEST='/kcsapi/api_get_member/questlist';
function fixture({wrappedFetch=false}={}){
  const f={time:10000,busy:false,visible:true,screen:'home',captures:0,observations:0,requests:[],listeners:new Map(),
    state:{info:{basic:{api_member_id:123}},plugins:[]}};
  f.buffer=PNG.sync.write(new PNG({width:1200,height:720}));
  const Clock=class extends Date{static now(){return f.time;}};
  f.context=vm.createContext({Date:Clock,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,
    location:{href:'https://example.test/kcs2/index.php?api_token=private-test-token',origin:'https://example.test'},
    document:{visibilityState:'visible',querySelector:()=>f.visible?{isConnected:true,getBoundingClientRect:()=>({width:1200,height:720})}:null,
      addEventListener:(name,callback,options)=>{assert.equal(options.passive,true);assert.equal(options.capture,true);f.listeners.set(name,callback);},
      removeEventListener:(name,callback)=>{if(f.listeners.get(name)===callback)f.listeners.delete(name);}},
    getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),
    // A callable Proxy has the same native-source shape as the browser fetch
    // for this isolated transport double; the intrinsic itself is untouched.
    fetch:new Proxy(async function fetch(url,options){
      f.requests.push({url,options});
      if(f.fetch)return f.fetch(url,options);
      return {ok:true,text:async()=> 'svdata='+JSON.stringify({api_result:1,api_data:{api_count:1,api_page_count:1,api_disp_page:1,api_exec_count:1,
        api_list:[{api_no:201,api_title:'敵艦隊を撃破せよ！',api_detail:'敵艦隊を撃破',api_state:2,api_get_material:[50,50,0,0],secret:'omit'},-1],secret:'omit'}})};
    },{})});
  f.nativeFetch=f.context.fetch;
  if(wrappedFetch)f.context.fetch=async function fetch(url,options){return f.nativeFetch(url,options);};
  f.frame={get url(){return f.context.location.href;},executeJavaScript:source=>{
    if(source.includes(',"read",')&&f.beforeRead)f.beforeRead();
    return vm.runInContext(source,f.context);
  }};
  f.wc={mainFrame:{framesInSubtree:[f.frame]},capturePage:async()=>{
    f.captures++;if(f.onCapture)await f.onCapture();return {toPNG:()=>f.buffer};
  },isDestroyed:()=>false};
  f.window={getStore:key=>key==='layout.webview.ref'?{getWebContentsId:()=>7}:f.state};
  f.remote={webContents:{fromId:id=>{assert.equal(id,7);return f.wc;}}};
  f.reader=new QuestReader({window:f.window,getRemote:()=>f.remote,getStore:()=>f.state,now:()=>f.time,
    isBusy:()=>f.busy,observeScreen:async()=>{f.observations++;return {valid:f.screen!=='unknown',mode:f.screen};}});
  f.fire=name=>f.listeners.get(name)?.({type:name});
  f.port=async()=>{
    await f.reader.installation;f.time+=10;
    f.reader.observeRequest({path:PORT,body:{api_token:'do-not-copy'}});
    f.reader.observeResponse({path:PORT,body:{api_ship:[]}});f.time+=2100;
  };
  return f;
}
const plain=value=>JSON.parse(JSON.stringify(value));

test('quest reader uses a quiet observed home and one read-only request without exporting credentials',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();
  const context=await f.reader.context();assert.equal(context.idle,true);assert.equal(context.compatible,true);
  assert.match(context.sessionKey,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(context).includes('private-test-token'),false);
  const result=await f.reader.read({sessionKey:context.sessionKey});
  assert.equal(f.requests.length,1);const {url,options}=f.requests[0];
  assert.equal(url,'https://example.test'+QUEST);assert.equal(options.method,'POST');assert.equal(options.credentials,'same-origin');
  const body=new URLSearchParams(options.body);assert.equal(body.get('api_tab_id'),'0');assert.equal(body.get('api_token'),'private-test-token');
  assert.deepEqual([...body.keys()].sort(),['api_tab_id','api_token','api_verno']);
  assert.deepEqual(plain(result),{list:{api_list:[{api_no:201,api_state:2,api_title:'敵艦隊を撃破せよ！',api_detail:'敵艦隊を撃破',api_get_material:[50,50,0,0]},-1],
    api_count:1,api_page_count:1,api_disp_page:1,api_exec_count:1}});
  assert.equal(JSON.stringify(result).includes('private-test-token'),false);
  assert.equal(f.context.fetch,f.nativeFetch);
});

test('cached context supplies the opaque session while busy or incompatible without taking a capture',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();f.busy=true;
  f.context.fetch=async()=>{};
  const context=await f.reader.context({cached:true});
  assert.match(context.sessionKey,/^[a-f0-9]{64}$/);assert.equal(context.compatible,false);assert.equal(context.idle,false);assert.equal(f.captures,0);
  assert.equal((await f.reader.context({cached:true})).sessionKey,context.sessionKey);
});

test('missing port, input since port, busy state and recent observed API activity defer without fetching',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.reader.installation;f.time+=3000;
  assert.equal((await f.reader.context()).idle,false);assert.equal(f.captures,0);
  await f.port();f.busy=true;assert.equal((await f.reader.context()).idle,false);f.busy=false;
  f.reader.observeRequest({path:'/kcsapi/api_get_member/mission'});
  assert.equal((await f.reader.context()).idle,false);
  // game.request arrives at XHR load. A missing matching notification must
  // not leave a fabricated in-flight counter stuck indefinitely.
  f.time+=2100;assert.equal((await f.reader.context()).idle,true);
  f.reader.observeResponse({path:'/kcsapi/api_get_member/mission',body:[]});
  assert.equal((await f.reader.context()).idle,false);f.time+=2100;
  assert.equal((await f.reader.context()).idle,true);
  f.fire('pointerdown');f.time+=2100;assert.equal((await f.reader.context()).idle,false);
  await f.port();assert.equal((await f.reader.context()).idle,true);
  assert.equal(f.requests.length,0);
});

test('network errors require a fresh port while ordinary responses only reset the quiet interval',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();
  f.reader.observeFailure();f.time+=3000;assert.equal((await f.reader.context()).idle,false);
  await f.port();assert.equal((await f.reader.context()).idle,true);
  f.reader.observeResponse({path:'/kcsapi/api_get_member/basic',body:{}});
  assert.equal((await f.reader.context()).idle,false);
  f.time+=2100;assert.equal((await f.reader.context()).idle,true);
  assert.equal(f.requests.length,0);
});

test('home recognition, visible canvas and capture stability are required',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();
  f.screen='organization';assert.equal((await f.reader.context()).idle,false);
  f.screen='home';f.visible=false;assert.equal((await f.reader.context()).idle,false);f.visible=true;
  f.buffer=PNG.sync.write(new PNG({width:1000,height:1000}));assert.equal((await f.reader.context()).idle,false);
  f.buffer=PNG.sync.write(new PNG({width:1200,height:720}));f.onCapture=()=>f.fire('keydown');
  assert.equal((await f.reader.context()).idle,false);assert.equal(f.requests.length,0);
});

test('high-DPI captures normalize while non-game aspect ratios are rejected',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();
  f.buffer=PNG.sync.write(new PNG({width:1500,height:900}));
  f.reader.observeScreen=async image=>{
    assert.equal(image.width,1200);assert.equal(image.height,720);return {valid:true,mode:'home'};
  };
  assert.equal((await f.reader.context()).idle,true);
});

test('failed port and failed game activity remain deferred until a successful port',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();
  f.reader.observeRequest({path:PORT});f.reader.observeResponse({path:PORT,body:{api_result:0}});f.time+=2100;
  assert.equal((await f.reader.context()).idle,false);
  await f.port();assert.equal((await f.reader.context()).idle,true);
  f.reader.observeRequest({path:'/kcsapi/api_get_member/basic'});f.reader.observeFailure();
  f.time+=2100;assert.equal((await f.reader.context()).idle,false);
  await f.port();assert.equal((await f.reader.context()).idle,true);assert.equal(f.requests.length,0);
});

test('no game webview leaves remote undiscovered and context unready',async()=>{
  let calls=0;const reader=new QuestReader({window:{getStore:()=>null},getRemote:()=>{calls++;throw Error('unexpected');},
    getStore:()=>({})});
  await reader.installation;assert.equal((await reader.context()).ready,false);assert.equal(calls,0);await reader.dispose();
});

test('account or fetch changes during capture invalidate the final read guard',async t=>{
  for(const change of [f=>{f.state.info.basic.api_member_id=456;},f=>{
    f.context.fetch=async()=>{};
  }]){
    const f=fixture();t.after(()=>f.reader.dispose());await f.port();const context=await f.reader.context();
    f.onCapture=()=>change(f);
    assert.equal((await f.reader.read({sessionKey:context.sessionKey})).deferred,true);
    assert.equal(f.requests.length,0);
  }
});

test('a wrapped fetch at installation is unavailable and cannot be disguised with its own toString',async t=>{
  const f=fixture({wrappedFetch:true});t.after(()=>f.reader.dispose());await f.port();
  f.context.fetch.toString=()=> 'function fetch() { [native code] }';
  const context=await f.reader.context();assert.equal(context.compatible,false);assert.equal(context.idle,false);
  assert.equal((await f.reader.read({sessionKey:context.sessionKey})).deferred,true);assert.equal(f.requests.length,0);
});

test('the last frame guard rejects replaced fetch or inspection intrinsic before sending',async t=>{
  for(const change of [f=>{f.context.fetch=new Proxy(f.nativeFetch,{});},f=>{
    vm.runInContext('Function.prototype.toString=function(){return "function fetch() { [native code] }";}',f.context);
  }]){
    const f=fixture();t.after(()=>f.reader.dispose());await f.port();const context=await f.reader.context();
    f.beforeRead=()=>change(f);
    assert.equal((await f.reader.read({sessionKey:context.sessionKey})).deferred,true);assert.equal(f.requests.length,0);
  }
});

test('final frame guard catches input after the host capture and before fetch',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();const context=await f.reader.context();
  f.beforeRead=()=>f.fire('wheel');
  assert.equal((await f.reader.read({sessionKey:context.sessionKey})).deferred,true);assert.equal(f.requests.length,0);
});

test('session changes invalidate an old port and previous session cannot read',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();const original=await f.reader.context();
  f.state.info.basic.api_member_id=456;
  const changed=await f.reader.context({cached:true});assert.notEqual(changed.sessionKey,original.sessionKey);
  assert.equal((await f.reader.context()).idle,false);
  assert.equal((await f.reader.read({sessionKey:original.sessionKey})).deferred,true);assert.equal(f.requests.length,0);
  await f.port();assert.equal((await f.reader.context()).idle,true);
  f.reader.observeStart();assert.equal((await f.reader.context()).idle,false);
});

test('a queued read is cancellable and dispose removes only its own passive listeners',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();const context=await f.reader.context();
  const abort=new AbortController();let started;
  const requestStarted=new Promise(resolve=>{started=resolve;});
  f.fetch=async(url,options)=>new Promise((resolve,reject)=>{
    started();options.signal.addEventListener('abort',()=>reject(Error('private URL must not escape')),{once:true});
  });
  const result=f.reader.read({sessionKey:context.sessionKey,signal:abort.signal});
  const rejected=assert.rejects(result,/Quest list unavailable/);
  await requestStarted;abort.abort();await rejected;assert.equal(f.requests.length,1);
  await f.reader.dispose();assert.equal(f.listeners.size,0);assert.equal((await f.reader.context()).ready,false);
});

test('transport or malformed response errors are sanitized and not retried',async t=>{
  for(const response of [{ok:false},{ok:true,text:async()=> 'invalid private-token text'},
    {ok:true,text:async()=> 'svdata={"api_result":0}'},{ok:true,text:async()=> 'svdata={"api_result":1,"api_data":{}}'}]){
    const f=fixture();t.after(()=>f.reader.dispose());await f.port();const context=await f.reader.context();
    f.fetch=async()=>response;
    await assert.rejects(f.reader.read({sessionKey:context.sessionKey}),/^Error: Quest list unavailable$/);
    assert.equal(f.requests.length,1);
  }
});
