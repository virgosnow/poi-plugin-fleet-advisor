'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../../helpers/workbench_fixture');
const {routeOptions,pathChance,requirements}=require('../../../src/domain/routes/route_plans');
const {recommendNormalFleet}=require('../../../src/recommendation/index');
const {evaluateNormalRoute}=require('../../../src/domain/routes/normal_routes');
const {planningPath,possiblePoint}=require('../../../src/domain/routes/route_plans');
const {recommendNormalEquipment}=require('../../../src/recommendation/index');

test('fleet-size projection keeps equipment, speed, uncertain branches and alternative paths possible',()=>{
  const {routeFleetSizes}=require('../../../src/domain/routes/route_plans');
  assert.deepEqual(routeFleetSizes('1-1',routeOptions('1-1')),[1,2,3,4,5,6],'small-fleet preference is not a game rule');
  assert.deepEqual(routeFleetSizes('1-5',routeOptions('1-5')),[1,2,3,4]);
  assert.deepEqual(routeFleetSizes('1-2',routeOptions('1-2')),[1,2,3,4,5,6],'random entry and repairable speed keep other fleet sizes possible');
  assert.deepEqual(routeFleetSizes('4-5',routeOptions('4-5')),[1,2,3,4,5,6]);
  const paths=routeOptions('1-1'),withRequirement=when=>paths.map(p=>({...p,fleetRequirement:when}));
  assert.deepEqual(routeFleetSizes('1-1',withRequirement({all:[{shipCount:{max:4}},{los:{coefficient:4,gte:99}}]})),[1,2,3,4]);
  assert.deepEqual(routeFleetSizes('1-1',withRequirement({any:[{shipCount:{exact:3}},{not:{shipCount:{max:4}}}]})),[3,5,6]);
  assert.deepEqual(routeFleetSizes('1-1',withRequirement({count:{stypes:[2],min:4}})),[4,5,6]);
  assert.deepEqual(routeFleetSizes('1-1',withRequirement({not:{count:{stypes:[2],min:4}}})),[1,2,3,4,5,6]);
});

test('fleet-size pruning never removes a possible concrete hull across normal maps and phases',()=>{
  const fs=require('fs'),path=require('path'),P=require('../../../src/domain/routes/route_plans'),{predicate}=require('../../../src/domain/routes/normal_routes');
  let seed=28,checked=0;const next=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  for(const file of fs.readdirSync(path.join(__dirname,'../../../data/normal_routes')).filter(f=>/^\d-\d\.json$/.test(f))){
    const map=require('../../../data/normal_routes/'+file),area=map.area,target=map.bossNodes.length?'boss':map.terminalNodes[0];
    for(const phase of Object.keys(map.bossPhases||{}).length?Object.keys(map.bossPhases):[undefined]){
      const options=P.routeOptions(area,target,phase),sizes=P.routeFleetSizes(area,options,phase);
      for(let size=1;size<=6;size++)for(let sample=0;sample<20;sample++){
        const ships=Array.from({length:size},(_,i)=>({instanceId:i+1,name:['羽黒改二','神風改','足柄改二','测试舰'][next(4)],
          stype:1+next(22),radarEquipped:null,drumEquipped:null,landingCraftEquipped:null}));
        const route={area,phase,ships,targetNodes:options.map(o=>o.nodes.at(-1)),speed:{status:'unknown'}};
        const possible=options.some(o=>(!o.fleetRequirement||predicate(o.fleetRequirement,ships,{speed:route.speed,lineOfSight:{status:'unknown'}})!==false)&&
          P.optionPaths(o).some(nodes=>P.hullPath(route,nodes).max>0));
        if(possible){checked++;assert(sizes.includes(size),`${area} ${phase||''}: size ${size}`);}
      }
    }
  }
  assert(checked>1000);
});

test('size-limited hull enumeration keeps the original feasible beams and parallel merge',()=>{
  const P=require('../../../src/domain/routes/route_plans'),rows=Array.from({length:24},(_,i)=>({
    id:i+1,name:'舰'+i,stype:[1,2,3,7,11,16][i%6],power:100-i,ship:{api_soku:10}}));
  const ctx={fixed:[],roster:rows,byId:new Map(rows.map(r=>[r.id,r]))},routes=P.routeOptions('1-5');
  const full=P.hullSeeds(ctx,{area:'1-5',routes},r=>r.id),options={area:'1-5',routes,sizes:P.routeFleetSizes('1-5',routes)};
  const limited=P.hullSeeds(ctx,options,r=>r.id);
  assert.deepEqual(limited.rows,full.rows);assert.deepEqual(limited.baselineRows,full.baselineRows);
  assert(limited.attempted<full.attempted);
  const parts=Array.from({length:6},(_,index)=>P.hullSeeds(ctx,{...options,partial:true,shard:{index,count:6}},r=>r.id));
  assert.deepEqual(P.mergeHullParts(parts.reverse(),ctx.byId),limited);
});

test('lazy path assessment skips fixed edges and stops at blocked or zero-probability exits',()=>{
  const route={area:'1-1',targetNodes:['C']},nodes=['A','C','X'];
  for(const assessment of [
    {status:'fixed',destinations:['B']},
    {status:'random',destinations:['B','C'],probabilities:[{to:'B',probability:1},{to:'C',probability:0}]},
  ]){
    const calls=[];
    const result=pathChance(route,nodes,from=>{calls.push(from);assert.equal(from,'A');return assessment;});
    assert.deepEqual(result,pathChance({...route,pointAssessments:[{from:'A',assessment}]},nodes));
    assert.deepEqual(result,{min:0,max:0,probability:0});assert.deepEqual(calls,['A']);
  }
  assert.deepEqual(pathChance(route,['B'],()=>assert.fail('fixed start cannot resolve a rule')),{min:0,max:0,probability:0});
});

test('lazy paths preserve unresolved equipment conditions and explicit player choices',()=>{
  for(const assessment of [
    null,
    {status:'unknown',possibleDestinations:['B','C']},
    {status:'unknown',destinations:['B','C'],reason:'能动分歧'},
    {status:'random',destinations:['B','C'],referencePathProbability:.5},
  ]){
    const route={area:'1-1',targetNodes:['C'],pointAssessments:[{from:'A',assessment}]};
    assert.deepEqual(pathChance(route,['A','C'],()=>assessment),pathChance(route,['A','C']));
    assert(pathChance(route,['A','C'],()=>assessment).max>0);
  }
});

test('hard hull requirements reject only definite failures without pruning larger descendants',()=>{
  const {hullSeeds}=require('../../../src/domain/routes/route_plans');
  const rows=Array.from({length:6},(_,i)=>({id:i+1,name:'ship'+i,stype:2,power:100-i,ship:{api_soku:10}}));
  const ctx={fixed:[],roster:rows,byId:new Map(rows.map(r=>[r.id,r]))},base=routeOptions('1-1')[0];
  const run=fleetRequirement=>hullSeeds(ctx,{area:'1-1',routes:[{...base,fleetRequirement,templates:[{2:1}]}]},r=>r.id);
  const six=run({shipCount:{exact:6}});
  assert.equal(six.attempted,6);assert.equal(six.rows.length,1);assert.equal(six.rows[0].length,6);
  assert.equal(run({count:{stypes:[16],min:1}}).rows.length,0);
  assert.deepEqual(run({los:{coefficient:1,gte:100}}),run(undefined),'unknown gear can still be fitted; templates do not restrict hulls');
});

test('shared beam identities retain the route that first contributes a feasible hull',()=>{
  const {hullSeeds}=require('../../../src/domain/routes/route_plans'),base=routeOptions('1-1')[0];
  const rows=Array.from({length:6},(_,i)=>({id:i+1,name:'ship'+i,stype:2,power:100,ship:{api_soku:10}}));
  const result=hullSeeds({fixed:[],roster:rows,byId:new Map(rows.map(r=>[r.id,r]))},
    {area:'1-1',partial:true,routes:[{...base,fleetRequirement:{count:{stypes:[16],min:1}}},base]},r=>r.id);
  assert.equal(result.beams.length,6);
  assert(result.beams.every(beam=>beam.routeIndex===1));
  assert.deepEqual(result.beams.map(beam=>beam.order),[1,2,3,4,5,6]);
});

test('routing buckets retain combat hulls alongside level leaders without changing route feasibility',()=>{
  const {hullSeeds}=require('../../../src/domain/routes/route_plans');
  const rows=Array.from({length:10},(_,i)=>({id:i+1,name:'驱逐'+i,stype:2,power:10000-i*100,
    ship:{api_soku:10},combat:i<5?20:100+i}));
  const ctx={fixed:[],roster:rows,byId:new Map(rows.map(r=>[r.id,r]))},options={area:'1-2',routes:routeOptions('1-2','boss')};
  const before=JSON.stringify(rows),level=hullSeeds(ctx,options,r=>r.id);
  const combined=hullSeeds({...ctx,combatScore:r=>r.combat},options,r=>r.id);
  const keys=new Set(combined.rows.map(rs=>rs.map(r=>r.id).join(',')));
  for(const rs of level.rows)assert(keys.has(rs.map(r=>r.id).join(',')),'retain the level-based baseline');
  assert.deepEqual(combined.rows.slice(0,level.rows.length),level.rows,'bounded fitting retains the original beam order');
  assert(combined.rows.some(rs=>rs.length===5&&rs.every(r=>r.id>5)),'lower-level combat fleet must reach full fitting');
  assert.equal(combined.attempted,level.attempted);assert.equal(JSON.stringify(rows),before);
});

test('bounded hull ranking keeps earlier ties and family reuse stays within one search',()=>{
  const {hullSeeds}=require('../../../src/domain/routes/route_plans');
  const rows=[2,3,5,7,9,16,22,21].map((stype,i)=>({id:i+1,stype,name:'ship'+i,power:100,ship:{api_soku:10}}));
  const ctx={roster:rows,fixed:[],byId:new Map(rows.map(r=>[r.id,r])),combatScore:()=>100};
  const options={area:'2-3',routes:routeOptions('2-3')};let calls=0;
  const family=row=>{calls++;return row.family||row.id;};
  const result=hullSeeds(ctx,options,family);
  assert.equal(calls,rows.length);assert.equal(result.attempted,246);
  assert.deepEqual(result.rows.filter(rs=>rs.length===6).slice(0,12).map(rs=>rs.map(r=>r.id)),[
    [1,2,3,4,5,6],[1,2,3,4,5,7],[1,2,3,4,5,8],[1,2,3,4,6,7],
    [1,2,3,4,6,8],[1,2,3,4,7,8],[1,2,3,5,6,7],[1,2,3,5,6,8],
    [1,2,3,5,7,8],[1,2,3,6,7,8],[1,2,4,5,6,7],[1,2,4,5,6,8],
  ]);
  rows.forEach(row=>{row.family='same-remodel-family';});calls=0;
  const changed=hullSeeds({...ctx,fixed:[1]},options,family);
  assert.equal(calls,rows.length);assert(changed.rows.length>0);
  assert(changed.rows.every(rs=>rs.length===1),'do not reuse family identities across searches');
});

test('bounded hull search visits low-ranked historical routing ships before ordinary hulls exhaust its budget',()=>{
  const {hullSeeds}=require('../../../src/domain/routes/route_plans'),rows=[];
  for(let stype=1;stype<=22;stype++)for(const speed of [5,10])rows.push({
    id:rows.length+1,name:'普通'+rows.length,stype,power:10000-rows.length,ship:{api_soku:speed}});
  for(const [name,stype] of [['羽黒改二',5],['足柄改二',5],['神風',2]])rows.push({
    id:rows.length+1,name,stype,power:1,ship:{api_soku:10}});
  const before=JSON.stringify(rows),result=hullSeeds({fixed:[],roster:rows,byId:new Map(rows.map(r=>[r.id,r]))},
    {area:'7-3',phase:'gauge2',routes:routeOptions('7-3','boss','gauge2')},r=>r.id);
  assert.equal(result.truncated,true);
  assert(result.rows.some(ships=>ships.length<=4&&['羽黒改二','神風'].every(name=>ships.some(s=>s.name===name))));
  assert.equal(JSON.stringify(rows),before);
});

test('7-1 seeds the confirmed four-ship escort fleet below the destroyer level guideline',()=>{
  const store=fixture();
  for(const id of [3,4,5]){store.const.$ships[id].api_stype=1;store.info.ships[id].api_lv=45;}
  for(const id of [1,2,6,8])store.info.ships[id].api_lv=65;
  const result=recommendNormalFleet(store,{area:'7-1',});
  const found=result.routeResults.find(r=>r.key==='F>G>H>K');assert.equal(found.status,'available',found.message);
  assert.equal(found.chance.probability,1);
  const types=result.recommendations[found.recommendationIndex].scheme.ships.map(s=>store.const.$ships[store.info.ships[s.id].api_ship_id].api_stype);
  assert.equal(types.filter(t=>t===1).length,3);assert.equal(types.filter(t=>t===2).length,1);
});

function fastStrategyFixture(){
  const store=fixture();
  for(const [id,ship] of Object.entries(store.info.ships)){
    ship.api_slot=[-1,-1,-1];ship.api_onslot=[0,0,0];
    store.const.$ships[id].api_slot_num=3;store.const.$ships[id].api_maxeq=[0,0,0];
  }
  for(const stype of [1,2,3])store.const.$shipTypes[stype]={api_equip_type:{1:1,12:1,17:1}};
  for(const [id,type,name] of [[33,17,'改良型艦本式タービン'],[34,17,'強化型艦本式缶'],[27,12,'电探'],[1,1,'主炮']])
    store.const.$equips[id]={api_id:id,api_name:name,api_type:[0,0,type,0],api_houg:type===1?2:0,api_saku:type===12?5:0};
  let id=100;for(const masterId of [...Array(6).fill(33),...Array(6).fill(34),27,...Array(12).fill(1)])
    store.info.equips[id]={api_id:id++,api_slotitem_id:masterId,api_level:0};
  return store;
}

function speedFleetFixture(types){
  const store=fixture();store.info.equips={};
  for(const id of [7,8]){delete store.info.ships[id];delete store.const.$ships[id];}
  types.forEach((type,i)=>{
    const id=i+1,ship=store.info.ships[id],master=store.const.$ships[id];
    Object.assign(ship,{api_lv:99,api_slot:[-1,-1,-1,-1],api_slot_ex:-1,api_onslot:[24,24,24,24],api_sakuteki:[1000,1000]});
    Object.assign(master,{api_stype:type,api_slot_num:4,api_maxeq:[24,24,24,24],api_fuel_max:60,api_bull_max:60});
    store.const.$shipTypes[type]={api_equip_type:{1:1,2:1,3:1,6:1,7:1,8:1,10:1,12:1,17:1,18:1}};
  });
  store.const.$exslotEquips=[33];
  for(const [id,type,name,stats] of [[33,17,'改良型艦本式タービン',{}],[87,17,'新型高温高圧缶',{}],
    [27,12,'电探',{api_saku:8}],[1,1,'主炮',{api_houg:10}],
    [3,3,'大口径炮',{api_houg:20}],[20,6,'战斗机',{api_tyku:12}],
    [21,7,'攻击机',{api_raig:12,api_tyku:1}],[22,8,'轰炸机',{api_baku:12,api_tyku:1}],
    [25,10,'水侦',{api_saku:8}],[35,18,'三式弹',{api_tyku:5}]])
    store.const.$equips[id]={api_id:id,api_name:name,api_type:[0,0,type,0],...stats};
  let id=100;
  for(const masterId of [33,87,27,1,3,20,21,22,25,35])for(let i=0;i<18;i++)
    store.info.equips[id]={api_id:id++,api_slotitem_id:masterId,api_level:masterId===87?7:0,api_alv:7};
  return store;
}

// Guide examples must pass the authoritative branch order, not just exist in
// the map graph. High bare LoS isolates hull/name routing from equipment stock.
const backupExamples=[
  ['7-4',undefined,'A>B>E>J>P',[21,1,1,1,7],{5:'大鷹改二'}],
  ['7-4',undefined,'A>B>E>J>P',[21,1,1,1,2]],
  ['7-4',undefined,'C>E>J>L>P',[4,4,10,1,1,1]],
  ['5-2',undefined,'B>C>E>F>O',[9,9,11,18,5,6]],
  ['5-2',undefined,'B>C>D>F>O@shokaku-zuikaku',[11,18,8,8,2,2],{1:'翔鶴改二甲',2:'瑞鶴改二甲'}],
  ['5-2',undefined,'B>C>D>F>O@yubari',[3,7,7,5,5,6],{1:'夕張改二特'}],
  ['5-2',undefined,'B>C>D>F>O@shoho',[7,5,5,6,6,3],{1:'祥鳳改'}],
  ['7-3','gauge1','A>C>D>E',[5,3,2,2]],
  ['7-3','gauge1','A>B>C>E',[2,2,2,2],{1:'神風改'}],
  ['7-3','gauge1','A>B>C>E',[3,2]],
  ['4-4',undefined,'A>E>I>K@light-carriers',[7,7,7,3,2,2]],
  ['5-6','gauge2','I>J>K1>K>K2>L>N',[13,14,14,14,14,14]],
  ['7-5','gauge2','A>B>D>F>J>O>Q@battleship-light-carrier',[8,7,6,3,2,2]],
  ['3-5',undefined,'B>C>F>G>K@semi-lower',[3,3,4,13,14,14]],
  ['3-5',undefined,'B>C>F>G>K@semi-lower',[3,3,4,16,16,22]],
  ['6-4',undefined,'M>K>J>N',[9,11,17,3,2,2]],
  ['6-4',undefined,'M>K>J>I>N',[9,11,6,3,2,2]]
];
function backupFixture(types,names={}){
  const store=speedFleetFixture(types);
  for(const id of Object.keys(store.info.ships))if(Number(id)>types.length){delete store.info.ships[id];delete store.const.$ships[id];}
  for(const [id,name] of Object.entries(names))store.const.$ships[id].api_name=name;
  return store;
}
test('backup guide examples satisfy the current full path and declared fleet identity',()=>{
  const P=require('../../../src/domain/routes/route_plans');
  for(const [area,phase,key,types,names] of backupExamples){
    const store=backupFixture(types,names),options=routeOptions(area,'boss',phase),option=options.find(o=>o.key===key);
    assert(option,key);assert.equal(new Set(options.map(o=>o.key)).size,options.length);
    const route=evaluateNormalRoute(store,{area,phase,scheme:{fleet:1,ships:types.map((_,i)=>i+1)}});
    assert(P.fleetRequirementAssessment(route,option).eligible,area+' '+key);
    assert.equal(P.planningPath(route,option.nodes).chance.probability,1,area+' '+key);
    assert.equal(P.fleetRequirementAssessment({ships:[]},option).eligible,false);
  }
});
test('backup fleet searches and manual equipment updates preserve selected paths and fixed ships',()=>{
  const P=require('../../../src/domain/routes/route_plans');
  for(const area of ['7-4','5-2','7-3','3-5','5-6']){
    const [,phase,key,types,names]=backupExamples.find(c=>c[0]===area),store=backupFixture(types,names),before=JSON.stringify(store);
    const fixedShipIds=Object.keys(store.info.ships).map(Number);
    const result=recommendNormalFleet(store,{area,phase,fixedShipIds,automaticFilters:{maxRoutes:20}});
    const found=result.routeResults.find(r=>r.key===key);assert.equal(found.status,'available',area+': '+found.message);
    const row=result.recommendations[found.recommendationIndex];
    assert.deepEqual(row.scheme.ships.map(s=>s.id),fixedShipIds);
    assert.equal(found.chance.probability,1);
    const manual=recommendNormalEquipment(store,{area,phase,routeKey:key,scheme:row.scheme});
    const updated=evaluateNormalRoute(store,{area,phase,scheme:manual.scheme});
    assert(P.fleetRequirementAssessment(updated,found).eligible);
    assert.equal(P.planningPath(updated,found.nodes).chance.probability,1);
    assert.equal(JSON.stringify(store),before);
  }
});
test('backup guides reject old examples contradicted by the current NGA rules',()=>{
  const P=require('../../../src/domain/routes/route_plans');
  for(const [area,phase,key,types,names] of [
    ['7-4',undefined,'A>B>E>J>P',[21,1,1,1,1]],
    ['7-4',undefined,'A>B>E>J>P',[21,1,1,1,7]],
    ['7-3','gauge1','A>B>C>E',[2,2,2,2]]
  ]){
    const store=backupFixture(types,names),option=routeOptions(area,'boss',phase).find(o=>o.key===key);
    const route=evaluateNormalRoute(store,{area,phase,scheme:{fleet:1,ships:types.map((_,i)=>i+1)}});
    assert.equal(P.fleetRequirementAssessment(route,option).eligible,false);
    assert.equal(P.planningPath(route,option.nodes).chance.probability,0);
  }
});

test('independent speed guides retain real paths, strict thresholds and generic arrival labels',()=>{
  const P=require('../../../src/domain/routes/route_plans'),W=require('../../../src/ui/workbench/workbench_model');
  const cases=[['3-2',undefined,'fastest',[3,2,2,2,2,2]],['3-4',undefined,'fastPlus',[11,18,7,3,2,2]],
    ['4-5',undefined,'fastPlus',[8,11,11,18,6,6]],['5-1',undefined,'fastPlus',[8,8,8,6,6,3]],
    ['5-4',undefined,'fastPlus',[8,8,11,18,6,6]],['5-5',undefined,'fastPlus',[8,8,11,18,11,6]],
    ['5-6','gauge3','fastPlus',[8,8,11,18,11,18]],
    ...['gauge1','gauge2','gauge3'].map(p=>['7-5',p,'fastest',[8,8,11,18,6,6]])];
  for(const [area,phase,wanted,types] of cases){
    const options=routeOptions(area,'boss',phase),option=options.find(o=>o.key.endsWith('@'+wanted));assert(option,area);
    assert.equal(new Set(options.map(o=>o.key)).size,options.length,'same-path strategies need unique keys');
    const store=speedFleetFixture(types),route=evaluateNormalRoute(store,{area,phase,scheme:{fleet:1,ships:[1,2,3,4,5,6]}});
    route.speed={status:'observed',fleetSpeed:wanted,ships:types.map((_,i)=>({shipId:i+1,status:'observed',speed:wanted}))};
    route.ships.forEach(s=>{s.radarEquipped=true;});
    assert.equal(P.fleetRequirementAssessment(route,option).eligible,true,area);
    assert.equal(P.strategyAssessment(route,option).eligible,true,area+' '+phase);
    const ordinary={...route,speed:{status:'observed',fleetSpeed:wanted==='fastest'?'fastPlus':'fast'}};
    assert.equal(P.strategyAssessment(ordinary,option).eligible,false,area+' may not downgrade');
    assert(P.routeDiagnostics(ordinary,option).warnings.some(s=>s.includes('速力要求')));
    const overview=W.mapOverview(area,'boss',phase,{maxRoutes:20}),profile=W.selectedMapProfile(overview,option.key);
    assert.deepEqual(profile.highlightPaths,option.strategy.paths);
    assert.equal(W.routeArrival({route},option,true).value,'固定到达');
    if(area!=='3-2')assert(!W.routeArrival({route},option,true).note.includes('两战'));
  }
});

test('heavy fast-plus and fastest guides allocate unique engines and retain air fitting',()=>{
  for(const [area,phase,wanted,types] of [['4-5',undefined,'fastPlus',[8,11,11,18,6,6]],
    ['5-6','gauge3','fastPlus',[8,8,11,18,11,18]],['7-5','gauge3','fastest',[8,8,11,18,6,6]]]){
    const store=speedFleetFixture(types),before=JSON.stringify(store),option=routeOptions(area,'boss',phase).find(o=>o.key.endsWith('@'+wanted));
    const result=recommendNormalFleet(store,{area,phase,airGoal:'superiority',fixedShipIds:[1,2,3,4,5,6],automaticFilters:{maxRoutes:20}});
    const found=result.routeResults.find(r=>r.key===option.key);assert.equal(found.status,'available',area+': '+found.message);
    const row=result.recommendations[found.recommendationIndex];
    assert.equal(row.route.speed.fleetSpeed,wanted);assert.equal(found.chance.probability,1);
    const ids=row.scheme.ships.flatMap(s=>s.slots.concat(s.ex)).filter(id=>id>0);assert.equal(ids.length,new Set(ids).size);
    const manual=recommendNormalEquipment(store,{area,phase,routeKey:option.key,scheme:row.scheme});
    assert.equal(evaluateNormalRoute(store,{area,phase,scheme:manual.scheme}).speed.fleetSpeed,wanted);
    assert.equal(JSON.stringify(store),before);
    if(area==='4-5')assert(row.scores.airGoalTier>=2,'air fitting still works after propulsion allocation');
  }
});

test('speed strategies reject locked propulsion slots and ships unable to reach fastest',()=>{
  const store=speedFleetFixture([8,11,11,18,6,6]);
  const gun=Object.values(store.info.equips).filter(e=>e.api_slotitem_id===3).slice(0,4).map(e=>e.api_id);
  const heldSlots=[{id:1,slots:gun,ex:-1,keep:{0:true,1:true,2:true,3:true,ex:true}}],before=JSON.stringify(heldSlots);
  const result=recommendNormalFleet(store,{area:'4-5',fixedShipIds:[1,2,3,4,5,6],heldSlots});
  const failed=result.routeResults.find(r=>r.key.endsWith('@fastPlus'));
  assert.equal(failed.status,'notFound');assert.match(failed.message,/测试舰1/);
  assert.equal(JSON.stringify(heldSlots),before);
  store.const.$ships[2].api_name='加賀改二';
  const option=routeOptions('7-5','boss','gauge3').find(o=>o.strategy);
  assert.throws(()=>recommendNormalEquipment(store,{area:'7-5',phase:'gauge3',routeKey:option.key,
    scheme:{fleet:1,ships:[1,2,3,4,5,6].map(id=>({id,slots:[-1,-1,-1,-1],ex:-1}))}}),/最速.*加賀改二/);
});

test('3-2 speed strategy must fit a real six-ship fast-plus two-battle fleet',()=>{
  const store=fastStrategyFixture(),before=JSON.stringify(store),option=routeOptions('3-2')[0];
  const result=recommendNormalFleet(store,{area:'3-2',});
  const found=result.routeResults.find(r=>r.key===option.key);assert.equal(found.status,'available',found.message);
  const row=result.recommendations[found.recommendationIndex];
  assert.equal(row.scheme.ships.length,6);assert.equal(row.route.speed.fleetSpeed,'fastPlus');
  assert.equal(require('../../../src/domain/routes/route_plans').strategyAssessment(row.route,option).eligible,true);
  assert.equal(row.pathChance.probability,1);assert.equal(planningPath(row.route,option.nodes).chance.probability,.4);
  const ids=row.scheme.ships.flatMap(s=>s.slots.concat(s.ex)).filter(id=>id>0);assert.equal(ids.length,new Set(ids).size);
  assert.equal(JSON.stringify(store),before);
  const fitted=recommendNormalEquipment(store,{area:'3-2',routeKey:option.key,scheme:row.scheme});
  assert.equal(evaluateNormalRoute(store,{area:'3-2',scheme:fitted.scheme}).speed.fleetSpeed,'fastPlus');
  assert.equal(fitted.pathChance.probability,1);
  const W=require('../../../src/ui/workbench/workbench_model');
  const arrival=W.routeArrival({route:row.route},option,true);
  assert.equal(arrival.value,'固定到达');assert.equal(arrival.tone,'good');
  assert.match(arrival.note,/E 路 40%.*G 路 60%/);
  assert.deepEqual(W.selectedMapProfile(W.mapOverview('3-2'),option.key).highlightPaths,option.strategy.paths);
  const ordinary=evaluateNormalRoute(store,{area:'3-2',scheme:{fleet:1,ships:[1,2,3,4,5,6]}});
  assert.equal(W.routeArrival({route:ordinary},option,true).value,'流派条件未满足');
  assert.equal(W.routeArrival({route:row.route},option,false).value,'待核对编成');
});

test('3-2 mandatory speed fitting preserves manually held equipment and reports blocked slots',()=>{
  const store=fastStrategyFixture(),key=routeOptions('3-2')[0].key;
  const guns=Object.values(store.info.equips).filter(e=>e.api_slotitem_id===1).slice(0,3).map(e=>e.api_id);
  const heldSlots=[{id:1,slots:guns,ex:-1,keep:{0:true,1:true,2:true}}],before=JSON.stringify(heldSlots);
  const result=recommendNormalFleet(store,{area:'3-2',fixedShipIds:[1],heldSlots});
  const failed=result.routeResults.find(r=>r.key===key);
  assert.equal(failed.status,'notFound');assert.match(failed.message,/测试舰1/);
  assert.equal(JSON.stringify(heldSlots),before);
});

test('threaded speed fitting preserves ordered candidates, held equipment and exact recommendations',async()=>{
  const {RecommendationPool}=require('../../../src/infrastructure/workers/recommendation_pool');
  const {recommendNormalFleetParallel}=require('../../../src/recommendation/index');
  for(const blocked of [false,true]){
    const store=fastStrategyFixture(),before=JSON.stringify(store);
    const guns=Object.values(store.info.equips).filter(e=>e.api_slotitem_id===1).slice(0,3).map(e=>e.api_id);
    const args={area:'3-2',fixedShipIds:[1],heldSlots:blocked?
      [{id:1,slots:guns,ex:-1,keep:{0:true,1:true,2:true}}]:[{id:1,slots:[guns[0]],keep:{0:true}}]};
    const expected=recommendNormalFleet(store,args),pool=new RecommendationPool(store,{size:6}),kinds=[];
    try{
      const result=await recommendNormalFleetParallel(store,args,(batch,fallback)=>{
        kinds.push(batch.kind);return pool.run(batch,fallback);
      });
      assert.deepEqual(result,expected);assert.equal(JSON.stringify(store),before);
      assert(kinds.includes('speed-fit'));assert(kinds.includes('speed-refit'));
      const speed=result.routeResults.find(r=>r.key===routeOptions('3-2')[0].key);
      assert.equal(speed.status,blocked?'notFound':'available');
    }finally{await pool.dispose();}
  }
});

test('3-2 speed strategy reports missing engines and incompatible fixed hulls instead of ordinary-speed fallback',()=>{
  const store=fastStrategyFixture(),key=routeOptions('3-2')[0].key;
  for(const [id,item] of Object.entries(store.info.equips))if(item.api_slotitem_id===33)delete store.info.equips[id];
  let result=recommendNormalFleet(store,{area:'3-2',}),failed=result.routeResults.find(r=>r.key===key);
  assert.equal(failed.status,'notFound');assert.match(failed.message,/涡轮 0/);assert.match(failed.message,/不会降级/);
  assert(!result.recommendations.some(r=>r.routeKey===key));
  const other=fastStrategyFixture();other.const.$ships[2].api_name='Samuel B.Roberts';other.const.$ships[2].api_soku=5;
  other.info.ships[2].api_soku=5;other.info.ships[2].api_slot=[-1,-1];other.const.$ships[2].api_slot_num=2;
  result=recommendNormalFleet(other,{area:'3-2',fixedShipIds:[2]});failed=result.routeResults.find(r=>r.key===key);
  assert.equal(failed.status,'notFound');assert.match(failed.message,/Samuel B\.Roberts/);
  const scheme={fleet:1,ships:[1,2,3,4,5,6].map(id=>({id,slots:other.info.ships[id].api_slot.slice(),ex:-1}))};
  assert.throws(()=>recommendNormalEquipment(other,{area:'3-2',routeKey:key,scheme}),/Samuel B\.Roberts/);
});

test('route details preserve nested alternatives and highlight only the first matching rule',()=>{
  const {requirementDetails}=require('../../../src/domain/routes/route_plans');
  const route={area:'5-2',ships:Array.from({length:6},()=>({stype:2,name:'驱逐'})),
    speed:{status:'observed',fleetSpeed:'fast'},lineOfSight:{status:'computed',rawScoresByCoefficient:{2:100}}};
  const details=requirementDetails('5-2',['B','C','D','F','O'],null,route);
  const d=details.find(p=>p.from==='D'),f=details.find(p=>p.from==='F');
  assert.equal(d.rules[0].conditionTree.operator,'all');
  assert.equal(d.rules[0].conditionTree.children[3].operator,'any');
  assert.equal(d.rules[0].conditionTree.children[3].children.length,2);
  assert.deepEqual(d.rules.map(r=>r.state),['unmatched','unmatched','unmatched','unmatched','unmatched','matched']);
  assert.deepEqual(f.rules.map(r=>r.state),['unmatched','unmatched','matched','inactive','inactive']);
  assert.match(f.rules[1].condition,/≥ 63 且 < 70.*否则继续判断/);
  assert.equal(f.rules[2].offRoute,false);
  route.ships=[7,3,2,2,5,5].map((stype,i)=>({stype,name:['祥鳳','夕張'][i]||'其他'}));
  const matched=requirementDetails('5-2',['B','C','D','F','O'],null,route).find(p=>p.from==='D');
  assert.equal(matched.rules[0].state,'matched');assert.equal(matched.rules[1].state,'inactive');
  assert.equal(matched.rules[0].conditionTree.children[3].children.filter(c=>c.met===true).length,1);
});

test('route detail highlights distinguish missing evidence, estimates, stale drafts and wrong exits',()=>{
  const {requirementDetails}=require('../../../src/domain/routes/route_plans'),nodes=['B','C','D','F','O'];
  const route={area:'5-2',ships:Array.from({length:6},()=>({stype:2})),speed:{status:'unknown'},lineOfSight:{status:'unknown'}};
  const gate=()=>requirementDetails('5-2',nodes,null,route).find(p=>p.from==='F').rules;
  assert.deepEqual(gate().map(r=>r.state),['pending','inactive','inactive','inactive','inactive']);
  assert(!gate().some(r=>r.active));
  route.lineOfSight={status:'estimate',rawScoresByCoefficient:{2:100},lowerBoundScoresByCoefficient:{2:50}};
  assert.equal(gate()[2].state,'estimated');
  const idle=requirementDetails('5-2',nodes,null,null);
  assert(idle.every(p=>p.rules.every(r=>r.state==='idle'&&!r.active)));
  route.lineOfSight.status='computed';route.ships=Array.from({length:6},()=>({stype:9}));
  assert.equal(gate()[3].state,'matched');assert.equal(gate()[3].offRoute,true);
});
test('path probability multiplies exact branch odds instead of borrowing total boss arrival',()=>{
  const route={area:'2-2',targetNodes:['K'],pointAssessments:[
    {from:'C',assessment:{status:'random',destinations:['D','E'],probabilities:[{to:'D',probability:.5},{to:'E',probability:.5}]}},
    {from:'E',assessment:{status:'random',destinations:['G','K'],probabilities:[{to:'G',probability:.3},{to:'K',probability:.7}]}}]};
  assert.equal(pathChance(route,['C','E','K']).probability,.35);
  route.pointAssessments[1].assessment={status:'fixed',destinations:['G']};
  assert.equal(pathChance(route,['C','E','K']).probability,0);
  route.pointAssessments[1].assessment={status:'random',destinations:['G','K']};
  assert.deepEqual(pathChance(route,['C','E','K']),{min:.25,max:.25,probability:.25});
  route.pointAssessments[1].assessment=require('../../../src/domain/routes/normal_routes').evaluatePoint([{when:true,tentative:true,uncertain:true,choices:[{to:'G',weight:.3},{to:'K',weight:.7}]}],[],{});
  assert.equal(pathChance(route,['C','E','K']).probability,.35);
});
test('one-one percentages change with actual ship count, never claim fixed arrival',()=>{
  const store=fixture();
  for(const [count,chance] of [[1,.8],[2,.75],[6,.55]]){
    const route=evaluateNormalRoute(store,{area:'1-1',scheme:{fleet:1,ships:Array.from({length:count},(_,i)=>({id:i+1}))}});
    assert.equal(pathChance(route,['A','C']).probability,chance);
  }
});

test('only explicit player-controlled exits bypass probability uncertainty',()=>{
  const {isPlayerChoice}=require('../../../src/domain/routes/route_plans'),{evaluatePoint}=require('../../../src/domain/routes/normal_routes');
  let checked=0;
  for(const area of ['4-5','5-3','5-5','6-3','7-4','7-5']){
    const map=require(`../../../data/normal_routes/${area}.json`);
    for(const rules of Object.values(map.machineRules))for(const rule of rules){
      if(!/能動分岐/.test(rule.note||''))continue;
      assert(isPlayerChoice(evaluatePoint([rule],[],{})),area);checked++;
    }
  }
  assert.equal(checked,10);
  const route={area:'6-3',targetNodes:['C'],pointAssessments:[{from:'A',assessment:{
    status:'unknown',destinations:['B','C'],reason:'能動分岐（出撃者の選択）'}}]};
  assert.equal(pathChance(route,['A','C']).probability,1);
  assert.equal(pathChance(route,['A','J']).probability,0,'player choice cannot invent an exit');
  route.pointAssessments[0].assessment.reason='出口尚未确认';
  assert.equal(pathChance(route,['A','C']).probability,null);
  route.pointAssessments[0].assessment.reason='能動分岐';route.pointAssessments[0].assessment.tentative=true;
  assert.equal(pathChance(route,['A','C']).probability,null);
});

test('route details guide explicit player choices without requiring or matching a fleet',()=>{
  const {requirementDetails}=require('../../../src/domain/routes/route_plans');
  let checked=0;
  for(const area of ['4-5','5-3','5-5','6-3','7-4','7-5']){
    const map=require(`../../../data/normal_routes/${area}.json`);
    for(const [from,rules] of Object.entries(map.machineRules))for(const rule of rules){
      if(!/能動分岐/.test(rule.note||''))continue;
      for(const {to} of rule.choices){
        const detail=requirementDetails(area,[from,to],null,null).find(p=>p.from===from);
        assert.equal(detail.playerChoice,true,`${area} ${from}→${to}`);
        assert.deepEqual(detail.rules,[],'manual choices are not matching rules');
      }
      checked++;
    }
  }
  assert.equal(checked,10);
  const ordinary=requirementDetails('5-3',['D','G','I','O','K','E','Q'],null,null);
  assert(ordinary.filter(p=>p.from!=='O').every(p=>!p.playerChoice&&p.rules.length));
  const invalid=requirementDetails('5-3',['O','Z'],null,null).find(p=>p.from==='O');
  assert.equal(invalid.playerChoice,false,'do not instruct an exit the player cannot select');
});
test('route search covers each displayed path, retains missing options and respects fixed/excluded ships',()=>{
  const store=fixture(),before=JSON.stringify(store);
  const result=recommendNormalFleet(store,{area:'1-2',fixedShipIds:[1],excludedShipIds:[2]});
  assert.deepEqual(result.routeResults.map(r=>r.key),routeOptions('1-2').map(r=>r.key));
  assert(result.recommendations.length);
  for(const row of result.recommendations){
    assert(row.scheme.ships.some(s=>s.id===1));assert(!row.scheme.ships.some(s=>s.id===2));
    assert(row.profile.routePaths.some(p=>p.nodes.join('>')===row.selectedPath.join('>')));
    assert.deepEqual(row.pathChance,pathChance(row.route,row.selectedPath));
    assert.deepEqual(row.scores.routeAirReference.nodes.map(n=>n.id),row.selectedPath);
    assert.equal(row.scores.routeAirReference.scope,'selectedRoute');
  }
  const locked=recommendNormalFleet(store,{area:'3-5',fixedShipIds:[2,3,4,5,6,8]});
  assert.equal(locked.routeResults.find(r=>r.key==='upper').status,'notFound');
  assert.equal(locked.routeResults.find(r=>r.key==='upper').recommendationIndex,null);
  assert(locked.routeResults.find(r=>r.key==='upper').requirements.length);
  assert(locked.recommendations.every(r=>r.routeKey!=='upper'));
  assert.equal(JSON.stringify(store),before);
});
test('requirements expose ordered alternatives and ship type conditions, without inventing one mandatory template',()=>{
  const steps=requirements('2-2',['C','E','K']);
  assert(steps.find(s=>s.from==='C').rules.some(r=>r.condition.includes('水母')));
  assert(steps.find(s=>s.from==='E').rules.some(r=>r.condition.includes('高速')));
});
test('route search preserves held position and equipment while fitting coastal escorts for surface routes',()=>{
  const store=fixture();
  store.const.$ships[6].api_stype=16;store.const.$ships[8].api_stype=1;
  store.const.$equips[500]={api_id:500,api_name:'测试小口径主炮',api_type:[0,0,1,1],api_houg:8};
  for(const type of [1,2,3,16])store.const.$shipTypes[type]={api_equip_type:{1:1}};
  for(let id=101;id<121;id++)store.info.equips[id]={api_id:id,api_slotitem_id:500,api_level:0};
  const heldSlots=[null,{id:6,slots:[101,-1],ex:0,pin:true,keep:{0:true}}];
  const result=recommendNormalFleet(store,{area:'2-2',fixedShipIds:[6],heldSlots});
  const row=result.recommendations.find(r=>r.routeKey==='C>E>F>H>K');assert(row);
  assert.equal(row.scheme.ships[1].id,6);assert.equal(row.scheme.ships[1].slots[0],101);
  for(const id of [7,8])assert(row.scheme.ships.find(s=>s.id===id).slots.some(id=>id>0),'coastal escort gets a surface weapon');
  const all=row.scheme.ships.flatMap(s=>(s.slots||[]).concat(s.ex||0)).filter(id=>id>0);
  assert.equal(new Set(all).size,all.length);
});

test('unknown routing equipment does not admit exits blocked by higher priority hull rules',()=>{
  const rules=[{when:{drumCarriers:{min:2}},to:'B'},
    {when:{count:{groups:['carrier'],min:1}},to:'C'},{when:'otherwise',to:'D'}];
  assert.deepEqual(possiblePoint(rules,[{stype:11,drumEquipped:null}],{}).destinations,['B','C']);
});

function losFixture(){
  const store=fixture();store.info.basic.api_level=112;
  for(const [id,ship] of Object.entries(store.info.ships)){
    const m=store.const.$ships[id];m.api_slot_num=3;m.api_maxeq=[0,0,0];
    ship.api_slot=[-1,-1,-1];ship.api_onslot=[0,0,0];
    ship.api_sakuteki=[35,60];ship.api_lv=80;
  }
  store.const.$ships[7].api_stype=5;
  store.const.$equips[500]={api_id:500,api_name:'小口径主砲',api_type:[0,0,1,1],api_houg:5};
  store.const.$equips[501]={api_id:501,api_name:'水上電探',api_type:[0,0,13,13],api_saku:10};
  store.const.$equips[502]={api_id:502,api_name:'ドラム缶',api_type:[0,0,30,30]};
  for(const type of [1,2,3,5])store.const.$shipTypes[type]={api_equip_type:{1:1,13:1,30:1}};
  for(let id=101;id<=150;id++)store.info.equips[id]={api_id:id,api_slotitem_id:id<125?500:501,api_level:0};
  return store;
}

test('2-5 fits exact candidate LoS before selecting the lightweight north route',()=>{
  const store=losFixture(),before=JSON.stringify(store);
  // Strong wrong-route hulls must not displace the CL/DD solution.
  for(let id=20;id<28;id++){
    store.info.ships[id]={...store.info.ships[1],api_id:id,api_ship_id:id,api_lv:160};
    store.const.$ships[id]={...store.const.$ships[1],api_id:id,api_name:`大型舰${id}`,api_stype:9};
  }
  const result=recommendNormalFleet(store,{area:'2-5',});
  const row=result.recommendations.find(r=>r.routeKey==='B>F>E>I>O');assert(row);
  const p=planningPath(row.route,row.selectedPath);
  assert.equal(p.chance.min,1);assert.equal(p.losShortfall,0);
  assert(p.losRequirements.some(r=>r.coefficient===1&&r.required===35));
  assert.equal(row.route.lineOfSight.status,'computed');
  assert.equal(row.pathChance.probability,1,'confirmed candidate calculations should replace the old unknown recommendation probability');
  assert.equal(pathChance(row.route,row.selectedPath).probability,1,'the actual candidate outfit is now calculable');
  assert.equal(JSON.stringify(store.info.ships[1]),JSON.stringify(JSON.parse(before).info.ships[1]));
});

test('manual ship replacement equipment search uses the same LoS gate and keeps held slots',()=>{
  const store=losFixture(),scheme={fleet:1,ships:[1,2,3,4,5,7].map(id=>({id,slots:[101+id,-1,-1],ex:-1}))};
  const heldSlots=[null,{...scheme.ships[1],keep:{0:true}}],before=JSON.stringify(store);
  const row=recommendNormalEquipment(store,{scheme,area:'2-5',routeKey:'B>F>E>I>O',heldSlots});
  assert.deepEqual(row.scheme.ships.map(s=>s.id),scheme.ships.map(s=>s.id));
  assert.equal(row.scheme.ships[1].slots[0],103);
  const route=evaluateNormalRoute(store,{area:'2-5',scheme:row.scheme});
  const planning=planningPath(route,['B','F','E','I','O']);
  assert.equal(planning.chance.min,1);assert.equal(planning.losShortfall,0);
  assert.equal(JSON.stringify(store),before);
});

test('exact low-LoS hulls still get the bounded repair pass on routes with no routing equipment requirement',()=>{
  const store=losFixture(),ids=[1,2,3,4,5,6];store.info.basic.api_level=120;
  store.const.$equips[501].api_saku=2;
  const option=routeOptions('3-5').find(r=>r.key==='lower');assert(option);
  const initial=evaluateNormalRoute(store,{area:'3-5',scheme:{fleet:1,ships:ids}});
  assert.equal(initial.lineOfSight.status,'computed');
  assert.equal(require('../../../src/domain/routes/route_plans').routingNeeds(initial,option.nodes).length,0);
  const result=recommendNormalFleet(store,{area:'3-5',fixedShipIds:ids});
  const row=result.recommendations.find(r=>r.routeKey===option.key);assert(row,'a deficient initial outfit must remain repairable');
  assert.equal(row.pathChance.probability,1);assert(row.route.lineOfSight.rawScoresByCoefficient[4]>=28);
});

test('hull rules that bypass LoS never receive an unnecessary LoS requirement',()=>{
  const store=fixture();
  const route=evaluateNormalRoute(store,{area:'7-2',phase:'gauge1',scheme:{fleet:1,ships:[2,3,4].map(id=>({id}))}});
  assert.deepEqual(planningPath(route,['C','E','G']).losRequirements,[]);
});

test('reviewed contradictory paths cannot consume route choices',()=>{
  assert(!routeOptions('6-2').some(r=>r.key==='C>D>H>K'));
  assert(!routeOptions('7-2','boss','gauge2').some(r=>r.key.startsWith('C>D')));
  assert(!routeOptions('7-2','boss','gauge1').some(r=>r.key==='A>B>C>E>G'));
  assert(!routeOptions('7-4').some(r=>r.key==='C>E>G>L>P'||r.key==='C>E>J>P'));
  assert(routeOptions('6-2').some(r=>r.key==='C>E>J>K'),'fill the vacated choice with the next route');
});

test('routing gear and held slots satisfy the reference 2-5 final gate without disturbing held equipment',()=>{
  const store=losFixture(),ids=[1,2,3,4,5,7];
  ids.forEach((id,i)=>{store.const.$ships[id].api_stype=5;
    store.info.ships[id].api_slot=[125+i*3,126+i*3,127+i*3];});
  store.info.ships[1].api_soku=5;store.const.$ships[1].api_soku=5;
  for(const id of [200,201])store.info.equips[id]={api_id:id,api_slotitem_id:502,api_level:0};
  const heldSlots=[{id:1,slots:store.info.ships[1].api_slot.slice(),ex:-1,pin:true,keep:{0:true}}];
  const result=recommendNormalFleet(store,{area:'2-5',fixedShipIds:ids,heldSlots});
  const route=result.routeResults.find(r=>r.key==='B>F>J>O');
  assert.equal(route.status,'available');assert.equal(route.chance.probability,1);
  assert.equal(heldSlots[0].slots[0],125);
  const row=result.recommendations[route.recommendationIndex];
  assert.equal(row.scheme.ships.find(s=>s.id===1).slots[0],125);
});

test('speed fitting uses owned engines and respects expansion and held slots',()=>{
  const store=losFixture(),{speedLoadout}=require('../../../src/domain/routes/route_speed');
  for(const id of [33,34])store.const.$equips[id]={api_id:id,api_name:'機関',api_type:[6,31,17,19]};
  store.const.$shipTypes[2].api_equip_type[17]=1;
  const inventory=[];
  for(let id=200;id<204;id++){
    const masterId=id%2?34:33;store.info.equips[id]={api_id:id,api_slotitem_id:masterId,api_level:0};
    inventory.push({id,master:store.const.$equips[masterId]});
  }
  store.info.ships[2].api_slot_ex=-1;store.const.$exslotEquips=[17];
  const scheme={fleet:1,ships:[2,3].map(id=>({id,slots:[101+id,-1,-1],ex:-1}))};
  const hold=[{...scheme.ships[0],keep:{0:true}}],before=JSON.stringify(store);
  const fit=speedLoadout(store,scheme,inventory,'fastPlus',hold);assert(fit);
  assert.equal(fit.ships[0].slots[0],103);assert(fit.ships[0].ex>0);
  assert.equal(fit.ships[1].ex,-1,'closed expansion remains empty and previewable');
  const route=evaluateNormalRoute(store,{area:'1-1',scheme:fit});
  assert.equal(route.speed.fleetSpeed,'fastPlus');assert.equal(route.speed.status,'computed');
  const all=fit.ships.flatMap(s=>s.slots.concat(s.ex)).filter(id=>id>0);assert.equal(new Set(all).size,all.length);
  assert.equal(speedLoadout(store,scheme,inventory.slice(0,1),'fastPlus',hold),null);
  assert.equal(JSON.stringify(store),before);
});

test('speed fitting can use four engine slots and replace an unheld weaker boiler',()=>{
  const store=losFixture(),{speedLoadout}=require('../../../src/domain/routes/route_speed');
  for(const id of [33,34,87])store.const.$equips[id]={api_id:id,api_name:'機関',api_type:[6,31,17,19]};
  store.const.$shipTypes[2].api_equip_type[17]=1;
  Object.assign(store.info.ships[2],{api_slot:[-1,-1,-1],api_slot_ex:-1});
  store.const.$exslotEquips=[17];
  const inventory=[33,34,34,34].map((masterId,i)=>{const id=200+i;
    store.info.equips[id]={api_id:id,api_slotitem_id:masterId,api_level:0};return {id,master:store.const.$equips[masterId]};});
  const scheme={fleet:1,ships:[{id:2,slots:[-1,-1,-1],ex:-1}]};
  const fit=speedLoadout(store,scheme,inventory,'fastest');assert(fit,'three old boilers plus a turbine require four slots');
  assert.equal(evaluateNormalRoute(store,{area:'1-1',scheme:fit}).speed.fleetSpeed,'fastest');
  assert.equal(speedLoadout(store,scheme,inventory,'fastest',[{id:2,keep:{0:true}}]),null,'held slot may not be consumed');
  store.const.$ships[2].api_name='島風改';store.info.equips[204]={api_id:204,api_slotitem_id:87,api_level:0};
  const worn={fleet:1,ships:[{id:2,slots:[201,102,103],ex:200}]},held=[{id:2,keep:{1:true,2:true,ex:true}}];
  const upgraded=speedLoadout(store,worn,[{id:204,master:store.const.$equips[87]}],'fastest',held);assert(upgraded);
  assert.equal(upgraded.ships[0].slots[0],204,'unheld old boiler is replaced by a new boiler');
  assert.equal(speedLoadout(store,worn,[{id:204,master:store.const.$equips[87]}],'fastest',[{id:2,keep:{0:true,1:true,2:true,ex:true}}]),null);
});

test('guide routes take precedence, retain readable names and never pad the list to three',()=>{
  const catalog=require('../../../data/normal_route_guides.json').maps;
  const {previewForMap}=require('../../../src/domain/routes/sortie_profile');
  for(const [key,guide] of Object.entries(catalog)){
    const [area,phase]=key.split(':'),target=area==='1-6'?'N':'boss';
    const paths=previewForMap(area,{target,phase}).routePaths;
    assert(guide.routes.every(r=>require('../../../src/domain/routes/route_plans').optionPaths(r).every(nodes=>paths.some(p=>p.nodes.join('>')===nodes.join('>')))),key+' guide path must exist');
    const choices=routeOptions(area,target,phase);
    assert.deepEqual(choices.map(r=>r.nodes),guide.routes.map(r=>r.nodes),key);
    for(const [i,r]of choices.entries()){assert.equal(r.basis,'guide');assert.equal(r.source,guide.source);assert.equal(r.label,guide.routes[i].labelMode==='name'?r.name:`${r.name}（${r.strategy?.pathLabel||r.pathLabel||r.nodes.join('→')}）`);}
  }
  assert.deepEqual(routeOptions('2-5').map(r=>r.name),['下路空母流','上路大船流','上转下轻量流']);
  assert.equal(routeOptions('4-4').length,2);
  assert(routeOptions('5-5').some(r=>r.key==='B>F>D>H>N>O>S'));
  assert(!routeOptions('5-5').some(r=>r.key==='A>C>E>H>P>S'));
  assert.equal(routeOptions('1-1')[0].basis,'inferred');
  assert(routeOptions('1-1')[0].name);
  assert(routeOptions('7-2').every(r=>r.basis==='guide'),'unspecified phase also uses guide entries');
});

test('branching maps list every reviewed Boss path, without truncating guide or phase choices',()=>{
  const {previewForMap}=require('../../../src/domain/routes/sortie_profile');
  for(const [area,count]of [['1-4',4],['2-3',8]]){
    const options=routeOptions(area).filter(o=>area!=='1-4'||o.recommend===false);
    assert.equal(options.length,count);
    assert(options.every(o=>o.arrivalMode==='boss'));
    assert.deepEqual(options.flatMap(require('../../../src/domain/routes/route_plans').optionPaths).map(nodes=>nodes.join('>')).sort(),previewForMap(area).routePaths.map(p=>p.nodes.join('>')).sort());
    assert.equal(new Set(options.map(o=>o.key)).size,count);
  }
  assert.equal(routeOptions('7-2').length,5,'both stages retain all reviewed choices');
  assert.equal(routeOptions('1-1').length,1);
});

test('upper and lower names agree with the displayed map, including formerly inverted 2-3 labels',()=>{
  const catalog=require('../../../data/normal_route_guides.json').maps,layouts=require('../../../data/sortie/maps/index.json').maps;
  for(const [key,guide]of Object.entries(catalog)){
    const layout=layouts[key.split(':')[0]];
    for(const upper of guide.routes.filter(r=>/^(上路|北路)/.test(r.name)))
      for(const lower of guide.routes.filter(r=>/^(下路|南路)/.test(r.name))){
        const only=(a,b)=>a.nodes.filter(n=>!b.nodes.includes(n));
        const u=only(upper,lower),l=only(lower,upper);if(!u.length||!l.length)continue;
        const y=nodes=>nodes.reduce((s,n)=>s+layout.spots[n][1],0)/nodes.length;
        assert(y(u)<y(l),`${key} ${upper.name} must appear above ${lower.name}`);
      }
  }
  assert.equal(routeOptions('2-3').find(o=>o.key==='A>D>G>K>N').name,'下路水母流');
  assert.equal(routeOptions('2-3').find(o=>o.key==='C>F>J>N').name,'潜水舰队流');
  assert.equal(routeOptions('2-1').find(o=>o.key==='C>D>H').name,'下路迎击流');
});

test('normal route titles keep node references, fleet claims and stage labels consistent',()=>{
  const catalog=require('../../../data/normal_route_guides.json').maps;
  for(const [key,guide]of Object.entries(catalog)){
    for(const route of guide.routes){
      assert.match(route.name,/流$/,`${key}: ${route.name}`);
      assert.doesNotMatch(route.name,/阶段|另一出发|备选/);
      for(const match of route.name.matchAll(/([A-Z])点/g))
        assert(route.nodes.includes(match[1]),`${key}: named node must be on the route`);
    }
    const [area,phase]=key.split(':');
    const options=routeOptions(area,area==='1-6'?'N':'boss',phase);
    assert.equal(options.length,guide.routes.length,`${key}: every reviewed name is visible`);
    for(const [i,option]of options.entries())assert.equal(option.label,guide.routes[i].labelMode==='name'?option.name:`${option.name}（${option.strategy?.pathLabel||option.pathLabel||option.nodes.join('→')}）`);
  }
  // These paths accept other legal fleets: do not label them by one guide example.
  for(const [area,phase,key,forbidden]of [
    ['1-6',null,'C>H>K>M>J>D>N',/大船/],
    ['3-2',null,'C>G>H>F>L',/常速|水雷/],
    ['4-5',null,'C>D>H>T',/高速/],
    ['6-4',null,'A>D>C>F>N',/秋津洲/],
    ['7-3','gauge1','A>C>E',/史实/],
  ])assert.doesNotMatch(routeOptions(area,area==='1-6'?'N':'boss',phase).find(o=>o.key===key).name,forbidden);
  for(const area of ['7-2','7-3','7-5'])for(const option of routeOptions(area))
    assert.equal((option.label.match(/阶段/g)||[]).length,1);
  assert.equal(routeOptions('1-1')[0].name,'近海推进流');
});

test('retained guide hull and ship-count names reject fleets missing the named feature',()=>{
  const {fleetRequirementAssessment}=require('../../../src/domain/routes/route_plans');
  for(const [area,phase,key,valid,invalid]of [
    ['2-1',null,'C>E>H',[16,3,2,2,2,2],[3,3,2,2,2,2]],
    ['2-2',null,'C>E>K',[16,3,2,2,2,2],[3,3,2,2,2,2]],
    ['2-2',null,'C>E>F>H>K',[16,7,3,2,1,1],[16,7,3,2,2,2]],
    ['3-4',null,'A>C>E>G>J>P',[16,11,11,9,7,3],[22,11,11,9,7,3]],
    ['7-1',null,'D>E>G>H>K',[3,2,2,2,2],[3,2,2,2]],
    ['7-1',null,'F>G>H>K',[2,1,1,1],[2,1,1]],
    ['7-2','gauge1','C>E>G',[3,2,2,1],[3,2,2,2]],
    ...[['2-5','C>E>I>O'],['3-3','A>C>G>M'],['4-4','A>E>I>K'],['5-2','B>C>D>F>O'],['5-4','B>C>G>L>P'],['6-5','A>C>D>G>M']]
      .map(([area,key])=>[area,null,key,[11,3,2,2,2,2],[3,3,2,2,2,2]]),
    ...[['2-4','B>C>F>J>L>P'],['2-5','B>F>J>O'],['3-5','upper'],['5-5','B>K>P>S']]
      .map(([area,key])=>[area,null,key,[5,3,2,2,2,2],[3,3,2,2,2,2]]),
  ]){
    const option=routeOptions(area,'boss',phase).find(o=>o.key===key);
    const assess=stypes=>fleetRequirementAssessment({ships:stypes.map(stype=>({stype}))},option);
    assert(assess(valid).eligible,`${area}: ${option.name} accepts its feature`);
    assert(!assess(invalid).eligible,`${area}: ${option.name} rejects a missing feature`);
  }
});

test('branch arrival uses all exits of the same fleet, separately from the highlighted path',()=>{
  const W=require('../../../src/ui/workbench/workbench_model'),store=fixture();
  // AV+5DD: half enters F; F→J=.9, J miss=(1-.8)*(1-.65)=.07.
  for(const [area,expected,pathProbability]of [['1-4',1,.25],['2-3',1-.5*.9*.07,.175]]){
    if(area==='2-3')store.const.$ships[1].api_stype=16;
    const route=evaluateNormalRoute(store,{area,scheme:{fleet:1,ships:[1,2,3,4,5,6]}}),options=routeOptions(area).filter(o=>!o.key.includes('@'));
    assert(Math.abs(route.probability-expected)<1e-9);
    const sum=options.reduce((s,o)=>s+require('../../../src/domain/routes/route_plans').optionPlanning(route,o).chance.probability,0);
    assert(Math.abs(sum-expected)<1e-9);
    assert.equal(planningPath(route,options[0].nodes).chance.probability,pathProbability);
    const card=W.routeArrival({route},options[0],true);
    assert.equal(card.value,area==='1-4'?'固定到达':'到达概率 96.9%');
    assert.match(card.label,/含其他分支/);assert(card.note.includes(`${pathProbability*100}%`));
    assert.equal(W.routeArrival({route},options[0],false).value,'待核对编成');
    assert.equal(W.routeArrival({route:{...route,probability:null}},options[0],true).value,'到达率待确认');
    const blocked=options.find(o=>planningPath(route,o.nodes).chance.probability===0);
    assert.match(W.routeArrival({route},blocked,true).note,/无法走所选路线/);
  }
});

test('merged guides retain every branch, remove the redundant 3-2 row and count shared prefixes once',()=>{
  const P=require('../../../src/domain/routes/route_plans'),W=require('../../../src/ui/workbench/workbench_model');
  const options=routeOptions('3-2');assert.equal(options.length,3);
  assert.equal(options[0].name,'水雷提速流');assert(!options.some(o=>o.key==='C>G>F>L'));
  assert.deepEqual(P.optionPaths(options[0]),[[...'CEFL'],[...'CGFL']]);
  const store=backupFixture([16,3,2,2,2,2]);
  const route=evaluateNormalRoute(store,{area:'2-3',scheme:{fleet:1,ships:[1,2,3,4,5,6]}});
  const option=routeOptions('2-3')[0],grouped=P.optionPlanning(route,option);
  assert.equal(grouped.chance.probability,.5,'random start is shared, not multiplied twice or counted as certain');
  assert.equal(grouped.branches.length,2);
  assert.deepEqual(grouped.branches.map(b=>b.chance.probability),[.175,.325]);
  assert.deepEqual(P.optionPlanning(route,{...option,paths:[...option.paths,option.paths[0]]}).chance,grouped.chance,'deduplicate full journeys');
  const profile=W.selectedMapProfile(W.mapOverview('2-3'),option.key);
  assert.deepEqual(profile.highlightPaths,option.paths);assert.deepEqual(profile.examples,option.paths);
  assert(profile.threat.enemies.every(e=>e.nodes.every(n=>option.paths.some(p=>p.includes(n)))));
  const card=W.routeArrival({route},option,true);assert.match(card.note,/所选合流路线 50%/);
  assert.match(card.note,/A→D→G→I→K→N 32.5%/);
});

test('4-5 merged starts share fleet fitting, LoS gates, air reference and arrival status',()=>{
  const P=require('../../../src/domain/routes/route_plans'),W=require('../../../src/ui/workbench/workbench_model');
  const store=backupFixture([11,11,5,5,6,6]),ids=[1,2,3,4,5,6],before=JSON.stringify(store);
  const option=routeOptions('4-5').find(o=>o.key==='C>D>H>K>T');
  const result=recommendNormalFleet(store,{area:'4-5',fixedShipIds:ids});
  const found=result.routeResults.find(r=>r.key===option.key);assert.equal(found.status,'available',found.message);
  assert.equal(found.chance.probability,1);
  const row=result.recommendations[found.recommendationIndex],planned=P.optionPlanning(row.route,option);
  assert.deepEqual(planned.branches.map(b=>b.chance.probability),[.5,.5]);
  assert.equal(planned.losRequirements.filter(g=>g.from==='K').length,1,'shared LoS gate is not duplicated');
  assert.equal(W.routeArrival({route:row.route},option,true).value,'固定到达');
  assert.equal(P.routeDiagnostics(row.route,option).warnings.length,0);
  const profile=W.selectedMapProfile(W.mapOverview('4-5'),option.key,row.profile);
  const summary=W.fleetSummary({route:row.route,metrics:{lineOfSight:row.route.lineOfSight,airPower:row.route.airPower}},profile,option.paths);
  assert(summary.air.reference.nodes.some(n=>n.id==='K'||n.node==='K'));
  assert.match(summary.los.hint,/K→T/);assert(!summary.los.hint.includes('共 2 处'));
  const manual=recommendNormalEquipment(store,{area:'4-5',routeKey:option.key,scheme:row.scheme});
  assert.equal(manual.pathChance.probability,1);assert.deepEqual(manual.scheme.ships.map(s=>s.id),ids);
  assert.equal(JSON.stringify(store),before);
});

test('a merged group accepts a usable secondary path without diagnosing its impossible alternative',()=>{
  const P=require('../../../src/domain/routes/route_plans'),store=backupFixture([11,11,5,5,6,6]);
  const route=evaluateNormalRoute(store,{area:'2-3',scheme:{fleet:1,ships:[1,2,3,4,5,6]}});
  const original=routeOptions('2-3').find(o=>o.key==='A>D>F>G>K>N');
  const option={...original,nodes:original.paths[1],paths:original.paths.slice().reverse()};
  const planned=P.optionPlanning(route,option);
  assert.equal(planned.branches[0].chance.probability,0);
  assert(planned.branches[1].chance.probability>0);
  assert.deepEqual(planned.nodes,original.nodes);
  assert(!P.routeDiagnostics(route,option).points.some(p=>p.from==='G'&&p.to==='I'));
});

test('4-1 and 4-2 random starts recombine without changing one fleet or its arrival probability',()=>{
  const P=require('../../../src/domain/routes/route_plans'),W=require('../../../src/ui/workbench/workbench_model'),store=fixture();
  for(const area of ['4-1','4-2']){
    const option=routeOptions(area)[0],route=evaluateNormalRoute(store,{area,scheme:{fleet:1,ships:[1,2,3,4,5,6]}});
    const planned=P.optionPlanning(route,option);assert.equal(planned.branches.length,2);
    assert(planned.branches.every(b=>b.chance.probability>0&&b.chance.probability<1));
    assert.equal(planned.chance.probability,1);assert.equal(W.routeArrival({route},option,true).value,'固定到达');
    assert.deepEqual(W.selectedMapProfile(W.mapOverview(area),option.key).highlightPaths,option.paths);
  }
});

test('all-route diagnostics list later blockers too, with full LoS and hull conditions',()=>{
  const {routeDiagnostics}=require('../../../src/domain/routes/route_plans');
  const store=fixture(),route=evaluateNormalRoute(store,{area:'5-2',scheme:{fleet:1,ships:[2,3,4,5,6,8]}});
  const selected={nodes:['B','C','D','F','O']},d=routeDiagnostics(route,selected);
  assert.equal(d.chance.probability,0);assert.deepEqual(d.blocked.map(p=>p.from),['C','F']);
  assert(d.blocked[0].requirements.some(r=>r.condition.includes('空母')));
  assert(d.blocked[1].requirements.some(r=>r.condition.includes('≥ 70')));
  const display=require('../../../src/ui/workbench/workbench_model').routeArrival({route},selected,true);
  assert(display.warnings.some(w=>w.includes('C → D')));assert(display.warnings.some(w=>w.includes('F → O')));
});

test('phase-less route selection exposes and previews the correct 7-3 gauge',()=>{
  const W=require('../../../src/ui/workbench/workbench_model'),overview=W.mapOverview('7-3','boss',undefined,undefined,{info:{maps:{73:{api_gauge_num:2}}}});
  assert.deepEqual(overview.options.map(r=>r.phase),['gauge1','gauge2','gauge2','gauge2','gauge2']);
  for(const option of overview.options){
    const profile=W.selectedMapProfile(overview,option.key);
    assert(profile.routePaths.some(p=>p.nodes.join('>')===option.key));
    assert(profile.targetNodes.includes(option.nodes.at(-1)));
  }
});

test('7-3 Wiki backup fleets reach Boss without Kamikaze and retain their composition requirements',()=>{
  const {fleetRequirementAssessment}=require('../../../src/domain/routes/route_plans');
  const options=routeOptions('7-3','boss','gauge2');
  for(const [key,names,types] of [
    ['A>C>D>G>J>P',['羽黒改二','足柄改二','最上改二特','驱逐甲','驱逐乙','驱逐丙'],[5,5,6,2,2,2]],
    ['A>C>D>G>I>M>P',['羽黒改二','足柄改二','三隈改二特','驱逐甲','驱逐乙','驱逐丙'],[5,5,16,2,2,2]],
    ['A>C>I>L>M>P',['普通重巡','普通轻巡','驱逐甲','驱逐乙','驱逐丙'],[5,3,2,2,2]],
  ]){
    const option=options.find(o=>o.key===key);assert(option,key);
    const route={area:'7-3',phase:'gauge2',targetNodes:['P'],ships:types.map((stype,i)=>({stype,name:names[i],instanceId:i+1})),
      speed:{status:'observed',fleetSpeed:'fast'},lineOfSight:{status:'computed',rawScoresByCoefficient:{4:100}}};
    assert.equal(fleetRequirementAssessment(route,option).eligible,true,key);
    assert.equal(planningPath(route,option.nodes,{allowTentative:false}).chance.probability,1,key);
    assert.notEqual(planningPath({...route,speed:{status:'observed',fleetSpeed:'slow'}},option.nodes,{allowTentative:false}).chance.probability,1,`${key} requires fast fleet`);
    route.ships.at(-1).name='神風改';
    assert.equal(fleetRequirementAssessment(route,option).eligible,false,`${key} keeps its no-Kamikaze promise`);
  }
});

test('7-4 routing uses actual selected history, and 7-5 P uses the confirmed coefficient-four threshold',()=>{
  const {predicate}=require('../../../src/domain/routes/normal_routes');
  assert.equal(predicate({pathIncludes:'D'},[],{}),null);
  const ships=[10,7,3,2,2,2].map((stype,i)=>({stype,name:'测试',instanceId:i}));
  const route={area:'7-4',targetNodes:['P'],ships,lineOfSight:{status:'computed',rawScoresByCoefficient:{4:40}},speed:{status:'observed',fleetSpeed:'fast'}};
  const good=planningPath(route,['A','B','E','J','L','P'],{allowTentative:false});
  assert.equal(good.chance.probability,1);assert(good.losRequirements.some(r=>r.from==='J'&&r.required===37));
  assert.equal(planningPath(route,['C','D','F','J','L','P'],{allowTentative:false}).chance.probability,0);
  const map=require('../../../data/normal_routes/7-5.json'),{evaluatePoint}=require('../../../src/domain/routes/normal_routes');
  const metrics=score=>({speed:{status:'observed',fleetSpeed:'fast'},lineOfSight:{status:'computed',rawScoresByCoefficient:{4:score}}});
  const fleet=[5,3,2,2,2,2].map(stype=>({stype}));
  assert.deepEqual(evaluatePoint(map.machineRules.P,fleet,metrics(58)).destinations,['T']);
  assert.deepEqual(evaluatePoint(map.machineRules.P,fleet,metrics(55.9)).destinations,['S']);
  assert.equal(evaluatePoint(map.machineRules.P,fleet,metrics(57.9)).status,'random');
  assert.deepEqual(evaluatePoint(map.machineRules.P,fleet,metrics(57.9)).probabilities.map(p=>p.probability),[.5,.5]);
  assert.deepEqual(evaluatePoint(map.machineRules.P,[{stype:11},...fleet.slice(1)],metrics(63)).destinations,['R']);
  assert.equal(evaluatePoint(map.machineRules.P,fleet,{...metrics(63),lineOfSight:{status:'unknown'}}).status,'unknown');
});

test('7-3 named rules respect priority with second-stage D fixed to G',()=>{
  const {evaluatePoint}=require('../../../src/domain/routes/normal_routes'),m=require('../../../data/normal_routes/7-3.json');
  const fleet=[{stype:5,name:'羽黒改二'},{stype:2,name:'神風改'},{stype:5,name:'足柄改二'},{stype:2,name:'驱逐'},{stype:2,name:'驱逐'}];
  const metrics={speed:{status:'observed',fleetSpeed:'fast',ships:[]}};
  assert.deepEqual(evaluatePoint(m.machineRules['A#gauge2'],fleet,metrics).destinations,['C']);
  assert.deepEqual(evaluatePoint(m.machineRules['C#gauge2'],fleet,metrics).destinations,['I']);
  assert.deepEqual(evaluatePoint(m.machineRules['I#gauge2'],fleet,metrics).destinations,['M']);
  assert.equal(evaluatePoint(m.machineRules['D#gauge2'],fleet,metrics).status,'fixed');
  assert.deepEqual(evaluatePoint(m.machineRules['D#gauge2'],fleet,metrics).destinations,['G']);
  const carrier=[{stype:11,name:'空母'},...fleet];
  assert.deepEqual(evaluatePoint(m.machineRules['A#gauge2'],carrier,metrics).destinations,['B']);
});

test('fleet API plans explicit known stages and prioritizes confirmed route arrival',()=>{
  const store=fixture();
  for(const ship of Object.values(store.info.ships))ship.api_lv=90;
  for(const stype of [1,2,3])store.const.$shipTypes[stype]={api_equip_type:{1:1}};
  store.const.$equips[1]={api_id:1,api_name:'主炮',api_type:[0,0,1,0],api_houg:2};
  for(let id=100;id<116;id++)store.info.equips[id]={api_id:id,api_slotitem_id:1,api_level:0};
  const before=JSON.stringify(store);
  const staged=recommendNormalFleet(store,{area:'7-3'});
  assert(staged.recommendations.length>0);
  for(const row of staged.recommendations){
    assert(row.route.phase,'stages must be resolved before route evaluation');
    assert(planningPath(row.route,row.selectedPath,{allowTentative:false}).chance.probability>0);
  }
  const fixed=recommendNormalFleet(store,{area:'1-2'});
  assert(fixed.recommendations.length>0);
  for(const row of fixed.recommendations){
    assert.equal(row.pathChance.probability,1,'fixed route outranks the higher-power six-ship random start');
    assert.deepEqual(row.selectedPath,['A','E']);
    assert.equal(planningPath(row.route,row.selectedPath,{allowTentative:false}).chance.probability,1);
  }
  const random=recommendNormalFleet(store,{area:'1-1'});
  assert(random.recommendations.length>0);
  assert(random.recommendations.every(row=>row.pathChance.probability>0&&row.pathChance.probability<1));
  assert.equal(JSON.stringify(store),before);
});

test('equipment API without a route key requires confirmed complete-path evidence',()=>{
  const store=fixture(),scheme={fleet:1,ships:[1,2,3,4,5,6].map(id=>({id}))},before=JSON.stringify(store);
  assert.throws(()=>recommendNormalEquipment(store,{scheme,area:'7-3'}),e=>
    e.message.includes('到达率可确认')&&e.message.includes('A → C')&&e.message.includes('C → E'));
  const result=recommendNormalEquipment(store,{scheme,area:'1-1'});
  assert.deepEqual(result.selectedPath,['A','C']);assert.equal(result.pathChance.probability,.55);
  assert.deepEqual(result.scheme.ships.map(s=>s.id),scheme.ships.map(s=>s.id));
  assert.throws(()=>recommendNormalEquipment(store,{scheme,area:'1-1',routeKey:'A>B>C'}),/所选路线不存在/);
  assert.equal(JSON.stringify(store),before);
});

test('fleet and equipment searches fit a narrow LoS route after normal loadout completion',()=>{
  const store=losFixture(),ids=[1,2,3,4,5,6],types=[5,11,5,5,2,2];
  store.info.basic.api_level=120;store.const.$equips[501].api_saku=5;
  store.const.$shipTypes[11]={api_equip_type:{1:1,13:1,30:1}};
  ids.forEach((id,i)=>{store.const.$ships[id].api_stype=types[i];store.info.ships[id].api_sakuteki=[20,40];});
  const scheme={fleet:1,ships:ids.map((id,i)=>({id,slots:[125+i*3,126+i*3,127+i*3],ex:-1}))};
  const before=JSON.stringify(store),key='C>E>I>K',nodes=['C','E','I','K'];
  const fleet=recommendNormalFleet(store,{area:'6-2',fixedShipIds:ids});
  const choice=fleet.routeResults.find(r=>r.key===key);assert.equal(choice.status,'available');
  assert.equal(choice.chance.probability,1);
  const heldSlots=[{...scheme.ships[4],keep:{0:true}}];
  const equipped=recommendNormalEquipment(store,{scheme,area:'6-2',routeKey:key,heldSlots});
  assert.equal(equipped.scheme.ships[4].slots[0],scheme.ships[4].slots[0]);
  assert.deepEqual(equipped.scheme.ships.map(s=>s.id),ids);
  const route=evaluateNormalRoute(store,{area:'6-2',scheme:equipped.scheme});
  assert.equal(planningPath(route,nodes,{allowTentative:false}).chance.probability,1);
  const score=route.lineOfSight.rawScoresByCoefficient[3];assert(score>=40&&score<43);
  const equipmentIds=equipped.scheme.ships.flatMap(s=>s.slots.concat(s.ex)).filter(id=>id>0);
  assert.equal(equipmentIds.length,new Set(equipmentIds).size);
  assert.equal(JSON.stringify(store),before);
});

test('2-3 Wiki composition titles are enforced by fleet and equipment recommendations',()=>{
  const P=require('../../../src/domain/routes/route_plans'),W=require('../../../src/ui/workbench/workbench_model'),store=fixture();
  const selected=P.routeOptions('2-3').find(r=>r.key==='A>D>G>K>N');
  assert.equal(selected.name,'下路水母流');
  assert.equal(P.routeOptions('2-3').find(r=>r.key==='A>D>F>J>N').name,'D点转上流');
  const missing=recommendNormalFleet(store,{area:'2-3',});
  for(const row of missing.routeResults.filter(r=>r.name.includes('水母'))){
    assert.equal(row.status,'notFound');assert.match(row.message,/攻略编成要求.*水母至少 1 艘/);
  }
  const noWater=evaluateNormalRoute(store,{area:'2-3',scheme:{fleet:1,ships:[1,2,3,4,5,6]}});
  assert.equal(W.routeArrival({route:noWater},selected,true).value,'编成条件未满足');
  assert.throws(()=>recommendNormalEquipment(store,{area:'2-3',routeKey:selected.key,scheme:{fleet:1,ships:[1,2,3,4,5,6].map(id=>({id,slots:[-1,-1],ex:0}))}}),/攻略编成要求.*水母/);
  store.const.$ships[8].api_stype=16;
  const result=recommendNormalFleet(store,{area:'2-3',fixedShipIds:[1,2,3,4,5,8]});
  for(const route of result.routeResults.filter(r=>r.fleetRequirement)){
    assert.equal(route.status,'available');const row=result.recommendations[route.recommendationIndex];
    assert(P.fleetRequirementAssessment(row.route,route).eligible);
    if(route.name==='水母＋驱逐')assert(row.scheme.ships.some(s=>s.id===8));
  }
});

test('reference-note caching retains original policy and observes edited source text',()=>{
  const {effectiveRule}=require('../../../src/domain/routes/route_policy'),fs=require('fs'),path=require('path');
  const legacy=rule=>rule.conditionUnknown?{...rule,tentative:false,uncertain:true}:
    /能動分岐|能动分岐/.test(rule.note||'')?rule:{...rule,tentative:false,uncertain:false,
      ...(rule.assumedTo?{to:rule.assumedTo,choices:undefined}:{}),
      note:(rule.note||'').replace(/(\d(?:[\d.%~～/]+)?)[?？]/g,'$1').replace(/；?[^；。]*样本(?:不足|少)[^；。]*/g,'').replace(/（幅付きのため未確定）/g,'')};
  const rules=fs.readdirSync(path.join(__dirname,'../../../data/normal_routes')).filter(n=>/^\d-\d\.json$/.test(n)).flatMap(n=>Object.values(require('../../../data/normal_routes/'+n).machineRules||{}).flat());
  for(const rule of rules){const before=JSON.stringify(rule);assert.deepEqual(effectiveRule(rule),legacy(rule));assert.equal(JSON.stringify(rule),before);}
  const rule={when:true,to:'A',note:'概率40%？；样本不足。后文',tentative:true};
  assert.deepEqual(effectiveRule(rule),legacy(rule));rule.note='概率70%？';rule.to='B';
  assert.deepEqual(effectiveRule(rule),legacy(rule));
  for(let i=0;i<600;i++)effectiveRule({note:'概率'+i+'?'});
  assert.deepEqual(effectiveRule(rule),legacy(rule));
});

test('hull feasibility reuse preserves named routing ships, flagships and type-specific speed',()=>{
  const {hullSeeds}=require('../../../src/domain/routes/route_plans');
  const rows=[[3,'軽巡',10],[2,'神風改',10],[5,'羽黒改二',10],[5,'足柄改二',10],[2,'駆逐',5],[16,'水母',5],[3,'軽巡B',5],[7,'軽空母',10]].map(([stype,name,speed],i)=>({id:i+1,stype,name,power:100-i,ship:{api_soku:speed}}));
  for(const [area,phase]of [['2-3',undefined],['3-2',undefined],['7-3','gauge2']])for(const fixed of [[],[4,2],[2,4]]){
    const ctx={roster:rows,fixed,byId:new Map(rows.map(r=>[r.id,r]))};
    const options={area,phase,routes:routeOptions(area,'boss',phase)};
    assert.deepEqual(hullSeeds(ctx,options,r=>r.id),hullSeeds(ctx,{...options,reuseFacts:false},r=>r.id));
  }
});

test('LoS window probe skips only threshold reporting and preserves every path assessment',()=>{
  const store=fixture();
  for(const area of ['2-5','4-5','5-2','6-2','7-4']){
    const base=evaluateNormalRoute(store,{area,scheme:{fleet:1,ships:[1,2,3,4,5,6]}});
    for(const option of routeOptions(area))for(const score of [0,33,40,60,70,76,100]){
      const route={...base,lineOfSight:{status:'computed',rawScoresByCoefficient:{1:score,2:score,3:score,4:score},thresholdMargin:6}};
      const full=planningPath(route,option.nodes,{allowTentative:false});
      const probe=planningPath(route,option.nodes,{allowTentative:false,includeLosRequirements:false});
      assert.deepEqual(probe.chance,full.chance);assert.deepEqual(probe.pointAssessments,full.pointAssessments);
    }
  }
});

test('routing name requirements respect alternatives, phase and nameless fallbacks',()=>{
  const {namedShipRequirements}=require('../../../src/domain/routes/route_plans');
  const rows=namedShipRequirements('7-3',['A','C','D','G','P'],'gauge2');
  const g=rows.find(p=>p.from==='G');assert(g);
  assert(g.alternatives.every(a=>['羽黒','神風'].every(name=>a.some(r=>r.prefixes.includes(name)))));
  assert(!rows.some(p=>p.from==='A'),'A→C also has non-historical fleet alternatives');
  assert.deepEqual(namedShipRequirements('6-2',['C','E','I','K']),[]);
  const map=require('../../../data/normal_routes/7-3.json'),saved=map.machineRules['G#gauge2'];
  try{
    map.machineRules['G#gauge2']=[{when:{not:{shipName:{prefixes:['神風']}}},to:'P'}];
    assert.deepEqual(namedShipRequirements('7-3',['G','P'],'gauge2'),[]);
    map.machineRules['G#gauge2']=[{when:{any:[{shipName:{prefixes:['神風']}},{count:{stypes:[2],min:3}}]},to:'P'}];
    assert.deepEqual(namedShipRequirements('7-3',['G','P'],'gauge2'),[]);
    map.machineRules['G#gauge2']=[{when:{count:{prefixes:['神風'],stypes:[2],min:3}},to:'P'}];
    assert.deepEqual(namedShipRequirements('7-3',['G','P'],'gauge2'),[],'ship-type OR name counts do not force the named ship');
  }finally{map.machineRules['G#gauge2']=saved;}
});

test('unavailable historical routing ships appear in both API message and visible route warnings',()=>{
  const store=fixture();store.const.$ships[1].api_name='羽黒改二';store.const.$ships[1].api_stype=5;
  store.const.$ships[2].api_name='神風';store.const.$ships[2].api_aftershipid='99';
  store.const.$ships[99]={...store.const.$ships[2],api_id:99,api_name:'神風改',api_aftershipid:0};
  const before=JSON.stringify(store),key='A>C>D>G>P';
  const r=recommendNormalFleet(store,{area:'7-3',phase:'gauge2',});
  const selected=r.routeResults.find(r=>r.key===key);
  assert.equal(selected.status,'notFound');
  assert.match(selected.message,/神風 Lv.50 已持有.*出击设置「未改造」/);
  assert.match(selected.diagnostics.warnings[0],/G → P.*神風/);
  assert.equal(selected.diagnostics.briefWarnings[0],'G → P：神風 Lv.50（未改造，已排除）');
  assert.equal(JSON.stringify(store),before);
  delete store.info.ships[2];
  const absent=recommendNormalFleet(store,{area:'7-3',phase:'gauge2',}).routeResults.find(r=>r.key===key);
  assert.match(absent.message,/神風：未持有/);
});

test('interleaved hull shards preserve the global truncated DFS prefix',()=>{
  const P=require('../../../src/domain/routes/route_plans'),rows=[];
  for(let stype=1;stype<=22;stype++)for(const speed of [5,10])rows.push({id:rows.length+1,name:'ship'+rows.length,stype,power:10000-rows.length,ship:{api_soku:speed}});
  for(const [name,stype] of [['羽黒改二',5],['足柄改二',5],['神風',2]])rows.push({id:rows.length+1,name,stype,power:1,ship:{api_soku:10}});
  const ctx={fixed:[],roster:rows,byId:new Map(rows.map(r=>[r.id,r])),combatScore:r=>r.id},options={area:'7-3',phase:'gauge2',routes:P.routeOptions('7-3','boss','gauge2')};
  const expected=P.hullSeeds(ctx,options,r=>r.id);assert.equal(expected.truncated,true);assert.equal(expected.attempted,180001);
  const parts=[5,1,4,0,3,2].map(index=>P.hullSeeds(ctx,{...options,shard:{index,count:6},partial:true},r=>r.id));
  assert.deepEqual(P.mergeHullParts(parts,ctx.byId),expected);
});

test('interleaved shards retain serial beam order, stable ties, duplicate combat hulls and fixed flagship',()=>{
  const P=require('../../../src/domain/routes/route_plans');
  const rows=Array.from({length:28},(_,i)=>({id:i+1,name:'ship'+i,stype:[2,3,5,6,7,11,16][i%7],
    power:100-Math.floor(i/14),ship:{api_soku:i%2?10:5}}));
  for(const fixed of [[],[1],[1,2,3,4,5,6]]){
    const ctx={roster:rows,fixed,byId:new Map(rows.map(r=>[r.id,r])),combatScore:r=>r.id%3},
      options={area:'2-3',routes:P.routeOptions('2-3','boss')};
    const serial=P.hullSeeds(ctx,options,r=>r.id);
    for(const count of [2,4,6,8]){
      const parts=Array.from({length:count},(_,index)=>P.hullSeeds(ctx,{...options,shard:{index,count},partial:true},r=>r.id));
      assert.deepEqual(P.mergeHullParts(parts.reverse(),ctx.byId),serial,`fixed=${fixed.length}, shards=${count}`);
    }
  }
});

test('hull shard merge deduplicates combat fleets before the global cutoff and restores equal-score order',()=>{
  const {mergeHullParts}=require('../../../src/domain/routes/route_plans');
  const rows=Array.from({length:24},(_,i)=>({id:i+1})),byId=new Map(rows.map(r=>[r.id,r]));
  const part=(ids,shard)=>({attempted:100,truncated:false,beams:[{key:'route:6:combat',order:shard+1,routeIndex:0,
    entries:ids.map(id=>({ids:[id],score:100,order:id*2+shard}))}]});
  const parts=[part(Array.from({length:12},(_,i)=>i*2+1),0),part(Array.from({length:12},(_,i)=>i+1),1)];
  const merged=mergeHullParts(parts.reverse(),byId);
  assert.deepEqual(merged.rows,rows.slice(0,12).map(r=>[r]));
  assert.deepEqual(merged.baselineRows,[]);assert.equal(merged.attempted,100);assert.equal(merged.truncated,false);
});

test('hull work estimate bounds enumeration without changing roster or candidate selection',()=>{
  const P=require('../../../src/domain/routes/route_plans'),rows=[2,3,5,7,9,16].map((stype,i)=>({id:i+1,stype,name:'ship'+i,power:100,ship:{api_soku:10}}));
  for(const fixed of [[],[1,2,3,4,5,6]]){
    const ctx={roster:rows,fixed,byId:new Map(rows.map(r=>[r.id,r]))},options={area:'1-1',routes:P.routeOptions('1-1')};
    const estimate=P.hullSeeds(ctx,{...options,estimate:true},r=>r.id),result=P.hullSeeds(ctx,options,r=>r.id);
    assert(estimate>=result.attempted);assert(estimate<2000);
  }
});
