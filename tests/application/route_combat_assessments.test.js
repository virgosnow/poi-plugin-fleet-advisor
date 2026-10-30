'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createRouteCombatAssessor}=require('../../src/application/route_combat_assessments');

test('each route assesses its own merged fleet and matching stage',async()=>{
  const calls=[],store={info:{},const:{}},slots=[{id:88}],service={};
  const run=createRouteCombatAssessor({
    merge:(s,old,scheme,config)=>{assert.equal(s,store);assert.equal(old,slots);assert.equal(config.preservePositions,false);return scheme.ships;},
    inspect:(svc,s,merged,settings)=>{assert.equal(svc,service);assert.equal(s,store);calls.push({merged,settings});return {valid:true,scheme:{ships:merged}};},
    assess:({report,option})=>({status:'estimated',balance:{rank:report.scheme.ships[0].id},key:option.key}),
    yieldControl:async()=>{}});
  const options=[{key:'a',phase:'first',row:{scheme:{ships:[{id:1}]}}},{key:'b',phase:'second',row:{scheme:{ships:[{id:2}]}}}];
  const results=await run({store,service,slots,fleet:2,settings:{kind:'normal',area:'7-3',phase:'first'},options});
  assert.equal(results.a.balance.rank,1);assert.equal(results.b.balance.rank,2);
  assert.equal(calls[0].settings.phase,'first');assert.equal(calls[1].settings.phase,'second');
  assert.equal(calls[0].settings.fleet,2);
});

test('missing candidates and failed inspections never acquire a battle grade',async()=>{
  let assessed=0;
  const run=createRouteCombatAssessor({merge:()=>[],inspect:()=>({valid:false,error:'候选不可用'}),
    assess:()=>{assessed++;},yieldControl:async()=>{}});
  const results=await run({slots:[],options:[{key:'missing',status:'notFound'},
    {key:'uncertain',status:'unconfirmed'},{key:'invalid',row:{scheme:{ships:[]}}}]});
  assert.equal(results.missing.status,'notFound');assert.equal(results.uncertain.status,'unknown');
  assert.equal(results.invalid.status,'unknown');assert.equal(assessed,0);
});

test('batch yields and discards partial results if the request becomes stale',async()=>{
  let yields=0,assessments=0;
  const run=createRouteCombatAssessor({merge:()=>[],inspect:()=>({valid:true}),
    assess:()=>{assessments++;return {status:'estimated'};},yieldControl:async()=>{yields++;}});
  const result=await run({slots:[],options:[{key:'a',row:{scheme:{}}},{key:'b',row:{scheme:{}}}],
    isCancelled:()=>yields>=2});
  assert.equal(result,null);assert.equal(yields,2);assert.equal(assessments,1);
});

test('exceptions in one route do not prevent independent routes being checked',async()=>{
  const run=createRouteCombatAssessor({merge:(_s,_old,scheme)=>{if(scheme.bad)throw Error('失效');return [];},
    inspect:()=>({valid:true}),assess:()=>({status:'estimated'}),yieldControl:async()=>{}});
  const result=await run({slots:[],options:[{key:'bad',row:{scheme:{bad:true}}},{key:'good',row:{scheme:{}}}]});
  assert.equal(result.bad.status,'unknown');assert.match(result.bad.reasons[0],/失效/);
  assert.equal(result.good.status,'estimated');
});

test('real workbench merge and preview preserve held ships while inspecting each recommendation',async()=>{
  const store=require('../helpers/workbench_fixture')(),W=require('../../src/ui/workbench/workbench_model');
  const {Controller}=require('../../src/application/controller');
  const service=new Controller({getStore:()=>store}),held={...W.entry(store,1),pin:true};
  const options=[2,3].map(id=>({key:`route-${id}`,phase:'',row:{scheme:{fleet:1,ships:[
    {id:1,slots:[-1,-1],ex:-1},{id,slots:[-1,-1],ex:-1}]}}}));
  const run=createRouteCombatAssessor({yieldControl:async()=>{},assess:({report,option})=>({
    status:'estimated',shipIds:report.scheme.ships.map(ship=>ship.id),area:report.route.area,key:option.key})});
  const results=await run({store,service,slots:[held],fleet:1,
    settings:{kind:'normal',area:'1-1',target:'boss',phase:''},options});
  assert.deepEqual(results['route-2'].shipIds,[1,2]);assert.deepEqual(results['route-3'].shipIds,[1,3]);
  assert.equal(results['route-2'].area,'1-1');assert.equal(held.pin,true);
});

test('real route profile and combat model evaluate the recommended fleet',async()=>{
  const store=require('../helpers/workbench_fixture')(),W=require('../../src/ui/workbench/workbench_model');
  const {Controller}=require('../../src/application/controller'),plans=require('../../src/domain/routes/route_plans');
  const {createCombatAssessment}=require('../../src/application/combat_assessment');
  const {evaluateRoute}=require('../../src/domain/combat/route_estimate');
  Object.assign(store.info.ships[1],{api_nowhp:30,api_maxhp:30,api_soukou:[12,12],api_karyoku:[35,35],
    api_raisou:[30,30],api_kyouka:[0,0,0,0],api_lucky:[20,20]});
  Object.assign(store.const.$ships[1],{api_houg:[35,35],api_raig:[30,30],api_leng:2});
  const option={...plans.recommendedOptions('1-1')[0],row:{scheme:{fleet:1,ships:[{id:1,slots:[-1,-1],ex:-1}]}}};
  const assess=createCombatAssessment({plans,profileForRoute:require('../../src/domain/routes/sortie_profile').profileForRoute,
    evaluate:(...args)=>evaluateRoute(args[0],args[1],args[2],{...args[3],now:()=>0})});
  const run=createRouteCombatAssessor({assess,yieldControl:async()=>{}});
  const results=await run({store,service:new Controller({getStore:()=>store}),slots:[],fleet:1,
    settings:{kind:'normal',area:'1-1',target:'boss',phase:''},options:[option]});
  assert.equal(results[option.key].status,'estimated');
  assert.ok(Number.isFinite(results[option.key].balance.ratio));
});
