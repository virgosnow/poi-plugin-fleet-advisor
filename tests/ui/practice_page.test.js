'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/workbench_fixture'),W=require('../../src/ui/workbench/workbench_model');
test('practice imports a live fleet as a draft and immediately reevaluates it',()=>{
 const store=fixture(),states=[],refs=[];let i=0,j=0,calls=0,forecastCalls=0;
 store.info.fleets[2].api_ship=[2,3];store.practiceState={known:true,opponents:[{id:10,index:1,name:'对手',ships:[{masterId:1,level:50}]}],revision:1};
 store.const.$equips[501]={api_id:501,api_name:'测试炮',api_type:[0,0,1,1]};store.const.$shipTypes[2]={api_equip_type:{1:1}};
 store.info.equips[101]={api_id:101,api_slotitem_id:501};store.info.ships[2].api_slot=[101,-1];
 const {Controller}=require('../../src/application/controller'),controller=new Controller({getStore:()=>store});
 const service={preview:(...args)=>{calls++;return controller.preview(...args);},recommendPracticeFleet:()=>assert.fail('import must not recommend or refit')};
 const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),useEffect:()=>{},
  useRef(initial){const at=j++;return refs[at]||(refs[at]={current:initial});},useState(initial){const at=i++;if(!(at in states))states[at]=typeof initial==='function'?initial():initial;return [states[at],value=>{states[at]=typeof value==='function'?value(states[at]):value;}];}};
 const Page=require('../../src/ui/practice/practice_page')(React,{getStore:()=>store,getController:()=>service});
 const walk=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(walk)]:[];
 const render=()=>{i=0;j=0;return Page({kind:'practice',automaticOperations:true});};
 let tree=render();walk(tree).find(n=>n.props.className==='paa-practice-opponent-select').props.onClick();tree=render();
 const forecast=require('../../src/domain/combat/practice_forecast'),original=forecast.estimate;
 forecast.estimate=(...args)=>{forecastCalls++;return original(...args);};
 const before=JSON.stringify(store),picker=walk(tree).find(n=>n.type?.name==='FleetImportPicker');assert(picker);
 try{picker.props.onImport(3);tree=render();}finally{forecast.estimate=original;}
 assert.deepEqual(states[0].filter(Boolean).map(s=>s.id),[2,3]);assert(states[0].filter(Boolean).every(s=>s.pin));
 assert.deepEqual(states[0][0].slots,[101,-1]);assert(forecastCalls>0,'selected opponent is reassessed with the imported fleet');
 assert.equal(states[1],1);assert(calls>0);assert.equal(JSON.stringify(store),before);
 assert(walk(tree).some(n=>n.props['data-ship-id']===2));
});

test('practice can inspect an away fleet but warns that it cannot be applied, in every language',()=>{
 const {setLocale}=require('../../src/shared/i18n'),store=fixture(),states=[],refs=[];let i=0,j=0;
 store.info.fleets[2].api_ship=[2,3];store.info.fleets[2].api_mission=[1,1];
 const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),useEffect:()=>{},
  useRef(initial){const at=j++;return refs[at]||(refs[at]={current:initial});},useState(initial){const at=i++;if(!(at in states))states[at]=typeof initial==='function'?initial():initial;return [states[at],value=>{states[at]=typeof value==='function'?value(states[at]):value;}];}};
 const Page=require('../../src/ui/practice/practice_page')(React,{getStore:()=>store,getController:()=>({preview:()=>{throw Error('away')}})});
 const walk=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(walk)]:[],render=()=>{i=0;j=0;return Page({automaticOperations:true});};
 try{
  walk(render()).find(n=>n.type?.name==='FleetImportPicker').props.onImport(3);
  for(const [locale,text] of [['zh-CN','导入舰队当前仅供参考，暂不可应用'],['zh-TW','匯入艦隊目前僅供參考，暫時無法套用'],['ja','読込んだ艦隊は参考表示です。現在は反映できません']]){
   setLocale(locale);const nodes=walk(render());assert(nodes.some(n=>n.props.className==='paa-fleet-warning'&&n.children.includes(text)));
   assert.equal(nodes.find(n=>n.props.className==='paa-primary paa-wb-apply').props.disabled,true);
  }
  assert.deepEqual(states[0].filter(Boolean).map(s=>s.id),[2,3]);
 }finally{setLocale('zh-CN');}
});

test('practice renders recommendation errors in the currently selected language',async()=>{
 const {setLocale}=require('../../src/shared/i18n'),store=fixture(),states=[],refs=[];let i=0,j=0;
 store.practiceState={known:true,opponents:[{id:10,index:1,name:'对手',ships:[{masterId:1,level:50}]}],revision:1};
 const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),useEffect:()=>{},
  useRef(initial){const at=j++;return refs[at]||(refs[at]={current:initial});},useState(initial){const at=i++;if(!(at in states))states[at]=typeof initial==='function'?initial():initial;return [states[at],value=>{states[at]=typeof value==='function'?value(states[at]):value;}];}};
 const service={preview:()=>({}),createSnapshot:()=>({snapshotId:'test'}),recommendPracticeFleet:async()=>{throw Object.assign(Error('legacy'),{code:'PRACTICE_TARGETS_OVER_CAPACITY',details:{count:7,capacity:6}});}};
 const Page=require('../../src/ui/practice/practice_page')(React,{getStore:()=>store,getController:()=>service});
 const walk=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(walk)]:[],render=()=>{i=0;j=0;return Page({automaticOperations:false});};
 try{
  walk(render()).find(n=>n.props.className==='paa-practice-opponent-select').props.onClick();
  await walk(render()).find(n=>n.props.className==='paa-wb-complete').props.onClick();
  for(const [locale,expected] of [['ja',/計7隻で、6隻/],['zh-TW',/共 7 艘，超過 6 艘/],['zh-CN',/共 7 艘，超过 6 艘/]]){
   setLocale(locale);const warning=walk(render()).find(n=>n.props.className==='paa-fleet-warning');assert.match(warning.children.join(''),expected);
  }
 }finally{setLocale('zh-CN');}
});
test('overview navigation selects an active practice quest without clearing the existing draft',()=>{
 const store=fixture(),states=[],refs=[],effects=[];let i=0,j=0;
 store.questState={known:true,complete:true,tasks:[{api_no:371,api_category:3,api_state:2,api_title:'春です！「春雨」、演習しますっ！'}]};
 const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),useEffect:fn=>effects.push(fn),
  useRef(initial){const at=j++;return refs[at]||(refs[at]={current:initial});},
  useState(initial){const at=i++;if(!(at in states))states[at]=typeof initial==='function'?initial():initial;return [states[at],value=>{states[at]=typeof value==='function'?value(states[at]):value;}];}};
 const Page=require('../../src/ui/practice/practice_page')(React,{getStore:()=>store,getController:()=>({})});
 const intent={id:1,kind:'practice',code:'P371'},walk=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(walk)]:[];
 const render=()=>{i=0;j=0;effects.length=0;return Page({navigationIntent:intent});};
 render();states[0]=[W.entry(store,1),null,null,null,null,null];render();
 effects.find(fn=>String(fn).includes('handledNavigation.current===intent.id'))();
 const tree=render(),section=walk(tree).find(n=>n.type?.name==='QuestSection');
 assert.deepEqual(section.props.selectedQuests,['P371']);assert.equal(section.props.open,true);assert.equal(states[0][0].id,1);
});
test('practice task focus compresses the upper sections and keeps the fleet draft',()=>{
 const store=fixture(),states=[],refs=[];let i=0,j=0;
 const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),useEffect:()=>{},
  useRef(initial){const at=j++;return refs[at]||(refs[at]={current:initial});},useState(initial){const at=i++;if(!(at in states))states[at]=typeof initial==='function'?initial():initial;return [states[at],value=>{states[at]=typeof value==='function'?value(states[at]):value;}];}};
 const Page=require('../../src/ui/practice/practice_page')(React,{getStore:()=>store,getController:()=>({preview:()=>({})})});
 const walk=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(walk)]:[],render=()=>{i=0;j=0;return Page({automaticOperations:false});};
 let tree=render();states[0]=[W.entry(store,1),null,null,null,null,null];tree=render();
 walk(tree).find(n=>n.type?.name==='QuestSection').props.onOpenChange(true);tree=render();
 assert.equal(walk(tree).find(n=>n.props.className==='paa-wb-left').props['data-quest-focus'],true);
 const compact=walk(tree).find(n=>n.props.className==='paa-quest-focus-rows');assert.equal(compact.children.length,3);
 compact.children[0].props.onClick();tree=render();assert.equal(walk(tree).find(n=>n.props.className==='paa-wb-left').props['data-quest-focus'],undefined);
 assert.equal(states[0][0].id,1);
});
test('practice completes an empty fleet without specifying training ships',async()=>{
 const store=fixture(),states=[],requests=[];let i=0;
 store.practiceState={known:true,opponents:[{id:10,index:1,name:'对手',ships:[{masterId:1,level:50}]}],revision:1};
 const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),useEffect:()=>{},useRef:value=>({current:value}),
  useState(initial){const at=i++;if(!(at in states))states[at]=typeof initial==='function'?initial():initial;return [states[at],value=>{states[at]=typeof value==='function'?value(states[at]):value;}];}};
 const service={preview:()=>({}),createSnapshot:()=>({snapshotId:'test'}),recommendPracticeFleet:async args=>{
  requests.push(args);return require('../../src/recommendation/practice').recommendPractice(store,args);
 }};
 const Page=require('../../src/ui/practice/practice_page')(React,{getStore:()=>store,getController:()=>service});
 const walk=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(walk)]:[],render=()=>{i=0;return Page({kind:'practice',automaticOperations:false});};
 let tree=render();
 assert.equal(walk(tree).find(n=>n.props.className==='paa-practice-training-empty-hint').children[0],'无特别指定');
 assert.equal(walk(tree).find(n=>n.props.className==='paa-practice-training-trigger').props['aria-label'],'优先培养舰娘：无特别指定');
 walk(tree).find(n=>n.props.className==='paa-practice-opponent-select').props.onClick();tree=render();
 const complete=walk(tree).find(n=>n.props.className==='paa-wb-complete');assert.equal(complete.props.disabled,false);
 await complete.props.onClick();tree=render();
 assert.equal(requests.length,1);assert.deepEqual(requests[0].trainingShipIds,[]);assert(requests[0].slots.every(slot=>slot===null));
 assert.equal(states[0].filter(Boolean).length,6);assert.equal(new Set(states[0].map(slot=>slot.id)).size,6);
 assert.equal(walk(tree).find(n=>n.props.className==='paa-practice-training-empty-hint').children[0],'无特别指定');
 assert(!walk(tree).some(n=>n.props.className==='paa-fleet-warning'));
});
test('practice hides special attack badges while retaining ordinary combat mechanisms',()=>{
 const mechanism=require('../../src/domain/combat/ship_mechanisms');
 const cases=[['special-shelling',[['大和改二重',10],['武蔵改二',9]]],
   ['special-night',[['金剛改二丙',8],['比叡改二丙',8]]],
   ['special-submarine',[['迅鯨改',20],['伊58改',14],['伊168改',13]]]];
 for(const [special,names] of cases){
   const store=fixture(),states=[];let i=0;
   names.forEach(([name,type],index)=>Object.assign(store.const.$ships[index+1],{api_name:name,api_stype:type}));
   for(const ship of Object.values(store.info.ships))Object.assign(ship,{api_nowhp:100,api_maxhp:100});
   store.info.useitems={95:{api_id:95,api_count:2}};
   Object.assign(store.const.$ships[4],{api_slot_num:3,api_maxeq:[0,0,0]});
   Object.assign(store.info.ships[4],{api_slot:[600,601,602],api_onslot:[0,0,0]});
   Object.assign(store.info.ships[5],{api_slot:[603,604],api_lucky:[40,99]});
   Object.assign(store.const.$ships[6],{api_maxeq:[0,2]});
   Object.assign(store.info.ships[6],{api_slot:[605,606],api_onslot:[0,2]});
   [['高角炮',1,10,16],['高角炮',1,10,16],['电探',12,4,11],['鱼雷',5,0,5],['鱼雷',5,0,5],
     ['発煙装置(煙幕)',93,0,54],['九八式水上偵察機(夜偵)',10,0,50]].forEach(([name,type,aa,icon],index)=>{
     const id=600+index;store.const.$equips[id]={api_id:id,api_name:name,api_type:[0,0,type,icon],api_tyku:aa,api_raig:type===5?8:0};
     store.info.equips[id]={api_id:id,api_slotitem_id:id,api_level:0};
   });
   const slots=[1,2,3,4,5,6].map(id=>W.entry(store,id));states[0]=slots;
   const actual=mechanism.fleetMechanisms(store,slots,mechanism.fleetSpeed(store,slots));
   assert(actual.get(1).some(b=>b.key===special),`${special} exists outside practice`);
   assert(actual.get(4).some(b=>b.key==='aaci'));assert(actual.get(5).some(b=>b.key==='night'&&b.label.includes('CI')));
   assert(actual.get(6).some(b=>b.key==='smoke'),'smoke remains visible outside practice');
   assert.match(actual.get(6).find(b=>b.key==='night-contact').detail,/均衡与空丧不可/);
   const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),useEffect:()=>{},useRef:value=>({current:value}),
     useState(initial){const at=i++;if(!(at in states))states[at]=typeof initial==='function'?initial():initial;return [states[at],()=>{}];}};
   const Page=require('../../src/ui/practice/practice_page')(React,{getStore:()=>store,getController:()=>({preview:()=>({})})});
   const walk=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(walk)]:[];
   const nodes=walk(Page({kind:'practice',automaticOperations:false}));
   assert(!nodes.some(n=>['special-shelling','special-night','special-submarine','smoke'].includes(n.props['data-mechanism'])));
   for(const key of ['speed','aaci','night','night-contact'])assert(nodes.some(n=>n.props['data-mechanism']===key),`${key} remains visible`);
   assert.match(nodes.find(n=>n.props['data-mechanism']==='night-contact').props['data-tooltip'],/均衡时条件待确认/);
 }
});
test('practice page displays observed opponents, preserves manual drafts and keeps unknowns explicit',async()=>{
 const store=fixture(),states=[];let i=0;
 store.practiceState={known:true,opponents:[{id:10,index:1,name:'对手',level:100,ships:[{masterId:1,level:55}]}],history:[],localHistory:[],revision:1};
 store.questState={known:true,tasks:[{api_no:1,api_category:3,api_state:2,api_title:'演習任務',api_detail:'<b>演習で勝利</b>'},{api_no:2,api_category:4,api_state:2,api_title:'远征任务'}]};
 const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),useEffect:()=>{},useRef:value=>({current:value}),
   useState(initial){const at=i++;if(!(at in states))states[at]=typeof initial==='function'?initial():initial;return [states[at],value=>{states[at]=typeof value==='function'?value(states[at]):value;}];}};
 const Page=require('../../src/ui/practice/practice_page')(React,{getStore:()=>store,getController:()=>({preview:()=>({})})});
 const render=()=>{i=0;return Page({kind:'practice',automaticOperations:false});};
 const walk=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(walk)]:[];
 let tree=render();assert.equal(walk(tree).find(n=>n.props.className==='paa-practice-opponent-select').props['aria-pressed'],false);
 assert.equal(walk(tree).find(n=>n.props.className==='paa-wb-complete').props.disabled,true);
 walk(tree).find(n=>n.props.className==='paa-practice-opponent-select').props.onClick();tree=render();
 const complete=walk(tree).find(n=>n.props.className==='paa-wb-complete');
 assert(walk(complete).some(n=>n.type==='svg'&&n.props.width===15));assert(complete.children.includes('一键补全'));
 const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join(' ');
 const initialMetrics=walk(tree).find(n=>n.props['aria-label']==='经验、制空与资源消耗');
 assert.match(text(initialMetrics),/旗舰经验 —/);assert.match(text(initialMetrics),/综合制空/);assert.match(text(initialMetrics),/预计消耗/);
 states[0]=[W.entry(store,1),null,null,null,null,null];tree=render();
 const noOpponentAir=walk(tree).find(n=>n.props.className==='paa-wb-metric air');
 assert.match(noOpponentAir.props['aria-label'],/综合制空 0/);assert.doesNotMatch(text(noOpponentAir),/选择对手后/);
 states[0]=Array(6).fill(null);tree=render();
 const quests=walk(tree).find(n=>n.type?.name==='QuestSection');
 assert.equal(quests.props.readOnly,undefined);assert.equal(quests.props.kind,'practice');assert.equal(typeof quests.props.onToggleQuest,'function');
 const practiceTask=quests.props.listTasks({state:store,questState:store.questState}).tasks[0];assert.equal(practiceTask.id,1);assert.equal(practiceTask.status,'unknown');assert.equal(practiceTask.supported,false);assert.equal(practiceTask.goals[0].label,'目标条件待确认');
 assert.equal(quests.props.listTasks({questState:{known:false}}).status,'unknown');
 walk(tree).find(n=>n.props.className==='paa-practice-opponent-select').props.onClick();tree=render();
 const opponentSection=walk(tree).find(n=>n.type==='section'&&walk(n).some(c=>c?.type==='h3'&&c.children.includes('演习对手')));
 assert(walk(opponentSection).some(n=>n.props['aria-label']==='对手编成'));assert.match(text(opponentSection),/Lv\.55/);
 assert(!text(tree).includes('演习记录'));
 assert(!text(tree).includes('火力'));assert(!text(tree).includes('装甲'));
 assert(!text(tree).includes('历史配装'));
 states[0]=[W.entry(store,1),null,null,null,null,null];tree=render();assert(walk(tree).some(n=>n.props['data-ship-id']===1));
 assert.match(text(tree),/参考装备主数据缺失/);
 assert(!walk(tree).some(n=>n.children.includes('应用编成')),'automation switch hides apply');
 Object.assign(store.const.$ships[1],{api_taik:[30,40],api_houg:[10,40],api_raig:[10,70],api_souk:[10,30],api_leng:1});
 store.const.$shipTypes[3]={api_equip_type:{2:1}};
 store.const.$equips[340]={api_id:340,api_name:'测试主炮',api_type:[0,0,2,2],api_houg:8,api_souk:1,api_leng:2};
 Object.assign(store.info.ships[1],{api_nowhp:30,api_maxhp:30,api_kyouka:[0,0,0,0,0],api_lucky:[20,99]});
 tree=render();assert(walk(tree).some(n=>n.props.role==='img'&&/胜|败/.test(n.props['aria-label'])));
 assert(!walk(tree).some(n=>n.props.className==='paa-practice-forecast-note'));
 assert(walk(tree).some(n=>n.props['aria-label']==='燃料 2'));assert(walk(tree).some(n=>n.props['aria-label']==='弹药 2–3'));
 assert(walk(tree).some(n=>n.props['aria-label']==='铝土 0'));assert.match(text(tree),/假设对手配装/);
 const xp=walk(tree).find(n=>n.props.className==='paa-wb-metric speed');
 assert.match(text(xp),/旗舰经验/);assert.match(xp.props['aria-label'],/旗舰/);assert.match(xp.props['data-tooltip'],/MVP/);
 assert(!walk(tree).some(n=>n.props.className==='paa-practice-experience'));
 const air=walk(tree).find(n=>n.props.className==='paa-wb-metric air');assert.match(air.props['data-tooltip'],/我方制空：.*满载/);assert.match(air.props['data-tooltip'],/敌方制空：.*假设可开发装备/);
 assert.match(air.props['data-tooltip'],/预计：/);assert.match(air.props['aria-label'],/预计/);assert.match(text(air),/预计/);assert.doesNotMatch(text(air),/参考/);
 const resources=walk(tree).find(n=>n.props.className==='paa-wb-metric los paa-practice-resources');assert.equal(resources.props['aria-label'],'预计资源消耗');
 assert.match(resources.props['data-tooltip'],/满补给、满载/);assert.match(resources.props['data-tooltip'],/假设配装/);assert.doesNotMatch(resources.props['data-tooltip'],/每架飞机|空确时/);
 const table=JSON.parse(xp.props['data-tooltip-content']);assert.deepEqual(table.sections[0].columns,['舰娘','普通','MVP']);assert(table.notes.join('').length<100);
 i=0;const running=Page({kind:'practice',automaticOperations:false,busy:true,onStop:()=>{}});
 assert(walk(running).some(n=>n.props.className==='paa-primary paa-wb-apply'&&n.children.includes('停止操作')));
});

test('opponent rows keep result alignment and distinguish known wins, losses and unknown ranks',()=>{
 const store=fixture(),states=[];let i=0;
 const ranks=[null,'S','SS','A','B','C','D','E','unrecognized'];
 store.practiceState={known:true,opponents:ranks.map((rank,index)=>({id:index+10,index:index+1,name:`对手${index+1}`,level:100,rank})),revision:1};
 store.questState={known:true,tasks:[]};
 const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),useEffect:()=>{},useRef:value=>({current:value}),
   useState(initial){const at=i++;if(!(at in states))states[at]=typeof initial==='function'?initial():initial;return [states[at],()=>{}];}};
 const Page=require('../../src/ui/practice/practice_page')(React,{getStore:()=>store,getController:()=>({preview:()=>({})})});
 const walk=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(walk)]:[];
 const tree=Page({kind:'practice',automaticOperations:false}),list=walk(tree).find(node=>node.props.className==='paa-practice-opponents');
 const buttons=walk(list).filter(node=>node.type==='button'&&node.props.className==='paa-practice-opponent-select');assert.equal(buttons.length,ranks.length);
 for(let index=0;index<ranks.length;index++){
   const rank=ranks[index],result=walk(buttons[index]).find(node=>node.props.className==='paa-practice-rank');assert(result);
   if(!rank||rank==='unrecognized'){
     assert.equal(result.props['data-outcome'],undefined);assert.equal(result.children.filter(Boolean).length,0);
     assert.doesNotMatch(buttons[index].props['aria-label'],/胜|败|未演习/);
   }else{
     const win=['SS','S','A','B'].includes(rank);
     assert.equal(result.props['data-outcome'],win?'win':'loss');
     assert.match(buttons[index].props['aria-label'],new RegExp(`${rank}${win?'胜':'败'}`));
     assert.equal(result.children[0].children[0],win?'胜利':'败北');assert.equal(result.children[1].children[0],rank);
   }
 }
});

test('opponent card places the portrait before the name, rank and signature',()=>{
 const store=fixture(),states=[];let i=0;
 store.practiceState={known:true,opponents:[{id:10,index:1,name:'甲',level:100,admiralRank:'大将',comment:'测试签名',flagship:1}],revision:1};
 store.questState={known:true,tasks:[]};
 const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),useEffect:()=>{},useRef:value=>({current:value}),
  useState(initial){const at=i++;if(!(at in states))states[at]=typeof initial==='function'?initial():initial;return [states[at],()=>{}];}};
 const Page=require('../../src/ui/practice/practice_page')(React,{getStore:()=>store,getController:()=>({preview:()=>({})})});
 const walk=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(walk)]:[];
 const button=walk(Page({kind:'practice',automaticOperations:false})).find(node=>node.props.className==='paa-practice-opponent-select');
 assert.deepEqual(button.children.slice(0,2).map(node=>node.props.className),['paa-practice-opponent-portrait','paa-practice-opponent-body']);
 const body=button.children[1];assert.equal(body.children[0].children[1].children[0],'大将');assert.equal(body.children[1].children[0],'测试签名');
 assert.match(button.props['aria-label'],/大将.*测试签名/);
});

test('practice preserves restored formation until an observed opponent list actually changes',()=>{
 const store=fixture(),refs=[],calls=[];let stateIndex=0,refIndex=0,effects=[];
 store.practiceState={known:false,opponents:[],revision:1};store.questState={known:true,tasks:[]};
 const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),
  useState(initial){const at=stateIndex++;return [at===2?10:typeof initial==='function'?initial():initial,value=>calls.push([at,value])];},
  useRef(value){const at=refIndex++;return refs[at]||(refs[at]={current:value});},useEffect(fn){effects.push(fn);}};
 const Page=require('../../src/ui/practice/practice_page')(React,{getStore:()=>store,getController:()=>({preview:()=>({})})});
 const update=()=>{stateIndex=0;refIndex=0;effects=[];Page({kind:'practice',hidden:true});const effect=effects.find(fn=>String(fn).includes('lastOpponentList.current'));assert(effect);effect();};
 update();store.practiceState={known:true,opponents:[{id:10}],revision:2};update();assert.deepEqual(calls,[]);
 store.practiceState={known:true,opponents:[{id:20}],revision:3};update();assert.deepEqual(calls,[[16,{}],[17,'auto'],[0,Array(6).fill(null)],[4,null],[8,'']]);
});

test('selecting another practice opponent keeps the connected panel open and updates it immediately',()=>{
 const store=fixture(),states=[],refs=[];let i=0,r=0;
 store.practiceState={known:true,opponents:[
   {id:10,index:1,name:'甲',level:100,ships:[{masterId:1,level:55}]},
   {id:20,index:2,name:'乙',level:90,ships:null}
 ],revision:1};
 store.questState={known:true,tasks:[]};
 const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),useEffect:()=>{},useRef(value){const at=r++;return refs[at]||(refs[at]={current:value});},
   useState(initial){const at=i++;if(!(at in states))states[at]=typeof initial==='function'?initial():initial;return [states[at],value=>{states[at]=typeof value==='function'?value(states[at]):value;}];}};
 const Page=require('../../src/ui/practice/practice_page')(React,{getStore:()=>store,getController:()=>({preview:()=>({})})});
 const walk=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(walk)]:[];
 const render=()=>{i=0;r=0;return Page({kind:'practice',automaticOperations:false});};
 const items=tree=>walk(tree).filter(node=>node.props.className==='paa-practice-opponent-item');
 const toggle=item=>walk(item).find(node=>node.props.className==='paa-practice-opponent-toggle');
 const select=item=>walk(item).find(node=>node.props.className==='paa-practice-opponent-select');
 const expanded=item=>select(item).props['aria-pressed']?select(item).props['aria-expanded']:toggle(item).props['aria-expanded'];
 const panel=tree=>walk(tree).find(node=>node.props.className==='paa-practice-enemy-detail');
 let tree=render(),rows=items(tree);
 assert.equal(rows.length,2);assert.equal(expanded(rows[0]),false);assert.equal(expanded(rows[1]),false);
 assert(toggle(rows[0]),'unselected opponents retain their fleet count button');
 assert.equal(walk(toggle(rows[1])).find(node=>node.props.className==='paa-practice-opponent-count').children[0],'—');
 assert.match(toggle(rows[1]).props['aria-label'],/舰船数量待同步/);
 assert.equal(panel(tree).props['aria-hidden'],true);assert.equal(panel(tree).props.inert,'');
 rows[0].props.onClick();tree=render();rows=items(tree);
 assert.equal(expanded(rows[0]),true);assert.equal(expanded(rows[1]),false);
 assert.equal(select(rows[0]).props['aria-pressed'],true);assert.equal(select(rows[1]).props['aria-pressed'],false);
 assert.equal(panel(tree).props['aria-hidden'],false);assert(walk(panel(tree)).some(node=>node.props['aria-label']==='对手编成'));
 assert(walk(panel(tree)).some(node=>node.type==='small'&&node.children.includes('轻巡 · Lv.55')));
 rows[1].props.onClick();tree=render();rows=items(tree);
 assert.equal(select(rows[1]).props['aria-pressed'],true,'the selection changes immediately');
 assert.equal(panel(tree).props['data-open'],true,'the frame stays open without a fading phase');
 assert.equal(expanded(rows[0]),false);assert.equal(expanded(rows[1]),true);
 assert(walk(panel(tree)).some(node=>node.children?.includes('对手舰队资料待同步。')));
 select(rows[1]).props.onClick();tree=render();rows=items(tree);
 assert.equal(select(rows[1]).props['aria-pressed'],true);assert.equal(expanded(rows[1]),true);
 toggle(rows[0]).props.onClick();tree=render();rows=items(tree);
 assert.equal(panel(tree).props['data-open'],true);
 assert.equal(expanded(rows[0]),true);assert.equal(expanded(rows[1]),false);
 assert.equal(select(rows[0]).props['aria-pressed'],true);
 rows[1].props.onClick();tree=render();rows=items(tree);assert.equal(select(rows[1]).props['aria-pressed'],true);
 assert.equal(expanded(rows[0]),false,'selecting a closed opponent also collapses the previous lineup');
 assert.equal(expanded(rows[1]),true,'selecting an opponent opens its lineup');
 assert.equal(toggle(rows[1]),undefined,'selected opponent is connected directly to the detail panel');
 rows[0].props.onClick();tree=render();rows=items(tree);
 assert.equal(panel(tree).props['data-open'],true,'rapid switches keep the panel open');
 rows[1].props.onClick();tree=render();rows=items(tree);
 assert.equal(select(rows[1]).props['aria-pressed'],true,'a newer choice cancels the previous transition');
 rows[0].props.onClick();tree=render();rows=items(tree);
 states[0]=[{id:1,slots:[-1,-1],ex:-1},null,null,null,null,null];tree=render();
 const clear=walk(tree).find(node=>node.props['aria-label']==='取消选择演习对手');clear.props.onClick();tree=render();rows=items(tree);
 assert(rows.every(row=>select(row).props['aria-pressed']===false),'all opponents remain unselected');
 assert.equal(panel(tree).props['aria-hidden'],true);assert.equal(states[0][0].id,1,'clearing selection preserves the fleet draft');
 assert.equal(walk(tree).find(node=>node.props['aria-label']==='取消选择演习对手').props.disabled,true);
 assert.equal(walk(tree).find(node=>node.props.className==='paa-wb-complete').props.disabled,true,'clearing the opponent disables completion');
 rows[1].props.onClick();tree=render();rows=items(tree);
 assert.equal(expanded(rows[1]),true);assert.deepEqual(states[0],Array(6).fill(null),'selecting a new opponent clears the old draft');
 i=0;r=0;const busy=Page({kind:'practice',automaticOperations:false,busy:true});const busyRows=items(busy);busyRows[0].props.onClick();tree=render();rows=items(tree);
 assert.equal(select(rows[1]).props['aria-pressed'],true,'disabled cards do not change selection');
});

test('practice training targets can be searched and selected without altering the draft',async()=>{
 const store=fixture(),states=[],requests=[],estimates=[];let i=0;
 store.practiceState={known:true,opponents:[
   {id:10,index:1,name:'甲',level:100,ships:[{masterId:1,level:55}]},
   {id:20,index:2,name:'乙',level:90,ships:[{masterId:1,level:50}]}
 ],revision:1};store.questState={known:true,tasks:[]};
 store.const.$ships[1].api_aftershipid='2';store.const.$ships[1].api_afterlv=60;
 store.const.$ships[2].api_aftershipid='0';
 store.const.$ships[3].api_aftershipid='4';store.const.$ships[3].api_afterlv=40;
 const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),useEffect:()=>{},useRef:value=>({current:value}),
   useState(initial){const at=i++;if(!(at in states))states[at]=typeof initial==='function'?initial():initial;return [states[at],value=>{states[at]=typeof value==='function'?value(states[at]):value;}];}};
 const ship=W.entry(store,1),service={preview:()=>({}),createSnapshot:()=>({snapshotId:'test'}),recommendPracticeFleet:async args=>{requests.push(args);return {scheme:{ships:[ship]},enemyKnown:true};}};
  const renderTraining=require('../helpers/training_picker_react')(React);
 const forecast=require('../../src/domain/combat/practice_forecast'),originalRecommend=forecast.recommendFormation,originalEstimate=forecast.estimate;
 forecast.recommendFormation=(s,scheme,enemy)=>enemy.known?'lineAbreast':null;
 forecast.estimate=(s,scheme,enemy,options)=>{estimates.push(options);return {status:'unknown',reason:'测试预测'};};
 try{
   const Page=require('../../src/ui/practice/practice_page')(React,{getStore:()=>store,getController:()=>service});
   const walk=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(walk)]:[];
   const render=()=>{i=0;return renderTraining(()=>Page({kind:'practice',automaticOperations:false}));};
   const trigger=tree=>walk(tree).find(n=>n.props.className==='paa-practice-training-trigger');
   const option=(tree,id)=>walk(tree).find(n=>n.type==='label'&&n.props.key===id);
   const opponents=tree=>walk(tree).filter(n=>n.type==='button'&&n.props.className==='paa-practice-opponent-select');
   let tree=render();
   opponents(tree)[0].props.onClick();tree=render();
   assert(!walk(tree).some(n=>['演习目标','演习阵形','舰队规模'].includes(n.props['aria-label'])));
   states[0]=[{...ship,pin:true},null,null,null,null,null];
   trigger(tree).props.onClick();tree=render();
   walk(tree).find(n=>n.type==='input'&&n.props['aria-label']==='已锁定').props.onChange({target:{checked:false}});tree=render();
   const text=node=>walk(node).flatMap(n=>n.children||[]).filter(x=>typeof x==='string').join(' ');
   assert.match(text(option(tree,1)),/下一改造 Lv\.60/);assert.doesNotMatch(text(option(tree,1)),/已达/);
   assert.match(text(option(tree,2)),/无后续改造/);assert.match(text(option(tree,3)),/下一改造 Lv\.40（已达）/);assert.match(text(option(tree,4)),/改造等级待确认/);
   walk(option(tree,2)).find(n=>n.type==='input').props.onChange();tree=render();
   assert.equal(walk(option(tree,2)).find(n=>n.type==='input').props.checked,true);
   assert.match(text(trigger(tree)),/测试舰2/);assert.equal(states[0][0].id,ship.id);assert.equal(requests.length,0);
   states[0][1]={...W.entry(store,8),keep:{0:true}};tree=render();
   for(const id of [3,4,5]){walk(option(tree,id)).find(n=>n.type==='input').props.onChange();tree=render();}
   assert.equal(walk(option(tree,7)).find(n=>n.type==='input').props.disabled,true,'固定舰与目标共六舰时不能再选');
   assert.equal(walk(option(tree,1)).find(n=>n.type==='input').props.disabled,false,'已固定舰可同时设为练级目标');
   assert.equal(walk(option(tree,8)).find(n=>n.type==='input').props.disabled,false,'手动固定装备的舰可同时设为练级目标');
   walk(option(tree,1)).find(n=>n.type==='input').props.onChange();tree=render();
   walk(option(tree,8)).find(n=>n.type==='input').props.onChange();tree=render();
   assert.equal(walk(trigger(tree)).filter(n=>n.props.className==='paa-practice-training-portrait').length,6);
   assert.match(trigger(tree).props['aria-label'],/测试舰1/);
   for(const id of [1,2,3,4,5,8]){walk(option(tree,id)).find(n=>n.type==='input').props.onChange();tree=render();}
   assert(walk(tree).some(n=>n.props.className==='paa-practice-training-panel'),'取消选择后面板保持打开');
   assert.match(trigger(tree).props['aria-label'],/无特别指定/);assert.equal(states[0][0].id,ship.id);
   for(const id of [2,3,4,5]){walk(option(tree,id)).find(n=>n.type==='input').props.onChange();tree=render();}
   for(const id of [3,4,5]){walk(option(tree,id)).find(n=>n.type==='input').props.onChange();tree=render();}
   states[0][1]=null;tree=render();
   const search=walk(tree).find(n=>n.props['aria-label']==='搜索舰娘');search.props.onChange({target:{value:'测试舰3'}});tree=render();
   assert(option(tree,3));assert(!option(tree,2));
   await walk(tree).find(n=>n.props.className==='paa-wb-complete').props.onClick();
   tree=render();assert.deepEqual(requests[0].trainingShipIds,[2]);
   assert.equal(requests[0].capacity,6);assert.equal(requests[0].slots[0].id,1);
   opponents(tree)[0].props.onClick();tree=render();
   await walk(tree).find(n=>n.props.className==='paa-wb-complete').props.onClick();tree=render();
   assert.equal(estimates.at(-1).ownFormation,'lineAbreast');
   opponents(tree)[0].props.onClick();tree=render();assert.equal(states[0][0].id,1,'重复选择当前对手保留草稿');
   opponents(tree)[1].props.onClick();tree=render();assert.equal(states[17],'auto');
   assert.deepEqual(states[0],Array(6).fill(null),'切换对手清空舰队草稿');
   assert.match(text(trigger(tree)),/测试舰2/,'切换对手保留练级目标');
 }finally{forecast.recommendFormation=originalRecommend;forecast.estimate=originalEstimate;}
});

test('training picker shares hover guard and filters and sorts the full roster without changing selections',()=>{
 const store=fixture(),states=[];let i=0;store.practiceState={known:true,opponents:[],revision:1};store.questState={known:true,tasks:[]};
 store.info.ships={1:store.info.ships[1],2:store.info.ships[2]};store.info.ships[1].api_lv=1;store.info.ships[2].api_lv=90;store.info.fleets[0].api_ship=[1,2,-1,-1,-1,-1];
 store.const.$ships[2].api_name='翔鶴';store.info.ships[1].api_locked=1;store.info.ships[2].api_locked=0;
 const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),useEffect:()=>{},useRef:value=>({current:value}),
   useState(initial){const at=i++;if(!(at in states))states[at]=typeof initial==='function'?initial():initial;return [states[at],value=>{states[at]=typeof value==='function'?value(states[at]):value;}];}};
 const renderTraining=require('../helpers/training_picker_react')(React);
 const Page=require('../../src/ui/practice/practice_page')(React,{getStore:()=>store,getController:()=>({preview:()=>({})})});
 const walk=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(walk)]:[];
 const render=()=>{i=0;return renderTraining(()=>Page({kind:'practice',automaticOperations:false}));};
 let tree=render(),anchor=walk(tree).find(n=>n.props.className==='paa-practice-training');
 assert.equal(typeof anchor.props.onPointerEnter,'function');assert.equal(typeof anchor.props.onPointerLeave,'function');assert.equal(typeof anchor.props.onClickCapture,'function');
 walk(tree).find(n=>n.props.className==='paa-practice-training-trigger').props.onClick();tree=render();
 const options=()=>walk(tree).filter(n=>n.type==='label'&&n.props.className==='paa-practice-training-option');
 const filter=(label,checked)=>{walk(tree).find(n=>n.type==='input'&&n.props['aria-label']===label).props.onChange({target:{checked}});tree=render();};
 assert.equal(walk(tree).find(n=>n.type==='input'&&n.props['aria-label']==='已锁定').props.checked,true);
 assert.deepEqual(options().map(n=>n.props.key),[1]);
 filter('已锁定',false);walk(options()[1]).find(n=>n.type==='input').props.onChange();tree=render();
 filter('已锁定',true);assert.deepEqual(options().map(n=>n.props.key),[1]);
 assert(walk(tree).some(n=>n.props.className==='paa-practice-training-portrait'),'a filtered-out training target remains selected');
 filter('已锁定',false);assert.deepEqual(options().map(n=>n.props.key),[1,2]);
 assert.equal(walk(options()[1]).find(n=>n.type==='input').props.checked,true);walk(options()[1]).find(n=>n.type==='input').props.onChange();tree=render();
 assert(options().every(option=>walk(option).every(n=>!n.props['data-tooltip']&&!n.props.title)));
 assert.deepEqual(options().map(n=>n.props.key),[1,2],'default sort is level ascending');
 assert(!walk(tree).some(n=>n.props['aria-label']==='舰队筛选'),'only ship type is a primary filter');
 assert(options().every(option=>walk(option).some(n=>n.props.className==='paa-wb-portrait')),'list displays ship portraits');
 assert.deepEqual(options().map(option=>walk(option).find(n=>n.props.className==='paa-practice-training-lock')?.props['aria-label']),['已锁定',undefined]);
 filter('已锁定',true);
 assert.deepEqual(options().map(n=>n.props.key),[1]);
 filter('已锁定',false);
 let types=walk(tree).find(n=>n.props['aria-label']==='舰种筛选');walk(types).find(n=>n.type==='button'&&n.children.includes('驱逐／海防')).props.onClick();tree=render();
 assert.deepEqual(options().map(n=>n.props.key),[2]);
 walk(tree).find(n=>n.props['aria-label']==='排序方式').props.onChange({target:{value:'level-desc'}});tree=render();
 types=walk(tree).find(n=>n.props['aria-label']==='舰种筛选');walk(types).find(n=>n.type==='button'&&n.children.includes('全部')).props.onClick();tree=render();
 assert.deepEqual(options().map(n=>n.props.key),[2,1],'manual sorting remains available');
 walk(tree).find(n=>n.props['aria-label']==='搜索舰娘').props.onChange({target:{value:'翔鹤'}});tree=render();
 assert.deepEqual(options().map(n=>n.props.key),[2],'search accepts simplified and original names');
 assert(options().every(n=>walk(n).some(x=>x.type==='input'&&x.props.type==='checkbox')));
 assert.match(walk(tree).find(n=>n.props.className==='paa-practice-training-trigger').props['aria-label'],/无特别指定/);
 walk(options()[0]).find(n=>n.type==='input').props.onChange();tree=render();
 let stopped=false;walk(tree).find(n=>n.props['aria-label']==='移除翔鶴').props.onClick({stopPropagation(){stopped=true;}});tree=render();
 assert(stopped);assert.match(walk(tree).find(n=>n.props.className==='paa-practice-training-trigger').props['aria-label'],/无特别指定/);
 assert(walk(tree).some(n=>n.props.className==='paa-practice-training-panel'),'removing a portrait does not toggle the picker');
});

test('training picker renders a bounded window and resets it when reopened by click or hover',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const store=fixture(),states=[];let i=0;store.practiceState={known:true,opponents:[],revision:1};store.questState={known:true,tasks:[]};
 const template=store.info.ships[1];store.info.ships={};for(let id=1;id<=100;id++)store.info.ships[id]={...template,api_id:id,api_lv:id,api_locked:id%2};
 const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),useEffect:()=>{},useRef:value=>({current:value}),
   useState(initial){const at=i++;if(!(at in states))states[at]=typeof initial==='function'?initial():initial;return [states[at],value=>{states[at]=typeof value==='function'?value(states[at]):value;}];}};
 const renderTraining=require('../helpers/training_picker_react')(React);
 const Page=require('../../src/ui/practice/practice_page')(React,{getStore:()=>store,getController:()=>({preview:()=>({})})});
 const walk=n=>n&&typeof n==='object'?[n,...(n.children||[]).flatMap(walk)]:[],render=()=>{i=0;return renderTraining(()=>Page({kind:'practice'}));};
 let tree=render();walk(tree).find(n=>n.props.className==='paa-practice-training-trigger').props.onClick();tree=render();
 walk(tree).find(n=>n.type==='input'&&n.props['aria-label']==='已锁定').props.onChange({target:{checked:false}});tree=render();
 let list=walk(tree).find(n=>n.props.className==='paa-practice-training-list'),options=()=>walk(tree).filter(n=>n.props.className==='paa-practice-training-option');
 assert.equal(options().length,16);assert.equal(options()[0].props['data-index'],0);
 assert.equal(walk(tree).find(n=>n.props.className==='paa-practice-training-window').props.style.height,5300);
 list.props.onScroll({currentTarget:{scrollTop:53*90}});tree=render();
 assert(options().length<=16);assert(options().some(n=>n.props['data-index']===90));
 walk(tree).find(n=>n.props.className==='paa-practice-training-trigger').props.onClick();tree=render();
 assert(!walk(tree).some(n=>n.props.className==='paa-practice-training-list'));
 walk(tree).find(n=>n.props.className==='paa-practice-training-trigger').props.onClick();tree=render();
 assert.equal(options()[0].props['data-index'],0,'a remounted list starts at scrollTop 0 and must render its first rows');
 list=walk(tree).find(n=>n.props.className==='paa-practice-training-list');
 list.props.onScroll({currentTarget:{scrollTop:53*70}});tree=render();
 walk(tree).find(n=>n.props.className==='paa-practice-training-trigger').props.onClick();tree=render();
 walk(tree).find(n=>n.props.className==='paa-practice-training').props.onPointerEnter({pointerType:'mouse'});
 t.mock.timers.tick(500);tree=render();
 assert.equal(options()[0].props['data-index'],0,'hover opening also resets the virtual window before rendering');
 assert.equal(options().length,16);
 list=walk(tree).find(n=>n.props.className==='paa-practice-training-list');list.props.onScroll({currentTarget:{scrollTop:0}});tree=render();
 walk(tree).find(n=>n.type==='input'&&n.props['aria-label']==='已锁定').props.onChange({target:{checked:true}});tree=render();
 assert.equal(walk(tree).find(n=>n.props.className==='paa-practice-training-window').props.style.height,2650);
 assert(options().every(n=>n.props.key%2===1));
});

test('training picker waits for label focus before dismissing on blur',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const store=fixture(),states=[];let i=0;store.practiceState={known:true,opponents:[],revision:1};
 const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),useEffect:()=>{},useRef:value=>({current:value}),
  useState(initial){const at=i++;if(!(at in states))states[at]=typeof initial==='function'?initial():initial;return [states[at],value=>{states[at]=typeof value==='function'?value(states[at]):value;}];}};
 const Page=require('../../src/ui/practice/practice_page')(React,{getStore:()=>store,getController:()=>({preview:()=>({})})});
 const walk=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(walk)]:[];
 const render=()=>{i=0;return Page({kind:'practice',automaticOperations:false});};
 let tree=render();walk(tree).find(n=>n.props.className==='paa-practice-training-trigger').props.onClick();tree=render();
 const anchor=walk(tree).find(n=>n.props.className==='paa-practice-training'), checkbox={},outside={},doc={activeElement:outside};
 const element={isConnected:true,ownerDocument:doc,contains:x=>x===checkbox};
 anchor.props.onBlur({currentTarget:element,relatedTarget:null});doc.activeElement=checkbox;t.mock.timers.tick(0);tree=render();
 assert(walk(tree).some(n=>n.props.className==='paa-practice-training-panel'),'label click keeps panel open');
 anchor.props.onBlur({currentTarget:element,relatedTarget:null});doc.activeElement=outside;t.mock.timers.tick(0);tree=render();
 assert(!walk(tree).some(n=>n.props.className==='paa-practice-training-panel'),'focus leaving closes panel');
});

test('practice quest preselection is passed into completion and unavailable task data is rejected',async()=>{
 const store=fixture(),states=[],requests=[];let i=0;store.practiceState={known:true,opponents:[{id:10,index:1,name:'对手',ships:[{masterId:1,level:10}]}],revision:1};
 store.questState={known:true,complete:false,tasks:[{api_no:368,api_category:3,api_state:2,api_title:'「十六駆」演習！'}]};
 const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),useEffect:()=>{},useRef:value=>({current:value}),
  useState(initial){const at=i++;if(!(at in states))states[at]=typeof initial==='function'?initial():initial;return [states[at],value=>{states[at]=typeof value==='function'?value(states[at]):value;}];}};
 const service={preview:()=>({}),createSnapshot:()=>({snapshotId:'test'}),recommendPracticeFleet:async args=>{requests.push(args);return {scheme:{ships:[W.entry(store,1)]},enemyKnown:true};}};
 const Page=require('../../src/ui/practice/practice_page')(React,{getStore:()=>store,getController:()=>service});
 const walk=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(walk)]:[],render=()=>{i=0;return Page({kind:'practice',automaticOperations:false});};
 let tree=render();walk(tree).find(n=>n.props.className==='paa-practice-opponent-select').props.onClick();tree=render();
 let section=walk(tree).find(n=>n.type?.name==='QuestSection');section.props.onToggleQuest('P368');tree=render();
 section=walk(tree).find(n=>n.type?.name==='QuestSection');assert.deepEqual(section.props.selectedQuests,['P368']);
 await walk(tree).find(n=>n.props.className==='paa-wb-complete').props.onClick();assert.deepEqual(requests[0].questCodes,['P368']);
 store.questState={known:true,complete:false,tasks:[],claimedTaskIds:[368]};tree=render();
 await walk(tree).find(n=>n.props.className==='paa-wb-complete').props.onClick();
 assert.equal(requests.length,2);assert.equal(requests[1].questCodes,undefined);
 tree=render();assert.deepEqual(walk(tree).find(n=>n.type?.name==='QuestSection').props.selectedQuests,[]);
 walk(tree).find(n=>n.type?.name==='QuestSection').props.onToggleQuest('P368');
 store.questState={known:true,complete:false,tasks:store.questState.tasks};tree=render();await walk(tree).find(n=>n.props.className==='paa-wb-complete').props.onClick();assert.equal(requests.length,2);
});

test('a quest claimed during practice calculation does not apply a stale result or show an error',async()=>{
 const store=fixture(),states=[],refs=[];let i=0,j=0,finish,started;
 store.practiceState={known:true,opponents:[{id:10,index:1,name:'对手',ships:[{masterId:1,level:10}]}],revision:1};
 store.questState={known:true,complete:true,tasks:[{api_no:368,api_category:3,api_state:2,api_title:'「十六駆」演習！'}]};
 const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),useEffect:()=>{},
  useRef(value){const at=j++;return refs[at]||(refs[at]={current:value});},
  useState(value){const at=i++;if(!(at in states))states[at]=typeof value==='function'?value():value;
   return [states[at],next=>{states[at]=typeof next==='function'?next(states[at]):next;}];}};
 const ready=new Promise(resolve=>{started=resolve;}),service={preview:()=>({}),createSnapshot:()=>({snapshotId:'test'}),
  recommendPracticeFleet:()=>{started();return new Promise(resolve=>{finish=resolve;});}};
 const Page=require('../../src/ui/practice/practice_page')(React,{getStore:()=>store,getController:()=>service});
 const walk=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(walk)]:[],render=()=>{i=0;j=0;return Page({kind:'practice'});};
 let tree=render();walk(tree).find(n=>n.props.className==='paa-practice-opponent-select').props.onClick();tree=render();
 walk(tree).find(n=>n.type?.name==='QuestSection').props.onToggleQuest('P368');tree=render();
 const pending=walk(tree).find(n=>n.props.className==='paa-wb-complete').props.onClick();await ready;
 store.questState={known:true,complete:false,tasks:[],claimedTaskIds:[368]};
 finish({scheme:{ships:[W.entry(store,1)]},enemyKnown:true});await pending;tree=render();
 assert.deepEqual(walk(tree).find(n=>n.type?.name==='QuestSection').props.selectedQuests,[]);
 assert(!walk(tree).some(n=>n.props.className==='paa-fleet-warning'));
 assert(states[0].every(ship=>ship===null),'do not apply a plan made for the old task');
});
