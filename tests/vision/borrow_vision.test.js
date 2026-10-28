const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');const {Observer}=require('../../src/vision/observers');
const obs=new Observer(),frame=n=>fs.readFileSync(__dirname+'/../fixtures/'+n+'.png');
for(const [name,mode] of [['borrow/stock','stock'],['borrow/others','others'],['borrow/others-page2','others'],['borrow/stock-filtered-heading','stock']])test('fresh picker mode '+name,async()=>{assert.deepEqual(await obs.observe('equipmode',frame(name)),{valid:true,mode});});
test('native transfer confirmation matches only the final modal',async()=>{assert((await obs.observe('borrowconfirm',frame('borrow/confirm'))).valid);for(const name of ['borrow/stock','borrow/others','equip/confirm'])assert(!(await obs.observe('borrowconfirm',frame(name))).valid);assert(!(await obs.observe('equipmode',frame('borrow/confirm'))).valid);});

test('other-ship mode is verified by the intact stock toggle when the heading is covered',async()=>{
  assert.deepEqual(await obs.observe('equipmode',frame('borrow/others-filtered-heading')),{valid:true,mode:'others'});
});
test('a damaged mode toggle cannot authorize selecting equipment with an unreadable heading',async()=>{
  const {Pixels}=require('../../src/vision/pixels'),im=Pixels.decode(frame('borrow/others-filtered-heading'));
  for(let y=155;y<183;y++)for(let x=1070;x<1185;x++)im.data.fill(0,(y*1200+x)*4,(y*1200+x)*4+3);
  assert.equal((await obs.observe('equipmode',im)).valid,false);
});
test('conflicting source heading and toggle indicators never authorize equipment selection',async()=>{
  const {Pixels}=require('../../src/vision/pixels'),im=Pixels.decode(frame('borrow/others-filtered-heading'));
  const stock=Pixels.decode(frame('borrow/stock'));
  for(let y=155;y<183;y++)stock.data.copy(im.data,(y*1200+860)*4,(y*1200+860)*4,(y*1200+942)*4);
  const result=await obs.observe('equipmode',im);
  assert.equal(result.valid,false);assert.equal(result.reason,'equipment source indicators conflict');
});
for(const mode of ['stock','others'])test(mode+' covered-heading mode recognition survives supported viewport resampling',async()=>{
  const {Pixels,resampleArea}=require('../../src/vision/pixels');
  for(const scale of [1.25,1.5,1.75]){
    const im=resampleArea(Pixels.decode(frame('borrow/'+mode+'-filtered-heading')),Math.round(1200*scale),Math.round(720*scale));
    assert.deepEqual(await obs.observe('equipmode',im),{valid:true,mode},String(scale));
  }
});
test('stock mode is rejected when both its source heading and toggle are unreadable',async()=>{
  const {Pixels}=require('../../src/vision/pixels'),im=Pixels.decode(frame('borrow/stock-filtered-heading'));
  for(let y=155;y<183;y++)for(let x=1070;x<1185;x++)im.data.fill(0,(y*1200+x)*4,(y*1200+x)*4+3);
  assert.equal((await obs.observe('equipmode',im)).valid,false);
});
test('the stock toggle cannot bypass an unreadable sort heading',async()=>{
  const {Pixels}=require('../../src/vision/pixels'),im=Pixels.decode(frame('borrow/others-filtered-heading'));
  for(let y=155;y<183;y++)for(let x=648;x<727;x++)im.data.fill(0,(y*1200+x)*4,(y*1200+x)*4+3);
  assert.equal((await obs.observe('equipmode',im)).valid,false);
});
