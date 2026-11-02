'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/workbench_fixture'),F=require('../../src/ui/fleet/current_fleet_model');

test('ship supply status accounts for fuel, ammunition and aircraft without guessing missing data',()=>{
  const full={current:10,max:10},half={current:5,max:10},unknown={current:null,max:10};
  assert.deepEqual(F.shipSupply(full,full,[]),{state:'full'});
  assert.deepEqual(F.shipSupply(full,half,[]),{state:'low'});
  assert.deepEqual(F.shipSupply(full,full,[{id:1,item:{},capacity:20,planes:15}]),{state:'low'});
  assert.deepEqual(F.shipSupply(full,full,[{id:1,item:{},capacity:0,planes:0}]),{state:'full'});
  assert.deepEqual(F.shipSupply(unknown,full,[]),{state:'unknown'});
  assert.deepEqual(F.shipSupply(unknown,half,[]),{state:'low'});
  assert.deepEqual(F.shipSupply(full,full,[{id:1,item:null}]),{state:'unknown'});
});

test('supply warning detects known fuel, ammunition and aircraft deficits without guessing missing data',()=>{
  const s=fixture(),ids=[1,2];
  assert.equal(F.needsSupply(s,ids),false);
  s.info.ships[1].api_fuel--;assert.equal(F.needsSupply(s,ids),true);
  s.info.ships[1].api_fuel++;s.info.ships[2].api_bull--;assert.equal(F.needsSupply(s,ids),true);
  s.info.ships[2].api_bull++;s.const.$ships[1].api_maxeq=[12,0];
  s.info.ships[1].api_slot=[101,-1];s.info.ships[1].api_onslot=[11,0];
  s.info.equips[101]={api_id:101,api_slotitem_id:500};s.const.$equips[500]={api_type:[0,0,6,6]};
  assert.equal(F.needsSupply(s,ids),true);
  s.info.ships[1].api_onslot[0]=12;assert.equal(F.needsSupply(s,ids),false);
  delete s.info.ships[1].api_fuel;delete s.info.ships[1].api_onslot;assert.equal(F.needsSupply(s,ids),false);
  s.info.ships[2].api_bull--;assert.equal(F.needsSupply(s,ids),true,'a known deficit remains visible even if another value is missing');
  assert.equal(F.needsSupply(s,[999]),false);
});

test('fleet status replaces standby only and refreshes when supply observations change',()=>{
  let store=fixture(),index=0,tree;const state=[];
  store.info.fleets[0].api_ship=[1];store.info.fleets[1]={api_ship:[2],api_mission:[1,1,4000]};
  store.info.ships[2].api_fuel=0;
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),
    useState(value){const i=index++;if(!(i in state))state[i]=typeof value==='function'?value():value;return [state[i],v=>state[i]=typeof v==='function'?v(state[i]):v];},
    useRef(value){const i=index++;return state[i]||(state[i]={current:value});},useEffect:()=>{}};
  const Component=require('../../src/ui/fleet/current_fleet')(React,{getStore:()=>store});
  const render=()=>{index=0;tree=Component({});return tree;};
  const find=(node,p)=>!node||typeof node!=='object'?null:p(node)?node:(node.children||[]).map(child=>find(child,p)).find(Boolean);
  const text=node=>typeof node==='string'?node:(node?.children||[]).map(text).join(' ');
  const status=()=>find(find(tree,n=>n.props['data-source-fleet']===1),n=>n.props.className==='paa-fleet-choice-state');
  render();assert.match(text(status()),/待命/);assert.equal(status().props['data-supply'],undefined);
  store={...store,info:{...store.info,ships:{...store.info.ships,1:{...store.info.ships[1],api_fuel:0}}}};
  render();assert.match(text(status()),/补给不足/);assert.equal(status().props['data-supply'],true);
  const heading=find(tree,n=>n.props.className==='paa-fleet-duty');assert.match(text(heading),/补给不足/);assert.equal(heading.props['data-supply'],true);
  const ship=find(tree,n=>n.props['data-ship-id']===1),shipState=find(ship,n=>n.props.className==='paa-fleet-ship-state');
  assert(!text(ship).includes('补给不足'));assert(!text(ship).includes('补给待同步'));
  const name=find(ship,n=>n.type==='strong'&&n.children.includes('测试舰1'));assert.equal(name.props['data-tooltip'],undefined);
  const supply=find(ship,n=>n.props.className==='paa-fleet-supply');assert.equal(supply.props['data-supply-state'],'low');
  assert.match(text(supply),/待补给/);const actions=find(ship,n=>n.props.className==='paa-fleet-ship-actions');
  assert.equal(actions.children.filter(Boolean).length,2);assert(!find(actions,n=>n.type==='progress'));
  assert.equal(shipState.children.length,1);assert.equal(shipState.children[0].props.className,'paa-collapse');
  const away=find(find(tree,n=>n.props['data-source-fleet']===2),n=>n.props.className==='paa-fleet-choice-state');
  assert.equal(away.props['data-state'],'away');assert.equal(away.props['data-supply'],undefined);
  store={...store,info:{...store.info,ships:{...store.info.ships,1:{...store.info.ships[1],api_fuel:store.const.$ships[1].api_fuel_max}}}};
  render();assert.match(text(status()),/待命/);assert.equal(status().props['data-supply'],undefined);
});
