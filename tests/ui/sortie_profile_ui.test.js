'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {profileForRoute}=require('../../src/domain/routes/sortie_profile');
const fixed=(from,to)=>({from,assessment:{status:'fixed',destinations:[to]}});

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
  const profile=profileForRoute('3-5',{targetNodes:['K'],pointAssessments:[
    fixed('start','B'),fixed('B','D'),fixed('H','K')]});
  assert.equal(profile.threat.node,'H');assert.equal(profile.threat.status,'incomplete');
  const node=profile.mapPreview.nodes.find(n=>n.id==='H');assert(node.compositionUncertain);
  assert(node.dataWarnings.length);assert(profile.threat.enemies.some(e=>e.apiId===1587||e.apiId===1588));
  assert(profile.threat.enemies.every(e=>!('stats' in e)));
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
