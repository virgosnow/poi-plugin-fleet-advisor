'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const W=require('../../src/ui/workbench/workbench_model');
const plans=require('../../src/domain/routes/route_plans');
const {previewForMap}=require('../../src/domain/routes/sortie_profile');
const {evaluateNormalRoute}=require('../../src/domain/routes/normal_routes');
const fixture=require('../helpers/workbench_fixture');
const render=require('../../src/ui/maps/route_preview');
const catalog=fs.readdirSync(path.join(__dirname,'../../data/normal_routes')).filter(f=>/^\d-\d\.json$/.test(f)).flatMap(file=>{
  const area=file.slice(0,-5),target=area==='1-6'?'N':'boss';
  return plans.routeOptions(area,target).filter(o=>plans.optionPaths(o).length>1).map(option=>({area,target,option,
    overview:{profile:previewForMap(area,{target,phase:option.phase}),options:[option]}}));
});
const h=(type,props,...children)=>({type,props:props||{},children});
const collect=(tree,p)=>!tree||typeof tree!=='object'?[]:[...(p(tree)?[tree]:[]),...(tree.children||[]).flatMap(n=>collect(n,p))];
function drawnEdges(profile,fixedNodes){
  const tree=render(h,{profile,compact:true,fixedNodes,showPaths:false,showDetails:false,onNode:()=>{}});
  return collect(tree,n=>n.props.className==='paa-real-route'||/^paa-map-edge active(?: |$)/.test(n.props.className||''))
    .map(n=>n.props.key).filter(key=>!key.startsWith('start#')).sort();
}
const edges=paths=>[...new Set(paths.flatMap(nodes=>nodes.slice(1).map((to,i)=>`${nodes[i]}>${to}`)))].sort();
function fleet(types,speed,los){
  const store=fixture();
  types.forEach((type,i)=>{
    const id=i+1;store.const.$ships[id].api_stype=type;store.const.$ships[id].api_soku=speed;
    store.info.ships[id].api_soku=speed;store.info.ships[id].api_sakuteki=[los,los];
  });
  return {store,scheme:{fleet:1,ships:types.map((_,i)=>i+1)}};
}

test('every merged normal-map style previews all alternatives only with an empty fleet',()=>{
  assert(catalog.length>=22);assert(new Set(catalog.map(c=>c.area)).size>=12);
  for(const {area,option,overview} of catalog){
    const requested=plans.optionPaths(option),profile=W.selectedMapProfile(overview,option.key);
    assert.deepEqual(profile.highlightPaths,requested,`${area} ${option.label}`);
    assert.deepEqual(profile.edgeProbabilities,[]);
    for(const expanded of [false,true])assert.deepEqual(drawnEdges(profile,expanded),edges(requested),`${area} empty ${expanded}`);
  }
});

test('all merged catalogs render exactly the possible branches for hull, speed and LoS variations',()=>{
  const formations=[[16,2,2,7,3,5],[3,2,2,2,2,2],[9,9,11,11,2,2],[13,13,13,13,13,13],
    [10,10,2,2,11,3],[22,3,2,2,7,7],[8,5,6,3,2,2],[1,1,1,1]];
  let blocked=0,filtered=0,multiple=0;
  for(const {area,target,option,overview} of catalog)for(const types of formations)for(const speed of [5,10,15,20])for(const los of [1,200]){
    const {store,scheme}=fleet(types,speed,los),route=evaluateNormalRoute(store,{area,target,phase:option.phase,scheme});
    const expected=plans.optionPaths(option).filter(nodes=>plans.planningPath(route,nodes,
      {allowTentative:false,includeLosRequirements:false}).chance.max>0);
    const before=JSON.stringify(route),profile=W.selectedMapProfile(overview,option.key,null,route);
    assert.deepEqual(profile.highlightPaths,expected,`${area} ${option.key} ${types} speed ${speed} LoS ${los}`);
    assert.equal(JSON.stringify(route),before,'display calculation must not mutate route facts');
    if(!expected.length)blocked++;
    else if(expected.length<plans.optionPaths(option).length)filtered++;
    if(expected.length>1)multiple++;
    // Verify both renderers for every combination, including the zero-path case.
    for(const expanded of [false,true])assert.deepEqual(drawnEdges(profile,expanded),edges(expected),`${area} fleet ${expanded}`);
  }
  assert(blocked>0);assert(filtered>0);assert(multiple>0,'real random alternatives must survive the filter');
});

test('blocked, pending and wrong-phase fleets never fall back to complete style highlighting',()=>{
  for(const {area,option,overview} of catalog){
    const pending=W.selectedMapProfile(overview,option.key,null,null,true);
    assert.deepEqual(pending.highlightPaths,[],area+' pending');assert.deepEqual(pending.edgeProbabilities,[]);
    const stale=W.selectedMapProfile(overview,option.key,null,{area:'other-map',ships:[{}]},true);
    assert.deepEqual(stale.highlightPaths,[],area+' stale');
    if(option.phase){
      const phase=W.selectedMapProfile(overview,option.key,null,{area,phase:'other-phase',ships:[{}]},true);
      assert.deepEqual(phase.highlightPaths,[],area+' wrong phase');
    }
  }
  const overview=W.mapOverview('3-5'),{store,scheme}=fleet([3,2,2,2,2,2],10,1);
  const route=evaluateNormalRoute(store,{area:'3-5',scheme});
  const blocked=W.selectedMapProfile(overview,'lower',null,route);
  assert.deepEqual(blocked.highlightPaths,[],'known inadequate LoS blocks the selected path');
  assert(blocked.routePaths.length,'reference targets remain available for equipment mechanisms and inspection');
  const tree=render(h,{profile:blocked,compact:true,onNode:()=>{}});
  assert.equal(collect(tree,n=>n.props.className?.startsWith('paa-map-node active')).length,0);
  assert(collect(tree,n=>n.props['aria-label']==='地图节点图例')[0]?.children.length,'a gray map still needs its legend');
  const unknown=W.selectedMapProfile(overview,'lower',null,{...route,lineOfSight:{status:'unknown'}});
  assert.deepEqual(unknown.highlightPaths,[['F','G','K']],'missing data is not proof that a branch is impossible');
});
