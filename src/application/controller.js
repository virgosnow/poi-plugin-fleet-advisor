'use strict';
const {Session}=require('../execution/session');
const {resolvePlan,restoreOrganization}=require('../execution/organize');
const {createFleetPlanner}=require('../domain/fleet/fleet_plan');
const {restoreEquipment}=require('../execution/equipment');
const {enterScreen}=require('../execution/navigation');
const {canFallback,recoverImageScreen}=require('../execution/recognition_fallback');


class Controller {
  constructor({getStore,createHost,createObserver,onProgress=()=>{}}) {
    this.getStore=getStore;this.createHost=createHost;this.createObserver=createObserver;this.onProgress=onProgress;
    this.planner=createFleetPlanner(getStore,{resolveOrganization:resolvePlan});
    this.running=false;this.disposed=false;
  }
  preview(kind,scheme) {return this.planner.preview(kind,scheme);}
  async run(kind,scheme,{operationWaitMs=0,recognitionMode='controls'}={}) {
    if(this.running||this.disposed)throw new Error('Assistant busy or disabled');
    if(!['image','controls'].includes(recognitionMode))throw Error('Unsupported recognition mode');
    this.running=true;this.cancelled=false;this.fallbackUsed=false;this.initialFallback=null;
    const started=performance.now();let success=false;
    try {
      if(kind==='fleet'){
        const result=await this.runFleet(scheme,{operationWaitMs,recognitionMode});
        if(result.metrics)result.metrics={...result.metrics,startupMs:result.metrics.started-started,totalMs:performance.now()-started};
        success=true;return result;
      }
      const plan=this.preview(kind,scheme);
      if(plan.done){success=true;return {ok:true,done:true,changed:0};}
      const pinned={fleet:plan.fleet,ships:kind==='organization'?plan.targets.map(id=>({id})):
        plan.ships.map(s=>({id:s.shipId,slots:s.want.slots,ex:s.want.ex===0?'empty':s.want.ex}))};
      this.host=this.createHost();
      await this.host.start();
      if(this.cancelled)throw new Error('Run stopped');
      await this.startExecutionObserver(recognitionMode);
      if(this.cancelled)throw new Error('Run stopped');
      const operations=kind==='equipment'?plan.ships.reduce((n,s)=>n+s.ops.length,0):plan.targets.length;
      this.createSession({operationWaitMs,recognitionMode,timeoutMs:Math.max(180000,operations*30000)});
      const result=await this.runStage(kind,()=> (kind==='organization'?restoreOrganization:restoreEquipment)(this.session,pinned));
      await this.runStage('return-home',()=>this.returnHomeAndPark()).catch(()=>{/* best effort only */});
      success=true;
      return {...result,metrics:{...this.session.metrics,startupMs:this.session.metrics.started-started,totalMs:performance.now()-started}};
    } finally {
      if(this.session)this.session.stop();
      await Promise.allSettled([this.host&&this.host.dispose(),!success&&this.observer&&this.observer.dispose()]);
      this.host=null;if(!success)this.observer=null;this.session=null;this.running=false;
    }
  }
  async startObserver(mode){
    if(this.observer&&this.observerMode!==mode){await this.observer.dispose();this.observer=null;}
    this.observerMode=mode;
    if(!this.observer)this.observer=this.createObserver(this.host,mode);
    await this.observer.start(this.host);
  }
  fallbackEvent(phase,error){
    this.onProgress({phase:'recognition-fallback',detail:'控件识别不可用，切换图像识别继续'});
    return {from:'controls',to:'image',phase,code:error.code,kind:error.diagnostics?.kind};
  }
  async startExecutionObserver(mode){
    try{await this.startObserver(mode);}
    catch(error){
      if(mode!=='controls'||this.cancelled||error.code!=='CONTROL_RECOGNITION_UNAVAILABLE')throw error;
      this.host.check();this.fallbackUsed=true;this.initialFallback=this.fallbackEvent('startup',error);
      await this.startObserver('image');
    }
  }
  createSession({recognitionMode,...options}){
    this.session=new Session(this.host,this.observer,{...options,onProgress:this.onProgress,allowControlFallback:this.observerMode==='controls'});
    Object.assign(this.session.metrics,{recognitionMode,finalRecognitionMode:this.observerMode,
      recognitionFallbacks:this.initialFallback?[this.initialFallback]:[]});
    if(this.initialFallback)this.session.resetImagePicker=true;
  }
  async runStage(phase,execute){
    const before=this.session.metrics.confirmedMutations||0;
    try{return await execute();}
    catch(error){
      if(this.fallbackUsed||!canFallback(this.session,error))throw error;
      // Recheck the old stage's entire expected state before accepting a new
      // checkpoint. Unknown submissions and external changes never authorize
      // a second attempt, even if image recognition could read the screen.
      this.session.check();
      if(this.host.inputBusy||this.host.monitor?.expected||this.host.monitor?.closed)throw error;
      const completed=(this.session.metrics.confirmedMutations||0)-before;
      this.fallbackUsed=true;
      const event=this.fallbackEvent(phase,error);
      await this.session.bounded(this.startObserver('image'),30000);
      this.session.useImageObserver(this.observer);
      this.session.metrics.finalRecognitionMode='image';
      this.session.metrics.recognitionFallbacks.push(event);
      await recoverImageScreen(this.session);
      // The pinned instance scheme is unchanged. The existing planner skips
      // verified completed positions/slots, including borrowed equipment.
      const result=await execute();
      return result&&typeof result.changed==='number'?{...result,changed:completed+result.changed}:result;
    }
  }
  // Best-effort return to the home port so the next task (or the user)
  // starts from a known place. The run itself already succeeded, so a failed
  // or interrupted return never fails it. Parks the cursor at the top-left
  // corner so no button stays highlighted.
  async returnHomeAndPark() {
    if(!this.session)return;
    this.onProgress({phase:'return-home'});
    await enterScreen(this.session,'home');
    await this.session.input(0,0,undefined,'hover');
  }

  // Resolve every target before the first input. Keep exact ship/equipment
  // IDs across stages, and own resources only in run()'s finally block.
  async runFleet(scheme,{operationWaitMs=0,recognitionMode='controls'}={}) {
    const plan=this.preview('fleet',scheme), {org,eq}=plan.pinned;
    const stages={organization:{done:true,changed:0},equipment:{done:true,changed:0}};
    if(plan.done)return {ok:true,done:true,changed:0,stages};
    const equipmentSnapshot=JSON.stringify(Object.entries(this.getStore().info.ships).map(([id,s])=>[id,s.api_slot,s.api_slot_ex]));
    this.host=this.createHost();
    await this.host.start();if(this.cancelled)throw new Error('Run stopped');
    await this.startExecutionObserver(recognitionMode);if(this.cancelled)throw new Error('Run stopped');
    const ops=plan.equipment.ships.reduce((n,s)=>n+s.ops.length,0)+org.ships.length;
    this.createSession({operationWaitMs,recognitionMode,timeoutMs:Math.max(180000,ops*30000+30000)});
    this.onProgress({phase:'organization-start',fleet:plan.fleet,targets:plan.organization.targets});
    if(!plan.organization.done) {
      stages.organization=await this.runStage('organization',()=>restoreOrganization(this.session,org));
      this.onProgress({phase:'organization-ready',fleet:plan.fleet});
      // Equipment navigation switches directly using the verified native
      // organization side menu, without a home-port round trip.
    }else this.onProgress({phase:'organization-ready',fleet:plan.fleet});
    this.session.check();
    if(JSON.stringify(Object.entries(this.getStore().info.ships).map(([id,s])=>[id,s.api_slot,s.api_slot_ex]))!==equipmentSnapshot)
      throw new Error('Equipment changed during organization stage');
    if(eq.ships.length)stages.equipment=await this.runStage('equipment',()=>restoreEquipment(this.session,eq));
    await this.runStage('return-home',()=>this.returnHomeAndPark()).catch(()=>{});
    this.onProgress({phase:'fleet-complete',fleet:plan.fleet});
    return {ok:true,done:true,changed:stages.organization.changed+stages.equipment.changed,stages,metrics:{...this.session.metrics}};
  }

  stop() {
    this.cancelled=true;
    if(this.session)this.session.stop();else if(this.host)this.host.cancel();
    // stop() can arrive while a successful run is disposing its host. That
    // run retains its warm observer on success, so drop this reference here
    // before terminating it; the next run must create a fresh observer.
    const observer=this.observer;this.observer=null;
    if(observer)void observer.dispose();
    // A request already sent to the server cannot be cancelled. Capture
    // the current store for diagnostics; do not report a rollback.
    return {stopped:true,fleets:this.getStore().info.fleets};
  }
  dispose(){this.disposed=true;this.stop();}
}
module.exports={Controller};
