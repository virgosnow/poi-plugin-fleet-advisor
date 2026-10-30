'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const make=require('../../helpers/workbench_fixture');
const {previewForMap}=require('../../../src/domain/routes/sortie_profile');
const plans=require('../../../src/domain/routes/route_plans');
const {evaluateRoute,enemyFormation,groundReferenceSlots,laterBattleExists}=require('../../../src/domain/combat/route_estimate');
const {routeEncounters}=require('../../../src/domain/combat/combat_encounters');
const {projectedHull}=require('../../../src/domain/combat/combat_projection');
const {nodeThreat,equipmentLookup}=require('../../../src/domain/combat/combat_threat');
function fixture({fire=35,torpedo=30,armor=15,hp=35,type=2,count=1}={}){
  const store=make(),ships=[];
  for(let id=1;id<=count;id++){
    const ship=store.info.ships[id],master=store.const.$ships[id];
    Object.assign(ship,{api_maxhp:hp,api_nowhp:hp,api_soukou:[armor,armor],api_karyoku:[fire,fire],
      api_raisou:[torpedo,torpedo],api_kyouka:[0,0,0,0],api_lucky:[20,20]});
    Object.assign(master,{api_stype:type,api_houg:[fire,fire],api_raig:[torpedo,torpedo],api_leng:2});
    ships.push({id,slots:ship.api_slot.slice(),ex:-1});
  }
  return {store,scheme:{fleet:1,ships}};
}
function profile(area,name){
  const option=plans.recommendedOptions(area).find(row=>row.name===name);
  const map=previewForMap(area,{paths:plans.optionPaths(option),phase:option.phase});
  return {...map,referenceOnly:false,selectedPathsVerified:true,incomplete:false,truncated:false};
}
const assess=(f,p,options={})=>evaluateRoute(f.store,f.scheme,p,{route:{area:p.area},now:()=>0,...options});
test('multiple recorded enemy formations retain a conservative phase-aware reference',()=>{
  const formations={formation:['単縦','単横']};
  assert.equal(enemyFormation(formations,[{submarine:false}],'battle'),'単縦');
  assert.equal(enemyFormation(formations,[{submarine:true}],'battle'),'単横');
  assert.equal(enemyFormation({formation:[]},[],'battle'),undefined);
});
test('1-6 terminal resource consumption cannot affect a later battle',()=>{
  const nodes=new Map([['E',{}],['F',{}],['B',{}]]),path=['A','E','G','F','B','N'];
  assert.equal(laterBattleExists(path,path.indexOf('N'),nodes),false);
  assert.equal(laterBattleExists(path,path.indexOf('G'),nodes),true);
  assert.equal(laterBattleExists(path,path.indexOf('B'),nodes),false);
});
test('1-6 noncombat destination keeps two distinct evaluated enroute threats',()=>{
  const f=fixture({count:6,type:2,fire:50,torpedo:50,armor:20,hp:35});
  for(const ship of f.scheme.ships){
    Object.assign(f.store.const.$ships[ship.id],{api_ctype:0,api_aftershipid:'0'});
    f.store.info.ships[ship.id].api_taisen=[60,60];
  }
  const names=[['深海棲艦戦 Mark.II',6],['深海棲艦攻 Mark.II',8],['深海棲艦爆 Mark.II',7],
    ['深海棲艦爆',7],['深海棲艦攻',8],['深海棲艦戦',6],['深海ソナー Mk.II',14]];
  names.forEach(([name,type],i)=>{f.store.const.$equips[200+i]={api_id:200+i,api_name:name,api_type:[0,0,type],api_baku:type===7?6:0,api_raig:type===8?6:0};});
  const option=plans.recommendedOptions('1-6','N').find(row=>row.name==='下路水雷护航流');
  const map=previewForMap('1-6',{target:'N',paths:plans.optionPaths(option)}),p={...map,referenceOnly:false,selectedPathsVerified:true,incomplete:false,truncated:false};
  const result=assess(f,p,{route:{area:'1-6',targetNodes:['N']}});
  assert.equal(result.status,'estimated',result.reasons?.join('；'));
  assert.equal(result.threats.target.status,'none');assert.equal(result.threats.enroute.enemies.length,2);
  assert.notEqual(result.threats.enroute.enemies[0].apiId,result.threats.enroute.enemies[1].apiId);
  assert(!result.reasons.some(reason=>reason.includes('N 点弹药消耗')));
});
test('the same real 1-1 route distinguishes strong and weak synthetic fleets',()=>{
  const p=profile('1-1','雷巡流');
  const weak=assess(fixture({fire:15,torpedo:10,armor:5,hp:20}),p);
  const strong=assess(fixture({fire:70,torpedo:50,armor:35,hp:60}),p);
  assert.equal(weak.status,'estimated');assert.equal(strong.status,'estimated');
  assert(strong.balance.ratio>weak.balance.ratio);
  assert(weak.reasons.some(reason=>reason.includes('不是实际通过率')));
});
test('5-5 upper path identifies RE-class threat without putting it on the middle path',()=>{
  const f=fixture({count:6,fire:55,torpedo:50,armor:30,hp:45});
  const upper=assess(f,profile('5-5','上路大船流'));
  const middle=assess(f,profile('5-5','中路大船流'));
  assert.equal(upper.threats.enroute.enemies[0].node,'P');
  assert.match(upper.threats.enroute.enemies[0].name,/RE/);
  assert(middle.threats.enroute.enemies.every(enemy=>enemy.node!=='P'));
  // This fixture omits enemy equipment masters: an absent bomber cannot be
  // silently evaluated as a zero-power aircraft.
  assert.equal(upper.status,'unknown');assert.match(upper.reasons[0],/敌方攻击机资料不足/);
});
test('a submarine fleet facing enemy ASW cannot be labelled safe',()=>{
  const f=fixture({type:13,torpedo:80,fire:10,armor:12,hp:18,count:3});
  const result=assess(f,profile('2-3','全潜艇流'));
  assert.equal(result.status,'unknown');assert.equal(result.balance,undefined);
  assert.match(result.reasons[0],/对潜|敌方攻击机/);
});
test('an unchosen branch or formation with unknown enemy aircraft cannot silently become a grade',()=>{
  const map=require('../../../data/sortie/encounters/1-1.json');
  const a=map.nodes.A.phases.base.patterns,b=map.nodes.B.phases.base.patterns;
  const enemy=id=>({apiId:id,apiIdStatus:'verified(test)'});
  // A's six destroyers have a larger static threat score. B contains a
  // separate carrier alternative whose attack aircraft master is unavailable.
  // This deliberately ensures that B is not the branch chosen for simulation.
  map.nodes.A.phases.base.patterns=[{pattern:1,enemyShips:Array(6).fill(null).map(()=>enemy(1503)),formation:['単縦']}];
  map.nodes.B.phases.base.patterns=[{pattern:1,enemyShips:[enemy(1501)],formation:['単縦']},
    {pattern:2,enemyShips:[enemy(1510)],formation:['単縦']}];
  try{
    const f=fixture({count:4,fire:35,torpedo:30,armor:15,hp:35});
    const original=profile('1-1','雷巡流');
    // Synthetic alternate journey deliberately tests the branch guard without
    // asserting this path exists on 1-1 in the actual game.
    const p={...original,routePaths:[{nodes:['A','C']},{nodes:['B','C']}],
      mapPreview:{...original.mapPreview,nodes:[...original.mapPreview.nodes,{id:'B'}]}};
    const evidence=routeEncounters(p),fleet=f.scheme.ships.map(entry=>projectedHull(f.store,entry));
    const lookup=equipmentLookup(f.store.const.$equips);
    assert(nodeThreat(evidence.nodes.find(n=>n.id==='A'),fleet,lookup).score>
      nodeThreat(evidence.nodes.find(n=>n.id==='B'),fleet,lookup).score);
    const result=assess(f,p);
    assert.equal(result.status,'unknown');assert.equal(result.balance,undefined);
    assert.match(result.reasons[0],/B 点.*敌方攻击机资料不足/);
  }finally{map.nodes.A.phases.base.patterns=a;map.nodes.B.phases.base.patterns=b;}
});
test('preflight permits an alternative with supported land-target attacks',()=>{
  const map=require('../../../data/sortie/encounters/1-1.json'),original=map.nodes.A.phases.base.patterns;
  map.nodes.A.phases.base.patterns=[...original,{pattern:100,
    enemyShips:[{apiId:1665,apiIdStatus:'verified(test)'}],formation:['単縦']}];
  try{
    const f=fixture({count:2});
    for(const entry of f.scheme.ships){
      entry.slots=[-1];
      Object.assign(f.store.const.$ships[entry.id],{api_ctype:0,api_aftershipid:'0'});
    }
    const result=assess(f,profile('1-1','雷巡流'));
    assert.equal(result.status,'estimated',result.reasons?.join('；'));
  }finally{map.nodes.A.phases.base.patterns=original;}
});
test('air raids do not count as a missed friendly attack and enemy air damage still matters',()=>{
  const map=require('../../../data/sortie/encounters/1-1.json'),oldKind=map.nodes.A.kind,
    oldPatterns=map.nodes.A.phases.base.patterns;
  const ref=id=>({apiId:id,apiIdStatus:'verified(test)'});
  try{
    map.nodes.A.kind='aerialRaid';
    const f=fixture({count:4});
    f.store.const.$equips[1594]={api_id:1594,api_name:'深海空要塞(偵察型)',api_type:[3,5,7,7],api_baku:3,api_raig:0};
    f.store.const.$equips[1562]={api_id:1562,api_name:'深海解放陸爆Ace',api_type:[3,5,7,7],api_baku:16,api_raig:0};
    const base=profile('1-1','雷巡流');
    const p=nodes=>({...base,routePaths:[{nodes}],targetNodes:['C']});
    map.nodes.A.phases.base.patterns=[{pattern:1,enemyShips:[ref(1501)],formation:['輪形']}];
    const one=assess(f,p(['C'])),quiet=assess(f,p(['A','C'])),airOnly=assess(f,p(['A']));
    assert.equal(one.status,'estimated');assert.equal(quiet.status,'estimated');
    assert.deepEqual(quiet.balance,one.balance,'a harmless air raid does not count as a failed attack');
    assert.equal(quiet.diagnostics.nodes[0].kind,'aerialRaid');
    assert.equal(quiet.diagnostics.nodes[0].enemyHpLoss,null,'enemy fleet cannot be attacked in an air raid');
    assert.equal(airOnly.status,'unknown');assert.equal(airOnly.balance,undefined);
    assert.match(airOnly.reasons[0],/只有空袭/);
    map.nodes.A.phases.base.patterns=[{pattern:1,enemyShips:[ref(1889)],formation:['輪形']}];
    const dangerous=assess(f,p(['A','C']));
    assert.equal(dangerous.status,'estimated',dangerous.reasons?.join('；'));
    assert(dangerous.balance.ratio<quiet.balance.ratio,'enemy aircraft damage worsens the comparison');
  }finally{map.nodes.A.kind=oldKind;map.nodes.A.phases.base.patterns=oldPatterns;}
});
test('unvisited battles do not double-penalize a retreat, while severe damage remains a risk',()=>{
  const battle=require('../../../src/domain/combat/combat_battle'),original=battle.runScenario;
  const f=fixture({count:1,hp:40}),base=profile('1-1','雷巡流');
  const path=nodes=>({...base,routePaths:[{nodes}],targetNodes:[]});
  let severe=true;
  // Controlled scenario: A produces the same outgoing impact and immediately
  // forces retreat. C is deliberately unreachable when severe is true.
  battle.runScenario=(prepared,rng,{initialHp,specialUsed}={})=>{
    const hp=initialHp||prepared.allies.map(ship=>ship.hp);
    return {status:'estimated',ownHp:hp.map((n,i)=>severe?Math.floor(prepared.allies[i].hp*.25):n),
      enemyLost:.8,severe,specialUsed:!!specialUsed,damageByEnemy:prepared.foes.map(()=>0)};
  };
  try{
    const short=assess(f,path(['A'])),long=assess(f,path(['A','C']));
    assert.equal(short.status,'estimated');assert.equal(long.status,'estimated');
    assert.equal(short.balance.ratio,long.balance.ratio,'unvisited C is not a zero-output battle');
    assert.equal(long.diagnostics.nodes[0].id,'A');
    assert.equal(long.diagnostics.nodes[0].visits,32);
    assert.equal(long.diagnostics.nodes[0].severe,32);
    assert.equal(long.diagnostics.nodes[0].ownHpLoss,.75);
    assert(Math.abs(long.diagnostics.nodes[0].enemyHpLoss-.8)<1e-12);
    assert.deepEqual(long.diagnostics.nodes[1],
      {id:'C',kind:'battle',visits:0,severe:0,ownHpLoss:null,enemyHpLoss:null},
      'unvisited battles must not be presented as zero damage');
    severe=false;
    const safe=assess(f,path(['A','C']));
    assert(safe.balance.ratio>long.balance.ratio,'severe damage is still penalized as a route risk');
    assert.equal(safe.diagnostics.nodes[1].visits,32);
    assert.equal(safe.diagnostics.nodes[1].severe,0);
  }finally{battle.runScenario=original;}
});
test('land aviation uses an explicit zero-damage reference but missing land capability remains unknown',()=>{
  const map=require('../../../data/sortie/encounters/1-1.json'),original=map.nodes.A.phases.base.patterns;
  map.nodes.A.phases.base.patterns=[{pattern:100,enemyShips:[{apiId:1665,apiIdStatus:'verified(test)'}],formation:['単縦']}];
  try{
    const f=fixture({count:1,type:2});
    const entry=f.scheme.ships[0],master=f.store.const.$ships[entry.id];
    Object.assign(master,{api_ctype:0,api_aftershipid:'0',api_slot_num:1,api_maxeq:[10]});
    f.store.const.$equips[26]={api_id:26,api_name:'瑞雲',api_type:[0,0,11,0],api_baku:4,api_raig:0,api_tais:0,api_houg:0};
    f.store.info.equips[600]={api_id:600,api_slotitem_id:26,api_level:0};entry.slots=[600];
    const airPower={status:'range',slots:[{shipId:entry.id,slot:0,planes:[10,10],aircraftType:11,
      effectiveAntiAir:[0,0],proficiencyBonus:[0,0]}]};
    const result=assess(f,profile('1-1','雷巡流'),{airPower});
    assert.equal(result.status,'estimated',result.reasons?.join('；'));
    assert(result.reasons.some(reason=>reason.includes('假设航空开幕对陆上目标伤害为零')));
    const partialLoss=assess(f,profile('1-1','雷巡流'));
    assert.equal(partialLoss.status,'estimated',partialLoss.reasons?.join('；'));
    assert(partialLoss.reasons.some(reason=>reason.includes('对地飞机按损耗范围中间架数')));
    delete f.store.const.$equips[26];
    const unknown=assess(f,profile('1-1','雷巡流'));
    assert.equal(unknown.status,'unknown');
  }finally{map.nodes.A.phases.base.patterns=original;}
});
test('ground aircraft reference preserves confirmed depletion and flags assumed loss bounds',()=>{
  const f=fixture(),entry=f.scheme.ships[0],master=f.store.const.$ships[entry.id];
  master.api_maxeq=[10,4,0];entry.slots=[101,102,103];
  f.store.const.$equips[26]={api_id:26,api_name:'瑞雲',api_type:[0,0,11,0],api_baku:4};
  for(const id of entry.slots)f.store.info.equips[id]={api_id:id,api_slotitem_id:26,api_level:0};
  assert.deepEqual(groundReferenceSlots(f.store,entry,{status:'estimated',slots:{0:[0,10],1:0,2:0}}),
    {slots:{0:5,1:0,2:0},assumed:true});
  assert.deepEqual(groundReferenceSlots(f.store,entry,{status:'estimated',slots:{0:[1,10],1:0,2:0}}),
    {slots:{0:[1,10],1:0,2:0},assumed:false});
});
test('time budget exhaustion and an unverified path cannot generate a grade',()=>{
  const f=fixture(),p=profile('1-1','雷巡流');let clock=0;
  const timeout=assess(f,p,{now:()=>clock+=60});
  assert.equal(timeout.status,'unknown');assert.match(timeout.reasons[0],/时间预算/);
  assert.equal(timeout.balance,undefined);
  assert.equal(assess(f,{...p,selectedPathsVerified:false}).status,'unknown');
  const excess=assess(f,{...p,routePaths:Array.from({length:9},()=>p.routePaths[0])});
  assert.equal(excess.status,'unknown');assert.match(excess.reasons[0],/分支超过计算预算/);
});
test('reference scenarios are reproducible for the same fleet and route',()=>{
  const f=fixture(),p=profile('1-1','雷巡流');
  const first=assess(f,p),second=assess(f,p);
  assert.equal(first.status,'estimated');assert.equal(second.status,'estimated');
  assert.deepEqual(first.balance,second.balance);assert.equal(first.uncertain,second.uncertain);
});
test('small armor changes do not switch to an unrelated weaker enemy formation',()=>{
  const p=profile('1-1','雷巡流');
  const first=assess(fixture({fire:35,torpedo:25,armor:28,hp:25}),p);
  const second=assess(fixture({fire:35,torpedo:25,armor:29,hp:25}),p);
  assert.equal(first.status,'estimated');assert.equal(second.status,'estimated');
  assert.equal(first.balance.label,second.balance.label);
});
test('qualifying Nelson fleet uses the explicit special-attack formation as a reference',()=>{
  const f=fixture({count:6,type:9,fire:100,torpedo:20,armor:30,hp:100});
  for(const entry of f.scheme.ships){
    Object.assign(f.store.const.$ships[entry.id],{api_name:entry.id===1?'Nelson改':`测试舰${entry.id}`,
      api_ctype:0,api_aftershipid:'0'});
    Object.assign(f.store.info.ships[entry.id],{api_lucky:[40,99],api_lv:99});
  }
  const r=assess(f,profile('1-1','雷巡流'));
  assert.equal(r.status,'estimated');
  assert(r.reasons.some(reason=>reason.includes('特殊炮击发动阵形')));
});
test('1-5 ASW equipment improves the same fleet and unknown bonuses never become zero attacks',()=>{
  const f=fixture({count:4,type:1,fire:20,torpedo:20,armor:12,hp:25});
  f.store.const.$equips[47]={api_id:47,api_name:'三式水中探信儀',api_type:[0,0,14,14],api_tais:10};
  for(const ship of f.scheme.ships){
    const master=f.store.const.$ships[ship.id];Object.assign(master,{api_ctype:0,api_aftershipid:'0'});
    f.store.info.ships[ship.id].api_taisen=[85,85];
    f.store.info.equips[100+ship.id]={api_id:100+ship.id,api_slotitem_id:47,api_level:0};
  }
  const p=profile('1-5','中路四海防流'),baseline=assess(f,p);
  const fitted={...f,scheme:{...f.scheme,ships:f.scheme.ships.map(ship=>({...ship,slots:[100+ship.id,-1]}))}};
  const improved=assess(fitted,p);
  assert.equal(baseline.status,'estimated');assert.equal(improved.status,'estimated');
  assert(improved.balance.ratio>baseline.balance.ratio);
  // Missing remodel-chain data makes the blue bonus uncertain; the route must
  // not silently drop those ASW attacks and still present a comparison.
  const unknownStore={...f.store,const:{...f.store.const,$ships:{...f.store.const.$ships}}};
  for(const ship of fitted.scheme.ships){unknownStore.const.$ships[ship.id]={...unknownStore.const.$ships[ship.id]};delete unknownStore.const.$ships[ship.id].api_aftershipid;}
  const uncertain=assess({...fitted,store:unknownStore},p);
  assert.equal(uncertain.status,'unknown');assert.equal(uncertain.balance,undefined);
});
