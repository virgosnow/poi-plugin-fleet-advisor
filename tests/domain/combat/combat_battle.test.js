'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {random,prepareBattle,runScenario,evaluateBattle,scenarioPower,hitDamage,combinedNightTarget,deriveOwnNight,deriveFleetSpecial}=require('../../../src/domain/combat/combat_battle');
const {enemyRecord}=require('../../../src/domain/combat/combat_encounters');
const {deriveEnemyAir}=require('../../../src/domain/combat/combat_air_asw');
const {buildGroundAttack}=require('../../../src/domain/combat/combat_ground');
const fixture=require('../../helpers/workbench_fixture');
const enemy=id=>enemyRecord({apiId:id,apiIdStatus:'verified'});
const ship={status:'known',stype:2,hp:30,initialHp:30,armor:10,fire:40,torpedo:35,
  intrinsicTorpedo:30,openingTorpedo:false,range:1,condition:49,submarine:false,hasAircraft:false,
  asw:{status:'known',normal:true,opening:true,power:90,penetration:0}};
test('seeded battle reference is reproducible and limited to at most 32 scenarios',()=>{
  const a=evaluateBattle([ship,ship],[enemy(1501)],{samples:16,seed:42});
  const b=evaluateBattle([ship,ship],[enemy(1501)],{samples:16,seed:42});
  assert.deepEqual(a,b);assert.equal(a.status,'partial');assert(a.assumptions.some(s=>s.includes('不是实际胜率')));
  assert.equal(evaluateBattle([ship],[enemy(1501)],{samples:33}).status,'unknown');
});
test('scenario accepts carried HP, returns each ship, and creates fresh enemy state',()=>{
  const p=prepareBattle([ship,ship],[enemy(1501)]);
  const first=runScenario(p,random(7),{initialHp:[30,15]});
  const second=runScenario(p,random(7),{initialHp:[30,15]});
  assert.deepEqual(first,second);assert.equal(first.ownHp.length,2);assert(first.ownHp[1]<=15);
  assert.equal(runScenario(p,random(7),{initialHp:[31,15]}).status,'unknown');
});
test('damage carried from earlier nodes increases severe-damage exposure in the same fight',()=>{
  const p=prepareBattle([ship],[enemy(1501)]);
  const count=hp=>Array.from({length:32},(_,i)=>runScenario(p,random(i+1),{initialHp:[hp]})).filter(r=>r.severe).length;
  assert(count(15)>count(30));
});
test('prior heavy damage remains severe even when a battle causes no new damage',()=>{
  const p=prepareBattle([ship],[enemy(1501)],{kind:'aerialRaid'});
  const r=runScenario(p,random(9),{initialHp:[7]});
  assert.equal(r.severe,true);assert.equal(r.stopped,true);assert.deepEqual(r.ownHp,[7]);
  assert.deepEqual(r.enemyHp,[20]);
});
test('5-6 D recon installation launches its real aircraft only in an air raid',()=>{
  const data=require('../../../data/sortie/enemy_catalog.json').enemies;
  const catalog=new Map(data.map(row=>[row.apiId,row])),ref={apiId:1889,apiIdStatus:'verified'};
  const enemy=enemyRecord(ref,catalog,{nodeKind:'aerialRaid'}),store=fixture();
  store.const.$equips={
    1594:{api_id:1594,api_name:'深海空要塞(偵察型)',api_type:[3,5,7,7],api_baku:3,api_raig:0},
    1562:{api_id:1562,api_name:'深海解放陸爆Ace',api_type:[3,5,7,7],api_baku:16,api_raig:0}};
  const air=deriveEnemyAir(store,enemy,{nodeKind:'aerialRaid'});
  assert.equal(air.unresolvedAttack,false);assert.equal(air.attacks.length,3);
  assert.deepEqual(air.attacks.map(a=>a.planesMax),[9,9,12]);
  assert(air.attacks.every(a=>a.powerMax>0));
  const p=prepareBattle([ship],[enemy],{kind:'aerialRaid',enemyAir:[air]});
  assert.notEqual(p.status,'unknown');assert.equal(prepareBattle([ship],[enemy],{kind:'battle'}).status,'unknown');
  let attacks=0,damage=0;
  for(let i=1;i<=32;i++){
    const trace=[],out=runScenario(p,random(i),{trace});
    attacks+=trace.filter(row=>row.side==='enemy'&&row.phase==='air').length;
    damage+=30-out.ownHp[0];assert.equal(out.enemyLost,0);
    assert(trace.every(row=>row.phase==='air'));
  }
  assert(attacks>0);assert(damage>0);
  const missing={...store,const:{...store.const,$equips:{1594:store.const.$equips[1594]}}};
  assert.equal(deriveEnemyAir(missing,enemy,{nodeKind:'aerialRaid'}).unresolvedAttack,true);
});
test('opening ASW before the enemy torpedo reduces risk on a pure submarine node',()=>{
  const capable={...ship,fire:0,torpedo:0,asw:{status:'known',normal:true,opening:true,power:170,penetration:0}};
  const without={...capable,asw:{...capable.asw,opening:false}};
  const a=evaluateBattle([capable],[enemy(1532)],{kind:'asw',samples:32,seed:3});
  const b=evaluateBattle([without],[enemy(1532)],{kind:'asw',samples:32,seed:3});
  assert(a.enemyImpact<b.enemyImpact);assert(a.ownImpact>b.ownImpact);
});
test('opening ASW follows range and can suppress an enemy before its torpedo attack',()=>{
  const slow={...ship,range:1},fast={...ship,range:3};
  const tough={...enemy(1532),hp:{min:1000,max:1000},armor:{min:5,max:5}};
  const p=prepareBattle([slow,fast],[tough],{kind:'asw'}),trace=[];
  runScenario(p,()=>.1,{trace});
  assert.deepEqual(trace.filter(row=>row.stage==='openingAsw'&&row.side==='own').map(row=>row.attacker),[1,0]);
  const easy={...enemy(1532),hp:{min:5,max:5},armor:{min:0,max:0}};
  const capable=prepareBattle([slow,fast],[easy],{kind:'asw'}),before=[];
  const result=runScenario(capable,()=>.1,{trace:before});
  assert.equal(result.enemyHp[0],0);
  assert(!before.some(row=>row.stage==='openingTorpedo'&&row.side==='enemy'));
});
test('midpoint aircraft references apply symmetrically; bounds are not treated as wipeout odds',()=>{
  const aircraft=[{status:'known',attacks:[{powerMin:0,powerMax:120,referencePowers:[60]}]}];
  const p=prepareBattle([{...ship,hasAircraft:true}],[enemy(1510)],{ownAir:aircraft,enemyAir:aircraft});
  const trace=[];runScenario(p,()=>.1,{trace});
  assert(trace.some(row=>row.stage==='air'&&row.side==='own'));
  assert(trace.some(row=>row.stage==='air'&&row.side==='enemy'));
  const none=[{status:'known',attacks:[{powerMin:0,powerMax:0,referencePowers:[0]}]}];
  const noTrace=[];runScenario(prepareBattle([{...ship,hasAircraft:true}],[enemy(1510)],{ownAir:none,enemyAir:none}),()=>.1,{trace:noTrace});
  assert(!noTrace.some(row=>row.stage==='air'));
});
test('two-round aerial combat uses the second-round aircraft reading and labels fallback',()=>{
  const none=[{status:'known',attacks:[{powerMin:0,powerMax:0,referencePowers:[0]}]}];
  const second=[{status:'partial',reasons:['假设航空攻击不计蓝字加成，仅作基础参考，实际数值可能不同'],
    attacks:[{powerMin:50,powerMax:50,referencePowers:[50]}]}];
  const p=prepareBattle([{...ship,hasAircraft:true}],[enemy(1501)],{kind:'aerialCombat',ownAir:none,ownAirSecond:second}),trace=[];
  runScenario(p,()=>.1,{trace});
  assert(!trace.some(row=>row.stage==='air'&&row.side==='own'));
  assert(trace.some(row=>row.stage==='air2'&&row.side==='own'));
  assert(p.reasons.some(reason=>reason.includes('不计蓝字')));
  const fallback=prepareBattle([{...ship,hasAircraft:true}],[enemy(1501)],{kind:'aerialCombat',ownAir:none});
  assert(fallback.reasons.some(reason=>reason.includes('第二轮航空损耗按第一轮参考')));
});
test('opening night battle never runs aircraft or opening torpedo phases',()=>{
  const air=[{status:'known',attacks:[{powerMin:1000,powerMax:1000}]}];
  const ordinary=evaluateBattle([ship],[enemy(1501)],{kind:'nightBattle',samples:16,seed:11});
  const withAir=evaluateBattle([{...ship,openingTorpedo:true,hasAircraft:true}],[enemy(1501)],
    {kind:'nightBattle',samples:16,seed:11,ownAir:air});
  assert.equal(ordinary.ownImpact,withAir.ownImpact);assert.equal(ordinary.enemyImpact,withAir.enemyImpact);
});
test('partial aircraft and missing enemy anti-submarine data remain disclosed',()=>{
  const surface=evaluateBattle([{...ship,hasAircraft:true}],[enemy(1501)]);
  assert.equal(surface.status,'partial');assert(surface.reasons.some(r=>r.includes('航空')));
  const sub={...ship,stype:13,submarine:true};
  const underwater=evaluateBattle([sub],[enemy(1623)]);
  assert.equal(underwater.status,'partial');assert(underwater.reasons.some(r=>r.includes('对潜')));
});
test('documented enemy ASW is a real attack rather than zero or an invented value',()=>{
  const sub={...ship,stype:13,submarine:true,hp:20,initialHp:20,armor:5};
  const p=prepareBattle([sub],[enemy(1501)]);
  assert.equal(p.enemyMain[0].enemyAsw.status,'known');
  assert(!p.reasons.some(r=>r.includes('敌方对潜攻击力资料不完整')));
  assert.equal(scenarioPower(p.foes[0],p.foes[0].hp,'asw','lineAhead',random(1)),13);
  const traces=[];let damaged=0;
  for(let i=1;i<=32;i++){
    const trace=[],r=runScenario(p,random(i),{trace});
    if(trace.some(row=>row.phase==='asw'&&row.side==='enemy'))traces.push(trace);
    if(r.ownHp[0]<20)damaged++;
  }
  assert(traces.length>0);assert(damaged>0);
});
test('submarine fleet facing a normal carrier and documented destroyer keeps the actual ASW threat',()=>{
  const sub={...ship,stype:13,submarine:true,hp:20,initialHp:20,armor:5};
  const prepared=prepareBattle([sub],[enemy(1512),enemy(1502)],{includeNight:true});
  assert.equal(prepared.foes[0].aswCapable,false);
  assert.equal(prepared.foes[1].enemyAsw.status,'known');
  assert(prepared.foes[1].enemyAsw.powerMin>0);
  assert(!prepared.reasons.some(r=>r.includes('敌方对潜攻击力资料不完整')));
  assert(prepared.reasons.some(r=>r.includes('敌方对潜按已知攻击范围参考')));
});
test('land installation with bombers is not treated as harmless to submarines',()=>{
  const sub={...ship,stype:13,submarine:true,hp:20,initialHp:20,armor:5};
  const prepared=prepareBattle([sub],[enemy(1653)]);
  assert.equal(prepared.foes[0].aswCapable,true);
  assert.equal(prepared.foes[0].enemyAsw.status,'partial');
  assert(prepared.foes[0].enemyAsw.powerMax>0);
  assert(!prepared.reasons.some(r=>r.includes('敌方对潜攻击力资料不完整')));
});
test('enemy flagship carriers can attack at night using native fire and torpedo, not daytime carrier power',()=>{
  const p=prepareBattle([ship],[enemy(1528)],{kind:'nightBattle'});
  assert.equal(p.foes[0].nightCarrier,true);assert.equal(p.foes[0].nightBase,31);
  const value=scenarioPower(p.foes[0],p.foes[0].hp,'night','lineAhead',()=>.9);
  assert.equal(value.power,31);
  const normal=prepareBattle([ship],[enemy(1510)],{kind:'nightBattle'});
  assert.equal(scenarioPower(normal.foes[0],normal.foes[0].hp,'night','lineAhead',random(1)),0);
  const boss=prepareBattle([ship],[enemy(1586)],{kind:'nightBattle'});
  assert.equal(boss.foes[0].nightBase,193);
  assert.equal(scenarioPower(boss.foes[0],boss.foes[0].hp,'night','lineAhead',()=>.9).power,193);
});
test('missing own range and unreviewed enemy opening torpedo remain uncertain',()=>{
  const p=prepareBattle([{...ship,range:undefined}],[enemy(1501)]);
  assert.equal(p.status,'partial');assert(p.reasons.some(r=>r.includes('射程未知')));
  assert(p.reasons.some(r=>r.includes('先制雷击条件待确认')));
  const withMissingHp=prepareBattle([{...ship,hpEstimated:true}],[enemy(1501)]);
  assert(withMissingHp.reasons.some(r=>r.includes('当前耐久未知')));
});
test('land target is not a surface torpedo target and remains explicitly partial',()=>{
  const land={...enemy(1501),kind:'installation'};
  const p=prepareBattle([{...ship,openingTorpedo:true}],[land]);
  const result=runScenario(p,random(1));
  assert.equal(p.status,'partial');assert(p.reasons.some(r=>r.includes('陆上目标')));
  assert.deepEqual(result.enemyHp,[land.hp.max]);
});
test('verified pillbox accepts a target-specific gun reading while unknown equipment remains disclosed',()=>{
  const store=fixture(),s=store.info.ships[1],m=store.const.$ships[1];
  Object.assign(m,{api_stype:5,api_slot_num:1,api_maxeq:[0],api_ctype:0,api_aftershipid:'0',api_houg:[20,40],api_raig:[20,40]});
  store.const.$equips[500]={api_id:500,api_name:'测试主炮',api_type:[0,0,2,2],api_houg:0,api_raig:0,api_baku:0};
  store.info.equips[101]={api_id:101,api_slotitem_id:500,api_level:0};
  Object.assign(s,{api_slot:[101],api_slot_ex:0,api_karyoku:[20,40],api_raisou:[20,40],api_kyouka:[0,0,0,0,0]});
  const land=enemy(1665),reading=buildGroundAttack(store,{id:1,slots:[101],ex:0},land);
  const p=prepareBattle([ship],[land],{ground:[[reading]],enemyFormation:'lineAhead'});
  assert(!p.reasons.some(r=>r.includes('陆上目标的装备特效')));
  const trace=[];runScenario(p,()=>.2,{trace});
  assert(trace.some(row=>row.side==='own'&&row.phase==='shelling'));
  assert(!trace.some(row=>row.side==='own'&&row.phase.includes('Torpedo')));
  const missing=prepareBattle([ship],[land],{enemyFormation:'lineAhead'});
  assert(missing.reasons.some(r=>r.includes('陆上目标的装备特效')));
});
test('missing enemy formation is disclosed, and night damage reflects medium damage',()=>{
  const unknown=prepareBattle([ship],[enemy(1501)]);
  assert(unknown.reasons.some(r=>r.includes('敌方阵形未知')));
  const known=prepareBattle([ship],[enemy(1501)],{enemyFormation:'lineAhead'});
  assert(!known.reasons.some(r=>r.includes('敌方阵形未知')));
  assert.equal(scenarioPower({...ship,side:'own',nightBase:100},15,'night','lineAhead',()=>.9).power,70);
});
test('carrier shelling applies formation before cap and an unarmed carrier cannot shell',()=>{
  const carrier={...ship,side:'own',stype:7,carrier:true,armedCarrier:true,carrierRaw:300,carrierPower:228};
  assert.equal(scenarioPower(carrier,30,'shelling','doubleLine',random(1)),224);
  assert.equal(scenarioPower({...carrier,armedCarrier:false,carrierRaw:null},30,'shelling','lineAhead',random(1)),0);
  const torp={...ship,side:'own',torpedoRaw:240,torpedoPower:187};
  assert.equal(scenarioPower(torp,30,'torpedo','doubleLine',random(1)),183);
  assert.equal(scenarioPower({...torp,side:'enemy',torpedo:0},30,'torpedo','lineAhead',random(1)),0);
  const enemyCarrier={...carrier,side:'enemy',fire:65,torpedo:4};
  assert.equal(scenarioPower(enemyCarrier,30,'shelling','lineAhead',random(1)),65);
  assert.equal(scenarioPower(enemyCarrier,30,'shelling','lineAhead',random(1),10),80);
  assert.equal(scenarioPower({...carrier,carrierRaw:100},30,'shelling','lineAhead',random(1),5),107);
  assert.equal(scenarioPower(enemyCarrier,30,'torpedo','lineAhead',random(1)),0);
});
test('armor-blocked hits use remaining-HP scratch damage, ignore ammo and cannot sink',()=>{
  const heavy={hp:100,armor:100};
  assert.equal(hitDamage(1,heavy,()=>0,1,false,0,50),3);
  assert.equal(hitDamage(1,heavy,()=>.999,0,false,0,50),6);
  assert.equal(hitDamage(1,heavy,()=>.999,0,false,0,1),0);
});
test('enemy combined fleets use escort, torpedo, main, then second shelling with correct target groups',()=>{
  const tough=id=>({...enemy(id),hp:{min:1000,max:1000},armor:{min:1000,max:1000}});
  const battleship={...ship,stype:8,hp:1000,initialHp:1000,armor:1000,fire:10};
  const p=prepareBattle([battleship,battleship],[tough(1501)],{
    escort:[tough(1502)],enemyFormation:'第三警戒航行序列'});
  assert.equal(p.combined,true);assert.equal(p.enemyFormation,'combinedThird');
  assert.equal(p.enemyMain.length,1);assert.equal(p.enemyEscort.length,1);
  const trace=[],r=runScenario(p,random(12),{trace});
  const stages=[...new Set(trace.map(e=>e.stage))];
  assert.deepEqual(stages,['escortShell','torpedo','mainShell','secondShell']);
  assert(trace.filter(e=>e.side==='own'&&e.stage==='escortShell').every(e=>e.targetGroup==='escort'));
  assert(trace.filter(e=>e.side==='own'&&e.stage==='mainShell').every(e=>e.targetGroup==='main'));
  assert(trace.filter(e=>e.side==='enemy'&&e.stage==='torpedo').every(e=>e.attacker>=p.mainCount));
  assert.equal(r.enemyMainHp.length,1);assert.equal(r.enemyEscortHp.length,1);
  const targets=new Set();for(let seed=1;seed<=128;seed++){
    const seen=[];runScenario(p,random(seed),{trace:seen});
    for(const e of seen.filter(row=>row.side==='own'&&row.stage==='secondShell'))targets.add(e.targetGroup);
  }
  assert.deepEqual([...targets].sort(),['escort','main']);
});
test('enemy combined 6-5 uses real separate main and escort formations',()=>{
  const {formationRecords}=require('../../../src/domain/combat/combat_encounters');
  const formation=formationRecords(require('../../../data/sortie/encounters/6-5.json').nodes.M).formations[0];
  assert.equal(formation.ships.length,6);assert.equal(formation.escort.length,6);
  const p=prepareBattle([ship,ship],formation.ships,{escort:formation.escort,enemyFormation:formation.formation[0]});
  assert.notEqual(p.status,'unknown');assert.equal(p.enemyMain.length,6);assert.equal(p.enemyEscort.length,6);
  const r=runScenario(p,random(42));assert.equal(r.enemyMainHp.length,6);assert.equal(r.enemyEscortHp.length,6);
  assert(p.reasons.some(reason=>reason.includes('夜战')));
});
test('combined aircraft strike with destroyed escort skips its shelling round',()=>{
  const main={...enemy(1501),kind:'installation',hp:{min:1000,max:1000},armor:{min:1000,max:1000}};
  const escort={...enemy(1502),hp:{min:2,max:2},armor:{min:0,max:0}};
  const own={...ship,hp:1000,initialHp:1000,armor:1000,hasAircraft:true};
  const p=prepareBattle([own],[main],{escort:[escort],ownAir:[{status:'known',attacks:[{powerMin:1000,powerMax:1000}]}]});
  const trace=[],r=runScenario(p,()=>.6,{trace});
  assert.equal(r.enemyEscortHp[0],0);assert(!trace.some(row=>row.stage==='escortShell'));
});
test('enemy combined night target follows tentative escort damage threshold',()=>{
  const main=[{hp:100}],escort=Array.from({length:3},()=>({hp:100}));
  assert.equal(combinedNightTarget(main,escort,[100],[100,100,100]),'escort');
  assert.equal(combinedNightTarget(main,escort,[100],[0,100,0]),'main');
  assert.equal(combinedNightTarget(main,escort,[0],[0,100,0]),'escort');
  assert.equal(combinedNightTarget(main,escort,[100],[0,0,0]),'main');
});
test('optional combined night engages only selected enemy component',()=>{
  const tough=id=>({...enemy(id),hp:{min:1000,max:1000},armor:{min:1000,max:1000}});
  const own={...ship,hp:1000,initialHp:1000,armor:1000,stype:8};
  const main=[tough(1501)],escort=[tough(1501),tough(1502)];
  const p=prepareBattle([own],main,{escort,includeNight:true});
  const trace=[],r=runScenario(p,random(1),{trace});
  assert.equal(r.nightTarget,'escort');assert(p.reasons.some(reason=>reason.includes('夜战去向为参考')));
  assert(trace.some(row=>row.stage==='night'));
  assert(trace.filter(row=>row.stage==='night'&&row.side==='own').every(row=>row.targetGroup==='escort'));
  assert(trace.filter(row=>row.stage==='night'&&row.side==='enemy').every(row=>row.attacker>=p.mainCount));
});
test('RE intrinsic ASW targets submarines at night even with aircraft emptied',()=>{
  const sub={...ship,stype:13,submarine:true,hp:20,initialHp:20,armor:5};
  const p=prepareBattle([ship,sub],[enemy(1562)],{kind:'nightBattle',enemyAir:[{status:'known',attacks:[{slot:3,planesMin:0,planesMax:0}]}]});
  assert.equal(p.foes[0].nightAswCapable,true);assert.equal(p.foes[0].nightAsw.eligible,true);
  assert(p.foes[0].nightAsw.powerMax>0);
  const trace=[];runScenario(p,()=>.1,{trace});
  assert(trace.some(row=>row.side==='enemy'&&row.phase==='nightAsw'&&row.target===1));
});
test('ordinary enemy aircraft-only carrier does not divert night attack to submarines',()=>{
  const sub={...ship,stype:13,submarine:true,hp:20,initialHp:20};
  const p=prepareBattle([ship,sub],[enemy(1510)],{kind:'nightBattle'});
  assert.equal(p.foes[0].nightAswCapable,false);
  const trace=[];runScenario(p,()=>.1,{trace});
  assert(!trace.some(row=>row.side==='enemy'&&row.phase==='nightAsw'));
});
test('night intrinsic-ASW ship prioritizes submarines; aircraft-only BBV targets surface instead',()=>{
  const escort={...ship,asw:{status:'known',normal:true,opening:true,power:90,penetration:0,hull:50}};
  const tough=id=>({...enemy(id),hp:{min:1000,max:1000},armor:{min:1000,max:1000}});
  const night=prepareBattle([escort],[tough(1532),tough(1501)],{kind:'nightBattle'}),trace=[];
  runScenario(night,()=>.1,{trace});
  assert(trace.some(row=>row.side==='own'&&row.phase==='nightAsw'&&row.target===0));
  const aviation=prepareBattle([{...escort,stype:10,asw:{...escort.asw,hull:0}}],[tough(1532),tough(1501)],{kind:'nightBattle'}),other=[];
  runScenario(aviation,()=>.1,{trace:other});
  assert(other.some(row=>row.side==='own'&&row.phase==='night'&&row.target===1));
});
test('unknown night ASW priority conservatively diverts eligible BBV but not a carrier unable to act',()=>{
  const tough=id=>({...enemy(id),hp:{min:1000,max:1000},armor:{min:1000,max:1000}});
  const bbv={...ship,stype:10,asw:{status:'known',normal:true,opening:false,power:60,penetration:0,hull:40}},
    carrier={...ship,stype:7,hasAircraft:true,asw:{status:'known',normal:true,opening:false,power:60,penetration:0,hull:40}};
  const p=prepareBattle([bbv,carrier],[tough(1532),tough(1501)],{kind:'nightBattle',
    ownNight:[{status:'known',available:false},{status:'known',available:false}]});
  assert(p.reasons.some(reason=>reason.includes('假设')&&reason.includes('低估火力')));
  assert.equal(p.allies[0].nightAswCapable,true);assert.equal(p.allies[1].nightAswCapable,false);
  assert.deepEqual(scenarioPower(p.allies[0],p.allies[0].hp,'nightAsw','lineAhead',random(1)),{power:0,hits:1});
  const trace=[];runScenario(p,()=>.1,{trace});
  assert(trace.some(row=>row.side==='own'&&row.attacker===0&&row.phase==='nightAsw'));
  assert(!trace.some(row=>row.side==='own'&&row.attacker===1&&row.stage==='night'));
});
test('unmodelled aviation against land wastes the launch instead of retargeting a surface ship',()=>{
  const land={...enemy(1501),kind:'installation',hp:{min:1000,max:1000},armor:{min:1000,max:1000}},
    surface={...enemy(1501),hp:{min:1000,max:1000},armor:{min:1000,max:1000}},
    own={...ship,stype:7,hasAircraft:true,armedCarrier:true,carrierRaw:100};
  const ground=[[{status:'unknown'},null]],air=[{status:'known',attacks:[{powerMin:200,powerMax:200}]}];
  const p=prepareBattle([own],[land,surface],{ownAir:air,ground});
  assert(p.reasons.some(reason=>reason.includes('假设航空开幕对陆上目标伤害为零')));
  const trace=[];runScenario(p,()=>0,{trace});
  assert(!trace.some(row=>row.side==='own'&&row.phase==='air'));
});
test('own night carrier requires explicit capability and cannot normally attack at half health',()=>{
  const carrier={...ship,stype:7,hasAircraft:true,armedCarrier:true,carrierRaw:100};
  const p=prepareBattle([carrier],[enemy(1501)],{kind:'nightBattle',ownNight:[{status:'known',available:true,power:100,modes:[]}]});
  assert.equal(p.allies[0].nightCarrier,true);
  const trace=[];runScenario(p,()=>.1,{initialHp:[15],trace});
  assert(!trace.some(row=>row.side==='own'&&row.stage==='night'));
});
test('ordinary boss can opt into night battle, while day-only encounters do not',()=>{
  const tough={...enemy(1501),hp:{min:1000,max:1000},armor:{min:1000,max:1000}};
  const own={...ship,hp:1000,initialHp:1000,armor:1000};
  const day=prepareBattle([own],[tough]),night=prepareBattle([own],[tough],{includeNight:true});
  const t1=[],t2=[];runScenario(day,random(2),{trace:t1});runScenario(night,random(2),{trace:t2});
  assert(!t1.some(row=>row.stage==='night'));assert(t2.some(row=>row.stage==='night'));
});
test('enemy day-to-night ASW is a scratch-only attack rather than opening-night ASW power',()=>{
  const sub={...ship,stype:13,submarine:true,hp:100,initialHp:100,armor:5,fire:0,torpedo:0,intrinsicTorpedo:0};
  const p=prepareBattle([sub],[enemy(1501)],{includeNight:true});
  assert.deepEqual(scenarioPower(p.foes[0],p.foes[0].hp,'nightAsw','lineAhead',random(1)),{power:0,hits:1});
  const trace=[];runScenario(p,()=>.1,{trace});
  assert(trace.some(row=>row.stage==='night'&&row.phase==='nightAsw'));
});
test('enemy combined daytime-to-night ASW retains actual opening-night style power',()=>{
  const sub={...ship,stype:13,submarine:true,hp:100,initialHp:100,armor:5,fire:0,torpedo:0,intrinsicTorpedo:0};
  const p=prepareBattle([sub],[enemy(1502)],{escort:[enemy(1501)],includeNight:true});
  assert.equal(p.foes[1].nightAsw.status,'known');
  assert(scenarioPower(p.foes[1],p.foes[1].hp,'nightAsw','lineAhead',random(1))>0);
});
test('night aviation distinguishes unknown losses, known remaining planes, and ordinary carriers',()=>{
  const store=require('../../helpers/workbench_fixture')(),master=store.const.$ships[1],hull=store.info.ships[1];
  Object.assign(master,{api_name:'赤城改二戊',api_stype:11,api_slot_num:2,api_maxeq:[10,4],api_houg:[30,90],api_raig:[0,0],api_aftershipid:'0',api_ctype:0});
  Object.assign(hull,{api_slot:[-1,-1],api_slot_ex:0,api_maxhp:80,api_nowhp:80,api_kyouka:[0,0,0,0,0],api_lucky:[20,99]});
  store.const.$equips[10]={api_id:10,api_name:'夜间舰攻',api_type:[0,0,8,46],api_raig:10,api_baku:0,api_houg:0,api_tais:0};
  store.info.equips[10]={api_id:10,api_slotitem_id:10,api_level:0};
  const entry={id:1,slots:[10,-1],ex:0},before=JSON.stringify([store,entry]);
  const uncertain=deriveOwnNight(store,entry);
  assert.equal(uncertain.status,'partial');assert.equal(uncertain.available,null);
  assert.equal(uncertain.powerMin,0);assert(uncertain.powerMax>0);
  const known=deriveOwnNight(store,entry,{slotRemaining:{0:[5,5]}});
  assert.equal(known.status,'known');assert.equal(known.available,true);
  assert.equal(known.powerMin,known.powerMax);
  assert.deepEqual(deriveOwnNight(store,entry,{slotRemaining:{0:[0,0]}}),{status:'known',available:false,reasons:[]});
  assert.equal(JSON.stringify([store,entry]),before);
  master.api_name='赤城改二';
  assert.deepEqual(deriveOwnNight(store,entry),{status:'known',available:false,reasons:[]});
});
test('special shelling requires the explicit matching reference formation and cannot fire twice',()=>{
  const store=require('../../helpers/workbench_fixture')();
  for(let i=1;i<=6;i++){
    Object.assign(store.const.$ships[i],{api_name:i===1?'Nelson改':`测试舰${i}`,api_stype:9,
      api_houg:[100,100],api_raig:[20,100],api_ctype:0,api_aftershipid:'0'});
    Object.assign(store.info.ships[i],{api_nowhp:100,api_maxhp:100,api_karyoku:[100,100],api_raisou:[20,100],
      api_kyouka:[0,0,0,0,0],api_lucky:[40,99],api_lv:99});
  }
  const entries=Array.from({length:6},(_,i)=>({id:i+1,slots:[-1,-1],ex:0}));
  const {projectedHull}=require('../../../src/domain/combat/combat_projection');
  const fleet=entries.map(entry=>projectedHull(store,entry)),special=deriveFleetSpecial(store,entries);
  assert.equal(special.status,'known');assert.equal(special.label,'Nelson Touch');
  assert.equal(special.formation,'doubleLine');assert(special.rate>0&&special.rate<1);
  const foe={...enemy(1501),hp:{min:1000,max:1000},armor:{min:1000,max:1000}};
  const unchosen=prepareBattle(fleet,[foe],{special});
  assert.equal(unchosen.special,null);assert(unchosen.reasons.some(reason=>reason.includes('未明确选择')));
  const wrong=prepareBattle(fleet,[foe],{special,ownFormation:'lineAhead'});assert.equal(wrong.special,null);
  const selected=prepareBattle(fleet,[foe],{special,ownFormation:'doubleLine'});
  assert(selected.special);assert(selected.reasons.some(reason=>reason.includes('实际须选阵形')));
  const withSpecial=[],alreadyUsed=[];
  assert.equal(runScenario(selected,()=>.1,{trace:withSpecial}).specialUsed,true);
  assert.equal(runScenario(selected,()=>.1,{specialUsed:true,trace:alreadyUsed}).specialUsed,true);
  assert(withSpecial.filter(row=>row.side==='own'&&row.stage==='shelling').length>
    alreadyUsed.filter(row=>row.side==='own'&&row.stage==='shelling').length);
  const missing={...special,rate:null};assert.equal(prepareBattle(fleet,[foe],{special:missing,ownFormation:'doubleLine'}).special,null);
});
