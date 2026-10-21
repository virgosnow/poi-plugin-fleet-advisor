'use strict';
const {Worker}=require('worker_threads');
class WorkerObserver {
  constructor({createWorker=filename=>new Worker(filename)}={}) {
    this.worker=createWorker(require.resolve('./worker'));this.sequence=0;this.pending=null;this.closed=false;
    this.worker.on('message',message=>{
      if(!this.pending||message.id!==this.pending.id)return;
      const pending=this.pending;this.pending=null;clearTimeout(pending.timer);
      if(message.error)pending.reject(new Error(message.error));else pending.resolve(message.result);
    });
    this.worker.on('error',()=>this.fail('Observer worker failed'));
    this.worker.on('exit',()=>this.fail('Observer worker exited'));
  }
  fail(message) {
    this.closed=true;
    if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(new Error(message));this.pending=null;}
  }
  observe(kind,frame,arg) {
    if(this.closed||this.pending)return Promise.reject(new Error('Observer unavailable or busy'));
    return new Promise((resolve,reject)=>{
      const id=++this.sequence;
      const timer=setTimeout(()=>{this.fail('Observer timed out');void this.worker.terminate();},30000);
      this.pending={id,resolve,reject,timer};
      try {this.worker.postMessage({id,kind,frame,arg});}
      catch(error) {
        // A synchronous clone/send failure never queued a request. Release
        // both the busy flag and its timeout instead of poisoning later work.
        clearTimeout(timer);this.pending=null;reject(error);
      }
    });
  }
  async start(){await this.observe('initialize');}
  async dispose(){this.fail('Observer stopped');await this.worker.terminate();}
}
module.exports={WorkerObserver};
