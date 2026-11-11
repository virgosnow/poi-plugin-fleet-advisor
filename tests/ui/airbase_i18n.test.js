'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const i18n=require('../../src/shared/i18n');
const view=require('../../src/ui/workbench/airbase_view');
const fixture=require('../helpers/workbench_fixture');
const h=(type,props,...children)=>({type,props:props||{},children:children.flat()});
const find=(node,predicate)=>node&&typeof node==='object'&&(predicate(node)?node:(node.children||[]).map(child=>find(child,predicate)).find(Boolean));
const text=node=>typeof node==='string'||typeof node==='number'?String(node):(node?.children||[]).map(text).join('');

test('base display changes language without changing game names, source mode or slot state',()=>{
  const store=fixture();store.info.equips[1001]={api_slotitem_id:501,api_level:0,api_alv:0};
  store.const.$equips[501]={api_name:'出击',api_type:[0,0,47,47],api_tyku:3,api_raig:10,api_distance:8};
  const planes=Array.from({length:4},(_,i)=>({api_squadron_id:i+1,api_slotid:i?0:1001,api_count:i?0:18,api_max_count:18,api_state:i?0:1}));
  store.info.airbase=[{api_area_id:6,api_rid:1,api_name:'出击',api_action_kind:1,api_distance:8,api_plane_info:planes},
    {api_area_id:6,api_rid:2,api_action_kind:0,api_distance:5,api_plane_info:[]}];
  const source=JSON.stringify(store),model=JSON.stringify(view.model(store,'6-5'));
  try{
    i18n.setLocale('ja-JP');let tree=view.render(h,()=>null,store,'6-5');
    assert.match(text(tree),/基地航空隊/);assert.match(text(tree),/出撃/);
    assert.equal(find(tree,node=>node.props.className==='paa-airbase-unit-heading').children[0].children[0],'出击','game-provided base name is not translated');
    assert.equal(find(tree,node=>node.props.className==='paa-airbase-slot-name').children[0],'出击','game-provided equipment name is not translated');
    assert.match(text(tree),/第2航空隊/,'locally generated base names are translated');
    const badge=find(tree,node=>node.props.className==='paa-airbase-mode');assert.equal(badge.props['data-mode'],'出击');
    i18n.setLocale('zh-TW');tree=view.render(h,()=>null,store,'6-5');
    assert.match(text(tree),/基地航空隊/);assert.match(text(tree),/出擊/);
    assert.equal(JSON.stringify(view.model(store,'6-5')),model);assert.equal(JSON.stringify(store),source);
  }finally{i18n.setLocale('zh-CN');}
});

test('base aircraft category search accepts translated and original labels without changing inventory',()=>{
  const editor=require('../../src/ui/workbench/airbase_editor'),store=fixture();
  store.info.ships={};store.info.equips={1:{api_id:1,api_slotitem_id:1001,api_level:0,api_alv:7}};
  store.const.$equips={1001:{api_id:1001,api_name:'試験機',api_type:[0,0,47],api_distance:8,api_tyku:2,api_raig:10}};
  const slots=[1,0,0,0].map((id,i)=>({api_squadron_id:i+1,api_slotid:id,api_count:18,api_max_count:18,api_state:1}));
  store.info.airbase=[{api_area_id:6,api_rid:1,api_action_kind:1,api_distance:8,api_plane_info:slots}];
  const draft=editor.observedDraft(store,'6-5'),before=JSON.stringify({store,draft});
  try{
    i18n.setLocale('ja-JP');
    const original=editor.equipmentOptions(store,'6-5',draft,{ships:[]},1,1,'陆上机');
    const translated=editor.equipmentOptions(store,'6-5',draft,{ships:[]},1,1,'陸上機');
    assert(original.some(row=>row.id===1));assert.deepEqual(translated.map(row=>row.id),original.map(row=>row.id));
    assert.equal(JSON.stringify({store,draft}),before);
  }finally{i18n.setLocale('zh-CN');}
});
