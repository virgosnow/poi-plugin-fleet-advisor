'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const picker=require('../../src/ui/components/equipment_picker');

const rows=[
  {id:1,masterId:101,name:'舰攻',categoryId:2,category:'舰爆／舰攻',count:3,stars:2,proficiency:7,stats:[],tooltip:'舰攻'},
  {id:2,masterId:102,name:'主炮',categoryId:4,category:'主炮',count:1,stats:[],tooltip:'主炮'},
  {id:3,masterId:103,name:'舰战',categoryId:1,category:'舰上战斗机',count:2,stats:[],tooltip:'舰战'},
  {id:4,masterId:104,name:'试制装备',categoryId:4,category:'主炮',count:1,stats:[],tooltip:'试制装备'},
];
const store={const:{$equips:{101:{api_houg:4,api_tais:8,api_type:[0,0,8]},102:{api_houg:15},103:{api_houg:0},104:{api_houg:15}}}};
test('equipment two-level filters and base-attribute ranking preserve ties and category order',()=>{
  assert.equal(picker.groupForCategory(2),'air');assert.equal(picker.groupForCategory(4),'gun');
  assert.deepEqual(picker.filterRows(rows,'air','all','default',store).map(r=>r.id),[1,3]);
  assert.deepEqual(picker.filterRows(rows,'air','1','default',store).map(r=>r.id),[3]);
  assert.deepEqual(picker.filterRows(rows,'all','all','fire',store).map(r=>r.id),[2,4,1,3]);
  assert.deepEqual(picker.filterRows(rows,'all','all','asw',store).map(r=>r.id),[1,2,3,4]);
  assert.equal(picker.statValue(rows[2],'asw',store),0);
  assert.equal(picker.statValue(rows[0],'fire',store),4);
  const intercept={...store,const:{$equips:{101:{api_houm:9,api_type:[0,0,48]}}}};
  assert.equal(picker.statValue(rows[0],'accuracy',intercept),0);
});

test('equipment picker displays available counts, quality, current item, and actions',()=>{
  const calls=[],React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()})};
  const Component=picker(React),tree=Component({index:1,slot:2,rows,store,search:'',group:'air',category:'2',sort:'default',currentEquipment:1,
    setSearch:v=>calls.push(['search',v]),setGroup:v=>calls.push(['group',v]),setCategory:v=>calls.push(['category',v]),setSort:v=>calls.push(['sort',v]),
    onClose:()=>calls.push(['close']),onPick:v=>calls.push(['pick',v.id]),onClear:()=>calls.push(['clear']),onAuto:()=>calls.push(['auto'])});
  const walk=n=>n&&typeof n==='object'?[n,...(n.children||[]).flatMap(walk)]:[];
  const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join('');
  const find=(p)=>walk(tree).find(p);
  assert.equal(find(n=>n.props.role==='dialog').props['aria-label'],'替换装备');
  assert.equal(find(n=>n.props['aria-label']==='优先属性').type,'summary');
  const priorities=find(n=>n.props['aria-label']==='优先属性选项');
  for(const button of priorities.children){assert(walk(button).some(n=>n.type==='svg'),'each priority has an icon');assert.doesNotMatch(text(button),/从高到低/);}
  const fire=walk(priorities).find(n=>n.type==='button'&&text(n)==='火力'),dropdown={open:true};
  fire.props.onClick({currentTarget:{closest:()=>dropdown}});assert.deepEqual(calls.pop(),['sort','fire']);assert.equal(dropdown.open,false);
  const priority=find(n=>n.type==='details'&&n.props.className==='paa-wb-priority');let stopped=false,focused=false;
  const openMenu={open:true,querySelector:()=>({focus:()=>{focused=true;}})};
  priority.props.onKeyDown({key:'Escape',currentTarget:openMenu,stopPropagation:()=>{stopped=true;}});
  assert.equal(openMenu.open,false);assert(stopped&&focused,'Escape closes only the menu and returns focus');
  const blurred={open:true,contains:()=>false};priority.props.onBlur({currentTarget:blurred,relatedTarget:null});assert.equal(blurred.open,false);
  const option=find(n=>n.props.className==='paa-wb-equipment-option');assert.equal(option.props['aria-current'],'true');
  assert.match(text(option),/舰攻/);assert.match(text(option),/★2/);assert.match(text(option),/熟练 7/);assert.match(text(option),/可用 3/);assert.match(text(option),/当前/);
  const name=find(n=>n.props.className==='paa-wb-equipment-name');
  assert.equal(name.children[0].type,'strong');assert.equal(name.children[1].props.className,'paa-wb-equipment-quality');
  assert(option.props['data-tooltip-content'],'equipment retains attribute tooltip');option.props.onClick();assert.deepEqual(calls.pop(),['pick',1]);
  find(n=>n.type==='button'&&text(n)==='炮装').props.onClick();assert.deepEqual(calls.splice(0),[['group','gun'],['category','all']]);
  find(n=>n.type==='button'&&text(n)==='清空此槽').props.onClick();find(n=>n.type==='button'&&text(n)==='交给自动配装').props.onClick();
  assert.deepEqual(calls,[['clear'],['auto']]);
});
