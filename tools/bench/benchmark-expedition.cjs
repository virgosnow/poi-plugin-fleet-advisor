'use strict';
// Offline paired-goal benchmark. Snapshots and full results stay outside Git.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {Worker,isMainThread,parentPort,workerData}=require('worker_threads');
if(!isMainThread){
  (async()=>{
  const store=JSON.parse(fs.readFileSync(workerData.store)),r=require(path.join(workerData.runtime,'src/recommendation/index'));
  const start=performance.now(),args={missionId:workerData.missionId,fleet:2,limit:3};
  const pair=workerData.threads===2?await require(path.join(workerData.runtime,'src/infrastructure/workers/recommendation_worker')).parallelExpeditionGoals(store,args):r.recommendExpeditionGoals?r.recommendExpeditionGoals(store,args):{
    success:r.recommendExpeditionFleet(store,{...args,goal:'success'}),great:r.recommendExpeditionFleet(store,{...args,goal:'great'})};
  parentPort.postMessage({ms:performance.now()-start,pair,heapMiB:process.memoryUsage().heapUsed/1048576});
  })().catch(error=>{throw error;});
}else{
  const options={};for(let i=2;i<process.argv.length;i+=2)options[process.argv[i].replace(/^--/,'')]=process.argv[i+1];
  if(!options.store||!options.output)throw Error('Usage: --store <snapshot> --output <report> [--runtime <root>] [--missions 5,21,37,38,101,103] [--baseline <report>] [--repeat 1] [--threads 1|2]');
  const threads=Number(options.threads||1);if(![1,2].includes(threads))throw Error('threads must be 1 or 2');
  const runtime=path.resolve(options.runtime||path.join(__dirname,'../..')),missions=(options.missions||'5,21,37,38,101,103').split(',').map(Number),rows=[];
  const baseline=options.baseline?JSON.parse(fs.readFileSync(options.baseline)):null;
  const canonical=value=>{const {goals,...selected}=value;return selected;};
  const digest=value=>crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
  (async()=>{
    for(const missionId of missions){const runs=[];let pair,peak=0,heap=0;
      const before=process.memoryUsage().rss/1048576;
      for(let repeat=0;repeat<Number(options.repeat||1);repeat++){
        const result=await new Promise((resolve,reject)=>{
          const worker=new Worker(__filename,{workerData:{store:path.resolve(options.store),runtime,missionId,threads}});let message;
          const timer=setInterval(()=>{peak=Math.max(peak,process.memoryUsage().rss/1048576);},20);
          worker.once('message',value=>{heap=value.heapMiB;message=value;});worker.once('error',reject);
          worker.once('exit',code=>{clearInterval(timer);if(code||!message)reject(Error('Benchmark worker exited: '+code));else resolve(message);});
        });runs.push(result.ms);pair=result.pair;
      }
      const old=baseline?.rows.find(row=>row.missionId===missionId);
      const matches=old?['success','great'].every(goal=>digest(pair[goal])===digest(old.pair[goal])):null;
      const row={missionId,runsMs:runs.map(n=>Math.round(n*10)/10),matches,
        memory:{beforeMiB:before,peakMiB:peak,endMiB:process.memoryUsage().rss/1048576,workerHeapMiB:heap},pair};rows.push(row);
      fs.writeFileSync(options.output,JSON.stringify({runtime,threads,workerHeapScope:'ownerOnly',rows},null,2));
      console.log(JSON.stringify({missionId,runsMs:row.runsMs,matches,peakMiB:Math.round(peak),quality:Object.fromEntries(['success','great'].map(goal=>[goal,{
        evaluated:pair[goal].search.evaluated,probability:pair[goal].recommendations[0]?.evaluation.greatSuccess.estimatedPercent,
        net:pair[goal].recommendations[0]?.income?.rows.reduce((n,r)=>n+r.net,0)}]))}));
    }
    if(rows.some(row=>row.matches===false))process.exitCode=1;
  })().catch(e=>{console.error(e);process.exitCode=1;});
}
