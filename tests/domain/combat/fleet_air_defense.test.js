'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const defense=require('../../../src/domain/combat/fleet_air_defense');
const {fleetDefense}=require('../../../src/domain/combat/anti_air_cutin');
const {projectShip}=require('../../../src/domain/fleet/fleet_metrics');
const {prepareBattle,runScenario,random}=require('../../../src/domain/combat/combat_battle');
const {enemyRecord}=require('../../../src/domain/combat/combat_encounters');
const fixture=require('../../helpers/workbench_fixture');

function setup(){
  const store=fixture(),m=store.const.$ships[1],s=store.info.ships[1];
  Object.assign(m,{api_name:'秋月改',api_tyku:[116,116],api_ctype:54,api_slot_num:3,api_maxeq:[0,0,0]});
  Object.assign(s,{api_slot:[101,102,103],api_kyouka:[0,0,0,0,0],api_slot_ex:0});
  for(const [i,type,icon,aa] of [[101,1,16,10],[102,1,16,10],[103,12,11,4]]){
    store.const.$equips[i]={api_id:i,api_name:i===103?'13号対空電探改':'10cm連装高角砲＋高射装置',api_type:[0,0,type,icon],api_tyku:aa};
    store.info.equips[i]={api_id:i,api_slotitem_id:i,api_level:0};
  }
  return {store,target:projectShip(store,1,{slots:s.api_slot,ex:0})};
}
test('fleet defense applies equipment, improvement and formation after per-ship rounding',()=>{
  const {store,target}=setup();
  // floor(10*.35*2 + 4*.4) = 8; diamond = floor(8*1.6)*2/1.3.
  assert.equal(fleetDefense(store,[target],'lineAhead'),8*2/1.3);
  assert.equal(fleetDefense(store,[target],'diamond'),12*2/1.3);
  store.info.equips[101].api_level=4;
  assert.equal(fleetDefense(store,[target],'lineAhead'),14*2/1.3);
});
test('AA interception matches wiki example, including independent rolls and cut-in guarantee',()=>{
  const cutin={fixed:7,multiplier:1.7};
  assert.equal(defense.intercept(180,null,224,38.46,cutin,()=>0),28);
  assert.equal(defense.intercept(180,null,224,38.46,cutin,()=>.9),172);
  assert.equal(defense.intercept(5,null,0,0,cutin,()=>.9),0);
  assert.equal(defense.intercept(0,'supremacy',224,38,cutin,()=>0),0);
  assert.equal(defense.intercept(180,null,224,38.46,cutin,()=>0,.8),57);
});
test('air superiority shoots down more enemy planes than air loss for the same rolls',()=>{
  assert(defense.intercept(100,'supremacy',0,0,null,()=>.999)<defense.intercept(100,'loss',0,0,null,()=>.999));
  assert.equal(defense.stateFor({before:{min:150,max:150},required:{supremacy:300}}),'superiority');
  assert.equal(defense.stateFor(undefined),null);
});
test('cut-in selection rolls independently in priority order and never stacks',()=>{
  const rows=[{position:0,roll:.4,id:1,fixed:7,multiplier:1.7},{position:1,roll:.8,id:2,fixed:4,multiplier:1.4}];
  let rolls=[.5,.2];assert.equal(defense.selectCutin(rows,[30,30],()=>rolls.shift()).id,2);
  assert.equal(defense.selectCutin(rows,[30,30],()=>.1).id,1);
  assert.equal(defense.selectCutin(rows,[0,30],()=>.1).id,2);
  assert.equal(defense.selectCutin(rows,[30,30],()=>.99),null);
});
test('actual battle uses configured AA, cancels emptied slots, and carries remaining planes into round two',()=>{
  const enemy=enemyRecord({apiId:1510,apiIdStatus:'verified'});
  const friendly={status:'known',stype:2,hp:1000,initialHp:1000,armor:1000,fire:1,torpedo:1,range:1,condition:49};
  const reading=[{status:'known',attacks:[{slot:0,planesMax:10,powerMin:0,powerMax:100,
    referencePowers:[60],aircraftType:7,aircraftStat:10}]}];
  const p=prepareBattle([friendly],[enemy],{kind:'aerialCombat',enemyAir:reading});
  p.fleetAirDefense={weights:[0],defense:0,cutins:[],states:[null,null]};
  const trace=[];runScenario(p,()=>.9,{trace});
  const rows=trace.filter(x=>x.phase==='airDefense');
  assert.deepEqual(rows.map(x=>[x.before,x.remaining]),[[10,9],[9,8]]);
  p.fleetAirDefense.cutins=[{id:1,position:0,roll:1,fixed:10,multiplier:1.7}];
  const stopped=[];runScenario(p,()=>.9,{trace:stopped});
  assert.equal(stopped.find(x=>x.phase==='airDefense').remaining,0);
  assert(!stopped.some(x=>x.side==='enemy'&&x.phase==='air'));
  assert.deepEqual(runScenario(p,random(12)),runScenario(p,random(12)));
});
test('missing AA or air-state information is disclosed',()=>{
  const {store,target}=setup();delete target.ship.api_kyouka;delete target.ship.api_taiku;
  const result=defense.prepare(store,[target],'lineAhead',[undefined]);
  assert(result.reasons.some(x=>x.includes('对空资料不足')));
  assert(result.reasons.some(x=>x.includes('制空资料不足')));
  assert(result.cutins.some(x=>x.id===1));
});
test('land-base slot losses carry into fleet interception without scaling twice',()=>{
  const land=require('../../../src/domain/combat/land_base'),original=land.simulateWaves;
  const enemy=enemyRecord({apiId:1510,apiIdStatus:'verified'});
  const friendly={status:'known',stype:2,hp:1000,initialHp:1000,armor:1000,fire:1,torpedo:1,range:1,condition:49};
  const reading=[{status:'known',attacks:[{slot:0,planesMax:10,powerMin:0,powerMax:100,
    referencePowers:[60],aircraftType:7,aircraftStat:10}]}];
  const p=prepareBattle([friendly],[enemy],{kind:'aerialRaid',enemyAir:reading});
  p.fleetAirDefense={weights:[0],defense:0,cutins:[],states:[null]};
  p.landBase={waves:[{}]};
  land.simulateWaves=()=>({remainingRatio:.5,enemySlots:[{shipIndex:0,slotIndex:0,count:3}]});
  try{
    const trace=[];runScenario(p,()=>.9,{trace});
    const row=trace.find(x=>x.phase==='airDefense');assert.equal(row.before,3);assert.equal(row.remaining,2);
  }finally{land.simulateWaves=original;}
});
test('6-5 G enemy aircraft suffer fewer surviving attacks with a triggered Akizuki cut-in',()=>{
  const {deriveEnemyAir}=require('../../../src/domain/combat/combat_air_asw');
  const store=fixture();
  for(const [id,name,type,stat] of [[1100,'深海猫艦戦',6,0],[1101,'深海地獄艦爆',7,11],
    [1102,'深海復讐艦攻',8,11],[1103,'深海猫艦戦改',6,0],
    [1104,'深海地獄艦爆改',7,12],[1105,'深海復讐艦攻改',8,12],
    [1106,'深海対空レーダ―',13,0],[1107,'深海ソナー Mk.II',14,0],[1108,'深海棲艦偵察機',10,0]])
    store.const.$equips[id]={api_id:id,api_name:name,api_type:[0,0,type],api_baku:stat,api_raig:stat};
  const formation=require('../../../data/sortie/encounters/6-5.json').nodes.G.phases.base.patterns[1];
  const enemies=formation.enemyShips.map(ref=>enemyRecord(ref)),air=enemies.map(enemy=>deriveEnemyAir(store,enemy,{nodeKind:'aerialRaid'}));
  assert(air.every(reading=>!reading.unresolvedAttack),JSON.stringify(air.map((reading,i)=>[enemies[i].apiId,reading.reasons])));
  const friendly=Array.from({length:6},()=>({status:'known',stype:2,hp:1000,initialHp:1000,armor:0,fire:1,torpedo:1,range:1,condition:49}));
  const p=prepareBattle(friendly,enemies,{kind:'aerialRaid',enemyAir:air});
  p.fleetAirDefense={weights:[224,40,40,40,40,40],defense:38.46,states:['superiority'],cutins:[]};
  const sample=()=>{
    let remaining=0,launched=0;
    for(let seed=1;seed<=512;seed++){
      const trace=[];runScenario(p,random(seed),{trace});
      remaining+=trace.filter(row=>row.phase==='airDefense').reduce((n,row)=>n+row.remaining,0);
      launched+=trace.filter(row=>row.side==='enemy'&&row.phase==='air').length;
    }
    return {remaining,launched};
  };
  const ordinary=sample();
  p.fleetAirDefense.cutins=[{id:1,position:0,roll:1,fixed:7,multiplier:1.7}];
  const cutin=sample();
  assert(cutin.remaining<ordinary.remaining);assert(cutin.launched<ordinary.launched);
});
