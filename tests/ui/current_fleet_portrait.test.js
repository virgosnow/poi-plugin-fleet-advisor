'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/workbench_fixture');

test('ship portraits toggle their own attributes without an extra text button',()=>{
  const store=fixture();store.info.fleets[0].api_ship=[1,2];
  let index=0,tree;const states=[];
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),
    useState(value){const i=index++;if(!(i in states))states[i]=typeof value==='function'?value():value;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},
    useRef(value){const i=index++;return states[i]||(states[i]={current:value});},useEffect:()=>{}};
  const Component=require('../../src/ui/fleet/current_fleet')(React,{getStore:()=>store});
  const render=(props={})=>{index=0;tree=Component(props);return tree;};
  const find=(node,p)=>!node||typeof node!=='object'?null:p(node)?node:(node.children||[]).map(child=>find(child,p)).find(Boolean);
  const portrait=id=>find(tree,n=>n.props['aria-controls']===`paa-fleet-stats-${id}`);
  const content=id=>find(tree,n=>n.props.id===`paa-fleet-stats-${id}`);
  render();assert.equal(portrait(1).type,'button');assert.match(portrait(1).props.className,/paa-fleet-portrait-toggle/);
  assert.equal(portrait(1).props['aria-expanded'],false);assert.equal(content(1).props.inert,'');
  assert(!find(tree,n=>n.type==='button'&&n.children.includes('属性')));
  portrait(1).props.onClick();render();assert.equal(portrait(1).props['aria-expanded'],true);assert.equal(content(1).props.inert,undefined);
  assert.equal(portrait(2).props['aria-expanded'],false);
  portrait(1).props.onClick();render();assert.equal(portrait(1).props['aria-expanded'],false);
  render({busy:true});assert.equal(portrait(1).props.disabled,true);
});
