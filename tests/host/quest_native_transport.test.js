'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {PNG}=require('pngjs');
const {QuestReader}=require('../../src/host/quest_reader');
const {QuestObserver}=require('../../src/infrastructure/quests/quest_observer');

const PORT='/kcsapi/api_port/port',QUEST='/kcsapi/api_get_member/questlist';
const TOKEN='frame-only-test-token';
const plain=value=>JSON.parse(JSON.stringify(value));

function fixture(){
  const f={time:10000,nativeRequests:[],xhrRequests:[],broadcasts:[],redux:[],selectedTabs:[],listeners:new Map()};
  f.state={info:{basic:{api_member_id:123},quests:{activeQuests:{},records:{}}},
    plugins:[{id:'poi-plugin-quest-info-2',enabled:true,switchPluginPath:[QUEST]}]};
  f.config={get:(key,fallback)=>key.startsWith('poi.autoswitch.')?true:fallback};
  f.observer=new QuestObserver({getState:()=>f.state,now:()=>f.time});
  f.payload=()=>({api_result:1,api_data:{api_count:1,api_page_count:1,api_disp_page:1,api_exec_count:1,
    api_list:[{api_no:201,api_state:2,api_title:'敵艦隊を撃破せよ！',api_detail:'敵艦隊を撃破',api_get_material:[50,50,0,0],
      api_token:TOKEN,privateUrl:'https://frame-only.invalid/?api_token='+TOKEN},-1],
    api_token:TOKEN,privateUrl:'https://frame-only.invalid/?api_token='+TOKEN}});
  const response=()=> 'svdata='+JSON.stringify(f.payload());
  const pathOf=url=>new URL(url,'https://game.invalid').pathname;
  const decodePost=value=>Object.fromEntries(new URLSearchParams(value));
  const emit=(type,detail)=>{
    f.broadcasts.push({type,detail});
    // Model the normal resolver order: Redux first, then window events.
    f.redux.push({type:type==='game.request'?'onGameRequest':'onGameResponse',detail});
    if(type==='game.request')f.reader?.observeRequest(detail);
    if(type==='game.response'){
      f.reader?.observeResponse(detail);f.observer.observe(detail);
      // poi central auto-switch semantics: overview first, then the last
      // enabled matching plugin overrides it; selection happens on response.
      if(!f.config.get('poi.autoswitch.enabled',true))return;
      let target=f.config.get('poi.autoswitch.main',true)&&detail.path===QUEST?'main-view':null;
      for(const plugin of f.state.plugins){
        if(!plugin.enabled||!f.config.get('poi.autoswitch.'+plugin.id,true))continue;
        const matches=(plugin.switchPluginPath||[]).some(rule=>typeof rule==='string'?rule===detail.path:
          rule?.path===detail.path&&rule.valid?.(detail));
        if(matches)target=plugin.id;
      }
      if(target)f.selectedTabs.push({target,automatic:true});
    }
  };
  const bridge={
    sendRequest(method,path,url,request){
      emit('game.request',{method,path,body:decodePost(request),time:f.time});
    },
    sendResponse(method,path,url,request,body,responseType,status){
      if(status!==200||!['','json','text'].includes(responseType))return;
      const payload=responseType==='json'?body:JSON.parse(String(body).replace(/^svdata=/,''));
      if(payload.api_result!==1)return;
      const postBody=decodePost(request);delete postBody.api_token;
      emit('game.response',{method,path,body:payload.api_data??payload,postBody,time:f.time});
    }
  };
  // Faithful minimal xhr-hack transport contract, written for this test:
  // listeners installed at construction broadcast request on load, response
  // on loadend. Native fetch is a separate channel, never routed through XHR.
  class HookedXMLHttpRequest {
    constructor(){
      this.events=new Map();this.responseType='';this.status=0;this.responseURL='';
      this.addEventListener('load',()=>bridge.sendRequest(this.method,pathOf(this.responseURL||this.url),this.url,this.request));
      this.addEventListener('loadend',()=>bridge.sendResponse(this.method,pathOf(this.responseURL||this.url),this.responseURL,
        this.request,this.response,this.responseType,this.status));
    }
    addEventListener(type,handler){if(!this.events.has(type))this.events.set(type,[]);this.events.get(type).push(handler);}
    open(method,url){this.method=method;this.url=new URL(url,'https://game.invalid').href;}
    send(body){
      this.request=String(body||'');f.xhrRequests.push({url:this.url,body:this.request});
      // A normal XHR is not announced as in-flight at send time by poi.
      f.normalRequestsBeforeLoad=f.broadcasts.length;
      this.status=200;this.responseURL=this.url;this.response=response();
      for(const callback of this.events.get('load')||[])callback.call(this,{type:'load'});
      for(const callback of this.events.get('loadend')||[])callback.call(this,{type:'loadend'});
    }
  }
  // A JS Proxy is our offline stand-in for the browser's native fetch. The
  // genuine Function.prototype.toString reports the native shape for a Proxy;
  // production code receives no injection and no intrinsic is modified here.
  f.nativeFetch=new Proxy(async function fetch(url,options){
    f.nativeRequests.push({url,options});
    if(f.transportError)throw Error('private https://game.invalid/?api_token='+TOKEN);
    return {ok:true,text:async()=>response()};
  },{});
  const Clock=class extends Date{static now(){return f.time;}};
  f.frameContext=vm.createContext({Date:Clock,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,
    fetch:f.nativeFetch,XMLHttpRequest:HookedXMLHttpRequest,
    location:{href:'https://game.invalid/kcs2/index.php?api_token='+TOKEN,origin:'https://game.invalid'},
    document:{visibilityState:'visible',querySelector:()=>({isConnected:true,getBoundingClientRect:()=>({width:1200,height:720})}),
      addEventListener:(type,listener)=>f.listeners.set(type,listener),
      removeEventListener:(type,listener)=>{if(f.listeners.get(type)===listener)f.listeners.delete(type);}},
    getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'})});
  f.frame={get url(){return f.frameContext.location.href;},executeJavaScript:source=>vm.runInContext(source,f.frameContext)};
  const image=PNG.sync.write(new PNG({width:1200,height:720}));
  const wc={mainFrame:{framesInSubtree:[f.frame]},isDestroyed:()=>false,capturePage:async()=>({toPNG:()=>image})};
  f.reader=new QuestReader({window:{getStore:key=>key==='layout.webview.ref'?{getWebContentsId:()=>1}:f.state},
    getRemote:()=>({webContents:{fromId:()=>wc}}),getStore:()=>f.state,now:()=>f.time,getConfig:()=>f.config,
    observeScreen:async()=>({valid:true,mode:'home'})});
  f.port=async()=>{
    await f.reader.installation;f.time+=10;
    f.reader.observeRequest({path:PORT});f.reader.observeResponse({path:PORT,body:{api_ship:[]}});f.time+=2100;
  };
  f.normalXhr=()=>vm.runInContext(`(()=>{
    const xhr=new XMLHttpRequest();xhr.open('POST',${JSON.stringify(QUEST)});
    xhr.send(new URLSearchParams({api_verno:'1',api_token:${JSON.stringify(TOKEN)},api_tab_id:'0'}).toString());
  })()`,f.frameContext);
  return f;
}

test('native task read succeeds with auto-switch enabled without broadcasting or Redux writes',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();
  const initial=JSON.stringify(f.state);
  const context=await f.reader.context();
  assert.equal(context.compatible,true);assert.equal(context.idle,true);
  const outcome=await f.reader.read({sessionKey:context.sessionKey});
  assert.ok(outcome.list);assert.equal(f.nativeRequests.length,1);assert.equal(f.xhrRequests.length,0);
  assert.deepEqual(f.broadcasts,[]);assert.deepEqual(f.selectedTabs,[]);assert.deepEqual(f.redux,[]);
  assert.equal(f.observer.view().known,false);
  // The plugin's explicit read result is merged only into its own observer.
  assert.equal(f.observer.acceptList(outcome.list),true);
  assert.equal(f.observer.view().known,true);assert.deepEqual(f.observer.view().tasks.map(task=>task.api_no),[201]);
  assert.equal(JSON.stringify(f.state),initial);
  assert.deepEqual(f.broadcasts,[]);assert.deepEqual(f.redux,[]);
});

test('frame-only credentials remain request-local and are absent from returned host data',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();
  const context=await f.reader.context(),outcome=await f.reader.read({sessionKey:context.sessionKey});
  const {url,options}=f.nativeRequests[0];
  assert.equal(url,'https://game.invalid'+QUEST);assert.equal(options.method,'POST');
  assert.equal(options.credentials,'same-origin');
  const posted=new URLSearchParams(options.body);
  assert.equal(posted.get('api_token'),TOKEN);assert.equal(posted.get('api_tab_id'),'0');
  assert.deepEqual([...posted.keys()].sort(),['api_tab_id','api_token','api_verno']);
  const exported=JSON.stringify({context,outcome});
  assert.equal(exported.includes(TOKEN),false);assert.equal(exported.includes('privateUrl'),false);
  assert.equal(exported.includes('game.invalid'),false);
  assert.deepEqual(Object.keys(plain(outcome.list.api_list[0])).sort(),['api_detail','api_get_material','api_no','api_state','api_title']);
});

test('normal XHR remains on its original bridge and auto-switch path after a native read',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();
  const xhr=f.frameContext.XMLHttpRequest,fetch=f.frameContext.fetch;
  const context=await f.reader.context();await f.reader.read({sessionKey:context.sessionKey});
  assert.equal(f.frameContext.XMLHttpRequest,xhr);assert.equal(f.frameContext.fetch,fetch);
  f.normalXhr();
  assert.equal(f.normalRequestsBeforeLoad,0);
  assert.equal(f.xhrRequests.length,1);assert.equal(f.nativeRequests.length,1);
  assert.deepEqual(f.broadcasts.map(event=>event.type),['game.request','game.response']);
  assert.deepEqual(f.redux.map(action=>action.type),['onGameRequest','onGameResponse']);
  assert.deepEqual(f.selectedTabs,[{target:'poi-plugin-quest-info-2',automatic:true}]);
  assert.equal(f.broadcasts[1].detail.postBody.api_token,undefined);
  assert.equal(f.observer.view().known,true);
});

test('ordinary XHR still switches to overview when no task plugin matches',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();f.state.plugins=[];
  f.normalXhr();
  assert.deepEqual(f.broadcasts.map(event=>event.type),['game.request','game.response']);
  assert.deepEqual(f.selectedTabs,[{target:'main-view',automatic:true}]);
});

test('a wrapped fetch defers instead of falling back to hooked XHR',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();
  f.frameContext.fetch=async function wrappedFetch(...args){return f.nativeFetch(...args);};
  const context=await f.reader.context();assert.equal(context.compatible,false);
  const outcome=await f.reader.read({sessionKey:context.sessionKey});assert.equal(outcome.deferred,true);
  assert.equal(f.nativeRequests.length,0);assert.equal(f.xhrRequests.length,0);assert.equal(f.broadcasts.length,0);
  f.normalXhr();assert.equal(f.broadcasts.length,2);assert.equal(f.selectedTabs.length,1);
});

test('native errors remain private and do not synthesize game responses or update the observer',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();f.transportError=true;
  const context=await f.reader.context();
  await assert.rejects(f.reader.read({sessionKey:context.sessionKey}),error=>{
    assert.equal(error.message,'Quest list unavailable');assert.equal(String(error).includes(TOKEN),false);return true;
  });
  assert.equal(f.nativeRequests.length,1);assert.equal(f.broadcasts.length,0);assert.equal(f.redux.length,0);
  assert.equal(f.selectedTabs.length,0);assert.equal(f.observer.view().known,false);
});
