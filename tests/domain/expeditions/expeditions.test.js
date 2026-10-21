'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateExpedition,listExpeditions,expeditionFleet}=require('../../../src/domain/expeditions/expeditions');
const {FleetAdvisorService}=require('../../../src/application/fleet_advisor_service');
const {Controller}=require('../../../src/application/controller');
const {TOOL_DEFS}=require('../../../src/bridge/mcp_tools');
const {METHODS}=require('../../../src/bridge/service_api');
const DRUM=75;

test('snapshot evaluator matches fresh checks across mission types, hull orders and drum slots',()=>{
  const {createEvaluator,DATA}=require('../../../src/domain/expeditions/expeditions');
  const f=build([[1,{level:80,morale:60,drums:1}],[2,{morale:60,drums:2}],[3], [4], [5], [6]]);
  const snapshot=store(f.fleets,f.ships,f.equips,masters),before=JSON.stringify(snapshot),rules=JSON.stringify(DATA);
  const ids=f.fleets[0].api_ship.filter(id=>id>0),drums=Object.keys(f.equips).map(Number);
  const schemes=[undefined,{fleet:1,ships:ids.map(id=>({id}))},
    {fleet:1,ships:ids.slice().reverse().map(id=>({id,slots:[-1,-1,-1,-1],ex:0}))},
    {fleet:1,ships:ids.map((id,i)=>({id,slots:i===0?drums:[-1,-1,-1,-1],ex:0}))},
    {fleet:1,ships:ids.map((id,i)=>({id,slots:[-1,-1,-1,-1],ex:drums[i]||0}))},
    {fleet:1,ships:[]}];
  for(const missionId of Object.keys(DATA.missions).map(Number)){
    const evaluate=createEvaluator(snapshot,1,missionId);
    for(const scheme of [...schemes,...schemes.slice().reverse()])assert.deepEqual(evaluate(scheme),evaluateExpedition(snapshot,1,missionId,scheme));
  }
  assert.equal(JSON.stringify(snapshot),before);assert.equal(JSON.stringify(DATA),rules);
  snapshot.info.ships[ids[0]].api_cond=20;
  assert.deepEqual(createEvaluator(snapshot,1,103)(schemes[1]),evaluateExpedition(snapshot,1,103,schemes[1]));
  assert.equal(evaluateExpedition(snapshot,1,103,schemes[1]).ships[0].morale,20,'live checks read the latest data');
});

function store(fleets,ships,equips,masters){
  return {info:{basic:{api_member_id:'t'},ships,equips,fleets,repairs:[],airbase:[]},
    const:{$ships:masters,$equips:{75:{api_name:'ドラム缶',api_type:[0,0,25,30]}},
      $missions:{21:{api_name:'北方鼠輸送作戦'},5:{api_name:'長距離練習航海'}},
      $shipTypes:{},$equipShip:{},$exslotEquips:[],$exslotEquipShips:{},$exslotEquipLimits:{}}};
}
const masters={
  1:{api_id:1,api_name:'CL',api_stype:3,api_fuel_max:25,api_bull_max:25},
  2:{api_id:2,api_name:'DD',api_stype:2,api_fuel_max:15,api_bull_max:15},
  3:{api_id:3,api_name:'CVE',api_stype:7,api_tais:[30,99],api_fuel_max:35,api_bull_max:35},
  4:{api_id:4,api_name:'CVL',api_stype:7,api_tais:[0,0],api_fuel_max:35,api_bull_max:35},
  5:{api_id:5,api_name:'SS',api_stype:13,api_fuel_max:10,api_bull_max:20},
  6:{api_id:6,api_name:'SSV',api_stype:14,api_fuel_max:15,api_bull_max:20},
};
let seq=1000;
const ship=(masterId,{level=50,morale=49,fuel,bull,drums=0}={})=>{
  const id=++seq,m=masters[masterId];
  const slot=[];const eq={};
  for(let i=0;i<drums;i++){const eid=++seq;eq[eid]={api_slotitem_id:DRUM,api_level:0};slot.push(eid);}
  while(slot.length<4)slot.push(-1);
  return [id,{api_id:id,api_ship_id:masterId,api_lv:level,api_cond:morale,
    api_fuel:fuel??m.api_fuel_max,api_bull:bull??m.api_bull_max,api_slot:slot,api_slot_ex:0,
    api_sakuteki:[10,20],api_taisen:[20,40],api_taiku:[30,60],api_karyoku:[40,80]},eq];
};
const build=(fleetShips)=>{ // fleetShips: array of [masterId,opts]
  const ships={},equips={},ids=[];
  for(const [mid,opts] of fleetShips){const [id,s,eq]=ship(mid,opts);ships[id]=s;Object.assign(equips,eq);ids.push(id);}
  while(ids.length<6)ids.push(-1);
  return {ships,equips,fleets:[{api_ship:ids,api_mission:[0,0]},{api_ship:[-1,-1,-1,-1,-1,-1],api_mission:[0,0]}]};
};

test('exped 21: composition, drums and morale gate eligibility',()=>{
  const fleetShips=[[1,{level:60}],[2,{drums:2}],[2,{drums:1}],[2,{drums:1}],[2]];
  const {ships,equips,fleets}=build(fleetShips);
  const ok=evaluateExpedition(store(fleets,ships,equips,masters),1,21);
  assert.equal(ok.eligible,true,JSON.stringify(ok.checks.filter(c=>!c.sat)));
  assert.equal(ok.name,'北方鼠輸送作戦');
  // same fleet, one drum short (carriers drop to 2)
  const {ships:s2,equips:e2,fleets:f2}=build([[1,{level:60}],[2,{drums:1}],[2,{drums:1}],[2],[2]]);
  const bad=evaluateExpedition(store(f2,s2,e2,masters),1,21);
  assert.equal(bad.eligible,false);
  assert.ok(bad.checks.find(c=>c.type==='drumCarriers'&&c.left===2&&c.right===3));
});
test('CVE satisfies the CVE branch; plain CVL falls back to other branches',()=>{
  const mkFleet=(cveMaster)=>{const {ships,equips,fleets}=build([[cveMaster,{level:20}],[2],[2],[2]]);
    return evaluateExpedition(store(fleets,ships,equips,masters),1,5);};
  const withCve=mkFleet(3),withCvl=mkFleet(4);
  const cveBranch=withCve.checks.find(c=>c.type==='fleetCompo');
  assert.equal(cveBranch.sat,true,'CVE 1 + DD 2 branch satisfied');
  const cveParts=cveBranch.detail.find(r=>r.parts.some(p=>p.estype==='CVE')).parts.find(p=>p.estype==='CVE');
  assert.deepEqual([cveParts.actual,cveParts.need],[1,1]);
  const cvlParts=withCvl.checks.find(c=>c.type==='fleetCompo').detail.find(r=>r.parts.some(p=>p.estype==='CVE')).parts.find(p=>p.estype==='CVE');
  assert.equal(cvlParts.actual,0,'plain CVL is not CVE');
});
test('SSLike covers both SS and SSV',()=>{
  for(const mid of [5,6]){
    const {ships,equips,fleets}=build([[mid,{level:10}],[mid,{level:10}]]);
    const r=evaluateExpedition(store(fleets,ships,equips,masters),1,27);
    assert.equal(r.checks.find(c=>c.type==='fleetCompo').sat,true,'master '+mid);
  }
});
test('great success: unrounded estimates, innate probability and flagship level bonus',()=>{
  const {ships,equips,fleets}=build([[1,{level:60,morale:85}],[2,{morale:60,drums:1}],[2,{morale:55,drums:1}],[2,{morale:52,drums:1}],[2,{morale:50}]]);
  const r=evaluateExpedition(store(fleets,ships,equips,masters),1,21);
  assert.equal(r.greatSuccess.kind,'drum');
  assert.equal(r.greatSuccess.estimatedPercent,80,'3 drums = middle tier, 5 sparkled');
  assert.ok(r.greatSuccess.checks.find(c=>c.type==='gsDrums'&&c.left===3&&c.right===4));
  // Only the flagship's level enters the current Wiki formula.
  const {ships:s2,equips:e2,fleets:f2}=build([[4,{level:55}],[2,{level:99}],[2],[2],[2],[2]]);
  const r2=evaluateExpedition(store(f2,s2,e2,masters),1,43);
  assert.equal(r2.greatSuccess.kind,'flagship');
  assert.equal(r2.greatSuccess.estimatedPercent,16+Math.sqrt(55)+55/10);
  assert.equal(r2.greatSuccess.checks.find(c=>c.type==='gsFlagshipLevelBonus').sat,true);
  // all-sparkled default kind on a simple expedition
  const {ships:s3,equips:e3,fleets:f3}=build([[1,{morale:100}],[2,{morale:100}]]);
  const r3=evaluateExpedition(store(f3,s3,e3,masters),1,1);
  assert.equal(r3.greatSuccess.kind,'sparkled');
  assert.equal(r3.greatSuccess.estimatedPercent,50);
});

test('Wiki drum tiers include no-sparkle base and stop benefiting from surplus drums',()=>{
  const evaluate=(id,drums)=>{const f=build([[1,{drums}],[2],[2],[2],[2],[2]]);return evaluateExpedition(store(f.fleets,f.ships,f.equips,masters),1,id).greatSuccess;};
  assert.equal(evaluate(24,0).estimatedPercent,5);
  assert.equal(evaluate(24,1).estimatedPercent,5);
  assert.equal(evaluate(24,2).estimatedPercent,40);
  assert.equal(evaluate(24,4).estimatedPercent,40);
  assert.equal(evaluate(40,0).estimatedPercent,5);
  assert.equal(evaluate(21,3).estimatedPercent,5);
  assert.equal(evaluate(21,4).fullDrumBonus,false,'normal required carrier distribution still matters');
});

test('all seven drum probability rows match Wiki values and ordinary four/five ship references',()=>{
  const minimum=[5,20,35,50,65,80,95],full=[40,55,70,85,101,116,131];
  for(let sparkled=0;sparkled<=6;sparkled++)for(const extra of [false,true]){
    const fixture=build(Array.from({length:6},(_,i)=>[i===0?1:2,{morale:i<sparkled?50:49,drums:i<3?1+(extra&&i===0?1:0):0}]));
    const result=evaluateExpedition(store(fixture.fleets,fixture.ships,fixture.equips,masters),1,21).greatSuccess;
    const expected=(extra?full:minimum)[sparkled];
    assert.equal(result.rawPercent,expected);assert.equal(result.estimatedPercent,Math.min(100,expected));
  }
  for(const [count,expected] of [[4,80],[5,95],[6,100]]){
    const fixture=build(Array.from({length:count},()=>[2,{morale:50}]));
    assert.equal(evaluateExpedition(store(fixture.fleets,fixture.ships,fixture.equips,masters),1,1).greatSuccess.estimatedPercent,expected);
  }
});

test('fresh Wiki dispatch thresholds include expedition 15/16 levels and D2 LoS 70',()=>{
  const {DATA}=require('../../../src/domain/expeditions/expeditions');
  assert.equal(DATA.missions[15].flagshipLevel,8);assert.equal(DATA.missions[16].flagshipLevel,10);
  const fixture=build([[1,{level:60}],...Array.from({length:4},()=>[5,{level:60}])]);
  const first=fixture.ships[fixture.fleets[0].api_ship[0]];first.api_ship_id=7;
  const snapshot=store(fixture.fleets,fixture.ships,fixture.equips,{...masters,7:{...masters[1],api_id:7,api_stype:20}});
  first.api_sakuteki[0]=29;
  const low=evaluateExpedition(snapshot,1,132);assert.equal(low.eligible,false);
  assert.equal(low.checks.find(c=>c.type==='totalLos').right,70);
  first.api_sakuteki[0]=30;assert.equal(evaluateExpedition(snapshot,1,132).eligible,true);
});

test('probability capped at 100, and level 127 + four sparkles is below full probability',()=>{
  const evaluate=level=>{const f=build([[2,{level,morale:50}],...Array.from({length:5},(_,i)=>[2,{morale:i<3?50:49}])]);return evaluateExpedition(store(f.fleets,f.ships,f.equips,masters),1,101).greatSuccess;};
  const almost=evaluate(127),full=evaluate(128);
  assert(almost.estimatedPercent<100&&almost.estimatedPercent>99.96);
  assert.equal(full.estimatedPercent,100);assert(full.rawPercent>100);
  const f=build(Array.from({length:6},()=>[2,{morale:50}]));
  assert.equal(evaluateExpedition(store(f.fleets,f.ships,f.equips,masters),1,1).greatSuccess.estimatedPercent,100);
  for(const s of Object.values(f.ships))s.api_cond=49;
  assert.equal(evaluateExpedition(store(f.fleets,f.ships,f.equips,masters),1,1).greatSuccess.estimatedPercent,0);
});
test('resupply and morale surface as failed checks with ship names',()=>{
  const {ships,equips,fleets}=build([[1,{level:10,bull:0}],[2,{morale:10}]]);
  const r=evaluateExpedition(store(fleets,ships,equips,masters),1,1);
  const unsupplied=r.checks.find(c=>c.type==='resupply');
  assert.equal(unsupplied.sat,false);assert.match(unsupplied.detail,/CL/);
  const morale=r.checks.find(c=>c.type==='minMorale');
  assert.equal(morale.sat,false);assert.match(morale.detail,/DD\(10\)/);
});
test('list and error paths',()=>{
  const s=store([{api_ship:[-1,-1,-1,-1,-1,-1],api_mission:[0,0]}],{},[],masters);
  const all=listExpeditions(s);
  assert.equal(all.length,63);
  assert.equal(all.find(m=>m.missionId===21).name,'北方鼠輸送作戦');
  assert.equal(all.find(m=>m.missionId===37).gs.kind,'drum');
  assert.throws(()=>evaluateExpedition(s,1,999),/未知远征/);
  assert.throws(()=>evaluateExpedition(s,0,1),/舰队数据不可用/);
});
test('service and MCP surfaces agree on the two new tools',()=>{
  assert.deepEqual(TOOL_DEFS.map(t=>t.name),Object.keys(METHODS),'tool registry sync');
  const {ships,equips,fleets}=build([[1,{level:60}],[2],[2],[2]]);
  const svc=new FleetAdvisorService({controller:new Controller({getStore:()=>store(fleets,ships,equips,masters)}),
    getStore:()=>store(fleets,ships,equips,masters),storageDir:require('fs').mkdtempSync(require('path').join(require('os').tmpdir(),'paa-exp-'))});
  const snap=svc.createSnapshot();
  const list=svc.listExpeditions({snapshotId:snap.snapshotId});
  assert.equal(list.missions.length,63);
  const evalResult=svc.evaluateExpedition({snapshotId:snap.snapshotId,fleet:1,missionId:5});
  assert.equal(evalResult.eligible,true,JSON.stringify(evalResult.checks.filter(c=>c.sat===false)));
  assert.throws(()=>svc.evaluateExpedition({snapshotId:snap.snapshotId,fleet:9,missionId:5}),/fleet/);
  svc.dispose();
});


test('draft expedition evaluation matches a projected snapshot without cloning or changing the account',()=>{
  const store=require('../../helpers/workbench_fixture')(),W=require('../../../src/ui/workbench/workbench_model');
  for(let id=101;id<=106;id++)store.info.equips[id]={api_slotitem_id:75};
  const slots=[1,2,3,4,5,6].map(id=>({...W.entry(store,id),slots:[100+id,-1],ex:-1}));
  slots[0].ex=106;slots[5].slots=[-1,-1];
  const before=JSON.stringify(store);
  for(const missionId of [1,21,37,38,101])assert.deepEqual(evaluateExpedition(store,2,missionId,W.scheme(slots,2)),
    evaluateExpedition(W.projected(store,slots,2),2,missionId));
  assert.equal(JSON.stringify(store),before);
});
