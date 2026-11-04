'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../../helpers/workbench_fixture');
const contact=require('../../../src/domain/combat/practice_night_contact');
const {scenarioPower,runScenario}=require('../../../src/domain/combat/combat_battle');
test('practice night contact distinguishes our and opposing air parity',()=>{
 assert.equal(contact.canContact('own','parity'),false);
 assert.equal(contact.canContact('enemy','parity'),true);
 assert.equal(contact.canContact('own','disadvantage'),true);
 assert.equal(contact.canContact('enemy','supremacy'),false);
 assert.equal(contact.canContact('own','noAirBattle'),false);
 assert.equal(contact.canContact('enemy','noAirBattle'),true);
});
test('zero air power only becomes own air supremacy when ordinary aviation attacks launch',()=>{
 const noAttack=[{attacks:[]}],launched=[{attacks:[{planesMax:3,referencePlanes:2}]}],empty=[{attacks:[{planesMax:0,referencePlanes:0}]}];
 assert.deepEqual(contact.statesForContact(['noAirBattle'],noAttack,empty),['noAirBattle']);
 assert.deepEqual(contact.statesForContact(['noAirBattle'],launched,noAttack),['supremacy']);
 assert.deepEqual(contact.statesForContact(['noAirBattle'],noAttack,launched),['supremacy']);
 assert.deepEqual(contact.statesForContact(['noAirBattle','supremacy'],launched,noAttack),['supremacy']);
});
test('night scouts use live slot, level, scouting and accuracy; unknowns stay explicit',()=>{
 const s=fixture();s.const.$ships[1].api_maxeq=[1,0];s.info.ships[1].api_lv=99;
 s.info.equips[1]={api_slotitem_id:102};s.const.$equips[102]={api_type:[0,0,10,50],api_saku:3,api_houm:1};
 const scheme={ships:[{id:1,slots:[1,-1]}]},out=contact.friendly(s,scheme);
 assert.deepEqual(out,{candidates:[{shipIndex:0,slot:0,rate:.68,bonus:5}],incomplete:false});
 assert.equal(contact.activate(out,'superiority','own',()=>.67),5);
 assert.equal(contact.activate(out,'superiority','own',()=>.69),0);
 assert.equal(contact.activate(out,'parity','own',()=>0),0);
 assert.equal(contact.activate(out,'parity','enemy',()=>0),5);
 s.const.$ships[1].api_maxeq[0]=0;assert.deepEqual(contact.friendly(s,scheme).candidates,[]);
 s.const.$ships[1].api_maxeq[0]=1;delete s.info.ships[1].api_lv;
 assert.equal(contact.friendly(s,scheme).incomplete,true);
});
test('night contact affects the actual pre-cap night attack and CI multiplier',()=>{
 const ship={side:'own',index:0,nightBase:100,fire:60,torpedo:40,nightMode:{rate:1,multiplier:1.5,hits:2},hp:100,carrier:false};
 assert.equal(scenarioPower(ship,100,'night','lineAhead',()=>0,0,0).power,150);
 assert.equal(scenarioPower(ship,100,'night','lineAhead',()=>0,0,5).power,157);
 const capped={...ship,nightBase:350};
 assert.equal(scenarioPower(capped,100,'night','lineAhead',()=>0,0,5).power,373);
 const carrier={...ship,carrier:true,nightCarrier:true,nightRawBase:350,
  nightOptions:[{power:373,basePower:350,multiplier:1.5,fit:0,rate:1,hits:1}]};
 assert.equal(scenarioPower(carrier,100,'night','lineAhead',()=>0,0,5).power,373);
});
test('night contact is sampled once per night and affects battle outcome',()=>{
 const fighter=(side,index)=>({side,index,hp:1000,initialHp:1000,armor:0,fire:50,torpedo:50,nightBase:100,
  carrier:false,submarine:false,installation:false,condition:49,nightAswCapable:false});
 const own=fighter('own',0),foe=fighter('enemy',0),prepared={status:'estimated',kind:'nightBattle',allies:[own],foes:[foe],
  combined:false,ownFormation:'lineAhead',enemyFormation:'lineAhead',special:null};
 const base=runScenario(prepared,()=>.1);
 const enhanced=runScenario({...prepared,practiceNightContact:{states:['superiority'],own:{candidates:[{rate:1,bonus:5}]},enemy:{candidates:[]}}},()=>.1);
 assert.ok(enhanced.enemyHp[0]<base.enemyHp[0]);assert.equal(enhanced.ownHp[0],base.ownHp[0]);
 const parity=runScenario({...prepared,practiceNightContact:{states:['parity'],own:{candidates:[{rate:1,bonus:5}]},enemy:{candidates:[{rate:1,bonus:5}]}}},()=>.1);
 assert.equal(parity.enemyHp[0],base.enemyHp[0]);assert.ok(parity.ownHp[0]<base.ownHp[0]);
});
