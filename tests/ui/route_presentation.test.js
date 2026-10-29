'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {routeFormula,arrivalNote}=require('../../src/ui/models/route_presentation');
const P=require('../../src/domain/routes/route_plans');
const h=(type,props,...children)=>({type,props:props||{},children});
const all=(n,p)=>!n||typeof n!=='object'?[]:[...(p(n)?[n]:[]),...(n.children||[]).flatMap(c=>all(c,p))];
const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join(' ');

test('2-3 route formulas condense the full catalogue without changing its paths',()=>{
  const options=P.recommendedOptions('2-3'),before=JSON.stringify(options);
  for(const option of options){
    assert.equal(routeFormula(option),'A/B→…→J/K→N');
    assert(!routeFormula(option).includes('；'));
  }
  assert.equal(JSON.stringify(options),before);
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
  assert.equal(captions.length,options.length+1);
  for(const caption of captions)assert.equal(text(caption),'A/B→…→J/K→N');
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
  assert.equal(text(rows[0].children[0]),branches[0].nodes.join('→'),'the most likely journey appears first');
  assert.equal(all(tree,n=>n.type==='ul'&&n.props['aria-label']==='各路线到达概率').length,1);
  for(let i=0;i<rows.length;i++){
    assert.equal(text(rows[i].children[0]),branches[i].nodes.join('→'));
    assert.equal(text(rows[i].children[1]),`${Math.round(branches[i].chance.probability*1000)/10}%`);
  }
  assert.equal(tree.children[0].children[0],'阶段说明');
  assert.equal(tree.children.at(-1).children[0],'不含战斗撤退');
  assert.equal(all(tree,n=>n.type==='button').length,0,'the card retains its existing disclosure interaction');
  assert.equal(arrivalNote(h,{note:''}),null);
  assert(text(arrivalNote(h,{note:'能动分歧请按所选路线选择出口'})).includes('能动分歧'));
});
