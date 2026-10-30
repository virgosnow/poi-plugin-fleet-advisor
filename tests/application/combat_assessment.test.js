'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createCombatAssessment}=require('../../src/application/combat_assessment');
function fixture(){
  let calls=0,inspectedPaths;
  const store={info:{},const:{}},report={valid:true,scheme:{ships:[{id:1}]},route:{area:'1-4',phase:''},profile:{area:'1-4'}};
  const option={key:'selected',nodes:['A','B']};
  const assess=createCombatAssessment({plans:{optionPaths:o=>[o.nodes],fleetPaths:()=>[['A','B']]},
    profileForRoute:(area,route,paths)=>{inspectedPaths=paths;return {status:'known',routePaths:paths.map(nodes=>({nodes}))};},
    evaluate:(_store,_scheme,profile)=>{calls++;return {status:'ready',path:profile.routePaths[0].nodes};}});
  return {store,report,option,assess,calls:()=>calls,paths:()=>inspectedPaths};
}
test('only a current inspection and selected fleet paths are assessed',()=>{
  const f=fixture(),args={store:f.store,report:f.report,option:f.option};
  assert.equal(f.assess({...args,option:null}).status,'unselected');
  assert.equal(f.assess({...args,report:{...f.report,scheme:{ships:[]}}}).status,'empty');
  assert.equal(f.assess({...args,dirty:true}).status,'pending');
  assert.equal(f.calls(),0);
  assert.equal(f.assess(args).status,'ready');assert.deepEqual(f.paths(),[['A','B']]);
  assert.equal(f.calls(),1);
});
test('cache is scoped to inspection, route and immutable store references',()=>{
  const f=fixture(),args={store:f.store,report:f.report,option:f.option};
  f.assess(args);f.assess(args);assert.equal(f.calls(),1);
  f.assess({...args,option:{...f.option,key:'other'}});assert.equal(f.calls(),2);
  f.assess({...args,store:{...f.store,info:{}}});assert.equal(f.calls(),3);
  f.assess({...args,report:{...f.report}});assert.equal(f.calls(),4);
});
test('an unreachable or stage-mismatched route never reuses a previously valid assessment',()=>{
  const f=fixture(),args={store:f.store,report:f.report,option:f.option};
  f.assess(args);
  assert.equal(f.assess({...args,option:{...f.option,phase:'gauge2'}}).status,'pending');
  const unavailable=createCombatAssessment({plans:{fleetPaths:()=>[],optionPaths:()=>[]},
    profileForRoute:()=>{throw Error('must not evaluate')},evaluate:()=>{throw Error('must not evaluate')}});
  assert.equal(unavailable(args).status,'unreachable');
});
test('unrelated incomplete graph branches do not hide a fully resolved selected path',()=>{
  const f=fixture(),args={store:f.store,report:f.report,option:f.option};
  let seen;
  const assess=createCombatAssessment({plans:{optionPaths:o=>[o.nodes],fleetPaths:()=>[['A','B']]},
    profileForRoute:()=>({status:'possible',incomplete:true,truncated:true,routePaths:[{nodes:['A','B'],uncertain:true}]}),
    evaluate:(_s,_c,p)=>{seen=p;return {status:'estimated'};}});
  assert.equal(assess(args).status,'estimated');assert.equal(seen.incomplete,false);
  assert.equal(seen.truncated,false);assert.equal(seen.routePaths[0].uncertain,true);
});
test('missing any selected fleet path prevents calculation',()=>{
  const f=fixture(),args={store:f.store,report:f.report,option:f.option};
  const assess=createCombatAssessment({plans:{optionPaths:o=>[o.nodes],fleetPaths:()=>[['A','B'],['C','B']]},
    profileForRoute:()=>({status:'possible',routePaths:[{nodes:['A','B']}]}),
    evaluate:()=>{throw Error('must not calculate with a missing selected path');}});
  assert.equal(assess(args).status,'unknown');
});
test('invalid or unexpected enemy data does not crash the workbench',()=>{
  const f=fixture(),args={store:f.store,report:f.report,option:f.option};
  const assess=createCombatAssessment({plans:{optionPaths:o=>[o.nodes],fleetPaths:()=>[['A','B']]},
    profileForRoute:()=>({status:'known',routePaths:[{nodes:['A','B']}]}),
    evaluate:()=>{throw Error('invalid data');}});
  const result=assess(args);assert.equal(result.status,'unknown');assert.match(result.reasons[0],/无法计算/);
});
test('real inspected 1-1 draft passes only its fleet-checked path to the evaluator',()=>{
  const fixture=require('../helpers/workbench_fixture'),W=require('../../src/ui/workbench/workbench_model');
  const {Controller}=require('../../src/application/controller');
  const plans=require('../../src/domain/routes/route_plans'),profileForRoute=require('../../src/domain/routes/sortie_profile').profileForRoute;
  const store=fixture(),slots=[W.entry(store,1)],settings={kind:'normal',fleet:1,area:'1-1',target:'boss',phase:'',missionId:1,revision:0};
  const report=W.inspect(new Controller({getStore:()=>store}),store,slots,settings),option=plans.recommendedOptions('1-1')[0];
  let actual;
  const assess=createCombatAssessment({plans,profileForRoute,evaluate:(_store,_scheme,profile)=>{actual=profile;return {status:'estimated'};}});
  assert.equal(assess({store,report,option}).status,'estimated');
  assert.deepEqual(actual.routePaths.map(p=>p.nodes),[['A','C']]);
  assert.equal(actual.referenceOnly,undefined);
  assert.equal(actual.selectedPathsVerified,true);
});
test('inspected 1-1 draft reaches the real comparison renderer and stale edits do not',()=>{
  const fixture=require('../helpers/workbench_fixture'),W=require('../../src/ui/workbench/workbench_model');
  const {Controller}=require('../../src/application/controller'),plans=require('../../src/domain/routes/route_plans');
  const {evaluateRoute}=require('../../src/domain/combat/route_estimate'),render=require('../../src/ui/components/combat_balance');
  const assessCombat=createCombatAssessment({plans,profileForRoute:require('../../src/domain/routes/sortie_profile').profileForRoute,
    evaluate:(store,scheme,profile,options)=>evaluateRoute(store,scheme,profile,{...options,now:()=>0})});
  const store=fixture(),ship=store.info.ships[1],master=store.const.$ships[1];
  Object.assign(ship,{api_nowhp:30,api_maxhp:30,api_soukou:[12,12],api_karyoku:[35,35],api_raisou:[30,30],api_kyouka:[0,0,0,0],api_lucky:[20,20]});
  Object.assign(master,{api_houg:[35,35],api_raig:[30,30],api_leng:2});
  const slots=[W.entry(store,1)],settings={kind:'normal',fleet:1,area:'1-1',target:'boss',phase:'',missionId:1,revision:0};
  const report=W.inspect(new Controller({getStore:()=>store}),store,slots,settings),option=plans.recommendedOptions('1-1')[0];
  const h=(type,props,...children)=>({type,props:props||{},children:children.flat()});
  const result=assessCombat({store,report,option});
  assert.equal(result.status,'estimated');
  assert.equal(render(h,result).props.className,'paa-combat-balance');
  const stale=assessCombat({store,report,option,dirty:true});
  assert.equal(stale.status,'pending');assert.equal(render(h,stale).props.className,'paa-balance-pending');
});
