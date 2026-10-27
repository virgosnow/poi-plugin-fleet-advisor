'use strict';
// One immutable snapshot per process. No Electron host, controller or game APIs.
const {runRecommendation}=require('./recommendation_worker');
const port=process.parentPort;
if(!port)throw Error('Recommendation process requires an Electron parent port');
port.once('message',async({data})=>{
  try{port.postMessage(await runRecommendation(data));}
  catch(error){port.postMessage({ok:false,error:{message:error.message,code:error.code,stack:error.stack}});}
  // The parent waits for actual exit before delivering the result or clearing
  // caches. This fallback also releases memory if its renderer disappeared.
  setTimeout(()=>process.exit(0),1000);
});
port.postMessage({ready:true});
