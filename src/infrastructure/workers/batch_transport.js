'use strict';
// One immutable header per run/worker. Items and complete numerical results
// continue through Node's native structured clone without a JS graph codec.
class BatchReceiver {
  constructor(){this.batchId=null;this.header=null;}
  read({batchId,header,items}){
    if(header!==undefined){this.batchId=batchId;this.header=header;}
    if(this.batchId!==batchId||!this.header)throw Error('Missing batch header');
    return {...this.header,items};
  }
}
module.exports={BatchReceiver};
