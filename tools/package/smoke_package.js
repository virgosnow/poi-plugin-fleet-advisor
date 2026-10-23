'use strict';
// Exercise the actual packed worker from a fresh path, without access to
// this checkout's node_modules. Test tooling only; never connects to the
// game. Identity checks run on position + level digits + cyan button
// gating; no OCR ships in the package.
const fs=require('fs'),path=require('path'),os=require('os'),zlib=require('zlib');
const {Worker}=require('worker_threads');
const tar=zlib.gunzipSync(fs.readFileSync(process.argv[2]||`poi-plugin-fleet-advisor-${require('../../package.json').version}.tgz`));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'poi-plugin-zh-'));
let worker;
async function main() {
  let pax={};
  for(let offset=0;offset+512<=tar.length;) {
    const header=tar.subarray(offset,offset+512),str=(a,b)=>header.subarray(a,b).toString().split('\0')[0];
    const name=str(0,100);if(!name)break;
    const size=parseInt(str(124,136).trim(),8)||0,type=str(156,157),prefix=str(345,500);
    const data=tar.subarray(offset+512,offset+512+size);offset+=512+Math.ceil(size/512)*512;
    if(type==='x') {
      pax={};let p=0;
      while(p<data.length){const space=data.indexOf(32,p),length=Number(data.subarray(p,space).toString());if(!length)break;const record=data.subarray(space+1,p+length-1).toString(),equal=record.indexOf('=');pax[record.slice(0,equal)]=record.slice(equal+1);p+=length;}
      continue;
    }
    const relative=pax.path||(prefix?prefix+'/':'')+name;pax={};
    const dest=path.resolve(root,relative);
    if(!dest.startsWith(path.resolve(root)+path.sep))throw new Error('Archive path escapes smoke workspace');
    if(type==='5'){fs.mkdirSync(dest,{recursive:true});continue;}
    if(type!==''&&type!=='0')throw new Error('Unsupported archive entry');
    fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,data);
  }
  const deny=path.join(root,'deny-network.cjs');
  fs.writeFileSync(deny,"const no=()=>{throw Error('Network forbidden in package smoke');}; for(const p of ['http','https']){require(p).request=no;require(p).get=no;}require('net').connect=no;require('net').createConnection=no;global.fetch=no;\n");
  worker=new Worker(path.join(root,'package/src/vision/worker.js'),{execArgv:['--require',deny]});
  let sequence=0;
  function call(kind,frame,arg) {
    return new Promise((resolve,reject)=>{
      const id=++sequence;
      const timer=setTimeout(()=>finish(new Error('Packed worker timed out')),30000);
      const onError=()=>finish(new Error('Packed worker failed'));
      const onMessage=m=>{if(m.id===id)finish(m.error?new Error(m.error):null,m.result);};
      function finish(error,result){clearTimeout(timer);worker.removeListener('message',onMessage);worker.removeListener('error',onError);error?reject(error):resolve(result);}
      worker.on('message',onMessage);worker.on('error',onError);worker.postMessage({id,kind,frame,arg});
    });
  }
  await call('initialize');
  const {matchesName}=require(path.join(root,'package/src/shared/name_matching.js'));
  if(!matchesName('発煙装置(煙幕)','发烟装置')||!matchesName('翔鶴改二甲','翔鹤'))throw new Error('Packed name-variant matching failed');
  const {routeOptions}=require(path.join(root,'package/src/domain/routes/route_plans.js'));
  if(routeOptions('2-5')[0].label!=='下路空母流（C→E→I→O）')throw new Error('Packed route guide failed');
  require(path.join(root,'package/src/domain/routes/route_speed.js'));
  const questCatalog=require(path.join(root,'package/data/quests/requirements.json'));
  const firstSortie=questCatalog.quests.find(quest=>quest.code==='B1');
  const {listRelatedQuests}=require(path.join(root,'package/src/domain/quests/quest_requirements.js'));
  const related=listRelatedQuests({state:require('../../tests/helpers/workbench_fixture')(),mapId:'1-1',slots:[],
    questState:{known:true,tasks:[{api_no:firstSortie.ids[0],api_state:1,api_title:firstSortie.title}]}});
  if(related.tasks.length!==1||related.tasks[0].status!=='unknown')throw Error('Packed task catalog or empty-draft check failed');
  require(path.join(root,'package/src/infrastructure/quests/quest_observer.js'));
  const {QuestAutoRead}=require(path.join(root,'package/src/infrastructure/quests/quest_auto_read.js'));
  require(path.join(root,'package/src/host/quest_reader.js'));
  let questReads=0;
  const bootstrap=new QuestAutoRead({stableMs:0,getContext:()=>({sessionKey:'package-smoke',ready:true,idle:true,compatible:true}),
    getQuestState:()=>({known:false}),read:async()=>{questReads++;throw Error('Simulated task read failure');}});
  bootstrap.setActive('normal',true);await bootstrap.tick();bootstrap.setActive('expedition',true);await bootstrap.tick();
  bootstrap.dispose();if(questReads!==1)throw Error('Packed task bootstrap retried a failed read');
  // No development map PNGs may be needed in a clean installed package.
  const maps=path.join(root,'package/data/sortie/maps'),mapIndex=require(path.join(maps,'index.json'));
  if(fs.readdirSync(maps).some(n=>/^\d+-\d+\.png$/.test(n)))throw Error('Packed development maps');
  const {MapResourceCache}=require(path.join(root,'package/src/infrastructure/cache/map_resource_cache.js'));
  require(path.join(root,'package/src/host/map_resources.js'));
  const source=require(path.join(maps,'map_common.source.json')),data=fs.readFileSync(path.join(maps,'map_common.png'));
  const mapResource={path:'/kcs2/resources/map/001/01_image.png',sha256:source.imageEncoding.sha256,
    width:source.runtimeAtlas.size.w,height:source.runtimeAtlas.size.h,offsetY:0};
  const directory=path.join(root,'map-cache'),mapCache=new MapResourceCache({directory,readResource:()=>data});
  await mapCache.loadMap({resources:[mapResource]});
  const diskMap=new MapResourceCache({directory,readResource:()=>{throw Error('Network forbidden');}});
  if((await diskMap.loadMap({resources:[mapResource]})).parts[0].source!=='plugin-cache')throw Error('Packed map cache miss');
  if(Object.keys(mapIndex.maps).length!==37)throw Error('Packed map index incomplete');
  const fixtures=p=>path.join(__dirname,'../../tests/fixtures',p);
  // Identity: level digits + teal button gate (no OCR ships in the package).
  const card=fs.readFileSync(fixtures('org/page06-card.png'));
  const grey=await call('cardidentity',card,{expectedLevel:92});
  if(grey.valid||grey.reason!=='confirmation button not available (grey)')throw new Error('Packed grey-button gate failed');
  const fiveSlot=await call('cardidentity',fs.readFileSync(fixtures('identity/musashi-five-slot-card.png')),{checkLevel:false});
  if(!fiveSlot.valid||fiveSlot.level!==undefined||fiveSlot.commit?.y!==669)throw new Error('Packed five-slot card confirmation failed');
  const row=fs.readFileSync(fixtures('identity/2422-row.png'));
  const ok=await call('rowidentity',row,{row:2,fleet:2,total:35,page:28,mask:[1,1,1,1,1,1,1,1],expectedLevel:67});
  if(!ok.valid||ok.level!==67)throw new Error('Packed level identity failed');
  const bulk=await call('orgclear',fs.readFileSync(fixtures('org/clear-hover.png')),{fleet:2});
  if(!bulk.valid||bulk.commit?.x!==625||bulk.commit?.y!==178)throw new Error('Packed bulk-clear observation failed');
  const equipmentBulk=await call('equipclear',fs.readFileSync(fixtures('equip/clear-hover-3.png')),{fleet:2,slots:3});
  if(!equipmentBulk.valid||equipmentBulk.commit?.x!==485||equipmentBulk.commit?.y!==395)throw new Error('Packed equipment bulk-clear observation failed');
  const picker=await call('equippicker',fs.readFileSync(fixtures('equip/picker-transport.png')),{total:161});
  if(!picker.valid||picker.primary!==20||picker.page?.activePage!==1)throw new Error('Packed equipment category observation failed');
  const {RecommendationWorker}=require(path.join(root,'package/src/infrastructure/workers/recommendation_worker.js'));
  const cacheDir=path.join(root,'search-cache'),recommendationWorker=new RecommendationWorker({cacheDir});
  try{
    const snapshot=require('../../tests/helpers/workbench_fixture')();
    const result=await recommendationWorker.run('recommendNormalFleet',snapshot,{area:'1-1',limit:1,byRoute:true});
    if(!result.recommendations.length)throw Error('Packed recommendation worker returned no result');
    const entries=fs.readdirSync(cacheDir).filter(n=>n.endsWith('.bin'));
    if(entries.length!==1)throw Error('Packed recommendation cache was not written');
    const cacheFile=path.join(cacheDir,entries[0]),past=new Date(Date.now()-60000);
    fs.utimesSync(cacheFile,past,past);const stamp=fs.statSync(cacheFile).mtimeMs;
    const again=await recommendationWorker.run('recommendNormalFleet',snapshot,{area:'1-1',limit:1,byRoute:true});
    require('assert/strict').deepEqual(again,result);
    if(fs.statSync(cacheFile).mtimeMs!==stamp)throw Error('Packed recommendation cache did not hit');
    const calculations=path.join(cacheDir,'calculations'),tables=fs.readdirSync(calculations).filter(n=>n.endsWith('.bin'));
    if(!tables.length)throw Error('Packed calculation cache was not written');
    for(const name of tables)fs.utimesSync(path.join(calculations,name),past,past);
    const times=tables.map(name=>fs.statSync(path.join(calculations,name)).mtimeMs);
    snapshot.info.basic.api_nickname='changed snapshot';
    const changed=await recommendationWorker.run('recommendNormalFleet',snapshot,{area:'1-1',limit:1,byRoute:true});
    require('assert/strict').deepEqual(changed,result);
    require('assert/strict').deepEqual(tables.map(name=>fs.statSync(path.join(calculations,name)).mtimeMs),times);
    const expeditionArgs={missionId:1,fleet:2,limit:1};
    const expedition=await recommendationWorker.run('recommendExpeditionFleet',snapshot,expeditionArgs);
    require('assert/strict').deepEqual(expedition.goals,
      require(path.join(root,'package/src/recommendation/index.js')).recommendExpeditionGoals(snapshot,expeditionArgs));
  }finally{await recommendationWorker.dispose();}
  console.log(JSON.stringify({ok:true,packedWorker:true,recommendationWorker:true,expeditionParallel:true,recommendationCache:true,crossSnapshotCalculations:true,mapResourceCache:true,networkDisabled:true,unicodeInstallPath:true,noOCR:true,levelIdentity:true,greyButtonGate:true,bulkClear:true,equipmentBulkClear:true,equipmentCategory:true,nameVariants:true}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{
  if(worker)await worker.terminate();
  const resolved=path.resolve(root),temp=path.resolve(os.tmpdir());
  if(path.dirname(resolved)===temp&&path.basename(resolved).startsWith('poi-plugin-zh-'))fs.rmSync(resolved,{recursive:true,force:true});
});
