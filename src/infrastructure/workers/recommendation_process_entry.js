'use strict';
// One immutable snapshot per process. No Electron host, controller or game APIs.
const {runRecommendation}=require('./recommendation_worker');
const preloadStarted=performance.now();
require('../../recommendation/index');
const preloadMs=performance.now()-preloadStarted;
const port=process.parentPort;
if(!port)throw Error('Recommendation process requires an Electron parent port');
port.once('message',async({data})=>{
  try{
    const message=await runRecommendation(data,performance.now());
    if(message.profile)Object.assign(message.profile.runtime,{prewarmed:data.prewarmed===true,preloadMs});
    port.postMessage(message);
  }
  catch(error){port.postMessage({ok:false,error:{message:error.message,code:error.code,stack:error.stack}});}
  // The parent waits for actual exit before delivering the result or clearing
  // caches. This fallback also releases memory if its renderer disappeared.
  setTimeout(()=>process.exit(0),1000);
});
port.postMessage({ready:true});
