'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../../helpers/workbench_fixture'),{generate}=require('../../../src/domain/combat/practice_enemy_loadout');
function store(){
 const s=fixture(),items={2:1,3:1,4:2,5:2,8:3,9:3,15:5,21:6,22:6,26:11,27:12,36:19,39:21,40:21,41:22,45:15,47:14,52:8,57:7,59:10,65:2,66:4,90:2,207:11,213:32,226:15,245:3,298:3,340:2,356:2,382:1};
 for(const [id,type] of Object.entries(items))s.const.$equips[id]={api_id:Number(id),api_name:`设备${id}`,api_type:[0,0,type,type]};
 s.const.$shipTypes={2:{api_equip_type:{1:1,5:1,12:1,14:1}},11:{api_equip_type:{6:1,7:1,8:1,12:1,2:1}},
  13:{api_equip_type:{5:1,32:1}}};
 return s;
}
test('virtual opponent loadout ignores actual owned inventory and preserves store',()=>{
 const s=store();s.info.equips={};Object.assign(s.const.$ships[1],{api_stype:2,api_slot_num:3,api_maxeq:[0,0,0]});
 const before=JSON.stringify(s),result=generate(s,{known:true,ships:[{masterId:1,level:90}]});
 assert.equal(result.status,'estimated');assert.deepEqual(result.ships[0].slots.map(x=>x.masterId),[3,3,27]);
 assert.equal(JSON.stringify(s),before);
});
test('aircraft go into legal positive-capacity slots, with largest strike slot first',()=>{
 const s=store();Object.assign(s.const.$ships[1],{api_stype:11,api_slot_num:3,api_maxeq:[5,18,2]});
 const result=generate(s,{known:true,ships:[{masterId:1,level:99}]});assert.equal(result.status,'estimated');
 assert.deepEqual(result.ships[0].slots.map(x=>[x.slot,x.masterId]),[[0,57],[1,52],[2,22]]);
});
test('normal-slot exclusions and equipment permissions are enforced',()=>{
 const s=store();Object.assign(s.const.$ships[1],{api_stype:2,api_slot_num:3,api_maxeq:[0,0,0]});
 s.selectorTables={...require('../../../data/equipment_rules.json'),slotExclusions:[{shipMstIds:[1],slot:0,exclude:[1]}]};
 const result=generate(s,{known:true,ships:[{masterId:1}]});assert.equal(result.status,'estimated');
 assert.notEqual(result.ships[0].slots.find(x=>x.slot===0)?.master.api_type[2],1);
});
test('missing slot and rules data do not become invented equipment',()=>{
 const s=store();Object.assign(s.const.$ships[1],{api_stype:2,api_maxeq:[0,0]});delete s.const.$ships[1].api_slot_num;
 assert.equal(generate(s,{known:true,ships:[{masterId:1}]}).status,'unknown');
 s.const.$ships[1].api_slot_num=2;delete s.const.$shipTypes[2];
 assert.equal(generate(s,{known:true,ships:[{masterId:1}]}).status,'unknown');
});
test('true zero-slot ship stays empty; lack of candidate masters is unknown',()=>{
 const s=store();Object.assign(s.const.$ships[1],{api_stype:13,api_slot_num:0});delete s.const.$ships[1].api_maxeq;
 assert.deepEqual(generate(s,{known:true,ships:[{masterId:1}]}).ships[0].slots,[]);
 s.const.$ships[1].api_slot_num=1;s.const.$ships[1].api_maxeq=[0];delete s.const.$equips[15];delete s.const.$equips[213];
 assert.equal(generate(s,{known:true,ships:[{masterId:1}]}).status,'unknown');
});
test('submarines prefer developable bow torpedoes when legal and fall back without inventory',()=>{
 const s=store();s.info.equips={};Object.assign(s.const.$ships[1],{api_stype:13,api_slot_num:2,api_maxeq:[0,0]});
 let result=generate(s,{known:true,ships:[{masterId:1}]});assert.deepEqual(result.ships[0].slots.map(x=>x.masterId),[213,213]);
 s.const.$shipTypes[13].api_equip_type[32]=0;result=generate(s,{known:true,ships:[{masterId:1}]});
 assert.deepEqual(result.ships[0].slots.map(x=>x.masterId),[15,15]);
});
test('restricted transport and auxiliary ships use legal developable fits',()=>{
 const s=store();s.info.equips={};
 Object.assign(s.const.$ships[1],{api_stype:17,api_slot_num:3,api_maxeq:[0,0,0]});
 s.const.$equipShip={1:{api_equip_type:{1:[382],4:[66],12:null,21:null}}};
 let result=generate(s,{known:true,ships:[{masterId:1}]});
 assert.equal(result.status,'estimated');assert.deepEqual(result.ships[0].slots.map(x=>x.masterId),[382,382,27]);
 Object.assign(s.const.$ships[1],{api_stype:22,api_slot_num:2,api_maxeq:[6,1]});
 s.const.$equipShip[1]={api_equip_type:{11:null,10:null,12:null,21:null}};
 result=generate(s,{known:true,ships:[{masterId:1}]});
 assert.equal(result.status,'estimated');assert.deepEqual(result.ships[0].slots.map(x=>x.masterId),[207,59]);
 Object.assign(s.const.$ships[1],{api_slot_num:1,api_maxeq:[0]});
 s.const.$equipShip[1]={api_equip_type:{21:null}};
 result=generate(s,{known:true,ships:[{masterId:1}]});
 assert.equal(result.status,'estimated');assert.deepEqual(result.ships[0].slots.map(x=>x.masterId),[40]);
 Object.assign(s.const.$ships[1],{api_stype:20,api_slot_num:2,api_maxeq:[1,1]});
 s.const.$equipShip[1]={api_equip_type:{2:[4],21:null}};
 result=generate(s,{known:true,ships:[{masterId:1}]});
 assert.equal(result.status,'estimated');assert.deepEqual(result.ships[0].slots.map(x=>x.masterId),[4,4]);
});
