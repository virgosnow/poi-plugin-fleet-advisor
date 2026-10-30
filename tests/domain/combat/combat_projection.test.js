'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {attackFor,coverage,referenceDamage,surfaceBattle,projectedHull}=require('../../../src/domain/combat/combat_projection');
const surface={kind:'surface',hp:50,armor:20},sub={kind:'submarine',hp:20,armor:5};
const gun={stype:2,submarine:false,fire:50,torpedo:30,intrinsicTorpedo:25,openingTorpedo:false,asw:{status:'known',power:0,normal:false,opening:false}};
test('armor and ammo affect representative damage without inventing hit rates',()=>{
  assert.equal(referenceDamage(50,20),30);assert.equal(referenceDamage(50,20,.5),15);
  assert.equal(referenceDamage(10,20),0);assert.equal(referenceDamage(null,20),null);
});
test('a submarine cannot shell, a fighter-only carrier cannot shell and anti-land remains unknown',()=>{
  assert.equal(attackFor({...gun,stype:13,submarine:true},surface,'shelling'),0);
  assert.equal(attackFor({...gun,stype:7,armedCarrier:false},surface,'shelling'),0);
  assert.equal(attackFor(gun,{kind:'installation',hp:100,armor:50},'shelling'),null);
});
test('a surface gun cannot replace an actual anti-submarine package',()=>{
  assert.equal(attackFor(gun,sub,'openingAsw'),0);assert.equal(attackFor(gun,sub,'shelling'),0);
  assert.equal(attackFor({...gun,asw:{status:'unknown'}},sub,'openingAsw'),null);
});
test('normal torpedo and opening torpedo follow distinct eligibility',()=>{
  assert.equal(attackFor(gun,surface,'openingTorpedo'),0);
  assert(attackFor(gun,surface,'torpedo')>0);
  assert.equal(attackFor({...gun,intrinsicTorpedo:0},surface,'torpedo'),0);
  assert.equal(attackFor({...gun,intrinsicTorpedo:null},surface,'torpedo'),null);
  assert(attackFor({...gun,intrinsicTorpedo:0,openingTorpedo:true},surface,'openingTorpedo')>0);
});
test('mixed submarine formations force eligible ships to use their shelling action on subs',()=>{
  const escort={...gun,asw:{status:'known',power:70,normal:true,opening:false,penetration:0}};
  assert.equal(attackFor(escort,surface,'shelling',{hasLiveSubmarines:true}),0);
  assert(attackFor(escort,sub,'shelling',{hasLiveSubmarines:true})>0);
  assert(attackFor(escort,surface,'shelling',{hasLiveSubmarines:false})>0);
  assert.equal(attackFor({...escort,asw:{status:'unknown'}},surface,'shelling',{hasLiveSubmarines:true}),null);
});
test('opportunities do not damage every alternative target and unknown is not zero',()=>{
  const evalHit=(a,t)=>referenceDamage(a.power,t.armor);
  const row=coverage([{power:80}],[surface,surface],['shelling'],evalHit);
  assert.equal(row.status,'known');assert.equal(row.coverage,1);assert.equal(row.hardestRemaining,.5);
  const unknown=coverage([{power:80}],[surface,sub],['shelling'],(a,t)=>t.kind==='submarine'?null:evalHit(a,t));
  assert.equal(unknown.status,'unknown');
});
test('increasing an attack cannot make the fixed-target reference worse',()=>{
  const targets=[{hp:10,armor:10},{hp:30,armor:0}];
  const measure=power=>coverage([{power},{power:20}],targets,['shelling'],
    (actor,target)=>referenceDamage(actor.power,target.armor)).coverage;
  assert(measure(15)>=measure(10));
  for(let power=1;power<50;power++)assert(measure(power+1)>=measure(power));
});
test('surface comparison is monotonic and rejects unsupported special encounters',()=>{
  const friendly=[{...gun,status:'known',hp:30,armor:20}],enemies=[{...surface,fire:40,torpedo:15,carrier:false}];
  const base=surfaceBattle(friendly,enemies),strong=surfaceBattle([{...friendly[0],fire:80}],enemies);
  assert.equal(base.status,'experimental');assert(strong.balance.ratio>=base.balance.ratio);
  assert.equal(surfaceBattle([{...friendly[0],submarine:true}],enemies).status,'unknown');
  assert.equal(surfaceBattle(friendly,[{...enemies[0],carrier:true}]).status,'unknown');
  assert.equal(surfaceBattle(friendly,[{...enemies[0],fire:null}]).status,'unknown');
});
test('unknown or invalid observed HP is explicitly flagged when full HP is used',()=>{
  const store=require('../../helpers/workbench_fixture')();
  store.info.ships[1].api_maxhp=30;
  const entry={id:1,slots:[-1,-1],ex:0};
  let reading=projectedHull(store,entry);
  assert.equal(reading.hpEstimated,true);assert.equal(reading.initialHp,30);
  store.info.ships[1].api_nowhp=15;reading=projectedHull(store,entry);
  assert.equal(reading.hpEstimated,false);assert.equal(reading.initialHp,15);
  store.info.ships[1].api_nowhp=31;reading=projectedHull(store,entry);
  assert.equal(reading.hpEstimated,true);assert.equal(reading.initialHp,30);
});
