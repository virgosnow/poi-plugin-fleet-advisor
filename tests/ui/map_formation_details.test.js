'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {nodeFormations,landBaseAirState}=require('../../src/ui/maps/node_formations');
const preview=require('../../src/ui/maps/route_preview');
const {previewForMap}=require('../../src/domain/routes/sortie_profile');
const h=(type,props,...children)=>({type,props:props||{},children:children.flat()});
const all=(node,p)=>!node||typeof node!=='object'?[]:[...(p(node)?[node]:[]),...(node.children||[]).flatMap(c=>all(c,p))];
test('node formations preserve each alternative, inherited rows, ship order and non-battle nodes',()=>{
  const data=require('../../data/sortie/encounters/1-4.json').nodes.H.phases.base.patterns;
  const rows=nodeFormations('1-4','H');assert.equal(rows.length,data.length);
  assert.equal(rows[0].ships.length,data[0].enemyShips.length);
  assert.deepEqual(rows[2].ships,rows[1].ships,'same-as pattern remains a separate formation');
  assert.deepEqual(nodeFormations('1-6','N'),[]);
  assert.deepEqual(nodeFormations('../outside','H'),[]);
});
test('small map uses hover-only node hints; large map contains selectable formations',()=>{
  const profile=previewForMap('1-4'),shared={profile,nodeId:'H',onNode(){},onBackground(){},compact:true,nodePopup:true,showDetails:true};
  let selected=null;const small=preview(h,{...shared,textOnly:true,onNode:id=>{selected=id;},enemyPortrait:e=>h('img',{alt:e.name})});
  assert.equal(all(small,n=>n.props['aria-label']==='节点详情').length,0);
  assert.equal(all(small,n=>n.props.className==='paa-map-selection').length,0);
  const node=all(small,n=>n.props.role==='img'&&n.props['aria-label']?.startsWith('H 点'))[0];assert(node);
  assert.equal(node.props.style.cursor,'pointer','hover hints use the hand cursor');
  assert.match(node.props['data-tooltip'],/^H 点 ·/);assert.equal(node.props['aria-pressed'],undefined);
  const boss=all(small,n=>n.props.role==='img'&&n.props['data-boss'])[0];assert(boss);
  assert.match(boss.props['data-tooltip'],/Boss 战/);
  assert.doesNotMatch(node.props['data-tooltip'],/Boss 战/);
  node.props.onClick({stopPropagation(){}});node.props.onKeyDown({key:'Enter',preventDefault(){}});assert.equal(selected,null);
  const large=preview(h,{...shared,enemyPortrait:e=>h('img',{alt:e.name})});
  const modal=all(large,n=>n.props['aria-label']==='节点详情')[0];
  assert.equal(all(modal,n=>n.props.role==='tab').length,nodeFormations('1-4','H').length);
  assert.equal(all(modal,n=>n.props.className==='paa-map-enemy-card').length,nodeFormations('1-4','H')[0].ships.length);
  assert(all(modal,n=>n.type==='img').length>0);
  assert(all(large,n=>n.props.role==='button'&&n.props['aria-pressed']===true).length>0);
});

test('formation tabs switch the entire visible fleet and expose verified HP',()=>{
  const profile=previewForMap('6-4'),rows=nodeFormations('6-4','C');let selected=0;
  const render=()=>preview(h,{profile,nodeId:'C',onNode(){},onBackground(){},compact:true,nodePopup:true,showDetails:true,
    formationIndex:selected,onFormationIndex:i=>{selected=i;},enemyPortrait:e=>h('img',{alt:e.name})});
  let tree=render(),tabs=all(tree,n=>n.props.role==='tab');assert.equal(tabs.length,rows.length);
  assert.equal(tabs[0].props['aria-selected'],true);assert(rows[0].ships.some(ship=>ship.hp>0));
  assert(all(tree,n=>n.props.className==='paa-map-enemy-card').some(card=>card.children.some(child=>
    child?.children?.some(part=>part?.children?.some(text=>typeof text==='string'&&text.startsWith('HP '))))));
  tabs[1].props.onClick();tree=render();tabs=all(tree,n=>n.props.role==='tab');assert.equal(tabs[1].props['aria-selected'],true);
  assert.equal(tabs[1].props.tabIndex,0);assert.equal(tabs[0].props.tabIndex,-1);
  const cards=all(tree,n=>n.props.className==='paa-map-enemy-card');
  assert.equal(cards.length,rows[1].ships.length+rows[1].escort.length);
  assert.deepEqual(cards.map(card=>all(card,n=>n.type==='img')[0].props.alt),[...rows[1].ships,...rows[1].escort].map(ship=>ship.name));
  let prevented=false,focused=false;
  tabs[1].props.onKeyDown({key:'ArrowRight',preventDefault(){prevented=true;},currentTarget:{parentElement:{querySelectorAll(){return rows.map(()=>({focus(){focused=true;}}));}}}});
  assert.equal(selected,2);assert(prevented&&focused,'keyboard navigation switches and focuses the next formation');
});

test('formation air and base air state follow the selected example, including land-base reconnaissance AA',()=>{
  const rows=nodeFormations('6-5','M');
  assert.deepEqual(rows.slice(0,2).map(row=>[row.enemyAirPower,row.landBaseAirPower]),[[209,215],[312,318]]);
  assert.equal(nodeFormations('1-4','H')[2].enemyAirPower,16,'same-as formation retains its air value');
  assert.equal(nodeFormations('6-5','B')[0].enemyAirPower,0,'verified zero aircraft remains zero');
  let selected=0;
  const base={id:1,name:'测试航空队',targets:['M','M'],air:{label:'出击制空',value:'330',power:{min:330,max:330}},slots:[]};
  const render=()=>preview(h,{profile:previewForMap('6-5'),nodeId:'M',onNode(){},onBackground(){},compact:true,
    nodePopup:true,showDetails:true,airbases:[base],formationIndex:selected,onFormationIndex:i=>{selected=i;},enemyPortrait:e=>h('img',{alt:e.name})});
  const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join(' ');
  let tree=render();
  assert.equal(text(all(tree,n=>n.props.className==='paa-map-formation-air')[0]),'制空 209');
  assert.equal(text(all(tree,n=>n.props.className==='paa-map-airstrike-state')[0]),'预计空优');
  all(tree,n=>n.props.role==='tab')[1].props.onClick();tree=render();
  assert.equal(text(all(tree,n=>n.props.className==='paa-map-formation-air')[0]),'制空 312');
  assert.equal(text(all(tree,n=>n.props.className==='paa-map-airstrike-state')[0]),'预计空均');
  base.air={...base.air,value:'320',power:{min:320,max:320}};selected=0;tree=render();
  assert.equal(text(all(tree,n=>n.props.className==='paa-map-airstrike-state')[0]),'预计空均','uses 215 land-base AA, not fleet AA 209');
});

test('base air state respects exact borders, ranges and missing data',()=>{
  const compare=(min,max,enemy=100)=>landBaseAirState({power:{min,max}},{landBaseAirPower:enemy});
  assert.equal(compare(300,300),'预计空确');assert.equal(compare(150,150),'预计空优');
  assert.equal(compare(67,67),'预计空均');assert.equal(compare(34,34),'预计空劣');
  assert.equal(compare(33,33),'预计丧失');assert.equal(compare(149,150),'预计空均～空优');
  assert.equal(compare(0,0,0),'预计空确');assert.equal(compare(null,100),'制空待确认');
  assert.equal(landBaseAirState({power:{min:100,max:100}},null),'制空待确认');
});

test('enlarged battle formations use one ordered fleet column or separate main and escort columns',()=>{
  for(const [area,id,combined] of [['1-4','H',false],['6-5','M',true]]){
    const formation=nodeFormations(area,id)[0],tree=preview(h,{profile:previewForMap(area),nodeId:id,
      onNode(){},onBackground(){},compact:true,nodePopup:true,showDetails:true,enemyPortrait:e=>h('img',{alt:e.name})});
    const fleets=all(tree,n=>n.props.className==='paa-map-enemy-fleets')[0];assert(fleets);
    assert.equal(fleets.props['data-combined'],combined);
    assert.equal(all(tree,n=>n.props['aria-label']==='节点详情')[0].props['data-combined'],combined);
    const groups=all(fleets,n=>n.props.className==='paa-map-enemy-group');assert.equal(groups.length,combined?2:1);
    assert.deepEqual(all(groups[0],n=>n.type==='img').map(n=>n.props.alt),formation.ships.map(s=>s.name));
    if(combined)assert.deepEqual(all(groups[1],n=>n.type==='img').map(n=>n.props.alt),formation.escort.map(s=>s.name));
  }
});

test('both map sizes mark selected airbase targets and the enlarged node details show each team and wave',()=>{
  const profile=previewForMap('6-5'),teams=[{id:1,name:'第一航空队',targets:['I','M'],air:{label:'出击制空',value:'123'},
    slots:[{number:1,name:'一式陸攻 ★2',item:{name:'一式陸攻'},count:'18/18'},{number:2,name:'空槽',item:null}]},
    {id:2,name:'第二航空队',targets:['I','I'],air:{label:'出击制空',value:'95'},slots:[]}];
  const shared={profile,nodeId:'I',onNode(){},onBackground(){},compact:true,nodePopup:true,showDetails:true,airbases:teams};
  for(const fixedNodes of [false,true]){
    const tree=preview(h,{...shared,fixedNodes,textOnly:!fixedNodes,enemyPortrait:e=>h('img',{alt:e.name}),equipmentIcon:()=>null});
    const markers=all(tree,n=>n.props.className==='paa-map-airstrike-marker');assert.equal(markers.length,2);
    const target=all(tree,n=>['img','button'].includes(n.props.role)&&n.props['aria-label']?.startsWith('I 点'))[0];
    const details=all(tree,n=>n.props['aria-label']==='攻击此点的基地航空队');
    if(!fixedNodes){assert.equal(details.length,0);assert.match(target.props['data-tooltip'],/第一航空队第 1 波/);
      assert.match(target.props['data-tooltip'],/第二航空队第 1、2 波/);continue;}
    assert.equal(target.props['data-tooltip'],undefined,'the selected node does not compete with its open details');
    const otherNode=all(tree,n=>n.props.role==='button'&&n.props['aria-label']?.startsWith('M 点'))[0];
    assert.match(otherNode.props['data-tooltip'],/基地航程 5/,'other nodes keep their hover hints');
    const popover=all(tree,n=>n.props['aria-label']==='节点详情')[0];
    const content=n=>typeof n==='string'?n:(n?.children||[]).map(content).join(' ');
    assert.match(content(popover),/I 点.*基地航程 3/);
    assert.equal(details.length,1);assert.equal(all(details[0],n=>n.props.className==='paa-map-airstrike-unit').length,2);
    const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join(' ');
    assert.match(text(details[0]),/第一航空队.*第 1 波.*出击制空 123/);
    assert.match(text(details[0]),/一式陸攻 ★2.*18\/18/);
    assert.match(text(details[0]),/第二航空队.*第 1、2 波/);
    assert.equal(all(tree,n=>n.props['aria-label']==='敌方编成例').length,2,'tab list and formation section remain available');
  }
  const other=preview(h,{...shared,nodeId:'F',enemyPortrait:e=>h('img',{alt:e.name})});
  assert.equal(all(other,n=>n.props['aria-label']==='攻击此点的基地航空队').length,0);
  const offRoute=preview(h,{...shared,profile:{...profile,highlightPaths:[['B','F','I','J','M']]},nodeId:'C',
    airbases:[{...teams[0],targets:['C','C']}],enemyPortrait:e=>h('img',{alt:e.name})});
  const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join(' ');
  assert.match(text(all(offRoute,n=>n.props['aria-label']==='节点详情')[0]),/不在当前路线.*不会生效/);
});

test('closing the enlarged node details restores its tooltip, and unknown range stays explicit',()=>{
  const profile=previewForMap('6-5'),shared={profile,onNode(){},onBackground(){},compact:true,fixedNodes:true,nodePopup:true,enemyPortrait:e=>h('img',{alt:e.name})};
  const find=(tree,id)=>all(tree,n=>n.props.role==='button'&&n.props['aria-label']?.startsWith(`${id} 点`))[0];
  let tree=preview(h,{...shared,nodeId:'M',showDetails:true});assert.equal(find(tree,'M').props['data-tooltip'],undefined);
  const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join(' ');
  assert.match(text(all(tree,n=>n.props['aria-label']==='节点详情')[0]),/M 点.*Boss 战.*基地航程 5/);
  tree=preview(h,{...shared,nodeId:null,showDetails:false});assert.match(find(tree,'M').props['data-tooltip'],/基地航程 5/);
  tree=preview(h,{...shared,nodeId:'K',showDetails:true});assert.match(text(all(tree,n=>n.props['aria-label']==='节点详情')[0]),/基地航程 待确认/);
  const normal=preview(h,{...shared,profile:previewForMap('1-4'),nodeId:'H',showDetails:true});
  assert.doesNotMatch(text(all(normal,n=>n.props['aria-label']==='节点详情')[0]),/基地航程/);
});
