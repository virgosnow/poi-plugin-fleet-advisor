'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateCandidate,projectFleet,lineOfSight}=require('../../../src/domain/fleet/fleet_metrics');

function fixture(){
  const equips={
    101:{api_slotitem_id:101,api_level:0},102:{api_slotitem_id:102,api_level:0},
    103:{api_slotitem_id:103,api_level:0},201:{api_slotitem_id:201,api_level:0,api_alv:7},
    202:{api_slotitem_id:202,api_level:0,api_alv:0},
    301:{api_slotitem_id:33,api_level:0},302:{api_slotitem_id:34,api_level:0}
  };
  const $equips={
    101:{api_name:'小型ソナー',api_type:[0,0,14,0],api_tais:4,api_saku:0},
    102:{api_name:'電探',api_type:[0,0,12,0],api_tais:0,api_saku:5},
    103:{api_name:'強化ソナー',api_type:[0,0,14,0],api_tais:9,api_saku:0},
    201:{api_name:'烈風',api_type:[0,0,6,0],api_tyku:10,api_saku:0},
    202:{api_name:'別の艦戦',api_type:[0,0,6,0],api_tyku:10,api_saku:0},
    33:{api_name:'改良型艦本式タービン',api_type:[0,0,17,0]},
    34:{api_name:'強化型艦本式缶',api_type:[0,0,17,0]}
  };
  return {info:{basic:{api_level:120},ships:{
    1:{api_ship_id:1,api_slot:[101,102],api_slot_ex:-1,api_onslot:[0,0],
      api_taisen:[95,0],api_sakuteki:[40,0],api_soku:10},
    2:{api_ship_id:2,api_slot:[201],api_slot_ex:0,api_onslot:[24],
      api_taisen:[0,0],api_sakuteki:[50,0],api_soku:10}},equips},
    const:{$ships:{1:{api_name:'测试驱逐',api_stype:2,api_soku:10,api_slot_num:2,api_maxeq:[0,0]},
      2:{api_name:'翔鶴改二甲',api_stype:18,api_soku:10,api_slot_num:1,api_maxeq:[24]}},$equips}};
}
const plan=(ship1={slots:[101,102],ex:-1},ship2={slots:[201],ex:0})=>({
  organization:{targets:[1,2]},equipment:{expected:[{shipId:1,state:ship1},{shipId:2,state:ship2}]}
});
test('per-ship metrics reuse unchanged outfits, retain order and expire with the immutable scope',()=>{
  const {withEquipmentIndexCache}=require('../../../src/domain/fleet/equipment_planner');
  const {evaluateProjectedCandidate}=require('../../../src/domain/fleet/fleet_metrics');
  const store=fixture(),base=plan(),changed=plan({slots:[301,302],ex:103});
  const expected=[base,changed].map(p=>evaluateCandidate(store,p));
  withEquipmentIndexCache(store,()=>{
    const first=evaluateCandidate(store,base),next=evaluateCandidate(store,changed);
    assert.deepEqual(first,expected[0]);assert.deepEqual(next,expected[1]);
    assert.strictEqual(first.speed.ships[1],next.speed.ships[1]);
    assert.strictEqual(first.openingASW.ships[1],next.openingASW.ships[1]);
    assert.notStrictEqual(first.speed.ships[0],next.speed.ships[0]);
    assert.notStrictEqual(first.openingASW.ships[0],next.openingASW.ships[0]);
    assert.deepEqual(evaluateProjectedCandidate(store,projectFleet(store,base)),first);
    const reversed={...base,organization:{targets:[2,1]}};
    assert.deepEqual(evaluateCandidate(store,reversed).openingASW.ships,first.openingASW.ships.slice().reverse());
    base.equipment.expected[0].state.slots=[301,302];
    assert.equal(evaluateCandidate(store,base).speed.ships[0].speed,'fastPlus');
  });
  store.info.ships[1].api_taisen=[110,0];store.info.equips[103].api_level=7;
  const live=evaluateCandidate(store,changed);
  assert.notDeepEqual(live.openingASW,expected[1].openingASW);
  assert.deepEqual(withEquipmentIndexCache(store,()=>evaluateCandidate(store,changed)),live);
});

test('fighter power uses per-slot flooring and visible proficiency as a range',()=>{
  const store=fixture();
  const current=evaluateCandidate(store,plan(),{enemyAirPower:40}).airPower;
  assert.deepEqual([current.min,current.max],[74,74]); // floor(10*sqrt(24)+22+sqrt(100..120/10))
  assert.equal(current.airState,'superiority');
  assert.equal(evaluateCandidate(store,plan(),{enemyAirPower:0}).airPower.airState,'supremacy');
  assert.equal(evaluateCandidate(store,plan({slots:[101,102],ex:-1},{slots:[0],ex:0}),
    {enemyAirPower:0}).airPower.airState,'noAirBattle');
  const alternative=evaluateCandidate(store,plan(undefined,{slots:[202],ex:0})).airPower;
  assert.deepEqual([alternative.min,alternative.max],[48,49]);
  assert.equal(alternative.slots[0].itemId,202);
});

test('33-style LoS reads HQ level, equipment coefficients and the candidate allocation',()=>{
  const store=fixture();
  const result=evaluateCandidate(store,plan(),{los:{coefficient:2,minimum:0,maximum:50}}).lineOfSight;
  const reference=Math.sqrt(35)+Math.sqrt(50)+2*(5*0.6)-48+8;
  assert(Math.abs(result.scoresByCoefficient[2]-Math.round(reference*100)/100)<0.001);
  assert.equal(result.selected.verdict,'fail');
  const changed=evaluateCandidate(store,plan({slots:[103,102],ex:-1})).lineOfSight;
  assert.equal(changed.status,'computed','changing a sonar with no LoS bonus does not make LoS uncertain');
  assert.equal(changed.rawScoresByCoefficient[2],result.rawScoresByCoefficient[2]);
});

test('post-change LoS retains the known hull contribution instead of dropping every ship sqrt',()=>{
  const store=fixture();store.const.$equips[102].api_saku=40;
  store.info.ships[1].api_sakuteki=[75,0];
  const reading=evaluateCandidate(store,plan({slots:[103,102],ex:-1}),
    {los:{coefficient:4,maximum:40}}).lineOfSight;
  assert.equal(reading.status,'computed');
  assert.equal(reading.lowerBoundScoresByCoefficient[4],56+Math.sqrt(35)+Math.sqrt(50));
  assert.equal(reading.selected.verdict,'pass');
  assert.equal(reading.rawScoresByCoefficient[4],reading.lowerBoundScoresByCoefficient[4]);
  assert.equal(evaluateCandidate(store,plan({slots:[103,102],ex:-1}),
    {los:{coefficient:4,maximum:57}}).lineOfSight.selected.verdict,'pass');
});

test('current speed is observed; propulsion changes and OASW use projected equipment',()=>{
  const store=fixture();
  const projected=projectFleet(store,plan({slots:[103,102],ex:-1}));
  assert.deepEqual(projected[0].after.slots,[103,102]);
  const result=evaluateCandidate(store,plan({slots:[103,102],ex:-1}));
  assert.equal(result.speed.fleetSpeed,'fast');
  assert.equal(result.speed.status,'observed');
  assert.equal(result.openingASW.ships[0].totalAswEstimate,100);
  assert.equal(result.openingASW.ships[0].eligible,true);
  assert.equal(result.openingASW.ships[0].predictedEligible,true);
  assert.equal(evaluateCandidate(store,plan()).openingASW.status,'computed');
  assert.equal(evaluateCandidate(store,plan()).openingASW.ships[1].eligible,false);
  const upgraded=evaluateCandidate(store,plan({slots:[301,302],ex:-1}));
  assert.equal(upgraded.speed.ships[0].speed,'fastPlus');
  assert.equal(upgraded.speed.ships[0].status,'computed');
  const expansion=evaluateCandidate(store,plan({slots:[101,102],ex:103}));
  assert.equal(expansion.openingASW.ships[0].totalAswEstimate,104);
  assert.equal(expansion.openingASW.ships[0].status,'computed');
});

test('speed groups distinguish an old boiler from a new boiler',()=>{
  const store=fixture();
  store.const.$ships[1].api_name='瑞鶴改二甲';
  const old=evaluateCandidate(store,plan({slots:[101,302],ex:301})).speed.ships[0];
  assert.equal(old.speed,'fastPlus');
  store.info.equips[303]={api_slotitem_id:87,api_level:0};
  store.const.$equips[87]={api_name:'新型高温高圧缶',api_type:[0,0,17,0]};
  const fresh=evaluateCandidate(store,plan({slots:[101,303],ex:301})).speed.ships[0];
  assert.equal(fresh.speed,'fastest');
});

test('missing HQ data never silently produces a LoS score',()=>{
  const store=fixture();delete store.info.basic;
  assert.equal(evaluateCandidate(store,plan()).lineOfSight.status,'unknown');
});

test('draft speed covers carrier, tender, special turbine and boiler groups',()=>{
  // Wiki speed table: equipment ids are turbine 33, old boiler 34, new boiler 87.
  const cases=[
    ['赤城改二',11,10,[33,87,87],'fastest'],
    ['千歳甲',16,10,[33,87,87],'fastPlus'],
    ['三隈改二特',16,10,[87],'fastPlus',7],
    ['飛鷹改',7,5,[33,87,87],'fastPlus'],
    ['大鯨',20,5,[33,34],'fast'],
    ['夕張改二特',3,5,[33],'fast'],
    ['Samuel B.Roberts Mk.Ⅱ',2,10,[33,87,87],'fastPlus'],
    ['Samuel B.Roberts改',2,5,[33],'fast'],
    ['伊203改',13,5,[87],'fast'],
    ['鳳翔改二',7,5,[33,87,87],'fastest'],
    ['武蔵改二',9,5,[33,87,87,87],'fastest'],
    ['武蔵改二',9,5,[33,87],'fastPlus',7],
    ['武蔵改二',9,5,[33,87],'fast',6],
    ['島風改',2,10,[87,87],'fastest',7],
    ['島風改',2,10,[87],'fast',6],
  ];
  for(const [name,type,base,gear,wanted,stars=0] of cases){
    const store=fixture();Object.assign(store.const.$ships[1],{api_name:name,api_stype:type,api_soku:base,api_slot_num:4});
    Object.assign(store.info.ships[1],{api_soku:base,api_slot:[-1,-1,-1,-1]});
    const slots=gear.map((masterId,i)=>{const id=400+i;store.info.equips[id]={api_slotitem_id:masterId,api_level:stars};return id;});
    slots.push(...Array(4-slots.length).fill(-1));
    const reading=evaluateCandidate(store,plan({slots,ex:-1})).speed;
    assert.equal(reading.ships[0].speed,wanted,name);assert.equal(reading.ships[0].status,'computed',name);
  }
});

test('missing speed data stays unknown only when it can change the resulting tier',()=>{
  const store=fixture();Object.assign(store.const.$ships[1],{api_name:'大鳳改',api_stype:18});
  store.info.equips[303]={api_slotitem_id:87};
  let reading=evaluateCandidate(store,plan({slots:[303,-1],ex:-1})).speed;
  assert.equal(reading.status,'unknown');assert.match(reading.ships[0].reason,/改修资料缺失/);
  reading=evaluateCandidate(store,plan({slots:[303,301],ex:-1})).speed;
  assert.equal(reading.status,'computed');assert.equal(reading.ships[0].speed,'fastest','turbine plus new boiler is fastest regardless of stars for Taiho');
  reading=evaluateCandidate(store,plan({slots:[999,-1],ex:-1})).speed;
  assert.equal(reading.status,'unknown');assert.match(reading.ships[0].reason,/装备资料缺失/);
  Object.assign(store.const.$ships[1],{api_name:'未收录特殊舰',api_stype:99,api_soku:5});
  reading=evaluateCandidate(store,plan({slots:[301,302],ex:-1})).speed;
  assert.equal(reading.status,'unknown');assert.match(reading.ships[0].reason,/未收录/);
});

test('removing propulsion restores base speed and an empty fleet has no speed',()=>{
  const store=fixture();Object.assign(store.const.$ships[1],{api_name:'未知特殊舰',api_stype:99,api_soku:5});
  Object.assign(store.info.ships[1],{api_soku:10,api_slot:[301,302]});
  const before=JSON.stringify(store);
  const reading=evaluateCandidate(store,plan({slots:[-1,-1],ex:-1})).speed;
  assert.equal(reading.ships[0].speed,'slow');assert.equal(reading.fleetSpeed,'slow');
  assert.equal(JSON.stringify(store),before);
  const empty=evaluateCandidate(store,{organization:{targets:[]},equipment:{expected:[]}}).speed;
  assert.equal(empty.fleetSpeed,null);assert.equal(empty.status,'unknown');
});

test('wikiwiki six-ship 33-formula example retains precision and HQ margin',()=>{
  const bases=[90,91,49,72,55,44];
  const gear=[
    {type:8,raw:6,stars:0,ship:0},{type:7,raw:2,stars:0,ship:0},
    {type:8,raw:4,stars:0,ship:1},{type:9,raw:9,stars:2,ship:1},
    {type:10,raw:3,stars:10,ship:2},{type:6,raw:3,stars:10,ship:3},
    {type:12,raw:4,stars:4,ship:5},
  ];
  const ships={},masters={},equips={},equipMasters={};
  bases.forEach((base,index)=>{
    const attached=gear.map((entry,gearIndex)=>({...entry,id:gearIndex+1}))
      .filter(entry=>entry.ship===index);
    ships[index+1]={api_ship_id:index+1,api_slot:attached.map(entry=>entry.id),api_slot_ex:-1,
      api_sakuteki:[base+attached.reduce((sum,entry)=>sum+entry.raw,0),0]};
    masters[index+1]={api_slot_num:attached.length};
  });
  gear.forEach((entry,index)=>{
    equips[index+1]={api_slotitem_id:index+1,api_level:entry.stars};
    equipMasters[index+1]={api_type:[0,0,entry.type],api_saku:entry.raw};
  });
  const store={info:{basic:{api_level:112},ships,equips},
    const:{$ships:masters,$equips:equipMasters}};
  const projected=projectFleet(store,{organization:{targets:[1,2,3,4,5,6]},
    equipment:{expected:[]}});
  const result=lineOfSight(store,projected,{los:{coefficient:2,maximum:70}});
  // Re-evaluating the source's written factors gives 71.0624266477;
  // its printed 71.06246647 has two transposed digits.
  assert(Math.abs(result.rawScoresByCoefficient[2]-71.0624266477)<1e-9);
  assert.equal(result.thresholdMargin,1);
  assert.equal(result.selected.verdict,'pass');
  delete store.const.$equips[7];
  assert.equal(lineOfSight(store,projected).status,'unknown');
});
