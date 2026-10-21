'use strict';
const {Session}=require('../execution/session');
const {resolvePlan,restoreOrganization}=require('../execution/organize');
const {createFleetPlanner}=require('../domain/fleet/fleet_plan');
const {restoreEquipment}=require('../execution/equipment');
const {enterScreen}=require('../execution/navigation');


class Controller {
  constructor({getStore,createHost,createObserver,onProgress=()=>{}}) {
    this.getStore=getStore;this.createHost=createHost;this.createObserver=createObserver;this.onProgress=onProgress;
    this.planner=createFleetPlanner(getStore,{resolveOrganization:resolvePlan});
    this.running=false;this.disposed=false;
  }
  preview(kind,scheme) {return this.planner.preview(kind,scheme);}
  async run(kind,scheme) {
    if(this.running||this.disposed)throw new Error('Assistant busy or disabled');
    this.running=true;this.cancelled=false;
    const started=performance.now();let success=false;
    try {
      if(kind==='fleet'){
        const result=await this.runFleet(scheme);
        if(result.metrics)result.metrics={...result.metrics,startupMs:result.metrics.started-started,totalMs:performance.now()-started};
        success=true;return result;
      }
      const plan=this.preview(kind,scheme);
      if(plan.done){success=true;return {ok:true,done:true,changed:0};}
      this.host=this.createHost();
      if(!this.observer)this.observer=this.createObserver(this.host);
      await this.host.start();
      if(this.cancelled)throw new Error('Run stopped');
      await this.observer.start();
      if(this.cancelled)throw new Error('Run stopped');
      const operations=kind==='equipment'?plan.ships.reduce((n,s)=>n+s.ops.length,0):plan.targets.length;
      this.session=new Session(this.host,this.observer,{onProgress:this.onProgress,timeoutMs:Math.max(180000,operations*30000)});
      const result=await (kind==='organization'?restoreOrganization:restoreEquipment)(this.session,scheme);
      await this.returnHomeAndPark().catch(()=>{/* best effort only */});
      success=true;
      return {...result,metrics:{...this.session.metrics,startupMs:this.session.metrics.started-started,totalMs:performance.now()-started}};
    } finally {
      if(this.session)this.session.stop();
      await Promise.allSettled([this.host&&this.host.dispose(),!success&&this.observer&&this.observer.dispose()]);
      this.host=null;if(!success)this.observer=null;this.session=null;this.running=false;
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
  async runFleet(scheme) {
    const plan=this.preview('fleet',scheme), {org,eq}=plan.pinned;
    const stages={organization:{done:true,changed:0},equipment:{done:true,changed:0}};
    if(plan.done)return {ok:true,done:true,changed:0,stages};
    const equipmentSnapshot=JSON.stringify(Object.entries(this.getStore().info.ships).map(([id,s])=>[id,s.api_slot,s.api_slot_ex]));
    this.host=this.createHost();
    if(!this.observer)this.observer=this.createObserver(this.host);
    await this.host.start();if(this.cancelled)throw new Error('Run stopped');
    await this.observer.start();if(this.cancelled)throw new Error('Run stopped');
    const ops=plan.equipment.ships.reduce((n,s)=>n+s.ops.length,0)+org.ships.length;
    this.session=new Session(this.host,this.observer,{onProgress:this.onProgress,timeoutMs:Math.max(180000,ops*30000+30000)});
    this.onProgress({phase:'organization-start',fleet:plan.fleet,targets:plan.organization.targets});
    if(!plan.organization.done) {
      stages.organization=await restoreOrganization(this.session,org);
      this.onProgress({phase:'organization-ready',fleet:plan.fleet});
      if(eq.ships.length)await this.returnHomeAndPark();
    }else this.onProgress({phase:'organization-ready',fleet:plan.fleet});
    this.session.check();
    if(JSON.stringify(Object.entries(this.getStore().info.ships).map(([id,s])=>[id,s.api_slot,s.api_slot_ex]))!==equipmentSnapshot)
      throw new Error('Equipment changed during organization stage');
    if(eq.ships.length)stages.equipment=await restoreEquipment(this.session,eq);
    await this.returnHomeAndPark().catch(()=>{});
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
