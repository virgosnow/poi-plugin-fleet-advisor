'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {defenseAirPower}=require('../../../src/domain/combat/land_base_defense');
const {inspectSquadron}=require('../../../src/domain/combat/land_base');
function fixture(){
 const store={info:{airbase:[],equips:{1:{api_slotitem_id:1,api_alv:7,api_level:0},2:{api_slotitem_id:2,api_alv:7,api_level:0}}},
   const:{$equips:{1:{api_type:[0,0,48],api_tyku:6,api_houk:2,api_houm:5,api_distance:2},
     2:{api_type:[0,0,49],api_tyku:1,api_saku:9,api_distance:8}}}};
 const base={areaId:6,rid:1,slots:[{slotId:1,itemId:1,count:18,maxCount:18,planned:true},
   {slotId:2,itemId:0,count:0},{slotId:3,itemId:0,count:0},{slotId:4,itemId:0,count:0}]};
 return {store,base};
}
test('defense uses interception plus twice anti-bomber, not sortie air power',()=>{
 const {store,base}=fixture(),defense=defenseAirPower(store,base),sortie=inspectSquadron(store,base);
 assert.deepEqual(defense.airPower,{min:101,max:101});
 assert.deepEqual(sortie.airPower,{min:63,max:63});
});
test('recon contributes its own air power and the source disagreement remains a range',()=>{
 const {store,base}=fixture();base.slots[1]={slotId:2,itemId:2,count:4,maxCount:4,planned:true};
 const defense=defenseAirPower(store,base);
 assert.deepEqual(defense.airPower,{min:130,max:131});assert.match(defense.reason,/差异/);
 assert.deepEqual(inspectSquadron(store,base).airPower,{min:80,max:80},'sortie also counts the scout itself');
});
test('missing slot, unknown interception and unsupported jet recon remain unknown',()=>{
 const {store,base}=fixture();base.slots.pop();assert.equal(defenseAirPower(store,base).airPower,null);
 base.slots.push({slotId:4,itemId:0,count:0});delete store.const.$equips[1].api_houm;
 assert.equal(defenseAirPower(store,base).airPower,null);
 store.const.$equips[1].api_houm=5;store.const.$equips[2].api_type[2]=59;
 base.slots[1]={slotId:2,itemId:2,count:4,maxCount:4,planned:true};
 assert.equal(defenseAirPower(store,base).airPower,null);
});
