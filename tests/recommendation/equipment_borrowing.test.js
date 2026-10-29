'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/workbench_fixture');
const {equipmentForFleet,prepareFleetEquipment,assertFleetEquipment}=require('../../src/recommendation/loadout/equipment_borrowing');
const {availableEquipment}=require('../../src/recommendation/loadout/loadout_policy');
const R=require('../../src/recommendation/normal');
const filters={allowEquipmentBorrowing:false};
const itemIds=scheme=>scheme.ships.flatMap(ship=>[...ship.slots,ship.ex]).filter(id=>id>0);
function armed(){
  const store=fixture();
  store.const.$shipTypes[2]={api_equip_type:{1:1}};
  store.const.$equips[500]={api_id:500,api_name:'自用主炮',api_type:[0,0,1,1],api_houg:4};
  store.const.$equips[501]={api_id:501,api_name:'他舰强炮',api_type:[0,0,1,1],api_houg:18};
  for(const id of [101,102,103,104,201,202])store.info.equips[id]={api_id:id,api_slotitem_id:id<200?500:501,api_level:0};
  store.info.ships[2].api_slot=[101,102];
  store.info.ships[3].api_slot=[103,-1];
  store.info.ships[8].api_slot=[201,202];
  return store;
}
test('scope follows candidate owners including expansion slots, retaining ordinary availability restrictions',()=>{
  const store=armed();store.info.ships[3].api_slot_ex=104;
  const inventory=availableEquipment(store),before=JSON.stringify(store);
  assert.strictEqual(equipmentForFleet(inventory,[2],{}),inventory);
  assert.deepEqual(equipmentForFleet(inventory,[2],filters).map(i=>i.id),[101,102]);
  const team=equipmentForFleet(inventory,[{id:2},{id:3}],filters);
  assert.deepEqual(team.map(i=>i.id),[101,102,103,104]);
  assert.strictEqual(team,equipmentForFleet(inventory,[3,2],filters),'same ownership set reuses the pool');
  assert.deepEqual(equipmentForFleet(inventory,[3,8],filters).map(i=>i.id),[103,104,201,202]);
  const next=structuredClone(store);next.info.ships[8].api_slot=[-1,-1];
  assert(equipmentForFleet(availableEquipment(next),[2],filters).some(i=>i.id===201),'ownership changes in a new snapshot');
  next.info.fleets[2]={api_ship:[3],api_mission:[1,1]};
  assert(!equipmentForFleet(availableEquipment(next),[3],filters).some(i=>i.id===103),'expedition gear remains unavailable');
  assert.equal(JSON.stringify(store),before);
});
test('upgrades discard former members equipment, allow internal transfers, and never erase manual holds',()=>{
  const inventory=availableEquipment(armed()),scope=equipmentForFleet(inventory,[3],filters);
  const draft={fleet:1,ships:[{id:3,slots:[101,103],ex:104}]},before=JSON.stringify(draft);
  assert.deepEqual(prepareFleetEquipment(draft,scope,filters).ships[0].slots,[-1,103]);
  assert.throws(()=>prepareFleetEquipment(draft,scope,filters,[{id:3,keep:{0:true}}]),/不借用.*草稿已保留/);
  assert.throws(()=>assertFleetEquipment(draft,scope,filters),/不借用/);
  assert.equal(JSON.stringify(draft),before);
  assert.doesNotThrow(()=>assertFleetEquipment(draft,equipmentForFleet(inventory,[2,3],filters),filters));
});
test('fixed fleet refitting uses warehouse and participating ships only; borrowing remains the default',()=>{
  const store=armed(),before=JSON.stringify(store),scheme={fleet:1,ships:[{id:2,slots:[201,202],ex:-1}]};
  const allowed=R.recommendNormalEquipment(store,{scheme,area:'1-1'});
  assert(itemIds(allowed.scheme).some(id=>id>=200),'default can use a better weapon from another ship');
  const restricted=R.recommendNormalEquipment(store,{scheme,area:'1-1',automaticFilters:filters});
  assert(itemIds(restricted.scheme).length);assert(itemIds(restricted.scheme).every(id=>[101,102,104].includes(id)));
  const heldSlots=[{...scheme.ships[0],keep:{0:true}}];
  assert.throws(()=>R.recommendNormalEquipment(store,{scheme,area:'1-1',heldSlots,automaticFilters:filters}),/不借用.*草稿已保留/);
  assert.equal(JSON.stringify(store),before);
});
test('expedition and airbase equipment stay locked even with borrowing and future hull planning enabled',()=>{
  const F=require('../../src/config/recommendation_filters');
  const {createEquipmentPlanner}=require('../../src/domain/fleet/equipment_planner');
  for(const situation of ['expedition','airbase']){
    const store=armed();store.info.ships[8].api_slot=[201,-1];store.info.ships[8].api_slot_ex=202;
    if(situation==='expedition')store.info.fleets[2]={api_ship:[8],api_mission:[1,1]};
    if(situation==='airbase'){
      store.info.ships[8].api_slot=[-1,-1];store.info.ships[8].api_slot_ex=-1;
      store.info.airbase=[{api_plane_info:[{api_slotid:201},{api_slotid:202}]}];
    }
    const before=JSON.stringify(store);
    for(const allowEquipmentBorrowing of [true,false]){
      const settings={...F.DEFAULTS.normal,allowEquipmentBorrowing,excludeExpedition:false,excludeRepairing:false};
      for(const input of [store,F.planningStore(store,settings)]){
        const inventory=equipmentForFleet(availableEquipment(input),[2,8],settings);
        assert(!inventory.some(item=>item.id>=200),situation+' locked independently of borrowing and membership');
        const scheme={fleet:1,ships:[{id:2,slots:[201,202],ex:-1}]};
        const result=R.recommendNormalEquipment(input,{scheme,area:'1-1',automaticFilters:settings});
        assert(itemIds(result.scheme).every(id=>id<200),situation+' cannot be chosen by refitting');
        // Final preview remains a separate hard check, even on a planning copy.
        const planner=createEquipmentPlanner(()=>input);
        for(const projectionOnly of [false,true])assert.throws(()=>planner.resolvePlan(scheme,{fleetShips:[2],projectionOnly}),/无可用装备/);
      }
    }
    assert.equal(JSON.stringify(store),before);
  }
});
test('repairing hulls remain excluded but their normal and expansion equipment can be borrowed',()=>{
  const F=require('../../src/config/recommendation_filters');
  for(const state of ['dock','dockId','situation']){
    const store=armed();store.info.ships[8].api_slot=[201,-1];store.info.ships[8].api_slot_ex=202;
    if(state==='dock')store.info.repairs=[{api_ship_id:8}];
    if(state==='dockId')store.info.repairs=[8];
    if(state==='situation')store.info.ships[8].api_situation=2;
    const before=JSON.stringify(store);
    assert(F.evaluator(store,'normal')(8).includes('入渠中'));
    assert(F.evaluator(store,'expedition')(8).includes('入渠中'));
    for(const input of [store,F.planningStore(store,{...F.DEFAULTS.normal,excludeRepairing:false})]){
      const inventory=availableEquipment(input);
      assert.deepEqual(inventory.filter(i=>i.sourceShipId===8).map(i=>i.id),[201,202]);
      for(const allowEquipmentBorrowing of [true,false]){
        const scheme={fleet:1,ships:[{id:2,slots:[],ex:-1}]};
        const fitted=R.recommendNormalEquipment(input,{scheme,area:'1-1',automaticFilters:{allowEquipmentBorrowing}});
        assert.equal(itemIds(fitted.scheme).some(id=>id>=200),allowEquipmentBorrowing);
      }
    }
    assert.equal(JSON.stringify(store),before);
  }
});
test('fleet search, real worker batches, and hull upgrades enforce the same ownership boundary',async()=>{
  const {RecommendationPool}=require('../../src/infrastructure/workers/recommendation_pool');
  const store=armed(),before=JSON.stringify(store),args={area:'1-1',routeKey:'A>C',fixedShipIds:[2],excludedShipIds:[1,3,4,5,6,7,8],automaticFilters:filters};
  const serial=R.recommendNormalFleet(store,args),pool=new RecommendationPool(store,{size:2});
  assert(serial.recommendations.length);
  for(const row of serial.recommendations)assertFleetEquipment(row.scheme,equipmentForFleet(availableEquipment(store),row.scheme.ships,filters),filters);
  try{
    const parallel=await R.recommendNormalFleetParallel(store,args,(batch,fallback)=>pool.run(batch,fallback));
    assert.deepEqual(parallel.recommendations.map(r=>r.scheme),serial.recommendations.map(r=>r.scheme));
    const batchArgs={area:'1-1',automaticFilters:filters};
    const [base]=await pool.execute(pool.workers[0]||pool.spawn(),{kind:'seeds',args:batchArgs,items:[[2]]});
    assert(base);assert(itemIds(base.scheme).every(id=>[101,102,104].includes(id)));
    const option=require('../../src/domain/routes/route_plans').routeOptions('1-1').find(r=>r.key==='A>C');
    const [{candidate}]=await pool.execute(pool.workers[0],{kind:'refinement',args:batchArgs,items:[{ids:[3],base,option}]});
    assert(candidate,'stronger hull keeps its independent refitting opportunity');
    assert(itemIds(candidate.scheme).length);assert(itemIds(candidate.scheme).every(id=>[103,104].includes(id)));
    const [borrowed]=await pool.execute(pool.workers[0],{kind:'seeds',args:{area:'1-1'},items:[[2]]});
    assert(itemIds(borrowed.scheme).some(id=>id>=200),'cached no-borrow results do not contaminate allowed borrowing');
  }finally{await pool.dispose();}
  assert.equal(JSON.stringify(store),before);
});
test('shared UI/MCP service injects the saved policy into both searches and separates cached results',async()=>{
  const fs=require('fs'),os=require('os'),path=require('path');
  const {FleetAdvisorService}=require('../../src/application/fleet_advisor_service');
  const {Controller}=require('../../src/application/controller');
  const {RecommendationCache}=require('../../src/infrastructure/cache/recommendation_cache');
  const store=armed(),before=JSON.stringify(store),dir=fs.mkdtempSync(path.join(os.tmpdir(),'paa-borrowing-'));
  const service=new FleetAdvisorService({storageDir:dir,getStore:()=>store,controller:new Controller({getStore:()=>store})});
  try{
    const {snapshotId}=service.createSnapshot(),scheme={fleet:1,ships:[{id:2,slots:[],ex:-1}]};
    const args={snapshotId,scheme,area:'1-1',automaticFilters:{allowEquipmentBorrowing:true}};
    const cache=new RecommendationCache(path.join(dir,'test-cache'),{version:'test'});
    assert.notEqual(cache.key('recommendNormalEquipment',store,args),cache.key('recommendNormalEquipment',store,{...args,automaticFilters:filters}));
    const allowed=await service.recommendNormalEquipment(args);assert(itemIds(allowed.scheme).some(id=>id>=200));
    service.setRecommendationFilters({normal:filters});
    const restricted=await service.recommendNormalEquipment(args);
    assert(itemIds(restricted.scheme).length);assert(itemIds(restricted.scheme).every(id=>[101,102,104].includes(id)));
    const fleet=await service.recommendNormalFleet({snapshotId,area:'1-1',routeKey:'A>C',fixedShipIds:[2],excludedShipIds:[1,3,4,5,6,7,8],automaticFilters:args.automaticFilters});
    assert(fleet.recommendations.length);assert.equal(fleet.selectionFilters.settings.allowEquipmentBorrowing,false);
    assert(fleet.recommendations.every(row=>itemIds(row.scheme).every(id=>[101,102,104].includes(id))));
    service.setRecommendationFilters({normal:{allowEquipmentBorrowing:true}});
    assert.deepEqual((await service.recommendNormalEquipment(args)).scheme,allowed.scheme);
    assert.equal(JSON.stringify(store),before);
  }finally{
    await service.dispose();
    assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'paa-borrowing-'));
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
