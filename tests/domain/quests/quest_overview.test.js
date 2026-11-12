'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {listOverviewQuests,destinations,missionId}=require('../../../src/domain/quests/quest_overview');
const catalog=require('../../../data/quests/requirements.json').quests;
const event=require('../../../data/quests/limited/2026-halloween.json');
const byCode=code=>[...catalog,...event.quests].find(quest=>quest.code===code);
const live=(code,state=2)=>{const q=byCode(code);return {api_no:q.ids[0],api_title:q.title,api_state:state};};
const query=tasks=>listOverviewQuests({state:{},questState:{known:true,tasks},now:Date.parse('2026-11-01T00:00:00Z')});

test('overview includes observed sortie and expedition tasks with real destinations and phases',()=>{
  const result=query([live('B131'),live('Dw2'),live('2610B2'),live('B2',1),live('B2',3)]);
  const task=code=>result.tasks.find(row=>row.code===code);
  assert.equal(result.status,'ready');assert(task('2610B2'));assert.equal(task('B2').state,3);
  assert.deepEqual(task('B131').goals.find(goal=>goal.label.includes('7-2')).destinations[0],
    {kind:'normal',area:'7-2',target:'boss',phase:'gauge2',label:'7-2'});
  assert.deepEqual(task('Dw2').goals[0].destinations.map(item=>item.missionId),[37,38]);
  assert(task('2610B2').goals.some(goal=>goal.destinations.some(destination=>destination.area==='1-2')));
  assert.equal(missionId('A1'),100);assert.equal(missionId('B1'),110);assert.equal(missionId('invalid'),null);
});

test('overview only includes active tasks, including unknown ones, and retains observed progress',()=>{
  const result=query([{...live('B131'),api_progress_flag:1},{...live('Dw2'),api_progress_flag:2},
    {...live('B2',1),api_category:2},{...live('B2',3),api_category:2},
    {api_no:999999,api_category:2,api_title:'未知进行中',api_state:2},
    {api_no:999998,api_category:4,api_title:'未知未受领',api_state:1}]);
  assert.deepEqual(result.tasks.map(row=>row.code).filter(Boolean).sort(),['B131','B2','Dw2']);
  assert.equal(result.tasks.find(row=>row.code==='B131').progressFlag,1);
  assert.equal(result.tasks.find(row=>row.code==='Dw2').progressFlag,2);
  assert(result.tasks.some(row=>row.id===999999));assert(!result.tasks.some(row=>row.id===999998));
  assert.equal(query([live('B2',1),live('B2',3)]).tasks.length,1);
});

test('overview retains the actual game description independently of catalog goals',()=>{
  const raw='【編成】<b>艦隊</b>を編成！<br>出撃 &amp; 勝利 &#x2605;';
  const result=query([{...live('B131'),api_detail:raw},{api_no:999999,api_category:2,api_title:'未知',api_state:2,api_detail:'情報<br>不足'}]);
  assert.equal(result.tasks.find(row=>row.code==='B131').description,'【編成】艦隊を編成！\n出撃 & 勝利 ★');
  assert.equal(result.tasks.find(row=>row.id===999999).description,'情報\n不足');
  assert.equal(query([live('B131')]).tasks[0].description,'');
});

test('structured goals have stable identities independent of their position',()=>{
  const first=query([live('B131')]).tasks[0].goals;
  const second=query([live('Dw2'),live('B131')]).tasks.find(row=>row.code==='B131').goals;
  assert(first.every(goal=>/^[a-f0-9]{64}$/.test(goal.key)));
  assert.deepEqual(first.map(goal=>goal.key),second.map(goal=>goal.key));
});

test('game rewards distinguish observed resources, selections and unknown data',()=>{
  const {rewards}=require('../../../src/domain/quests/quest_overview');
  const state={const:{$equips:{35:{api_name:'装备名'}},$useitems:{3:{api_name:'道具名'}}}};
  assert.deepEqual(rewards({api_get_material:[50,0,100,0],api_select_rewards:[[{api_kind:12,api_mst_id:35,api_count:2},{api_kind:13,api_mst_id:3,api_count:1}]]},state),
    {resources:[{name:'燃料',amount:50},{name:'钢材',amount:100}],fixed:[],choices:[[{name:'装备名',count:2,kind:12,id:35},{name:'开发资材',count:1,kind:13,id:3}]],reference:false,choicesFromGame:true,shipBonus:false});
  assert.equal(rewards({},state).resources,null);
  assert.deepEqual(rewards({api_get_material:[0,0,0,0]},state).resources,[]);
  assert.deepEqual(rewards({api_get_material:[1,-1,0,0]},state).resources,null);
  assert.equal(rewards({api_bonus_flag:2},state).shipBonus,true);
});

test('fixed, selectable and limited equipment rewards match task identity; game choices take priority',()=>{
  const state={const:{$equips:{103:{api_name:'固定装备',api_type:[0,0,0,5]},165:{api_name:'选项甲'},178:{api_name:'选项乙'}}}};
  const list=tasks=>listOverviewQuests({state,questState:{known:true,tasks},now:Date.parse('2026-11-01T00:00:00Z')}).tasks;
  const fixed=list([live('B27')])[0].rewards;assert.equal(fixed.fixed[0].name,'固定装备');assert.equal(fixed.fixed[0].iconType,5);assert(fixed.reference);
  const choice=list([live('B88')])[0].rewards;assert.deepEqual(choice.choices[0].map(x=>x.name),['选项甲','选项乙']);assert.equal(choice.choicesFromGame,false);
  const actual=list([{...live('B88'),api_select_rewards:[[{api_kind:12,api_mst_id:103,api_count:2,api_slotitem_level:3}]]}])[0].rewards;
  assert.equal(actual.choicesFromGame,true);assert.deepEqual(actual.choices[0].map(x=>[x.name,x.count,x.level]),[['固定装备',2,3]]);
  const seasonal=list([live('2610B3'),live('2610B4'),live('2610B8')]);
  assert(seasonal.find(t=>t.code==='2610B3').rewards.choices[0].some(x=>x.name==='SKレーダー'&&x.count===4));
  assert(seasonal.find(t=>t.code==='2610B4').rewards.choices[1].some(x=>x.name==='Ro.44水上戦闘機'));
  assert(seasonal.find(t=>t.code==='2610B8').rewards.choices[0].some(x=>x.name==='試製 秋水'));
  const {rewards}=require('../../../src/domain/quests/quest_overview');
  assert.equal(rewards({api_no:999999},state,byCode('B27')).reference,false);
});

test('daily expedition Dd1 includes its verified development material',()=>{
  const {rewards}=require('../../../src/domain/quests/quest_overview');
  const row=rewards({api_no:402,api_get_material:[100,100,100,100]}, {}, {code:'Dd1'});
  assert.equal(row.reference,true);
  assert.deepEqual(row.fixed.map(x=>[x.kind,x.id,x.count]),[[13,3,1]]);
});

test('practice rewards use the community-number mapping while retaining internal task IDs',()=>{
  const rows=query([{...live('P302'),api_category:3},{...live('P345'),api_category:3}]).tasks;
  const weekly=rows.find(row=>row.code==='P302'),annual=rows.find(row=>row.code==='P345');
  assert.equal(weekly.rewards.reference,true);assert(weekly.rewards.fixed.some(item=>item.kind===13&&item.id===3&&item.count===2));
  assert.equal(annual.rewards.reference,true);assert.equal(annual.rewards.choices.length,2);
  assert(annual.rewards.choices[0].some(item=>item.kind===12&&item.id===242));
  assert.equal(annual.rewards.choicesFromGame,false);
});

test('new preparation practices and factory task retain requirements and verified rewards',()=>{
  const event=require('../../../data/quests/limited/2026-saury-preparation.json');
  const factory=require('../../../data/quests/factory.json').quests[0];
  const seen=[...event.quests,factory].map(q=>({api_no:q.ids[0],api_title:q.title,api_category:q.category==='C'?3:6,api_state:2,api_get_material:[0,0,0,0]}));
  const result=listOverviewQuests({state:{},questState:{known:true,tasks:seen},now:Date.parse('2026-11-12T12:00:00+09:00')}).tasks;
  assert.deepEqual(result.map(t=>t.code).sort(),['2611C1','2611C2','F144']);
  for(const code of ['2611C1','2611C2']){const row=result.find(t=>t.code===code);assert.equal(row.rewards.choices.length,2);assert.equal(row.goals[0].count,3);}
  const f=result.find(t=>t.code==='F144');assert.equal(f.category,'F');assert.equal(f.rewards.fixed[0].level,10);assert.equal(f.rewards.fixed[0].count,2);
  assert.deepEqual(f.goals.map(g=>g.kind),['factoryEquip','factoryEquip','factoryDiscard','factoryPrepare']);
  assert(f.goals.every(g=>!g.key&&g.count===undefined&&g.destinations.length===0));
  assert.equal(listOverviewQuests({state:{},questState:{known:true,tasks:[{...seen[2],api_title:'不同任务'}]}}).tasks.length,0);
});

test('reference rewards are tied to known quest IDs and retain complete choices',()=>{
  const entries=require('../../../data/quests/rewards.json').quests;
  assert(Object.keys(entries).length>300);
  for(const [code,row] of Object.entries(entries)){
    assert(byCode(code)?.ids.includes(row.id),code);
    for(const group of [row.fixed,...row.choices])for(const item of group){
      assert([11,12,13,14,18].includes(item.kind),code);
      assert(Number.isSafeInteger(item.count)&&item.count>0,code);
      assert(item.kind===18||Number.isSafeInteger(item.id)&&item.id>0,code);
      if(item.level!==undefined)assert(item.level>=1&&item.level<=10,code);
    }
    assert(row.choices.every(group=>group.length),code);
  }
});

test('named equipment rewards scan master data at most once per overview and see in-place updates',()=>{
  let scans=0;const masters=new Proxy({1:{api_name:'SKレーダー',api_type:[0,0,0,5]}},{ownKeys(target){scans++;return Reflect.ownKeys(target);}});
  const state={const:{$equips:masters},questState:{known:true,tasks:[live('2610B3'),live('2610B4'),live('2610B8')]}};
  const read=()=>listOverviewQuests({state,now:Date.parse('2026-11-01T00:00:00Z')}).tasks.find(t=>t.code==='2610B3').rewards.choices[0].find(x=>x.name==='SKレーダー');
  assert.equal(read().iconType,5);assert.equal(scans,1);
  masters[1].api_type[3]=6;assert.equal(read().iconType,6);assert.equal(scans,2);
});

test('combined, generic and unknown objectives retain correct navigation boundaries',()=>{
  const result=query([live('Bd7'),live('B10'),live('B1'),live('D1'),live('B175'),
    {api_no:999999,api_category:2,api_title:'尚未收录',api_detail:'出击<br>目标未知',api_state:2},
    {api_no:999998,api_category:3,api_title:'演习',api_state:2}]);
  const task=code=>result.tasks.find(row=>row.code===code);
  assert.deepEqual(task('Bd7').goals[0].destinations.map(item=>item.area),['2-1','2-2','2-3','2-4','2-5']);
  assert(task('B10').goals[0].destinations[0].area,'enemy-kill objective chooses a documented eligible map');
  assert.equal(task('B1').goals[0].destinations[0].area,null,'any map preserves the workbench destination');
  assert.equal(task('D1').goals[0].destinations[0].missionId,null,'any mission preserves the workbench destination');
  assert.deepEqual(task('B175').goals.find(goal=>goal.label.includes('7-4')).destinations[0],
    {kind:'normal',area:'7-4',target:'O',label:'7-4'});
  const unknown=result.tasks.find(row=>row.id===999999);assert.equal(unknown.code,null);
  assert.equal(unknown.goals[0].label,'目标条件待确认');assert.deepEqual(unknown.goals[0].destinations,[]);
  const unknownPractice=result.tasks.find(row=>row.id===999998);
  assert.equal(unknownPractice.category,'C');assert.equal(unknownPractice.code,null);
  assert.deepEqual(unknownPractice.goals[0].destinations,[]);
  assert.equal(listOverviewQuests({state:{}}).status,'unknown');
});

test('overview describes known fleet conditions without evaluating the current fleet',()=>{
  const result=query([live('B136'),live('Dd1'),{api_no:999999,api_category:2,api_title:'未知',api_state:2}]);
  const constrained=result.tasks.find(row=>row.code==='B136');
  assert(constrained.fleetRequirements.some(rule=>rule.kind==='count'&&rule.positions?.[0]===1&&rule.selector?.name==='海風改二'));
  assert(constrained.fleetRequirements.some(rule=>rule.kind==='count'&&rule.min===2&&rule.selector?.anyOf?.some(ship=>ship.name==='山風')));
  assert.deepEqual(result.tasks.find(row=>row.code==='Dd1').fleetRequirements,[]);
  assert.equal(result.tasks.find(row=>row.id===999999).fleetRequirements,null);
});

test('active practice tasks appear with a safe practice destination and preserve unknown tasks',()=>{
  const result=query([{api_no:371,api_category:3,api_state:2,api_title:'春です！「春雨」、演習しますっ！'},
    {api_no:303,api_category:3,api_state:1,api_title:'未接取'},
    {api_no:999999,api_category:3,api_state:2,api_title:'未知',api_detail:'演習で勝利'}]);
  const task=result.tasks.find(row=>row.id===371);
  assert.equal(task.category,'C');assert.equal(task.code,'P371');assert.equal(task.period,'yearly');
  assert.match(task.goals[0].label,/A胜以上 4次/);
  assert.deepEqual(task.goals[0].destinations,[{kind:'practice',label:'演习'}]);
  assert.equal(task.goals[0].key,undefined,'do not invent individually tracked progress');
  assert(!result.tasks.some(row=>row.id===303));
  assert.equal(result.tasks.find(row=>row.id===999999).code,null);
});
test('practice multi-stage goals do not misdirect sortie or consumable steps to practice',()=>{
 const result=query([{api_no:317,api_category:3,api_state:2,api_title:'甲型駆逐艦の戦力整備計画'},
   {api_no:318,api_category:3,api_state:2,api_title:'給糧艦「伊良湖」の支援'}]);
 const sortie=result.tasks.find(row=>row.id===317),ration=result.tasks.find(row=>row.id===318);
 assert.equal(sortie.goals[0].destinations[0].kind,'practice');
 assert(sortie.goals.slice(1).every(goal=>goal.known&&goal.destinations.every(destination=>destination.kind==='normal')));
 assert.match(ration.goals[1].label,/战斗粮食/);assert.equal(ration.goals[1].destinations.length,0);
});

test('every structured target maps to a related mission or an actual map path',()=>{
  const {relation}=require('../../../src/domain/quests/quest_requirements');
  const {previewForMap}=require('../../../src/domain/routes/sortie_profile');
  let checked=0;
  for(const quest of [...catalog,...event.quests].filter(row=>['B','D'].includes(row.category)))for(const goal of quest.goals||[]){
    const rows=destinations(goal,quest.category);assert(rows.length,quest.code);
    for(const row of rows){
      checked++;
      if(row.kind==='normal'&&row.area){
        assert.equal(relation(goal,{mapId:row.area}),true,quest.code);
        assert(previewForMap(row.area,{target:row.target,phase:row.phase}).routePaths.length,quest.code);
      }else if(row.kind==='expedition'&&row.missionId!==null)
        assert.equal(relation(goal,{missionId:row.missionId}),true,quest.code);
    }
  }
  assert(checked>=800);
});
