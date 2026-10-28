'use strict';
// Offline audit: every displayed route gets a row, including no-result cases.
// Do not reduce acceptance to "this map returned at least one recommendation".
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const option=n=>process.argv[process.argv.indexOf(n)+1],root=path.resolve(__dirname,'../..');
const store=JSON.parse(fs.readFileSync(option('--store'),'utf8')),before=JSON.stringify(store);
const {Controller}=require('../../src/application/controller'),controller=new Controller({getStore:()=>store});
const {optionPaths,optionPlanning,pathChance,routeOptions,recommendedOptions,strategyAssessment}=require('../../src/domain/routes/route_plans');
let recommend=require('../../src/recommendation/index').recommendNormalFleet;
if(process.argv.includes('--baseline-runtime'))
  recommend=require(path.resolve(option('--baseline-runtime'),'src/recommendation/index')).recommendNormalFleet;
if(process.argv.includes('--baseline')){
  const Module=require('module'),dir=option('--baseline');
  const load=(file,source,override)=>{const m=new Module(file,module);m.filename=file;m.paths=module.paths;
    if(override){const original=m.require.bind(m);m.require=id=>id==='./route_plans'?override:original(id);}
    m._compile(fs.readFileSync(source,'utf8'),file);return m.exports;};
  const routes=load(path.join(root,'src/domain/routes/route_plans.js'),path.join(dir,'route-plans-before.js'));
  recommend=load(path.join(root,'src/recommendation/index.js'),path.join(dir,'recommendations-before.js'),routes).recommendNormalFleet;
}
const cases=[];
const maxRoutes=process.argv.includes('--max-routes')?Number(option('--max-routes')):5;
assert(Number.isInteger(maxRoutes)&&maxRoutes>=1&&maxRoutes<=20,'--max-routes must be 1–20');
const areas=process.argv.includes('--area')?new Set(option('--area').split(',')):null;
const maps=fs.readdirSync(path.join(root,'data/normal_routes')).filter(n=>/^\d-\d\.json$/.test(n)).sort().map(n=>require(path.join(root,'data/normal_routes',n))).filter(map=>!areas||areas.has(map.area));
(async()=>{
for(const map of maps){
  const phases=Object.entries(map.bossPhases||{}).filter(([,nodes])=>nodes.length).map(([phase])=>phase);
  for(const phase of phases.length?[...phases,undefined]:[undefined]){
    const target=map.bossNodes.length?'boss':map.terminalNodes[0],start=Date.now();
    const args={area:map.area,target,phase,airGoal:'superiority',automaticFilters:{maxRoutes}};
    let result;
    if(process.argv.includes('--parallel')){
      const {RecommendationPool}=require('../../src/infrastructure/workers/recommendation_pool');
      const pool=new RecommendationPool(store);
      try{result=await require('../../src/recommendation/index').recommendNormalFleetParallel(store,args,(b,f)=>pool.run(b,f));}
      finally{await pool.dispose();}
      if(process.argv.includes('--compare-serial'))assert.deepEqual(result,recommend(store,args),`${map.area} ${phase||'auto'} serial/parallel mismatch`);
    }else result=recommend(store,args);
    assert.equal(result.routeResults.length,(process.argv.includes('--baseline')&&!process.argv.includes('--parallel')?routeOptions(map.area,target,phase):recommendedOptions(map.area,target,phase,{maxRoutes},store)).length);
    const routes=result.routeResults.map(r=>{
      const row=r.recommendationIndex===null?null:result.recommendations[r.recommendationIndex];
      if(!row){
        assert(r.message&&r.diagnostics?.warnings?.length,'missing actionable diagnosis: '+map.area+' '+r.key);
        return {key:r.key,label:r.label,basis:r.basis,status:r.status,message:r.message,diagnostics:r.diagnostics};
      }
      controller.preview('fleet',row.scheme);
      assert(row.profile.routePaths.some(p=>optionPaths(r).some(nodes=>p.nodes.join('>')===nodes.join('>'))));
      const observed=pathChance(row.route,r.nodes),strategy=strategyAssessment(row.route,r);
      const planning=optionPlanning(row.route,r);
      if(!process.argv.includes('--baseline')||process.argv.includes('--parallel')){
        if(strategy)assert(strategy.eligible,'speed/radar strategy requirement not met');
        assert.deepEqual(strategy?.chance||planning.chance,r.chance);
        assert(r.chance.probability>0,'unknown or impossible route returned as a recommendation');
        assert.equal(r.status,'available');
      }
      return {key:r.key,label:r.label,basis:r.basis,status:r.status,observed,reported:r.chance,strictChance:strategy?.chance||planning.chance,planning,air:row.scores.airGoalStatus,
        quality:{strength:row.scores.strengthProxy,surface:row.scores.surfaceStrengthProxy,night:row.scores.nightStrengthProxy,
          asw:row.scores.aswStrengthProxy,openingAsw:row.scores.openingAswCount,airTier:row.scores.airGoalTier,
          aswCombat:row.scores.aswCombat,
          aswItems:row.scheme.ships.reduce((n,e)=>n+e.slots.concat(e.ex).filter(id=>[14,15,40].includes(Number(store.const.$equips[store.info.equips[id]?.api_slotitem_id]?.api_type?.[2]))).length,0),
          cost:row.scores.sortieCostProxy,special:row.scores.specialAttack?.label||null},
        scheme:row.scheme,ships:row.scheme.ships.map(s=>store.const.$ships[store.info.ships[s.id].api_ship_id].api_name)};
    });
    assert.equal(JSON.stringify(store),before);
    const row={area:map.area,phase:phase||null,durationMs:Date.now()-start,routes,search:result.search};cases.push(row);
    fs.writeFileSync(option('--output'),JSON.stringify({cases},null,2));
    console.log(JSON.stringify({area:row.area,phase:row.phase,routes:routes.map(r=>({key:r.key,status:r.status,shortfall:r.planning?.losShortfall,blocked:r.planning?.chance.max===0}))}));
  }
}
const rows=cases.flatMap(c=>c.routes),summary={maps:maps.length,scenarios:cases.length,routes:rows.length,returned:rows.filter(r=>r.scheme).length,notFound:rows.filter(r=>!r.scheme).length,
  fixed:rows.filter(r=>r.strictChance?.probability===1).length,random:rows.filter(r=>r.strictChance?.probability>0&&r.strictChance.probability<1).length,
  uncertainRecommendations:rows.filter(r=>r.scheme&&r.strictChance?.probability===null).length,
  estimatedBlocked:rows.filter(r=>r.planning?.chance.max===0).length,losShortfalls:rows.filter(r=>r.planning?.losShortfall>0).length,snapshotUnchanged:JSON.stringify(store)===before};
fs.writeFileSync(option('--output'),JSON.stringify({summary,cases},null,2));console.log(JSON.stringify(summary));
})().catch(e=>{console.error(e);process.exitCode=1;});
