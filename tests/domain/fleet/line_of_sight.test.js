'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {lineOfSight,losPredicate}=require('../../../src/domain/fleet/line_of_sight');
const {projectFleet}=require('../../../src/domain/fleet/fleet_metrics');
function fixture(){
  const ships={1:{api_ship_id:1,api_slot:[-1,-1],api_slot_ex:-1,api_sakuteki:[47,49]},
    2:{api_ship_id:2,api_slot:[-1,-1],api_slot_ex:-1,api_sakuteki:[50,51]}};
  const store={info:{basic:{api_level:120},ships,equips:{}},const:{$ships:{
    1:{api_stype:2,api_ctype:1,api_aftershipid:'0',api_slot_num:2},
    2:{api_stype:2,api_ctype:91,api_aftershipid:'0',api_slot_num:2}},$equips:{}}};
  const add=(id,masterId,type,raw,star=0)=>{
    store.info.equips[id]={api_slotitem_id:masterId,api_level:star};
    store.const.$equips[masterId]={api_type:[0,0,type,0],api_saku:raw};return id;
  };
  add(101,129,39,2);add(102,315,12,8);add(103,456,12,10);
  add(104,1,1,0);add(105,129,39,2);add(106,9999,12,8);
  const read=(slots1=[-1,-1],slots2=[-1,-1],ex=-1)=>lineOfSight(store,projectFleet(store,{
    organization:{targets:[1,2]},equipment:{expected:[{shipId:1,state:{slots:slots1,ex}},
      {shipId:2,state:{slots:slots2,ex:-1}}]}}));
  return {store,read,add};
}
const close=(a,b)=>assert(Math.abs(a-b)<1e-10,`${a} != ${b}`);
test('wiki-confirmed Shiun and SOC Seagull bonuses are exact and follow hull and improvement conditions',()=>{
  for(const [id,ctype,stype,raw,stars,bonus] of [
    [118,52,3,8,0,2],[118,52,3,8,10,3],[118,91,2,8,10,0],
    [414,91,2,4,0,1],[414,99,3,4,0,2],[414,99,3,4,3,3],
    [414,1,2,4,10,0]
  ]){
    const {store,read,add}=fixture();Object.assign(store.const.$ships[1],{api_ctype:ctype,api_stype:stype});
    add(110,id,10,raw,stars);
    let result=read([110,-1]);assert.equal(result.status,'computed',`${id} stars ${stars}`);
    assert.equal(result.ships[0].bonusAfter,bonus);assert.equal(result.ships[0].baseSearchEstimate,47+bonus);
    assert.equal(result.lowerBoundScoresByCoefficient[1],result.upperBoundScoresByCoefficient[1]);
    // Removing the same outfit must remove its panel bonus once, without
    // retaining it in the hull or mutating the observed API values.
    store.info.ships[1].api_slot=[110,-1];store.info.ships[1].api_sakuteki=[47+raw+bonus,49];
    result=read();assert.equal(result.status,'computed');assert.equal(result.ships[0].intrinsicSearch,47);
    assert.equal(result.ships[0].bonusAfter,0);
  }
});
test('submarine small seaplane routing bonuses track model, hull, stars and cumulative outfits',()=>{
  for(const [id,stype,star,bonus] of [[522,14,0,3],[522,14,5,4],[523,14,0,4],[523,14,5,5],
    [522,13,10,0],[523,13,10,0]]){
    const {store,read,add}=fixture();store.const.$ships[1].api_stype=stype;
    const raw=id===522?3:4;add(110,id,10,raw,star);add(111,id,10,raw,star);
    const result=read([110,111]);assert.equal(result.status,'computed');
    assert.equal(result.ships[0].bonusAfter,bonus*2);
    assert.equal(result.ships[0].baseSearchEstimate,47+bonus*2);
    store.info.ships[1].api_slot=[110,111];store.info.ships[1].api_sakuteki=[47+2*(raw+bonus),49];
    const removed=read();assert.equal(removed.status,'computed');assert.equal(removed.ships[0].intrinsicSearch,47);
  }
});
test('carrier recon shared improvement bonus is exact without promoting exclusive unverified bonuses',()=>{
  for(const [star,bonus]of [[0,0],[1,0],[2,1],[5,1],[6,2],[9,2],[10,3]]){
    const {store,read,add}=fixture();store.const.$ships[1].api_stype=11;
    add(110,212,9,10,star);add(111,61,9,7,2);
    const result=read([110,111]);assert.equal(result.status,'computed');
    assert.equal(result.ships[0].bonusAfter,Math.max(bonus,1),'shared category bonus uses the highest improvement only');
    store.info.ships[1].api_slot=[110,-1];store.info.ships[1].api_sakuteki=[57+bonus,49];
    const unchanged=read([110,-1]);assert.equal(unchanged.status,'computed');
    assert.equal(unchanged.ships[0].baseSearchEstimate,47+bonus);
  }
  const {store,read,add}=fixture();Object.assign(store.const.$ships[1],{api_stype:11,api_ctype:78});
  add(110,423,9,4,10);const uncertain=read([110,-1]);assert.equal(uncertain.status,'estimate');
  assert.deepEqual(uncertain.ships[0].routingBonus,[3,7],'Fulmar exclusive bonus remains uncertain, shared +3 does not');
  const unchanged=read();assert.equal(unchanged.status,'computed','other outfits must not inherit uncertainty from cached trials');
});
test('LoS removes old blue bonuses and adds the actual candidate bonus once, including expansion gear',()=>{
  const {store,read}=fixture();
  store.info.ships[1].api_slot=[101,-1];store.info.ships[1].api_sakuteki=[50,49]; // 47 + 2 + 1
  const removed=read([104,-1]),equipped=read([104,-1],undefined,105);
  assert.equal(removed.status,'computed');assert.equal(removed.ships[0].intrinsicSearch,47);
  assert.equal(removed.ships[0].bonusBefore,1);assert.equal(removed.ships[0].bonusAfter,0);
  close(removed.rawScoresByCoefficient[1],Math.sqrt(47)+Math.sqrt(50)-40);
  assert.equal(equipped.ships[0].bonusAfter,1);assert.equal(equipped.ships[0].baseSearchEstimate,48);
  close(equipped.rawScoresByCoefficient[1],Math.sqrt(48)+Math.sqrt(50)+1.2-40);
  const swapped=read([105,-1]);assert.equal(swapped.status,'computed');
  assert.equal(swapped.ships[0].equipmentChanged,false,'same master/star across instances is the same effective outfit');
  assert.equal(swapped.rawScoresByCoefficient[1],equipped.rawScoresByCoefficient[1]);
});
test('SG initial routing bonus is included after its game fix; removing a known panel bonus restores intrinsic LoS',()=>{
  const {store,read}=fixture();let result=read(undefined,[102,-1]);
  assert.equal(result.status,'computed');assert.equal(result.ships[1].bonusAfter,4);
  assert.equal(result.ships[1].baseSearchEstimate,54);
  store.info.ships[2].api_slot=[103,-1];store.info.ships[2].api_sakuteki=[64,51]; // 50 + 10 + 4
  result=read();assert.equal(result.status,'computed');assert.equal(result.ships[1].intrinsicSearch,50);
  assert.equal(result.ships[1].baseSearchEstimate,50,'unknown route effectiveness does not prevent removing a known panel bonus');
});
test('unverified routing bonuses keep finite bounds and cannot create false minimum or upper-window passes',()=>{
  const {read}=fixture(),result=read(undefined,[103,-1]),c=3;
  assert.equal(result.status,'estimate');
  const lo=Math.sqrt(47)+Math.sqrt(50)+6*c-40,hi=Math.sqrt(47)+Math.sqrt(54)+6*c-40;
  close(result.lowerBoundScoresByCoefficient[c],lo);close(result.upperBoundScoresByCoefficient[c],hi);
  assert.equal(losPredicate(result,{coefficient:c,gte:lo-.01}),true);
  assert.equal(losPredicate(result,{coefficient:c,gte:hi+.01}),false);
  assert.equal(losPredicate(result,{coefficient:c,gte:(lo+hi)/2}),null);
  assert.equal(losPredicate(result,{coefficient:c,gte:lo-.01,lt:hi+.01}),true);
  assert.equal(losPredicate(result,{coefficient:c,lt:(lo+hi)/2}),null);
  assert.equal(losPredicate(result,{coefficient:c,lt:lo}),false);
});
test('unknown new equipment retains known hulls, but missing old bonuses never become an exact intrinsic value',()=>{
  const {store,read}=fixture();let result=read([106,-1]);
  assert.equal(result.status,'estimate');assert.equal(result.ships[0].intrinsicSearch,47);
  close(result.lowerBoundScoresByCoefficient[1],Math.sqrt(47)+Math.sqrt(50)+4.8-40);
  assert.equal(result.upperBoundScoresByCoefficient[1],null);
  store.info.ships[1].api_slot=[106,-1];store.info.ships[1].api_sakuteki=[55,49];
  result=read();assert.equal(result.status,'estimate');assert.equal(result.ships[0].intrinsicSearch,null);
  close(result.lowerBoundScoresByCoefficient[1],Math.sqrt(50)-40,'the other ship remains in the bound');
  delete store.info.ships[1].api_sakuteki;assert.equal(read().status,'unknown');
});
test('HQ margin and raw unrounded scores remain part of interval validation for all four coefficients',()=>{
  const {store,read}=fixture();store.info.basic.api_level=112;
  const result=read([101,-1]);assert.equal(result.status,'computed');assert.equal(result.thresholdMargin,1);
  for(const c of [1,2,3,4]){
    const score=result.rawScoresByCoefficient[c];
    assert.equal(losPredicate(result,{coefficient:c,gte:score-1}),true);
    assert.equal(losPredicate(result,{coefficient:c,gte:score-.9}),null);
    assert.equal(losPredicate(result,{coefficient:c,lt:score}),null);
    assert.equal(losPredicate(result,{coefficient:c,lt:score+.01}),true);
  }
});
test('every normal-map LoS predicate respects its own coefficient, strict upper edge and HQ margin',()=>{
  const fs=require('fs'),path=require('path'),{predicate}=require('../../../src/domain/routes/normal_routes');
  const root=path.join(__dirname,'../../../data/normal_routes');let maps=0,gates=0;
  const collect=v=>!v||typeof v!=='object'?[]:v.los?[v.los]:
    Object.values(v).flatMap(x=>Array.isArray(x)?x.flatMap(collect):collect(x));
  for(const name of fs.readdirSync(root).filter(n=>/^\d-\d\.json$/.test(n))){
    const all=Object.values(require(path.join(root,name)).machineRules||{}).flatMap(rules=>rules.flatMap(r=>collect(r.when)));
    if(all.length)maps++;
    for(const gate of all){gates++;for(const border of [gate.gte,gate.lt].filter(Number.isFinite)){
      for(const delta of [-.001,0,.001])for(const margin of [0,1,2]){
        const value=border+delta,reading={status:'computed',thresholdMargin:margin,
          rawScoresByCoefficient:{1:999,2:999,3:999,4:999,[gate.coefficient]:value}};
        const floor=gate.gte??-Infinity,ceiling=gate.lt??Infinity;
        // Both endpoints can fail while the interval crosses a narrow valid
        // window; endpoint equality alone must never prove that rule false.
        const expected=value<floor||value-margin>=ceiling?false:
          value-margin>=floor&&value<ceiling?true:null;
        assert.equal(predicate({los:gate},[],{lineOfSight:reading}),expected,`${name} ${JSON.stringify(gate)}`);
        const bounded={...reading,status:'estimate',lowerBoundScoresByCoefficient:{[gate.coefficient]:value},
          upperBoundScoresByCoefficient:{[gate.coefficient]:value}};
        assert.equal(predicate({los:gate},[],{lineOfSight:bounded}),expected,name);
      }
    }}
  }
  assert(maps>=15);assert(gates>=50);
});

test('per-ship LoS reuse preserves exact slot changes and refreshes observed panels between searches',()=>{
  const {withEquipmentIndexCache}=require('../../../src/domain/fleet/equipment_planner'),f=fixture();
  const variants=[[],[[101,102]],[[104,102]],[[101,102],[-1,-1],105]];
  const expected=variants.map(args=>f.read(...args));
  withEquipmentIndexCache(f.store,()=>{
    for(let round=0;round<3;round++)variants.forEach((args,i)=>assert.deepEqual(f.read(...args),expected[i]));
    assert.equal(f.read([101,102]).ships[0],f.read([101,102]).ships[0]);
  });
  f.store.info.ships[1].api_sakuteki[0]+=20;
  const live=f.read([101,102]);assert.notDeepEqual(live,expected[1]);
  assert.deepEqual(withEquipmentIndexCache(f.store,()=>f.read([101,102])),live);
});
