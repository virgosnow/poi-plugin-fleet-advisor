'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../../src/ui/workbench/workbench_model');
const {Controller}=require('../../src/application/controller');

test('completion publishes the refitted fleet with the matching selected base draft',async()=>{
  const state=[],refs=[];let index=0,refIndex=0;
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),
    useState(initial){const i=index++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;
      return [state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];},
    useRef(initial){const i=refIndex++;return refs[i]||(refs[i]={current:initial});},useEffect:()=>{}};
  const store=require('../helpers/workbench_fixture')();
  store.info.airbase=[{api_area_id:6,api_rid:1,api_action_kind:1,api_plane_info:[1,2,3,4].map(i=>
    ({api_squadron_id:i,api_slotid:0,api_count:0,api_max_count:18,api_state:0}))}];
  store.const.$equips[500]={api_id:500,api_name:'测试主炮',api_type:[0,0,1,1],api_houg:5};
  store.const.$shipTypes[3]={api_equip_type:{1:1}};
  store.info.equips[101]={api_id:101,api_slotitem_id:500,api_level:0};
  store.info.equips[102]={api_id:102,api_slotitem_id:500,api_level:0};
  const controller=new Controller({getStore:()=>store}),option=require('../../src/domain/routes/route_plans')
    .recommendedOptions('6-5').find(row=>row.key==='guide:6-5-04');
  const other=require('../../src/domain/routes/route_plans').recommendedOptions('6-5').find(row=>row.key==='guide:6-5-06');
  const candidate={fleet:1,ships:[{id:1,slots:[-1,-1],ex:-1}]};let fits=0;
  const service={createSnapshot:()=>({snapshotId:'test'}),preview:(...args)=>controller.preview(...args),
    recommendNormalFleet:()=>({routeResults:[option,other].map((row,i)=>({...row,status:'available',chance:{min:1,max:1},recommendationIndex:i})),
      recommendations:[option,other].map(row=>({routeKey:row.key,scheme:candidate}))}),
    recommendNormalEquipment:args=>{fits++;const target=args.landBases[0].targets[0];
      assert(['C','M'].includes(target));return {scheme:{...args.scheme,ships:args.scheme.ships.map(ship=>({...ship,slots:[target==='C'?101:102,-1]}))}};}};
  const baseCache=require('../../src/application/land_base_proposal_cache'),baseChoice=require('../../src/application/land_base_combat_choice');
  const assessor=require('../../src/application/route_combat_assessments');
  const oldAssessor=assessor.assessRouteChoices;
  const reading=()=>({status:'estimated',balance:{ratio:1},diagnostics:{journeys:{samples:32,completed:10},
    target:{id:'M',visits:10,sVictories:2}}});
  assessor.assessRouteChoices=assessor.createRouteCombatAssessor({assess:reading});
  const oldCache=baseCache.createLandBaseProposalCache,oldChoice=baseChoice.createLandBaseCombatSelector,oldIssue=W.draftRouteIssue;
  let proposals=0;
  baseCache.createLandBaseProposalCache=()=>()=>{const target=proposals++===0?'C':'M';
    return {bases:[{areaId:6,rid:1,targets:[target,target],slots:[]}],warnings:[]};};
  baseChoice.createLandBaseCombatSelector=()=>({proposal})=>({assessment:reading(),proposal});
  W.draftRouteIssue=()=>null;
  try{
    const Component=require('../../src/ui/workbench/workbench')(React,{getController:()=>service,getStore:()=>store});
    const names=[...String(Component).split('React.useRef')[0].matchAll(/\[\s*(\w+)\s*,\s*\w+\s*\]\s*=\s*React\.useState\(/g)].map(m=>m[1]);
    const pos=name=>{const i=names.indexOf(name);assert(i>=0,name);return i;};
    const render=()=>{index=0;refIndex=0;return Component({kind:'normal',busy:false,automaticOperations:true});};
    const find=(node,p)=>node&&typeof node==='object'&&(p(node)?node:node.children?.map(child=>find(child,p)).find(Boolean));
    render();state[pos('area')]='6-5';state[pos('mapRoute')]=option.key;
    const tree=render();await find(tree,node=>node.props.className==='paa-wb-complete').props.onClick();
    assert.equal(fits,2);assert.equal(state[pos('error')],'');
    assert.equal(state[pos('slots')][0].slots[0],101);
    assert.deepEqual(state[pos('landBaseDrafts')]['6-5'].bases[0].targets,['C','C']);
    const picker=find(render(),node=>node.type?.name==='RoutePicker');
    assert.equal(picker.props.onChange(other.key),undefined);
    assert.equal(fits,2,'switching an already prepared route does not refit again');
    assert.equal(state[pos('slots')][0].slots[0],102);
    assert.deepEqual(state[pos('landBaseDrafts')]['6-5'].bases[0].targets,['M','M']);
  }finally{baseCache.createLandBaseProposalCache=oldCache;baseChoice.createLandBaseCombatSelector=oldChoice;assessor.assessRouteChoices=oldAssessor;W.draftRouteIssue=oldIssue;}
});
