'use strict';
const {parentPort}=require('worker_threads');
const {Observer}=require('./observers');
const {Pixels}=require('./pixels');
const observer=new Observer();
let busy=false,cached=null;
const freshMetrics=()=>({decodes:0,normalizations:0,resamples:0,reuses:0,retainedBytes:0,peakRetainedBytes:0,decodeMs:0,normalizeMs:0});
let metrics=freshMetrics();
const releaseFrame=()=>{cached=null;metrics.retainedBytes=0;};
parentPort.on('message',async message=>{
  if(message.kind==='release-frame'){releaseFrame();return;}
  if(busy){parentPort.postMessage({id:message.id,error:'Observer already running'});return;}
  busy=true;
  try {
    let result;
    if(message.kind==='initialize'){releaseFrame();metrics=freshMetrics();result={ready:true};}
    else {
      let pixels;
      if(message.reuseFrame){
        if(!cached||cached.token!==message.frameToken)throw Error('Parsed screenshot is unavailable or invalidated');
        pixels=cached.pixels;metrics.reuses++;
      }else{
        // Every fresh capture decodes again, even when its PNG bytes happen
        // to equal the previous capture. Only Session can authorize reuse.
        releaseFrame();
        const frame=message.frame;
        if(!ArrayBuffer.isView(frame))throw Error('Screenshot bytes unavailable');
        const buffer=Buffer.from(frame.buffer,frame.byteOffset,frame.byteLength);
        let started=performance.now();const decoded=Pixels.decode(buffer);
        metrics.decodeMs+=performance.now()-started;metrics.decodes++;
        started=performance.now();pixels=decoded.normalize();
        metrics.normalizeMs+=performance.now()-started;metrics.normalizations++;
        if(decoded!==pixels)metrics.resamples++;
        // Keep normalized pixels only, never the high-DPI source or a list
        // of frames. Legacy raw worker messages without a token stay uncached.
        if(Number.isSafeInteger(message.frameToken)&&message.frameToken>0){
          cached={token:message.frameToken,pixels};metrics.retainedBytes=pixels.data.byteLength;
          metrics.peakRetainedBytes=Math.max(metrics.peakRetainedBytes,metrics.retainedBytes);
        }
      }
      result=await observer.observe(message.kind,pixels,message.arg);
    }
    parentPort.postMessage({id:message.id,result,cachedFrameToken:cached?.token??null,frameMetrics:{...metrics}});
  } catch(error){releaseFrame();parentPort.postMessage({id:message.id,error:error.message,cachedFrameToken:null,frameMetrics:{...metrics}});}
  finally{busy=false;}
});
