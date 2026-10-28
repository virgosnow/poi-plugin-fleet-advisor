'use strict';
// Offline, read-only timing. Never connect to the game or write player state.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {RecommendationWorker}=require('../../src/infrastructure/workers/recommendation_worker');
const {summarize}=require('../../src/shared/performance_trace');
async function main(){
  const options={};
  for(let i=2;i<process.argv.length;i+=2){
    if(!process.argv[i].startsWith('--')||!process.argv[i+1])throw Error('Options require a value');
    options[process.argv[i].slice(2)]=process.argv[i+1];
  }
  if(!options.store||!options.output||!options.area&&!options.args)
    throw Error('Usage: --store <private snapshot.json> --output <private report.json> --area 4-5 [--args <request.json>] [--threads 6] [--level stages|modules] [--repeat 1] [--cache <private directory>] [--result-cache true|false]');
  const level=options.level||'stages',threads=Number(options.threads||6),repeat=Number(options.repeat||1);
  if(!['stages','modules'].includes(level)||!Number.isInteger(threads)||threads<1||threads>8||
    !Number.isInteger(repeat)||repeat<1||repeat>20)throw Error('Invalid profiling options');
  if(options['result-cache']&&!['true','false'].includes(options['result-cache']))throw Error('result-cache must be true or false');
  const captured=JSON.parse(fs.readFileSync(path.resolve(options.store),'utf8')),store=captured.store||captured;
  const args=options.args?JSON.parse(fs.readFileSync(path.resolve(options.args),'utf8')):
    {fleet:1,area:options.area,airGoal:'superiority',automaticFilters:captured.filters};
  const settings={threads,resultCache:options['result-cache']==='true',calculationCache:!!options.cache};
  const worker=new RecommendationWorker({cacheDir:options.cache?path.resolve(options.cache):undefined,
    getSettings:()=>settings,getDiagnostics:()=>({level})});
  const reports=[];
  try{for(let i=0;i<repeat;i++){
    const result=await worker.run('recommendNormalFleet',store,args),profile=worker.lastProfile;
    reports.push({run:i+1,recommendations:result.recommendations.length,
      resultHash:crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex'),summary:summarize(profile),profile});
  }}finally{await worker.dispose();}
  const output=path.resolve(options.output);fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify({version:1,settings,level,reports},null,2));
  console.log(JSON.stringify({output,runs:reports.map(r=>({run:r.run,ms:r.profile.elapsedMs,recommendations:r.recommendations}))}));
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={main};
