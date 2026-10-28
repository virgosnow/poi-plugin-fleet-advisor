'use strict';
// Read-only regression scan using a captured poi business-state snapshot.
// No live game APIs, fleet changes, equipment changes or sorties are invoked.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const option=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const storePath=option('--store'),output=option('--output');
if(!storePath||!output)throw Error('Required: --store snapshot.json --output report.json [--plugin-root path]');
const root=path.resolve(option('--plugin-root')||path.join(__dirname,'../..'));
const {recommendNormalFleet}=require(path.join(root,'src/recommendation/index'));
const {Controller}=require(path.join(root,'src/application/controller'));
const {fixedArrivalCondition}=require(path.join(root,'src/domain/routes/normal_routes'));
const store=JSON.parse(fs.readFileSync(storePath,'utf8'));
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const snapshotHash=digest(store),controller=new Controller({getStore:()=>store});
const maps=fs.readdirSync(path.join(root,'data/normal_routes')).filter(f=>/^\d-\d\.json$/.test(f))
  .sort().map(f=>JSON.parse(fs.readFileSync(path.join(root,'data/normal_routes',f),'utf8')));
const scenarios=maps.flatMap(map=>{
  const phases=Object.entries(map.bossPhases||{}).filter(([,bosses])=>bosses.length).map(([phase])=>phase);
  return (phases.length?phases:[undefined]).map(phase=>({area:map.area,
    target:map.bossNodes.length?'boss':map.terminalNodes[0],...(phase?{phase}:{})}));
});
const cases=[],start=Date.now();
for(const scenario of scenarios)for(const airGoal of ['ignore','superiority','supremacy']){
  const query={...scenario,airGoal,fleet:1},caseStart=Date.now();
  const entry={...query,status:'error',recommendations:[]};
  try{
    const result=recommendNormalFleet(store,query);
    for(const row of result.recommendations){
      // Check the complete returned result, including its final arrival proof,
      // and re-run the ordinary preview with the suggested equipment.
      controller.preview('fleet',row.scheme);
      fixedArrivalCondition(row.route);
      const legacy={...row.route};delete legacy.speed;fixedArrivalCondition(legacy);
      entry.recommendations.push({routeKey:row.routeKey,
        ships:row.scheme.ships.map(ship=>({id:ship.id,
          name:store.const.$ships[store.info.ships[ship.id].api_ship_id].api_name})),
        verdict:row.route.verdict,paths:row.profile.examples,
        fixedArrivalCondition:row.route.fixedArrivalCondition,
        airGoalStatus:row.scores.airGoalStatus,airGoalRequired:row.scores.airGoalRequired,
        airPower:row.route.airControl?.fleetAirPower,
        routeStatus:row.profile.status});
    }
    entry.status=result.recommendations.length?'passed':'noRecommendation';
    entry.search=result.search;entry.reason=result.reason||null;entry.warnings=result.warnings||[];
    if(digest(store)!==snapshotHash)throw Error('Recommendation mutated the input snapshot');
  }catch(e){entry.status='error';entry.error={message:e.message,stack:e.stack};}
  entry.durationMs=Date.now()-caseStart;cases.push(entry);
  console.log(JSON.stringify({area:entry.area,phase:entry.phase||null,airGoal,status:entry.status,
    count:entry.recommendations.length,...(entry.error?{error:entry.error.message}:{})}));
}
const summary={maps:maps.length,scenarios:scenarios.length,cases:cases.length,
  passed:cases.filter(c=>c.status==='passed').length,
  noRecommendation:cases.filter(c=>c.status==='noRecommendation').length,
  errors:cases.filter(c=>c.status==='error').length,
  recommendations:cases.reduce((sum,c)=>sum+c.recommendations.length,0),
  airConfirmedCases:cases.filter(c=>c.airGoal!=='ignore'&&c.recommendations.some(r=>
    ['meetsAtStart','noEnemyAirPower'].includes(r.airGoalStatus))).length,
  snapshotUnchanged:digest(store)===snapshotHash,durationMs:Date.now()-start};
fs.writeFileSync(output,JSON.stringify({capturedAt:new Date().toISOString(),pluginRoot:root,
  snapshotHash,ships:Object.keys(store.info.ships).length,equipment:Object.keys(store.info.equips).length,
  summary,cases},null,2));
console.log(JSON.stringify(summary));
if(summary.errors||!summary.snapshotUnchanged)process.exitCode=1;
