'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {range,enemyRecord,formationRecords,crossCheckAlternatives,crossCheckFormations,routeEncounters}=require('../../../src/domain/combat/combat_encounters');
const catalog=new Map([[1,{shipType:'駆逐艦',kcwikiNameZh:'敌舰',stats:{'耐久':20,'装甲':5,'火力':[5,8],'雷装':15,'搭載':0}}]]);
const ship={apiId:1,apiIdStatus:'verified(wikiTarget)'};
test('enemy statistics retain ranges and missing identity is not invented',()=>{
  assert.deepEqual(range([8,5]),{min:5,max:8});
  assert.equal(range(null),null);assert.equal(range([5,null]),null);
  assert.deepEqual(enemyRecord(ship,catalog).fire,{min:5,max:8});
  assert.equal(enemyRecord({...ship,apiIdStatus:'tentative'},catalog).status,'unknown');
  assert.equal(enemyRecord({...ship,apiId:99},catalog).status,'unknown');
});
test('alternatives and same-as inheritance remain separate, with restrictions preserved',()=>{
  const records=formationRecords({phases:{base:{patterns:[
    {pattern:1,enemyShips:[ship],formation:['単縦']},
    {pattern:2,sameAsPattern:1,hqLevelRange:[80,120]},
    {pattern:3,enemyShips:[ship,ship],availability:'final'}]}}},catalog);
  assert.equal(records.status,'known');assert.equal(records.formations.length,3);
  assert.deepEqual(records.formations.map(f=>f.ships.length),[1,1,2]);
  assert.deepEqual(records.formations[1].formation,['単縦']);
  assert.deepEqual(records.formations[1].hqLevelRange,[80,120]);
  assert.equal(records.formations[2].availability,'final');
});
test('missing or cyclic inherited formations produce partial evidence',()=>{
  const records=formationRecords({phases:{base:{patterns:[
    {pattern:1,sameAsPattern:2},{pattern:2,sameAsPattern:1},
    {pattern:3,enemyShips:[{...ship,apiIdStatus:'unknown'}]}]}}},catalog);
  assert.equal(records.status,'partial');assert.equal(records.formations.length,1);
  assert.equal(records.formations[0].ships[0].status,'unknown');
});
test('route evidence includes only requested actual paths and separates target',()=>{
  const battle={kind:'battle',phases:{base:{patterns:[{pattern:1,enemyShips:[ship]}]}}};
  const data={nodes:{A:battle,B:battle,C:battle,D:{kind:'resources'}}};
  const profile={area:'1-1',status:'known',targetNodes:['C'],routePaths:[{nodes:['A','D','C']}],
    mapPreview:{nodes:['A','B','C','D'].map(id=>({id}))}};
  const result=routeEncounters(profile,data,catalog);
  assert.equal(result.status,'known');assert.deepEqual(result.nodes.map(n=>n.id),['A','C']);
  assert.deepEqual(result.nodes.map(n=>n.target),[false,true]);
  assert.equal(routeEncounters({...profile,truncated:true},data,catalog).status,'unknown');
  assert.equal(routeEncounters({...profile,mapPreview:{nodes:[{id:'A'}]}},data,catalog).status,'partial');
  assert.equal(routeEncounters({...profile,mapPreview:{nodes:[{id:'A',compositionUncertain:true},{id:'C'},{id:'D'}]}},data,catalog).status,'partial');
});
test('real 1-1 preserves each recorded enemy formation independently',()=>{
  const {previewForMap}=require('../../../src/domain/routes/sortie_profile');
  const profile=previewForMap('1-1',{paths:[['A','C']]});
  const result=routeEncounters(profile);
  assert.equal(result.status,'known');
  assert.deepEqual(result.nodes.map(n=>n.id),['A','C']);
  assert.deepEqual(result.nodes.find(n=>n.id==='C').formations.map(f=>f.ships.length),[3,3,4]);
});
test('coastal batteries are land targets and not ordinary surface ships',()=>{
  const master=require('../../../data/sortie/enemy_catalog.json').enemies.find(row=>row.name==='砲台小鬼');
  const record=enemyRecord({apiId:master.apiId,apiIdStatus:'verified'},new Map([[master.apiId,master]]));
  assert.equal(record.status,'known');assert.equal(record.kind,'installation');
});
test('5-6 D air-only installation preserves unknown cannon stats and cannot be used for surface battle',()=>{
  const raw=require('../../../data/sortie/encounters/5-6.json').nodes.D;
  const records=formationRecords(raw);assert.equal(records.status,'known');
  const airOnly=records.formations.flatMap(f=>f.ships).find(s=>s.apiId===1889);
  assert(airOnly?.airOnly);assert.equal(airOnly.hp.max,500);assert.equal(airOnly.aircraft.max,30);
  assert.equal(airOnly.fire,null);assert.equal(airOnly.torpedo,null);assert.equal(airOnly.armor,null);
  assert.equal(enemyRecord({apiId:1889,apiIdStatus:'verified'}).status,'unknown');
  assert.equal(formationRecords({...raw,kind:'battle'}).status,'partial');
});
test('cross-source disagreements retain documented formations separately, without mixing ships',()=>{
  const data=require('../../../data/sortie/encounters/6-2.json');
  const alternatives=crossCheckAlternatives('6-2','I',data);
  assert.equal(alternatives.status,'known');assert(alternatives.formations.length>=2);
  const sequences=alternatives.formations.map(f=>f.ships.map(s=>s.apiId));
  const documented=data.crossCheck.nodes.I.kcwikiVariants.map(f=>f.apiIds);
  for(const sequence of sequences)assert(documented.some(row=>JSON.stringify(row)===JSON.stringify(sequence)));
  assert(alternatives.warnings.some(w=>w.includes('差异')));
  const missing={...data,crossCheck:{nodes:{I:{...data.crossCheck.nodes.I,kcwikiVariants:[]}}}};
  assert.equal(crossCheckAlternatives('6-2','I',missing).status,'unknown');
});
test('real 1-6 K merges formations only for the same fully matched fleet',()=>{
  const data=require('../../../data/sortie/encounters/1-6.json'),records=formationRecords(data.nodes.K);
  const result=crossCheckFormations('1-6','K',records,data);
  assert.equal(result.status,'known');assert(result.warnings.some(w=>w.includes('差异')));
  const second=records.formations.find(f=>f.pattern===2);
  assert.deepEqual(second.formation.sort(),['単縦','複縦'].sort());
  assert.deepEqual(second.ships.map(s=>s.apiId),[1527,1522,1520,1575,1501,1501]);
  // Missing escort information or ambiguous stage rows must not silently
  // broaden a different fleet or stage.
  const incomplete=structuredClone(data);
  incomplete.crossCheck.nodes.K.kcwikiVariants=[];
  assert.equal(crossCheckFormations('1-6','K',formationRecords(data.nodes.K),incomplete).status,'unknown');
  const ambiguous=formationRecords(data.nodes.K);
  ambiguous.formations.push({...ambiguous.formations.find(f=>f.pattern===2),phase:'other'});
  assert.equal(crossCheckFormations('1-6','K',ambiguous,data).status,'unknown');
});
test('real 6-4 M merges the second source\'s anti-submarine formation',()=>{
  const data=require('../../../data/sortie/encounters/6-4.json'),records=formationRecords(data.nodes.M);
  assert.equal(crossCheckFormations('6-4','M',records,data).status,'known');
  assert.deepEqual(records.formations.find(f=>f.pattern===1).formation.sort(),['単横','梯形'].sort());
});
test('duplicate actual pattern numbers retain separate internal formation identities',()=>{
  const data=require('../../../data/sortie/encounters/7-3.json'),records=formationRecords(data.nodes.N);
  const matches=records.formations.filter(f=>f.pattern===2);
  assert.equal(matches.length,2);assert.notEqual(matches[0].key,matches[1].key);
  assert.notDeepEqual(matches[0].ships.map(s=>s.apiId),matches[1].ships.map(s=>s.apiId));
  assert.equal(crossCheckFormations('7-3','N',records,data).status,'known');
});
test('real route includes complete cross-source alternatives but rejects incomplete conflicts',()=>{
  const profile=(area,id)=>({area,status:'known',targetNodes:[],routePaths:[{nodes:[id]}],
    mapPreview:{nodes:[{id,compositionUncertain:true}]}});
  const data=require('../../../data/sortie/encounters/6-2.json');
  const result=routeEncounters(profile('6-2','I'),data);
  assert.equal(result.status,'known');
  assert(result.nodes[0].sourceWarnings.some(w=>w.includes('差异')));
  const sequences=result.nodes[0].formations.map(f=>JSON.stringify(f.ships.map(s=>s.apiId)));
  for(const variant of data.crossCheck.nodes.I.kcwikiVariants)assert(sequences.includes(JSON.stringify(variant.apiIds)));
  const missing=structuredClone(data);missing.crossCheck.nodes.I.kcwikiVariants=[];
  const incomplete=routeEncounters(profile('6-2','I'),missing);
  assert.equal(incomplete.status,'partial');
  assert.match(incomplete.reasons.join('；'),/待确认/);
});
test('3-5 H and 4-5 T no longer inherit stale null-identity adjudications',()=>{
  for(const [area,id] of [['3-5','H'],['4-5','T']]){
    const data=require(`../../../data/sortie/encounters/${area}.json`);
    const profile={area,status:'known',targetNodes:[id],routePaths:[{nodes:[id]}],mapPreview:{nodes:[{id}]}};
    const result=routeEncounters(profile,data);
    assert.equal(result.status,'known',`${area} ${result.reasons}`);
    assert.equal(result.nodes[0].formations.length,6);
    for(const row of result.nodes[0].formations)assert(row.ships.every(s=>s.status==='known'));
    assert(result.nodes[0].formations.some(row=>row.finalForm===true));
    assert(result.nodes[0].formations.some(row=>row.finalForm!==true));
    assert(result.nodes[0].sourceWarnings.some(w=>w.includes('未按当前血条筛选')));
  }
  const entries=require('../../../data/sortie/adjudications.json').entries;
  for(const [area,node] of [['3-5','H'],['4-5','T']])
    assert(!entries.some(e=>e.area===area&&e.node===node&&e.kind==='compositionConflict'&&e.status==='pending'));
});
test('missing secondary final-form markers remain null rather than false',()=>{
  const entries=require('../../../data/sortie/adjudications.json').entries;
  const corrected=entries.filter(e=>e.note?.includes('中文来源未标注最终形态'));
  assert(corrected.length>=40);
  for(const entry of corrected){
    assert.equal(entry.values.finalForm.wikiwiki,true);
    assert.equal(entry.values.finalForm.kcwiki,null);
    if(entry.fields.length===1)assert.equal(entry.status,'resolved');
    else assert.equal(entry.status,'pending');
  }
});
test('route and formation size budgets reject oversized inputs instead of truncating them',()=>{
  const tooMany=formationRecords({phases:{base:{patterns:Array.from({length:17},(_,i)=>({pattern:i,enemyShips:[ship]}))}}},catalog);
  assert.equal(tooMany.status,'unknown');assert.match(tooMany.reasons[0],/预算/);
  const profile={area:'1-1',status:'known',targetNodes:['C'],routePaths:Array.from({length:129},()=>({nodes:['A','C']}))};
  const result=routeEncounters(profile,{nodes:{}},catalog);
  assert.equal(result.status,'unknown');assert.match(result.reasons[0],/预算/);assert.equal(result.nodes.length,0);
});
