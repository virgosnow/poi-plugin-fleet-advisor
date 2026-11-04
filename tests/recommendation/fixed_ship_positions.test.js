'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {recommendNormalFleet}=require('../../src/recommendation/index');

function fleetFixture(){
  const store={info:{basic:{api_level:120},ships:{},equips:{},repairs:[],airbase:[],
    fleets:[1,2,3,4].map(()=>({api_ship:[-1,-1,-1,-1,-1,-1],api_mission:[0,0]}))},
    const:{$ships:{},$equips:{},$shipTypes:{},$equipShip:{},$exslotEquips:[39],
      $exslotEquipShips:{},$exslotEquipLimits:{}}};
  const add=(id,type,icon,name,stats={})=>{
    store.info.equips[id]={api_slotitem_id:id,api_level:0};
    store.const.$equips[id]={api_id:id,api_type:[0,0,type,icon],api_name:name,...stats};
  };
  for(const [id,name,type] of [[1,'朝潮改二丁',2],[2,'武蔵改二',9],[3,'大和改二重',10],
    [4,'矢矧改二乙',3],[5,'阿武隈改二',3],[6,'Zara due',5]]){
    const speed=id===2||id===3?5:10;
    store.const.$ships[id]={api_id:id,api_name:name,api_stype:type,api_slot_num:4,
      api_maxeq:[0,0,4,4],api_soku:speed,api_fuel_max:40,api_bull_max:40};
    store.info.ships[id]={api_id:id,api_ship_id:id,api_lv:id===1?160:99,api_cond:49,
      api_fuel:40,api_bull:40,api_soku:speed,api_slot:[-1,-1,-1,-1],api_slot_ex:-1,
      api_onslot:[0,0,4,4],api_karyoku:[90,90],api_raisou:[90,90],api_soukou:[75,75],
      api_sakuteki:[500,500],api_taiku:[50,50],api_taisen:[30,30]};
    store.const.$shipTypes[type]={api_equip_type:Object.fromEntries(
      [1,2,3,5,10,11,12,13,14,15,33,39,45].map(t=>[t,1]))};
  }
  for(let id=520;id<524;id++)add(id,3,3,'46cm三連装砲',{api_houg:26});
  for(let id=524;id<528;id++)add(id,1,1,'小口径主炮',{api_houg:5});
  for(let id=528;id<534;id++)add(id,45,43,'二式水戦改',{api_tyku:5});
  return store;
}

test('fixedShipIds require hulls but do not reserve their listed positions',()=>{
  const store=fleetFixture(),before=JSON.stringify(store);
  const args={area:'6-5',routeKey:'B>C>D>G>M',airGoal:'ignore',fixedShipIds:[1,2,3]};
  const result=recommendNormalFleet(store,args);
  const row=result.recommendations.find(r=>r.routeKey===args.routeKey);
  assert(row);assert.equal(row.pathChance.probability,1);
  assert.deepEqual(new Set(row.scheme.ships.slice(0,2).map(e=>e.id)),new Set([2,3]));
  assert(row.scheme.ships.some(e=>e.id===1));
  assert.equal(row.scores.specialAttack.label,'大和型齐射');assert(row.scores.specialAttack.bonus>0);
  assert.equal(JSON.stringify(store),before);
});

test('explicit heldSlots positions remain fixed even when special attacks prefer another order',()=>{
  const store=fleetFixture();
  const args={area:'6-5',routeKey:'B>C>D>G>M',airGoal:'ignore',fixedShipIds:[1,2,3],
    heldSlots:[{id:1,pin:true,slots:[-1,-1,-1,-1],keep:{}}]};
  const result=recommendNormalFleet(store,args);
  const row=result.recommendations.find(r=>r.routeKey===args.routeKey);
  assert(row);assert.equal(row.pathChance.probability,1);
  assert.equal(row.scheme.ships[0].id,1);
  assert.equal(row.scores.specialAttack.bonus,0);
});

function sixFourFixture(){
  const store=fleetFixture();
  for(const [id,name,type] of [[1,'轻巡甲改',3],[2,'驱逐甲改',2],[3,'驱逐乙改',2],
    [4,'驱逐丙改',2],[5,'重巡甲改',5],[6,'水母甲改',16]]){
    Object.assign(store.const.$ships[id],{api_name:name,api_stype:type,api_soku:10});
    Object.assign(store.info.ships[id],{api_soku:10,api_sakuteki:[500,500]});
    store.const.$shipTypes[type]={api_equip_type:Object.fromEntries([1,2,3,5,10,11,12,13,14,15,33,39,45].map(t=>[t,1]))};
  }
  return store;
}

test('fixed hulls permit a route-required light cruiser flagship',()=>{
  const store=sixFourFixture(),routeKey='B>D>C>F>N';
  const args={area:'6-4',routeKey,airGoal:'ignore',fixedShipIds:[2,3,4,1,5,6]};
  const control=recommendNormalFleet(store,{...args,fixedShipIds:[1,2,3,4,5,6]});
  assert(control.recommendations.some(r=>r.routeKey===routeKey),'the same hulls with a light cruiser flagship are viable');
  const result=recommendNormalFleet(store,args);
  const row=result.recommendations.find(r=>r.routeKey===routeKey);
  assert(row,'fixed hull inclusion should not pin the first ship as flagship');
  assert.equal(row.scheme.ships[0].id,1);
  assert.equal(row.pathChance.probability,1);
});

test('an explicit held flagship cannot be moved to satisfy a route',()=>{
  const store=sixFourFixture(),routeKey='B>D>C>F>N';
  const result=recommendNormalFleet(store,{area:'6-4',routeKey,airGoal:'ignore',
    fixedShipIds:[2,3,4,1,5,6],heldSlots:[{id:2,pin:true,slots:[-1,-1,-1,-1],keep:{}}]});
  assert(!result.recommendations.some(r=>r.routeKey===routeKey),
    'an explicitly locked destroyer flagship cannot be silently replaced by the light cruiser');
});

test('a free hull may become the flagship when fixed hulls do not prescribe one',()=>{
  const store=sixFourFixture(),routeKey='B>D>C>F>N';
  const result=recommendNormalFleet(store,{area:'6-4',routeKey,airGoal:'ignore',fixedShipIds:[2,3,4]});
  const row=result.recommendations.find(r=>r.routeKey===routeKey);
  assert(row,'a non-fixed light cruiser can lead the fixed destroyers');
  assert.equal(row.scheme.ships[0].id,1);
  for(const id of [2,3,4])assert(row.scheme.ships.some(s=>s.id===id));
  assert.equal(row.pathChance.probability,1);
});

test('route flagship alternatives survive a same-family conflict in serial and worker search',async()=>{
  const store=sixFourFixture(),routeKey='B>D>C>F>N';
  // The highest-scored light cruiser is the same family as a fixed destroyer;
  // the lower-scored, independent light cruiser must remain a candidate.
  store.const.$ships[1].api_yomi='shared-family';
  store.const.$ships[2].api_yomi='shared-family';
  store.const.$ships[7]={...store.const.$ships[1],api_id:7,api_name:'轻巡乙改',api_yomi:'independent-family'};
  store.info.ships[7]={...store.info.ships[1],api_id:7,api_ship_id:7,api_lv:60};
  const args={area:'6-4',routeKey,airGoal:'ignore',fixedShipIds:[2,3,4]};
  const check=result=>{
    const row=result.recommendations.find(r=>r.routeKey===routeKey);
    assert(row,'the independent light cruiser must not be pruned');
    assert.equal(row.scheme.ships[0].id,7);assert.equal(row.pathChance.probability,1);
    assert(!row.scheme.ships.some(s=>s.id===1));
  };
  const serial=recommendNormalFleet(store,args);check(serial);
  const {recommendNormalFleetParallel}=require('../../src/recommendation/index');
  const parallel=await recommendNormalFleetParallel(store,args,(_batch,run)=>run());
  check(parallel);assert.deepEqual(parallel,serial);
  const {RecommendationWorker}=require('../../src/infrastructure/workers/recommendation_worker');
  const worker=new RecommendationWorker({getDiagnostics:()=>null});
  try{const actual=await worker.run('recommendNormalFleet',store,args);check(actual);assert.deepEqual(actual,serial);}
  finally{await worker.dispose();}
});

test('a position-locked sixth ship cannot be silently shifted into a five-ship fleet',()=>{
  const store=fleetFixture(),{holdDraftEquipment}=require('../../src/recommendation/context');
  const held=[null,null,null,null,null,{id:2,pin:true,slots:[-1,-1,-1,-1],keep:{}}];
  const scheme=ids=>({fleet:1,ships:ids.map(id=>({id,slots:[-1,-1,-1,-1],ex:-1}))});
  assert.throws(()=>holdDraftEquipment(store,scheme([1,2,3,4,5]),held));
  assert.equal(holdDraftEquipment(store,scheme([1,2,3,4,5,6]),held).ships[5].id,2);
});

test('expedition search can fill every slot before an explicitly held sixth ship',()=>{
  const store=fleetFixture();
  store.const.$missions={1:{api_use_fuel:.3,api_use_bull:0}};
  const {recommendExpeditionFleet}=require('../../src/recommendation/index');
  const control=recommendExpeditionFleet(store,{missionId:1,fleet:2,goal:'success',fixedShipIds:[1,2,3,4,5,6],
    heldSlots:[null,null,null,null,null,{id:2,pin:true,slots:[-1,-1,-1,-1],keep:{}}]});
  assert(control.recommendations.length,'the six fixed hulls satisfy the expedition');
  const result=recommendExpeditionFleet(store,{missionId:1,fleet:2,goal:'success',fixedShipIds:[2],
    heldSlots:[null,null,null,null,null,{id:2,pin:true,slots:[-1,-1,-1,-1],keep:{}}]});
  assert(result.recommendations.length,'a six-ship candidate should remain available');
  for(const row of result.recommendations){assert.equal(row.scheme.ships.length,6);assert.equal(row.scheme.ships[5].id,2);}
});

test('conflicting expedition flagship and held positions never produce an invalid recommendation',()=>{
  const store=fleetFixture();store.const.$missions={1:{api_use_fuel:.3,api_use_bull:0}};
  const {recommendExpeditionFleet}=require('../../src/recommendation/index');
  const heldSlots=[null,null,null,null,null,{id:2,pin:true,slots:[-1,-1,-1,-1],keep:{}}];
  assert.throws(()=>recommendExpeditionFleet(store,{missionId:1,fleet:2,goal:'success',fixedFlagshipId:2,heldSlots}),
    err=>err.code==='INVALID_QUERY');
  const otherFlag=[{id:1,pin:true,slots:[-1,-1,-1,-1],keep:{}}];
  assert.throws(()=>recommendExpeditionFleet(store,{missionId:1,fleet:2,goal:'success',fixedFlagshipId:2,heldSlots:otherFlag}),
    err=>err.code==='INVALID_QUERY');
  const movable=[null,{id:2,pin:true,holdPosition:false,slots:[-1,-1,-1,-1],keep:{}}];
  const result=recommendExpeditionFleet(store,{missionId:1,fleet:2,goal:'success',fixedFlagshipId:2,heldSlots:movable});
  assert(result.recommendations.length);
  assert(result.recommendations.every(row=>row.scheme.ships[0].id===2));
});
