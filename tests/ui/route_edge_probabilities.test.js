'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/workbench_fixture');
const W=require('../../src/ui/workbench/workbench_model');
const P=require('../../src/domain/routes/route_plans');
const {evaluateNormalRoute}=require('../../src/domain/routes/normal_routes');

function routeFor(area,types){
  const state=fixture();
  for(const key of Object.keys(state.info.ships)){
    if(+key>types.length){delete state.info.ships[key];delete state.const.$ships[key];}
    else state.const.$ships[key].api_stype=types[+key-1];
  }
  return evaluateNormalRoute(state,{area,scheme:{fleet:1,ships:types.map((_,index)=>index+1)}});
}
const edgeMap=rows=>Object.fromEntries(rows.map(row=>[row.from+'>'+row.to,row.probability]));
const option=(paths,phase)=>({nodes:paths[0],paths,...phase?{phase}:{}});
// This suite verifies display probabilities for supplied paths, independently
// of which alternate branches the guide catalogue currently recommends.
const mergedUpper=()=>({...P.routeOptions('1-3').find(row=>row.key==='A>E>F>J'),
  ...option([[...'AEFJ'],[...'ADBEFJ']])});

test('1-3 merged A exits display 20/80 conditional odds, not one-path or whole-route totals',()=>{
  const route=routeFor('1-3',[16,3,2,2,2,2]),selected=mergedUpper();
  assert.equal(P.optionPlanning(route,selected).chance.probability,1);
  assert.deepEqual(edgeMap(W.routeEdgeProbabilities(route,selected)),{'A>E':.2,'A>D':.8});
});

test('a random earlier start does not multiply the 1-3 A-exit labels',()=>{
  const route=routeFor('1-3',[3,3,2,2,2,2]),selected=mergedUpper();
  const planned=P.optionPlanning(route,selected);
  assert.deepEqual(planned.branches.map(branch=>branch.chance.probability),[.1,.4]);
  assert.deepEqual(edgeMap(W.routeEdgeProbabilities(route,selected)),{'start>A':.5,'A>E':.2,'A>D':.8});
});

test('2-2 G labels retain 30/70 although entry into the G branch was only 30 percent',()=>{
  const route=routeFor('2-2',[16,8,2,2,2,2]),selected=option([[...'CEGHK'],[...'CEGK']]);
  assert.deepEqual(P.optionPlanning(route,selected).branches.map(branch=>branch.chance.probability),[.09,.21]);
  assert.deepEqual(edgeMap(W.routeEdgeProbabilities(route,selected)),{'E>G':.3,'G>H':.3,'G>K':.7});
});

test('4-5 only random start is labeled; active branches at A/C and fixed D-H are omitted',()=>{
  const route=routeFor('4-5',[3,3,2,2,2,2]),selected=option([[...'CDHT'],[...'ADHT']]);
  assert.deepEqual(edgeMap(W.routeEdgeProbabilities(route,selected)),{'start>C':.5,'start>A':.5});
});

test('shared conditional edge is emitted once rather than adding path probabilities',()=>{
  const route=routeFor('4-5',[8,7,5,5,2,2]),selected=option([[...'CDHKT'],[...'ADHKT'],[...'CDHKT']]);
  route.lineOfSight={status:'computed',rawScoresByCoefficient:{2:65}};
  const rows=W.routeEdgeProbabilities(route,selected),mapped=edgeMap(rows);
  assert.equal(mapped['K>T'],.5);assert.equal(rows.filter(row=>row.from==='K'&&row.to==='T').length,1);
  assert.deepEqual(mapped,{'start>C':.5,'K>T':.5,'start>A':.5});
});

test('different upstream history never produces a false common-edge probability',()=>{
  const route=routeFor('4-5',[8,7,5,5,2,2]),selected=option([[...'ABEKT'],[...'CDHKT']]);
  route.lineOfSight={status:'computed',rawScoresByCoefficient:{2:100}};
  const plans=P.optionPlanning(route,selected);
  assert.equal(plans.branches[0].pointAssessments.find(point=>point.from==='K').assessment.probabilities.find(edge=>edge.to==='T').probability,.5);
  assert.equal(plans.branches[1].pointAssessments.find(point=>point.from==='K').assessment.status,'fixed');
  const rows=W.routeEdgeProbabilities(route,selected);
  assert.equal(rows.some(row=>row.from==='K'&&row.to==='T'),false,'0.5 via E conflicts with 1 via H');
  assert.equal(edgeMap(rows)['start>A'],.5);assert.equal(edgeMap(rows)['start>C'],.5);
});

test('unknown random weights use the existing selected-exit 50 percent policy',()=>{
  // 1-1 ship-count 3 is not assigned a source weight: its two exits use the
  // accepted 50% reference policy. This is distinct from an unknown condition.
  const route=routeFor('1-1',[2,2,2]);
  assert.deepEqual(edgeMap(W.routeEdgeProbabilities(route,{nodes:[...'AC']})),{'A>C':.5});
});

test('unknown three-way random exit uses 50 percent, never an invented uniform third',()=>{
  const route=routeFor('5-1',[8,8,7,3,2,2]),selected={nodes:[...'BCFJ']};
  const assessment=P.planningPath(route,selected.nodes,{allowTentative:false,includeLosRequirements:false})
    .pointAssessments.find(point=>point.from==='F').assessment;
  assert.equal(assessment.status,'random');assert.equal(assessment.referencePathProbability,.5);
  const rows=edgeMap(W.routeEdgeProbabilities(route,selected));
  assert.equal(rows['F>J'],.5);assert.equal(rows['start>B'],.75);
  assert.equal(Object.hasOwn(rows,'F>G'),false);assert.equal(Object.hasOwn(rows,'F>H'),false);
});

test('genuine unknown condition is not replaced with a 50 percent label',()=>{
  const route=routeFor('4-5',[8,7,5,5,2,2]),selected=option([[...'CDHKT'],[...'ADHKT']]);
  route.lineOfSight={status:'unknown'};
  assert.deepEqual(edgeMap(W.routeEdgeProbabilities(route,selected)),{'start>C':.5,'start>A':.5});
});

test('no draft, no selection or wrong phase does not expose stale probability labels',()=>{
  const route=routeFor('1-3',[16,3,2,2,2,2]),selected=P.routeOptions('1-3').find(row=>row.key==='A>E>F>J');
  for(const [snapshot,choice] of [[null,selected],[route,null],[{...route,ships:[]},selected],[{...route,phase:'gauge1'},{...selected,phase:'gauge2'}]]){
    assert.deepEqual(W.routeEdgeProbabilities(snapshot,choice),[]);
  }
});

test('fixed or blocked path exits do not display percentages or labels beyond the blocker',()=>{
  const route=routeFor('1-3',[22,3,2,2,2,2]);
  assert.deepEqual(W.routeEdgeProbabilities(route,{nodes:[...'AEFJ']}),[],'A-E is blocked by supply-ship A-D routing');
  assert.deepEqual(W.routeEdgeProbabilities(route,{nodes:[...'ADBEFJ']}),[],'the full supply-ship path is fixed');
});

test('selected profile carries current labels without mutating its route or static overview',()=>{
  const overview=W.mapOverview('1-3'),selected=mergedUpper();
  const localOverview={...overview,options:[selected]};
  const route=routeFor('1-3',[16,3,2,2,2,2]);
  const before=JSON.stringify({route,overview,localOverview,selected});
  const profile=W.selectedMapProfile(localOverview,selected.key,null,route);
  assert.deepEqual(edgeMap(profile.edgeProbabilities),{'A>E':.2,'A>D':.8});
  assert.equal(JSON.stringify({route,overview,localOverview,selected}),before);
  const reference=W.selectedMapProfile(localOverview,selected.key);
  assert.deepEqual(reference.edgeProbabilities||[],[]);
});
