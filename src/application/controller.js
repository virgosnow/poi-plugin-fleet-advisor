'use strict';
const {Session}=require('../execution/session');
const {resolvePlan,restoreOrganization}=require('../execution/organize');
const {createFleetPlanner}=require('../domain/fleet/fleet_plan');
const {restoreEquipment}=require('../execution/equipment');
const {enterScreen}=require('../execution/navigation');
const {canFallback,recoverImageScreen}=require('../execution/recognition_fallback');
const {planLandBases,assertExecutable}=require('../domain/fleet/land_base_execution_plan');
const {baseInventory}=require('../domain/fleet/land_base_inventory');
const landBase=require('../execution/land_base');

// Returning home is best effort unless the game requires the player to handle
// an expedition return, which must be reported as an interrupted operation.
const ignoreReturnHomeFailure=error=>{if(error?.code==='EXPEDITION_RETURN_REQUIRED')throw error;};

class Controller {
  constructor({getStore,createHost,createObserver,onProgress=()=>{},onDiagnostic=()=>{}}) {
    this.getStore=getStore;this.createHost=createHost;this.createObserver=createObserver;this.onProgress=onProgress;this.onDiagnostic=onDiagnostic;
    this.planner=createFleetPlanner(getStore,{resolveOrganization:resolvePlan});
    this.running=false;this.disposed=false;
  }
  preview(kind,scheme,options={}) {
    const plan=this.planner.preview(kind,scheme);
    if(!options.landBase)return plan;
    if(kind!=='fleet')throw Error('基地方案仅支持舰队应用');
    const base=planLandBases(this.getStore(),options.landBase);
    if(!baseInventory(this.getStore().info))throw Error('基地库存资料不完整');
    assertExecutable(base);
    const fleetItems=new Set(plan.pinned.eq.ships.flatMap(ship=>[...(ship.slots||[]),ship.ex]).filter(id=>Number.isSafeInteger(id)&&id>0));
    if(base.bases.some(row=>row.desired.some(id=>id>0&&fleetItems.has(id))))throw Error('舰队与基地方案重复使用同一装备');
    return {...plan,landBase:base,done:plan.done&&base.changed===0,changed:plan.changed+base.changed};
  }
  async run(kind,scheme,{operationWaitMs=0,recognitionMode='controls',landBase:baseRequest}={}) {
    if(this.running||this.disposed)throw new Error('Assistant busy or disabled');
    if(!['image','controls'].includes(recognitionMode))throw Error('Unsupported recognition mode');
    this.running=true;this.cancelled=false;this.fallbackUsed=false;this.initialFallback=null;
    const started=performance.now();let success=false;
    try {
      if(kind==='fleet'){
        const result=await this.runFleet(scheme,{operationWaitMs,recognitionMode,landBase:baseRequest});
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
      await this.runStage('return-home',()=>this.returnHomeAndPark()).catch(ignoreReturnHomeFailure);
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
    try{this.onDiagnostic({phase:'recognition-fallback',stage:'switch',executionPhase:phase,
      code:error.code,...(error.diagnostics?{diagnostics:error.diagnostics}:{})});}catch(_){}
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
    this.session=new Session(this.host,this.observer,{...options,onProgress:this.onProgress,onDiagnostic:this.onDiagnostic,allowControlFallback:this.observerMode==='controls'});
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
  // or interrupted return normally does not fail it. Parks the cursor at the top-left
  // corner so no button stays highlighted.
  async returnHomeAndPark() {
    if(!this.session)return;
    this.onProgress({phase:'return-home'});
    await enterScreen(this.session,'home');
    await this.session.input(0,0,undefined,'hover');
  }

  // Resolve every target before the first input. Keep exact ship/equipment
  // IDs across stages, and own resources only in run()'s finally block.
  async runFleet(scheme,{operationWaitMs=0,recognitionMode='controls',landBase:baseRequest}={}) {
    const pinnedBase=baseRequest?structuredClone(baseRequest):null;
    const plan=this.preview('fleet',scheme,{landBase:pinnedBase}), {org,eq}=plan.pinned;
    const stages={organization:{done:true,changed:0},equipment:{done:true,changed:0}};
    if(plan.done)return {ok:true,done:true,changed:0,stages};
    if(plan.landBase?.changed&&recognitionMode!=='controls')throw Error('基地航空队自动配置需要控件识别，请在游戏中手动配置');
    const baseBefore=plan.landBase?.changed?JSON.stringify([baseInventory(this.getStore().info),this.getStore().info.airbaseRelocations]):null;
    const equipmentSnapshot=JSON.stringify(Object.entries(this.getStore().info.ships).map(([id,s])=>[id,s.api_slot,s.api_slot_ex]));
    this.host=this.createHost();
    await this.host.start();if(this.cancelled)throw new Error('Run stopped');
    await this.startExecutionObserver(recognitionMode);if(this.cancelled)throw new Error('Run stopped');
    if(plan.landBase?.changed&&this.observerMode!=='controls')throw Error('基地航空队控件识别不可用，未开始配置');
    const ops=plan.equipment.ships.reduce((n,s)=>n+s.ops.length,0)+org.ships.length+(plan.landBase?.changed||0);
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
    if(plan.landBase?.changed){
      if(this.observerMode!=='controls')throw Error('基地航空队需要控件识别；舰队可能已更改，请核对');
      if(JSON.stringify([baseInventory(this.getStore().info),this.getStore().info.airbaseRelocations])!==baseBefore)
        throw Error('基地航空队状态已变化，停止配置；舰队可能已更改，请核对');
      stages.landBase={changed:0};
      let inventory=baseInventory(this.getStore().info),location=null;
      for(const base of plan.landBase.bases.filter(row=>row.operations.length||row.modeChange)){
        this.session.check();
        if(JSON.stringify(baseInventory(this.getStore().info))!==JSON.stringify(inventory))throw Error('基地库存已变化，停止配置');
        const target=pinnedBase.bases.find(row=>row.rid===base.rid);
        this.onProgress({phase:'land-base',base:base.rid});
        if(!location)await landBase.enterBase(this.session,base.areaId,base.rid);
        else if(location.area!==base.areaId)throw Error('基地海域已变化，停止配置');
        else if(location.open)await landBase.selectBase(this.session,base.areaId,base.rid,location.base);
        else await landBase.openBaseFromArea(this.session,base.areaId,base.rid);
        const result=await landBase.configureOpenBase(this.session,{area:pinnedBase.area,base:target,verifiedInventory:inventory});
        stages.landBase.changed+=result.changed;
        location={area:base.areaId,base:base.rid,open:!base.modeChange};
        const expected=structuredClone(inventory),row=expected.find(item=>item.area===base.areaId&&item.base===base.rid);
        for(const op of base.operations){
          const dest=row.slots.find(slot=>slot.slot===op.slotId);
          if(op.kind==='set'){
            const observed=baseInventory(this.getStore().info)?.find(item=>item.area===base.areaId&&item.base===base.rid)?.slots.find(slot=>slot.slot===op.slotId);
            if(!observed||observed.item!==op.itemId||![1,2].includes(observed.state))throw Error('基地飞机状态未确认');
            dest.item=op.itemId;dest.state=observed.state;
          }
          else if(op.kind==='swap'){
            const source=row.slots.find(slot=>slot.slot===op.sourceSlotId);
            [source.item,dest.item]=[dest.item,source.item];[source.state,dest.state]=[dest.state,source.state];
          }
        }
        inventory=baseInventory(this.getStore().info);
        if(JSON.stringify(inventory)!==JSON.stringify(expected))throw Error('基地库存未按预期更新，请核对后重试');
      }
      if(location?.open)await landBase.closeBase(this.session,location.area,location.base);
      const observed=this.getStore().info.airbase;
      for(const base of plan.landBase.bases){
        const live=observed.find(row=>row.api_area_id===base.areaId&&row.api_rid===base.rid);
        if(!live||live.api_action_kind!==base.mode||base.desired.some((id,i)=>live.api_plane_info?.find(slot=>slot.api_squadron_id===i+1)?.api_slotid!==id))
          throw Error('基地航空队最终状态不一致，请核对后重试');
      }
    }
    await this.runStage('return-home',()=>this.returnHomeAndPark()).catch(ignoreReturnHomeFailure);
    this.onProgress({phase:'fleet-complete',fleet:plan.fleet});
    return {ok:true,done:true,changed:stages.organization.changed+stages.equipment.changed+(stages.landBase?.changed||0),stages,metrics:{...this.session.metrics}};
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
