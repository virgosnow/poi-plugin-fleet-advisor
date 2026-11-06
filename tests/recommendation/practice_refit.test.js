'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/workbench_fixture'),W=require('../../src/ui/workbench/workbench_model');
const {recommendPractice}=require('../../src/recommendation/practice');
test('practice refit preserves the specified ships and held equipment without adding training targets',()=>{
 const store=fixture();store.const.$shipTypes[2]={api_equip_type:{1:1,2:1}};store.const.$shipTypes[3]={api_equip_type:{1:1,2:1}};
 for(const [master,type] of [[100,2],[101,1]]){
  store.const.$equips[master]={api_id:master,api_name:`测试装备${master}`,api_type:[0,0,type,type],api_houg:7};
  for(let i=0;i<3;i++){const id=master*10+i;store.info.equips[id]={api_id:id,api_slotitem_id:master,api_level:0};}
 }
 const first={...W.entry(store,1),pin:true,slots:[1000,-1],keep:{0:true}},second={...W.entry(store,3),pin:true};
 const result=recommendPractice(store,{fleet:1,slots:[first,second],capacity:2,trainingShipIds:[],equipmentOnly:true,
   opponent:{ships:[{masterId:1,level:50}]}});
 assert.deepEqual(result.scheme.ships.map(ship=>ship.id),[1,3]);assert.equal(result.scheme.ships[0].slots[0],1000);
 assert(result.scheme.ships.flatMap(ship=>ship.slots).filter(id=>id>0).length>1,'the remaining slots receive available equipment');
});
