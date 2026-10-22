'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/workbench_fixture');
const {recommendExpeditionFleet,recommendExpeditionEquipment}=require('../../src/recommendation/expedition');
const {DATA,evaluateExpedition}=require('../../src/domain/expeditions/expeditions');
const {Controller}=require('../../src/application/controller');
function hull(store,id,type,base={},slots=3,cost=15){
  store.const.$ships[id]={api_id:id,api_name:'候选舰'+id,api_stype:type,api_ctype:0,api_aftershipid:'0',api_slot_num:slots,
    api_maxeq:Array(slots).fill(0),api_tais:[type===7?1:0,99],api_fuel_max:cost,api_bull_max:cost};
  store.info.ships[id]={api_id:id,api_ship_id:id,api_lv:99,api_cond:60,api_fuel:cost,api_bull:cost,api_locked:1,
    api_slot:Array(slots).fill(-1),api_slot_ex:0,api_karyoku:[base.firepower||0,999],api_taiku:[base.antiAir||0,999],
    api_taisen:[base.asw||0,999],api_sakuteki:[base.los||0,999]};
}
function empty(){const s=fixture();s.info.ships={};s.const.$ships={};s.info.equips={};s.const.$equips={};return s;}
function item(store,id,master,type,stats){
  store.const.$equips[master]={api_id:master,api_name:'远征测试装备'+master,api_type:[0,0,type,0],...stats};
  store.info.equips[id]={api_id:id,api_slotitem_id:master,api_level:0};
}
function concealedHullFixture(){
  const s=empty();
  for(const type of [2,3,5])s.const.$shipTypes[type]={api_equip_type:{14:1}};
  const base={firepower:100,antiAir:100,los:100};
  hull(s,1,5,base,2);hull(s,2,3,base,2);
  for(let id=3;id<=14;id++){
    hull(s,id,2,{...base,asw:20},2);
    for(let k=0;k<2;k++){const eq=1000+id*2+k;item(s,eq,500,14,{api_tais:10});s.info.ships[id].api_slot[k]=eq;}
  }
  for(let id=15;id<=18;id++)hull(s,id,2,{...base,asw:19},3,16);
  return s;
}
test('monthly candidate generation finds unarmed hulls hidden below six currently equipped families',()=>{
  const store=concealedHullFixture(),before=JSON.stringify(store),args={missionId:111,fleet:2,fixedFlagshipId:1,limit:1};
  const witness=recommendExpeditionEquipment(store,{missionId:111,scheme:{fleet:2,ships:[1,2,15,16,17,18].map(id=>({id}))}});
  assert(witness.evaluation.eligible,'an owned, previewable outfit proves this fixture is feasible');
  for(const goal of ['success','great']){
    const result=recommendExpeditionFleet(store,{...args,goal}),row=result.recommendations[0];
    assert(row,JSON.stringify({goal,shortfalls:result.closestRecommendation?.shortfalls}));
    assert.equal(result.search.rescue,true,'the regular beam failed before independent hull ranking rescued it');
    assert(row.scheme.ships.some(s=>s.id>=15));assert.equal(result.closestRecommendation,undefined);
    assert(evaluateExpedition(store,2,111,row.scheme).eligible);
  }
  assert.equal(JSON.stringify(store),before);
});
const type={CL:3,DD:2,DE:1,DDorDE:2,CA:5,CAV:6,CT:21,SSLike:13,CVLike:7,CVL:7,CVE:7,CV:11,BB:9,BBV:10,AV:16,AS:20,AO:22,LHA:17};
function monthlyFixture(missionId,worn=false,composition=0){
  const s=empty(),spec=DATA.missions[missionId],types=Object.entries(spec.fleetCompos[composition]).flatMap(([key,n])=>Array(n).fill(type[key]));
  while(types.length<6)types.push(2);
  if(spec.flagshipType){const at=types.indexOf(type[spec.flagshipType]);assert(at>=0);[types[0],types[at]]=[types[at],types[0]];}
  const base=Object.fromEntries(Object.entries(spec.totals||{}).map(([key,n])=>[key,Math.max(0,Math.ceil(n/6)-3)]));
  types.forEach((t,i)=>{hull(s,i+1,t,base,4);s.const.$shipTypes[t]={api_equip_type:{1:1,30:1}};});
  for(let i=0;i<24;i++)item(s,2000+i,500,1,{api_houg:5,api_tyku:5,api_tais:5,api_saku:5});
  for(let i=0;i<10;i++)item(s,3000+i,75,30,{});
  if(worn)for(let id=1;id<=6;id++)for(let k=0;k<4;k++){
    const eq=4000+id*4+k;item(s,eq,501,1,{});s.info.ships[id].api_slot[k]=eq;
  }
  return s;
}
test('all monthly missions refit empty and full irrelevant outfits before classifying them as closest',()=>{
  for(const missionId of DATA.unlocks.monthly)for(let composition=0;composition<DATA.missions[missionId].fleetCompos.length;composition++)for(const worn of [false,true]){
    const store=monthlyFixture(missionId,worn,composition),before=JSON.stringify(store);
    for(const goal of ['success','great']){
      const result=recommendExpeditionFleet(store,{missionId,fleet:2,goal,limit:1}),row=result.recommendations[0];
      assert(row,JSON.stringify({missionId,composition,worn,goal,shortfalls:result.closestRecommendation?.shortfalls}));
      assert(row.evaluation.eligible);assert.equal(result.closestRecommendation,undefined);
      assert.doesNotThrow(()=>new Controller({getStore:()=>store}).preview('fleet',row.scheme));
    }
    assert.equal(JSON.stringify(store),before);
  }
});

test('rescue never restores excluded, busy, or manually emptied hull capacity',()=>{
  for(const mode of ['excluded','busy','manual']){
    const store=concealedHullFixture(),strong=[15,16,17,18];
    const args={missionId:111,fleet:2,fixedFlagshipId:1,goal:'great',limit:1};
    if(mode==='excluded')args.excludedShipIds=strong;
    if(mode==='busy'){store.info.fleets[2].api_ship=strong;store.info.fleets[2].api_mission=[1,1];}
    if(mode==='manual'){
      args.fixedShipIds=[1,2,...strong];
      args.heldSlots=[null,null,...strong.map(id=>({id,slots:[-1,-1,-1],ex:-1,keep:{0:true}}))];
    }
    const before=JSON.stringify(store),result=recommendExpeditionFleet(store,args);
    assert.equal(result.recommendations.length,0);assert(result.closestRecommendation);assert.equal(result.search.rescue,true);
    if(mode!=='manual')assert(result.closestRecommendation.scheme.ships.every(s=>!strong.includes(s.id)));
    else assert(result.closestRecommendation.scheme.ships.filter(s=>strong.includes(s.id)).every(s=>s.slots.every(id=>id<0)));
    assert.equal(JSON.stringify(store),before);
  }
});

test('monthly great-success drums never turn a feasible dispatch into an ineligible reference',()=>{
  const store=empty();store.const.$shipTypes[2]={api_equip_type:{1:1,30:1}};
  for(let id=1;id<=6;id++)hull(store,id,2,{firepower:40,antiAir:33,asw:26,los:20},2);
  for(let id=2000;id<2012;id++)item(store,id,500,1,{api_houg:6,api_tyku:6,api_tais:6,api_saku:6});
  for(let id=3000;id<3006;id++)item(store,id,75,30,{});
  const scheme={fleet:2,ships:[1,2,3,4,5,6].map(id=>({id}))};
  const witness=recommendExpeditionEquipment(store,{scheme,missionId:142,goal:'success'});
  assert(witness.evaluation.eligible);
  const fit=recommendExpeditionEquipment(store,{scheme,missionId:142,goal:'great'});
  assert(fit.evaluation.eligible,'four mandatory drums and eight attribute items fit; six drums do not');
  assert.equal(fit.evaluation.greatSuccess.drums,4);
  const searched=recommendExpeditionFleet(store,{missionId:142,fleet:2,goal:'great',limit:1});
  assert(searched.recommendations[0]?.evaluation.eligible);assert.equal(searched.closestRecommendation,undefined);
});

test('attribute fitting admits radar that supplies only a required blue synergy, not raw required stats',()=>{
  const store=empty();
  for(const id of [543,2,3,4])hull(store,id,2,{firepower:id===543?40:0,antiAir:20,asw:50},2);
  store.const.$ships[543].api_ctype=38;
  store.const.$shipTypes[2]={api_equip_type:{1:1,12:1}};
  item(store,2000,267,1,{api_houg:5});item(store,2001,28,12,{api_saku:5});
  const scheme={fleet:2,ships:[543,2,3,4].map(id=>({id}))};
  const witness={fleet:2,ships:[{id:543,slots:[2000,2001]},...scheme.ships.slice(1)]};
  assert(evaluateExpedition(store,2,101,witness).eligible);
  const result=recommendExpeditionEquipment(store,{missionId:101,scheme});
  assert(result.evaluation.eligible,'the radar unlocks +3 firepower even though mission 101 has no LoS requirement');
  assert(result.scheme.ships.find(s=>s.id===543).slots.includes(2001));
});

test('mandatory drums reserve scarce ASW-compatible slots instead of filling the first three carriers',()=>{
  const store=empty(),types=[2,2,3,16,7,7];
  types.forEach((type,i)=>hull(store,i+1,type,{antiAir:40,los:30},type===16?4:2));
  for(const type of [2,3])store.const.$shipTypes[type]={api_equip_type:{14:1,30:1}};
  store.const.$shipTypes[16]={api_equip_type:{30:1}};store.const.$shipTypes[7]={api_equip_type:{}};
  for(let id=2000;id<2004;id++)item(store,id,500,14,{api_tais:50});
  for(let id=3000;id<3008;id++)item(store,id,75,30,{});
  const scheme={fleet:2,ships:[1,2,3,4,5,6].map(id=>({id}))};
  const witness={fleet:2,ships:[{id:1,slots:[3000,2000]},{id:2,slots:[3001,2001]},
    {id:3,slots:[2002,2003]},{id:4,slots:[3002,3003,3004,3005]},{id:5},{id:6}]};
  assert(evaluateExpedition(store,2,44,witness).eligible);
  for(const goal of ['success','great']){
    const fit=recommendExpeditionEquipment(store,{missionId:44,goal,scheme});
    assert(fit.evaluation.eligible,'transport-only AV slots can hold four drums, leaving four sonar slots');
    assert.equal(fit.evaluation.greatSuccess.drums,6);
  }
});
