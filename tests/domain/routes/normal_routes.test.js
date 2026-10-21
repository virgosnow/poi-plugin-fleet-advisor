'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {listNormalMaps,evaluateNormalRoute,predicate,evaluatePoint,fixedArrivalCondition}=require('../../../src/domain/routes/normal_routes');
test('prepared hull predicates match interpreted rules and guide requirements across all maps and unknown gear facts',()=>{
  const {preparePredicate}=require('../../../src/domain/routes/normal_routes');
  const fs=require('fs'),path=require('path'),directory=path.join(__dirname,'../../../data/normal_routes');
  const rules=fs.readdirSync(directory).filter(n=>/^\d-\d\.json$/.test(n)).flatMap(n=>Object.values(require(path.join(directory,n)).machineRules||{}).flat());
  let requirements=0;
  const visit=value=>{
    if(!value||typeof value!=='object')return;
    if(value.fleetRequirement){rules.push({when:value.fleetRequirement});requirements++;}
    Object.values(value).forEach(visit);
  };
  visit(require('../../../data/normal_route_guides.json'));assert(requirements>0);
  const names=[...new Set(rules.flatMap(r=>JSON.stringify(r.when).match(/"prefixes":\[[^\]]+\]/g)||[]).flatMap(s=>JSON.parse('{'+s+'}').prefixes))];
  let seed=7;const next=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  const samples=Array.from({length:120},(_,i)=>{
    const ships=Array.from({length:i%7},(_,j)=>({instanceId:j+1,stype:1+next(22),name:names[next(names.length)]+'改二',
      radarEquipped:[null,false,true][next(3)],drumEquipped:[null,false,true][next(3)],landingCraftEquipped:[null,false,true][next(3)]}));
    return [ships,{visitedNodes:i%2?['A','D','E','F']:undefined,
      lineOfSight:{status:['unknown','estimate','computed'][i%3],rawScoresByCoefficient:{1:i,2:i,3:i,4:i},lowerBoundScoresByCoefficient:{1:i-5,2:i-5,3:i-5,4:i-5},thresholdMargin:i%4},
      speed:{status:i%4?'observed':'unknown',fleetSpeed:['slow','fast','fastPlus','fastest'][i%4],ships:ships.map(s=>({shipId:s.instanceId,status:i%3?'observed':'unknown',speed:['slow','fast','fastPlus','fastest'][next(4)]}))}}];
  });
  for(const rule of rules){const prepared=preparePredicate(rule.when);
    for(const [ships,metrics] of samples)assert.equal(prepared(ships,metrics),predicate(rule.when,ships,metrics),JSON.stringify(rule.when));
  }
});
function assertWeights(assessment,expected){
  assert.deepEqual(assessment.destinations.slice().sort(),Object.keys(expected).sort());
  for(const {to,probability} of assessment.probabilities)assert(Math.abs(probability-expected[to])<1e-9,`${to}: ${probability}`);
}

function fixture(){
  const types=[3,2,2,2,9,2,2,1,1,1,1,13,16,10,10,22,11],ships={};
  types.forEach((stype,index)=>{
    const id=index+1;
    ships[id]={api_id:id,api_ship_id:id,api_slot:[-1],api_slot_ex:-1,api_onslot:[0],
      api_sakuteki:[20,40],api_taisen:[20,40],api_soku:10,api_lv:50};
  });
  return {info:{basic:{api_level:100},ships,equips:{},
    fleets:[{api_ship:[1,2,3,4,5,-1],api_mission:[0]}],repairs:[],airbase:[]},
    const:{$ships:Object.fromEntries(types.map((stype,index)=>[index+1,
      {api_name:`测试${index+1}`,api_stype:stype,api_slot_num:1,api_maxeq:[0],api_soku:10}])),
      $equips:{},$shipTypes:{},$equipShip:{},$exslotEquips:[],
      $exslotEquipShips:{},$exslotEquipLimits:{}}};
}

test('every reviewed fixed edge in a branch table is reported as fixed across normal maps and phases',()=>{
  const store=fixture();let checked=0;
  for(const {area} of listNormalMaps().maps){
    const map=require(`../../../data/normal_routes/${area}.json`);
    const phases=new Set([undefined,...Object.keys(map.bossPhases||{}),
      ...Object.keys(map.fixedEdges||{}).filter(key=>key.includes('#')).map(key=>key.split('#')[1])]);
    for(const phase of phases){
      const result=evaluateNormalRoute(store,{area,phase,target:map.bossNodes.length?'boss':map.terminalNodes[0]});
      for(const point of result.pointAssessments||[]){
        const to=map.fixedEdges?.[`${point.from}#${phase}`]??map.fixedEdges?.[point.from];
        if(!to)continue;
        checked++;
        assert.equal(point.assessment.status,'fixed',`${area} ${phase||''} ${point.from}→${to}`);
        assert.deepEqual(point.assessment.destinations,[to]);
      }
    }
  }
  assert(checked>=14,'retain coverage of shared fixed-edge/branch-table entries');
});

test('wiki catalog has one source-linked JSON per normal map with point exits and bosses',()=>{
  const maps=listNormalMaps().maps;
  assert.equal(maps.length,37);
  for(const map of maps){
    assert.match(map.source,/^https:\/\/zh\.kcwiki\.cn\/wiki\//);
    assert(map.branchPoints.length>0,map.area);
    assert(map.branchPoints.every(point=>point.destinations.length>0),map.area);
  }
  assert.deepEqual(maps.find(map=>map.area==='1-1').bossNodes,['C']);
  assert.deepEqual(maps.find(map=>map.area==='1-6').bossNodes,[]);
  assert.deepEqual(maps.find(map=>map.area==='1-6').terminalNodes,['N']);
  assert.deepEqual(maps.find(map=>map.area==='6-2').bossNodes,['K']);
  assert.deepEqual(maps.find(map=>map.area==='5-2').bossNodes,['O']);
  assert.deepEqual(maps.find(map=>map.area==='7-1').bossNodes,['K']);
  assert.deepEqual(maps.find(map=>map.area==='7-5').bossNodes,['K','Q','T']);
  assert.equal(maps.find(map=>map.area==='5-5').branchPoints.length,11);
  assert.equal(maps.find(map=>map.area==='7-3').branchPoints.filter(point=>point.phase==='gauge2').length,7);
});

test('1-1 boss probability follows the wiki fleet-size table; B is a battle dead end',()=>{
  const store=fixture();
  const five=evaluateNormalRoute(store,{area:'1-1'});
  assert.equal(five.verdict,'possibleRandom');
  assert.equal(five.probability,0.6); // drifting to B ends the run there (one non-boss battle)
  const one=evaluateNormalRoute(store,{area:'1-1',scheme:{fleet:1,ships:[1]}});
  assert.equal(one.probability,0.8);
  assert.equal(evaluateNormalRoute(store,{area:'1-1',target:'B'}).probability,0.4);
});

test('1-2 current composition and candidate are evaluated through ordered wiki rules',()=>{
  const store=fixture();
  const current=evaluateNormalRoute(store,{area:'1-2'});
  assert.equal(current.verdict,'possibleRandom');
  assert.equal(current.probability,0.5);
  assert.equal(current.pointAssessments[0].assessment.status,'random');
  const candidate=evaluateNormalRoute(store,{area:'1-2',scheme:{fleet:1,ships:[1,2,3,4,6]}});
  assert.equal(candidate.verdict,'guaranteed');
  assert.deepEqual(candidate.pointAssessments.map(point=>point.assessment.destinations),[['A'],['E']]);
  assert.equal(store.info.fleets[0].api_ship[4],5);
});

test('1-2 specified-point evaluation distinguishes speed routing and dead ends',()=>{
  const store=fixture();
  // 5 fast ships: only the start coin is random (50%), everything after is fixed
  for(const target of ['boss','C','E'])
    assert.equal(evaluateNormalRoute(store,{area:'1-2',target}).probability,0.5,target);
  // A→D requires the fleet not to be all-fast; a fast fleet can never reach D
  const d=evaluateNormalRoute(store,{area:'1-2',target:'D'});
  assert.equal(d.verdict,'unreachable');assert.equal(d.probability,0);
  store.info.ships[5].api_soku=5;
  const slowD=evaluateNormalRoute(store,{area:'1-2',target:'D'});
  assert.equal(slowD.verdict,'possibleRandom');assert.equal(slowD.probability,0.5);
  assert.deepEqual(slowD.pointAssessments.map(point=>point.assessment.destinations),[['A','B'],['D']]);
});

test('1-4 graph-complete evaluation follows wiki branch order through the full map',()=>{
  const store=fixture();
  const boss=evaluateNormalRoute(store,{area:'1-4'});
  assert.equal(boss.verdict,'possibleRandom');
  // A→D→(E|G→J) and B→C→F both converge on boss L: 0.5*(0.5+0.5*0.75)+0.5*1
  assert.equal(boss.probability,0.9375);
  assert.equal(boss.pointAssessments.find(point=>point.from==='B').assessment.status,'fixed');
  assert.deepEqual(boss.pointAssessments.find(point=>point.from==='B').assessment.destinations,['C']);
  assert.deepEqual(boss.pointAssessments.find(point=>point.from==='J').assessment.probabilities,
    [{to:'L',probability:0.75},{to:'K',probability:0.25}]);
  // K is a blue no-battle terminal (return to port): only reachable via A→D→G→J→K
  assert.equal(evaluateNormalRoute(store,{area:'1-4',target:'K'}).probability,0.0625);
  // three fleet carriers pin B to D; the lone destroyer drops J to the 65% tier
  for(const id of [2,4,5])store.const.$ships[id].api_stype=11;
  const carriers=evaluateNormalRoute(store,{area:'1-4'});
  assert.deepEqual(carriers.pointAssessments.find(point=>point.from==='B').assessment.destinations,['D']);
  assert.equal(carriers.probability,0.825);
});

test('1-6 fixed routes follow the wiki strategy lines AEGFBN and CHKMJDN/CHKMLIDN',()=>{
  const store=fixture();
  // CL1+DD3+BB1: (DD+海防)3隻以下 pins the start to C; N (the port) is always reached
  const n=evaluateNormalRoute(store,{area:'1-6',target:'N'});
  assert.equal(n.verdict,'guaranteed');assert.equal(n.probability,1);
  assert.deepEqual(n.pointAssessments.find(point=>point.from==='start').assessment.destinations,['C']);
  assert.deepEqual(n.pointAssessments.find(point=>point.from==='M').assessment.destinations,['L']);
  // 軽巡1+駆逐5 walks the recommended lower route A→E→G→F→B→N with G pinned
  const escort=evaluateNormalRoute(store,{area:'1-6',target:'N',scheme:{fleet:1,ships:[1,2,3,4,6,7]}});
  assert.deepEqual(escort.pointAssessments.find(point=>point.from==='start').assessment.destinations,['A']);
  assert.deepEqual(escort.pointAssessments.find(point=>point.from==='G').assessment.destinations,['F']);
  // 駆逐5 without a light cruiser leaves the G coin un-fixed
  const drift=evaluateNormalRoute(store,{area:'1-6',target:'N',scheme:{fleet:1,ships:[2,3,4,6,7]}});
  assert.equal(drift.pointAssessments.find(point=>point.from==='G').assessment.status,'random');
  // The observed low LoS takes M→L, so J cannot be reached.
  assert.equal(evaluateNormalRoute(store,{area:'1-6',target:'J',
    scheme:{fleet:1,ships:[2,3,4,6,7]}}).verdict,'unreachable');
});

test('active branch choices and LOS gates surface as unknown point assessments',()=>{
  const store=fixture();
  // 4-5 is fully curated but its 能動分岐 points stay unknown: the player picks the lane
  const result=evaluateNormalRoute(store,{area:'4-5'});
  assert.notEqual(result.verdict,'unknown');
  assert.equal(result.pointAssessments.find(point=>point.from==='A').assessment.status,'unknown');
  assert(result.pointAssessments.some(point=>point.assessment.status==='unknown'));
  assert.equal(evaluateNormalRoute(store,{area:'1-6'}).verdict,'noBoss');
  const phase=evaluateNormalRoute(store,{area:'7-3',phase:'gauge2'});
  assert.deepEqual(phase.targetNodes,['P']);
  assert(phase.pointAssessments.every(point=>point.phase==='gauge2'));
});

test('3-2 follows wiki point order and fixed map edges to Boss L',()=>{
  const store=fixture();
  const wrong=evaluateNormalRoute(store,{area:'3-2'});
  assert.equal(wrong.verdict,'unreachable');
  assert.deepEqual(wrong.chanceRange,[0,0]);
  const six=evaluateNormalRoute(store,{area:'3-2',scheme:{fleet:1,ships:[1,2,3,4,6,7]}});
  assert.equal(six.verdict,'guaranteed');
  assert.deepEqual(six.chanceRange,[1,1]);
  assert.equal(six.targetNodes[0],'L');
});

test('1-5 follows the Chinese table priority for five ships',()=>{
  const store=fixture();
  const dd=evaluateNormalRoute(store,{area:'1-5',scheme:{fleet:1,ships:[2,3,4,6]}});
  assert.equal(dd.verdict,'guaranteed');
  assert.deepEqual(dd.chanceRange,[1,1]);
  const de=evaluateNormalRoute(store,{area:'1-5',scheme:{fleet:1,ships:[8,9,10,11]}});
  assert.equal(de.verdict,'guaranteed');
  const five=evaluateNormalRoute(store,{area:'1-5',scheme:{fleet:1,ships:[2,3,4,6,7]}});
  assert.equal(five.verdict,'unreachable');
  const fiveDE=evaluateNormalRoute(store,{area:'1-5',scheme:{fleet:1,ships:[1,8,9,10,11]}});
  assert.equal(fiveDE.verdict,'unreachable');
  assert.deepEqual(fiveDE.pointAssessments.find(point=>point.from==='C').assessment.destinations,['B']);
  const submarine=evaluateNormalRoute(store,{area:'1-5',scheme:{fleet:1,ships:[2,3,4,12]}});
  assert.equal(submarine.verdict,'unreachable');
});

test('2-1 reaches boss through both D and E and detects the B dead end',()=>{
  const store=fixture();
  const light=evaluateNormalRoute(store,{area:'2-1',scheme:{fleet:1,ships:[1,2,3,4,6,7]}});
  assert.equal(light.verdict,'guaranteed');
  assert.deepEqual(light.chanceRange,[1,1]);
  const waterTender=evaluateNormalRoute(store,{area:'2-1',scheme:{fleet:1,ships:[13,1,2,3,4,6]}});
  assert.equal(waterTender.verdict,'guaranteed');
  assert.deepEqual(waterTender.pointAssessments.find(point=>point.from==='C').assessment.destinations,['E']);
  const supply=evaluateNormalRoute(store,{area:'2-1',scheme:{fleet:1,ships:[16,2,3,4]}});
  assert.equal(supply.verdict,'unreachable');
  const battleships=evaluateNormalRoute(store,{area:'2-1',scheme:{fleet:1,ships:[14,15,2,3]}});
  assert.equal(battleships.verdict,'unreachable');
});

test('2-2 follows wiki branch order; carrier-heavy fleets hit the B dead end',()=>{
  const store=fixture();
  // 水母+軽巡+4駆逐(高速統一): C→E fixed, then E's CL+fast-DD rule pins K
  const escort=evaluateNormalRoute(store,{area:'2-2',scheme:{fleet:1,ships:[13,1,2,3,4,6]}});
  assert.equal(escort.verdict,'guaranteed');
  assert.deepEqual(escort.pointAssessments.find(point=>point.from==='C').assessment.destinations,['E']);
  assert.deepEqual(escort.pointAssessments.find(point=>point.from==='E').assessment.destinations,['K']);
  // 3 carriers pin C→B→A (bauxite dead end): boss becomes unreachable
  for(const id of [2,3,4])store.const.$ships[id].api_stype=11;
  const carriers=evaluateNormalRoute(store,{area:'2-2',scheme:{fleet:1,ships:[16,17,2,3,4,6]}});
  assert.equal(carriers.verdict,'unreachable');
  assert.deepEqual(carriers.chanceRange,[0,0]);
  // 6 destroyers: C coin 50%, E coin K寄り70%, H's plain ランダム uses the 50% reference
  const dd=fixture();dd.const.$ships[8].api_stype=2;
  const destroyers=evaluateNormalRoute(dd,{area:'2-2',scheme:{fleet:1,ships:[2,3,4,6,7,8]}});
  assert.equal(destroyers.verdict,'possibleRandom');
  assert.deepEqual(destroyers.chanceRange,[0.425,0.425]);
  const h=destroyers.pointAssessments.find(point=>point.from==='H').assessment;
  assert.equal(h.status,'random');
  assert.deepEqual(h.probabilities.map(item=>item.probability),[.5,.5]);
});

test('2-3 submarine and transport routes match wiki-stated path probabilities',()=>{
  const store=fixture();
  // wiki's boss-fixing fleet 軽巡1+駆逐4+自由1: both start lanes converge on N
  store.const.$ships[5].api_stype=5;
  const boss=evaluateNormalRoute(store,{area:'2-3',scheme:{fleet:1,ships:[1,2,3,4,6,5]}});
  assert.equal(boss.verdict,'guaranteed');
  // AV branch at F: 90% J; at J the AV roll reaches N with 65%.
  for(const id of [5,6,7])store.const.$ships[id].api_stype=5;
  const transport=evaluateNormalRoute(store,{area:'2-3',scheme:{fleet:1,ships:[13,2,3,5,6,7]}});
  assert.ok(Math.abs(transport.probability-(.5+.5*(.1+.9*.65)))<1e-9);
  // submarine-only fleet rides C: wiki CDGIK=21.45% fixes the three coins
  const ss=fixture();for(const id of [2,3,4,6,7])ss.const.$ships[id].api_stype=13;
  const cruise=evaluateNormalRoute(ss,{area:'2-3',scheme:{fleet:1,ships:[12,2,3,4,6,7]}});
  assert.ok(Math.abs(cruise.probability-0.7607275)<1e-9);
  assert.deepEqual(cruise.pointAssessments.find(point=>point.from==='start').assessment.destinations,['C']);
  const iMass=evaluateNormalRoute(ss,{area:'2-3',target:'I',scheme:{fleet:1,ships:[12,2,3,4,6,7]}});
  assert.ok(Math.abs(iMass.probability-0.29082625)<1e-9);
  // 6 battleships: D and F feed G, while J is fixed to the dead end L.
  const bb=fixture();for(const id of [2,3,4,6,7])bb.const.$ships[id].api_stype=9;
  const gun=evaluateNormalRoute(bb,{area:'2-3',scheme:{fleet:1,ships:[5,2,3,4,6,7]}});
  assert.ok(Math.abs(gun.probability-0.3626875)<1e-9);
  assert.deepEqual(gun.pointAssessments.find(point=>point.from==='J').assessment.destinations,['L']);
});

test('2-4 central route fleets pin BGHLP; heavy fleets follow all subsequent rolls',()=>{
  const store=fixture();
  // wiki's fully-fixed central route 重巡1+軽巡1+駆逐4 walks B→G→H→L→P
  store.const.$ships[5].api_stype=5;
  const central=evaluateNormalRoute(store,{area:'2-4',scheme:{fleet:1,ships:[5,1,2,3,4,6]}});
  assert.equal(central.verdict,'guaranteed');
  assert.deepEqual(central.pointAssessments.find(point=>point.from==='B').assessment.destinations,['G']);
  assert.deepEqual(central.pointAssessments.find(point=>point.from==='H').assessment.destinations,['L']);
  assert.deepEqual(central.pointAssessments.find(point=>point.from==='L').assessment.destinations,['P']);
  // 軽巡1+駆逐5 is the alternate wiki-fixed fleet: the extra destroyer counts as the 加えて ship
  const light=evaluateNormalRoute(store,{area:'2-4',scheme:{fleet:1,ships:[1,2,3,4,6,7]}});
  assert.equal(light.verdict,'guaranteed');
  // 戦艦4+正空2 pins B→C; Chinese F probabilities bound the later coin.
  const bb=fixture();
  for(const id of [2,3,4])bb.const.$ships[id].api_stype=9;
  bb.const.$ships[7].api_stype=11;
  const heavy=evaluateNormalRoute(bb,{area:'2-4',scheme:{fleet:1,ships:[5,2,3,4,17,7]}});
  assert.deepEqual(heavy.pointAssessments.find(point=>point.from==='B').assessment.destinations,['C']);
  assert(heavy.chanceRange.every(p=>Math.abs(p-.035)<1e-9));
});

test('2-5 LoS gates use the observed score after composition picks the lane',()=>{
  const store=fixture();
  // 4 submarines pin start→B then B→A (no-battle dead end)
  const subs=fixture();for(const id of [2,3,4,6,7])subs.const.$ships[id].api_stype=13;
  const drift=evaluateNormalRoute(subs,{area:'2-5',scheme:{fleet:1,ships:[12,2,3,4,6,7]}});
  assert.equal(drift.verdict,'unreachable');
  assert.deepEqual(drift.pointAssessments.find(point=>point.from==='start').assessment.destinations,['B']);
  // 軽巡1+駆逐5 rides the north lane B→F→E→I; insufficient LoS diverts I→H.
  const north=evaluateNormalRoute(store,{area:'2-5',scheme:{fleet:1,ships:[1,2,3,4,6,7]}});
  assert.equal(north.verdict,'unreachable');
  assert.deepEqual(north.pointAssessments.find(point=>point.from==='F').assessment.destinations,['E']);
  assert.deepEqual(north.pointAssessments.find(point=>point.from==='I').assessment.destinations,['H']);
  // a slow ship anywhere in the fleet forces F→J (whole-fleet anyShipSpeed)
  const slow=fixture();slow.info.ships[5].api_soku=5;
  const mixed=evaluateNormalRoute(slow,{area:'2-5',scheme:{fleet:1,ships:[5,1,2,3,4,6]}});
  assert.deepEqual(mixed.pointAssessments.find(point=>point.from==='F').assessment.destinations,['J']);
  // two drum canister carriers pin start→B where the 6-ship coin would otherwise float
  const drums=fixture();for(const id of [4,6,7])drums.const.$ships[id].api_stype=5;
  drums.const.$equips[75]={api_type:[0,0,30,0,0]};
  drums.info.equips[100]={api_id:100,api_slotitem_id:75};
  drums.info.ships[1].api_slot=[100];
  const coin=evaluateNormalRoute(drums,{area:'2-5',scheme:{fleet:1,ships:[1,2,3,4,6,7]}});
  assert.equal(coin.pointAssessments.find(point=>point.from==='start').assessment.status,'random');
  assert.deepEqual(coin.pointAssessments.find(point=>point.from==='start').assessment.probabilities.map(p=>p.probability),[.8,.2]);
  assert.notEqual(coin.routeTag,'样本不足');
  drums.info.equips[101]={api_id:101,api_slotitem_id:75};
  drums.info.ships[2].api_slot=[101];
  const pinned=evaluateNormalRoute(drums,{area:'2-5',scheme:{fleet:1,ships:[1,2,3,4,6,7]}});
  assert.deepEqual(pinned.pointAssessments.find(point=>point.from==='start').assessment.destinations,['B']);
});

test('3-1 fleet weight tiers decide between F, D and the E dead end',()=>{
  const store=fixture();
  // wiki's 2-battle fleet 戦艦+空母2+重巡系2+駆逐2 rides C→F→G
  for(const id of [6,7])store.const.$ships[id].api_stype=5;
  const light=evaluateNormalRoute(store,{area:'3-1',scheme:{fleet:1,ships:[2,3,6,7,5,17]}});
  assert.equal(light.verdict,'guaranteed');
  assert.deepEqual(light.pointAssessments.find(point=>point.from==='C').assessment.destinations,['F']);
  // 4 battleships take C→D→F→G; a 5th tips D into the no-battle dead end E
  const bb=fixture();for(const id of [2,3,4])bb.const.$ships[id].api_stype=9;
  const four=evaluateNormalRoute(bb,{area:'3-1',scheme:{fleet:1,ships:[5,2,3,4,6,7]}});
  assert.equal(four.verdict,'guaranteed');
  bb.const.$ships[6].api_stype=9;
  const five=evaluateNormalRoute(bb,{area:'3-1',scheme:{fleet:1,ships:[5,2,3,4,6,7]}});
  assert.equal(five.verdict,'unreachable');
  assert.deepEqual(five.pointAssessments.find(point=>point.from==='D').assessment.destinations,['E']);
  // 3 submarines randomize C between D and F, both of which converge on G
  const ss=fixture();for(const id of [2,3,4])ss.const.$ships[id].api_stype=13;
  assert.equal(evaluateNormalRoute(ss,{area:'3-1',
    scheme:{fleet:1,ships:[12,2,3,4,6,7]}}).verdict,'guaranteed');
});

test('3-3 northern/southern short routes are fully pinned by composition',()=>{
  const store=fixture();
  // BB1+CL1+DD4 walks A→C→G→M (北最短 ACGM)
  const north=evaluateNormalRoute(store,{area:'3-3',scheme:{fleet:1,ships:[5,1,2,3,4,6]}});
  assert.equal(north.verdict,'guaranteed');
  assert.deepEqual(north.pointAssessments.find(point=>point.from==='A').assessment.destinations,['C']);
  assert.deepEqual(north.pointAssessments.find(point=>point.from==='C').assessment.destinations,['G']);
  assert.deepEqual(north.pointAssessments.find(point=>point.from==='G').assessment.destinations,['M']);
  // CL1+DD5 walks A→B→F→J→M (南最短 ABFJM)
  const south=evaluateNormalRoute(store,{area:'3-3',scheme:{fleet:1,ships:[1,2,3,4,6,7]}});
  assert.equal(south.verdict,'guaranteed');
  assert.deepEqual(south.pointAssessments.find(point=>point.from==='B').assessment.destinations,['F']);
  assert.deepEqual(south.pointAssessments.find(point=>point.from==='J').assessment.destinations,['M']);
  // 2 fleet carriers ride A→C→E→G→M through the fixed E→G edge
  store.const.$ships[2].api_stype=11;
  const carriers=evaluateNormalRoute(store,{area:'3-3',scheme:{fleet:1,ships:[17,2,3,4,6,7]}});
  assert.equal(carriers.verdict,'guaranteed');
  assert.deepEqual(carriers.pointAssessments.find(point=>point.from==='C').assessment.destinations,['E']);
  // Chinese table gives the four-capital-ship coin as 50/50 without a question mark.
  const bb=fixture();for(const id of [2,3,4])bb.const.$ships[id].api_stype=9;
  const gun=evaluateNormalRoute(bb,{area:'3-3',scheme:{fleet:1,ships:[5,2,3,4,6,7]}});
  assert.equal(gun.verdict,'possibleRandom');
  assert.equal(gun.pointAssessments.find(point=>point.from==='G').assessment.status,'random');
  assert.deepEqual(gun.pointAssessments.find(point=>point.from==='G').assessment.probabilities.map(x=>x.probability),[0.5,0.5]);
});

test('3-4 wiki sample fleets walk DHLJP/ACFJP/ACBHGJP end to end',()=>{
  const store=fixture();
  // 航巡1+軽巡2+駆逐3 rides start→D→H→L→J→P (DHLJP, 2 battles + whirlpool)
  store.const.$ships[5].api_stype=6;store.const.$ships[2].api_stype=3;
  const torp=evaluateNormalRoute(store,{area:'3-4',scheme:{fleet:1,ships:[5,1,2,3,4,6]}});
  assert.equal(torp.verdict,'guaranteed');
  assert.deepEqual(torp.pointAssessments.find(point=>point.from==='start').assessment.destinations,['D']);
  assert.deepEqual(torp.pointAssessments.find(point=>point.from==='H').assessment.destinations,['L']);
  assert.equal(require('../../../data/normal_routes/3-4.json').fixedEdges.D,'H');
  assert.equal(evaluateNormalRoute(store,{area:'3-4',target:'B',scheme:{fleet:1,ships:[5,1,2,3,4,6]}}).verdict,'unreachable');
  // 正空2+軽空1+軽巡1+駆逐2 rides A→C→F with the fast+ pin at F→J
  const fast=fixture();fast.const.$ships[5].api_stype=11;fast.const.$ships[7].api_stype=7;
  for(const id of [1,2,3,5,7,17])fast.info.ships[id].api_soku=20;
  const carriers=evaluateNormalRoute(fast,{area:'3-4',scheme:{fleet:1,ships:[17,5,7,1,2,3]}});
  assert.equal(carriers.verdict,'guaranteed');
  assert.deepEqual(carriers.pointAssessments.find(point=>point.from==='F').assessment.destinations,['J']);
  // Plain fast: first 45% J, then 15% of failures go G; all exits reach P.
  for(const id of [1,2,3,5,7,17])fast.info.ships[id].api_soku=10;
  const plain=evaluateNormalRoute(fast,{area:'3-4',scheme:{fleet:1,ships:[17,5,7,1,2,3]}});
  assert.equal(plain.pointAssessments.find(point=>point.from==='F').assessment.status,'random');
  assertWeights(plain.pointAssessments.find(point=>point.from==='F').assessment,{J:.45,G:.0825,M:.4675});
  assert.equal(plain.verdict,'guaranteed');
  assert.equal(plain.routeTag,'100%固定');
  // battleship-only fleet takes the all-battle lane A→C→B→H→G→J→P (ACBHGJP)
  const bb=fixture();for(const id of [1,2,3,4,6,7])bb.const.$ships[id].api_stype=9;
  const gun=evaluateNormalRoute(bb,{area:'3-4',scheme:{fleet:1,ships:[5,1,2,3,4,6]}});
  assert.equal(gun.verdict,'guaranteed');
  assert.deepEqual(gun.pointAssessments.find(point=>point.from==='C').assessment.destinations,['B']);
});

test('3-5 lanes funnel into LoS gates; heavy fleets still drift through B→D→H',()=>{
  const store=fixture();
  // 軽巡1+駆逐5 pins start→F then F→G, but the fixture's low LoS diverts G→I.
  const lower=evaluateNormalRoute(store,{area:'3-5',scheme:{fleet:1,ships:[1,2,3,4,6,7]}});
  assert.equal(lower.verdict,'unreachable');
  assert.deepEqual(lower.pointAssessments.find(point=>point.from==='F').assessment.destinations,['G']);
  assert.deepEqual(lower.pointAssessments.find(point=>point.from==='G').assessment.destinations,['I']);
  // 戦艦2+重巡4 rides start→B→D(→H fixed).
  const bb=fixture();bb.const.$ships[5].api_stype=8;for(const id of [2,3,4,6])bb.const.$ships[id].api_stype=5;
  const upper=evaluateNormalRoute(bb,{area:'3-5',scheme:{fleet:1,ships:[5,1,2,3,4,6]}});
  assert.deepEqual(upper.pointAssessments.find(point=>point.from==='start').assessment.destinations,['B']);
  assert.deepEqual(upper.pointAssessments.find(point=>point.from==='B').assessment.destinations,['D']);
  assert.equal(upper.pointAssessments.find(point=>point.from==='H').assessment.status,'fixed');
  // 4 destroyers (CL1+DD4+CA1) leave the start coin 75/25 toward F
  store.const.$ships[7].api_stype=5;
  const four=evaluateNormalRoute(store,{area:'3-5',scheme:{fleet:1,ships:[1,2,3,4,6,7]}});
  assert.deepEqual(four.pointAssessments.find(point=>point.from==='start').assessment.probabilities,
    [{to:'B',probability:0.25},{to:'F',probability:0.75}]);
});

test('4-1 light escort fleets are guaranteed while 5 heavy capitals strand at I',()=>{
  const store=fixture();
  // 軽巡1+駆逐5: both start lanes (A→B→D and C→F) converge on H→J
  const light=evaluateNormalRoute(store,{area:'4-1',scheme:{fleet:1,ships:[1,2,3,4,6,7]}});
  assert.equal(light.verdict,'guaranteed');
  assert.deepEqual(light.pointAssessments.find(point=>point.from==='F').assessment.destinations,['H']);
  // 5 battleship-class ships: C→E (dead end) and B→D→H→I (dead end) — boss unreachable
  const bb=fixture();for(const id of [1,2,3,4,6])bb.const.$ships[id].api_stype=9;
  const heavy=evaluateNormalRoute(bb,{area:'4-1',scheme:{fleet:1,ships:[5,1,2,3,4,6]}});
  assert.equal(heavy.verdict,'unreachable');
  assert.deepEqual(heavy.chanceRange,[0,0]);
});

test('4-2 keeps the random start but both boss-fixing lanes now converge on L',()=>{
  const store=fixture();
  // CV2+CL1+DD3: both A→C and B→D→C converge on L.
  store.const.$ships[5].api_stype=11;
  const fleet=evaluateNormalRoute(store,{area:'4-2',scheme:{fleet:1,ships:[5,17,1,2,3,4]}});
  assert.equal(fleet.verdict,'guaranteed');
  assert.deepEqual(fleet.chanceRange,[1,1]);
  assert.equal(fleet.pointAssessments.find(point=>point.from==='start').assessment.status,'random');
  assert.equal(fleet.pointAssessments.find(point=>point.from==='B').assessment.status,'fixed');
  assert.deepEqual(fleet.pointAssessments.find(point=>point.from==='B').assessment.destinations,['D']);
  // with DD+海防4 the A-lane pins C→L; 軽巡 included keeps it deterministic
  const dd=evaluateNormalRoute(store,{area:'4-2',scheme:{fleet:1,ships:[1,2,3,4,6,5]}});
  assert.equal(dd.pointAssessments.find(point=>
    point.from==='A').assessment.destinations.includes('C'),true);
});

test('4-2 topology has B→D and G→F→J, without phantom boss shortcuts',()=>{
  const map=require('../../../data/normal_routes/4-2.json');
  assert.deepEqual(map.branchPoints.find(point=>point.from==='B').destinations,['D']);
  assert.equal(map.fixedEdges.B,'D');
  assert.equal(map.fixedEdges.F,'J');
  assert(map.deadEnds.includes('J'));
  const {previewForMap}=require('../../../src/domain/routes/sortie_profile');
  const preview=previewForMap('4-2');
  const edges=preview.mapPreview.edges.map(edge=>`${edge.from}>${edge.to}`);
  assert(edges.includes('B>D'));
  assert(edges.includes('G>F'));
  assert(edges.includes('F>J'));
  assert(!edges.includes('B>J'));
  assert(!edges.includes('F>L'));
  assert(preview.routePaths.every(path=>!path.nodes.includes('F')&&!path.nodes.includes('J')));
  // Even when G allows a northward diversion to F, it cannot reach the Boss.
  const route=reviewRoute('4-2',[9,9,9,3,2,2]);
  const {pathChance}=require('../../../src/domain/routes/route_plans');
  assert.deepEqual(pathChance(route,['B','J','L']),{min:0,max:0,probability:0});
  assert.deepEqual(pathChance(route,['B','D','C','G','F','L']),{min:0,max:0,probability:0});
});

test('4-3 H to I is a dead end, so two 70% checks yield 91% boss arrival',()=>{
  const store=fixture();
  // 軽母2+軽巡1+駆逐3 pins start→D→H; H→I misses the boss.
  store.const.$ships[5].api_stype=7;store.const.$ships[16].api_stype=7;
  const center=evaluateNormalRoute(store,{area:'4-3',scheme:{fleet:1,ships:[5,16,1,2,3,4]}});
  assert.equal(center.verdict,'possibleRandom');
  assert(center.chanceRange.every(p=>Math.abs(p-.91)<1e-9));
  assert.deepEqual(center.pointAssessments.find(point=>point.from==='start').assessment.destinations,['D']);
  assertWeights(center.pointAssessments.find(point=>point.from==='H').assessment,{I:.09,N:.91});
  // 正空1+軽空1+軽巡1+重巡3 rides start→C; C's coin and H's miss remain.
  const southStore=fixture();for(const id of [5,6,7])southStore.const.$ships[id].api_stype=5;
  const south=evaluateNormalRoute(southStore,{area:'4-3',scheme:{fleet:1,ships:[17,16,1,5,6,7]}});
  assert.equal(south.verdict,'possibleRandom');
  assert.equal(south.pointAssessments.find(point=>point.from==='C').assessment.status,'random');
  assertWeights(south.pointAssessments.find(point=>point.from==='C').assessment,{F:1-.35*.35,D:.35*.35});
  // Battleship-only: C→F→K→L→M; the A lane cannot reach N either.
  const bb=fixture();for(const id of [1,2,3,4,6,7])bb.const.$ships[id].api_stype=9;
  assert.equal(evaluateNormalRoute(bb,{area:'4-3',
    scheme:{fleet:1,ships:[5,1,2,3,4,6]}}).verdict,'unreachable');
});

test('4-4 wiki central fix AEIK holds; G three-way coin retains explicit reference weights',()=>{
  const store=fixture();
  // 正空2+重巡1+軽巡1+駆逐2 walks start→A→E→I→K
  store.const.$ships[5].api_stype=11;
  const center=evaluateNormalRoute(store,{area:'4-4',scheme:{fleet:1,ships:[17,5,1,2,3,4]}});
  assert.equal(center.verdict,'guaranteed');
  assert.deepEqual(center.pointAssessments.find(point=>point.from==='E').assessment.destinations,['I']);
  assert.deepEqual(center.pointAssessments.find(point=>point.from==='I').assessment.destinations,['K']);
  // 6 destroyers: question-marked E/F/G values become ordinary reference coins
  const dd=fixture();
  const swarm=evaluateNormalRoute(dd,{area:'4-4',scheme:{fleet:1,ships:[2,3,4,6,7,8]}});
  assert.equal(swarm.verdict,'possibleRandom');
  assert.equal(swarm.pointAssessments.find(point=>point.from==='E').assessment.status,'random');
});

test('4-5 active branches stay open while M/R speed tiers pin the return lanes',()=>{
  const store=fixture();
  // 軽巡1+駆逐3+空母1+戦艦1 at fast+ satisfies both wiki DHT conditions
  for(const id of [1,2,3,4,5,17])store.info.ships[id].api_soku=20;
  const central=evaluateNormalRoute(store,{area:'4-5',scheme:{fleet:1,ships:[1,2,3,4,17,5]}});
  assert.equal(central.verdict,'guaranteed');
  assert.deepEqual(central.pointAssessments.find(point=>point.from==='D').assessment,
    {status:'fixed',destinations:['H'],reason:'已校订固定连接'});
  assert.equal(central.pointAssessments.find(point=>point.from==='A').assessment.status,'unknown',
    'an active branch must remain a player choice');
  assert(!require('../../../src/ui/models/presentation_model').routeReasons({route:central,
    profile:{examples:[['A','D','H','T']]}}).some(reason=>reason.startsWith('D 点')));
  assert.deepEqual(central.pointAssessments.find(point=>point.from==='H').assessment.destinations,['T']);
  // every lane (including all 能動分岐 picks and K's LOS coin) funnels to T: DD6 also guaranteed
  const swarm=evaluateNormalRoute(store,{area:'4-5',scheme:{fleet:1,ships:[2,3,4,6,7,8]}});
  assert.equal(swarm.verdict,'guaranteed');
  // 補給艦1+軽巡1+駆逐4 rides E→M and M's (戦艦級+正空)1以下 rule pins N→T
  store.const.$ships[16].api_stype=15;
  const supply=evaluateNormalRoute(store,{area:'4-5',scheme:{fleet:1,ships:[16,1,2,3,4,6]}});
  assert.deepEqual(supply.pointAssessments.find(point=>point.from==='E').assessment.destinations,['M']);
  assert.deepEqual(supply.pointAssessments.find(point=>point.from==='M').assessment.destinations,['N']);
});

test('5-1 short BCFJ fleet and the 高速+水上打撃 fix both reach J',()=>{
  const store=fixture();
  // 戦艦1+軽母1+重巡1+軽巡1+駆逐2 pins start→B→C→F→J
  store.const.$ships[6].api_stype=8;store.const.$ships[7].api_stype=5;
  const short=evaluateNormalRoute(store,{area:'5-1',scheme:{fleet:1,ships:[6,16,7,1,2,3]}});
  assert.equal(short.verdict,'guaranteed');
  assert.deepEqual(short.pointAssessments.find(point=>point.from==='B').assessment.destinations,['C']);
  assert.deepEqual(short.pointAssessments.find(point=>point.from==='F').assessment.destinations,['J']);
  // 戦艦級3+軽巡1+重巡級2 goes start→B→E→G; fast+ pins G→J, plain fast gets the 85% coin
  const punch=fixture();for(const id of [2,3])punch.const.$ships[id].api_stype=9;
  punch.const.$ships[4].api_stype=3;punch.const.$ships[6].api_stype=5;punch.const.$ships[7].api_stype=5;
  for(const id of [2,3,4,5,6,7])punch.info.ships[id].api_soku=20;
  const fastPlus=evaluateNormalRoute(punch,{area:'5-1',scheme:{fleet:1,ships:[5,2,3,4,6,7]}});
  assert.equal(fastPlus.verdict,'guaranteed');
  assert.deepEqual(fastPlus.pointAssessments.find(point=>point.from==='B').assessment.destinations,['E']);
  for(const id of [2,3,4,5,6,7])punch.info.ships[id].api_soku=10;
  const fast=evaluateNormalRoute(punch,{area:'5-1',scheme:{fleet:1,ships:[5,2,3,4,6,7]}});
  assert.equal(fast.probability,0.85);
});

test('5-2 carrier+heavy fleet pins C→D but low LoS sends F→H',()=>{
  const store=fixture();
  store.const.$ships[5].api_stype=11;store.const.$ships[6].api_stype=5;store.const.$ships[7].api_stype=5;
  const fleet=evaluateNormalRoute(store,{area:'5-2',scheme:{fleet:1,ships:[17,5,6,7,2,3]}});
  assert.equal(fleet.verdict,'unreachable');
  assert.deepEqual(fleet.chanceRange,[0,0]);
  assert.deepEqual(fleet.pointAssessments.find(point=>point.from==='start').assessment.destinations,['B']);
  assert.deepEqual(fleet.pointAssessments.find(point=>point.from==='C').assessment.destinations,['D']);
  assert.deepEqual(fleet.pointAssessments.find(point=>point.from==='F').assessment.destinations,['H']);
});

test('5-3 Sendai-fleet and destroyer routes walk the DGIO(K)E chains to Q',()=>{
  const store=fixture();
  // 重巡級5+軽巡1 (三川艦隊) rides D→G→I→O; both 能動 picks reach Q
  const ca=fixture();for(const id of [2,3,4,5,6])ca.const.$ships[id].api_stype=5;
  const mikawa=evaluateNormalRoute(ca,{area:'5-3',scheme:{fleet:1,ships:[1,2,3,4,5,6]}});
  assert.equal(mikawa.verdict,'guaranteed');
  assert.deepEqual(mikawa.pointAssessments.find(point=>point.from==='I').assessment.destinations,['O']);
  // 駆逐4+軽巡1 rides K→H→E→Q through the fixed H→E edge
  const dd=fixture();dd.const.$ships[5].api_stype=5;
  const swarm=evaluateNormalRoute(dd,{area:'5-3',scheme:{fleet:1,ships:[1,2,3,4,6,5]}});
  assert.equal(swarm.verdict,'guaranteed');
  assert.deepEqual(swarm.pointAssessments.find(point=>point.from==='K').assessment.destinations,['H']);
  // two drum canister carriers also unlock K's H tier for a 2-destroyer fleet
  const drums=fixture();
  drums.const.$equips[75]={api_type:[0,0,30,0,0]};
  drums.info.equips[100]={api_id:100,api_slotitem_id:75};drums.info.equips[101]={api_id:101,api_slotitem_id:75};
  drums.info.ships[1].api_slot=[100];drums.info.ships[2].api_slot=[101];
  drums.const.$ships[6].api_stype=5;drums.const.$ships[7].api_stype=5;
  const canister=evaluateNormalRoute(drums,{area:'5-3',scheme:{fleet:1,ships:[1,2,3,6,7,16]}});
  assert.deepEqual(canister.pointAssessments.find(point=>point.from==='K').assessment.destinations,['H']);
});

test('5-4 transport tallies pin start→B and the fast+ fleet closes BEHIJMP',()=>{
  const store=fixture();
  store.const.$ships[5].api_stype=8;store.const.$ships[6].api_stype=5;store.const.$ships[7].api_stype=5;
  const fleet=evaluateNormalRoute(store,{area:'5-4',scheme:{fleet:1,ships:[5,1,2,3,4,6]}});
  assert.equal(fleet.verdict,'unreachable');
  assert.deepEqual(fleet.pointAssessments.find(point=>point.from==='B').assessment.destinations,['E']);
  assert.deepEqual(fleet.pointAssessments.find(point=>point.from==='M').assessment.destinations,['O']);
  for(const id of [1,2,3,4,5,6])store.info.ships[id].api_soku=20;
  const fast=evaluateNormalRoute(store,{area:'5-4',scheme:{fleet:1,ships:[5,1,2,3,4,6]}});
  assert.equal(fast.verdict,'guaranteed');
  // 4 drum canister carriers + CL1 keep the fleet on the B lane (DD4+ tier)
  const drums=fixture();
  drums.const.$equips[75]={api_type:[0,0,30,0,0]};
  for(const id of [100,101,102,103]){drums.info.equips[id]={api_id:id,api_slotitem_id:75};}
  drums.info.ships[1].api_slot=[100];drums.info.ships[2].api_slot=[101];
  drums.info.ships[3].api_slot=[102];drums.info.ships[4].api_slot=[103];
  assert.deepEqual(evaluateNormalRoute(drums,{area:'5-4',
    scheme:{fleet:1,ships:[1,2,3,4,6,7]}}).pointAssessments
    .find(point=>point.from==='start').assessment.destinations,['B']);
  // the transport tally needs 5: adding a 5th drum carrier still rides B via DD5
  drums.info.equips[104]={api_id:104,api_slotitem_id:75};
  drums.info.ships[6].api_slot=[104];
  assert.deepEqual(evaluateNormalRoute(drums,{area:'5-4',
    scheme:{fleet:1,ships:[1,2,3,4,6,7]}}).pointAssessments
    .find(point=>point.from==='start').assessment.destinations,['B']);
});

test('5-5 lane rules pin B and E while LOS gates keep the boss interval open',()=>{
  const store=fixture();
  // 軽巡1+駆逐4+重巡1 rides A→C→E→G→I→M→O; O's LOS coin stays unknown
  const lower=evaluateNormalRoute(store,{area:'5-5',scheme:{fleet:1,ships:[1,2,3,4,6,16]}}).pointAssessments;
  assert.equal(lower.find(point=>point.from==='start').assessment.destinations[0],'A');
  assert.equal(lower.find(point=>point.from==='I').assessment.destinations[0],'M');
  // 戦艦2+正空2+重巡2 pins B→K; at fast+ the P rule (戦艦級+空母系)5以下 closes S
  const bb=fixture();bb.const.$ships[5].api_stype=8;bb.const.$ships[6].api_stype=8;
  bb.const.$ships[7].api_stype=5;bb.const.$ships[16].api_stype=11;
  const fleet=evaluateNormalRoute(bb,{area:'5-5',scheme:{fleet:1,ships:[5,6,16,17,2,7]}});
  assert.deepEqual(fleet.pointAssessments.find(point=>point.from==='B').assessment.destinations,['K']);
  assert.equal(fleet.verdict,'unreachable');
  for(const id of [2,5,6,7,16,17])bb.info.ships[id].api_soku=20;
  const fast=evaluateNormalRoute(bb,{area:'5-5',scheme:{fleet:1,ships:[5,6,16,17,2,7]}});
  assert.equal(fast.verdict,'guaranteed');
});

test('6-x LOS-heavy maps keep honest intervals; 6-4 fixed lanes reach N',()=>{
  const store=fixture();
  // 6-1: submarine-only fleet rides A→D→F→G, then low LoS diverts G→I.
  const subs=fixture();for(const id of [1,2,3,4,6,7])subs.const.$ships[id].api_stype=13;
  const cruise=evaluateNormalRoute(subs,{area:'6-1',scheme:{fleet:1,ships:[1,2,3,4,6,7]}});
  assert.equal(cruise.verdict,'unreachable');
  assert.deepEqual(cruise.pointAssessments.find(point=>point.from==='A').assessment.destinations,['D']);
  // 6-2: 5 heavy capitals pin start→B→C→A (the wiki 1-battle retreat lane)
  const bb=fixture();bb.const.$ships[17].api_stype=8;for(const id of [2,3,4,6,7])bb.const.$ships[id].api_stype=8;
  const retreat=evaluateNormalRoute(bb,{area:'6-2',scheme:{fleet:1,ships:[5,17,2,3,4,6]}});
  assert.equal(retreat.verdict,'unreachable');
  // 6-3: 水母1+軽巡1+駆逐4 pins E→G, but low LoS diverts H→I.
  const scout=evaluateNormalRoute(store,{area:'6-3',scheme:{fleet:1,ships:[13,1,2,3,4,6]}});
  assert.deepEqual(scout.pointAssessments.find(point=>point.from==='E').assessment.destinations,['G']);
  assert.deepEqual(scout.pointAssessments.find(point=>point.from==='H').assessment.destinations,['I']);
  // 6-4: 軽巡旗艦+駆逐3 rides B→D→C→F→N through all fixed edges
  store.const.$ships[5].api_stype=8;store.const.$ships[6].api_stype=5;
  const land=evaluateNormalRoute(store,{area:'6-4',scheme:{fleet:1,ships:[1,2,3,4,5,6]}});
  assert.equal(land.verdict,'guaranteed');
  assert.deepEqual(land.pointAssessments.find(point=>point.from==='start').assessment.destinations,['B']);
  // 6-5: 航戦2+航巡1+軽巡1+駆逐2 walks B→F→I→J; low LoS diverts J→L.
  const surface=fixture();surface.const.$ships[5].api_stype=10;surface.const.$ships[17].api_stype=10;
  surface.const.$ships[14].api_stype=6;
  const south=evaluateNormalRoute(surface,{area:'6-5',scheme:{fleet:1,ships:[5,17,14,1,2,3]}});
  assert.deepEqual(south.pointAssessments.find(point=>point.from==='B').assessment.destinations,['F']);
  assert.deepEqual(south.pointAssessments.find(point=>point.from==='J').assessment.destinations,['L']);
});

test('7-x multi-gauge phases route correctly; active branches stay unknown',()=>{
  const store=fixture();
  // 7-1: 軽巡1+駆逐4 (5 ships) rides D→E→G→H→K through all fixed edges
  const escort=evaluateNormalRoute(store,{area:'7-1',scheme:{fleet:1,ships:[1,2,3,4,6]}});
  assert.equal(escort.verdict,'guaranteed');
  assert.deepEqual(escort.pointAssessments.find(point=>point.from==='D').assessment.destinations,['E']);
  // 7-2 gauge1: 海防3+軽空1+軽巡1 (5 ships) walks C→E→G (CEG)
  store.const.$ships[16].api_stype=7;
  const g1=evaluateNormalRoute(store,{area:'7-2',phase:'gauge1',scheme:{fleet:1,ships:[8,9,10,16,1]}});
  assert.equal(g1.verdict,'guaranteed');
  assert.deepEqual(g1.pointAssessments.find(point=>point.from==='C').assessment.destinations,['E']);
  // 7-2 gauge2: 海防3+重巡2+軽巡1 opens C→D; D's speed tier pins I, whose reference LoS condition applies
  const g2Store=fixture();for(const id of [5,6])g2Store.const.$ships[id].api_stype=5;
  const g2=evaluateNormalRoute(g2Store,{area:'7-2',phase:'gauge2',scheme:{fleet:1,ships:[5,6,8,9,10,1]}});
  assert.deepEqual(g2.pointAssessments.find(point=>point.from==='C').assessment.destinations,['D']);
  assert.deepEqual(g2.pointAssessments.find(point=>point.from==='D').assessment.destinations,['I']);
  assert.equal(g2.pointAssessments.find(point=>point.from==='I').assessment.status,'fixed');
  // 7-3 gauge1: 重巡1+駆逐2 (3 ships) walks A→C→E; 6 ships with a battleship strand at F
  const patrol=fixture();patrol.const.$ships[5].api_stype=5;
  const fleet=evaluateNormalRoute(patrol,{area:'7-3',phase:'gauge1',scheme:{fleet:1,ships:[5,2,3,4]}});
  assert.equal(fleet.verdict,'guaranteed');
  const heavy=fixture();for(const id of [1,2,3,4,6])heavy.const.$ships[id].api_stype=9;
  assert.equal(evaluateNormalRoute(heavy,{area:'7-3',phase:'gauge1',
    scheme:{fleet:1,ships:[5,1,2,3,4,6]}}).verdict,'unreachable');
  // 7-4: 練巡1+海防3+駆逐1 walks start→A→B→E; low LoS sends J→K.
  const convoy=fixture();convoy.const.$ships[5].api_stype=21;
  const resupply=evaluateNormalRoute(convoy,{area:'7-4',scheme:{fleet:1,ships:[5,8,9,10,2]}});
  assert.deepEqual(resupply.pointAssessments.find(point=>point.from==='C').assessment.destinations,['E']);
  assert.deepEqual(resupply.pointAssessments.find(point=>point.from==='J').assessment.destinations,['K']);
  // 7-5: heavy fleets strand at C; the light escort reaches the F 能動 branch open
  const light=evaluateNormalRoute(fixture(),{area:'7-5',phase:'gauge1',
    scheme:{fleet:1,ships:[14,1,2,3,4,6]}});
  assert.equal(light.pointAssessments.find(point=>point.from==='B').assessment.destinations[0],'D');
  assert.equal(light.pointAssessments.find(point=>point.from==='F').assessment.status,'unknown');
  const bb=fixture();bb.const.$ships[5].api_stype=8;for(const id of [2,3])bb.const.$ships[id].api_stype=8;
  assert.equal(evaluateNormalRoute(bb,{area:'7-5',phase:'gauge1',
    scheme:{fleet:1,ships:[5,2,3,4,6,7]}}).verdict,'unreachable');
});

test('1-3 uses individual observed battleship speed and preserves unspecified random weights',()=>{
  const store=fixture();
  const fourDD=evaluateNormalRoute(store,{area:'1-3',scheme:{fleet:1,ships:[1,2,3,4,6]}});
  assert.equal(fourDD.verdict,'guaranteed');
  const supplyCarrier=evaluateNormalRoute(store,{area:'1-3',scheme:{fleet:1,ships:[16,17,2]}});
  assert.equal(supplyCarrier.verdict,'unreachable');
  assert.equal(predicate({anyShipSpeed:{stypes:[9],speedIs:'slow'}},
    [{instanceId:5,stype:9}],{speed:{ships:[{shipId:5,speed:'slow',status:'observed'}]}}),true);
  assert.equal(predicate({anyShipSpeed:{stypes:[9],speedIs:'slow'}},
    [{instanceId:5,stype:9}],{speed:{ships:[{shipId:5,speed:'fast',status:'estimated'}]}}),null);
});

test('known base speed is authoritative for fleet and individual routing predicates',()=>{
  const ships=[{instanceId:5,stype:9}],metrics={speed:{status:'computed',fleetSpeed:'slow',ships:[{shipId:5,speed:'slow',status:'computed'}]}};
  assert.equal(predicate({speedIs:'slow'},ships,metrics),true);
  assert.equal(predicate({speedAtLeast:'fast'},ships,metrics),false);
  assert.equal(predicate({anyShipSpeed:{stypes:[9],speedIs:'slow'}},ships,metrics),true);
  assert.equal(predicate({anyShipSpeed:{stypes:[9],speedIs:'fast'}},ships,metrics),false);
});

function reviewFleet(types,{names=[],speeds=[]}={}){
  const store=fixture();
  types.forEach((stype,index)=>{
    const id=index+1;
    store.const.$ships[id].api_stype=stype;
    store.const.$ships[id].api_name=names[index]||`测试${id}`;
    store.info.ships[id].api_soku=speeds[index]??10;
    store.const.$ships[id].api_soku=speeds[index]??10;
  });
  return {store,scheme:{fleet:1,ships:types.map((_,index)=>index+1)}};
}
function reviewRoute(area,types,options={},shipOptions={}){
  const {store,scheme}=reviewFleet(types,shipOptions);
  return evaluateNormalRoute(store,{area,scheme,...options});
}
function at(result,node){return result.pointAssessments.find(point=>point.from===node).assessment;}

test('friendly supply, armored carriers, and class-based slow battleships use the right type sets',()=>{
  assert.equal(at(reviewRoute('2-2',[22,3,2,2,2,2],{target:'B'}),'C').destinations[0],'B');
  assert.deepEqual(at(reviewRoute('3-3',[18,7,3,2,2,4]),'A').destinations,['C']);
  assert.deepEqual(at(reviewRoute('1-3',[9,3,2,2,2,2],{},
    {speeds:[10]}),'F').destinations,['H']);
  assert.deepEqual(at(reviewRoute('7-5',[9,7,3,2,2,2]),'B').destinations,['D']);
  assert.deepEqual(at(reviewRoute('7-5',[9,9,3,2,2,2]),'B').destinations,['C']);
  assert.deepEqual(at(reviewRoute('7-4',[10,7,3,2,2,2]),'start').destinations,['A']);
});

test('aviation battleships count as 戦艦級 while fast ones are not (低速)戦艦',()=>{
  // 金剛型 (stype 8) is a high-speed battleship: it must not take the (低速)戦艦 lane
  assert.deepEqual(at(reviewRoute('1-3',[8,3,2,2,2,2],{}, {speeds:[10]}),'F').destinations,['J']);
  assert.deepEqual(at(reviewRoute('7-5',[8,8,3,2,2,2]),'B').destinations,['D']);
  // 航空戦艦 (10) is a separate subtype but belongs to 戦艦級 in route tables.
  const coin=at(reviewRoute('2-2',[10,10,7,7,2,2]),'E');
  assert.equal(coin.status,'fixed');
  assert.deepEqual(coin.destinations,['G']);
});

test('NGA generic gates precede 5-2 exceptions while 6-4 named pair is retained',()=>{
  const yubari=reviewRoute('5-2',[3,2,2,2,2,2],{},
    {names:['夕張改']});
  assert.deepEqual(at(yubari,'C').destinations,['E']);
  assert.deepEqual(at(yubari,'D').destinations,['G']);
  const nagato=reviewRoute('6-4',[9,9,16,3,2,2],{},
    {names:['長門改二','陸奥改二','秋津洲改'],speeds:[5,5,5]});
  assert.deepEqual(at(nagato,'start').destinations,['A']);
  assert.deepEqual(at(nagato,'A').destinations,['D']);
  const kisaragi=reviewRoute('6-4',[3,2,2,2,2,2],{},
    {names:['テスト','如月改二']});
  assert.deepEqual(at(kisaragi,'E').destinations,['D']);
});

test('大発動艇系 membership follows the wiki list, not the 上陸用舟艇 category',()=>{
  const equipBarges=(store,masterId,category,shipIds)=>{
    store.const.$equips[masterId]={api_type:[0,0,category,0,0]};
    shipIds.forEach((shipId,index)=>{
      const instance=100+index;
      store.info.equips[instance]={api_id:instance,api_slotitem_id:masterId};
      store.info.ships[shipId].api_slot=[instance];
    });
  };
  const startAt=(store,area,ships)=>evaluateNormalRoute(store,{area,scheme:{fleet:1,ships}})
    .pointAssessments.find(point=>point.from==='start').assessment;
  // 軽巡1+駆逐3+戦艦1: without barges 5-5 start falls through to それ以外はB
  // 特二式内火艇 (category 46) is in every wiki definition of 大発動艇系
  const nika=fixture();equipBarges(nika,167,46,[1,2,3,6]);
  assert.deepEqual(startAt(nika,'5-5',[1,2,3,5,6]).destinations,['A']);
  // 大発動艇 proper still counts
  const daihatsu=fixture();equipBarges(daihatsu,68,24,[1,2,3,6]);
  assert.deepEqual(startAt(daihatsu,'5-5',[1,2,3,5,6]).destinations,['A']);
  // M4A1 DD and 特大発＋戦車第11連隊 share category 24 but the wiki excludes both
  const tanks=fixture();equipBarges(tanks,355,24,[1,2,3,6]);
  assert.deepEqual(startAt(tanks,'5-5',[1,2,3,5,6]).destinations,['B']);
  const regiment=fixture();equipBarges(regiment,230,24,[1,2,3,6]);
  assert.deepEqual(startAt(regiment,'5-5',[1,2,3,5,6]).destinations,['B']);
  // 大発動艇(R35&フランス兵) is unclassified on the wiki: the branch must stay
  // undecided and surface a warning instead of silently not counting
  const r35=fixture();equipBarges(r35,576,24,[1,2]);
  const undecided=startAt(r35,'5-5',[1,2,3,5,6]);
  assert.equal(undecided.status,'unknown');
  assert.deepEqual(undecided.destinations,['A','B']);
  assert.equal(evaluateNormalRoute(r35,{area:'5-5',
    scheme:{fleet:1,ships:[1,2,3,5,6]}}).warnings.length,1);
  // 5-4's drum+landing tally counts 内火艇 too and excludes the 戦車第11連隊 combo
  const nikaTally=fixture();equipBarges(nikaTally,167,46,[1,2,5,12,13]);
  assert.deepEqual(startAt(nikaTally,'5-4',[1,2,5,12,13]).destinations,['B']);
  const regimentTally=fixture();equipBarges(regimentTally,230,24,[1,2,5,12,13]);
  assert.deepEqual(startAt(regimentTally,'5-4',[1,2,5,12,13]).destinations,['A']);
});

test('fixed arrival wording proves the 3-5 LoS requirement without changing an estimated verdict',()=>{
  const map=require('../../../data/normal_routes/3-5.json');
  for(const [upper,gate,minimum] of [[true,'H',40],[false,'G',28]]){
    const store=fixture();store.info.basic.api_level=120;
    const ids=upper?[5,1,2,3,4,6]:[1,2,3,4,6,7];
    if(upper)for(const id of [1,2,3,4,6])store.const.$ships[id].api_stype=5;
    const route=evaluateNormalRoute(store,{area:'3-5',scheme:{fleet:1,ships:ids}});
    route.lineOfSight={...route.lineOfSight,status:'estimate',thresholdMargin:0,
      rawScoresByCoefficient:{1:25,2:50,3:75,4:100},scoresByCoefficient:{1:25,2:50,3:75,4:100}};
    route.verdict='possibleUnverified';route.chanceRange=[0,1];
    route.pointAssessments.find(p=>p.from===gate).assessment=
      evaluatePoint(map.machineRules[gate],route.ships,{lineOfSight:route.lineOfSight});
    const before=JSON.stringify(route),condition=fixedArrivalCondition(route);
    assert.deepEqual(condition.requirements,[{from:gate,coefficient:4,minimum,requiredScore:minimum}]);
    assert.equal(condition.estimatedMeets,true);assert.equal(JSON.stringify(route),before);
    route.lineOfSight.rawScoresByCoefficient[4]=minimum-0.01;
    assert.equal(fixedArrivalCondition(route).estimatedMeets,false);
    route.lineOfSight.thresholdMargin=2;route.lineOfSight.rawScoresByCoefficient[4]=minimum+1;
    assert.equal(fixedArrivalCondition(route).estimatedMeets,false);
    assert.equal(fixedArrivalCondition(route).requirements[0].requiredScore,minimum+2);
    route.pointAssessments.find(p=>p.from==='start').assessment={status:'random',destinations:['B','F']};
    assert.equal(fixedArrivalCondition(route),null,'a genuine random branch must retain its probability');
  }
});

test('5-4 and 5-5 conditional arrival checks retain speed while proving LoS and tolerate missing legacy speed',()=>{
  for(const [area,types,gate,minimum] of [
    ['5-4',[11,8,7,6,2,2],'L',60],
    ['5-4',[10,6,3,2,2,2],'M',45],
    ['5-5',[8,8,11,11,6,6],'P',80]
  ])for(const status of ['computed','estimate']){
    const route=reviewRoute(area,types);
    assert.equal(route.speed.status,'observed');
    assert.equal(route.speed.fleetSpeed,'fast');
    route.lineOfSight={...route.lineOfSight,status,thresholdMargin:1,
      rawScoresByCoefficient:{2:minimum+1},lowerBoundScoresByCoefficient:undefined};
    const before=JSON.stringify(route),condition=fixedArrivalCondition(route);
    assert.deepEqual(condition.requirements,[{from:gate,coefficient:2,minimum,requiredScore:minimum+1}]);
    assert.equal(condition.estimatedMeets,true);
    assert.equal(JSON.stringify(route),before,'the proof must not change the route or actual speed');
    delete route.speed;
    assert.equal(fixedArrivalCondition(route),null,'unknown speed cannot prove that a prior speed condition does not apply');
  }
});

test('estimated LoS fixes an exit when its conservative lower bound clears every preceding band',()=>{
  const rules=require('../../../data/normal_routes/3-5.json').machineRules.H;
  const metrics=(bound,margin=0)=>({lineOfSight:{status:'estimate',rawScoresByCoefficient:{4:123.05},
    lowerBoundScoresByCoefficient:{4:bound},thresholdMargin:margin}});
  const enough=evaluatePoint(rules,[],metrics(70));
  assert.equal(enough.status,'fixed');assert.deepEqual(enough.destinations,['K']);
  assert.equal(evaluatePoint(rules,[],metrics(39.99)).status,'unknown');
  assert.equal(evaluatePoint(rules,[],metrics(41,2)).status,'unknown');
  assert.equal(evaluatePoint(rules,[],metrics(42,2)).status,'fixed');
  assert.equal(predicate({los:{coefficient:4,gte:40}},[],{}),null);
  const blocked=evaluatePoint(rules,Array.from({length:4},()=>({stype:11})),metrics(70));
  assert.equal(blocked.status,'fixed');assert.deepEqual(blocked.destinations,['J']);
});

test('all 37 maps expose air-control reference profiles with distinct phase and route cases',()=>{
  const maps=listNormalMaps().maps;
  for(const map of maps){
    assert(map.airControl?.profiles.length>0,map.area);
    const ids=map.airControl.profiles.map(profile=>profile.id);
    assert.equal(new Set(ids).size,ids.length,map.area);
    for(const profile of map.airControl.profiles){
      assert(Number.isInteger(profile.superiority)&&profile.superiority>=0,map.area);
      assert(Number.isInteger(profile.supremacy)&&profile.supremacy>=profile.superiority,map.area);
      assert.equal(profile.supremacy%3,0,`${map.area}:${profile.id}`);
      assert.equal(profile.superiority,Math.ceil(profile.supremacy/2),`${map.area}:${profile.id}`);
    }
  }
  const detour=maps.find(map=>map.area==='7-4').airControl.profiles.find(p=>p.id==='detourM');
  assert.equal(detour.supremacy,1098);
  const middle=maps.find(map=>map.area==='5-5').airControl.profiles.find(p=>p.id==='middleH');
  assert.equal(middle.parity,137);
});

test('route evaluation compares departure air-power range without promising en-route supremacy',()=>{
  const store=fixture();
  store.const.$ships[1].api_maxeq=[18];store.info.ships[1].api_onslot=[18];
  store.info.ships[1].api_slot=[201];
  store.info.equips[201]={api_slotitem_id:201,api_alv:7,api_level:0};
  store.const.$equips[201]={api_type:[0,0,6,0],api_tyku:10};
  const result=evaluateNormalRoute(store,{area:'2-2'}).airControl;
  assert.equal(result.referenceMaximum.superiority,41);
  assert.equal(result.referenceMaximum.supremacy,81);
  assert.equal(result.assessment.superiority.status,'meetsAtStart');
  assert.equal(result.assessment.supremacy.status,'belowAtStart');
  assert.equal(result.routeSustainability,'notSimulated');
});

test('air-control phases and land-base options stay separate from unconditional requirements',()=>{
  const store=fixture();
  assert.equal(evaluateNormalRoute(store,{area:'7-5',phase:'gauge1'}).airControl.referenceMaximum.supremacy,549);
  assert.equal(evaluateNormalRoute(store,{area:'7-5',phase:'gauge3'}).airControl.referenceMaximum.supremacy,1005);
  assert.equal(evaluateNormalRoute(store,{area:'7-2',phase:'gauge3'}).airControl.status,'unknown');
  const six=evaluateNormalRoute(store,{area:'6-5'}).airControl;
  assert.equal(six.referenceMaximum.superiority,468);
  assert.equal(six.profiles[0].parity,209);
  assert.equal(six.landBaseOptions[0].fleetSuperiority,294);
  assert.equal(six.landBaseOptions[0].status,'requiresLandBaseVerification');
  assert.equal(six.landBaseProbabilityBasis.fleet,0.99);
  assert.equal(evaluateNormalRoute(store,{area:'1-6'}).airControl.referenceMaximum.superiority,198);
});

test('missing equipment master leaves equipment-dependent routes unresolved',()=>{
  const store=fixture();
  store.info.ships[1].api_slot=[999];
  const result=evaluateNormalRoute(store,{area:'5-5',scheme:{fleet:1,ships:[1,2,3,5,6]}});
  const start=result.pointAssessments.find(point=>point.from==='start').assessment;
  assert.equal(result.lineOfSight.status,'unknown');
  assert.equal(result.airControl.status,'unknown');
  assert.equal(start.status,'unknown');
  assert.deepEqual(start.destinations,['A','B']);
  assert.equal(result.warnings.length,1);
});

test('unknown drums affect combined transport counts but not known landing-craft counts',()=>{
  const ships=[{drumEquipped:null,landingCraftEquipped:true}];
  assert.equal(predicate({landingCraftCarriers:{min:1}},ships,{}),true);
  assert.equal(predicate({transportEquipCount:{min:2}},ships,{}),null);
  assert.equal(predicate({transportEquipCount:{max:1}},ships,{}),null);
});

test('7-3 gauge2 uses the player-selected F/G stage rule and retains first-stage E',()=>{
  const drift=evaluateNormalRoute(fixture(),{area:'7-3',phase:'gauge2',
    scheme:{fleet:1,ships:[1,2,3,4]}});
  const d=drift.pointAssessments.find(point=>point.from==='D').assessment;
  assert.equal(d.status,'fixed');
  assert.equal(d.conditionUnknown,undefined);
  assert.deepEqual(d.destinations,['G']);
  assert.deepEqual(evaluatePoint(require('../../../data/normal_routes/7-3.json').machineRules['D#gauge1'],
    [5,2,2,2].map(stype=>({stype})),{}).destinations,['E']);
  assert.notEqual(drift.routeTag,'样本不足');
  // Three battleships still pin D→F outright.
  const heavy=fixture();for(const id of [1,2,3])heavy.const.$ships[id].api_stype=9;
  assert.deepEqual(evaluateNormalRoute(heavy,{area:'7-3',phase:'gauge2',
    scheme:{fleet:1,ships:[1,2,3,4]}}).pointAssessments
    .find(point=>point.from==='D').assessment.destinations,['F']);
});

test('six-ship escorts and extra light cruisers satisfy the source formations',()=>{
  const fourDE=reviewRoute('7-4',[1,1,1,1,17,7],{},
    {names:['占守','国後','択捉','松輪','あきつ丸改','大鷹']});
  assert.deepEqual(at(fourDE,'E').destinations,['J'],'CVL + Akitsu Maru >= 2 takes priority');
  const fiveDE=reviewRoute('7-4',[1,1,1,1,1,17]);
  assert.deepEqual(at(fiveDE,'E').destinations,['G']);
  const otherCVL=reviewRoute('7-4',[1,1,1,1,17,7],{},
    {names:['占守','国後','択捉','松輪','あきつ丸改','瑞鳳']});
  assert.deepEqual(at(otherCVL,'E').destinations,['J']);
  assert.deepEqual(at(reviewRoute('2-4',[3,3,2,2,2,2]),'H').destinations,['L']);
});

test('ambiguous exits stay possible rather than becoming guaranteed or unreachable',()=>{
  const m43=require('../../../data/normal_routes/4-3.json');
  assert.equal(m43.fixedEdges.K,undefined);
  const k43=evaluatePoint(m43.machineRules.K,[11,7,8,8,2,2].map(stype=>({stype})),{});
  assert(k43.destinations.includes('N'));
  const m45=require('../../../data/normal_routes/4-5.json');
  const k45=evaluatePoint(m45.machineRules.K,[13,14,3,2,2,2].map(stype=>({stype})),{});
  assert.deepEqual(new Set(k45.destinations),new Set(['L','M','T']));
  assert.equal(k45.status,'unknown','missing computed LoS must remain unresolved');
  assert.deepEqual(reviewRoute('3-4',[16,11,11,7,7,3]).chanceRange,[1,1]);
  assert.equal(reviewRoute('3-4',[3,2,2,2,2,1]).verdict,'guaranteed');
  assert.equal(reviewRoute('6-1',[11,3,4,4,4,2]).verdict,'unreachable');
  assert.notEqual(reviewRoute('7-2',[8,11,7,5,2,2],{phase:'gauge2'}).verdict,'guaranteed');
  const m61=require('../../../data/normal_routes/6-1.json');
  const m72=require('../../../data/normal_routes/7-2.json');
  assert(m61.deadEnds.includes('I'));
  assert(m72.deadEnds.includes('F')&&m72.deadEnds.includes('L'));
  assert.equal(require('../../../data/normal_routes/3-4.json').fixedEdges.N,'P');
  const m73=require('../../../data/normal_routes/7-3.json');
  assert.equal(m73.fixedEdges.N,undefined);
  assert(m73.deadEnds.includes('N'));
  assert.equal(reviewRoute('7-3',[11,2,2,2,2,2],{phase:'gauge2'}).verdict,'unreachable');
  const m74=require('../../../data/normal_routes/7-4.json');
  assert.equal(m74.fixedEdges.H,'K');
  assert(!m74.deadEnds.includes('H'));
  const m75=require('../../../data/normal_routes/7-5.json');
  assert.equal(m75.fixedEdges.L,'M');
  assert(!m75.deadEnds.includes('L'));
  const special=reviewRoute('7-3',[5,2,2,2],{phase:'gauge2'},
    {names:['羽黒改二','神風改']});
  assert.deepEqual(at(special,'A').destinations,['C']);
  assert.deepEqual(at(special,'C').destinations,['E']);
  assert.deepEqual(at(special,'D').destinations,['G']);
  assert.equal(at(special,'D').status,'fixed');
  const penangPair=reviewRoute('7-3',[5,2],{phase:'gauge1'},
    {names:['羽黒改二','神風改']});
  assert.deepEqual(at(penangPair,'A').destinations,['C']);
  assert.deepEqual(at(penangPair,'C').destinations,['E']);
  const penangPairGauge2=reviewRoute('7-3',[5,2],{phase:'gauge2'},
    {names:['羽黒改二','神風改']});
  assert.deepEqual(at(penangPairGauge2,'A').destinations,['C']);
  assert.deepEqual(at(penangPairGauge2,'C').destinations,['E']);
  assert.equal(reviewRoute('7-5',[3,2,2,2,2,2],{phase:'gauge1',target:'Q'}).verdict,'unreachable');
  assert.equal(reviewRoute('7-5',[3,2,2,2,2,2],{phase:'gauge1',target:'T'}).verdict,'unreachable');
  assert.equal(reviewRoute('7-5',[3,2,2,2,2,2],{phase:'gauge2',target:'T'}).verdict,'unreachable','low LoS now correctly routes to S');
});

test('Chinese wiki unmarked random rates are reflected at the affected nodes',()=>{
  const m24=require('../../../data/normal_routes/2-4.json');
  const fleet=types=>types.map(stype=>({stype}));
  const f24=evaluatePoint(m24.machineRules.F,fleet([7,2,2,3,5,6]),{});
  assert.deepEqual(f24.probabilities.map(x=>x.probability),[0.0625,0.9375]);
  const i24=evaluatePoint(m24.machineRules.I,fleet([7,3,2,2,5,6]),{});
  assertWeights(i24,{E:.072,K:.928});
  const de24=evaluatePoint(m24.machineRules.I,fleet([1,1,7,3,2,2]),{});
  assert.equal(de24.status,'random');
  assertWeights(de24,{E:.536,K:.464});
  const m33=require('../../../data/normal_routes/3-3.json');
  const g33=evaluatePoint(m33.machineRules.G,fleet([9,9,9,9,9,2]),{});
  assert.deepEqual(g33.probabilities.map(x=>x.probability),[0.65,0.35]);
  const k33=evaluatePoint(m33.machineRules.K,fleet([9,7,2,2,2,3]),{});
  assert.deepEqual(k33.probabilities.map(x=>x.probability),[0.25,0.75]);
  const m34=require('../../../data/normal_routes/3-4.json');
  const start34=evaluatePoint(m34.machineRules.start,fleet([9,9,3,2,2,2]),{});
  assert.deepEqual(start34.probabilities.map(x=>x.probability),[0.35,0.65]);
  const m42=require('../../../data/normal_routes/4-2.json');
  const smallSample=evaluatePoint(m42.machineRules.start,fleet([2,2,2,2,2,3]),{});
  assert.equal(smallSample.status,'random');
  assertWeights(smallSample,{A:.8626875,B:.1373125});
});

test('reference numeric conditions and recorded K-to-M exit are applied',()=>{
  const m44=require('../../../data/normal_routes/4-4.json');
  const f44=evaluatePoint(m44.machineRules.F,[9,9,11,2,2,3].map(stype=>({stype})),{});
  assert.equal(f44.status,'fixed');assert.deepEqual(f44.destinations,['H']);
  const m74=require('../../../data/normal_routes/7-4.json');
  const k74=evaluatePoint(m74.machineRules.K,[2,2,3,7,10].map(stype=>({stype})),{});
  assert.equal(k74.status,'fixed');assert.equal(k74.conditionUnknown,undefined);
  assert.deepEqual(k74.destinations,['M']);
  const confirmed=reviewRoute('1-5',[3,2,2,2]);assert.equal(confirmed.routeTag,'100%固定');
  const reference=reviewRoute('3-4',[11,11,7,3,2,2]);
  assert.equal(reference.verdict,'guaranteed');assert.equal(reference.routeTag,'100%固定');
  assert.equal(reference.probability,1);assert.deepEqual(reference.tentativePoints,[]);
});

test('33-formula route thresholds compare unrounded score and keep uncertain inputs open',()=>{
  const rules=require('../../../data/normal_routes/1-6.json').machineRules.M;
  const ships=[3,2,2,2,2].map(stype=>({stype}));
  const metrics=score=>({lineOfSight:{status:'computed',rawScoresByCoefficient:{3:score},thresholdMargin:0}});
  assert.deepEqual(evaluatePoint(rules,ships,metrics(27.999)).destinations,['L']);
  assert.equal(evaluatePoint(rules,ships,metrics(28)).status,'random');
  assert.equal(evaluatePoint(rules,ships,metrics(29.999)).status,'random');
  assert.deepEqual(evaluatePoint(rules,ships,metrics(30)).destinations,['J']);
  assert.equal(evaluatePoint(rules,ships,{lineOfSight:{status:'estimate'}}).status,'unknown');
  assert.equal(predicate({los:{coefficient:3,gte:30}},ships,
    {lineOfSight:{status:'computed',rawScoresByCoefficient:{3:30.5},thresholdMargin:1}}),null);
  assert.equal(predicate({los:{coefficient:3,gte:30}},ships,
    {lineOfSight:{status:'computed',rawScoresByCoefficient:{3:31},thresholdMargin:1}}),true);
});

test('5-3 G counts two battleship hulls independently of propulsion upgrades',()=>{
  const rules=require('../../../data/normal_routes/5-3.json').machineRules.G;
  const pair=[9,9,5,3,2,2].map(stype=>({stype})),single=[9,5,5,3,2,2].map(stype=>({stype}));
  for(const fleetSpeed of ['slow','fastPlus','fastest']){
    const metrics={speed:{status:'observed',fleetSpeed}};
    assert.deepEqual(evaluatePoint(rules,pair,metrics).destinations,['J']);
    assert.equal(evaluatePoint(rules,pair,metrics).status,'fixed');
    assert.deepEqual(evaluatePoint(rules,single,metrics).destinations,['I']);
  }
});
test('7-1 four-ship escort template fixes the H-to-Boss gate',()=>{
  const guide=require('../../../data/normal_route_guides.json').maps['7-1'].routes.find(r=>r.nodes[0]==='F');
  assert.deepEqual(guide.templates,[[[2],[1],[1],[1]]]);
  const result=reviewRoute('7-1',[2,1,1,1]);
  assert.equal(result.verdict,'guaranteed');assert.deepEqual(result.chanceRange,[1,1]);
});


function referenceMetrics(score,coefficient=2,speed='fast',visitedNodes=[]){
  return {speed:{status:'observed',fleetSpeed:speed},visitedNodes,
    lineOfSight:{status:'computed',rawScoresByCoefficient:{[coefficient]:score}}};
}
const referenceShips=(types,names=[])=>types.map((stype,i)=>({stype,name:names[i]||`测试${i}`}));

test('2-5 accepts the numeric 49 reference and applies a 50% intermediate LoS coin',()=>{
  const rules=require('../../../data/normal_routes/2-5.json').machineRules.J;
  const ships=referenceShips([9,5,5,3,2,2]);
  assert.deepEqual(evaluatePoint(rules,ships,referenceMetrics(41.99,1)).destinations,['H']);
  assert.deepEqual(evaluatePoint(rules,ships,referenceMetrics(48.99,1)).probabilities,
    [{to:'H',probability:.5},{to:'O',probability:.5}]);
  const met=evaluatePoint(rules,ships,referenceMetrics(49,1));
  assert.equal(met.status,'fixed');assert.deepEqual(met.destinations,['O']);
  assert(!met.tentative);assert(!met.rule.includes('样本不足'));
});

test('4-5 route history, K LoS 60/70 and Q LoS 50/60 are fully evaluated',()=>{
  const map=require('../../../data/normal_routes/4-5.json');
  const ships=referenceShips([5,5,5,3,2,2]);
  const at=(point,score,extra={})=>evaluatePoint(map.machineRules[point],ships,{...referenceMetrics(score),...extra});
  assert.deepEqual(at('H',80).destinations,['K']);
  assert.deepEqual(at('H',80,{visitedNodes:['D']}).destinations,['K']);
  assert.deepEqual(at('K',59.99).destinations,['L']);
  assert.deepEqual(at('K',60).probabilities,[{to:'L',probability:.5},{to:'T',probability:.5}]);
  assert.deepEqual(at('K',70).destinations,['T']);
  assert.deepEqual(at('K',70,{visitedNodes:['E']}).probabilities,[{to:'M',probability:.5},{to:'T',probability:.5}]);
  const submarine=referenceShips([13,5,5,3,2,2]);
  const middle=evaluatePoint(map.machineRules.K,submarine,referenceMetrics(65));
  assert.deepEqual(middle.probabilities,[{to:'M',probability:.5},{to:'L',probability:.25},{to:'T',probability:.25}]);
  assert.deepEqual(evaluatePoint(map.machineRules.K,submarine,referenceMetrics(70)).probabilities,
    [{to:'M',probability:.5},{to:'T',probability:.5}]);
  assert.deepEqual(at('Q',49.99).destinations,['P']);
  assert.deepEqual(at('Q',50).probabilities,[{to:'P',probability:.5},{to:'N',probability:.5}]);
  assert.deepEqual(at('Q',60).destinations,['N']);
  const noDestroyer=referenceShips([5,5,5,5,5,3]);
  assert.deepEqual(evaluatePoint(map.machineRules.Q,noDestroyer,referenceMetrics(58)).destinations,['P','O']);
  assert.deepEqual(evaluatePoint(map.machineRules.Q,noDestroyer,referenceMetrics(60)).destinations,['O']);
});

test('5-2 G uses unknown-random reference without unsupported named bonuses',()=>{
  const rules=require('../../../data/normal_routes/5-2.json').machineRules.G;
  for(const speed of ['fast','fastPlus','fastest']){
    const result=evaluatePoint(rules,referenceShips([7,3,5,5,2,2],['祥鳳改','夕張改二']),referenceMetrics(80,2,speed));
    assert.equal(result.status,'random');assertWeights(result,{J:.5,L:.5});
    assert.deepEqual(result.destinations,['J','L']);
  }
  assert.equal(predicate({flagshipName:{prefixes:['祥鳳','夕張']}},[{name:'夕張改二特'}],{}),true);
  assert.equal(predicate({flagshipName:{prefixes:['祥鳳','夕張']}},[{name:'鳥海'},{name:'夕張改二特'}],{}),false);
});

test('5-5 low LoS overrides submarine coins and numeric 35% branches remain exact',()=>{
  const map=require('../../../data/normal_routes/5-5.json');
  const submarine=referenceShips([13,5,5,3,2,2]);
  assert.deepEqual(evaluatePoint(map.machineRules.O,submarine,referenceMetrics(62.99)).destinations,['R']);
  assert.deepEqual(evaluatePoint(map.machineRules.O,submarine,referenceMetrics(64)).probabilities,
    [{to:'R',probability:.675},{to:'S',probability:.325}]);
  assert.deepEqual(evaluatePoint(map.machineRules.O,submarine,referenceMetrics(66)).probabilities,
    [{to:'R',probability:.35},{to:'S',probability:.65}]);
  const heavy=referenceShips([9,9,9,11,11,2]);
  assert.deepEqual(evaluatePoint(map.machineRules.P,heavy,referenceMetrics(72.99)).destinations,['Q']);
  assert.deepEqual(evaluatePoint(map.machineRules.P,heavy,referenceMetrics(80)).probabilities,
    [{to:'Q',probability:.35},{to:'S',probability:.65}]);
});

test('7-4 remaining J and M rules use full fleet conditions after the LoS gate',()=>{
  const map=require('../../../data/normal_routes/7-4.json');
  const escort=referenceShips([2,1,1]);
  assert.deepEqual(evaluatePoint(map.machineRules.J,escort,referenceMetrics(35,4,'fast',['E'])).probabilities,
    [{to:'K',probability:.5},{to:'P',probability:.5}]);
  assert.deepEqual(evaluatePoint(map.machineRules.J,escort,referenceMetrics(80,4,'fast',['D','F'])).destinations,['K']);
  const light=referenceShips([7,3,2,2,2,2]),heavy=referenceShips([9,3,2,2,2,2]);
  assert.deepEqual(evaluatePoint(map.machineRules.M,light,referenceMetrics(45,4)).destinations,['N','O']);
  assert.deepEqual(evaluatePoint(map.machineRules.M,light,referenceMetrics(57,4)).destinations,['P']);
  assert.deepEqual(evaluatePoint(map.machineRules.M,heavy,referenceMetrics(46,4)).probabilities,
    [{to:'N',probability:.5},{to:'O',probability:.5}]);
  assert.deepEqual(evaluatePoint(map.machineRules.M,heavy,referenceMetrics(47,4)).destinations,['O']);
});

test('explicitly missing conditions still cannot be converted to a reference coin',()=>{
  const result=evaluatePoint([{when:true,choices:[{to:'A'},{to:'B'}],conditionUnknown:true,
    conditionUnknownReason:'Test condition not supplied'}],[],{});
  assert.equal(result.status,'unknown');assert.equal(result.conditionUnknown,true);
  assert.equal(result.referencePathProbability,undefined);
});

test('user-adjudicated 3-4 and 4-5 branches remove unsupported exits without inventing odds',()=>{
  const m34=require('../../../data/normal_routes/3-4.json'),m45=require('../../../data/normal_routes/4-5.json');
  const f=evaluatePoint(m34.machineRules.F,referenceShips([2,2,2,2,2,2]),referenceMetrics(100));
  assert.deepEqual(f.probabilities,[{to:'G',probability:.45},{to:'M',probability:.55}]);
  assert(!m34.branchPoints.find(p=>p.from==='F').destinations.includes('I'));
  assert(m34.deadEnds.includes('I'),'unused map node is retained');
  for(const score of [0,65,100]){
    const k=evaluatePoint(m45.machineRules.K,referenceShips([5,5,5,3,3,2]),referenceMetrics(score,2,'fast',['E']));
    assert.equal(k.status,'fixed');assert.deepEqual(k.destinations,['M']);
  }
});

test('7-4 supplied table covers G boundaries, C fastest speed and E priority',()=>{
  const m=require('../../../data/normal_routes/7-4.json'),fleet=referenceShips([7,3,2,2,2,2]);
  for(const [score,exits]of [[32.999,['I']],[33,['I','L']],[36.999,['I','L']],[37,['L']]]){
    const r=evaluatePoint(m.machineRules.G,fleet,referenceMetrics(score,4));assert.deepEqual(r.destinations,exits);
    if(exits.length===2)assert.deepEqual(r.probabilities.map(p=>p.probability),[.5,.5]);
  }
  assert.equal(evaluatePoint(m.machineRules.G,fleet,{}).status,'unknown','missing score must not pass');
  assert.equal(evaluatePoint(m.machineRules.G,fleet,{lineOfSight:{status:'computed',rawScoresByCoefficient:{4:37},thresholdMargin:1}}).status,'unknown');
  assert.deepEqual(evaluatePoint(m.machineRules.G,fleet,{lineOfSight:{status:'computed',rawScoresByCoefficient:{4:38},thresholdMargin:1}}).destinations,['L']);
  for(const speed of ['fastPlus','fastest'])assert.deepEqual(evaluatePoint(m.machineRules.C,referenceShips([2,2,3]),referenceMetrics(50,4,speed)).destinations,['E']);
  for(const [types,names,exit]of [
    [[22,21,1,1,1,2],[],'G'],[[22,1,1,1,1,7],['速吸','海防1','海防2','海防3','海防4','大鷹'],'G'],
    [[17,1,1,1,1,7],['あきつ丸改','海防1','海防2','海防3','海防4','大鷹'],'J'],
    [[22,21,1,1,1,3],[],'J'],[[22,1,1,1,2,2],[],'J']])
    assert.deepEqual(evaluatePoint(m.machineRules.E,referenceShips(types,names),{}).destinations,[exit]);
});

test('7-4 J escort shortcuts and M early exception follow the supplied rule priority',()=>{
  const m=require('../../../data/normal_routes/7-4.json');
  for(const [types,names,exit] of [
    [[1,1,1,1,1,1],[],'P'],[[2,1,1],[],'P'],[[7,1,1,1],['春日丸'],'P'],
    [[7,21,1,1,1],['八幡丸'],'P'],[[2,21,1,1,1],[],'P'],[[7,1,1,1],['神鷹'],'L'],
    [[21,1,1,1],[],'L'],[[2,2,1,1,1],[],'L']]){
    const ships=referenceShips(types,names);
    assert.deepEqual(evaluatePoint(m.machineRules.J,ships,referenceMetrics(37,4)).destinations,[exit]);
    assert.deepEqual(evaluatePoint(m.machineRules.J,ships,referenceMetrics(35,4)).destinations,['K',exit]);
    assert.deepEqual(evaluatePoint(m.machineRules.J,ships,referenceMetrics(90,4,'fast',['F'])).destinations,['K']);
  }
  const special=referenceShips([21,1,1,1,2]);
  for(const score of [0,46,56,57])assert.deepEqual(evaluatePoint(m.machineRules.M,special,referenceMetrics(score,4)).destinations,['P']);
  const ordinary=referenceShips([7,3,2,2,2,2]);
  for(const [score,exits]of [[44.999,['N']],[45,['N','O']],[46.999,['N','O']],[47,['O']],[56.999,['O']],[57,['P']]])
    assert.deepEqual(evaluatePoint(m.machineRules.M,ordinary,referenceMetrics(score,4)).destinations,exits);
  for(const types of [[9,2,2],[11,2,2],[18,2,2],[8,8,2,2],[10,10,2,2],[7,7,2,2],[16,16,2,2],[5,5,6,2,2],[3,2]])
    assert.deepEqual(evaluatePoint(m.machineRules.M,referenceShips(types),referenceMetrics(57,4)).destinations,['O']);
  assert.deepEqual(evaluatePoint(m.machineRules.M,referenceShips([8,10,7,2,2,2]),referenceMetrics(57,4)).destinations,['P'],'old combined-heavy shortcut is not in supplied table');
  assert.deepEqual(evaluatePoint(m.machineRules.K,ordinary,{}).destinations,['M']);
  assert.deepEqual(m.branchPoints.find(p=>p.from==='K').destinations,['M']);
});


test('4-5 K evaluates escort, submarine and LoS checks in order with conditional reference odds',()=>{
  const rules=require('../../../data/normal_routes/4-5.json').machineRules.K;
  for(const visited of [[],['E']])for(const escorts of [1,2])for(const hasSub of [false,true]){
    const types=[5,5,5,5,5,5];for(let i=0;i<escorts;i++)types[i]=i===0?1:2;if(hasSub)types[5]=13;
    for(const score of [59.999,60,69.999,70]){
      const fixedM=visited.length&&escorts===1,rolls=Number(!!visited.length)+Number(hasSub);
      const m=fixedM?1:1-.5**rolls,rest=1-m;
      const expected={};if(m)expected.M=m;
      if(rest){if(score<60)expected.L=rest;else if(score<70){expected.L=rest/2;expected.T=rest/2;}else expected.T=rest;}
      const r=evaluatePoint(rules,referenceShips(types),referenceMetrics(score,2,'fast',visited));
      const actual=r.status==='fixed'?{[r.destinations[0]]:1}:Object.fromEntries(r.probabilities.map(p=>[p.to,p.probability]));
      assert.deepEqual(actual,expected,JSON.stringify({visited,escorts,hasSub,score}));
      assert.equal(Object.values(actual).reduce((a,b)=>a+b,0),1);
    }
  }
  for(const types of [[10,10,10,11,2,2],[10,7,7,7,7,2]])
    assert.deepEqual(evaluatePoint(rules,referenceShips(types),referenceMetrics(0)).destinations,['M'],'heavy-fleet rules precede history and LoS');
  assert.deepEqual(evaluatePoint(rules,referenceShips([22,5,3,2,2,2]),referenceMetrics(0)).destinations,['L'],'supply ship alone no longer forces M');
});


test('4-5 complete supplied table preserves priority at E/G/H/M/O/R',()=>{
  const map=require('../../../data/normal_routes/4-5.json');
  const at=(p,types,speed='fast',visited=[])=>evaluatePoint(map.machineRules[p],referenceShips(types),referenceMetrics(100,2,speed,visited));
  for(const speed of ['fastPlus','fastest']){
    assert.deepEqual(at('E',[5,5,2,2],speed).destinations,['M']);
    assert.deepEqual(at('G',[9,9,11,11,2,2],speed).destinations,['H'],'speed bypasses heavy count');
    assert.deepEqual(at('H',[9,9,11,11,2,2],speed).destinations,['T']);
    assert.deepEqual(at('H',[9,9,11,11,7,2],speed).destinations,['K']);
  }
  assert.deepEqual(at('E',[22,5,2,2]).destinations,['M']);
  assert.deepEqual(at('E',[10,11,7,2,2]).destinations,['M']);
  assert.deepEqual(at('E',[3,1,2,5]).destinations,['M']);
  assert.deepEqual(at('E',[5,5,2,2]).destinations,['K']);
  assert.deepEqual(at('G',[9,9,11,11,2,2]).destinations,['D'],'heavy count precedes escorts');
  assert.deepEqual(at('G',[5,5,1,2]).destinations,['H']);
  assert.deepEqual(at('G',[5,5,3,2]).probabilities,[{to:'D',probability:.5},{to:'H',probability:.5}]);
  assert.deepEqual(at('H',[3,3,1,2,2,5]).destinations,['T'],'at least one CL, not exactly one');
  assert.deepEqual(at('H',[3,3,1,2,5,5],'fast',['F']).destinations,['T']);
  for(const visited of [[],['D']])assert.deepEqual(at('H',[3,3,1,2,5,5],'fast',visited).destinations,['K'],'F must be present');
  assert.deepEqual(at('M',[9,9,2],'fastest').destinations,['N'],'fastest precedes DD count');
  assert.deepEqual(at('M',[9,9,2],'fastPlus').destinations,['R'],'DD count precedes fast-plus');
  assert.deepEqual(at('M',[9,9,2,2],'slow').destinations,['R']);
  assert.deepEqual(at('M',[9,9,2,2],'fastPlus').destinations,['N']);
  assert.deepEqual(at('M',[9,3,2,2]).destinations,['N']);
  assert.deepEqual(at('M',[9,9,2,2]).destinations,['R']);
  assert.deepEqual(at('O',[6,5,2,2],'slow').destinations,['N']);
  for(const [types,speed]of [[[6,6,2,2],'slow'],[[9,9,11,11,7,2],'fast']])
    assert.deepEqual(at('O',types,speed).probabilities,[{to:'N',probability:.5},{to:'T',probability:.5}]);
  assert.deepEqual(at('R',[5,5,2],'fastPlus').destinations,['N']);
  assert.deepEqual(at('R',[16,5,2,2],'slow').destinations,['S']);
  assert.deepEqual(at('R',[16,5,2]).destinations,['S']);
  assert.deepEqual(at('R',[5,5,2,2]).destinations,['S']);
  for(const support of [3,6,16])assert.deepEqual(at('R',[support,5,2,2]).destinations,['N']);
});

test('4-5 Q uses 50/60 before heavy-count and DD gates, and reports the same LoS requirement',()=>{
  const rules=require('../../../data/normal_routes/4-5.json').machineRules.Q;
  for(const [types,exit]of [[[9,9,11,11,7,2],'O'],[[5,5,5,3,1,1],'O'],[[5,5,5,3,1,2],'N']]){
    const ships=referenceShips(types);
    for(const score of [49.999,50,59.999,60]){
      const r=evaluatePoint(rules,ships,referenceMetrics(score));
      assert.deepEqual(r.destinations,score<50?['P']:score<60?['P',exit]:[exit]);
      if(score>=50&&score<60)assert.deepEqual(r.probabilities.map(p=>p.probability),[.5,.5]);
    }
    const lowHq=referenceMetrics(60);lowHq.lineOfSight.thresholdMargin=1;
    assert.equal(evaluatePoint(rules,ships,lowHq).status,'unknown');
    lowHq.lineOfSight.rawScoresByCoefficient[2]=61;
    assert.deepEqual(evaluatePoint(rules,ships,lowHq).destinations,[exit]);
  }
  const metrics=referenceMetrics(59),route={area:'4-5',targetNodes:['T'],ships:referenceShips([9,9,5,5,2,2]),...metrics};
  const plan=require('../../../src/domain/routes/route_plans').planningPath(route,['A','B','E','K','M','R','S','Q','N','T']);
  const gate=plan.losRequirements.find(p=>p.from==='Q');assert.equal(gate.coefficient,2);assert.equal(gate.required,60);assert.equal(gate.score,59);
});

test('resolved-fleet reuse distinguishes loadouts and clears before later live state changes',()=>{
  const store=fixture(),{FleetPlanner}=require('../../../src/domain/fleet/fleet_plan'),{withEquipmentIndexCache}=require('../../../src/domain/fleet/equipment_planner');
  store.const.$equips[12]={api_name:'雷达',api_type:[0,0,12,12],api_saku:5};
  store.const.$shipTypes[3]={api_equip_type:{12:1}};
  store.info.equips[101]={api_slotitem_id:12,api_level:0,api_alv:0};
  const scheme={fleet:1,ships:[{id:1,slots:[-1],ex:'empty'}]};
  const preview=FleetPlanner.prototype.preview;let calls=0;
  FleetPlanner.prototype.preview=function(kind,...args){if(kind==='fleet')calls++;return preview.call(this,kind,...args);};
  try{
    withEquipmentIndexCache(store,()=>{
      const first=evaluateNormalRoute(store,{area:'2-3',scheme});
      const second=evaluateNormalRoute(store,{area:'2-3',scheme:structuredClone(scheme)});
      assert.deepEqual(first,second);assert.equal(calls,1);
      const equipped=evaluateNormalRoute(store,{area:'2-3',scheme:{fleet:1,ships:[{id:1,slots:[101],ex:'empty'}]}});
      assert.equal(calls,2);assert.equal(equipped.ships[0].radarEquipped,true);assert.equal(first.ships[0].radarEquipped,false);
    });
    store.info.repairs=[{api_ship_id:1}];
    assert.throws(()=>evaluateNormalRoute(store,{area:'2-3',scheme}),/repair/);
    assert.throws(()=>withEquipmentIndexCache(store,()=>evaluateNormalRoute(store,{area:'2-3',scheme})),/repair/);
    store.info.repairs=[];delete store.info.equips[101];
    assert.throws(()=>evaluateNormalRoute(store,{area:'2-3',scheme:{fleet:1,ships:[{id:1,slots:[101],ex:'empty'}]}}));
  }finally{FleetPlanner.prototype.preview=preview;}
});
