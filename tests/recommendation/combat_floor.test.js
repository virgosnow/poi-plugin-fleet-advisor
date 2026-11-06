'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createCombatFloor}=require('../../src/recommendation/loadout/combat_floor');
function setup(){
  const store=require('../helpers/workbench_fixture')();
  store.const.$ships[1].api_maxeq=[4,4,4,4];store.info.ships[1].api_onslot=[4,4,4,4];
  for(const [id,type,stats] of [[101,3,{}],[102,2,{}],[103,10,{}],[104,45,{}],
    [105,14,{api_tais:10}],[106,7,{}],[107,8,{}],[108,6,{}]]){
    store.info.equips[id]={api_id:id,api_slotitem_id:id,api_level:0,api_alv:7};
    store.const.$equips[id]={api_id:id,api_name:`装备${id}`,api_type:[0,0,type,type],...stats};
  }
  return store;
}
const scheme=slots=>({fleet:1,ships:[{id:1,slots,ex:-1}]});
const day={counts:{surface:{maximum:2},night:{maximum:0},asw:{maximum:0}}};

test('adding water fighters cannot erase the existing guns or sole spotting plane',()=>{
  const store=setup(),before=scheme([101,102,103,-1]),accept=createCombatFloor(store,before,day);
  assert.equal(accept(scheme([104,102,103,104])),false);
  assert.equal(accept(scheme([101,102,104,-1])),false);
  assert.equal(accept(scheme([101,102,103,104])),true);
  const oneGun=createCombatFloor(store,scheme([102,104,-1,-1]),day);
  assert.equal(oneGun(scheme([104,104,-1,-1])),false,'do not turn a one-gun cruiser into a fighter mule');
  const noGun=createCombatFloor(store,scheme([104,-1,-1,-1]),day);
  assert.equal(noGun(scheme([104,104,-1,-1])),true,'an explicitly gunless baseline is not inventively constrained');
});

test('carrier FBA and the last strike aircraft survive added fighters',()=>{
  const store=setup();store.const.$ships[1].api_stype=11;
  const accept=createCombatFloor(store,scheme([106,107,108,-1]),day);
  assert.equal(accept(scheme([108,107,108,-1])),false);
  assert.equal(accept(scheme([106,107,108,108])),true);
});

test('existing opening ASW remains available on a route with submarines',()=>{
  const store=setup();store.const.$ships[1].api_stype=2;store.info.ships[1].api_taisen=[100,100];
  const before=scheme([105,102]),profile={counts:{surface:{maximum:1},night:{maximum:0},asw:{maximum:1}}};
  const eligible=require('../../src/domain/combat/opening_asw').openingASW(store,
    require('../../src/domain/fleet/fleet_metrics').projectShip(store,1,before.ships[0])).eligible;
  assert.equal(eligible,true);
  const accept=createCombatFloor(store,before,profile);
  assert.equal(accept(scheme([102,102])),false);
  assert.equal(accept(scheme([105,102])),true);
});
