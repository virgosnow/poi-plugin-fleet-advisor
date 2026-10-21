'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {openingASW,bonus}=require('../../../src/domain/combat/opening_asw');
const {fleetMechanisms}=require('../../../src/domain/combat/ship_mechanisms');
function fixture(id=488,name='由良改二',type=3){
  const master={api_id:id,api_name:name,api_stype:type,api_ctype:20,api_aftershipid:'0',api_slot_num:4,api_maxeq:[0,0,0,0],api_soku:10};
  const ship={api_ship_id:id,api_taisen:[87,99],api_slot:[],api_slot_ex:-1,api_soku:10,api_nowhp:30,api_maxhp:30};
  const store={const:{$ships:{[id]:master},$equips:{}},info:{ships:{1:ship},equips:{}}};
  const before={slots:[],ex:-1},after={slots:[],ex:-1};
  const target={id:1,ship,master,before,after};
  let next=1000;
  const gear=(id,type,raw,level=0)=>{const n=next++;store.const.$equips[id]={api_id:id,api_name:'装备'+id,api_type:[0,0,type,0],api_tais:raw};
    store.info.equips[n]={api_slotitem_id:id,api_level:level};return n;};
  return {store,target,gear,read:()=>openingASW(store,target)};
}
test('blue bonus crosses the 100 threshold and removing old gear removes its blue bonus too',()=>{
  const f=fixture(),sonar=f.gear(149,14,12);f.target.after.slots=[sonar];
  assert.equal(f.read().totalAsw,100);assert.equal(f.read().eligible,true);assert.equal(f.read().bonusAfter,1);
  f.target.before.slots=[sonar];f.target.ship.api_taisen=[100,100];
  f.target.after.slots=[f.gear(101,14,12)];
  assert.equal(f.read().totalAsw,99);assert.equal(f.read().eligible,false);assert.equal(f.read().bonusBefore,1);
});
test('single-count bonuses, per-item improvement levels and expansion equipment are evaluated together',()=>{
  const f=fixture();f.target.after.slots=[f.gear(149,14,12),f.gear(149,14,12)];
  assert.equal(f.read().bonusAfter,1);assert.equal(f.read().totalAsw,112);
  f.target.ship.api_taisen=[87,99];f.target.after.slots=[f.gear(288,14,10,8)];
  assert.equal(f.read().eligible,false);f.target.after.slots=[f.gear(288,14,10,9)];assert.equal(f.read().totalAsw,100);
  f.target.after.ex=f.gear(288,14,10,10);assert.equal(f.read().bonusAfter,7);
  const total=f.read().totalAsw;f.target.after.slots.reverse();assert.equal(f.read().totalAsw,total);
});
test('bonus combinations and original-hull rules count remodel ancestry, not display-name guesses',()=>{
  const f=fixture(999,'测试改二',2);f.store.const.$ships[35]={api_aftershipid:'999'};
  const first=f.gear(268,14,12,7),second=f.gear(402,12,0);
  f.target.after.slots=[first];assert.equal(f.read().bonusAfter,1);
  f.target.after.ex=second;assert.equal(f.read().bonusAfter,3);
  f.target.after.slots=[f.gear(268,14,12,6)];assert.equal(f.read().bonusAfter,0);
});
test('new/unresolved equipment stays unknown after a change, but observed equivalent loadouts stay exact',()=>{
  const f=fixture(),newGear=f.gear(9999,14,20);f.target.after.slots=[newGear];
  assert.equal(f.read().eligible,null);assert.match(f.read().reason,/新装备/);
  f.target.before.slots=[newGear];f.target.ship.api_taisen=[110,110];assert.equal(f.read().eligible,true);
  f.target.after.slots=[123456];assert.equal(f.read().eligible,null);
  f.target.ship.api_taisen=undefined;assert.equal(f.read().eligible,null);
  f.target.after.slots=[newGear];f.target.ship.api_taisen=[null];assert.equal(f.read().eligible,null);
});
test('unconditional ships bypass missing stat bonuses; ordinary hulls still need their equipment',()=>{
  for(const name of ['五十鈴改二','Janus改','Fletcher','Fletcher改 Mod.2','吹雪改三護(六式)']){
    const f=fixture(999,name,2);f.target.ship.api_taisen=undefined;assert.equal(f.read().eligible,true,name);
  }
  const f=fixture(999,'Heywood L.E.',2);assert.equal(f.read().eligible,false);
});
test('carrier planes use raw ASW, not a blue bonus, to meet the aircraft-specific threshold',()=>{
  const f=fixture(999,'龍驤改二',7);f.target.ship.api_taisen=[65,65];
  f.target.after.slots=[f.gear(101,8,6)];assert.equal(f.read().eligible,false);
  f.target.after.slots=[f.gear(102,8,7)];assert.equal(f.read().eligible,true);
  f.target.ship.api_taisen=[43,43];f.target.after.ex=f.gear(103,40,0);assert.equal(f.read().eligible,true);
  f.target.ship.api_taisen=[42,42];assert.equal(f.read().eligible,false);
});
test('escort thresholds use raw equipment totals and Fusou accepts real depth charges only',()=>{
  const f=fixture(999,'海防舰',1);f.target.ship.api_taisen=[71,71];f.target.after.ex=f.gear(101,15,4);
  assert.equal(f.read().eligible,true);f.target.ship.api_taisen=[70,70];assert.equal(f.read().eligible,false);
  const b=fixture(999,'扶桑改二',10);b.target.ship.api_taisen=[100,100];b.target.after.slots=[b.gear(101,40,0),b.gear(102,44,0)];
  assert.equal(b.read().eligible,false);b.target.after.slots[1]=b.gear(103,15,0);assert.equal(b.read().eligible,true);
});
test('workbench and evaluator use one eligibility result without estimate badges or state mutations',()=>{
  const f=fixture();f.target.after.slots=[f.gear(149,14,12)];
  const saved=JSON.stringify(f.store),draft={id:1,...f.target.after};
  const badge=fleetMechanisms(f.store,[draft]).get(1).find(b=>b.key==='asw');
  assert.equal(badge.state,'ready');assert.match(badge.detail,/100/);assert.equal(JSON.stringify(f.store),saved);
  draft.ex=f.gear(9999,1,0);const pending=fleetMechanisms(f.store,[draft]).get(1).find(b=>b.key==='asw');
  assert.equal(pending.state,'unknown');assert.match(pending.detail,/新装备/);
});
