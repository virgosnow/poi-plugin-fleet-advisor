'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/workbench_fixture');
const {availableEquipment,emptyLoadout,completeCombatLoadout}=require('../../src/recommendation/loadout/loadout_policy');
const {airLoadout,gearVariant}=require('../../src/recommendation/fitting');
const {recommendNormalEquipment,recommendNormalFleet}=require('../../src/recommendation/index');
const {airPower}=require('../../src/domain/fleet/fleet_metrics');
const {estimateRouteAir}=require('../../src/domain/routes/route_air');
const {affordableSupremacy,healthySupremacy,supportedAirGoal}=require('../../src/recommendation/loadout/carrier_policy');

function carrierFixture(capacities=[20,20,44,12,3]){
  const store=fixture(),ship=store.info.ships[1];ship.api_ship_id=6001;
  store.const.$ships[6001]={...store.const.$ships[1],api_id:6001,api_name:'加賀改二',api_stype:11,
    api_slot_num:capacities.length,api_maxeq:capacities};
  Object.assign(ship,{api_slot:capacities.map(()=>-1),api_onslot:capacities.slice()});
  store.const.$shipTypes[11]={api_equip_type:{6:1,7:1,8:1,9:1,2:1,35:1}};
  for(const [id,type,name,stats] of [[9001,8,'流星改',{api_raig:13,api_tyku:1}],
    [9002,7,'艦爆',{api_baku:13,api_tyku:1}],[9003,6,'艦戦',{api_tyku:12}],
    [9004,9,'彩雲',{api_saku:9}],[9005,35,'熟練艦載機整備員',{api_houg:10}],
    [9006,2,'中口径主砲',{api_houg:8}]]){
    store.const.$equips[id]={api_id:id,api_name:name,api_type:[0,0,type,type],...stats};
  }
  for(const [id,master] of [[101,9001],[102,9001],[103,9001],[104,9001],[105,9001],
    [201,9002],[202,9002],[301,9003],[302,9003],[303,9003],[401,9004],[501,9005],[601,9006]])
    store.info.equips[id]={api_id:id,api_slotitem_id:master,api_level:0,api_alv:7};
  return store;
}
const scheme=store=>({fleet:1,ships:[{id:1,slots:store.info.ships[1].api_slot.slice(),ex:-1}]});
const type=(store,id)=>store.const.$equips[store.info.equips[id]?.api_slotitem_id]?.api_type[2];
const types=(store,entry)=>entry.slots.map(id=>type(store,id));
function complete(store,heldSlots=[]){return completeCombatLoadout(store,emptyLoadout(store,scheme(store),heldSlots),
  availableEquipment(store),{area:'2-1',heldSlots}).ships[0];}
const reference={status:'known',enemyAirPower:10,paths:[['Z']],nodes:[{id:'Z',boss:true,enemyAirPower:10}]};

function jetCarrierFixture(){
  const store=carrierFixture([34,21,12,6]);store.info.resources=[1000,1000,1000,1000];
  Object.assign(store.const.$shipTypes[11].api_equip_type,{56:1,57:1});
  for(const [id,t,bomb,aa] of [[199,57,15,6],[200,57,11,12],[548,56,0,17]]){
    store.const.$equips[id]={api_id:id,api_name:`喷气${id}`,api_type:[0,0,t,t],api_baku:bomb,api_tyku:aa};
    const iid=10000+id;store.info.equips[iid]={api_id:iid,api_slotitem_id:id,api_level:0,api_alv:7};
  }
  store.info.ships[1].api_slot=[101,201,301,401];store.info.ships[1].api_lucky=[15,50];
  return store;
}

test('jet alternatives compare both bomber roles, jet fighter CIs and conventional outfits using unique inventory instances',()=>{
  const {jetLoadouts}=require('../../src/recommendation/loadout/jet_fitting');
  const store=jetCarrierFixture(),before=JSON.stringify(store),base=scheme(store);
  const alternatives=jetLoadouts(store,base,availableEquipment(store));
  assert(alternatives.length<=12);
  for(const mid of [199,200,548])assert(alternatives.some(s=>s.ships[0].slots.some(id=>store.info.equips[id]?.api_slotitem_id===mid)));
  assert(alternatives.some(s=>types(store,s.ships[0]).includes(56)&&types(store,s.ships[0]).includes(57)));
  for(const s of alternatives){
    const all=s.ships.flatMap(e=>e.slots.concat(e.ex)).filter(id=>id>0);
    assert.equal(new Set(all).size,all.length);assert(all.every(id=>store.info.equips[id]));
    assert(s.ships[0].slots.slice(2).every(id=>type(store,id)!==57));
  }
  base.ships[0].slots[1]=10199;
  assert(jetLoadouts(store,base,availableEquipment(store)).some(s=>types(store,s.ships[0]).includes(7)));
  assert.equal(JSON.stringify(store),before);
});

test('jet alternatives preserve manual equipment and do not assume all carriers can equip jets',()=>{
  const {jetLoadouts}=require('../../src/recommendation/loadout/jet_fitting');
  const store=jetCarrierFixture(),base=scheme(store);base.ships[0].slots[0]=10199;
  const held=[{...base.ships[0],keep:{0:true,1:true,2:true,3:true}}];
  assert.deepEqual(jetLoadouts(store,base,availableEquipment(store),{heldSlots:held}),[]);
  delete store.const.$shipTypes[11].api_equip_type[56];delete store.const.$shipTypes[11].api_equip_type[57];
  store.info.ships[1].api_slot=[101,201,301,401];
  assert.deepEqual(jetLoadouts(store,scheme(store),availableEquipment(store)),[]);
});

test('jet scoring separates assault, ordinary strike, conditional shelling and per-battle steel; no jets retain the fast path',()=>{
  const {routeRank,carrierStrike}=require('../../src/recommendation/scoring');
  const {projectFleet}=require('../../src/domain/fleet/fleet_metrics');
  const store=jetCarrierFixture(),profile={area:'1-1',examples:[['A','C']],counts:{surface:{maximum:2},air:{maximum:0},asw:{maximum:0},night:{maximum:0}}};
  // Keep this numeric scoring fixture inside the recorded blue-bonus range.
  store.const.$ships[1]={...store.const.$ships[6001],api_id:1,api_ctype:0,api_aftershipid:0};store.info.ships[1].api_ship_id=1;
  for(const [old,id] of [[9001,8],[9002,7],[9003,6],[9004,9],[9005,35],[9006,2]]){
    store.const.$equips[id]={...store.const.$equips[old],api_id:id};
    for(const e of Object.values(store.info.equips))if(e.api_slotitem_id===old)e.api_slotitem_id=id;
  }
  const score=()=>{
    const s=scheme(store),ship=store.info.ships[1],master=store.const.$ships[ship.api_ship_id];
    const targets=projectFleet(store,{organization:{targets:[1]},equipment:{expected:[{shipId:1,state:s.ships[0]}]}});
    const result={chanceRange:[1,1],verdict:'guaranteed',airControl:{fleetAirPower:airPower(store,targets)}};
    const rows=[{id:1,ship,master,stype:11,level:50,fuel:80,ammo:80}];
    return {scores:routeRank(result,profile,rows,'strongest','superiority',profile.area,store,s,true),strike:carrierStrike(store,rows,s)};
  };
  assert.equal(score().scores.jetAviation,undefined);
  store.info.ships[1].api_slot[1]=10199;
  const normalSteel=score(),jet=normalSteel.scores.jetAviation;
  assert.equal(jet.status,'bounded',jet.reasons.join('；'));assert(jet.assault.min>0);assert(jet.steelPerBattle>0);
  assert(jet.ciAdjustment<0,'replacing the only normal B loses FBA; a jet is not a normal B');
  assert.equal(normalSteel.scores.carrierStrikeProxy,normalSteel.strike,'ordinary attack proxy excludes the additional assault');
  store.info.resources[2]=0;
  const empty=score();assert.deepEqual(empty.scores.jetAviation.assault,{min:0,max:0});
  assert.equal(empty.scores.jetAviation.steelPerBattle,0);assert.equal(empty.strike,normalSteel.strike);
  profile.area='1-5';profile.examples=[['A','D','E','J']];
  const noAssault=score().scores.jetAviation;assert.equal(noAssault.assault.max,0);assert.equal(noAssault.steelPerBattle,0);
  store.const.$equips[199].api_type=[0,0,58,58];profile.area='1-1';profile.examples=[['A','C']];
  const unsupported=score().scores.jetAviation;assert.equal(unsupported.status,'unknown');
  assert.equal(unsupported.assault.max,null);assert.equal(unsupported.ordinary,null,'unknown jet-attacker power is not a numeric zero');
});

test('Kaga reserves 12- and 3-plane slots for utility and keeps both attack types in larger slots',()=>{
  const store=carrierFixture(),before=JSON.stringify(store),entry=complete(store),fitted=types(store,entry);
  assert(fitted.slice(0,3).includes(7));assert(fitted.slice(0,3).includes(8));
  assert(fitted.slice(3).every(t=>![7,8].includes(t)));
  assert(fitted.slice(3).every(t=>[6,9,2,35].includes(t)));
  assert.equal(JSON.stringify(store),before);
});

test('surplus air power does not convert small fighters back into attack aircraft',()=>{
  const store=carrierFixture();store.info.ships[1].api_slot=[101,102,201,301,302];
  const fitted=airLoadout(store,scheme(store),availableEquipment(store),15,reference).ships[0];
  assert(types(store,fitted).slice(3).every(t=>![7,8].includes(t)));
});

test('air fitting repairs the reported tiny attack slot without sacrificing the air goal',()=>{
  const store=carrierFixture();store.info.ships[1].api_slot=[101,102,201,301,103];
  const fitted=airLoadout(store,scheme(store),availableEquipment(store),15,reference).ships[0];
  assert(![7,8].includes(type(store,fitted.slots[4])));
  assert(types(store,fitted).includes(8));assert(types(store,fitted).includes(7));
});

test('small carrier slots prefer legal firepower over unnecessary reconnaissance when fighters are unavailable',()=>{
  for(const expected of [35,2]){
    const store=carrierFixture([24,18,3]);
    for(const [id,item] of Object.entries(store.info.equips)){
      const t=type(store,id);
      if(t===6||expected===2&&t===35)delete store.info.equips[id];
    }
    assert.equal(type(store,complete(store).slots[2]),expected);
  }
});

test('illegal firepower gear is not forced into small carrier slots',()=>{
  const store=carrierFixture([24,18,3]);delete store.const.$shipTypes[11].api_equip_type[2];
  for(const id of [301,302,303,401,501])delete store.info.equips[id];
  assert.equal(complete(store).slots[2],-1);
});

test('zero-capacity carrier slots use legal firepower equipment rather than grounded fighters or reconnaissance',()=>{
  const store=carrierFixture([24,18,0]),entry=complete(store);
  assert.equal(type(store,entry.slots[2]),35);
});

test('manual small-slot attack aircraft and explicit gaps remain authoritative',()=>{
  const store=carrierFixture(),held=[{id:1,slots:[-1,-1,-1,-1,103],ex:-1,keep:{4:true}}];
  const entry=complete(store,held);assert.equal(entry.slots[4],103);
  const fitted=airLoadout(store,{fleet:1,ships:[entry]},availableEquipment(store),15,reference,'superiority',held);
  assert.equal(fitted.ships[0].slots[4],103);
  const gap=complete(store,[{id:1,slots:[-1,-1,-1,-1,-1],ex:-1,keep:{4:true}}]);
  assert.equal(gap.slots[4],-1);
});

test('carriers with only small slots retain an attack aircraft instead of becoming unarmed',()=>{
  const store=carrierFixture([8,8,3]),entry=complete(store);
  assert(types(store,entry).some(t=>[7,8].includes(t)));
});

test('small-slot protection is independent of slot order and does not compact large-slot attackers into a gap',()=>{
  const store=carrierFixture([3,24,18]);
  assert(![7,8].includes(type(store,complete(store).slots[0])));
  for(const id of [301,302,303,401,501,601])delete store.info.equips[id];
  assert(![7,8].includes(type(store,complete(store).slots[0])));
});

test('equipment search preserves small-slot utility after air and route variants',()=>{
  const store=carrierFixture(),before=JSON.stringify(store);
  const entry=recommendNormalEquipment(store,{scheme:scheme(store),area:'2-1'}).scheme.ships[0];
  assert(types(store,entry).slice(3).every(t=>![7,8].includes(t)));
  assert(types(store,entry).some(t=>[7,8].includes(t)));
  const ids=entry.slots.concat(entry.ex).filter(id=>id>0);assert.equal(new Set(ids).size,ids.length);
  assert.equal(JSON.stringify(store),before);
});

function twoCarrierFixture(){
  const store=carrierFixture();
  store.const.$ships[6002]={...store.const.$ships[6001],api_id:6002,api_name:'Intrepid改'};
  store.info.ships[2]={...store.info.ships[1],api_id:2,api_ship_id:6002,api_slot:[-1,-1,-1,-1,-1],api_onslot:[20,20,44,12,3]};
  for(const id of [304,305,306])store.info.equips[id]={api_id:id,api_slotitem_id:9003,api_level:0,api_alv:7};
  const initial={fleet:1,ships:[...scheme(store).ships,{id:2,slots:[-1,-1,-1,-1,-1],ex:-1}]};
  const base=completeCombatLoadout(store,initial,availableEquipment(store),{area:'2-1'});
  return {store,base};
}
function reading(store,fitted,ref){
  const air=airPower(store,fitted.ships.map(entry=>{
    const ship=store.info.ships[entry.id];return {id:entry.id,ship,master:store.const.$ships[ship.api_ship_id],
      before:{slots:ship.api_slot,ex:ship.api_slot_ex},after:entry};
  }));
  return {air,estimate:estimateRouteAir(air,ref)};
}

test('two well-equipped carriers may buy route-wide supremacy with one expendable attack slot',()=>{
  const {store,base}=twoCarrierFixture();
  const ref={...reference,enemyAirPower:100,nodes:[{id:'Z',boss:true,enemyAirPower:100}]};
  const start=reading(store,base,ref);assert(start.estimate.margins.superiority.min>=0);
  assert(start.estimate.margins.supremacy.min<0);
  const fitted=airLoadout(store,base,availableEquipment(store),150,ref);
  const result=reading(store,fitted,ref);
  assert(result.estimate.margins.supremacy.min>=0);
  assert(affordableSupremacy(store,base,fitted));
  assert(healthySupremacy(store,fitted,result.air,result.estimate));
  for(const entry of fitted.ships){assert(types(store,entry).slice(0,3).includes(7));assert(types(store,entry).slice(0,3).includes(8));}
});

test('optional supremacy rolls back when it would remove too many attack slots',()=>{
  const {store,base}=twoCarrierFixture();
  const ref={...reference,enemyAirPower:145,nodes:[{id:'Z',boss:true,enemyAirPower:145}]};
  const fitted=airLoadout(store,base,availableEquipment(store),218,ref);
  const result=reading(store,fitted,ref);
  assert(result.estimate.margins.superiority.min>=0);
  assert(result.estimate.margins.supremacy.min<0);
  assert.deepEqual(fitted,base);
});

test('losing one very large strike slot also exceeds the optional supremacy cost budget',()=>{
  const {store,base}=twoCarrierFixture(),expensive=structuredClone(base);
  assert.equal(type(store,expensive.ships[0].slots[2]),8);
  expensive.ships[0].slots[2]=305;
  assert.equal(affordableSupremacy(store,base,expensive),false);
});

test('optional supremacy requires high-performance fighters and keeps manual strike slots',()=>{
  const {store,base}=twoCarrierFixture();store.const.$equips[9003].api_tyku=9;
  const ref={...reference,enemyAirPower:75,nodes:[{id:'Z',boss:true,enemyAirPower:75}]};
  const fitted=airLoadout(store,base,availableEquipment(store),113,ref);
  assert.equal(healthySupremacy(store,fitted,reading(store,fitted,ref).air,reading(store,fitted,ref).estimate),false);
  fitted.ships.forEach((e,i)=>assert.deepEqual(e.slots.slice(0,3),base.ships[i].slots.slice(0,3)));
  store.const.$equips[9003].api_tyku=12;
  const stronger={...ref,enemyAirPower:100,nodes:[{id:'Z',boss:true,enemyAirPower:100}]};
  const held=base.ships.map(entry=>({id:entry.id,keep:{0:true,1:true,2:true}}));
  const manual=airLoadout(store,base,availableEquipment(store),150,stronger,'superiority',held);
  manual.ships.forEach((e,i)=>assert.deepEqual(e.slots.slice(0,3),base.ships[i].slots.slice(0,3)));
});

test('supremacy is assessed after sequential losses and rejected when enemy AA is unknown',()=>{
  const {store,base}=twoCarrierFixture();
  const ref={status:'known',enemyAirPower:100,paths:[['A','Z']],nodes:[
    {id:'A',enemyAirPower:100,antiAir:{status:'unknown',reason:'测试缺失防空'}},
    {id:'Z',boss:true,enemyAirPower:100}]};
  const fitted=airLoadout(store,base,availableEquipment(store),150,ref);
  assert.equal(reading(store,fitted,ref).estimate.status,'unknown');
  assert.deepEqual(fitted,base);
});

test('equipment search favors healthy supremacy when two carriers can afford it',()=>{
  const {store,base}=twoCarrierFixture();
  const recommendation=recommendNormalEquipment(store,{scheme:base,area:'2-1'}),fitted=recommendation.scheme;
  const {routeAirReference}=require('../../src/domain/routes/route_air');
  const ref=routeAirReference({},'2-1',{examples:[recommendation.selectedPath]});
  const result=reading(store,fitted,ref);
  assert(healthySupremacy(store,fitted,result.air,result.estimate));
});

test('fleet recommendation applies small-slot protection and can retain healthy supremacy',()=>{
  const {store}=twoCarrierFixture(),before=JSON.stringify(store);
  const result=recommendNormalFleet(store,{area:'2-1',byRoute:true,airGoal:'superiority',preference:'strongest',fixedShipIds:[1,2],limit:3});
  assert(result.recommendations.length>0);
  for(const row of result.recommendations)for(const id of [1,2]){
    const entry=row.scheme.ships.find(s=>s.id===id);assert(entry);
    assert(types(store,entry).slice(3).every(t=>![7,8].includes(t)));
  }
  assert(result.recommendations.some(row=>row.scores.opportunisticSupremacy));
  assert.equal(JSON.stringify(store),before);
});

function fighterBomberFixture(){
  const store=carrierFixture([24,18,3]);
  store.const.$equips[9003].api_tyku=5;
  store.const.$equips[233]={api_id:233,api_name:'F4U-1D',api_type:[0,0,7,7],api_houg:1,api_baku:7,api_tyku:7,api_saku:1};
  store.info.equips[701]={api_id:701,api_slotitem_id:233,api_level:0,api_alv:7};
  store.info.ships[1].api_slot=[101,201,301];
  return store;
}

test('F4U-1D can close an air-power gap while retaining the torpedo, bomber and pure fighter combination',()=>{
  const store=fighterBomberFixture();
  store.const.$ships[6001].api_maxeq[2]=12;store.info.ships[1].api_onslot[2]=12;
  store.const.$equips[9003].api_tyku=12;
  store.const.$equips[9001].api_tyku=0;store.const.$equips[9002].api_tyku=0;
  const before=JSON.stringify(store);
  const ref={...reference,enemyAirPower:54,nodes:[{id:'Z',boss:true,enemyAirPower:54}]};
  assert(reading(store,scheme(store),ref).estimate.margins.superiority.min<0);
  const fitted=airLoadout(store,scheme(store),availableEquipment(store),81,ref);
  assert.deepEqual(fitted.ships[0].slots,[101,701,301]);
  const result=reading(store,fitted,ref);
  assert(result.estimate.margins.superiority.min>=0);
  assert(supportedAirGoal(result.air,ref,'superiority'));
  const attrition={...ref,paths:[['A','Z']],nodes:[
    {id:'A',enemyAirPower:54,antiAir:{status:'known',proportion:0.2,fixed:6}},...ref.nodes]};
  assert.equal(supportedAirGoal(result.air,attrition,'superiority'),false,
    'a comfortable departure value is insufficient after known stage-two AA losses');
  const plane=result.air.slots.find(s=>s.itemId===701);
  assert.equal(plane.aircraftType,7);assert(plane.proficiencyBonus[0]<4,'bomber proficiency is not fighter proficiency');
  assert.equal(JSON.stringify(store),before);
});

test('fighter-bomber air support is rejected when it only just meets the target or relies on weak fighter cover',()=>{
  const store=fighterBomberFixture();
  const ref={...reference,enemyAirPower:38,nodes:[{id:'Z',boss:true,enemyAirPower:38}]};
  const fragile={fleet:1,ships:[{id:1,slots:[101,701,301],ex:-1}]};
  const result=reading(store,fragile,ref);
  assert(result.estimate.margins.superiority.min>=0,'nominal air superiority alone is insufficient');
  assert.equal(supportedAirGoal(result.air,ref,'superiority'),false);
  const fitted=airLoadout(store,scheme(store),availableEquipment(store),57,ref);
  assert(!fitted.ships[0].slots.includes(701),'later fighter swaps cannot bypass the safety buffer');
  const unknown={...ref,paths:[['A','Z']],nodes:[{id:'A',enemyAirPower:38,antiAir:{status:'unknown'}},...ref.nodes]};
  assert.equal(supportedAirGoal(result.air,unknown,'superiority'),false);
});

test('fighter-bombers are not preferred over stronger bombers when their air power is unnecessary',()=>{
  const store=fighterBomberFixture();store.const.$equips[9003].api_tyku=12;
  const fitted=airLoadout(store,scheme(store),availableEquipment(store),15,reference);
  assert.equal(fitted.ships[0].slots[1],201);
});

test('a manually held bomber cannot be exchanged for F4U-1D to repair air power',()=>{
  const store=fighterBomberFixture(),held=[{id:1,keep:{1:true}}];
  const ref={...reference,enemyAirPower:38,nodes:[{id:'Z',boss:true,enemyAirPower:38}]};
  const fitted=airLoadout(store,scheme(store),availableEquipment(store),57,ref,'superiority',held);
  assert.equal(fitted.ships[0].slots[1],201);
});

test('F4U-1D is bomber B in carrier cut-ins and a live ground bomber, never pure fighter F',()=>{
  const store=fighterBomberFixture(),entry={id:1,slots:[101,701,301],ex:-1};
  const {fleetMechanisms}=require('../../src/domain/combat/ship_mechanisms');
  const cutin=()=>fleetMechanisms(store,[entry]).get(1).find(b=>b.key==='carrier-ci');
  assert.equal(cutin().label,'战爆联合·FBA');
  entry.slots[2]=-1;assert.equal(cutin().label,'战爆联合·BA');
  const {carrierGroundState}=require('../../src/domain/combat/installation_attack');
  assert.equal(carrierGroundState([{master:store.const.$equips[233],planes:18}]),'ready');
  assert.equal(carrierGroundState([{master:store.const.$equips[233],planes:0}]),'blocked');
});

test('ground fitting can replace a conventional bomber with F4U-1D to unlock attacks against land targets',()=>{
  const store=fighterBomberFixture(),before=JSON.stringify(store);
  const {groundLoadouts}=require('../../src/recommendation/loadout/ground_fitting');
  const profile={examples:[['Z']],mapPreview:{nodes:[{id:'Z',kind:'battle',enemies:[{name:'港湾棲姫'}]}]},
    counts:{surface:{maximum:1},asw:{maximum:0}}};
  const variants=groundLoadouts(store,scheme(store),availableEquipment(store),{profile});
  assert(variants.some(s=>s.ships[0].slots[1]===701));
  const held=groundLoadouts(store,scheme(store),availableEquipment(store),{profile,heldSlots:[{id:1,keep:{1:true}}]});
  assert(held.every(s=>s.ships[0].slots[1]===201));
  assert.equal(JSON.stringify(store),before);
});

function fiveTwoLoSFixture(los=400){
  const {store}=twoCarrierFixture();
  for(const [id,name,caps] of [[1,'翔鶴改二甲',[34,21,12,9]],[2,'瑞鶴改二甲',[34,24,12,6]]]){
    const s=store.info.ships[id],m=store.const.$ships[s.api_ship_id];
    Object.assign(m,{api_name:name,api_slot_num:4,api_maxeq:caps});
    Object.assign(s,{api_slot:[-1,-1,-1,-1],api_onslot:caps,api_sakuteki:[los,los]});
  }
  for(const id of [3,4,5,6]){
    store.const.$ships[id].api_stype=id<5?5:2;
    store.info.ships[id].api_sakuteki=[los,los];
  }
  for(const id of [402,403,404])store.info.equips[id]={...store.info.equips[401],api_id:id};
  const initial={fleet:1,ships:[1,2,3,4,5,6].map(id=>({id,slots:store.info.ships[id].api_slot.slice(),ex:-1}))};
  const base=completeCombatLoadout(store,initial,availableEquipment(store),{area:'5-2'});
  return {store,base,profile:require('../../src/domain/routes/sortie_profile').previewForMap('5-2',
    {paths:[['B','C','D','F','O']]})};
}

test('LoS fitting leaves attackers alone on maps without a LoS gate and on already-qualified 5-2 fleets',()=>{
  const {store,base,profile}=fiveTwoLoSFixture(),before=JSON.stringify(store);
  assert.equal(gearVariant(store,base,availableEquipment(store),'los',profile,'5-2'),null);
  const noGate=require('../../src/domain/routes/sortie_profile').previewForMap('2-1');
  assert.equal(gearVariant(store,base,availableEquipment(store),'los',noGate,'2-1'),null);
  assert.equal(gearVariant(store,base,availableEquipment(store),'los',profile,'5-2',undefined,
    {allowCombatLoss:true,stopWhen:()=>false}),null,'a non-LoS failure must not keep raising LoS');
  assert.equal(JSON.stringify(store),before);
});

test('5-2 equipment and full-fleet recommendations retain large-slot BA once LoS is sufficient',()=>{
  const {store,base}=fiveTwoLoSFixture(),before=JSON.stringify(store);
  const args={area:'5-2',routeKey:'B>C>D>F>O'};
  const equipment=recommendNormalEquipment(store,{...args,scheme:base});
  const full=recommendNormalFleet(store,{...args,byRoute:true,airGoal:'superiority',fixedShipIds:[1,2,3,4,5,6]});
  assert(full.recommendations.length>0);
  for(const fitted of [equipment.scheme,...full.recommendations.map(r=>r.scheme)]){
    for(const entry of fitted.ships.slice(0,2)){
      assert(types(store,entry).slice(0,2).includes(7));
      assert(types(store,entry).slice(0,2).includes(8));
      assert(types(store,entry).slice(2).every(t=>![7,8].includes(t)));
    }
    const ids=fitted.ships.flatMap(e=>e.slots.concat(e.ex)).filter(id=>id>0);
    assert.equal(new Set(ids).size,ids.length);
    assert.equal(require('../../src/domain/routes/route_plans').planningPath(
      require('../../src/domain/routes/normal_routes').evaluateNormalRoute(store,{...args,scheme:fitted}),
      ['B','C','D','F','O']).chance.probability,1);
  }
  assert(full.recommendations.every(r=>r.scores.airGoalTier===3));
  assert.equal(JSON.stringify(store),before);
});

test('LoS fitting stops after repairing the actual node coefficient and preserves manual slots',()=>{
  const {store,base,profile}=fiveTwoLoSFixture(300),before=JSON.stringify(store);
  const fitted=gearVariant(store,base,availableEquipment(store),'los',profile,'5-2',undefined,
    {heldSlots:[{id:1,keep:{0:true}}]});
  assert(fitted);assert.equal(fitted.ships[0].slots[0],base.ships[0].slots[0]);
  const originalIds=new Set(base.ships.flatMap(e=>e.slots));
  const additions=fitted.ships.flatMap(e=>e.slots).filter(id=>id>0&&!originalIds.has(id));
  assert.equal(additions.length,1,'one reconnaissance aircraft closes this fixture LoS gap');
  const recon=fitted.ships.find(e=>e.slots.some(id=>type(store,id)===9));
  const slot=recon.slots.findIndex(id=>type(store,id)===9);
  assert.equal(store.info.ships[recon.id].api_onslot[slot],Math.min(...store.info.ships[recon.id].api_onslot));
  const route=require('../../src/domain/routes/normal_routes').evaluateNormalRoute(store,{area:'5-2',scheme:fitted});
  const planning=require('../../src/domain/routes/route_plans').planningPath(route,['B','C','D','F','O']);
  assert.equal(planning.losShortfall,0);assert.equal(planning.chance.probability,1);
  assert.equal(gearVariant(store,fitted,availableEquipment(store),'los',profile,'5-2'),null);
  assert.equal(JSON.stringify(store),before);
});

test('a real LoS shortfall uses compatible auxiliary slots before sacrificing carrier attackers',()=>{
  const {store,base,profile}=fiveTwoLoSFixture(300);
  store.const.$shipTypes[5]={api_equip_type:{12:1}};
  store.const.$equips[9011]={api_id:9011,api_name:'索敌电探',api_type:[0,0,12,12],api_saku:20};
  store.info.equips[801]={api_id:801,api_slotitem_id:9011,api_level:0};
  const fitted=gearVariant(store,base,availableEquipment(store),'los',profile,'5-2');
  assert(fitted);assert.deepEqual(fitted.ships.slice(0,2),base.ships.slice(0,2));
  assert(fitted.ships.slice(2).some(e=>e.slots.includes(801)));
  assert.equal(gearVariant(store,fitted,availableEquipment(store),'los',profile,'5-2'),null);
});

test('automatic carrier utility does not duplicate reconnaissance across hulls but keeps manual copies',()=>{
  const {store}=twoCarrierFixture();
  for(const [id,item] of Object.entries(store.info.equips))if(type(store,id)===6)delete store.info.equips[id];
  store.info.equips[402]={...store.info.equips[401],api_id:402};
  const initial={fleet:1,ships:[1,2].map(id=>({id,slots:[-1,-1,-1,-1,-1],ex:-1}))};
  const fitted=completeCombatLoadout(store,initial,availableEquipment(store),{area:'2-1'});
  assert.equal(fitted.ships.flatMap(e=>types(store,e)).filter(t=>t===9).length,0);
  const held=initial.ships.map((e,i)=>({...e,slots:[-1,-1,-1,-1,401+i],keep:{4:true}}));
  const manual=completeCombatLoadout(store,emptyLoadout(store,initial,held),availableEquipment(store),{area:'2-1',heldSlots:held});
  assert.equal(manual.ships[0].slots[4],401);assert.equal(manual.ships[1].slots[4],402);
});

test('unmodeled jets stay explicit while separate conventional alternatives retain BA and manual jets',()=>{
  const store=carrierFixture([34,21,12,9]);
  store.const.$equips[9010]={api_id:9010,api_name:'喷气舰爆',api_type:[0,0,57,57],api_baku:15,api_tyku:6};
  store.const.$shipTypes[11].api_equip_type[57]=1;
  store.info.equips[710]={api_id:710,api_slotitem_id:9010,api_level:0,api_alv:7};
  store.info.ships[1].api_slot=[101,710,301,302];
  const before=JSON.stringify(store);
  assert.equal(reading(store,scheme(store),reference).estimate.status,'unknown');
  const fitted=airLoadout(store,scheme(store),availableEquipment(store),15,reference);
  assert.equal(type(store,fitted.ships[0].slots[1]),57);
  const alternatives=require('../../src/recommendation/loadout/jet_fitting').jetLoadouts(store,scheme(store),availableEquipment(store));
  assert(alternatives.some(s=>types(store,s.ships[0]).includes(7)&&types(store,s.ships[0]).includes(8)));
  const held=airLoadout(store,scheme(store),availableEquipment(store),15,reference,'superiority',[{id:1,keep:{1:true}}]);
  assert.equal(held?.ships[0].slots[1]??710,710);
  assert.equal(JSON.stringify(store),before);
});

test('surplus small-slot fighter cover can become legal fixed firepower while retaining FBA and route air control',()=>{
  const store=carrierFixture([34,21,12,9]);store.info.ships[1].api_slot=[101,201,301,302];
  const fitted=airLoadout(store,scheme(store),availableEquipment(store),15,reference);
  assert(fitted.ships[0].slots.includes(501));
  assert(types(store,fitted.ships[0]).includes(6));
  assert.deepEqual(types(store,fitted.ships[0]).slice(0,2),[8,7]);
  assert(reading(store,fitted,reference).estimate.margins.superiority.min>=0);
  const held=airLoadout(store,scheme(store),availableEquipment(store),15,reference,'superiority',[{id:1,keep:{2:true,3:true}}]);
  assert.deepEqual(held.ships[0].slots.slice(2),[301,302]);
});

test('air fitting orders newly chosen firepower utility after the fighter in equal small slots',()=>{
  const store=carrierFixture([24,18,2,2]);store.info.ships[1].api_slot=[101,201,301,302];
  const emptyAir={...reference,enemyAirPower:0,nodes:[{id:'Z',boss:true,enemyAirPower:0}]};
  const fitted=airLoadout(store,scheme(store),availableEquipment(store),1,emptyAir);
  assert.deepEqual(types(store,fitted.ships[0]),[8,7,6,35]);
});

test('one escort carrier near supremacy may spend a utility slot while retaining both large attack slots',()=>{
  const store=carrierFixture([14,19,2,2]);store.info.ships[1].api_slot=[201,101,501,301];
  const ref={...reference,enemyAirPower:20,nodes:[{id:'Z',boss:true,enemyAirPower:20}]};
  const initial=scheme(store),before=JSON.stringify([store,initial]);
  const start=reading(store,initial,ref);assert(start.estimate.margins.superiority.min>=0);
  assert(start.estimate.margins.supremacy.min<0);
  const fitted=airLoadout(store,initial,availableEquipment(store),30,ref),result=reading(store,fitted,ref);
  assert(result.estimate.margins.supremacy.min>=0);
  assert.deepEqual(fitted.ships[0].slots.slice(0,2),initial.ships[0].slots.slice(0,2));
  assert(healthySupremacy(store,fitted,result.air,result.estimate));
  assert(affordableSupremacy(store,initial,fitted));
  assert.equal(JSON.stringify([store,initial]),before);
  const held=airLoadout(store,initial,availableEquipment(store),30,ref,'superiority',[{id:1,keep:{2:true}}]);
  assert.equal(held.ships[0].slots[2],501);
  assert.deepEqual(held.ships[0].slots.slice(0,2),initial.ships[0].slots.slice(0,2));
  assert(reading(store,held,ref).estimate.margins.supremacy.min<0);
});

test('a lone carrier never sacrifices an attack slot for optional supremacy or claims an unknown result',()=>{
  const store=carrierFixture([34,21,18,9]);store.info.ships[1].api_slot=[101,201,102,301];
  const initial=scheme(store),ref={...reference,enemyAirPower:42,nodes:[{id:'Z',boss:true,enemyAirPower:42}]};
  const fitted=airLoadout(store,initial,availableEquipment(store),63,ref);
  assert.equal(types(store,fitted.ships[0]).filter(t=>[7,8].includes(t)).length,3);
  assert(reading(store,fitted,ref).estimate.margins.supremacy.min<0);
  const unknown={...ref,paths:[['A','Z']],nodes:[
    {id:'A',enemyAirPower:20,antiAir:{status:'unknown',reason:'缺失防空'}},...ref.nodes]};
  const uncertain=airLoadout(store,initial,availableEquipment(store),63,unknown);
  assert.equal(reading(store,uncertain,unknown).estimate.status,'unknown');
  assert.equal(types(store,uncertain.ships[0]).filter(t=>[7,8].includes(t)).length,3);
});

test('LoS repair fits at most one automatic Saiun across the fleet even when a second would raise LoS',()=>{
  const {store,base,profile}=fiveTwoLoSFixture(200);
  const fitted=gearVariant(store,base,availableEquipment(store),'los',profile,'5-2',undefined,{allowCombatLoss:true});
  assert(fitted);
  assert.equal(fitted.ships.flatMap(e=>e.slots).filter(id=>type(store,id)===9).length,1);
  const recon=fitted.ships.find(e=>e.slots.some(id=>type(store,id)===9));
  const slot=recon.slots.findIndex(id=>type(store,id)===9);
  assert.equal(store.info.ships[recon.id].api_onslot[slot],Math.min(...store.info.ships[recon.id].api_onslot));
  const route=require('../../src/domain/routes/normal_routes').evaluateNormalRoute(store,{area:'5-2',scheme:fitted});
  assert(require('../../src/domain/routes/route_plans').planningPath(route,['B','C','D','F','O']).losShortfall>0,
    'an unresolved shortage must not be presented as passing');
});
