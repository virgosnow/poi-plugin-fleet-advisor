'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createLandBaseCombatSelector}=require('../../src/application/land_base_combat_choice');
const result=(completed,sVictories=0,status='estimated')=>({status,diagnostics:{journeys:{samples:32,completed},
  target:{id:'M',visits:completed,sVictories},nodes:[]}});
const bases=target=>[{rid:1,targets:['M','M']},{rid:2,targets:target}];
const args=()=>({store:require('../helpers/workbench_fixture')(),report:{scheme:{ships:[{id:1}]},route:{area:'6-5'}},option:{key:'x'},proposal:{bases:bases(['B','B']),warnings:['原提示']}});
const paths={optionPaths:()=>[['B','F','I','M']],fleetPaths:()=>[['B','F','I','M']],orderedPathNodes:p=>p[0]};
test('safe arrivals take priority over Boss S; the best plan is reused',()=>{
 let calls=0,priors=0;
 const selector=createLandBaseCombatSelector({paths,prioritize:(_s,{diagnostics})=>{priors++;assert.equal(diagnostics.journeys.completed,5);return {
   changed:true,bases:bases(['I','F']),alternatives:[bases(['I','I']),bases(['B','I'])],warnings:['换装']};},
   assess:({landBases})=>{calls++;const first=landBases[1].targets.join('');return first==='BB'?result(5,1):first==='IF'?result(3,2):first==='II'?result(9,0):result(8,1);},now:()=>0});
 const input=args(),choice=selector(input);
 assert.deepEqual(choice.proposal.bases[1].targets,['I','I']);assert.deepEqual(choice.proposal.warnings,['原提示','换装']);
 assert.equal(choice.assessment.diagnostics.journeys.completed,9);assert.equal(calls,4);assert.equal(priors,1);
 assert.strictEqual(selector(input),choice);assert.equal(calls,4);
});
test('unknown, tied, worse or incomplete results do not displace original',()=>{
 for(const candidate of [result(5,1),result(4,5),result(9,2,'unknown')]){
   let calls=0;const selector=createLandBaseCombatSelector({paths,now:()=>0,prioritize:()=>({changed:true,bases:bases(['I','F'])}),
     assess:()=>++calls===1?result(5,1):candidate});
   assert.deepEqual(selector(args()).proposal.bases[1].targets,['B','B']);
 }
});
test('budget exhaustion leaves original plan instead of picking from incomplete comparisons',()=>{
 let clock=0,calls=0;const selector=createLandBaseCombatSelector({paths,budgetMs:20,now:()=>clock,
   prioritize:()=>({changed:true,bases:bases(['I','F']),alternatives:[bases(['I','I'])]}),
   assess:()=>{calls++;if(calls===2)clock=25;return calls===1?result(5):result(15);}});
 const input=args(),first=selector(input);
 assert.deepEqual(first.proposal.bases[1].targets,['B','B']);assert.equal(calls,2);
 assert(first.proposal.warnings.some(text=>text.includes('超时')));
 clock=0;selector(input);assert(calls>2,'an incomplete comparison must not be cached');
});
test('equal arrival and boss S may prefer a lower worst en-route risk with a clear caveat',()=>{
 const original=result(5),candidate=result(5);original.diagnostics.nodes=[{id:'I',severe:16,visits:24}];
 candidate.diagnostics.nodes=[{id:'I',severe:15,visits:24}];let calls=0;
 const selector=createLandBaseCombatSelector({paths,now:()=>0,prioritize:()=>({changed:true,bases:bases(['B','I'])}),
   assess:()=>++calls===1?original:candidate});
 const chosen=selector(args());assert.deepEqual(chosen.proposal.bases[1].targets,['B','I']);
 assert(chosen.proposal.warnings.some(row=>row.includes('样本有限')));
});
test('in-place account and master updates invalidate a cached comparison',()=>{
 let calls=0;const selector=createLandBaseCombatSelector({paths,now:()=>0,prioritize:()=>({changed:false}),
   assess:()=>{calls++;return result(5);}});
 const input=args();input.store.info.equips[1]={api_slotitem_id:1,level:0};input.store.const.$equips[1]={api_tyku:3};
 selector(input);selector(input);assert.equal(calls,1);
 input.store.info.ships[1].api_nowhp=9;selector(input);assert.equal(calls,2);
 input.store.info.equips[1].level=1;selector(input);assert.equal(calls,3);
 input.store.const.$equips[1].api_tyku=4;selector(input);assert.equal(calls,4);
});
test('risk optimization receives the fleet-checked path, not impossible branches in a merged option',()=>{
 const route=['B','F','I','J','M'];let seen;
 const actual={...paths,optionPaths:()=>[['B','C','D','G','M'],route],fleetPaths:()=>[route]};
 const selector=createLandBaseCombatSelector({paths:actual,now:()=>0,
   assess:()=>result(5),prioritize:(_store,input)=>{seen=input.routeNodes;return {changed:false};}});
 selector(args());assert.deepEqual(seen,route);assert(!seen.includes('C'));assert(!seen.includes('G'));
});
test('selector fingerprint also invalidates the underlying combat cache for in-place HP changes',t=>{
 const planner=require('../../src/recommendation/land_base');t.mock.method(planner,'validatePlan',()=>({valid:true,issues:[]}));
 const {createCombatAssessment}=require('../../src/application/combat_assessment');let calls=0;
 const p={optionPaths:o=>[o.nodes],fleetPaths:()=>[['B','M']]};
 const assess=createCombatAssessment({plans:p,profileForRoute:()=>({status:'known',routePaths:[{nodes:['B','M']}]}),
   evaluate:store=>{calls++;return result(store.info.ships[1].api_nowhp);}});
 const selector=createLandBaseCombatSelector({paths,assess,now:()=>0,prioritize:()=>({changed:false})});
 const input=args();input.option.nodes=['B','M'];input.report.valid=true;input.store.info.ships[1].api_nowhp=5;
 assert.equal(selector(input).assessment.diagnostics.journeys.completed,5);
 input.store.info.ships[1].api_nowhp=6;
 assert.equal(selector(input).assessment.diagnostics.journeys.completed,6);assert.equal(calls,2);
});
test('an incomplete snapshot bypasses the underlying cache for original and candidate',()=>{
 const flags=[];const selector=createLandBaseCombatSelector({paths,now:()=>0,
   prioritize:()=>({changed:true,bases:bases(['I','F'])}),
   assess:args=>{flags.push(args.bypassCache);return result(flags.length===1?5:7);}});
 const input=args();input.store={};selector(input);assert.deepEqual(flags,[true,true]);
});


test('a transient forecast timeout is not cached by the land-base selector',()=>{
 let calls=0;const selector=createLandBaseCombatSelector({paths,now:()=>0,prioritize:()=>({changed:false}),
   assess:()=>++calls===1?{status:'unknown',reasonCode:'timeBudgetExceeded',reasons:['time limit reached']}:result(5)});
 const input=args();assert.equal(selector(input).assessment.status,'unknown');
 assert.equal(selector(input).assessment.status,'estimated');assert.equal(calls,2);
});
test('a transient forecast timeout is not cached by combat assessment',()=>{
 const {createCombatAssessment}=require('../../src/application/combat_assessment');let calls=0;
 const plans={optionPaths:()=>[['B','M']],fleetPaths:()=>[['B','M']]};
 const assess=createCombatAssessment({plans,profileForRoute:()=>({status:'known',routePaths:[{nodes:['B','M']}]}),
   evaluate:()=>++calls===1?{status:'unknown',reasonCode:'timeBudgetExceeded',reasons:['time limit reached']}:result(5)});
 const input={store:require('../helpers/workbench_fixture')(),report:{valid:true,scheme:{ships:[{id:1}]},route:{area:'6-5'}},option:{key:'x'}};
 assert.equal(assess(input).status,'unknown');assert.equal(assess(input).status,'estimated');assert.equal(calls,2);
});


test('overwhelming disadvantage commits a whole squadron to reachable en-route threats even when Boss S falls',()=>{
 const original=result(2,2);original.balance={rank:0};const candidate=result(5,1);candidate.balance={rank:0};
 let calls=0;const selector=createLandBaseCombatSelector({paths,now:()=>0,
   prioritize:()=>({changed:true,bases:bases(['F','I'])}),assess:()=>++calls===1?original:candidate});
 const input=args();input.proposal.bases=bases(['M','M']);const choice=selector(input);
 assert.deepEqual(choice.proposal.bases[1].targets,['F','I']);assert.strictEqual(choice.assessment,candidate);
 assert(choice.proposal.warnings.some(text=>text.includes('支援道中')));
});
test('overwhelming disadvantage keeps a reachable forward plan if its new forecast times out',()=>{
 const original=result(1,0);original.balance={rank:0};let calls=0;
 const selector=createLandBaseCombatSelector({paths,now:()=>0,prioritize:()=>({changed:true,bases:bases(['I','I'])}),
   assess:()=>++calls===1?original:{status:'unknown',reasonCode:'timeBudgetExceeded',reasons:['time limit reached']}});
 const input=args();input.proposal.bases=bases(['M','M']);const choice=selector(input);
 assert.deepEqual(choice.proposal.bases[1].targets,['I','I']);assert.equal(choice.assessment.status,'unknown');
});
test('cannot override locked or unavailable forward support and explains the limitation',()=>{
 const original=result(0);original.balance={rank:0};const selector=createLandBaseCombatSelector({paths,now:()=>0,
   prioritize:()=>({changed:false}),assess:()=>original});
 const input=args();input.proposal.bases=bases(['M','M']);const choice=selector(input);
 assert.deepEqual(choice.proposal.bases[1].targets,['M','M']);assert(choice.proposal.warnings.some(t=>t.includes('未找到可确认的道中')));
});


test('one squadron split gains arrival priority even when Boss S decreases',()=>{
 const original=result(4,3),candidate=result(8,2);original.balance={rank:1};candidate.balance={rank:1};
 const single=t=>[{rid:1,targets:t}];let calls=0;
 const selector=createLandBaseCombatSelector({paths,now:()=>0,prioritize:()=>({changed:true,bases:single(['C','N'])}),
  assess:()=>++calls===1?{...original,diagnostics:{...original.diagnostics,target:{...original.diagnostics.target,id:'N'}}}:
    {...candidate,diagnostics:{...candidate.diagnostics,target:{...candidate.diagnostics.target,id:'N'}}}});
 const input=args();input.report.route.area='6-4';input.proposal.bases=single(['N','N']);
 assert.deepEqual(selector(input).proposal.bases[0].targets,['C','N']);
});
test('when safe arrivals tie, Boss S victory after night combat breaks the tie',()=>{
 let calls=0;const selector=createLandBaseCombatSelector({paths,now:()=>0,prioritize:()=>({changed:true,bases:bases(['F','I'])}),
  assess:()=>++calls===1?result(8,2):result(8,4)});
 const choice=selector(args());assert.deepEqual(choice.proposal.bases[1].targets,['F','I']);
 assert.equal(choice.assessment.diagnostics.target.sVictories,4);
});
test('aircraft fits are compared for both en-route and boss without changing target waves',()=>{
 const initial=bases(['I','I']),forward=bases(['I','I']),boss=bases(['I','I']);
 initial[0].slots=['boss original'];initial[1].slots=['forward original'];
 forward[0].slots=['boss original'];forward[1].slots=['three attackers'];
 boss[0].slots=['four attackers'];boss[1].slots=['forward original'];
 const seen=[];const selector=createLandBaseCombatSelector({paths,now:()=>0,prioritize:()=>({changed:false}),
  aircraft:(_store,input)=>input.bases===initial?[forward,boss]:[],
  assess:({landBases})=>{seen.push(landBases);return landBases===forward?result(10,1):landBases===boss?result(8,6):result(7,2);}});
 const input=args();input.proposal.bases=initial;const chosen=selector(input);
 assert.equal(seen.length,3);assert.strictEqual(chosen.proposal.bases,forward);
 assert.deepEqual(chosen.proposal.bases.map(b=>b.targets),[['M','M'],['I','I']]);
 assert(chosen.proposal.warnings.some(t=>t.includes('有限战况场景')));
});
test('a second comparison can improve both squadrons without reusing one plane',()=>{
 const initial=bases(['I','I']),forward=bases(['I','I']),both=bases(['I','I']);
 initial[0].slots=[1];initial[1].slots=[2];forward[0].slots=[1];forward[1].slots=[3];both[0].slots=[4];both[1].slots=[3];
 const selector=createLandBaseCombatSelector({paths,now:()=>0,prioritize:()=>({changed:false}),
  aircraft:(_s,{bases:current})=>current===initial?[forward]:current===forward?[both]:[],
  assess:({landBases})=>landBases===both?result(12,3):landBases===forward?result(10,2):result(7,1)});
 const input=args();input.proposal.bases=initial;const chosen=selector(input);
 assert.strictEqual(chosen.proposal.bases,both);assert.equal(chosen.assessment.diagnostics.journeys.completed,12);
});
test('overwhelming disadvantage accepts one forward wave from the only sortie squadron',()=>{
 const initial=result(1,0);initial.balance={rank:0};const next=result(3,0);let calls=0;
 const one=targets=>[{rid:1,targets}];const selector=createLandBaseCombatSelector({paths,now:()=>0,
  prioritize:()=>({changed:true,bases:one(['C','M'])}),assess:()=>++calls===1?initial:next});
 const input=args();input.report.route.area='6-4';input.proposal.bases=one(['M','M']);
 assert.deepEqual(selector(input).proposal.bases[0].targets,['C','M']);
});
