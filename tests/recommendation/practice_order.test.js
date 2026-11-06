'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/workbench_fixture'),W=require('../../src/ui/workbench/workbench_model');
const {practiceOrderCandidates}=require('../../src/recommendation/practice_order');
const {recommendPractice}=require('../../src/recommendation/practice');
function setup(){const s=fixture();for(let i=1;i<=8;i++){
 Object.assign(s.info.ships[i],{api_nowhp:30,api_maxhp:30,api_kyouka:[0,0,0,0,0],api_lucky:[20,99],api_karyoku:[i===2?100:20,100],api_soukou:[35,35],api_locked:1});
 Object.assign(s.const.$ships[i],{api_taik:[30,40],api_houg:[10,80],api_raig:[10,70],api_souk:[10,40],api_leng:1});}
 s.const.$ships[100]={api_id:100,api_stype:9,api_souk:[10,30]};return s;}
const ids=scheme=>scheme.ships.map(s=>s.id);
test('position alternatives preserve training targets, manual positions, equipment, and ship identity',()=>{
 const s=setup(),slots=[W.entry(s,1),W.entry(s,3),{...W.entry(s,4),pin:true},W.entry(s,2)],scheme=W.scheme(slots,1);
 const enemy={submarines:0,ships:[{master:s.const.$ships[100]}]},args={slots,trainingShipIds:[1]},before=JSON.stringify(scheme);
 const candidates=practiceOrderCandidates(s,scheme,args,enemy);assert(candidates.length<=2);assert(candidates.some(x=>JSON.stringify(ids(x))===JSON.stringify([1,2,4,3])));
 for(const candidate of candidates){assert.equal(candidate.ships[0].id,1);assert.equal(candidate.ships[2].id,4);
  for(const entry of candidate.ships)assert.deepEqual(entry,scheme.ships.find(x=>x.id===entry.id));}
 assert.equal(JSON.stringify(scheme),before);
 assert.deepEqual(practiceOrderCandidates(s,scheme,{slots,trainingShipIds:undefined},enemy),[],'legacy manually chosen positions stay fixed');
});
test('order optimization accepts an equally effective stronger front but rejects a lower win rate',()=>{
 const s=setup(),forecast=require('../../src/domain/combat/practice_forecast'),xp=require('../../src/domain/combat/practice_experience'),resources=require('../../src/domain/combat/practice_resources');
 const old=[forecast.estimate,xp.estimateFromScenarios,resources.estimate],slots=[W.entry(s,1),W.entry(s,3),{...W.entry(s,4),pin:true},W.entry(s,2)];
 const args={slots,capacity:4,trainingShipIds:[1],opponent:{ships:[{masterId:100,level:60}]}};
 try{let punish=false;forecast.estimate=(_s,scheme)=>{const rank=punish&&scheme.ships[1].id===2?'D':'S';return {status:'estimated',samples:1,rows:[{label:rank,count:1}],xpScenarios:[{rank,ownHp:[30,30,30,30],mvpIndex:0}]};};
  xp.estimateFromScenarios=()=>({status:'estimated',expectedTotal:400,expectedPerShip:[100,100,100,100]});resources.estimate=()=>({status:'known',fuel:10,ammoDay:10,ammoNight:10,bauxite:{max:0}});
  assert.deepEqual(ids(recommendPractice(s,args).scheme),[1,2,4,3]);punish=true;assert.deepEqual(ids(recommendPractice(s,args).scheme),[1,3,4,2]);
 }finally{[forecast.estimate,xp.estimateFromScenarios,resources.estimate]=old;}
});
