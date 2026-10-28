'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {Observer}=require('../../src/vision/observers');
const {Pixels,resampleArea}=require('../../src/vision/pixels');
const frame=()=>Pixels.decode(fs.readFileSync(__dirname+'/../fixtures/equip/normal-remove.png'));
test('normal-slot removal finds the original game cross only on the correct equipment base and fleet',async()=>{
  const o=new Observer();
  for(let slot=0;slot<5;slot++){
    const r=await o.observe('equipremove',frame(),{fleet:2,slots:5,slot});
    assert(r.valid);assert.deepEqual(r.commit,{x:1167,y:[271,321,366,412,457][slot]});
  }
  for(const args of [{fleet:1,slots:5,slot:2},{fleet:2,slots:3,slot:3},{fleet:2,slots:6,slot:0}])assert(!(await o.observe('equipremove',frame(),args)).valid);
});
test('covered removal cross and non-base screens cannot authorize removal',async()=>{
  const o=new Observer(),im=frame();
  for(let y=350;y<380;y++)for(let x=1150;x<1185;x++)im.data.fill(200,(y*1200+x)*4,(y*1200+x)*4+3);
  assert(!(await o.observe('equipremove',im,{fleet:2,slots:5,slot:2})).valid);
  const modal=fs.readFileSync(__dirname+'/../fixtures/equip/confirm.png');
  assert(!(await o.observe('equipremove',modal,{fleet:2,slots:5,slot:0})).valid);
});
test('normal removal cross matches at supported fractional scales',async()=>{
  const o=new Observer();
  for(const scale of [1.25,1.5,1.75]){
    const im=resampleArea(frame(),1200*scale,720*scale);
    assert((await o.observe('equipremove',im,{fleet:2,slots:5,slot:3})).valid,String(scale));
  }
});
