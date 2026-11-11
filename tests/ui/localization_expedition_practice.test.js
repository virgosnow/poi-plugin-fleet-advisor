'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const i18n=require('../../src/shared/i18n');
const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),Fragment:'fragment'};
const nodes=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(nodes)]:[];
const text=node=>typeof node==='string'||typeof node==='number'?String(node):(node?.children||[]).map(text).join(' ');
const view=require('../../src/ui/expedition/expedition_view')(React);

test('expedition locale changes preserve conditions, probabilities, duration and game names',()=>{
  try{
    const args={mission:null,master:{api_time:95,api_win_item1:[999,1]},useItems:{999:{api_name:'特製「試験」装備'}},
      expedition:{eligible:false,checks:[{type:'shipCount',left:3,right:6,sat:false}]},rate:35,income:null,hasShips:true};
    const render=locale=>{i18n.setLocale(locale);return view.overview(args);};
    const zh=render('zh-CN'),ja=render('ja-JP'),tw=render('zh-TW');
    assert.match(text(zh),/出航条件/);assert.match(text(ja),/出発条件/);assert.match(text(tw),/出航條件/);
    assert.match(text(ja),/1時間35分/);assert.match(text(tw),/1小時35分/);
    for(const tree of [zh,ja,tw]){
      assert.match(text(tree),/3 \/ 6/);assert.match(text(tree),/35%/);assert.match(text(tree),/65%/);
      assert.match(text(tree),/特製「試験」装備/);
      assert.equal(nodes(tree).find(n=>n.props['data-type']==='shipCount').props['data-satisfied'],false);
    }
  }finally{i18n.setLocale('zh-CN');}
});

test('practice labels change locale without changing opponent selection and rank',()=>{
  const store=require('../helpers/workbench_fixture')();
  store.practiceState={known:true,opponents:[{id:10,index:1,name:'Admiral X',ships:[{masterId:1,level:55}],rank:'S'}],revision:1};
  const states=[],refs=[];let i=0,j=0;
  const R={...React,useEffect:()=>{},useState(initial){const k=i++;if(!(k in states))states[k]=typeof initial==='function'?initial():initial;return [states[k],v=>{states[k]=typeof v==='function'?v(states[k]):v;}];},
    useRef(initial){const k=j++;return refs[k]||(refs[k]={current:initial});}};
  const Page=require('../../src/ui/practice/practice_page')(R,{getStore:()=>store,getController:()=>({preview:()=>({})})});
  const render=()=>{i=0;j=0;return Page({kind:'practice',automaticOperations:false});};
  try{
    i18n.setLocale('zh-CN');let tree=render();nodes(tree).find(n=>n.props.className==='paa-practice-opponent-select').props.onClick();tree=render();
    assert.equal(nodes(tree).find(n=>n.props.className==='paa-practice-opponent-select').props['aria-pressed'],true);
    i18n.setLocale('ja-JP');tree=render();assert.match(text(tree),/演習相手/);assert.match(text(tree),/Admiral X/);
    assert.equal(nodes(tree).find(n=>n.props.className==='paa-practice-opponent-select').props['aria-pressed'],true);
    i18n.setLocale('zh-TW');tree=render();assert.match(text(tree),/演習對手/);assert.match(text(tree),/Admiral X/);
    assert.equal(nodes(tree).find(n=>n.props.className==='paa-practice-opponent-select').props['aria-pressed'],true);
  }finally{i18n.setLocale('zh-CN');}
});

test('fleet-type departure conditions translate from stable type ids without altering evaluation',()=>{
  const checks=[{type:'fleetCompo',sat:false,detail:[{parts:[{estype:'CL',actual:1,need:2},{estype:'DD',actual:2,need:3}]}]}];
  const args={mission:null,master:{api_time:60},expedition:{eligible:false,checks},income:null,hasShips:true};
  try{
    i18n.setLocale('zh-CN');const zh=text(view.overview(args));
    i18n.setLocale('ja-JP');const ja=text(view.overview(args));
    i18n.setLocale('zh-TW');const tw=text(view.overview(args));
    assert.match(zh,/轻巡 1 \/ 2/);assert.match(ja,/軽巡 1 \/ 2/);assert.match(tw,/輕巡 1 \/ 2/);
    assert.match(ja,/駆逐艦 2 \/ 3/);assert.equal(checks[0].sat,false);assert.equal(checks[0].detail[0].parts[0].estype,'CL');
  }finally{i18n.setLocale('zh-CN');}
});

test('expedition prerequisites render translated labels while preserving original quest name',()=>{
  const args={mission:{missionId:1},master:{api_time:15},missionMasters:{},missionProgress:{},fleets:[],useItems:{},rate:null,income:null,hasShips:false};
  try{
    i18n.setLocale('ja-JP');const ja=text(view.overview(args));assert.match(ja,/前提/);assert.match(ja,/任務 A4/);assert.match(ja,/6隻編成の艦隊を編成せよ/);
    i18n.setLocale('zh-TW');const tw=text(view.overview(args));assert.match(tw,/完成任務 A4/);assert.match(tw,/6隻編成の艦隊を編成せよ/);
  }finally{i18n.setLocale('zh-CN');}
});

test('game-provided reward names are preserved even when identical to resource labels',()=>{
  const args={mission:null,master:{api_time:30,api_win_item1:[999,1]},useItems:{999:{api_name:'弹药'}},rate:0,income:null,hasShips:false};
  try{
    i18n.setLocale('ja-JP');const tree=view.overview(args),item=nodes(tree).find(n=>n.props.className==='paa-exp-income-row paa-exp-item-row');
    assert(item);assert.match(text(item),/弹药/);assert.doesNotMatch(text(item),/弾薬/);
  }finally{i18n.setLocale('zh-CN');}
});

test('unknown game ship type and game name are not translated even if they match plugin vocabulary',()=>{
  const store=require('../helpers/workbench_fixture')();
  store.const.$ships[1].api_name='舰娘';store.const.$ships[1].api_stype=99;store.const.$shipTypes[99]={api_name:'驱逐'};
  store.practiceState={known:true,opponents:[{id:10,index:1,name:'Player',ships:[{masterId:1,level:55}]}],revision:1};
  const states=[],refs=[];let i=0,j=0;
  const R={...React,useEffect:()=>{},useState(initial){const k=i++;if(!(k in states))states[k]=typeof initial==='function'?initial():initial;return [states[k],v=>{states[k]=typeof v==='function'?v(states[k]):v;}];},
    useRef(initial){const k=j++;return refs[k]||(refs[k]={current:initial});}};
  const Page=require('../../src/ui/practice/practice_page')(R,{getStore:()=>store,getController:()=>({preview:()=>({})})});
  const render=()=>{i=0;j=0;return Page({kind:'practice',automaticOperations:false});};
  try{
    i18n.setLocale('ja-JP');let tree=render();nodes(tree).find(n=>n.props.className==='paa-practice-opponent-select').props.onClick();tree=render();
    const enemy=nodes(tree).find(n=>n.props.className==='paa-practice-enemy-ship');assert(enemy);
    assert.match(text(enemy),/舰娘/);assert.match(text(enemy),/驱逐/);assert.doesNotMatch(text(enemy),/駆逐艦/);
  }finally{i18n.setLocale('zh-CN');}
});
