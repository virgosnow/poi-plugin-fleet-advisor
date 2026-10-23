'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const create=require('../../src/ui/expedition/expedition_view');
const React={Fragment:Symbol('Fragment'),createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()})};
const find=(node,predicate)=>node&&typeof node==='object'&&(predicate(node)?node:node.children.map(child=>find(child,predicate)).find(Boolean));
function fixture({disabled=false,unmet=false}={}){
  const tree=create(React).overview({disabled,hasShips:true,rate:0,expedition:{eligible:!unmet,
    checks:[{type:'shipCount',left:unmet?3:4,right:4,sat:!unmet}]}});
  const card=find(tree,node=>node.props.className==='paa-exp-outcome');
  let forwards=0,selection={isCollapsed:true};
  const details={open:false};
  const root={ownerDocument:{getSelection:()=>selection},closest:()=>null,
    querySelector:selector=>{assert.equal(selector,'.paa-exp-requirements > summary');return summary;}};
  const dispatch=(target=root,options={})=>card.props.onClick({target,currentTarget:root,
    button:0,defaultPrevented:false,preventDefault(){assert.fail('Native summary activation must remain intact');},...options});
  const summary={closest:()=>summary,click(){forwards++;details.open=!details.open;dispatch(summary);}};
  const content={closest:()=>content},shortfalls={closest:()=>shortfalls};
  return {tree,card,summary,content,shortfalls,dispatch,details,get forwards(){return forwards;},
    select(){selection={isCollapsed:false};},clearSelection(){selection={isCollapsed:true};}};
}

test('departure condition card whitespace activates native summary exactly once',()=>{
  const f=fixture(),summary=find(f.card,node=>node.type==='summary');
  assert.equal(summary.props.onClick,undefined);assert.equal(summary.props.onKeyDown,undefined);
  f.dispatch();assert.equal(f.forwards,1);assert.equal(f.details.open,true);
  f.dispatch();assert.equal(f.forwards,2);assert.equal(f.details.open,false);
  f.dispatch(f.summary);assert.equal(f.forwards,2);
  assert.equal(find(f.card,node=>node.type==='details').props.open,undefined,'Native details keeps its own open state');
});

test('condition bodies and visible unmet details are reading regions and never toggle the card',()=>{
  for(const unmet of [false,true]){
    const f=fixture({unmet});
    assert(find(f.card,node=>node.props.className==='paa-exp-requirements-content'));
    assert.equal(!!find(f.card,node=>node.props.className==='paa-exp-shortfalls'),unmet);
    f.details.open=true;
    f.dispatch(f.content);f.dispatch({nodeType:3,parentElement:f.content});
    f.dispatch(f.shortfalls);f.dispatch({nodeType:3,parentElement:f.shortfalls});
    assert.equal(f.details.open,true);assert.equal(f.forwards,0);
  }
});

test('disabled, selected-text, cancelled and non-primary clicks do not activate the outer card',()=>{
  const disabled=fixture({disabled:true});disabled.dispatch();assert.equal(disabled.forwards,0);
  const f=fixture();f.select();f.dispatch();assert.equal(f.forwards,0);
  f.clearSelection();f.dispatch(undefined,{defaultPrevented:true});
  f.dispatch(undefined,{button:1});f.dispatch(undefined,{button:2});assert.equal(f.forwards,0);
  f.dispatch();assert.equal(f.forwards,1);
});

test('income column headers show complementary integer probabilities without a separate probability row',()=>{
  const view=create(React),all=(n,p)=>!n||typeof n!=='object'?[]:[...(p(n)?[n]:[]),...n.children.flatMap(c=>all(c,p))];
  const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join('');
  const render=rate=>view.overview({rate,hasShips:true,master:{api_win_item1:[3,1]}});
  for(const rate of [0,.4,.5,33.33,50,66.67,99.999,100]){
    const tree=render(rate),columns=all(tree,n=>n.props.role==='columnheader').slice(1).map(text);
    assert(columns.every(c=>/^(成功|大成功) \d+%$/.test(c)));
    assert.equal(columns.reduce((sum,c)=>sum+Number(c.match(/\d+/)[0]),0),100);
    if(rate===0)assert.deepEqual(columns,['成功 100%']);
    if(rate===100)assert.deepEqual(columns,['大成功 100%']);
    assert.equal(all(tree,n=>n.props.className==='paa-exp-rate').length,0);
  }
  for(const rate of [null,undefined,NaN]){
    const columns=all(render(rate),n=>n.props.role==='columnheader').slice(1).map(text);
    assert.deepEqual(columns,['成功 —','大成功 —'],'unknown probabilities must not be presented as zero or certain success');
  }
});
