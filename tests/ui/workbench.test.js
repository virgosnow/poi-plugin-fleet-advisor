'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../../src/ui/workbench/workbench_model'),fixture=require('../helpers/workbench_fixture');
const {Controller}=require('../../src/application/controller');
const {recommendExpeditionFleet}=require('../../src/recommendation/index');

test('full-search holds retain manual positions and equipment but ignore automatic loadouts',()=>{
  const store=fixture(),slots=[W.entry(store,1),null,{...W.entry(store,2),pin:true},
    {...W.entry(store,3),keep:{0:true,ex:true},ex:-1},null,null];
  const before=JSON.stringify(slots),holds=W.recommendationHolds(slots);
  assert.equal(holds[0],null);assert.equal(holds[1],null);
  assert.equal(holds[2].id,2);assert(holds[2].pin);assert(holds[2].slots.every(id=>id===null));
  assert.equal(holds[3].slots[0],slots[3].slots[0]);assert.equal(holds[3].ex,-1);
  const changed=JSON.parse(before);changed[0]=W.entry(store,4);changed[2].slots.fill(999);changed[3].slots[1]=999;
  assert.deepEqual(W.recommendationHolds(changed),holds);
  changed[3].slots[0]=777;assert.notDeepEqual(W.recommendationHolds(changed),holds);
  assert.equal(JSON.stringify(slots),before);
});

test('normalized draft constraints preserve full recommendation results with manual ship positions',()=>{
  const store=fixture(),recommend=require('../../src/recommendation/index').recommendNormalFleet;
  for(const slots of [Array(6).fill(null),[W.entry(store,1),W.entry(store,2),null,null,null,null],
    [null,{...W.entry(store,2),pin:true},{...W.entry(store,3),keep:{0:true}},null,null,null]]){
    const args={area:'1-1',fixedShipIds:slots.filter(s=>s&&(s.pin||Object.keys(s.keep).length)).map(s=>s.id)};
    assert.deepEqual(recommend(store,{...args,heldSlots:W.recommendationHolds(slots)}),recommend(store,{...args,heldSlots:slots}));
  }
});

function equipmentPickerFixture(){
  const store=fixture();
  store.const.$equips[200]={api_id:200,api_name:'测试飞机',api_type:[0,0,6,6]};
  store.const.$shipTypes[3]={api_equip_type:{6:1}};
  for(let id=101;id<=106;id++)store.info.equips[id]={api_id:id,api_slotitem_id:200,api_level:0,api_alv:7};
  return store;
}

test('manual equipment choices merge equivalent instances but retain different masters, stars and proficiency',()=>{
  const store=equipmentPickerFixture();
  store.info.equips[103].api_level=1;store.info.equips[104].api_alv=6;
  store.const.$equips[201]={...store.const.$equips[200],api_id:201};
  store.info.equips[105].api_slotitem_id=201;
  const slots=[W.entry(store,1)],before=JSON.stringify({store,slots});
  const rows=W.equipmentOptions(store,slots,0,0);
  assert.equal(rows.length,4,'same names alone do not imply equivalent equipment');
  assert.equal(rows.find(r=>r.id===101).count,3);
  assert.match(rows.find(r=>r.id===101).tooltip,/可用 3 件/);
  assert(rows.some(r=>r.id===103));assert(rows.some(r=>r.id===104));assert(rows.some(r=>r.id===105));
  assert.equal(W.equipmentOptions(store,slots,0,0,'106')[0].id,106,'explicit instance search still works');
  assert.equal(JSON.stringify({store,slots}),before);
});

test('manual equipment groups exclude unavailable copies and consume a different instance for another slot',()=>{
  const store=equipmentPickerFixture();
  store.info.ships[2].api_slot=[101,-1];store.info.fleets[2].api_ship=[2];store.info.fleets[2].api_mission=[1,1];
  store.info.airbase=[{api_plane_info:[{api_slotid:102}]}];
  store.info.ships[3].api_slot=[104,-1];
  store.info.ships[1].api_slot=[106,-1];
  const slots=[{...W.entry(store,1),slots:[-1,-1]}, {...W.entry(store,4),slots:[103,-1]}];
  let rows=W.equipmentOptions(store,slots,0,0);
  assert.equal(rows.length,1);assert.equal(rows[0].count,3);assert.equal(rows[0].id,105,'prefer a free copy');
  slots[0].slots[0]=105;
  rows=W.equipmentOptions(store,slots,0,1);
  assert.equal(rows[0].count,2);assert.equal(rows[0].id,106,'own ship before other donors, without reusing 105');
  slots[0].slots[1]=106;
  rows=W.equipmentOptions(store,slots,0,0);
  assert.equal(rows[0].id,105,'retain current copy when opening its slot');
  assert.equal(rows[0].count,2);
});

test('manual equipment grouping keeps the current borrowed copy and checks expansion eligibility first',()=>{
  const store=equipmentPickerFixture();store.info.ships[3].api_slot=[106,-1];
  const slots=[{...W.entry(store,1),slots:[106,-1]}];
  assert.equal(W.equipmentOptions(store,slots,0,0)[0].id,106,'do not replace a current draft instance just to deduplicate');
  assert.equal(W.equipmentOptions(store,slots,0,'ex').length,0);
  store.info.ships[1].api_slot_ex=-1;
  store.const.$exslotEquipShips[200]={api_req_level:2,api_ship_ids:{1:1}};
  store.info.equips[104].api_level=2;store.info.equips[105].api_level=2;
  const extra=W.equipmentOptions(store,slots,0,'ex');
  assert.equal(extra.length,1);assert.equal(extra[0].id,104);assert.equal(extra[0].count,2);
});

test('manual equipment sorts by game category and model order, then descending stars and proficiency',()=>{
  const store=equipmentPickerFixture();store.info.equips={};
  store.const.$shipTypes[3].api_equip_type={1:1,6:1,12:1,99:1};
  for(const [id,type,icon,sort,name]of [[501,1,1,20,'A炮'],[502,1,1,10,'Z炮'],
    [503,1,16,1,'高角炮'],[504,12,11,1,'电探'],[505,99,99,1,'未来装备']])
    store.const.$equips[id]={api_id:id,api_type:[0,0,type,icon],api_sortno:sort,api_name:name};
  for(const [id,master,stars,rank]of [[101,501,0,0],[102,501,10,0],[103,501,5,0],[104,502,0,0],
    [105,200,0,7],[106,503,0,0],[107,504,0,0],[108,505,0,0],[109,200,0,6]])
    store.info.equips[id]={api_id:id,api_slotitem_id:master,api_level:stars,api_alv:rank};
  store.info.ships[2].api_slot=[102,-1];
  const slots=[W.entry(store,1)],rows=W.equipmentOptions(store,slots,0,0);
  assert.deepEqual(rows.map(r=>r.id),[105,109,104,102,103,101,106,107,108]);
  assert.deepEqual(rows.map(r=>r.categoryId),[1,1,4,4,4,4,6,9,14]);
  assert.equal(rows.find(r=>r.id===106).category,'副炮／对空','game high-angle gun split overrides raw gun type');
  assert.deepEqual(W.equipmentOptions(store,slots,0,0,'主炮').map(r=>r.id),[104,102,103,101]);
});

test('replacement shortlist uses same ship type and leaves all ships available without hiding restrictions',()=>{
  const store=fixture(),slots=[W.entry(store,2),W.entry(store,1)];
  store.info.fleets[2].api_ship=[3];store.info.fleets[2].api_mission=[1,1];
  const similar=W.replacementCandidates(store,slots,0);
  assert(similar.every(r=>r.typeId===2));
  assert.equal(similar.find(r=>r.id===3).fleetLabel,'第 3 舰队');
  assert(similar.find(r=>r.id===3).unavailable);
  assert(W.replacementCandidates(store,slots,0,'','all').some(r=>r.typeId===1));
  assert(W.replacementCandidates(store,slots,2).some(r=>r.typeId===1));
  assert.equal(W.replacementCandidates(store,slots,0,'不存在').length,0);
});

test('change summary compares final target fleet and actual equipment owners without changing the store',()=>{
  const store=fixture();store.info.fleets[0].api_ship=[1,2];
  store.info.ships[3].api_slot=[111,-1];store.info.ships[2].api_slot=[112,-1];
  const before=JSON.stringify(store),slots=[{...W.entry(store,1),slots:[111,-1]},W.entry(store,3)];
  slots[1].slots=[112,-1];
  assert.equal(W.changeSummary(store,slots,1),'换入 1 艘 · 移出 1 艘 · 调整 2 槽装备 · 借用 2 件');
  assert.equal(W.changeSummary(store,[W.entry(store,2),W.entry(store,1)],1),'调整顺序');
  assert.equal(W.changeSummary(store,[W.entry(store,1),W.entry(store,2)],1),'与目标舰队一致');
  assert.equal(JSON.stringify(store),before);
});
test('autocomplete preserves fixed positions and manual equipment without duplicate instances',()=>{
  const store=fixture(),old=[{...W.entry(store,2),pin:true,slots:[111,-1],keep:{0:true}},null,{...W.entry(store,1),pin:true},null,null,null];
  const before=JSON.stringify(old),next=W.merge(store,old,{ships:[{id:1,slots:[111,-1]},{id:3,slots:[-1,-1]},{id:2,slots:[-1,-1]}]});
  assert.deepEqual(next.filter(Boolean).map(s=>s.id),[2,3,1]);
  assert.equal(next[0].slots[0],111);assert.equal(next[2].slots[0],-1);
  assert.equal(JSON.stringify(old),before);
  assert.throws(()=>W.merge(store,old,{ships:[{id:1}]}),/没有保留/);
});

test('normal completion follows the recommended formation while retaining manual hulls and equipment ownership',()=>{
  const store=fixture(),old=[{...W.entry(store,2),pin:true,slots:[111,-1],keep:{0:true}},null,
    {...W.entry(store,1),pin:true},null,null,null],before=JSON.stringify(old);
  const holds=W.recommendationHolds(old,{preservePositions:false});
  assert(holds.filter(Boolean).every(h=>h.holdPosition===false));
  const next=W.merge(store,old,{ships:[{id:1,slots:[111,-1]},{id:3,slots:[-1,-1]},
    {id:2,slots:[-1,-1]}]},{preservePositions:false});
  assert.deepEqual(next.filter(Boolean).map(s=>s.id),[1,3,2]);
  assert(next[0].pin&&next[2].pin);assert(next[2].keep[0]);
  assert.equal(next[2].slots[0],111);assert.equal(next[0].slots[0],-1);
  assert.equal(JSON.stringify(old),before);
  assert.throws(()=>W.merge(store,old,{ships:[{id:1}]},{preservePositions:false}),/没有保留/);
});

test('explicit Asashio search spans ship types and automatic preferences while retaining availability reasons',()=>{
  const store=fixture(),selection={kind:'normal',filters:{minLevel:90}},slots=[W.entry(store,1)];
  store.const.$ships[2].api_name='朝潮改二丁';store.const.$ships[2].api_yomi='あさしお';
  store.const.$ships[3].api_name='朝潮改';store.const.$ships[3].api_yomi='あさしお';
  store.info.ships[2].api_cond=20;store.info.ships[2].api_locked=0;
  let candidates=W.replacementCandidates(store,slots,0,'朝潮','similar',selection);
  assert.deepEqual(candidates.map(r=>r.id),[2,3]);
  assert(!candidates[0].unavailable);assert(candidates[0].preferenceReasons.includes('士气低于 40'));
  assert(candidates[0].preferenceReasons.includes('等级低于 90'));
  assert(candidates[0].preferenceReasons.includes('未锁定'));
  store.info.fleets[2].api_ship=[2];store.info.fleets[2].api_mission=[1,1];
  store.info.repairs=[{api_ship_id:3}];
  candidates=W.replacementCandidates(store,slots,0,'朝潮','similar',selection);
  assert.equal(candidates.find(r=>r.id===2).unavailable,'远征中');
  assert.equal(candidates.find(r=>r.id===3).unavailable,'修理中');
  store.info.repairs=[];
  assert.equal(W.roster(store,[W.entry(store,2)],1,'朝潮').find(r=>r.id===3).unavailable,'同舰已编入');
});

test('ship choices put first-fleet members first and sort each group by descending level',()=>{
  const store=fixture();
  store.info.fleets[0].api_ship=[4,2];
  for(const [id,level]of [[1,99],[2,20],[3,95],[4,80],[5,90],[6,85],[7,1],[8,2]])store.info.ships[id].api_lv=level;
  const rows=W.replacementCandidates(store,[],0,'','all',{kind:'normal',filters:{minLevel:90}});
  assert.deepEqual(rows.map(r=>r.id),[4,2,1,3,5,6,8,7]);
  assert.equal(rows[0].fleet,1);assert.equal(rows[1].fleetLabel,'第 1 舰队');
});
test('income deducts expedition supply and does not fabricate missing master data',()=>{
  const store=fixture(),slots=[W.entry(store,1),W.entry(store,2)];
  const before=JSON.stringify(store),income=W.income(store,slots,1);
  assert.equal(income.cost.fuelCost,6);assert.equal(income.rows.find(r=>r.name==='燃料').net,-6);
  assert.equal(income.rows.find(r=>r.name==='弹药').net,30);
  assert.equal(income.rows.find(r=>r.name==='弹药').greatNet,45);
  store.info.ships[1].api_lv=100;
  assert.equal(W.income(store,slots,1).cost.fuelCost,5);
  store.info.ships[1].api_lv=50;assert.equal(JSON.stringify(store),before);
  delete store.const.$ships[1].api_fuel_max;assert.equal(W.income(store,slots,1),null);
  assert.equal(W.income(store,slots,999),null);
});

test('expedition status follows draft equipment and preserves unknown morale',()=>{
  const E=require('../../src/ui/expedition/expedition_model'),store=fixture();
  store.info.equips[101]={api_slotitem_id:75};store.info.equips[102]={api_slotitem_id:75};
  store.info.ships[1].api_cond=50;delete store.info.ships[2].api_cond;
  const slots=[{...W.entry(store,1),slots:[101,-1]},null,{...W.entry(store,2),slots:[-1,-1],ex:102}];
  const before=JSON.stringify(store),status=E.fleetStatus(store,slots),badges=E.shipBadges(status);
  assert.equal(status.sparkled,1);assert.equal(status.count,2);assert.equal(status.drums,2);assert.equal(status.carriers,2);assert(status.unknownMorale);
  assert.match(badges.get(1)[0].label,/有闪 50/);assert.equal(badges.get(2)[0].state,'unknown');
  assert.match(badges.get(2)[1].label,/运输桶 1/);assert.equal(JSON.stringify(store),before);
});

test('expedition ship reward badges share the drum row and use the current draft including expansion',()=>{
  const E=require('../../src/ui/expedition/expedition_model'),store=fixture();
  for(const [id,master,level] of [[101,75,0],[102,68,10],[103,193,0],[104,167,0],[105,230,0]])
    store.info.equips[id]={api_slotitem_id:master,api_level:level};
  store.info.ships[1].api_slot=[105,-1];
  const slots=[{...W.entry(store,1),slots:[101,102],ex:103},{...W.entry(store,2),slots:[104,105],ex:-1}],before=JSON.stringify({store,slots});
  const badges=E.shipBadges(E.fleetStatus(store,slots)),first=badges.get(1),second=badges.get(2);
  assert.deepEqual(first.map(b=>b.key),['expedition-morale','expedition-drums','expedition-income']);
  assert.equal(first[2].label,'基础收益 +10%');assert.equal(first[2].category,'income');
  assert.match(first[2].detail,/上限：20%/);assert.match(first[2].detail,/改修与特大发组合/);
  assert.equal(second.at(-1).label,'基础收益 +1%','non-reward tank craft are excluded');
  const empty=slots.map(s=>({...s,slots:[-1,-1],ex:-1}));
  assert(!E.shipBadges(E.fleetStatus(store,empty)).get(1).some(b=>b.key==='expedition-income'),'manual removals update immediately');
  assert.equal(JSON.stringify({store,slots}),before);
});

test('expedition ship reward badges include Kinu and explicitly remain base contributions before the fleet cap',()=>{
  const E=require('../../src/ui/expedition/expedition_model'),store=fixture();
  store.info.ships[1].api_ship_id=487;
  for(const id of [101,102,103,104,105])store.info.equips[id]={api_slotitem_id:68,api_level:10};
  const slots=[{...W.entry(store,2),slots:[101,102,103,104,105],ex:-1},{id:1,slots:[-1,-1],ex:-1}];
  const badges=E.shipBadges(E.fleetStatus(store,slots));
  assert.equal(badges.get(2).at(-1).label,'基础收益 +25%','do not pretend the uncapped per-hull value is actual fleet income');
  assert.equal(badges.get(1).at(-1).label,'基础收益 +5%');assert.match(badges.get(1).at(-1).detail,/舰娘自带：\+5%（鬼怒改二）/);
  slots[1].slots=[101,102];slots[0].slots=[103,104,105];
  assert.equal(E.shipBadges(E.fleetStatus(store,slots)).get(1).at(-1).label,'基础收益 +15%');
});

test('expedition overview separates unavailable probability and zero-rate net income',()=>{
  const E=require('../../src/ui/expedition/expedition_model'),React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()})};
  const view=require('../../src/ui/expedition/expedition_view')(React),nodes=n=>n&&typeof n==='object'?[n,...n.children.flatMap(nodes)]:[],text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join(' ');
  const store=fixture(),income=W.income(store,[W.entry(store,1),W.entry(store,2)],1);
  const render=rate=>view.overview({mission:{flagshipLevel:1,shipCount:2},master:{api_time:90},expedition:null,rate,income,goal:'great',hasShips:true});
  const zero=render(0),table=nodes(zero).find(n=>n.props['aria-label']==='扣补给后的远征收益');
  assert.equal(table.props['data-columns'],2);assert(!text(table).includes('大成功'));assert(text(table).includes('-6'));assert(text(table).includes('+30'));
  assert.equal(nodes(render(50)).find(n=>n.props['aria-label']==='扣补给后的远征收益').props['data-columns'],3);
  assert(text(render(null)).includes('—'));assert(!text(render(null)).includes('0%'));
  assert.equal(E.durationText(90),'1小时30分');assert.equal(E.durationText(30),'30分');assert.equal(E.durationText(60),'1小时');assert.equal(E.durationText(null),null);
});
test('hourly expedition income converts net supplies and rewards by actual mission duration',()=>{
  const E=require('../../src/ui/expedition/expedition_model'),store=fixture();
  const income=W.income(store,[W.entry(store,1),W.entry(store,2)],1),before=JSON.stringify(income);
  const fuel=income.rows.find(r=>r.name==='燃料'),ammo=income.rows.find(r=>r.name==='弹药');
  assert.equal(E.incomeText(fuel.net,'hour',90),'-4');
  assert.equal(E.incomeText(ammo.net,'hour',90),'+20');
  assert.equal(E.incomeText(ammo.greatNet,'hour',90),'+30');
  assert.equal(E.incomeText(7,'hour',90),'+4.7');
  assert.equal(E.incomeText(-7,'hour',90),'-4.7');
  assert.equal(E.incomeText(7,'hour',15),'+28');
  assert.equal(E.incomeText(0,'hour',90),'0');
  assert.equal(E.incomeText(-0.001,'hour',90),'0');
  for(const time of [undefined,null,0,-1,NaN,Infinity])assert.equal(E.incomeText(7,'hour',time),'—');
  assert.equal(E.incomeText(null,'hour',90),'—');
  assert.equal(E.incomeText(fuel.net,'trip',null),'-6');
  assert.equal(JSON.stringify(income),before);
});

test('income breakdown preserves separately floored bonuses, zero rewards and signed supply costs',()=>{
  const E=require('../../src/ui/expedition/expedition_model');
  for(const [base,success,great,cost,successBonus,greatBonus] of [
    [30,31,47,5,1,2],
    [31,32,48,5,1,2],
    [350,399,598,30,49,73],
    [0,0,0,5,0,0],
    [30,30,45,0,0,0],
  ]){
    const row={name:'弹药',base,success,great,cost},before=JSON.stringify(row),parts=E.incomeBreakdown(row);
    assert.equal(parts[0].success,base);assert.equal(parts[0].great,base);
    assert.equal(parts[1].success,0);assert.equal(parts[1].great,Math.floor(base*1.5)-base);
    assert.equal(parts[2].success,successBonus);assert.equal(parts[2].great,greatBonus);
    assert.equal(parts[3].success,-cost||0);assert.equal(parts[3].great,-cost||0);
    assert.equal(parts.reduce((n,p)=>n+p.success,0),success-cost);
    assert.equal(parts.reduce((n,p)=>n+p.great,0),great-cost);
    assert.equal(JSON.stringify(row),before);
  }
  const saved=E.incomeBreakdown({name:'弹药',success:31,great:47,cost:5},1);
  assert.equal(saved[0].success,30,'existing income rows can recover base rewards from local mission data');
  const unknown=E.incomeBreakdown({name:'燃料',success:100,great:150,cost:5},999);
  assert.equal(unknown[0].success,null);assert.equal(unknown[1].great,null);assert.equal(unknown[2].success,null);
  assert.equal(unknown[3].success,-5);assert.equal(E.incomeText(unknown[0].success,'trip'),'—');
});

test('great-success goal actually prefers sparkled eligible ships while success keeps low cost',()=>{
  const store=fixture();store.info.ships[5].api_cond=60;store.info.ships[6].api_cond=60;
  const great=recommendExpeditionFleet(store,{missionId:1,fleet:2,goal:'great'}).recommendations[0];
  const normal=recommendExpeditionFleet(store,{missionId:1,fleet:2,goal:'success'}).recommendations[0];
  assert(great.evaluation.greatSuccess.estimatedPercent>normal.evaluation.greatSuccess.estimatedPercent);
  assert(great.evaluation.eligible);assert(normal.evaluation.eligible);
});
test('great-success drum target falls back to an eligible ordinary drum load when scarce',()=>{
  const store=fixture();store.const.$equips[75]={api_id:75,api_name:'ドラム缶',api_type:[0,0,25,30]};
  store.const.$shipTypes[2]={api_equip_type:{25:1}};store.const.$shipTypes[3]={api_equip_type:{25:1}};
  for(let id=101;id<=104;id++)store.info.equips[id]={api_id:id,api_slotitem_id:75,api_level:0};
  const result=recommendExpeditionFleet(store,{missionId:37,fleet:2,goal:'great',excludedShipIds:[7]});
  assert(result.recommendations.length>0);assert(result.recommendations.every(r=>r.evaluation.eligible));
});

function withDrums(store,n){
  store.const.$equips[75]={api_id:75,api_name:'ドラム缶',api_type:[0,0,25,30]};
  for(const type of [1,2,3])store.const.$shipTypes[type]={api_equip_type:{25:1}};
  for(let id=101;id<101+n;id++)store.info.equips[id]={api_id:id,api_slotitem_id:75,api_level:0};
  return store;
}
test('four sparkles + full drum tier save surplus sparkle ships and equipment at 100%',()=>{
  const store=withDrums(fixture(),12);
  for(let id=1;id<=6;id++)store.info.ships[id].api_cond=60;
  const before=JSON.stringify(store);
  const best=recommendExpeditionFleet(store,{missionId:21,fleet:2,goal:'great'}).recommendations[0];
  assert(best.evaluation.eligible);assert.equal(best.evaluation.greatSuccess.estimatedPercent,100);
  assert.equal(best.evaluation.greatSuccess.sparkledCount,4);
  assert.equal(best.scheme.ships.length,5);assert.equal(best.evaluation.greatSuccess.drums,4);
  assert.equal(JSON.stringify(store),before);
});
test('no sparkles still recommends drum innate probability, limited inventory falls back',()=>{
  const store=withDrums(fixture(),2);
  const full=recommendExpeditionFleet(store,{missionId:24,fleet:2,goal:'great'}).recommendations[0];
  assert(full.evaluation.eligible);assert.equal(full.evaluation.greatSuccess.estimatedPercent,40);
  delete store.info.equips[102];
  const base=recommendExpeditionFleet(store,{missionId:24,fleet:2,goal:'great'}).recommendations[0];
  assert(base.evaluation.eligible);assert.equal(base.evaluation.greatSuccess.estimatedPercent,5);
  assert.equal(base.evaluation.greatSuccess.drums,0,'one extra drum has no probability benefit');
});
test('flagship search includes high levels outside cheap first ten, but respects fixed flagship',()=>{
  const store=fixture();
  for(let id=2;id<=8;id++)store.info.ships[id].api_taisen=[60,60];
  for(let id=9;id<=22;id++){
    store.const.$ships[id]={...store.const.$ships[2],api_id:id,api_name:`测试舰${id}`,api_fuel_max:15,api_bull_max:15};
    store.info.ships[id]={...store.info.ships[2],api_id:id,api_ship_id:id,api_fuel:15,api_bull:15,api_lv:50};
  }
  store.info.ships[22].api_lv=128;
  for(const id of [2,3,4,22])store.info.ships[id].api_cond=60;
  const best=recommendExpeditionFleet(store,{missionId:101,fleet:2,goal:'great'}).recommendations[0];
  assert.equal(best.scheme.ships[0].id,22);assert.equal(best.evaluation.greatSuccess.estimatedPercent,100);
  assert.equal(best.evaluation.greatSuccess.sparkledCount,4);
  const locked=recommendExpeditionFleet(store,{missionId:101,fleet:2,goal:'great',fixedFlagshipId:2}).recommendations[0];
  assert.equal(locked.scheme.ships[0].id,2);assert(locked.evaluation.greatSuccess.estimatedPercent<100);
  assert.equal(locked.evaluation.greatSuccess.sparkledCount,4,'best available probability is returned below 100');
  assert.throws(()=>recommendExpeditionFleet(store,{missionId:24,goal:'great',fixedFlagshipId:2}),/旗舰/);
});
test('great-success display keeps below-100 probabilities honest and shows innate bonuses',()=>{
  const E=require('../../src/ui/expedition/expedition_model');
  assert.equal(E.rateText(99.969), '99.96%');assert.equal(E.rateText(115),'100%');
  assert.equal(E.rateText(null),'—');
  const store=withDrums(fixture(),2),best=recommendExpeditionFleet(store,{missionId:24,fleet:2,goal:'great'}).recommendations[0];
  assert(E.probabilityDetails(best.evaluation.greatSuccess).some(s=>s.includes('基础概率')));
  const cards=E.requirements(best.evaluation);
  assert(cards.every(c=>c.sat));assert(cards.some(c=>c.label==='舰种组合'&&c.value.includes('驱逐 / 海防')));
  const empty=E.requirements(null,require('../../src/domain/expeditions/expeditions').listExpeditions(store).find(m=>m.missionId===24));
  assert(empty.some(c=>c.value==='— / 50'));assert(empty.every(c=>c.sat===undefined));
});

test('at full probability, a sufficient flagship wins over needless surplus level bonus',()=>{
  const store=fixture();
  for(let id=2;id<=8;id++){store.info.ships[id].api_taisen=[60,60];store.info.ships[id].api_cond=id<=6?60:49;}
  store.info.ships[2].api_lv=128;store.info.ships[3].api_lv=185;
  // A cheaper level-185 flagship must not beat sufficient level 128 just
  // because both displayed probabilities cap at 100.
  Object.assign(store.const.$ships[3],{api_fuel_max:8,api_bull_max:8});
  const best=recommendExpeditionFleet(store,{missionId:101,fleet:2,goal:'great'}).recommendations[0];
  assert.equal(best.evaluation.greatSuccess.estimatedPercent,100);
  assert.equal(best.evaluation.greatSuccess.sparkledCount,4);
  assert.equal(best.scheme.ships[0].id,2);
  assert(best.evaluation.greatSuccess.rawPercent<100.2);
});

test('reducing surplus flagship bonus must not add another ship to a full-probability fleet',()=>{
  const store=fixture();
  for(let id=2;id<=8;id++){store.info.ships[id].api_taisen=[60,60];store.info.ships[id].api_cond=id<=6?60:49;}
  store.info.ships[7].api_lv=33;
  const best=recommendExpeditionFleet(store,{missionId:101,fleet:2,goal:'great'}).recommendations[0];
  assert.equal(best.evaluation.greatSuccess.estimatedPercent,100);
  assert.equal(best.evaluation.greatSuccess.sparkledCount,5);
  assert.equal(best.scheme.ships.length,5,'six ships with level-33 flagship wastes a hull merely to reduce raw surplus');
});
test('report validates structural errors and records context so stale map/fleet results cannot enable apply',()=>{
  const store=fixture(),controller=new Controller({getStore:()=>store}),settings={kind:'manual',fleet:1};
  const result=W.inspect(controller,store,[W.entry(store,1)],settings);
  assert(result.valid);assert.equal(result.settingsKey,JSON.stringify(settings));
  assert(!W.inspect(controller,store,[W.entry(store,1),W.entry(store,1)],settings).valid);
  assert(!W.inspect(controller,store,[],settings).valid);
});
test('JSON name resolution normalizes unopened expansion slots before rendering and reapplying',()=>{
  const store=fixture(),controller=new Controller({getStore:()=>store});
  const plan=controller.preview('fleet',{fleet:1,ships:[{name:'测试舰2'},{id:1}]});
  const rows=W.resolved(store,plan);
  assert.deepEqual(rows.map(s=>s.id),[2,1]);assert(rows.every(s=>s.ex===-1));
  assert.doesNotThrow(()=>controller.preview('fleet',W.scheme(rows,1)));
});
test('air badges distinguish departure estimates from whole-route guarantees',()=>{
  const report={route:{airControl:{assessment:{superiority:{status:'meetsAtStart'}}},fixedArrivalCondition:{estimatedMeets:true,confirmedMeets:true}}};
  assert.deepEqual(W.badges(report),{air:'出击前空优',airBad:false,los:'索敌达标'});
  assert.equal(W.badges({}).los,'索敌待确认');
  report.route.fixedArrivalCondition.confirmedMeets=false;
  assert.equal(W.badges(report).los,'索敌待确认','an optimistic estimate alone does not prove routing sufficiency');
});
