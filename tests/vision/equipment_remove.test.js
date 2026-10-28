'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {Observer}=require('../../src/vision/observers');
const {Pixels,resampleArea}=require('../../src/vision/pixels');
const frame=()=>Pixels.decode(fs.readFileSync(__dirname+'/../fixtures/equip/normal-remove.png'));
test('real five-slot remodel frame finds each ordinary cross on the correct base and fleet',async()=>{
  const o=new Observer();
  for(let slot=0;slot<5;slot++){
    const r=await o.observe('equipremove',frame(),{fleet:1,slots:5,slot});
    assert(r.valid);assert.equal(r.commit.x,824);
    assert(Math.abs(r.commit.y-(271+47*slot))<=1);
  }
  for(const args of [{fleet:2,slots:5,slot:2},{fleet:1,slots:3,slot:3},{fleet:1,slots:6,slot:0},
    {fleet:1,slots:5,slot:-1},{fleet:1,slots:5,slot:1.5}])assert(!(await o.observe('equipremove',frame(),args)).valid);
});

test('real three- and four-slot frames use the same row layout and reject hidden rows',async()=>{
  const o=new Observer();
  for(const slots of [3,4]){
    const bytes=fs.readFileSync(__dirname+'/../fixtures/equip/normal-remove-'+slots+'.png');
    for(let slot=0;slot<slots;slot++){
      const r=await o.observe('equipremove',bytes,{fleet:1,slots,slot});
      assert(r.valid,slots+' slots, row '+slot);assert.equal(r.commit.x,824);
      assert(Math.abs(r.commit.y-(271+47*slot))<=1);
    }
    for(let slot=slots;slot<5;slot++)assert(!(await o.observe('equipremove',bytes,{fleet:1,slots:5,slot})).valid);
  }
});
test('covered removal cross and non-base screens cannot authorize removal',async()=>{
  const o=new Observer(),im=frame().normalize();
  for(let y=345;y<385;y++)for(let x=810;x<840;x++)im.data.fill(200,(y*im.width+x)*4,(y*im.width+x)*4+3);
  assert(!(await o.observe('equipremove',im,{fleet:1,slots:5,slot:2})).valid);
  assert((await o.observe('equipremove',im,{fleet:1,slots:5,slot:1})).valid,'neighbor remains visible but cannot authorize another row');
  const modal=fs.readFileSync(__dirname+'/../fixtures/equip/confirm.png');
  assert(!(await o.observe('equipremove',modal,{fleet:1,slots:5,slot:0})).valid);
});
test('normal removal cross matches at supported fractional scales',async()=>{
  const o=new Observer();
  for(const scale of [1,1.25,1.5,1.75]){
    const im=resampleArea(frame(),1200*scale,720*scale);
    for(let slot=0;slot<5;slot++){
      const r=await o.observe('equipremove',im,{fleet:1,slots:5,slot});
      assert(r.valid,scale+' slot '+slot);assert.equal(r.commit.x,824);
      assert(Math.abs(r.commit.y-(271+47*slot))<=2);
    }
  }
});

test('an exact ordinary cross at the old extra-slot x cannot authorize ordinary removal',async()=>{
  const o=new Observer(),im=frame().normalize(),tile=im.crop([810,345,840,385]);
  for(let y=345;y<385;y++)for(let x=810;x<840;x++)im.data.fill(0,(y*im.width+x)*4,(y*im.width+x)*4+3);
  for(let y=0;y<tile.height;y++)for(let x=0;x<tile.width;x++){
    const from=(y*tile.width+x)*4,to=((345+y)*im.width+1153+x)*4;
    tile.data.copy(im.data,to,from,from+4);
  }
  assert(!(await o.observe('equipremove',im,{fleet:1,slots:5,slot:2})).valid);
});

test('a cross outside the calibrated horizontal window is rejected instead of broadening the search',async()=>{
  const o=new Observer(),im=frame().normalize(),tile=im.crop([810,345,840,385]);
  for(let y=345;y<385;y++)for(let x=810;x<870;x++)im.data.fill(0,(y*im.width+x)*4,(y*im.width+x)*4+3);
  for(let y=0;y<tile.height;y++)for(let x=0;x<tile.width;x++){
    const from=(y*tile.width+x)*4,to=((345+y)*im.width+840+x)*4;
    tile.data.copy(im.data,to,from,from+4);
  }
  assert(!(await o.observe('equipremove',im,{fleet:1,slots:5,slot:2})).valid);
});

test('dimmed base anchors refuse even a visible ordinary cross',async()=>{
  const o=new Observer(),im=frame().normalize();
  for(let y=145;y<199;y++)for(let x=196;x<383;x++)for(let c=0;c<3;c++)im.data[(y*im.width+x)*4+c]*=.5;
  assert(!(await o.observe('equipremove',im,{fleet:1,slots:5,slot:0})).valid);
});
