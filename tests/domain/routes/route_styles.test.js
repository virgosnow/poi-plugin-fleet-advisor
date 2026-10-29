'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const plans=require('../../../src/domain/routes/route_plans');
const {evaluateNormalRoute}=require('../../../src/domain/routes/normal_routes');
const {recommendNormalFleet}=require('../../../src/recommendation/normal');
const carrierOption=()=>plans.recommendedOptions('1-4').find(o=>o.id==='1-4-05');
function aviationFixture(escorts=[13,14]){
  const store=require('../../helpers/workbench_fixture')();
  for(const [i,stype] of [11,18,7,20,...escorts,8,11].entries()){
    const id=10+i;
    store.const.$ships[id]={...store.const.$ships[1],api_id:id,api_name:'测试航空编成'+id,api_stype:stype};
    store.info.ships[id]={...store.info.ships[1],api_id:id,api_ship_id:id,api_karyoku:[80,80]};
  }
  return store;
}
const scheme=ids=>({fleet:1,ships:ids.map(id=>({id,slots:[-1,-1],ex:-1}))});
test('1-4 preset identities bind their reviewed hulls and never include the I detour',()=>{
 const catalog=plans.routeOptions('1-4'),options=catalog.filter(o=>o.recommend!==false);
 assert.equal(options.length,6);assert.equal(plans.recommendedOptions('1-4').length,5);
 for(const option of options){assert.equal(option.label,option.name+`（${option.pathLabel}）`);assert(option.templates.length);assert(option.paths.every(p=>!p.includes('I')&&p.at(-1)==='L'));}
 const carrier=carrierOption();assert.equal(carrier.pathLabel,'A/B→D→E→H→L');
 const ships=types=>({ships:types.map(stype=>({stype,name:'测试舰',openingTorpedo:[4,13,14].includes(stype)}))});
 for(const types of [[7,7,7,20,4,13],[11,18,7,20,13,14]])assert(plans.fleetRequirementAssessment(ships(types),carrier).eligible);
 for(const types of [[7,7,7,20,2,2],[7,7,7,7,20,4],[7,7,7,4,13,14]])assert(!plans.fleetRequirementAssessment(ships(types),carrier).eligible);
 assert.match(plans.fleetRequirementAssessment(ships([]),carrier).description,/可先制雷击舰/);
 assert(catalog.some(o=>o.key==='B>C>F>E>H>L'&&o.recommend===false));
});

test('generation preserves three styles and carrier style has exactly one AS, three carriers and two actual opening escorts',()=>{
  const store=aviationFixture(),before=JSON.stringify(store);
  const result=recommendNormalFleet(store,{area:'1-4',airGoal:'ignore'});
  assert(result.recommendations.length>0);
  const row=result.recommendations.find(r=>r.routeKey===carrierOption().key);
  assert(row);
  const types=row.route.ships.map(s=>s.stype);
  assert.equal(types.filter(t=>[7,11,18].includes(t)).length,3);
  assert.equal(types.filter(t=>t===20).length,1);
  assert.equal(row.route.ships.filter(s=>s.openingTorpedo).length,2);
  assert.equal(row.pathChance.probability,1);
  assert.equal(plans.pathChance(row.route,['A','D','E','H','L']).probability,.5);
  assert.equal(plans.pathChance(row.route,['B','D','E','H','L']).probability,.5);
  assert.equal(plans.pathChance(row.route,['B','C','F','I','L']).max,0);
  for(const r of result.recommendations)new (require('../../../src/application/controller').Controller)({getStore:()=>store}).preview('fleet',r.scheme);
  assert.equal(JSON.stringify(store),before);
});
test('carrier style rejects missing AS/openers and incompatible manual ships rather than adding more carriers',()=>{
  for(const missing of [13,14]){
    const store=aviationFixture();delete store.info.ships[missing];
    const result=recommendNormalFleet(store,{area:'1-4',routeKey:carrierOption().key,airGoal:'ignore'});
    assert.equal(result.recommendations.length,0);
  }
  const store=aviationFixture();
  for(const fixedShipIds of [[10,11,12,17],[2]]){
    const result=recommendNormalFleet(structuredClone(store),{area:'1-4',routeKey:carrierOption().key,airGoal:'ignore',fixedShipIds});
    assert.equal(result.recommendations.length,0,'manual fourth carrier or non-opening escort must remain manual');
  }
  const result=recommendNormalFleet(store,{area:'1-4',routeKey:carrierOption().key,airGoal:'ignore',fixedShipIds:[14]});
  assert(result.recommendations[0].scheme.ships.some(s=>s.id===14));
});
test('opening escorts are checked from planned equipment, not cruiser type or old equipment',()=>{
  const store=aviationFixture([4,3]);
  store.const.$equips[1]={api_id:1,api_name:'甲標的 甲型',api_type:[0,0,22,22],api_raig:12};
  for(const id of [101,102])store.info.equips[id]={api_id:id,api_slotitem_id:1,api_level:0};
  for(const id of [14,15])store.const.$equipShip[id]={api_equip_type:{22:null}};
  const option=carrierOption(),base=scheme([10,11,12,13,14,15]);
  assert(!plans.fleetRequirementAssessment(evaluateNormalRoute(store,{area:'1-4',scheme:base}),option).eligible);
  const armed=structuredClone(base);armed.ships[4].slots[0]=101;armed.ships[5].slots[0]=102;
  assert(plans.fleetRequirementAssessment(evaluateNormalRoute(store,{area:'1-4',scheme:armed}),option).eligible);
  const result=recommendNormalFleet(store,{area:'1-4',routeKey:option.key,airGoal:'ignore'});
  assert.equal(result.recommendations.length,1);
  assert.equal(result.recommendations[0].route.ships.filter(s=>s.openingTorpedo).length,2);
  const insufficient=structuredClone(store);delete insufficient.info.equips[102];
  assert.equal(recommendNormalFleet(insufficient,{area:'1-4',routeKey:option.key,airGoal:'ignore'}).recommendations.length,0,'one midget submarine cannot arm two cruisers');
});
test('one available midget submarine can pair a surface opener with an inherent submarine opener',()=>{
  const store=aviationFixture([4,3,13]);
  store.const.$equips[1]={api_id:1,api_name:'甲標的 甲型',api_type:[0,0,22,22],api_raig:12};
  store.info.equips[101]={api_id:101,api_slotitem_id:1,api_level:0};
  for(const id of [14,15])store.const.$equipShip[id]={api_equip_type:{22:null}};
  const result=recommendNormalFleet(store,{area:'1-4',routeKey:carrierOption().key,airGoal:'ignore'});
  assert.equal(result.recommendations.length,1);
  assert.equal(result.recommendations[0].route.ships.filter(s=>s.openingTorpedo).length,2);
  assert(result.recommendations[0].route.ships.some(s=>s.stype===13));
});
test('fleet route captions omit every impossible 1-4 branch while preserving real alternatives',()=>{
  const cases=[
    ['heavy',[8,7,4,5,6,20],['ADEHL','BDEHL'],true],
    ['heavy',[8,7,3,2,2,20],['ADEHL','BDEHL','BCFEHL'],true],
    ['heavy',[8,7,3,2,2,16],['ADGJL','BDGJL','BCFEHL'],true],
    ['light',[3,2,2,2,2,16],['ADGJL','BCFEHL'],true],
    ['light',[3,2,2,2,20,16],['ADEHL','BCFEHL'],true],
    ['light',[3,2,2,2,2,20],['ADEHL','BCFEHL'],true],
    ['light',[4,2,2,6,16,5],['ADGJL','BDGJL','BCFEHL'],false]
  ];
  const expand=label=>label.split('；').flatMap(group=>group.split('→').reduce((paths,node)=>
    paths.flatMap(prefix=>node.split('/').map(n=>prefix+n)),[''])).sort();
  for(const [style,types,expected,fixedBoss] of cases){
    const store=require('../../helpers/workbench_fixture')();
    types.forEach((type,i)=>{store.const.$ships[i+1].api_stype=type;});
    const paths=require('../../../src/domain/routes/sortie_profile').previewForMap('1-4').routePaths.map(p=>p.nodes).filter(p=>!p.includes('I'));
    const option={name:style,nodes:paths[0],paths};
    const before=JSON.stringify(option),route=evaluateNormalRoute(store,{area:'1-4',scheme:scheme([1,2,3,4,5,6])});
    const displayed=plans.fleetPathOption(route,option);
    assert.deepEqual(displayed.displayPaths.map(p=>p.join('')).sort(),expected.slice().sort(),types.join(','));
    assert.deepEqual(expand(displayed.pathLabel),expected.slice().sort(),'caption cannot invent a cross-branch path');
    assert.equal(displayed.label,option.name+`（${displayed.pathLabel}）`);
    assert.equal(JSON.stringify(option),before,'presentation never narrows the reusable option');
    assert.equal(plans.optionPlanning(route,option).chance.probability===1,fixedBoss);
  }
  assert.equal(plans.pathLabel([['A','D','E','H','L'],['B','D','E','H','L']]),'A/B→D→E→H→L');
  assert.deepEqual(expand(plans.pathLabel([['A','D','E','H','L'],['A','D','G','J','L']])),['ADEHL','ADGJL']);
});
test('fixed-branch 1-4 templates can complete manual AS hulls without changing their identity',()=>{
  const strategies=require('../../../src/recommendation/strategies');
  const cases=[['1-4-01',[20,7,3,2,2,2]],['1-4-02',[20,6,3,2,2,2]]];
  for(const [style,types] of cases){
    const store=require('../../helpers/workbench_fixture')();
    types.forEach((type,i)=>{store.const.$ships[i+1].api_stype=type;});
    delete store.info.ships[7];delete store.info.ships[8];
    const option=plans.recommendedOptions('1-4').find(o=>o.id===style);
    assert(option.templates.some(template=>strategies.remainingSlots(types.map(stype=>({stype})),template)?.length===0));
    const result=recommendNormalFleet(store,{area:'1-4',routeKey:option.key,airGoal:'ignore',fixedShipIds:[1,3,5,6]});
    assert.equal(result.recommendations.length,1);
    const row=result.recommendations[0],display=result.routeResults[0];
    for(const id of [1,3,5,6])assert(row.scheme.ships.some(s=>s.id===id));
    assert.equal(row.pathChance.probability,1);
    assert(!display.displayPaths.some(p=>p.includes('G')||p.includes('J')));
    assert.equal(display.label,plans.fleetPathOption(row.route,option).label);
    assert.equal(display.paths.length,2,'the catalog retains both valid starts');
  }
});
test('merged-path node order keeps upstream forks before downstream rules',()=>{
  const paths=[['A','D','E','H','L'],['B','D','E','H','L'],['B','C','F','E','H','L']];
  const nodes=plans.orderedPathNodes(paths),index=node=>nodes.indexOf(node);
  assert(index('start')<index('B'));assert(index('B')<index('D'));assert(index('D')<index('E'));
  assert(index('C')<index('F'));assert(index('F')<index('E'));assert(index('E')<index('H'));
  assert.deepEqual(plans.orderedPathNodes([['B','D','E','H','L']]),['start','B','D','E','H','L']);
  assert.equal(new Set(nodes).size,nodes.length);
});

function mergedRouteFacts(area,option,types,{speed='fast',radar=true,unknown=false}={}){
  const ships=types.map((stype,i)=>({instanceId:i+1,stype,name:['羽黒改二','足柄改二'][i]||'测试舰',
    radarEquipped:radar,drumEquipped:false,landingCraftEquipped:false}));
  return {area,phase:option.phase,ships,targetNodes:[option.nodes.at(-1)],
    lineOfSight:unknown?{status:'unknown'}:{status:'computed',rawScoresByCoefficient:{1:100,2:100,3:100,4:100}},
    speed:{status:unknown?'unknown':'computed',fleetSpeed:speed,ships:ships.map(s=>({shipId:s.instanceId,status:unknown?'unknown':'computed',speed}))}};
}
function expandRouteCaption(label){
  const expandOptional=text=>{
    const match=/\(([^()]*)\)/.exec(text);
    return match?[...expandOptional(text.slice(0,match.index)+text.slice(match.index+match[0].length)),
      ...expandOptional(text.slice(0,match.index)+match[1]+text.slice(match.index+match[0].length))]:[text];
  };
  return [...new Set(label.split('；').flatMap(part=>expandOptional(part).flatMap(text=>text.replace(/→+/g,'→').replace(/^→|→$/g,'').split('→')
    .reduce((rows,token)=>rows.flatMap(row=>token.split('/').map(node=>row.concat(node))),[[]]).map(nodes=>nodes.join('>')))))].sort();
}
test('merged routes across the catalog share exact visible branches, captions and travel order',()=>{
  const fs=require('fs'),W=require('../../../src/ui/workbench/workbench_model'),{previewForMap}=require('../../../src/domain/routes/sortie_profile');
  const files=fs.readdirSync(require('path').join(__dirname,'../../../data/normal_routes')).filter(f=>/^\d-\d\.json$/.test(f));
  let optionsChecked=0,merged=0,scenarios=0,pruned=0,blocked=0;const areas=new Set();
  const fleets=[[3,2,2,2,2,2],[16,3,2,2,5,6],[20,11,7,18,4,4],[22,3,2,2,2,2],
    [13,6,2,2,3,4],[10,11,3,2,2,5],[11,7,5,6,8,2],[8,3,2,2,6,6],[5,5,5,2,2,2]];
  for(const file of files){const area=file.slice(0,-5);for(const option of plans.routeOptions(area)){
    optionsChecked++;const all=plans.optionPaths(option),order=plans.orderedPathNodes(all);
    for(const path of all){let from='start';for(const to of path){assert(order.indexOf(from)<order.indexOf(to),`${area} ${from}→${to}`);from=to;}}
    if(all.length<=1)continue;merged++;areas.add(area);
    const overview={profile:previewForMap(area,{phase:option.phase}),options:[option]};
    assert.equal(plans.fleetPathOption(null,option),option);
    assert.deepEqual(W.selectedMapProfile(overview,option.key).highlightPaths,all,'empty drafts preview the full catalog');
    const typesets=fleets.concat((option.templates||[]).map(template=>template.map(types=>types[0])));
    for(const types of typesets)for(const mode of [{},{speed:'fastest'},{radar:false},{unknown:true}]){
      const route=mergedRouteFacts(area,option,types,mode),before=JSON.stringify({route,option});
      const expected=all.filter(nodes=>plans.planningPath(route,nodes,{allowTentative:false,includeLosRequirements:false}).chance.max>0);
      const caption=plans.fleetPathOption(route,option),profile=W.selectedMapProfile(overview,option.key,null,route);
      assert.deepEqual(caption.displayPaths,expected,`${area} ${option.key}`);
      assert.deepEqual(profile.highlightPaths,expected,`${area}: map and caption share the same branch set`);
      assert.equal(caption.displayPathLabel,caption.pathLabel);
      assert.equal(caption.label,option.name+`（${caption.pathLabel}）`);
      if(expected.length)assert.deepEqual(expandRouteCaption(caption.pathLabel),expected.map(nodes=>nodes.join('>')).sort());
      else{blocked++;assert.equal(caption.pathLabel,'无可达分支');}
      if(expected.length<all.length)pruned++;
      assert.equal(JSON.stringify({route,option}),before,'display filtering must never mutate constraints, facts or strategy');
      const visibleOrder=plans.orderedPathNodes(expected);
      for(const path of expected){let from='start';for(const to of path){assert(visibleOrder.indexOf(from)<visibleOrder.indexOf(to));from=to;}}
      scenarios++;
    }
    const stale={...mergedRouteFacts(area,option,fleets[0]),phase:'stale-phase'};
    if(option.phase){assert.equal(plans.fleetPathOption(stale,option),option);assert.deepEqual(W.selectedMapProfile(overview,option.key,null,stale).highlightPaths,[]);}
  }}
  assert(files.length>=37&&optionsChecked>=121&&merged>=25&&areas.size>=12&&scenarios>=900&&pruned>100&&blocked>100);
});
test('detours, speed strategies and multi-stage merged branches obey the actual hull facts',()=>{
  const cases=[
    ['1-3',[22,3,2,2,2,2],['ADBEFJ']],['1-3',[13,6,2,2,3,4],['AEFJ']],
    ['2-1',[16,11,3,2,2,5],['CEDH']],['2-1',[10,11,3,2,2,5],['CDH']],
    ['2-2',[11,7,3,2,2,5],['CEGHK']],['2-3',[11,7,5,6,8,2],['ADGKN']],
    ['3-2',[3,2,2,2,2,2],['CEFL'],{speed:'fastest'}],
    ['3-3',[3,2,2,2,2,2],['ABFJM']],['3-3',[13,3,2,2,2,2],['ABFJM','ABDFJM']],
    ['4-1',[8,7,3,2,2,2],[]],['4-1',[3,2,2,2,2,16],['CFHJ','ABDHJ']],
    ['4-2',[3,2,2,2,2,7],['ACL','BDCL']],['4-5',[3,2,2,2,5,6],['CDHT','ADHT'],{speed:'fastPlus'}],
    ['5-3',[8,3,2,2,6,6],['DGIOKEQ']],['5-3',[3,2,2,2,2,2],['DGIOKHEQ']],
    ['7-3',[5,5,5,2,2,2],['ACDGJP']]
  ];
  for(const [area,types,expected,mode] of cases){
    const paths=expected.map(p=>[...p]);if(!paths.length)continue;
    const option={nodes:paths[0],paths,pathLabel:plans.pathLabel(paths),phase:area==='7-3'?'gauge2':undefined},route=mergedRouteFacts(area,option,types,mode);
    const shown=plans.fleetPathOption(route,option);
    assert.deepEqual((shown.displayPaths||[shown.nodes]).map(nodes=>nodes.join('')),expected,`${area} ${types}`);
    if(expected.length)assert.deepEqual(expandRouteCaption(shown.pathLabel),(shown.displayPaths||[shown.nodes]).map(nodes=>nodes.join('>')).sort());
  }
  assert.equal(plans.pathLabel([['C','D','H'],['C','E','D','H']]),'C→(E)→D→H');
});
