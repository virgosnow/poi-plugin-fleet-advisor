'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const V=require('../../src/ui/models/presentation_model');

test('equipment hover attributes preserve negative stats and distinguish interceptor stats without polluting names',()=>{
  const master={api_name:'测试装备',api_type:[0,0,2,2],api_houg:3,api_houk:-2,api_houm:1,api_tyku:0,api_leng:2,api_saku:undefined};
  const state={info:{equips:{1:{api_slotitem_id:101,api_level:6}}},const:{$equips:{101:master}}};
  let item=V.equipmentItem(state,1,0);
  assert.equal(item.name,'测试装备');assert(!item.tooltip.includes('火力'));
  assert.equal(item.statsText,'基础属性：火力 +3 · 命中 +1 · 回避 -2 · 射程 中');
  assert.equal(item.statsSummary,'火力+3 命中+1 回避-2 射程中');
  assert.match(V.equipmentTooltip(item),/★6\n基础属性/);
  Object.assign(master,{api_type:[0,0,48,0],api_houg:0,api_leng:0,api_distance:4});
  item=V.equipmentItem(state,1,'ex');assert.equal(item.statsText,'基础属性：对爆 +1 · 迎击 -2 · 航程 4');
  assert.equal(V.equipmentTooltip(null),'');
});

test('ship equipment icons reflect proposed slots and expansion, with full improvement and proficiency tooltips',()=>{
  const state={info:{ships:{1:{api_ship_id:10,api_lv:80,api_slot:[1],api_slot_ex:3}},
    equips:{1:{api_slotitem_id:101},2:{api_slotitem_id:102,api_level:6,api_alv:7},
      3:{api_slotitem_id:103},4:{api_slotitem_id:104}}},
    const:{$ships:{10:{api_name:'测试舰'}},$equips:{101:{api_name:'原装备',api_type:[0,0,2,2]},
      102:{api_name:'九八式水上偵察機(夜偵)',api_type:[0,0,10,50]},
      103:{api_name:'原增设'},104:{api_name:'熟練見張員',api_type:[0,0,39,32]}}}};
  const row=V.fleetRows(state,{ships:[{id:1,slots:[2],ex:4}]})[0];
  assert.deepEqual(row.gearIcons.map(e=>e.id),[2,4]);
  assert.match(row.gearIcons[0].tooltip,/九八式水上偵察機\(夜偵\).*★6.*熟练度 7/);
  assert.match(row.gearIcons[0].icon,/^file:.*50\.png$/);
  assert.equal(row.gearIcons[1].extra,true);assert.match(row.gearIcons[1].tooltip,/增设.*熟練見張員/);
  assert.equal(V.fleetRows(state,{ships:[{id:1,ex:-1}]})[0].gearIcons.length,1);
});

const store={info:{ships:{1:{api_ship_id:10,api_lv:80},2:{api_ship_id:11,api_lv:45},
  3:{api_ship_id:12,api_lv:20,api_situation:2}},
  equips:{201:{api_slotitem_id:301}},
  fleets:[{api_ship:[1,-1],api_mission:[0]},{api_ship:[2,-1],api_mission:[1]},
    {api_ship:[-1,-1],api_mission:[0]}],repairs:[]},
const:{$ships:{10:{api_name:'時雨改二'},11:{api_name:'夕立改二'},12:{api_name:'睦月'}},
  $equips:{301:{api_name:'試製艦戦'}}}};

function harness(){
  const states=[],refs=[],effects=[];let slot=0,effectCount=0;
  const React={createElement:(type,props,...children)=>({type,props:props||{},children}),
    useState(initial){const index=slot++;if(!(index in states))states[index]=typeof initial==='function'?initial():initial;
      return [states[index],next=>{states[index]=typeof next==='function'?next(states[index]):next;}];},
    useRef(initial){const index=slot++;if(!(index in refs))refs[index]={current:initial};return refs[index];},
    useEffect(callback){if(effectCount++===0)effects.push(callback);}};
  return {React,states,render(View,props){slot=0;effectCount=0;const tree=View(props);
    for(const effect of effects.splice(0))effect();return tree;}};
}
const find=(tree,predicate)=>{
  if(!tree||typeof tree!=='object')return null;
  if(Array.isArray(tree)){for(const child of tree){const found=find(child,predicate);if(found)return found;}return null;}
  if(predicate(tree))return tree;
  for(const child of tree.children||[]){const found=find(child,predicate);if(found)return found;}
  return null;
};

test('roster labels expose busy and repairing availability',()=>{
  const rows=V.rosterRows(store);
  assert.equal(rows.find(x=>x.id===2).unavailable,'远征中');
  assert.equal(rows.find(x=>x.id===3).unavailable,'修理中');

});

test('production panel keeps the workbench mounted and applies directly without a second confirmation page',async()=>{
  const ui=harness(),calls=[],plan={fleet:1,done:true,organization:{fleet:1,current:[],targets:[],done:true},equipment:{fleet:1,ships:[],expected:[],done:true}};
  const Panel=require('../../src/ui/shell/panel')(ui.React,{getController:()=>({getExperimentalSettings:()=>({automaticOperations:true}),preview:()=>{calls.push('preview');return plan;},run:async()=>{calls.push('run');return {ok:true,done:true,changed:0};}}),getStore:()=>store,subscribe:()=>()=>{}});
  let tree=ui.render(Panel,{});
  await find(tree,n=>typeof n.type==='function'&&n.type.name==='Workbench').props.onApply({fleet:1,ships:[{id:1}]});
  tree=ui.render(Panel,{});
  assert.deepEqual(calls,['preview','run']);
  assert(find(tree,n=>typeof n.type==='function'&&n.type.name==='Workbench'));
  assert.equal(find(tree,n=>n.props.className==='paa-card paa-preview-card'),null);
  assert(find(tree,n=>n.type==='button'&&n.children.includes('当前舰队')));
  const status=find(tree,n=>n.type?.name==='CurrentFleet');assert(status);assert.equal(status.props.onApply,undefined);assert.equal(status.props.hidden,false);
});

test('route reasons retain numeric references and show unknown random exits without misleading totals',()=>{
  const row={route:{verdict:'possibleRandom',pointAssessments:[
    {from:'A',assessment:{status:'random',probabilities:[{to:'B',probability:null},{to:'C',probability:0.8}]}},
    {from:'X',assessment:{status:'unknown',reason:'不相关条件'}}]},profile:{examples:[['A','C']]}};
  const reasons=V.routeReasons(row);
  assert.equal(reasons.length,1);assert.match(reasons[0],/A 点随机分岐.*B 20%.*C 80%/);
  assert(!reasons[0].includes('B 0%'));
  const fallback={...row,route:{verdict:'possibleRandom',pointAssessments:[
    {from:'A',assessment:{status:'random',destinations:['B','C','D'],referencePathProbability:.5,
      probabilities:[{to:'B',probability:null},{to:'C',probability:null},{to:'D',probability:null}]}}]}};
  assert.deepEqual(V.routeReasons(fallback),['A 点随机分岐：所选出口 C 50%；其余偏航。']);
  assert(!V.routeReasons(fallback)[0].includes('B 50% / C 50% / D 50%'));
  fallback.route.pointAssessments[0].assessment.probabilities[1].probability=.2;
  assert.deepEqual(V.routeReasons(fallback),['A 点随机分岐：所选出口 C 20%；其余偏航。'],'an explicit selected-exit number wins over the fallback');
  const losRow={profile:{examples:[['A','C']]},route:{verdict:'possibleUnverified',
    lineOfSight:{status:'estimate',scoresByCoefficient:{4:45.123}},pointAssessments:[
      {from:'A',assessment:{status:'unknown',destinations:['B','C'],unconfirmedCondition:{los:{coefficient:4,gte:40}}}}]}};
  assert.match(V.routeReasons(losRow)[0],/系数 4.*45.12.*换装估算.*B \/ C/);
  assert(!V.routeReasons({...row,routeAfterEquipPending:true}).some(r=>r.includes('索敌')));
  const unknown=V.routeReasons({...row,route:{verdict:'unknown',pointAssessments:[
    {from:'A',assessment:{status:'unknown',destinations:['B','C'],reason:'舰种分岐条件尚未明确'}}]}});
  assert.match(unknown[0],/A 点条件待确认.*舰种分岐条件尚未明确/);
  assert(!unknown[0].includes('50%'),'a missing condition is not a random probability');
  assert(![...reasons,...V.routeReasons(fallback),...unknown].some(s=>/样本不足|疑似固定/.test(s)));
});

test('portraits use the host image resolver with the correct ship identity and version',()=>{
  const state={...store,info:{...store.info,server:{ip:'server'}},const:{...store.const,
    $shipgraph:[{api_id:10,api_version:['7']}]}};
  const calls=[];
  assert.equal(V.portraitUrl(state,10,(...args)=>{calls.push(args);return 'cached-banner';}),'cached-banner');
  assert.deepEqual(calls[0],[10,'banner',false,'server','7']);
  assert.equal(V.portraitUrl(state,null,()=>{throw Error('wrong identity');}),null);
});

test('map layout handles alternate branches, cycles and keyboard node preview',()=>{
  const preview={nodes:[{id:'start',kind:'start'},{id:'A',kind:'battle'},{id:'B',kind:'battle',target:true},
    {id:'C',kind:'noBattle'},{id:'X',kind:'unknown'}],edges:[{from:'start',to:'A'},
    {from:'A',to:'B'},{from:'A',to:'C'},{from:'C',to:'A'}]};
  const layout=V.mapLayout(preview);
  assert.equal(layout.nodes.length,4);assert(layout.nodes.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)));
  const ui=harness(),selected=[];
  const tree=require('../../src/ui/maps/route_preview')(ui.React.createElement,{profile:{mapPreview:preview,
    routePaths:[{nodes:['A','B']}]},pathIndex:0,onPath:()=>{},onNode:id=>selected.push(id)});
  const node=find(tree,n=>n.type==='g'&&n.props['aria-label']?.startsWith('B 点'));
  assert(node);node.props.onKeyDown({key:'Enter',preventDefault:()=>{}});assert.deepEqual(selected,['B']);
});
