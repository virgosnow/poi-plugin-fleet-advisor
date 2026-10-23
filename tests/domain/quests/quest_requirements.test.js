'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const DATA=require('../../../data/quests/requirements.json');
const {listRelatedQuests,evaluateFleetRequirements}=require('../../../src/domain/quests/quest_requirements');
const byCode=new Map(DATA.quests.map(q=>[q.code,q]));
function task(code,state=2,overrides={}){
  const quest=byCode.get(code);return {api_no:quest.ids[0],api_state:state,api_title:quest.title,...overrides};
}
function fixture(){
  const state={info:{ships:{},equips:{},resources:[1000,1000,6000,2000]},const:{$ships:{},$equips:{}}};
  const add=(id,masterId,name,type,extra={})=>{
    state.const.$ships[masterId]={api_id:masterId,api_name:name,api_stype:type,api_ctype:1,api_soku:10,...extra};
    state.info.ships[id]={api_id:id,api_ship_id:masterId,api_lv:80,api_soku:10,api_slot:[],api_slot_ex:0};
    return {id,slots:[],ex:-1};
  };
  return {state,add};
}
const query=(state,slots,codes,options={})=>listRelatedQuests({state,slots,mapId:'1-5',deckId:1,questState:{known:true,tasks:codes.map(code=>task(code))},...options});
const codeList=answer=>answer.tasks.map(task=>task.code);

test('only observed available and active quests are listed; never infer unlocks',()=>{
  const {state,add}=fixture(),slots=[add(1,100,'舰娘',2)];
  const answer=query(state,slots,[],{questState:{known:true,tasks:[task('B48',1),task('Bd1',2),task('Bd2',3),task('B50',0),{api_no:999999,api_state:2,api_title:'未知任务'}]}});
  assert.deepEqual(codeList(answer),['Bd1','B48']);
  assert.deepEqual(answer.tasks.map(q=>q.state),[2,1]);
});

test('unknown and empty observed quest snapshots have distinct meanings',()=>{
  assert.deepEqual(listRelatedQuests({state:{},mapId:'1-5'}),{status:'unknown',tasks:[]});
  assert.deepEqual(listRelatedQuests({questState:{known:true,tasks:[]},mapId:'1-5'}),{status:'ready',tasks:[]});
  assert.deepEqual(listRelatedQuests({state:{info:{quests:{activeQuests:{},records:{}}}},mapId:'1-5'}),{status:'unknown',tasks:[]});
});

test('quest snapshot precedence does not resurrect stale state',()=>{
  const {state}=fixture();state.info.quests=[task('B48')];state.questState={known:true,tasks:[task('Bd1')]};
  assert.deepEqual(codeList(listRelatedQuests({state,mapId:'1-5'})),['Bd1']);
  assert.deepEqual(listRelatedQuests({state,mapId:'1-5',questState:{known:false,tasks:[]}}),{status:'unknown',tasks:[]});
});

test('1-5 links several related quests and excludes targets on other maps',()=>{
  const {state,add}=fixture(),slots=[add(1,100,'舰娘',2)];
  const answer=query(state,slots,['B48','Bd8','Bw1','B5']);
  assert.deepEqual(new Set(codeList(answer)),new Set(['B48','Bd8','Bw1']));
  assert.equal(answer.tasks.find(q=>q.code==='B48').goals[0].label,'1-5 Boss A胜以上 4次');
  assert.equal(answer.tasks.find(q=>q.code==='B48').status,'met');
});

test('empty draft cannot report unrestricted fleet requirements as met',()=>{
  const {state}=fixture();const answer=query(state,[],['B48','Bw1']);
  assert.ok(answer.tasks.every(q=>q.status==='unknown'));
  assert.ok(answer.tasks.every(q=>q.checks.some(c=>c.label==='请先选择舰娘')));
});

test('generic sink tasks only appear where matching enemy types exist',()=>{
  const {state,add}=fixture(),slots=[add(1,100,'舰娘',2)];
  assert.deepEqual(codeList(query(state,slots,['Bd4','Bd5','Bd8'],{mapId:'1-1'})),[]);
  // 1-5 has carrier fleets on off-course nodes as well as the ASW route.
  assert.deepEqual(codeList(query(state,slots,['Bd4','Bd5','Bd8'])),['Bd4','Bd8']);
  assert.ok(codeList(query(state,slots,['Bd4','Bd5','Bd8'],{mapId:'2-3'})).includes('Bd5'));
  const missing=query(state,slots,['Bd8'],{mapId:'99-9'}).tasks[0];
  assert.equal(missing.status,'unknown');
});

test('map-group cumulative goals associate each allowed map, without claiming remaining counts',()=>{
  const {state,add}=fixture(),slots=[add(1,100,'舰娘',2)];
  assert.equal(query(state,slots,['Bd7'],{mapId:'2-5'}).tasks.length,1);
  assert.equal(query(state,slots,['Bd7'],{mapId:'1-5'}).tasks.length,0);
  assert.match(query(state,slots,['Bd7'],{mapId:'2-5'}).tasks[0].goals[0].label,/合计B胜以上 5次/);
});

test('multi-map quest only displays goals belonging to selected map',()=>{
  const {state,add}=fixture(),slots=[add(1,100,'舰娘',2)];
  const quest=query(state,slots,['B209'],{mapId:'2-3'}).tasks[0];
  assert.equal(quest.goals.length,1);assert.match(quest.goals[0].label,/2-3/);
});

test('explicit ship missing is unmet; ordinary same-name remodels are accepted',()=>{
  const {state,add}=fixture();
  const slots=[add(1,999,'古鷹改二',5),add(2,998,'加古改二',5),add(3,61,'青葉',5),
    add(4,69,'鳥海',5),add(5,51,'天龍',3),add(6,100,'駆逐艦',2)];
  const q=byCode.get('B11');
  assert.equal(evaluateFleetRequirements(q.fleet,state,slots,1).status,'met');
  assert.equal(evaluateFleetRequirements(q.fleet,state,slots.slice(0,3),1).status,'unmet');
});

test('renamed remodel requires explicit permission; same-family relation alone is unknown',()=>{
  const {state,add}=fixture();
  const hibiki=add(1,35,'響',2,{api_aftershipid:'147'}),verny=add(2,147,'Верный',2);
  const fleet={allOf:[{kind:'count',selector:{kind:'ship',name:'響',masterIds:[35]},min:1}]};
  assert.equal(evaluateFleetRequirements(fleet,state,[verny],1).status,'unknown');
  const allowed={allOf:[{kind:'count',selector:{kind:'ship',name:'響',masterIds:[35,147]},min:1}]};
  assert.equal(evaluateFleetRequirements(allowed,state,[verny],1).status,'met');
  assert.equal(evaluateFleetRequirements(fleet,state,[hibiki],1).status,'met');
});

test('minimum remodel form is not satisfied by an unremodelled hull',()=>{
  const {state,add}=fixture();const base=add(1,34,'暁',2),kai=add(2,437,'暁改二',2);
  const fleet={allOf:[{kind:'count',selector:{kind:'ship',name:'暁改二',masterIds:[437]},min:1}]};
  assert.equal(evaluateFleetRequirements(fleet,state,[base],1).status,'unmet');
  assert.equal(evaluateFleetRequirements(fleet,state,[kai],1).status,'met');
  const lesser={allOf:[{kind:'count',selector:{kind:'ship',name:'暁改',masterIds:[234]},min:1}]};
  assert.equal(evaluateFleetRequirements(lesser,state,[kai],1).status,'met');
  assert.equal(evaluateFleetRequirements(lesser,state,[base],1).status,'unmet');
});

test('distinct roles cannot reuse flagship as a companion',()=>{
  const {state,add}=fixture();const ship=add(1,1,'舰娘',2);
  const role={kind:'count',selector:{kind:'shipType',stypeIds:[2]},min:1};
  const fleet={distinctCompositionGroups:true,allOf:[{...role,positions:[1]},role]};
  assert.equal(evaluateFleetRequirements(fleet,state,[ship],1).status,'unmet');
  assert.equal(evaluateFleetRequirements(fleet,state,[ship,add(2,2,'其他舰',2)],1).status,'met');
});

test('fleet-total predicates can share a flagship, unlike distinct composition roles',()=>{
  const {state,add}=fixture();const ship=add(1,1,'舰娘',2);
  const role={kind:'count',selector:{kind:'shipType',stypeIds:[2]},min:1,scope:'fleetTotal'};
  assert.equal(evaluateFleetRequirements({distinctCompositionGroups:true,allOf:[{...role,positions:[1]},role]},state,[ship],1).status,'met');
});

test('second-ship positions and deck selection are independent; empty position remains empty',()=>{
  const {state,add}=fixture();const first=add(1,1,'第一',2),second=add(2,2,'第二',3);
  const fleet={fleetIndex:1,allOf:[{kind:'count',selector:{kind:'shipType',stypeIds:[3]},min:1,positions:[2]}]};
  assert.equal(evaluateFleetRequirements(fleet,state,[first,second],1).status,'met');
  assert.equal(evaluateFleetRequirements(fleet,state,[second,first],1).status,'unmet');
  assert.equal(evaluateFleetRequirements(fleet,state,[first,null,second],1).status,'unmet');
  assert.equal(evaluateFleetRequirements(fleet,state,[first,second],2).status,'unmet');
});

test('whole-composition alternatives must match one entire branch',()=>{
  const {state,add}=fixture();const a=add(1,1,'甲',2),b=add(2,2,'乙',3),c=add(3,3,'丙',5),d=add(4,4,'丁',7);
  const role=id=>({kind:'count',selector:{kind:'ship',masterIds:[id],name:String(id)},min:1});
  const fleet={distinctCompositionGroups:true,allOf:[{anyOf:[{allOf:[role(1),role(2)]},{allOf:[role(3),role(4)]}]}]};
  assert.equal(evaluateFleetRequirements(fleet,state,[a,b],1).status,'met');
  assert.equal(evaluateFleetRequirements(fleet,state,[a,d],1).status,'unmet');
  assert.equal(evaluateFleetRequirements(fleet,state,[c,d],1).status,'met');
});

test('counts include negatives, max counts, class, nationality, level and exclusions',()=>{
  const {state,add}=fixture();const a=add(1,1,'甲改二',3,{api_ctype:30}),b=add(2,2,'乙',2);
  const fleet={allOf:[{kind:'count',selector:{allOf:[{kind:'shipClass',ctypeIds:[30],name:'陽炎型'},{kind:'country',code:'JP',masterIds:[1]},{kind:'level',min:50},{kind:'remodelName',contains:'改二'},{kind:'shipTypeExclusion',stypeIds:[6]}]},min:1},
    {kind:'count',selector:{not:{kind:'shipType',stypeIds:[3]}},min:1,max:1},
    {kind:'forbiddenCount',selector:{kind:'shipType',stypeIds:[2]},equal:5}]};
  assert.equal(evaluateFleetRequirements(fleet,state,[a,b],1).status,'met');
  state.info.ships[1].api_lv=40;
  assert.equal(evaluateFleetRequirements(fleet,state,[a,b],1).status,'unmet');
});

test('duplicate hull instances/remodel families do not satisfy unique-family rules',()=>{
  const {state,add}=fixture();const a=add(1,1,'甲',2,{api_aftershipid:'2'}),b=add(2,2,'甲改',2);
  assert.equal(evaluateFleetRequirements({uniqueShipFamilies:true,allOf:[]},state,[a,b],1).status,'unmet');
});

test('unknown selectors and missing ship masters never silently pass',()=>{
  const {state,add}=fixture();const slot=add(1,1,'甲',2);
  assert.equal(evaluateFleetRequirements({allOf:[{kind:'count',selector:{kind:'futureCondition'},min:1}]},state,[slot],1).status,'unknown');
  delete state.const.$ships[1];
  assert.equal(evaluateFleetRequirements({allOf:[{kind:'count',selector:{kind:'shipType',stypeIds:[2]},min:1}]},state,[slot],1).status,'unknown');
  assert.equal(evaluateFleetRequirements({allOf:[{kind:'newRule'}]},state,[slot],1).status,'unknown');
});

test('speed requirement uses current candidate equipment/known speed',()=>{
  const {state,add}=fixture();const slot=add(1,1,'甲',2);
  const fleet={allOf:[{kind:'count',selector:{kind:'speed',min:10},min:1}]};
  assert.equal(evaluateFleetRequirements(fleet,state,[slot],1).status,'met');
});

test('expedition tasks include generic success goals and match wiki IDs to game IDs',()=>{
  const {state,add}=fixture(),slots=[add(1,1,'甲',2)];
  const answer=query(state,slots,['Dd1','D25','D5'],{mapId:undefined,missionId:100,deckId:2});
  assert.deepEqual(new Set(codeList(answer)),new Set(['Dd1','D25']));
  assert.match(answer.tasks.find(q=>q.code==='D25').goals[0].label,/A1号远征成功 1次/);
  assert.equal(answer.tasks.find(q=>q.code==='D25').status,'met');
});

test('resource requirements report missing resources, never silently met',()=>{
  const {state,add}=fixture(),slots=[add(1,1,'甲',2)];
  state.info.resources=[1000,1000,799,100];
  const low=query(state,slots,['D25'],{missionId:'A1'}).tasks[0];
  assert.equal(low.status,'unmet');assert.equal(low.checks.find(c=>c.required===800).actual,799);
  delete state.info.resources;
  assert.equal(query(state,slots,['D25'],{missionId:'A1'}).tasks[0].status,'unknown');
});

test('shared expedition goal associates either option, count is approved additional requirement',()=>{
  const {state,add}=fixture(),slots=[add(1,1,'甲',2)];
  const quest=query(state,slots,['Dw3'],{missionId:38}).tasks[0];
  assert.match(quest.goals[0].label,/37／38号远征合计成功 6次/);
  assert.equal(query(state,slots,['Dw3'],{missionId:36}).tasks.length,0);
});

test('Bm7 mapping conflicts require exact normalized title, for both numeric candidates',()=>{
  const {state,add}=fixture(),slots=[add(1,1,'甲',2)];
  for(const id of [266,267]){
    const live=task('Bm7',2,{api_no:id});
    assert.equal(query(state,slots,[],{mapId:'2-5',questState:{known:true,tasks:[live]}}).tasks.length,1);
    assert.equal(query(state,slots,[],{mapId:'2-5',questState:{known:true,tasks:[{...live,api_title:'别的任务'}]}}).tasks.length,0);
  }
});

test('other duplicate numeric IDs are disambiguated by title',()=>{
  const {state,add}=fixture(),slots=[add(1,1,'甲',2)];
  for(const code of ['B205','By15']){
    const q=byCode.get(code),map=q.goals.find(g=>g.map&&g.map!=='any').map;
    assert.equal(query(state,slots,[code],{mapId:map}).tasks[0].code,code);
  }
});

test('imported scope and provenance are complete without raw page content',()=>{
  assert.equal(DATA.quests.length,316);
  assert.equal(DATA.quests.filter(q=>q.category==='B').length,273);
  assert.equal(DATA.quests.filter(q=>q.category==='D').length,43);
  assert.ok(DATA.source.sources.every(source=>source.url&&source.sha256));
  assert.ok(DATA.quests.every(q=>q.source.url&&q.fleet&&q.goals.length));
  assert.ok(DATA.quests.every(q=>!q.rawText&&!q.contentHtml&&!q.detailText&&!q.sourceFile));
});
