'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const make=require('../../helpers/workbench_fixture');
const {previewForMap}=require('../../../src/domain/routes/sortie_profile');
const plans=require('../../../src/domain/routes/route_plans');
const {evaluateRoute,enemyFormation,groundReferenceSlots,laterBattleExists,advanceSupply}=require('../../../src/domain/combat/route_estimate');
const {routeEncounters}=require('../../../src/domain/combat/combat_encounters');
const {projectedHull}=require('../../../src/domain/combat/combat_projection');
const {nodeThreat,equipmentLookup}=require('../../../src/domain/combat/combat_threat');
function fixture({fire=35,torpedo=30,armor=15,hp=35,type=2,count=1}={}){
  const store=make(),ships=[];
  for(let id=1;id<=count;id++){
    const ship=store.info.ships[id],master=store.const.$ships[id];
    Object.assign(ship,{api_maxhp:hp,api_nowhp:hp,api_soukou:[armor,armor],api_karyoku:[fire,fire],
      api_raisou:[torpedo,torpedo],api_kyouka:[0,0,0,0],api_lucky:[20,20],api_kaihi:[60,60]});
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
test('remaining supply is tracked independently and unknown costs propagate',()=>{
  const full={fuel:1,ammo:1};
  const battle=advanceSupply(full,{fuel:.2,ammo:.2});assert.deepEqual(battle,{fuel:.8,ammo:.8});
  const asw=advanceSupply(battle,{fuel:.08,ammo:0});assert(Math.abs(asw.fuel-.72)<1e-9);assert.equal(asw.ammo,.8);
  const whirlpool=advanceSupply(asw,{fuel:null,ammo:0});assert.equal(whirlpool.fuel,null);assert.equal(whirlpool.ammo,.8);
  const later=advanceSupply(whirlpool,{fuel:.2,ammo:.2});assert.equal(later.fuel,null);assert(Math.abs(later.ammo-.6)<1e-9);
  assert.deepEqual(advanceSupply({fuel:.1,ammo:.1},{fuel:.2,ammo:.2}),{fuel:0,ammo:0});
});

test('a whirlpool keeps numeric before-battle supply on subsequent route nodes',()=>{
  const map=require('../../../data/sortie/encounters/1-1.json'),old=map.nodes.W;
  map.nodes.W={...require('../../../data/sortie/encounters/3-3.json').nodes.C,node:'W'};
  try{
    const f=fixture({fire:70,torpedo:50,armor:35,hp:60});
    f.store.const.$ships[1].api_fuel_max=100;
    const original=profile('1-1','雷巡流');
    // Synthetic path isolates supply propagation without adding a real edge.
    const p={...original,routePaths:[{nodes:['W','A','C']}],mapPreview:{...original.mapPreview,nodes:[...original.mapPreview.nodes,{id:'W'}]}};
    const result=assess(f,p);
    assert.equal(result.status,'estimated',result.reasons?.join('；'));
    assert(Math.abs(result.diagnostics.nodes[0].supplyBefore.fuel-.7)<1e-9);
    assert(Math.abs(result.diagnostics.nodes[1].supplyBefore.fuel-.5)<1e-9);
    assert.equal(result.diagnostics.supplyEstimates[0].radarShips,0);
  }finally{if(old)map.nodes.W=old;else delete map.nodes.W;}
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
  assert.deepEqual(strong.diagnostics.nodes.map(node=>node.supplyBefore),[{fuel:1,ammo:1},{fuel:.8,ammo:.8}]);
  assert(strong.balance.ratio>weak.balance.ratio);
  assert(weak.reasons.some(reason=>reason.includes('不是实际通过率')));
});
test('land-base waves affect only their assigned reachable node, and other maps are unchanged',()=>{
  const f=fixture({fire:15,torpedo:10,armor:5,hp:20});
  f.store.const.$equips[901]={api_id:901,api_name:'一式陸攻',api_type:[0,0,47],api_tyku:3,api_raig:10,api_baku:8,api_tais:0,api_distance:8};
  f.store.info.equips[901]={api_id:901,api_slotitem_id:901,api_alv:7,api_level:0};
  const bases=[{areaId:6,rid:1,slots:[{slotId:1,itemId:901,count:18,state:1}],targets:['N','N']}];
  const land=require('../../../src/domain/combat/land_base');
  const before=land.prepare(f.store,bases,{area:'6-4',nodeId:'C',nodeKind:'battle',enemyAirPower:0});
  const target=land.prepare(f.store,bases,{area:'6-4',nodeId:'N',nodeKind:'battle',enemyAirPower:0});
  assert.equal(before.waves.length,0);assert.equal(target.waves.length,2);
  const battle=require('../../../src/domain/combat/combat_battle'),enemy=require('../../../src/domain/combat/combat_encounters').enemyRecord({apiId:1501,apiIdStatus:'verified(test)'});
  const prepared=battle.prepareBattle([projectedHull(f.store,f.scheme.ships[0])],[{...enemy,hp:{min:1000,max:1000}}]);
  const without=battle.runScenario(prepared,battle.random(17));
  const withBase=battle.runScenario({...prepared,landBase:target},battle.random(17));
  assert(withBase.enemyHp[0]<without.enemyHp[0]);
  const unrelated=profile('1-1','雷巡流');
  assert.deepEqual(assess(f,unrelated,{landBases:bases}),assess(f,unrelated));
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
test('route air raid connects the projected fleet cut-in to enemy interception',()=>{
  const map=require('../../../data/sortie/encounters/1-1.json'),oldKind=map.nodes.A.kind,oldPatterns=map.nodes.A.phases.base.patterns;
  const battle=require('../../../src/domain/combat/combat_battle'),original=battle.runScenario,seen=[];
  const f=fixture({count:1,hp:100,armor:50});
  Object.assign(f.store.const.$ships[1],{api_name:'秋月改',api_ctype:54,api_tyku:[116,116],api_slot_num:3,api_maxeq:[0,0,0]});
  Object.assign(f.store.info.ships[1],{api_slot:[101,102,103],api_kyouka:[0,0,0,0,0]});
  f.scheme.ships[0].slots=[101,102,103];
  for(const [id,type,icon,aa] of [[101,1,16,10],[102,1,16,10],[103,12,11,4]]){
    f.store.const.$equips[id]={api_id:id,api_name:id===103?'13号対空電探改':'10cm連装高角砲＋高射装置',api_type:[0,0,type,icon],api_tyku:aa};
    f.store.info.equips[id]={api_id:id,api_slotitem_id:id,api_level:0};
  }
  f.store.const.$equips[1594]={api_id:1594,api_name:'深海空要塞(偵察型)',api_type:[3,5,7,7],api_baku:3,api_raig:0};
  f.store.const.$equips[1562]={api_id:1562,api_name:'深海解放陸爆Ace',api_type:[3,5,7,7],api_baku:16,api_raig:0};
  battle.runScenario=(prepared,rng,options)=>{
    const trace=[],out=original(prepared,rng,{...options,trace});
    if(prepared.kind==='aerialRaid')seen.push({prepared,trace});
    return out;
  };
  try{
    map.nodes.A.kind='aerialRaid';map.nodes.A.phases.base.patterns=[{pattern:1,enemyShips:[{apiId:1889,apiIdStatus:'verified(test)'}],formation:['輪形']}];
    const base=profile('1-1','雷巡流'),p={...base,routePaths:[{nodes:['A','C']}],targetNodes:['C']};
    const result=assess(f,p);
    assert.equal(result.status,'estimated',result.reasons?.join('；'));
    assert(seen.some(entry=>entry.prepared.fleetAirDefense?.cutins.some(row=>row.id===1)));
    assert(seen.some(entry=>entry.trace.some(row=>row.phase==='airDefense'&&row.cutin===1)));
    assert(result.reasons.some(reason=>reason.includes('制空资料不足')));
  }finally{battle.runScenario=original;map.nodes.A.kind=oldKind;map.nodes.A.phases.base.patterns=oldPatterns;}
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
      {id:'C',kind:'battle',supplyBefore:{fuel:.8,ammo:.8},visits:0,severe:0,ownHpLoss:null,enemyHpLoss:null},
      'unvisited battles must not be presented as zero damage');
    severe=false;
    const safe=assess(f,path(['A','C']));
    assert(safe.balance.ratio>long.balance.ratio,'severe damage is still penalized as a route risk');
    assert.equal(safe.diagnostics.nodes[1].visits,32);
    assert.equal(safe.diagnostics.nodes[1].severe,0);
  }finally{battle.runScenario=original;}
});

test('all journeys stopping before the target are not an even route despite high enemy damage',()=>{
  const battle=require('../../../src/domain/combat/combat_battle'),original=battle.runScenario;
  const f=fixture({hp:40}),base=profile('1-1','雷巡流');
  f.store.info.ships[1].api_nowhp=20;
  // Synthetic order of recorded fights, not a claim about the real 1-1 map.
  const p={...base,routePaths:[{nodes:['A','B','C']}],targetNodes:['C'],
    mapPreview:{...base.mapPreview,nodes:[...base.mapPreview.nodes,{id:'B'}]}};
  let sample=0,step=0;
  battle.runScenario=(prepared,rng,{initialHp,specialUsed}={})=>{
    if(!initialHp)return original(prepared,rng);
    if(step===0){sample++;assert.equal(initialHp[0],20,'use current medium-damaged HP');}
    const severe=sample<=14||step===1;
    step=severe?0:step+1;
    return {status:'estimated',ownHp:[severe?10:19],enemyLost:.87,severe,
      specialUsed:!!specialUsed,damageByEnemy:prepared.foes.map(()=>0)};
  };
  try{
    const result=assess(f,p);
    assert.equal(result.status,'estimated');assert.equal(result.balance.label,'压倒性劣势');
    assert.deepEqual(result.diagnostics.journeys,{samples:32,completed:0,stoppedBeforeTarget:32});
    assert.deepEqual(result.diagnostics.nodes.map(n=>[n.id,n.visits,n.severe]),[['A',32,14],['B',18,18],['C',0,0]]);
    assert(result.diagnostics.nodes[0].enemyHpLoss>.8,'retain damage actually inflicted before retreat');
  }finally{battle.runScenario=original;}
});

test('heavy damage after the final target battle differs from retreating before it',()=>{
  const battle=require('../../../src/domain/combat/combat_battle'),original=battle.runScenario;
  const f=fixture({hp:40}),p=profile('1-1','雷巡流');let step=0,beforeTarget=true;
  battle.runScenario=(prepared,rng,{initialHp,specialUsed}={})=>{
    if(!initialHp)return original(prepared,rng);
    const severe=beforeTarget||step===1;step=severe?0:step+1;
    return {status:'estimated',ownHp:initialHp.map(n=>severe?10:n),enemyHp:prepared.foes.map(()=>0),enemyLost:1,severe,
      specialUsed:!!specialUsed,damageByEnemy:prepared.foes.map(()=>0)};
  };
  try{
    const retreat=assess(f,p);beforeTarget=false;
    const target=assess(f,p);
    assert.equal(retreat.diagnostics.journeys.stoppedBeforeTarget,32);
    assert.deepEqual(target.diagnostics.journeys,{samples:32,completed:32,stoppedBeforeTarget:0});
    assert(target.balance.ratio>retreat.balance.ratio);
    assert.equal(target.diagnostics.nodes.at(-1).severe,32);
    assert.equal(target.diagnostics.nodes.at(-1).visits,32);
  }finally{battle.runScenario=original;}
});

test('safe journeys reward flagship kills and final S victories without treating escort damage as success',()=>{
  const battle=require('../../../src/domain/combat/combat_battle'),original=battle.runScenario;
  const f=fixture({hp:40}),p=profile('1-1','雷巡流');let bossHeavy=false,bossCleared=true,escortOnly=false,bossOnly=false,nightBattles=0;
  battle.runScenario=(prepared,rng,{initialHp,specialUsed}={})=>{
    if(!initialHp)return original(prepared,rng);
    const target=prepared.includeNight;
    if(target)nightBattles++;
    return {status:'estimated',ownHp:initialHp.map(n=>target&&bossHeavy?10:Math.max(11,n-1)),
      enemyHp:prepared.foes.map((s,i)=>target&&escortOnly?(i===0?s.hp:0):target&&bossOnly?(i===0?0:s.hp):target&&!bossCleared?s.hp*.9:0),
      enemyLost:target&&escortOnly?(prepared.foes.length-1)/prepared.foes.length:target&&bossOnly?1/prepared.foes.length:target&&!bossCleared?.1:1,
      severe:!!target&&bossHeavy,specialUsed:!!specialUsed,damageByEnemy:prepared.foes.map(()=>0)};
  };
  try{
    const light=assess(f,p);bossHeavy=true;
    const heavy=assess(f,p);
    assert.equal(light.status,'estimated');assert.equal(heavy.status,'estimated');
    assert.equal(light.balance.label,'压倒性优势');assert.deepEqual(heavy.balance,light.balance);
    assert.deepEqual(heavy.diagnostics.journeys,{samples:32,completed:32,stoppedBeforeTarget:0});
    assert.deepEqual(heavy.diagnostics.target,{id:'C',visits:32,sVictories:32,severe:32,flagshipDamage:1,fleetDamage:1,includeNight:true});
    assert.equal(light.diagnostics.target.severe,0);assert(nightBattles>=64);
    bossHeavy=false;bossCleared=false;
    const failed=assess(f,p);
    assert.equal(failed.diagnostics.target.sVictories,0);
    assert(Math.abs(failed.diagnostics.target.flagshipDamage-.1)<1e-9);
    assert(failed.balance.rank<2,'easy en-route victories cannot conceal a failed boss attack');
    escortOnly=true;
    const escorts=assess(f,p);
    assert.equal(escorts.balance.label,'压倒性劣势','destroying escorts alone cannot conceal an untouched boss');
    escortOnly=false;bossOnly=true;
    const flagship=assess(f,p);
    assert(flagship.balance.rank>=2,'sinking the target flagship is progress even when escorts survive');
    assert.equal(flagship.diagnostics.target.sVictories,0,'a flagship kill is not an S victory');
  }finally{battle.runScenario=original;}
});
test('candidate comparisons keep target random draws paired when earlier battles consume different draws',()=>{
  const battle=require('../../../src/domain/combat/combat_battle'),original=battle.runScenario;
  const f=fixture({hp:40}),p=profile('1-1','雷巡流');let precedingDraws=1,draws=[];
  battle.runScenario=(prepared,rng,{initialHp,specialUsed}={})=>{
    if(!initialHp)return original(prepared,rng);
    if(prepared.includeNight)draws.push(rng());
    else for(let i=0;i<precedingDraws;i++)rng();
    return {status:'estimated',ownHp:initialHp.slice(),enemyHp:prepared.foes.map(()=>0),enemyLost:1,
      severe:false,specialUsed:!!specialUsed,damageByEnemy:prepared.foes.map(()=>0)};
  };
  try{
    assert.equal(assess(f,p).status,'estimated');const first=draws.slice();
    draws=[];precedingDraws=20;
    assert.equal(assess(f,p).status,'estimated');
    assert.equal(first.length,32);assert.deepEqual(draws,first);
  }finally{battle.runScenario=original;}
});
test('an explicitly refined evaluation runs more paired reference scenarios',()=>{
  const f=fixture({count:2}),p=profile('1-1','雷巡流');
  const result=assess(f,p,{samples:64});
  assert.equal(result.status,'estimated',result.reasons?.join('；'));
  assert.equal(result.diagnostics.journeys.samples,64);
  assert.equal(assess(f,p,{samples:100000}).status,'unknown');
});
test('sortie night contact recognizes confirmed air disadvantage and opening-night battles',()=>{
  const {friendlyNightContact}=require('../../../src/domain/combat/route_estimate');
  const own={candidates:[{shipIndex:0,rate:.6,bonus:5}]};
  assert.equal(friendlyNightContact(own,null),null);
  assert.equal(friendlyNightContact(own,{before:{min:29,max:60},required:{superiority:30,supremacy:60}}),null);
  assert.deepEqual(friendlyNightContact(own,{before:{min:30,max:60},required:{superiority:30,supremacy:60}}).states,['superiority']);
  assert.deepEqual(friendlyNightContact(own,{before:{min:60,max:60},required:{superiority:30,supremacy:60}}).states,['supremacy']);
  const step=(min,max,range)=>({before:{min,max},required:{superiority:30,supremacy:60},...(range?{enemyAirPowerRange:range}:{})});
  assert.deepEqual(friendlyNightContact(own,step(7,13)).states,['disadvantage']);
  assert.equal(friendlyNightContact(own,step(6,6)),null,'one third is loss');
  assert.equal(friendlyNightContact(own,step(14,14)),null,'parity cannot trigger our contact');
  assert.equal(friendlyNightContact(own,step(13,14)),null,'a range crossing parity is uncertain');
  assert.deepEqual(friendlyNightContact(own,step(7,12,{min:18,max:20})).states,['disadvantage']);
  assert.equal(friendlyNightContact(own,step(7,13,{min:18,max:20})),null);
  assert.deepEqual(friendlyNightContact(own,null,{openingNight:true}).states,['openingNight']);
});
test('an opening-night route passes night contact into the actual battle simulation',()=>{
  const map=require('../../../data/sortie/encounters/1-1.json'),oldKind=map.nodes.A.kind;
  const battle=require('../../../src/domain/combat/combat_battle'),original=battle.runScenario;
  const f=fixture({count:1,fire:70,torpedo:50,armor:35,hp:60}),p=profile('1-1','雷巡流');
  f.store.const.$ships[1].api_maxeq=[1,0];f.store.info.ships[1].api_lv=99;
  f.store.const.$equips[99001]={api_id:99001,api_name:'夜偵',api_type:[0,0,10,50],api_saku:3,api_houm:1};
  f.store.info.equips[99001]={api_id:99001,api_slotitem_id:99001,api_level:0,api_alv:0};
  f.scheme.ships[0].slots=[99001,-1];map.nodes.A.kind='nightBattle';let observed=false;
  battle.runScenario=(prepared,rng,options)=>{
    if(options?.initialHp&&prepared.kind==='nightBattle'){
      assert.deepEqual(prepared.practiceNightContact?.states,['openingNight']);observed=true;
    }
    if(options?.initialHp)return {status:'estimated',ownHp:options.initialHp.slice(),enemyHp:prepared.foes.map(()=>0),
      enemyLost:1,severe:false,specialUsed:!!options.specialUsed,damageByEnemy:prepared.foes.map(()=>0)};
    return original(prepared,rng,options);
  };
  try{const result=assess(f,p);assert.equal(result.status,'estimated',result.reasons?.join('；'));assert(observed);}
  finally{map.nodes.A.kind=oldKind;battle.runScenario=original;}
});
test('known route weights combine objective progress while retaining honest per-branch scenario counts',()=>{
  const {combineBranches}=require('../../../src/domain/combat/route_estimate');
  const {fromRatio}=require('../../../src/domain/combat/combat_balance');
  const reading=(path,progress,completed)=>({status:'estimated',path:[path,'C'],
    balance:fromRatio((progress+.05)/(1-progress+.05)),reasons:[],
    diagnostics:{journeys:{samples:32,completed,stoppedBeforeTarget:32-completed},
      target:{id:'C',visits:completed,sVictories:completed},nodes:[]}});
  const safe=reading('A',.8,30),risky=reading('B',.2,8);
  const combined=combineBranches([{probability:.9,result:safe},{probability:.1,result:risky}]);
  const expected=fromRatio((.74+.05)/(1-.74+.05));
  assert(Math.abs(combined.balance.ratio-expected.ratio)<1e-9);
  assert.deepEqual(combined.diagnostics.representativePath,['B','C']);
  assert.equal(combined.diagnostics.journeys.completed,8);
  assert.deepEqual(combined.diagnostics.branches.map(row=>row.weight),[.9,.1]);
  assert.match(combined.reasons.at(-1),/逐点明细为综合较不利分支/);
  assert.equal(combineBranches([{probability:1,result:safe},{probability:.5,result:risky}]),null);
});
test('route evaluation actually simulates both weighted paths with their own histories',()=>{
  const old=plans.planningPath;
  const f=fixture({count:4,fire:70,torpedo:50,armor:35,hp:60}),base=profile('1-1','雷巡流');
  const p={...base,routePaths:[{nodes:['A','C']},{nodes:['B','C']}],
    mapPreview:{...base.mapPreview,nodes:[...base.mapPreview.nodes,{id:'B'}]}};
  plans.planningPath=(_route,nodes)=>({chance:{probability:nodes[0]==='A'?.8:.2}});
  try{
    const result=assess(f,p);
    assert.equal(result.status,'estimated',result.reasons?.join('；'));
    assert.equal(result.diagnostics.branches.length,2);
    assert.deepEqual(result.diagnostics.branches.map(row=>row.weight),[.8,.2]);
    assert.deepEqual(result.diagnostics.branches.map(row=>row.path),[['A','C'],['B','C']]);
    assert(result.diagnostics.branches.every(row=>row.journeys.samples===32));
    plans.planningPath=()=>({chance:{probability:null}});
    const unknown=assess(f,p);
    assert.equal(unknown.status,'estimated');assert.equal(unknown.diagnostics.branches,undefined);
    assert(unknown.reasons.some(reason=>reason.includes('分支参考概率不完整')));
    assert.equal(unknown.diagnostics.branchUncertain,true);
  }finally{plans.planningPath=old;}
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
