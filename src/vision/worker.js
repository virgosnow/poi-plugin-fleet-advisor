'use strict';
const {parentPort}=require('worker_threads');
const {Observer}=require('./observers');
const observer=new Observer();
let busy=false;
parentPort.on('message',async message=>{
  if(busy){parentPort.postMessage({id:message.id,error:'Observer already running'});return;}
  busy=true;
  try {
    const result=message.kind==='initialize' ? {ready:true} : await observer.observe(message.kind,Buffer.from(message.frame),message.arg);
    parentPort.postMessage({id:message.id,result});
  } catch(error){parentPort.postMessage({id:message.id,error:error.message});}
  finally{busy=false;}
});
