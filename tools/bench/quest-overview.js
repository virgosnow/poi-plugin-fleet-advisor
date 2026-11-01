'use strict';
// Synthetic data only; no account snapshots or game access.
const {performance}=require('node:perf_hooks');
const path=require('node:path'),Module=require('node:module');
const current=require('../../src/domain/quests/quest_overview');
let baseline;
if(process.argv[2]){
  const source=require('node:child_process').execFileSync('git',['show',`${process.argv[2]}:src/domain/quests/quest_overview.js`],{encoding:'utf8'});
  const filename=path.resolve(__dirname,'../../src/domain/quests/quest_overview.js'),moduleCopy=new Module(filename,module);
  moduleCopy.filename=filename;moduleCopy.paths=Module._nodeModulePaths(path.dirname(filename));moduleCopy._compile(source,filename);baseline=moduleCopy.exports;
}
const event=require('../../data/quests/limited/2026-halloween.json');
const now=Date.parse('2026-11-01T00:00:00Z');
const masters=Object.fromEntries(Array.from({length:4000},(_,i)=>[i+1,{api_id:i+1,api_name:`设备 ${i+1}`,api_type:[0,0,0,5]}]));
const tasks=event.quests.filter(q=>q.category==='B').map(q=>({api_no:q.ids[0],api_state:2,api_title:q.title,api_progress_flag:1,api_get_material:[300,200,100,0]}));
const state={const:{$equips:masters},questState:{known:true,tasks}};
const subjects=baseline?{baseline,current}:{current},samples=Object.fromEntries(Object.keys(subjects).map(key=>[key,[]]));
for(let i=0;i<30;i++)for(const subject of Object.values(subjects))subject.listOverviewQuests({state,now});
for(let i=0;i<200;i++)for(const [name,subject] of Object.entries(subjects)){
  const start=performance.now();subject.listOverviewQuests({state,now});samples[name].push(performance.now()-start);
}
const stats=Object.fromEntries(Object.entries(samples).map(([name,rows])=>{rows.sort((a,b)=>a-b);return [name,{
  averageMs:Number((rows.reduce((a,b)=>a+b,0)/rows.length).toFixed(3)),medianMs:Number(rows[Math.floor(rows.length/2)].toFixed(3)),p95Ms:Number(rows[Math.floor(rows.length*.95)].toFixed(3))}];}));
console.log(JSON.stringify({tasks:tasks.length,equipmentMasters:Object.keys(masters).length,iterations:200,...stats},null,2));
