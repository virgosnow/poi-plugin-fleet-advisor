'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {nightLoadout,nightReadiness,doubleAttack}=require('../../src/recommendation/loadout/night_equipment');
const {recommendNormalFleet}=require('../../src/recommendation/index');
const {Controller}=require('../../src/application/controller');
function fixture(){
  const store={info:{basic:{api_level:120},ships:{},equips:{},repairs:[],airbase:[],
    fleets:[1,2,3,4].map(()=>({api_ship:[-1,-1,-1,-1,-1,-1],api_mission:[0,0]}))},
    const:{$ships:{},$equips:{},$shipTypes:{},$equipShip:{},$exslotEquips:[39],
      $exslotEquipShips:{},$exslotEquipLimits:{}}};
  const add=(id,type,icon,name,stats={})=>{
    store.info.equips[id]={api_slotitem_id:id,api_level:0};
    store.const.$equips[id]={api_id:id,api_type:[0,0,type,icon],api_name:name,...stats};
  };
  for(let id=1;id<=6;id++){
    const stype=id===6?3:6;
    store.const.$ships[id]={api_id:id,api_name:`测试舰${id}`,api_stype:stype,
      api_slot_num:4,api_maxeq:[0,0,4,4],api_soku:10,api_fuel_max:40,api_bull_max:40};
    store.info.ships[id]={api_id:id,api_ship_id:id,api_lv:85,api_cond:49,api_fuel:40,
      api_bull:40,api_soku:10,api_slot:[100+id*4,101+id*4,102+id*4,-1],api_slot_ex:-1,
      api_onslot:[0,0,4,4],api_karyoku:[90,90],api_raisou:[90,90],api_soukou:[75,75],
      api_sakuteki:[40,40],api_taiku:[50,50],api_taisen:[30,30]};
    add(100+id*4,2,2,'20.3cm連装砲',{api_houg:8});
    add(101+id*4,2,2,'20.3cm連装砲',{api_houg:8});
    add(102+id*4,45,43,'二式水戦改',{api_tyku:5});
    store.const.$shipTypes[stype]={api_equip_type:Object.fromEntries(
      [2,4,5,10,11,12,29,33,39,45].map(type=>[type,1]))};
  }
  add(500,10,50,'九八式水上偵察機(夜偵)',{api_saku:3});
  add(501,33,27,'照明弾');add(502,29,24,'探照灯');
  for(let id=503;id<509;id++)add(id,39,32,'熟練見張員');
  const scheme={fleet:1,ships:[1,2,3,4,5,6].map(id=>({id}))};
  const inventory=()=>Object.keys(store.info.equips).map(id=>({id:Number(id),
    sourceShipId:scheme.ships.find(e=>store.info.ships[e.id].api_slot.includes(Number(id)))?.id||null,
    master:store.const.$equips[store.info.equips[id].api_slotitem_id]}));
  return {store,scheme,inventory,add};
}
test('night loadout preserves two main guns and water fighters and uses owned support/expansion gear once',()=>{
  const {store,scheme,inventory}=fixture();
  const next=nightLoadout(store,scheme,inventory(),{normalizeGuns:true});
  const readiness=nightReadiness(store,next);
  assert.equal(readiness.recon,1);assert.equal(readiness.flares,1);
  assert.equal(readiness.lookouts,6);assert.equal(readiness.searchlights,0);
  assert.equal(readiness.doubleAttackShips,6);
  assert.deepEqual(readiness.warnings,[]);
  for(const entry of next.ships){
    assert.equal(entry.slots[2],store.info.ships[entry.id].api_slot[2]);
    assert(doubleAttack(store,entry));
  }
  const ids=next.ships.flatMap(e=>[...e.slots,e.ex]).filter(id=>id>0);
  assert.equal(new Set(ids).size,ids.length);
  assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',next));
  assert.equal(store.info.ships[1].api_slot[3],-1,'planning cannot mutate the snapshot');
});
test('repeated night fights use at most two flare carriers and never stack them on one ship',()=>{
  const {store,scheme,inventory,add}=fixture();add(510,33,27,'照明弾');add(511,33,27,'照明弾');
  const before=JSON.stringify(store);
  const single=nightLoadout(store,scheme,inventory(),{nightBattles:1});
  assert.equal(nightReadiness(store,single).flareCarriers,1);
  const repeated=nightLoadout(store,scheme,inventory(),{nightBattles:3});
  const readiness=nightReadiness(store,repeated);assert.equal(readiness.flareCarriers,2);assert.equal(readiness.flares,2);
  assert.equal(readiness.searchlights,0);
  for(const entry of repeated.ships){assert(doubleAttack(store,entry));assert.equal(entry.slots[2],store.info.ships[entry.id].api_slot[2]);}
  assert.equal(JSON.stringify(store),before);assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',repeated));
});

test('a second flare cannot displace a radar, a fighter, or a manual empty slot',()=>{
  const {store,scheme,inventory,add}=fixture();add(510,33,27,'照明弾');
  const first=nightLoadout(store,scheme,inventory(),{nightBattles:1});
  for(const e of first.ships)if(e.slots[3]===-1){add(530+e.id,12,11,'索敌电探',{api_saku:10});e.slots[3]=530+e.id;}
  assert.equal(nightReadiness(store,nightLoadout(store,first,inventory(),{nightBattles:3})||first).flareCarriers,1);
  const held=scheme.ships.map(e=>({id:e.id,slots:[-1,-1,-1,-1],keep:{3:true}}));
  const locked=nightLoadout(store,scheme,inventory(),{nightBattles:3,heldSlots:held});
  assert.equal(nightReadiness(store,locked).flares,0);
});

test('manual searchlights survive night normalization without adding any new searchlights',()=>{
  const {store,scheme,inventory}=fixture();store.info.ships[1].api_slot[3]=502;
  const held=[{id:1,slots:store.info.ships[1].api_slot.slice(),keep:{3:true}}];
  const result=nightLoadout(store,scheme,inventory(),{normalizeGuns:true,nightBattles:3,heldSlots:held});
  assert.equal(result.ships[0].slots[3],502);assert.equal(nightReadiness(store,result).searchlights,1);
});

test('5-3 recommendations prefer two distributed flares when spare slots and inventory allow',()=>{
  const {store,add}=fixture();add(510,33,27,'照明弾');
  const result=recommendNormalFleet(store,{area:'5-3',airGoal:'ignore'});
  const row=result.recommendations[0];assert(row);
  assert.equal(row.scores.nightSupport.flareCarriers,2);
  assert.equal(row.scores.nightSupport.searchlights,0);
  assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',row.scheme));
});

test('5-3 considers owned Nelson, assigns strong participants to 1/3/5, and respects exclusions and draft holds',()=>{
  const {store,add}=fixture();
  for(const [id,name,stype,speed] of [[7,'Nelson改',9,5],[8,'驱逐改甲',2,10],[9,'驱逐改乙',2,10],[10,'普通战舰改',9,10]]){
    store.const.$ships[id]={...store.const.$ships[1],api_id:id,api_name:name,api_stype:stype,api_soku:speed};
    store.info.ships[id]={...store.info.ships[1],api_id:id,api_ship_id:id,api_lv:id===7?80:95,
      api_soku:speed,api_slot:[-1,-1,-1,-1],api_karyoku:[stype===2?50:100,100],api_raisou:[stype===2?60:0,60]};
    const gun=stype===2?1:3;
    store.const.$shipTypes[stype]={api_equip_type:{...store.const.$shipTypes[6].api_equip_type,[gun]:1}};
    if(stype===2)delete store.const.$shipTypes[stype].api_equip_type[2];
    add(600+id*2,gun,gun,'测试主炮',{api_houg:8});add(601+id*2,gun,gun,'测试主炮',{api_houg:8});
  }
  // Stronger destroyers cost a little more and have slightly lower levels.
  // Route recommendations must not settle for the cheap pair as mere escorts.
  for(const id of [11,12]){
    store.const.$ships[id]={...store.const.$ships[8],api_id:id,api_name:`低耗驱逐${id}`,
      api_fuel_max:15,api_bull_max:15};
    store.info.ships[id]={...store.info.ships[8],api_id:id,api_ship_id:id,api_lv:99,
      api_fuel:15,api_bull:15,api_karyoku:[25,25],api_raisou:[50,50]};
  }
  // Make the intended heavy-cruiser participants strictly stronger, rather
  // than asserting one arbitrary ship-type tie among equal synthetic panels.
  store.info.ships[6].api_karyoku=[70,70];
  add(510,33,27,'照明弾');
  const args={area:'5-3',airGoal:'ignore'},before=JSON.stringify(store);
  const result=recommendNormalFleet(store,args),route=result.routeResults[0];
  const row=result.recommendations[route.recommendationIndex];assert(row);
  assert.equal(row.scheme.ships[0].id,7);assert.equal(row.scores.specialAttack.label,'Nelson Touch');
  assert(row.routeKey);
  assert.deepEqual(new Set(row.scheme.ships.filter(s=>[8,9,11,12].includes(s.id)).map(s=>s.id)),new Set([8,9]));
  assert.deepEqual(row.scores.specialAttack.participants.map(p=>p.position),[1,3,5]);
  for(const i of [2,4])assert.equal(store.const.$ships[row.scheme.ships[i].id].api_stype,6);
  assert.equal(row.pathChance.probability,1);assert(row.scheme.ships.every(e=>doubleAttack(store,e)));
  assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',row.scheme));
  const excluded=recommendNormalFleet(store,{...args,excludedShipIds:[7]});
  assert(excluded.recommendations.length);assert(excluded.recommendations.every(r=>!r.scheme.ships.some(e=>e.id===7)));
  const filtered=recommendNormalFleet(store,{...args,automaticFilters:{minLevel:85}});
  assert(filtered.recommendations.length);assert(filtered.recommendations.every(r=>!r.scheme.ships.some(e=>e.id===7)));
  const heldSlots=[{id:11,pin:true,slots:[501,-1,-1,-1],keep:{0:true}},null,null,null,{id:12,pin:true,slots:[],keep:{}}];
  const held=recommendNormalFleet(store,{...args,fixedShipIds:[11,12],heldSlots});
  assert(held.recommendations.length);
  for(const r of held.recommendations){assert.equal(r.scheme.ships[0].id,11);assert.equal(r.scheme.ships[4].id,12);assert.equal(r.scheme.ships[0].slots[0],501);assert.equal(r.scores.specialAttack.bonus,0);}
  const kongo=JSON.parse(before);
  for(const [id,name] of [[7,'金剛改二丙'],[10,'比叡改二丙']]){
    Object.assign(kongo.const.$ships[id],{api_name:name,api_stype:8,api_soku:10});
    kongo.info.ships[id].api_soku=10;
  }
  kongo.const.$shipTypes[8]=kongo.const.$shipTypes[9];
  const assault=recommendNormalFleet(kongo,args),recommended=assault.recommendations[assault.routeResults[0].recommendationIndex];
  assert.equal(recommended.scores.specialAttack.label,'金刚型夜战突击');
  assert.deepEqual(new Set(recommended.scheme.ships.slice(0,2).map(s=>s.id)),new Set([7,10]));
  assert.equal(recommended.pathChance.probability,1);
  assert.equal(JSON.stringify(store),before);
});

test('zero-plane slots do not qualify for night recon and scarcity produces an explicit warning',()=>{
  const {store,scheme,inventory}=fixture();
  for(const ship of Object.values(store.info.ships))ship.api_onslot=[0,0,0,0];
  const next=nightLoadout(store,scheme,inventory(),{normalizeGuns:true});
  assert.equal(nightReadiness(store,next).recon,0);
  assert(nightReadiness(store,next).warnings.some(w=>w.includes('夜侦')));
  assert(!next.ships.some(e=>e.slots.includes(500)));
  store.info.ships[1].api_slot[3]=500;
  assert.equal(nightReadiness(store,scheme).unfilledRecon,1);
  assert(nightReadiness(store,scheme).warnings.some(w=>w.includes('尚无飞机')));
});

test('6-5 mixed-route finalists enable an owned Yamato pair without moving held positions or gear',async()=>{
  const {store,add}=fixture();
  for(const [id,name,type] of [[1,'朝潮改二丁',2],[2,'武蔵改二',9],[3,'大和改二重',10],
    [4,'矢矧改二乙',3],[5,'阿武隈改二',3],[6,'Zara due',5]]){
    Object.assign(store.const.$ships[id],{api_name:name,api_stype:type,api_soku:id===2||id===3?5:10});
    Object.assign(store.info.ships[id],{api_lv:id===1?160:99,api_saku:500,api_sakuteki:[500,500],api_soku:id===2||id===3?5:10});
    store.const.$shipTypes[type]={api_equip_type:Object.fromEntries([1,2,3,5,10,11,12,13,14,15,33,39,45].map(t=>[t,1]))};
  }
  for(let id=520;id<524;id++)add(id,3,3,'46cm三連装砲',{api_houg:26});
  for(let id=524;id<528;id++)add(id,1,1,'小口径主炮',{api_houg:5});
  const args={area:'6-5',airGoal:'ignore'},before=JSON.stringify(store);
  const api=require('../../src/recommendation/index'),r=api.recommendNormalFleet(store,args);
  const pick=result=>result.recommendations.find(row=>row.routeKey==='B>C>D>G>M');
  const row=pick(r);assert(row);assert.equal(row.pathChance.probability,1);
  assert.deepEqual(new Set(row.scheme.ships.slice(0,2).map(e=>e.id)),new Set([2,3]));
  assert.equal(row.scores.specialAttack.label,'大和型齐射');assert(row.scores.specialAttack.bonus>0);
  assert.deepEqual(new Set(row.scheme.ships.map(e=>e.id)),new Set([1,2,3,4,5,6]));
  assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',row.scheme));
  // Serial and batch orchestration must expose the same final order and gear.
  const parallel=await api.recommendNormalFleetParallel(store,args,batch=>api.recommendationBatch(store,batch));
  assert.deepEqual(parallel,r);
  const heldSlots=[{...row.scheme.ships.find(e=>e.id===1),pin:true,keep:{0:true}}];
  const held=pick(api.recommendNormalFleet(store,{...args,fixedShipIds:[1],heldSlots}));
  assert(held);assert.equal(held.scheme.ships[0].id,1);assert.equal(held.scheme.ships[0].slots[0],heldSlots[0].slots[0]);
  assert.equal(held.scores.specialAttack.bonus,0,'do not override a manually held flagship to force a touch');
  assert.equal(JSON.stringify(store),before);
});

test('final special positioning cannot replace a route-required light-cruiser flagship',()=>{
  const {store}=fixture();
  for(const [id,name,type]of [[1,'轻巡改',3],[2,'Nelson改',9],[3,'驱逐甲改',2],[4,'驱逐乙改',2],[5,'驱逐丙改',2],[6,'水母改',16]]){
    Object.assign(store.const.$ships[id],{api_name:name,api_stype:type,api_soku:10});
    Object.assign(store.info.ships[id],{api_lv:99,api_sakuteki:[500,500],api_soku:10});
    store.const.$shipTypes[type]={api_equip_type:Object.fromEntries([1,2,3,5,10,11,12,13,14,15,33,39,45].map(t=>[t,1]))};
  }
  const result=recommendNormalFleet(store,{area:'6-4',airGoal:'ignore'});
  const row=result.recommendations.find(r=>r.routeKey==='B>D>C>F>N');assert(row);
  assert.equal(row.pathChance.probability,1);assert.equal(row.scheme.ships[0].id,1);
  assert(row.scheme.ships.some(e=>e.id===2));assert.equal(row.scores.specialAttack.bonus,0);
});
test('night Zuiun is an alternative to flare; expansion secondary guns are corrected for stable double attacks',()=>{
  const {store,scheme,inventory,add}=fixture();
  add(510,11,10,'試製 夜間瑞雲(攻撃装備)');
  store.info.ships[1].api_slot[3]=510;
  add(511,4,4,'副砲');store.info.ships[2].api_slot_ex=511;
  const next=nightLoadout(store,scheme,inventory(),{normalizeGuns:true});
  const readiness=nightReadiness(store,next);
  assert.equal(readiness.zuiun,1);assert.equal(readiness.flares,0);
  assert.equal(readiness.doubleAttackShips,6);
  assert(!next.ships.some(e=>e.slots.includes(501)));
  assert.notEqual(next.ships[1].ex,511);
  store.info.ships[1].api_onslot[3]=0;
  const unfilled=nightLoadout(store,scheme,inventory(),{normalizeGuns:true});
  assert.equal(nightReadiness(store,unfilled).zuiun,0);
  assert(!unfilled.ships.some(e=>e.slots.includes(501)),'unfilled night Zuiun still should not be mixed with flare');
});
test('5-3 route recommendations retain night gear and route-specific ammunition',()=>{
  const {store}=fixture();
  const result=recommendNormalFleet(store,{area:'5-3',airGoal:'ignore'});
  assert(result.recommendations.length>0);
  for(const row of result.recommendations){
    assert(row.scheme.ships.every(e=>store.info.ships[e.id].api_lv>=75));
    assert.equal(row.scores.nightSupport.supportTier,2);
    assert.equal(row.scores.nightSupport.doubleAttackShips,6);
    assert.equal(row.profile.routePaths[0].nodes.join(''),'DGIOKEQ');
    assert.equal(row.profile.routePaths[0].ammoAtTargetPercent,80);
    assert.equal(row.profile.routePaths[0].counts.night.maximum,2);
    const detour=require('../../src/domain/routes/sortie_profile').profileForRoute('5-3',row.route).routePaths.find(p=>p.nodes.includes('P'));
    assert.equal(detour.nodes.join(''),'DGIOPKEQ');
    assert.equal(detour.ammoAtTargetPercent,70);
    assert.equal(detour.counts.night.maximum,3);
    assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',row.scheme));
  }
  delete store.info.equips[500];delete store.info.equips[501];
  const scarce=recommendNormalFleet(store,{area:'5-3',}).recommendations[0];
  assert(scarce);assert(scarce.scores.nightSupport.warnings.length>=2);
});
