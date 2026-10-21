'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../../src/ui/workbench/workbench_model'),{actualMapLayout}=require('../../src/ui/maps/map_assets');
const routePreview=require('../../src/ui/maps/route_preview');
const h=(type,props,...children)=>({type,props:props||{},children});
const find=(node,predicate)=>!node||typeof node!=='object'?null:predicate(node)?node:(node.children||[]).map(c=>find(c,predicate)).find(Boolean);

test('speed hints name the selected strategy gates without promoting optional fastest shortcuts',()=>{
  const P=require('../../src/domain/routes/route_plans');
  const options=P.routeOptions('3-2');
  const read=option=>W.routeSpeedSummary(P.optionPaths(option).flatMap(path=>P.requirementDetails('3-2',path,option.phase,null)),option);
  const fast=read(options.find(o=>o.strategy?.minimumSpeed==='fastPlus'));
  assert.equal(fast.hint,'C/E/G 点 · 高速+以上');assert(!fast.hint.includes('最速'));
  const fastest=read(options.find(o=>o.strategy?.minimumSpeed==='fastest'));
  assert.equal(fastest.detail,'C 点 · 最速\nE 点 · 高速+以上');
  assert.equal(W.routeSpeedSummary([],undefined).hint,'');
  assert.equal(read(options.find(o=>!o.strategy)).hint,'');
});

test('speed summaries follow active conditions and do not require a speed-free alternative',()=>{
  const speed={speedCondition:{kind:'minimum',value:'fastPlus'},met:true};
  const point={from:'H',to:'T',rules:[{active:true,destinations:'T',conditionTree:{operator:'any',children:[speed,{met:true,children:[]}]}}]};
  assert.equal(W.routeSpeedSummary([point]).hint,'');
  point.rules[0].conditionTree.children[1].met=false;
  assert.equal(W.routeSpeedSummary([point]).hint,'H 点 · 高速+以上');
  const slow={from:'K',to:'T',rules:[{active:false,state:'unmatched',destinations:'M',conditionTree:{speedCondition:{kind:'exact',value:'slow'}}},
    {active:true,destinations:'T',conditionTree:{children:[]}}]};
  assert.equal(W.routeSpeedSummary([slow]).hint,'K 点 · 高速以上');
  slow.rules[0].state='inactive';assert.equal(W.routeSpeedSummary([slow]).hint,'');
});

test('4-2 selected-path encounters exclude unrelated submarine branches and retain merged starts',()=>{
  const {previewForMap}=require('../../src/domain/routes/sortie_profile');
  const selected=previewForMap('4-2',{paths:[['A','E','G','L']]});
  assert.equal(selected.counts.asw.maximum,0);
  assert.deepEqual(selected.routePaths.map(path=>path.nodes),[['A','E','G','L']]);
  const merged=previewForMap('4-2',{paths:[['A','C','L'],['B','D','C','L']]});
  assert.deepEqual(merged.counts.asw,{minimum:0,maximum:1});
  assert.equal(merged.routePaths.length,2);
  assert(merged.mapPreview.nodes.some(node=>node.id==='L'&&node.boss&&node.enemies.some(enemy=>/戦艦|空母/.test(enemy.type))));
});

test('ASW roles distinguish submarine flagships, mixed bosses and the selected gauge or lane',()=>{
  const {previewForMap}=require('../../src/domain/routes/sortie_profile');
  const {aswEscortLimit,submarineObjective}=require('../../src/recommendation/loadout/loadout_policy');
  const {routeOptions,optionPaths}=require('../../src/domain/routes/route_plans');
  const cases=[['1-5','A>D>E>J',Infinity],['7-2','C>E>G',Infinity],
    ['7-2','B>C>D>I>M',2],['7-3','A>C>E',0],['7-3','A>C>D>G>J>P',2],
    ['7-3','A>C>D>G>I>M>P',0],['7-4','A>B>E>J>L>P',3],['4-4','A>E>I>K',2],
    ['5-5','A>C>E>G>I>M>O>S',1],['6-4','B>D>C>F>N',0],['6-4','M>K>J>N',2],
    ['7-5','A>B>D>F>J>O>Q',2],['5-6','I>O>Q>U>X>Z',1]];
  for(const [area,key,expected] of cases){
    const option=routeOptions(area,'boss').find(option=>option.key===key);assert(option,area+' '+key);
    const profile=previewForMap(area,{phase:option.phase,paths:optionPaths(option)});
    assert.notEqual(profile.status,'unavailable',area+' '+key);
    assert.equal(aswEscortLimit(profile),expected,area+' '+key);
    assert.equal(!!submarineObjective(profile),expected===Infinity,area+' '+key);
  }
  const boss=previewForMap('7-4').mapPreview.nodes.find(node=>node.id==='P');
  assert.equal(boss.submarineFlagship,false);
  assert.deepEqual(boss.submarines,{minimum:2,maximum:3},'alternative boss formations must not be added together');
  const stage=previewForMap('7-2',{phase:'gauge2'});
  assert.equal(submarineObjective(stage),false);
  assert.equal(aswEscortLimit(stage),2);
  assert.equal(submarineObjective({...stage,targetNodes:['G','M']}),false,'an off-path first-gauge boss is not this route objective');
});

test('every normal map renders before a fleet exists; selected reference routes highlight without claiming arrival',()=>{
  const maps=require('../../src/domain/routes/normal_routes').listNormalMaps().maps;
  for(const map of maps){
    const overview=W.mapOverview(map.area,map.bossNodes.length?'boss':map.terminalNodes[0]);
    const empty=W.selectedMapProfile(overview,'');
    assert(actualMapLayout(map.area,empty.mapPreview,[]),map.area);
    assert.equal(empty.routePaths.length,0);assert(empty.referenceOnly);
  }
  const overview=W.mapOverview('3-5');
  assert.deepEqual(W.selectedMapProfile(overview,'upper').examples,[['B','D','H','K']]);
  assert.deepEqual(W.selectedMapProfile(overview,'lower').examples,[['F','G','K']]);
  const wrongMap={area:'1-1',routePaths:[{nodes:['F','G','K']}]};
  assert(W.selectedMapProfile(overview,'lower',wrongMap).referenceOnly);
});

test('progress keeps observed counts, completed bars and reset counters separate',()=>{
  const store={info:{maps:{35:{api_defeat_count:1,api_required_defeat_count:4},44:{api_cleared:1,api_gauge_type:1}}}};
  let gauge=W.mapProgress(store,'3-5')[0];
  assert.equal(gauge.remaining,3);assert.equal(gauge.total,4);assert.equal(gauge.label,'K 点');
  gauge=W.mapProgress(store,'4-4')[0];assert.equal(gauge.remaining,0);assert.equal(gauge.state,'complete');
  store.info.maps[44].api_cleared=0;assert.equal(W.mapProgress(store,'4-4')[0].remaining,null);
  store.info.maps[35].api_defeat_count=4;assert.equal(W.mapProgress(store,'3-5')[0].remaining,0);
  store.info.maps[35].api_cleared=1;store.info.maps[35].api_defeat_count=0;
  assert.equal(W.mapProgress(store,'3-5')[0].remaining,4);
  store.info.maps[35]={api_cleared:1,api_required_defeat_count:4};
  assert.equal(W.mapProgress(store,'3-5')[0].remaining,null,'missing counter is not completion');
});

test('unobserved gauge maps retain every bar without inventing remaining amounts',()=>{
  const store={info:{maps:{}}};
  for(const map of require('../../src/domain/routes/normal_routes').listNormalMaps().maps){
    const gauges=require(`../../data/sortie/encounters/${map.area}.json`).gauges;
    const result=W.mapProgress(store,map.area);
    if(!gauges.length){assert.equal(result,null,map.area);continue;}
    assert.equal(result.length,gauges.length,map.area);
    assert(result.every(g=>g.remaining===null&&g.state==='unknown'),map.area);
    assert.deepEqual(result.map(g=>g.node),gauges.map(g=>g.bossNode));
  }
  store.info.maps[11]={api_cleared:1};assert.equal(W.mapProgress(store,'1-1'),null);
  assert.equal(W.mapProgress(store,'1-6')[0].total,7);
  assert.match(W.mapProgress(store,'1-6')[0].title,/次抵达/);
});

test('node selection owns one threat region and map background restores route threats',()=>{
  const profile=W.selectedMapProfile(W.mapOverview('3-5'),'upper');
  const local=W.displayThreat(profile,'K'),overview=W.displayThreat(profile,null);
  assert.equal(local.title,'K 点 · 主要威胁');assert(local.enemies.length);
  assert(local.enemies.every(e=>e.nodes.every(id=>id==='K')));
  assert.equal(overview.title,'道中最大威胁');assert(!overview.enemies.some(e=>e.nodes.includes('K')));
  let selected=null,stopped=false;
  const tree=routePreview(h,{profile,compact:true,showDetails:false,showPaths:false,onNode:id=>{selected=id;},onBackground:()=>{selected=null;}});
  const node=find(tree,n=>n.props?.['aria-label']?.startsWith('K 点'));
  node.props.onClick({stopPropagation:()=>{stopped=true;}});assert(stopped);assert.equal(selected,'K');
  find(tree,n=>n.type==='svg'&&n.props.role==='group').props.onClick();assert.equal(selected,null);
  assert(!find(tree,n=>n.props.className==='paa-node-detail'));
});

test('fleet summary shows air range, route-specific requirements and coefficient-qualified LoS without claiming full-route superiority',()=>{
  const report={metrics:{airPower:{status:'range',min:45,max:48},lineOfSight:{status:'estimate',scoresByCoefficient:{1:10,2:20,3:30,4:42},rawScoresByCoefficient:{4:42},lowerBoundScoresByCoefficient:{4:20}}},
    route:{airControl:{assessment:{superiority:{required:381}},profiles:[{route:'upper',superiority:381,supremacy:762},{route:'lower',superiority:35,supremacy:69}]},
      fixedArrivalCondition:{requirements:[{from:'G',coefficient:4,requiredScore:28}]}}};
  const profile=W.selectedMapProfile(W.mapOverview('3-5'),'lower');
  const result=W.fleetSummary(report,profile);
  assert.equal(result.air.value,'45–48');assert.match(result.air.hint,/空优 35.*空确 69/);
  assert.equal(result.air.state,'损耗待确认');assert.equal(result.los.value,'42.0');assert.equal(result.los.coefficient,4);
  assert.equal(result.los.state,'估算达标');
  report.metrics.airPower.min=20;report.metrics.airPower.max=23;assert.equal(W.fleetSummary(report,profile).air.state,'损耗待确认');
  assert.equal(W.fleetSummary({},profile).air.value,'—');
});

test('LoS UI warns only when the actual interval crosses the selected gate, and route planning preserves uncertainty',()=>{
  const route={area:'3-5',ships:[{stype:3},...Array.from({length:5},()=>({stype:2}))],targetNodes:['K'],
    lineOfSight:{status:'estimate',rawScoresByCoefficient:{4:29},scoresByCoefficient:{4:29},
      lowerBoundScoresByCoefficient:{4:28.1},upperBoundScoresByCoefficient:{4:29.5}},pointAssessments:[]};
  const report={route,metrics:{lineOfSight:route.lineOfSight}},selected={nodes:['F','G','K']};
  const summary=()=>W.fleetSummary(report,null,selected.nodes).los;
  assert.equal(summary().state,'索敌达标');assert.equal(W.routeArrival(report,selected,true).tone,'good');
  route.lineOfSight.lowerBoundScoresByCoefficient[4]=27.5;
  assert.equal(summary().state,'估算达标');assert(summary().uncertain);
  assert.notEqual(W.routeArrival(report,selected,true).tone,'good','planning must not force an uncertain LoS interval to computed');
  route.lineOfSight.rawScoresByCoefficient[4]=27.8;
  assert.equal(summary().state,'索敌待确认');assert.equal(summary().bad,false);
  route.lineOfSight.upperBoundScoresByCoefficient[4]=27.9;
  assert.equal(summary().state,'索敌不足');assert.equal(summary().bad,true);
});


test('arrival panel separates fixed, weighted, unknown and stale route evidence',()=>{
  const selected={nodes:['A','C']},route={area:'1-1',targetNodes:['C'],pointAssessments:[{from:'A',assessment:{status:'random',destinations:['B','C'],probabilities:[{to:'B',probability:.2},{to:'C',probability:.8}]}}]};
  assert.equal(W.routeArrival({route},selected,true).value,'到达概率 80%');
  assert(W.routeArrival({route},selected,true).warnings.some(r=>r.includes('B 20% / C 80%')));
  route.pointAssessments[0].assessment={status:'fixed',destinations:['C']};
  assert.equal(W.routeArrival({route},selected,true).value,'固定到达');
  route.pointAssessments[0].assessment={status:'random',destinations:['B','C']};
  assert.equal(W.routeArrival({route},selected,true).value,'到达概率 50%');
  assert.equal(W.routeArrival({route},selected,false).value,'待核对编成');
  assert.deepEqual(W.routeArrival({route},selected,false).warnings,[]);
  assert.equal(W.routeArrival({route},null,true).value,'请选择路线');
  route.pointAssessments[0].assessment={status:'fixed',destinations:['B']};
  assert.equal(W.routeArrival({route},selected,true).value,'无法沿此路线到达');
  assert.match(W.applicationWarning('normal',{route},selected).label,/不可达/);
  route.pointAssessments[0].assessment={status:'unknown',destinations:['B','C'],reason:'舰种分岐条件尚未明确'};
  assert.equal(W.applicationWarning('normal',{route},selected),null,'unknown is not zero probability');
  const unknown=W.routeArrival({route},selected,true);
  assert.equal(unknown.value,'到达率待确认');assert.notEqual(unknown.tone,'good');
  assert(unknown.warnings.some(w=>w.includes('A 点条件待确认')&&w.includes('舰种分岐条件尚未明确')));
  assert(!unknown.warnings.some(w=>w.includes('50%')),'unresolved hull conditions must remain separate from random exits');
});

test('calculated LoS satisfying confirmed route rules shows green fixed arrival without mutating observed evidence',()=>{
  const {evaluateNormalRoute,evaluatePoint}=require('../../src/domain/routes/normal_routes');
  const store=require('../helpers/workbench_fixture')();
  const route=evaluateNormalRoute(store,{area:'3-5',scheme:{fleet:1,ships:[1,2,3,4,5,6]}});
  route.lineOfSight={status:'computed',rawScoresByCoefficient:{4:100},scoresByCoefficient:{4:100}};
  route.pointAssessments.find(p=>p.from==='G').assessment=evaluatePoint(require('../../data/normal_routes/3-5.json').machineRules.G,route.ships,{lineOfSight:route.lineOfSight});
  const before=JSON.stringify(route),selected={nodes:['F','G','K']},report={route,metrics:{lineOfSight:route.lineOfSight}};
  const result=W.routeArrival(report,selected,true);
  assert.equal(result.value,'固定到达');assert.equal(result.tone,'good');assert.deepEqual(result.warnings,[]);
  assert(!result.note.includes('100%'));assert.equal(JSON.stringify(route),before);
  report.route.fixedArrivalCondition={requirements:[{from:'H',coefficient:4,requiredScore:40}]};
  const summary=W.fleetSummary(report,null,selected.nodes);
  assert.equal(summary.los.hint,'门槛 ≥ 28 · G→K');assert(!summary.los.hint.includes('H→'));
  assert.equal(summary.los.value,'100.0');
  route.lineOfSight.rawScoresByCoefficient[4]=29;route.lineOfSight.thresholdMargin=2;
  route.pointAssessments.find(p=>p.from==='G').assessment=evaluatePoint(require('../../data/normal_routes/3-5.json').machineRules.G,route.ships,{lineOfSight:route.lineOfSight});
  assert.notEqual(W.routeArrival(report,selected,true).tone,'good','HQ margin still applies');
  route.lineOfSight.rawScoresByCoefficient[4]=20;
  route.pointAssessments.find(p=>p.from==='G').assessment=evaluatePoint(require('../../data/normal_routes/3-5.json').machineRules.G,route.ships,{lineOfSight:route.lineOfSight});
  assert.equal(W.routeArrival(report,selected,true).value,'无法沿此路线到达');
  delete route.lineOfSight.rawScoresByCoefficient[4];
  assert.notEqual(W.routeArrival(report,selected,true).tone,'good','missing LoS is not a pass');
});

test('3-2 candidate speed yields exact path chances without disguising random branches as fixed',()=>{
  const {evaluateNormalRoute,evaluatePoint}=require('../../src/domain/routes/normal_routes');
  const store=require('../helpers/workbench_fixture')(),map=require('../../data/normal_routes/3-2.json');
  const route=evaluateNormalRoute(store,{area:'3-2',scheme:{fleet:1,ships:[1,2,3,4,5,6]}});
  const check=(speed,radars,expected,options={})=>{
    route.ships.forEach((s,i)=>{s.radarEquipped=i<radars;s.stype=i===0?3:options.supply&&i===5?22:2;});
    route.speed={status:options.unknown?'unknown':'estimated',fleetSpeed:options.unknown?null:speed,
      ships:route.ships.map(s=>({shipId:s.instanceId,speed:options.unknown?null:speed,status:options.unknown?'unknown':'estimated'}))};
    route.pointAssessments=Object.entries(map.machineRules).map(([from,rules])=>({from,assessment:evaluatePoint(rules,route.ships,{speed:route.speed,lineOfSight:route.lineOfSight})}));
    const before=JSON.stringify(route),result=W.routeArrival({route},{nodes:['C','E','F','L']},true);
    assert.equal(result.value,expected);assert.equal(JSON.stringify(route),before,'UI must not overwrite observed evidence');return result;
  };
  const fixed=check('fastest',4,'固定到达');assert.equal(fixed.tone,'good');assert.deepEqual(fixed.warnings,[]);
  check('fastPlus',1,'到达概率 40%');
  assert.equal(W.routeArrival({route},{nodes:['C','G','F','L']},true).value,'到达概率 60%');
  check('fast',1,'到达概率 37.4%',{supply:true});
  check('fast',1,'无法沿此路线到达');
  check('fastest',0,'无法沿此路线到达');
  check(null,1,'到达率待确认',{unknown:true});
});

test('LoS card automatically matches each selected connection to its coefficient and threshold',()=>{
  const store=require('../helpers/workbench_fixture')(),{evaluateNormalRoute}=require('../../src/domain/routes/normal_routes');
  for(const [area,path,coefficient,required,edge] of [
    ['2-5','CEIO',1,34,'I→O'],['3-5','FGK',4,28,'G→K'],
    ['5-2','BCDFO',2,70,'F→O'],['6-3','ACEGHJ',3,38,'H→J']]){
    const route=evaluateNormalRoute(store,{area,scheme:{fleet:1,ships:[1,2,3,4,5,6]}});
    const los={status:'computed',scoresByCoefficient:{1:70,2:140,3:210,4:280},rawScoresByCoefficient:{1:70,2:140,3:210,4:280}};
    route.lineOfSight=los;
    const report={route,metrics:{lineOfSight:los}},summary=()=>W.fleetSummary(report,{area},path.split('')).los;
    assert.equal(summary().coefficient,coefficient);assert.equal(summary().value,(70*coefficient).toFixed(1));
    assert.equal(summary().hint,`门槛 ≥ ${required} · ${edge}`);assert.equal(summary().state,'索敌达标');
    los.scoresByCoefficient[coefficient]=los.rawScoresByCoefficient[coefficient]=required-1;
    assert.equal(summary().state,'索敌不足');assert(summary().bad);
    delete los.rawScoresByCoefficient[coefficient];
    assert.equal(summary().state,'待计算');assert(!summary().bad,'missing measurements are not an observed shortfall');
  }
});

for(const [area,path,from,to,coefficient,minimum,required] of [
  ['2-5','CEIO','I','O',1,31,34],
  ['4-5','CDHKT','K','T',2,60,70],
  ['5-2','BCDFO','F','O',2,63,70],
  ['6-3','ACEGHJ','H','J',3,36,38]
])test(`${area} ${from}→${to}: coefficient-four display cannot override the node's LoS check`,()=>{
  const {evaluateNormalRoute,evaluatePoint}=require('../../src/domain/routes/normal_routes');
  const {planningPath}=require('../../src/domain/routes/route_plans');
  const store=require('../helpers/workbench_fixture')();
  const route=evaluateNormalRoute(store,{area,scheme:{fleet:1,ships:[1,2,3,4,5,6]}});
  const nodes=path.split(''),rules=require(`../../data/normal_routes/${area}.json`).machineRules[from];
  const los={status:'computed',thresholdMargin:0,
    scoresByCoefficient:{1:0,2:0,3:0,4:1000},rawScoresByCoefficient:{1:0,2:0,3:0,4:1000}};
  route.lineOfSight=los;
  const summary=()=>W.fleetSummary({route,metrics:{lineOfSight:los}},{area},nodes).los;
  const assess=()=>evaluatePoint(rules,route.ships,{lineOfSight:los,visitedNodes:nodes.slice(0,nodes.indexOf(from)+1)});
  for(const score of [minimum-1,required-1]){
    los.scoresByCoefficient[coefficient]=los.rawScoresByCoefficient[coefficient]=score;
    const card=summary(),point=assess();
    assert.equal(card.coefficient,coefficient);assert.equal(card.value,score.toFixed(1));
    assert.equal(card.state,'索敌不足');assert.equal(card.bad,true);
    assert(!(point.status==='fixed'&&point.destinations.length===1&&point.destinations[0]===to),
      'a passing coefficient-four score must not fix arrival at the selected exit');
    assert.deepEqual(planningPath(route,nodes).pointAssessments.find(p=>p.from===from).assessment,point);
    // Changing only the status page's display coefficient cannot change this node.
    los.scoresByCoefficient[4]=los.rawScoresByCoefficient[4]=-1000;
    assert.deepEqual(summary(),card);assert.deepEqual(assess(),point);
    los.scoresByCoefficient[4]=los.rawScoresByCoefficient[4]=1000;
  }
  // Meeting this node's own threshold must pass even when coefficient four fails.
  los.scoresByCoefficient[coefficient]=los.rawScoresByCoefficient[coefficient]=required;
  los.scoresByCoefficient[4]=los.rawScoresByCoefficient[4]=-1000;
  assert.equal(summary().state,'索敌达标');assert.equal(summary().value,required.toFixed(1));
  assert.equal(assess().status,'fixed');assert.deepEqual(assess().destinations,[to]);
});

test('LoS card separates no gate, unresolved gate and no selected route without inventing coefficient one',()=>{
  const profile={area:'4-5'},report={metrics:{lineOfSight:{scoresByCoefficient:{1:27.1,2:58.5,3:89.8,4:121.3}}}};
  const clear=W.fleetSummary(report,profile,['A','D','H','T']).los;
  assert.equal(clear.hint,'所选路线无索敌门槛');assert.equal(clear.state,'无需索敌');
  assert.equal(clear.value,'—');assert.equal(clear.coefficient,null);
  const unknown=W.fleetSummary(report,profile,['C','D','H','K','T']).los;
  assert.equal(unknown.hint,'K→T · 门槛待确认');assert.equal(unknown.coefficient,2,'the reference threshold now carries its known coefficient');
  const los={status:'estimate',rawScoresByCoefficient:{2:80},scoresByCoefficient:{2:80}};
  const route={area:'4-5',ships:[9,11,5,5,2,2].map(stype=>({stype})),lineOfSight:los,speed:{status:'observed',fleetSpeed:'fast'}};
  const reference=W.fleetSummary({route,metrics:{lineOfSight:los}},profile,['C','D','H','K','T']).los;
  assert.equal(reference.hint,'门槛 ≥ 70 · K→T');assert.equal(reference.value,'80.0');
  const unselected=W.fleetSummary(report,profile,[]).los;
  assert.equal(unselected.state,'请选择路线');assert.equal(unselected.value,'—');
  assert(!JSON.stringify([clear,unknown,unselected]).includes('系数 1–4'));
});

test('multiple LoS checks headline the tightest gate and retain every coefficient and value in details',()=>{
  const report={metrics:{lineOfSight:{status:'computed',scoresByCoefficient:{1:40,4:29},rawScoresByCoefficient:{1:40,4:29}}},
    route:{fixedArrivalCondition:{requirements:[{from:'A',to:'B',coefficient:1,requiredScore:30},{from:'C',to:'D',coefficient:4,requiredScore:28}]}}};
  const result=W.fleetSummary(report,{}).los;
  assert.equal(result.coefficient,4);assert.equal(result.value,'29.0');assert.equal(result.hint,'门槛 ≥ 28 · C→D · 共 2 处');
  assert.equal(result.compactHint,'C→D · 门槛 ≥ 28 · 系数 4');
  assert.match(result.detail,/A→B：门槛 ≥ 30 · 系数 1 · 当前 40.0/);
  assert.match(result.detail,/C→D：门槛 ≥ 28 · 系数 4 · 当前 29.0/);
});

test('numeric threshold references produce fixed arrival without sample warnings',()=>{
  const route={area:'3-5',targetNodes:['J'],ships:[11,11,5,5,2,2].map(stype=>({stype})),
    lineOfSight:{status:'computed',rawScoresByCoefficient:{4:30}},pointAssessments:[]};
  const selected={nodes:['B','D','H','J']},report={route};
  const reference=W.routeArrival(report,selected,true,'J');
  assert.equal(reference.value,'固定到达');assert.equal(reference.tone,'good');
  assert.equal(reference.note,'');assert.deepEqual(reference.warnings,[]);
  route.lineOfSight.rawScoresByCoefficient[4]=100;route.targetNodes=['K'];selected.nodes=['B','D','H','K'];
  const confirmed=W.routeArrival(report,selected,true);
  assert.equal(confirmed.value,'固定到达');assert.equal(confirmed.tone,'good');
  assert.deepEqual(confirmed.warnings,[],'unused tentative low-LoS rule does not taint the route');
});

test('6-3 player choice does not turn the known 40 percent branch into a zero-to-40 interval',()=>{
  const route={area:'6-3',targetNodes:['J'],ships:[16,3,3,2,2,2].map(stype=>({stype})),
    lineOfSight:{status:'computed',rawScoresByCoefficient:{3:76.2},thresholdMargin:1},pointAssessments:[]};
  const selected={nodes:['A','C','E','G','H','J']};
  let result=W.routeArrival({route},selected,true);
  assert.equal(result.value,'到达概率 40%');assert.match(result.note,/能动分岐/);
  assert(result.warnings.some(w=>w.includes('F 60% / G 40%')));
  route.ships=[16,3,2,2,2,2].map(stype=>({stype}));
  result=W.routeArrival({route},selected,true);
  assert.equal(result.value,'固定到达');assert.equal(result.tone,'good');assert.match(result.note,/能动分岐/);
  route.lineOfSight.rawScoresByCoefficient[3]=38.5;
  assert.notEqual(W.routeArrival({route},selected,true).tone,'good','unconfirmed LoS still produces a range');
});

test('multi-boss progress retains stage order, cleared stages and future bars across reset',()=>{
  const store={info:{maps:{}}};
  for(const [area,bosses] of [['5-6',['G','N','Z']],['7-2',['G','M']],['7-3',['E','P']],['7-5',['K','Q','T']]]){
    const id=Number(area.replace('-',''));
    store.info.maps[id]={api_gauge_type:1,api_gauge_num:2,api_cleared:1,api_required_defeat_count:3,api_defeat_count:1};
    let progress=W.mapProgress(store,area);
    assert.deepEqual(progress.map(g=>g.node),bosses);
    assert.equal(progress[0].state,'complete');assert.equal(progress[0].remaining,0);
    assert.equal(progress[1].remaining,2);assert.equal(progress[1].state,'current');
    assert.deepEqual(progress.map(g=>g.isCurrent),bosses.map((_,i)=>i===1));
    if(progress[2]){assert.equal(progress[2].state,'pending');assert.equal(progress[2].remaining,progress[2].total);}
    store.info.maps[id].api_gauge_num=1;store.info.maps[id].api_defeat_count=0;
    progress=W.mapProgress(store,area);
    assert.notEqual(progress[0].state,'complete');assert.equal(progress[1].state,'pending');
    for(const value of [undefined,0,99,1.5]){
      store.info.maps[id].api_gauge_num=value;
      assert(W.mapProgress(store,area).every(g=>g.remaining===null&&g.state==='unknown'&&!g.isCurrent));
    }
    store.info.maps[id]={api_cleared:1,api_gauge_num:bosses.length};
    assert(W.mapProgress(store,area).every(g=>g.remaining===0&&g.state==='complete'&&!g.isCurrent));
  }
});

test('transport progress never treats defeat counts as remaining TP',()=>{
  const store={info:{maps:{56:{api_gauge_num:1,api_gauge_type:2,api_required_defeat_count:280,api_defeat_count:100}}}};
  const rows=W.mapProgress(store,'5-6');
  assert.equal(rows[0].total,280);assert.equal(rows[0].remaining,null);assert(rows[0].isCurrent,'known stage remains highlighted even if TP is missing');assert.match(rows[0].title,/TP/);
  store.info.maps[56].api_gauge_num=2;
  assert.equal(W.mapProgress(store,'5-6')[0].remaining,0);
});

test('confirmed locked maps use local full gauges, while unloaded and unlocked maps remain unknown',()=>{
  const store={info:{maps:{11:{api_id:11,api_cleared:1}}},const:{$maps:{16:{api_id:16},56:{api_id:56},75:{api_id:75}}}};
  for(const [area,totals] of [['1-6',[7]],['5-6',[280,2,3]],['7-5',[2,3,3]]]){
    const rows=W.mapProgress(store,area);
    assert.deepEqual(rows.map(r=>r.total),totals);
    assert.deepEqual(rows.map(r=>r.remaining),totals);
    assert(rows.every(r=>r.state==='locked'&&r.detail==='未解锁'&&!r.isCurrent));
    assert(rows.every(r=>r.title.includes('本地资料')));
  }
  store.info.maps[75]={api_id:75,api_gauge_num:1,api_gauge_type:1,api_cleared:0};
  let rows=W.mapProgress(store,'7-5');assert.equal(rows[0].state,'unknown');assert.equal(rows[0].remaining,null);
  assert.equal(rows[1].state,'pending');
  delete store.info.maps[75];delete store.info.maps[11];
  assert(W.mapProgress(store,'7-5').every(r=>r.state==='unknown'));
  store.info.maps[11]={api_id:11};delete store.const.$maps[75];
  assert(W.mapProgress(store,'7-5').every(r=>r.state==='unknown'),'missing master map is not a confirmed lock');
});
