'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {deriveFriendlyAir,deriveEnemyAir,aircraftAfterNode,enemyOpeningTorpedo,enemyAswPower}=require('../../../src/domain/combat/combat_air_asw');
const fixture=require('../../helpers/workbench_fixture');
function friendly(){
  const store=fixture(),ship=store.info.ships[1],master=store.const.$ships[1];
  Object.assign(master,{api_ctype:0,api_aftershipid:'0',api_stype:11,api_slot_num:3,api_maxeq:[18,12,4]});
  Object.assign(ship,{api_slot:[-1,-1,-1],api_slot_ex:0,api_taisen:[100,100]});
  const specs=[[97,8,'天山',{api_raig:10}],[23,7,'彗星',{api_baku:8}],[26,11,'瑞雲',{api_baku:4}]];
  for(let i=0;i<specs.length;i++){
    const [id,type,name,stats]=specs[i];
    store.const.$equips[id]={api_id:id,api_name:name,api_type:[0,0,type,0],...stats};
    store.info.equips[100+i]={api_id:100+i,api_slotitem_id:id,api_level:0};
  }
  return {store,entry:{id:1,slots:[100,101,102],ex:0}};
}
function reEquipment(store){
  for(const [id,name,type,bomb,torpedo] of [[2001,'16inch三連装砲',3,0,0],
    [2002,'12.5inch連装副砲',4,0,0],[2003,'深海烏賊魚雷',5,0,0],[2004,'飛び魚艦爆',7,10,0]])
    store.const.$equips[id]={api_id:id,api_name:name,api_type:[3,5,type,0],api_baku:bomb,api_raig:torpedo};
}
test('friendly opening attacks are per slot, not carrier panel firepower',()=>{
  const {store,entry}=friendly(),options={slotRemaining:{0:[18,18],1:[12,12],2:[4,4]}};
  const before=JSON.stringify(store),r=deriveFriendlyAir(store,entry,options);
  assert.equal(r.status,'known');assert.equal(r.attacks.length,3);
  assert.deepEqual(r.attacks.map(x=>x.slot),[0,1,2]);
  assert.deepEqual([r.attacks[0].powerMin,r.attacks[0].powerMax],[53,101]);
  assert.deepEqual([r.attacks[1].powerMin,r.attacks[1].powerMax],[52,52]);
  assert.equal(r.attacks[2].powerMin,33);
  assert(r.attacks.every(attack=>attack.installationTarget==='unknown'));
  assert.equal(JSON.stringify(store),before);
  store.info.ships[1].api_karyoku=[9999,9999];
  assert.deepEqual(deriveFriendlyAir(store,entry,options).attacks,r.attacks);
});
test('missing losses remain a zero-to-full bound; zero capacity cannot launch',()=>{
  const {store,entry}=friendly(),result=deriveFriendlyAir(store,entry);
  assert.equal(result.status,'partial');assert(result.reasons.some(s=>/损耗/.test(s)));
  assert(result.attacks.every(attack=>attack.planesMin===0&&attack.powerMin===0));
  // These remain bounds; the battle reference uses middle counts rather than
  // assigning an invented 50% probability to every squadron being wiped out.
  assert.deepEqual(result.attacks.map(a=>a.referencePlanes),[9,6,2]);
  assert(result.attacks.every(a=>a.referencePowers.every(power=>power>0)));
  store.const.$ships[1].api_maxeq[2]=0;
  const zero=deriveFriendlyAir(store,entry,{slotRemaining:{0:[1,2],1:[1,2],2:[0,0]}});
  assert.equal(zero.status,'known');assert.equal(zero.attacks[2].powerMax,0);
  assert.equal(deriveFriendlyAir(store,entry,{slotRemaining:{0:[0,19]}}).status,'unknown');
});
test('node phase limits attacks and unknown equipment stays unknown',()=>{
  const {store,entry}=friendly();
  assert.deepEqual(deriveFriendlyAir(store,entry,{nodeKind:'nightBattle'}).attacks,[]);
  assert.deepEqual(deriveFriendlyAir(store,entry,{nodeKind:'aerialRaid'}).attacks,[]);
  delete store.const.$equips[97].api_raig;
  assert.equal(deriveFriendlyAir(store,entry).status,'unknown');
  delete store.const.$equips[97];assert.equal(deriveFriendlyAir(store,entry).status,'unknown');
});
test('uncovered blue bonuses use an explicitly labelled base reference instead of dropping attacks',()=>{
  const {store,entry}=friendly();
  // The equipment identity and attacking stats are known but this new ID is
  // beyond the blue-bonus catalogue. Its planes must not silently disappear.
  store.const.$equips[999999]={...store.const.$equips[97],api_id:999999};
  store.info.equips[100].api_slotitem_id=999999;
  const options={slotRemaining:{0:[18,18],1:[12,12],2:[4,4]}};
  const result=deriveFriendlyAir(store,entry,options);
  assert.equal(result.status,'partial');assert.equal(result.attacks.length,3);
  assert(result.attacks[0].referencePowers.every(power=>power>0));
  assert(result.reasons.some(reason=>/假设航空攻击不计蓝字加成/.test(reason)));
  // Missing a necessary attacking aircraft attribute is not covered by the
  // blue-only fallback and must never be interpreted as a zero-power launch.
  delete store.const.$equips[999999].api_raig;
  assert.equal(deriveFriendlyAir(store,entry,options).status,'unknown');
});
test('enemy RE-class aircraft resolves actual equipment and capacity, not surface fire',()=>{
  const {store}=friendly();reEquipment(store);
  const enemy={status:'known',apiId:1562};
  const r=deriveEnemyAir(store,enemy,{slotRemaining:{3:[180,180]},nodeKind:'battle'});
  assert.equal(r.status,'known');assert.equal(r.attacks.length,1);
  assert.equal(r.unresolvedAttack,false);
  assert.equal(r.attacks[0].slot,3);assert.equal(r.attacks[0].powerMax,159);
  assert.deepEqual(r.attacks[0].targetKinds,['surface']);assert.equal(r.attacks[0].submarineTarget,false);
  const airRaid=deriveEnemyAir(store,enemy,{slotRemaining:{3:[180,180]},nodeKind:'aerialRaid'});
  assert.equal(airRaid.attacks[0].submarineTarget,'unknown');
  const bounded=deriveEnemyAir(store,enemy,{nodeKind:'battle'});
  assert.equal(bounded.status,'partial');assert.equal(bounded.attacks[0].powerMin,0);
  assert.equal(bounded.attacks[0].referencePlanes,90);
  assert(bounded.attacks[0].referencePowers.every(power=>power>0));
  assert.equal(deriveEnemyAir(store,enemy,{nodeKind:'nightBattle'}).attacks.length,0);
});
test('enemy equipment ambiguity or absent master never becomes a zero-aircraft verdict',()=>{
  const {store}=friendly();reEquipment(store);delete store.const.$equips[2004];
  const enemy={status:'known',apiId:1562};
  const missing=deriveEnemyAir(store,enemy);assert.equal(missing.status,'partial');assert.equal(missing.unresolvedAttack,true);
  const unknown=deriveEnemyAir(store,{status:'unknown',apiId:1562});assert.equal(unknown.status,'unknown');assert.equal(unknown.unresolvedAttack,true);
  const ambiguous=friendly();reEquipment(ambiguous.store);
  ambiguous.store.const.$equips[3000]={api_id:3000,api_name:'飛び魚艦爆',api_type:[3,5,7,0],api_baku:20,api_raig:0};
  const result=deriveEnemyAir(ambiguous.store,enemy);assert.equal(result.status,'partial');assert.equal(result.unresolvedAttack,true);
});
test('aircraft capacity with an empty equipment list is missing data, not zero attacks',()=>{
  const {store}=friendly(),catalog=require('../../../data/sortie/enemy_catalog.json');
  const master=catalog.enemies.find(row=>row.apiId===1562),original=master.equipment;
  try{
    master.equipment=[];
    const r=deriveEnemyAir(store,{status:'known',apiId:1562});
    assert.equal(r.status,'unknown');assert.equal(r.unresolvedAttack,true);
  }finally{master.equipment=original;}
});
test('selected-path post-interception counts do not reuse an unknown terminal AA estimate',()=>{
  const reference={status:'known',paths:[['A','B']],nodes:[{id:'A',kind:'battle',antiAir:{status:'known'}},
    {id:'B',kind:'battle',antiAir:{status:'unknown'}}]};
  const estimate={status:'estimated',paths:[{steps:[{node:'A',round:1,aircraft:[{shipId:1,slot:0,planes:[4,10]}]},
    {node:'B',round:1,aircraft:[{shipId:1,slot:0,planes:[2,8]}]}]}]};
  assert.deepEqual(aircraftAfterNode(reference,estimate,{nodeId:'A',shipId:1}),
    {status:'estimated',slots:{0:[4,10]},reason:'沿途制空及迎击损耗范围，非概率'});
  assert.equal(aircraftAfterNode(reference,estimate,{nodeId:'B',shipId:1}).status,'unknown');
  assert.equal(aircraftAfterNode(reference,estimate,{nodeId:'C',shipId:1}).status,'unknown');
  // Another branch or later node may be uncertain without invalidating this
  // earlier step's recorded loss interval.
  const mixed={...estimate,status:'unknown',paths:[{status:'unknown',steps:estimate.paths[0].steps}]};
  assert.deepEqual(aircraftAfterNode(reference,mixed,{nodeId:'A',shipId:1}).slots,{0:[4,10]});
  const rounds={...estimate,paths:[{steps:[...estimate.paths[0].steps,
    {node:'A',round:2,aircraft:[{shipId:1,slot:0,planes:[1,7]}]}]}]};
  assert.deepEqual(aircraftAfterNode(reference,rounds,{nodeId:'A',round:2,shipId:1}).slots,{0:[1,7]});
});
test('known standard submarine elites and RE elite have opening torpedo; unrelated enemy variants remain unknown',()=>{
  const e=id=>({status:'known',apiId:id});
  assert.deepEqual(enemyOpeningTorpedo(e(1530)),{status:'known',eligible:false});
  assert.deepEqual(enemyOpeningTorpedo(e(1532)),{status:'known',eligible:true});
  assert.deepEqual(enemyOpeningTorpedo(e(1562)),{status:'known',eligible:true});
  assert.deepEqual(enemyOpeningTorpedo(e(1736)),{status:'known',eligible:true});
  assert.deepEqual(enemyOpeningTorpedo(e(1561)),{status:'known',eligible:false});
  assert.deepEqual(enemyOpeningTorpedo(e(1501)),{status:'unknown',eligible:null});
  assert.deepEqual(enemyOpeningTorpedo(e(1562),{nodeKind:'nightBattle'}),{status:'known',eligible:false});
});
test('normal-map boss variants use verified no-opening rules and unknown variants stay unknown',()=>{
  const enemy=id=>({status:'known',apiId:id});
  for(const id of [1587,1588,1589,1590,1597,1598,1601,1602,1619,1620,1653,1656,1898,1899,1901,1902,1922,1925,1971,1974])
    assert.deepEqual(enemyOpeningTorpedo(enemy(id)),{status:'known',eligible:false},String(id));
  assert.deepEqual(enemyOpeningTorpedo(enemy(1562)),{status:'known',eligible:true});
  assert.deepEqual(enemyOpeningTorpedo(enemy(999999)),{status:'unknown',eligible:null});
});
test('reviewed normal-map surface variants cannot launch opening torpedoes with the documented loadout',()=>{
  const e=id=>({status:'known',apiId:id});
  for(const id of [1527,1528,1548,1555,1565,1573,1575,1576,1577,1578,1579,1586,1591,1592,1595,1613,1615,2059,2060,2061,2062])
    assert.deepEqual(enemyOpeningTorpedo(e(id)),{status:'known',eligible:false},`enemy ${id}`);
  // Unknown variants do not inherit the decision merely from their class.
  assert.deepEqual(enemyOpeningTorpedo(e(1501)),{status:'unknown',eligible:null});
  assert.deepEqual(enemyOpeningTorpedo(e(1562)),{status:'known',eligible:true});
  // A catalog change or missing occupied-slot name requires review again.
  const catalog=require('../../../data/sortie/enemy_catalog.json');
  const master=catalog.enemies.find(enemy=>enemy.apiId===1577),original=master.equipment[1].name;
  try{
    master.equipment[1].name='深海烏賊魚雷';
    assert.deepEqual(enemyOpeningTorpedo(e(1577)),{status:'unknown',eligible:null});
    delete master.equipment[1].name;
    assert.deepEqual(enemyOpeningTorpedo(e(1577)),{status:'unknown',eligible:null});
  }finally{master.equipment[1].name=original;}
});
test('2-3 enemy ASW uses cited hull data and verified normal equipment',()=>{
  const e=id=>({status:'known',apiId:id});
  assert.equal(enemyAswPower(e(1501)).powerMin,23);
  assert.equal(Math.floor(enemyAswPower(e(1518)).powerMin),25);
  assert.equal(Math.floor(enemyAswPower(e(1519)).powerMin),26);
  assert.equal(Math.floor(enemyAswPower(e(1575)).powerMin),74);
  assert.equal(Math.floor(enemyAswPower(e(1576),{phase:'night',nightStart:true}).powerMin),74);
  assert.equal(enemyAswPower(e(1576),{phase:'night',nightStart:false}).powerMax,0);
  assert.equal(enemyAswPower(e(1510)).eligible,false);
  assert.equal(enemyAswPower(e(1523)).eligible,false);
  assert.equal(enemyAswPower(e(1501),{phase:'openingAsw'}).eligible,false);
  assert.equal(enemyAswPower(e(1501),{phase:'airRaid'}).status,'unknown');
  assert.equal(enemyAswPower(e(99999)).status,'unknown');
});
test('normal-map destroyers, light cruisers and torpedo cruisers use documented ASW',()=>{
  const enemy=id=>({status:'known',apiId:id});
  for(const [id,power] of [[1503,23],[1504,24],[1506,25],[1516,25],[1517,26],
    [1520,27],[1554,61],[1555,63],[1559,27],[1577,41],[1578,42],[1591,56],[1592,56],
    [1597,32],[1598,32],[1601,32],[1602,32]]){
    const reading=enemyAswPower(enemy(id));
    assert.equal(reading.status,'known',String(id));assert.equal(reading.eligible,true,String(id));
    assert.equal(Math.floor(reading.powerMin),power,String(id));
  }
  // Boss variants are not silently inferred from a superficial carrier name.
  assert.equal(enemyAswPower(enemy(2059)).status,'unknown');
  const catalog=require('../../../data/sortie/enemy_catalog.json').enemies;
  for(const id of [1554,1555,1559]){
    const master=catalog.find(row=>row.apiId===id),original=master.equipment[2].name;
    try{master.equipment[2].name='不明装备';assert.equal(enemyAswPower(enemy(id)).status,'unknown',String(id));}
    finally{master.equipment[2].name=original;}
  }
});
test('ordinary Wo-class carriers do not attack submarines, while Nu flagship depends on aircraft',()=>{
  const enemy=id=>({status:'known',apiId:id});
  for(const id of [1512,1525,1579,1615]){
    const reading=enemyAswPower(enemy(id));assert.equal(reading.status,'known');assert.equal(reading.eligible,false);
  }
  const full=enemyAswPower(enemy(1560),{slotRemaining:{1:[22,22],2:[22,22],3:[22,22]}});
  assert.equal(full.status,'known');assert.equal(full.eligible,true);assert.equal(full.powerMax,20);
  const partial=enemyAswPower(enemy(1560),{slotRemaining:{1:[1,22],2:[0,22],3:[0,22]}});
  assert.equal(partial.status,'partial');assert.equal(partial.eligible,true);assert.equal(partial.powerMin,11);assert.equal(partial.powerMax,20);assert.equal(partial.referencePower,20);
  const empty=enemyAswPower(enemy(1560),{slotRemaining:{1:[0,0],2:[0,0],3:[0,0]}});
  assert.equal(empty.status,'known');assert.equal(empty.eligible,false);
  assert.equal(enemyAswPower(enemy(1560),{phase:'night',nightStart:true}).eligible,false);
  assert.equal(enemyAswPower(enemy(1560),{slotRemaining:{1:[0,23]}}).status,'unknown');
});
test('Northern and Supply Depot installations have documented daytime aircraft ASW',()=>{
  const enemy=id=>({status:'known',apiId:id}),all={0:[1,1],1:[1,1],2:[1,1],3:[1,1]};
  for(const [id,power] of [[1587,20],[1588,21.5],[1589,20],[1590,21.5],[1653,38],[1656,41],[1922,41],[1925,44]]){
    const r=enemyAswPower(enemy(id),{slotRemaining:all});assert.equal(r.status,'known',String(id));
    assert.equal(r.eligible,true,String(id));assert.equal(r.powerMin,power,String(id));
    assert.equal(enemyAswPower(enemy(id),{phase:'night',nightStart:true}).eligible,false,String(id));
  }
  const r=enemyAswPower(enemy(1653));assert.equal(r.status,'partial');assert.equal(r.eligible,null);
  assert.equal(r.powerMin,0);assert.equal(r.powerMax,38);assert.equal(r.referencePower,38);
});
test('RE elite keeps aviation depletion and uncertain BBV formula constants distinct',()=>{
  const enemy={status:'known',apiId:1562};
  const full=enemyAswPower(enemy,{slotRemaining:{3:[1,180]}});
  assert.equal(full.status,'partial');assert.equal(full.eligible,true);
  assert.equal(full.powerMin,38.5);assert.equal(full.powerMax,43.5);
  const uncertain=enemyAswPower(enemy);assert.equal(uncertain.eligible,null);assert.equal(uncertain.powerMin,0);
  const empty=enemyAswPower(enemy,{slotRemaining:{3:[0,0]}});
  assert.equal(empty.status,'known');assert.equal(empty.eligible,false);
  assert.equal(enemyAswPower(enemy,{slotRemaining:{3:[0,181]}}).status,'unknown');
});
test('RE elite still prioritizes submarines at night when every plane is lost',()=>{
  const enemy={status:'known',apiId:1562};
  const night=enemyAswPower(enemy,{phase:'night',nightStart:true,slotRemaining:{3:[0,0]}});
  assert.equal(night.eligible,true);assert.equal(night.status,'partial');
  assert(night.powerMin>0);assert(night.powerMax>=night.powerMin);
  const transition=enemyAswPower(enemy,{phase:'night',nightStart:false,slotRemaining:{3:[0,0]}});
  assert.equal(transition.eligible,true);assert.equal(transition.powerMin,0);assert.equal(transition.powerMax,0);
  assert(transition.reasons.some(r=>/擦伤/.test(r)));
  const unknown=enemyAswPower(enemy,{phase:'night',slotRemaining:{3:[0,0]}});
  assert.equal(unknown.eligible,true);assert.equal(unknown.powerMin,0);assert(unknown.powerMax>0);
  assert.equal(enemyAswPower(enemy,{phase:'night',slotRemaining:{3:[0,181]}}).eligible,true);
});
test('zero-capacity enemy submarines need no aircraft data and jet assault is explicitly partial',()=>{
  const {store,entry}=friendly();
  assert.deepEqual(deriveEnemyAir(store,{status:'known',apiId:1530}),{status:'known',attacks:[],reasons:[],unresolvedAttack:false});
  store.const.$equips[200]={api_id:200,api_name:'噴式景雲改',api_type:[0,0,57,0],api_baku:15};
  store.info.equips[200]={api_id:200,api_slotitem_id:200,api_level:0};
  entry.slots[0]=200;
  const result=deriveFriendlyAir(store,entry,{slotRemaining:{0:[18,18],1:[12,12],2:[4,4]}});
  assert.equal(result.status,'partial');assert(result.reasons.some(s=>/喷式强袭/.test(s)));
});
