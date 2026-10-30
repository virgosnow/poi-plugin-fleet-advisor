'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateEvidence,evaluateRoute,referenceEnemy}=require('../../../src/domain/combat/route_combat');
const range=n=>({min:n,max:n});
const enemy={status:'known',kind:'surface',carrier:false,hp:range(25),armor:range(8),
  fire:range(20),torpedo:range(18),aircraft:range(0)};
const ship={status:'known',stype:2,submarine:false,hasAircraft:false,hp:30,armor:12,
  fire:40,torpedo:35,intrinsicTorpedo:30,openingTorpedo:false,
  asw:{status:'known',normal:false,opening:false,power:0}};
const formation=(pattern,ships)=>({phase:'base',pattern,ships,escort:[]});
const evidence={status:'known',nodes:[{id:'A',kind:'battle',target:false,
  formations:[formation(1,[enemy]),formation(2,[enemy,enemy])]},
  {id:'C',kind:'battle',target:true,formations:[formation(1,[enemy,enemy,enemy])]}]};
test('per-node calibration preserves alternatives and never exposes a certified grade',()=>{
  const r=evaluateEvidence([ship,ship],evidence);
  assert.equal(r.status,'experimental');assert.equal(r.nodes.length,2);
  assert.deepEqual(r.nodes.map(n=>n.battles.length),[2,1]);
  assert(Number.isFinite(r.reference.ratio));
});
test('same enemy route gives distinct experimental references for stronger and weaker fleets',()=>{
  const weak={...ship,hp:20,armor:5,fire:20,torpedo:15};
  const strong={...ship,hp:40,armor:18,fire:65,torpedo:50};
  const a=evaluateEvidence([weak,weak],evidence),b=evaluateEvidence([strong,strong],evidence);
  assert.equal(a.status,'experimental');assert.equal(b.status,'experimental');
  assert(b.reference.ratio>a.reference.ratio);
  assert.equal(a.nodes.length,b.nodes.length);
});
test('real 1-1 A formations respond directionally to stronger and weaker fleets',()=>{
  const {formationRecords}=require('../../../src/domain/combat/combat_encounters');
  const formations=formationRecords(require('../../../data/sortie/encounters/1-1.json').nodes.A);
  assert.equal(formations.status,'known');
  const data={status:'known',nodes:[{id:'A',kind:'battle',target:false,formations:formations.formations}]};
  const weak={...ship,hp:20,armor:0,fire:10,torpedo:5};
  const strong={...ship,hp:35,armor:10,fire:55,torpedo:40};
  const a=evaluateEvidence([weak],data),b=evaluateEvidence([strong],data);
  assert.equal(a.status,'experimental');assert.equal(b.status,'experimental');
  assert(b.reference.ratio>a.reference.ratio);
});
test('a repeated hazard remains experimental even when worst individual battle is unchanged',()=>{
  const single={status:'known',nodes:[evidence.nodes[0]]};
  const repeated={status:'known',nodes:[evidence.nodes[0],{...evidence.nodes[0],id:'B'}]};
  const a=evaluateEvidence([ship],single),b=evaluateEvidence([ship],repeated);
  assert.equal(a.status,'experimental');assert.equal(b.status,'experimental');
  assert.equal(a.reference.ratio,b.reference.ratio);
  // The minimum-node proxy cannot reflect cumulative retreat risk.
  assert.equal(b.nodes.length,2);
});
test('submarines, airborne ships, enemy carriers and unknown enemy data do not become a perfect result',()=>{
  for(const altered of [{...ship,submarine:true,stype:13},{...ship,hasAircraft:true}]){
    const r=evaluateEvidence([altered],evidence);assert.equal(r.status,'unknown');assert.equal(r.reference,undefined);
  }
  const carrier={...enemy,carrier:true};
  const r=evaluateEvidence([ship],{...evidence,nodes:[{...evidence.nodes[0],formations:[formation(1,[carrier])]}]});
  assert.equal(r.status,'unknown');assert.equal(r.reference,undefined);
  assert.equal(referenceEnemy({...enemy,aircraft:null}),null);
});
test('a partial route or unsupported point never produces a whole-route grade',()=>{
  assert.equal(evaluateEvidence([ship],{...evidence,status:'partial'}).status,'unknown');
  const r=evaluateEvidence([ship],{...evidence,nodes:[evidence.nodes[0],{...evidence.nodes[1],kind:'nightBattle'}]});
  assert.equal(r.status,'unknown');assert.equal(r.reference,undefined);
  assert.equal(r.nodes.length,1);
});
test('an unresolved HQ or stage restriction is not silently treated as applicable',()=>{
  const restricted={...formation(1,[enemy]),hqLevelRange:[80,120]};
  const r=evaluateEvidence([ship],{...evidence,nodes:[{...evidence.nodes[0],formations:[restricted]}]});
  assert.equal(r.status,'unknown');assert.equal(r.reference,undefined);
});
test('map overview cannot be substituted for paths checked against the current fleet',()=>{
  const result=evaluateRoute({}, {ships:[{id:1}]}, {referenceOnly:true});
  assert.equal(result.status,'unknown');assert.match(result.reasons[0],/可达路线/);
});
test('oversized fleets, nodes and formations return unknown without a partial grade',()=>{
  const tooManyNodes={...evidence,nodes:Array.from({length:25},()=>evidence.nodes[0])};
  const tooManyForms={...evidence,nodes:[{...evidence.nodes[0],formations:Array.from({length:17},()=>formation(1,[enemy]))}]};
  const tooManyTotal={...evidence,nodes:Array.from({length:9},()=>({...evidence.nodes[0],formations:Array.from({length:15},()=>formation(1,[enemy]))}))};
  for(const [fleet,input] of [[Array.from({length:7},()=>ship),evidence],[[ship],tooManyNodes],[[ship],tooManyForms],[[ship],tooManyTotal]]){
    const result=evaluateEvidence(fleet,input);
    assert.equal(result.status,'unknown');assert.match(result.reasons[0],/预算/);
    assert.equal(result.reference,undefined);
  }
});
