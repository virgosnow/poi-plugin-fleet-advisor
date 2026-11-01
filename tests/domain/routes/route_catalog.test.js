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
    const area=key.split(':')[0],options=P.routeOptions(area,m.target,m.phase||undefined).filter(o=>o.recommend!==false&&!o.fallback);
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
test('each catalog objective exposes a broadly compatible option built from actual map paths',()=>{
  const {previewForMap}=require('../../../src/domain/routes/sortie_profile');
  for(const [key,entry] of Object.entries(catalog.maps)){
    const area=key.split(':')[0],phase=entry.phase||undefined;
    const options=P.recommendedOptions(area,entry.target,phase),fallback=options.filter(option=>option.fallback);
    assert.equal(fallback.length,1,key);
    assert.equal(fallback[0].name,'自适应路线');assert.deepEqual(fallback[0].fleetRequirement,require('../../../data/normal_routes/'+area+'.json').sortieRequirement);
    assert.equal(fallback[0].templates,null);assert.equal(fallback[0].strategy,undefined);
    const actual=previewForMap(area,{target:entry.target,phase}).routePaths.map(path=>path.nodes.join('>'));
    assert(actual.length,key);assert.deepEqual(P.optionPaths(fallback[0]).map(nodes=>nodes.join('>')),actual,key);
  }
});
test('6-3 compatible and custom paths preserve mandatory sortie composition',()=>{
  const options=P.routeOptions('6-3').filter(option=>option.fallback||option.recommend===false);
  assert(options.length>1);
  const eligible=(option,types)=>P.fleetRequirementAssessment({ships:types.map(stype=>({stype}))},option).eligible;
  for(const option of options){
    assert(eligible(option,[16,3,2,2,2,2]));
    for(const types of [[16,3,2,2,2,8],[3,2,2,2,2,2],[16,2,2,2,2,2],[16,3,3,3,3,2],[16,16,16,3,2,2],[16,3,3,3,3,3]])
      assert(!eligible(option,types),JSON.stringify(types));
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
test('all stages expose every curated option without mixing optional unlock targets',()=>{
  for(const area of ['5-6','7-2','7-3','7-5']){
    const phases=Object.keys(require('../../../data/normal_routes/'+area+'.json').bossPhases);
    for(let i=0;i<phases.length;i++){
      const store={info:{maps:{[Number(area.replace('-',''))]:{api_gauge_num:i+1}}}};
      const selected=P.recommendedOptions(area,'boss',undefined,{maxRoutes:5},store);
      for(const phase of phases)assert.equal(selected.filter(r=>r.phase===phase&&!r.fallback).length,
        catalog.maps[area+':'+phase].routes.length);
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
