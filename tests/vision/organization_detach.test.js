'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {Observer}=require('../../src/vision/observers');
const {Pixels,resampleArea}=require('../../src/vision/pixels');
const frame=()=>Pixels.decode(fs.readFileSync(__dirname+'/../fixtures/org/detach.png'));

test('native picker detach reference requires a valid filter and the exact destination tab',async()=>{
  const o=new Observer(),im=frame();
  assert.deepEqual(await o.observe('orgdetach',im,{fleet:2}),{valid:true,tab:{valid:true,selected:[2]},commit:{x:1161,y:678}});
  for(const fleet of [0,1,3,4,5,2.5])assert(!(await o.observe('orgdetach',im,{fleet})).valid);
  for(const name of ['fleet','sort-new-normalized','page06-card']){
    const other=fs.readFileSync(__dirname+'/../fixtures/org/'+name+'.png');
    assert(!(await o.observe('orgdetach',other,{fleet:2})).valid,name);
  }
});

test('missing, dimmed and covered detach buttons never authorize a click',async()=>{
  const o=new Observer();
  for(const factor of [0,.5]){
    const im=frame();
    for(let y=660;y<696;y++)for(let x=1122;x<1200;x++)for(let k=0;k<3;k++){
      const at=(y*im.width+x)*4+k;im.data[at]=Math.round(im.data[at]*factor);
    }
    assert(!(await o.observe('orgdetach',im,{fleet:2})).valid);
  }
  const im=frame();
  for(let y=664;y<692;y++)for(let x=1130;x<1196;x++)im.data.fill(220,(y*im.width+x)*4,(y*im.width+x)*4+3);
  assert(!(await o.observe('orgdetach',im,{fleet:2})).valid);
});

test('detach reference retains its threshold across supported fractional scales',async()=>{
  const o=new Observer();
  for(const scale of [1.25,1.5,1.75])assert((await o.observe('orgdetach',resampleArea(frame(),1200*scale,720*scale),{fleet:2})).valid,String(scale));
});
