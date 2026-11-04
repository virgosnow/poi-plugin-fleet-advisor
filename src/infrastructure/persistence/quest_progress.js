'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {cacheFiles,removeCacheFile,reserveCacheSpace}=require('../cache/disk_cache_budget');
const {DEFAULTS}=require('../../config/computation_settings');
const DAY=86400000;
const accountKey=store=>{const id=store?.info?.basic?.api_member_id;return id?crypto.createHash('sha256').update(String(id)).digest('hex'):null;};
// D39 has exactly one objective: complete mission 30 twice. Its documented
// 50% indicator means one success. This is a read-time lower bound, not an
// extra observed event: taking the maximum prevents counting the same return
// twice when both a quest-list refresh and the result arrive.
function serverGoalLowerBound(store,task,goal){
  if(task?.id!==443||task.code!=='D39'||task.state!==2||task.progressFlag!==1||
    task.goals?.length!==1||goal?.key!==task.goals[0].key||goal.count!==2)return 0;
  const snapshot=store?.questState;
  const live=snapshot?.known===true&&Array.isArray(snapshot.tasks)?snapshot.tasks.find(row=>Number(row?.api_no)===443):null;
  return Number(live?.api_state)===2&&Number(live?.api_progress_flag)===1?1:0;
}
// Quest resets use 05:00 JST; quarterly resets start in March, June,
// September and December. Annual reset dates differ by quest, so they are
// cleared when a claim is observed rather than guessed from the calendar.
function cycle(period,now){
  const date=new Date(now+4*3600000),day=Math.floor((now+4*3600000)/DAY);
  if(String(period).includes('日常')||period==='daily')return `day:${day}`;
  if(String(period).includes('周常')||period==='weekly')return `week:${day-(date.getUTCDay()+6)%7}`;
  if(String(period).includes('月常')||period==='monthly')return `month:${date.getUTCFullYear()}-${date.getUTCMonth()+1}`;
  if(String(period).includes('季常')||period==='quarterly'){
    let year=date.getUTCFullYear(),month=Math.floor((date.getUTCMonth()+1)/3)*3-1;
    if(month<0){year--;month=11;}return `quarter:${year}-${month+1}`;
  }
  return 'claim';
}
class QuestProgress {
  constructor(storageDir,{now=()=>Date.now(),getCacheLimit=()=>DEFAULTS.cacheLimitMiB*1024**2}={}){
    // Old progress files mix manual and observed values, so preserve them but
    // do not treat them as game observations in the new store.
    this.file=path.join(storageDir,'quest-observations.json');this.root=path.join(storageDir,'recommendation-cache');
    this.now=now;this.getCacheLimit=getCacheLimit;this.pending=Promise.resolve();this.records={};this.error=null;this.lastError=null;
    try{const saved=JSON.parse(fs.readFileSync(this.file,'utf8'));if(saved.version!==1||!saved.records||typeof saved.records!=='object'||Array.isArray(saved.records))throw Error('格式不支持');this.records=saved.records;}
    catch(e){if(e.code!=='ENOENT')this.error=`任务记录读取失败：${e.message}`;}
  }
  enqueue(fn){const result=this.pending.then(fn).catch(e=>{this.lastError=e.message;throw e;});this.pending=result.catch(()=>{});return result;}
  get(store,task,goal){
    const account=accountKey(store),row=account&&this.records[account]?.[task.code];
    const inferred=account?serverGoalLowerBound(store,task,goal):0;
    if(!row||row.cycle!==cycle(task.period,this.now())||row.id!==task.id)return inferred;
    const n=row.goals?.[goal.key];return Math.max(inferred,Number.isSafeInteger(n)&&n>0?Math.min(n,goal.count):0);
  }
  getMany(store,tasks){
    const account=accountKey(store),now=this.now(),entries=account?this.records[account]||{}:{},result=new Map();
    for(const task of tasks||[]){
      const row=entries[task.code],valid=row&&row.id===task.id&&row.cycle===cycle(task.period,now);
      for(const goal of task.goals||[])if(goal.key){
        const value=valid&&row.goals?.[goal.key];
        result.set(`${task.id}:${goal.key}`,Math.max(account?serverGoalLowerBound(store,task,goal):0,Number.isSafeInteger(value)&&value>0?Math.min(value,goal.count):0));
      }
    }
    return result;
  }
  increment(store,task,goal){
    return this.incrementMany(store,[{task,goal}]);
  }
  incrementMany(store,updates){
    // Batch one observed event in a single atomic write and serialize it with
    // reconciliation and explicit cache clearing.
    const account=accountKey(store),at=this.now();
    if(!account||!updates.length)return Promise.resolve(false);
    const prepared=updates.map(({task,goal})=>({task,goal,period:cycle(task.period,at)}));
    return this.enqueue(async()=>{
      if(this.error)throw Error(this.error);
      const records=JSON.parse(JSON.stringify(this.records)),tasks=records[account]||{};let changed=false;
      for(const {task,goal,period} of prepared){
        const old=tasks[task.code],row=old?.cycle===period&&old.id===task.id?old:{id:task.id,cycle:period,goals:{}};
        if([0,1,2].includes(task.progressFlag)&&(![0,1,2].includes(row.flag)||task.progressFlag>row.flag)){row.flag=task.progressFlag;changed=true;}
        const before=Number(row.goals[goal.key])||0,next=Math.min(goal.count,before+1);
        if(next!==before){row.goals[goal.key]=next;changed=true;}
        tasks[task.code]=row;
      }
      if(!changed)return false;
      records[account]=tasks;await this.persist(records);this.records=records;return true;
    });
  }
  reconcile(store,liveTasks){
    const account=accountKey(store);if(!account||!Array.isArray(liveTasks))return Promise.resolve();
    const observed=liveTasks.filter(row=>Number.isSafeInteger(Number(row?.api_no))&&[1,2,3].includes(Number(row?.api_state)))
      .map(row=>({id:Number(row.api_no),state:Number(row.api_state),flag:row.api_progress_flag==null?null:Number(row.api_progress_flag)}));
    return this.enqueue(async()=>{
      if(this.error)throw Error(this.error);
      const records=JSON.parse(JSON.stringify(this.records)),tasks=records[account];if(!tasks)return;
      let changed=false;
      for(const row of Object.values(tasks)){
        const actual=observed.find(item=>item.id===row.id);if(!actual)continue;
        if(actual.state===3){for(const [code,entry] of Object.entries(tasks))if(entry===row){delete tasks[code];changed=true;}continue;}
        if(![0,1,2].includes(actual.flag))continue;
        if([0,1,2].includes(row.flag)&&actual.flag<row.flag){row.goals={};changed=true;}
        if(row.flag!==actual.flag){row.flag=actual.flag;changed=true;}
      }
      if(!Object.keys(tasks).length)delete records[account];
      if(changed){await this.persist(records);this.records=records;}
    });
  }
  clearTask(store,id){
    const account=accountKey(store);if(!account)return Promise.resolve();
    return this.enqueue(async()=>{
      const records=JSON.parse(JSON.stringify(this.records)),tasks=records[account]||{};
      for(const [code,row] of Object.entries(tasks))if(row.id===id)delete tasks[code];
      if(!Object.keys(tasks).length)delete records[account];
      if(JSON.stringify(records)!==JSON.stringify(this.records)){await this.persist(records);this.records=records;}
    });
  }
  async persist(records){
    const body=JSON.stringify({version:1,records}),temp=`${this.file}.${crypto.randomUUID()}.tmp`;
    await fs.promises.mkdir(path.dirname(this.file),{recursive:true,mode:0o700});
    const space=await reserveCacheSpace(this.root,{limitBytes:this.getCacheLimit(),replace:this.file,bytes:Buffer.byteLength(body)});
    if(!space.fits)throw Error('游戏数据缓存空间不足，请清理缓存或提高上限');
    try{
      await fs.promises.writeFile(temp,body,{mode:0o600,flag:'wx'});
      for(let attempt=0;;attempt++)try{await fs.promises.rename(temp,this.file);break;}
      catch(e){if(!['EBUSY','EPERM','EACCES'].includes(e.code)||attempt>=3)throw e;await new Promise(r=>setTimeout(r,40*(attempt+1)));}
      this.lastError=null;
    }finally{await fs.promises.unlink(temp).catch(()=>{});}
  }
  inspectCache(){return this.enqueue(async()=>{try{const files=await cacheFiles(this.root,'gameData');return {files:files.length,bytes:files.reduce((n,f)=>n+f.size,0),...(this.error||this.lastError?{writeError:this.error||this.lastError}:{})};}catch(e){return {files:null,bytes:null,error:e.message};}});}
  clearCache(){return this.enqueue(async()=>{const files=await cacheFiles(this.root,'gameData');let removed=0,failed=0;
    const main=files.find(f=>f.file===this.file);if(main&&!await removeCacheFile(main.file))return {removed:0,failed:1};
    if(main)removed++;this.records={};this.error=null;this.lastError=null;
    for(const f of files)if(f!==main){if(await removeCacheFile(f.file))removed++;else failed++;}
    return {removed,failed};});}
}
module.exports={QuestProgress,accountKey,cycle};
