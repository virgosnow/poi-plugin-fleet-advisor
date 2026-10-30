'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {nodeFormations}=require('../../src/ui/maps/node_formations');
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
test('small map node popover contains text only; large map contains separate formations',()=>{
  const profile=previewForMap('1-4'),shared={profile,nodeId:'H',onNode(){},onBackground(){},compact:true,nodePopup:true,showDetails:true};
  const small=preview(h,{...shared,textOnly:true,enemyPortrait:e=>h('img',{alt:e.name})});
  const pop=all(small,n=>n.props['aria-label']==='节点详情')[0];assert(pop);
  assert.equal(all(pop,n=>n.type==='img').length,0);assert.equal(all(pop,n=>n.type==='details').length,0);
  const large=preview(h,{...shared,enemyPortrait:e=>h('img',{alt:e.name})});
  const modal=all(large,n=>n.props['aria-label']==='节点详情')[0];
  assert.equal(all(modal,n=>n.type==='details').length,nodeFormations('1-4','H').length);
  assert(all(modal,n=>n.type==='img').length>0);
});
