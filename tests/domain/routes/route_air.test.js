'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {routeAirReference,simulateAirPath,estimateRouteAir,estimateRouteAirMargins,stageOneLoss}=require('../../../src/domain/routes/route_air');
const W=require('../../../src/ui/workbench/workbench_model');
const reference=(area,path)=>routeAirReference({},area,{examples:[path.split('')]});

test('5-4 thresholds use only encountered nodes, including boss and all recorded enemy variants',()=>{
  const north=reference('5-4','BCGLP'),middle=reference('5-4','BEHIJMP');
  assert.equal(north.status,'known');assert.equal(middle.status,'known');
  assert.deepEqual([north.superiority,north.supremacy],[309,618]);
  assert.deepEqual([middle.superiority,middle.supremacy],[140,279]);
  assert.deepEqual(north.limitingNodes,['G']);assert.deepEqual(middle.limitingNodes,['P']);
  assert(!middle.nodes.some(n=>n.id==='G'));
  const both=routeAirReference({},'5-4',{examples:['BCGLP'.split(''),'BEHIJMP'.split('')]});
  assert.equal(both.scope,'candidateRoutes');assert.equal(both.superiority,309);
});

test('3-5 uses the same generic node calculation for both routes',()=>{
  assert.deepEqual(['FGK','BDHK'].map(path=>reference('3-5',path).superiority),[35,381]);
});

test('7-5 includes both sourced air raid variants and the corrected R air line',()=>{
  const a=reference('7-5','A'),r=reference('7-5','R'),q=reference('7-5','Q');
  assert.equal(a.status,'known');assert.deepEqual([a.enemyAirPower,a.superiority,a.supremacy],[335,503,1005]);
  assert.equal(r.status,'known');assert.deepEqual([r.enemyAirPower,r.superiority,r.supremacy],[264,396,792]);
  assert.equal(q.status,'known');assert.deepEqual([q.enemyAirPower,q.superiority,q.supremacy],[114,171,342]);
  const source=require('../../../data/sortie/encounters/7-5.json');
  assert.deepEqual(source.crossCheck.nodes.A.kcwikiVariants.map(v=>v.air),[335,200,169,48]);
  assert.equal(source.nodes.R.phases.base.patterns.find(p=>p.pattern===4).airSuperiority,396);
  assert.equal(source.validation.find(v=>v.node==='R').recorded,394,'the original wiki value remains traceable');
  for(const option of require('../../../src/domain/routes/route_plans').recommendedOptions('7-5')){
    const paths=require('../../../src/domain/routes/route_plans').optionPaths(option);
    const result=routeAirReference(null,'7-5',{examples:paths});
    assert.equal(result.status,'known',`${option.phase} ${option.name}: ${result.reason}`);
  }
});

test('unselected and unavailable routes cannot fall back to whole-map maxima',()=>{
  const result={airControl:{assessment:{superiority:{required:999}}}};
  assert.equal(routeAirReference(result,'5-4',{}).status,'unselected');
  assert.equal(routeAirReference(result,'5-4',{routePaths:[],examples:[['G']]}).superiority,null);
  assert.equal(reference('5-4','Z').status,'unknown');
  assert.equal(reference('9-9','A').status,'unknown');
});

test('night-only fights and inherited gun-only enemy formations add no air-state requirement',()=>{
  assert.equal(reference('6-5','J').superiority,0);
  assert.equal(reference('6-3','ACEFHJ').superiority,0);
  assert.equal(reference('1-1','AC').superiority,0);
});

test('1-6 N is a resource goal without a battle or extra air requirement',()=>{
  const {previewForMap,consumption}=require('../../../src/domain/routes/sortie_profile');
  const data=require('../../../data/sortie/encounters/1-6.json'),node=data.nodes.N;
  assert.equal(node.kind,'resources');assert.match(node.effect.raw,/戦闘なし/);
  const alone=reference('1-6','N');
  assert.equal(alone.status,'known');assert.equal(alone.enemyAirPower,0);
  assert.equal(alone.nodes[0].noAirBattle,true);
  const before=reference('1-6','AEGFB'),withGoal=reference('1-6','AEGFBN');
  assert.equal(withGoal.status,before.status);assert.equal(withGoal.superiority,before.superiority);
  assert(!withGoal.reason?.includes('N 点'));
  for(const [path,superiority] of [['AEGFBN',83],['CHKMJDN',198],['CHKMLIDN',288]]){
    const route=reference('1-6',path);assert.equal(route.status,'known',route.reason);
    assert.equal(route.superiority,superiority);
  }
  const map=previewForMap('1-6',{target:'N',paths:[['A','E','G','F','B','N']]});
  assert.equal(map.mapPreview.nodes.find(n=>n.id==='N').kind,'resources');
  const resource=consumption(node,'1-6');assert.equal(resource.fuel,0);assert.equal(resource.ammo,null);
});

test('bounded source discrepancies matter only if they can change the route maximum',()=>{
  const conflict=reference('2-5','C');
  assert.equal(conflict.status,'unknown');assert.equal(conflict.superiority,null);
  assert.match(conflict.reason,/来源差异/);
  const boss=reference('2-5','CEIO');
  assert.equal(boss.status,'known');assert.equal(boss.superiority,42);
  assert.deepEqual(boss.limitingNodes,['O']);
  assert(boss.nodes.find(n=>n.id==='C').issues.length,'retain the source discrepancy for inspection');
});

const aircraft=(planes=25,aa=32,type=6,bonus=0)=>({status:'range',
  min:Math.floor(aa*Math.sqrt(planes)+bonus),max:Math.floor(aa*Math.sqrt(planes)+bonus),slots:[{
    planes:[planes,planes],effectiveAntiAir:[aa,aa],proficiencyBonus:[bonus,bonus],aircraftType:type}]});
const combat=(id='A',enemy=100,kind='battle')=>({id,kind,enemyAirPower:enemy,
  antiAir:{status:'known',proportion:0.25,fixed:12}});
const boss={...combat('Z'),boss:true};

test('route air references and aircraft losses follow encounter stage without stale cache reuse',()=>{
  const paths=[['X','Z']],forStage=encounterStage=>routeAirReference({},'5-6',{examples:paths,encounterStage});
  // Query unknown and final first: later before/after requests must not reuse
  // a stronger stage merely because their physical paths are identical.
  const unknown=forStage('unknown'),final=forStage('final'),before=forStage('before'),after=forStage('after');
  assert.deepEqual([unknown.enemyAirPower,final.enemyAirPower,before.enemyAirPower,after.enemyAirPower],[435,435,325,218]);
  assert.notStrictEqual(before,final);assert.strictEqual(before,forStage('before'));
  assert.deepEqual(before.nodes.map(n=>n.enemyAirPower),[325,325]);
  assert.deepEqual(final.nodes.map(n=>n.enemyAirPower),[435,435]);
  assert.deepEqual(after.nodes.map(n=>n.enemyAirPower),[218,218]);
  const plane=aircraft(25,32,7);
  const beforeLoss=estimateRouteAir(plane,before),afterLoss=estimateRouteAir(plane,after);
  assert.equal(beforeLoss.status,'estimated');assert.equal(afterLoss.status,'estimated');
  assert(beforeLoss.paths[0].steps[0].aircraft[0].planes[0]<afterLoss.paths[0].steps[0].aircraft[0].planes[0]);
  assert.equal(estimateRouteAir(plane,final).paths[0].steps[0].required.superiority,653);
});

test('route stage can come from the evaluated route while unknown remains conservative',()=>{
  const path={examples:[['H']]};
  const before=routeAirReference({encounterStage:'before'},'3-5',path);
  const final=routeAirReference({encounterStage:'final'},'3-5',path);
  const unknown=routeAirReference({},'3-5',path);
  assert.deepEqual([before.enemyAirPower,final.enemyAirPower,unknown.enemyAirPower],[221,254,254]);
  assert.equal(routeAirReference({encounterStage:'final'},'3-5',{...path,encounterStage:'before'}),before);
});

test('4-5 boss uses the documented final and post-clear air compositions',()=>{
  const path={examples:[['T']]};
  const values=['before','final','after','unknown'].map(encounterStage=>
    routeAirReference({},'4-5',{...path,encounterStage}).enemyAirPower);
  assert.deepEqual(values,[138,111,138,138]);
});

test('air query attribution reconciles cache hits and pass/fail without changing results',()=>{
  const perf=require('../../../src/shared/performance_trace');
  const {routeAirMeets}=require('../../../src/domain/routes/route_air');
  const ref={status:'known',nodes:[combat('A',71),boss],paths:[['A','Z']]};
  const air=aircraft(31,33),before=structuredClone(air),trace=new perf.PerformanceTrace();
  trace.run(()=>perf.withDetails({batch:'gear',airGoal:'superiority',airStep:'release'},()=>{
    assert.equal(routeAirMeets(air,ref,'superiority'),true);
    assert.equal(routeAirMeets(air,ref,'superiority'),true);
    assert.equal(routeAirMeets(air,ref,'superiority',1000),false);
    assert.equal(routeAirMeets(null,ref,'superiority'),null);
  }));
  const suffix='.gear.requested.superiority.release.direct',n=name=>trace.counters['air.query.'+name+suffix]||0;
  assert.equal(trace.spans.get('air.query'+suffix).calls,4);
  assert.equal(n('hit')+n('miss')+n('unknown'),4);
  assert.equal(n('pass'),2);assert.equal(n('fail'),1);assert.equal(n('unknown'),1);
  assert(n('hit')>=1);assert(n('miss')>=1);assert.deepEqual(air,before);
  const {sanitize}=require('../../../src/infrastructure/cache/performance_logs');
  assert.deepEqual(sanitize({...trace.snapshot(),level:'modules'}).counters,trace.counters);
});

test('boss air is measured before boss losses; preceding fights can break departure superiority',()=>{
  const fleet=aircraft(),before=JSON.stringify(fleet);
  const direct=simulateAirPath(fleet,[boss]),via=simulateAirPath(fleet,[combat(),boss]);
  assert.deepEqual(direct.boss.before,{min:160,max:160});
  assert.deepEqual(via.boss.before,{min:146,max:156});
  assert.equal(via.margins.superiority.min,-4);assert.equal(via.margins.superiority.max,6);
  assert.equal(via.steps.at(-1).after,undefined,'do not subtract boss losses before its own air check');
  assert.equal(JSON.stringify(fleet),before,'never mutate fleet metrics');
});

test('17-plane fighters lose nothing under supremacy; enemy-zero battles still have stage-one losses',()=>{
  assert.equal(stageOneLoss(17,'supremacy',true),0);
  assert.equal(stageOneLoss(18,'supremacy',true),1);
  assert.equal(stageOneLoss(20,'loss',true),11);
  const stable=simulateAirPath(aircraft(17,20),[combat('A',0),boss]);
  assert.deepEqual(stable.steps[0].before,stable.steps[0].after);
  const losses=simulateAirPath(aircraft(25,20),[combat('A',0),boss]);
  assert.deepEqual(losses.steps[0].after,{min:97,max:100});
});

test('raid excludes enemy stage two, fighters are immune, and aerial combat has two rounds',()=>{
  const bomber=aircraft(25,10,7),raid=simulateAirPath(bomber,[combat('A',0,'aerialRaid'),boss]);
  const surface=simulateAirPath(bomber,[combat('A',0),boss]);
  const fighter=simulateAirPath(aircraft(25,10),[combat('A',0),boss]);
  assert.deepEqual(raid.steps[0].after,{min:48,max:50});
  assert.deepEqual(fighter.steps[0].after,raid.steps[0].after);
  assert.deepEqual(surface.steps[0].after,{min:24,max:50});
  const twice=simulateAirPath(bomber,[combat('A',0,'aerialCombat'),boss]);
  assert.deepEqual(twice.steps.map(s=>[s.node,s.round]),[['A',1],['A',2],['Z',1]]);
  assert(twice.boss.before.min<surface.boss.before.min);
});

test('empty slots lose proficiency contribution; missing AA and unsupported jets remain unknown',()=>{
  const lost=simulateAirPath(aircraft(1,10,11,9),[combat('A',0),boss]);
  assert.equal(lost.boss.before.min,0);assert.equal(lost.boss.before.max,19);
  const missing={...combat(),antiAir:{status:'unknown',reason:'missing'}};
  assert.equal(simulateAirPath(aircraft(25,10,7),[missing,boss]).status,'unknown');
  assert.equal(simulateAirPath(aircraft(),[missing,boss]).status,'estimated');
  assert.equal(simulateAirPath(aircraft(25,10,57),[boss]).status,'unknown');
});

test('night and noncombat nodes preserve aircraft and path order changes accumulated boss losses',()=>{
  const quiet={id:'N',noAirBattle:true};
  assert.deepEqual(simulateAirPath(aircraft(),[quiet,boss]).boss.before,{min:160,max:160});
  const profile=reference('5-4','BEHIJMP');
  const estimate=estimateRouteAir(aircraft(),profile);
  assert.equal(estimate.status,'estimated');
  assert(!estimate.paths[0].steps.some(s=>['H','J','M'].includes(s.node)));
  assert.equal(estimate.boss.node,'P');
  const finish=simulateAirPath(aircraft(),[combat(),quiet]);
  assert.deepEqual(finish.terminal.before,finish.steps[0].after,'safe terminal uses aircraft AFTER the last battle');
  assert.equal(finish.terminal.node,'N');
  const asw=reference('6-5','B').nodes[0];
  assert.deepEqual(asw.antiAir,{status:'known',proportion:0,fixed:0},'pure submarines are not aerial strike targets');
});

test('compact metric labels threshold nodes and keeps friendly boss arrival power in the tooltip',()=>{
  const profile={area:'5-4',examples:[['P']]};
  const report={metrics:{airPower:aircraft(25,28)}};
  let air=W.fleetSummary(report,profile).air;
  assert.equal(air.state,'全程空优');assert.equal(air.hint,'空优 140 · 空确 279 · P 点');
  assert.match(air.detail,/抵达 Boss时我方预计制空：140/);
  assert(!air.hint.includes('Boss'));
  report.metrics.airPower=aircraft(25,56);
  assert.equal(W.fleetSummary(report,profile).air.state,'全程空确');
  report.metrics.airPower=aircraft(25,27);
  assert.equal(W.fleetSummary(report,profile).air.state,'P 点制空不足');
  assert.equal(W.fleetSummary(report,profile,[]).air.state,'待确认');
});

test('zero enemy air requires friendly air and water fighters survive ordinary interception',()=>{
  const profile={area:'1-1',examples:[['A','C']]};
  const read=air=>W.fleetSummary({metrics:{airPower:air}},profile).air;
  const empty={status:'range',min:0,max:0,slots:[]};
  assert.equal(read(empty).state,'未配制空');assert.equal(read(empty).bad,true);
  const water=read(aircraft(1,4,45));
  assert.equal(water.state,'全程空确');assert.equal(water.bad,false);
  assert.equal(water.hint,'敌方全程无制空');assert.match(water.detail,/估算/);
  assert.equal(water.estimate.paths[0].steps[0].required.supremacy,1);
  const bomber=W.fleetSummary({metrics:{airPower:aircraft(1,2,11)}},{area:'6-3',examples:['ACEFHJ'.split('')]}).air;
  assert.notEqual(bomber.state,'全程空确','a bomber wiped before the boss must not pass via 0 >= 0');
  assert(bomber.bad);
  assert.equal(W.fleetSummary({metrics:{airPower:empty}},{area:'6-5',examples:[['J']]}).air.state,'无需制空');
  assert.equal(W.fleetSummary({metrics:{airPower:empty}},{area:'1-5',examples:[['A','D','E','J']]}).air.state,'无需制空');
});

test('equivalent aircraft inputs reuse estimates while changed planes and equipment invalidate them',()=>{
  const route=reference('5-4','BCGLP'),fleet=aircraft();
  assert.equal(reference('5-4','BCGLP'),route);
  const first=estimateRouteAir(fleet,route),copy=JSON.parse(JSON.stringify(fleet));
  copy.slots[0].itemId=999;
  assert.equal(estimateRouteAir(copy,route),first,'instance IDs do not affect aircraft physics');
  for(const [key,index,value]of [['planes',0,20],['planes',1,30],['effectiveAntiAir',0,29],
    ['effectiveAntiAir',1,35],['proficiencyBonus',0,3],['proficiencyBonus',1,5]]){
    const changed=JSON.parse(JSON.stringify(fleet));changed.slots[0][key][index]=value;
    assert.notEqual(estimateRouteAir(changed,route),first,key+index);
  }
  const bomber=JSON.parse(JSON.stringify(fleet));bomber.slots[0].aircraftType=7;
  assert.notEqual(estimateRouteAir(bomber,route),first);
  const other=estimateRouteAir(fleet,reference('5-4','BEHIJMP'));
  assert.notEqual(other,first);assert.equal(other.paths[0].steps[0].node,'E');
});

test('trial margin reuse survives broad outfit searches without rerunning the same aircraft physics',()=>{
  let reads=0;
  const node={...combat('Z'),boss:true,get enemyAirPower(){reads++;return 100;}};
  const route={status:'known',nodes:[node],paths:[['Z']]},air=aircraft(25,20);
  const first=estimateRouteAirMargins(air,route);
  for(let i=1;i<=400;i++)estimateRouteAirMargins(aircraft(25,20+i/10),route);
  const before=reads;
  assert.equal(estimateRouteAirMargins(structuredClone(air),route),first);
  assert.equal(reads,before,'ordinary outfit sweeps should not evict the recent trial');
  assert.deepEqual(first,simulateAirPath(air,[node],false).margins);
});

test('jet margin reuse ignores report identity but retains steel, aircraft and proficiency inputs',()=>{
  const route={status:'known',nodes:[combat('A',0),boss],paths:[['A','Z']]};
  const air=aircraft(34,12,57);
  Object.assign(air.slots[0],{masterId:199,shipId:1,slot:0,bomb:15,jetSteel:1000});
  const first=estimateRouteAirMargins(air,route),other=structuredClone(air);
  Object.assign(other.slots[0],{shipId:2,slot:3,bomb:11});
  assert.equal(estimateRouteAirMargins(other,route),first,'identities and bomb power cannot change plane losses');
  const full=estimateRouteAir(air,route),next=estimateRouteAir(other,route);
  assert.notEqual(next,full,'full reports must retain the participating ship and slot');
  assert.equal(next.paths[0].jetStages[0].attacks[0].shipId,2);
  for(const changes of [{jetSteel:0},{masterId:200},{planes:[18,18]},{proficiencyBonus:[2,2]}]){
    const changed=structuredClone(other);Object.assign(changed.slots[0],changes);
    const actual=estimateRouteAirMargins(changed,route);
    assert.notEqual(actual,first);assert.deepEqual(actual,simulateAirPath(changed,route.nodes,false).margins);
  }
});

test('editing an existing slot invalidates its signature including array replacements and unknown states',()=>{
  const route=reference('5-4','BEHIJMP'),fleet=aircraft();
  for(const [key,index,value]of [['planes',0,18],['planes',1,20],['effectiveAntiAir',0,25],
    ['effectiveAntiAir',1,30],['proficiencyBonus',0,3],['proficiencyBonus',1,5]]){
    const before=estimateRouteAir(fleet,route);
    fleet.slots[0][key][index]=value;
    assert.notEqual(estimateRouteAir(fleet,route),before);
    assert.deepEqual(estimateRouteAir(fleet,route).paths[0],simulateAirPath(fleet,route.nodes));
  }
  fleet.slots[0].planes=[10,12];fleet.slots[0].aircraftType=7;
  assert.deepEqual(estimateRouteAir(fleet,route).paths[0],simulateAirPath(fleet,route.nodes));
  fleet.slots[0].unknown='proficiency';
  assert.equal(estimateRouteAir(fleet,route).status,'unknown');
  delete fleet.slots[0].unknown;fleet.slots[0].aircraftType=57;
  assert.equal(estimateRouteAir(fleet,route).status,'unknown');
});

test('converging paths share aviation calculations without merging different battles or terminal losses',()=>{
  const nodes=[{id:'S',noAirBattle:true},{id:'N',noAirBattle:true},combat(),boss];
  const paths=[['S','A','Z'],['N','A','Z'],['A','Z','N'],['Z','A'],['N'],[]];
  const route={status:'known',nodes,paths};
  for(const type of [6,7,11,57]){
    const air=aircraft(25,32,type),estimate=estimateRouteAir(air,route);
    assert.deepEqual(estimate.paths,paths.map(path=>simulateAirPath(air,path.map(id=>nodes.find(n=>n.id===id)))));
    assert.equal(estimate.paths[0],estimate.paths[1],'different quiet entries may share the same result');
    assert.notEqual(estimate.paths[0],estimate.paths[2],'a quiet terminal still needs post-battle losses');
  }
});

test('trial margins equal full reports across slots, air stages, unknown defenses and quiet terminals',()=>{
  let state=12345;const next=n=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state%n;};
  for(let i=0;i<180;i++){
    const air={status:'range',slots:Array.from({length:i%7},()=>({aircraftType:[6,7,8,11,45,57][next(6)],
      planes:[next(40),next(40)],effectiveAntiAir:[next(30),next(30)],proficiencyBonus:[next(25),next(25)]}))};
    const nodes=[combat('A',next(400),['battle','aerialCombat','aerialRaid'][next(3)]),
      {id:'N',noAirBattle:true},{...combat('B',next(200)),boss:i%2===0},boss];
    if(i%5===0)nodes[0].antiAir={status:'unknown',reason:'fixture unknown'};
    if(i%7===0)nodes[2].enemyAirPower=null;
    const paths=[['A','B','Z'],['N','A','B','Z'],['A','N'],[],['Z','A']].slice(0,i%5+1);
    const ref={status:'known',nodes,paths},before=JSON.stringify({air,ref});
    const margins=estimateRouteAirMargins(air,ref);
    const full=estimateRouteAir(air,ref);
    assert.deepEqual(margins,full.margins||null,'fixture '+i);
    assert.deepEqual(full.paths,paths.map(ids=>simulateAirPath(air,ids.map(id=>nodes.find(n=>n.id===id)))));
    assert.deepEqual(estimateRouteAirMargins(air,ref),margins,'full-report cache agrees with trial cache');
    assert.equal(JSON.stringify({air,ref}),before);
  }
});

test('aircraft order shares exact estimates while duplicates and changed scalar inputs remain distinct',()=>{
  const ref={status:'known',nodes:[combat(),boss],paths:[['A','Z']]};
  const air={status:'range',slots:[...aircraft(25,10,7).slots,...aircraft(18,14,6,9).slots]};
  const initial=estimateRouteAirMargins(air,ref),full=estimateRouteAir(air,ref);
  air.slots.reverse();
  assert.equal(estimateRouteAir(air,ref),full);
  assert.deepEqual(estimateRouteAirMargins(air,ref),initial);
  air.slots.push(structuredClone(air.slots[0]));
  assert.notDeepEqual(estimateRouteAirMargins(air,ref),initial,'two identical slots must both count');
  air.slots[0].planes[0]=0;
  assert.deepEqual(estimateRouteAirMargins(air,ref),estimateRouteAir(air,ref).margins);
  air.slots[0].unknown=true;
  assert.equal(estimateRouteAirMargins(air,ref),null);
  assert.equal(estimateRouteAirMargins(air,{status:'unknown'}),null);
});
