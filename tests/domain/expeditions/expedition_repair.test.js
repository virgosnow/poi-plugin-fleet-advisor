'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {typeOf,repairReference}=require('../../../src/domain/expeditions/expedition_repair');
const {missionIncome}=require('../../../src/domain/expeditions/expedition_income');
const {planningNet}=require('../../../src/domain/expeditions/expedition_loadout');
function store(){
 const state={const:{$ships:{},$missions:{104:{api_use_fuel:.5,api_use_bull:.5},105:{api_use_fuel:.5,api_use_bull:.5},1:{api_use_fuel:.5,api_use_bull:.5}},$equips:{}},info:{ships:{},equips:{}}};
 for(let id=1;id<=6;id++){const fuel=id===6?250:20,hp=id===6?100:40;state.const.$ships[id]={api_fuel_max:fuel,api_bull_max:fuel,api_taik:[hp,hp]};
  state.info.ships[id]={api_ship_id:id,api_lv:80,api_maxhp:hp,api_nowhp:hp,api_slot:[],api_slot_ex:-1};}
 return state;
}
const rows=()=>Array.from({length:6},(_,i)=>({id:i+1,slots:[],ex:-1}));
const check=(ratio)=>({checks:Object.entries(require('../../../data/expedition_requirements.json').missions[105].totals).map(([key,right])=>({type:'total'+key[0].toUpperCase()+key.slice(1),left:right*ratio,right}))});
test('combat expedition damage scenarios use bounded affected counts and hull repair costs',()=>{
 const s=store(),before=JSON.stringify(s),one=repairReference(s,rows(),104),two=repairReference(s,rows(),105,check(1));
 assert.equal(typeOf(1),0);assert.equal(repairReference(s,rows(),1),null);
 assert.equal(one.type,1);assert.equal(two.type,2);assert.equal(one.fuel,115);assert.equal(one.steel,218);
 assert.equal(two.fuel,230);assert.equal(two.steel,435);assert.match(one.note,/最多 3 艘/);assert.match(two.note,/非实际损伤概率/);
 assert.equal(JSON.stringify(s),before);
});
test('combat II reports the observed 220 percent line only when every required stat reaches it',()=>{
 const s=store(),safe=repairReference(s,rows(),105,check(2.2)),short=repairReference(s,rows(),105,check(2.19));
 assert.equal(safe.protectedLine,true);assert.equal(safe.fuel,0);assert.equal(safe.steel,0);assert.match(safe.note,/已有无伤报告/);
 assert.equal(short.protectedLine,false);assert(short.fuel>0);
});
test('repair costs are included separately in fuel and steel net income and above-cap planning',()=>{
 const s=store(),entries=rows(),income=missionIncome(s,entries,104),fuel=income.rows.find(row=>row.name==='燃料'),steel=income.rows.find(row=>row.name==='钢材');
 assert.equal(income.repair.status,'reference');assert.equal(fuel.repairCost,115);assert.equal(steel.repairCost,218);
 assert.equal(fuel.net,fuel.success-fuel.cost-fuel.repairCost);assert.equal(steel.greatNet,steel.great-steel.cost-steel.repairCost);
 const before=planningNet(income,104);income.bonus=.21;const capped=planningNet(income,104);
 assert(Number.isFinite(before));assert(Number.isFinite(capped));
 const noRepair={...income,repair:null};assert.equal(planningNet(noRepair,104)-capped,333);
 delete s.info.ships[1].api_maxhp;delete s.const.$ships[1].api_taik;assert.equal(missionIncome(s,entries,104).repair.status,'unknown');
});
