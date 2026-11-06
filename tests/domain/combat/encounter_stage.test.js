'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {encounterStage,filterFormations,applyCrosscheckEvidence}=require('../../../src/domain/combat/encounter_stage');
const {formationRecords,routeEncounters}=require('../../../src/domain/combat/combat_encounters');
const store=(id,row)=>({info:{maps:{[id]:row}}});
const phases=(area,id)=>formationRecords(require(`../../../data/sortie/encounters/${area}.json`).nodes[id]).formations;

test('gauge counters distinguish reduction, final and cleared even after historical clear',()=>{
  const map={api_gauge_type:1,api_required_defeat_count:4,api_defeat_count:0,api_cleared:1};
  assert.equal(encounterStage(store(35,map),'3-5'),'before');
  map.api_defeat_count=3;assert.equal(encounterStage(store(35,map),'3-5'),'final');
  map.api_defeat_count=4;assert.equal(encounterStage(store(35,map),'3-5'),'after');
  delete map.api_required_defeat_count;delete map.api_defeat_count;
  assert.equal(encounterStage(store(35,map),'3-5'),'unknown');
  map.api_defeat_count=0;assert.equal(encounterStage(store(35,map),'3-5'),'unknown');
  delete map.api_defeat_count;delete map.api_cleared;
  assert.equal(encounterStage(store(35,map),'3-5'),'unknown');
  map.api_required_defeat_count=4;map.api_defeat_count=5;
  assert.equal(encounterStage(store(35,map),'3-5'),'unknown');
  map.api_defeat_count=4;assert.equal(encounterStage(store(35,map),'3-5'),'after');
});
test('selected multi-gauge phase never borrows a different active gauge counter',()=>{
  const map={api_gauge_type:1,api_gauge_num:2,api_required_defeat_count:2,api_defeat_count:1};
  assert.equal(encounterStage(store(56,map),'5-6','gauge1'),'notCleared');
  assert.equal(encounterStage(store(56,map),'5-6','gauge2'),'final');
  assert.equal(encounterStage(store(56,map),'5-6','gauge3'),'notCleared');
  assert.equal(encounterStage(store(56,map),'5-6'),'unknown');
  map.api_gauge_type=2;assert.equal(encounterStage(store(56,map),'5-6','gauge2'),'unknown');
  delete map.api_required_defeat_count;delete map.api_defeat_count;map.api_cleared=1;
  assert.equal(encounterStage(store(56,map),'5-6','gauge2'),'unknown');
});
test('a bare historical clear flag is not proof a monthly gauge is cleared this month',()=>{
  for(const [id,area] of [[35,'3-5'],[45,'4-5'],[55,'5-5'],[65,'6-5'],[74,'7-4']])
    assert.equal(encounterStage(store(id,{api_cleared:1} ),area),'unknown');
  assert.equal(encounterStage(store(64,{api_cleared:1}),'6-4'),'after');
});
test('3-5 final and clear follow fixed forms while retaining the uncertain F node',()=>{
  for(const id of ['E','F','G','H','K']){
    const rows=phases('3-5',id),before=filterFormations('3-5',id,rows,'before');
    assert(before.length&&before.every(row=>row.finalForm!==true));
    for(const stage of ['final','after']){
      const result=filterFormations('3-5',id,rows,stage);
      assert.equal(result[0].finalForm,true);
      if(['E','G','H','K'].includes(id))assert(result.every(row=>row.finalForm===true));
      else assert.equal(result.length,rows.length);
    }
  }
});
test('completed first gauges use their own post-clear pool during the next gauge',()=>{
  for(const [area,id,node] of [['7-2',72,'G'],['7-3',73,'E']]){
    const map={api_gauge_type:1,api_gauge_num:2,api_required_defeat_count:4,api_defeat_count:1};
    const stage=encounterStage(store(id,map),area,'gauge1');
    assert.equal(stage,'priorCleared');
    const rows=phases(area,node),after=filterFormations(area,node,rows,stage);
    assert(after.length);
    if(area==='7-2')assert.deepEqual(after.map(row=>row.pattern),[4,5,6]);
    else assert.deepEqual(after.map(row=>row.pattern),[1,2]);
    assert.equal(encounterStage(store(id,map),area,'gauge2'),'before');
    map.api_defeat_count=4;assert.equal(encounterStage(store(id,map),area,'gauge1'),'after');
    map.api_defeat_count=5;assert.equal(encounterStage(store(id,map),area,'gauge1'),'unknown');
  }
});
test('reviewed final and post-clear pools remain distinct across normal maps',()=>{
  for(const [area,id] of [['7-3','E'],['7-3','P'],['7-4','M'],['7-4','P'],['7-5','K'],['7-5','Q'],['7-5','T']]){
    const rows=phases(area,id),final=filterFormations(area,id,rows,'final');
    assert(final.length&&final.every(row=>row.finalForm===true),`${area} ${id}`);
    assert(filterFormations(area,id,rows,'before').every(row=>row.finalForm!==true),`${area} ${id}`);
  }
  for(const id of ['M','P'])assert(filterFormations('7-4',id,phases('7-4',id),'after').every(row=>row.finalForm!==true));
  assert.deepEqual(filterFormations('5-4','P',phases('5-4','P'),'after').map(row=>row.pattern),[1,2]);
  assert.equal(filterFormations('5-4','P',phases('5-4','P'),'before').length,6);
});
test('7-5 J applies its third-gauge final rule to air, battle and map display only for that gauge',()=>{
  const {routeAirReference}=require('../../../src/domain/routes/route_air'),{nodeFormations}=require('../../../src/ui/maps/node_formations');
  const ref=phase=>routeAirReference({},'7-5',{examples:[['J']],encounterStage:'final',phase});
  const second=ref('gauge2'),third=ref('gauge3');
  assert.equal(second.nodes[0].airFormations.length,4);
  assert.equal(third.nodes[0].airFormations.length,2);
  assert.notStrictEqual(second,third,'phase-specific air results cannot share a stale cache entry');
  assert.deepEqual(nodeFormations('7-5','J','final','gauge3').map(row=>row.pattern),[3,4]);
  assert.equal(nodeFormations('7-5','J','final','gauge2').length,4);
  const profile={area:'7-5',phase:'gauge3',encounterStage:'final',routePaths:[{nodes:['J']}],
    mapPreview:{nodes:[{id:'J'}]}};
  assert.deepEqual(routeEncounters(profile).nodes[0].formations.map(row=>row.pattern),[3,4]);
});
test('5-5 before and final preserve pre-clear patterns and after uses distinct post-clear set',()=>{
  const rows=phases('5-5','S');
  for(const stage of ['before','final'])assert.deepEqual(filterFormations('5-5','S',rows,stage).map(r=>r.pattern),[1,2,3,4,5]);
  assert.deepEqual(filterFormations('5-5','S',rows,'after').map(r=>r.pattern),[6,7,8]);
  assert.equal(filterFormations('5-5','S',rows,'unknown').length,8);
});
test('4-5 T final uses only the documented strengthened boss formations',()=>{
  const rows=phases('4-5','T');
  assert.deepEqual(filterFormations('4-5','T',rows,'before').map(row=>row.pattern),[1,2,3]);
  assert.deepEqual(filterFormations('4-5','T',rows,'final').map(row=>row.pattern),[4,5,6]);
  assert.deepEqual(filterFormations('4-5','T',rows,'after').map(row=>row.pattern),[1,2,3]);
  const {routeAirReference}=require('../../../src/domain/routes/route_air');
  const air=stage=>routeAirReference({},'4-5',{examples:[['T']],encounterStage:stage}).enemyAirPower;
  assert.equal(air('before'),138);assert.equal(air('final'),111);assert.equal(air('after'),138);
});
test('5-6 final and clear select their documented encounter variants',()=>{
  for(const id of ['X','Z']){
    const rows=phases('5-6',id);
    assert.deepEqual(filterFormations('5-6',id,rows,'before').map(r=>r.pattern),[1,2,3]);
    assert.deepEqual(filterFormations('5-6',id,rows,'final').map(r=>r.pattern),[4,5,6]);
    assert.deepEqual(filterFormations('5-6',id,rows,'after').map(r=>r.pattern),[7,8,9]);
    assert.deepEqual(filterFormations('5-6',id,rows,'notCleared').map(r=>r.pattern),[1,2,3,4,5,6]);
  }
});
test('6-5 final uses documented final forms; before and after use normal forms',()=>{
  for(const id of ['A','B','C','D','E','F','G','H','I','J','M']){
    const rows=phases('6-5',id);
    assert(filterFormations('6-5',id,rows,'final').every(row=>row.finalForm===true),id);
    assert(filterFormations('6-5',id,rows,'before').every(row=>row.finalForm!==true),id);
    assert(filterFormations('6-5',id,rows,'after').every(row=>row.finalForm!==true));
    assert.equal(filterFormations('6-5',id,rows,'unknown').length,rows.length);
  }
  const rows=phases('6-5','M');
  assert.deepEqual(filterFormations('6-5','M',rows,'before').map(row=>row.pattern),[1,2]);
  assert.deepEqual(filterFormations('6-5','M',rows,'final').map(row=>row.pattern),[3]);
  assert.deepEqual(filterFormations('6-5','M',rows,'after').map(row=>row.pattern),[1,2]);
  const secondary={source:'kcwiki',finalForm:null,availability:null};
  assert(filterFormations('6-5','M',[...rows,secondary],'final').includes(secondary));
  const unsourced=[{pattern:1,finalForm:null},{source:'kcwiki',finalForm:true}];
  assert.equal(filterFormations('6-5','M',unsourced,'final').length,2,
    'a secondary annotation alone does not prove the primary fleet is unavailable');
});
test('structured route encounters use the same stage filter for each visited battle',()=>{
  const data=require('../../../data/sortie/encounters/6-5.json');
  const profile={area:'6-5',encounterStage:'final',routePaths:[{nodes:['F','M']}],targetNodes:['M'],mapPreview:{nodes:[{id:'F'},{id:'M'}]}};
  const evidence=routeEncounters(profile,data);
  assert.equal(evidence.status,'known');
  for(const node of evidence.nodes)assert(node.formations.every(row=>row.finalForm===true));
});

test('6-5 stage changes both battle formations and route air inputs',()=>{
  const {routeAirReference}=require('../../../src/domain/routes/route_air');
  const {nodeFormations}=require('../../../src/ui/maps/node_formations');
  const ref=stage=>routeAirReference({},'6-5',{examples:[['H','M']],encounterStage:stage});
  for(const [stage,head,patterns] of [['before',206,[1,2]],['final',209,[3]],['after',206,[1,2]]]){
    const reference=ref(stage);
    assert.equal(reference.nodes.find(row=>row.id==='H').enemyAirPower,head);
    assert.equal(reference.nodes.find(row=>row.id==='M').enemyAirPower,312,
      'ordinary pattern 2 and final pattern 3 have the same enemy air power');
    assert.deepEqual(nodeFormations('6-5','M',stage).map(row=>row.pattern),patterns);
    const boss=reference.nodes.find(row=>row.id==='M');
    assert.equal(boss.airFormations.length,patterns.length);
  }
});
test('3-5 G preserves unlabelled secondary-source fleets in final battle and air reference',()=>{
  const data=require('../../../data/sortie/encounters/3-5.json');
  const profile={area:'3-5',encounterStage:'final',routePaths:[{nodes:['G']}],targetNodes:[],
    mapPreview:{nodes:[{id:'G',compositionUncertain:true}]}};
  const evidence=routeEncounters(profile,data),node=evidence.nodes[0];
  assert(node.formations.some(row=>row.source==='kcwiki'&&row.finalForm===null));
  assert(node.formations.some(row=>row.source==='kcwiki'&&row.ships[0].apiId===1527));
  assert(node.formations.filter(row=>row.source!=='kcwiki').every(row=>row.finalForm===true));
  const {routeAirReference}=require('../../../src/domain/routes/route_air');
  const air=routeAirReference({},'3-5',{examples:[['G']],encounterStage:'final'});
  assert.equal(air.status,'known');assert.equal(air.enemyAirPower,23);
  assert(air.nodes[0].antiAir.profiles.length>0);
  const before=routeAirReference({},'3-5',{examples:[['G']],encounterStage:'before'});
  assert.equal(before.status,'known');assert.equal(before.enemyAirPower,0);
  const beforeEvidence=routeEncounters({...profile,encounterStage:'before'},data).nodes[0];
  assert(beforeEvidence.formations.filter(row=>row.source==='kcwiki').every(row=>row.ships[0].apiId!==1560));
});
test('reviewed evidence requires the full ordered fleet and never overwrites contradictory source values',()=>{
  const ids=[1560,1527,1522,1576,1575,1575];
  const rows=[{source:'kcwiki',apiIds:ids,escortApiIds:[]},
    {source:'kcwiki',apiIds:ids,escortApiIds:[3]},
    {source:'kcwiki',apiIds:[...ids].reverse(),escortApiIds:[]},
    {source:'kcwiki',apiIds:ids,escortApiIds:[],finalForm:false,air:0}];
  const result=applyCrosscheckEvidence('3-5','G',rows);
  assert.equal(result[0].finalForm,true);assert.equal(result[0].air,23);
  assert.equal(result[1].finalForm,undefined);assert.equal(result[2].finalForm,undefined);
  assert.equal(result[3].finalForm,false);assert.equal(result[3].air,0);assert.equal(result[3].evidenceConflict,true);
  assert.equal(applyCrosscheckEvidence('3-5','E',[rows[0]])[0].finalForm,undefined,'evidence is scoped to the exact node');
});
test('reviewed cross-source data stays tied to actual ordered source records',()=>{
  const evidence=require('../../../data/sortie/crosscheck_evidence.json');
  assert.match(evidence.reviewedAt,/^\d{4}-\d{2}-\d{2}$/);
  for(const [area,nodes] of Object.entries(evidence.nodes)){
    const data=require(`../../../data/sortie/encounters/${area}.json`),snapshot=evidence.sourceSnapshots[area];
    assert(snapshot.url.startsWith('https://m.kcwiki.cn/wiki/'));assert.match(snapshot.sha256,/^[a-f0-9]{64}$/);
    for(const [node,rows] of Object.entries(nodes)){
      const seen=new Set(),variants=data.crossCheck.nodes[node].kcwikiVariants;
      const patterns=Object.values(data.nodes[node].phases).flatMap(phase=>phase.patterns||[]);
      for(const row of rows){
        const key=JSON.stringify([row.apiIds,row.escortApiIds||[]]);assert(!seen.has(key));seen.add(key);
        assert.equal(variants.filter(v=>JSON.stringify([v.apiIds,v.escortApiIds||[]])===key).length,1,`${area} ${node}: source variant changed`);
        if(row.wikiwikiPattern!=null){
          const matches=patterns.filter(p=>p.pattern===row.wikiwikiPattern&&
            JSON.stringify([(p.enemyShips||[]).map(s=>s.apiId),(p.escortFleet?.enemyShips||[]).map(s=>s.apiId)])===key);
          assert.equal(matches.length,1,`${area} ${node}: primary evidence changed`);
          if(row.finalForm===true)assert.equal(matches[0].finalForm,true);
          if(Number.isFinite(row.air))assert.equal(matches[0].enemyAirPower,row.air);
        }
      }
    }
  }
});
test('reviewed final and pre-final fleets produce stage-specific air values',()=>{
  const {routeAirReference}=require('../../../src/domain/routes/route_air');
  for(const [area,node,stage,value] of [
    ['3-5','G','before',0],['3-5','G','final',23],['3-5','H','before',221],['3-5','H','final',254],
    ['4-5','T','before',138],['4-5','T','final',111],['4-5','T','after',138],
    ['1-6','F','unknown',55],['4-2','E','unknown',23],['4-4','F','unknown',52],['4-4','H','unknown',28],
    ['4-5','S','unknown',23],['5-3','M','unknown',252],['6-1','C','unknown',23],['6-1','K','unknown',84],
    ['6-2','I','unknown',23],['6-2','J','unknown',102],['6-4','C','unknown',24],['6-4','F','unknown',82],
    ['6-4','G','unknown',82],['7-1','B','unknown',23],['7-3','N','unknown',238],
    ['5-6','Q1','unknown',271],['5-6','V','unknown',271]]){
    const result=routeAirReference({},area,{examples:[[node]],encounterStage:stage});
    assert.equal(result.status,'known',`${area} ${node} ${stage}: ${result.reason}`);
    assert.equal(result.enemyAirPower,value,`${area} ${node} ${stage}`);
  }
});
test('7-4 final air uses Chinese wiki values for each formation throughout the UI and prediction',()=>{
  const {routeAirReference}=require('../../../src/domain/routes/route_air');
  const {nodeFormations}=require('../../../src/ui/maps/node_formations');
  const reference=routeAirReference({},'7-4',{examples:[['P']],encounterStage:'final'});
  const node=reference.nodes[0];
  assert.equal(reference.status,'known');
  assert.equal(reference.enemyAirPower,160);
  assert.equal(reference.superiority,240);
  assert.equal(reference.supremacy,480);
  assert.deepEqual(node.issues,[]);
  assert.deepEqual(node.airFormations.map(row=>[row.pattern,row.enemyAirPower,row.airSuperiority,row.airSupremacy]),
    [[5,160,240,480],[6,157,236,471]]);
  assert.deepEqual(nodeFormations('7-4','P','final').map(row=>[row.pattern,row.enemyAirPower]),[[5,160],[6,157]]);
});
test('changed source values do not silently override reviewed cross-source evidence',()=>{
  const data=structuredClone(require('../../../data/sortie/encounters/3-5.json'));
  const variant=data.crossCheck.nodes.G.kcwikiVariants.find(v=>v.apiIds[0]===1560);variant.air=24;
  const {crossCheckAlternatives}=require('../../../src/domain/combat/combat_encounters');
  assert.equal(crossCheckAlternatives('3-5','G',data).status,'unknown');
  variant.air=null;
  data.nodes.G.phases.base.patterns.find(pattern=>pattern.pattern===4).enemyAirPower=24;
  assert.equal(crossCheckAlternatives('3-5','G',data).status,'unknown','changed primary evidence must also be reviewed');
});
test('clear-specific primary rows do not erase stage-unknown secondary sources',()=>{
  const rows=[{pattern:1,finalForm:null},{pattern:5,availability:'afterClear'},
    {source:'kcwiki',finalForm:null,availability:null},{source:'kcwiki',finalForm:true}];
  assert.deepEqual(filterFormations('7-5','T',rows,'after'),[rows[1],rows[2]]);
  assert.deepEqual(filterFormations('4-5','T',rows,'final'),[rows[3],rows[2]]);
});
