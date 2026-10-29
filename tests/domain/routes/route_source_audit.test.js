'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluatePoint}=require('../../../src/domain/routes/normal_routes');
const {possiblePoint,planningPath,requirementDetails}=require('../../../src/domain/routes/route_plans');
const ships=(types,names=[])=>types.map((stype,i)=>({stype,name:names[i]||'测试舰'+i,instanceId:i+1,drumEquipped:false,radarEquipped:true}));
const metrics=(score=100,speed='fast',visitedNodes=[])=>({visitedNodes,speed:{status:'observed',fleetSpeed:speed},lineOfSight:{status:'computed',rawScoresByCoefficient:{1:score,2:score,3:score,4:score},thresholdMargin:0}});
const assess=(area,node,types,opts={})=>evaluatePoint(require(`../../../data/normal_routes/${area}.json`).machineRules[node],ships(types,opts.names),metrics(opts.score,opts.speed,opts.path));
function distribution(actual,expected,label=''){
  const got=actual.status==='fixed'?{[actual.destinations[0]]:1}:Object.fromEntries((actual.probabilities||[]).map(p=>[p.to,p.probability]));
  assert.deepEqual(Object.keys(got).sort(),Object.keys(expected).sort(),label);
  for(const [to,p]of Object.entries(expected))assert(Math.abs(got[to]-p)<1e-9,`${label} ${to}: ${got[to]} != ${p}`);
}

test('all reviewed maps retain source URLs and hashes without redistributing captured originals',()=>{
  const fs=require('fs'),path=require('path');
  const capturedSha='34ede676cbe1f4a8f2dade1a6bcbfa3bcb8f8b9d59757c6f391aa2932bccdc2a';
  const sources=new Map();
  const files=fs.readdirSync(path.join(__dirname,'../../../data/normal_routes'));
  assert.equal(files.length,37);assert(files.includes('5-6.json'));
  let changed=0;
  for(const file of files){
    const m=require('../../../data/normal_routes/'+file);sources.set(m.area,m.source.postUrl);
    assert.equal(m.source.authority,'nga-16820397');
    assert.equal(m.source.postUrl,`https://bbs.nga.cn/read.php?pid=${m.source.postId}`);
    assert.equal(m.source.snapshotSha256,capturedSha);assert.match(m.source.bodySha256,/^[a-f0-9]{64}$/);
    assert(!Object.hasOwn(m.source,'snapshot'));
    assert.match(m.source.url,/^https:\/\/zh\.kcwiki\.cn\/wiki\//);
    assert.equal(m.source.capturedDate,'2026-10-13');
    changed+=m.ngaReview.changedNodes.length;
    for(const point of m.branchPoints.filter(p=>!m.ngaReview.supplementaryNodes.includes(p.from))){
      assert.equal(point.source,m.source.postUrl);
      assert(point.clauses.length>0);
      assert(!Object.hasOwn(point,'previousClauses')&&!Object.hasOwn(point,'reviewedClauses'));
    }
  }
  assert.equal(changed,57);
  const c=require('../../../data/normal_routes/7-3.json').branchPoints.find(p=>p.from==='C').clauses.join('');
  assert(c.includes('[高速+]')&&c.includes('[最速]'),'literal speed labels must survive UBB formatting removal');
  for(const [key,g]of Object.entries(require('../../../data/normal_route_guides.json').maps)){
    assert.match(g.source,/^https:\/\/wikiwiki\.jp\/kancolle\//);
    assert.equal(g.routingSource,require('../../../data/normal_routes/'+key.split(':')[0]+'.json').source.url);
  }
});

// Independent examples derived from the reviewed source tables. The expected
// results do not reuse predicates or weights read from the production JSON.
const cases=[
 ['1-1','A',[2,2,2],{B:.5,C:.5}],
 ['1-2','A',[3,2,2,2,2],{E:1},{speed:'slow'}],
 ['1-4','B',[22,2,2,5,5,5],{C:1}],
 ['1-4','F',[16,5,5,5,5,2],{H:.5,I:.5}],
 ['1-4','F',[5,5,5,2,2,2],{E:.8,H:.2}],
 ['1-5','C',[13,1,1],{B:1}],
 // Author's follow-up explicitly confirms that failed coins continue.
 ['2-2','C',[10,3,2,2,2,2],{B:.7,E:.18,D:.12}],
 ['2-2','C',[5,3,2,2,2,2],{E:.8,D:.2}],
 ['2-2','E',[9,5,5,5,5,2],{G:.5,K:.5}],
 ['2-2','H',[5,5,5,5,5,2],{I:.35,J:.15,K:.5}],
 ['2-4','H',[5,5,3,2,2,2],{I:1}],
 ['3-3','K',[13,9,11,2,2,3],{L:.25,M:.75}],
 ['3-5','H',[3,2,2,2,2,2],{J:1},{score:34.999}],
 ['3-5','H',[3,2,2,2,2,2],{J:.5,K:.5},{score:35}],
 ['3-5','H',[3,2,2,2,2,2],{K:1},{score:40}],
 ['4-1','D',[13,2,2],{G:.35,H:.65}],
 ['4-2','start',[5,5,5,5,5,5],{A:.5*.65*.35,B:1-.5*.65*.35}],
 ['4-2','start',[5,5,5,5,2,2],{A:.35+.65*.35,B:.65*.65}],
 ['4-3','A',[5,6,2,2],{B:.35,D:.65}],
 ['4-4','E',[13,13,13,13,13],{G:1}],
 ['4-4','F',[9,11,7,2,2,3],{H:1}],
 ['5-2','C',[3,2,2,2,2,2],{E:1},{names:['夕張改二']}],
 ['5-2','D',[7,3,5,5,2,2],{G:1},{names:['祥鳳改','夕張改二']}],
 ['5-2','D',[7,3,6,6,2,2],{F:1},{names:['祥鳳改','夕張改二']}],
 ['5-3','E',[11,3,5,5,5,2],{Q:1}],
 ['5-3','I',[9,9,3,5,5,2],{J:.65,O:.35}],
 ['5-3','I',[21,5,5,5,5,2],{J:.5,O:.5}],
 ['5-3','J',[7,5,5,6,2,2],{L:1}],
 ['5-4','G',[11,11,18,5,5,2],{K:.65,L:.35}],
 ['5-5','B',[4,4,4,2,2,2],{F:1}],
 ['6-1','G',[3,2,2,13,13],{I:1}],
 ['6-2','start',[13,3,2,2,2,5],{B:1}],
 ['6-2','H',[3,2,2,5,5,5],{G:1},{score:39.999}],
 ['6-2','H',[3,2,2,5,5,5],{K:1},{score:40}],
 ['6-4','start',[9,9,9,16,2,2],{M:1},{names:['長門改二','陸奥改二']}],
 ['7-1','D',[16,1,1,1,1],{C:.65,E:.35}],
 ['7-1','H',[16,2,2,2,3],{K:.65,I:.35}],
 ['7-2','I',[9,11,7,5,2,2],{L:1},{score:62.999}],
 ['7-3','C#gauge1',[5,5,2],{E:1},{names:['羽黒改二','妙高改二','神風改']}],
 ['7-3','C#gauge2',[5,5,2],{D:1},{names:['羽黒改二','鳥海改二','神風改']}],
 ['7-4','J',[3,2,2,2,2,2],{K:.5,L:.5},{score:35}],
 ['7-4','M',[3,2,2,2,2,2],{N:.5,O:.5},{score:46}],
 ['7-5','B',[20,13,2,2,2,3],{D:1}],
 ['7-5','D',[9,9,11,13,2,2],{F:1},{speed:'fastest'}],
 ['7-5','D',[9,9,11,2,2,3],{E:1},{speed:'fastPlus'}],
 ['7-5','J',[9,7,5,5,2,2],{N:1}],
 ['1-3','F',[3,1,1,1,2,2],{J:1}],
 ['1-3','F',[3,4,2,2],{H:.25,J:.75}],
 ['1-3','F',[13,2,2],{H:.75,J:.25}],
 ['1-3','H',[3,2,2],{J:1}],
 ['1-3','H',[3,2],{I:.65,J:.35}],
 ['1-3','H',[2,2,5],{G:.4,I:.15,J:.45}],
 ['1-4','F',[10,10,10,2,2],{E:1}],
 ['1-5','C',[1,1,1],{J:1}],
 ['1-5','C',[3,2,2],{B:.5,J:.5}],
 ['1-5','D',[22,13,2],{F:1}],
 ['1-5','D',[2,2,2,2,2],{E:.65,F:.35}],
 ['1-5','F',[8,2,2],{I:1}],
 ['1-5','F',[10,2,2],{G:1}],
 ['2-2','G',[9,9,9,2],{H:.7,K:.3}],
 ['2-2','G',[9,2,3],{H:.3,K:.7}],
 ['2-2','H',[9,9,9,9,2],{I:.6,K:.4}],
 ['2-2','H',[13,2,3],{I:.7,K:.3}],
 ['2-3','D',[2,2,2,2,5],{F:.2,G:.8}],
 ['2-3','F',[7,3,2],{J:.9,G:.1}],
 ['2-3','F',[20,13,13,3],{J:.8,G:.2}],
 ['2-3','F',[20,13,13],{J:.35,G:.65}],
 ['2-3','F',[3,2,2],{J:.8,G:.2}],
 ['2-3','G',[20,13,13],{I:.55,K:.45}],
 ['2-3','J',[7,6,16,3,2,2],{N:1-.35*.35*.35*.5,L:.35*.35*.35*.5}],
 ['2-3','J',[9,9,9,9,11,13],{L:.8+.2*.35*.65,N:.2*.65,M:.2*.35*.35}],
 ['2-4','B',[9,11,7,2,2,2],{G:.72,C:.28}],
 ['2-4','I',[7,3,2,2,5,6],{E:.072,K:.928}],
 ['2-4','I',[1,1,7,3,2,2],{E:.536,K:.464}],
 ['2-4','K',[16,1,1,2],{N:1}],
 ['2-4','K',[16,2,3],{N:.4,L:.39,O:.21}],
 ['2-4','K',[9,9,11,11,2],{O:.675,L:.325}],
 ['2-4','L',[3,3,2,2,9,11],{P:1}],
 ['2-5','start',[13,2,3],{B:.5,C:.5}],
 ['2-5','start',[5,5],{C:1}],
 ['2-5','start',[5,5,5,2,2,2],{B:.8,C:.2}],
 ['2-5','E',[7,3,1,1,1,1],{I:1}],
 ['2-5','E',[7,3,2,2,2,2],{I:1},{speed:'slow'}],
 ['2-5','F',[9,9,9,2,2],{J:1}],
 ['2-5','F',[5,5,5,5,2,2],{E:.5,J:.5}],
 ['2-5','G',[3,1,1,1,1],{L:1}],
 ['2-5','J',[13,3,2,2],{H:.5,M:.25,O:.25},{score:45}],
 ['2-5','J',[1,1,1,5,5,5],{M:1}],
 ['3-1','C',[20,16,3,2,2,2],{B:.75,F:.25}],
 ['3-2','C',[22,3,2,2,2,2],{E:.45,G:.55}],
 ['3-2','E',[3,2,2,2,2,2],{D:.17,F:.83}],
 ['3-2','G',[13,2,2,2,2],{H:.5,J:.5}],
 ['3-2','G',[2,2,2,2,2,2],{H:.55,F:.45}],
 ['3-3','B',[9,7,1,1,3,5],{F:1}],
 ['3-4','F',[9,11,3,2,2,2],{J:.45,G:.0825,M:.4675}],
 ['3-4','M',[5,5,5,2,2],{K:.35,P:.65}],
 ['3-4','L',[11,2,2,3,3,3],{N:.65,O:.35}],
 ['3-5','H',[17,3,2,2,2,2],{K:1}],
 ['3-5','H',[17,9,7,2,2,2],{J:1}],
 ['4-1','F',[21,2,2,2,2],{H:1}],
 ['4-1','F',[3,2,2,2,2],{H:1}],
 ['4-1','H',[13,3,2,2],{J:.65,I:.35}],
 ['4-1','H',[5,5,5],{I:1}],
 ['4-2','A',[9,7,5,2,2,2],{C:.6,E:.4}],
 ['4-2','D',[3,3,2,2,9,9],{C:1}],
 ['4-2','D',[9,9,9,9,2],{C:.15,H:.85}],
 ['4-2','G',[9,11,13,2,5,5],{L:.6,F:.32,I:.08}],
 ['4-3','start',[9,7,2,2,5,5],{A:.35,C:.65}],
 ['4-3','C',[13,13,13,13],{F:1-.5*.35*.35,D:.5*.35*.35}],
 ['4-3','C',[3,3,2,2,7,5],{D:.35,F:.65}],
 ['4-3','F',[9,11,11,2],{K:1-.35*.35*.35,H:.35*.35*.35},{speed:'slow'}],
 ['4-3','H',[7,11,2,2,5,5],{N:.91,I:.09}],
 ['4-3','H',[7,11,18,5,5,5],{I:1}],
 ['4-3','K',[7,3,2,2,5,5],{L:.5,N:.5}],
 ['4-3','L',[7,5,5,13,2,2],{M:.35,N:.65}],
 ['5-1','start',[9,9,9,11,2,2],{A:.9,B:.1}],
 ['5-1','F',[9,9,9,9,2,2],{J:1},{speed:'fastest'}],
 ['5-1','F',[13,13,13],{G:1}],
 ['5-1','F',[5,5,5,2,2,2],{G:.05,J:.95}],
 ['5-1','G',[3,2,2,5,9,9],{J:1}],
 ['5-1','G',[5,5,5,3,9,9],{J:.35,I:.65}],
 ['5-2','start',[11,11,11,11,11,13],{A:.88625,B:.11375}],
 ['5-2','F',[9,9,9,3,2,2],{H:.5,I:.375,O:.125},{score:65}],
 ['5-3','I',[21,2,2,9,9,5],{O:1}],
 ['5-3','J',[7,2,2,5,4,4],{N:1}],
 ['5-3','K',[10,2,2,2,5,5],{H:1}],
 ['5-4','B',[4,5,2,2,2],{E:1}],
 ['5-4','L',[9,9,9,11,11,2],{N:1},{score:55}],
 ['5-4','L',[9,9,9,11,11,2],{N:.75,P:.25},{score:58}],
 ['5-4','M',[13,3,2,2],{O:.5,P:.5},{speed:'fastPlus'}],
 ['5-5','H',[9,9,3,5,5,2],{N:1},{speed:'fastPlus'}],
 ['5-5','M',[9,9,11,11,2,2],{O:1},{path:['N']}],
 ['5-5','N',[11,3,2,2,5,5],{O:1},{path:['M']}],
 ['5-5','O',[13,3,2,2],{R:.675,S:.325},{score:64}],
 ['5-5','P',[9,9,9,11,11,13],{Q:.78875,S:.21125},{score:75}],
 ['5-5','P',[13,3,2,2],{S:1},{score:0,speed:'fastPlus'}],
 ['6-1','G',[7,3,13,13,13,13],{I:.575,H:.425},{score:14}],
 ['6-1','G',[9,11,5,2,2,2],{I:1}],
 ['6-4','start',[21,5,5,2,2,2],{A:1}],
 ['6-4','A',[21,5,5,2,2],{E:1}],
 ['6-4','E',[5,6,3,2,2,2],{D:1}],
 ['6-4','J',[17,9,11,11,3,2],{L:1}],
 ['6-4','K',[9,9,9,2,2,2],{H:1}],
 ['6-5','B',[9,9,9,9,2,2],{C:1}],
 ['7-1','H',[9,7,3,2,5,5],{K:null,I:null,J:null}],
 ['7-2','E',[1,1,1,5,5,5],{G:1},{score:0}],
 ['7-3','A#gauge1',[22,2,2,2],{C:1}],
 ['7-3','C#gauge2',[5,2,2],{E:1},{speed:'fastest'}],
 ['7-3','G#gauge2',[5,5,3,2,2,2],{J:1},{speed:'slow'}],
 ['7-3','I#gauge2',[13,5,3,2,2,2],{J:1}],
 ['7-3','J#gauge2',[5,3,2,2,2],{P:1}],
 ['7-3','M#gauge2',[5,2,5,10,13],{P:1},{names:['羽黒改二','神風改','足柄改二']}],
];
for(const [area,node,types,expected,opts]of cases)test(`source audit ${area} ${node} ${types.join('/')} ${JSON.stringify(opts||{})}`,()=>{
  const result=assess(area,node,types,opts);
  if(Object.values(expected).includes(null)){
    assert.deepEqual(result.destinations.sort(),Object.keys(expected).sort());assert.equal(result.referencePathProbability,.5);
  }else distribution(result,expected,`${area} ${node}`);
});

test('sequential rolls preserve unknown evidence, collapse common exits and retain hull candidates',()=>{
  const rules=[{when:{count:{stypes:[13],min:1}},to:'A',chance:.35},{when:{los:{coefficient:2,lt:70}},to:'B'},{when:true,to:'A'}];
  const fleet=ships([13]);
  distribution(evaluatePoint(rules,fleet,metrics(65)),{A:.35,B:.65});
  distribution(evaluatePoint(rules,fleet,metrics(70)),{A:1});
  const missing={...metrics(),lineOfSight:{status:'unknown'}};
  assert.equal(evaluatePoint(rules,fleet,missing).status,'unknown');
  assert.deepEqual(possiblePoint(rules,fleet,missing).destinations,['A','B']);
});

test('7-5 LoS boundaries depend on hulls at both nodes, with priority for the largest threshold',()=>{
  for(const [types,offset]of [[[3,2,2,2,2,2],0],[[9,3,2,2,2,2],0],[[7,3,2,2,2,2],5],[[11,3,2,2,2,2],5],[[9,10,3,2,2,2],10],[[9,10,7,3,2,2],10],[[7,11,3,2,2,2],15],[[17,22,3,2,2,2],0]]){
    for(const [node,base,bad,good]of [['I',55,'L','M'],['P',58,'S','T']]){
      const border=base+offset;
      distribution(assess('7-5',node,types,{score:border-2-.001,speed:'fastest'}),{[bad]:1});
      for(const score of [border-2,border-.001])distribution(assess('7-5',node,types,{score,speed:'fastest'}),{[bad]:.5,[good]:.5});
      distribution(assess('7-5',node,types,{score:border,speed:'fastest'}),{[good]:1});
      const route={area:'7-5',phase:'gauge3',ships:ships(types),...metrics(border,'fastest'),targetNodes:['T']};
      const gates=planningPath(route,['A','B','D','F','G','H','I','M','O','P','T']).losRequirements;
      assert(gates.some(g=>g.from===node&&g.coefficient===4&&g.required===border),`${node} threshold ${border}`);
      const nodes=node==='I'?['A','B','D','F','G','H','I','M']:['A','B','D','F','J','O','P','T'];
      const lineOfSight={...route.lineOfSight,scoresByCoefficient:{4:border}};
      const card=require('../../../src/ui/workbench/workbench_model').fleetSummary({route,metrics:{lineOfSight}},{area:'7-5'},nodes).los;
      assert.equal(card.coefficient,4);assert.equal(card.value,border.toFixed(1));
      assert(card.hint.includes(`门槛 ≥ ${border} · ${node}→${good}`));
    }
  }
});

test('roll failure remains visible in rule highlighting and LoS diagnostics',()=>{
  const route={area:'5-2',ships:ships([9,9,9,3,2,2]),...metrics(65)};
  const detail=requirementDetails('5-2',['B','C','D','F','O'],null,route).find(p=>p.from==='F');
  assert.equal(detail.rules.filter(r=>r.active).length,2);
  assert(detail.rules.some(r=>r.active&&r.condition.includes('否则继续判断')));
});

test('all normal-map coin rules have valid weights and a terminal continuation',()=>{
  const fs=require('fs'),path=require('path');let coins=0;
  for(const filename of fs.readdirSync(path.join(__dirname,'../../../data/normal_routes'))){
    const m=require('../../../data/normal_routes/'+filename);
    for(const [node,rules]of Object.entries(m.machineRules))for(let i=0;i<rules.length;i++){
      const r=rules[i];if(r.chance===undefined)continue;coins++;
      assert(r.to&&Number.isFinite(r.chance)&&r.chance>0&&r.chance<1,`${m.area} ${node}`);
      assert(i<rules.length-1,`${m.area} ${node} needs a fallthrough`);
    }
  }
  assert(coins>25);
});
