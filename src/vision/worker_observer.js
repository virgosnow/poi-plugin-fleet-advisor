'use strict';
const {Worker}=require('worker_threads');
class WorkerObserver {
  constructor({createWorker=filename=>new Worker(filename)}={}) {
    this.worker=createWorker(require.resolve('./worker'));this.sequence=0;this.pending=null;this.closed=false;
    this.frame=null;this.frameMetrics={decodes:0,normalizations:0,resamples:0,reuses:0,retainedBytes:0,peakRetainedBytes:0,decodeMs:0,normalizeMs:0};
    this.worker.on('message',message=>{
      if(!this.pending||message.id!==this.pending.id)return;
      const pending=this.pending;this.pending=null;clearTimeout(pending.timer);
      if(message.frameMetrics)this.frameMetrics={...message.frameMetrics,
        retainedBytes:this.frame?.token===message.cachedFrameToken?message.frameMetrics.retainedBytes:0};
      if(message.error){this.releaseFrame();pending.reject(new Error(message.error));}else pending.resolve(message.result);
    });
    this.worker.on('error',()=>this.fail('Observer worker failed'));
    this.worker.on('exit',()=>this.fail('Observer worker exited'));
  }
  fail(message) {
    this.closed=true;this.releaseFrame();
    if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(new Error(message));this.pending=null;}
  }
  releaseFrame() {
    this.frame=null;this.frameMetrics.retainedBytes=0;
    if(!this.closed)try{this.worker.postMessage({kind:'release-frame'});}catch(_){/* A later observation still fails closed. */}
  }
  observe(kind,frame,arg,{reuseFrame=false}={}) {
    if(this.closed||this.pending)return Promise.reject(new Error('Observer unavailable or busy'));
    return new Promise((resolve,reject)=>{
      const id=++this.sequence;
      const timer=setTimeout(()=>{this.fail('Observer timed out');void this.worker.terminate();},30000);
      this.pending={id,resolve,reject,timer};
      try {
        if(kind==='initialize')this.frame=null;
        const reuse=!!(reuseFrame&&this.frame&&this.frame.buffer===frame);
        const frameToken=reuse?this.frame.token:id;
        if(kind!=='initialize'&&!reuse)this.frame={buffer:frame,token:frameToken};
        this.worker.postMessage({id,kind,arg,frameToken,...(reuse?{reuseFrame:true}:{frame})});
      }
      catch(error) {
        // A synchronous clone/send failure never queued a request. Release
        // both the busy flag and its timeout instead of poisoning later work.
        clearTimeout(timer);this.pending=null;this.releaseFrame();reject(error);
      }
    });
  }
  async start(){this.releaseFrame();await this.observe('initialize');}
  async dispose(){this.fail('Observer stopped');await this.worker.terminate();}
}
module.exports={WorkerObserver};
