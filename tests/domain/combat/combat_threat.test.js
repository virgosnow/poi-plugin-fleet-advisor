'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {formationRecords,enemyRecord}=require('../../../src/domain/combat/combat_encounters');
const {rankThreats,nodeThreat,enemyThreat,equipmentLookup,simulateNodeThreat,uniqueThreatCandidates}=require('../../../src/domain/combat/combat_threat');
const equipment={1:{api_name:'深海棲艦爆 Mark.II',api_baku:6,api_raig:0,api_type:[0,0,7]},
  2:{api_name:'深海棲艦攻 Mark.II',api_baku:0,api_raig:6,api_type:[0,0,8]},
  3:{api_name:'飛び魚艦爆',api_baku:10,api_raig:0,api_type:[0,0,7]},
  4:{api_name:'深海棲艦爆',api_baku:3,api_raig:0,api_type:[0,0,7]},
  5:{api_name:'深海棲艦攻',api_baku:0,api_raig:4,api_type:[0,0,8]},
  6:{api_name:'深海棲艦攻 Mark.III',api_baku:0,api_raig:11,api_type:[0,0,8]}};
const surface=(hp=35,armor=15)=>({status:'known',hp,armor,submarine:false,stype:2});
const fleet=[surface(),surface(60,60),surface(),surface(),surface(),surface()];
function node(area,id,target=false){
  const raw=require(`../../../data/sortie/encounters/${area}.json`).nodes[id];
  return {id,kind:raw.kind,target,...formationRecords(raw)};
}
test('node readings can be reused within the same assessment without changing the ranking',()=>{
  const nodes=[node('5-5','P'),node('1-1','C',true)],evidence={status:'known',nodes},rankedNodes=new Map();
  const normal=rankThreats(fleet,evidence,{equipmentMasters:equipment});
  const reused=rankThreats(fleet,evidence,{equipmentMasters:equipment,rankedNodes});
  assert.deepEqual(reused,normal);
  const lookup=equipmentLookup(equipment),cache=new Map();
  for(const item of nodes)assert.deepEqual(rankedNodes.get(item.id),nodeThreat(item,fleet,lookup,cache));
  const stronger=[surface(99,120)],next=new Map();
  rankThreats(stronger,evidence,{equipmentMasters:equipment,rankedNodes:next});
  assert.notEqual(next.get('P').score,rankedNodes.get('P').score);
});
test('5-5 P identifies Re-class elite as the conditional threat, not Ru-class',()=>{
  const r=rankThreats(fleet,{status:'known',nodes:[node('5-5','P')]},{equipmentMasters:equipment});
  assert.equal(r.status,'partial');assert.equal(r.enroute.enemies[0].node,'P');
  assert.equal(r.enroute.enemies[0].apiId,1562);assert.match(r.enroute.enemies[0].name,/RE/);
  assert(r.enroute.enemies[0].mechanisms.includes('开幕雷击'));
  assert.equal(r.target.status,'none');
});
test('6-5 J ranks the double-attacking Tsuu among the documented night threats',()=>{
  const r=rankThreats(fleet,{status:'known',nodes:[node('6-5','J')]},{equipmentMasters:equipment});
  assert.equal(r.enroute.enemies[0].apiId,1591);assert.equal(r.enroute.enemies[0].node,'J');
  assert(r.enroute.enemies[0].mechanisms.includes('夜战连击'));
  assert.equal(r.enroute.status,'partial');
});
test('regular Nu flagship can attack at night without using daytime carrier shelling power',()=>{
  const nu=node('6-5','J').formations.flatMap(f=>f.ships).find(e=>e.apiId===1560);
  const r=enemyThreat(nu,[surface(35,10)],'nightBattle',equipmentLookup(equipment));
  assert(r.mechanisms.includes('夜战攻击'));assert(r.score>0);
  assert(!r.mechanisms.includes('开幕航空'));assert(r.score<1);
});
test('the same enemy is less dangerous to more durable and armored ships',()=>{
  const enemy=node('5-5','P').formations.flatMap(f=>f.ships).find(s=>s.apiId===1562);
  const lookup=equipmentLookup(equipment);
  const fragile=enemyThreat(enemy,[surface(30,10)],'battle',lookup);
  const armored=enemyThreat(enemy,[surface(90,120)],'battle',lookup);
  assert(fragile.score>armored.score);
  assert(armored.score>0);assert(fragile.mechanisms.includes('开幕雷击'));
});
test('a same-node change in fleet protection can change the leading enemy',()=>{
  const evidence={status:'known',nodes:[node('3-5','B')]};
  const light=rankThreats(Array.from({length:6},()=>surface(20,5)),evidence,{equipmentMasters:equipment});
  const heavy=rankThreats(Array.from({length:6},()=>surface(35,30)),evidence,{equipmentMasters:equipment});
  assert.equal(light.enroute.enemies[0].node,'B');assert.equal(heavy.enroute.enemies[0].node,'B');
  assert.notEqual(light.enroute.enemies[0].apiId,heavy.enroute.enemies[0].apiId);
});
test('blocked hits retain a scratch reference rather than silently becoming zero danger',()=>{
  const r=rankThreats([surface(999,999)],{status:'known',nodes:[node('1-1','A')]});
  assert.equal(r.enroute.status,'partial');assert(r.enroute.scoreRange.min>0);
});
test('1-1 C enemy formation remains stable when armor crosses the old zero-damage boundary',()=>{
  const boss=node('1-1','C',true),lookup=equipmentLookup({});
  const a=nodeThreat(boss,[surface(25,28)],lookup),b=nodeThreat(boss,[surface(25,29)],lookup);
  assert.equal(a.enemy.pattern,3);assert.equal(b.enemy.pattern,3);
  assert(a.score>0&&b.score>0);assert(b.score<=a.score+1e-12);
  assert(a.score-b.score<.1,'one armor point should not trigger a large discontinuity');
});
test('target and enroute enemy formations stay separate',()=>{
  const r=rankThreats(fleet,{status:'known',nodes:[node('5-5','P'),node('1-1','C',true)]},{equipmentMasters:equipment});
  assert.equal(r.enroute.enemies[0].node,'P');assert.equal(r.target.enemies[0].node,'C');
});
test('noncombat target ranks two distinct enroute threats even from a single battle node',()=>{
  const first=node('1-1','C');
  const result=rankThreats(fleet,{status:'known',nodes:[first]},{equipmentMasters:equipment});
  assert.equal(result.target.status,'none');assert.equal(result.enroute.enemies.length,2);
  assert.notEqual(result.enroute.enemies[0].apiId,result.enroute.enemies[1].apiId);
  for(const enemy of result.enroute.enemies){
    assert.equal(enemy.node,'C');
    assert(first.formations.some(f=>f.ships.concat(f.escort).some(ship=>ship.apiId===enemy.apiId)));
  }
});
test('same enemy model across route nodes is one candidate with all its positions',()=>{
  const rows=[{score:3,enemy:{apiId:1,name:'A',nodes:['B']}},
    {score:2,enemy:{apiId:1,name:'A',nodes:['C']}},
    {score:1,enemy:{apiId:2,name:'B',nodes:['C']}}];
  const result=uniqueThreatCandidates(rows);
  assert.deepEqual(result.map(enemy=>enemy.apiId),[1,2]);
  assert.deepEqual(result[0].nodes,['B','C']);
});
test('known enemy ASW distinguishes submarine threat and an explicit empty equipment slot',()=>{
  const enemy=enemyRecord({apiId:1501,apiIdStatus:'verified'}),sub={...surface(),submarine:true,stype:13};
  const asw=enemyThreat(enemy,[sub],'battle',equipmentLookup({1:{api_name:'5inch単装砲',api_type:[0,0,1],api_baku:0,api_raig:0}}));
  assert.equal(asw.status,'known');assert(asw.score>0);assert(asw.mechanisms.includes('对潜攻击'));
  const carrier=enemyRecord({apiId:1512,apiIdStatus:'verified'});
  const noAsw=enemyThreat(carrier,[sub],'battle',equipmentLookup(equipment));
  assert.equal(noAsw.status,'known');assert.equal(noAsw.score,0);
});
test('5-5 P/J ranking exposes the difference between zero and full enemy aircraft assumptions',()=>{
  const r=rankThreats(fleet,{status:'known',nodes:[node('5-5','J'),node('5-5','P')]},{equipmentMasters:equipment});
  assert.equal(r.enroute.status,'partial');assert(r.enroute.scoreRange.min<r.enroute.scoreRange.max);
  assert.match(r.enroute.warnings.join(''),/航空损耗参考范围内，主要威胁可能改变/);
});
test('missing equipment and submarine ASW never become a safe known result',()=>{
  const enemy=enemyRecord({apiId:1623,apiIdStatus:'verified'});
  const missing={...node('5-5','P'),formations:[{phase:'base',pattern:1,ships:[enemy],escort:[],formation:['単縦']}]};
  const r=rankThreats([{...surface(),submarine:true,stype:13}],{status:'known',nodes:[missing]});
  assert.equal(r.enroute.status,'unknown');assert.equal(r.enroute.enemies.length,0);
  const e=rankThreats(fleet,{status:'known',nodes:[node('6-5','I')]});
  assert.equal(e.enroute.status,'partial');
});
test('aircraft carrier torpedo stat does not produce a torpedo-phase attack',()=>{
  const carrier=node('6-5','I').formations.flatMap(f=>f.ships).find(e=>e.carrier);
  assert(carrier);
  const reading=enemyThreat(carrier,fleet,'battle',equipmentLookup(equipment));
  assert(!reading.mechanisms.includes('雷击'));
});
test('land-based aviation does not create a torpedo-phase attack',()=>{
  const land=node('3-5','H').formations.flatMap(f=>f.ships).find(e=>e.kind==='installation');
  assert(land);
  const reading=enemyThreat(land,fleet,'battle',equipmentLookup(equipment));
  assert(!reading.mechanisms.includes('雷击'));
  assert(reading.mechanisms.includes('航空炮击'));
});
test('air raid and air battle do not fabricate ordinary shelling or torpedo phases',()=>{
  const carrier=node('6-5','I').formations.flatMap(f=>f.ships).find(e=>e.carrier);
  const lookup=equipmentLookup(equipment);
  for(const kind of ['aerialRaid','aerialCombat']){
    const reading=enemyThreat(carrier,fleet,kind,lookup);
    assert.equal(reading.status,'partial');assert(reading.mechanisms.includes('开幕航空'));
    assert(!reading.mechanisms.includes('炮击'));assert(!reading.mechanisms.includes('航空炮击'));
    assert(!reading.mechanisms.includes('雷击'));
  }
  const unknown=enemyThreat(carrier,fleet,'aerialRaid',equipmentLookup({}));
  assert.equal(unknown.score,0);assert.equal(unknown.status,'partial');
});
test('5-6 D land and reconnaissance-model bombers participate in air-only threat ranking',()=>{
  const masters={
    1:{api_name:'深海空要塞(偵察型)',api_baku:3,api_raig:0,api_type:[0,0,7]},
    2:{api_name:'深海解放陸爆Ace',api_baku:16,api_raig:0,api_type:[0,0,7]},
    3:{api_name:'深海双発陸爆',api_baku:12,api_raig:6,api_type:[0,0,7]},
    4:{api_name:'深海解放陸爆',api_baku:11,api_raig:0,api_type:[0,0,7]}};
  const d=node('5-6','D'),reading=nodeThreat(d,fleet,equipmentLookup(masters));
  assert.equal(d.status,'known');assert.equal(reading.enemy.pattern,6);
  assert(reading.score>0);assert(reading.enemy.mechanisms.includes('开幕航空'));
  const recon=d.formations.flatMap(f=>f.ships).find(e=>e.apiId===1889);
  const reconThreat=enemyThreat(recon,fleet,'aerialRaid',equipmentLookup(masters));
  assert(reconThreat.scoreRange.max>0);assert(reconThreat.mechanisms.includes('开幕航空'));
  // Missing required aircraft master must not turn into a zero attack.
  const missing=enemyThreat(recon,fleet,'aerialRaid',equipmentLookup({}));
  assert.notEqual(missing.status,'known');
});
test('budgets and incomplete route inputs cannot return a certified result',()=>{
  const r=rankThreats(fleet,{status:'known',nodes:Array.from({length:25},()=>node('1-1','A'))});
  assert.equal(r.status,'unknown');assert.equal(r.enroute.status,'unknown');
  const p=rankThreats(fleet,{status:'partial',nodes:[node('1-1','A')],reasons:['部分路径未知']});
  assert.equal(p.enroute.status,'partial');assert.equal(p.enroute.enemies[0].node,'A');
});
test('bounded scenarios identify 5-5 P and 6-5 J enemy threats with explicit uncertainty',()=>{
  const friendly=Array.from({length:6},(_,i)=>({status:'known',hp:i<2?80:35,initialHp:i<2?80:35,
    armor:i<2?85:20,fire:i<2?140:55,torpedo:i<2?0:65,intrinsicTorpedo:i<2?0:60,
    openingTorpedo:false,stype:i<2?9:2,submarine:false,hasAircraft:false,condition:49,
    range:i<2?3:1,asw:{status:'known',normal:true,opening:false,power:40}}));
  const store={const:{$equips:equipment}};
  const p=simulateNodeThreat(friendly,node('5-5','P'),{store,samples:16,maxFormations:3,seed:42});
  const j=simulateNodeThreat(friendly,node('6-5','J'),{store,samples:16,maxFormations:3,seed:42});
  assert.equal(p.status,'partial');assert.equal(p.enemy.apiId,1562);assert.equal(p.enemy.node,'P');
  assert.equal(j.status,'partial');assert.equal(j.enemy.apiId,1591);assert.equal(j.enemy.node,'J');
  assert.equal(j.unresolvedCritical,false);
  assert(p.sampledFormations<=3);assert.match(p.warnings.join(''),/不是大破或撤退概率/);
  const land=simulateNodeThreat(friendly,node('3-5','H'),{store,samples:16,maxFormations:3,seed:42});
  assert.equal(land.unresolvedCritical,true);assert.match(land.warnings.join(''),/陆上目标/);
  assert.equal(simulateNodeThreat(friendly,node('5-5','P'),{store,samples:17}).status,'unknown');
  assert.equal(simulateNodeThreat(friendly,node('5-5','P'),{store,maxFormations:4}).status,'unknown');
});
test('unidentified enemy aircraft is critical, not just ordinary loss uncertainty',()=>{
  const friendly=Array.from({length:6},()=>({...surface(),fire:55,torpedo:60,intrinsicTorpedo:60,
    openingTorpedo:false,stype:2,hasAircraft:false,condition:49,range:1,
    asw:{status:'known',normal:true,opening:false,power:40}}));
  const noAircraftData={const:{$equips:{}}};
  const r=simulateNodeThreat(friendly,node('5-5','P'),{store:noAircraftData,samples:8,seed:42});
  assert.equal(r.unresolvedCritical,true);assert.match(r.warnings.join(''),/敌方攻击机装备未识别/);
});
test('an unknown enemy in an unsampled alternative remains a critical uncertainty',()=>{
  const friendly=Array.from({length:6},()=>({...surface(),fire:55,torpedo:60,intrinsicTorpedo:60,
    openingTorpedo:false,stype:2,hasAircraft:false,condition:49,range:1,
    asw:{status:'known',normal:true,opening:false,power:40}}));
  const source=node('6-5','J');
  const extra={phase:'base',pattern:99,ships:[{status:'unknown',apiId:999999}],escort:[],formation:[]};
  const r=simulateNodeThreat(friendly,{...source,formations:[...source.formations,extra]},
    {store:{const:{$equips:equipment}},samples:8,maxFormations:3,seed:42});
  assert.equal(r.unresolvedCritical,true);assert.match(r.warnings.join(''),/敌舰身份或关键属性缺失/);
});
test('enemy anti-submarine gaps are critical for fleets with submarines',()=>{
  const friendly=Array.from({length:6},()=>({...surface(),fire:10,torpedo:60,intrinsicTorpedo:60,
    openingTorpedo:true,stype:13,submarine:true,hasAircraft:false,condition:49,range:0,
    asw:{status:'known',normal:false,opening:false,power:0}}));
  const ref=enemyRecord({apiId:1623,apiIdStatus:'verified'});
  const sample={...node('6-5','J'),formations:[{phase:'base',pattern:1,ships:[ref],escort:[],formation:['単縦']}]};
  const r=simulateNodeThreat(friendly,sample,{store:{const:{$equips:equipment}},samples:8,seed:42});
  assert.equal(r.unresolvedCritical,true);assert.match(r.warnings.join(''),/敌方对潜攻击资料缺失/);
});
test('special shelling is sampled only with explicit formation and sortie-used state',()=>{
  const friendly=Array.from({length:6},(_,i)=>({...surface(),fire:80,torpedo:60,intrinsicTorpedo:60,
    openingTorpedo:false,stype:i===0?9:2,hasAircraft:false,condition:49,range:1,
    asw:{status:'known',normal:true,opening:false,power:40}}));
  const special={status:'known',available:true,formation:'lineAhead',phase:'day',rate:.8,
    attacks:[{index:0,power:180,hits:1}],hpLimits:[[0,.5]],reasons:[]};
  const options={store:{const:{$equips:equipment}},samples:8,seed:42,special};
  const notSpecified=simulateNodeThreat(friendly,node('5-5','P'),options);
  assert.match(notSpecified.warnings.join(''),/特殊炮击未计入/);
  const available=simulateNodeThreat(friendly,node('5-5','P'),{...options,ownFormation:'lineAhead',specialUsed:false});
  assert.match(available.warnings.join(''),/仍可能不发动/);
  const used=simulateNodeThreat(friendly,node('5-5','P'),{...options,ownFormation:'lineAhead',specialUsed:true});
  assert.match(used.warnings.join(''),/本次出击已发动参考/);
});
