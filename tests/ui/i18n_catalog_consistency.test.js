'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path');
test('duplicate UI catalog keys have deterministic translations independent of registration order',()=>{
 const script=String.raw`
 const i=require('./src/shared/i18n'),captures=[];let file='';
 i.registerCatalog=(lang,entries)=>captures.push({file,lang:i.normalizeLocale(lang),entries});
 for(file of ['src/ui/shared_catalog.js','src/ui/i18n/execution.js','src/ui/i18n/readability.js','src/ui/components/calculation_progress.js','src/ui/models/route_conditions.js','src/ui/models/route_warnings.js','src/ui/maps/map_localization.js','src/ui/i18n/workbench_catalog.js'])require('./'+file);
 for(file of ['shell','expedition_practice','maps','combat','fleet_target','mechanism_catalog','airbase']){
   const o=require('./src/ui/i18n/'+file);
   for(const [k,v] of Object.entries(o))if(v&&typeof v==='object'&&!Array.isArray(v))i.registerCatalog(k==='zhTW'?'zh-TW':k==='zhCN'?'zh-CN':k,v);
 }
 const seen=new Map,errors=[];
 for(const entry of captures)for(const [key,value]of Object.entries(entry.entries)){
   const id=entry.lang+'|'+key,prior=seen.get(id);
   if(prior&&prior.value!==value)errors.push(id+' ('+prior.file+' / '+entry.file+')');
   else if(!prior)seen.set(id,{file:entry.file,value});
 }
 if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}`;
 const run=spawnSync(process.execPath,['-e',script],{cwd:path.join(__dirname,'../..'),encoding:'utf8'});
 assert.equal(run.status,0,run.stderr||run.stdout);
});
