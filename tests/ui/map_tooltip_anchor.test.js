'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {anchorRect,position}=require('../../src/ui/components/tooltip');
test('map tooltip uses visible marker bounds instead of the clipped atlas bounds',()=>{
  const hit={x:410,y:220,left:410,right:440,top:220,bottom:250,width:30,height:30};
  const huge={x:-800,y:-400,left:-800,right:1200,top:-400,bottom:1600,width:2000,height:2000};
  const marker={getBoundingClientRect:()=>hit};let selector;
  const anchor={classList:{contains:k=>k==='paa-map-node'},querySelector:s=>(selector=s,marker),getBoundingClientRect:()=>huge};
  assert.equal(anchorRect(anchor),hit);assert.match(selector,/paa-map-boss-hit/);assert.match(selector,/paa-map-node-body/);
  const point=position(anchorRect(anchor),{width:100,height:30},{width:800,height:600});
  assert(point.left>=350&&point.left<=450);assert(point.top>=180&&point.top<=260);
});
test('other tooltips and map nodes with no marker retain their existing anchor',()=>{
  const bounds={left:10,right:50,top:10,bottom:30,width:40,height:20};
  const normal={classList:{contains:()=>false},getBoundingClientRect:()=>bounds,querySelector(){throw Error('not a map');}};
  assert.equal(anchorRect(normal),bounds);
  const missing={classList:{contains:()=>true},querySelector:()=>null,getBoundingClientRect:()=>bounds};
  assert.equal(anchorRect(missing),bounds);
});
