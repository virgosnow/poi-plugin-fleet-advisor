// Evaluate in poi's main renderer. Read-only recommendation and preview;
// never dispatch a fleet, equipment or expedition action.
(()=>{
  const path=require('path'),assert=require('assert');
  const plugin=window.getStore().plugins.find(p=>p.id==='poi-plugin-fleet-advisor');
  const root=path.dirname(require.resolve(plugin.pluginPath)),store=window.getStore();
  const {recommendExpeditionFleet}=require(path.join(root,'src/recommendation/index'));
  const {evaluateExpedition}=require(path.join(root,'src/domain/expeditions/expeditions'));
  const fleet=store.info.fleets.findIndex((f,i)=>i>0&&Number(f.api_mission?.[0])===0)+1;
  if(fleet<2)throw Error('No idle expedition fleet for read-only preview');
  const before=JSON.stringify({ships:store.info.ships,fleets:store.info.fleets,equips:store.info.equips});
  const checks=[];
  for(const missionId of [1,21,24,37,101]){
    const start=Date.now();
    const output=recommendExpeditionFleet(store,{missionId,fleet,goal:'great',limit:1});
    const row=output.recommendations[0];
    if(row){
      // Keep the observed outfit as the baseline when projecting candidate stats.
      const actual=evaluateExpedition(store,fleet,missionId,row.scheme);
      assert(actual.eligible);assert.equal(actual.greatSuccess.estimatedPercent,row.evaluation.greatSuccess.estimatedPercent);
      assert(actual.greatSuccess.estimatedPercent>=0&&actual.greatSuccess.estimatedPercent<=100);
      checks.push({missionId,eligible:true,probability:actual.greatSuccess.estimatedPercent,flash:actual.greatSuccess.sparkledCount,drums:actual.greatSuccess.drums,shipCount:actual.ships.length,evaluated:output.search.evaluated,ms:Date.now()-start});
    }else checks.push({missionId,reason:output.reason,ms:Date.now()-start});
  }
  assert.equal(JSON.stringify({ships:store.info.ships,fleets:store.info.fleets,equips:store.info.equips}),before);
  return {ok:true,gameUnchanged:true,fleet,checks};
})()
