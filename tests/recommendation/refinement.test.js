'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {positionUpgrades,combineUpgrades}=require('../../src/recommendation/refinement');
const row=(id,stype,power,family=id)=>({id,stype,power,ship:{api_ship_id:family},master:{api_yomi:String(family)}});
const score=r=>r.power;
const options={lockedIds:new Set(),score};

test('a strong light carrier is compared before related carriers with larger naked-hull estimates',()=>{
  const rows=[row(1,7,50)],roster=[...rows,row(2,7,80),row(3,7,70),row(4,11,200),row(5,18,190)];
  const choices=positionUpgrades(rows,roster,options)[0].choices;
  assert.deepEqual(choices.map(r=>r.id),[2,3,4,5]);
});

test('every editable fleet position gets an independent choice even when other positions have huge gains',()=>{
  const rows=[row(1,8,50),row(2,2,50),row(3,2,50),row(4,7,50),row(5,13,50),row(6,20,50)];
  const upgrades=rows.map((r,i)=>row(i+11,r.stype,i===0?1000:80));
  const before=JSON.stringify([rows,upgrades]);
  const groups=positionUpgrades(rows,[...rows,...upgrades],options);
  assert.deepEqual(groups.map(g=>g.index),[0,1,2,3,4,5]);
  assert(groups.every(g=>g.choices.length));
  assert.equal(JSON.stringify([rows,upgrades]),before);
});

test('fixed ships, named-ship restrictions and duplicate families remain excluded from upgrade choices',()=>{
  const rows=[row(1,2,50,'a'),row(2,7,50,'b')],roster=[...rows,
    row(3,2,80),row(4,7,90,'a'),row(5,7,80),row(6,7,70)];
  const groups=positionUpgrades(rows,roster,{...options,lockedIds:new Set([1]),allowed:r=>r.id!==5});
  assert.deepEqual(groups.map(g=>g.index),[1]);assert.deepEqual(groups[0].choices.map(r=>r.id),[6]);
});

test('cross-type alternatives remain available when no same-type upgrade is usable',()=>{
  const rows=[row(1,7,50)],roster=[...rows,row(2,7,40),row(3,11,80),row(4,18,70),row(5,9,500)];
  assert.deepEqual(positionUpgrades(rows,roster,options)[0].choices.map(r=>r.id),[3,4]);
});

test('independent cruiser and carrier gains combine with the latest improved destroyer',()=>{
  const original=[row(1,2,30),row(2,5,30),row(3,7,30)],latest=[row(11,2,70),...original.slice(1)];
  const gains=[{index:0,row:latest[0],gain:80},{index:1,row:row(12,5,60),gain:60},
    {index:2,row:row(13,7,50),gain:40}];
  const before=JSON.stringify([latest,gains]),combined=combineUpgrades(latest,gains,new Set());
  assert.deepEqual(combined.map(r=>r.id),[11,12,13]);
  assert.equal(JSON.stringify([latest,gains]),before);
});

test('combining individually valid gains never duplicates a ship family or changes a locked ship',()=>{
  const rows=[row(1,2,30,'a'),row(2,2,30,'b'),row(3,7,30,'c')];
  const combined=combineUpgrades(rows,[{index:0,row:row(11,2,60,'x'),gain:100},
    {index:1,row:row(12,2,60,'x'),gain:90},{index:2,row:row(13,7,100),gain:200}],new Set([3]));
  assert.deepEqual(combined.map(r=>r.id),[11,2,3]);
});

test('a changed fleet is matched by original ship identity when rebasing independent upgrades',()=>{
  const rows=[row(2,7,30),row(1,2,30),row(3,5,90)];
  const combined=combineUpgrades(rows,[{index:1,beforeId:2,row:row(12,7,80),gain:50},
    {index:2,beforeId:4,row:row(14,5,60),gain:30}],new Set());
  assert.deepEqual(combined.map(r=>r.id),[12,1,3]);
});

function mergedRouteFixture(){
  const store=require('../helpers/workbench_fixture')(),types=[8,20,2,2,13,7,3];
  delete store.info.ships[8];delete store.const.$ships[8];
  types.forEach((stype,i)=>{
    const id=i+1,caps=stype===7?[24,18,20,4]:stype===8?[1,1,1,1]:stype===13?[0,0]:[1,1,1];
    Object.assign(store.const.$ships[id],{api_stype:stype,api_name:'测试舰'+id,api_slot_num:caps.length,api_maxeq:caps,api_soku:5});
    Object.assign(store.info.ships[id],{api_lv:70,api_slot:caps.map(()=>-1),api_onslot:caps.slice(),api_soku:5,
      api_karyoku:[stype===3?0:stype===8?80:50,100],api_raisou:[stype===2||stype===13?80:0,100],
      api_soukou:[stype===3?20:60,100],api_sakuteki:[50,100]});
    store.const.$shipTypes[stype]={api_equip_type:Object.fromEntries((stype===7?[6,7,8]:stype===3?[1,10,45]:
      stype===8?[3,10,19]:stype===13?[5]:[1,10]).map(t=>[t,1]))};
  });
  const gear=[[1,{api_houg:10}],[3,{api_houg:20}],[5,{api_raig:10}],
    [6,{api_tyku:15}],[7,{api_baku:13,api_tyku:4}],[8,{api_raig:13,api_tyku:4}],
    [10,{api_saku:9}],[19,{api_houg:9}],[45,{api_tyku:40}]];
  for(const [type,stats] of gear){
    store.const.$equips[type]={api_id:type,api_name:'测试装备'+type,api_type:[0,0,type,type],...stats};
    for(let i=0;i<(type===45?1:16);i++){
      const id=type*100+i;store.info.equips[id]={api_id:id,api_slotitem_id:type,api_alv:7};
    }
  }
  return store;
}

test('merged Boss routes do not buy a small branch-probability gain by dropping a much stronger carrier',()=>{
  const store=mergedRouteFixture(),before=JSON.stringify(store),area='1-4',routeKey='B>C>F>E>H>L';
  const {recommendNormalEquipment,recommendNormalFleet}=require('../../src/recommendation/normal');
  const plans=require('../../src/domain/routes/route_plans'),routes=require('../../src/domain/routes/normal_routes');
  const option=plans.routeOptions(area,'boss').find(o=>o.key===routeKey),comparisons=[];
  for(const id of [6,7]){
    const fitted=recommendNormalEquipment(store,{area,routeKey,scheme:{fleet:1,ships:[1,2,3,4,5,id].map(id=>({id}))}});
    const route=routes.evaluateNormalRoute(store,{area,scheme:fitted.scheme});
    comparisons.push({boss:route.probability,branch:plans.optionPlanning(route,option).chance.probability});
  }
  assert.equal(comparisons[0].boss,1);assert.equal(comparisons[1].boss,1);
  assert(comparisons[1].branch>comparisons[0].branch);
  const result=recommendNormalFleet(store,{area,routeKey,byRoute:true,airGoal:'superiority',fixedShipIds:[1,2,3,4,5]});
  const row=result.recommendations[0];assert(row);assert(row.scheme.ships.some(e=>e.id===6));
  assert.equal(row.route.probability,1);assert.equal(row.scores.airGoalTier,3);
  assert.equal(JSON.stringify(store),before);
});

test('local replacement of a carrier with a closed expansion retains a legal, fully fitted candidate',()=>{
  const store=mergedRouteFixture();
  store.info.ships[6].api_slot_ex=-1;
  store.const.$ships[8]={...store.const.$ships[6],api_id:8,api_name:'备用强力轻母',api_maxeq:[28,24,20,4]};
  store.info.ships[8]={...store.info.ships[6],api_id:8,api_ship_id:8,api_slot_ex:0,api_onslot:[28,24,20,4]};
  const {recommendNormalEquipment,recommendationBatch}=require('../../src/recommendation/normal');
  const area='1-4',routeKey='B>C>F>E>H>L',args={area,byRoute:true,airGoal:'superiority',fixedShipIds:[1,2,3,4,5]};
  const base=recommendNormalEquipment(store,{area,routeKey,scheme:{fleet:1,ships:[1,2,3,4,5,6].map(id=>({id}))}});
  const before=JSON.stringify(store),option=require('../../src/domain/routes/route_plans').routeOptions(area,'boss').find(o=>o.key===routeKey);
  const [result]=recommendationBatch(store,{kind:'refinement',args,items:[{ids:[1,2,3,4,5,8],base:{scheme:base.scheme,profile:base.profile},option}]});
  assert(result.candidate,'a closed expansion must not disqualify an otherwise legal upgrade');
  const entry=result.candidate.scheme.ships.find(e=>e.id===8);assert.equal(entry.ex,-1);
  assert.equal(result.candidate.scores.airGoalTier,3);
  const plan=require('../../src/domain/fleet/fleet_plan').createFleetPlanner(()=>store).preview('fleet',result.candidate.scheme);
  assert.equal(plan.equipment.expected.find(e=>e.shipId===8).state.ex,0);
  assert.equal(JSON.stringify(store),before);
});
