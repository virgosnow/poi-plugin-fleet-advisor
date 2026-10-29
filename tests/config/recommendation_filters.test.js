'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const F=require('../../src/config/recommendation_filters'),fixture=require('../helpers/workbench_fixture');
const {FleetAdvisorService}=require('../../src/application/fleet_advisor_service'),{Controller}=require('../../src/application/controller');
const clean=dir=>{if(!path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'paa-filter-'))throw Error('unsafe test cleanup');fs.rmSync(dir,{recursive:true,force:true});};
function source(){
  const s=fixture();
  for(const ship of Object.values(s.info.ships))Object.assign(ship,{api_locked:1,api_nowhp:20,api_maxhp:20});
  s.const.$ships[1].api_aftershipid='2';s.const.$ships[2].api_aftershipid='3';s.const.$ships[3].api_aftershipid='2';
  s.info.ships[4].api_lv=29;s.info.ships[5].api_cond=39;s.info.ships[6].api_nowhp=5;s.info.ships[7].api_locked=0;
  return s;
}
test('independent defaults, remodel graph, inclusive level boundary and sortie-specific exclusions',()=>{
  const s=source(),normal=F.evaluator(s,'normal'),exp=F.evaluator(s,'expedition');
  assert.deepEqual(normal(1),['未改造']);assert.deepEqual(normal(2),[]);assert.deepEqual(normal(3),[]);
  assert.deepEqual(normal(4),['等级低于 30']);s.info.ships[4].api_lv=30;assert.deepEqual(normal(4),[]);
  assert.deepEqual(normal(5),['士气低于 40']);assert.deepEqual(normal(6),['大破']);assert.deepEqual(normal(7),['未锁定']);
  assert.deepEqual(exp(1),[]);assert.deepEqual(exp(5),[]);assert.deepEqual(exp(6),[]);
  assert.deepEqual(normal(8),[],'no remodel available is eligible');
  s.info.fleets[0].api_ship=[8];assert.deepEqual(F.evaluator(s,'expedition')(8),['第一舰队成员']);
  assert.deepEqual(F.evaluator(s,'normal')(8),[]);
  s.info.fleets[2]={api_ship:[8],api_mission:[1,1]};s.info.repairs=[{api_ship_id:2}];s.info.ships[3].api_situation=2;
  for(const kind of ['normal','expedition']){
    assert(F.evaluator(s,kind)(8).includes('远征中'));assert(F.evaluator(s,kind)(2).includes('入渠中'));assert(F.evaluator(s,kind)(3).includes('入渠中'));
    const relaxed=F.evaluator(s,kind,{...F.DEFAULTS[kind],excludeExpedition:false,excludeRepairing:false,excludeFirstFleet:false});
    assert.deepEqual(relaxed(8),[]);assert.deepEqual(relaxed(2),[]);
  }
});
test('fleet search filters automatic choices while manual candidates remain visible with reasons',()=>{
  const s=source(),R=require('../../src/recommendation/index'),W=require('../../src/ui/workbench/workbench_model');
  const r=R.recommendNormalFleet(s,{area:'1-1'});
  assert(r.recommendations.length);assert(r.recommendations.every(r=>r.scheme.ships.every(s=>[2,3,8].includes(s.id))));
  const fixed=R.recommendNormalFleet(s,{area:'1-1',fixedShipIds:[1]});
  assert(fixed.recommendations.length);assert(fixed.recommendations.every(r=>r.scheme.ships.some(s=>s.id===1)));
  const slots=[W.entry(s,1)];
  const candidates=W.replacementCandidates(s,slots,0,'','all',{kind:'normal',filters:F.DEFAULTS.normal});
  const eligible=candidates.map(r=>r.id);
  assert(eligible.includes(1),'current explicit ship stays visible');assert(eligible.includes(4));assert(eligible.includes(5));
  assert.deepEqual(candidates.find(r=>r.id===4).preferenceReasons,['等级低于 30']);
  assert.deepEqual(candidates.find(r=>r.id===5).preferenceReasons,['士气低于 40']);
  assert(W.replacementCandidates(s,slots,0,'','all').some(r=>r.id===4),'manual JSON is not filtered');
  s.info.fleets[0].api_ship=[1,2,3];
  const expedition=R.recommendExpeditionFleet(s,{missionId:1,fleet:2});
  assert(expedition.recommendations.length);
  assert(expedition.recommendations.every(r=>r.scheme.ships.every(s=>![1,2,3,7].includes(s.id))));
});
test('preferences persist independently, migrate old settings, and roll back on save failure',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paa-filter-')),store=source();
  let service,restored;
  try{
    fs.writeFileSync(path.join(dir,'mcp-state.json'),JSON.stringify({mcpEnabled:false,httpPort:47615,jobs:[]}));
    const create=()=>new FleetAdvisorService({storageDir:dir,getStore:()=>store,controller:new Controller({getStore:()=>store})});
    service=create();assert.deepEqual(service.getRecommendationFilters(),F.DEFAULTS);
    service.setRecommendationFilters({normal:{allowEquipmentBorrowing:false,minLevel:60,excludeUnremodeled:false},expedition:{defaultGoal:'success'}});
    restored=create();assert.equal(restored.getRecommendationFilters().normal.minLevel,60);
    assert.equal(restored.getRecommendationFilters().normal.allowEquipmentBorrowing,false);
    for(const allowEquipmentBorrowing of [0,1,null,'false'])assert.throws(()=>restored.setRecommendationFilters({normal:{allowEquipmentBorrowing}}),/无效/);
    assert.equal(F.normalizeGroup('normal',{maxRoutes:2}).allowEquipmentBorrowing,true);
    assert(!('maxRoutes' in F.normalizeGroup('normal',{maxRoutes:2})));
    assert.deepEqual(restored.getRecommendationFilters().expedition,{...F.DEFAULTS.expedition,defaultGoal:'success'});
    for(const defaultGoal of [null,true,0,'unknown','GREAT'])assert.throws(()=>restored.setRecommendationFilters({expedition:{defaultGoal}}),/无效/);
    assert.equal(F.normalizeGroup('expedition',{defaultGoal:'invalid'}).defaultGoal,'great');
    assert.equal(restored.mcpEnabled,false);
    const copy=restored.getRecommendationFilters();copy.normal.minLevel=1;assert.equal(restored.getRecommendationFilters().normal.minLevel,60);
    assert.throws(()=>restored.setRecommendationFilters({normal:{minLevel:-1}}),/无效/);
    assert.throws(()=>restored.setRecommendationFilters({normal:{excludeUnremodeled:'false'}}),/无效/);
    restored.persist=()=>{throw Error('disk unavailable');};
    assert.throws(()=>restored.setRecommendationFilters({normal:{minLevel:80}}),/保存失败/);
    assert.equal(restored.getRecommendationFilters().normal.minLevel,60);
  }finally{await service?.dispose();await restored?.dispose();clean(dir);}
});
test('service injects global preferences into workers and future planning never releases live busy ships',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paa-filter-')),store=fixture(),before=JSON.stringify(store);
  const service=new FleetAdvisorService({storageDir:dir,getStore:()=>store,controller:new Controller({getStore:()=>store})});
  try{
    const {snapshotId}=service.createSnapshot();
    service.setRecommendationFilters({normal:{minLevel:999}});
    const empty=await service.recommendNormalFleet({snapshotId,area:'1-1',automaticFilters:{minLevel:0}});
    assert.equal(empty.recommendations.length,0);assert.match(empty.reason,/全局排除.*999/);
    assert.equal(empty.selectionFilters.excluded,8);assert.equal(JSON.stringify(store),before);
    service.setRecommendationFilters({normal:{minLevel:0,excludeExpedition:false,excludeRepairing:false}});
    store.info.fleets[2]={api_ship:[2],api_mission:[1,1]};store.info.repairs=[{api_ship_id:3}];
    const busyBefore=JSON.stringify(store),snapshot=service.createSnapshot();
    const result=await service.recommendNormalFleet({snapshotId:snapshot.snapshotId,area:'1-1',fixedShipIds:[2,3]});
    assert(result.recommendations.length);assert(result.recommendations[0].planningOnly);
    assert.throws(()=>service.preview('fleet',result.recommendations[0].scheme),/expedition|远征|repair|修理/);
    assert.equal(JSON.stringify(store),busyBefore);
    service.setRecommendationFilters({expedition:{minLevel:0,excludeExpedition:false,excludeRepairing:false}});
    const expedition=await service.recommendExpeditionFleet({snapshotId:snapshot.snapshotId,missionId:1,fleet:2,fixedShipIds:[2,3]});
    for(const goal of ['success','great']){
      assert(expedition.goals[goal].recommendations.length);
      assert(expedition.goals[goal].recommendations.every(r=>r.planningOnly));
      assert.equal(expedition.goals[goal].snapshotId,snapshot.snapshotId);
      assert.deepEqual(expedition.goals[goal].selectionFilters,expedition.selectionFilters);
    }
    assert.equal(JSON.stringify(store),busyBefore);

  }finally{await service.dispose();clean(dir);}
});

 test('all curated routes reach the UI and the active-stage search despite legacy route budgets',()=>{
  const P=require('../../src/domain/routes/route_plans'),W=require('../../src/ui/workbench/workbench_model'),R=require('../../src/recommendation/index');
  const store=fixture(),full=P.routeOptions('2-3');assert.equal(full.filter(r=>r.recommend!==false).length,5);
  assert.equal(new Set(full.flatMap(P.optionPaths).map(p=>p.join('>'))).size,16,'all physical journeys remain queryable');
  assert.equal(P.recommendedOptions('2-3').length,5);
  assert.equal(W.mapOverview('2-3').options.length,5);
  assert.equal(W.mapOverview('2-3','boss',undefined,{maxRoutes:2}).options.length,5);
  assert.equal(W.mapOverview('2-3').profile.routePaths.length,16);
  for(const [area,maxRoutes]of [['1-4',2],['7-2',2]]){
    const result=R.recommendNormalFleet(store,{area,automaticFilters:{maxRoutes}});
    assert.deepEqual(result.routeResults.map(r=>[r.phase,r.key]),P.recommendedOptions(area,'boss',P.currentPhase(area,store),{maxRoutes}).map(r=>[r.phase,r.key]));
    assert(result.routeResults.length>maxRoutes);
  }
  assert.equal(P.recommendedOptions('2-3','boss',undefined,{maxRoutes:20}).length,5);
  assert.equal(P.recommendedOptions('1-1').length,4);
 });
test('all stages retain every curated route regardless of progress or old route limits',()=>{
  const P=require('../../src/domain/routes/route_plans'),W=require('../../src/ui/workbench/workbench_model');
  const counts=(area,store,maxRoutes=5,phase)=>Object.fromEntries(
    P.recommendedOptions(area,'boss',phase,{maxRoutes},store).reduce((groups,row)=>
      groups.set(row.phase,(groups.get(row.phase)||0)+1),new Map()));
  const store={info:{maps:{73:{api_gauge_num:2},56:{api_gauge_num:3}}}};
  assert.deepEqual(counts('7-3',store),{gauge1:3,gauge2:4});
  assert.deepEqual(counts('7-3',store,3),{gauge1:3,gauge2:4});
  assert.deepEqual(counts('7-3',store,1),{gauge1:3,gauge2:4});
  assert.deepEqual(counts('5-6',store),{gauge1:3,gauge2:5,gauge3:6});
  assert.deepEqual(counts('5-6',store,1),{gauge1:3,gauge2:5,gauge3:6});
  store.info.maps[56].api_gauge_num=2;
  assert.deepEqual(counts('5-6',store),{gauge1:3,gauge2:5,gauge3:6});
  store.info.maps[75]={api_gauge_num:2};
  assert.deepEqual(counts('7-5',store),{gauge1:5,gauge2:5,gauge3:5});
  assert.deepEqual(counts('7-3',store,3,'gauge2'),{gauge2:4},'explicit phase still selects only that stage');
  for(const value of [undefined,null,0,9,1.5]){
    store.info.maps[73].api_gauge_num=value;
    assert.deepEqual(counts('7-3',store),{gauge1:3,gauge2:4},'unknown progress must not hide stages');
  }
  store.info.maps[73].api_gauge_num=2;
  assert.deepEqual(W.mapOverview('7-3','boss',undefined,{maxRoutes:3},store).options,
    P.recommendedOptions('7-3','boss',undefined,{maxRoutes:3},store));
});
test('snapshot worker searches only the observed phase while the UI retains the full catalog',async()=>{
  const store=fixture(),P=require('../../src/domain/routes/route_plans');
  store.info.maps={72:{api_gauge_num:2}};
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paa-filter-'));
  const service=new FleetAdvisorService({storageDir:dir,getStore:()=>store,controller:new Controller({getStore:()=>store})});
  try{
    const {snapshotId}=service.createSnapshot();
    const result=await service.recommendNormalFleet({snapshotId,area:'7-2',});
    assert.deepEqual(result.routeResults.map(r=>[r.phase,r.key]),
      P.recommendedOptions('7-2','boss','gauge2').map(r=>[r.phase,r.key]));
    assert.equal(result.routeResults.filter(r=>r.phase==='gauge2').length,4);
    assert.equal(result.routeResults.filter(r=>r.phase==='gauge1').length,0);
    assert.deepEqual(require('../../src/ui/workbench/workbench_model').mapOverview('7-2','boss',undefined,undefined,store).profile.targetNodes,['M']);
  }finally{await service.dispose();clean(dir);}
});
 test('settings align equipment borrowing with the independent expedition goal control',()=>{
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()})};
  let changed;const view=require('../../src/ui/settings/recommendation_settings')(React),props={value:F.normalize(),onChange:value=>{changed=value;},disabled:false},tree=view(props);
  const nodes=n=>n&&typeof n==='object'?[n,...n.children.flatMap(nodes)]:[];
  assert(!nodes(tree).some(n=>n.props['aria-label']==='推荐路线上限'));
  const borrowing=nodes(tree).find(n=>n.props['aria-label']==='出击装备借用');
  assert.equal(borrowing.props.role,'group');
  assert.deepEqual(borrowing.children.map(n=>[n.children[0],n.props['aria-pressed']]),[['允许借用',true],['不借用',false]]);
  borrowing.children[0].props.onClick();assert.equal(changed,undefined);
  borrowing.children[1].props.onClick();assert.equal(changed.normal.allowEquipmentBorrowing,false);
  assert.deepEqual(changed.expedition,F.DEFAULTS.expedition);
  const goal=nodes(tree).find(n=>n.props['aria-label']==='远征默认目标');
  assert.equal(goal.props.role,'group');
  const buttons=goal.children;
  assert.deepEqual(buttons.map(n=>[n.children[0],n.props['aria-pressed']]),[['优先大成功',true],['成功即可',false]]);
  changed=undefined;buttons[0].props.onClick();assert.equal(changed,undefined,'selected goal does not write again');
  buttons[1].props.onClick();
  assert.equal(changed.expedition.defaultGoal,'success');assert.deepEqual(changed.normal,F.DEFAULTS.normal);
  const helps=nodes(tree).filter(n=>n.props['data-tooltip']);
  assert.deepEqual(helps.map(n=>n.props['aria-label']),['出击设置说明','远征设置说明']);
  assert(helps.every(n=>n.type==='button'&&n.props.className==='paa-settings-help'));
  assert(nodes(tree).filter(n=>n.props.className==='paa-selection-options').every(n=>!nodes(n).some(c=>c.props.className==='paa-settings-help')),'individual filters have no question marks');
  changed=undefined;
  const disabledGoal=nodes(view({...props,disabled:true})).find(n=>n.props['aria-label']==='远征默认目标');
  assert(disabledGoal.children.every(n=>n.props.disabled));disabledGoal.children[1].props.onClick();assert.equal(changed,undefined);
  const disabledBorrowing=nodes(view({...props,disabled:true})).find(n=>n.props['aria-label']==='出击装备借用');
  assert(disabledBorrowing.children.every(n=>n.props.disabled));disabledBorrowing.children[1].props.onClick();assert.equal(changed,undefined);
  const strings=nodes(tree).flatMap(n=>n.children.filter(c=>typeof c==='string'));
  assert.equal(strings.filter(s=>s==='排除以下舰娘').length,2);
  assert(!strings.some(s=>/^排除.*舰$/.test(s)));assert(strings.includes('第一舰队成员'));
 });

test('routing ship warnings distinguish ownership, filters, alternatives and manual overrides',()=>{
  const s=source(),settings=F.DEFAULTS.normal;
  s.const.$ships[1].api_name='神風';s.const.$ships[2].api_name='羽黒改二';
  const makeContext=()=>({excluded:[],byId:new Map(Object.entries(s.info.ships).map(([id,ship])=>{
    const master=s.const.$ships[ship.api_ship_id];return [Number(id),{id:Number(id),ship,master,name:master.api_name,level:ship.api_lv,available:!F.evaluator(s,'normal',settings)(id).length}];}))});
  const ctx=makeContext(),requirement=[{from:'G',to:'P',alternatives:[[{prefixes:['羽黒'],min:1},{prefixes:['神風'],min:1}]]}];
  let warnings=F.shipRequirementWarnings(s,requirement,ctx,settings);
  assert.equal(warnings.length,1);assert.match(warnings[0],/神風 Lv.50 已持有.*出击设置「未改造」/);
  assert(!warnings[0].includes('羽黒改二'),'do not report a usable routing ship as missing');
  assert.deepEqual(F.shipRequirementWarnings(s,requirement,ctx,settings,{compact:true}),['G → P：神風 Lv.50（未改造，已排除）']);
  ctx.byId.delete(1);warnings=F.shipRequirementWarnings(s,requirement,ctx,settings);
  assert.match(warnings[0],/神風：未持有/);
  ctx.byId=makeContext().byId;ctx.byId.get(1).available=true;
  assert.deepEqual(F.shipRequirementWarnings(s,requirement,ctx,settings),[],'manual inclusion overrides automatic preferences');
  ctx.byId.get(1).available=false;
  const alternatives=[{from:'A',to:'C',alternatives:[[{prefixes:['神風'],min:1}],[{prefixes:['羽黒'],min:1}]]}];
  assert.deepEqual(F.shipRequirementWarnings(s,alternatives,ctx,settings),[],'an available alternative prevents a mandatory-ship claim');
  const choice=[{from:'A',to:'C',alternatives:[[{prefixes:['神風','羽黒'],min:1}]]}];
  assert.deepEqual(F.shipRequirementWarnings(s,choice,ctx,settings),[]);
  // Report every active setting, not just the first one, and explicit exclusions.
  Object.assign(s.info.ships[1],{api_lv:1,api_cond:1,api_locked:0,api_nowhp:1});
  s.info.fleets[2].api_ship=[1];s.info.fleets[2].api_mission=[1,1];s.info.repairs=[{api_ship_id:1}];
  ctx.excluded=[1];warnings=F.shipRequirementWarnings(s,requirement,ctx,settings);
  for(const reason of ['等级低于 30','未改造','士气低于 40','未锁定','大破','远征中','入渠中','手动排除'])assert(warnings[0].includes(reason));
});

test('named routing counts do not count duplicate instances as different ships',()=>{
  const s=source(),ctx={excluded:[],byId:new Map()};
  for(const id of [1,2])ctx.byId.set(id,{id,ship:s.info.ships[id],master:{api_yomi:'かみかぜ'},name:'神風',level:50,available:true});
  const requirements=[{from:'G',to:'P',alternatives:[[{prefixes:['神風','羽黒'],min:2}]]}];
  const warnings=F.shipRequirementWarnings(s,requirements,ctx,F.DEFAULTS.normal);
  assert.match(warnings[0],/可用 1\/2/);assert.match(warnings[0],/羽黒：未持有/);
});
