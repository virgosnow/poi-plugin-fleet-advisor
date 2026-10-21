'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {equipmentRewardRate,rewardBonus,resupplyCost,grossReward,missionIncome}=require('../../../src/domain/expeditions/expedition_income');
const DATA=require('../../../data/expedition_rewards.json');
const ship=(items=[],masterId=1)=>({masterId,equipment:items.map(([masterId,stars=0])=>({masterId,stars}))});

test('Wiki landing-craft examples include improvement averages, innate bonus and special synergy',()=>{
  const examples=[
    [ship([[68,10],[68,10]]),.10,.01,0],
    [ship(Array(4).fill([68,10])),.20,.02,0],
    [ship([...Array(4).fill([68,10]),[68,0]]),.20,.016,0],
    [ship([[193,10],[193,10],[193,10]],487),.20,.02,.05],
    [ship([...Array(4).fill([193,10]),...Array(4).fill([68,10])]),.20,.02,.06],
  ];
  for(const [fleet,base,stars,synergy] of examples){
    const result=rewardBonus([fleet]);
    assert(Math.abs(result.baseRate-base)<1e-12);assert(Math.abs(result.improvementRate-stars)<1e-12);
    assert(Math.abs(result.synergyRate-synergy)<1e-12);assert(Math.abs(result.totalRate-base-stars-synergy)<1e-12);
  }
  const innate=rewardBonus([ship([],487)]);assert.equal(innate.totalRate,.05);assert.equal(innate.equipmentCount,0);
  assert.equal(rewardBonus([ship([[193],[193],[193],[68],[68]],487)]).synergyRate,.052,'innate bonus is not a physical normal craft');
  assert.equal(rewardBonus([ship([[193],[193],[193],[526]])]).synergyRate,.05,'a 5% vehicle does not substitute for normal craft');
  assert.equal(equipmentRewardRate(230),0);assert.equal(rewardBonus([ship([[230,10]])]).totalRate,0);
});

test('special-craft synergy is floored separately for ordinary and great success',()=>{
  const bonus=rewardBonus([ship([[193]])]);
  assert.equal(grossReward(30,bonus),31,'floor(30*1.05) + floor(30*.02)');
  assert.equal(grossReward(30,bonus,true),47,'floor(45*1.05) + floor(45*.02)');
  const exact=rewardBonus([ship([[68],[68],[525]])]);
  assert.equal(grossReward(350,exact),399,'integer fraction preserves the exact boundary');
  assert.equal(grossReward(350,exact,true),598);
  assert.equal(grossReward(0,bonus,true),0);
});

test('resupply floors base consumption first, then applies marriage discount and minimum one',()=>{
  const fleet=[{fuelCapacity:15,ammoCapacity:20,married:true}];
  assert.deepEqual(resupplyCost(fleet,{fuel:.5,ammo:.3}),{fuelCost:5,ammoCost:5});
  assert.deepEqual(resupplyCost([{fuelCapacity:5,ammoCapacity:5,married:true}],{fuel:.2,ammo:0}),{fuelCost:1,ammoCost:0});
  assert.deepEqual(resupplyCost([{...fleet[0],married:false}],{fuel:.5,ammo:.3}),{fuelCost:7,ammoCost:6});
  assert.deepEqual(resupplyCost([...fleet,...fleet],{fuel:.5,ammo:.3}),{fuelCost:10,ammoCost:10});
  assert.deepEqual(resupplyCost([{fuelCapacity:90,ammoCapacity:90,married:false}],{fuel:.7,ammo:.7}),{fuelCost:63,ammoCost:63},'exact percentage boundary');
});

test('fresh Wiki resources and provenance cover all 63 supported expeditions',()=>{
  assert.equal(Object.keys(DATA.missions).length,63);
  assert.deepEqual(DATA.missions[110].resources,[0,0,20,30]);
  assert.deepEqual(DATA.missions[17].resources,[70,90,50,0]);
  assert.deepEqual(DATA.missions[18].resources,[0,0,300,150]);
  assert.deepEqual(DATA.missions[23].resources,[0,50,0,130]);
  assert.equal(DATA.missions[101].wikiId,'A2');assert.equal(DATA.missions[132].wikiId,'D2');
  for(const source of DATA.sources){assert(source.url.startsWith('https://wikiwiki.jp/kancolle/'));assert.match(source.sha256,/^[a-f0-9]{64}$/);}
});

test('mission income uses selected equipment, separate reward floors and net supply costs without mutating the snapshot',()=>{
  const store={const:{$missions:{1:{api_use_fuel:.5,api_use_bull:0}},$ships:{1:{api_fuel_max:15,api_bull_max:20}}},
    info:{ships:{7:{api_ship_id:1,api_lv:100,api_slot:[-1],api_slot_ex:-1}},equips:{10:{api_slotitem_id:193,api_level:0}}}};
  const before=JSON.stringify(store),result=missionIncome(store,[{id:7,slots:[10],ex:-1}],1);
  assert.equal(result.bonus,.07);assert.deepEqual(result.cost,{fuelCost:5,ammoCost:0});
  const ammo=result.rows.find(r=>r.name==='弹药');assert.equal(ammo.success,31);assert.equal(ammo.great,47);
  const fuel=result.rows.find(r=>r.name==='燃料');assert.equal(fuel.net,-5);assert.equal(fuel.greatNet,-5);
  assert.equal(JSON.stringify(store),before);
  assert.equal(missionIncome(store,[{id:99}],1),null);assert.equal(missionIncome(store,[{id:7}],999),null);
});
