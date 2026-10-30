'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {profileForRoute}=require('../../src/domain/routes/sortie_profile');
const W=require('../../src/ui/workbench/workbench_model');
const fixed=(from,to)=>({from,assessment:{status:'fixed',destinations:[to]}});

test('boss display retains first documented main-fleet flagship independently of threat ranking',()=>{
  for(const [area,node,apiId] of [['1-1','C',1505],['2-5','O',1529],['5-6','G',1548],['5-6','Z',1971]]){
    const profile=W.mapOverview(area).profile;
    const summary=profile.mapPreview.nodes.find(row=>row.id===node);
    assert(summary?.boss,`${area} ${node} must be a boss node`);
    assert.equal(summary.bossFlagship.apiId,apiId);
    const card=W.displayBossFlagship(profile,node);
    assert.equal(card.enemies.length,1);assert.equal(card.enemies[0].apiId,apiId);
    assert.deepEqual(card.enemies[0].nodes,[node]);
  }
  const ordinary=W.mapOverview('1-1').profile;
  assert.equal(W.displayBossFlagship(ordinary,'A'),null,'non-Boss nodes retain their own threat policy');
  assert.equal(W.displayBossFlagship(W.mapOverview('1-6','N').profile,'N'),null,'noncombat destinations keep enroute threats');
});

test('boss card and enlarged-map formations follow known gauge stage without contaminating cached previews',()=>{
  const {nodeFormations}=require('../../src/ui/maps/node_formations');
  const store={info:{maps:{45:{api_gauge_type:1,api_required_defeat_count:5,api_defeat_count:0}}}};
  const before=W.mapOverview('4-5','boss',undefined,undefined,store).profile;
  assert.equal(before.encounterStage,'before');
  assert.equal(W.displayBossFlagship(before,'T').enemies[0].apiId,1573);
  assert.equal(nodeFormations('4-5','T',before.encounterStage)[0].ships[0].apiId,1573);
  store.info.maps[45].api_defeat_count=4;
  const final=W.mapOverview('4-5','boss',undefined,undefined,store).profile;
  assert.equal(final.encounterStage,'final');
  assert.equal(W.displayBossFlagship(final,'T').enemies[0].apiId,1613);
  assert.equal(nodeFormations('4-5','T',final.encounterStage)[0].ships[0].apiId,1613);
  assert.equal(W.displayBossFlagship(before,'T').enemies[0].apiId,1573,'old cached preview is not mutated');
});

test('multi-gauge preview does not reuse the active gauge state for another phase',()=>{
  const store={info:{maps:{56:{api_gauge_type:1,api_gauge_num:3,api_required_defeat_count:3,api_defeat_count:2}}}};
  const overview=W.mapOverview('5-6','boss',undefined,undefined,store);
  const phase3=overview.options.find(option=>option.phase==='gauge3');
  const phase1=overview.options.find(option=>option.phase==='gauge1');
  const selected3=W.selectedMapProfile(overview,phase3.key,null,null,false,store);
  const selected1=W.selectedMapProfile(overview,phase1.key,null,null,false,store);
  assert.equal(selected3.encounterStage,'final');
  assert.equal(W.displayBossFlagship(selected3,'Z').enemies[0].apiId,1974);
  assert.equal(selected1.encounterStage,'notCleared','a different gauge must not inherit active last-dance or whole-map-clear state');
});

test('profile reuse follows resolved paths and retains uncertainty, targets and changed branches',()=>{
  const route={targetNodes:['C'],pointAssessments:[fixed('A','C')]};
  const first=profileForRoute('1-1',route);
  assert.equal(profileForRoute('1-1',JSON.parse(JSON.stringify(route))),first);
  route.pointAssessments[0].assessment.status='unknown';
  const uncertain=profileForRoute('1-1',route);
  assert.notEqual(uncertain,first);assert.equal(uncertain.status,'possible');
  assert.equal(first.status,'known');
  route.targetNodes=['B'];route.pointAssessments=[fixed('A','B')];
  const other=profileForRoute('1-1',route);
  assert.notEqual(other,first);assert.deepEqual(other.routePaths[0].nodes,['A','B']);
  route.pointAssessments=[fixed('A','C')];
  assert.equal(profileForRoute('1-1',route).status,'unavailable');
});

test('boss entry fuel and ammo exclude boss battle, with genuine enemy identities and alternate exits',()=>{
  const profile=profileForRoute('1-1',{targetNodes:['C'],pointAssessments:[fixed('A','C')]});
  assert.deepEqual(profile.fuelAtTargetPercent,{minimum:80,maximum:80});
  assert.deepEqual(profile.ammoAtTargetPercent,{minimum:80,maximum:80});
  assert.equal(profile.counts.surface.minimum,2);
  assert(profile.mapPreview.edges.some(e=>e.from==='A'&&e.to==='B'));
  assert.equal(profile.threat.node,'A');assert(profile.threat.enemies.every(e=>e.apiId>=1500));
});

test('submarine route preserves ammo while consuming fuel and identifies submarine threat',()=>{
  const profile=profileForRoute('1-5',{targetNodes:['J'],pointAssessments:[fixed('D','E'),fixed('E','J')]});
  // A, D, E submarine fights precede J; only the boss fight spends ammo.
  assert.deepEqual(profile.fuelAtTargetPercent,{minimum:76,maximum:76});
  assert.deepEqual(profile.ammoAtTargetPercent,{minimum:100,maximum:100});
  assert(profile.threat.enemies.some(e=>/潜水/.test(e.type)));
});

test('unknown aerial consumption cannot produce a definite boss-entry resource percentage',()=>{
  const profile=profileForRoute('5-2',{targetNodes:['O'],pointAssessments:[
    fixed('start','B'),fixed('C','E'),fixed('F','I')]});
  assert.equal(profile.fuelAtTargetPercent,null);assert.equal(profile.ammoAtTargetPercent,null);
});

test('pending composition conflicts downgrade maximum-threat certainty without using disputed stats',()=>{
  // 6-2 I still has genuinely different documented enemy compositions.
  const profile=profileForRoute('6-2',{targetNodes:['K'],pointAssessments:[
    fixed('start','C'),fixed('C','E'),fixed('E','I'),fixed('I','K')]});
  assert.equal(profile.threat.status,'incomplete');
  const node=profile.mapPreview.nodes.find(n=>n.id==='I');assert(node.compositionUncertain);
  assert(node.dataWarnings.length);assert(profile.threat.enemies.some(e=>e.apiId===1529));
  assert(profile.threat.enemies.every(e=>!('stats' in e)));
});

test('3-5 H uses verified enemy identities after stale composition conflicts are resolved',()=>{
  const profile=profileForRoute('3-5',{targetNodes:['K'],pointAssessments:[
    fixed('start','B'),fixed('B','D'),fixed('H','K')]});
  const node=profile.mapPreview.nodes.find(n=>n.id==='H');
  assert.equal(node.compositionUncertain,false);
  assert.equal(profile.threat.node,'H');assert.equal(profile.threat.status,'qualitative');
  assert(profile.threat.enemies.some(e=>e.apiId===1587||e.apiId===1588));
});

test('3-5 upper-route threats merge northern princess variants and include other en-route families',()=>{
  const profile=profileForRoute('3-5',{targetNodes:['K'],pointAssessments:[
    fixed('start','B'),fixed('B','D'),fixed('H','K')]});
  const northern=profile.threat.enemies.filter(e=>e.familyKey==='北方棲姫');
  assert.equal(northern.length,1);assert.equal(northern[0].name,'北方栖姬');
  assert.equal(northern[0].variantCount,4);
  assert.deepEqual(northern[0].encounterCount,{minimum:1,maximum:1});
  assert.deepEqual(northern[0].nodes,['H']);
  const battleship=profile.threat.enemies.find(e=>e.familyKey==='戦艦タ級');
  assert.deepEqual(battleship.nodes,['B','D']);
  assert.deepEqual(battleship.encounterCount,{minimum:2,maximum:2});
  assert(profile.threat.enemies.some(e=>e.type==='正規空母'));
  assert.equal(new Set(profile.threat.enemies.map(e=>e.familyKey)).size,profile.threat.enemies.length);
  const fort=profile.mapPreview.nodes.find(n=>n.id==='H').enemyFamilies.find(e=>e.familyKey==='護衛要塞');
  // True multiple copies in one formation survive grouping; six alternative
  // formations are not summed into a fictitious fleet of fortresses.
  assert.deepEqual(fort.countRange,{minimum:2,maximum:5});
});

test('threats follow one selected path and mutually exclusive routes are not added together',()=>{
  const profile=profileForRoute('3-5',{targetNodes:['K'],pointAssessments:[
    {from:'start',assessment:{status:'random',destinations:['B','F']}},
    fixed('B','D'),fixed('H','K'),fixed('F','G'),fixed('G','K')]});
  const upper=profile.routePaths.find(p=>p.nodes.includes('H'));
  const lower=profile.routePaths.find(p=>p.nodes.includes('G'));
  assert(upper&&lower);
  assert.deepEqual(upper.threat.enemies.find(e=>e.familyKey==='北方棲姫').encounterCount,{minimum:1,maximum:1});
  assert(!lower.threat.enemies.some(e=>e.familyKey==='北方棲姫'));
  for(const path of profile.routePaths)for(const enemy of path.threat.enemies)
    assert(enemy.nodes.every(id=>path.nodes.slice(0,-1).includes(id)));
  assert.deepEqual(profile.threat.enemies.find(e=>e.familyKey==='北方棲姫').encounterCount,{minimum:0,maximum:1});
});

test('path walking reuse separates zero-weight exits and selected-path filtering',()=>{
  const route={targetNodes:['C'],pointAssessments:[{from:'A',assessment:{status:'random',destinations:['B','C'],probabilities:[{probability:.5},{probability:.5}]}}]};
  const full=profileForRoute('1-1',route);assert.equal(full.routePaths.length,1);
  assert.equal(profileForRoute('1-1',route,[['A','B']]).status,'unavailable');
  assert.equal(profileForRoute('1-1',route),full,'filtering must not erase the cached full path set');
  route.pointAssessments[0].assessment.probabilities[1].probability=0;
  assert.equal(profileForRoute('1-1',route).status,'unavailable');
  route.pointAssessments[0].assessment.probabilities[1].probability=.8;
  assert.equal(profileForRoute('1-1',route),full);
});

test('7-4 walking retains path-dependent LoS gates even when displayed branch exits are identical',()=>{
  const route={targetNodes:['P'],ships:Array.from({length:6},()=>({stype:2})),
    lineOfSight:{scoresByCoefficient:{4:40},thresholdMargin:0},pointAssessments:[
      fixed('start','C'),fixed('C','E'),fixed('E','J'),
      {from:'J',assessment:{status:'unknown',destinations:['K','L','P']}},fixed('K','M'),fixed('M','P')]};
  const high=profileForRoute('7-4',route);assert(high.routePaths.every(p=>p.nodes.includes('L')));
  route.lineOfSight.scoresByCoefficient[4]=32;
  const low=profileForRoute('7-4',route);assert(low.routePaths.every(p=>p.nodes.includes('K')));
  route.lineOfSight.scoresByCoefficient[4]=35;
  const middle=profileForRoute('7-4',route);assert(middle.routePaths.some(p=>p.nodes.includes('K')));assert(middle.routePaths.some(p=>p.nodes.includes('L')));
  assert(!middle.routePaths.some(p=>p.nodes.at(-2)==='J'));
});
