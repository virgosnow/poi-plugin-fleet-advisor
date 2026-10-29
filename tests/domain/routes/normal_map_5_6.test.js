'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const map=require('../../../data/normal_routes/5-6.json');
const {evaluatePoint}=require('../../../src/domain/routes/normal_routes');
const {routeOptions}=require('../../../src/domain/routes/route_plans');
const {actualMapLayout}=require('../../../src/ui/maps/map_assets');
const W=require('../../../src/ui/workbench/workbench_model');
function point(node,types,{score=100,speed='fast',visitedNodes=[]}={}){
  return evaluatePoint(map.machineRules[node],types.map((stype,i)=>({stype,name:'测试'+i,instanceId:i+1})),
    {visitedNodes,speed:{status:'observed',fleetSpeed:speed},lineOfSight:{status:'computed',rawScoresByCoefficient:{4:score},thresholdMargin:0}});
}
function fixed(node,types,to,opts){const r=point(node,types,opts);assert.equal(r.status,'fixed');assert.deepEqual(r.destinations,[to]);}

test('5-6 changes starting points with stage, hull and speed without bypassing first-start priorities',()=>{
  fixed('start#gauge1',[11,11,6,3,2,2],'A1');
  fixed('start#gauge2',[11,11,6,3,2,2],'I');
  fixed('start#gauge3',[11,3,16,2,2,2],'A1');
  fixed('start#gauge2',[3,3,1,1,2,2],'A');
  fixed('start#gauge3',[9,9,3,3,2,2],'A1',{speed:'slow'});
  fixed('start#gauge3',[8,8,3,3,2,2],'I');
  fixed('start#gauge1',[16,3,2,2,2,2],'A',{speed:'slow'});
});
test('5-6 first-gauge battleships change LoS from 58 to 65; later gates require 80 and 88',()=>{
  for(const [node,types,threshold,yes,no]of [['E',[16,3,2,2,2,2],58,'G','F'],['E',[10,10,2,2,2,2],65,'G','F'],
    ['L',[11,11,6,3,2,2],80,'N','M'],['X',[8,11,5,3,2,2],88,'Z','Y']]){
    fixed(node,types,no,{score:threshold-.001});fixed(node,types,yes,{score:threshold});
  }
});
test('5-6 branch precedence and phase lock preserve the source conditions',()=>{
  fixed('B',[10,10,2,2,2,2],'C2',{speed:'slow'});
  fixed('C1',[11,3,2,2,2,2],'C2',{visitedNodes:['A','B']});
  fixed('C1',[11,3,2,2,2,2],'C',{visitedNodes:['A1','A2','B']});
  fixed('Q#gauge2',[11,11,3,2,2,2],'Q2',{speed:'fastPlus'});
  fixed('Q',[11,11,3,2,2,2],'W');
  fixed('Q',[11,11,3,2,2,2],'U',{speed:'slow'});
  fixed('Q',[11,11,11,3,2,2],'Q2');
  fixed('Q',[11,11,11,3,2,2],'W',{speed:'fastPlus'});
  fixed('K',[11,11,6,3,2,2],'L');
  fixed('K',[11,11,6,3,2,2],'K2',{speed:'slow'});
  assert.notEqual(point('Q1',[11,11,6,3,2,2]).status,'fixed');
});
test('5-6 guide catalogue covers all gauges with distinct presets and visible unlock prerequisites',()=>{
  const options=routeOptions('5-6').filter(o=>o.recommend!==false);
  assert.deepEqual([...new Set(options.map(o=>o.phase))],['gauge1','gauge2','gauge3']);
  for(const phase of ['gauge1','gauge2','gauge3'])assert(options.filter(o=>o.phase===phase).length>=3);
  assert.equal(new Set(options.map(o=>o.key)).size,options.length);
  assert.match(W.routeArrival(null,options.find(o=>o.phase==='gauge2'),false).note,/抵达 R 点/);
  assert.match(W.routeArrival(null,options.find(o=>o.phase==='gauge3'),false).note,/击破第二血条/);
  for(const option of options){
    const preview={nodes:option.nodes.map(id=>({id,kind:'battle'})),edges:[]};
    const layout=actualMapLayout('5-6',preview,option.nodes);assert(layout.real);
    assert.equal(layout.startId,option.phase==='gauge1'?'start#1':'start#2');
    const sprites=new Set(layout.backgroundRoutes.map(r=>r.key));
    for(let i=1;i<option.nodes.length;i++)assert(sprites.has(option.nodes[i-1]+'>'+option.nodes[i]));
  }
});
test('5-6 enemy catalogue resolves all enemies and treats landing as non-combat',()=>{
  const data=require('../../../data/sortie/encounters/5-6.json');
  assert.equal(data.apiIdBackfill.unresolvedCount,0);
  assert.equal(data.nodes.E.kind,'transport');
  const air=require('../../../src/domain/routes/route_air').routeAirReference({},'5-6',{examples:[['E']]});
  assert.equal(air.status,'known');assert.equal(air.superiority,0);assert(air.nodes[0].noAirBattle);
  assert.equal(data.gauges[0].mechanism,'transport');assert.equal(data.gauges[0].transportPoints,280);
  assert.equal(data.gauges[1].mechanism,'bossSunk');assert.equal(data.gauges[1].killsToClear,2);
  assert.equal(data.gauges[2].killsToClear,3);
});
