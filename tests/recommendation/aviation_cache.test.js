'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {withEquipmentIndexCache}=require('../../src/domain/fleet/equipment_planner');
const metrics=require('../../src/domain/fleet/fleet_metrics');
const carrierCI=require('../../src/domain/combat/carrier_cutin');
const {availableEquipment}=require('../../src/recommendation/loadout/loadout_policy');
function fixture(){
  const store=require('../helpers/workbench_fixture')();store.info.resources=[1000,1000,1000,1000];
  for(const id of [1,2]){
    Object.assign(store.const.$ships[id],{api_ctype:0,api_stype:11,api_aftershipid:0,api_slot_num:4,api_maxeq:[34,21,12,6]});
    Object.assign(store.info.ships[id],{api_slot:[101,102,103,104],api_onslot:[34,21,12,6],api_lucky:[20,50],api_sakuteki:[60,80]});
  }
  store.const.$shipTypes[11]={api_equip_type:{6:1,7:1,8:1,35:1,57:1}};
  for(const [id,type,stats] of [[6,6,{api_tyku:10}],[7,7,{api_baku:13}],[8,8,{api_raig:13}],
    [35,35,{api_houg:10}],[53,6,{api_tyku:15}],[54,6,{api_tyku:12}],
    [199,57,{api_baku:15,api_tyku:6}],[200,57,{api_baku:11,api_tyku:12}]])
    store.const.$equips[id]={api_id:id,api_name:`测试装备${id}`,api_type:[0,0,type,type],...stats};
  for(const [id,mid] of [[101,8],[102,7],[103,6],[104,35],[201,53],[202,54],[301,199],[302,200]])
    store.info.equips[id]={api_id:id,api_slotitem_id:mid,api_alv:7,api_level:0};
  return store;
}
const scheme=store=>({fleet:1,ships:[{id:1,slots:store.info.ships[1].api_slot.slice(),ex:-1}]});

test('air equivalence ignores names and instances but retains loss-relevant aircraft inputs',()=>{
  const {airContributionKey}=require('../../src/domain/routes/route_air');
  const base={status:'range',min:50,max:52,slots:[{shipId:1,slot:0,itemId:10,aircraftType:6,
    planes:[12,12],effectiveAntiAir:[8,8],proficiencyBonus:[25,25.5]}]};
  const copy=structuredClone(base);copy.slots[0].itemId=99;
  assert.equal(airContributionKey(base),airContributionKey(copy));
  for(const [key,value] of [['aircraftType',7],['planes',[11,12]],['effectiveAntiAir',[8.1,8.1]],['proficiencyBonus',[24,25.5]]]){
    const other=structuredClone(base);other.slots[0][key]=value;
    assert.notEqual(airContributionKey(base),airContributionKey(other),'same rounded departure power is not sufficient');
  }
  const jet=structuredClone(base);Object.assign(jet.slots[0],{aircraftType:57,masterId:199,jetSteel:1000,bomb:15});
  const empty=structuredClone(jet);empty.slots[0].jetSteel=0;
  assert.notEqual(airContributionKey(jet),airContributionKey(empty));
  empty.slots[0].unknown='capacity';assert.equal(airContributionKey(empty),null);
});

test('same-air different-name attackers share feasibility without merging their inventory or scores',()=>{
  const store=fixture(),base=scheme(store),{PerformanceTrace}=require('../../src/shared/performance_trace');
  // Each lower-power bomber produces the same air/loss input. None can replace
  // the large fighter here; the search must not rerun losses for every name.
  base.ships[0].slots=[201,102,103,104];
  for(let i=0;i<20;i++){
    const id=1000+i;store.const.$equips[id]={api_id:id,api_name:'不同舰爆'+i,api_type:[0,0,7,7],api_baku:8+i,api_tyku:0};
    store.info.equips[id]={api_id:id,api_slotitem_id:id,api_alv:7,api_level:0};
  }
  const ref={status:'known',enemyAirPower:40,paths:[['A','Z']],nodes:[
    {id:'A',enemyAirPower:40,antiAir:{status:'known',proportion:0.1,fixed:2}},
    {id:'Z',boss:true,enemyAirPower:40}]};
  const trace=new PerformanceTrace(),{airLoadout}=require('../../src/recommendation/loadout/air_fitting');
  const fit=trace.run(()=>airLoadout(store,base,availableEquipment(store),60,ref));
  assert(Object.entries(trace.counters).some(([k,v])=>k.startsWith('air.equivalent.hit.')&&v>0));
  const ids=fit.ships.flatMap(e=>e.slots).filter(id=>id>0);assert.equal(ids.length,new Set(ids).size);
});
test('surface and route fitting reuse full inputs and return independent allocations',()=>{
  const {surfaceLoadout,routingLoadout}=require('../../src/recommendation/fitting'),store=fixture(),inventory=availableEquipment(store),base=scheme(store);
  const profile={counts:{surface:{maximum:1}},examples:[['A']],mapPreview:{nodes:[{id:'A',kind:'battle'}]}};
  const calls=[()=>surfaceLoadout(store,base,inventory,'5-2',undefined,profile),
    ()=>surfaceLoadout(store,base,inventory,'5-2',undefined,profile,[{...base.ships[0],keep:{0:true,1:true,2:true,3:true}}]),
    ()=>routingLoadout(store,base,inventory,{kind:'radarCarriers',count:1})];
  const expected=calls.map(call=>call());
  withEquipmentIndexCache(store,()=>{
    for(let pass=0;pass<3;pass++)calls.forEach((call,i)=>{const actual=call();assert.deepEqual(actual,expected[i]);if(actual)actual.ships[0].slots.fill(-1);});
  });
});

test('immutable search batches share stock indexes without retaining live ownership or availability',()=>{
  const store=fixture(),plain=availableEquipment(store),scope=new Map();
  const read=()=>withEquipmentIndexCache(store,()=>availableEquipment(store),scope);
  const first=read();assert.deepEqual(first,plain);assert.equal(read(),first);
  assert.notEqual(availableEquipment(store),first,'live reads never use a previous search');
  store.info.ships[1].api_slot[0]=201;
  store.info.fleets[0].api_ship=[1,-1,-1,-1,-1,-1];store.info.fleets[0].api_mission=[1,1];
  const fresh=withEquipmentIndexCache(store,()=>availableEquipment(store));
  assert(!fresh.some(item=>item.id===201),'a new search sees gear on an expedition ship');
  assert(first.some(item=>item.id===201),'the old immutable catalogue is not edited');
});

test('shared stock catalogues are read-only inputs to automatic fitting',()=>{
  const store=fixture();
  withEquipmentIndexCache(store,()=>{
    const inventory=availableEquipment(store),before=JSON.stringify(inventory);
    inventory.forEach(Object.freeze);Object.freeze(inventory);
    const {completeCombatLoadout}=require('../../src/recommendation/loadout/loadout_policy');
    const {airLoadout}=require('../../src/recommendation/fitting');
    const base=completeCombatLoadout(store,scheme(store),inventory,{area:'5-2'});
    airLoadout(store,base,inventory,90);
    assert.equal(JSON.stringify(inventory),before);
  });
});

test('batch contexts share immutable rosters, distinguish constraints and isolate scoring callbacks',()=>{
  const {context}=require('../../src/recommendation/context'),store=fixture();
  const args={fleet:1,automaticFilters:{minLevel:1,excludeUnremodeled:false,excludeUnlocked:false}};
  withEquipmentIndexCache(store,()=>{
    const a=context(store,args,1),b=context(store,structuredClone(args),1);
    assert.notEqual(a,b);assert.equal(a.roster,b.roster);assert.equal(a.preview,b.preview);
    a.combatScore=()=>99;assert.equal(b.combatScore,undefined);
    const c=context(store,{...args,excludedShipIds:[1]},1);
    assert(!c.roster.some(row=>row.id===1));assert(a.roster.some(row=>row.id===1));
    assert.notEqual(context(store,{...args,fleet:2},1).preview,a.preview);
    context(store,{...args,fleet:null},1);
    assert.throws(()=>context(store,{...args,fleet:NaN},1),/fleet/);
    assert.throws(()=>context(store,{...args,fixedShipIds:null},1),/fixedShipIds/);
  });
  const first=context(store,args,1);store.info.ships[1].api_lv=1;
  const next=context(store,{...args,automaticFilters:{...args.automaticFilters,minLevel:30}},1);
  assert(first.roster.some(row=>row.id===1));assert(!next.roster.some(row=>row.id===1));
});

test('hull ASW sampling is reused within a search and refreshed after observed stats change',()=>{
  const {aswPotential,context}=require('../../src/recommendation/context'),store=fixture();
  const args={fleet:1,automaticFilters:{minLevel:1,excludeUnremodeled:false,excludeUnlocked:false}};
  const read=()=>aswPotential(store,context(store,args,1).byId.get(3));
  const first=withEquipmentIndexCache(store,read);
  assert(Number.isFinite(first));store.info.ships[3].api_taisen[0]+=30;
  const expected=read();assert.notEqual(expected,first);
  assert.equal(withEquipmentIndexCache(store,read),expected);
});

test('repeated air fits reuse per-slot metrics only inside an immutable search scope',()=>{
  const store=fixture(),inventory=availableEquipment(store),base=scheme(store),original=metrics.airPower;
  const file=require.resolve('../../src/recommendation/loadout/air_fitting');delete require.cache[file];let calls=0;
  metrics.airPower=(...args)=>{calls++;return original(...args);};
  try{
    const {airLoadout}=require(file),plain=airLoadout(store,base,inventory,90);
    withEquipmentIndexCache(store,()=>{
      const first=airLoadout(store,base,inventory,90),firstCalls=calls;
      const second=airLoadout(store,base,inventory,90);
      assert(firstCalls>0);assert.equal(calls,firstCalls,'the same slot metrics should not be rebuilt');
      assert.deepEqual(first,plain);assert.deepEqual(second,plain);
    });
    const end=calls;airLoadout(store,base,inventory,90);assert(calls>end,'live callers must recalculate');
  }finally{metrics.airPower=original;delete require.cache[file];}
});

test('cached suitability never caches stock allocation or manual holds',()=>{
  const store=fixture(),inventory=availableEquipment(store),base=scheme(store);
  const {airLoadout}=require('../../src/recommendation/fitting');
  const occupied={fleet:1,ships:[base.ships[0],{id:2,slots:[201,-1,-1,-1],ex:-1}]};
  const held=[{...occupied.ships[1],keep:{0:true,1:true,2:true,3:true}}];
  const expected=airLoadout(store,occupied,inventory,90,undefined,'superiority',held);
  withEquipmentIndexCache(store,()=>{
    airLoadout(store,base,inventory,90);
    const actual=airLoadout(store,occupied,inventory,90,undefined,'superiority',held);
    assert.deepEqual(actual,expected);assert.equal(actual.ships[1].slots[0],201);
    const ids=actual.ships.flatMap(e=>e.slots.concat(e.ex)).filter(id=>id>0);
    assert.equal(ids.length,new Set(ids).size);
    assert(!actual.ships[0].slots.includes(201));
  });
});

test('reused exact air fits isolate output edits and held slots',()=>{
  const store=fixture(),inventory=availableEquipment(store),base=scheme(store);
  const {airLoadout}=require('../../src/recommendation/loadout/air_fitting');
  withEquipmentIndexCache(store,()=>{
    const result=airLoadout(store,base,inventory,90),expected=structuredClone(result);
    result.ships[0].slots[0]=-1;
    assert.deepEqual(airLoadout(store,base,inventory,90),expected);
    const held=[{...base.ships[0],keep:{0:true,1:true,2:true,3:true}}];
    assert.deepEqual(airLoadout(store,base,inventory,90,undefined,'superiority',held).ships[0].slots,base.ships[0].slots);
  });
});

test('new search scopes observe changed capacity, steel and equipment instead of reusing old slot facts',()=>{
  const store=fixture(),original=metrics.airPower,file=require.resolve('../../src/recommendation/loadout/air_fitting');
  delete require.cache[file];const seen=[];
  metrics.airPower=(...args)=>{const value=original(...args);seen.push(...value.slots);return value;};
  try{
    const {airLoadout}=require(file),inventory=availableEquipment(store),base=scheme(store);
    base.ships[0].slots[0]=301;
    const held=[{...base.ships[0],keep:{0:true}}];
    withEquipmentIndexCache(store,()=>airLoadout(store,base,inventory,90,undefined,'superiority',held));
    assert(seen.some(s=>s.masterId===199&&s.jetSteel===1000));seen.length=0;
    store.info.resources[2]=0;store.info.ships[1].api_onslot[0]=17;store.const.$ships[1].api_maxeq[0]=17;
    store.const.$equips[199].api_tyku=8;
    const expected=airLoadout(store,base,inventory,90,undefined,'superiority',held);seen.length=0;
    const actual=withEquipmentIndexCache(store,()=>airLoadout(store,base,inventory,90,undefined,'superiority',held));
    assert.deepEqual(actual,expected);
    assert(seen.some(s=>s.masterId===199&&s.jetSteel===0&&s.planes[0]===17&&s.effectiveAntiAir[0]===8));
  }finally{metrics.airPower=original;delete require.cache[file];}
});

test('jet CI power reuse keeps scores identical and distinguishes changed carrier loadouts',()=>{
  const store=fixture(),original=carrierCI.attackPowers;let calls=0;
  carrierCI.attackPowers=(...args)=>{calls++;return original(...args);};
  try{
    const {scoreRoute}=require('../../src/recommendation/scoring');
    const base=scheme(store);base.ships[0].slots=[301,101,103,104];
    const profile={area:'1-1',examples:[['A','C']],counts:{surface:{maximum:2},air:{maximum:0},asw:{maximum:0},night:{maximum:0}}};
    const score=s=>{
      const targets=metrics.projectFleet(store,{organization:{targets:[1]},equipment:{expected:[{shipId:1,state:s.ships[0]}]}});
      const row={id:1,ship:store.info.ships[1],master:store.const.$ships[1],stype:11,level:50,fuel:80,ammo:80};
      return scoreRoute({chanceRange:[1,1],verdict:'guaranteed',airControl:{fleetAirPower:metrics.airPower(store,targets)}},
        profile,[row],'superiority','1-1',store,s);
    };
    const plain=score(base),changed={...base,ships:[{...base.ships[0],slots:[302,101,103,104]}]},expected=score(changed);
    withEquipmentIndexCache(store,()=>{
      assert.deepEqual(score(base),plain);const first=calls;
      assert.deepEqual(score(base),plain);assert.equal(calls,first);
      assert.deepEqual(score(changed),expected);assert(calls>first);
    });
  }finally{carrierCI.attackPowers=original;}
});

test('route ASW facts share only immutable search scopes and live route edits remain visible',()=>{
  const {aswEscortLimit,submarineObjective}=require('../../src/recommendation/loadout/loadout_policy');
  const store=fixture(),profile={targetNodes:['B'],examples:[['A','B']],
    counts:{surface:{maximum:1},asw:{maximum:1}},mapPreview:{nodes:[{id:'A',kind:'asw'},{id:'B',kind:'battle'}]}};
  assert.equal(aswEscortLimit(profile,store),2);
  withEquipmentIndexCache(store,()=>{
    assert.equal(aswEscortLimit(profile,store),2);assert.equal(submarineObjective(profile,store),false);
  });
  profile.examples=[['C']];profile.targetNodes=['C'];profile.mapPreview.nodes.push({id:'C',kind:'asw'});
  assert.equal(aswEscortLimit(profile,store),Infinity);
  assert.equal(withEquipmentIndexCache(store,()=>aswEscortLimit(profile,store)),Infinity);
});

test('candidate input reuse keeps complete results and does not cross held-slot constraints',()=>{
  const {recommendationBatch}=require('../../src/recommendation/normal');
  const {PerformanceTrace}=require('../../src/shared/performance_trace');
  const store=require('../helpers/workbench_fixture')();
  const args={fleet:1,area:'1-1',airGoal:'ignore',};
  const batches=[{kind:'seeds',args,items:[[2],[3]]},
    {kind:'seeds',args:{...args,heldSlots:[{id:2,slots:[-1,-1],ex:-1,keep:{0:true,1:true}}]},items:[[2]]}];
  const expected=batches.map(batch=>recommendationBatch(store,batch));
  assert(expected[0].every(Boolean));
  const trace=new PerformanceTrace({level:'stages'});
  trace.run(()=>withEquipmentIndexCache(store,()=>{
    for(let i=0;i<3;i++)batches.forEach((batch,j)=>assert.deepEqual(recommendationBatch(store,batch),expected[j]));
  }));
  assert(trace.snapshot().counters['candidate.inputHit']>=2);
  assert(trace.snapshot().counters['candidate.setup.hit']>=2,'full query preparation is shared without crossing holds');
});
test('prepared evaluators keep captured holds when a caller reuses and edits its query object',()=>{
  const {recommendationBatch}=require('../../src/recommendation/normal'),store=require('../helpers/workbench_fixture')();
  store.const.$shipTypes[2]={api_equip_type:{1:1}};
  store.const.$equips[1]={api_id:1,api_name:'主炮',api_type:[0,0,1,1],api_houg:5};
  for(const id of [101,102])store.info.equips[id]={api_id:id,api_slotitem_id:1};
  const original={fleet:1,area:'1-1',airGoal:'ignore'},mutable=structuredClone(original);
  const held=[{id:2,slots:[-1,-1],ex:-1,keep:{0:true,1:true}}];
  const run=args=>recommendationBatch(store,{kind:'seeds',args,items:[[2]]});
  const plain=run(original),locked=run({...original,heldSlots:held});assert.notDeepEqual(plain,locked);
  withEquipmentIndexCache(store,()=>{
    assert.deepEqual(run(mutable),plain);mutable.heldSlots=held;assert.deepEqual(run(mutable),locked);
    assert.deepEqual(run(structuredClone(original)),plain);
  });
});

test('air-pair score tiers match exhaustive original traversal, including equal scores and failed high tiers',()=>{
  const {selectAirPair}=require('../../src/recommendation/loadout/air_fitting');
  let seed=917;const next=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  const order=(a,b)=>a.cruiserIndex-b.cruiserIndex||a.waterIndex-b.waterIndex||a.carrierIndex-b.carrierIndex||a.index-b.index;
  for(let round=0;round<200;round++){
    const pairs=[],feasible=new Set();
    for(let cruiserIndex=0;cruiserIndex<3;cruiserIndex++)for(let carrierIndex=0;carrierIndex<2;carrierIndex++)for(let index=0;index<5;index++){
      const pair={cruiserIndex,carrierIndex,index,score:1+next(5),waters:[]};
      for(let w=0;w<4;w++){const water={id:w*3+1};pair.waters.push({water,index:w*2,gain:1+w});
        if(next(5)===0)feasible.add([cruiserIndex,carrierIndex,index,water.id].join(':'));}
      pairs.push(pair);
    }
    const allowed=(pair,water)=>feasible.has([pair.cruiserIndex,pair.carrierIndex,pair.index,water.id].join(':'));
    const all=pairs.flatMap(pair=>pair.waters.filter(w=>allowed(pair,w.water)).map(w=>({...pair,water:w.water,waterIndex:w.index})))
      .sort((a,b)=>b.score-a.score||order(a,b));
    assert.deepEqual(selectAirPair(pairs,allowed),all[0]||null);
  }
  let calls=0;const pairs=[1,10,5].map((score,index)=>({cruiserIndex:0,carrierIndex:0,index,score,waters:[{water:{id:1},index:0,gain:1}]}));
  assert.equal(selectAirPair(pairs,()=>{calls++;return true;}).score,10);assert.equal(calls,1);
});

test('route score reuse distinguishes settings and replacement row contexts',()=>{
  const {scoreRoute}=require('../../src/recommendation/scoring'),{context}=require('../../src/recommendation/context');
  const {evaluateNormalRoute}=require('../../src/domain/routes/normal_routes'),{profileForRoute}=require('../../src/domain/routes/sortie_profile');
  const store=require('../helpers/workbench_fixture')(),scheme={fleet:1,ships:[{id:2,slots:[-1,-1],ex:-1}]};
  const route=evaluateNormalRoute(store,{area:'1-1',fleet:1,scheme}),profile=profileForRoute('1-1',route),rows=[context(store,{fleet:1},1).byId.get(2)];
  const rank=()=>scoreRoute(route,profile,rows,'ignore','1-1',store,scheme),expected=rank();
  withEquipmentIndexCache(store,()=>{
    const first=rank();assert.equal(rank(),first);
    assert.deepEqual(first,expected);
    const altered=rows.map(row=>({...row,fuel:row.fuel+100}));
    const other=scoreRoute(route,profile,altered,'ignore','1-1',store,scheme);
    assert.notEqual(other,first);assert.notEqual(other.rank,first.rank);
    assert.notEqual(scoreRoute(route,profile,rows,'superiority','1-1',store,scheme),first);
  });
});
