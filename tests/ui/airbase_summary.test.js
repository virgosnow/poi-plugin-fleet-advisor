'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../../src/ui/workbench/workbench_model');

test('air superiority depending on land-base estimates is marked as expected, never as a guarantee',t=>{
 const air=require('../../src/domain/routes/route_air'),planner=require('../../src/recommendation/land_base');
 const reference={status:'known',superiority:30,supremacy:60,limitingNodes:['M'],nodes:[{id:'M',kind:'battle'}]};
 const estimate={status:'estimated',margins:{supremacy:{min:2,max:5},superiority:{min:30,max:40}},paths:[],basis:'参考'};
 t.mock.method(air,'routeAirReference',()=>reference);
 t.mock.method(air,'withLandBases',()=>({...reference,landBase:true}));
 t.mock.method(air,'estimateRouteAir',()=>estimate);
 t.mock.method(planner,'validatePlan',()=>({valid:true,issues:[]}));
 const report={route:{area:'6-5'},scheme:{ships:[]},metrics:{airPower:{status:'range',min:90,max:95}}};
 const args=[report,{area:'6-5'},[['B','M']],{store:{},landBases:[{targets:['M','M']}]}];
 assert.equal(W.fleetSummary(...args).air.state,'预计全程空确');
 estimate.margins.supremacy.min=-1;assert.equal(W.fleetSummary(...args).air.state,'预计全程空优');
 estimate.status='unknown';assert.equal(W.fleetSummary(...args).air.state,'损耗待确认');
});

test('base-adjusted headline thresholds and limiting nodes come from actual per-node references',t=>{
 const air=require('../../src/domain/routes/route_air'),planner=require('../../src/recommendation/land_base');
 const reference={status:'known',superiority:468,supremacy:936,limitingNodes:['M'],nodes:[{id:'I',kind:'battle'},{id:'M',kind:'battle'}]};
 const step=(node,lo,hi)=>({node,requiredLow:{superiority:Math.ceil(lo*1.5),supremacy:lo*3},
   required:{superiority:Math.ceil(hi*1.5),supremacy:hi*3},before:{min:100,max:120}});
 const estimate={status:'estimated',margins:{supremacy:{min:-100,max:-20},superiority:{min:-20,max:20}},
   paths:[{steps:[step('I',100,100),step('M',40,70)]}],basis:'参考'};
 t.mock.method(air,'routeAirReference',()=>reference);
 t.mock.method(air,'withLandBases',()=>({...reference,landBase:true}));
 t.mock.method(air,'estimateRouteAir',()=>estimate);
 t.mock.method(planner,'validatePlan',()=>({valid:true,issues:[]}));
 const report={route:{area:'6-5'},scheme:{ships:[]},metrics:{airPower:{status:'range',min:90,max:95}}};
 const args=[report,{area:'6-5'},[['B','I','M']],{store:{},landBases:[{targets:['M','M']}]}];
 let summary=W.fleetSummary(...args).air;
 assert.equal(summary.compactHint,'I 点 · 空优 150 · 空确 300（参考）');
 assert(!summary.compactHint.includes('468'));assert(!summary.compactHint.includes('M 点'));
 estimate.paths[0].steps[1]=step('M',40,160);summary=W.fleetSummary(...args).air;
 assert.equal(summary.compactHint,'I/M 点 · 空优 150–240 · 空确 300–480（参考）');
 estimate.status='unknown';summary=W.fleetSummary(...args).air;
 assert.equal(summary.compactHint,'基地航空后制空门槛待确认');assert(!summary.compactHint.includes('468'));
});
