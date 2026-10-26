'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {recommendNormalFleet,recommendExpeditionFleet}=require('../../src/recommendation/index');
const {Controller}=require('../../src/application/controller');
const {FleetAdvisorService}=require('../../src/application/fleet_advisor_service');
const {evaluateExpedition}=require('../../src/domain/expeditions/expeditions');
const {profileForRoute,consumption}=require('../../src/domain/routes/sortie_profile');
const fs=require('fs'),os=require('os'),path=require('path');

function fixture(){
  const ships={},masters={},equips={};
  const types=[3,2,2,2,2,2,1,2];
  for(let i=0;i<types.length;i++){
    const id=i+1,cost=i===6?7:10+i;
    masters[id]={api_id:id,api_name:`测试舰${id}`,api_stype:types[i],api_slot_num:2,api_ctype:0,api_aftershipid:'0',
      api_maxeq:[0,0],api_soku:10,api_fuel_max:cost,api_bull_max:cost};
    ships[id]={api_id:id,api_ship_id:id,api_lv:50,api_cond:49,api_fuel:cost,api_bull:cost,
      api_slot:[-1,-1],api_slot_ex:0,api_onslot:[0,0],api_soku:10,
      api_sakuteki:[20,40],api_taisen:[20,40],api_taiku:[20,40],api_karyoku:[20,40],
      api_raisou:[20,40],api_soukou:[20,40]};
  }
  return {info:{basic:{api_level:120},ships,equips,repairs:[],airbase:[],
    fleets:[1,2,3,4].map(()=>({api_ship:[-1,-1,-1,-1,-1,-1],api_mission:[0,0]}))},
  const:{$ships:masters,$equips:{},$missions:{1:{api_use_fuel:0.3,api_use_bull:0}},
    $shipTypes:{},$equipShip:{},$exslotEquips:[],$exslotEquipShips:{},$exslotEquipLimits:{}}};
}
function armSurfaceDestroyers(store){
  store.const.$equips[500]={api_id:500,api_name:'测试小口径主炮',
    api_type:[0,0,1,1],api_houg:5};
  store.const.$shipTypes[2]={api_equip_type:{1:1}};
  for(const [id,ship] of Object.entries(store.info.ships)){
    if(Number(store.const.$ships[ship.api_ship_id]?.api_stype)!==2)continue;
    const first=1000+Number(id)*2;
    for(const itemId of [first,first+1])store.info.equips[itemId]={
      api_id:itemId,api_slotitem_id:500,api_level:0};
    ship.api_slot=[first,first+1];
  }
}

function mixedAswFixture(){
  const store=fixture(),types=[3,2,2,2,5,5,1,2];
  for(const [index,stype] of types.entries()){
    const id=index+1;Object.assign(store.const.$ships[id],{api_stype:stype,api_slot_num:3,api_maxeq:[0,0,0]});
    Object.assign(store.info.ships[id],{api_slot:[-1,-1,-1],api_onslot:[0,0,0],api_taisen:[90,90]});
    store.const.$shipTypes[stype]={api_equip_type:{1:1,12:1,14:1,15:1}};
  }
  for(const [id,type,stats] of [[500,1,{api_houg:5}],[580,14,{api_tais:12}],
    [581,15,{api_tais:15}],[582,12,{api_houg:1,api_houm:3,api_saku:2}]]){
    store.const.$equips[id]={api_id:id,api_name:'测试装备'+id,api_type:[0,0,type,type],...stats};
    for(let n=0;n<24;n++){const instance=id*100+n;store.info.equips[instance]={api_id:instance,api_slotitem_id:id,api_level:0};}
  }
  return store;
}

test('4-2 reserves two-gun surface builds and limits automatic ASW to escorts',()=>{
  const store=mixedAswFixture(),before=JSON.stringify(store);
  const result=recommendNormalFleet(store,{area:'4-2',byRoute:true,airGoal:'ignore',fixedShipIds:[1,2,3,4,5,6]});
  const row=result.recommendations.find(row=>row.routeKey==='A>C>L');assert(row);
  const types=entry=>entry.slots.map(id=>store.const.$equips[store.info.equips[id]?.api_slotitem_id]?.api_type[2]);
  assert(row.profile.counts.asw.maximum>0,'the random B branch still needs an escort');
  assert(row.scheme.ships.filter(entry=>types(entry).some(type=>[14,15,40,44].includes(type))).length<=2);
  for(const entry of row.scheme.ships)assert(types(entry).filter(type=>type===1).length>=2);
  assert.equal(row.scores.openingAswCount,2);
  new Controller({getStore:()=>store}).preview('fleet',row.scheme);
  assert.equal(JSON.stringify(store),before);
});

test('selected submarine-free 4-2 lane removes off-route ASW gear but preserves manual slots',()=>{
  const store=mixedAswFixture();store.const.$ships[1].api_stype=5;
  const args={area:'4-2',byRoute:true,airGoal:'ignore',fixedShipIds:[1,2,3,4,5,6]};
  const result=recommendNormalFleet(store,args),row=result.recommendations.find(row=>row.routeKey==='A>E>G>L');assert(row);
  assert.equal(row.profile.counts.asw.maximum,0);assert.equal(row.scores.aswStrengthProxy,0);
  assert(row.scheme.ships.every(entry=>entry.slots.every(id=>![14,15,40,44].includes(store.const.$equips[store.info.equips[id]?.api_slotitem_id]?.api_type[2]))));
  const adjusted=require('../../src/recommendation/index').recommendNormalEquipment(store,{scheme:row.scheme,area:'4-2',routeKey:'A>E>G>L'});
  assert.deepEqual(adjusted.scheme.ships.map(entry=>entry.id),row.scheme.ships.map(entry=>entry.id));
  assert(adjusted.scheme.ships.every(entry=>entry.slots.every(id=>![14,15,40,44].includes(store.const.$equips[store.info.equips[id]?.api_slotitem_id]?.api_type[2]))));
  const heldSlots=[2,3,4].map((id,n)=>({id,slots:[58000+n,-1,-1],keep:{0:true}}));
  const held=recommendNormalFleet(store,{...args,heldSlots}).recommendations.find(row=>row.routeKey==='A>E>G>L');assert(held);
  for(const entry of heldSlots)assert.equal(held.scheme.ships.find(ship=>ship.id===entry.id).slots[0],entry.slots[0]);
});

test('submarine objectives retain full-fleet ASW kits instead of a two-escort limit',()=>{
  const store=mixedAswFixture();
  const row=recommendNormalFleet(store,{area:'1-5',preference:'strongest',fixedShipIds:[2,3,4,7],airGoal:'ignore'}).recommendations[0];assert(row);
  assert.equal(row.scores.openingAswCount,4);
  for(const entry of row.scheme.ships)assert(entry.slots.every(id=>[14,15,40,44].includes(store.const.$equips[store.info.equips[id]?.api_slotitem_id]?.api_type[2])));
});

test('7-4 mixed boss outfits effective escorts while preserving surface weapons on the other ships',()=>{
  const store=mixedAswFixture();
  for(const id of [5,6])store.const.$ships[id].api_stype=2;
  for(const ship of Object.values(store.info.ships))ship.api_sakuteki=[100,100];
  store.info.basic.api_level=40;
  const before=JSON.stringify(store),scheme={fleet:1,ships:[1,2,3,4,5,6].map(id=>({id,slots:[-1,-1,-1],ex:0}))};
  const row=require('../../src/recommendation/index').recommendNormalEquipment(store,{scheme,area:'7-4',routeKey:'A>B>E>J>L>P'});
  const types=entry=>entry.slots.map(id=>store.const.$equips[store.info.equips[id]?.api_slotitem_id]?.api_type[2]);
  const opening=row.scheme.ships.filter(entry=>{
    const ship=store.info.ships[entry.id];
    return require('../../src/domain/combat/opening_asw').openingASW(store,{id:entry.id,ship,master:store.const.$ships[ship.api_ship_id],
      before:{slots:ship.api_slot,ex:ship.api_slot_ex},after:entry}).eligible===true;
  });
  assert.equal(opening.length,3);
  assert.equal(row.scheme.ships.filter(entry=>types(entry).some(type=>[14,15,40,44].includes(type))).length,3);
  assert(row.scheme.ships.filter(entry=>types(entry).filter(type=>type===1).length===2).length>=3);
  const profile=require('../../src/domain/routes/sortie_profile').previewForMap('7-4',{paths:[['A','B','E','J','L','P']]});
  const {assessAsw}=require('../../src/domain/combat/asw_combat');
  const stripped={...row.scheme,ships:row.scheme.ships.map(entry=>({...entry,slots:entry.slots.map(id=>[14,15,40].includes(store.const.$equips[store.info.equips[id]?.api_slotitem_id]?.api_type[2])?-1:id)}))};
  assert(assessAsw(store,row.scheme,profile,{limit:3}).readiness>assessAsw(store,stripped,profile,{limit:3}).readiness);
  assert.deepEqual(row.scheme.ships.map(entry=>entry.id),scheme.ships.map(entry=>entry.id));
  new Controller({getStore:()=>store}).preview('fleet',row.scheme);
  assert.equal(JSON.stringify(store),before);
});

test('a submarine-free night lane retains stronger destroyers instead of following other lanes ASW priorities',()=>{
  const store=mixedAswFixture();store.info.basic.api_level=1;
  for(const sm of Object.values(store.const.$ships))sm.api_stype=2;
  for(const ship of Object.values(store.info.ships))ship.api_sakuteki=[140,140];
  store.const.$ships[1].api_name='Jervis改';
  for(const id of [9,10]){
    store.const.$ships[id]={...store.const.$ships[2],api_id:id,api_name:'强力驱逐'+id};
    store.info.ships[id]={...store.info.ships[2],api_id:id,api_ship_id:id,api_lv:40,
      api_taisen:[30,30],api_karyoku:[90,90],api_raisou:[100,100]};
  }
  const row=recommendNormalFleet(store,{area:'5-5',byRoute:true,airGoal:'ignore'}).recommendations.find(row=>row.routeKey==='A>C>E>G>I>M>O>S');
  assert(row);
  for(const id of [9,10])assert(row.scheme.ships.some(entry=>entry.id===id),'keep the strong hull and try its route-specific gear');
  assert.equal(row.profile.counts.asw.maximum,0);
  assert.equal(row.pathChance.probability,1);
  new Controller({getStore:()=>store}).preview('fleet',row.scheme);
});

test('combat route search values a lower-level cruiser and preserves explicit weak hulls and equipment',()=>{
  const store=fixture();armSurfaceDestroyers(store);
  store.info.ships[1].api_lv=99;
  store.const.$ships[9]={...store.const.$ships[1],api_id:9,api_name:'战斗轻巡',api_fuel_max:30,api_bull_max:35};
  store.info.ships[9]={...store.info.ships[1],api_id:9,api_ship_id:9,api_lv:65,api_fuel:30,api_bull:35,
    api_karyoku:[80,80],api_raisou:[90,90],api_soukou:[70,70],api_slot:[-1,-1]};
  store.const.$shipTypes[3]={api_equip_type:{1:1}};
  for(const id of [3000,3001])store.info.equips[id]={api_id:id,api_slotitem_id:500,api_level:0};
  const before=JSON.stringify(store),args={area:'1-2',byRoute:true,airGoal:'ignore'};
  const result=recommendNormalFleet(store,args),best=result.recommendations[0];assert(best);
  assert(best.scheme.ships.some(e=>e.id===9));assert.equal(best.pathChance.probability,1);
  assert(result.search.combatRefinement.tried<=40);
  const held=recommendNormalFleet(store,{...args,fixedShipIds:[1],heldSlots:[{id:1,pin:true,slots:[3000,-1],keep:{0:true}}]});
  assert.equal(held.recommendations[0].scheme.ships[0].id,1);
  assert.equal(held.recommendations[0].scheme.ships[0].slots[0],3000);
  const excluded=recommendNormalFleet(store,{...args,excludedShipIds:[9]});
  assert(excluded.recommendations.every(r=>!r.scheme.ships.some(e=>e.id===9)));
  for(const r of result.recommendations)new Controller({getStore:()=>store}).preview('fleet',r.scheme);
  assert.equal(JSON.stringify(store),before);
});

function yubariCargoFixture(){
  const store=fixture(),ship=store.info.ships[1];
  store.const.$ships[623]={...store.const.$ships[1],api_id:623,api_name:'夕張改二特',api_slot_num:5,api_maxeq:[0,0,0,0,0]};
  Object.assign(ship,{api_ship_id:623,api_slot:[101,102,103,104,-1],api_slot_ex:-1,api_onslot:[0,0,0,0,0]});
  store.const.$shipTypes[3]={api_equip_type:{1:1,12:1,21:1,22:1,24:1}};
  store.const.$exslotEquips=[21];
  const inventory=[];
  for(const [id,t,name,power] of [[101,22,'甲標的 甲型',0],[102,24,'大発動艇',0],[103,24,'大発動艇',0],[104,24,'大発動艇',0],
    [105,1,'主炮 A',5],[106,1,'主炮 B',5],[107,12,'小型电探 A',1],[108,12,'小型电探 B',1],[109,21,'机枪',1]]){
    store.const.$equips[id]={api_id:id,api_name:name,api_type:[0,0,t,t],api_houg:power,api_houm:power};
    store.info.equips[id]={api_id:id,api_slotitem_id:id,api_level:0};
    inventory.push({id,master:store.const.$equips[id],sourceShipId:id<=104?1:null});
  }
  return {store,inventory};
}

test('1-1 completes Yubari cargo slots with legal combat equipment and explains every slot',()=>{
  const {emptyLoadout,completeCombatLoadout,explainLoadout}=require('../../src/recommendation/loadout/loadout_policy');
  const {canEquip}=require('../../src/domain/fleet/equipment_rules');
  const {store,inventory}=yubariCargoFixture(),before=JSON.stringify(store);
  const result=completeCombatLoadout(store,emptyLoadout(store,{fleet:1,ships:[{id:1}]}),inventory,{area:'1-1'}),ship=result.ships[0];
  assert.equal(ship.slots[0],101);assert.equal(ship.slots.filter(id=>[105,106].includes(id)).length,2);
  assert(ship.slots.slice(3).every(id=>[107,108].includes(id)));assert.equal(ship.ex,109);
  assert.equal(new Set(ship.slots.concat(ship.ex)).size,6);
  ship.slots.forEach((id,k)=>assert(canEquip(store,1,id,k)));
  assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',result));
  const reason=explainLoadout(store,ship,{area:'1-1'});
  assert.equal(reason.rows.length,6);assert(reason.rows.every(r=>r.reason&&!r.warning));
  assert(reason.role.includes('开幕雷击'));assert(reason.rows[1].reason.includes('夜战连击'));
  const old=explainLoadout(store,{id:1,slots:[101,102,103,104,-1],ex:-1},{area:'1-1'});
  assert(old.rows.slice(1,4).every(r=>r.warning));assert(old.rows[4].reason.includes('第五槽仅允许'));
  assert.equal(JSON.stringify(store),before);
});

test('1-1 cleanup preserves manual cargo and empty slots and does not invent unavailable equipment',()=>{
  const {emptyLoadout,completeCombatLoadout,explainLoadout}=require('../../src/recommendation/loadout/loadout_policy');
  const {store,inventory}=yubariCargoFixture();
  const held={id:1,slots:[101,102,103,104,-1],ex:-1,keep:{1:true,4:true,ex:true}};
  const result=completeCombatLoadout(store,emptyLoadout(store,{fleet:1,ships:[held]},[held]),inventory,{area:'1-1',heldSlots:[held]}).ships[0];
  assert.equal(result.slots[1],102);assert.equal(result.slots[4],-1);assert.equal(result.ex,-1);
  const reasons=explainLoadout(store,{...result,keep:held.keep},{area:'1-1'}).rows;
  assert(reasons[1].reason.startsWith('手动保留'));assert(reasons[4].reason.includes('手动指定留空'));
  const empty=completeCombatLoadout(store,emptyLoadout(store,{fleet:1,ships:[{id:1}]}),[],{area:'1-1'}).ships[0];
  assert.deepEqual(empty.slots,[-1,-1,-1,-1,-1]);
  assert(explainLoadout(store,empty,{area:'1-1'}).rows[1].reason.includes('未配置'));
});

test('normal equipment is built from empty slots regardless of currently installed cargo or weapons',()=>{
  const {store}=yubariCargoFixture(),{recommendNormalEquipment}=require('../../src/recommendation/index');
  const args={area:'2-1',scheme:{fleet:1,ships:[{id:1,slots:[101,102,103,104,-1],ex:-1}]}};
  const before=JSON.stringify(store),first=recommendNormalEquipment(store,args).scheme;
  assert(first.ships[0].slots.every(id=>id>0));assert(!first.ships[0].slots.some(id=>[102,103,104].includes(id)));
  assert.equal(JSON.stringify(store),before,'search never empties actual game equipment');
  store.info.ships[1].api_slot=[105,106,107,108,-1];store.info.ships[1].api_slot_ex=109;
  const second=recommendNormalEquipment(store,{...args,scheme:{fleet:1,ships:[{id:1,slots:[105,106,107,108,-1],ex:109}]}}).scheme;
  assert.deepEqual(second,first,'current ship equipment changes neither seed nor final selection');
  assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',second));
});

test('limited slot gets the only small radar before a flexible slot and busy inventory is excluded',()=>{
  const {store}=yubariCargoFixture(),{emptyLoadout,completeCombatLoadout,availableEquipment}=require('../../src/recommendation/loadout/loadout_policy');
  store.const.$shipTypes[3].api_equip_type[13]=1;
  store.const.$equips[108].api_type=[0,0,13,13];store.const.$equips[108].api_houg=0;store.const.$equips[108].api_houm=1;
  store.info.ships[2].api_slot=[109,-1];store.info.fleets[1].api_ship=[2,-1,-1,-1,-1,-1];store.info.fleets[1].api_mission=[1,1];
  const inventory=availableEquipment(store);assert(!inventory.some(i=>i.id===109));
  const result=completeCombatLoadout(store,emptyLoadout(store,{fleet:1,ships:[{id:1}]}),inventory,{area:'2-1'});
  assert.equal(result.ships[0].slots[3],108);assert.equal(result.ships[0].slots[4],107);
  assert.equal(result.ships[0].ex,-1,'cannot borrow the only expansion item from an expedition');
  assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',result));
});

test('ranked loadouts that fail the final pure plan preview are never returned',()=>{
  const {FleetPlanner}=require('../../src/domain/fleet/fleet_plan');
  const store=fixture(),original=FleetPlanner.prototype.preview;let calls=0;
  FleetPlanner.prototype.preview=function(){calls++;throw new Error('final preview refused');};
  try{
    const result=recommendNormalFleet(store,{area:'1-1',byRoute:true,fixedShipIds:[2],excludedShipIds:[1,3,4,5,6,7,8]});
    assert(calls>0);assert.equal(result.recommendations.length,0);
    assert(result.routeResults.every(r=>r.recommendationIndex===null));
  }finally{FleetPlanner.prototype.preview=original;}
});
function armCapitalShips(store,ids){
  store.const.$equips[502]={api_id:502,api_name:'测试大口径主炮',
    api_type:[0,0,3,3],api_houg:15};
  store.const.$shipTypes[8]={api_equip_type:{3:1}};
  for(const id of ids){
    const first=2000+id*2;
    for(const itemId of [first,first+1])store.info.equips[itemId]={
      api_id:itemId,api_slotitem_id:502,api_level:0};
    store.info.ships[id].api_slot=[first,first+1];
  }
}
function airMapFixture(){
  const store=fixture();armSurfaceDestroyers(store);
  store.const.$ships[6].api_stype=16;
  store.const.$ships[8].api_stype=5;
  store.info.ships[6].api_slot=[-1,-1];
  store.const.$shipTypes[16]={api_equip_type:{}};
  store.const.$shipTypes[5]={api_equip_type:{}};
  return store;
}

test('normal recommendation respects fixed and excluded instances and remains previewable',()=>{
  const store=fixture();
  const result=recommendNormalFleet(store,{area:'1-1',fleet:1,preference:'lowestConsumption',
    fixedShipIds:[2],excludedShipIds:[7],limit:3});
  assert(result.recommendations.length>0);
  assert.equal(result.search.globalOptimal,false);
  for(const row of result.recommendations){
    const ids=row.scheme.ships.map(s=>s.id);
    assert(ids.includes(2));assert(!ids.includes(7));
    assert(row.route.chanceRange[1]>0);
    assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',row.scheme));
  }
  assert.throws(()=>recommendNormalFleet(store,{area:'1-1',fixedShipIds:[2],excludedShipIds:[2]}),/重叠/);
  assert.throws(()=>recommendNormalFleet(store,{area:'1-6'}),/目标点位/);
});

test('1-1 favors modest opening torpedo and carrier strike fleets over a battleship',()=>{
  const store=fixture();
  store.const.$ships[1].api_stype=8;
  store.const.$ships[1].api_fuel_max=100;
  store.const.$ships[1].api_bull_max=100;
  store.info.ships[1].api_karyoku=[120,120];
  store.info.ships[1].api_soukou=[100,100];
  store.const.$ships[2].api_stype=4;
  store.info.ships[2].api_raisou=[115,115];
  store.const.$ships[3].api_stype=7;
  store.const.$ships[3].api_maxeq=[18,12];
  store.info.ships[3].api_onslot=[18,12];
  for(const id of [4,5]){
    store.const.$ships[id].api_stype=13;
    store.const.$ships[id].api_fuel_max=8;
    store.const.$ships[id].api_bull_max=8;
    store.info.ships[id].api_lv=80;
    store.info.ships[id].api_raisou=[125,125];
  }
  store.const.$equips[522]={api_id:522,api_name:'甲標的 甲型',
    api_type:[2,4,22,5],api_raig:12};
  store.const.$equips[523]={api_id:523,api_name:'試製艦攻',
    api_type:[0,0,8,8],api_raig:10};
  store.const.$shipTypes[4]={api_equip_type:{22:1}};
  store.const.$shipTypes[7]={api_equip_type:{8:1}};
  store.info.equips[1522]={api_id:1522,api_slotitem_id:522,api_level:0};
  store.info.equips[1523]={api_id:1523,api_slotitem_id:523,api_level:0};
  store.info.ships[2].api_slot=[1522,-1];
  store.info.ships[3].api_slot=[1523,-1];
  const result=recommendNormalFleet(store,{area:'1-1'});
  assert.deepEqual(new Set(result.recommendations.flatMap(row=>row.preferences)),
    new Set(['shortest','strongest','lowestConsumption']));
  for(const row of result.recommendations){
    assert(row.scheme.ships.length<=2);
    assert(!row.scheme.ships.some(ship=>ship.id===1),JSON.stringify(row.scheme));
    assert(row.scores.openingTorpedoCount>0||row.scores.carrierStrikeProxy>0,
      JSON.stringify(row.scores));
    assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',row.scheme));
  }
  assert.equal(result.recommendations.find(row=>row.preference==='shortest').route.chanceRange[0],0.8);
  for(const mode of ['strongest','lowestConsumption']){
    const row=result.recommendations.find(item=>item.preferences.includes(mode));
    assert(row.scheme.ships.some(ship=>![4,5].includes(ship.id)),
      'a submarine-only fleet should not outrank surface openers against ASW enemies');
  }
});

test('opening torpedo strength on other maps requires actual equipment',()=>{
  const store=fixture();armSurfaceDestroyers(store);
  store.const.$ships[2].api_stype=4;
  store.const.$shipTypes[4]={api_equip_type:{22:1}};
  store.info.ships[2].api_raisou=[110,110];
  store.const.$equips[522]={api_id:522,api_name:'甲標的 甲型',
    api_type:[2,4,22,5],api_raig:12};
  store.info.equips[1522]={api_id:1522,api_slotitem_id:522,api_level:0};
  const args={area:'1-4',preference:'strongest',fixedShipIds:[2,3,4,5],
    excludedShipIds:[1,6,7,8]};
  const bare=recommendNormalFleet(store,args).recommendations[0];
  assert(bare);
  assert.equal(bare.scores.openingTorpedoCount,1);
  assert(bare.scheme.ships.find(s=>s.id===2).slots.includes(1522),'available opening gear is allocated even when originally unequipped');
  store.info.ships[2].api_slot=[1522,-1];
  store.info.ships[2].api_raisou=[122,122];
  const armed=recommendNormalFleet(store,args).recommendations[0];
  assert(armed);
  assert.equal(armed.scores.openingTorpedoCount,1);
  assert.deepEqual(armed.scheme,bare.scheme,'current equipment does not seed the proposed loadout');
});

test('1-1 can outfit a fixed torpedo cruiser and light carrier for opening attacks',()=>{
  const store=fixture();
  store.const.$ships[2].api_stype=4;
  store.const.$ships[3].api_stype=7;
  store.const.$ships[3].api_maxeq=[18,12];
  store.info.ships[3].api_onslot=[18,12];
  store.const.$shipTypes[4]={api_equip_type:{22:1}};
  store.const.$shipTypes[7]={api_equip_type:{8:1}};
  store.const.$equips[522]={api_id:522,api_name:'甲標的 甲型',
    api_type:[2,4,22,5],api_raig:12};
  store.const.$equips[523]={api_id:523,api_name:'試製艦攻',
    api_type:[0,0,8,8],api_raig:10};
  store.info.equips[1522]={api_id:1522,api_slotitem_id:522,api_level:0};
  store.info.equips[1523]={api_id:1523,api_slotitem_id:523,api_level:0};
  assert.equal(require('../../src/domain/fleet/equipment_rules').canEquip(store,2,1522,0),true);
  assert.equal(require('../../src/domain/fleet/equipment_rules').canEquip(store,3,1523,0),true);
  const result=recommendNormalFleet(store,{area:'1-1',preference:'strongest',
    fixedShipIds:[2,3]});
  const row=result.recommendations[0];
  assert(row,JSON.stringify(result.guideWarnings));
  assert(row.scheme.ships.find(ship=>ship.id===2).slots?.includes(1522),JSON.stringify({row,search:result.search}));
  assert(row.scheme.ships.find(ship=>ship.id===3).slots?.includes(1523));
  assert.equal(row.scores.openingTorpedoCount,1);
  assert(row.scores.carrierStrikeProxy>0);
  assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',row.scheme));
});

test('1-1 combines a light cruiser opening torpedo with an equipped seaplane bomber',()=>{
  const store=fixture();
  store.const.$ships[2].api_stype=3;
  store.const.$ships[2].api_maxeq=[0,2];
  store.info.ships[2].api_onslot=[0,2];
  store.info.ships[2].api_raisou=[100,100];
  store.const.$shipTypes[2]={api_equip_type:{}};
  store.const.$shipTypes[3]={api_equip_type:{11:1,22:1}};
  store.const.$equips[522]={api_id:522,api_name:'甲標的 甲型',
    api_type:[2,4,22,5],api_raig:12};
  store.const.$equips[524]={api_id:524,api_name:'瑞雲12型',
    api_type:[5,43,11,10],api_baku:7};
  store.info.equips[1522]={api_id:1522,api_slotitem_id:522,api_level:0};
  store.info.ships[2].api_slot=[1522,-1];
  const args={area:'1-1',preference:'shortest',fixedShipIds:[2],
    excludedShipIds:[1,3,4,5,6,7,8]};
  const bare=recommendNormalFleet(store,args).recommendations[0];
  assert(bare);
  assert.equal(bare.scores.openingTorpedoCount,1);
  assert.equal(bare.scores.seaplaneStrikeProxy,0);
  store.info.equips[1524]={api_id:1524,api_slotitem_id:524,api_level:0};
  assert.equal(require('../../src/domain/fleet/equipment_rules').canEquip(store,2,1524,1),true);
  const equipped=recommendNormalFleet(store,args).recommendations[0];
  assert(equipped,JSON.stringify(args));
  assert(equipped.scheme.ships[0].slots?.includes(1524));
  assert.equal(equipped.scores.openingTorpedoCount,1);
  assert(equipped.scores.seaplaneStrikeProxy>0);
  assert(equipped.scores.strengthProxy>bare.scores.strengthProxy);
  assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',equipped.scheme));
  store.info.ships[2].api_onslot=[0,0];
  const empty=recommendNormalFleet(store,args).recommendations[0];
  assert.equal(empty.scores.seaplaneStrikeProxy,0,
    'a zero-plane slot cannot be counted as an opening air attack');
});

test('1-1 replaces smoke with a seaplane bomber on a fixed opening-torpedo aviation cruiser',()=>{
  const store=fixture();
  store.const.$ships[2].api_stype=6;
  store.const.$ships[2].api_slot_num=4;
  store.const.$ships[2].api_maxeq=[2,2,7,3];
  store.info.ships[2].api_slot=[1522,1525,1526,1527];
  store.info.ships[2].api_onslot=[2,2,7,3];
  store.info.ships[2].api_raisou=[100,100];
  store.const.$shipTypes[6]={api_equip_type:{2:1,11:1,22:1,54:1}};
  const gear=[
    [522,'甲標的 甲型',22,0],
    [524,'瑞雲12型',11,7],
    [525,'中口径主砲',2,0],
    [527,'発煙装置(煙幕)',54,0]
  ];
  for(const [id,name,type,baku] of gear)
    store.const.$equips[id]={api_id:id,api_name:name,api_type:[0,0,type,type],api_baku:baku};
  for(const [id,masterId] of [[1522,522],[1524,524],[1525,525],[1526,525],[1527,527]])
    store.info.equips[id]={api_id:id,api_slotitem_id:masterId,api_level:0};
  const row=recommendNormalFleet(store,{area:'1-1',preference:'shortest',fixedShipIds:[2],
    excludedShipIds:[1,3,4,5,6,7,8]}).recommendations[0];
  assert(row);
  assert.deepEqual(row.scheme.ships[0].slots,[1525,1526,1522,1524],'sort guns before the opening torpedo but retain the aircraft slot');
  assert.equal(row.scores.openingTorpedoCount,1);
  assert(row.scores.seaplaneStrikeProxy>0);
  assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',row.scheme));
});

test('1-1 replaces an unneeded boiler with a bomber on a fixed opening-torpedo seaplane tender',()=>{
  const store=fixture();
  store.const.$ships[2].api_stype=16;
  store.const.$ships[2].api_slot_num=4;
  store.const.$ships[2].api_maxeq=[2,3,6,2];
  store.info.ships[2].api_slot=[1522,1525,1527,1528];
  store.info.ships[2].api_onslot=[2,3,6,2];
  store.info.ships[2].api_raisou=[100,100];
  store.const.$shipTypes[16]={api_equip_type:{2:1,11:1,17:1,18:1,22:1}};
  const gear=[
    [522,'甲標的 甲型',22,0],
    [524,'瑞雲12型',11,7],
    [525,'中口径主砲',2,0],
    [527,'新型高温高圧缶',17,0],
    [528,'三式弾',18,0]
  ];
  for(const [id,name,type,baku] of gear)
    store.const.$equips[id]={api_id:id,api_name:name,api_type:[0,0,type,type],api_baku:baku};
  for(const [id,masterId] of [[1522,522],[1524,524],[1525,525],[1527,527],[1528,528]])
    store.info.equips[id]={api_id:id,api_slotitem_id:masterId,api_level:0};
  const row=recommendNormalFleet(store,{area:'1-1',preference:'shortest',fixedShipIds:[2],
    excludedShipIds:[1,3,4,5,6,7,8]}).recommendations[0];
  assert(row);
  assert.deepEqual(row.scheme.ships[0].slots,[1524,1525,1522,-1],'retain the aircraft slot and sort the remaining weapons');
  assert.equal(row.scores.openingTorpedoCount,1);
  assert(row.scores.seaplaneStrikeProxy>0);
  assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',row.scheme));
});

test('1-1 accepts one-gun Ise-class remodels and counts their opening aircraft',()=>{
  const store=fixture();
  for(const id of [2,3]){
    store.const.$ships[id].api_stype=10;
    store.const.$ships[id].api_slot_num=5;
    store.const.$ships[id].api_maxeq=[2,2,22,22,9];
    store.info.ships[id].api_onslot=[2,2,22,22,9];
    store.info.ships[id].api_karyoku=[100,100];
  }
  store.const.$shipTypes[10]={api_equip_type:{3:1,7:1,11:1}};
  for(const [id,name,type,baku] of [
    [502,'試製41cm三連装砲',3,0],
    [523,'彗星二二型(六三四空)',7,11],
    [524,'瑞雲12型',11,7]
  ])store.const.$equips[id]={api_id:id,api_name:name,
    api_type:[0,0,type,type],api_baku:baku};
  for(const [id,masterId] of [[2002,502],[2003,502],[2523,523],[2524,524]])
    store.info.equips[id]={api_id:id,api_slotitem_id:masterId,api_level:0};
  store.info.ships[2].api_slot=[2002,-1,-1,-1,-1];
  store.info.ships[3].api_slot=[2003,2524,-1,-1,-1];
  assert.equal(require('../../src/domain/fleet/equipment_rules').canEquip(store,2,2523,2),true);
  for(const [id,kind] of [[2,'aviationBattleshipStrikeProxy'],[3,'seaplaneStrikeProxy']]){
    const result=recommendNormalFleet(store,{area:'1-1',preference:'shortest',
      fixedShipIds:[id],excludedShipIds:[1,4,5,6,7,8]});
    const row=result.recommendations[0];
    assert(row,`one-gun aviation battleship ${id} should remain eligible`);
    assert.equal(row.route.probability,0.8);
    assert(row.scores.openingAirStrikeProxy>0,JSON.stringify({id,kind,score:row.scores[kind],
      scheme:row.scheme,openingAirStrike:row.scores.openingAirStrikeProxy,
      search:result.search}));
    assert(row.scores.openingAirStrikeProxy>0);
    assert.equal(row.scores.carrierStrikeProxy,0);
    assert.equal(row.scores.dayShellingRounds,2);
    assert(row.scores.oneOneSecondRoundProxy>0);
    if(id===2)assert(row.scheme.ships[0].slots?.includes(2523));
    assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',row.scheme));
  }
});

test('expedition recommendation finds low-cost eligible fleet and respects exclusions',()=>{
  const store=fixture();
  const result=recommendExpeditionFleet(store,{missionId:1,fleet:2,fixedShipIds:[1],excludedShipIds:[7]});
  assert(result.recommendations.length>0,JSON.stringify(result));
  const row=result.recommendations[0],ids=row.scheme.ships.map(s=>s.id);
  assert(ids.includes(1));assert(!ids.includes(7));
  assert.equal(row.evaluation.eligible,true);
  assert.equal(row.cost.source,'missionMaster');
  assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',row.scheme));
  const virtual={...store,info:{...store.info,fleets:store.info.fleets.map((f,i)=>i===1?
    {...f,api_ship:ids}:f)}};
  assert.equal(evaluateExpedition(virtual,2,1).eligible,true);
});

test('expedition skips duplicate copies and remodels of the same ship',()=>{
  const store=fixture();
  store.info.ships[3].api_ship_id=2; // A second owned copy of master ship 2.
  store.const.$ships[2].api_yomi='おなじふね';
  store.const.$ships[4].api_yomi='おなじふね'; // Different remodel, same ship reading.
  const result=recommendExpeditionFleet(store,{missionId:1,fleet:2,
    fixedShipIds:[2],excludedShipIds:[1],limit:5});
  assert(result.recommendations.length>0);
  for(const row of result.recommendations){
    const ids=row.scheme.ships.map(ship=>ship.id);
    assert(ids.includes(2));
    assert(!ids.includes(3),'another copy of the fixed ship must not be selected');
    assert(!ids.includes(4),'another remodel of the fixed ship must not be selected');
    assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',row.scheme));
  }
  assert.throws(()=>recommendExpeditionFleet(store,{missionId:1,fleet:2,fixedShipIds:[2,3]}),
    /同一舰娘/);
  assert.throws(()=>recommendExpeditionFleet(store,{missionId:1,fleet:2,fixedShipIds:[2,4]}),
    /同一舰娘/);
});

test('normal-map recommendations also avoid two copies of the same ship',()=>{
  const store=fixture();store.info.ships[3].api_ship_id=2;
  const result=recommendNormalFleet(store,{area:'1-1',fixedShipIds:[2]});
  assert(result.recommendations.length>0);
  for(const row of result.recommendations)
    assert(!row.scheme.ships.some(ship=>ship.id===3));
});

test('busy destination and unavailable fixed ship fail closed',()=>{
  const store=fixture();store.info.fleets[1].api_mission=[1,1];
  assert.throws(()=>recommendExpeditionFleet(store,{missionId:1,fleet:2}),/远征/);
  store.info.fleets[1].api_mission=[0,0];store.info.ships[2].api_situation=2;
  assert.throws(()=>recommendNormalFleet(store,{area:'1-1',fixedShipIds:[2]}),/不能编入/);
  assert.throws(()=>recommendExpeditionFleet(store,{missionId:1,fleet:1}),/第 2–4 舰队/);
});

test('expedition recommendation assigns owned free drums to empty eligible slots',()=>{
  const store=fixture();
  store.const.$equips[75]={api_id:75,api_name:'ドラム缶',api_type:[0,0,25,30]};
  store.const.$shipTypes[2]={api_equip_type:{25:1}};
  store.const.$shipTypes[3]={api_equip_type:{25:1}};
  for(let id=101;id<=104;id++)store.info.equips[id]={api_id:id,api_slotitem_id:75,api_level:0};
  const result=recommendExpeditionFleet(store,{missionId:37,fleet:2,excludedShipIds:[7]});
  assert(result.recommendations.length>0,JSON.stringify(result.search));
  const row=result.recommendations[0];
  assert.equal(row.evaluation.eligible,true);
  assert(row.scheme.ships.some(ship=>ship.slots?.some(id=>id>=101)));
  assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',row.scheme));
  assert.equal(store.info.ships[1].api_slot[0],-1,'recommendation does not change snapshot');
});

test('expedition equipment keeps hull order and manual gear, and refits drums for each goal',()=>{
  const store=fixture(),fit=require('../../src/recommendation/index').recommendExpeditionEquipment;
  store.const.$equips[75]={api_id:75,api_name:'ドラム缶',api_type:[0,0,25,30]};
  store.const.$equips[500]={api_id:500,api_name:'主炮',api_type:[0,0,1,1]};
  for(const type of [2,3])store.const.$shipTypes[type]={api_equip_type:{25:1,1:1}};
  for(let id=101;id<=110;id++)store.info.equips[id]={api_id:id,api_slotitem_id:75};
  for(let id=301;id<=312;id++)store.info.equips[id]={api_id:id,api_slotitem_id:500};
  const ids=[1,6,5,4,3,2],scheme={fleet:2,ships:ids.map((id,i)=>({id,slots:[301+i*2,302+i*2],ex:-1}))};
  const heldSlots=[{id:2,slots:[311,312],ex:-1,keep:{0:true}}],before=JSON.stringify({store,scheme,heldSlots});
  const success=fit(store,{scheme,missionId:37,goal:'success',heldSlots});
  assert.deepEqual(success.scheme.ships.map(s=>s.id),ids);assert(success.evaluation.eligible);
  assert.equal(success.evaluation.greatSuccess.drums,5);assert(success.evaluation.greatSuccess.drumCarriers>=3);
  assert.equal(success.scheme.ships.at(-1).slots[0],311);
  const great=fit(store,{scheme:success.scheme,missionId:37,goal:'great',heldSlots});
  assert.equal(great.evaluation.greatSuccess.drums,5);
  const again=fit(store,{scheme:great.scheme,missionId:37,goal:'success',heldSlots});
  assert.equal(again.evaluation.greatSuccess.drums,5,'success mode keeps useful spare-slot drums without requiring sparkle');
  const equipped=great.scheme.ships.flatMap(s=>s.slots.concat(s.ex)).filter(id=>id>0);
  assert.equal(new Set(equipped).size,equipped.length);assert.deepEqual(great.scheme.ships.map(s=>s.id),ids);
  assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',great.scheme));
  assert.equal(JSON.stringify({store,scheme,heldSlots}),before);
});

test('expedition equipment excludes busy drums and reports shortages without replacing manual slots',()=>{
  const store=fixture(),fit=require('../../src/recommendation/index').recommendExpeditionEquipment;
  store.const.$equips[75]={api_id:75,api_name:'ドラム缶',api_type:[0,0,25,30]};
  for(const type of [2,3])store.const.$shipTypes[type]={api_equip_type:{25:1}};
  for(let id=101;id<=105;id++)store.info.equips[id]={api_id:id,api_slotitem_id:75};
  store.info.ships[8].api_slot=[101,102];store.info.fleets[2].api_ship=[8];store.info.fleets[2].api_mission=[1,1];
  const scheme={fleet:2,ships:[1,2,3,4,5,6].map(id=>({id,slots:[-1,-1],ex:-1}))};
  const result=fit(store,{scheme,missionId:37,goal:'great'});
  assert(!result.evaluation.eligible);assert(result.warnings.some(s=>s.includes('运输桶不足')));
  assert(result.scheme.ships.flatMap(s=>s.slots).every(id=>![101,102].includes(id)));
  const locked=fit(store,{scheme,missionId:37,heldSlots:scheme.ships.map(s=>({...s,keep:{0:true,1:true}}))});
  assert(locked.scheme.ships.every(s=>s.slots.every(id=>id===-1)));
  assert(locked.warnings.some(s=>s.includes('载桶舰娘不足')));
});

function incomeEquipmentFixture(){
  const store=fixture();
  for(const type of [1,2,3])store.const.$shipTypes[type]={api_equip_type:{25:1,24:1,1:1}};
  for(const [id,name,type] of [[75,'运输桶',25],[68,'大发',24],[193,'特大发',24],[166,'陆战大发',24],[500,'主炮',1]])
    store.const.$equips[id]={api_id:id,api_name:name,api_type:[0,0,type,type]};
  store.const.$missions[5]={api_use_fuel:.5,api_use_bull:0};
  store.const.$missions[37]={api_use_fuel:.8,api_use_bull:.8};
  return store;
}
test('B4 returns an explicitly ineligible closest fleet and exact deficits without breaking manual constraints',()=>{
  const store=fixture(),types=[3,5,5,2,2,14];
  for(const [i,type]of types.entries()){
    const id=i+1;store.const.$ships[id].api_stype=type;store.info.ships[id].api_lv=60;
  }
  delete store.info.ships[7];delete store.info.ships[8];
  const args={missionId:113,fleet:2,goal:'great',fixedShipIds:[2],heldSlots:[null,{id:2,pin:true,slots:[-1,-1],ex:-1,keep:{0:true}}]},before=JSON.stringify(store);
  const result=recommendExpeditionFleet(store,args),row=result.closestRecommendation;
  assert.deepEqual(result.recommendations,[]);assert(row);assert.equal(row.status,'closest');assert.equal(row.departureReady,false);
  assert.equal(row.evaluation.eligible,false);assert.equal(row.scheme.ships.length,6);assert.equal(row.scheme.ships[1].id,2);
  assert.equal(row.scheme.ships[1].slots[0],-1);assert.equal(row.evaluation.checks.find(c=>c.type==='fleetCompo').sat,true);
  for(const gap of row.shortfalls.filter(g=>g.missing!==undefined))assert.equal(gap.missing,gap.required-gap.actual);
  assert.equal(row.shortfalls.find(g=>g.type==='totalFirepower').missing,380);
  assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',row.scheme));
  assert.equal(JSON.stringify(store),before);
  for(const ship of Object.values(store.info.ships))for(const key of ['api_karyoku','api_taiku','api_taisen','api_sakuteki'])ship[key]=[100,100];
  const ready=recommendExpeditionFleet(store,args);assert(ready.recommendations.length);assert.equal(ready.closestRecommendation,undefined);
  assert(ready.recommendations.every(r=>r.evaluation.eligible));
});

test('closest expedition fallback may expose missing ship types but never restores filtered ships',()=>{
  const store=fixture(),before=JSON.stringify(store);
  const result=recommendExpeditionFleet(store,{missionId:113,fleet:2,automaticFilters:{minLevel:0}});
  assert(result.closestRecommendation);assert.equal(result.recommendations.length,0);
  assert(result.closestRecommendation.shortfalls.some(g=>g.type==='fleetCompo'));
  const none=recommendExpeditionFleet(store,{missionId:113,fleet:2,automaticFilters:{minLevel:999}});
  assert.equal(none.closestRecommendation,undefined);assert.equal(none.recommendations.length,0);
  assert.equal(JSON.stringify(store),before);
  const lowFlagship=fixture();lowFlagship.const.$ships[1].api_stype=20;lowFlagship.info.ships[1].api_lv=10;
  const low=recommendExpeditionFleet(lowFlagship,{missionId:132,fleet:2});
  assert(low.closestRecommendation);assert.equal(low.closestRecommendation.scheme.ships[0].id,1,'prefer the required flagship type even when its level is too low');
  assert.equal(low.closestRecommendation.evaluation.checks.find(c=>c.type==='flagshipType').sat,true);
});
const expeditionFit=(store,ships,missionId=5,extra={})=>require('../../src/recommendation/index').recommendExpeditionEquipment(store,{
  missionId,scheme:{fleet:2,ships:ships.map(id=>({id,slots:store.info.ships[id].api_slot.slice(),ex:-1}))},...extra});
const addExpeditionItem=(store,id,master,level=0)=>{store.info.equips[id]={api_id:id,api_slotitem_id:master,api_level:level};};

test('expedition fits reward gear after mandatory and great-success drums without wasting the only cargo carrier',()=>{
  const store=incomeEquipmentFixture();
  delete store.const.$shipTypes[2].api_equip_type[24];
  for(let id=101;id<=110;id++)addExpeditionItem(store,id,75);
  for(let id=201;id<=204;id++)addExpeditionItem(store,id,68);
  const before=JSON.stringify(store),fit=expeditionFit(store,[1,2,3,4,5,6],37,{goal:'great'});
  assert(fit.evaluation.eligible);assert.equal(fit.evaluation.greatSuccess.drums,5);
  assert(fit.evaluation.greatSuccess.drumCarriers>=3);
  assert(fit.scheme.ships[0].slots.every(id=>store.info.equips[id]?.api_slotitem_id===68));
  assert.equal(fit.income.bonus,.1);assert.equal(fit.warnings.length,0);
  assert.deepEqual(fit.income,require('../../src/ui/workbench/workbench_model').income(store,fit.scheme.ships,37));
  assert.equal(JSON.stringify(store),before);
});

test('success dispatch prefers unsparkled hulls and still respects fixed or uniquely required ships',()=>{
  const store=incomeEquipmentFixture();
  store.info.ships[1].api_cond=60;store.info.ships[2].api_cond=60;
  store.const.$ships[9]={...store.const.$ships[1],api_id:9,api_name:'无闪轻巡',api_fuel_max:30,api_bull_max:30};
  store.info.ships[9]={...store.info.ships[1],api_id:9,api_ship_id:9,api_cond:49,api_fuel:30,api_bull:30,api_slot:[-1,-1]};
  for(let id=101;id<=105;id++)addExpeditionItem(store,id,75);
  const before=JSON.stringify(store),args={missionId:37,fleet:2,goal:'success',limit:1};
  const best=recommendExpeditionFleet(store,args).recommendations[0];
  assert(best.evaluation.eligible);assert.equal(best.evaluation.greatSuccess.sparkledCount,0);
  assert(best.scheme.ships.some(s=>s.id===9));assert.equal(best.evaluation.greatSuccess.drums,5);
  const fixed=recommendExpeditionFleet(store,{...args,fixedFlagshipId:1}).recommendations[0];
  assert.equal(fixed.scheme.ships[0].id,1);assert.equal(fixed.evaluation.greatSuccess.sparkledCount,1);
  const fallback=recommendExpeditionFleet(store,{...args,excludedShipIds:[9]}).recommendations[0];
  assert(fallback.evaluation.eligible);assert.equal(fallback.evaluation.greatSuccess.sparkledCount,1);
  assert.equal(JSON.stringify(store),before);
});

test('success equipment adds only useful complete drum tiers and preserves income gear',()=>{
  const store=incomeEquipmentFixture(),ids=[1,2,3,4,5,6];
  store.const.$missions[24]={api_use_fuel:.5,api_use_bull:0};
  for(let id=101;id<=105;id++)addExpeditionItem(store,id,75);
  const before=JSON.stringify(store),full=expeditionFit(store,ids,37,{goal:'success'});
  assert(full.evaluation.eligible);assert.equal(full.evaluation.greatSuccess.sparkledCount,0);
  assert.equal(full.evaluation.greatSuccess.drums,5);assert.equal(full.evaluation.greatSuccess.estimatedPercent,40);
  assert.equal(new Set(full.scheme.ships.flatMap(s=>s.slots).filter(id=>id>0)).size,5);
  assert.equal(JSON.stringify(store),before);
  delete store.info.equips[105];
  const scarce=expeditionFit(store,ids,37,{goal:'success'});
  assert(scarce.evaluation.eligible);assert.equal(scarce.evaluation.greatSuccess.drums,4);
  for(const id of [102,103,104])delete store.info.equips[id];
  const partial=expeditionFit(store,ids,24,{goal:'success'});
  assert(partial.evaluation.eligible);assert.equal(partial.evaluation.greatSuccess.drums,0);
  assert.equal(partial.evaluation.greatSuccess.estimatedPercent,5,'one drum cannot reach the useful two-drum tier');
  assert.equal(expeditionFit(store,ids,5,{goal:'success'}).evaluation.greatSuccess.drums,0,'ordinary missions do not benefit from drums');
  for(let id=201;id<=204;id++)addExpeditionItem(store,id,68);
  const heldSlots=ids.slice(2).map((id,i)=>{
    addExpeditionItem(store,301+i*2,500);addExpeditionItem(store,302+i*2,500);
    return {id,slots:[301+i*2,302+i*2],ex:-1,keep:{0:true,1:true}};
  });
  addExpeditionItem(store,102,75);
  const crowded=expeditionFit(store,ids,24,{goal:'success',heldSlots});
  assert(crowded.evaluation.eligible);assert.equal(crowded.income.bonus,.2);
  assert.equal(crowded.evaluation.greatSuccess.drums,0,'optional drums must not displace cargo or manual equipment');
});

test('expedition prefers improved cargo and stops at the cap rather than diluting the average',()=>{
  const store=incomeEquipmentFixture();
  for(let id=201;id<=204;id++)addExpeditionItem(store,id,68,10);
  for(let id=205;id<=212;id++)addExpeditionItem(store,id,68,0);
  const fit=expeditionFit(store,[1,2,3,4,5,6]);
  assert(Math.abs(fit.income.bonus-.22)<1e-10);
  assert.deepEqual(fit.scheme.ships.flatMap(s=>s.slots).filter(id=>id>0).sort(),[201,202,203,204]);
  const refit=expeditionFit(store,[1,2,3,4,5,6],5,{scheme:fit.scheme});
  assert.deepEqual(refit.scheme,fit.scheme,'repeat fitting is stable');
});

test('expedition includes Kinu innate bonus and preserves manually chosen low-star cargo',()=>{
  const store=incomeEquipmentFixture();
  store.const.$ships[487]={...store.const.$ships[1],api_id:487};store.info.ships[1].api_ship_id=487;
  for(let id=201;id<=206;id++)addExpeditionItem(store,id,68,10);
  const fit=expeditionFit(store,[1,2,3,4]);
  assert(Math.abs(fit.income.bonus-.22)<1e-10);
  assert.equal(fit.scheme.ships.flatMap(s=>s.slots).filter(id=>id>0).length,3);
  addExpeditionItem(store,301,166,0);
  const manual=expeditionFit(store,[1,2,3,4],5,{heldSlots:[{id:1,slots:[301,-1],ex:-1,keep:{0:true}}]});
  assert.equal(manual.scheme.ships[0].slots[0],301);
  assert(manual.income.bonus>.2,'remaining slots still improve the manual setup');
});

test('expedition reaches the ordinary cap with four Daihatsu instead of chasing special-craft synergy',()=>{
  const store=incomeEquipmentFixture();
  for(let id=201;id<=204;id++)addExpeditionItem(store,id,193);
  for(let id=205;id<=208;id++)addExpeditionItem(store,id,68);
  const fit=expeditionFit(store,[1,2,3,4,5,6]);
  assert.equal(fit.income.bonus,.2);
  assert.deepEqual(fit.scheme.ships.flatMap(s=>s.slots).filter(id=>id>0).sort(),[205,206,207,208]);
  const calc=require('../../src/domain/expeditions/expedition_income');
  assert.equal(calc.equipmentRewardRate(525),.04);assert.equal(calc.equipmentRewardRate(526),.05);assert.equal(calc.equipmentRewardRate(576),.03);
  assert.equal(calc.equipmentRewardRate(230),0,'tank craft without reward bonus must not be used');
  const b=calc.rewardBonus([{masterId:1,equipment:[{masterId:526,stars:0},{masterId:193,stars:0},{masterId:193,stars:0},{masterId:193,stars:0}]}]);
  assert.equal(b.synergyRate,.05,'new 5% vehicles do not count as normal Daihatsu in special synergy');
});

test('expedition reserves combat landing craft and other fleets improved gear when ordinary Daihatsu suffice',()=>{
  const store=incomeEquipmentFixture();
  for(let id=101;id<=104;id++)addExpeditionItem(store,id,166,10);
  for(let id=201;id<=204;id++)addExpeditionItem(store,id,68);
  for(let id=301;id<=302;id++)addExpeditionItem(store,id,68,10);
  store.info.ships[8].api_slot=[301,302];store.info.fleets[2].api_ship=[8];store.info.fleets[2].api_mission=[0,0];
  const before=JSON.stringify(store),fit=expeditionFit(store,[1,2,3,4,5,6]);
  assert.equal(fit.income.bonus,.2);
  assert.deepEqual(fit.scheme.ships.flatMap(s=>s.slots).filter(id=>id>0).sort(),[201,202,203,204]);
  assert.equal(JSON.stringify(store),before);
});

test('expedition stops once three special Daihatsu reach the target and keeps manual extras',()=>{
  const store=incomeEquipmentFixture();
  for(let id=201;id<=206;id++)addExpeditionItem(store,id,193,10);
  let fit=expeditionFit(store,[1,2,3,4,5,6]);
  assert.equal(fit.scheme.ships.flatMap(s=>s.slots).filter(id=>id>0).length,3);
  assert(fit.income.bonus>.2,'actual extra yield is still displayed');
  const heldSlots=[{id:1,slots:[201,202],ex:-1,keep:{0:true,1:true}},
    {id:2,slots:[203,204],ex:-1,keep:{0:true,1:true}},{id:3,slots:[205,206],ex:-1,keep:{0:true,1:true}}];
  fit=expeditionFit(store,[1,2,3,4,5,6],5,{heldSlots});
  assert.deepEqual(fit.scheme.ships.slice(0,3).map(s=>s.slots),heldSlots.map(s=>s.slots));
  assert.equal(fit.scheme.ships.flatMap(s=>s.slots).filter(id=>id>0).length,6);
  const loadout=require('../../src/domain/expeditions/expedition_loadout');
  for(const chance of [0,.5,1]){
    // Mission 5 rewards 200 fuel + 200 ammo + 20 steel + 20 bauxite.
    const expected=528+264*chance-fit.income.cost.fuelCost-fit.income.cost.ammoCost;
    assert.equal(loadout.planningNet(fit.income,5,chance),expected,'extra yield cannot win a fleet tie by itself');
    assert(fit.income.rows.reduce((n,r)=>n+r.net+(r.greatNet-r.net)*chance,0)>=expected);
  }
});

test('expedition leaves scarce combat craft unused even when ordinary Daihatsu cannot reach twenty percent',()=>{
  const store=incomeEquipmentFixture();addExpeditionItem(store,201,68);
  for(let id=101;id<=108;id++)addExpeditionItem(store,id,166,10);
  const fit=expeditionFit(store,[1,2,3,4,5,6]);
  assert.deepEqual(fit.scheme.ships.flatMap(s=>s.slots).filter(id=>id>0),[201]);
  assert.equal(fit.income.bonus,.05);
  const manual=expeditionFit(store,[1,2,3,4,5,6],5,{heldSlots:[{id:1,slots:[101,-1],keep:{0:true}}]});
  assert.equal(manual.scheme.ships[0].slots[0],101);assert(manual.income.bonus>.07);
  assert.equal(manual.scheme.ships.flatMap(s=>s.slots).filter(id=>id>0).length,2);
});

test('expedition cargo fitting respects manual slots, scarce compatibility and busy inventory',()=>{
  const store=incomeEquipmentFixture();
  for(let id=201;id<=208;id++)addExpeditionItem(store,id,68,10);
  store.info.ships[8].api_slot=[201,202];store.info.fleets[2].api_ship=[8];store.info.fleets[2].api_mission=[1,1];
  store.info.ships[7].api_slot=[203,204];store.info.repairs=[{api_ship_id:7}];
  addExpeditionItem(store,301,500);store.info.ships[1].api_slot=[301,-1];
  const heldSlots=[{id:1,slots:[301,-1],ex:-1,keep:{0:true,1:true}}];
  const fit=expeditionFit(store,[1,2,3,4],5,{heldSlots}),items=fit.scheme.ships.flatMap(s=>s.slots).filter(id=>id>0);
  assert.deepEqual(fit.scheme.ships[0].slots,[301,-1]);
  assert(!items.some(id=>[201,202,203,204].includes(id)));assert.equal(items.length,new Set(items).size);
  assert(Math.abs(fit.income.bonus-.22)<1e-10);
  assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',fit.scheme));
});

test('expedition frees surplus monthly stat equipment while retaining eligibility and reward slots',()=>{
  const store=incomeEquipmentFixture();store.const.$missions[101]={api_use_fuel:.5,api_use_bull:.5};
  store.const.$equips[500].api_tais=20;
  for(const id of [2,3,4,5]){
    addExpeditionItem(store,300+id,500);store.info.ships[id].api_slot=[300+id,-1];store.info.ships[id].api_taisen=[60,60];
  }
  for(let id=201;id<=208;id++)addExpeditionItem(store,id,68);
  const fit=expeditionFit(store,[2,3,4,5],101);
  assert(fit.evaluation.eligible);assert.equal(fit.income.bonus,.2);
  assert.equal(fit.scheme.ships.flatMap(s=>s.slots).filter(id=>id>=302&&id<=305).length,1);
  assert(fit.evaluation.checks.find(c=>c.type==='totalAsw').left>=180);
});

function monthlyEquipmentFixture(){
  const store=fixture(),types=[3,5,5,2,2,14];
  delete store.info.ships[7];delete store.info.ships[8];
  for(const [i,type]of types.entries()){
    const id=i+1;Object.assign(store.const.$ships[id],{api_stype:type,api_slot_num:3,api_maxeq:[0,0,0]});
    Object.assign(store.info.ships[id],{api_lv:60,api_slot:[-1,-1,-1],api_karyoku:[70,100],api_taiku:[40,100],api_taisen:[40,100],api_sakuteki:[25,100]});
    store.const.$shipTypes[type]={api_equip_type:{1:1,14:1,12:1}};
  }
  for(const [id,type,stats,count]of [[500,1,{api_houg:10,api_tyku:5},8],[501,14,{api_tais:10},4],[502,12,{api_saku:10},2]]){
    store.const.$equips[id]={api_id:id,api_name:'测试远征装备'+id,api_type:[0,0,type,0],...stats};
    for(let i=0;i<count;i++)addExpeditionItem(store,id*100+i,id);
  }
  return store;
}
test('B4 refits all four attribute deficits before falling back to a closest reference',()=>{
  const store=monthlyEquipmentFixture(),before=JSON.stringify(store),args={missionId:113,fleet:2,goal:'great',limit:1};
  const result=recommendExpeditionFleet(store,args),row=result.recommendations[0];
  assert(row,JSON.stringify(result.closestRecommendation?.shortfalls));assert.equal(result.closestRecommendation,undefined);
  assert(row.evaluation.eligible);assert(row.evaluation.checks.filter(c=>c.type.startsWith('total')).every(c=>c.sat));
  const ids=row.scheme.ships.flatMap(s=>s.slots).filter(id=>id>0);assert.equal(ids.length,new Set(ids).size);
  assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',row.scheme));
  const inspected=require('../../src/ui/workbench/workbench_model').inspect(new Controller({getStore:()=>store}),store,row.scheme.ships,{fleet:2,missionId:113,kind:'expedition'});
  assert.deepEqual(inspected.expedition,row.evaluation,'UI evaluates against the original panel, not a synthetic swapped snapshot');
  assert.equal(JSON.stringify(store),before);
  delete store.info.equips[50000];
  const missing=recommendExpeditionFleet(store,args);assert.equal(missing.recommendations.length,0);
  assert(missing.closestRecommendation.shortfalls.some(c=>c.type==='totalFirepower'&&c.missing===10));
});
test('monthly fitter preserves manual empty slots and replaces full existing outfits to make room for mandatory drums',()=>{
  const store=incomeEquipmentFixture();store.const.$missions[44]={api_use_fuel:.5,api_use_bull:.5};
  store.const.$ships[2].api_stype=16;store.const.$ships[3].api_stype=7;
  for(const type of [16,7])store.const.$shipTypes[type]={api_equip_type:{25:1,24:1,1:1}};
  for(const id of [1,2,3,4,5,6]){
    Object.assign(store.const.$ships[id],{api_slot_num:3,api_maxeq:[0,0,0]});
    Object.assign(store.info.ships[id],{api_slot:[-1,-1,-1],api_taiku:[50,100],api_taisen:[50,100],api_sakuteki:[30,100]});
    for(let k=0;k<3;k++){const eq=1000+id*3+k;addExpeditionItem(store,eq,500);store.info.ships[id].api_slot[k]=eq;}
  }
  for(let id=201;id<=210;id++)addExpeditionItem(store,id,75);
  const heldSlots=[{id:2,slots:[-1,-1,-1],keep:{0:true}}],fit=expeditionFit(store,[1,2,3,4,5,6],44,{heldSlots});
  assert(fit.evaluation.eligible,JSON.stringify(fit.evaluation.checks.filter(c=>!c.sat)));
  assert.equal(fit.scheme.ships[1].slots[0],-1);assert.equal(fit.evaluation.greatSuccess.drums,8,'spare slots reach the useful drum tier without changing the preserved empty hull');
});

test('monthly stat fitting escapes a scarce-equipment placement trap using a joint exchange',()=>{
  const {fitStatEquipment}=require('../../src/recommendation/loadout/expedition_stats');
  const store=monthlyEquipmentFixture();
  store.const.$equips[500].api_houg=10;store.const.$equips[501].api_tais=8;
  // Hull 1 can replace the scarce mixed gun with sonar; hull 2 cannot use sonar.
  store.const.$equips[500].api_tais=8;store.const.$shipTypes[5].api_equip_type={1:1};
  const entries=[{id:1,slots:[50000],ex:-1},{id:2,slots:[-1],ex:-1}];
  const inventory=[{id:50000,master:store.const.$equips[500]},{id:50100,master:store.const.$equips[501]}];
  const held=new Map(),spec={totals:{firepower:10,asw:8}};
  const read=(id,s)=>Object.fromEntries(['firepower','asw'].map(key=>[key,{lower:s.slots.reduce((n,e)=>n+(store.const.$equips[store.info.equips[e]?.api_slotitem_id]?.[key==='asw'?'api_tais':'api_houg']||0),0)}]));
  // Force hull 2 to need the gun, while hull 1's innate fire makes that gun redundant.
  const withHull=(id,s)=>{const r=read(id,s);if(id===1)r.firepower.lower+=10;return r;};
  spec.totals={firepower:20,asw:16};
  const result=fitStatEquipment(store,entries,inventory,held,spec,withHull);
  assert.equal(result.gap,0);assert.equal(entries[0].slots[0],50100);assert.equal(entries[1].slots[0],50000);
});

test('expedition fleet search considers reward carriers and compares actual net income after supply',()=>{
  const store=incomeEquipmentFixture();
  delete store.const.$shipTypes[1].api_equip_type[24];delete store.const.$shipTypes[2].api_equip_type[24];delete store.const.$shipTypes[3].api_equip_type[24];
  store.const.$equipShip[8]={api_equip_type:{24:null}};
  for(let id=201;id<=204;id++)addExpeditionItem(store,id,68);
  const noCarrier=recommendExpeditionFleet(store,{missionId:5,fleet:2,excludedShipIds:[8],limit:1}).recommendations[0];
  const best=recommendExpeditionFleet(store,{missionId:5,fleet:2,limit:1}).recommendations[0];
  assert(best.scheme.ships.some(s=>s.id===8));assert(best.income.bonus>0);
  const net=row=>row.income.rows.reduce((n,r)=>n+r.net,0);assert(net(best)>net(noCarrier));
  store.const.$ships[8].api_fuel_max=500;store.info.ships[8].api_fuel=500;
  const expensive=recommendExpeditionFleet(store,{missionId:5,fleet:2,limit:1}).recommendations[0];
  assert(!expensive.scheme.ships.some(s=>s.id===8),'a bonus does not justify a larger supply loss');
});

test('expedition reward optimization cannot trade away the great-success probability target',()=>{
  const store=incomeEquipmentFixture();
  for(const id of [1,2,3,4,5,6])store.info.ships[id].api_cond=60;
  for(const type of [1,2,3])delete store.const.$shipTypes[type].api_equip_type[24];
  store.const.$equipShip[8]={api_equip_type:{24:null}};
  for(let id=201;id<=204;id++)addExpeditionItem(store,id,68);
  const best=recommendExpeditionFleet(store,{missionId:5,fleet:2,goal:'great',limit:1}).recommendations[0];
  assert.equal(best.evaluation.greatSuccess.estimatedPercent,100);
  assert(!best.scheme.ships.some(s=>s.id===8));
});

test('drums and borrowed gear stay within slot_num when api_slot is the raw 5-element array',()=>{
  const store=fixture();
  // Real poi stores keep api_slot at length 5 even for 2-slot ships.
  for(const id of Object.keys(store.info.ships))
    store.info.ships[id].api_slot=[-1,-1,-1,-1,-1];
  store.const.$equips[75]={api_id:75,api_name:'ドラム缶',api_type:[0,0,25,30]};
  store.const.$shipTypes[2]={api_equip_type:{25:1}};
  store.const.$shipTypes[3]={api_equip_type:{25:1}};
  for(let id=101;id<=108;id++)store.info.equips[id]={api_id:id,api_slotitem_id:75,api_level:0};
  const result=recommendExpeditionFleet(store,{missionId:37,fleet:2,excludedShipIds:[7]});
  assert(result.recommendations.length>0,JSON.stringify({search:result.search,reason:result.reason}));
  for(const row of result.recommendations){
    for(const ship of row.scheme.ships){
      const master=store.const.$ships[store.info.ships[ship.id].api_ship_id];
      if(ship.slots)assert(ship.slots.length<=master.api_slot_num,
        `slots ${ship.slots.length} exceed slot_num ${master.api_slot_num}`);
    }
    assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',row.scheme));
  }
});

test('normal strongest recommendation can equip an owned free fighter',()=>{
  const store=airMapFixture();
  store.const.$ships[7].api_stype=7;store.const.$ships[7].api_maxeq=[18,18];
  store.info.ships[7].api_onslot=[18,18];
  store.const.$shipTypes[7]={api_equip_type:{6:1}};
  store.const.$equips[201]={api_id:201,api_name:'戦闘機',api_type:[0,0,6,6],api_tyku:10};
  store.info.equips[201]={api_id:201,api_slotitem_id:201,api_level:0,api_alv:7};
  const result=recommendNormalFleet(store,{area:'2-1',preference:'strongest',airGoal:'superiority',
    fixedShipIds:[7],limit:5});
  assert(result.recommendations.some(row=>row.scheme.ships.some(ship=>ship.slots?.includes(201))));
  assert.equal(store.info.ships[7].api_slot[0],-1);
});

test('borrowed equipment is reported with its donor ship',()=>{
  const store=airMapFixture();
  store.const.$ships[7].api_stype=7;store.const.$ships[7].api_maxeq=[18,18];
  store.info.ships[7].api_onslot=[18,18];
  store.const.$ships[8].api_stype=7;
  store.const.$shipTypes[7]={api_equip_type:{6:1}};
  store.const.$equips[201]={api_id:201,api_name:'戦闘機',api_type:[0,0,6,6],api_tyku:10};
  store.info.equips[201]={api_id:201,api_slotitem_id:201,api_level:0,api_alv:7};
  store.info.ships[8].api_slot=[201,-1];
  const result=recommendNormalFleet(store,{area:'2-1',preference:'strongest',airGoal:'superiority',
    fixedShipIds:[7],excludedShipIds:[8],limit:5});
  assert(result.recommendations.some(row=>row.donorShipIds.includes(8)&&
    row.scheme.ships.some(ship=>ship.slots?.includes(201))));
});

test('air goal ranks confirmed air superiority first and reports unmet air supremacy',()=>{
  const store=airMapFixture();
  store.const.$ships[7].api_stype=7;store.const.$ships[7].api_maxeq=[18,18];
  store.info.ships[7].api_onslot=[18,18];
  store.const.$shipTypes[7]={api_equip_type:{6:1}};
  store.const.$equips[201]={api_id:201,api_name:'戦闘機',api_type:[0,0,6,6],api_tyku:10};
  store.const.$equips[202]={api_id:202,api_name:'戦闘機',api_type:[0,0,6,6],api_tyku:10};
  for(const id of [201,202])store.info.equips[id]={api_id:id,api_slotitem_id:id,api_level:0,api_alv:7};
  const superior=recommendNormalFleet(store,{area:'2-1',airGoal:'superiority',fixedShipIds:[7]});
  assert.equal(superior.airGoalSummary.status,'confirmedOptions',JSON.stringify(superior.airGoalSummary));
  assert.equal(superior.recommendations[0].scores.airGoalStatus,'meetsAlongRoute');
  assert.equal(superior.recommendations[0].scores.airGoalBaseRequired,81);
  assert.equal(superior.recommendations[0].scores.airGoalRequired,81);
  assert(superior.recommendations[0].scheme.ships.some(ship=>ship.slots?.includes(201)));
  const freeChoice=recommendNormalFleet(store,{area:'2-1',airGoal:'superiority'});
  assert.equal(freeChoice.recommendations[0].scores.airGoalStatus,'meetsAlongRoute');
  assert(freeChoice.recommendations[0].scheme.ships.some(ship=>ship.id===7));
  const supreme=recommendNormalFleet(store,{area:'2-1',airGoal:'supremacy',fixedShipIds:[7]});
  assert.equal(supreme.airGoalSummary.status,'noConfirmedOption');
  assert(supreme.recommendations.every(row=>row.scores.airGoalTier<3));
  const ignored=recommendNormalFleet(store,{area:'2-1',airGoal:'ignore',fixedShipIds:[7]});
  assert.equal(ignored.airGoalSummary.status,'notRequested');
  assert(ignored.recommendations.every(row=>row.scores.airGoalRequired===null),'ignore adds no mandatory air threshold');
  assert.throws(()=>recommendNormalFleet(store,{area:'2-1',airGoal:'invalid'}),/airGoal/);
});

test('air planning replaces a full carrier slot and retains its strike plane',()=>{
  const store=airMapFixture();
  store.const.$ships[7].api_stype=7;store.const.$ships[7].api_maxeq=[30,18];
  store.info.ships[7].api_onslot=[30,18];
  store.const.$shipTypes[7]={api_equip_type:{6:1,8:1}};
  store.const.$equips[201]={api_id:201,api_name:'弱い艦戦',api_type:[0,0,6,6],api_tyku:5};
  store.const.$equips[202]={api_id:202,api_name:'艦攻',api_type:[0,0,8,8],api_tyku:1,api_raig:10};
  store.const.$equips[203]={api_id:203,api_name:'強い艦戦',api_type:[0,0,6,6],api_tyku:14};
  for(const id of [201,202,203])store.info.equips[id]={api_id:id,
    api_slotitem_id:id,api_level:0,api_alv:7};
  store.info.ships[7].api_slot=[201,202];
  const result=recommendNormalFleet(store,{area:'2-1',preference:'strongest',
    airGoal:'superiority',fixedShipIds:[7]});
  const row=result.recommendations[0],carrier=row.scheme.ships.find(ship=>ship.id===7);
  assert(carrier.slots?.includes(203),JSON.stringify(result.airGoalSummary));
  assert(carrier.slots.includes(202),'retain an attack aircraft after meeting air goal');
  assert(row.route.airControl.fleetAirPower.min>=row.scores.airGoalRequired);
  assert(row.scores.routeAirEstimate.margins.superiority.min>=0,'fighter fitting must pass after sequential losses');
  assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',row.scheme));
});

test('a cruiser water fighter restores a carrier attack slot when air stays sufficient',()=>{
  const store=airMapFixture();
  store.const.$ships[7].api_stype=7;store.const.$ships[7].api_maxeq=[18,18];
  store.info.ships[7].api_onslot=[18,18];
  store.const.$ships[8].api_stype=5;store.const.$ships[8].api_maxeq=[3,0];
  store.info.ships[8].api_onslot=[3,0];
  store.const.$shipTypes[7]={api_equip_type:{6:1,8:1}};
  store.const.$shipTypes[5]={api_equip_type:{45:1,30:1}};
  store.const.$equips[201]={api_id:201,api_name:'艦戦A',api_type:[0,0,6,6],api_tyku:10};
  store.const.$equips[202]={api_id:202,api_name:'艦戦B',api_type:[0,0,6,6],api_tyku:10};
  store.const.$equips[203]={api_id:203,api_name:'水戦',api_type:[0,0,45,45],api_tyku:5};
  store.const.$equips[204]={api_id:204,api_name:'ドラム缶',api_type:[0,0,30,30]};
  store.const.$equips[205]={api_id:205,api_name:'艦攻',api_type:[0,0,8,8],api_raig:10};
  for(const id of [201,202,203,204,205])store.info.equips[id]={api_id:id,
    api_slotitem_id:id,api_level:0,api_alv:7};
  store.info.ships[7].api_slot=[201,202];
  store.info.ships[8].api_slot=[204,-1];
  const result=recommendNormalFleet(store,{area:'2-1',preference:'strongest',
    airGoal:'superiority',fixedShipIds:[7,8]});
  const row=result.recommendations[0];
  assert(row.scheme.ships.find(ship=>ship.id===7).slots?.includes(205));
  assert(row.scheme.ships.find(ship=>ship.id===8).slots?.includes(203));
  assert(row.route.airControl.fleetAirPower.min>=row.scores.airGoalRequired);
  assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',row.scheme));
});

function duplicateAircraftFixture(){
  const store=airMapFixture();
  Object.assign(store.const.$ships[7],{api_stype:7,api_maxeq:[18,18]});
  Object.assign(store.info.ships[7],{api_onslot:[18,18],api_slot:[601,605]});
  Object.assign(store.const.$ships[8],{api_stype:5,api_maxeq:[3,0]});
  Object.assign(store.info.ships[8],{api_onslot:[3,0],api_slot:[604,-1]});
  store.const.$shipTypes[7]={api_equip_type:{6:1,8:1}};
  store.const.$shipTypes[5]={api_equip_type:{6:1,45:1,30:1}};
  for(const [id,type,aa,torpedo]of [[601,6,10,0],[602,8,1,10],[603,45,5,0],[604,30,0,0]])
    store.const.$equips[id]={api_id:id,api_name:'air-test-'+id,api_type:[0,0,type,type],api_tyku:aa,api_raig:torpedo};
  for(const [id,master]of [[601,601],[602,602],[603,603],[604,604],[605,601],[606,602],[607,603]])
    store.info.equips[id]={api_id:id,api_slotitem_id:master,api_level:0,api_alv:7};
  const scheme={fleet:1,ships:[7,8].map(id=>({id,slots:store.info.ships[id].api_slot.slice(),ex:-1}))};
  const reference={status:'known',paths:[['Z']],nodes:[{id:'Z',boss:true,enemyAirPower:54}]};
  const run=(required=81,inventory=require('../../src/recommendation/loadout/loadout_policy').availableEquipment(store),ref=reference)=>
    require('../../src/recommendation/index').airLoadout(store,scheme,inventory,required,ref);
  return {store,scheme,reference,run};
}

test('uncontested routes fit one water fighter without replacing guns or held equipment',()=>{
  const store=fixture(),{airLoadout,routeAirReference,recommendNormalEquipment}=require('../../src/recommendation/index');
  Object.assign(store.const.$ships[1],{api_stype:16,api_slot_num:3,api_maxeq:[0,0,1]});
  Object.assign(store.info.ships[1],{api_slot:[501,502,-1],api_onslot:[0,0,1]});
  store.const.$shipTypes[16]={api_equip_type:{1:1,12:1,45:1}};
  store.const.$equips[500]={api_id:500,api_name:'主炮',api_type:[0,0,1,1],api_houg:5};
  store.const.$equips[503]={api_id:503,api_name:'水戦',api_type:[0,0,45,45],api_tyku:4};
  store.const.$equips[504]={api_id:504,api_name:'辅助电探',api_type:[0,0,12,12],api_houg:1};
  for(const [id,mid] of [[501,500],[502,500],[503,503],[504,504]])store.info.equips[id]={api_id:id,api_slotitem_id:mid,api_level:0,api_alv:0};
  const scheme={fleet:1,ships:[{id:1,slots:[501,502,-1],ex:0}]};
  const inventory=require('../../src/recommendation/loadout/loadout_policy').availableEquipment(store),before=JSON.stringify(store);
  const ref=routeAirReference({},'1-1',{examples:[['A','C']]});
  const fitted=airLoadout(store,scheme,inventory,0,ref);
  assert.deepEqual(fitted.ships[0].slots,[501,502,503]);
  assert.equal(JSON.stringify(store),before);
  const held=airLoadout(store,scheme,inventory,0,ref,'superiority',[{id:1,keep:{2:true}}]);
  assert.deepEqual(held.ships[0].slots,[501,502,-1]);
  const noInventory=airLoadout(store,scheme,inventory.filter(i=>i.id!==503),0,ref);
  assert.deepEqual(noInventory.ships[0].slots,[501,502,-1]);
  const adjusted=recommendNormalEquipment(store,{scheme,area:'1-1'});
  assert(adjusted.scheme.ships[0].slots.includes(503),'final recommendation keeps the safe one-plane fit');
  assert.equal(JSON.stringify(store),before);
});

test('uncontested carrier fleets keep a carrier fighter instead of forcing water fighters',()=>{
  const f=duplicateAircraftFixture();f.scheme.ships[0].slots=[602,606];
  const ref=require('../../src/domain/routes/route_air').routeAirReference({},'1-1',{examples:[['A','C']]});
  const result=f.run(0,undefined,ref),type=id=>f.store.const.$equips[f.store.info.equips[id]?.api_slotitem_id]?.api_type[2];
  assert.equal(result.ships[0].slots.filter(id=>type(id)===6).length,1);
  assert(result.ships[0].slots.some(id=>type(id)===8),'retain strike capability');
  assert(result.ships[1].slots.every(id=>type(id)!==45),'do not force water cover with a carrier available');
});

test('equivalent aircraft retain copy counts and original instance tie ordering',()=>{
  const f=duplicateAircraftFixture(),before=JSON.stringify(f.store);
  const inventory=require('../../src/recommendation/loadout/loadout_policy').availableEquipment(f.store);
  const low=f.run(1,inventory,{...f.reference,nodes:[{id:'Z',boss:true,enemyAirPower:0}]});
  assert.deepEqual(low.ships[0].slots,[602,606],'each slot consumes a distinct available copy');
  assert.equal(JSON.stringify(f.store),before);
  const paired=f.run();
  assert.deepEqual(paired.ships[0].slots,[602,605]);assert.equal(paired.ships[1].slots[0],603);
  const reversed=f.run(81,inventory.slice().reverse());
  assert.equal(reversed.ships[1].slots[0],607,'paired ties retain original inventory traversal');
  assert.equal(reversed.ships[0].slots[0],606);
  assert.doesNotThrow(()=>new Controller({getStore:()=>f.store}).preview('fleet',paired));
});

test('equivalent aircraft skip ineligible borrowed copies before choosing a representative',()=>{
  const f=duplicateAircraftFixture();f.store.info.ships[3].api_slot=[603,-1];
  f.store.selectorTables=structuredClone(require('../../data/equipment_rules.json'));
  f.store.selectorTables.pickerTypeOverrides[603]=6;
  f.store.selectorTables.slotExclusions.push({shipMstIds:[8],slot:0,exclude:[45]});
  const result=f.run();
  assert.equal(result.ships[1].slots[0],607,'free copy remains available when the first copy cannot be borrowed');
  assert.doesNotThrow(()=>new Controller({getStore:()=>f.store}).preview('fleet',result));
});

test('fixed equipment survives grouped automatic loadouts and expansion items are not reused',()=>{
  const f=duplicateAircraftFixture();f.store.info.ships[7].api_slot_ex=606;
  f.store.const.$exslotEquips=[8];f.scheme.ships[0].ex=606;
  const result=f.run(1,undefined,{...f.reference,nodes:[{id:'Z',boss:true,enemyAirPower:0}]});
  assert(!result.ships.flatMap(s=>s.slots).includes(606));
  const held=f.scheme.ships.map(s=>({...s,keep:s.id===7?{0:true,ex:true}:{}}));
  const fitted=require('../../src/recommendation/index').recommendNormalEquipment(f.store,
    {area:'2-1',scheme:f.scheme,heldSlots:held}).scheme;
  assert.equal(fitted.ships[0].slots[0],601);assert.equal(fitted.ships[0].ex,606);
  const ids=fitted.ships.flatMap(s=>s.slots.concat(s.ex)).filter(id=>id>0);
  assert.equal(ids.length,new Set(ids).size);
});

test('all preferences merge identical winners and retain every goal from the same bounded search',()=>{
  const store=fixture();
  const result=recommendNormalFleet(store,{area:'1-1'});
  assert.equal(result.preference,'all');
  assert.deepEqual(new Set(result.recommendations.flatMap(row=>row.preferences)),
    new Set(['shortest','strongest','lowestConsumption']));
  assert.equal(result.recommendations.length,2,'the cheapest and shortest winners are the same fleet');
  assert.equal(new Set(result.recommendations.map(row=>JSON.stringify(row.scheme))).size,2);
  assert.equal(result.airGoalSummary.returnedCount,2);
  for(const mode of ['shortest','strongest','lowestConsumption']){
    const individual=recommendNormalFleet(store,{area:'1-1',preference:mode}).recommendations[0];
    assert.deepEqual(result.recommendations.find(row=>row.preferences.includes(mode)).scheme,individual.scheme);
  }
  for(const row of result.recommendations)
    assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',row.scheme));
});

test('sequential aircraft loss identifies a fleet that meets departure air but can lose superiority',()=>{
  const store=airMapFixture();
  store.const.$ships[7].api_stype=7;store.const.$ships[7].api_maxeq=[18,18];
  store.info.ships[7].api_onslot=[18,18];
  store.const.$shipTypes[7]={api_equip_type:{6:1}};
  store.const.$equips[203]={api_id:203,api_name:'戦闘機',api_type:[0,0,6,6],api_tyku:14};
  store.info.equips[203]={api_id:203,api_slotitem_id:203,api_level:0,api_alv:7};
  const result=recommendNormalFleet(store,{area:'2-1',preference:'shortest',
    airGoal:'superiority',fixedShipIds:[7]});
  assert.equal(result.airGoalSummary.status,'noConfirmedOption');
  const fighter=result.recommendations.find(row=>row.scheme.ships.some(ship=>
    ship.slots?.includes(203)));
  assert(fighter);
  assert.equal(fighter.route.airControl.assessment.superiority.status,'meetsAtStart');
  assert.equal(fighter.scores.airGoalStatus,'uncertainAlongRoute');
  assert.equal(fighter.scores.airGoalRequired,81);
  assert(fighter.scores.routeAirEstimate.margins.superiority.min<0);
  assert(fighter.scores.routeAirEstimate.margins.superiority.max>=0);
  assert.equal(result.airReservePercent,undefined);
});

test('a fully constrained identical winner is returned once with all three preferences',()=>{
  const result=recommendNormalFleet(fixture(),{area:'1-1',fixedShipIds:[2],
    excludedShipIds:[1,3,4,5,6,7,8]});
  assert.equal(result.recommendations.length,1);
  assert.deepEqual(result.recommendations[0].preferences,['shortest','strongest','lowestConsumption']);
  assert.equal(result.airGoalSummary.returnedCount,1);
  assert.deepEqual(result.guideWarnings,[]);
  assert.deepEqual(result.recommendations[0].scheme.ships,[{id:2,slots:[-1,-1],ex:-1}]);
});

test('1-5 route counts submarine fights and reports full ammo on boss entry',()=>{
  const store=fixture();
  const result=recommendNormalFleet(store,{area:'1-5',preference:'strongest',
    fixedShipIds:[2,3,4,5]});
  assert.equal(result.recommendations.length,1);
  const row=result.recommendations[0];
  assert.equal(row.profile.counts.surface.maximum,0);
  assert.equal(row.profile.counts.asw.minimum,4);
  assert.deepEqual(row.profile.ammoAtTargetPercent,{minimum:100,maximum:100});
  assert.equal(row.scores.aswShipCount,4);
});

test('unknown aerial and whirlpool consumption is not presented as zero',()=>{
  assert.equal(consumption({node:'I',kind:'aerialCombat',fuelFraction:null,
    ammoFraction:null},'5-2').ammo,null);
  assert.equal(consumption({kind:'whirlpool',effect:{raw:'弾薬を失う'}},'2-4').ammo,null);
  assert.equal(consumption({kind:'whirlpool',effect:{raw:'燃料を失う'}},'2-4').ammo,0);
  assert.equal(consumption({kind:'battle',fuelFraction:null,ammoFraction:null},'1-4').ammo,0.2);
});

test('1-5 recommendation outfits small ships with available ASW equipment',()=>{
  const store=fixture();
  store.const.$shipTypes[2]={api_equip_type:{14:1,15:1}};
  store.const.$equips[301]={api_id:301,api_name:'三式水中探信儀',
    api_type:[0,0,14,14],api_tais:10};
  store.const.$equips[302]={api_id:302,api_name:'三式爆雷投射機',
    api_type:[0,0,15,15],api_tais:8};
  store.const.$equips[400]={api_id:400,api_name:'旧主砲',api_type:[0,0,1,1]};
  store.info.equips[400]={api_id:400,api_slotitem_id:400,api_level:0};
  store.info.ships[2].api_slot[0]=400;
  for(let id=301;id<=308;id++)store.info.equips[id]={api_id:id,
    api_slotitem_id:id%2?301:302,api_level:0};
  const row=recommendNormalFleet(store,{area:'1-5',preference:'strongest',
    fixedShipIds:[2,3,4,5]}).recommendations[0];
  assert(row.scheme.ships.every(ship=>ship.slots?.every(id=>id>=301&&id<=308)),
    JSON.stringify(row.scheme));
  for(const ship of row.scheme.ships){
    const types=ship.slots.map(id=>Number(store.const.$equips[
      store.info.equips[id]?.api_slotitem_id]?.api_type?.[2]));
    assert(types.includes(14)&&types.includes(15),
      `ship ${ship.id} should pair sonar with depth equipment`);
  }
  assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',row.scheme));
});

test('1-5 pool retains a sonar-equipped OASW ship whose stat is a two-element array',()=>{
  const store=fixture();
  store.const.$equips[301]={api_id:301,api_name:'水中探信儀',
    api_type:[0,0,14,18],api_tais:12};
  store.info.equips[301]={api_id:301,api_slotitem_id:301,api_level:0};
  store.const.$shipTypes[2]={api_equip_type:{14:1}};
  for(let id=9;id<=24;id++){
    store.const.$ships[id]={...store.const.$ships[2],api_id:id,api_name:`高练度舰${id}`,
      api_fuel_max:20,api_bull_max:20};
    store.info.ships[id]={...store.info.ships[2],api_id:id,api_ship_id:id,
      api_lv:150,api_fuel:20,api_bull:20,api_slot:[-1,-1]};
  }
  store.const.$ships[25]={...store.const.$ships[2],api_id:25,
    api_name:'低等级先制对潜舰',api_fuel_max:100,api_bull_max:100};
  store.info.ships[25]={...store.info.ships[2],api_id:25,api_ship_id:25,
    api_lv:1,api_fuel:100,api_bull:100,api_taisen:[110,110],api_slot:[301,-1]};
  const result=recommendNormalFleet(store,{area:'1-5',preference:'strongest',automaticFilters:{minLevel:0}});
  assert(result.recommendations[0].scheme.ships.some(ship=>ship.id===25),
    'ready OASW ship must enter the candidate pool even when not cheap or high-level');
});

test('1-5 strongest search prefers four viable opening-ASW ships over high-level low-ASW hulls',()=>{
  const store=fixture();
  store.const.$shipTypes[2]={api_equip_type:{14:1,15:1}};
  store.const.$shipTypes[3]={api_equip_type:{14:1,15:1}};
  store.const.$equips[301]={api_id:301,api_name:'水中探信儀',
    api_type:[0,0,14,14],api_tais:12};
  store.const.$equips[302]={api_id:302,api_name:'爆雷投射機',
    api_type:[0,0,15,15],api_tais:12};
  for(let id=101;id<=120;id++)store.info.equips[id]={api_id:id,
    api_slotitem_id:id<=112?301:302,api_level:0};
  for(let id=9;id<=28;id++){
    const priority=id>=25,stype=id===25?3:2;
    store.const.$ships[id]={...store.const.$ships[2],api_id:id,
      api_name:`对潜候选${id}`,api_stype:stype,api_slot_num:3,
      api_fuel_max:priority?20:5,api_bull_max:priority?20:5};
    store.info.ships[id]={...store.info.ships[2],api_id:id,api_ship_id:id,
      api_lv:priority?80:150,api_fuel:priority?20:5,api_bull:priority?20:5,
      api_taisen:priority?[85,85]:[20,20],api_slot:[-1,-1,-1]};
  }
  const result=recommendNormalFleet(store,{area:'1-5',preference:'strongest'});
  const best=result.recommendations[0];
  assert(best,JSON.stringify(result.search));
  assert.equal(best.scores.openingAswCount,4,
    'four viable OASW hulls must beat high-level ships that cannot open with ASW');
  assert(best.scheme.ships.every(ship=>ship.id>=25&&ship.id<=28),
    JSON.stringify(best.scheme));
});

test('1-5 shortest and cheapest searches try an all-coastal-guard shortcut',()=>{
  const store=fixture();
  store.const.$shipTypes[1]={api_equip_type:{14:1,15:1}};
  store.const.$equips[301]={api_id:301,api_name:'水中探信儀',
    api_type:[0,0,14,14],api_tais:12};
  store.const.$equips[302]={api_id:302,api_name:'爆雷投射機',
    api_type:[0,0,15,15],api_tais:12};
  for(let id=101;id<=120;id++)store.info.equips[id]={api_id:id,
    api_slotitem_id:id<=112?301:302,api_level:0};
  for(let id=9;id<=28;id++){
    const coastal=id>=25;
    store.const.$ships[id]={...store.const.$ships[2],api_id:id,
      api_name:`海防候选${id}`,api_stype:coastal?1:2,api_slot_num:3,
      api_fuel_max:coastal?10:20,api_bull_max:coastal?10:20};
    store.info.ships[id]={...store.info.ships[2],api_id:id,api_ship_id:id,
      api_lv:coastal?40:150,api_fuel:coastal?10:20,api_bull:coastal?10:20,
      api_taisen:coastal?[55,55]:[20,20],api_slot:[-1,-1,-1]};
  }
  const result=recommendNormalFleet(store,{area:'1-5'});
  for(const mode of ['shortest','lowestConsumption']){
    const row=result.recommendations.find(item=>item.preferences.includes(mode));
    assert.deepEqual(row.profile.examples[0],['A','D','E','J'],mode);
    assert.equal(row.scheme.ships.length,4,mode);
    assert(row.scheme.ships.every(ship=>store.const.$ships[
      store.info.ships[ship.id].api_ship_id].api_stype===1),mode);
    assert(row.scores.openingAswCount>=3,mode);
  }
});

test('1-4 surface battles favor heavy firepower, while mixed routes retain both needs',()=>{
  const store=fixture();
  armSurfaceDestroyers(store);
  for(const id of [1,7]){
    store.const.$ships[id].api_stype=8;
    store.const.$ships[id].api_fuel_max=100;
    store.const.$ships[id].api_bull_max=100;
    store.info.ships[id].api_karyoku=[100,120];
    store.info.ships[id].api_soukou=[80,100];
  }
  armCapitalShips(store,[1,7]);
  const strong=recommendNormalFleet(store,{area:'1-4',preference:'strongest'}).recommendations[0];
  assert(strong, '1-4 must have a reachable fleet');
  assert(strong.scheme.ships.some(ship=>[1,7].includes(ship.id)),JSON.stringify(strong.scheme));
  assert.equal(strong.profile.counts.asw.maximum,0);
  assert(strong.profile.counts.surface.minimum>=1);
  const cheap=recommendNormalFleet(store,{area:'1-4',preference:'lowestConsumption'}).recommendations[0];
  assert(cheap.scheme.ships.length>=4,'lowest cost must still carry a viable surface fleet');
  const unqualified=recommendNormalFleet(fixture(),{area:'4-3',preference:'strongest',
    fixedShipIds:[1,2,3],excludedShipIds:[4,5,6,7,8]});
  assert.equal(unqualified.recommendations.length,0,
    'a fleet that merely reaches the installation boss must not be recommended');
  assert(unqualified.guideWarnings.length>0);
});

test('4-3 only recommends its light-carrier lane with an owned anti-ground hitter',()=>{
  const store=fixture();armSurfaceDestroyers(store);
  for(const id of [7,8])store.const.$ships[id].api_stype=7;
  const without=recommendNormalFleet(store,{area:'4-3',preference:'shortest'});
  assert.equal(without.recommendations.length,0,
    'reaching an installation boss without anti-ground gear is insufficient');
  store.const.$equips[501]={api_id:501,api_name:'WG42 (Wurfgerät 42)',
    api_type:[0,0,37,37]};
  store.const.$shipTypes[2].api_equip_type[37]=1;
  store.info.equips[1900]={api_id:1900,api_slotitem_id:501,api_level:0};
  const withGear=recommendNormalFleet(store,{area:'4-3',preference:'shortest'});
  const row=withGear.recommendations[0];
  assert(row,JSON.stringify(withGear.guideWarnings));
  assert.equal(row.scheme.ships.length,6);
  assert.equal(row.route.verdict,'possibleRandom');
  assert(row.route.chanceRange.every(p=>Math.abs(p-.91)<1e-9));
  assert(row.scheme.ships.some(ship=>ship.slots?.includes(1900)));
  assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',row.scheme));
});

test('7-4 six-ship E to J route does not display the five-ship J to P shortcut',()=>{
  const route={targetNodes:['P'],phase:null,
    ships:[{stype:10},{stype:7},{stype:1},{stype:1},{stype:3},{stype:5}],
    lineOfSight:{scoresByCoefficient:{4:50},thresholdMargin:1},
    pointAssessments:[
      {from:'start',phase:null,assessment:{status:'fixed',destinations:['A']}},
      {from:'E',phase:null,assessment:{status:'fixed',destinations:['J']}},
      {from:'J',phase:null,assessment:{status:'unknown',destinations:['K','L','P']}}
    ]};
  const profile=profileForRoute('7-4',route);
  assert.deepEqual(profile.examples[0],['A','B','E','J','L','P']);
  assert.equal(profile.status,'possible','the underlying route is still unverified');
  const insufficient=profileForRoute('7-4',{...route,
    lineOfSight:{scoresByCoefficient:{4:32},thresholdMargin:0}});
  assert.equal(insufficient.status,'unavailable');
});

test('2-5 combines fighter and LoS changes before accepting a fast south-route fleet',()=>{
  const store=fixture();armSurfaceDestroyers(store);
  store.const.$ships[5].api_stype=7;
  store.const.$ships[6].api_stype=11;
  for(const id of [5,6]){
    store.const.$ships[id].api_slot_num=3;
    store.const.$ships[id].api_maxeq=[30,30,30];
    store.info.ships[id].api_slot=[3000+id,-1,-1];
    store.info.ships[id].api_onslot=[30,30,30];
  }
  for(const id of [2,3,4]){
    store.const.$ships[id].api_slot_num=3;
    store.info.ships[id].api_slot.push(-1);
    store.info.ships[id].api_onslot.push(0);
  }
  for(const ship of Object.values(store.info.ships))ship.api_sakuteki=[100,100];
  store.const.$equips[503]={api_id:503,api_name:'测试舰攻',api_type:[0,0,8,8],api_raig:10};
  store.const.$equips[504]={api_id:504,api_name:'测试舰战',api_type:[0,0,6,6],api_tyku:15};
  store.const.$equips[505]={api_id:505,api_name:'测试电探',api_type:[0,0,12,12],api_saku:10};
  store.const.$equips[506]={api_id:506,api_name:'测试舰侦',api_type:[0,0,9,9],api_saku:10};
  store.const.$shipTypes[7]={api_equip_type:{6:1,8:1,9:1,12:1}};
  store.const.$shipTypes[11]={api_equip_type:{6:1,8:1,9:1,12:1}};
  store.const.$shipTypes[3]={api_equip_type:{12:1}};
  store.const.$shipTypes[2].api_equip_type[12]=1;
  for(const id of [5,6])store.info.equips[3000+id]={
    api_id:3000+id,api_slotitem_id:503,api_level:0};
  for(const [id,master] of [[3010,504],[3011,504],[3020,505],[3021,505],
    [3022,505],[3023,505],[3024,505],[3030,506]])store.info.equips[id]={
    api_id:id,api_slotitem_id:master,api_level:0};
  assert.equal(require('../../src/domain/fleet/equipment_rules').canEquip(store,5,3010,1),true);
  const result=recommendNormalFleet(store,{area:'2-5',preference:'shortest',
    airGoal:'superiority',fixedShipIds:[5,1,2,3,4,6]});
  const row=result.recommendations[0];
  assert(row,JSON.stringify(result.guideWarnings));
  assert.deepEqual(row.profile.examples[0],['C','E','I','O']);
  assert.equal(row.scores.airGoalStatus,'meetsAlongRoute',JSON.stringify({
    score:row.route.lineOfSight.scoresByCoefficient[1],
    air:row.route.airControl.fleetAirPower,required:row.scores.airGoalRequired,
    scheme:row.scheme,search:result.search}));
  assert(row.route.lineOfSight.scoresByCoefficient[1]>=34);
  assert(row.scheme.ships.some(ship=>ship.slots?.includes(3010)||
    ship.slots?.includes(3011)));
  assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',row.scheme));
});

test('1-2 uses the five-ship light fleet that fixes the short boss route',()=>{
  const store=fixture();armSurfaceDestroyers(store);
  const result=recommendNormalFleet(store,{area:'1-2',preference:'shortest'});
  const row=result.recommendations[0];
  assert(row,JSON.stringify(result.guideWarnings));
  assert.deepEqual(row.profile.examples[0],['A','E']);
  assert.equal(row.scheme.ships.length,5);
  assert.equal(row.route.ships.filter(ship=>ship.stype===2).length,4);
  assert.equal(row.route.ships.filter(ship=>ship.stype===3).length,1);
  assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',row.scheme));
});

test('3-2 seeds six trained CL and DD rather than returning no fleet',()=>{
  const store=fixture();armSurfaceDestroyers(store);
  store.info.ships[1].api_lv=65;
  for(const id of [2,3,4,5,6])store.info.ships[id].api_lv=65;
  const result=recommendNormalFleet(store,{area:'3-2',preference:'shortest'});
  const row=result.recommendations[0];
  assert(row,JSON.stringify(result.guideWarnings));
  assert.equal(row.scheme.ships.length,6);
  assert(row.profile.examples.some(path=>path.at(-1)==='L'));
  assert.equal(row.route.ships.filter(ship=>ship.stype===2).length,5);
});

test('6-3 rejects ineligible large hulls and uses the seaplane tender light fleet',()=>{
  const store=fixture();armSurfaceDestroyers(store);
  store.const.$ships[7].api_stype=16;
  store.const.$ships[8].api_stype=8;
  store.const.$shipTypes[16]={api_equip_type:{}};
  for(const ship of Object.values(store.info.ships)){
    ship.api_lv=80;ship.api_sakuteki=[400,400];
  }
  const invalid=recommendNormalFleet(store,{area:'6-3',preference:'shortest',fixedShipIds:[8]});
  assert.equal(invalid.recommendations.length,0);
  const valid=recommendNormalFleet(store,{area:'6-3',preference:'shortest'});
  const row=valid.recommendations[0];
  assert(row,JSON.stringify(valid.guideWarnings));
  assert.equal(row.route.ships.filter(ship=>ship.stype===16).length,1);
  assert(row.route.ships.every(ship=>[2,3,16].includes(ship.stype)));
  assert(row.profile.examples.some(path=>path.at(-1)==='J'));
});

test('3-5 exposes trained lower and upper攻略 fleets instead of low-level cheap hulls',()=>{
  const store=fixture();
  store.info.basic.api_level=1;
  store.const.$shipTypes[11]={api_equip_type:{6:1,8:1}};
  store.const.$shipTypes[2]={api_equip_type:{1:1,24:1}};
  store.const.$equips[401]={api_id:401,api_name:'艦戦',
    api_type:[0,0,6,6],api_tyku:15};
  store.const.$equips[402]={api_id:402,api_name:'艦攻',
    api_type:[0,0,8,8],api_tyku:2};
  store.const.$equips[403]={api_id:403,api_name:'小口径主砲',api_type:[0,0,1,1]};
  store.const.$equips[404]={api_id:404,api_name:'大発動艇',api_type:[0,0,24,24]};
  for(let id=9;id<=27;id++){
    const type=id<=13?2:id===14?3:id<=17?11:id<=20?5:id===21?8:id>=26?2:22;
    const cost=id===27?3:type===2?15:type===3?25:type===11?70:type===5?40:type===8?100:1;
    const level=type===22?5:90;
    store.const.$ships[id]={...store.const.$ships[2],api_id:id,
      api_name:`3-5候选${id}`,api_stype:type,api_slot_num:2,
      api_maxeq:type===11?[30,30]:[0,0],api_fuel_max:cost,api_bull_max:cost};
    store.info.ships[id]={...store.info.ships[2],api_id:id,api_ship_id:id,
      api_lv:level,api_fuel:cost,api_bull:cost,api_sakuteki:[100,100],
      api_karyoku:[type===22?5:80,100],api_slot:[-1,-1],
      api_onslot:type===11?[30,30]:[0,0]};
    if(type===11){
      const fighter=500+id,attack=600+id;
      store.info.equips[fighter]={api_id:fighter,api_slotitem_id:401,api_level:0,api_alv:7};
      store.info.equips[attack]={api_id:attack,api_slotitem_id:402,api_level:0,api_alv:7};
      store.info.ships[id].api_slot=[fighter,attack];
    }else if(type===2){
      const first=700+id*2,second=first+1;
      const equipment=id===27?404:403;
      store.info.equips[first]={api_id:first,api_slotitem_id:equipment,api_level:0};
      store.info.equips[second]={api_id:second,api_slotitem_id:equipment,api_level:0};
      store.info.ships[id].api_slot=[first,second];
    }
  }
  const result=recommendNormalFleet(store,{area:'3-5'});
  assert.deepEqual(new Set(result.recommendations.flatMap(row=>row.preferences)),
    new Set(['shortest','strongest','lowestConsumption']),JSON.stringify(result.guideWarnings));
  const [short,strong,cheap]=['shortest','strongest','lowestConsumption'].map(mode=>
    result.recommendations.find(row=>row.preferences.includes(mode)));
  assert.deepEqual([short.guideStyle,strong.guideStyle,cheap.guideStyle],
    ['lower','upper','lower']);
  assert.deepEqual(short.profile.examples[0],['F','G','K']);
  assert.deepEqual(strong.profile.examples[0],['B','D','H','K']);
  assert.deepEqual(cheap.profile.examples[0],['F','G','K']);
  assert(result.recommendations.every(row=>row.scheme.ships.length===6&&
    row.scheme.ships.every(ship=>store.info.ships[ship.id].api_lv>=70)));
  assert(strong.route.airControl.fleetAirPower.min>=170);
  assert(cheap.scores.fullSupplyCostProxy<strong.scores.fullSupplyCostProxy);
  assert(!cheap.scheme.ships.some(ship=>ship.id===27),
    'a cheap destroyer carrying only landing craft is not combat ready');
  const airGoal=recommendNormalFleet(store,{area:'3-5',airGoal:'superiority'});
  const lowerAir=airGoal.recommendations.find(row=>row.preference==='shortest');
  const upperAir=airGoal.recommendations.find(row=>row.preference==='strongest');
  assert.equal(lowerAir.scores.routeAirReference.scope,'selectedRoute');
  assert.deepEqual(lowerAir.scores.routeAirReference.nodes.map(n=>n.id),['F','G','K']);
  assert.equal(lowerAir.scores.airGoalBaseRequired,35);
  assert.equal(lowerAir.scores.airGoalRequired,35);
  assert.equal(upperAir.scores.routeAirReference.scope,'selectedRoute');
  assert.deepEqual(upperAir.scores.routeAirReference.nodes.map(n=>n.id),['B','D','H','K']);
  assert.equal(upperAir.scores.airGoalBaseRequired,381);
  assert.equal(upperAir.scores.airGoalRequired,381);
  const unsafeFixed=recommendNormalFleet(store,{area:'3-5',preference:'lowestConsumption',
    fixedShipIds:[22]});
  assert.equal(unsafeFixed.recommendations.length,0);
  assert(unsafeFixed.guideWarnings.length>0);
});

test('surface combat score does not confuse ship level with hull firepower',()=>{
  const store=fixture();
  armSurfaceDestroyers(store);
  for(const id of [1,7]){
    store.const.$ships[id].api_stype=8;
    store.info.ships[id].api_lv=40;
    store.info.ships[id].api_karyoku=[150,150];
    store.info.ships[id].api_soukou=[100,100];
  }
  armCapitalShips(store,[1,7]);
  for(const id of [2,3,4,5])store.info.ships[id].api_lv=150;
  const destroyers=recommendNormalFleet(store,{area:'1-4',preference:'strongest',
    fixedShipIds:[2,3,4,5],excludedShipIds:[1,7]}).recommendations[0];
  const heavy=recommendNormalFleet(store,{area:'1-4',preference:'strongest',
    fixedShipIds:[1,7,2,3],excludedShipIds:[4,5,6,8]}).recommendations[0];
  assert(heavy.scores.surfaceStrengthProxy>destroyers.scores.surfaceStrengthProxy);
});

test('service recommendation methods use a snapshot and return reusable schemes',async()=>{
  const store=fixture(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'paa-rec-'));
  let workers=0;
  const service=new FleetAdvisorService({controller:new Controller({getStore:()=>store}),
    getStore:()=>store,storageDir:directory,createRecommendationWorker:(filename,options)=>{
      workers++;return new (require('worker_threads').Worker)(filename,options);
    }});
  try{
    const {snapshotId}=service.createSnapshot();
    const normal=await service.recommendNormalFleet({snapshotId,area:'1-1',limit:1});
    const expedition=await service.recommendExpeditionFleet({snapshotId,missionId:1,fleet:2,limit:1});
    assert.equal(normal.snapshotId,snapshotId);
    assert.equal(expedition.snapshotId,snapshotId);
    assert(normal.recommendations[0].scheme.ships.length>0);
    assert(expedition.recommendations[0].scheme.ships.length>0);
    const fitted=await service.recommendExpeditionEquipment({snapshotId,missionId:1,scheme:expedition.recommendations[0].scheme});
    assert.deepEqual(fitted.scheme.ships.map(s=>s.id),expedition.recommendations[0].scheme.ships.map(s=>s.id));
    assert.equal(workers,3,'fleet and equipment recommendations use the host-supplied worker factory');
  }finally{
    await service.dispose();
    const resolved=path.resolve(directory),tempRoot=path.resolve(os.tmpdir());
    assert(resolved.startsWith(tempRoot+path.sep),'temporary test directory stays under OS temp');
    fs.rmSync(resolved,{recursive:true,force:true});
  }
});


test('paired expedition goals preserve independent search ordering, equipment and manual constraints',()=>{
  const store=incomeEquipmentFixture(),r=require('../../src/recommendation/index');
  for(let id=101;id<=112;id++)addExpeditionItem(store,id,75);
  for(let id=201;id<=208;id++)addExpeditionItem(store,id,id>204?193:68,id%3);
  for(const id of [1,2,3,4])store.info.ships[id].api_cond=60;
  for(const ship of Object.values(store.info.ships))ship.api_taisen=[100,100];
  const before=JSON.stringify(store);
  for(const missionId of [1,5,21,37,38,101,103,142]){
    const args={missionId,fleet:2,limit:3},pair=r.recommendExpeditionGoals(store,args);
    for(const goal of ['success','great'])assert.deepEqual(pair[goal],r.recommendExpeditionFleet(store,{...args,goal}));
  }
  const args={missionId:37,fleet:2,fixedFlagshipId:1,fixedShipIds:[2],heldSlots:[null,{id:2,slots:[201,-1],ex:-1,keep:{0:true}}]};
  const pair=r.recommendExpeditionGoals(store,args);
  for(const goal of ['success','great']){
    assert.deepEqual(pair[goal],r.recommendExpeditionFleet(store,{...args,goal}));
    assert.equal(pair[goal].recommendations[0].scheme.ships[0].id,1);
    assert.equal(pair[goal].recommendations[0].scheme.ships.find(s=>s.id===2).slots[0],201);
  }
  assert.equal(JSON.stringify(store),before);
});


test('expedition ranking keeps distinct families when cheap duplicate ships would crowd out the next hull',()=>{
  const store=incomeEquipmentFixture(),r=require('../../src/recommendation/index');
  for(let id=101;id<=112;id++)addExpeditionItem(store,id,75);
  for(let id=201;id<=208;id++)addExpeditionItem(store,id,68,10);
  for(const ship of Object.values(store.info.ships))ship.api_cond=60;
  const args={missionId:37,fleet:2,limit:3,fixedShipIds:[1,2,3,4,5],fixedFlagshipId:1};
  const expected=r.recommendExpeditionGoals(store,args);
  for(let id=20;id<60;id++)store.info.ships[id]={...store.info.ships[2],api_id:id};
  const before=JSON.stringify(store),actual=r.recommendExpeditionGoals(store,args);
  for(const goal of ['success','great']){
    assert(actual[goal].recommendations.length);
    assert.deepEqual(actual[goal].recommendations,expected[goal].recommendations);
    for(const row of actual[goal].recommendations){
      assert.equal(row.scheme.ships.length,6);assert(row.scheme.ships.every(s=>s.id<20));
      assert.equal(row.scheme.ships[0].id,1);assert(row.evaluation.eligible);
    }
  }
  assert.equal(JSON.stringify(store),before);
});

test('expedition numeric score keys agree with the fallback for fractional and unsafe custom stats',()=>{
  const store=incomeEquipmentFixture(),r=require('../../src/recommendation/index');
  for(let id=101;id<=112;id++)addExpeditionItem(store,id,75);
  for(let id=201;id<=208;id++)addExpeditionItem(store,id,68,10);
  for(const ship of Object.values(store.info.ships)){
    ship.api_cond=60;
    for(const key of ['api_karyoku','api_taiku','api_taisen','api_sakuteki'])ship[key]=[100,100];
  }
  for(const missionId of [37,103,104]){
    const args={missionId,fleet:2,limit:3},expected=r.recommendExpeditionGoals(store,args);
    assert(expected.success.recommendations.length);
    for(const value of [.5,Number.MAX_SAFE_INTEGER]){
      const copy=structuredClone(store);
      copy.const.$ships[999]={...copy.const.$ships[2],api_id:999,api_name:'高消耗候选',api_fuel_max:100000,api_bull_max:100000};
      copy.info.ships[999]={...copy.info.ships[2],api_id:999,api_ship_id:999,api_lv:1,
        api_fuel:100000,api_bull:100000,api_sakuteki:[value,value]};
      const before=JSON.stringify(copy);
      assert.deepEqual(r.recommendExpeditionGoals(copy,args),expected,'an inferior custom hull switches the key path without affecting any candidate');
      assert.equal(JSON.stringify(copy),before);
    }
  }
});

test('expedition dominated hulls remain available after five better families are fixed',()=>{
  const store=fixture(),sixth=structuredClone(store.info.ships[6]);
  for(const id of [6,7,8])delete store.info.ships[id];
  for(const ship of Object.values(store.info.ships))ship.api_cond=60;
  store.const.$ships[9]={...store.const.$ships[2],api_id:9,api_name:'备用舰',api_fuel_max:100,api_bull_max:100};
  store.info.ships[9]={...store.info.ships[2],api_id:9,api_ship_id:9,api_fuel:100,api_bull:100};
  for(let id=20;id<30;id++)store.info.ships[id]={...store.info.ships[2],api_id:id};
  const args={missionId:1,fleet:2,goal:'great',fixedShipIds:[1,2,3,4,5]};
  const before=JSON.stringify(store),first=recommendExpeditionFleet(store,args).recommendations[0];
  assert.equal(first.evaluation.greatSuccess.estimatedPercent,100);
  assert(first.scheme.ships.some(s=>s.id===9),'five families and duplicate copies cannot remove the remaining legal hull');
  assert.equal(JSON.stringify(store),before);
  store.info.ships[6]={...sixth,api_cond:60};
  const second=recommendExpeditionFleet(store,args).recommendations[0];
  assert.equal(second.evaluation.greatSuccess.estimatedPercent,100);
  assert(second.scheme.ships.some(s=>s.id===6));assert(!second.scheme.ships.some(s=>s.id===9));
});
