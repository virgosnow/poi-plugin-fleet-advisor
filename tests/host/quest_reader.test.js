'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {PNG}=require('pngjs');
const {QuestReader}=require('../../src/host/quest_reader');
const PORT='/kcsapi/api_port/port',QUEST='/kcsapi/api_get_member/questlist';
function fixture({wrappedFetch=false}={}){
  const f={time:10000,busy:false,visible:true,screen:'home',captures:0,observations:0,requests:[],identityRequests:[],identityMember:123,listeners:new Map(),
    state:{info:{basic:{api_member_id:123}},plugins:[]}};
  f.buffer=PNG.sync.write(new PNG({width:1200,height:720}));
  const Clock=class extends Date{static now(){return f.time;}};
  f.context=vm.createContext({Date:Clock,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,performance:{timeOrigin:98765},
    location:{href:'https://example.test/kcs2/index.php?api_token=private-test-token',origin:'https://example.test'},
    document:{visibilityState:'visible',querySelector:()=>f.visible?{isConnected:true,getBoundingClientRect:()=>({width:1200,height:720})}:null,
      addEventListener:(name,callback,options)=>{assert.equal(options.passive,true);assert.equal(options.capture,true);f.listeners.set(name,callback);},
      removeEventListener:(name,callback)=>{if(f.listeners.get(name)===callback)f.listeners.delete(name);}},
    getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),
    // A callable Proxy has the same native-source shape as the browser fetch
    // for this isolated transport double; the intrinsic itself is untouched.
    fetch:new Proxy(async function fetch(url,options){
      if(url.endsWith('/api_get_member/basic')){
        f.identityRequests.push({url,options});
        if(f.identityFetch)return f.identityFetch(url,options);
        return {ok:true,text:async()=> 'svdata='+JSON.stringify({api_result:1,api_data:{api_member_id:f.identityMember}})};
      }
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

test('late plugin startup verifies the current account without requiring a port event',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.reader.installation;f.time+=2100;
  const context=await f.reader.context();assert.equal(context.idle,true);
  assert.equal(context.identityVerified,false);
  assert.equal(f.identityRequests.length,0,'readiness probes must not send game requests');
  assert.ok((await f.reader.read({sessionKey:context.sessionKey})).list);
  assert.equal(f.identityRequests.length,1);assert.equal(f.requests.length,1);
  assert.equal((await f.reader.context({cached:true})).identityVerified,true);
  await f.reader.read({sessionKey:context.sessionKey});assert.equal(f.identityRequests.length,1);
});

test('a failed basic identity response cannot send a business request or expose credentials',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.reader.installation;f.time+=2100;
  f.identityFetch=async()=>({ok:true,text:async()=> 'svdata='+JSON.stringify({api_result:1,api_data:{secret:'private-test-token'}})});
  const context=await f.reader.context(),result=await f.reader.read({sessionKey:context.sessionKey});
  assert.equal(result.deferred,true);assert.equal(f.requests.length,0);assert(!JSON.stringify(result).includes('private-test-token'));
});

test('identity failures share one session backoff across all endpoints and recover without a port event',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.reader.installation;f.time+=2100;
  f.identityFetch=async()=>{throw Error('private-test-token');};
  let context=await f.reader.context();
  const first=await f.reader.read({sessionKey:context.sessionKey,kind:'missions'});
  assert.equal(first.reason,'identity_unavailable');assert.equal(first.retryAt,f.time+2000);
  for(const kind of ['mapinfo','practice','presets','quest']){
    const deferred=await f.reader.read({sessionKey:context.sessionKey,kind});
    assert.equal(deferred.reason,'identity_backoff');
  }
  assert.equal(f.identityRequests.length,1);assert.equal(f.requests.length,0);
  f.time+=2000;const second=await f.reader.read({sessionKey:context.sessionKey,kind:'missions'});
  assert.equal(second.retryAt,f.time+4000);assert.equal(f.identityRequests.length,2);
  f.time+=4000;delete f.identityFetch;
  assert.ok((await f.reader.read({sessionKey:context.sessionKey})).list);
  assert.equal(f.identityRequests.length,3);assert.equal(f.requests.length,1);
});

test('a new account clears an old identity backoff immediately',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.reader.installation;f.time+=2100;
  f.identityMember=456;const original=await f.reader.context();
  assert.equal((await f.reader.read({sessionKey:original.sessionKey})).reason,'identity_mismatch');
  f.state.info.basic.api_member_id=456;const changed=await f.reader.context({cached:true});f.time+=2100;
  assert.ok((await f.reader.read({sessionKey:changed.sessionKey})).list);
  assert.equal(f.identityRequests.length,2);
});

test('a stale poi account never receives data from a different authenticated frame',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.reader.installation;f.time+=2100;f.identityMember=456;
  const context=await f.reader.context();assert.equal(context.idle,true);
  assert.equal((await f.reader.read({sessionKey:context.sessionKey})).deferred,true);
  assert.equal(f.requests.length,0);assert.equal(f.identityRequests.length,1);
  assert.equal(JSON.stringify(context).includes('private-test-token'),false);
  f.state.info.basic.api_member_id=456;await f.reader.context({cached:true});f.time+=2100;
  const fresh=await f.reader.context();assert.notEqual(fresh.sessionKey,context.sessionKey);
  assert.ok((await f.reader.read({sessionKey:fresh.sessionKey})).list);
  assert.equal(f.requests.length,1);
});

test('an account or game activity change during identity validation prevents the business request',async t=>{
  for(const change of [f=>{f.state.info.basic.api_member_id=456;},
    f=>f.reader.observeResponse({path:'/kcsapi/api_get_member/mission',body:{}}),
    f=>f.fire('pointerdown')]){
    const f=fixture();t.after(()=>f.reader.dispose());await f.reader.installation;f.time+=2100;
    f.identityFetch=async()=>{change(f);return {ok:true,text:async()=> 'svdata='+JSON.stringify({api_result:1,api_data:{api_member_id:123}})};};
    const context=await f.reader.context();const result=await f.reader.read({sessionKey:context.sessionKey});
    assert.equal(result.deferred,true);assert.equal(f.requests.length,0);
  }
});

test('a plugin restart preserves document session identity; a new document changes it',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.reader.installation;f.time+=2100;
  const original=(await f.reader.context()).sessionKey;
  await f.reader.dispose();
  f.reader=new QuestReader({window:f.window,getRemote:()=>f.remote,getStore:()=>f.state,now:()=>f.time,isBusy:()=>f.busy});
  await f.reader.installation;f.time+=2100;
  assert.equal((await f.reader.context({cached:true})).sessionKey,original);
  await f.reader.execute(f.frame,'dispose');f.context.performance.timeOrigin++;
  const changed=await f.reader.context({cached:true});assert.notEqual(changed.sessionKey,original);
  assert.equal((await f.reader.read({sessionKey:original})).deferred,true);
});

test('a game start will not reuse the old frame during account re-login',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.reader.installation;f.time+=2100;
  const original=await f.reader.context();assert.equal(original.idle,true);
  f.reader.observeStart();f.time+=2100;
  assert.equal((await f.reader.context()).ready,false);
  // A late response from the old document cannot prove that re-login ended.
  f.reader.observeResponse({path:PORT,body:{api_ship:[]}});f.time+=2100;
  assert.equal((await f.reader.context()).ready,false);
  await f.reader.execute(f.frame,'dispose');f.context.performance.timeOrigin++;
  const changed=await f.reader.context({cached:true});assert.equal(changed.ready,true);
  assert.notEqual(changed.sessionKey,original.sessionKey);
  f.time+=2100;assert.ok((await f.reader.read({sessionKey:changed.sessionKey})).list);
});

test('login before the old document was probed never treats it as the new session',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.reader.installation;
  f.reader.observeStart();f.time+=3000;
  assert.equal((await f.reader.context()).ready,false);assert.equal(f.requests.length,0);
  f.reader.observeResponse({path:PORT,body:{api_ship:[]}});f.time+=2100;
  assert.equal((await f.reader.context()).ready,true);
});

test('guarded practice reads use the real read-only endpoints and return only allowed opponent fields',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();
  f.fetch=async(url)=>({ok:true,text:async()=> 'svdata='+JSON.stringify({api_result:1,api_data:url.endsWith('/practice')?
    {api_list:[{api_enemy_id:12,api_enemy_name:'对手',api_enemy_level:99,api_enemy_flag_ship:17,api_state:1,secret:'omit'}]}:
    {api_member_id:12,api_deck:{api_ships:[{api_ship_id:17,api_level:50,secret:'omit'}]},secret:'omit'}})});
  const sessionKey=(await f.reader.context()).sessionKey;
  const list=await f.reader.read({sessionKey,kind:'practice'}),enemy=await f.reader.read({sessionKey,kind:'practice-enemy',enemyId:12});
  assert.deepEqual(plain(list),{list:{api_list:[{api_enemy_id:12,api_enemy_name:'对手',api_enemy_level:99,api_enemy_flag_ship:17,api_state:1}]}});
  assert.deepEqual(plain(enemy),{enemy:{api_member_id:12,api_deck:{api_ships:[{api_ship_id:17,api_level:50}]}}});
  assert.equal(f.requests[0].url,'https://example.test/kcsapi/api_get_member/practice');
  assert.equal(f.requests[1].url,'https://example.test/kcsapi/api_req_member/get_practice_enemyinfo');
  assert.equal(new URLSearchParams(f.requests[1].options.body).get('api_member_id'),'12');
  assert(!JSON.stringify([list,enemy]).includes('private-test-token'));assert(!JSON.stringify([list,enemy]).includes('omit'));
  f.busy=true;assert.equal((await f.reader.read({sessionKey,kind:'practice'})).deferred,true);assert.equal(f.requests.length,2);
});
test('input during an automatic practice request aborts it and allows a later safe retry',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();let started;
  const pending=new Promise(resolve=>{started=resolve;});
  f.fetch=async(_url,options)=>{started();return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));};
  const sessionKey=(await f.reader.context()).sessionKey,read=f.reader.read({sessionKey,kind:'practice'});
  await pending;f.fire('pointerdown');assert.equal((await read).deferred,true);
});
test('task and practice background reads share one in-flight guard',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();let start,release;
  const started=new Promise(resolve=>{start=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  f.fetch=async()=>{start();await gate;return {ok:true,text:async()=> 'svdata='+JSON.stringify({api_result:1,api_data:{api_list:[]}})};};
  const sessionKey=(await f.reader.context()).sessionKey;
  const first=f.reader.read({sessionKey,kind:'practice'});await started;
  assert.equal((await f.reader.read({sessionKey})).deferred,true);assert.equal(f.requests.length,1);
  release();assert.deepEqual(plain(await first),{list:{api_list:[]}});
});
test('guarded startup reads sanitize map, airbase, preset and mission data',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();
  f.fetch=async url=>({ok:true,text:async()=> 'svdata='+JSON.stringify({api_result:1,api_data:url.endsWith('/mapinfo')?
    {api_map_info:[{api_id:25,api_cleared:1,api_gauge_num:2,api_eventmap:{api_now_maphp:30,secret:'omit'},secret:'omit'},{api_id:11}],
      api_air_base:[{api_area_id:6,api_rid:1,api_plane_info:[{api_slotid:123,api_count:18,secret:'omit'}]}]}:
    url.endsWith('/preset_deck')?{api_max_num:5,api_deck:{1:{api_name:'队伍',api_ship:[1,2,-1],secret:'omit'}}}:
      {api_list_items:[{api_mission_id:1,api_state:2,secret:'omit'}]}})});
  const sessionKey=(await f.reader.context()).sessionKey;
  const map=await f.reader.read({sessionKey,kind:'mapinfo'}),preset=await f.reader.read({sessionKey,kind:'presets'}),mission=await f.reader.read({sessionKey,kind:'missions'});
  assert.equal(map.mapinfo.maps[0].api_eventmap.api_now_maphp,30);assert.equal(map.mapinfo.airbase[0].api_plane_info[0].api_slotid,123);
  assert.deepEqual(plain(preset.presets.api_deck['1'].api_ship),[1,2,-1]);assert.equal(mission.missions.api_list_items[0].api_state,2);
  assert(!JSON.stringify([map,preset,mission]).includes('omit'));assert(!JSON.stringify([map,preset,mission]).includes('private-test-token'));
  assert.deepEqual(f.requests.map(x=>new URL(x.url).pathname),['/kcsapi/api_get_member/mapinfo','/kcsapi/api_get_member/preset_deck','/kcsapi/api_get_member/mission']);
});
test('incomplete airbase data is never treated as an empty equipment inventory',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();
  f.fetch=async()=>({ok:true,text:async()=> 'svdata='+JSON.stringify({api_result:1,api_data:{api_map_info:[{api_id:11}],api_air_base:[{api_area_id:6,api_rid:1}]}})});
  const sessionKey=(await f.reader.context()).sessionKey;
  await assert.rejects(f.reader.read({sessionKey,kind:'mapinfo'}),/Quest list unavailable/);
});

test('explicit full read requests each page and never claims an incomplete list',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();
  f.fetch=async(url,options)=>{
    const page=Number(new URLSearchParams(options.body).get('api_page_no')||1);
    return {ok:true,text:async()=> 'svdata='+JSON.stringify({api_result:1,api_data:{api_count:2,api_page_count:2,
      api_disp_page:page,api_list:[{api_no:200+page,api_state:1,api_title:`task ${page}`},-1]}})};
  };
  let result=await f.reader.readAll();
  assert.equal(result.status,'ready');assert.deepEqual(plain(result.tasks.map(x=>x.api_no)),[201,202]);
  assert.deepEqual(f.requests.map(x=>new URLSearchParams(x.options.body).get('api_page_no')),[null,'2']);
  f.fetch=async()=>({ok:true,text:async()=> 'svdata='+JSON.stringify({api_result:1,api_data:{api_count:2,
    api_page_count:2,api_disp_page:1,api_list:[{api_no:201,api_state:1}]}})});
  result=await f.reader.readAll();assert.equal(result.status,'incomplete');assert.equal(result.tasks,undefined);
});

test('a modern unpaged task list is complete only when count and unique rows agree',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();
  f.fetch=async()=>({ok:true,text:async()=> 'svdata='+JSON.stringify({api_result:1,api_data:{api_count:2,
    api_list:[{api_no:442,api_state:2,api_label_type:102},{api_no:443,api_state:1,api_label_type:1}]}})});
  const result=await f.reader.readAll();assert.equal(result.status,'ready');assert.equal(result.tasks.length,2);
  assert.equal(result.tasks[0].api_label_type,102);assert.equal(f.requests.length,1);
});

test('a changed game state during full collection prevents partial results',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();
  f.fetch=async()=>{
    f.reader.observeResponse({path:'/kcsapi/api_get_member/basic',body:{}});
    return {ok:true,text:async()=> 'svdata='+JSON.stringify({api_result:1,api_data:{api_count:1,
      api_page_count:1,api_disp_page:1,api_list:[{api_no:201,api_state:1}]}})};
  };
  const result=await f.reader.readAll();assert.equal(result.status,'deferred');assert.equal(result.tasks,undefined);
});

test('quest reader verifies identity and uses a read-only request without exporting credentials',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();
  const context=await f.reader.context();assert.equal(context.idle,true);assert.equal(context.compatible,true);
  assert.match(context.sessionKey,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(context).includes('private-test-token'),false);
  const result=await f.reader.read({sessionKey:context.sessionKey});
  assert.equal(f.identityRequests.length,1);
  assert.equal(new URL(f.identityRequests[0].url).pathname,'/kcsapi/api_get_member/basic');
  assert.equal(f.requests.length,1);const {url,options}=f.requests[0];
  assert.equal(url,'https://example.test'+QUEST);assert.equal(options.method,'POST');assert.equal(options.credentials,'same-origin');
  const body=new URLSearchParams(options.body);assert.equal(body.get('api_tab_id'),'0');assert.equal(body.get('api_token'),'private-test-token');
  assert.deepEqual([...body.keys()].sort(),['api_tab_id','api_token','api_verno']);
  assert.deepEqual(plain(result),{list:{api_list:[{api_no:201,api_state:2,api_title:'敵艦隊を撃破せよ！',api_detail:'敵艦隊を撃破',api_get_material:[50,50,0,0]},-1],
    api_count:1,api_page_count:1,api_disp_page:1,api_exec_count:1}});
  assert.equal(JSON.stringify(result).includes('private-test-token'),false);
  assert.equal(f.context.fetch,f.nativeFetch);
});

test('quest reader forwards only safe fields from game-provided selectable rewards',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();
  f.fetch=async()=>({ok:true,text:async()=> 'svdata='+JSON.stringify({api_result:1,api_data:{api_list:[{
    api_no:201,api_state:2,api_select_rewards:[[{api_no:1,api_kind:12,api_mst_id:35,api_count:2,secret:'omit'}]],secret:'omit'}]}})});
  const context=await f.reader.context(),result=await f.reader.read({sessionKey:context.sessionKey});
  assert.deepEqual(plain(result.list.api_list[0].api_select_rewards),[[{api_no:1,api_kind:12,api_mst_id:35,api_count:2}]]);
  assert(!JSON.stringify(result).includes('omit'));
});

test('cached context supplies the opaque session while busy or incompatible without taking a capture',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();f.busy=true;
  f.context.fetch=async()=>{};
  const context=await f.reader.context({cached:true});
  assert.match(context.sessionKey,/^[a-f0-9]{64}$/);assert.equal(context.compatible,false);assert.equal(context.idle,false);assert.equal(f.captures,0);
  assert.equal((await f.reader.context({cached:true})).sessionKey,context.sessionKey);
});

test('late bootstrap and ordinary input need no port, while activity and busy state defer',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.reader.installation;f.time+=3000;
  assert.equal((await f.reader.context()).idle,true);assert.equal(f.captures,0);
  await f.port();f.busy=true;assert.equal((await f.reader.context()).idle,false);f.busy=false;
  f.reader.observeRequest({path:'/kcsapi/api_get_member/mission'});
  assert.equal((await f.reader.context()).idle,false);
  // game.request arrives at XHR load. A missing matching notification must
  // not leave a fabricated in-flight counter stuck indefinitely.
  f.time+=2100;assert.equal((await f.reader.context()).idle,true);
  f.reader.observeResponse({path:'/kcsapi/api_get_member/mission',body:[]});
  assert.equal((await f.reader.context()).idle,false);f.time+=2100;
  assert.equal((await f.reader.context()).idle,true);
  f.fire('pointerdown');assert.equal((await f.reader.context()).idle,false);
  f.time+=2100;assert.equal((await f.reader.context()).idle,true);
  assert.equal(f.requests.length,0);
});

test('network errors and ordinary responses reset the quiet interval without needing a port',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();
  f.reader.observeFailure();assert.equal((await f.reader.context()).idle,false);
  f.time+=3000;assert.equal((await f.reader.context()).idle,true);
  f.reader.observeResponse({path:'/kcsapi/api_get_member/basic',body:{}});
  assert.equal((await f.reader.context()).idle,false);
  f.time+=2100;assert.equal((await f.reader.context()).idle,true);
  assert.equal(f.requests.length,0);
});

test('background and non-home game documents remain readable without capture or focus',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();
  f.screen='organization';f.context.document.visibilityState='hidden';
  assert.equal((await f.reader.context()).idle,true);assert.equal(f.captures,0);
  f.visible=false;assert.equal((await f.reader.context()).idle,false);
});

test('failed port and game activity recover after quiet and revalidate identity',async t=>{
  const f=fixture();t.after(()=>f.reader.dispose());await f.port();
  f.reader.observeRequest({path:PORT});f.reader.observeResponse({path:PORT,body:{api_result:0}});f.time+=2100;
  assert.equal((await f.reader.context()).idle,true);
  f.reader.observeRequest({path:'/kcsapi/api_get_member/basic'});f.reader.observeFailure();
  f.time+=2100;assert.equal((await f.reader.context()).idle,true);assert.equal(f.requests.length,0);
});

test('no game webview leaves remote undiscovered and context unready',async()=>{
  let calls=0;const reader=new QuestReader({window:{getStore:()=>null},getRemote:()=>{calls++;throw Error('unexpected');},
    getStore:()=>({})});
  await reader.installation;assert.equal((await reader.context()).ready,false);assert.equal(calls,0);await reader.dispose();
});

test('account or fetch changes immediately before sending invalidate the final read guard',async t=>{
  for(const change of [f=>{f.state.info.basic.api_member_id=456;},f=>{
    f.context.fetch=async()=>{};
  }]){
    const f=fixture();t.after(()=>f.reader.dispose());await f.port();const context=await f.reader.context();
    f.beforeRead=()=>change(f);
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
