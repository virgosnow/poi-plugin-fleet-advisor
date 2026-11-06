'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createRouteCombatAssessor}=require('../../src/application/route_combat_assessments');
const reading=(extra={})=>({status:'estimated',balance:{ratio:1},diagnostics:{journeys:{samples:32,completed:10},
  target:{id:'M',visits:10,sVictories:2}},...extra});

test('equal arrival odds cannot hide loss of a base-supported branch',()=>{
  const {preservesRouting}=require('../../src/application/joint_fitting_comparison');
  const old={route:{probability:1,paths:[['A','C','M']]}},changed={route:{probability:1,paths:[['A','D','M']]}};
  const plans={optionPlanning:()=>({chance:{min:1,max:1,probability:1},losShortfall:0}),fleetPaths:route=>route.paths};
  assert.equal(preservesRouting(old,changed,{},[{targets:['C','C']}],plans),false);
  assert.equal(preservesRouting(old,changed,{},[{targets:['M','M']}],plans),false);
  assert.equal(preservesRouting(old,old,{},[{targets:['C','C']}],plans),true);
});

test('more arrivals do not buy a weaker balance without more S scenarios',()=>{
  const {improvesOrMatches}=require('../../src/application/joint_fitting_comparison');
  const old=reading(),weaker=reading({balance:{ratio:0.7},diagnostics:{journeys:{samples:32,completed:12},
    target:{id:'M',visits:12,sVictories:2}}});
  assert.equal(improvesOrMatches(old,weaker),false);
  const moreS={...weaker,diagnostics:{...weaker.diagnostics,target:{...weaker.diagnostics.target,sVictories:3}}};
  assert.equal(improvesOrMatches(old,moreS),true);
});
test('joint fitting compares weighted outcomes rather than just the worst displayed branch',()=>{
  const {improvesOrMatches}=require('../../src/application/joint_fitting_comparison');
  const branch=(path,weight,completed,sVictories)=>({path:[path,'M'],weight,
    journeys:{samples:32,completed},target:{id:'M',visits:completed,sVictories}});
  const old=reading({diagnostics:{journeys:{samples:32,completed:10},target:{id:'M',visits:10,sVictories:2},
    branches:[branch('A',.9,30,12),branch('B',.1,10,2)]}});
  const newValue=reading({diagnostics:{journeys:{samples:32,completed:11},target:{id:'M',visits:11,sVictories:2},
    branches:[branch('A',.9,25,8),branch('B',.1,11,2)]}});
  assert.equal(improvesOrMatches(old,newValue),false,'a small improvement on the displayed branch cannot hide a large common-path loss');
  newValue.diagnostics.branches[0]=branch('A',.9,31,13);
  assert.equal(improvesOrMatches(old,newValue),true);
  newValue.diagnostics.branches[1].weight=.2;
  assert.equal(improvesOrMatches(old,newValue),false,'different path weights are not comparable');
});

test('each fixed fleet is refitted against its own selected base plan before assessment and publication',async()=>{
  const events=[],prepared=[],proposals={a:{bases:[{rid:1,targets:['C','C']}]},b:{bases:[{rid:1,targets:['M','M']}]}};
  const run=createRouteCombatAssessor({
    merge:(_store,_slots,scheme)=>scheme.ships,
    inspect:(_service,_store,ships)=>({valid:true,scheme:{ships}}),
    assess:({report,landBases})=>{events.push(['assess',report.scheme.ships[0].item,landBases[0].targets[0]]);
      return reading({item:report.scheme.ships[0].item,target:landBases[0].targets[0]});},
    yieldControl:async()=>{}});
  const options=['a','b'].map(key=>({key,row:{scheme:{ships:[{id:1,item:'old'}]}}}));
  const result=await run({store:{},service:{},slots:[],fleet:1,options,
    landBases:option=>proposals[option.key],
    selectLandBaseCombat:({option})=>({assessment:reading(),proposal:proposals[option.key]}),
    refineLandBaseEquipment:async({option,slots,proposal})=>{
      events.push(['fit',option.key,proposal.bases[0].targets[0]]);
      const updated=slots.map(ship=>({...ship,item:'fitted-'+option.key}));
      return {slots:updated,report:{valid:true,scheme:{ships:updated}}};
    },
    onPrepared:(option,value)=>prepared.push([option.key,value])});
  assert.deepEqual(events,[['fit','a','C'],['assess','fitted-a','C'],['fit','b','M'],['assess','fitted-b','M']]);
  assert.equal(result.a.item,'fitted-a');assert.equal(result.b.target,'M');
  assert.equal(prepared[0][1].slots[0].item,'fitted-a');
  assert.strictEqual(prepared[1][1].landBaseProposal,proposals.b);
});

test('a failed or cancelled joint fit never publishes a stale candidate',async()=>{
  let publish=0,cancelled=false;
  const run=createRouteCombatAssessor({merge:()=>[{id:1}],inspect:()=>({valid:true}),
    assess:()=>({status:'estimated'}),yieldControl:async()=>{}});
  const args={slots:[],options:[{key:'a',row:{scheme:{ships:[{id:1}]}}}],
    landBases:()=>({bases:[{targets:['M']}]}),onPrepared:()=>publish++};
  const failed=await run({...args,refineLandBaseEquipment:async()=>{throw Error('飞机冲突');}});
  assert.equal(failed.a.status,'unknown');assert.match(failed.a.reasons[0],/飞机冲突/);assert.equal(publish,0);
  const stopped=await run({...args,isCancelled:()=>cancelled,refineLandBaseEquipment:async()=>{cancelled=true;return null;}});
  assert.equal(stopped,null);assert.equal(publish,0);
});

test('a failed refit retains the previously checked fleet and base with a warning',async()=>{
  const original=[{id:1,item:'old'}],proposal={bases:[{targets:['M','M']}],warnings:[]},prepared=[];
  const run=createRouteCombatAssessor({merge:()=>original,inspect:()=>({valid:true}),yieldControl:async()=>{}});
  const result=await run({slots:[],options:[{key:'a',row:{scheme:{ships:[{id:1}]}}}],landBases:()=>proposal,
    selectLandBaseCombat:()=>({assessment:reading(),proposal}),refineLandBaseEquipment:async()=>{throw Error('装备临时不可用');},
    onPrepared:(_option,value)=>prepared.push(value)});
  assert.strictEqual(prepared[0].slots,original);assert.equal(result.a.status,'estimated');
  assert.deepEqual(prepared[0].landBaseProposal.bases,proposal.bases);
  assert(prepared[0].landBaseProposal.warnings.some(value=>value.includes('保留已核对的原配装')));
});

test('a changed target after fitting causes one more fit before the final assessment',async()=>{
  const events=[],prepared=[];
  const run=createRouteCombatAssessor({merge:()=>[{id:1,item:'old'}],inspect:()=>({valid:true}),
    assess:({report,landBases})=>{events.push(['assess',report.item,landBases[0].targets[0]]);return reading();},yieldControl:async()=>{}});
  const result=await run({slots:[],options:[{key:'a',row:{scheme:{ships:[{id:1}]}}}],
    landBases:()=>({bases:[{targets:['M']}]}),
    selectLandBaseCombat:({report,proposal})=>({assessment:reading(),proposal:report.item?
      {bases:[{targets:['C']}]}:proposal}),
    refineLandBaseEquipment:async({slots,proposal})=>{const target=proposal.bases[0].targets[0];
      events.push(['fit',target]);return {slots,report:{valid:true,item:target}};},
    onPrepared:(_option,value)=>prepared.push(value)});
  assert.deepEqual(events,[['fit','M'],['assess','M','M'],['fit','C'],['assess','C','C']]);
  assert.equal(result.a.landBaseProposal.bases[0].targets[0],'C');
  assert.equal(prepared[0].report.item,'C');
});

test('worse or unknown combat results preserve the original fitted fleet and base plan',async()=>{
  for(const next of [reading({diagnostics:{journeys:{samples:32,completed:9},target:{id:'M',visits:9,sVictories:2}}}),
    reading({diagnostics:{journeys:{samples:32,completed:11},target:{id:'M',visits:11,sVictories:1}}}),
    {status:'unknown'}]){
    const before=reading(),original=[{id:1,item:'original'}],proposal={bases:[{targets:['M','M']}]},prepared=[];
    const run=createRouteCombatAssessor({merge:()=>original,inspect:()=>({valid:true,item:'original'}),
      assess:()=>next,yieldControl:async()=>{}});
    const result=await run({slots:[],options:[{key:'a',row:{scheme:{ships:[{id:1}]}}}],landBases:()=>proposal,
      selectLandBaseCombat:()=>({assessment:before,proposal}),
      refineLandBaseEquipment:async()=>({slots:[{id:1,item:'new'}],report:{valid:true,item:'new'}}),
      onPrepared:(_option,value)=>prepared.push(value)});
    assert.strictEqual(prepared[0].slots,original);assert.strictEqual(result.a.balance,before.balance);
    assert.strictEqual(prepared[0].landBaseProposal,proposal);
  }
});

test('a worse second base target keeps the first accepted joint fleet and its matching base',async()=>{
  const old=reading(),better=reading({diagnostics:{journeys:{samples:32,completed:12},target:{id:'M',visits:12,sVictories:3}}}),
    worse=reading({diagnostics:{journeys:{samples:32,completed:8},target:{id:'M',visits:8,sVictories:0}}}),prepared=[];
  const first={bases:[{targets:['M','M']}]},second={bases:[{targets:['C','C']}]};
  const run=createRouteCombatAssessor({merge:()=>[{id:1,item:'old'}],inspect:()=>({valid:true,item:'old'}),
    assess:({report})=>report.item==='first'?better:worse,yieldControl:async()=>{}});
  const result=await run({slots:[],options:[{key:'a',row:{scheme:{ships:[{id:1}]}}}],landBases:()=>first,
    selectLandBaseCombat:({report})=>report.item==='old'?{assessment:old,proposal:first}:{assessment:better,proposal:second},
    refineLandBaseEquipment:async({proposal})=>{const item=proposal===first?'first':'second';
      return {slots:[{id:1,item}],report:{valid:true,item}};},onPrepared:(_option,value)=>prepared.push(value)});
  assert.equal(prepared[0].slots[0].item,'first');assert.strictEqual(result.a.landBaseProposal,first);
  assert.equal(result.a.diagnostics.journeys.completed,12);
});

test('equipment worker receives a validated base plan and cannot use its aircraft',async()=>{
  const store=require('../helpers/workbench_fixture')();store.airbaseSync={complete:true};
  store.const.$equips[900]={api_id:900,api_name:'测试陆战',api_type:[0,0,48,48],api_distance:8,api_tyku:10,api_houk:0};
  for(let id=101;id<=104;id++)store.info.equips[id]={api_id:id,api_slotitem_id:900,api_level:0,api_alv:0};
  store.info.airbase=[{api_area_id:6,api_rid:1,api_action_kind:1,
    api_plane_info:[101,102,103,104].map((id,i)=>({api_squadron_id:i+1,api_slotid:id,api_count:18,api_max_count:18,api_state:1}))}];
  const bases=require('../../src/recommendation/land_base').sourceBases(store,'6-5');bases[0].targets=['C','C'];
  const scheme={fleet:1,ships:[{id:1,slots:[-1,-1],ex:-1}]};
  const service=Object.create(require('../../src/application/fleet_advisor_service').FleetAdvisorService.prototype);
  service.snapshots={get:()=>({store})};service.equipmentRecommendationArgs=(_store,args)=>args;
  service.getRecommendationFilters=()=>({normal:{}});
  let called=0;
  service.recommendations={run:async(method,input,args)=>{
    called++;assert.equal(method,'recommendNormalEquipment');assert.deepEqual(input.planningUnavailableEquipmentIds,[101,102,103,104]);
    assert.deepEqual(args.landBases,bases);assert.deepEqual(args.combatBaseline,scheme);return {scheme};
  }};
  const result=await service.recommendNormalEquipment({snapshotId:'test',area:'6-5',scheme,landBases:bases});
  assert.deepEqual(result.scheme,scheme);assert.equal(called,1);
  const conflict={...scheme,ships:[{id:1,slots:[101,-1],ex:-1}]};
  await assert.rejects(()=>service.recommendNormalEquipment({snapshotId:'test',area:'6-5',scheme:conflict,landBases:bases}),/基地航空队/);
  assert.equal(called,1,'reject conflicts before invoking the equipment worker');
});

test('actual 6-5 enemy slots affect the fleet scoring reference before fitting',()=>{
  const store=require('../helpers/workbench_fixture')();store.airbaseSync={complete:true};
  store.const.$equips[900]={api_id:900,api_name:'陆战',api_type:[0,0,48,48],api_distance:8,api_tyku:10,api_houk:0};
  for(let id=801;id<=804;id++)store.info.equips[id]={api_id:id,api_slotitem_id:900,api_level:0,api_alv:7};
  for(const [id,name,type,aa] of [[910,'深海猫艦戦改',6,12],[911,'深海地獄艦爆改',7,0],
    [912,'深海復讐艦攻改',8,5],[913,'深海棲艦偵察機',10,1]])
    store.const.$equips[id]={api_id:id,api_name:name,api_type:[0,0,type,type],api_tyku:aa};
  store.info.airbase=[{api_area_id:6,api_rid:1,api_action_kind:1,
    api_plane_info:[801,802,803,804].map((id,i)=>({api_squadron_id:i+1,api_slotid:id,api_count:18,api_max_count:18,api_state:1}))}];
  const bases=require('../../src/recommendation/land_base').sourceBases(store,'6-5');bases[0].targets=['C','C'];
  const scheme={fleet:1,ships:[{id:1,slots:[-1,-1]}]};
  const route=require('../../src/domain/routes/normal_routes').evaluateSearchRoute(store,{area:'6-5',target:'boss',fleet:1,scheme});
  const profile={...require('../../src/domain/routes/sortie_profile').previewForMap('6-5',{target:'boss'}),routePaths:[{nodes:['C']}]};
  const rows=[require('../../src/recommendation/context').context(store,{fleet:1},1).byId.get(1)];
  const score=require('../../src/recommendation/scoring').scoreRoute;
  const raw=score(route,profile,rows,'superiority','6-5',store,scheme);
  const adjusted=score(route,{...profile,landBases:bases},rows,'superiority','6-5',store,scheme);
  assert.equal(raw.airGoalRequired,198);
  assert.equal(adjusted.routeAirReference.landBaseRangeKind,'p05-p95');
  assert(adjusted.airGoalRequired<raw.airGoalRequired);
  assert.equal(adjusted.airGoalRequired,Math.ceil(adjusted.routeAirReference.nodes[0].enemyAirPowerRange.max*1.5));
});
