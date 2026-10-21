'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const {Pixels}=require('../../src/vision/pixels');
const {Observer,sortread,pageread}=require('../../src/vision/observers');
const {readNumber}=require('../../src/vision/numbers');
const {runMatrix,judge,fileInside}=require('../../tools/vision/zoom-matrix');
const fixture=name=>Pixels.decode(fs.readFileSync(path.join(__dirname,'../fixtures/zoom175',name+'.png')));
test('resampled supported sorts retain direction and unsupported sorts stay rejected',async()=>{
  assert.equal((await sortread(fixture('picker-p1'))).valid,false); // crane, NOT type
  assert.deepEqual(await sortread(fixture('picker-sort4')),{valid:true,mode:'level',direction:'desc'});
  // Live 1.75 NEW-desc frame: the production organizer switches the picker to
  // NEW descending, so this mode must read without a native template.
  assert.deepEqual(await sortread(fixture('picker-new')),{valid:true,mode:'new',direction:'desc'});
  for(const name of ['picker-sort2','picker-sort3'])assert.equal((await sortread(fixture(name))).valid,false,name);
});
test('live 1.75 row levels read exactly after variant glyphs',()=>{
  const im=fixture('picker-page4').normalize();
  const expect=[84,85,52,78,50,95,112,94,123,84];
  for(let row=0;row<10;row++){
    const r=readNumber(im,[823,225+43*row,884,259+43*row]);
    assert.equal(r.valid&&r.value===expect[row],true,'row '+row+' got '+(r.valid?r.value:r.reason));
  }
});
test('selected page five is recognized without relaxing the glyph threshold',()=>{
  const p=pageread(fixture('picker-p2'),{total:5});assert(p.valid);assert.equal(p.activePage,5);assert.deepEqual(p.labels,[1,2,3,4,5]);
});
test('resampled stock and others modes remain distinguishable',async()=>{
  const o=new Observer();for(const [name,mode] of [['equippicker-p1','stock'],['equippicker-others','others']])assert.deepEqual(await o.observe('equipmode',fixture(name)),{valid:true,mode});
  assert.equal((await o.observe('equipmode',fixture('picker-sort4'))).valid,false);
});
test('matrix awaits sortread and distinguishes expected rejection from recognition failure',async()=>{
  assert.equal((await judge(fixture('picker-sort4'),{kind:'sortread',expected:{valid:true,mode:'level'}})).status,'PASS');
  assert.equal((await judge(fixture('picker-sort2'),{kind:'sortread',expected:{valid:false}})).status,'PASS');
  assert.equal((await judge(fixture('picker-sort4'),{kind:'sortread',expected:{valid:false}})).status,'FAIL');
});
test('correct recognition on the wrong page fails navigation expectations',async()=>{
  const im=fixture('picker-p2');
  assert.equal((await judge(im,{kind:'pageread',arg:{total:5},expected:{valid:true,activePage:2}})).status,'FAIL');
  assert.equal((await judge(im,{kind:'pageread',arg:{total:5},expected:{valid:true,activePage:5}})).status,'PASS');
});
test('only manifest frames count; missing and unlabeled data cannot report a complete pass',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'poi-matrix-test-'));
  try{
    fs.copyFileSync(path.join(__dirname,'../fixtures/zoom175/picker-sort4.png'),path.join(dir,'old-remodel.png'));
    fs.writeFileSync(path.join(dir,'env.json'),JSON.stringify({captures:{unlabeled:{rs:'old-remodel.png'},missing:{rs:'absent.png',checks:[{kind:'screen',expected:{valid:true}}]}}}));
    const result=await runMatrix(dir);assert.equal(result.results.length,2);assert.equal(result.summary.UNLABELED,1);assert.equal(result.summary.MISSING,1);assert.equal(result.ok,false);
    await assert.rejects(runMatrix(dir,{method:'typo'}),/Unsupported/);
    assert.throws(()=>fileInside(dir,'../escape.png'),/escapes/);
    fs.writeFileSync(path.join(dir,'env.json'),JSON.stringify({ok:false,error:'collection interrupted',captures:{partial:{rs:'old-remodel.png',checks:[{kind:'sortread',expected:{valid:true,mode:'level'}}]}}}));
    const partial=await runMatrix(dir);assert.equal(partial.summary.PASS,1);assert.equal(partial.ok,false);assert.equal(partial.collectionError,'collection interrupted');
  }finally{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));fs.rmSync(dir,{recursive:true});}
});
test('1.25 and 1.5 NEW-desc picker frames read the new-mode label directly (1.75-trained variant generalizes) (1.75-trained variant generalizes)',async()=>{
  const im=Pixels.decode(fs.readFileSync(path.join(__dirname,'../fixtures/zoom125/picker-new.png'))).normalize();
  for(const dirName of ['zoom125','zoom150']){
    const im=Pixels.decode(fs.readFileSync(path.join(__dirname,'../fixtures',dirName,'picker-new.png'))).normalize();
    assert.deepEqual(await sortread(im),{valid:true,mode:'new',direction:'desc'},dirName);
  }
});
test('1.25/1.5 raw picker frames: level sort stays unique after the NEW variant, row levels read exactly',async()=>{
  const levels=[123,122,112,95,95,94,92,91,89,89]; // store level-desc CV top10
  for(const dirName of ['zoom150','zoom125']){
    const im=Pixels.decode(fs.readFileSync(path.join(__dirname,'../fixtures',dirName,'picker-initial.png'))).normalize();
    assert.deepEqual([im.width,im.height],[1200,720]);
    assert.deepEqual(await sortread(im),{valid:true,mode:'level',direction:'desc'},dirName);
    for(let row=0;row<10;row++){
      const r=readNumber(im,[823,225+43*row,884,259+43*row]);
      assert.equal(r.valid&&r.value===levels[row],true,dirName+' row '+row+' got '+(r.valid?r.value:r.reason));
    }
  }
});
test('1.25 and 1.5 category title variants identify all 15 categories without relaxing the IoU threshold',async()=>{
  const {PNG}=require('pngjs');
  const o=new Observer(),variants=require('../../data/resample_variants.json');
  const cat=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/equip_categories.json'),'utf8'));
  const w=cat.selectedBox[2]-cat.selectedBox[0],h=cat.selectedBox[3]-cat.selectedBox[1];
  for(const dirName of ['zoom150','zoom125']){
  const base=Pixels.decode(fs.readFileSync(path.join(__dirname,'../fixtures',dirName,'equipment-initial.png')));
  for(const variant of variants.categories){
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const v=variant.mask[y][x]==='1'?255:0,q=((cat.selectedBox[1]+y)*1200+(cat.selectedBox[0]+x))*4;
      base.data[q]=v;base.data[q+1]=v;base.data[q+2]=v;
    }
    const r=await o.observe('equippicker',PNG.sync.write({width:1200,height:720,data:base.data}),{total:999});
    assert.equal(r.category,variant.category,'category '+variant.category+' tag '+variant.tag+' base '+dirName);
  }
  }
});
