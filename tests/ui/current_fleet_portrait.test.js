'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('../helpers/workbench_fixture');

test('ship portraits toggle attributes for the actual card row without an extra text button',()=>{
  const store=fixture();store.info.fleets[0].api_ship=[1,2,3,4];
  let index=0,tree;const states=[];
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),
    useState(value){const i=index++;if(!(i in states))states[i]=typeof value==='function'?value():value;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},
    useRef(value){const i=index++;return states[i]||(states[i]={current:value});},useEffect:()=>{}};
  const Component=require('../../src/ui/fleet/current_fleet')(React,{getStore:()=>store});
  const render=(props={})=>{index=0;tree=Component(props);return tree;};
  const find=(node,p)=>!node||typeof node!=='object'?null:p(node)?node:(node.children||[]).map(child=>find(child,p)).find(Boolean);
  const portrait=id=>find(tree,n=>n.props['aria-controls']===`paa-fleet-stats-${id}`);
  const content=id=>find(tree,n=>n.props.id===`paa-fleet-stats-${id}`);
  const eventFor=(id,tops)=>{
    const grid={children:tops.map((top,i)=>({dataset:{shipId:String(i+1)},classList:{contains:()=>true},
      querySelector:()=>true,getBoundingClientRect:()=>({top})}))};
    grid.children.forEach(card=>card.parentElement=grid);
    return {currentTarget:{closest:()=>grid.children[id-1]}};
  };
  render();assert.equal(portrait(1).type,'button');assert.match(portrait(1).props.className,/paa-fleet-portrait-toggle/);
  assert.equal(portrait(1).props['aria-expanded'],false);assert.equal(portrait(1).props['data-tooltip'],'查看属性');assert.equal(content(1).props.inert,'');
  assert(!find(tree,n=>n.type==='button'&&n.children.includes('属性')));
  portrait(1).props.onClick(eventFor(1,[100,100,300,300]));render();
  assert.equal(portrait(1).props['aria-expanded'],true);assert.equal(content(1).props.inert,undefined);
  assert.equal(portrait(2).props['aria-expanded'],true);assert.equal(portrait(3).props['aria-expanded'],false);
  assert.equal(portrait(1).props['data-tooltip'],undefined);assert.equal(portrait(2).props['data-tooltip'],undefined);assert.equal(portrait(3).props['data-tooltip'],'查看属性');
  portrait(2).props.onClick(eventFor(2,[100,100,300,300]));render();
  assert.equal(portrait(1).props['aria-expanded'],false);assert.equal(portrait(2).props['aria-expanded'],false);
  assert.equal(portrait(1).props['data-tooltip'],'查看属性');assert.equal(portrait(2).props['data-tooltip'],'查看属性');
  portrait(3).props.onClick(eventFor(3,[100,100,300,300]));render();
  assert.equal(portrait(3).props['aria-expanded'],true);assert.equal(portrait(4).props['aria-expanded'],true);
  portrait(1).props.onClick(eventFor(1,[100,300,500,700]));render();
  assert.equal(portrait(1).props['aria-expanded'],true);assert.equal(portrait(2).props['aria-expanded'],false);
  assert.equal(portrait(3).props['aria-expanded'],true);
  render({busy:true});assert.equal(portrait(1).props.disabled,true);
});
