'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeName,matchingNames,matchesName,VARIANT_GROUPS}=require('../../src/shared/name_matching');
const {selectShipByName}=require('../../src/domain/fleet/ship_selection');
const {resolvePlan}=require('../../src/execution/organize');
const {createEquipmentPlanner}=require('../../src/domain/fleet/equipment_planner');
const {Controller}=require('../../src/application/controller');

test('variant groups are disjoint and normalization is idempotent',()=>{
  const all=VARIANT_GROUPS.join('');assert.equal(new Set(all).size,[...all].length);
  for(const group of VARIANT_GROUPS)for(const c of group){assert.equal(normalizeName(c),[...group][0]);assert.equal(normalizeName(normalizeName(c)),normalizeName(c));}
});
for(const [input,original] of [
  ['发烟装置','発煙装置(煙幕)'],['发烟装置（烟幕）','発煙装置(煙幕)'],
  ['大发动艇','大発動艇(八九式中戦車&陸戦隊)'],['舰本式','艦本式 新型高温高圧缶'],
  ['零式舰战２１型（熟练）','零式艦戦21型(熟練)'],['１２．７ｃｍ连装炮','12.7cm連装砲B型改二'],
  ['翔鹤改二','翔鶴改二甲'],['响','響'],['龙骧','龍驤'],['岚','嵐'],['晓','暁'],['驱逐舰','駆逐艦']
])test(input+' matches '+original,()=>assert(matchesName(original,input)));

test('no semantic translation, kana conversion, punctuation removal or case folding',()=>{
  for(const [input,original] of [['雷达','電探'],['运输桶','ドラム缶(輸送用)'],['秋月','秋津洲'],['ろ号','ロ号'],['a','A'],['12.7cm 連装砲','12.7cm連装砲']])assert(!matchesName(original,input));
});
test('raw prefixes keep their full original candidate set before conversion',()=>{
  const names=['発煙装置(煙幕)','发烟装置','発煙装置(煙幕)改'];
  assert.deepEqual(matchingNames(names,'発煙装置',x=>x),[names[0],names[2]]);
  assert.deepEqual(matchingNames(names,'发烟',x=>x),[names[1]]);
  assert.deepEqual(matchingNames(names,'発煙装置(煙幕)',x=>x),[names[0],names[2]]);
});
test('collapsed complete names are rejected but ordinary prefix families and duplicate instances remain valid',()=>{
  assert.throws(()=>matchingNames(['復装置','複装置'],'复',x=>x),/日文原名或实例 ID.*復装置.*複装置/);
  assert.deepEqual(matchingNames(['復装置','複装置'],'複',x=>x),['複装置']);
  assert.deepEqual(matchingNames(['発煙装置','発煙装置','発煙装置改'],'发烟',x=>x),['発煙装置','発煙装置','発煙装置改']);
});
test('empty or non-string names cannot select arbitrary equipment',()=>{
  for(const name of ['', ' ', '\u3000',null,12,{}])assert.throws(()=>matchingNames(['gun'],name,x=>x),/名称不能为空/);
});
test('game master equipment corpus converts every simplified-Chinese full name to its Japanese original',()=>{
  const corpus=require('../fixtures/equipment_names_master.json'),entries=corpus.map(([name])=>({name}));
  for(const [name,simplified] of corpus)assert(matchingNames(entries,simplified).length>=1,name);
});
test('game master equipment corpus has no normalized full-name collisions',()=>{
  const seen=new Map();
  for(const [name] of require('../fixtures/equipment_names_master.json')){
    const key=normalizeName(name);assert(!seen.has(key),key);seen.set(key,name);
  }
});
test('game master ship corpus converts every simplified-Chinese full name to its Japanese original',()=>{
  const corpus=require('../fixtures/ship_names_master.json'),entries=corpus.map(([name])=>({name}));
  for(const [name,simplified] of corpus)assert(matchingNames(entries,simplified).length>=1,name);
});
test('game master ship corpus has no normalized full-name collisions',()=>{
  const seen=new Map();
  for(const [name] of require('../fixtures/ship_names_master.json')){
    const key=normalizeName(name);assert(!seen.has(key),key);seen.set(key,name);
  }
});
test('ship prefixes retain highest level and oldest instance rules after conversion',()=>{
  const roster=[{id:3,name:'翔鶴',level:30},{id:2,name:'翔鶴改二甲',level:90},{id:1,name:'翔鶴改二',level:90}];
  assert.equal(selectShipByName(roster,'翔鹤'),1);assert.equal(selectShipByName(roster,'翔鶴'),1);
});

function state() {
  return {info:{ships:{1:{api_ship_id:1,api_lv:90,api_slot:[101,-1],api_slot_ex:-1},2:{api_ship_id:2,api_lv:95,api_slot:[-1,-1],api_slot_ex:-1}},
    equips:{101:{api_slotitem_id:9001,api_level:0},102:{api_slotitem_id:9001,api_level:6,api_alv:7},103:{api_slotitem_id:9002,api_level:0},104:{api_slotitem_id:9001,api_level:0}},
    fleets:[{api_ship:[1],api_mission:[0]},{api_ship:[2],api_mission:[0]}],repairs:[]},
    const:{$ships:{1:{api_name:'翔鶴改二',api_stype:2,api_slot_num:2},2:{api_name:'翔鶴改二甲',api_stype:2,api_slot_num:2}},
      $shipTypes:{2:{api_equip_type:{54:1,12:1}}},$equips:{9001:{api_name:'発煙装置(煙幕)',api_type:[0,0,54,54]},9002:{api_name:'電探',api_type:[0,0,12,11]}},
      $exslotEquips:[54,12],$exslotEquipShips:{},$exslotEquipLimits:{}}};
}
test('organization accepts simplified ship names, with or without exact instance IDs',()=>{
  const data=state();assert.equal(resolvePlan(data,{fleet:1,ships:['翔鹤']}).targets[0],2);
  assert.equal(resolvePlan(data,{fleet:1,ships:[{id:1,name:'翔鹤'}]}).targets[0],1);
  assert.throws(()=>resolvePlan(data,{fleet:1,ships:[{id:1,name:'瑞鹤'}]}),/mismatch/);
});
test('equipment normal and expansion slots keep IDs, star and proficiency constraints',()=>{
  const data=state(),planner=createEquipmentPlanner(()=>data);
  const p=planner.resolvePlan({fleet:1,ships:[{id:1,name:'翔鹤',slots:['发烟装置',{name:'发烟装置（烟幕）',star:6,alv:7}],ex:'电探'}]});
  assert.deepEqual(p.expected[0].state,{slots:[101,102],ex:103});
  assert.equal(p.ships[0].name,'翔鶴改二');
  assert.throws(()=>planner.resolvePlan({fleet:1,ships:[{id:1,name:'瑞鹤',ex:'电探'}]}),/不一致/);
});
test('equipment ship selection by simplified prefix uses the same instance as organization',()=>{
  const data=state(),planner=createEquipmentPlanner(()=>data);
  assert.equal(planner.resolvePlan({fleet:2,ships:[{name:'翔鹤',slots:['发烟装置']}]}).ships[0].shipId,2);
});
test('unified Japanese and simplified schemes produce identical pinned targets and leave input untouched',()=>{
  const data=state(),controller=new Controller({getStore:()=>data});
  const cn={fleet:1,ships:[{name:'翔鹤',slots:[{name:'发烟装置',star:6,alv:7}],ex:'电探'}]};
  const ja={fleet:1,ships:[{name:'翔鶴',slots:[{name:'発煙装置',star:6,alv:7}],ex:'電探'}]};
  const before=JSON.stringify({data,cn});
  assert.deepEqual(controller.preview('fleet',cn),controller.preview('fleet',ja));
  assert.equal(JSON.stringify({data,cn}),before);
});
test('conversion does not relax unavailable equipment or impossible star constraints',()=>{
  const data=state(),planner=createEquipmentPlanner(()=>data);
  assert.throws(()=>planner.resolvePlan({fleet:1,ships:[{id:1,slots:[{name:'发烟装置',star:10}]}]}),/无可用装备/);
  data.info.airbase=[{api_plane_info:[{api_slotid:103}]}];
  assert.throws(()=>planner.resolvePlan({fleet:1,ships:[{id:1,ex:'电探'}]}),/无可用装备/);
});
test('planner rejects conversion collisions, while Japanese names and explicit IDs disambiguate',()=>{
  const data=state(),planner=createEquipmentPlanner(()=>data);
  data.const.$equips[9001].api_name='復装置';data.const.$equips[9002].api_name='複装置';
  assert.throws(()=>planner.resolvePlan({fleet:1,ships:[{id:1,slots:['复装置']}]}),/字形转换后名称重合/);
  assert.equal(planner.resolvePlan({fleet:1,ships:[{id:1,slots:['複装置']}]}).expected[0].state.slots[0],103);
  assert.equal(planner.resolvePlan({fleet:1,ships:[{id:1,slots:[103]}]}).expected[0].state.slots[0],103);
});
