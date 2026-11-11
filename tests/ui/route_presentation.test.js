'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {routeFormula,arrivalNote,withArrivalNotes}=require('../../src/ui/models/route_presentation');
const P=require('../../src/domain/routes/route_plans');
const h=(type,props,...children)=>({type,props:props||{},children});
const all=(n,p)=>!n||typeof n!=='object'?[]:[...(p(n)?[n]:[]),...(n.children||[]).flatMap(c=>all(c,p))];
const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join(' ');

test('2-3 route formulas condense the full catalogue without changing its paths',()=>{
  const options=P.recommendedOptions('2-3'),before=JSON.stringify(options);
  for(const option of options.filter(option=>!option.fallback)){
    assert.equal(routeFormula(option),option.id==='2-3-submarines'?'C→…→J/K→N':'A/B→…→J/K→N');
    assert(!routeFormula(option).includes('；'));
  }
  assert.equal(JSON.stringify(options),before);
  assert.equal(routeFormula(options.find(option=>option.fallback)),'按舰队寻找可达路线');
  const option=options[0],actual=P.fleetPathOption({area:'2-3',phase:'',ships:[]},option);
  assert.equal(routeFormula({...actual,displayPaths:[['B','E','F','J','N']],displayPathLabel:'B→E→F→J→N'}),'B→E→F→J→N',
    'a fleet-specific caption must never resurrect eliminated branches');
});

test('simple alternatives and proven optional detours stay exact; correlated branches use ellipsis',()=>{
  const label=paths=>routeFormula({pathLabel:P.pathLabel(paths)});
  assert.equal(label([[...'ADGKN'],[...'BDGKN']]),'A/B→D→G→K→N');
  assert.equal(label(['CFGKN','CDFGKN','CFGIKN','CDFGIKN'].map(s=>[...s])),'C→(D)→F→G→(I)→K→N');
  assert.equal(label([[...'ABDF'],[...'ACEF']]),'A→…→D/E→F');
  assert.equal(label([[...'ABDF'],[...'ACDEF']]),'A→…→D/E→F',
    'dependent detours cannot be labelled as independently optional');
  assert.equal(routeFormula({displayPathLabel:'无可达分支',paths:[[...'ABC']]}),'无可达分支');
});

test('the route selector uses the compact formula in both selected and popup rows',()=>{
  const React={createElement:h,useState:()=>[true,()=>{}],useRef:()=>({current:null}),useEffect:()=>{}};
  const options=P.recommendedOptions('2-3');
  const tree=require('../../src/ui/components/route_picker')(React)({options,value:options[0].key,onChange:()=>{}});
  const captions=all(tree,n=>['paa-wb-route-path','paa-route-option-path'].includes(n.props.className));
  const visible=options.filter(option=>!option.fallback);
  assert.equal(captions.length,visible.length+1);
  assert.deepEqual(captions.map(text),[options[0],...visible].map(routeFormula));
});

test('merged arrival probabilities render one complete journey and one unchanged chance per list row',()=>{
  const store=require('../helpers/workbench_fixture')();
  for(const id of Object.keys(store.info.ships)){
    if(Number(id)>6){delete store.info.ships[id];delete store.const.$ships[id];continue;}
    store.const.$ships[id].api_stype=13;store.info.ships[id].api_lv=99;
  }
  const route=require('../../src/domain/routes/normal_routes').evaluateNormalRoute(store,
    {area:'2-3',scheme:{fleet:1,ships:[1,2,3,4,5,6]}});
  const selected={nodes:[...'CFGKN'],paths:['CFGKN','CFGIKN','CDFGKN','CDFGIKN'].map(p=>[...p]),arrivalMode:'boss',phaseNote:'阶段说明'};
  const branches=P.optionPlanning(route,selected).branches.filter(b=>b.chance.max>0).sort((a,b)=>b.chance.probability-a.chance.probability);
  const arrival=require('../../src/ui/workbench/workbench_model').routeArrival({route},selected,true);
  const tree=arrivalNote(h,arrival),rows=all(tree,n=>n.type==='li');
  assert.equal(arrival.value,'到达概率 76.1%');assert.equal(rows.length,branches.length);
  assert.equal(arrival.label,'按既定路线抵达目标');
  assert(arrival.note.includes('总到达概率包含其他可抵达目标的分支'),'the list excludes some Boss-bound journeys');
  assert.deepEqual(arrival.warnings,[],'the full journey list replaces duplicate per-fork probability warnings');
  assert.equal(text(rows[0].children[0]),branches[0].nodes.join('→'),'the most likely journey appears first');
  assert.equal(all(tree,n=>n.type==='ul'&&n.props['aria-label']==='各路线到达概率').length,1);
  for(let i=0;i<rows.length;i++){
    assert.equal(text(rows[i].children[0]),branches[i].nodes.join('→'));
    assert.equal(text(rows[i].children[1]),`${Math.round(branches[i].chance.probability*1000)/10}%`);
  }
  assert(!text(tree).includes('阶段说明'),'phase prerequisites belong in the detailed rules');
  assert(!arrival.note.includes('不含战斗撤退'));assert(!text(tree).includes('不含战斗撤退'));
  assert.equal(all(tree,n=>n.type==='button').length,0,'the card retains its existing disclosure interaction');
  assert.equal(arrivalNote(h,{note:''}),null);
  assert(text(arrivalNote(h,{note:'能动分歧请按所选路线选择出口'})).includes('能动分歧'));
});

test('adaptive 2-3 sums the same fleet’s Boss-bound branches and highlights each viable journey',()=>{
  const store=require('../helpers/workbench_fixture')(),W=require('../../src/ui/workbench/workbench_model');
  [3,18,18,2,1,1].forEach((stype,i)=>{store.const.$ships[i+1].api_stype=stype;});
  const route=require('../../src/domain/routes/normal_routes').evaluateNormalRoute(store,{area:'2-3',scheme:{fleet:1,ships:[1,2,3,4,5,6]}});
  const selected=P.recommendedOptions('2-3').find(o=>o.fallback),best=P.optionPlanning(route,selected);
  const arrival=W.routeArrival({route},selected,true),summary=P.adaptiveArrival(route,selected);
  assert(Math.abs(best.chance.probability-.43425)<1e-9,'the representative route alone is 43.4%');
  assert.equal(arrival.value,'到达概率 97.9%');assert.equal(summary.branches.length,8);
  assert(Math.abs(summary.branches.reduce((sum,branch)=>sum+branch.chance.probability,0)-arrival.probability)<1e-9);
  const list=all(arrivalNote(h,arrival),n=>n.type==='li');assert.equal(list.length,8);
  const values=arrival.noteLines.filter(line=>line.nodes).map(line=>line.probability);
  assert.deepEqual(values,values.slice().sort((a,b)=>b-a));
  assert.deepEqual(P.fleetPathOption(route,selected).displayPaths,P.displayFleetPaths(route,selected));
  const overview=W.mapOverview('2-3','boss','',undefined,store);
  const profile=W.selectedMapProfile(overview,selected.key,null,route,true,store);
  assert.deepEqual(profile.highlightPaths,P.displayFleetPaths(route,selected));
  assert.equal(P.fleetPaths(route,selected).length,1,'the recommendation search still uses its representative path');
});

test('adaptive manual forks use one exit per point instead of adding incompatible choices',()=>{
  const store=require('../helpers/workbench_fixture')(),W=require('../../src/ui/workbench/workbench_model');
  const route=require('../../src/domain/routes/normal_routes').evaluateNormalRoute(store,{area:'4-5',scheme:{fleet:1,ships:[1,2,3,4,5,6]}});
  const selected=P.recommendedOptions('4-5').find(o=>o.fallback),summary=P.adaptiveArrival(route,selected);
  assert.deepEqual(summary.playerChoices,[{from:'A',to:'D'},{from:'C',to:'D'}]);
  assert.deepEqual(summary.branches.map(branch=>branch.nodes.join('')).sort(),['ADHT','CDHT']);
  assert.equal(summary.arrival.probability,1);
  const arrival=W.routeArrival({route},selected,true);assert.equal(arrival.value,'固定到达');
  assert.match(arrival.note,/能动分歧：A 点选 D，C 点选 D/);
  assert.equal(all(arrivalNote(h,arrival),n=>n.type==='li').length,2);
});

test('adaptive single fixed paths stay compact and unknown Boss odds remain unknown',()=>{
  const store=require('../helpers/workbench_fixture')(),W=require('../../src/ui/workbench/workbench_model');
  [16,3,6,2,2,2].forEach((stype,i)=>{store.const.$ships[i+1].api_stype=stype;});
  const route=require('../../src/domain/routes/normal_routes').evaluateNormalRoute(store,{area:'2-2',scheme:{fleet:1,ships:[1,2,3,4,5,6]}});
  const selected=P.recommendedOptions('2-2').find(o=>o.fallback),fixed=W.routeArrival({route},selected,true);
  assert.equal(fixed.value,'固定到达');assert.equal(fixed.note,'');assert.equal(arrivalNote(h,fixed),null);
  const unknown=W.routeArrival({route:{...route,probability:null,chanceRange:[0,1]}},selected,true);
  assert.equal(unknown.value,'到达率待确认');assert.equal(unknown.probability,null);
});

test('adaptive three-way unknown rolls that rejoin do not count three 50% references',()=>{
  const store=require('../helpers/workbench_fixture')(),W=require('../../src/ui/workbench/workbench_model');
  for(let i=1;i<=6;i++)store.const.$ships[i].api_stype=13;
  const route=require('../../src/domain/routes/normal_routes').evaluateNormalRoute(store,{area:'5-3',scheme:{fleet:1,ships:[1,2,3,4,5,6]}});
  const selected=P.recommendedOptions('5-3').find(o=>o.fallback),arrival=W.routeArrival({route},selected,true);
  assert.equal(arrival.value,'到达概率 50%');
  const rows=arrival.noteLines.filter(row=>row.nodes);
  assert.deepEqual(rows.map(row=>row.value),['30%','20%']);
  assert(rows.every(row=>row.nodes.includes('L/M/N')));
  assert(Math.abs(rows.reduce((sum,row)=>sum+row.probability,0)-arrival.probability)<1e-9);
  assert.match(arrival.note,/能动分歧：O 点选 K/);
});

test('a sole fixed journey hides its probability rows and summary, while preserving phase and player-choice guidance',()=>{
  const store=require('../helpers/workbench_fixture')(),W=require('../../src/ui/workbench/workbench_model');
  [16,3,6,2,2,2].forEach((stype,i)=>{store.const.$ships[i+1].api_stype=stype;});
  const route=require('../../src/domain/routes/normal_routes').evaluateNormalRoute(store,
    {area:'2-2',scheme:{fleet:1,ships:[1,2,3,4,5,6]}});
  assert.equal(W.routeArrival({route},null,true).label,'按既定路线抵达目标');
  assert.equal(W.routeArrival({route},{nodes:['C','E','K']},false,'K').label,'按既定路线抵达目标');
  for(const id of ['2-2-01','2-2-04']){
    // The first preset has a strategy; the other prunes its two catalog paths.
    const selected=P.recommendedOptions('2-2').find(o=>o.id===id);
    const inspected=id==='2-2-01'?{...route,ships:route.ships.map((s,i)=>i===5?{...s,stype:4}:s)}:route;
    const card=W.routeArrival({route:inspected},selected,true);
    assert.equal(card.label,'按既定路线抵达目标');
    assert.equal(card.value,'固定到达');assert.equal(card.note,'');assert.deepEqual(card.noteLines,[]);
    assert.equal(arrivalNote(h,card),null,'there must be no empty note block');
    const phase=W.routeArrival({route:inspected},{...selected,phaseNote:'阶段带路说明'},true);
    assert.equal(phase.note,'阶段带路说明');
    assert.equal(arrivalNote(h,phase),null,'a fixed path does not display phase prose beneath arrival');
  }
  assert.equal(W.routeArrival({route},{nodes:['C','E','K'],arrivalMode:'boss'},true).note,'',
    'explicit single-path selections follow the same display rule');
  const guided=withArrivalNotes({value:'固定到达'},[{kind:'probabilitySummary',text:'所选合流路线 100%'},
    {nodes:['A','C'],probability:1,value:'100%'},{text:'能动分歧：A 点选 C'}]);
  assert.equal(guided.note,'能动分歧：A 点选 C');
});

test('only multiple journeys or an explicit player choice display arrival notes',()=>{
  for(const [probability,value]of [[.8,'80%'],[.99999,'100%'],[null,'待确认']]){
    const card=withArrivalNotes({},[{nodes:['A','C'],probability,value}]);
    if(probability===null)assert.equal(arrivalNote(h,card),null);
    else assert.equal(all(arrivalNote(h,card),n=>n.type==='li').length,1,'a non-certain path has another exit');
  }
  const card=withArrivalNotes({},[{nodes:['A','C'],probability:.5,value:'50%'},{nodes:['B','C'],probability:.5,value:'50%'}]);
  assert.equal(all(arrivalNote(h,card),n=>n.type==='li').length,2);
  const manual=withArrivalNotes({},[{kind:'phase',text:'阶段说明'},{nodes:['A','C'],probability:1,value:'100%'},{text:'能动分歧：A 点选 C'}]);
  assert.equal(text(arrivalNote(h,manual)),'能动分歧：A 点选 C');
  assert.equal(arrivalNote(h,{note:'需调整编成'}),null,'other diagnostics are shown in the warning area');
  const extra=withArrivalNotes({hasOtherBranches:true},[{nodes:['A','C'],probability:.5,value:'50%'},{text:'总到达概率包含其他可抵达目标的分支'}]);
  assert.equal(all(arrivalNote(h,extra),n=>n.type==='li').length,1);
});

test('complete probability lists suppress random-fork prose and redundant headings, but keep real diagnostics',()=>{
  const store=require('../helpers/workbench_fixture')();
  [7,3,2,2,2,2].forEach((stype,i)=>{store.const.$ships[i+1].api_stype=stype;});
  const route=require('../../src/domain/routes/normal_routes').evaluateNormalRoute(store,
    {area:'2-3',scheme:{fleet:1,ships:[1,2,3,4,5,6]}});
  const selected=P.recommendedOptions('2-3')[0],W=require('../../src/ui/workbench/workbench_model');
  const card=W.routeArrival({route},selected,true);
  assert.equal(card.value,'固定到达');assert.equal(card.label,'按既定路线抵达目标');
  assert.equal(card.noteLines.filter(r=>r.nodes).length,8);assert.deepEqual(card.warnings,[]);
  const unknown=W.routeArrival({route:{...route,targetNodes:[]}},selected,true);
  assert(unknown.warnings.some(s=>s.includes('资料不完整')),'missing route evidence remains visible');
  const blocked=W.routeArrival({route},{...selected,nodes:['C','K'],paths:[['C','K']]},true);
  assert.equal(blocked.noteLines.filter(r=>r.nodes).length,0);
  assert(blocked.warnings.some(s=>s.includes('受阻')),'an impossible route still explains its blockers');
});

test('speed strategies render each possible journey in the same descending probability list',()=>{
  const store=require('../helpers/workbench_fixture')();
  [3,2,2,2,2,2].forEach((stype,i)=>{store.const.$ships[i+1].api_stype=stype;});
  const evaluated=require('../../src/domain/routes/normal_routes').evaluateNormalRoute(store,
    {area:'3-2',scheme:{fleet:1,ships:[1,2,3,4,5,6]}});
  const route={...evaluated,ships:evaluated.ships.map(s=>({...s,radarEquipped:true})),
    speed:{...evaluated.speed,status:'observed',fleetSpeed:'fastPlus',ships:evaluated.ships.map(s=>({shipId:s.id,status:'observed',speed:'fastPlus'}))}};
  const selected=P.recommendedOptions('3-2').find(o=>o.strategy&&o.paths?.length>1);
  assert(selected);
  const card=require('../../src/ui/workbench/workbench_model').routeArrival({route},selected,true);
  assert.equal(card.label,'按既定路线抵达目标');assert.equal(card.value,'固定到达');
  const rows=all(arrivalNote(h,card),n=>n.type==='li');
  assert.deepEqual(rows.map(row=>text(row.children[0])),['C→G→F→L','C→E→F→L']);
  assert.deepEqual(rows.map(row=>text(row.children[1])),['60%','40%']);
});
