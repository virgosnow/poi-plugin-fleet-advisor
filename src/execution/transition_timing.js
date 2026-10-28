'use strict';

// Run-local scheduling hints only. They never authorize an input or extend a
// deadline, and contain no screenshots, recognition results or inventory.
class TransitionTiming {
  constructor(){this.profiles=new Map();this.recurring=0;}
  clear(){this.profiles.clear();this.recurring=0;}
  begin(input,kind,arg={}){
    const checks=kind==='batch'&&Array.isArray(arg?.checks)?arg.checks.map(c=>c?.kind).join(','):'';
    const key=[input.kind,input.x,input.y,input.path,kind,checks].join('|');
    const profile=this.profiles.get(key);
    if(!profile||profile.samples.length<2)return {key,delay:0};
    // Probe immediately every third recurrence. Delayed successes cannot
    // teach their own delay back to the predictor or hide a faster UI forever.
    this.recurring=(this.recurring+1)%3;
    return {key,delay:this.recurring===0?0:Math.max(...profile.samples)};
  }
  reject(plan){this.profiles.delete(plan.key);}
  record(plan,{delayUsed,hadInvalid,readyAfterMs}){
    if(delayUsed)return;
    if(!hadInvalid){
      // A previously delayed UI has become immediately readable. Drop other
      // old hints as well instead of charging a stale delay once per control.
      if(this.profiles.get(plan.key)?.samples.length===2)this.clear();
      else this.profiles.delete(plan.key);
      return;
    }
    if(!Number.isFinite(readyAfterMs)||readyAfterMs<=0||readyAfterMs>400){
      this.profiles.delete(plan.key);return;
    }
    const profile=this.profiles.get(plan.key)||{samples:[]};
    profile.samples.push(readyAfterMs);if(profile.samples.length>2)profile.samples.shift();
    this.profiles.delete(plan.key);this.profiles.set(plan.key,profile);
    if(this.profiles.size>64)this.profiles.delete(this.profiles.keys().next().value);
  }
}
module.exports={TransitionTiming};
