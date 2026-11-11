'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const F=require('../../src/config/recommendation_filters'),fixture=require('../helpers/workbench_fixture');
const {formatMissingRoutingShips,formatBlockedRoute}=require('../../src/ui/models/route_warnings');
const {setLocale}=require('../../src/shared/i18n');
test('alternative routing ships and unavailable reasons retain data and render in each language',()=>{
 const s=fixture();s.const.$ships[1].api_name='神風';s.const.$ships[2].api_name='羽黒改二';
 s.info.fleets[2]={api_ship:[1],api_mission:[1,1]};s.info.repairs=[{api_ship_id:1}];
 const row={id:1,name:'神風',level:50,ship:s.info.ships[1],master:s.const.$ships[1],available:false};
 const ctx={excluded:[1],byId:new Map([[1,row]])};
 const requirements=[{from:'start',to:'A',alternatives:[[{prefixes:['神風'],min:1}],[{prefixes:['羽黒'],min:1}]]}];
 const details=F.shipRequirementWarningDetails(s,requirements,ctx,F.DEFAULTS.normal,{compact:true});
 assert.equal(details.length,1);const detail=details[0],before=JSON.stringify(detail);
 assert.deepEqual(F.shipRequirementWarnings(s,requirements,ctx,F.DEFAULTS.normal,{compact:true}),[detail.text]);
 assert.equal(detail.choices.length,2);assert.deepEqual(detail.choices[0][0].ships[0].reasons.map(r=>r.origin),['setting','setting','manual']);
 try{
  setLocale('ja-JP');const ja=formatMissingRoutingShips(detail);
  assert.match(ja,/出撃地点 → A/);assert.match(ja,/神風 Lv\.50/);assert.match(ja,/遠征中/);assert.match(ja,/入渠中/);assert.match(ja,/手動で除外/);assert.match(ja,/羽黒：未所持/);
  setLocale('zh-TW');const tw=formatMissingRoutingShips(detail);
  assert.match(tw,/出發點 → A/);assert.match(tw,/神風 Lv\.50/);assert.match(tw,/遠征中/);assert.match(tw,/入渠中/);assert.match(tw,/手動排除/);assert.match(tw,/羽黒：未持有/);
  assert.equal(JSON.stringify(detail),before,'formatting must not change structured data');
  const unknown=JSON.parse(before);unknown.choices[0][0].ships[0].reasons.push({origin:'unknown'});
  assert.equal(formatMissingRoutingShips(unknown),unknown.text,'unknown future reasons keep the compatibility text');
 }finally{setLocale('zh-CN');}
});

test('manual fleet route blockers keep all nodes and conditions while localizing only structured data',()=>{
 const {evaluateNormalRoute}=require('../../src/domain/routes/normal_routes');
 const W=require('../../src/ui/workbench/workbench_model'),store=fixture();
 const route=evaluateNormalRoute(store,{area:'5-2',scheme:{fleet:1,ships:[2,3,4,5,6,8]}});
 const selected={nodes:['B','C','D','F','O']},before=JSON.stringify(route);
 const P=require('../../src/domain/routes/route_plans');
 const ordinary=P.routeDiagnostics(route,selected),structured=P.routeDiagnostics(route,selected,{structured:true});
 const strip=p=>{const {currentDetail,requirementDetails,reasonCode,minimumSpeed,radarCarriers,...legacy}=p;return legacy;};
 assert.deepEqual(structured.points.map(strip),ordinary.points,'display metadata is opt-in and cannot alter public diagnostic decisions');
 const issue=W.draftRouteIssue({route},selected,true);
 assert(issue.unreachable);assert.deepEqual(issue.warningDetails.map(row=>row.from),['C','F']);
 assert.deepEqual(issue.warningDetails.map(row=>row.text),issue.warnings);
 try{
  setLocale('ja-JP');let rows=issue.warningDetails.map(formatBlockedRoute);
  assert.match(rows[0],/^C → D：現在の編成が該当：/);assert.match(rows[0],/翔鶴/);assert.match(rows[0],/瑞鶴/);
  assert.match(rows[1],/^F → O：/);assert.match(rows[1],/係数 2.*< 63/);assert.match(rows[1],/≥ 70/);
  setLocale('zh-TW');rows=issue.warningDetails.map(formatBlockedRoute);
  assert.match(rows[0],/^C → D：目前命中：/);assert.match(rows[0],/翔鶴/);assert.match(rows[1],/係數 2.*< 63/);
  assert.equal(JSON.stringify(route),before,'formatting must not modify fleet, route, or probability');
  const unknown={code:'routeBlocked',from:'A',to:'B',current:{code:'stageUnknown'},requirements:[],text:'A → B：当前阶段是否开放该节点待确认'};
  assert.match(formatBlockedRoute(unknown),/待確認/);
  const raw={...unknown,current:{code:'raw',text:'无法判断的外部资料'}};
  assert.equal(formatBlockedRoute(raw),raw.text,'free text remains an exact compatibility fallback');
  const reachable=evaluateNormalRoute(store,{area:'1-1',scheme:{fleet:1,ships:[2,3,4,5,6,8]}});
  assert.equal(W.draftRouteIssue({route:reachable},{nodes:['A','C']},true),null,'a possible route must not become blocked');
 }finally{setLocale('zh-CN');}
});

test('strategy speed and radar warnings use codes and do not claim unknown speed is insufficient',()=>{
 const {evaluateNormalRoute}=require('../../src/domain/routes/normal_routes'),P=require('../../src/domain/routes/route_plans');
 const W=require('../../src/ui/workbench/workbench_model'),store=fixture();
 const route=evaluateNormalRoute(store,{area:'3-2',scheme:{fleet:1,ships:[2,3,4,5,6,8]}});
 const option=P.routeOptions('3-2','boss').find(row=>row.key==='guide:3-2-01');
 const issue=W.draftRouteIssue({route},option,true),speed=issue.warningDetails.find(row=>row.code==='strategySpeed'),radar=issue.warningDetails.find(row=>row.code==='strategyRadar');
 assert(speed);assert(radar);
 try{
  setLocale('ja-JP');assert.match(formatBlockedRoute(speed),/高速\+統一/);assert.match(formatBlockedRoute(radar),/少なくとも1隻/);
  setLocale('zh-TW');assert.match(formatBlockedRoute(speed),/全隊高速\+統一/);assert.match(formatBlockedRoute(radar),/至少 1 艘/);
  const unknown={...route,speed:{...route.speed,status:'unknown'}};
  const pending=W.draftRouteIssue({route:unknown},option,true);
  assert(!pending.warningDetails.some(row=>row.code==='strategySpeed'),'unknown speed cannot be presented as confirmed insufficient');
 }finally{setLocale('zh-CN');}
});

test('fleet requirements translate from a copied predicate while preserving original decisions',()=>{
 const {evaluateNormalRoute}=require('../../src/domain/routes/normal_routes'),P=require('../../src/domain/routes/route_plans');
 const W=require('../../src/ui/workbench/workbench_model'),store=fixture();
 const route=evaluateNormalRoute(store,{area:'1-1',scheme:{fleet:1,ships:[2,3,4,5,6,8]}});
 const option=P.routeOptions('1-1','boss').find(row=>row.key==='guide:1-1-01'),before=JSON.stringify({route,option});
 const issue=W.draftRouteIssue({route},option,true),detail=issue.warningDetails.find(row=>row.code==='fleetRequirement');assert(detail);
 try{
  setLocale('ja-JP');assert.match(formatBlockedRoute(detail),/編成条件：.*艦隊.*1隻.*雷巡.*1隻/);
  setLocale('zh-TW');assert.match(formatBlockedRoute(detail),/攻略編成要求：.*艦隊.*1 艘.*雷巡.*1 艘/);
  assert.equal(JSON.stringify({route,option}),before,'rendering must not mutate the original machine rule');
  const future={...detail,expression:{futureCondition:1}};
  assert.equal(formatBlockedRoute(future),detail.text,'unknown predicates keep the exact prior warning');
 }finally{setLocale('zh-CN');}
});

test('incompatible path reasons use stable IDs and preserve unknown data',()=>{
 const {evaluateNormalRoute}=require('../../src/domain/routes/normal_routes'),P=require('../../src/domain/routes/route_plans');
 const W=require('../../src/ui/workbench/workbench_model'),store=fixture();
 const route=evaluateNormalRoute(store,{area:'6-2',scheme:{fleet:1,ships:[2,3,4,5,6,8]}}),option={nodes:['C','D','H']};
 const legacy=P.routeDiagnostics(route,option),structured=P.routeDiagnostics(route,option,{structured:true});
 const issue=W.draftRouteIssue({route},option,true),detail=issue.warningDetails.find(row=>row.code==='incompatiblePath');assert(detail);
 const plain=legacy.points.find(row=>row.summary===detail.text),rich=structured.points.find(row=>row.summary===detail.text);
 assert(plain);assert.equal(plain.reasonCode,undefined);assert.equal(rich.reasonCode,'incompatiblePath');
 try{
  setLocale('ja-JP');const ja=formatBlockedRoute(detail);assert.match(ja,/C→D→H/);assert.match(ja,/計3隻以上/);assert.match(ja,/0隻/);
  setLocale('zh-TW');const tw=formatBlockedRoute(detail);assert.match(tw,/至少 3 艘/);assert.match(tw,/0 艘/);
  assert.equal(formatBlockedRoute({...detail,reason:'different wording'}),tw,'display wording does not change the translation');
  assert.equal(formatBlockedRoute({...detail,reasonId:'new-revision'}),detail.text,'unreviewed identifiers cannot reuse a stale translation');
  assert.equal(formatBlockedRoute({...detail,nodes:['C','X','H']}),detail.text,'unrecognized path cannot reuse a translation');
 }finally{setLocale('zh-CN');}
});
