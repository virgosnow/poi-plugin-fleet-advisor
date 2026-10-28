'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {Pixels,resampleArea}=require('../../src/vision/pixels');
const {Observer}=require('../../src/vision/observers');
const {portReturn}=require('../../src/vision/port_return');
const frame=()=>Pixels.decode(fs.readFileSync(__dirname+'/../fixtures/equip/return-button.png'));
test('real non-home circle is recognized without changing ordinary screen detection',async()=>{
  const o=new Observer(),im=frame();
  assert.deepEqual(await o.observe('screen',im),{valid:false,mode:'unknown'});
  assert.deepEqual(await o.observe('screen',im,{allowPortReturn:true}),{valid:true,mode:'port-return',returnButton:{page:'port',x:62,y:58}});
});
test('return button survives fractional viewport resampling',()=>{
  for(const scale of [1.25,1.5,1.75]){
    const im=resampleArea(frame(),Math.round(1200*scale),Math.round(720*scale)).normalize();
    assert.equal(portReturn(im)?.page,'port',String(scale));
  }
});
test('dimmed, covered, blank and shifted buttons never authorize returning',()=>{
  for(const kind of ['dim','covered','blank','shifted']){
    const im=frame();
    if(kind==='dim')for(let i=0;i<im.data.length;i++)if(i%4!==3)im.data[i]*=.65;
    if(kind==='covered')for(let y=30;y<145;y++)for(let x=130;x<170;x++)im.data.fill(50,(y*1200+x)*4,(y*1200+x)*4+3);
    if(kind==='blank')im.data.fill(0);
    if(kind==='shifted')im.data.copyWithin(32*4,0,im.data.length-32*4);
    assert.equal(portReturn(im),null,kind);
  }
});
test('the original home glyph is never interpreted as a return button',async()=>{
  const im=Pixels.decode(fs.readFileSync(__dirname+'/../fixtures/equip/home-toggle.png'));
  assert.equal(portReturn(im),null);
  assert.deepEqual(await new Observer().observe('screen',im,{allowPortReturn:true}),{valid:false,mode:'unknown',reason:'home hide-UI button excluded'});
});
test('rotated and hovered title from the failed live screen still recognizes the stationary border',async()=>{
  const im=Pixels.decode(fs.readFileSync(__dirname+'/../fixtures/equip/return-button-rotated.png'));
  assert.deepEqual(await new Observer().observe('screen',im,{allowPortReturn:true}),
    {valid:true,mode:'port-return',returnButton:{page:'port',x:62,y:58}});
});
test('changing the interior title does not break matching the border',()=>{
  const im=frame();
  for(let y=12;y<105;y++)for(let x=12;x<105;x++)im.data.set([160,110,190],(y*1200+x)*4);
  assert.equal(portReturn(im)?.page,'port');
});
test('one-pixel raster offsets retain border matching without lowering thresholds',()=>{
  const source=frame();
  for(const [dx,dy] of [[1,0],[0,1],[-1,0],[0,-1]]){
    const im=new Pixels(1200,720,Buffer.alloc(1200*720*4));
    for(let y=2;y<165;y++)for(let x=2;x<170;x++)im.data.set(source.rgb(x,y),( (y+dy)*1200+x+dx)*4);
    assert(portReturn(im),`${dx},${dy}`);
  }
});
test('a gold region without concentric border structure is rejected',()=>{
  const im=frame();
  for(let y=0;y<170;y++)for(let x=0;x<180;x++)im.data.set([230,200,100],(y*1200+x)*4);
  assert.equal(portReturn(im),null);
});
