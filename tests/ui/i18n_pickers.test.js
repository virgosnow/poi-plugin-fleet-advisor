'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const i18n=require('../../src/shared/i18n');
const createShipPicker=require('../../src/ui/components/ship_picker');
const createEquipmentPicker=require('../../src/ui/components/equipment_picker');
const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()})};
const walk=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(walk)]:[];
const text=node=>walk(node).flatMap(n=>n.children.filter(c=>typeof c==='string'));
test('picker locale changes only displayed strings, not identities or selection constraints',()=>{
 const shipPicker=createShipPicker(React),equipmentPicker=createEquipmentPicker(React);
 const store={info:{ships:{1:{api_ship_id:9,api_lv:42,api_cond:49,api_nowhp:8,api_maxhp:20}},equips:{}},const:{$ships:{9:{api_aftershipid:'10',api_afterlv:50}},$equips:{}}};
 const row={id:1,name:'日向改二',type:'驱逐',level:42,fleet:1};
 try{
  i18n.setLocale('ja-JP');
  const a=shipPicker({index:0,rows:[row],store,kind:'normal'}),nodes=walk(a);
  assert(nodes.some(n=>n.props['aria-label']==='艦娘を変更'));assert(text(a).includes('日向改二'));
  assert(nodes.some(n=>n.props['data-ship-index']===0&&n.props.key===1));
  assert(text(a).some(s=>s.includes('中破')));
  const b=equipmentPicker({index:0,slot:0,rows:[],store});assert(walk(b).some(n=>n.props['aria-label']==='装備を変更'));
  i18n.setLocale('zh-TW');const c=shipPicker({index:0,rows:[row],store,kind:'normal'});
  assert(walk(c).some(n=>n.props['aria-label']==='更換艦娘'));assert(text(c).includes('日向改二'));
  assert.deepEqual(createShipPicker.matchesLock(store,1,'all'),true);
 }finally{i18n.setLocale('zh-CN');}
});
test('map picker preserves game map names and mission resource search across locales',()=>{
 const picker=require('../../src/ui/components/area_picker');
 const Stub={...React,useState:initial=>[typeof initial==='function'?initial():initial,()=>{}],useRef:initial=>({current:initial}),useEffect:()=>{}};
 const maps=[{area:'1-1',name:'鎮守府正面海域'}],missions=[{missionId:1,world:1}];
 try{
  i18n.setLocale('ja-JP');const component=picker(Stub),tree=component({maps,value:'1-1',onChange(){}});
  assert(walk(tree).some(n=>n.props['aria-label']==='海域'));assert(text(tree).includes('鎮守府正面海域'));
  const summary=()=>({number:'01',name:'練習航海',time:'15分',rewards:[{name:'弹药'}]});
  assert.deepEqual(picker.filterMissions(missions,summary,{query:'弾薬'}),missions);
  i18n.setLocale('zh-TW');assert.deepEqual(picker.filterMissions(missions,summary,{query:'彈藥'}),missions);
 }finally{i18n.setLocale('zh-CN');}
});
test('execution progress localizes stable phase while preserving original identity and details',()=>{
 const display=require('../../src/ui/i18n/execution');const state={info:{ships:{8:{api_ship_id:9,api_lv:42}}},const:{$ships:{9:{api_name:'大和改二'}}}};
 try{
  i18n.setLocale('ja-JP');assert.equal(display.progress({phase:'organized',slot:1,ship:8},state),'1番艦 · 大和改二 · Lv.42を編成済み');
  assert.equal(display.progress({phase:'equipment',detail:'original game detail'},state),'original game detail');
  i18n.setLocale('zh-TW');assert.equal(display.progress({phase:'organized',slot:1,ship:8},state),'第 1 位 · 已編入 大和改二 · Lv.42');
 }finally{i18n.setLocale('zh-CN');}
});
test('unknown game reward names remain original even if they equal a resource label',()=>{
 const create=require('../../src/ui/components/area_picker');let index=0,tree;const states=[];
 const Fake={...React,useState(initial){const n=index++;if(!(n in states))states[n]=typeof initial==='function'?initial():initial;return [states[n],v=>{states[n]=v}];},useRef(initial){const n=index++;return states[n]||(states[n]={current:initial})},useEffect(){}};
 const Picker=create(Fake),props={kind:'expedition',missions:[{missionId:999,name:'ゲーム名'}],missionMasters:{999:{api_time:15,api_win_mat_level:[0,0,0,0],api_win_item1:[999,1]}},useItems:{999:{api_name:'弹药'}},value:999,onChange(){}};
 try{i18n.setLocale('ja-JP');index=0;tree=Picker(props);walk(tree).find(n=>n.props['aria-label']==='遠征').props.onClick();index=0;tree=Picker(props);
  const reward=walk(tree).find(n=>n.props.className==='paa-mission-reward-icon');assert.equal(reward.props['data-tooltip'],'弹药');
 }finally{i18n.setLocale('zh-CN');}
});
test('ship picker does not translate unknown game-defined ship types even on a catalog collision',()=>{
 const Picker=createShipPicker(React),state={info:{ships:{1:{api_ship_id:9,api_lv:10,api_cond:49,api_nowhp:8,api_maxhp:20}}},const:{$ships:{9:{api_stype:99}},$shipTypes:{99:{api_name:'驱逐'}}}};
 try{i18n.setLocale('ja-JP');const tree=Picker({index:0,rows:[{id:1,name:'原名',type:'驱逐',level:10}],store:state,kind:'normal'});
  const line=walk(tree).find(n=>n.type==='small'&&n.children.some(c=>typeof c==='string'&&c.includes('Lv.10')));assert.match(line.children[0],/^驱逐 ·/);
 }finally{i18n.setLocale('zh-CN');}
});
test('conditionally rendered picker functions do not add hooks to the parent workbench',()=>{
 const NoHooks={...React,useState(){throw Error('unexpected parent hook')},useEffect(){throw Error('unexpected parent effect')}};
 const state={info:{ships:{},equips:{}},const:{$ships:{},$equips:{}}};
 assert.doesNotThrow(()=>createShipPicker(NoHooks)({index:0,rows:[],store:state,kind:'normal'}));
 assert.doesNotThrow(()=>createEquipmentPicker(NoHooks)({index:0,slot:0,rows:[],store:state}));
});
test('equipment summary translates stat labels without changing values or item name',()=>{
 const Picker=createEquipmentPicker(React),state={info:{equips:{}},const:{$equips:{}}};
 const row={id:7,masterId:7,name:'試製装備',categoryId:1,statsSummary:'雷装+5 对潜+6',stats:[['雷装','+5'],['对潜','+6']],count:1};
 try{i18n.setLocale('ja-JP');const tree=Picker({index:0,slot:0,rows:[row],store:state});
  assert(text(tree).includes('試製装備'));assert(text(tree).includes('雷装+5 対潜+6'));
 }finally{i18n.setLocale('zh-CN');}
});
