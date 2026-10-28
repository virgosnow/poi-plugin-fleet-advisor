'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {matches,RequestMonitor}=require('../../src/execution/request_monitor');
const {Session}=require('../../src/execution/session');
const {PoiHost}=require('../../src/host/poi_host');
const {Controller}=require('../../src/application/controller');
const policy={path:'api_req_hensei/change',fleet:2,j:0,ship:35};
const request={method:'POST',url:'https://example.invalid/kcsapi/api_req_hensei/change',postData:'api_id=2&api_ship_idx=0&api_ship_id=35'};
test('request matching distinguishes endpoint, method, destination, slot, ship and duplicate parameters',()=>{
  assert(matches(request,policy));
  for(const r of [{...request,method:'GET'},{...request,url:request.url+'/suffix'},
    ...['api_id=1&api_ship_idx=0&api_ship_id=35','api_id=2&api_ship_idx=1&api_ship_id=35','api_id=2&api_ship_idx=0&api_ship_id=34',request.postData+'&api_id=2'].map(postData=>({...request,postData}))])assert(!matches(r,policy));
});
test('equipment endpoints retain their own exact policies',()=>{
  const p={path:'api_req_kaisou/slotset',ship:8,j:2,item:42};
  const r={method:'POST',url:'https://x.invalid/kcsapi/'+p.path,postData:'api_id=8&api_slot_idx=2&api_item_id=42'};
  assert(matches(r,p));assert(!matches(r,policy));assert(!matches({...r,postData:r.postData+'&api_item_id=42'},p));
});

test('all-equipment removal is identified by its own endpoint and exact ship',()=>{
  const p={path:'api_req_kaisou/unsetslot_all',ship:8};
  const r={method:'POST',url:'https://example.invalid/kcsapi/'+p.path,postData:'api_id=8'};
  assert(matches(r,p));assert(!matches(r,{path:'api_req_kaisou/slotset',ship:8,j:0,item:-1}));
  for(const bad of [{...r,method:'GET'},{...r,url:r.url+'/suffix'},{...r,postData:'api_id=9'},{...r,postData:'api_id=8&api_id=8'},
    {...r,url:'https://example.invalid/kcsapi/api_req_kaisou/slotset',postData:'api_id=8&api_slot_idx=0&api_item_id=-1'}])assert(!matches(bad,p));
  const monitor=new RequestMonitor(()=>0);monitor.expect(p,1);monitor.observe(r);assert.equal(monitor.matchedAction,1);assert.throws(()=>monitor.observe(r),/stopping automation only/);
});

test('bulk clear matches minus two at slot zero in the exact destination fleet',()=>{
  const p={path:'api_req_hensei/change',fleet:1,j:0,ship:-2};
  const r={...request,postData:'api_id=1&api_ship_idx=0&api_ship_id=-2'};
  assert(matches(r,p));assert(!matches(r,policy));
  for(const postData of ['api_id=2&api_ship_idx=0&api_ship_id=-2','api_id=1&api_ship_idx=-1&api_ship_id=-2',
    'api_id=1&api_ship_idx=1&api_ship_id=-2','api_id=1&api_ship_idx=0&api_ship_id=-1','api_id=1&api_ship_idx=0&api_ship_id=35',r.postData+'&api_ship_id=-2'])assert(!matches({...r,postData},p));
  const monitor=new RequestMonitor(()=>0);monitor.expect(p,1);monitor.observe(r);assert.equal(monitor.matchedAction,1);
});

test('single escort detach matches the exact minus-one slot and never accepts a replacement or bulk clear',()=>{
  const p={path:'api_req_hensei/change',fleet:2,j:5,ship:-1};
  const r={...request,postData:'api_id=2&api_ship_idx=5&api_ship_id=-1'};
  assert(matches(r,p));
  for(const postData of ['api_id=1&api_ship_idx=5&api_ship_id=-1','api_id=2&api_ship_idx=4&api_ship_id=-1',
    'api_id=2&api_ship_idx=5&api_ship_id=35','api_id=2&api_ship_idx=0&api_ship_id=-2',r.postData+'&api_ship_id=-1'])assert(!matches({...r,postData},p));
  const monitor=new RequestMonitor(()=>0);monitor.expect(p,1);monitor.observe(r);
  assert.equal(monitor.matchedAction,1);assert.throws(()=>monitor.observe(r),/stopping automation only/);
});
test('request observations are one-shot and use a monotonic deadline',()=>{
  let now=0;const p=new RequestMonitor(()=>now);p.expect(policy,1);p.observe(request);assert.equal(p.matchedAction,1);assert.throws(()=>p.observe(request));
  const q=new RequestMonitor(()=>now);q.expect(policy,2);now=10001;assert.throws(()=>q.observe(request));assert.throws(()=>q.expect(policy,3));
});
function hostFixture(occupied=false) {
  const commands=[],sent=[],responses=[],wc=new EventEmitter(),dbg=new EventEmitter();
  let attached=occupied;
  dbg.isAttached=()=>attached;dbg.attach=()=>{attached=true;};dbg.detach=()=>{attached=false;};
  dbg.sendCommand=async(method,params)=>{commands.push({method,params});if(method==='Page.getLayoutMetrics')return {cssVisualViewport:{clientWidth:1200,clientHeight:720,pageX:0,pageY:0,scale:1}};};
  Object.assign(wc,{id:1,debugger:dbg,isDestroyed:()=>false,getURL:()=> 'https://x.invalid/kancolle/',capturePage:async()=>({toPNG:()=>Buffer.from('image')}),sendInputEvent(){}});
  const host=new PoiHost({window:{getStore:key=>key?wc:{info:{}}},remote:{}});
  const transmit=request=>{
    sent.push(request);dbg.emit('message',{},'Network.requestWillBeSent',{requestId:String(sent.length),request});
    // Delivery is independent of the plugin's decision to continue its task.
    const response={api_result:1};responses.push(response);return response;
  };
  return {host,wc,dbg,commands,sent,responses,transmit};
}
test('host does not take an occupied debugger',async()=>{
  const f=hostFixture(true);await assert.rejects(f.host.start(),/occupied/);assert.equal(f.commands.length,0);assert(f.dbg.isAttached());
});
test('unexpected requests stop automation without intercepting traffic and preserve foreign listeners',async()=>{
  const f=hostFixture();const foreign=()=>{};f.dbg.on('message',foreign);await f.host.start();
  const before=f.commands.length;assert.deepEqual(f.transmit(request),{api_result:1});
  assert.equal(f.commands.length,before);assert.throws(()=>f.host.check(),/stopping automation only/);
  await assert.rejects(f.host.input({x:10,y:10,actionId:1}),/stopping automation only/);
  await f.host.dispose();assert.deepEqual(f.dbg.listeners('message'),[foreign]);
  assert(f.commands.some(c=>c.method==='Network.enable'));assert(f.commands.some(c=>c.method==='Network.disable'));
  assert(!f.commands.some(c=>c.method.startsWith('Fetch.')));
});
test('matching UI requests are observed without network commands and duplicates still reach the game',async()=>{
  const f=hostFixture();await f.host.start();f.host.monitor.expect(policy,3);const before=f.commands.length;
  f.transmit(request);assert.equal(f.host.monitor.matchedAction,3);assert(!f.host.error);
  f.transmit(request);assert(f.host.error);assert.equal(f.commands.length,before);assert.equal(f.responses.length,2);
  await f.host.dispose();assert(!f.commands.some(c=>c.method.startsWith('Fetch.')));
});
test('settings, eligibility and unknown future APIs need no whitelist and leave the expected operation intact',async()=>{
  const f=hostFixture();await f.host.start();f.host.monitor.expect(policy,3);const before=f.commands.length;
  for(const path of ['api_req_member/set_oss_condition','api_req_kaisou/can_preset_slot_select','api_req_future/new_operation','api_req_hensei/change/new_endpoint']) {
    f.transmit({method:'POST',url:'https://example.invalid/kcsapi/'+path,postData:'api_language_type=0&api_oss_items%5B0%5D=1'});
    assert(!f.host.error);assert.deepEqual(f.host.monitor.expected,policy);assert.equal(f.host.monitor.matchedAction,null);
  }
  f.transmit(request);assert.equal(f.host.monitor.matchedAction,3);assert.equal(f.commands.length,before);
  await f.host.dispose();assert(!f.commands.some(c=>c.method.startsWith('Fetch.')));
});
test('unexpected request diagnostics omit credentials and unrelated parameters',async()=>{
  const f=hostFixture();await f.host.start();
  f.transmit({...request,url:request.url+'?api_token=url-secret',postData:request.postData+'&api_token=secret-value&unrelated=private'});
  assert(!f.host.error.includes('secret-value'));assert(f.host.error.includes('api_ship_id'));await f.host.dispose();
  assert(!f.host.error.includes('url-secret'));assert(!f.host.error.includes('private'));
});

test('mouse input waits for the matching network notification, not an interception acknowledgement',async()=>{
  const f=hostFixture();await f.host.start();const send=f.dbg.sendCommand;
  f.dbg.sendCommand=async(method,params)=>{const r=await send(method,params);if(method==='Input.dispatchMouseEvent'&&params.type==='mouseReleased')f.transmit(request);return r;};
  await f.host.input({x:20,y:30,mutation:policy,actionId:7});assert.equal(f.host.monitor.matchedAction,7);assert.equal(f.responses.length,1);
  await f.host.dispose();assert(!f.commands.some(c=>c.method.startsWith('Fetch.')));
});

test('a mismatched click stops further automation but leaves the request and response untouched',async()=>{
  const f=hostFixture();await f.host.start();const send=f.dbg.sendCommand;
  f.dbg.sendCommand=async(method,params)=>{const r=await send(method,params);if(method==='Input.dispatchMouseEvent'&&params.type==='mouseReleased')f.transmit({...request,postData:'api_id=2&api_ship_idx=0&api_ship_id=34'});return r;};
  await assert.rejects(f.host.input({x:20,y:30,mutation:policy,actionId:7}),/stopping automation only/);
  const count=f.commands.length;await assert.rejects(f.host.input({x:40,y:50,actionId:8}));assert.equal(f.commands.length,count);
  assert.equal(f.responses.length,1);await f.host.dispose();assert(!f.commands.some(c=>c.method.startsWith('Fetch.')));
});

test('stop releases the mouse and never cancels the in-flight game request',async()=>{
  const f=hostFixture();await f.host.start();const send=f.dbg.sendCommand;
  f.dbg.sendCommand=async(method,params)=>{
    const r=await send(method,params);
    if(method==='Input.dispatchMouseEvent'&&params.type==='mousePressed')f.host.cancel();
    if(method==='Input.dispatchMouseEvent'&&params.type==='mouseReleased')f.transmit(request);
    return r;
  };
  await assert.rejects(f.host.input({x:20,y:30,mutation:policy,actionId:7}),/stopped/);
  assert.equal(f.responses.length,1);await f.host.dispose();f.transmit(request);assert.equal(f.responses.length,2);
  assert(!f.commands.some(c=>c.method.startsWith('Fetch.')));
});

test('missing request notifications never retry a click',async()=>{
  const f=hostFixture();await f.host.start();let time=0;f.host.now=()=>time+=6000;
  await assert.rejects(f.host.input({x:20,y:30,mutation:policy,actionId:7}),/will not be retried/);
  assert.equal(f.commands.filter(c=>c.method==='Input.dispatchMouseEvent'&&c.params.type==='mousePressed').length,1);
  await f.host.dispose();assert(!f.commands.some(c=>c.method.startsWith('Fetch.')));
});
test('reload and debugger detach invalidate host',async()=>{
  for(const event of ['did-start-navigation','detach']){const f=hostFixture();await f.host.start();(event==='detach'?f.dbg:f.wc).emit(event);assert.throws(()=>f.host.check());await f.host.dispose();}
});
test('late capture after stop cannot enter observer or input',async()=>{
  let release,calls=0;const host={check(){},cancel(){},capture:()=>new Promise(r=>release=r),input(){calls++;}};
  const session=new Session(host,{observe(){calls++;}});
  const pending=session.observe('x');session.stop();release(Buffer.from('late'));
  await assert.rejects(pending,/stopped/);assert.equal(calls,0);
});
test('late OCR after stop is rejected',async()=>{
  let release;const session=new Session({check(){},cancel(){},capture:async()=>Buffer.from('x')},{observe:()=>new Promise(r=>release=r)});
  const pending=session.observe('x');await new Promise(r=>setImmediate(r));session.stop();release({valid:true});
  await assert.rejects(pending,/stopped/);
});
test('high frequency checking does not consume time budget',()=>{
  let time=0;const session=new Session({check(){},cancel(){}},{},{now:()=>time,timeoutMs:100});
  for(let n=0;n<10000;n++)session.check();time=101;assert.throws(()=>session.check(),/deadline/);
});
test('modal opening can skip fixed settling while input completion and state checks are retained',async()=>{
  const events=[];let changed=false;
  const session=new Session({check(){},cancel(){},input:async()=>{events.push('input');}},{observe:async()=>({valid:true})});
  session.wait=async ms=>{events.push(ms);};
  session.validate=()=>{events.push('check');if(changed)throw Error('state drift');};
  await session.input(1075,659,undefined,'click',{settleMs:0});
  assert.deepEqual(events,['check','input','check']);events.length=0;
  await session.input(470,480);assert.deepEqual(events,['check','input',100,'check']);events.length=0;
  changed=true;await assert.rejects(session.input(1075,659,undefined,'click',{settleMs:0}),/state drift/);
  assert(!events.includes('input'));
});
test('controller no-op requires no host, OCR or OS tooling',async()=>{
  const c=new Controller({getStore:()=>({info:{ships:{1:{api_ship_id:1,api_lv:1}},fleets:[{api_ship:[1],api_mission:[0]}]},const:{$ships:{1:{api_name:'x',api_stype:2}}}}),createHost(){throw Error('host');},createObserver(){throw Error('ocr');}});
  assert((await c.run('organization',{fleet:1,ships:[1]})).done);
});
test('session prohibits overlapping screenshot and input',async()=>{
  let release,inputs=0;const session=new Session({check(){},cancel(){},capture:()=>new Promise(r=>release=r),input:()=>{inputs++;}},{observe:async()=>({valid:true})});
  const pending=session.observe('x');await assert.rejects(session.input(1,1),/already running/);
  release(Buffer.from('x'));await pending;assert.equal(inputs,0);
});
test('late valid observation cannot bypass phase deadline',async()=>{
  let time=0;const session=new Session({check(){},cancel(){},capture:async()=>Buffer.from('x')},{observe:async()=>{time=7000;return {valid:true};}},{now:()=>time});
  await assert.rejects(session.until('rowidentity',{}),/timed out/);
});
test('host rejects unsupported viewport before any mouse input',async()=>{
  const f=hostFixture();f.dbg.sendCommand=async(method,params)=>{f.commands.push({method,params});if(method==='Page.getLayoutMetrics')return {cssVisualViewport:{clientWidth:800,clientHeight:600}};};
  await assert.rejects(f.host.start(),/Unsupported game viewport/);assert(!f.commands.some(c=>c.method.startsWith('Input.')));
});
test('fractional zoom captures the full viewport without the tiled CSS clip',async()=>{
  const f=hostFixture(),send=f.dbg.sendCommand;
  f.dbg.sendCommand=async(method,params)=>{
    if(method==='Page.getLayoutMetrics')return {cssVisualViewport:{clientWidth:1200.43,clientHeight:720.95,pageX:0,pageY:0,scale:1,zoom:.665}};
    if(method==='Page.captureScreenshot'){assert.equal(params.clip,undefined);return {data:Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,13,0x49,0x48,0x44,0x52,0,0,4,0xb0,0,0,2,0xd0,8,6,0,0,0]).toString('base64')};}
    return send(method,params);
  };
  await f.host.start();assert.equal((await f.host.capture()).length,29);await f.host.dispose();
});
test('lossless fast PNG capture keeps the full viewport and records component timings',async()=>{
  const f=hostFixture(),send=f.dbg.sendCommand;
  const png=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,13,0x49,0x48,0x44,0x52,0,0,4,0xb0,0,0,2,0xd0,8,6,0,0,0]);
  f.dbg.sendCommand=async(method,params)=>{
    if(method==='Page.captureScreenshot'){
      assert.deepEqual(params,{format:'png',fromSurface:true,captureBeyondViewport:false,optimizeForSpeed:true});
      return {data:png.toString('base64')};
    }
    return send(method,params);
  };
  await f.host.start();assert.deepEqual(await f.host.capture(),png);
  assert.equal(f.host.lastCaptureMetrics.fastPng,true);assert.equal(f.host.lastCaptureMetrics.width,1200);
  assert.equal(f.host.lastCaptureMetrics.height,720);assert(f.host.lastCaptureMetrics.commandMs>=0);
  assert(f.host.lastCaptureMetrics.eventLoopLagMs>=0);await f.host.dispose();
});
test('an old capture protocol falls back once on unsupported parameters and remembers that capability',async()=>{
  const f=hostFixture(),send=f.dbg.sendCommand,calls=[];
  const png=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,13,0x49,0x48,0x44,0x52,0,0,4,0xb0,0,0,2,0xd0,8,6,0,0,0]);
  f.dbg.sendCommand=async(method,params)=>{
    if(method==='Page.captureScreenshot'){calls.push(params);if(params.optimizeForSpeed)throw Error('Invalid parameters: optimizeForSpeed');return {data:png.toString('base64')};}
    return send(method,params);
  };
  await f.host.start();await f.host.capture();await f.host.capture();
  assert.equal(calls.length,3);assert.equal(calls[0].optimizeForSpeed,true);assert(!calls[1].optimizeForSpeed);assert(!calls[2].optimizeForSpeed);
  assert.equal(f.host.lastCaptureMetrics.fastPng,false);await f.host.dispose();
});
test('a stalled screenshot never triggers a second capture attempt',async()=>{
  const f=hostFixture(),send=f.dbg.sendCommand;let captures=0;
  f.dbg.sendCommand=async(method,params)=>{if(method==='Page.captureScreenshot'){captures++;throw Error('Debugger command timed out');}return send(method,params);};
  await f.host.start();await assert.rejects(f.host.capture(),/timed out/);assert.equal(captures,1);await f.host.dispose();
});
test('stopping during observer startup prevents all game input',async()=>{
  let release,disposed=0;const state={info:{ships:{1:{api_ship_id:1,api_lv:1},2:{api_ship_id:2,api_lv:1}},fleets:[{api_ship:[1],api_mission:[0]}]},const:{$ships:{1:{api_name:'x',api_stype:2},2:{api_name:'y',api_stype:2}}}};
  const c=new Controller({getStore:()=>state,createHost:()=>({start:async()=>{},cancel(){},dispose:async()=>{disposed++;},input(){throw Error('Unexpected input');}}),createObserver:()=>({start:()=>new Promise(r=>release=r),dispose:async()=>{disposed++;}})});
  const pending=c.run('organization',{fleet:1,ships:[2]});await new Promise(r=>setImmediate(r));
  await assert.rejects(c.run('organization',{fleet:1,ships:[2]}),/busy/);c.stop();release();
  await assert.rejects(pending,/stopped/);assert(disposed>=2);assert(!c.running);
});

test('borrow request checks every source/destination slot-kind field and never blocks traffic',()=>{
 const p={path:'api_req_kaisou/slot_deprive',ship:8,j:-1,slotKind:1,sourceShip:9,sourceJ:2,sourceKind:0};
 const fields={api_set_ship:8,api_set_idx:-1,api_set_slot_kind:1,api_unset_ship:9,api_unset_idx:2,api_unset_slot_kind:0};
 const r={method:'POST',url:'https://example.invalid/kcsapi/'+p.path,postData:new URLSearchParams(fields).toString()};
 assert(matches(r,p));
 for(const key of Object.keys(fields)){assert(!matches({...r,postData:new URLSearchParams({...fields,[key]:fields[key]+1}).toString()},p));assert(!matches({...r,postData:r.postData+'&'+key+'='+fields[key]},p));}
 const monitor=new RequestMonitor(()=>0);monitor.expect(p,1);monitor.observe(r);assert.equal(monitor.matchedAction,1);
 assert.throws(()=>monitor.observe(r),/stopping automation only/);
});
