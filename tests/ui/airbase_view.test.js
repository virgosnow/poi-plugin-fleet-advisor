'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const view=require('../../src/ui/workbench/airbase_view');
const fixture=require('../helpers/workbench_fixture');
const h=(type,props,...children)=>({type,props:props||{},children:children.flat()});
const find=(node,predicate)=>node&&typeof node==='object'&&(predicate(node)?node:(node.children||[]).map(child=>find(child,predicate)).find(Boolean));
const text=node=>typeof node==='string'||typeof node==='number'?String(node):(node?.children||[]).map(text).join('');

test('only supported maps show their own area bases with aircraft and observed state',()=>{
  const store=fixture();
  store.info.equips[1001]={api_slotitem_id:501,api_level:3,api_alv:7};
  store.const.$equips[501]={api_name:'测试陆攻',api_type:[0,0,47,47]};
  store.info.airbase=[
    {api_area_id:7,api_rid:1,api_name:'南西航空队',api_action_kind:2,api_distance:{api_base:4,api_bonus:2},api_plane_info:[{api_squadron_id:1,api_slotid:1001,api_count:14,api_max_count:18,api_state:1},{api_squadron_id:2,api_slotid:0,api_state:0}]},
    {api_area_id:6,api_rid:2,api_action_kind:1,api_distance:{api_base:5,api_bonus:0},api_plane_info:[]},
    {api_area_id:6,api_rid:1,api_action_kind:0,api_distance:8,api_plane_info:[]}
  ];
  const before=JSON.stringify(store);
  assert.equal(view.model(store,'7-5'),null);
  assert.equal(view.model(store,'5-6'),null);
  const central=view.model(store,'6-5');
  assert.equal(central.map.maxSortieSquadrons,2);
  assert.deepEqual(central.bases.map(base=>base.id),[1,2]);
  assert.equal(central.bases[0].distance,8);
  assert.equal(central.bases[1].mode,'出击');
  const southwest=view.model(store,'7-4');
  assert.equal(southwest.map.maxSortieSquadrons,1);
  assert.equal(southwest.bases[0].distance,6);
  assert.equal(southwest.bases[0].mode,'防空');
  assert.match(southwest.bases[0].slots[0].name,/测试陆攻.*★3.*熟练度 7/);
  assert.equal(southwest.bases[0].slots[0].count,'14/18');
  assert.equal(southwest.bases[0].slots[1].name,'空槽');
  assert.equal(southwest.bases[0].slots[2].name,'资料待同步');
  const tree=view.render(h,()=>null,store,'7-4');
  assert.match(text(tree),/基地航空队.*最多出击 1 队.*南西航空队.*防空.*航程 6/);
  const details=find(tree,node=>node.type==='details'&&node.props.className==='paa-airbase-disclosure');
  assert(details);assert.equal(details.props.open,undefined,'the details are folded by default');
  const summary=find(details,node=>node.type==='summary');
  assert.match(text(summary),/1 队.*防空.*航程 6/,'the folded summary retains the squadron status');
  assert(!text(summary).includes('测试陆攻'),'aircraft details appear only inside the collapsed content');
  assert(find(details,node=>node.props.className==='paa-airbase-list'));
  assert.equal(find(tree,node=>node.type==='button'),undefined);
  assert.equal(JSON.stringify(store),before);
});

test('missing base, partial range and unknown aircraft do not become known values',()=>{
  const store=fixture();
  assert.match(text(view.render(h,()=>null,store,'6-4')),/基地航空队待同步/);
  store.info.airbase=[{api_area_id:6,api_rid:1,api_action_kind:99,api_distance:{api_base:5},api_plane_info:[
    {api_squadron_id:1,api_slotid:1001,api_count:0,api_state:2},
    {api_squadron_id:2,api_slotid:0,api_state:0}]}];
  const base=view.model(store,'6-4').bases[0];
  assert.equal(base.distance,null);assert.equal(base.mode,'状态待确认');
  assert.equal(base.slots[0].name,'飞机资料待同步');assert.equal(base.slots[0].count,'0/?');
  assert.equal(base.slots[0].state,'状态待确认');assert.equal(base.slots[1].name,'空槽');
  assert.equal(base.slots[2].name,'资料待同步');
  const southwest=view.model(store,'7-4');
  assert.deepEqual(southwest.bases,[],'central bases must never be displayed for the southwest');
  assert.match(text(view.render(h,()=>null,store,'7-4')),/基地航空队待同步/);
  store.airbaseSync={complete:true};
  const locked=view.render(h,()=>null,store,'7-4');
  assert.match(text(locked),/待解锁/);
  assert(find(locked,node=>node.type==='svg'&&node.props['aria-hidden']===true),'lock icon is visible');
  assert(find(locked,node=>node.props['data-state']==='locked'));
  assert.equal(find(locked,node=>node.type==='button'),undefined);
});

test('change signature detects in-place base and assigned equipment updates',()=>{
  const store=fixture();store.info.equips[1001]={api_slotitem_id:501,api_level:0};
  store.const.$equips[501]={api_name:'测试陆攻',api_type:[0,0,47,47]};
  store.info.airbase=[{api_area_id:6,api_rid:1,api_plane_info:[{api_squadron_id:1,api_slotid:1001,api_count:18}]}];
  let before=view.signature(store,'6-4');store.info.airbase[0].api_plane_info[0].api_count=17;
  assert.notEqual(view.signature(store,'6-4'),before);
  before=view.signature(store,'6-4');store.info.equips[1001].api_level=1;
  assert.notEqual(view.signature(store,'6-4'),before);
  assert.equal(view.signature(store,'7-5'),'');
});
