'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {completeCombatLoadout,emptyLoadout,availableEquipment}=require('../../src/recommendation/loadout/loadout_policy');
const {aviationBattleshipLoadouts}=require('../../src/recommendation/loadout/aviation_fitting');
const {recommendNormalEquipment,recommendNormalFleet}=require('../../src/recommendation/normal');
const {orderCarrierUtility}=require('../../src/domain/fleet/equipment_order');
const {openingAirStrike}=require('../../src/recommendation/scoring');
const profile={counts:{surface:{maximum:3},night:{maximum:0},asw:{maximum:0}},examples:[['A','D','E','H','L']]};
function fixture(){
  const store=require('../helpers/workbench_fixture')(),s=store.info.ships[1];
  store.const.$ships[6001]={...store.const.$ships[1],api_id:6001,api_name:'伊勢改二',api_stype:10,
    api_slot_num:5,api_maxeq:[2,2,22,22,9]};
  Object.assign(s,{api_ship_id:6001,api_slot:[-1,-1,-1,-1,-1],api_onslot:[2,2,22,22,9],api_karyoku:[100,100]});
  store.const.$shipTypes[10]={api_equip_type:{3:1,6:1,7:1,9:1,10:1,11:1,13:1,19:1}};
  const gear=[
    [1001,3,'主炮',{api_houg:20}],[1002,3,'主炮',{api_houg:20}],
    [1003,19,'一式徹甲弾',{api_houg:9}],[1101,11,'瑞雲12型',{api_baku:7,api_saku:6,api_tyku:3}],
    [1102,11,'瑞雲12型',{api_baku:7,api_saku:6,api_tyku:3}],[1201,10,'零式水上偵察機',{api_saku:9}],
    [1301,9,'彩雲',{api_saku:9}],[1302,9,'彩雲',{api_saku:9}],
    [1401,7,'彗星',{api_baku:13,api_tyku:2}],[1501,6,'烈風',{api_tyku:12}],
    [1601,13,'电探',{api_saku:5}]
  ];
  for(const [id,type,name,stats] of gear){
    store.const.$equips[id]={api_id:id,api_name:name,api_type:[0,0,type,type],...stats};
    store.info.equips[id]={api_id:id,api_slotitem_id:id,api_level:0,api_alv:7};
  }
  return store;
}
const scheme=()=>({fleet:1,ships:[{id:1,slots:[-1,-1,-1,-1,-1],ex:-1}]});
const type=(store,id)=>store.const.$equips[store.info.equips[id]?.api_slotitem_id]?.api_type[2];
const base=store=>completeCombatLoadout(store,scheme(),availableEquipment(store),{area:'1-4',profile});

test('aviation battleships start with a large-slot seaplane bomber and no unnecessary Saiun',()=>{
  const store=fixture(),before=JSON.stringify(store),entry=base(store).ships[0];
  assert.equal(type(store,entry.slots[2]),11);
  assert.equal(entry.slots.filter(id=>type(store,id)===3).length,2);
  assert(entry.slots.includes(1003));assert(!entry.slots.some(id=>type(store,id)===9));
  assert.equal(JSON.stringify(store),before);
});

test('water reconnaissance preserves spotting when bombers are unavailable or the route emphasizes night combat',()=>{
  for(const night of [false,true]){
    const store=fixture();if(!night)for(const id of [1101,1102])delete store.info.equips[id];
    const fitted=completeCombatLoadout(store,scheme(),availableEquipment(store),{
      area:'5-3',profile:{...profile,counts:{...profile.counts,night:{maximum:night?2:0}}}});
    assert(fitted.ships[0].slots.includes(1201));
    assert.equal(fitted.ships[0].slots[4],1201,'observation plane uses the smallest free legal positive slot');
    assert(!fitted.ships[0].slots.some(id=>type(store,id)===9));
  }
});

test('aviation fitting compares water bombers, safe reconnaissance and carrier bombers with observation',()=>{
  const store=fixture(),initial=base(store),before=JSON.stringify([store,initial]);
  const variants=aviationBattleshipLoadouts(store,initial,availableEquipment(store),{area:'1-4',profile});
  assert(variants.some(s=>s.ships[0].slots.includes(1101)));
  assert(variants.some(s=>s.ships[0].slots.includes(1201)&&!s.ships[0].slots.some(id=>[7,11].includes(type(store,id)))));
  const dive=variants.find(s=>s.ships[0].slots.includes(1401));assert(dive);
  assert.equal(dive.ships[0].slots[2],1401);assert.equal(dive.ships[0].slots[4],1201);
  for(const v of variants){assert(v.ships[0].slots.includes(1003));assert.equal(new Set(v.ships[0].slots.filter(id=>id>0)).size,v.ships[0].slots.filter(id=>id>0).length);}
  assert.equal(JSON.stringify([store,initial]),before);
});

test('aviation fitting preserves held items, held gaps and an explicitly held Saiun',()=>{
  const store=fixture(),held=[{id:1,slots:[1001,1002,1301,1003,-1],ex:-1,keep:{2:true,4:true}}];
  const initial=completeCombatLoadout(store,emptyLoadout(store,scheme(),held),availableEquipment(store),{area:'1-4',profile,heldSlots:held});
  for(const v of aviationBattleshipLoadouts(store,initial,availableEquipment(store),{area:'1-4',profile,heldSlots:held})){
    assert.equal(v.ships[0].slots[2],1301);assert.equal(v.ships[0].slots[4],-1);
  }
});

test('Ise-class utility ordering also moves required Saiun out of a large slot',()=>{
  const store=fixture(),initial={fleet:1,ships:[{id:1,slots:[1001,1002,1301,1003,1501],ex:-1}]};
  const fitted=orderCarrierUtility(store,initial);
  assert.equal(fitted.ships[0].slots[2],1501);assert.equal(fitted.ships[0].slots[4],1301);
});

test('real type-7 carrier bombers on aviation battleships receive opening aviation credit; type-8 torpedoes do not',()=>{
  const store=fixture(),row={id:1,ship:store.info.ships[1],master:store.const.$ships[6001],stype:10};
  assert.equal(openingAirStrike(store,[row],{ships:[{id:1,slots:[-1,-1,1401,-1,-1]}]}),13*Math.sqrt(22));
  store.const.$equips[1701]={api_id:1701,api_name:'艦攻',api_type:[0,0,8,8],api_raig:13};
  store.info.equips[1701]={api_id:1701,api_slotitem_id:1701};
  assert.equal(openingAirStrike(store,[row],{ships:[{id:1,slots:[-1,-1,1701,-1,-1]}]}),0);
});

test('1-4 normal equipment and fleet searches retain an observation plane and avoid optional reconnaissance cargo',()=>{
  const store=fixture(),before=JSON.stringify(store);
  const equipment=recommendNormalEquipment(store,{area:'1-4',scheme:scheme()});
  const full=recommendNormalFleet(store,{area:'1-4',fixedShipIds:[1,2,3,4,5,6],airGoal:'superiority'});
  assert(full.recommendations.length>0,full.reason);
  for(const fitted of [equipment.scheme,...full.recommendations.map(r=>r.scheme)]){
    assert(fitted.ships[0].slots.some(id=>[10,11].includes(type(store,id))));
    assert(!fitted.ships[0].slots.some(id=>type(store,id)===9));
  }
  assert.equal(JSON.stringify(store),before);
});

test('2-5 rechecks air fitting after the drums make the selected upper route reachable',()=>{
  const store=fixture();
  for(const id of [1,2]){
    store.info.ships[id]={...store.info.ships[1],api_id:id,api_soku:5,api_sakuteki:[100,100]};
    store.const.$ships[6001].api_soku=5;
  }
  store.const.$ships[6002]={...store.const.$ships[6001],api_id:6002,api_name:'日向改二'};
  store.info.ships[2].api_ship_id=6002;
  for(const id of [3,4]){
    store.const.$ships[id]={...store.const.$ships[id],api_stype:5,api_slot_num:4,api_maxeq:[2,2,2,2]};
    Object.assign(store.info.ships[id],{api_slot:[-1,-1,-1,-1],api_onslot:[2,2,2,2],api_sakuteki:[100,100]});
  }
  for(const id of [5,6])store.info.ships[id].api_sakuteki=[100,100];
  store.const.$shipTypes[2]={api_equip_type:{30:1}};
  store.const.$shipTypes[5]={api_equip_type:{3:1,10:1,13:1}};
  for(const [first,count] of [[1001,2],[1003,1],[1101,2],[1201,1],[1501,4],[1601,3]]){
    const master=store.const.$equips[first];
    for(let n=0;n<count;n++){
      const id=first*10+n;
      store.info.equips[id]={api_id:id,api_slotitem_id:master.api_id,api_alv:7};
    }
  }
  store.const.$equips[1801]={api_id:1801,api_name:'ドラム缶(輸送用)',api_type:[0,0,30,30]};
  for(const id of [1801,1802])store.info.equips[id]={api_id:id,api_slotitem_id:1801};
  for(const id of [1101,1102,1401])store.const.$equips[id].api_tyku=0;
  store.const.$equips[1501].api_tyku=7;
  for(const e of Object.values(store.info.equips))e.api_alv=0;
  const before=JSON.stringify(store),args={area:'2-5',routeKey:'B>F>J>O',
    scheme:{fleet:1,ships:[1,2,3,4,5,6].map(id=>({id}))}};
  const fitted=recommendNormalEquipment(store,args).scheme;
  const route=require('../../src/domain/routes/normal_routes').evaluateNormalRoute(store,{...args,scheme:fitted});
  const planning=require('../../src/domain/routes/route_plans').planningPath(route,['B','F','J','O']);
  assert.equal(planning.chance.probability,1);assert.equal(planning.losShortfall,0);
  const plan=require('../../src/domain/fleet/fleet_plan').createFleetPlanner(()=>store).preview('fleet',fitted);
  const metrics=require('../../src/domain/fleet/fleet_metrics').evaluateCandidate(store,plan);
  const profile=require('../../src/domain/routes/sortie_profile').profileForRoute('2-5',route,[['B','F','J','O']]);
  const air=require('../../src/domain/routes/route_air');
  assert(air.estimateRouteAir(metrics.airPower,air.routeAirReference(route,'2-5',profile)).margins.superiority.min>=0);
  assert.equal(JSON.stringify(store),before);
});
