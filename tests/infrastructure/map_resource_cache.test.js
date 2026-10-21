'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),{EventEmitter}=require('events');
const {fileURLToPath}=require('url'),{PNG}=require('pngjs');
const {MapResourceCache}=require('../../src/infrastructure/cache/map_resource_cache');
const {createPoiMapResources,requestResource}=require('../../src/host/map_resources');
const manifest=require('../../data/sortie/maps/index.json');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function sample(){
  const image=new PNG({width:3,height:2});image.data.fill(120);
  const data=PNG.sync.write(image),resource={path:'/kcs2/resources/map/001/01_image.png',
    sha256:digest(data),width:3,height:2,offsetY:0,fallbackUrl:'https://example.test/pinned.png'};
  return {data,resource,map:{resources:[resource]}};
}
function directory(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paa-map-cache-'));
  t.after(()=>{assert(dir.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
  return dir;
}

test('simultaneous small/expanded maps share a download; a fresh process uses only the verified disk cache',async t=>{
  const {data,map}=sample(),dir=directory(t);let calls=0,release;
  const cache=new MapResourceCache({directory:dir,readResource:()=>{calls++;return new Promise(r=>{release=r;});}});
  const first=cache.loadMap(map,'game.test'),second=cache.loadMap(map,'game.test');
  while(!release)await new Promise(r=>setImmediate(r));release(data);
  const [a,b]=await Promise.all([first,second]);assert.equal(calls,1);assert.deepEqual(a,b);
  assert.equal(a.persisted,true);assert.deepEqual(fs.readFileSync(fileURLToPath(a.parts[0].image)),data);
  const fresh=new MapResourceCache({directory:dir,readResource:()=>{throw Error('Must not fetch');}});
  assert.equal((await fresh.loadMap(map)).parts[0].source,'plugin-cache');
  assert.equal(fs.readdirSync(dir).length,1);
});

test('damaged disk images, stale poi cache and changed game atlases cannot be used with pinned geometry',async t=>{
  const {data,map,resource}=sample(),dir=directory(t),urlCalls=[];
  fs.writeFileSync(path.join(dir,resource.sha256+'.png'),data.subarray(0,40));
  const changed=Buffer.from(data);changed[changed.length-1]^=1;
  const cache=new MapResourceCache({directory:dir,readResource:()=>changed,fetchResource:url=>{
    urlCalls.push(url);return url.includes('example.test')?data:changed;
  }});
  const result=await cache.loadMap(map,'game.test');
  assert.equal(result.status,'ready');assert.deepEqual(urlCalls,['https://game.test'+resource.path,resource.fallbackUrl]);
  assert.deepEqual(fs.readFileSync(fileURLToPath(result.parts[0].image)),data);
});

test('source version changes invalidate caches, failures can retry and a hanging reader has a deadline',async t=>{
  const {data,map,resource}=sample(),dir=directory(t);let fail=true,calls=0;
  const cache=new MapResourceCache({directory:dir,timeoutMs:15,readResource:()=>new Promise(()=>{}),
    fetchResource:()=>{calls++;if(fail)throw Error('offline');return data;}});
  await assert.rejects(cache.loadMap(map,'game.test'),/海图暂未加载/);assert.equal(cache.pending.size,0);
  fail=false;await cache.loadMap(map,'game.test');assert(calls>=3);
  const next={...resource,sha256:'a'.repeat(64)};
  await assert.rejects(cache.loadMap({resources:[next]},'game.test'),/海图暂未加载/);
  assert.equal(cache.ready.size,1);
  await assert.rejects(cache.loadMap({resources:[{...resource,path:'/api_req_hensei/change'}]}),/无效/);
});

test('read-only disk preserves the map for this session and reports the persistence problem locally',async t=>{
  const {data,map}=sample(),dir=directory(t),blocked=path.join(dir,'file');fs.writeFileSync(blocked,'occupied');
  const cache=new MapResourceCache({directory:blocked,readResource:()=>data});
  const result=await cache.loadMap(map);
  assert.equal(result.persisted,false);assert.match(result.warning,/缓存未能保存/);
  assert.deepEqual(Buffer.from(result.parts[0].image.split(',')[1],'base64'),data);
});

test('multi-stage maps retain source texture coordinates and load each distinct stage once',async t=>{
  const {data,resource}=sample(),dir=directory(t);let calls=0;
  const second=new PNG({width:2,height:1});second.data.fill(255);const b=PNG.sync.write(second);
  const map={resources:[resource,{...resource,path:'/kcs2/resources/map/005/06_image18.png',
    sha256:digest(b),width:2,height:1,offsetY:2}]};
  const cache=new MapResourceCache({directory:dir,readResource:p=>{calls++;return p.includes('18')?b:data;}});
  const result=await cache.loadMap(map);assert.equal(calls,2);
  assert.deepEqual(result.parts.map(p=>[p.width,p.height,p.offsetY]),[[3,2,0],[2,1,2]]);
  await cache.loadMap(map);assert.equal(calls,2);
});

test('old poi without kcs-resource reads its shared cache, then uses default-session fetch on a miss',async t=>{
  const {data,map,resource}=sample(),dir=directory(t),shared=path.join(dir,'shared');let fetches=0;
  const file=path.join(shared,'KanColle',resource.path);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data);
  const remote={getGlobal:()=>shared,require:name=>{
    if(name==='./lib/kcs-resource')throw Error('MODULE_NOT_FOUND');
    if(name==='./lib/config')return {get:(_,fallback)=>fallback};
    if(name==='electron')return {session:{defaultSession:{fetch:async()=>{fetches++;return {ok:true,arrayBuffer:async()=>data};}}}};
    throw Error(name);
  }};
  const cache=createPoiMapResources({remote,directory:path.join(dir,'plugin')});
  assert.equal((await cache.loadMap(map)).status,'ready');assert.equal(fetches,0);
  fs.unlinkSync(file);
  const next=createPoiMapResources({remote,directory:path.join(dir,'fresh')});
  assert.equal((await next.loadMap(map,'game.test')).status,'ready');assert.equal(fetches,1);
});

test('old Electron net.request honors poi session, rejects incomplete responses and times out',async()=>{
  let behavior='ok',options,aborts=0;
  const session={},net={request:opts=>{options=opts;const request=new EventEmitter();request.abort=()=>{aborts++;};
    request.end=()=>queueMicrotask(()=>{if(behavior==='hang')return;
      const response=new EventEmitter();response.statusCode=behavior==='status'?404:200;
      request.emit('response',response);
      if(behavior==='abort')response.emit('aborted');
      else {response.emit('data',Buffer.from('png'));response.emit('end');}
    });return request;}};
  assert.equal((await requestResource(net,session,'https://game.test/map.png')).toString(),'png');assert.equal(options.session,session);
  behavior='status';await assert.rejects(requestResource(net,session,'https://game.test/map.png'),/下载失败/);
  behavior='abort';await assert.rejects(requestResource(net,session,'https://game.test/map.png'),/中断/);
  behavior='hang';await assert.rejects(requestResource(net,session,'https://game.test/map.png',5),/超时/);assert.equal(aborts,3);
  await assert.rejects(requestResource(net,session,'http://game.test/map.png'),/无效/);
});

test('map loading retires previous areas and retries failures without affecting fleet state',async()=>{
  const state=[],effects=[],callbacks=new Map();let cursor=0,pending=[];
  const React={useState(initial){const i=cursor++;if(!(i in state))state[i]=initial;return [state[i],v=>{state[i]=typeof v==='function'?v(state[i]):v;}];},
    useEffect(fn,deps){const i=cursor++;if(!effects[i]||deps.some((d,j)=>d!==effects[i].deps[j])){
      effects[i]?.cleanup?.();effects[i]={deps};pending.push(()=>{effects[i].cleanup=fn();});
    }}};
  const useLoading=require('../../src/ui/maps/map_loading')(React,{getStore:()=>({}),
    createCache:()=>({loadMap:map=>new Promise((resolve,reject)=>callbacks.set(map,{resolve,reject}))})});
  const render=(area,active=true)=>{cursor=0;const result=useLoading(area,active);const run=pending;pending=[];run.forEach(fn=>fn());return result;};
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  assert.equal(render('1-1').status,'loading');await tick();
  render('5-6');await tick();callbacks.get(manifest.maps['1-1']).resolve({status:'ready',parts:['old']});await tick();
  assert.equal(render('5-6').status,'loading');
  callbacks.get(manifest.maps['5-6']).reject(Error('offline'));await tick();
  const error=render('5-6');assert.equal(error.status,'error');error.retry();render('5-6');await tick();
  callbacks.get(manifest.maps['5-6']).resolve({status:'ready',parts:['new']});await tick();
  assert.deepEqual(render('5-6').parts,['new']);render('5-6',false);assert.equal(render('5-6').status,'ready');
  await tick();assert.equal(render('5-6').status,'ready');
});

test('resource index covers all sprite rectangles including the unseen final stages of 5-6',()=>{
  for(const [area,map] of Object.entries(manifest.maps)){
    assert(map.resources.length,area);
    for(const resource of map.resources){
      assert.match(resource.sha256,/^[a-f0-9]{64}$/);assert(resource.path.startsWith('/kcs2/resources/map/'));
      assert.equal(new URL(resource.fallbackUrl).protocol,'https:');
    }
    for(const sprite of [...map.backgrounds,...Object.values(map.lines).map(line=>line.sprite)]){
      const f=sprite.frame,part=map.resources.find(p=>f.y>=p.offsetY&&f.y+f.h<=p.offsetY+p.height);
      assert(part,area);assert(f.x+f.w<=part.width,area);
    }
  }
  assert.equal(manifest.maps['5-6'].resources.length,4);
});

test('map rendering keeps geometry during loading and maps phased sprites to their own original PNG',()=>{
  const h=(type,props,...children)=>({type,props:props||{},children:children.flat()}),render=require('../../src/ui/maps/route_preview');
  const profile=require('../../src/domain/routes/sortie_profile').previewForMap('5-6');profile.routePaths=[];profile.examples=[];
  const find=(n,p)=>!n||typeof n!=='object'?[]:[...(p(n)?[n]:[]),...(n.children||[]).flatMap(c=>find(c,p))];
  const loading=render(h,{profile,mapAsset:{status:'loading'},compact:true});
  const ready=render(h,{profile,mapAsset:{status:'ready',parts:manifest.maps['5-6'].resources.map((p,i)=>({...p,image:'file:///stage-'+i+'.png'}))},compact:true});
  const svg=tree=>find(tree,n=>n.type==='svg'&&n.props.role==='group')[0];
  assert.equal(svg(loading).props.viewBox,svg(ready).props.viewBox);
  assert.equal(find(loading,n=>n.props.className==='paa-map-loading').length,1);
  assert.equal(find(ready,n=>n.props.className==='paa-map-loading').length,0);
  const images=find(ready,n=>n.type==='image'&&String(n.props.href).startsWith('file:///stage-'));
  assert.equal(new Set(images.map(n=>n.props.href)).size,4);
  assert(images.every(n=>n.props.y<=0));
});
