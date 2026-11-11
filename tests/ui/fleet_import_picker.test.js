'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/workbench_fixture'),W=require('../../src/ui/workbench/workbench_model');
const i18n=require('../../src/shared/i18n');

test('import requires a complete fleet snapshot and copies its equipment without touching the store',()=>{
  const store=fixture();store.info.fleets[2].api_ship=[2,3];store.info.ships[2].api_slot=[101,-1];
  assert.equal(W.importFleet(store,1).status,'empty');assert.equal(W.importFleet(store,3).status,'unsynced');
  store.info.equips[101]={api_id:101,api_slotitem_id:10};const before=JSON.stringify(store);
  const result=W.importFleet(store,3);assert.equal(result.status,'ready');
  assert.deepEqual(result.slots.filter(Boolean).map(s=>s.id),[2,3]);
  result.slots[0].slots[0]=-1;assert.equal(store.info.ships[2].api_slot[0],101);assert.equal(JSON.stringify(store),before);
  store.info.fleets[2].api_ship=[1,2,3,4,5,6,7];assert.equal(W.importFleet(store,3).status,'unsupported');
});

test('the shared import dialog offers four fleets with localized unavailable states',()=>{
  const store=fixture(),states=[],refs=[],chosen=[];let i=0,j=0;
  store.info.fleets[0].api_ship=[1,2];store.info.fleets[2].api_ship=[3];store.info.fleets[2].api_mission=[1,1];
  const React={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),
    useEffect:()=>{},useRef(initial){const k=j++;return refs[k]||(refs[k]={current:initial});},
    useState(initial){const k=i++;if(!(k in states))states[k]=initial;return [states[k],v=>{states[k]=typeof v==='function'?v(states[k]):v;}];}};
  const Picker=require('../../src/ui/components/fleet_import_picker')(React);
  const render=()=>{i=0;j=0;return Picker({store,onImport:n=>chosen.push(n)});};
  const walk=n=>n&&typeof n==='object'?[n,...(n.children||[]).flatMap(walk)]:[],text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join('');
  try{
    i18n.setLocale('ja-JP');let tree=render();walk(tree).find(n=>n.type==='button').props.onClick();tree=render();
    const dialog=walk(tree).find(n=>n.props.role==='dialog'),buttons=walk(dialog).filter(n=>n.type==='button'&&typeof n.props.key==='number');
    assert.equal(buttons.length,4);assert.equal(buttons[0].props.disabled,false);assert.equal(buttons[1].props.disabled,true);
    assert.equal(buttons[2].props.disabled,false,'away fleets remain readable');assert.match(text(buttons[1]),/艦隊なし/);
    buttons[2].props.onClick();assert.deepEqual(chosen,[3]);assert(!walk(render()).some(n=>n.props.role==='dialog'));
  }finally{i18n.setLocale('zh-CN');}
});
