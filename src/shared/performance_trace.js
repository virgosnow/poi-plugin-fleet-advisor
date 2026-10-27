'use strict';
// Optional diagnostics only. Never put traces in recommendations or cache keys.
const {AsyncLocalStorage}=require('node:async_hooks');
const contexts=new AsyncLocalStorage();
let used=false,enabled=false,detail='stages',lastReport=null;
const current=()=>used?contexts.getStore():null;
class PerformanceTrace {
  constructor({now=()=>performance.now(),level='modules'}={}){
    this.level=level;
    this.now=now;this.spans=new Map();this.stack=[];this.stages=[];this.counters={};this.children=[];this.dispatch=[];
    used=true;
  }
  run(calculate){return contexts.run(this,calculate);}
  begin(name){const frame={name,start:this.now(),children:0};this.stack.push(frame);return {trace:this,frame};}
  end(frame){
    const elapsed=this.now()-frame.start;
    if(this.stack.pop()!==frame)throw Error('Unbalanced performance span');
    if(this.stack.length)this.stack.at(-1).children+=elapsed;
    const row=this.spans.get(frame.name)||{name:frame.name,calls:0,totalMs:0,selfMs:0};
    row.calls++;row.totalMs+=elapsed;row.selfMs+=elapsed-frame.children;this.spans.set(frame.name,row);
  }
  snapshot(){return {spans:[...this.spans.values()].map(row=>({...row})),counters:{...this.counters}};}
}
function begin(name){const trace=current();return trace?.level==='modules'?trace.begin(name):null;}
function end(token){if(token)token.trace.end(token.frame);}
function measure(name,calculate){
  const token=begin(name);try{return calculate();}finally{end(token);}
}
function count(name,amount=1){const trace=current();if(trace)trace.counters[name]=(trace.counters[name]||0)+amount;}
function stage(name,calculate){
  const trace=current();if(!trace)return calculate();
  const start=trace.now();try{return calculate();}finally{trace.stages.push({name,ms:trace.now()-start});}
}
async function stageAsync(name,calculate){
  const trace=current();if(!trace)return calculate();
  const start=trace.now();try{return await calculate();}finally{trace.stages.push({name,ms:trace.now()-start});}
}
function setEnabled(value,{level='stages'}={}){enabled=value===true;detail=level==='modules'?'modules':'stages';}
function isEnabled(){return enabled||['1','stages','modules'].includes(process.env.FLEET_ADVISOR_PROFILE);}
function options(){return isEnabled()?{level:process.env.FLEET_ADVISOR_PROFILE==='modules'?'modules':detail}:null;}
function publish(report){lastReport=report;}
function summarize(report){
  if(!report)return null;
  const stages=new Map(),modules=new Map(),counters={};
  for(const row of report.stages||[]){const value=stages.get(row.name)||{name:row.name,calls:0,ms:0};
    value.calls++;value.ms+=row.ms;stages.set(row.name,value);}
  for(const trace of [report,...report.children||[]]){
    for(const row of trace.spans||[]){const value=modules.get(row.name)||{name:row.name,calls:0,totalMs:0,selfMs:0};
      for(const key of ['calls','totalMs','selfMs'])value[key]+=row[key];modules.set(row.name,value);}
    for(const [name,value]of Object.entries(trace.counters||{}))counters[name]=(counters[name]||0)+value;
    for(const [name,stats]of Object.entries(trace.calculationStats||{}))
      for(const [kind,value]of Object.entries(stats)){
        const key='calculation.'+name+'.'+kind;counters[key]=(counters[key]||0)+value;
      }
  }
  const accountedMs=[...stages.values()].reduce((sum,row)=>sum+row.ms,0);
  return {elapsedMs:report.elapsedMs,queueMs:report.queueMs,workerMs:report.workerMs,teardownMs:report.teardownMs,
    startupAndTransferMs:report.startupAndTransferMs,otherWorkerMs:Math.max(0,report.workerMs-accountedMs),
    stages:[...stages.values()],modules:[...modules.values()].sort((a,b)=>b.selfMs-a.selfMs),counters};
}
module.exports={PerformanceTrace,current,begin,end,measure,count,stage,stageAsync,setEnabled,isEnabled,options,publish,
  summarize,getLastReport:()=>lastReport,clear:()=>{lastReport=null;}};
