'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../../helpers/workbench_fixture');
const {evaluateNormalRoute}=require('../../../src/domain/routes/normal_routes');
const P=require('../../../src/domain/routes/route_plans');
const W=require('../../../src/ui/workbench/workbench_model');
const {recommendNormalFleet,recommendNormalEquipment}=require('../../../src/recommendation');

function fleet(types){
  const store=fixture();
  for(const id of Object.keys(store.info.ships)){
    if(Number(id)>types.length){delete store.info.ships[id];delete store.const.$ships[id];continue;}
    store.const.$ships[id].api_stype=types[Number(id)-1];store.info.ships[id].api_lv=99;
  }
  return store;
}
const ids=[1,2,3,4,5,6];
// Independent path vectors exercise merge arithmetic after preset replacement.
const vectors={
 '1-3:A>E>F>J':['AEFJ','ADBEFJ'], '2-1:C>D>H':['CDH','CEDH'],
 '2-2:C>E>G>H>K':['CEGHK','CEGK'], '2-3:C>F>G>K>N':['CFGKN','CFGIKN','CDFGKN','CDFGIKN'],
 '3-3:A>B>F>J>M':['ABFJM','ABDFJM'], '5-3:D>G>I>O>K>E>Q':['DGIOKEQ','DGIOKHEQ'],
 '5-3:D>G>J>L>O>K>E>Q':['DGJLOKEQ','DGJLOKHEQ'], '7-3:A>C>D>G>J>P':['ACDGJP','ACDGIJP']};
const option=(area,key)=>{const paths=vectors[area+':'+key].map(s=>[...s]);return {key,nodes:paths[0],paths,...area==='2-3'?{arrivalMode:'boss'}:{},...area==='7-3'?{phase:'gauge2'}:{}};};
const assess=(store,area)=>evaluateNormalRoute(store,{area,scheme:{fleet:1,ships:ids}});
const close=(actual,expected)=>assert(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);

test('2-1 resource detour recombines at D, without consuming the separate water-tender shortcut',()=>{
  const selected=option('2-1','C>D>H'),route=assess(fleet([7,7,5,5,2,2]),'2-1');
  assert.deepEqual(P.optionPaths(selected),[[...'CDH'],[...'CEDH']]);
  assert.deepEqual(P.optionPlanning(route,selected).branches.map(b=>b.chance.probability),[.5,.5]);
  assert.equal(P.optionPlanning(route,selected).chance.probability,1);
  assert.equal(W.routeArrival({route},selected,true).value,'固定到达');
  const waterTender=assess(fleet([16,3,2,2,2,2]),'2-1');
  assert.equal(waterTender.probability,1);
  assert.equal(P.optionPlanning(waterTender,selected).chance.probability,0,'E-H is a different battle sequence');
});

test('2-2 G-K and G-H-K count together while the E-K shortcut and C-D diversion stay outside',()=>{
  const selected=option('2-2','C>E>G>H>K'),route=assess(fleet([16,8,2,2,2,2]),'2-2');
  const planned=P.optionPlanning(route,selected);
  assert.deepEqual(P.optionPaths(selected),[[...'CEGHK'],[...'CEGK']]);
  assert.deepEqual(planned.branches.map(b=>b.chance.probability),[.09,.21]);
  close(planned.chance.probability,.3);assert.equal(route.probability,1);
  assert.equal(W.routeArrival({route},selected,true).value,'到达概率 30%');
  const diverted=assess(fleet([10,3,2,2,2,2]),'2-2');
  close(P.optionPlanning(diverted,selected).chance.probability,.0459);
  assert(P.optionPlanning(diverted,selected).chance.probability<diverted.probability);
});

test('2-3 submarine resource branches share one guide with all four journeys and unchanged Boss odds',()=>{
  const selected=option('2-3','C>F>G>K>N'),route=assess(fleet([13,13,13,13,13,13]),'2-3');
  assert.deepEqual(P.optionPaths(selected),[[...'CFGKN'],[...'CFGIKN'],[...'CDFGKN'],[...'CDFGIKN']]);
  close(P.optionPlanning(route,selected).chance.probability,.138775);
  close(route.probability,.7607275);
  const card=W.routeArrival({route},selected,true);
  assert.match(card.note,/所选合流路线/);assert.match(card.label,/最终抵达/);
  assert.notEqual(card.value,'固定到达');
});

test('3-3 B-D-F and B-F merge, but the remaining F-H diversion is still a real failure',()=>{
  const selected=option('3-3','A>B>F>J>M'),route=assess(fleet([13,2,2,2,2,2]),'3-3');
  assert.deepEqual(P.optionPaths(selected),[[...'ABFJM'],[...'ABDFJM']]);
  const planned=P.optionPlanning(route,selected);
  assert.deepEqual(planned.branches.map(b=>b.chance.probability),[.25,.25]);
  assert.equal(planned.chance.probability,.5);
  assert.equal(W.routeArrival({route},selected,true).value,'到达概率 50%');
  const direct=assess(fleet([3,2,2,2,2,2]),'3-3');
  assert.deepEqual(P.optionPlanning(direct,selected).branches.map(b=>b.chance.probability),[1,0]);
});

test('5-3 resource pickup at H keeps both night strategies reachable and leaves the O choice at K',()=>{
  for(const [key,types,branches] of [
    ['D>G>I>O>K>E>Q',[3,2,2,2,2,2],[0,1]],
    ['D>G>I>O>K>E>Q',[8,5,5,3,2,2],[1,0]],
    ['D>G>J>L>O>K>E>Q',[7,3,5,2,2,2],[0,1]]
  ]){
    const selected=option('5-3',key),route=assess(fleet(types),'5-3'),planned=P.optionPlanning(route,selected);
    assert.deepEqual(planned.branches.map(b=>b.chance.probability),branches);
    assert.equal(planned.chance.probability,1);
    assert.equal(W.routeArrival({route},selected,true).value,'固定到达');
    assert.deepEqual(P.routeDiagnostics(route,selected).warnings,[]);
    assert(P.optionPaths(selected).every(nodes=>nodes[nodes.indexOf('O')+1]==='K'&&!nodes.includes('P')));
  }
});

test('every reviewed merged guide highlights exactly its full journeys in both map and route profile',()=>{
  for(const [area,key] of [
    ['1-3','A>E>F>J'],['2-1','C>D>H'],['2-2','C>E>G>H>K'],['2-3','C>F>G>K>N'],
    ['3-3','A>B>F>J>M'],['5-3','D>G>I>O>K>E>Q'],['5-3','D>G>J>L>O>K>E>Q'],
    ['7-3','A>C>D>G>J>P']
  ]){
    const selected=option(area,key),overview=W.mapOverview(area,'boss',selected.phase,{maxRoutes:20}),profile=W.selectedMapProfile({...overview,options:[selected]},key);
assert.deepEqual(profile.highlightPaths,P.optionPaths(selected));
    assert.deepEqual(profile.examples,P.optionPaths(selected));
    assert.deepEqual(profile.routePaths.map(p=>p.nodes),P.optionPaths(selected));
  }
});

test('merged guide branches never count alternative player-controlled exits as independent probabilities',()=>{
  const catalog=require('../../../data/normal_route_guides.json').maps;
  for(const [id,guide] of Object.entries(catalog)){
    const [area,phase]=id.split(':'),map=require(`../../../data/normal_routes/${area}.json`);
    for(const selected of guide.routes){
      const paths=P.optionPaths(selected);
      for(let i=0;i<paths.length;i++)for(let j=i+1;j<paths.length;j++){
        const a=paths[i],b=paths[j];let common=0;
        while(common<Math.min(a.length,b.length)&&a[common]===b[common])common++;
        const from=common?a[common-1]:'start';
        const rules=map.machineRules?.[`${from}#${phase}`]??map.machineRules?.[from]??[];
        assert(!rules.some(rule=>/能動分岐|能动分岐/.test(rule.note||'')),`${id} ${selected.name}: choose one exit at ${from}`);
      }
    }
  }
});

test('5-3 recommendation and manual equipment updates accept the H branch without changing chosen ships',()=>{
  const store=fleet([3,2,2,2,2,2]),before=JSON.stringify(store),selected={key:'D>G>I>O>K>H>E>Q'};
  const result=recommendNormalFleet(store,{area:'5-3',routeKey:selected.key,fixedShipIds:ids});
  const found=result.routeResults.find(row=>row.key===selected.key);
  assert.equal(found.status,'available',found.message);assert.equal(found.chance.probability,1);
  const row=result.recommendations[found.recommendationIndex];
  assert.deepEqual(row.selectedPath,[...'DGIOKHEQ']);
  assert.deepEqual(row.scheme.ships.map(s=>s.id).sort((a,b)=>a-b),ids);
  const adjusted=recommendNormalEquipment(store,{area:'5-3',routeKey:selected.key,scheme:row.scheme});
  assert.equal(adjusted.pathChance.probability,1);
  assert.deepEqual(adjusted.scheme.ships.map(s=>s.id),row.scheme.ships.map(s=>s.id));
  assert.equal(JSON.stringify(store),before);
});
