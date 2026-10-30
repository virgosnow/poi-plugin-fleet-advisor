'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../../helpers/workbench_fixture');
const {targetClass,buildGroundAttack,groundAttackPower}=require('../../../src/domain/combat/combat_ground');
const enemy=apiId=>({status:'known',kind:'installation',apiId});
function setup({stype=5,equipment=[]}={}){
  const store=fixture(),ship=store.info.ships[1],master=store.const.$ships[1];
  Object.assign(master,{api_stype:stype,api_slot_num:Math.max(1,equipment.length),api_maxeq:equipment.map(e=>e.planes||0),
    api_ctype:0,api_aftershipid:'0',api_houg:[20,40],api_raig:[20,40]});
  const ids=equipment.map((e,i)=>{
    const id=101+i,masterId=500+i;store.const.$equips[masterId]={api_id:masterId,api_name:e.name,
      api_type:[0,0,e.type,e.type],api_houg:e.fire||0,api_raig:e.torpedo||0,api_baku:e.bomb||0};
    store.info.equips[id]={api_id:id,api_slotitem_id:masterId,api_level:0};return id;
  });
  Object.assign(ship,{api_slot:ids.length?ids:[-1],api_slot_ex:0,api_karyoku:[20,40],
    api_raisou:[20,40],api_kyouka:[0,0,0,0,0]});
  return {store,entry:{id:1,slots:ship.api_slot.slice(),ex:0}};
}
test('real enemy identities map to specific ground targets without guessing unsupported types',()=>{
  assert.equal(targetClass(enemy(1587)),'soft');assert.equal(targetClass(enemy(1665)),'pillbox');
  assert.equal(targetClass(enemy(1668)),'island');assert.equal(targetClass(enemy(1653)),'supply');
  assert.equal(targetClass({status:'known',kind:'surface',apiId:1587}),null);
  assert.equal(targetClass(enemy(999999)),null);
});
test('ordinary guns attack land without a dedicated badge; night includes +5 but no automatic contact',()=>{
  const f=setup({equipment:[{name:'测试主炮甲',type:2},{name:'测试主炮乙',type:2}]});
  const r=buildGroundAttack(f.store,f.entry,enemy(1587));
  assert.equal(r.status,'known');assert.deepEqual(groundAttackPower(r),{status:'known',power:25,hits:1});
  assert.deepEqual(groundAttackPower(r,{night:true}),{status:'known',power:25,hits:1});
  assert.deepEqual(groundAttackPower(r,{night:true,nightContact:5}),{status:'known',power:30,hits:1});
  assert.deepEqual(groundAttackPower(r,{night:true,special:true}),{status:'known',power:30,hits:2});
  f.store.info.ships[1].api_raisou=[999,999];
  assert.equal(groundAttackPower(buildGroundAttack(f.store,f.entry,enemy(1587)),{night:true}).power,25);
});
test('unarmed night exception uses fire plus torpedo and has no automatic contact',()=>{
  const f=setup(),r=buildGroundAttack(f.store,f.entry,enemy(1587));
  assert.equal(groundAttackPower(r,{night:true}).power,40);
  assert.equal(groundAttackPower(r,{night:true,nightContact:5}).power,45);
});
test('different targets apply the existing target-specific equipment effects',()=>{
  const f=setup({equipment:[{name:'三式弾',type:18},{name:'WG42 (Wurfgerät 42)',type:37}]});
  const values=[1587,1665,1668,1653].map(id=>groundAttackPower(buildGroundAttack(f.store,f.entry,enemy(id))).power);
  assert(values.every(Number.isFinite));assert(new Set(values).size>2);
});
test('carrier with ordinary dive bomber is blocked; compatible and torpedo bombers need actual live slots',()=>{
  const ordinary=setup({stype:11,equipment:[{name:'彗星',type:7,bomb:8,planes:18}]});
  const blocked=buildGroundAttack(ordinary.store,ordinary.entry,enemy(1587),{slotRemaining:{0:18}});
  assert.equal(groundAttackPower(blocked).status,'blocked');
  const f=setup({stype:11,equipment:[{name:'F4U-1D',type:7,bomb:7,planes:18}]});
  const full=buildGroundAttack(f.store,f.entry,enemy(1587),{slotRemaining:{0:18}});
  assert.equal(groundAttackPower(full).status,'known');
  assert.equal(groundAttackPower(buildGroundAttack(f.store,f.entry,enemy(1587))).status,'unknown');
  assert.equal(groundAttackPower(buildGroundAttack(f.store,f.entry,enemy(1587),{slotRemaining:{0:[1,18]}})).status,'known');
  assert.equal(groundAttackPower(buildGroundAttack(f.store,f.entry,enemy(1587),{slotRemaining:{0:[0,18]}})).status,'unknown');
  assert.equal(groundAttackPower(buildGroundAttack(f.store,f.entry,enemy(1587),{slotRemaining:{0:0}})).status,'blocked');
  assert.equal(groundAttackPower(full,{night:true}).status,'unknown');
  const torp=setup({stype:11,equipment:[{name:'流星',type:8,torpedo:10,planes:18}]});
  assert.equal(groundAttackPower(buildGroundAttack(torp.store,torp.entry,enemy(1587),{slotRemaining:{0:18}})).status,'known');
});
test('depleted aircraft keep equipment multipliers but cannot satisfy carrier attack eligibility',()=>{
  // Wiki reports that water-bomber anti-installation modifiers remain active
  // even with zero planes, while their base equipment stats still apply.
  const b=setup({stype:5,equipment:[{name:'瑞雲',type:11,bomb:4,planes:10}]});
  const live=buildGroundAttack(b.store,b.entry,enemy(1665),{slotRemaining:{0:10}});
  const empty=buildGroundAttack(b.store,b.entry,enemy(1665),{slotRemaining:{0:0}});
  assert.equal(groundAttackPower(live).status,'known');
  assert.equal(groundAttackPower(empty).status,'known');
  assert.equal(groundAttackPower(empty).power,groundAttackPower(live).power);
  b.store.const.$ships[1].api_maxeq[0]=0;
  const zeroCapacity=buildGroundAttack(b.store,b.entry,enemy(1665),{slotRemaining:{0:0}});
  assert.equal(groundAttackPower(zeroCapacity).power,groundAttackPower(live).power);

  const carrier=setup({stype:11,equipment:[{name:'F4U-1D',type:7,bomb:7,planes:18}]});
  carrier.store.const.$ships[1].api_maxeq[0]=0;
  const blocked=buildGroundAttack(carrier.store,carrier.entry,enemy(1587),{slotRemaining:{0:0}});
  assert.equal(groundAttackPower(blocked).status,'blocked');
  delete carrier.store.const.$ships[1].api_maxeq[0];
  const noCapacity=buildGroundAttack(carrier.store,carrier.entry,enemy(1587),{slotRemaining:{0:0}});
  assert.equal(groundAttackPower(noCapacity).status,'unknown');
});
test('depleted ground dive bomber with live torpedo bomber has a disclosed bombing-stat assumption',()=>{
  const f=setup({stype:11,equipment:[{name:'F4U-1D',type:7,bomb:7,planes:18},
    {name:'流星',type:8,torpedo:10,planes:18}]});
  const empty=buildGroundAttack(f.store,f.entry,enemy(1587),{slotRemaining:{0:0,1:18},nightCarrier:{status:'known',available:false}});
  assert.equal(groundAttackPower(empty).status,'known');
  assert(empty.assumptions.some(text=>text.includes('全灭的对地舰爆爆装')));
  const {prepareBattle}=require('../../../src/domain/combat/combat_battle');
  const {enemyRecord}=require('../../../src/domain/combat/combat_encounters');
  const carrier={status:'known',stype:11,hp:40,initialHp:40,armor:20,fire:40,torpedo:0,
    intrinsicTorpedo:0,range:1,condition:49,submarine:false,hasAircraft:true,
    asw:{status:'known',normal:false,opening:false,power:0}};
  const battle=prepareBattle([carrier],[enemyRecord({apiId:1587,apiIdStatus:'verified'})],{ground:[[empty]]});
  assert(battle.reasons.some(text=>text.includes('全灭的对地舰爆爆装')));
  f.store.const.$ships[1].api_maxeq[0]=0;
  const zeroCapacity=buildGroundAttack(f.store,f.entry,enemy(1587),{slotRemaining:{0:0,1:18},nightCarrier:{status:'known',available:false}});
  assert.equal(groundAttackPower(zeroCapacity).status,'known');
  assert(zeroCapacity.assumptions.some(text=>text.includes('全灭的对地舰爆爆装')));
  f.store.const.$ships[1].api_maxeq[0]=18;
  const live=buildGroundAttack(f.store,f.entry,enemy(1587),{slotRemaining:{0:1,1:18}});
  assert(!live.assumptions.some(text=>text.includes('全灭的对地舰爆爆装')));
});
test('non-ground fighter and scout losses do not block ground shelling or invent night carrier capability',()=>{
  const battleship=setup({stype:9,equipment:[{name:'紫雲',type:10,planes:4}]});
  battleship.store.const.$equips[118]={...battleship.store.const.$equips[500],api_id:118};
  battleship.store.info.equips[101].api_slotitem_id=118;
  const scout=buildGroundAttack(battleship.store,battleship.entry,enemy(1587));
  assert.equal(groundAttackPower(scout).status,'known');
  const carrier=setup({stype:11,equipment:[{name:'零式艦戦53型(岩本隊)',type:6,planes:20},
    {name:'天山一二型(友永隊)',type:8,torpedo:10,planes:18}]});
  for(const [instance,original,id] of [[101,500,157],[102,501,94]]){
    carrier.store.const.$equips[id]={...carrier.store.const.$equips[original],api_id:id};
    carrier.store.info.equips[instance].api_slotitem_id=id;
  }
  const opts={slotRemaining:{1:[1,18]},nightCarrier:{status:'known',available:false}};
  const capable=buildGroundAttack(carrier.store,carrier.entry,enemy(1587),opts);
  assert.equal(groundAttackPower(capable).status,'known');
  assert.equal(groundAttackPower(capable,{night:true}).status,'blocked');
  const uncertain=buildGroundAttack(carrier.store,carrier.entry,enemy(1587),
    {...opts,nightCarrier:{status:'partial',available:null}});
  assert.equal(groundAttackPower(uncertain,{night:true}).status,'unknown');
  const depleted=buildGroundAttack(carrier.store,carrier.entry,enemy(1587),
    {...opts,slotRemaining:{1:[0,18]}});
  assert.equal(groundAttackPower(depleted).status,'unknown');
});
test('daytime submarine torpedoes cannot attack ground; unknown bonus or equipment remains unknown',()=>{
  const sub=setup({stype:13,equipment:[{name:'测试主炮',type:2}]});
  const r=buildGroundAttack(sub.store,sub.entry,enemy(1587));assert.equal(groundAttackPower(r).status,'blocked');
  assert.equal(groundAttackPower(r,{night:true}).status,'known');
  const landing=setup({stype:13,equipment:[{name:'特二式内火艇',type:46}]});
  assert.equal(groundAttackPower(buildGroundAttack(landing.store,landing.entry,enemy(1587))).status,'known');
  const bareSub=setup({stype:13});
  assert.equal(groundAttackPower(buildGroundAttack(bareSub.store,bareSub.entry,enemy(1587)),{night:true}).status,'unknown');
  const f=setup({equipment:[{name:'未知登陆装备',type:24}]});
  assert.equal(groundAttackPower(buildGroundAttack(f.store,f.entry,enemy(1587))).status,'unknown');
  delete f.store.info.equips[101];
  assert.equal(buildGroundAttack(f.store,f.entry,enemy(1587)).status,'unknown');
});
test('destroyer gun plus torpedo ground CI is not mistaken for the generic gun mode',()=>{
  const f=setup({stype:2,equipment:[{name:'测试主炮',type:1},{name:'测试鱼雷',type:5}]});
  const r=buildGroundAttack(f.store,f.entry,enemy(1587));
  assert.equal(groundAttackPower(r,{night:true}).status,'known');
  assert.equal(groundAttackPower(r,{night:true,special:true}).status,'unknown');
});
