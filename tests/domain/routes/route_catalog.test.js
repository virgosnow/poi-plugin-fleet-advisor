'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../../../src/domain/routes/route_plans');
const W=require('../../../src/ui/workbench/workbench_model');
const catalog=require('../../../data/normal_route_guides.json');
const witnesses=require('../../fixtures/route_catalog_witnesses.json');
const {guidePolicy}=require('../../../src/recommendation/strategies');
test('reviewed catalog covers all 37 maps, all 43 objectives and two optional unlocks with Chinese names',()=>{
  assert.equal(new Set(Object.keys(catalog.maps).map(k=>k.split(':')[0])).size,37);
  assert.equal(Object.values(catalog.maps).filter(m=>m.target==='boss'||m.target==='N').length,43);
  for(const [key,m] of Object.entries(catalog.maps)){
    const area=key.split(':')[0],options=P.routeOptions(area,m.target,m.phase||undefined).filter(o=>o.recommend!==false);
    assert.equal(options.length,m.routes.length,key);
    assert.equal(new Set(options.map(o=>o.key)).size,options.length);
    assert.equal(new Set(options.map(o=>o.name)).size,options.length,key);
    assert(options.length>=2,key);
    for(const r of options){assert.match(r.name,/^[\p{Script=Han}]+$/u);assert(r.templates?.length);assert(r.fleetRequirement);assert(r.summary);}
    const policy=guidePolicy(area,m.target,m.phase||undefined);
    assert(policy,key);assert(policy.templates.length>0);
    assert(m.source.startsWith('https://wikiwiki.jp/'));
  }
});
for(const w of witnesses)test(`catalog ${w.id} follows actual branch order, preserves hull requirements and renders all possible branches`,()=>{
  const m=catalog.maps[w.catalog],area=w.catalog.split(':')[0];
  const option=P.routeOptions(area,m.target,m.phase||undefined).find(o=>o.id===w.id);
  assert(option,w.id);
  const ships=w.types.map((stype,i)=>({instanceId:i+1,stype,name:w.names[i]||'测试舰'+i,openingTorpedo:[3,4,13,14,16].includes(stype),radarEquipped:i<w.radars,drumEquipped:i<w.drums,landingCraftEquipped:false}));
  const route={area,phase:m.phase||undefined,targetNodes:[w.paths[0].at(-1)],ships,
    speed:{status:'observed',fleetSpeed:w.speed,ships:ships.map(s=>({shipId:s.instanceId,speed:w.speed,status:'observed'}))},
    lineOfSight:{status:'computed',rawScoresByCoefficient:Object.fromEntries([1,2,3,4].map(c=>[c,w.los])),thresholdMargin:0}};
  assert(P.fleetRequirementAssessment(route,option).eligible);
  assert(!P.fleetRequirementAssessment({...route,ships:[]},option).eligible);
  const planning=P.optionPlanning(route,option);
  assert(Math.abs(planning.chance.probability-w.probability)<1e-8,`${w.id}: ${planning.chance.probability} vs ${w.probability}`);
  assert(planning.chance.max>0);
  const live=P.fleetPathOption(route,option);
  assert.deepEqual(P.optionPaths(option),w.paths);
  for(const nodes of live.displayPaths||P.optionPaths(live))assert(P.planningPath(route,nodes).chance.max>0);
  const overview=W.mapOverview(area,m.target,m.phase||undefined,{maxRoutes:20});
  if(!overview.options.some(o=>o.key===option.key))overview.options.push(option);
  const profile=W.selectedMapProfile(overview,option.key,null,route);
  assert.deepEqual(profile.highlightPaths,w.paths);
  if(option.strategy)assert(P.strategyAssessment(route,option).eligible);
});
test('current-phase quotas and optional unlock targets do not mix fleets from different stages',()=>{
  for(const area of ['5-6','7-2','7-3','7-5']){
    const phases=Object.keys(require('../../../data/normal_routes/'+area+'.json').bossPhases);
    for(let i=0;i<phases.length;i++){
      const store={info:{maps:{[Number(area.replace('-',''))]:{api_gauge_num:i+1}}}};
      const selected=P.recommendedOptions(area,'boss',undefined,{maxRoutes:5},store);
      assert(selected.length<=5);
      for(const phase of phases)assert.equal(selected.filter(r=>r.phase===phase).length,
        phase===phases[i]?Math.min(catalog.maps[area+':'+phase].routes.length,6-phases.length):1);
      assert(selected.every(r=>r.phaseLabel&&!r.name.includes('阶段')));
    }
  }
});
test('report corrections are executable requirements instead of label-only promises',()=>{
  const pick=(area,id,phase)=>P.routeOptions(area,'boss',phase).find(o=>o.id===id);
  const g1=pick('7-3','7-3-02','gauge1');assert.match(JSON.stringify(g1.fleetRequirement),/羽黒/);assert(!JSON.stringify(g1.fleetRequirement).includes('神風'));
  const g2=pick('7-3','7-3-06','gauge2');assert(g2.templates[0].some(t=>t.includes(3)&&t.includes(4)&&t.includes(16)));
  const heavy=pick('5-6','5-6-heavy-fast','gauge3');assert.equal(heavy.strategy.minimumSpeed,'fastPlus');
  const torpedo=pick('1-4','1-4-05');assert.match(JSON.stringify(torpedo.fleetRequirement),/openingTorpedoCarriers/);
  assert.equal(P.optionPaths(torpedo).map(p=>p.join('')).sort().join('/'),'ADEHL/BDEHL');
});
