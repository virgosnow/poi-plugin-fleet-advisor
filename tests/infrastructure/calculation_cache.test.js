'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const {CalculationCache,withCalculationCache,calculationTable}=require('../../src/shared/calculation_cache');
const {RecommendationCache}=require('../../src/infrastructure/cache/recommendation_cache');
const {canEquip}=require('../../src/domain/fleet/equipment_rules');
const fixture=require('../helpers/workbench_fixture');
function storage(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'paa-calculations-'));
  t.after(()=>{assert(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
  return ()=>new CalculationCache(new RecommendationCache(directory,{version:'test'}));
}
function equipmentStore(){
  const s=fixture();
  s.const.$equips[500]={api_id:500,api_type:[0,0,1,1],api_name:'测试主炮'};
  s.const.$shipTypes[2]={api_equip_type:{1:1}};
  s.info.equips[100]={api_slotitem_id:500,api_level:0};
  s.const.$exslotEquipShips[500]={api_req_level:2,api_ship_ids:{2:1}};
  return s;
}
test('parallel cache merge retains equipment facts but never imports local hull token dictionaries',t=>{
  const create=storage(t),coordinator=create(),child=create();
  const base=coordinator.table('equipmentEligibility',{rules:1},2);
  base.memo('old',()=>true);
  const remote=child.table('equipmentEligibility',{rules:1},2);
  remote.memo('new',()=>false);
  const hull=child.table('hullFeasibility',{rules:1});hull.token('destroyer');hull.memo('0',()=>true);
  coordinator.table('hullFeasibility',{rules:1}).token('carrier');
  const records=child.equipmentEntries();assert.equal(records.length,1);
  coordinator.mergeEquipmentEntries(records);
  assert.equal(base.memo('new',()=>assert.fail('merged fact missing')),false);
  assert.equal(base.entries.size,2);
  coordinator.mergeEquipmentEntries([...child.tables].filter(([,table])=>table.tokens.size).map(([key,table])=>[key,table.entries]));
  assert.equal(coordinator.table('hullFeasibility',{rules:1}).entries.size,0);
  coordinator.flush();assert.equal(create().table('equipmentEligibility',{rules:1}).memo('new',()=>assert.fail('not persisted')),false);
});
test('eligibility persists across snapshots, maps and instances without reusing ownership decisions',t=>{
  const create=storage(t),a=equipmentStore();
  let cache=create();
  assert.equal(withCalculationCache(cache,()=>canEquip(a,2,100,0)),true);
  assert.equal(cache.stats.equipmentEligibility.misses,1);
  const b=structuredClone(a);b.info.basic.api_level++;b.info.ships[2].api_cond=20;
  b.info.ships[20]={...b.info.ships[2],api_id:20,api_lv:99,api_fuel:0};
  b.info.equips[101]={...b.info.equips[100],api_alv:7};delete b.info.equips[100];
  b.info.repairs=[{api_ship_id:2}];b.info.fleets[0].api_mission=[1,1];
  b.info.maps={'5-2':{}};cache=create();
  assert.equal(withCalculationCache(cache,()=>canEquip(b,20,101,0)),true);
  assert.equal(cache.stats.equipmentEligibility.loaded,1);assert.equal(cache.stats.equipmentEligibility.misses,0);
  // Eligibility means compatible, not available. A fresh execution preview
  // must still reject a repairing ship even after a compatibility cache hit.
  const {Controller}=require('../../src/application/controller');
  assert.throws(()=>new Controller({getStore:()=>b}).preview('fleet',{fleet:2,ships:[{id:2,slots:[101,-1]}]}),/repair/);
  delete b.info.equips[101];assert.throws(()=>canEquip(b,20,101,0),/missing/);
});
test('improvement, expansion opening, slot-specific rules and changed masters invalidate eligibility',t=>{
  const create=storage(t),s=equipmentStore();
  const check=(state,slot)=>{const expected=canEquip(state,2,100,slot),cache=create();
    assert.equal(withCalculationCache(cache,()=>canEquip(state,2,100,slot)),expected);return expected;};
  assert.equal(check(s,'ex'),false);
  s.info.ships[2].api_slot_ex=-1;assert.equal(check(s,'ex'),false);
  s.info.equips[100].api_level=2;assert.equal(check(s,'ex'),true);
  s.const.$exslotEquipShips[500].api_req_level=3;assert.equal(check(s,'ex'),false);
  assert.equal(check(s,0),true);
  s.selectorTables=structuredClone(require('../../data/equipment_rules.json'));
  s.selectorTables.slotExclusions.push({shipMstIds:[2],slot:0,exclude:[1]});
  assert.equal(check(s,0),false);assert.equal(check(s,1),true);
  s.const.$shipTypes[2].api_equip_type[1]=0;assert.equal(check(s,1),false);
});
test('hull facts survive reordered rosters and changed levels but retain name, speed and flagship facts',t=>{
  const create=storage(t),P=require('../../src/domain/routes/route_plans');
  const initial=[[3,'軽巡',10],[2,'神風改',10],[5,'羽黒改二',10],[5,'足柄改二',10],[2,'駆逐',5],[16,'水母',5],[7,'軽空母',10]]
    .map(([stype,name,speed],i)=>({id:i+1,stype,name,power:100-i,ship:{api_soku:speed}}));
  for(const [area,phase] of [['2-3',undefined],['3-2',undefined],['7-3','gauge2']]){
    const options={area,phase,routes:P.routeOptions(area,'boss',phase)};
    const run=(rows,fixed)=>{
      const ctx={roster:rows,fixed,byId:new Map(rows.map(r=>[r.id,r]))},expected=P.hullSeeds(ctx,options,r=>r.id),cache=create();
      assert.deepEqual(withCalculationCache(cache,()=>P.hullSeeds(ctx,options,r=>r.id)),expected);return cache.stats.hullFeasibility;
    };
    run(initial,[]);
    const changed=initial.map(r=>({...r,id:r.id+100,power:r.power*2,ship:{...r.ship,api_lv:90}})).reverse();
    const reused=run(changed,[]);assert(reused.loaded>0);assert.equal(reused.misses,0);
    const subset=run(changed.filter(r=>r.id!==106),[]);assert(subset.loaded>0);assert.equal(subset.misses,0);
    run(changed,[104,102]);run(changed,[102,104]);
    changed.find(r=>r.id===102).name='駆逐';run(changed,[]);
    changed.find(r=>r.id===101).ship.api_soku=5;run(changed,[]);
  }
});
test('pure tables are bounded, dependency keyed, exception safe and disabled for live callers',t=>{
  const create=storage(t),cache=create();assert.equal(calculationTable('x',{}),undefined);
  assert.throws(()=>withCalculationCache(cache,()=>{calculationTable('x',{},2).memo('bad',()=>{throw Error('fail');});}),/fail/);
  assert.equal(calculationTable('x',{}),undefined);
  withCalculationCache(create(),()=>{
    const table=calculationTable('x',{rule:1},2);
    for(const key of ['a','b','c'])table.memo(key,()=>key);
    assert.equal(table.entries.size,2);
  });
  const next=create();withCalculationCache(next,()=>{
    assert.equal(calculationTable('x',{rule:1},2).memo('c',()=>assert.fail('must hit')),'c');
    assert.equal(calculationTable('x',{rule:2},2).memo('c',()=>false),false);
  });
  assert.equal(next.stats.x.hits,1);assert.equal(next.stats.x.misses,1);
});

test('warm calculation tables still reallocate current inventory and reject newly busy fixed ships',t=>{
  const create=storage(t),recommend=require('../../src/recommendation/index').recommendNormalFleet;
  const a=equipmentStore(),args={area:'1-1',fixedShipIds:[2],excludedShipIds:[1,3,4,5,6,7,8]};
  const first=withCalculationCache(create(),()=>recommend(a,args));
  assert(first.recommendations.some(r=>r.scheme.ships.some(s=>s.slots.includes(100))));
  const b=structuredClone(a);delete b.info.equips[100];b.info.equips[101]={api_slotitem_id:500,api_level:0};
  const cache=create(),next=withCalculationCache(cache,()=>recommend(b,args));
  assert.deepEqual(next,recommend(b,args));assert(cache.stats.equipmentEligibility.hits>0);
  assert(next.recommendations.every(r=>r.scheme.ships.every(s=>!s.slots.includes(100))));
  assert(next.recommendations.some(r=>r.scheme.ships.some(s=>s.slots.includes(101))));
  b.info.repairs=[{api_ship_id:2}];
  assert.throws(()=>withCalculationCache(create(),()=>recommend(b,args)),/不能编入/);
});

test('hull shards merge token dictionaries by descriptor and persist only matching dependencies',t=>{
  const create=storage(t),parent=create(),child=create();
  const a=parent.table('hullFeasibility',{map:1},2),b=child.table('hullFeasibility',{map:1},2);
  a.token('DD');a.token('CL');b.token('CL');b.token('DD');b.token('CV');
  b.memo('0:1,2',()=>[1,3]);b.memo('2:',()=>[2]);
  const foreign=child.table('hullFeasibility',{map:2});foreign.token('DD');foreign.memo('0:',()=>[99]);
  parent.mergeHullEntries(child.hullEntries());
  assert.deepEqual(a.entries.get('1:0,2'),[1,3]);assert.deepEqual(a.entries.get('2:'),[2]);
  assert.equal(parent.tables.size,1);assert.equal(a.entries.size,2);
  parent.flush();const reopened=create(),saved=reopened.table('hullFeasibility',{map:1},2);
  assert.deepEqual(saved.memo('1:0,2',()=>assert.fail('not persisted')),[1,3]);
  assert.equal(reopened.hullEntries().length,0,'loaded facts are not exported again');
  saved.memo('0:',()=>[0]);saved.memo('1:',()=>[1]);saved.memo('2:0',()=>[2]);
  assert.equal(saved.delta.size,2);assert.equal(saved.entries.size,2);
});

test('equipment transfer sends only new facts and remains bounded after eviction',t=>{
  const create=storage(t),saved=create();
  saved.table('equipmentEligibility',{rules:'delta'},2).memo('loaded',()=>true);saved.flush();
  const child=create(),table=child.table('equipmentEligibility',{rules:'delta'},2);
  assert.equal(table.memo('loaded',()=>assert.fail('must load')),true);
  assert.deepEqual(child.equipmentEntries(),[]);
  table.memo('a',()=>false);table.memo('b',()=>true);table.memo('c',()=>false);
  assert.deepEqual([...child.equipmentEntries()[0][1]],[['b',true],['c',false]]);
  const parent=create(),merged=parent.table('equipmentEligibility',{rules:'delta'},2);
  parent.mergeEquipmentEntries(child.equipmentEntries());
  assert.equal(merged.memo('c',()=>assert.fail('missing delta')),false);
  assert.deepEqual(parent.equipmentEntries(),[],'imported facts must not be echoed to siblings');
  parent.flush();assert.equal(create().table('equipmentEligibility',{rules:'delta'},2).memo('b',()=>assert.fail('not saved')),true);
});
